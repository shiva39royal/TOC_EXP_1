import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractOfflineProject, type LayoutToken } from '@/engine/offlineExtractor';

const sourceLayout = { kind: 'PDF' as const, fileName: 'station-a.pdf' };
const text = (value: string, x: number, y: number, extra: Partial<LayoutToken> = {}): LayoutToken => ({
  text: value, x, y, page: 1, width: value.length * 1.2, height: 2, confidence: 95, kind: 'text', ...extra,
});
const ring = (x: number, y: number): LayoutToken => ({ text: '', kind: 'ring', x, y, width: 2.6, height: 2.6, page: 1 });
const track = (x: number, x2: number, y: number): LayoutToken => ({ text: '', kind: 'track', x, x2, y, height: 0.8, page: 1 });

/** A generic two-signal line: tag labels below the line with their chainage underneath. */
function layout(extra: LayoutToken[] = []): LayoutToken[] {
  return [
    track(0, 400, 100),
    text('DN', 26, 103.5), text('MAIN', 31, 103.5),
    text('UP', 300, 20), text('DOWN', 320, 20),
    text('R-101', 50, 102.8), text('10.000', 50, 105.2),
    text('R-102', 150, 102.8), text('10.100', 150, 105.2),
    text('R-103', 250, 102.8), text('10.200', 250, 105.2),
    // Signal head rows to the right of their posts (posts stand on the foot tags).
    ring(58, 94), ring(60.6, 94), text('1D', 59, 91),
    ring(258, 94), ring(260.6, 94), text('1', 259, 91),
    ...extra,
  ];
}

describe('offline drawing extraction', () => {
  it('pairs every tag with its own chainage and builds the route between consecutive signals', () => {
    const project = extractOfflineProject({ fileName: 'station-a.pdf', sourceLayout, tokens: layout() });
    expect(project.tags.map((tag) => [tag.tagId, tag.chainageM])).toEqual([['R-101', 10000], ['R-102', 10100], ['R-103', 10200]]);
    expect(project.tracks.map((t) => t.name)).toEqual(['DN MAIN']);
    expect(project.signals.map((s) => [s.name, s.footTagId, s.direction])).toEqual([['S1D', 'R-101', 'DOWN'], ['S1', 'R-103', 'DOWN']]);
    expect(project.routes).toHaveLength(1);
    expect(project.routes[0]!.entrySignal).toBe('S1D');
    expect(project.routes[0]!.exitSignal).toBe('S1');
    expect(project.routes[0]!.distanceBetweenSignalsM).toBe(200);
    expect(project.routes[0]!.linkingSequence).toEqual([{ distanceM: 100, tagId: 'R-102' }, { distanceM: 100, tagId: 'R-103' }]);
    expect(project.routes[0]!.engineerStatus).toBe('NEEDS_REVIEW');
  });

  it('collects TIN labels drawn on the line between two signals', () => {
    const project = extractOfflineProject({ fileName: 'a.pdf', sourceLayout, tokens: layout([text('N-46', 200, 97)]) });
    expect(project.tracks[0]!.tinList).toEqual(['N-46']);
    expect(project.routes[0]!.tinsRequiresFree).toEqual(['N-46']);
  });

  it('does not treat a number without a drawn signal head as a signal', () => {
    const tokens = layout().filter((t) => !(t.kind === 'ring' && t.x > 200));
    const project = extractOfflineProject({ fileName: 'a.pdf', sourceLayout, tokens });
    expect(project.signals.map((s) => s.name)).toEqual(['S1D']);
    expect(project.routes).toEqual([]);
  });

  it('reads an OCR "11D" beside a 1D/1 pair as inner distant 1 ID', () => {
    const project = extractOfflineProject({
      fileName: 'a.pdf', sourceLayout,
      tokens: layout([text('R-104', 350, 102.8), text('10.300', 350, 105.2), ring(358, 94), ring(360.6, 94), text('11D', 359, 91)]),
    });
    expect(project.signals.map((s) => s.name)).toContain('S1 ID');
  });

  it('drops tags without location evidence and chainages far from the rest of the station', () => {
    const tokens: LayoutToken[] = [
      text('R-100', 20, 50), text('10.000', 20, 52.4),
      text('R-101', 40, 50), text('10.050', 40, 52.4),
      text('R-102', 60, 50), text('10.100', 60, 52.4),
      text('R-103', 80, 50), text('99.150', 80, 52.4),
      text('R-999', 300, 200), text('RFID', 280, 200),
    ];
    const project = extractOfflineProject({ fileName: 'a.pdf', sourceLayout, tokens });
    expect(project.tags.map((tag) => tag.tagId)).toEqual(['R-100', 'R-101', 'R-102']);
  });

  it('reads station, code and adjacent station IDs from the allocation table', () => {
    const tokens = layout([
      text('CHITRA', 100, 150, { height: 4 }), text('(CTA)', 108, 150, { height: 4 }),
      text('CTA', 140, 170), text('UP', 160, 170), text('DN', 180, 170),
      text('STATION', 110, 173), text('ID', 117, 173), text('520', 140, 173), text('503', 160, 173), text('521', 180, 173),
    ]);
    const { metadata } = extractOfflineProject({ fileName: 'x.pdf', sourceLayout, tokens });
    expect(metadata.stationName).toBe('CHITRA');
    expect(metadata.stationCode).toBe('CTA');
    expect(metadata.stationId).toBe('520');
    expect(metadata.nextUpStationId).toBe('503');
    expect(metadata.nextDownStationId).toBe('521');
  });

  it('interpolates missing tag chainages from yard geometry and satisfies RDSO linking sum check', () => {
    const tokens: LayoutToken[] = [
      track(0, 400, 100),
      text('DN', 26, 103.5), text('MAIN', 31, 103.5),
      text('UP', 300, 20), text('DOWN', 320, 20),
      text('R-101', 50, 102.8), text('120.000', 50, 105.2),
      text('R-102', 150, 102.8), // NO chainage label beside R-102
      text('R-103', 250, 102.8), text('120.200', 250, 105.2),
      ring(58, 94), ring(60.6, 94), text('1D', 59, 91),
      ring(258, 94), ring(260.6, 94), text('1', 259, 91),
    ];
    const project = extractOfflineProject({ fileName: 'test.pdf', sourceLayout, tokens });
    const r102 = project.tags.find((t) => t.tagId === 'R-102');
    expect(r102).toBeDefined();
    expect(r102!.chainageM).toBe(120100);
    expect(r102!.confidence).not.toBe('LOW');

    expect(project.routes).toHaveLength(1);
    const r = project.routes[0]!;
    expect(r.distanceBetweenSignalsM).toBe(200);
    const linkingSum = r.linkingSequence.reduce((sum, link) => sum + link.distanceM, 0);
    expect(linkingSum).toBe(200);
  });

  it('does not create a phantom signal from a bare number near an en-route tag', () => {
    const tokens: LayoutToken[] = [
      track(0, 400, 100),
      text('UP', 30, 20), text('MAIN', 50, 20),
      text('R-201', 100, 102.8), text('120.000', 100, 105.2), text('N', 95, 100),
      text('18', 105, 96),
    ];
    const project = extractOfflineProject({ fileName: 'test.pdf', sourceLayout, tokens });
    expect(project.signals.some((s) => s.name === 'S18' || s.name === 'S8')).toBe(false);
  });

  it('preserves two-digit signal 30 and connects 30 ID to S30', () => {
    const tokens: LayoutToken[] = [
      track(0, 500, 100),
      text('UP', 30, 20), text('MAIN', 50, 20),
      text('R-301', 100, 102.8), text('122.000', 100, 105.2),
      text('R-302', 300, 102.8), text('121.000', 300, 105.2),
      ring(98, 94), ring(95.4, 94), text('30ID', 99, 91),
      ring(298, 94), ring(295.4, 94), text('30', 299, 91),
    ];
    const project = extractOfflineProject({ fileName: 'test.pdf', sourceLayout, tokens });
    const s30 = project.signals.find((s) => s.name === 'S30');
    expect(s30).toBeDefined();
    expect(project.signals.some((s) => s.name === 'S3' && s.direction === 'UP')).toBe(false);
    const approachRoute = project.routes.find((r) => r.entrySignal === 'S30 ID');
    expect(approachRoute).toBeDefined();
    expect(approachRoute!.exitSignal).toBe('S30');
  });

  it('synthesizes 8 aspect rows for a 4-aspect Distant in Double Distant territory without any Red exit aspects', () => {
    const tokens: LayoutToken[] = [
      track(0, 800, 100),
      text('DN', 26, 103.5), text('MAIN', 31, 103.5),
      text('UP', 300, 20), text('DOWN', 320, 20),
      text('R-101', 50, 102.8), text('10.000', 50, 105.2),
      text('R-102', 150, 102.8), text('11.000', 150, 105.2),
      text('R-103', 250, 102.8), text('12.000', 250, 105.2),
      ring(58, 94), ring(60.6, 94), text('1D', 59, 91),
      ring(158, 94), ring(160.6, 94), text('1ID', 159, 91),
      ring(258, 94), ring(260.6, 94), text('1', 259, 91),
    ];
    const project = extractOfflineProject({ fileName: 'test.pdf', sourceLayout, tokens });
    const distantRoute = project.routes.find((r) => r.entrySignal === 'S1D');
    expect(distantRoute).toBeDefined();
    expect(distantRoute!.exitSignal).toBe('S1 ID');
    expect(distantRoute!.aspectPermutations).toHaveLength(8);
    const aspects = distantRoute!.aspectPermutations!.map((p) => p.aspectOfEntrySignal);
    expect(aspects).toEqual([
      'Green', 'Green',
      'Double Yellow', 'Double Yellow', 'Double Yellow',
      'Yellow', 'Yellow', 'Yellow'
    ]);
    const mas = distantRoute!.aspectPermutations!.map((p) => p.movementAuthoritySections);
    expect(mas).toEqual(['3', '3', '3', '3', '2', '3', '3', '2']);
    for (const p of distantRoute!.aspectPermutations!) {
      expect(p.requiresAspectOfExitSignal).not.toContain('Red');
    }
  });

  it('strictly contains zero hardcoded station names, fixed signal IDs or chainages in engine logic', () => {
    const filesToAudit = [
      path.resolve(__dirname, '../engine/offlineExtractor.ts'),
      path.resolve(__dirname, '../utils/exportToc.ts'),
    ];
    const forbiddenPatterns = [
      /\bCHITGIDDA\b/i,
      /\bCTF\b/,
      /\b122790\b/,
    ];
    for (const filePath of filesToAudit) {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const pattern of forbiddenPatterns) {
        expect(content).not.toMatch(pattern);
      }
    }
  });
});
