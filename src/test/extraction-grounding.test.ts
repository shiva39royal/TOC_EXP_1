import { describe, expect, it } from 'vitest';
import {
  groundNormalizedExtraction,
  mergeLayoutExtractions,
  planVisualSections,
} from '@/server/extractionGrounding';

describe('source-grounded extraction', () => {
  it('drops entities absent from embedded drawing text', () => {
    const result = groundNormalizedExtraction(
      {
        tracks: [{ name: 'UP MAIN' }, { name: 'COMMON LOOP' }],
        signals: [{ name: 'A511' }, { name: 'S-999' }],
        points: [{ name: '101' }],
        tags: [{ tagId: 'R-263' }, { tagId: 'R-999' }],
        levelCrossings: [{ name: 'LC 49' }, { name: 'LC 999' }],
        routes: [],
        blockSections: [],
      },
      'UP MAIN LINE | A511 | R-263 | LX NO. 49',
    );

    expect(result.tracks?.map((track) => track.name)).toEqual(['UP MAIN']);
    expect(result.signals?.map((signal) => signal.name)).toEqual(['A511']);
    expect(result.tags?.map((tag) => tag.tagId)).toEqual(['R-263']);
    expect(result.levelCrossings?.map((lc) => lc.name)).toEqual(['LC 49']);
    expect(result.points).toEqual([]);
  });

  it('removes routes and references that are not in the extracted inventories', () => {
    const result = groundNormalizedExtraction(
      {
        signals: [{ name: 'A511' }, { name: 'A513' }],
        points: [],
        tags: [{ tagId: 'R-263' }],
        tracks: [],
        levelCrossings: [],
        routes: [
          {
            entrySignal: 'A511',
            exitSignal: 'A513',
            pointsNormal: ['101'],
            pointsReverse: [],
            entryFootTag: 'R-999',
            linkingSequence: [{ tagId: 'R-263', distanceM: 10 }, { tagId: 'R-999', distanceM: 20 }],
            enRouteTags: ['R-263', 'R-999'],
          },
          { entrySignal: 'A511', exitSignal: 'S-999' },
        ],
        blockSections: [{ lastStopSignal: 'S-999' }],
      },
      '',
    );

    expect(result.routes).toHaveLength(1);
    expect(result.routes?.[0]?.pointsNormal).toEqual([]);
    expect(result.routes?.[0]?.entryFootTag).toBe('--');
    expect(result.routes?.[0]?.linkingSequence).toEqual([{ tagId: 'R-263', distanceM: 10 }]);
    expect(result.routes?.[0]?.enRouteTags).toEqual(['R-263']);
    expect(result.blockSections).toEqual([]);
  });

  it('merges drawing sections without duplicate entities and renumbers routes', () => {
    const merged = mergeLayoutExtractions([
      {
        metadata: { stationName: '--', stationCode: 'UJP' },
        signals: [{ name: 'A511', line: 'UP MAIN', confidence: 'LOW' }],
        tags: [{ tagId: 'R-263', line: 'UP MAIN', confidence: 'LOW' }],
        routes: [{ entrySignal: 'A511', exitSignal: 'A513', direction: 'UP' }],
      },
      {
        metadata: { stationName: 'UJIARPUR' },
        signals: [{ name: 'A511', line: '--', confidence: 'HIGH', chainageM: 28560 }],
        tags: [{ tagId: 'R-263', line: '--', confidence: 'HIGH' }],
        routes: [{ entrySignal: 'A513', exitSignal: 'A515', direction: 'UP' }],
      },
    ]);

    expect(merged.metadata).toEqual({ stationName: 'UJIARPUR', stationCode: 'UJP' });
    expect(merged.signals).toHaveLength(1);
    expect(merged.signals[0].chainageM).toBe(28560);
    expect(merged.tags).toHaveLength(1);
    expect(merged.routes.map((route: any) => route.slNo)).toEqual([1, 2]);
  });

  it('uses every visual crop exactly once when planning concurrent sections', () => {
    const sections = planVisualSections([0, 1, 2, 3, 4, 5, 6], 3);
    expect(sections.map((section) => section.length)).toEqual([3, 3, 1]);
    expect(sections.flat()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
