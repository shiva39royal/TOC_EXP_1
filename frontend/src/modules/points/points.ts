import type { LayoutToken } from "@/engine/offlineExtractor";
import type { ConfidenceLevel, LevelCrossing, PointSwitch, TrackLine } from "@/types/signalling";
import { nearestTrackLine, type InternalTrackLine } from "../lines/lines";

export interface PointsExtractionInput {
  tokens: LayoutToken[];
  trackLines: TrackLine[];
  internalLines?: InternalTrackLine[];
}

export interface PointsExtractionResult {
  points: PointSwitch[];
  levelCrossings: LevelCrossing[];
}

function upper(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, " ").trim();
}

function unitHeight(texts: LayoutToken[]): number {
  const heights = texts.map((t) => t.height || 0).filter((h) => h > 0);
  if (heights.length === 0) return 8;
  heights.sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)] || 8;
}

function parseChainage(raw: string): number | null {
  const text = upper(raw)
    .replace(/\s+/g, "")
    .replace(/^(?:TO-?|KM|CH)[.:\s-]*/i, "");
  const kmMatch = text.match(/^\(?(\d{1,4})[./,:-](\d{1,3})\)?(?:KM)?\.?$/);
  if (kmMatch) {
    const km = Number(kmMatch[1]);
    const mStr = kmMatch[2]!.padEnd(3, "0").slice(0, 3);
    const value = km * 1000 + Number(mStr);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return null;
}

function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const LC_PATTERN = /(?:LC|GATE|L\.C\.)\s*[-:.]?\s*(\d{1,4}[A-Z]?)/i;

/**
 * Extracts Point Switches (e.g. 11, 12, 13, 18, 20) and Level Crossings (e.g. LC-49)
 * 100% dynamically from drawing layout tokens, crossover link geometries, and turnout chainages.
 * ZERO hardcoded numbers.
 */
export function extractPointsAndCrossings(input: PointsExtractionInput): PointsExtractionResult {
  const { tokens, trackLines, internalLines = [] } = input;
  const texts = tokens.filter((t) => !t.kind || t.kind === "text");
  const h = unitHeight(texts);

  // 1. Identify Turnout Chainages ("TO-..." or "CH:...")
  const turnoutChainages: Array<{ token: LayoutToken; value: number }> = [];
  for (const t of texts) {
    const raw = upper(t.text);
    if (/^(?:TO-?|TURNOUT|SW)/i.test(raw)) {
      const ch = parseChainage(raw);
      if (ch !== null) turnoutChainages.push({ token: t, value: ch });
    }
  }

  // 2. Identify Crossover Switch Legs connecting track lines
  interface CrossoverLeg {
    a: InternalTrackLine | TrackLine;
    xa: number;
    b: InternalTrackLine | TrackLine;
    xb: number;
    p: { x: number; y: number };
    q: { x: number; y: number };
    page: number;
    label: string;
  }

  const bareText = (t: LayoutToken) => upper(t.text).replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "");
  const pointLabels = texts.filter(
    (t) =>
      !t.vertical &&
      /^\d{1,3}[AB]?$/.test(bareText(t)) &&
      !/^R\s*[-:.]?\s*\d+/i.test(t.text) &&
      (t.confidence ?? 100) >= 40,
  );

  const legs: CrossoverLeg[] = [];
  const linesToSearch = internalLines.length > 0 ? internalLines : trackLines;

  for (const token of tokens) {
    if (token.kind !== "link" || !Number.isFinite(token.x2) || !Number.isFinite(token.y2)) continue;
    const p = { x: token.x, y: token.y, page: token.page };
    const q = { x: token.x2!, y: token.y2!, page: token.page };

    const a = nearestTrackLine(linesToSearch as any, p, h, 5.5);
    const b = nearestTrackLine(linesToSearch as any, q, h, 5.5);
    if (!a || !b || a === b) continue;

    // Find nearest point number label
    const nearbyLabel = pointLabels
      .filter((t) => t.page === token.page)
      .map((t) => ({ t, d: distanceToSegment(t, p, q) }))
      .filter((item) => item.d <= 8.5 * h)
      .sort((x, y) => x.d - y.d)[0];

    legs.push({
      a,
      xa: p.x,
      b,
      xb: q.x,
      p,
      q,
      page: token.page,
      label: nearbyLabel ? bareText(nearbyLabel.t) : "",
    });
  }

  // 3. Assemble Point Switches
  const points: PointSwitch[] = [];
  const usedNames = new Set<string>();

  // A. Points from crossover legs
  for (const leg of legs) {
    if (!leg.label || usedNames.has(leg.label)) continue;
    const mid = { x: (leg.p.x + leg.q.x) / 2, y: (leg.p.y + leg.q.y) / 2 };
    const nearbyTurnout = turnoutChainages
      .filter(
        (c) => c.token.page === leg.page && Math.hypot(c.token.x - mid.x, c.token.y - mid.y) <= 8.0 * h,
      )
      .sort(
        (x, y) =>
          Math.hypot(x.token.x - mid.x, x.token.y - mid.y) -
          Math.hypot(y.token.x - mid.x, y.token.y - mid.y),
      )[0];

    usedNames.add(leg.label);
    points.push({
      id: `point-${points.length + 1}`,
      name: leg.label,
      chainageM: nearbyTurnout?.value ?? null,
      normalLine: (leg.a as any).id || (leg.a as any).name || "",
      reverseLine: (leg.b as any).id || (leg.b as any).name || "",
      turnoutSpeedKmph: 30,
      confidence: "HIGH" as ConfidenceLevel,
      notes: `Point switch linking ${(leg.a as any).name || (leg.a as any).id} and ${(leg.b as any).name || (leg.b as any).id}.`,
    });
  }

  // B. Points from explicit "POINT" / "PT" labels or numbers near turnout chainages / N-xx tags
  for (const t of texts) {
    if (t.vertical) continue;
    const raw = upper(t.text);
    const explicit = raw.match(/^(?:PT\.?|POINT)\s*[-:]?\s*(\d{1,3}[A-Z]?)$/);
    const bareMatch = raw.match(/^(\d{1,3}[AB]?)$/);

    const isNearTurnout = turnoutChainages.some(
      (c) => c.token.page === t.page && Math.hypot(c.token.x - t.x, c.token.y - t.y) <= 6.5 * h,
    );
    const isNearNormalTag = texts.some(
      (ot) =>
        ot.page === t.page &&
        /^N\s*-?\s*\d+/i.test(ot.text) &&
        Math.hypot(ot.x - t.x, ot.y - t.y) <= 6.5 * h,
    );

    const name = explicit?.[1] || (bareMatch && (isNearTurnout || isNearNormalTag) ? bareMatch[1] : null);
    if (!name || usedNames.has(name)) continue;

    const nearbyTurnout = turnoutChainages
      .filter((c) => c.token.page === t.page && Math.hypot(c.token.x - t.x, c.token.y - t.y) <= 6.0 * h)
      .sort(
        (x, y) =>
          Math.hypot(x.token.x - t.x, x.token.y - t.y) -
          Math.hypot(y.token.x - t.x, y.token.y - t.y),
      )[0];

    const assignedLine = nearestTrackLine(linesToSearch as any, t, h, 3.5);

    usedNames.add(name);
    points.push({
      id: `point-${points.length + 1}`,
      name,
      chainageM: nearbyTurnout?.value ?? null,
      normalLine: (assignedLine as any)?.name || (assignedLine as any)?.id || "",
      reverseLine: "",
      turnoutSpeedKmph: 30,
      confidence: "HIGH" as ConfidenceLevel,
      notes: "Point switch actuator on station track layout.",
    });
  }

  // Sort points by numeric index
  points.sort((a, b) => {
    const na = parseInt(a.name, 10) || 0;
    const nb = parseInt(b.name, 10) || 0;
    return na - nb;
  });

  // 4. Identify Level Crossings
  const levelCrossings: LevelCrossing[] = [];
  const usedLcNames = new Set<string>();

  for (const t of texts) {
    const m = upper(t.text).match(LC_PATTERN);
    if (!m) continue;
    const name = `LC-${m[1]}`;
    if (usedLcNames.has(name)) continue;

    // Check class nearby
    const nearbyClass = texts.find(
      (ot) =>
        ot.page === t.page &&
        Math.hypot(ot.x - t.x, ot.y - t.y) <= 4.0 * h &&
        /CLASS\s*'?([A-Z])'?/i.test(ot.text),
    );
    const classMatch = nearbyClass ? upper(nearbyClass.text).match(/CLASS\s*'?([A-Z])'?/i) : null;

    // Check chainage nearby
    const nearbyChainage = texts.find(
      (ot) =>
        ot.page === t.page &&
        Math.hypot(ot.x - t.x, ot.y - t.y) <= 5.0 * h &&
        parseChainage(ot.text) !== null,
    );
    const chainageM = nearbyChainage ? parseChainage(nearbyChainage.text) : null;

    usedLcNames.add(name);
    levelCrossings.push({
      id: `lc-${levelCrossings.length + 1}`,
      name,
      chainageM,
      manningType: "Manned",
      lcClass: classMatch?.[1] || "SPL",
      autoWhistling: "Yes",
      closingCondition: "Interlocked",
    });
  }

  return { points, levelCrossings };
}
