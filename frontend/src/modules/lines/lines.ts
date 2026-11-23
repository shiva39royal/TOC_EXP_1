import type { LayoutToken } from "@/engine/offlineExtractor";
import type { LineType, SignalDirection, StationMetadata, TrackLine } from "@/types/signalling";

export interface DirectionLegend {
  text: string;
  direction: SignalDirection;
  x: number;
  y: number;
  pointingLeft: boolean;
  pointingRight: boolean;
}

export interface InternalTrackLine {
  id: string;
  names: string[];
  page: number;
  y: number;
  x0: number;
  x1: number;
  segs: Array<{ x0: number; x1: number; y: number }>;
  circuits: Array<{ id: string; x: number }>;
  tins: Array<{ id: string; x: number }>;
  direction: SignalDirection;
  lineType: LineType;
}

export interface TrackExtractionInput {
  tokens: LayoutToken[];
  metadata?: StationMetadata;
}

export interface TrackExtractionResult {
  trackLines: TrackLine[];
  rawLines: InternalTrackLine[];
  directionLegends: DirectionLegend[];
}

const NON_CIRCUIT_WORDS = new Set([
  "EXIT",
  "NOT",
  "AT",
  "BT",
  "OUT",
  "GATE",
  "GAT",
  "SET",
  "LIT",
  "FIT",
  "PIT",
  "UNIT",
  "LEFT",
  "POST",
  "PORT",
  "FEET",
  "POINT",
  "ROUTE",
  "TCAS",
  "RFID",
  "LIMIT",
  "NEXT",
  "WEST",
  "EAST",
  "SHEET",
  "LINE",
  "MAIN",
  "LOOP",
  "TAG",
  "TEST",
  "WAIT",
  "STOP",
  "PLAT",
]);

const TRACK_NAME_PATTERN =
  /^(?:(UP|DN|DOWN)\s+)?(MAIN|COMMON\s+LOOP|LOOP|BRANCH|SIDING|CHORD)(?:\s+LINE)?$/i;

const TRACK_CIRCUIT_PATTERN = /^(?:(\d{1,4}(?:[-/]\d{1,4})?[A-Z]{0,3}T)|([A-Z]{2,6}T\d?))$/i;

const TIN_LABEL_PATTERN = /^(?:N\s*[-:.]\s*(\d{1,4})|TIN\s*[-:.]?\s*(\d{1,4}))$/i;

function upper(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, " ").trim();
}

function words(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]+/g, " ").trim();
}

function unitHeight(texts: LayoutToken[]): number {
  const heights = texts.map((t) => t.height || 0).filter((h) => h > 0);
  if (heights.length === 0) return 8;
  heights.sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)] || 8;
}

export function inferLineType(name: string): LineType {
  const v = name.toUpperCase();
  if (v.includes("UP") && v.includes("LOOP")) return "UP_LOOP";
  if ((v.includes("DN") || v.includes("DOWN")) && v.includes("LOOP")) return "DN_LOOP";
  if (v.includes("COMMON") || v.includes("LOOP")) return "COMMON_LOOP";
  if (v.includes("UP") && (v.includes("MAIN") || v.includes("LINE"))) return "UP_MAIN";
  if ((v.includes("DN") || v.includes("DOWN")) && (v.includes("MAIN") || v.includes("LINE")))
    return "DN_MAIN";
  if (v.includes("MAIN")) return "DN_MAIN";
  if (v.includes("SIDING")) return "SIDING";
  if (v.includes("BRANCH") || v.includes("CHORD")) return "BRANCH";
  return "COMMON_LOOP";
}

/**
 * Standard Indian Railways line designation (e.g. Down Main, Up Main, Common Loop, Up Loop)
 */
export function canonicalLineName(name: string): string {
  const v = name.toUpperCase().trim();
  if (v.includes("COMMON") && v.includes("LOOP")) return "Common Loop";
  if (v.includes("UP") && v.includes("LOOP")) return "Up Loop";
  if ((v.includes("DN") || v.includes("DOWN")) && v.includes("LOOP")) return "Down Loop";
  if (v.includes("DN") || v.includes("DOWN") || (v.includes("MAIN") && !v.includes("UP")))
    return "Down Main";
  if (v.includes("UP") && v.includes("MAIN")) return "Up Main";
  if (v.includes("LOOP")) return "Common Loop";
  if (v.includes("MAIN")) return "Down Main";
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function inferDirection(
  name: string,
  fallback: SignalDirection = "UNKNOWN",
): SignalDirection {
  const v = name.toUpperCase();
  if (v.includes("COMMON") || v.includes("BI-DIRECTIONAL") || v.includes("BIDIRECTIONAL")) {
    return "BIDIRECTIONAL";
  }
  if (v.includes("UP")) return "UP";
  if (v.includes("DN") || v.includes("DOWN")) return "DOWN";
  return fallback;
}

export function lineYAt(
  line: { y: number; segs: Array<{ x0: number; x1: number; y: number }> },
  x: number,
): number {
  if (line.segs.length === 0) return line.y;
  let best: { x0: number; x1: number; y: number } | null = null;
  let bestD = Infinity;
  for (const seg of line.segs) {
    if (x >= seg.x0 && x <= seg.x1) return seg.y;
    const d = x < seg.x0 ? seg.x0 - x : x > seg.x1 ? x - seg.x1 : 0;
    if (d < bestD) {
      bestD = d;
      best = seg;
    }
  }
  return best ? best.y : line.y;
}

export function nearestTrackLine(
  lines: InternalTrackLine[],
  token: { x: number; y: number; page: number },
  h: number,
  maxDy = 2.8,
): InternalTrackLine | null {
  let best: { line: InternalTrackLine; dy: number } | null = null;
  for (const line of lines) {
    if (line.page !== token.page) continue;
    if (token.x < line.x0 - 4 * h || token.x > line.x1 + 4 * h) continue;
    const dy = Math.abs(lineYAt(line, token.x) - token.y);
    if (dy <= maxDy * h && (!best || dy < best.dy)) {
      best = { line, dy };
    }
  }
  return best?.line ?? null;
}

export function extractDirectionLegends(tokens: LayoutToken[]): DirectionLegend[] {
  const legends: DirectionLegend[] = [];
  const textTokens = tokens.filter((t) => !t.kind || t.kind === "text");

  for (const t of textTokens) {
    const raw = t.text.trim();
    const upText = raw.toUpperCase();

    // Arrows in text like "<-- TO SECUNDERABAD" or "TO SAMASTIPUR -->" or "UP -->"
    const pointingLeft =
      /^(?:<--?|<-|«|TO\b.*<)/.test(upText) ||
      /TO\s+[A-Z\s]+(?:\(?[A-Z]{2,4}\)?)?\s*<--?/.test(upText);
    const pointingRight =
      /(?:-->|->|»|>)$/.test(upText) || /TO\s+[A-Z\s]+(?:\(?[A-Z]{2,4}\)?)?\s*-->?/.test(upText);

    let direction: SignalDirection = "UNKNOWN";
    if (/\b(?:UP\s*(?:DIRECTION|LINE|TRAIN)?)\b/.test(upText)) direction = "UP";
    else if (/\b(?:(?:DN|DOWN)\s*(?:DIRECTION|LINE|TRAIN)?)\b/.test(upText)) direction = "DOWN";

    if (pointingLeft || pointingRight || direction !== "UNKNOWN") {
      legends.push({
        text: raw,
        direction,
        x: t.x,
        y: t.y,
        pointingLeft,
        pointingRight,
      });
    }
  }

  return legends;
}

export function extractTrackLines(input: TrackExtractionInput): TrackExtractionResult {
  const { tokens } = input;
  const texts = tokens.filter((t) => !t.kind || t.kind === "text");
  const h = unitHeight(texts);

  // 1. Detect physical track bands
  const rawBands = tokens
    .filter((token) => token.kind === "track")
    .map((token) => ({
      ...token,
      x2: Number.isFinite(token.x2)
        ? token.x2!
        : Number.isFinite(token.width)
          ? token.x + token.width!
          : token.x + 100,
    }));

  const bands = rawBands
    .filter((token) => token.x2 - token.x >= 8 * h)
    .filter((token) => !token.height || (token.height >= 0.15 * h && token.height <= 3.0 * h))
    .sort((a, b) => a.page - b.page || a.x - b.x);

  const parent = bands.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));

  for (let i = 0; i < bands.length; i += 1) {
    for (let j = i + 1; j < bands.length; j += 1) {
      const a = bands[i]!;
      const b = bands[j]!;
      if (a.page !== b.page) continue;
      const overlap = Math.min(a.x2!, b.x2!) - Math.max(a.x, b.x);
      if (overlap < -3 * h) continue;
      const dy = Math.abs(a.y - b.y);
      if ((overlap > 0 && dy <= 0.8 * h) || (overlap <= 0 && dy <= 1.3 * h)) {
        parent[find(j)] = find(i);
      }
    }
  }

  const groups = new Map<number, LayoutToken[]>();
  bands.forEach((band, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), band]);
  });

  let lines: InternalTrackLine[] = Array.from(groups.values()).map((members) => {
    const segs = members.map((band) => ({ x0: band.x, x1: band.x2!, y: band.y }));
    const weight = segs.reduce((s, seg) => s + (seg.x1 - seg.x0), 0) || 1;
    return {
      id: "",
      names: [],
      page: members[0]!.page,
      y: segs.reduce((s, seg) => s + seg.y * (seg.x1 - seg.x0), 0) / weight,
      x0: Math.min(...segs.map((seg) => seg.x0)),
      x1: Math.max(...segs.map((seg) => seg.x1)),
      segs,
      circuits: [],
      tins: [],
      direction: "UNKNOWN",
      lineType: "COMMON_LOOP",
    };
  });

  // Fallback: If no vector track bands found, group tags/circuits into horizontal rows
  if (lines.length === 0) {
    const tagAndCircuitTokens = tokens
      .filter((t) => {
        const text = upper(t.text || "");
        return /^R\s*[-:.]?\s*\d+/i.test(text) || TRACK_CIRCUIT_PATTERN.test(text);
      })
      .sort((a, b) => a.page - b.page || a.y - b.y);

    const rows: LayoutToken[][] = [];
    for (const token of tagAndCircuitTokens) {
      const row = rows[rows.length - 1];
      const last = row?.[row.length - 1];
      if (row && last && last.page === token.page && Math.abs(token.y - last.y) <= 3.2 * h) {
        row.push(token);
      } else {
        rows.push([token]);
      }
    }

    lines = rows.map((row) => {
      const y = row.reduce((s, t) => s + t.y, 0) / row.length;
      const x0 = Math.min(...row.map((t) => t.x)) - 10 * h;
      const x1 = Math.max(...row.map((t) => t.x)) + 10 * h;
      return {
        id: "",
        names: [],
        page: row[0]!.page,
        y,
        x0,
        x1,
        segs: [{ x0, x1, y }],
        circuits: [],
        tins: [],
        direction: "UNKNOWN",
        lineType: "COMMON_LOOP",
      };
    });
  }

  // 2. Discover Direction Legends
  const directionLegends = extractDirectionLegends(tokens);

  // 3. Match track names to lines
  for (const token of texts) {
    const raw = words(token.text);
    if (!TRACK_NAME_PATTERN.test(raw)) continue;
    const line = nearestTrackLine(lines, token, h, 3.5);
    if (line) {
      line.names.push(upper(raw));
    }
  }

  // 4. Match track circuits to lines
  for (const token of texts) {
    const text = upper(token.text).replace(/[^A-Z0-9/-]/g, "");
    if (!TRACK_CIRCUIT_PATTERN.test(text)) continue;
    if (NON_CIRCUIT_WORDS.has(text)) continue;

    const line = nearestTrackLine(lines, token, h, 2.8);
    if (line && !line.circuits.some((c) => c.id === text)) {
      line.circuits.push({ id: text, x: token.x });
    }
  }

  // 5. Match TIN labels to lines
  for (const token of texts) {
    const text = upper(token.text).replace(/\s+/g, "");
    const m = text.match(TIN_LABEL_PATTERN);
    if (!m) continue;
    const tinId = m[1] ? `N-${m[1]}` : `TIN-${m[2]}`;

    const line = nearestTrackLine(lines, token, h, 2.8);
    if (line && !line.tins.some((t) => t.id === tinId)) {
      line.tins.push({ id: tinId, x: token.x });
    }
  }

  // 6. Filter active lines: Keep only lines that carry evidence (names, circuits, or tags)
  const tagCandidates = tokens.filter((t) => /^R\s*[-:.]?\s*\d+/i.test(upper(t.text || "")));
  const activeLines = lines
    .filter(
      (line) =>
        line.names.length > 0 ||
        line.circuits.length > 0 ||
        tagCandidates.some((tag) => nearestTrackLine([line], tag, h, 2.5) !== null),
    )
    .sort((a, b) => a.page - b.page || a.y - b.y);

  // 7. Resolve display names, lineTypes, and running directions
  activeLines.forEach((line, index) => {
    let resolvedName = "";
    if (line.names.length > 0) {
      const counts = new Map<string, number>();
      for (const name of line.names) {
        const canonical = name.replace(/^DOWN\b/, "DN");
        counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
      }
      resolvedName = Array.from(counts.entries()).sort(
        (a, b) => b[1] - a[1] || b[0].length - a[0].length,
      )[0]![0];
    } else {
      resolvedName = `LINE ${index + 1}`;
    }

    line.id = canonicalLineName(resolvedName);
    line.lineType = inferLineType(resolvedName);
    line.direction = inferDirection(resolvedName);

    // If direction still unknown, infer from adjacent direction legends
    if (line.direction === "UNKNOWN") {
      const nearbyLegend = directionLegends.find(
        (l) => Math.abs(l.y - line.y) < 3.0 * h && l.direction !== "UNKNOWN",
      );
      if (nearbyLegend) {
        line.direction = nearbyLegend.direction;
      }
    }
  });

  // 8. Convert to publication TrackLine model
  const trackLines: TrackLine[] = activeLines.map((line, index) => ({
    id: line.id,
    name: line.id,
    lineType: line.lineType,
    direction: line.direction,
    trackCircuit: line.circuits
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((c) => c.id)
      .join(", "),
    tinList: line.tins
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((t) => t.id),
    ySlot: index,
  }));

  return {
    trackLines,
    rawLines: activeLines,
    directionLegends,
  };
}
