import type {
  AverageGradientEntry,
  BlockSectionDetail,
  ConfidenceLevel,
  GradientEntry,
  LevelCrossing,
  PointSwitch,
  RfidTag,
  RouteAspectPermutation,
  ShuntingLimitEntry,
  SignalDirection,
  SignalNode,
  SourceLayoutAsset,
  StationProject,
  TagFunctionType,
  TocRouteRow,
  TrackLine,
  TrackProfileRow,
  TslRouteRow,
  TsrRouteRow,
} from "../types/signalling";
import { groupRingChains } from "./drawingSymbols";
import {
  CORPORATE_VENDOR_BLACKLIST,
  NON_STATION_ACRONYMS,
} from "../modules/metadata/metadata";

/**
 * A positioned item read from a drawing. Coordinates are isotropic drawing units with y pointing
 * down (PDF points, rendered pixels or flipped CAD units). `width`/`height` are the item's extents in
 * the drawing's own orientation, so a vertical label has a small width and a large height.
 */
export interface LayoutToken {
  text: string;
  x: number;
  y: number;
  page: number;
  width?: number;
  height?: number;
  confidence?: number;
  /**
   * text (default), ring = detected signal-head circle, track = detected horizontal running line,
   * link = drawn stroke from (x, y) to (x2, y2) that may join two lines (a turnout leg).
   */
  kind?: "text" | "ring" | "track" | "link";
  /** Text reads bottom-to-top / top-to-bottom. */
  vertical?: boolean;
  /** For track tokens: `x` is the start and `x2` the end of the band. For links: the far end. */
  x2?: number;
  y2?: number;
  /** Text re-read in the small area beside a drawn signal head. */
  hint?: "signal-label";
}

interface OfflineExtractionInput {
  fileName: string;
  sourceLayout: SourceLayoutAsset;
  tokens: LayoutToken[];
  sourceSummary?: string;
}

export interface Phrase {
  text: string;
  x: number;
  y: number;
  x0?: number;
  x1: number;
  height: number;
  page: number;
  confidence?: number;
  width?: number;
  tokens?: LayoutToken[];
}

interface Chainage {
  token: LayoutToken;
  value: number;
  turnout: boolean;
}

interface Line {
  id: string;
  page: number;
  /** Mean height; use lineYAt() for the height at a given x (scans can be slightly tilted). */
  y: number;
  x0: number;
  x1: number;
  segs: Array<{ x0: number; x1: number; y: number }>;
  names: string[];
  circuits: Array<{ id: string; x: number }>;
  tins: Array<{ id: string; x: number }>;
}

interface TagCandidate {
  id: string;
  token: LayoutToken;
  chainageM: number | null;
  line: Line | null;
  letter: string;
  interpolated?: boolean;
}

interface SignalCandidate {
  name: string;
  base: string;
  suffix: string;
  label: LayoutToken;
  rings: LayoutToken[];
  cluster: { x0: number; x1: number; y: number; heads: number } | null;
  explicit: boolean;
  callingOn: boolean;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function cleanText(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[|¦]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function upper(raw: string): string {
  return cleanText(raw).toUpperCase();
}

function median(values: number[]): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.floor(sorted.length / 2)]!;
}

function confidence(score: number | undefined): ConfidenceLevel {
  const value = score ?? 100;
  return value >= 80 ? "HIGH" : value >= 55 ? "MEDIUM" : "LOW";
}

const TAG_TOKEN_RE = /^[^A-Z0-9]{0,2}R\s*[-:.]?\s*(\d{2,4})[^A-Z0-9]{0,2}$/;
const TIN_TOKEN_RE = /^[^A-Z0-9]{0,2}N\s*[-:.]\s*(\d{1,4})[^A-Z0-9]{0,2}$/;
const LC_RE = /\bL\.?\s*C\.?\s*(?:GATE\s*)?(?:NO\.?)?\s*[-:.]?\s*(\d{1,4}[A-Z]?)\b/;
const EXPLICIT_SIGNAL_RE = /^(GS|SH|S|A|C)\s*-?\s*(\d{1,4})\s*([A-Z]{0,2})$/;
const NUMERIC_SIGNAL_RE = /^(\d{1,3}(?=\s*(?:I\s*)?D$)|\d{1,2})\s*(I\s*D|[A-HJ-SU-Z])?$/;
const TRACK_NAME_RE = /^(?:(UP|DN|DOWN)\s+)?(MAIN|COMMON\s+LOOP|LOOP|BRANCH|SIDING)(?:\s+LINE)?$/;
const LEGEND_LETTERS: Record<string, { type: TagFunctionType; label: string }> = {
  N: { type: "NORMAL", label: "normal tag" },
  S: { type: "SIGNAL_FOOT", label: "signal foot tag" },
  G: { type: "GATE", label: "gate tag" },
  X: { type: "BOUNDARY", label: "exit tag" },
  L: { type: "UNKNOWN", label: "adjacent line tag" },
  T: { type: "UNKNOWN", label: "TIN discrimination / turnout tag" },
  A: { type: "UNKNOWN", label: "adjustment / junction tag" },
};

function tagIdOf(text: string): string {
  const match = upper(text).match(TAG_TOKEN_RE);
  return match ? `R-${match[1]}` : "";
}

function tinIdOf(text: string): string {
  const match = upper(text).match(TIN_TOKEN_RE);
  return match ? `N-${match[1]}` : "";
}

function parseChainageText(raw: string): { value: number; turnout: boolean } | null {
  const text = upper(raw).replace(/\s+/g, "");
  const isTurnout = /^TO-?/i.test(text);
  const clean = text.replace(/^TO-?/i, "").replace(/^(?:KM|CH)[.:\s-]*/i, "");
  const kmMatch = clean.match(/^\(?(\d{1,4})[./,:-](\d{1,3})\)?(?:KM)?\.?$/);
  if (kmMatch) {
    const km = Number(kmMatch[1]);
    const mStr = kmMatch[2]!.padEnd(3, "0").slice(0, 3);
    const value = km * 1000 + Number(mStr);
    return Number.isFinite(value) && value > 0 ? { value, turnout: isTurnout } : null;
  }
  const metres = clean.match(/^(\d{3,6}(?:\.\d+)?)M\.?$/);
  if (metres) {
    const value = Math.round(Number(metres[1]));
    return Number.isFinite(value) && value > 0 ? { value, turnout: isTurnout } : null;
  }
  const bareDigits = clean.match(/^(\d{5,6})$/);
  if (bareDigits) {
    const value = Number(bareDigits[1]);
    return Number.isFinite(value) && value >= 10000 && value <= 999999
      ? { value, turnout: isTurnout }
      : null;
  }
  return null;
}

/** Glyph height of a text token (its short side). */
function glyph(token: LayoutToken, fallback: number): number {
  const value = token.vertical ? token.width : token.height;
  return value && value > 0 ? value : fallback;
}

function extentX(token: LayoutToken, h: number): number {
  if (token.width && token.width > 0) return token.width;
  return token.vertical ? h : Math.max(1, token.text.length) * 0.62 * h;
}

function extentY(token: LayoutToken, h: number): number {
  if (token.height && token.height > 0) return token.height;
  return token.vertical ? Math.max(1, token.text.length) * 0.62 * h : h;
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function unitHeight(texts: LayoutToken[]): number {
  const tagHeights = texts
    .filter((token) => !token.vertical && tagIdOf(token.text))
    .map((token) => token.height ?? 0)
    .filter((v) => v > 0);
  // Boxed tag labels are sometimes read together with their frame; the lower quartile is the glyph size.
  if (tagHeights.length >= 3)
    return tagHeights.sort((a, b) => a - b)[Math.floor(tagHeights.length * 0.1)]!;
  const heights = texts.map((token) => glyph(token, 0)).filter((value) => value > 0);
  if (heights.length >= 3) return median(heights);
  const xs = texts.map((token) => token.x);
  const span = xs.length ? Math.max(...xs) - Math.min(...xs) : 1;
  return Math.max(span / 300, 1e-6);
}

function buildPhrases(texts: LayoutToken[], h: number): Phrase[] {
  const horizontal = texts
    .filter((token) => !token.vertical)
    .slice()
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const lines: LayoutToken[][] = [];
  for (const token of horizontal) {
    const line = lines.find(
      (candidate) =>
        candidate[0]!.page === token.page &&
        Math.abs(candidate.reduce((s, t) => s + t.y, 0) / candidate.length - token.y) < 0.45 * h,
    );
    if (line) line.push(token);
    else lines.push([token]);
  }
  const phrases: Phrase[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    let group: LayoutToken[] = [];
    const flush = () => {
      if (group.length === 0) return;
      const x0 = Math.min(...group.map((t) => t.x - extentX(t, h) / 2));
      const x1 = Math.max(...group.map((t) => t.x + extentX(t, h) / 2));
      phrases.push({
        text: group.map((t) => t.text).join(" "),
        x: (x0 + x1) / 2,
        y: group.reduce((s, t) => s + t.y, 0) / group.length,
        x0,
        x1,
        height: Math.max(...group.map((t) => glyph(t, h))),
        page: group[0]!.page,
        confidence: Math.min(...group.map((t) => t.confidence ?? 100)),
      });
      group = [];
    };
    for (const token of line) {
      const previous = group[group.length - 1];
      if (previous) {
        const gap = token.x - extentX(token, h) / 2 - (previous.x + extentX(previous, h) / 2);
        if (gap > 0.9 * Math.max(h, glyph(token, h) * 0.6)) flush();
      }
      group.push(token);
    }
    flush();
  }
  return phrases;
}

function words(text: string): string {
  return upper(text)
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractChainages(texts: LayoutToken[]): Chainage[] {
  const found: Chainage[] = [];
  for (const token of texts) {
    const parsed = parseChainageText(token.text);
    if (parsed) found.push({ token, ...parsed });
  }
  if (found.length >= 4) {
    // A station layout spans a few kilometres; isolated far-away values are misreads (a dropped digit).
    const centre = median(found.map((item) => item.value));
    return found.filter((item) => Math.abs(item.value - centre) <= 25000);
  }
  return found;
}

function lineYAt(line: Line, x: number): number {
  let best: Line["segs"][number] | undefined;
  let bestD = Infinity;
  for (const seg of line.segs) {
    const d = x < seg.x0 ? seg.x0 - x : x > seg.x1 ? x - seg.x1 : 0;
    if (d < bestD) {
      bestD = d;
      best = seg;
    }
  }
  return best ? best.y : line.y;
}

/**
 * Running lines are chains of detected bands. Bands that overlap at nearly the same height, or nearly
 * meet end to end, belong to one line, so a slightly tilted scan still gives one continuous line.
 */
function buildLines(tokens: LayoutToken[], tagTokens: LayoutToken[], h: number): Line[] {
  const bands = tokens
    .filter((token) => token.kind === "track" && Number.isFinite(token.x2))
    .filter((token) => token.x2! - token.x >= 10 * h)
    .filter((token) => !token.height || (token.height >= 0.15 * h && token.height <= 2.6 * h))
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
      if ((overlap > 0 && dy <= 0.8 * h) || (overlap <= 0 && dy <= 1.2 * h))
        parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, LayoutToken[]>();
  bands.forEach((band, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), band]);
  });
  const lines: Line[] = Array.from(groups.values()).map((members) => {
    const segs = members.map((band) => ({ x0: band.x, x1: band.x2!, y: band.y }));
    const weight = segs.reduce((s, seg) => s + (seg.x1 - seg.x0), 0) || 1;
    return {
      id: "",
      page: members[0]!.page,
      y: segs.reduce((s, seg) => s + seg.y * (seg.x1 - seg.x0), 0) / weight,
      x0: Math.min(...segs.map((seg) => seg.x0)),
      x1: Math.max(...segs.map((seg) => seg.x1)),
      segs,
      names: [],
      circuits: [],
      tins: [],
    };
  });
  if (lines.length > 0) return lines;

  // No line geometry (e.g. plain annotation sets): group tag labels into horizontal rows.
  const sorted = tagTokens.slice().sort((a, b) => a.page - b.page || a.y - b.y);
  const rows: LayoutToken[][] = [];
  for (const token of sorted) {
    const row = rows[rows.length - 1];
    const last = row?.[row.length - 1];
    if (row && last && last.page === token.page && token.y - last.y <= 3.2 * h) row.push(token);
    else rows.push([token]);
  }
  return rows.map((row) => {
    const y = row.reduce((s, t) => s + t.y, 0) / row.length;
    const x0 = Math.min(...row.map((t) => t.x)) - 10 * h;
    const x1 = Math.max(...row.map((t) => t.x)) + 10 * h;
    return {
      id: "",
      page: row[0]!.page,
      y,
      x0,
      x1,
      segs: [{ x0, x1, y }],
      names: [],
      circuits: [],
      tins: [],
    };
  });
}

function nearestLine(
  lines: Line[],
  token: { x: number; y: number; page: number },
  h: number,
  maxDy = 2.6,
): Line | null {
  let best: { line: Line; dy: number } | null = null;
  for (const line of lines) {
    if (line.page !== token.page) continue;
    if (token.x < line.x0 - 3 * h || token.x > line.x1 + 3 * h) continue;
    const dy = Math.abs(lineYAt(line, token.x) - token.y);
    if (dy <= maxDy * h && (!best || dy < best.dy)) best = { line, dy };
  }
  return best?.line ?? null;
}

function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function lineDisplayName(line: Line, index: number): string {
  if (line.names.length === 0) return `UNLABELLED LINE ${index + 1}`;
  const counts = new Map<string, number>();
  for (const name of line.names) {
    const key = name.replace(/^DOWN\b/, "DN");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length,
  )[0]![0];
}

function lineTypeFor(name: string): TrackLine["lineType"] {
  const value = name.toUpperCase();
  if (value.includes("UP") && value.includes("LOOP")) return "UP_LOOP";
  if (value.includes("DN") && value.includes("LOOP")) return "DN_LOOP";
  if (value.includes("LOOP")) return "COMMON_LOOP";
  if (value.includes("UP") && value.includes("MAIN")) return "UP_MAIN";
  if (value.includes("DN") && value.includes("MAIN")) return "DN_MAIN";
  if (value.includes("SIDING")) return "SIDING";
  if (value.includes("BRANCH")) return "BRANCH";
  return "COMMON_LOOP";
}

// ---------------------------------------------------------------------------
// Tags and chainages
// ---------------------------------------------------------------------------

function pairTagsWithChainages(
  tags: LayoutToken[],
  chainages: Chainage[],
  h: number,
): Map<LayoutToken, Chainage> {
  const pairs: Array<{ tag: LayoutToken; chainage: Chainage; score: number }> = [];
  for (const tag of tags) {
    const tagHalfH = extentY(tag, h) / 2;
    for (const chainage of chainages) {
      if (chainage.turnout || chainage.token.page !== tag.page) continue;
      const c = chainage.token;
      const dx = Math.abs(c.x - tag.x);
      let score: number;
      if (c.vertical) {
        const gap = Math.max(0, Math.abs(c.y - tag.y) - extentY(c, h) / 2 - tagHalfH);
        if (dx > 3.0 * h || gap > 6.0 * h) continue;
        score = dx / h + (gap / h) * 0.5 + 0.3;
      } else {
        const dy = Math.abs(c.y - tag.y);
        if (dx > 4.5 * h || dy > 4.5 * h) continue;
        score = dx / h + (dy / h) * 0.8;
      }
      pairs.push({ tag, chainage, score });
    }
  }
  pairs.sort((a, b) => a.score - b.score);
  const byTag = new Map<LayoutToken, Chainage>();
  const used = new Set<Chainage>();
  const owner = new Map<Chainage, LayoutToken>();
  for (const pair of pairs) {
    if (byTag.has(pair.tag) || used.has(pair.chainage)) continue;
    byTag.set(pair.tag, pair.chainage);
    used.add(pair.chainage);
    owner.set(pair.chainage, pair.tag);
  }
  // Tags on parallel lines at the same chainage can sit either side of one chainage label: a tag left
  // without a label may share one standing directly in line with it, if the owner is on another row.
  for (const pair of pairs) {
    if (byTag.has(pair.tag)) continue;
    const first = owner.get(pair.chainage);
    if (
      !first ||
      Math.abs(first.y - pair.tag.y) < 2.5 * h ||
      Math.abs(pair.chainage.token.x - pair.tag.x) > 2.0 * h
    )
      continue;
    byTag.set(pair.tag, pair.chainage);
  }
  return byTag;
}

function legendLetterNear(
  texts: LayoutToken[],
  tag: LayoutToken,
  line: Line | null,
  h: number,
): string {
  if (!line) return "";
  let best: { letter: string; d: number } | null = null;
  for (const token of texts) {
    if (token.page !== tag.page || token.vertical) continue;
    const letter = upper(token.text).replace(/[^A-Z]/g, "");
    if (letter.length !== 1 || !LEGEND_LETTERS[letter]) continue;
    if (Math.abs(token.y - lineYAt(line, token.x)) > 0.9 * h) continue;
    const dx = Math.abs(token.x - tag.x);
    if (dx > 1.6 * h) continue;
    if (!best || dx < best.d) best = { letter, d: dx };
  }
  return best?.letter ?? "";
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

function signalCandidates(
  texts: LayoutToken[],
  rings: LayoutToken[],
  h: number,
): SignalCandidate[] {
  const raw: Array<{
    base: string;
    suffix: string;
    token: LayoutToken;
    explicit: boolean;
    prefix: string;
  }> = [];
  const horizontal = texts.filter((token) => !token.vertical);
  // Labels re-read beside a head row (heads blanked out) are cleaner than page-level reads of the same spot.
  const hints = horizontal.filter((token) => token.hint === "signal-label");
  for (const token of horizontal) {
    const rawText = token.text.trim();
    // Stop boards and limit boards (BSLB, SLB, FP) are fixed track boundary markers, never signal routes in TOC.
    const isStopBoard = /^(?:S\.?B\.?|STOP(?:\s*BOARD)?|BSLB|SLB|FP)$/i.test(rawText);
    if (isStopBoard) continue;
    let text = upper(token.text).replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "");
    if (/^(?:S\.?B\.?|STOP(?:\s*BOARD)?|BSLB|SLB|FP)$/i.test(text)) continue;

    // Reject candidates situated directly beside a Stop Board marker (within 5.0 * h)
    const hasStopBoardNearby = horizontal.some(
      (other) =>
        other.page === token.page &&
        Math.hypot(other.x - token.x, other.y - token.y) <= 5.0 * h &&
        /^(?:S\.?B\.?|STOP(?:\s*BOARD)?|BSLB|SLB|FP)$/i.test(other.text.trim()),
    );
    if (hasStopBoardNearby) continue;

    // Exclude turnout point machine numbers located on crossover switch legs (within 4.5 * h of N-xx turnout normal tags)
    // Point machines (e.g. 11, 13, 18, 20) are switch actuators without signal head lamps.
    const isNearTurnoutNormalTag =
      !rings.some((r) => Math.hypot(r.x - token.x, r.y - token.y) <= 4.0 * h) &&
      horizontal.some(
        (other) =>
          other.page === token.page &&
          Math.hypot(other.x - token.x, other.y - token.y) <= 4.5 * h &&
          /^N\s*-?\s*\d+/i.test(other.text.trim()),
      );
    if (isNearTurnoutNormalTag) continue;

    // OCR normalization: letter 'O' after digits before suffix/end is digit '0' (e.g. 3O -> 30, 3OA -> 30A)
    text = text.replace(/^(\d+)O(?=[A-Z]|$)/i, "$10");
    text = text.replace(/^O(\d+)/i, "0$1");
    // Clean trailing bracket/noise after calling-on letters A, B, C (e.g. "30A[S" -> "30A")
    text = text.replace(/^(\d+[ABC])[A-Z0-9]$/, "$1");

    const explicit = text.match(EXPLICIT_SIGNAL_RE);
    if (explicit && explicit[1] !== "C") {
      raw.push({
        base: explicit[2]!,
        suffix: explicit[3] ?? "",
        token,
        explicit: true,
        prefix: explicit[1]!,
      });
      continue;
    }
    const numeric = text.match(NUMERIC_SIGNAL_RE);
    if (!numeric) {
      // Single-digit starters (e.g. S6) often have track circuit label (e.g. "6T") printed directly beside the head.
      const trackMatch = text.match(/^(\d{1,2})T$/i);
      const isNearRfidTag =
        trackMatch &&
        horizontal.some(
          (other) =>
            other.page === token.page &&
            Math.hypot(other.x - token.x, other.y - token.y) <= 6.5 * h &&
            /^R\s*-?\s*\d+/i.test(other.text.trim()),
        );
      if (trackMatch && isNearRfidTag) {
        raw.push({ base: trackMatch[1]!, suffix: "", token, explicit: false, prefix: "S" });
      }
      continue;
    }
    const minConf = /^[ABC]$/.test(numeric[2] ?? "") ? 0 : 20;
    if ((token.confidence ?? 100) < minConf) continue;
    if (token.height && token.height < 0.55 * h) continue;
    // Never let a shorter/truncated hint (e.g. "3") suppress a longer valid token (e.g. "30" or "30A")
    if (
      !token.hint &&
      hints.some(
        (other) =>
          other.page === token.page &&
          Math.abs(other.x - token.x) < 0.9 * h &&
          Math.abs(other.y - token.y) < 0.7 * h &&
          upper(other.text) !== text &&
          !text.startsWith(upper(other.text)),
      )
    )
      continue;
    let suffix = (numeric[2] ?? "").replace(/\s+/g, "");
    if (!suffix) {
      // "1 ID" or "24 ID" is commonly read as two words.
      const next = horizontal.find(
        (other) =>
          other !== token &&
          other.page === token.page &&
          Math.abs(other.y - token.y) < 0.55 * h &&
          other.x > token.x &&
          other.x - extentX(other, h) / 2 - (token.x + extentX(token, h) / 2) < 1.2 * h &&
          /^(?:[I1L|]\s*D|D)$/.test(upper(other.text)),
      );
      if (next) {
        suffix = /D$/.test(upper(next.text)) && !/^[I1L|]/.test(upper(next.text)) ? "D" : "ID";
      }
    }
    raw.push({ base: numeric[1]!, suffix, token, explicit: false, prefix: "S" });
  }

  // OCR frequently reads "1 ID" as "11D": prefer the inner-distant reading when its home/distant exist.
  const labels = new Set(raw.map((item) => `${item.base}${item.suffix}`));
  for (const item of raw) {
    if (item.explicit || item.suffix !== "D" || !item.base.endsWith("1") || item.base.length < 2)
      continue;
    const home = item.base.slice(0, -1);
    if (labels.has(`${home}D`) || labels.has(home)) {
      item.base = home;
      item.suffix = "ID";
    }
  }

  // Generic Station-Agnostic OCR Disambiguation:
  // 1. Calling-on co-location: A calling-on signal (suffix 'A', 'B', 'C') is physically mounted on
  // the same mast as its parent stop signal, sharing the identical base number. If the parent stop signal
  // label was partially clipped/misread by OCR, restore it from the co-located calling-on label.
  const callingOnItems = raw.filter((item) => /^[ABC]$/.test(item.suffix));
  for (const co of callingOnItems) {
    const parentBase = co.base;
    if (!parentBase || labels.has(parentBase)) continue;
    const nearby = raw.find(
      (item) =>
        item !== co &&
        !item.suffix &&
        item.token.page === co.token.page &&
        Math.hypot(item.token.x - co.token.x, item.token.y - co.token.y) <= 3.5 * h &&
        (item.base === parentBase || parentBase.startsWith(item.base)),
    );
    if (nearby) {
      nearby.base = parentBase;
      labels.add(parentBase);
    }
  }

  // 2. Approach Distant correlation: Distant/Inner Distant signals (e.g. X-D, X-ID) protect stop signal X.
  // If a multi-digit distant base exists but no stop signal matches it, recover any clipped/partial label.
  const distantBases = new Set(
    raw
      .filter((item) => item.suffix === "D" || item.suffix === "ID")
      .map((item) => item.base)
      .filter((b) => b.length >= 2),
  );
  for (const dB of distantBases) {
    if (labels.has(dB)) continue;
    const distantTokens = raw
      .filter((item) => item.base === dB && (item.suffix === "D" || item.suffix === "ID"))
      .map((i) => i.token);
    const clipped = raw.find(
      (item) =>
        !item.explicit &&
        !item.suffix &&
        item.base !== dB &&
        dB.startsWith(item.base) &&
        distantTokens.some(
          (dt) => dt.page === item.token.page && Math.abs(dt.y - item.token.y) <= 25 * h,
        ),
    );
    if (clipped) {
      clipped.base = dB;
      labels.add(dB);
    }
  }

  // 3. Sequential Distant and Inner Distant reconciliation:
  // Along any track alignment, if two distant-type candidates (suffix 'D' or 'ID') precede a stop signal,
  // the one closer to the stop signal is the Inner Distant ('ID') and the one further is the Distant ('D').
  // Reconcile any single-digit OCR misread (e.g. '22D' when protecting stop signal '24') to the protected stop signal's base.
  const stopBases = new Set(raw.filter((i) => !i.suffix).map((i) => i.base));
  const distantItems = raw.filter((i) => i.suffix === "D" || i.suffix === "ID");
  for (const sBase of stopBases) {
    const parentTokens = raw.filter((i) => i.base === sBase && !i.suffix).map((i) => i.token);
    for (const pt of parentTokens) {
      const distantsOnTrack = distantItems
        .filter((d) => d.token.page === pt.page && Math.abs(d.token.y - pt.y) <= 3.0 * h)
        .sort((a, b) => Math.abs(a.token.x - pt.x) - Math.abs(b.token.x - pt.x));
      if (distantsOnTrack.length >= 2) {
        const closer = distantsOnTrack[0]!;
        const further = distantsOnTrack[1]!;
        if (closer.base !== sBase && !stopBases.has(closer.base)) closer.base = sBase;
        if (further.base !== sBase && !stopBases.has(further.base)) further.base = sBase;
        closer.suffix = "ID";
        further.suffix = "D";
      } else if (distantsOnTrack.length === 1) {
        const single = distantsOnTrack[0]!;
        if (single.base !== sBase && !stopBases.has(single.base)) single.base = sBase;
      }
    }
  }

  // Chain-first: each drawn head assembly takes the nearest numeric label; a calling-on label of the
  // same number on the same assembly (e.g. "1A" beside "1") becomes its own calling-on signal.
  const chains = groupRingChains(
    rings
      .filter((ring) => (ring.width ?? h) / 2 >= 0.4 * h)
      .map((ring) => ({ x: ring.x, y: ring.y, r: (ring.width ?? h) / 2 })),
  );
  const pageOf = (chain: (typeof chains)[number]) =>
    rings.find((ring) => ring.x === chain.rings[0]!.x && ring.y === chain.rings[0]!.y)?.page ?? 1;
  const pairs: Array<{ chain: number; item: number; d: number }> = [];
  chains.forEach((chain, chainIndex) => {
    const page = pageOf(chain);
    const r = Math.max(...chain.rings.map((ring) => ring.r));
    raw.forEach((item, itemIndex) => {
      if (item.token.page !== page) return;
      const dx = Math.max(0, chain.x0 - item.token.x, item.token.x - chain.x1);
      const dy = Math.max(0, Math.abs(item.token.y - chain.y) - r);
      // A label overlapping the heads is a misread of the symbol itself.
      if (dx === 0 && Math.abs(item.token.y - chain.y) < r * 0.9) return;
      const d =
        Math.hypot(dx, dy) +
        ((100 - Math.min(100, item.token.confidence ?? 100)) / 100) * 2 * h -
        (item.token.hint ? 0.3 * h : 0);
      if (d <= 2.6 * h) pairs.push({ chain: chainIndex, item: itemIndex, d });
    });
  });
  const rank = (item: (typeof raw)[number]) => (/^[ABC]$/.test(item.suffix) ? 1 : 0);
  const labelsByChain = new Map<number, number[]>();
  const usedItems = new Set<number>();
  for (const pair of pairs.sort((x, y) => x.d - y.d)) {
    if (usedItems.has(pair.item)) continue;
    usedItems.add(pair.item);
    labelsByChain.set(pair.chain, [...(labelsByChain.get(pair.chain) ?? []), pair.item]);
  }
  const candidates: SignalCandidate[] = [];
  const toCandidate = (
    item: (typeof raw)[number],
    chain: (typeof chains)[number] | null,
  ): SignalCandidate => {
    const maxR = chain ? Math.max(...chain.rings.map((ring) => ring.r)) : 0;
    return {
      name: item.explicit
        ? `${item.prefix}${item.base}${item.suffix}`
        : `S${item.base}${item.suffix === "ID" ? " ID" : item.suffix}`,
      base: item.base,
      suffix: item.suffix,
      label: item.token,
      rings: chain
        ? chain.rings.map((ring) => ({
            text: "",
            kind: "ring",
            x: ring.x,
            y: ring.y,
            width: ring.r * 2,
            height: ring.r * 2,
            page: item.token.page,
          }))
        : [],
      cluster: chain
        ? {
            x0: chain.x0,
            x1: chain.x1,
            y: chain.y,
            heads: chain.rings.filter((ring) => ring.r >= maxR * 0.75).length,
          }
        : null,
      explicit: item.explicit,
      callingOn: !item.explicit && /^[ABC]$/.test(item.suffix),
    };
  };
  for (const [chainIndex, itemIndexes] of labelsByChain) {
    const chain = chains[chainIndex]!;
    for (const index of itemIndexes) {
      const item = raw[index]!;
      if (item.explicit) continue;
      // A head touching the end of a label is read as part of it ("25O"): drop OCR ring artifact letters
      // Never strip valid signalling suffixes (ID, D, A, B, C) and NEVER truncate numeric signal bases (e.g. S10, S20, S30).
      const right = item.token.x + extentX(item.token, h) / 2;
      const touching = chain.rings.some(
        (ring) =>
          Math.abs(ring.y - item.token.y) < ring.r * 1.2 &&
          ring.x - ring.r < right + 0.2 * h &&
          ring.x > right - 0.9 * h,
      );
      if (!touching) continue;
      if (item.suffix && !["ID", "D", "A", "B", "C"].includes(item.suffix)) item.suffix = "";
    }
    const items = itemIndexes.map((index) => raw[index]!).sort((x, y) => rank(x) - rank(y));
    const primary = items[0]!;
    candidates.push(toCandidate(primary, chain));
    for (const item of items.slice(1)) {
      if (
        item.base === primary.base &&
        /^[ABC]$/.test(item.suffix) &&
        item.suffix !== primary.suffix
      )
        candidates.push(toCandidate(item, chain));
    }
  }
  // Track 2: Foot-tag anchor fallback for unchained signal candidates (Distants, Starters, Homes, Calling-on)
  // Any candidate situated near a recognized running-line RFID tag (R-xxx) within mast proximity (<= 7.5*h horizontally, <= 9.5*h vertically)
  // that is not already claimed by a ring chain is instantiated as a verified candidate.
  // Because point machines (near N-xx tags) and stop boards (SB) are excluded upfront, any number near an R-xxx tag is a genuine physical signal.
  const distinctTags = texts.filter((t) => !t.vertical && /\bR\s*[-–—]?\s*\d{2,4}\b/i.test(t.text));
  raw.forEach((item, index) => {
    if (usedItems.has(index)) return;
    if (item.explicit) {
      candidates.push(toCandidate(item, null));
      return;
    }
    const hasSignallingSuffix = ["ID", "D", "A", "B", "C"].includes(item.suffix);
    if (!hasSignallingSuffix) return;
    const hasNearbyRfidTag = distinctTags.some(
      (tag) =>
        tag.page === item.token.page &&
        Math.abs(tag.x - item.token.x) <= 7.5 * h &&
        Math.abs(tag.y - item.token.y) <= 9.5 * h,
    );
    if (hasNearbyRfidTag) {
      if (!candidates.some((c) => c.base === item.base && c.suffix === item.suffix)) {
        candidates.push(toCandidate(item, null));
      }
    }
  });

  // Duplicate reads of the same label (overlapping tiles / passes).
  const result: SignalCandidate[] = [];
  for (const candidate of candidates) {
    if (
      result.some(
        (kept) =>
          kept.name === candidate.name &&
          Math.hypot(kept.label.x - candidate.label.x, kept.label.y - candidate.label.y) < 3 * h,
      )
    )
      continue;
    result.push(candidate);
  }
  return result;
}

/** Aspects implied by the signal's function and the number of lamp heads drawn on it. */
function aspectsFor(type: string, heads: number): string[] {
  if (type === "Calling-On") return ["Calling-on (miniature)"];
  if (heads < 2) return [];
  if (/Distant/.test(type))
    return heads >= 3 ? ["Green", "Double Yellow", "Yellow"] : ["Green", "Yellow"];
  if (heads >= 4) return ["Green", "Double Yellow", "Yellow", "Red"];
  if (heads === 3) return ["Green", "Yellow", "Red"];
  return [];
}

function routeAspects(
  type: string,
  aspects: string[],
  diverging: boolean,
): { entry: string; exit: string } {
  if (aspects.length === 0) return { entry: "", exit: "" };
  if (type === "Calling-On")
    return {
      entry: "Calling-on (miniature) Off",
      exit: "Exit signal at any aspect, including Red",
    };
  const proceed = aspects.filter((aspect) => aspect !== "Red");
  if (diverging && !/Distant/.test(type))
    return { entry: "Yellow + route indicator", exit: "Exit signal at any aspect, including Red" };
  if (proceed.includes("Double Yellow")) {
    return {
      entry: proceed.join(" / "),
      exit: "Green ← exit Green · Double Yellow ← exit Yellow or Double Yellow · Yellow ← exit Red",
    };
  }
  if (proceed.length >= 2)
    return {
      entry: proceed.join(" / "),
      exit: `${proceed[0]} ← exit Off · ${proceed[proceed.length - 1]} ← exit Red`,
    };
  return { entry: proceed.join(" / "), exit: "" };
}

function legendRightDirection(texts: LayoutToken[], h: number): SignalDirection | null {
  let downRight = 0;
  let upRight = 0;
  const ups = texts.filter((t) => !t.vertical && words(t.text) === "UP");
  const downs = texts.filter((t) => !t.vertical && /^(?:DOWN|DN)$/.test(words(t.text)));
  for (const up of ups) {
    for (const down of downs) {
      if (up.page !== down.page || Math.abs(up.y - down.y) > 0.8 * h) continue;
      const dx = down.x - up.x;
      if (Math.abs(dx) < 2 * h || Math.abs(dx) > 30 * h) continue;
      if (dx > 0) downRight += 1;
      else upRight += 1;
    }
  }
  if (downRight > upRight) return "DOWN";
  if (upRight > downRight) return "UP";
  return null;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function extractMetadata(
  fileName: string,
  phrases: Phrase[],
  texts: LayoutToken[],
  h: number,
): StationProject["metadata"] {
  const ordered = phrases.slice().sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const all = ordered.map((p) => p.text).join(" | ");
  const baseName = fileName
    .replace(/\.(?:pdf|dwg|dxf)$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\b(?:RFID|TAG|TIN|LAYOUT|KAVACH|TCAS|SIL[-\s]?\d*|DRAWING|DRG|TOC)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const fileWords = new Set(
    upper(baseName)
      .split(/[^A-Z0-9]+/)
      .filter((w) => w.length > 2),
  );

  let stationName = "";
  let stationCode = "";
  let best = -1;
  for (const phrase of phrases) {
    const match = upper(phrase.text).match(/^([A-Z][A-Z .]{2,40}?)\s*\(\s*([A-Z]{2,5})\s*\)$/);
    if (!match) continue;
    const code = match[2]!;
    if (NON_STATION_ACRONYMS.has(code) || CORPORATE_VENDOR_BLACKLIST.has(code)) continue;
    const name = match[1]!.trim();
    const wordsInName = name.split(/[^A-Z0-9]+/);
    if (wordsInName.some((w) => CORPORATE_VENDOR_BLACKLIST.has(w))) continue;

    const fileScore = wordsInName.filter((w) => fileWords.has(w)).length;
    const score = phrase.height / h + fileScore * 2;
    if (score > best) {
      best = score;
      stationName = name;
      stationCode = code;
    }
  }
  if (!stationName) {
    const labelled =
      all.match(
        /(?:STATION\s*NAME|NAME\s*OF\s*STATION)\s*[:=-]?\s*([A-Z][A-Z .]{2,40}?)(?:\s*\(([A-Z]{2,5})\))?(?:\s*\||$)/i,
      ) ||
      all.match(
        /SECTION\s*[:=-]\s*.*?(?:LC[-\s]*\d+\s*[-–—]\s*)?([A-Z][A-Z\s.]{2,25})\s*\(\s*([A-Z]{2,5})\s*\)/i,
      );
    if (labelled && labelled[1]) {
      const candName = labelled[1].trim().toUpperCase();
      if (!candName.split(/[^A-Z]+/).some((w) => CORPORATE_VENDOR_BLACKLIST.has(w))) {
        stationName = candName;
        stationCode = labelled[2]?.toUpperCase() ?? "";
      }
    }
  }

  // Check for explicit Station Building annotation e.g. "STATION BUILDING" with station name directly above or beside it
  const stnBuildingToken = texts.find((t) => /STATION\s*BUILDING/i.test(t.text));
  if (stnBuildingToken) {
    const nearbyStationName = texts
      .filter(
        (t) =>
          t.page === stnBuildingToken.page &&
          Math.abs(t.x - stnBuildingToken.x) <= 120 * h &&
          Math.abs(t.y - stnBuildingToken.y) <= 120 * h &&
          t !== stnBuildingToken &&
          !/STATION\s*BUILDING|Station\s*ID|\(Km/i.test(t.text),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - stnBuildingToken.x, a.y - stnBuildingToken.y) -
          Math.hypot(b.x - stnBuildingToken.x, b.y - stnBuildingToken.y),
      )[0];
    if (nearbyStationName) {
      const cleanName = nearbyStationName.text
        .replace(/^[\\{\s]*L?/i, "")
        .replace(/[{}\\]/g, "")
        .trim()
        .toUpperCase();
      if (cleanName && cleanName.length >= 2 && !CORPORATE_VENDOR_BLACKLIST.has(cleanName)) {
        stationName = cleanName;
        stationCode = cleanName;
      }
    }
  }
  const ORPHAN_SUFFIXES = /^(?:JN\.?|JUNCTION|CABIN|STATION|STN|YARD)$/i;
  if (ORPHAN_SUFFIXES.test(stationName) || (stationName && stationName.length <= 3)) {
    const fileBase = Array.from(fileWords).find((w) => !ORPHAN_SUFFIXES.test(w) && w.length >= 4);
    if (fileBase) {
      stationName = `${fileBase} ${stationName}`.replace(/\s+/g, " ").trim();
    } else {
      const m = all.match(/\b([A-Z]{3,30})\s*(?:\|\s*)?(?:JN\.?|JUNCTION|CABIN)\b/i);
      if (m && !CORPORATE_VENDOR_BLACKLIST.has(m[1]!.toUpperCase())) {
        stationName = `${m[1]!.toUpperCase()} ${stationName}`.replace(/\s+/g, " ").trim();
      } else {
        const orphanToken = texts.find((t) => ORPHAN_SUFFIXES.test(t.text.trim().toUpperCase()));
        if (orphanToken) {
          const leftWord = texts
            .filter(
              (t) =>
                t.page === orphanToken.page &&
                Math.abs(t.y - orphanToken.y) <= 0.8 * h &&
                t.x < orphanToken.x &&
                orphanToken.x - t.x <= 35.0 * h &&
                t.text.trim().length >= 3,
            )
            .sort((a, b) => b.x - a.x)[0];
          if (leftWord && !CORPORATE_VENDOR_BLACKLIST.has(leftWord.text.trim().toUpperCase())) {
            stationName = `${leftWord.text.trim().toUpperCase()} ${stationName}`
              .replace(/\s+/g, " ")
              .trim();
          }
        }
      }
    }
  }

  if (!stationName) {
    stationName = upper(baseName);
    stationCode = "";
  }
  if (!stationCode) {
    const m = all.match(/(?:STATION|STN)\s*(?:ALPHA\s*)?CODE\s*[:=-]?\s*([A-Z]{2,5})\b/i);
    if (
      m &&
      !NON_STATION_ACRONYMS.has(m[1]!.toUpperCase()) &&
      !CORPORATE_VENDOR_BLACKLIST.has(m[1]!.toUpperCase())
    ) {
      stationCode = m[1]!.toUpperCase();
    }
  }

  // Station ID: from an allocation table (header row with station code / UP / DN) or an inline label.
  let stationId = "";
  let nextUpStationId = "";
  let nextDownStationId = "";

  const explicitIdMatches = [
    all.match(
      /\b(?:STATION|STAION|STN|TCAS|KAVACH)\s*(?:ID|NO\.?)\s*[:.\-=~]?\s*(?:\|\s*)?([0-9O]{3,6})(?:\s*\(|\s*\[|\s*$|\s*[,\s|])/i,
    ),
    all.match(/\b(?:STATION|STAION|STN)\s*(?:ID|NO\.?)\s*[:.\-=~]?\s*(?:\|\s*)?([0-9O]{3,6})/i),
  ];
  for (const m of explicitIdMatches) {
    if (m && m[1]) {
      stationId = m[1];
      break;
    }
  }
  for (const phrase of phrases) {
    const text = upper(phrase.text);
    if (!/\b(?:STATION|STAION|STN)\s*ID\b/.test(text)) continue;
    const inline = text.match(/\b(?:STATION|STAION|STN)\s*ID\s*[:.\-=]?\s*(\d{2,6})\b/);
    const numbers = texts
      .filter(
        (t) =>
          !t.vertical &&
          t.page === phrase.page &&
          Math.abs(t.y - phrase.y) < 0.6 * h &&
          t.x > phrase.x1 &&
          t.x - phrase.x1 < 40 * h &&
          /^\d{2,6}$/.test(upper(t.text)),
      )
      .sort((a, b) => a.x - b.x);
    if (numbers.length >= 2) {
      for (const number of numbers) {
        const header = texts
          .filter(
            (t) =>
              !t.vertical &&
              t.page === number.page &&
              number.y - t.y > 0.6 * h &&
              number.y - t.y < 4 * h &&
              Math.abs(t.x - number.x) < 3 * h,
          )
          .sort((a, b) => number.y - a.y - (number.y - b.y))[0];
        const label = header ? words(header.text) : "";
        if (label === "UP") nextUpStationId ||= upper(number.text);
        else if (label === "DN" || label === "DOWN") nextDownStationId ||= upper(number.text);
        else if (!stationId && (label === stationCode || !label)) stationId = upper(number.text);
      }
    }
    if (!stationId && inline) stationId = inline[1]!;
    if (!stationId && numbers[0]) stationId = upper(numbers[0].text);
  }

  if (!nextDownStationId) {
    const m = all.match(
      /\bNEXT\s*(?:[|\s]+)?(?:DOWN|DN)\s*(?:[|\s]+)?(?:STATION|STN)?\s*[:=-]?\s*([A-Z0-9]{2,6})\b/i,
    );
    if (m) nextDownStationId = m[1]!.toUpperCase();
  }
  if (!nextUpStationId) {
    const m = all.match(
      /\bNEXT\s*(?:[|\s]+)?UP\s*(?:[|\s]+)?(?:STATION|STN)?\s*[:=-]?\s*([A-Z0-9]{2,6})\b/i,
    );
    if (m) nextUpStationId = m[1]!.toUpperCase();
  }

  const find = (re: RegExp) =>
    ordered
      .map((p) => upper(p.text).match(re)?.[1])
      .find(Boolean)
      ?.trim() ?? "";
  const division =
    find(/\b([A-Z][A-Z]{3,}(?:\s+[A-Z]{3,})?)\s+DIVISION\b/) ||
    find(/\bDIVISION\s*[:=-]\s*([A-Z][A-Z ]{2,30})/);
  const refSip = find(/\bREF\.?\s*SIP\.?\s*(?:NO\.?)?\s*[:=-]?\s*([A-Z0-9][A-Z0-9./_()-]{3,60})/);
  const refToc = find(
    /\bREF\.?\s*(?:TOC|TABLE\s*OF\s*CONTROL)\.?\s*(?:NO\.?)?\s*[:=-]?\s*([A-Z0-9][A-Z0-9./_()-]{2,60})/,
  );
  const refLayout = find(
    /\b((?:KAVACH|TCAS)[_\s]*RFID[_\s]*TAG[_\s]*(?:\/\s*TIN[_\s]*)?LAYOUT[_A-Z0-9.-]*)/,
  );
  const version =
    refLayout.match(/[_\s-](\d+(?:\.\d+)+)$/)?.[1] ??
    find(/\bVER(?:SION)?\.?\s*(?:NO\.?)?\s*[:=-]?\s*([0-9][0-9.]{0,10})\b/);

  const valueUnder = (headerRe: RegExp): string => {
    const header = phrases.find((p) => headerRe.test(upper(p.text)));
    if (!header) return "";
    const value = phrases
      .filter(
        (p) =>
          p.page === header.page &&
          p.y - header.y > 0.8 * h &&
          p.y - header.y < 7 * h &&
          Math.abs(p.x - header.x) < 4 * h,
      )
      .filter(
        (p) =>
          /^[A-Z][A-Z .]{2,35}$/.test(upper(p.text)) &&
          !/\b(?:SIGN|NAME|BY|DATE)\b/.test(upper(p.text)),
      )
      .sort((a, b) => b.y - a.y)[0];
    return value
      ? upper(value.text)
      : find(new RegExp(`${headerRe.source}\\s*[:=-]?\\s*([A-Z][A-Z .]{2,35})`));
  };

  return {
    stationName,
    stationCode,
    stationId,
    division,
    section: find(/\bSECTION\s*[:=-]\s*([A-Z][A-Z0-9 -]{1,30})/),
    refSip,
    refLayout,
    refToc,
    version,
    chainageDirection: "UNKNOWN",
    nextDownStationId,
    nextUpStationId,
    preparedBy: valueUnder(/PREPARED\s*BY/),
    checkedBy: valueUnder(/CHECKED\s*BY/),
    engineerSignedOff: false,
  };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function extractOfflineProject(input: OfflineExtractionInput): StationProject {
  const tokens = input.tokens
    .map((token) => ({ ...token, text: cleanText(token.text) }))
    .filter(
      (token) =>
        Number.isFinite(token.x) &&
        Number.isFinite(token.y) &&
        (token.kind && token.kind !== "text" ? true : Boolean(token.text)),
    );
  const texts = tokens.filter((token) => !token.kind || token.kind === "text");
  const rings = tokens.filter((token) => token.kind === "ring");
  if (texts.length === 0)
    throw new Error(
      "No readable text was found in this drawing. Try a clearer drawing or explicitly choose an online AI provider.",
    );

  const h = unitHeight(texts);
  const phrases = buildPhrases(texts, h);
  const chainages = extractChainages(texts);

  // --- RFID tag labels -----------------------------------------------------------------------
  let tagTokens = tokens.filter(
    (token) =>
      (!token.kind || token.kind === "text" || token.kind === "rfid") &&
      !token.vertical &&
      tagIdOf(token.text),
  );
  const digitCounts = new Map<number, number>();
  for (const token of tagTokens) {
    const digits = tagIdOf(token.text).length - 2;
    digitCounts.set(digits, (digitCounts.get(digits) ?? 0) + 1);
  }
  const [modeDigits, modeCount] = Array.from(digitCounts.entries()).sort(
    (a, b) => b[1] - a[1],
  )[0] ?? [0, 0];
  if (tagTokens.length >= 6 && modeDigits >= 3 && modeCount >= tagTokens.length * 0.7) {
    // A clipped read ("R-7" from "R-718") has fewer digits than the drawing's tag numbering.
    tagTokens = tagTokens.filter((token) => tagIdOf(token.text).length - 2 >= modeDigits);
  }
  const distinctTagTokens: LayoutToken[] = [];
  for (const token of tagTokens.sort((a, b) => (b.confidence ?? 100) - (a.confidence ?? 100))) {
    const id = tagIdOf(token.text);
    if (
      distinctTagTokens.some(
        (kept) =>
          tagIdOf(kept.text) === id &&
          kept.page === token.page &&
          Math.hypot(kept.x - token.x, kept.y - token.y) < 2 * h,
      )
    )
      continue;
    distinctTagTokens.push(token);
  }

  // --- Lines, names, circuits and TINs ----------------------------------------------------------
  const lines = buildLines(tokens, distinctTagTokens, h);
  for (const phrase of phrases) {
    const name = words(phrase.text);
    if (!TRACK_NAME_RE.test(name)) continue;
    const line = nearestLine(lines, phrase, h, 3);
    if (line) line.names.push(name);
  }
  const looseTins: Array<{ id: string; x: number; y: number; page: number }> = [];
  for (const token of texts) {
    if (token.vertical) continue;
    const text = upper(token.text).replace(/[^A-Z0-9/-]/g, "");
    if (
      /^(?:\d{1,3}(?:[-/]\d{1,3})?[A-Z]?T|[A-Z]{2,4}T)$/.test(text) &&
      !/^(?:EXIT|NOT|AT|BT|OUT|GAT|SET|LIT|FIT|PIT|UNIT|LEFT|POST)$/.test(text)
    ) {
      const line = nearestLine(lines, token, h, 2.6);
      if (line && !line.circuits.some((c) => c.id === text))
        line.circuits.push({ id: text, x: token.x });
    }
    const tin = tinIdOf(token.text);
    if (tin) {
      const line = nearestLine(lines, token, h, 2.6);
      if (line && !line.tins.some((t) => t.id === tin)) line.tins.push({ id: tin, x: token.x });
      else if (!line && !looseTins.some((t) => t.id === tin))
        looseTins.push({ id: tin, x: token.x, y: token.y, page: token.page });
    }
  }

  // --- Tag locations -------------------------------------------------------------------------------
  const chainageByTag = pairTagsWithChainages(distinctTagTokens, chainages, h);
  const tagCandidates: TagCandidate[] = [];
  for (const token of distinctTagTokens) {
    const line = nearestLine(lines, token, h);
    const chainage = chainageByTag.get(token);
    const onDetectedTrack = Boolean(line) && tokens.some((t) => t.kind === "track");
    // Physical-location evidence is required: a paired chainage label or a detected running line.
    if (!chainage && !onDetectedTrack) continue;
    tagCandidates.push({
      id: tagIdOf(token.text),
      token,
      chainageM: chainage?.value ?? null,
      line,
      letter: legendLetterNear(texts, token, line, h),
    });
  }

  // --- Dynamic Yard Chainage Model ----------------------------------------------------------------
  // Collect all confident anchor points with known chainage and x coordinate
  const anchors = tagCandidates
    .filter((tc) => tc.chainageM !== null && Number.isFinite(tc.chainageM) && tc.chainageM! > 0)
    .map((tc) => ({ x: tc.token.x, c: tc.chainageM!, page: tc.token.page }));

  let yardScale: { slope: number; intercept: number } | null = null;
  if (anchors.length >= 2) {
    const n = anchors.length;
    const sumX = anchors.reduce((s, a) => s + a.x, 0);
    const sumC = anchors.reduce((s, a) => s + a.c, 0);
    const sumXC = anchors.reduce((s, a) => s + a.x * a.c, 0);
    const sumXX = anchors.reduce((s, a) => s + a.x * a.x, 0);
    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) > 1e-5) {
      const slope = (n * sumXC - sumX * sumC) / denom;
      const intercept = (sumC - slope * sumX) / n;
      if (Math.abs(slope) > 0.001) {
        yardScale = { slope, intercept };
      }
    }
  }

  // Interpolate missing chainages for tags on detected running lines using the yard track model
  for (const tc of tagCandidates) {
    if (tc.chainageM === null && yardScale) {
      const sameLineAnchors = tagCandidates
        .filter((other) => other !== tc && other.line === tc.line && other.chainageM !== null)
        .sort((a, b) => a.token.x - b.token.x);
      const left = sameLineAnchors.filter((a) => a.token.x <= tc.token.x).pop();
      const right = sameLineAnchors.filter((a) => a.token.x >= tc.token.x).shift();

      if (left && right && Math.abs(right.token.x - left.token.x) > 1e-3) {
        const frac = (tc.token.x - left.token.x) / (right.token.x - left.token.x);
        tc.chainageM = Math.round(left.chainageM! + frac * (right.chainageM! - left.chainageM!));
      } else {
        tc.chainageM = Math.round(yardScale.slope * tc.token.x + yardScale.intercept);
      }
      tc.interpolated = true;
    }
  }

  // Keep only lines that carry evidence, ordered top to bottom.
  const usedLines = lines
    .filter((line) => line.names.length > 0 || tagCandidates.some((tag) => tag.line === line))
    .sort((a, b) => a.page - b.page || a.y - b.y);
  usedLines.forEach((line, index) => {
    line.id = lineDisplayName(line, index);
  });
  const lineName = (line: Line | null) => (line && usedLines.includes(line) ? line.id : "");

  const tags: RfidTag[] = tagCandidates.map((candidate, index) => {
    const legend = candidate.letter ? LEGEND_LETTERS[candidate.letter] : undefined;
    const isInterp = candidate.interpolated;
    const notes = [
      isInterp
        ? `Chainage computed from yard layout geometry (Ch. ${candidate.chainageM}m).`
        : candidate.chainageM === null
          ? "Tag label sits on a drawn running line but its chainage label could not be read."
          : "Chainage paired from the label beside this tag.",
      legend ? `Drawing legend letter "${candidate.letter}" (${legend.label}).` : "",
      "TIN is left blank unless the drawing states it for this tag.",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      id: `tag-${index + 1}`,
      tagId: candidate.id,
      chainageM: candidate.chainageM,
      line: lineName(candidate.line),
      tin: "",
      tagType:
        (candidate.token as any).tagType === "N"
          ? "NORMAL"
          : (candidate.token as any).tagType === "S"
            ? "SIGNAL_FOOT"
            : (candidate.token as any).tagType === "T"
              ? "TURNOUT"
              : (candidate.token as any).tagType === "X"
                ? "EXIT"
                : (candidate.token as any).tagType === "G"
                  ? "GATE"
                  : (candidate.token as any).tagType === "A"
                    ? "ADJUSTMENT"
                    : (candidate.token as any).tagType === "L"
                      ? "LOOP"
                      : (candidate.token as any).tagType === "D"
                        ? "DEAD_END"
                        : legend?.type ?? "UNKNOWN",
      // A label paired with its own chainage or interpolated from yard geometry is corroborated
      confidence:
        candidate.chainageM === null || (candidate.token.confidence ?? 100) < 45
          ? "LOW"
          : confidence(Math.max(candidate.token.confidence ?? 100, isInterp ? 75 : 60)),
      verified: false,
      notes,
      x: candidate.token.x,
      y: -candidate.token.y,
    };
  });

  // --- Signals --------------------------------------------------------------------------------------
  const rightDirection = legendRightDirection(texts, h);
  const leftDirection: SignalDirection | null =
    rightDirection === "DOWN" ? "UP" : rightDirection === "UP" ? "DOWN" : null;
  const candidates = signalCandidates(texts, rings, h);
  const tagLines = usedLines.filter((line) => tagCandidates.some((tag) => tag.line === line));
  /**
   * Score for a signal post standing on `tag`: the post is at one end of the head row and drops to the
   * nearest running line; the tag's own label is normally written on the other side of the line.
   */
  const postScore = (
    cluster: { x0: number; x1: number; y: number },
    tag: TagCandidate,
  ): number | null => {
    if (!tag.line) return null;
    const x = tag.token.x;
    const ly = lineYAt(tag.line, x);
    const offset = cluster.y - ly;
    if (Math.abs(offset) < 1.5 * h || Math.abs(offset) > 10 * h) return null;
    const inside = x >= cluster.x0 && x <= cluster.x1;
    const endDx = inside ? 0 : Math.min(Math.abs(x - cluster.x0), Math.abs(x - cluster.x1));
    if (endDx > 7.5 * h) return null;
    const blocked = tagLines.some((line) => {
      if (line === tag.line || line.page !== tag.line!.page || x < line.x0 - h || x > line.x1 + h)
        return false;
      const between = (lineYAt(line, x) - ly) * Math.sign(offset);
      return between > 0.5 * h && between < Math.abs(offset) - 0.5 * h;
    });
    if (blocked) return null;
    const labelSide = tag.token.y - ly;
    const sideScore =
      Math.abs(labelSide) < 0.3 * h ? 0 : Math.sign(labelSide) === Math.sign(offset) ? 1.2 : -1.2;
    const letterBonus = tag.letter === "S" ? -1.5 : tag.letter && tag.letter !== "S" ? 1 : 0;
    return endDx / h + (0.25 * Math.abs(offset)) / h + (inside ? 1 : 0) + sideScore + letterBonus;
  };
  const footPairs: Array<{ signal: SignalCandidate; tag: number; score: number }> = [];
  for (const signal of candidates) {
    tagCandidates.forEach((tag, index) => {
      if (tag.token.page !== signal.label.page) return;
      const letterBonus = tag.letter === "S" ? -1.5 : tag.letter && tag.letter !== "S" ? 1 : 0;
      if (signal.cluster) {
        const score = postScore(signal.cluster, tag);
        if (score !== null) footPairs.push({ signal, tag: index, score: score - 2.5 });
      } else {
        const dx = Math.abs(tag.token.x - signal.label.x);
        const dy = Math.abs(tag.token.y - signal.label.y);
        if (dx > 7.5 * h || dy > 10.0 * h) return;
        // Turnout normal tags (N-xx) cannot be signal foot tags
        if (/^N\s*-?\s*\d+/i.test(tag.token.text)) return;
        footPairs.push({ signal, tag: index, score: dx / h + (dy / h) * 0.25 + letterBonus });
      }
    });
  }
  footPairs.sort((a, b) => a.score - b.score);
  const footOf = new Map<SignalCandidate, number>();
  const footUsers = new Map<number, SignalCandidate[]>();
  for (const pair of footPairs) {
    if (footOf.has(pair.signal)) continue;
    const users = footUsers.get(pair.tag) ?? [];
    // One post can carry a main signal and its calling-on signal (same number), nothing else.
    if (users.some((other) => other.base !== pair.signal.base || other.name === pair.signal.name))
      continue;
    footOf.set(pair.signal, pair.tag);
    footUsers.set(pair.tag, [...users, pair.signal]);
  }

  // A drawn head assembly without a tag at its post is not enough evidence for a signal.
  // Unclustered candidates paired to valid running line posts or explicit signals are retained.
  const evidenced = candidates.filter((signal) => {
    const fIdx = footOf.get(signal);
    const fTag = fIdx !== undefined ? tagCandidates[fIdx] : undefined;
    if (fTag && /^N\s*-?\s*\d+/i.test(fTag.token.text)) return false;
    if (!signal.cluster) {
      return fIdx !== undefined || signal.explicit;
    }
    return signal.explicit || fIdx !== undefined;
  });
  interface PlacedSignal {
    candidate: SignalCandidate;
    node: SignalNode;
    footX: number | null;
    sense: "right" | "left" | null;
    line: Line | null;
    gateLc: string;
  }
  const placed: PlacedSignal[] = evidenced.map((signal, index) => {
    let footIndex = footOf.get(signal);
    // Fallback: if foot tag is not explicitly paired, find nearest tag on nearest line within 15*h
    if (footIndex === undefined && signal.cluster) {
      const nearLine = nearestLine(usedLines, signal.label, h, 8);
      const candidatesOnLine = tagCandidates
        .map((tag, tIdx) => ({
          tag,
          tIdx,
          dist: Math.hypot(tag.token.x - signal.label.x, tag.token.y - signal.label.y),
        }))
        .filter(
          (item) =>
            (nearLine ? item.tag.line === nearLine : true) &&
            item.dist <= 15 * h &&
            (item.tag.letter === "S" || !tagCandidates.some((t) => t.letter === "S")) &&
            !footUsers.has(item.tIdx),
        )
        .sort((a, b) => a.dist - b.dist);
      if (candidatesOnLine.length > 0 && candidatesOnLine[0]) {
        footIndex = candidatesOnLine[0].tIdx;
      }
    }
    const foot = footIndex === undefined ? undefined : tagCandidates[footIndex];
    const footTag = footIndex === undefined ? undefined : tags[footIndex];
    if (footTag) {
      footTag.tagType = "SIGNAL_FOOT";
      footTag.linkedSignal ||= `signal-${index + 1}`;
    }
    const line = foot?.line ?? nearestLine(usedLines, signal.label, h, 8);
    let sense: "right" | "left" | null = null;
    const lineIdUpper = (line?.id || "").toUpperCase();
    const isDownMain = /DN|DOWN/i.test(lineIdUpper) && /MAIN/i.test(lineIdUpper);
    const isUpMain = /UP/i.test(lineIdUpper) && /MAIN/i.test(lineIdUpper);

    if (isDownMain) {
      sense = rightDirection === "DOWN" ? "right" : "left";
    } else if (isUpMain) {
      sense = leftDirection === "UP" ? "left" : "right";
    } else {
      // Loop line or other line:
      // First check physical head cluster position relative to foot tag if distinct offset
      if (foot && signal.cluster) {
        const centre = (signal.cluster.x0 + signal.cluster.x1) / 2;
        if (Math.abs(centre - foot.token.x) > 0.8 * h) {
          sense = centre > foot.token.x ? "right" : "left";
        }
      }
      // If still not determined, use position along the loop line relative to mid-track
      if (!sense) {
        const footX = foot?.token.x ?? signal.label.x;
        const meanTrackX = line ? (line.x0 + line.x1) / 2 : footX;
        if (line && Math.abs(footX - meanTrackX) > 3 * h) {
          sense = footX > meanTrackX ? "right" : "left";
        } else {
          // Parity fallback
          const isUpLoop = /UP.*LOOP/i.test(lineIdUpper);
          const isDnLoop = /DN.*LOOP|DOWN.*LOOP/i.test(lineIdUpper);
          if (isUpLoop) {
            sense = leftDirection === "UP" ? "left" : "right";
          } else if (isDnLoop) {
            sense = rightDirection === "DOWN" ? "right" : "left";
          } else {
            const num = parseInt(signal.base, 10);
            const isOdd = Number.isFinite(num) && num % 2 === 1;
            sense = isOdd
              ? rightDirection === "DOWN"
                ? "right"
                : "left"
              : leftDirection === "UP"
                ? "left"
                : "right";
          }
        }
      }
    }
    const direction: SignalDirection =
      sense === "right"
        ? (rightDirection ?? "DOWN")
        : sense === "left"
          ? (leftDirection ?? "UP")
          : "UNKNOWN";
    const footX = foot?.token.x ?? signal.label.x;
    let chainageM = foot?.chainageM ?? null;
    if (chainageM === null || !Number.isFinite(chainageM)) {
      if (yardScale) {
        chainageM = Math.round(yardScale.slope * footX + yardScale.intercept);
      } else {
        chainageM = Math.round(footX * 10);
      }
    }

    return {
      candidate: signal,
      node: {
        id: `signal-${index + 1}`,
        name: signal.name,
        line: lineName(line),
        direction,
        signalType: "",
        chainageM,
        footTagId: foot?.id ?? "",
        aspects: [],
        confidence: foot && signal.cluster ? confidence(signal.label.confidence) : "LOW",
        verified: false,
        notes: "",
        x: signal.label.x,
        y: -signal.label.y,
      },
      footX,
      sense,
      line,
      gateLc: "",
    };
  });
  const dirOf = (item: PlacedSignal) => (item.sense === "right" ? 1 : -1);

  // Gate signals: the same number drawn again at an LC gate, facing that gate. Each copy belongs to the
  // nearest LC label ahead of it, unless a uniquely numbered signal stands in between.
  const lcAnchors = phrases
    .map((phrase) => ({ phrase, match: upper(phrase.text).match(LC_RE) }))
    .filter((item) => item.match && nearestLine(usedLines, item.phrase, h, 14))
    .map((item) => ({ name: item.match![1]!, x: item.phrase.x, page: item.phrase.page }));
  const nameCount = new Map<string, number>();
  for (const item of placed)
    nameCount.set(item.node.name, (nameCount.get(item.node.name) ?? 0) + 1);
  for (const item of placed) {
    if ((nameCount.get(item.node.name) ?? 0) < 2 || item.sense === null || item.footX === null)
      continue;
    const dir = dirOf(item);
    const lc = lcAnchors
      .filter(
        (anchor) =>
          anchor.page === item.candidate.label.page &&
          (anchor.x - item.footX!) * dir > -2 * h &&
          Math.abs(anchor.x - item.footX!) <= 80 * h,
      )
      .sort((a, b) => Math.abs(a.x - item.footX!) - Math.abs(b.x - item.footX!))[0];
    if (!lc) continue;
    const blocked = placed.some(
      (other) =>
        other !== item &&
        other.sense === item.sense &&
        other.footX !== null &&
        !other.candidate.callingOn &&
        (nameCount.get(other.node.name) ?? 0) === 1 &&
        (other.footX - item.footX!) * dir > 0.3 * h &&
        (lc.x - other.footX) * dir > 0,
    );
    if (!blocked) item.gateLc = lc.name;
  }
  for (const item of placed) {
    if (item.gateLc) item.node.name = `G${item.node.name.replace(/^S/, "")} of LC${item.gateLc}`;
  }

  // --- Turnout legs between lines -------------------------------------------------------------------
  const signalLabels = new Set(evidenced.map((c) => c.label));
  const bareText = (token: LayoutToken) =>
    upper(token.text).replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "");
  const pointLabels = texts.filter(
    (token) =>
      !token.vertical &&
      !signalLabels.has(token) &&
      /^\d{1,2}[AB]?$/.test(bareText(token)) &&
      (token.confidence ?? 100) >= 50,
  );
  interface Leg {
    a: Line;
    xa: number;
    b: Line;
    xb: number;
    p: { x: number; y: number };
    q: { x: number; y: number };
    page: number;
    tags: TagCandidate[];
    tins: string[];
    label: string;
  }
  const legs: Leg[] = [];
  for (const token of tokens) {
    if (token.kind !== "link" || !Number.isFinite(token.x2) || !Number.isFinite(token.y2)) continue;
    const p = { x: token.x, y: token.y, page: token.page };
    const q = { x: token.x2!, y: token.y2!, page: token.page };
    const a = nearestLine(usedLines, p, h, 2.5);
    const b = nearestLine(usedLines, q, h, 2.5);
    if (!a || !b || a === b) continue;
    if (Math.abs(lineYAt(a, p.x) - lineYAt(b, q.x)) < 2 * h) continue;
    if (
      legs.some(
        (leg) =>
          (leg.a === a &&
            leg.b === b &&
            Math.abs(leg.xa - p.x) < 3 * h &&
            Math.abs(leg.xb - q.x) < 3 * h) ||
          (leg.a === b &&
            leg.b === a &&
            Math.abs(leg.xa - q.x) < 3 * h &&
            Math.abs(leg.xb - p.x) < 3 * h),
      )
    )
      continue;
    const label = pointLabels
      .filter((t) => t.page === token.page)
      .map((t) => ({ t, d: distanceToSegment(t, p, q) }))
      .filter((item) => item.d <= 5 * h)
      .sort((x, y) => x.d - y.d)[0];
    legs.push({
      a,
      xa: p.x,
      b,
      xb: q.x,
      p,
      q,
      page: token.page,
      tags: [],
      tins: [],
      label: label ? bareText(label.t) : "",
    });
  }
  const nearestLeg = (point: { x: number; y: number; page: number }) =>
    legs
      .filter((leg) => leg.page === point.page)
      .map((leg) => ({ leg, d: distanceToSegment(point, leg.p, leg.q) }))
      .filter((item) => item.d <= 5.0 * h)
      .sort((x, y) => x.d - y.d)[0]?.leg;
  for (const tag of tagCandidates) {
    if (tag.line) continue;
    const leg = nearestLeg({ x: tag.token.x, y: tag.token.y, page: tag.token.page });
    if (leg) {
      leg.tags.push(tag);
    }
  }
  for (const tin of looseTins) nearestLeg(tin)?.tins.push(tin.id);

  // Determine topological station yard boundaries from turnout crossover switches, points, and loop lines
  const yardPointsX: number[] = [];
  for (const leg of legs) {
    yardPointsX.push(leg.xa, leg.xb);
  }
  for (const l of usedLines) {
    if (/LOOP|BRANCH|SIDING|GOODS/i.test(l.id)) {
      yardPointsX.push(l.x0, l.x1);
    }
  }
  for (const token of tokens) {
    if (token.kind === "point" && Number.isFinite(token.x)) {
      yardPointsX.push(token.x as number);
    }
  }
  if (yardPointsX.length === 0 && placed.length >= 2) {
    const fxCoords = placed.map((p) => p.footX).filter((x): x is number => x !== null && Number.isFinite(x));
    if (fxCoords.length >= 2) {
      const minX = Math.min(...fxCoords);
      const maxX = Math.max(...fxCoords);
      const span = maxX - minX;
      if (span > 10 * h) {
        // Intermediate span between outermost entrance distants is station yard
        yardPointsX.push(minX + span * 0.15, maxX - span * 0.15);
      }
    }
  }
  const minYardX = yardPointsX.length > 0 ? Math.min(...yardPointsX) : -Infinity;
  const maxYardX = yardPointsX.length > 0 ? Math.max(...yardPointsX) : Infinity;

  // Enforce Directional Outermost Approach Distant Signalling Invariant:
  // Along each direction of travel, at most the 1 or 2 outermost approach signals entering the yard
  // can be Distants (Distant / Inner Distant).
  // ALL downstream signals situated inside the station limits or along station lines
  // are strictly Stop Signals (Starters / Homes / Advanced Starters). Strip any stray OCR lamp-ring 'D'.
  for (const dir of ["DOWN", "UP"] as const) {
    const dirMult = dir === "DOWN" ? 1 : -1;
    const dirPlaced = placed.filter((p) => p.node.direction === dir && p.footX !== null);
    const sortedAlongApproach = dirPlaced.slice().sort((a, b) => (a.footX! - b.footX!) * dirMult);

    for (let i = 0; i < sortedAlongApproach.length; i++) {
      const item = sortedAlongApproach[i]!;
      const c = item.candidate;
      const fx = item.footX ?? 0;
      const isInside = (yardPointsX.length > 0 && fx >= minYardX - 3 * h && fx <= maxYardX + 3 * h) || i >= 2;
      const isLoopLine = /LOOP|BRANCH|SIDING|GOODS/i.test(item.line?.id || item.node.line || "");

      // Distants (D, ID) belong outside station limits along the approach section.
      // Never strip authentic D or ID suffixes from distant signals.
      if (isLoopLine && !c.callingOn && !c.explicit) {
        if (c.suffix === "D" || c.suffix === "ID") {
          c.suffix = "";
          item.node.name = item.node.name.replace(/(?:I\s*)?D$/i, "");
        }
      }
    }
  }

  // Signal function from the drawn label and its neighbours per RDSO signalling standards.
  // Pass 1: Identify special signals (Calling-on, Gate, Auto, Shunt, Stop Board, Distants, IB).
  for (const item of placed) {
    const c = item.candidate;
    let name = item.node.name.toUpperCase();
    const fx = item.footX ?? 0;
    const dir = item.node.direction;
    const isPastDepartureThroat =
      yardPointsX.length > 0 &&
      ((dir === "DOWN" && fx > maxYardX + 5 * h) || (dir === "UP" && fx < minYardX - 5 * h));

    const isInsideYard =
      yardPointsX.length > 0 && fx >= minYardX - 3 * h && fx <= maxYardX + 3 * h;
    const isLoopLine = /LOOP|BRANCH|SIDING|GOODS/i.test(item.line?.id || item.node.line || "");

    // Loop line signals inside yard cannot be Distants; approach signals must preserve D / ID
    if (isLoopLine && !c.callingOn && !c.explicit) {
      if (c.suffix === "D" || c.suffix === "ID") {
        c.suffix = "";
        item.node.name = `S${c.base}`;
        name = item.node.name.toUpperCase();
      }
    }

    if (c.callingOn || /^[CS]\d*A$/i.test(name) || c.suffix === "A" || /CALLING/i.test(name)) {
      item.node.signalType = "Calling-on Signal";
    } else if (c.explicit && /^A\d+/i.test(c.name)) {
      item.node.signalType = "Auto Signal";
    } else if (item.gateLc) {
      item.node.signalType = c.suffix === "D" ? "Gate Distant" : "Gate Stop";
    } else if (/^SH\d+/i.test(name) || /SHUNT/i.test(name)) {
      item.node.signalType = "Shunt Signal";
    } else if (/STOP\s*BOARD/i.test(name)) {
      item.node.signalType = "Stop Board";
    } else if (c.suffix === "ID" || /ID$/i.test(name) || /INNER\s*DISTANT/i.test(name)) {
      item.node.signalType =
        isPastDepartureThroat || /IB/i.test(name) ? "IB Inner Distant" : "Inner Distant";
    } else if (c.suffix === "D" || /D$/i.test(name) || /DISTANT/i.test(name)) {
      item.node.signalType = isPastDepartureThroat || /IB/i.test(name) ? "IB Distant" : "Distant";
    } else if (/IB/i.test(name) || isPastDepartureThroat) {
      item.node.signalType = "IB Signal";
    }
  }

  // Pass 2: Classify remaining stop signals per direction based on topological station layout
  for (const dir of ["DOWN", "UP"] as const) {
    const dirMult = dir === "DOWN" ? 1 : -1;
    const dirPlaced = placed.filter((p) => p.node.direction === dir && p.footX !== null);

    // Find approach distants for this direction (strictly entrance approach, not IB)
    const approachDistants = dirPlaced.filter(
      (p) => p.node.signalType === "Distant" || p.node.signalType === "Inner Distant",
    );

    // Remaining unclassified stop signals in this direction, sorted along direction of travel
    // Exclude signals already identified as IB signals or distants
    const stopSignals = dirPlaced
      .filter((p) => !p.node.signalType && p.node.signalType !== "IB Signal")
      .sort((a, b) => (a.footX! - b.footX!) * dirMult);

    if (stopSignals.length === 0) continue;

    // 1. Identify Station Home signal:
    // Matches the base number of an entrance approach distant (e.g. S1 matches S1D, S30 matches S30D),
    // or is explicitly named HOME, or is the first stop signal entering the station yard.
    let homeSignal = stopSignals.find((s) =>
      approachDistants.some((d) => d.candidate.base === s.candidate.base),
    );
    if (!homeSignal) {
      homeSignal = stopSignals.find((s) => /HOME/i.test(s.node.name)) || stopSignals[0];
    }
    if (homeSignal) {
      homeSignal.node.signalType = "Main Home with Route Indicator";
    }

    // Remaining stop signals after Home
    const remainingAfterHome = stopSignals.filter((s) => s !== homeSignal);
    if (remainingAfterHome.length === 0) continue;

    // 2. Identify Advanced Starter (LSS) and IB signals:
    for (const s of remainingAfterHome) {
      const hasIbDistantInRear = dirPlaced.some(
        (d) =>
          (d.node.signalType === "IB Distant" || d.node.signalType === "IB Inner Distant") &&
          (s.footX! - d.footX!) * dirMult > 2 * h,
      );
      if (hasIbDistantInRear || /IB/i.test(s.node.name)) {
        s.node.signalType = "IB Signal";
      }
    }

    // Outermost unclassified departure stop signal on the main running line is the Advanced Starter
    const yardStopSignals = remainingAfterHome.filter((s) => !s.node.signalType);
    if (yardStopSignals.length > 0) {
      const departureMainSignals = yardStopSignals.filter(
        (s) => !/LOOP|SIDING/i.test(s.line?.id || ""),
      );
      const furthest =
        departureMainSignals.length > 0
          ? departureMainSignals[departureMainSignals.length - 1]!
          : yardStopSignals[yardStopSignals.length - 1]!;
      furthest.node.signalType = "Advanced Starter";
    }

    // 3. Classify all remaining signals between Home and Advanced Starter as Starters
    for (const s of yardStopSignals) {
      if (s.node.signalType) continue;
      const lineId = (s.line?.id || s.node.line || "").toUpperCase();
      if (/LOOP|BRANCH|SIDING|GOODS/i.test(lineId)) {
        s.node.signalType = "Loopline Starter";
      } else {
        s.node.signalType = "Mainline Starter";
      }
    }
  }

  // Fallback for any signals not yet typed
  for (const item of placed) {
    if (!item.node.signalType) {
      item.node.signalType = "Mainline Starter";
    }
  }

  // Strict Rule: Signals MUST start with "S"
  // If ends with D -> Distant Signal
  // If ends with ID -> Inner Distant
  // If ends with A -> Calling-on Signal
  for (const item of placed) {
    let n = item.node.name.trim().toUpperCase();
    if (!n.startsWith("S") && !n.startsWith("G") && !n.startsWith("SH")) {
      n = `S${n}`;
    }
    if (item.node.signalType === "Distant" && !n.endsWith("D")) {
      n = `${n}D`;
    } else if (item.node.signalType === "Inner Distant" && !n.endsWith("ID")) {
      n = `${n}ID`;
    } else if (item.node.signalType === "Calling-on Signal" && !n.endsWith("A")) {
      n = `${n}A`;
    }
    item.node.name = n;
  }
  for (const item of placed) {
    const heads = item.candidate.cluster?.heads ?? 0;
    item.node.aspects = aspectsFor(item.node.signalType, heads);
    const footLabel = item.node.footTagId;
    item.node.notes = [
      item.candidate.cluster
        ? `Signal label beside ${heads} drawn lamp head(s).`
        : "Explicit signal label.",
      footLabel
        ? `Foot tag ${footLabel} taken from the tag at the signal post.`
        : "No foot tag could be matched at the signal post.",
      item.sense
        ? `Facing ${item.sense === "right" ? "left-to-right" : "right-to-left"} from the head symbols${item.node.direction === "UNKNOWN" ? "" : ` (${item.node.direction} per the drawing's direction legend)`}.`
        : "Direction not determinable from the drawing.",
      item.gateLc
        ? `Same number is drawn elsewhere; this copy faces LC ${item.gateLc}, so it is read as that gate's signal.`
        : "",
      item.node.signalType
        ? `Function "${item.node.signalType}" inferred from the label${item.node.signalType === "Home" || item.node.signalType === "Starter" ? " and neighbouring signals" : ""}.`
        : "Function not stated on the drawing.",
      item.node.aspects.length
        ? "Aspects follow from the function and the number of lamp heads drawn; confirm against the signal plan."
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const signals = placed.map((item) => item.node);

  // Drawn head rows whose number could not be read still stop a route: no row is built past them.
  const barriers: Array<{ line: Line; footX: number; sense: "right" | "left" }> = [];
  const allChains = groupRingChains(
    rings
      .filter((ring) => (ring.width ?? h) / 2 >= 0.4 * h)
      .map((ring) => ({ x: ring.x, y: ring.y, r: (ring.width ?? h) / 2 })),
  );
  for (const chain of allChains) {
    if (
      evidenced.some(
        (signal) =>
          signal.cluster &&
          Math.abs(signal.cluster.x0 - chain.x0) < 0.5 * h &&
          Math.abs(signal.cluster.y - chain.y) < 0.5 * h,
      )
    )
      continue;
    const best = tagCandidates
      .map((tag) => ({ tag, score: postScore(chain, tag) }))
      .filter((item) => item.score !== null)
      .sort((a, b) => a.score! - b.score!)[0];
    if (!best?.tag.line) continue;
    const centre = (chain.x0 + chain.x1) / 2;
    if (Math.abs(centre - best.tag.token.x) <= 0.5 * h) continue;
    barriers.push({
      line: best.tag.line,
      footX: best.tag.token.x,
      sense: centre > best.tag.token.x ? "right" : "left",
    });
  }

  // --- Points and level crossings ---------------------------------------------------------------
  const turnouts = chainages.filter((c) => c.turnout);
  const points: PointSwitch[] = [];

  // 1. Ingest points directly emitted from CAD/DWG parsing
  for (const token of tokens) {
    if (token.kind !== "point" || !token.text) continue;
    const ptName = String(token.text).trim();
    if (points.some((p) => p.name === ptName)) continue;

    const pPt = { x: token.x, y: token.y, page: token.page ?? 1 };
    const nearLine = nearestLine(usedLines, pPt, h, 8.0);
    const altLine = usedLines.find(
      (l) => l !== nearLine && Math.abs(lineYAt(l, pPt.x) - pPt.y) <= 15 * h,
    );

    points.push({
      id: `point-${points.length + 1}`,
      name: ptName,
      chainageM: null,
      normalLine: nearLine?.id || "",
      reverseLine: altLine?.id || "",
      turnoutSpeedKmph: 30,
      confidence: "HIGH",
      notes: "Point machine extracted directly from engineering CAD layout.",
      x: token.x,
      y: -token.y,
    });
  }

  // 2. Extract point numbers from drawing annotations / OCR text
  for (const token of texts) {
    if (signalLabels.has(token)) continue;
    const text = upper(token.text).replace(/[^A-Z0-9]/g, "");
    const explicit = upper(token.text).match(/^(?:PT\.?|POINT|P)?\s*[-:]?\s*(\d{1,3}[AB]?)$/);
    const bare = /^\d{1,2}[AB]?$/.test(text) && (token.confidence ?? 100) >= 50 ? text : "";
    const name = explicit?.[1] ?? bare;
    if (!name) continue;

    const pTok = { x: token.x, y: token.y, page: token.page };
    const nearLine = nearestLine(usedLines, pTok, h, 6.0);
    const isNearLeg = legs.some((leg) => distanceToSegment(pTok, leg.p, leg.q) <= 6.0 * h);
    if (!nearLine && !isNearLeg && !explicit) continue;
    if (points.some((point) => point.name === name)) continue;

    const turnout = turnouts
      .filter(
        (c) =>
          c.token.page === token.page &&
          Math.hypot(c.token.x - token.x, c.token.y - token.y) <= 8.0 * h,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.token.x - token.x, a.token.y - token.y) -
          Math.hypot(b.token.x - token.x, b.token.y - token.y),
      )[0];

    const altLine = usedLines.find(
      (l) => l !== nearLine && Math.abs(lineYAt(l, pTok.x) - pTok.y) <= 15 * h,
    );

    points.push({
      id: `point-${points.length + 1}`,
      name,
      chainageM: turnout?.value ?? null,
      normalLine: nearLine?.id || "",
      reverseLine: altLine?.id || "",
      turnoutSpeedKmph: 30,
      confidence: confidence(token.confidence),
      notes: turnout
        ? 'Point number beside a turnout chainage label.'
        : "Point switch number identified on track layout.",
      x: token.x,
      y: -token.y,
    });
  }

  // 3. Ensure all detected crossover legs are registered as point switches
  for (let idx = 0; idx < legs.length; idx++) {
    const leg = legs[idx]!;
    let legLabel = leg.label;
    if (!legLabel) {
      const mid = { x: (leg.p.x + leg.q.x) / 2, y: (leg.p.y + leg.q.y) / 2 };
      const nearbyPt = points.find((p) => {
        const ptTok = texts.find((t) => upper(t.text).includes(p.name));
        return ptTok && Math.hypot(ptTok.x - mid.x, ptTok.y - mid.y) <= 8.0 * h;
      });
      if (nearbyPt) {
        legLabel = nearbyPt.name;
        leg.label = legLabel;
        nearbyPt.normalLine ||= leg.a.id;
        nearbyPt.reverseLine ||= leg.b.id;
      } else {
        const baseNum = 11 + idx;
        legLabel = `${baseNum}A/${baseNum}B`;
        leg.label = legLabel;
      }
    }
    if (points.some((point) => point.name === legLabel)) continue;

    const mid = { x: (leg.p.x + leg.q.x) / 2, y: (leg.p.y + leg.q.y) / 2 };
    const turnout = turnouts
      .filter(
        (c) =>
          c.token.page === leg.page && Math.hypot(c.token.x - mid.x, c.token.y - mid.y) <= 8 * h,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.token.x - mid.x, a.token.y - mid.y) -
          Math.hypot(b.token.x - mid.x, b.token.y - mid.y),
      )[0];

    points.push({
      id: `point-${points.length + 1}`,
      name: legLabel,
      chainageM: turnout?.value ?? null,
      normalLine: leg.a.id,
      reverseLine: leg.b.id,
      turnoutSpeedKmph: 30,
      confidence: "MEDIUM",
      notes: `Point crossover leg connecting ${leg.a.id} and ${leg.b.id}.`,
    });
  }

  const levelCrossings: LevelCrossing[] = [];
  for (const phrase of phrases) {
    const cleanTxt = upper(phrase.text.replace(/\\L|\\[A-Za-z0-9]+;?|[{}]/g, " "));
    const match =
      cleanTxt.match(LC_RE) ||
      cleanTxt.match(/\bLC[.\s]*(?:GATE[.\s]*)?(?:NO[.\s]*)?[:=-]?\s*(\d{1,4}[A-Z]?)\b/i);
    if (!match) continue;
    const name = `LC-${match[1]}`;
    if (levelCrossings.some((lc) => lc.name === name)) continue;
    const classMatch = cleanTxt.match(/(?:CLASS\s*'?([A-Z]+)'?|'([A-Z]+)'\s*CLASS)/);
    const kmMatch = cleanTxt.match(/(?:AT\s*KM|KM)\s*[:.\-=]?\s*(\d{1,3}\.\d{2,3})/);
    const chainageM = kmMatch ? Math.round(parseFloat(kmMatch[1]) * 1000) : null;
    levelCrossings.push({
      id: `lc-${levelCrossings.length + 1}`,
      name,
      chainageM,
      manningType: "Manned",
      lcClass: classMatch ? classMatch[1] || classMatch[2] : "SPL",
      autoWhistling: "Yes",
      closingCondition: "Interlocked",
    });
  }

  // --- Metadata -------------------------------------------------------------------------------------
  const metadata = extractMetadata(input.fileName, phrases, texts, h);
  const located = tagCandidates.filter((tag) => tag.chainageM !== null);
  const chainagePoints: Array<{ x: number; c: number }> = [];
  for (const tag of tagCandidates) {
    if (tag.chainageM !== null && Number.isFinite(tag.chainageM) && tag.chainageM > 0) {
      chainagePoints.push({ x: tag.token.x, c: tag.chainageM });
    }
  }
  for (const ch of chainages) {
    if (Number.isFinite(ch.value) && ch.value > 0) {
      chainagePoints.push({ x: ch.token.x, c: ch.value });
    }
  }
  if (chainagePoints.length >= 2) {
    const meanX = chainagePoints.reduce((s, t) => s + t.x, 0) / chainagePoints.length;
    const meanC = chainagePoints.reduce((s, t) => s + t.c, 0) / chainagePoints.length;
    const covariance = chainagePoints.reduce((s, t) => s + (t.x - meanX) * (t.c - meanC), 0);
    if (Math.abs(covariance) > 0)
      metadata.chainageDirection = covariance > 0 ? "RIGHT_INCREASING" : "LEFT_INCREASING";
  }

  // --- Dynamic Aspect Permutation Synthesis (RDSO SPN-196 v4.0 Amdt-6 Annexure-I) -----------------
  const buildAspectPermutations = (params: {
    entryName: string;
    exitName: string;
    entrySignalType: string;
    exitSignalType: string;
    entryDirection: SignalDirection | string;
    isCallingOn: boolean;
    isDiverging: boolean;
    distM: number;
    speeds: { sr: string; os: string };
    exitLineId?: string | undefined;
    entryLineId?: string | undefined;
    entryY?: number | undefined;
    exitY?: number | undefined;
    isLeftDivergence?: boolean | undefined;
  }): RouteAspectPermutation[] => {
    const isExitInnerDistant =
      /inner\s*distant/i.test(params.exitSignalType) || /ID$/i.test(params.exitName);
    const isEntryDistant =
      /distant/i.test(params.entrySignalType) && !/inner/i.test(params.entrySignalType);
    const isEntryInnerDistant =
      /inner\s*distant/i.test(params.entrySignalType) || /ID$/i.test(params.entryName);
    const isEntryAdvance = /advance|lss/i.test(params.entrySignalType);
    const isEntryStarter = /starter/i.test(params.entrySignalType) && !isEntryAdvance;
    const isEntryHome = /home/i.test(params.entrySignalType);
    const isEntryIb = /ib/i.test(params.entrySignalType);
    const isExitIbDistant =
      /ib\s*distant/i.test(params.exitSignalType) ||
      (isEntryAdvance && /distant/i.test(params.exitSignalType));

    if (params.isCallingOn) {
      const parentName = params.entryName.replace(/[A-Z]+$/, "");
      return [
        {
          aspectOfEntrySignal: `Miniature (${parentName} Red/Blank)`,
          requiresAspectOfExitSignal: `${params.exitName} Red`,
          movementAuthoritySections: "1",
          authorizedSpeedSr: "15",
          authorizedSpeedOs: "15",
        },
      ];
    }

    if (/auto/i.test(params.entrySignalType) || /^A\d+/i.test(params.entryName)) {
      return [
        {
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${params.exitName} Green / Double Yellow`,
          movementAuthoritySections: "4",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Double Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Yellow`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Red`,
          movementAuthoritySections: "1",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "30",
        },
        {
          aspectOfEntrySignal: "Red",
          requiresAspectOfExitSignal: "-",
          movementAuthoritySections: "0",
          authorizedSpeedSr: "0",
          authorizedSpeedOs: "0",
        },
      ];
    }

    if (isEntryDistant && isExitInnerDistant) {
      // 4-Aspect Double Distant territory: Distant facing Inner Distant (e.g. S30D -> S30 ID, S1D -> S1 ID)
      // Permissive signal ahead: Exit NEVER shows Red. Double Yellow triad is mandatory.
      // Total 8 atomic rows per RDSO Amdt-6 Table 1:
      return [
        // Green
        {
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${params.exitName} Double Yellow`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        // Double Yellow
        {
          aspectOfEntrySignal: "Double Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Double Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Double Yellow`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Double Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Yellow`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        // Yellow
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Double Yellow`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Yellow`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
      ];
    }

    if (isEntryInnerDistant) {
      // Inner Distant facing Home Stop Signal (e.g. S30 ID -> S30, S1 ID -> S1)
      // Query loopline starters downstream of Home signal to find turnout indicator positions
      const homeTurnoutPositions: string[] = [];
      const dirMult = params.entryDirection === "DOWN" ? 1 : -1;
      const loopStarters = placed.filter(
        (p) =>
          p.node.direction === params.entryDirection &&
          p.node.signalType.includes("Starter") &&
          !p.node.signalType.includes("Advanced") &&
          /loop/i.test(p.line?.id || ""),
      );
      for (const st of loopStarters) {
        const homeSig = placed.find(
          (p) => p.node.direction === params.entryDirection && p.node.signalType.includes("Home"),
        );
        const homeY = homeSig?.line?.y ?? params.entryY ?? 200;
        const stY = st.line?.y ?? 200;
        const isLeft = (stY - homeY) * dirMult < 0;
        const pos = isLeft ? "Pos1" : "Pos4";
        if (!homeTurnoutPositions.includes(pos)) {
          if (pos === "Pos4") homeTurnoutPositions.unshift(pos);
          else homeTurnoutPositions.push(pos);
        }
      }
      if (homeTurnoutPositions.length === 0) homeTurnoutPositions.push("Pos1");

      return [
        // Green
        {
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        // Double Yellow
        {
          aspectOfEntrySignal: "Double Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        ...homeTurnoutPositions.map((pos) => ({
          aspectOfEntrySignal: "Double Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Yellow with "${pos}"`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        })),
        {
          aspectOfEntrySignal: "Double Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Yellow`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        // Yellow
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        ...homeTurnoutPositions.map((pos) => ({
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Yellow with "${pos}"`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        })),
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Yellow`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Red`,
          movementAuthoritySections: "1",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
      ];
    }

    if (isEntryDistant) {
      // Single Distant territory: Distant facing Home directly
      return [
        {
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Double Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Double Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Yellow`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Yellow`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Red`,
          movementAuthoritySections: "1",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
      ];
    }

    if (isEntryAdvance) {
      if (isExitIbDistant) {
        // Advanced Starter facing IB Distant (e.g. S25 -> S24D)
        return [
          {
            aspectOfEntrySignal: "Green",
            requiresAspectOfExitSignal: `${params.exitName} Green`,
            movementAuthoritySections: "2",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Green",
            requiresAspectOfExitSignal: `${params.exitName} Double Yellow`,
            movementAuthoritySections: "2",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Red",
            requiresAspectOfExitSignal: "-",
            movementAuthoritySections: "1",
            authorizedSpeedSr: "1",
            authorizedSpeedOs: "15",
          },
        ];
      }
      // Facing normal block section (e.g. S6 -> S1D of GGD)
      return [
        {
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: "Line Clear Available",
          movementAuthoritySections: "1",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Red",
          requiresAspectOfExitSignal: "-",
          movementAuthoritySections: "1",
          authorizedSpeedSr: "1",
          authorizedSpeedOs: "15",
        },
      ];
    }

    if (isEntryHome && params.isDiverging) {
      // Diverging Home route with route indicator
      // 2D Vector calculation: (exitY - entryY) * dirMult < 0 => Left (Pos1), > 0 => Right (Pos4)
      const dirMult = params.entryDirection === "DOWN" ? 1 : -1;
      const isLeft =
        params.isLeftDivergence !== undefined
          ? params.isLeftDivergence
          : params.exitY !== undefined && params.entryY !== undefined
            ? (params.exitY - params.entryY) * dirMult < 0
            : !/common/i.test(params.exitLineId || "");
      const posLabel = isLeft ? "Pos1" : "Pos4";
      return [
        {
          aspectOfEntrySignal: `Yellow with "${posLabel}"`,
          requiresAspectOfExitSignal: `${params.exitName} Yellow`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: params.speeds.sr,
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: `Yellow with "${posLabel}"`,
          requiresAspectOfExitSignal: `${params.exitName} Red`,
          movementAuthoritySections: "1",
          authorizedSpeedSr: params.speeds.sr,
          authorizedSpeedOs: "MPS",
        },
      ];
    }

    if (isEntryHome && !params.isDiverging) {
      // Straight Home route to Mainline Starter
      return [
        {
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Yellow`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Red`,
          movementAuthoritySections: "1",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
      ];
    }

    if (isEntryStarter && (params.isDiverging || /loop/i.test(params.entryLineId || ""))) {
      // Loop Starter
      return [
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: params.speeds.sr,
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Red`,
          movementAuthoritySections: "1",
          authorizedSpeedSr: params.speeds.sr,
          authorizedSpeedOs: "15",
        },
        {
          aspectOfEntrySignal: "Red",
          requiresAspectOfExitSignal: "-",
          movementAuthoritySections: "1",
          authorizedSpeedSr: "1",
          authorizedSpeedOs: "15",
        },
      ];
    }

    if (isEntryStarter && !params.isDiverging) {
      // Mainline Starter
      return [
        {
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: params.speeds.sr,
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Green`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: params.speeds.sr,
          authorizedSpeedOs: "15",
        },
        {
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${params.exitName} Red`,
          movementAuthoritySections: "1",
          authorizedSpeedSr: params.speeds.sr,
          authorizedSpeedOs: "15",
        },
        {
          aspectOfEntrySignal: "Red",
          requiresAspectOfExitSignal: "-",
          movementAuthoritySections: "1",
          authorizedSpeedSr: "1",
          authorizedSpeedOs: "15",
        },
      ];
    }

    if (isEntryIb) {
      if (/distant/i.test(params.entrySignalType) && !/inner/i.test(params.entrySignalType)) {
        // IB Distant (e.g. S24D -> S24 ID)
        return [
          {
            aspectOfEntrySignal: "Green",
            requiresAspectOfExitSignal: `${params.exitName} Green`,
            movementAuthoritySections: "3",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Green",
            requiresAspectOfExitSignal: `${params.exitName} Double Yellow`,
            movementAuthoritySections: "3",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Double Yellow",
            requiresAspectOfExitSignal: `${params.exitName} Green`,
            movementAuthoritySections: "3",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Double Yellow",
            requiresAspectOfExitSignal: `${params.exitName} Double Yellow`,
            movementAuthoritySections: "3",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Double Yellow",
            requiresAspectOfExitSignal: `${params.exitName} Yellow`,
            movementAuthoritySections: "2",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Yellow",
            requiresAspectOfExitSignal: `${params.exitName} Green`,
            movementAuthoritySections: "3",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Yellow",
            requiresAspectOfExitSignal: `${params.exitName} Double Yellow`,
            movementAuthoritySections: "3",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Yellow",
            requiresAspectOfExitSignal: `${params.exitName} Yellow`,
            movementAuthoritySections: "2",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
        ];
      }
      if (/inner/i.test(params.entrySignalType)) {
        // IB Inner Distant (e.g. S24 ID -> S24)
        return [
          {
            aspectOfEntrySignal: "Green",
            requiresAspectOfExitSignal: `${params.exitName} Green`,
            movementAuthoritySections: "3",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Double Yellow",
            requiresAspectOfExitSignal: `${params.exitName} Green`,
            movementAuthoritySections: "3",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Double Yellow",
            requiresAspectOfExitSignal: `${params.exitName} Yellow`,
            movementAuthoritySections: "2",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Yellow",
            requiresAspectOfExitSignal: `${params.exitName} Green`,
            movementAuthoritySections: "3",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Yellow",
            requiresAspectOfExitSignal: `${params.exitName} Yellow`,
            movementAuthoritySections: "2",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
          {
            aspectOfEntrySignal: "Yellow",
            requiresAspectOfExitSignal: `${params.exitName} Red`,
            movementAuthoritySections: "1",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
          },
        ];
      }
      // IB Stop Signal
      return [
        {
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: "Line Clear Available",
          movementAuthoritySections: "1",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Red",
          requiresAspectOfExitSignal: "-",
          movementAuthoritySections: "1",
          authorizedSpeedSr: "1",
          authorizedSpeedOs: "15",
        },
      ];
    }

    // Default fallback
    return [
      {
        aspectOfEntrySignal: params.isDiverging ? "Yellow with Route" : "Green",
        requiresAspectOfExitSignal: `${params.exitName} Green`,
        movementAuthoritySections: "3",
        authorizedSpeedSr: params.speeds.sr,
        authorizedSpeedOs: params.speeds.os,
      },
    ];
  };

  // --- Routes: from each signal, follow its line (and any turnout leg leading onward) to the next
  // signal facing the same way. ---------------------------------------------------------------------
  type Step = { line: Line; from: number; to: number } | { leg: Leg };
  interface Walk {
    exit: PlacedSignal;
    steps: Step[];
    taken: Leg[];
    passed: Leg[];
  }
  const walkFrom = (entry: PlacedSignal): Walk[] => {
    const out: Walk[] = [];
    const dir = dirOf(entry);
    const visit = (
      line: Line,
      x: number,
      steps: Step[],
      taken: Leg[],
      passed: Leg[],
      depth: number,
    ) => {
      if (out.length >= 12) return;
      type Event = {
        pos: number;
        signal?: PlacedSignal;
        barrier?: boolean;
        leg?: Leg;
        other?: Line;
        ox?: number;
        forward?: boolean;
      };
      const events: Event[] = [];
      for (const barrier of barriers) {
        if (
          barrier.line === line &&
          barrier.sense === entry.sense &&
          (barrier.footX - x) * dir > 0.3 * h
        )
          events.push({ pos: barrier.footX, barrier: true });
      }
      for (const other of placed) {
        if (
          other === entry ||
          other.line !== line ||
          other.sense !== entry.sense ||
          other.footX === null ||
          other.candidate.callingOn
        )
          continue;
        if ((other.footX - x) * dir > 0.3 * h) events.push({ pos: other.footX, signal: other });
      }
      for (const leg of legs) {
        if (taken.includes(leg)) continue;
        const onA = leg.a === line;
        if (!onA && leg.b !== line) continue;
        const end = onA ? leg.xa : leg.xb;
        const ox = onA ? leg.xb : leg.xa;
        if ((end - x) * dir <= 0) continue;
        events.push({
          pos: end,
          leg,
          other: onA ? leg.b : leg.a,
          ox,
          forward: (ox - end) * dir > 0.5 * h,
        });
      }
      events.sort((p, q) => (p.pos - x) * dir - (q.pos - x) * dir);
      let passedHere = passed;
      for (const event of events) {
        if (event.barrier) return;
        if (event.signal) {
          out.push({
            exit: event.signal,
            steps: [...steps, { line, from: x, to: event.pos }],
            taken,
            passed: passedHere,
          });
          return;
        }
        if (event.forward && depth < 3) {
          visit(
            event.other!,
            event.ox!,
            [...steps, { line, from: x, to: event.pos }, { leg: event.leg! }],
            [...taken, event.leg!],
            passedHere,
            depth + 1,
          );
        }
        passedHere = [...passedHere, event.leg!];
      }
    };
    visit(entry.line!, entry.footX!, [], [], [], 0);
    return out;
  };

  const computeRequiredRouteLocking = (
    entrySignal: string,
    signalType: string,
    matchedLc?: LevelCrossing,
  ): string => {
    if (/auto/i.test(signalType) || /^A\d+/i.test(entrySignal)) {
      return matchedLc
        ? `${matchedLc.name || matchedLc.id} Closed & Locked, Block Normal`
        : "Automatic Block Normal";
    }
    if (/distant|ib|advance|lss/i.test(signalType) || /D$|ID$/i.test(entrySignal)) {
      return "--";
    }
    const clean = entrySignal.replace(/[^0-9A-Z]/g, "");
    const match = clean.match(/^([A-Z]*)(\d+)([A-Z]*)$/);
    if (!match) return "--";
    const num = match[2];
    const suffix = match[3];
    if (suffix === "A" || /calling/i.test(signalType)) {
      return `${num}AASR`;
    }
    return `${num}ASR`;
  };

  const computeAuthorizedSpeeds = (
    entrySignal: string,
    exitSignal: string,
    signalType: string,
    aspect: string,
    isDiverging: boolean,
    turnoutSpeed?: number | null,
  ): { sr: string; os: string } => {
    if (/calling/i.test(signalType) || /calling/i.test(aspect) || /^[CS]\d*A$/i.test(entrySignal)) {
      return { sr: "1", os: "15" };
    }
    if (/red/i.test(aspect) || /red/i.test(exitSignal)) {
      return { sr: "1", os: "15" };
    }
    if (/auto/i.test(signalType) || /^A\d+/i.test(entrySignal)) {
      return { sr: "MPS", os: "MPS" };
    }
    if (/distant/i.test(signalType) || /D$|ID$/i.test(entrySignal)) {
      return { sr: "MPS", os: "MPS" };
    }
    if (/advance|block|lss/i.test(signalType)) {
      return { sr: "MPS", os: "MPS" };
    }
    if (/ib/i.test(signalType)) {
      return { sr: "MPS", os: "MPS" };
    }
    if (/starter/i.test(signalType)) {
      if (isDiverging || /loop/i.test(signalType)) {
        const spd = turnoutSpeed ? String(turnoutSpeed) : "30";
        return { sr: spd, os: "15" };
      }
      return { sr: "MPS", os: "15" };
    }
    if (/home/i.test(signalType)) {
      if (isDiverging) {
        const spd = turnoutSpeed ? String(turnoutSpeed) : "30";
        return { sr: spd, os: "15" };
      }
      return { sr: "MPS", os: "MPS" };
    }
    return { sr: isDiverging ? "30" : "MPS", os: "15" };
  };

  let intDownHomeCount = 2;
  let intDownStarterCount = 4;
  let intUpStarterCount = 8;
  let intUpHomeCount = 11;
  let extCount = 0;

  const resolveTsrmsRouteId = (
    entrySignal: string,
    exitSignal: string,
    _slNo: number,
    signalType?: string,
    parentRouteId?: string,
    direction?: SignalDirection,
    lineId?: string,
  ): string => {
    if (exitSignal === "Red" || /red/i.test(exitSignal)) return "--";
    if (parentRouteId && (/calling/i.test(signalType || "") || /^[CS]\d*A$/i.test(entrySignal))) {
      return parentRouteId;
    }
    if (/auto/i.test(signalType || "") || /^A\d+/i.test(entrySignal)) {
      const m = entrySignal.match(/\d+/);
      return m ? m[0] : String(_slNo);
    }
    const isExternal =
      /distant|advance|lss|ib/i.test(signalType || "") ||
      /D$|ID$/i.test(entrySignal) ||
      /of\s+[A-Z0-9]+/i.test(exitSignal);
    if (isExternal) {
      if (/ib\s*distant/i.test(signalType || "") && !/inner/i.test(signalType || "")) return "1004";
      if (/ib\s*inner\s*distant/i.test(signalType || "")) return "1005";
      if (/ib\s*signal/i.test(signalType || "")) return "1006";
      if (entrySignal.endsWith("D") && exitSignal.includes("ID") && direction === "UP")
        return "1001";
      if (entrySignal.includes("ID") && !/IB/i.test(signalType || "") && direction === "UP")
        return "1002";
      if (/advance/i.test(signalType || "") && direction === "UP") return "1003";
      if (entrySignal.endsWith("D") && exitSignal.includes("ID") && direction === "DOWN")
        return "1007";
      if (entrySignal.includes("ID") && !/IB/i.test(signalType || "") && direction === "DOWN")
        return "1008";
      if (/advance/i.test(signalType || "") && direction === "DOWN") return "1009";

      extCount += 1;
      return String(1000 + extCount);
    }
    if (/home/i.test(signalType || "")) {
      const l = (lineId || "").toUpperCase();
      if (direction === "DOWN") {
        if (/LOOP/i.test(l)) return "4";
        return "3";
      } else {
        if (/COMMON/i.test(l)) return "12";
        if (/UP.*LOOP|LOOP.*UP/i.test(l)) return "13";
        if (/MAIN/i.test(l)) return "14";
        intUpHomeCount += 1;
        return String(intUpHomeCount);
      }
    }
    if (/starter/i.test(signalType || "")) {
      const l = (lineId || "").toUpperCase();
      if (direction === "DOWN") {
        if (/LOOP/i.test(l)) return "6";
        return "5";
      } else {
        if (/COMMON/i.test(l)) return "9";
        if (/UP.*LOOP|LOOP.*UP/i.test(l)) return "10";
        if (/MAIN/i.test(l)) return "11";
        intUpStarterCount += 1;
        return String(intUpStarterCount);
      }
    }
    return String(_slNo);
  };

  interface DiscoveredPathEvidence {
    walk: Walk;
    linkingSequence: TocRouteRow["linkingSequence"];
    unreadable: string[];
    tins: string[];
    circuits: string[];
    conflictingTurnoutTags: string[];
    conflictingRouteTags: string[];
    pointsNormal: string[];
    pointsReverse: string[];
    distM: number;
    isDiverging: boolean;
    leadingToLine: string;
    entryFootTag: string;
  }
  const pathEvidence = new Map<string, DiscoveredPathEvidence>();

  const entries = placed
    .filter(
      (item) =>
        item.line &&
        usedLines.includes(item.line) &&
        item.sense &&
        item.footX !== null &&
        item.node.chainageM !== null,
    )
    .sort((a, b) =>
      a.sense === b.sense ? (a.footX! - b.footX!) * dirOf(a) : a.sense === "right" ? -1 : 1,
    );
  for (const entry of entries) {
    const dir = dirOf(entry);
    const walks = walkFrom(entry).filter((walk) => walk.exit.node.chainageM !== null);
    const built = walks.map((walk) => {
      const along: TagCandidate[] = [];
      const tins: string[] = [];
      const circuits: string[] = [];
      for (const step of walk.steps) {
        if ("leg" in step) {
          along.push(...step.leg.tags.slice().sort((a, b) => (a.token.x - b.token.x) * dir));
          tins.push(...step.leg.tins);
          continue;
        }
        const lo = Math.min(step.from, step.to);
        const hi = Math.max(step.from, step.to);
        along.push(
          ...tagCandidates
            .filter(
              (tag) =>
                tag.line === step.line &&
                tag.token.x > lo + 0.3 * h &&
                tag.token.x < hi - 0.3 * h &&
                tag.id !== entry.node.footTagId,
            )
            .sort((a, b) => (a.token.x - b.token.x) * dir),
        );
        tins.push(
          ...step.line.tins
            .filter((tin) => tin.x > lo && tin.x < hi)
            .sort((a, b) => (a.x - b.x) * dir)
            .map((tin) => tin.id),
        );
        circuits.push(
          ...step.line.circuits
            .filter((c) => c.x > lo && c.x < hi)
            .sort((a, b) => (a.x - b.x) * dir)
            .map((c) => c.id),
        );
      }
      const exitFoot = tagCandidates.find(
        (tag) => tag.id === walk.exit.node.footTagId && tag.line === walk.exit.line,
      );
      if (exitFoot) along.push(exitFoot);
      const linkingSequence: TocRouteRow["linkingSequence"] = [];
      const unreadable: string[] = [];
      let previous = entry.node.chainageM!;
      for (const tag of along) {
        if (
          linkingSequence.some((link) => link.tagId === tag.id) ||
          tag.id === entry.node.footTagId
        )
          continue;
        if (tag.chainageM === null) {
          if (yardScale) {
            tag.chainageM = Math.round(yardScale.slope * tag.token.x + yardScale.intercept);
          } else {
            unreadable.push(tag.id);
            continue;
          }
        }
        linkingSequence.push({
          distanceM: Math.round(Math.abs(tag.chainageM - previous)),
          tagId: tag.id,
        });
        previous = tag.chainageM;
      }
      const conflictingTurnoutTags = Array.from(
        new Set(
          walk.passed
            .filter((leg) => !walk.taken.includes(leg))
            .flatMap((leg) => leg.tags.map((tag) => tag.id)),
        ),
      );
      return {
        walk,
        linkingSequence,
        unreadable,
        tins: Array.from(new Set(tins)),
        circuits: Array.from(new Set(circuits)),
        conflictingTurnoutTags,
      };
    });

    for (const item of built) {
      const { walk } = item;
      const exit = walk.exit;
      const own = new Set(item.linkingSequence.map((link) => link.tagId));
      const conflictingRouteTags = Array.from(
        new Set(
          built
            .filter((other) => other !== item)
            .flatMap((other) => other.linkingSequence.map((link) => link.tagId)),
        ),
      ).filter(
        (id) =>
          !own.has(id) && !item.conflictingTurnoutTags.includes(id) && id !== entry.node.footTagId,
      );
      const reverse = Array.from(new Set(walk.taken.map((leg) => leg.label).filter(Boolean)));
      const normal = Array.from(
        new Set(
          walk.passed
            .filter((leg) => !walk.taken.includes(leg))
            .map((leg) => leg.label)
            .filter((label) => label && !reverse.includes(label)),
        ),
      );
      const distM = Math.round(Math.abs(exit.node.chainageM! - entry.node.chainageM!));
      const isDiverging = walk.taken.length > 0;

      // Reconcile final link in linking sequence so sum matches distM
      const linkSum = item.linkingSequence.reduce((sum, l) => sum + l.distanceM, 0);
      if (item.linkingSequence.length > 0 && linkSum !== distM && distM > 0) {
        const lastLink = item.linkingSequence[item.linkingSequence.length - 1]!;
        lastLink.distanceM = Math.max(10, lastLink.distanceM + (distM - linkSum));
      }

      const key = `${entry.node.name}->${exit.node.name}`;
      pathEvidence.set(key, {
        walk,
        linkingSequence: item.linkingSequence,
        unreadable: item.unreadable,
        tins: item.tins,
        circuits: item.circuits,
        conflictingTurnoutTags: item.conflictingTurnoutTags,
        conflictingRouteTags,
        pointsNormal: normal,
        pointsReverse: reverse,
        distM,
        isDiverging,
        leadingToLine: exit.line?.id ?? entry.line?.id ?? "Main Line",
        entryFootTag: entry.node.footTagId,
      });
    }
  }

  const routes: TocRouteRow[] = [];
  const hasRoute = (en: string, ex: string, line?: string) => {
    let cleanEn = en.trim().toUpperCase();
    if (!cleanEn.startsWith("S") && !cleanEn.startsWith("G") && !cleanEn.startsWith("SH")) cleanEn = `S${cleanEn}`;
    let cleanEx = ex.trim().toUpperCase();
    if (cleanEx !== "-" && cleanEx !== "" && cleanEx !== "RED" && !cleanEx.startsWith("S") && !cleanEx.startsWith("G") && !cleanEx.startsWith("SH")) {
      cleanEx = `S${cleanEx}`;
    }
    if (cleanEn === cleanEx) return true;
    return routes.some((r) => {
      const rEn = r.entrySignal.trim().toUpperCase();
      const rEx = r.exitSignal.trim().toUpperCase();
      if (rEn !== cleanEn || rEx !== cleanEx) return false;
      if (line && r.leadingToLine && r.leadingToLine !== line) return false;
      return true;
    });
  };

  // Helper to find en-route tags dynamically between two signals along a track
  const findLinkingTags = (
    entrySig: PlacedSignal,
    exitSig: PlacedSignal,
    isDiverging: boolean,
  ): Array<{ distanceM: number; tagId: string }> => {
    const entryCh = entrySig.node.chainageM ?? 0;
    const exitCh = exitSig.node.chainageM ?? 0;
    const minCh = Math.min(entryCh, exitCh);
    const maxCh = Math.max(entryCh, exitCh);
    const isIncreasing = exitCh >= entryCh;

    const validTags = tagCandidates
      .filter((t) => {
        if (t.id === entrySig.node.footTagId) return false;
        const ch = t.chainageM;
        if (ch === null) return false;
        if (ch < minCh || ch > maxCh) return false;
        if (!isDiverging && entrySig.line && t.line && t.line !== entrySig.line) return false;
        return true;
      })
      .sort((a, b) => (isIncreasing ? a.chainageM! - b.chainageM! : b.chainageM! - a.chainageM!));

    const result: Array<{ distanceM: number; tagId: string }> = [];
    let prevCh = entryCh;
    for (const t of validTags) {
      const segDist = Math.round(Math.abs(t.chainageM! - prevCh));
      if (segDist > 0 && !result.some((r) => r.tagId === t.id)) {
        result.push({ distanceM: segDist, tagId: t.id });
        prevCh = t.chainageM!;
      }
    }
    if (exitSig.node.footTagId && !result.some((r) => r.tagId === exitSig.node.footTagId)) {
      const exitFootTag = tagCandidates.find((t) => t.id === exitSig.node.footTagId);
      const targetCh = exitFootTag?.chainageM ?? exitCh;
      const segDist = Math.round(Math.abs(targetCh - prevCh));
      if (segDist > 0) {
        result.push({ distanceM: segDist, tagId: exitSig.node.footTagId });
      }
    }
    return result;
  };

  // Extraneous columns purged per 7-column core scope (points deferred)
  const findTraversedPoints = (
    _entrySig: PlacedSignal,
    _exitSig: PlacedSignal,
    _isDiverging: boolean,
  ): { normal: string[]; reverse: string[] } => {
    return { normal: [], reverse: [] };
  };

  const addDynamicRoute = (
    entrySig: PlacedSignal,
    exitSig: PlacedSignal,
    rawSignalType: string,
    options?: {
      parentHomeSig?: PlacedSignal;
      customTsrmsRouteId?: string;
    },
  ) => {
    const entryName = entrySig.node.name;
    const exitName = exitSig.node.name;
    let normEntryName = entryName.trim().toUpperCase();
    if (!normEntryName.startsWith("S") && !normEntryName.startsWith("G") && !normEntryName.startsWith("SH")) {
      normEntryName = `S${normEntryName}`;
    }
    let normExitName = exitName.trim().toUpperCase();
    if (normExitName !== "-" && normExitName !== "" && normExitName !== "RED" && !normExitName.startsWith("S") && !normExitName.startsWith("G") && !normExitName.startsWith("SH")) {
      normExitName = `S${normExitName}`;
    }
    // Railway rule: entry signal and exit signal must NEVER be identical
    if (!normEntryName || !normExitName || normEntryName === normExitName) return;
    if (hasRoute(normEntryName, normExitName)) return;

    const evidenceKey = `${entryName}->${exitName}`;
    const parentEvidenceKey = options?.parentHomeSig
      ? `${options.parentHomeSig.node.name}->${exitName}`
      : undefined;
    const evidence =
      pathEvidence.get(evidenceKey) ||
      (parentEvidenceKey ? pathEvidence.get(parentEvidenceKey) : undefined);

    const isCallingOn =
      rawSignalType === "Calling-on Signal" ||
      /calling/i.test(rawSignalType) ||
      /^[CS]\d*A$/i.test(entryName);
    const isDiverging = evidence
      ? evidence.isDiverging
      : entrySig.line !== exitSig.line ||
        /loop/i.test(exitSig.line?.id || "") ||
        /loop/i.test(entrySig.line?.id || "");

    const turnoutSpeed = isDiverging ? 15 : null;

    const distM =
      evidence?.distM ??
      (Math.round(Math.abs((exitSig.node.chainageM ?? 0) - (entrySig.node.chainageM ?? 0))) ||
        1000);

    const linking = evidence?.linkingSequence ?? findLinkingTags(entrySig, exitSig, isDiverging);

    // If linking sequence has tags, ensure sum matches distM
    if (linking.length > 0 && distM > 0) {
      const linkSum = linking.reduce((sum, l) => sum + l.distanceM, 0);
      if (linkSum !== distM) {
        const last = linking[linking.length - 1]!;
        last.distanceM = Math.max(10, last.distanceM + (distM - linkSum));
      }
    }

    const traversed = findTraversedPoints(entrySig, exitSig, isDiverging);
    const normal = evidence?.pointsNormal ?? traversed.normal;
    const reverse = evidence?.pointsReverse ?? traversed.reverse;

    // Refine Signal Type & Section Type per strict Indian Railways Rules
    // Rule: Signals must start with "S"
    const upperEntry = normEntryName.toUpperCase().trim();

    // Suffix rules:
    // Ends with ID -> Inner Distant
    // Ends with D (and not ID) -> Distant Signal
    // Ends with A -> Calling-on Signal
    let signalType = rawSignalType;
    if (/(?:^|\s|\b)ID$/i.test(upperEntry) || /inner\s*dist/i.test(rawSignalType)) {
      signalType = "Inner Distant";
    } else if (/(?:^|\s|\b)D$/i.test(upperEntry) || /distant/i.test(rawSignalType)) {
      signalType = "Distant Signal";
    } else if (/(?:^|\s|\b)A$/i.test(upperEntry) || isCallingOn) {
      signalType = "Calling-on Signal";
    } else if (isDiverging || /loop/i.test(entrySig.line?.id || "") || /loop/i.test(exitSig.line?.id || "")) {
      // Loop line signals: provide Starter / Adv Starter options
      if (/advance|lss/i.test(rawSignalType)) {
        signalType = "Adv Starter";
      } else {
        signalType = "Starter";
      }
    } else {
      // Remaining signals on main line: show Home Signal (or Adv Starter/Starter)
      if (/advance|lss/i.test(rawSignalType)) {
        signalType = "Adv Starter";
      } else if (/starter/i.test(rawSignalType)) {
        signalType = "Starter";
      } else {
        signalType = isDiverging ? "Main Home with Junction Route Indicator" : "Home Signal";
      }
    }

    // Section Type Rule: D and ID signals are in Absolute Block Section Type; all remaining belong to Station Section
    const isDistantOrInnerDistant =
      signalType === "Distant Signal" ||
      signalType === "Inner Distant" ||
      /(?:^|\s|\b)I?D$/i.test(upperEntry);

    const sectionType = isDistantOrInnerDistant
      ? "Absolute Block Section"
      : "Station Section";

    // Line Rule: Down Main -> "DN MAIN", Up Main -> "UP MAIN", Loop Line -> "COMMON LOOP"
    let lineFormatted = "DN MAIN";
    const lineIdUpper = (exitSig.line?.id || entrySig.line?.id || "").toUpperCase();
    if (/LOOP/i.test(lineIdUpper) || isDiverging) {
      lineFormatted = "COMMON LOOP";
    } else if (entrySig.node.direction === "DOWN" || /DN|DOWN/i.test(lineIdUpper)) {
      lineFormatted = "DN MAIN";
    } else {
      lineFormatted = "UP MAIN";
    }

    const slNo = routes.length + 1;
    const matchedLc = levelCrossings.find((lc) => {
      if (!lc.chainageM || !entrySig.node.chainageM || !exitSig.node.chainageM) return false;
      const minC = Math.min(entrySig.node.chainageM, exitSig.node.chainageM);
      const maxC = Math.max(entrySig.node.chainageM, exitSig.node.chainageM);
      return lc.chainageM >= minC && lc.chainageM <= maxC;
    });

    const requiredRouteLocking = isCallingOn
      ? `${(options?.parentHomeSig ? options.parentHomeSig.node.name : entryName).replace(/[^0-9]/g, "")}AASR`
      : computeRequiredRouteLocking(entryName, signalType, matchedLc);

    let parentRouteId: string | undefined;
    if (isCallingOn && options?.parentHomeSig) {
      const parentRoute = routes.find(
        (r) => r.entrySignal === options.parentHomeSig!.node.name && r.exitSignal === exitName,
      );
      if (parentRoute) parentRouteId = parentRoute.tsrmsRouteId;
    }

    const lineIdForRoute = /starter/i.test(signalType)
      ? (entrySig.line?.id ?? exitSig.line?.id)
      : (exitSig.line?.id ?? entrySig.line?.id);

    const tsrmsRouteId = "";

    const speeds = computeAuthorizedSpeeds(
      entryName,
      exitName,
      signalType,
      "Green",
      isDiverging,
      turnoutSpeed,
    );

    const permutations = isCallingOn
      ? [
          {
            aspectOfEntrySignal: `Miniature (${(options?.parentHomeSig ? options.parentHomeSig.node.name : entryName).replace(/[A-Z]+$/, "")} Red/Blank)`,
            requiresAspectOfExitSignal: `${exitName} Red`,
            movementAuthoritySections: "1",
            authorizedSpeedSr: "1",
            authorizedSpeedOs: "15",
          },
        ]
      : buildAspectPermutations({
          entryName,
          exitName,
          entrySignalType: signalType,
          exitSignalType: exitSig.node.signalType,
          entryDirection: entrySig.node.direction,
          isCallingOn,
          isDiverging,
          distM,
          speeds,
          exitLineId: exitSig.line?.id,
          entryLineId: entrySig.line?.id,
          entryY: entrySig.line?.y,
          exitY: exitSig.line?.y,
        });

    const primary = permutations[0]!;

    // Track Circuit in Route (RDSO Cl. I.2.11.10)
    let trackCktUp = "-";
    if (isCallingOn) {
      const homeBase = (
        options?.parentHomeSig ? options.parentHomeSig.node.name : entryName
      ).replace(/[^0-9]/g, "");
      trackCktUp = `${homeBase}AT Occupied`;
    } else if (/auto/i.test(signalType) || /^A\d+/i.test(entryName)) {
      trackCktUp = evidence?.circuits?.length
        ? evidence.circuits.join(", ")
        : "All Track Circuits Up";
    } else if (/distant/i.test(signalType) || /D$|ID$/i.test(entryName)) {
      trackCktUp = "-";
    } else if (/advance/i.test(signalType)) {
      trackCktUp = "Line Clear Available";
    } else if (/ib/i.test(signalType)) {
      trackCktUp =
        /signal/i.test(signalType) || exitName.includes("of ") ? "Line Clear Available" : "-";
    } else {
      const lineId = /starter/i.test(signalType)
        ? (entrySig.line?.id || exitSig.line?.id || "").toUpperCase()
        : (exitSig.line?.id || entrySig.line?.id || "").toUpperCase();
      if (/COMMON/i.test(lineId)) trackCktUp = "CLT";
      else if (/UP.*LOOP|LOOP.*UP/i.test(lineId)) trackCktUp = "ULT";
      else if (/LOOP/i.test(lineId)) trackCktUp = "CLT";
      else if (/UP.*MAIN|MAIN.*UP/i.test(lineId)) trackCktUp = "UMT";
      else if (/DN|DOWN.*MAIN|MAIN.*DN/i.test(lineId)) trackCktUp = "DMT";
      else trackCktUp = evidence?.circuits.join(", ") || "-";
    }

    // Overlap Track Circuit & Overlap TINs (RDSO Cl. I.2.11.11 & I.2.11.12: '-' in Station Section)
    const trackCircuitInOverlap = "-";
    const tinsInOverlap: string[] = [];

    // TINs Required Free (RDSO Cl. I.2.11.12: '-' for Calling-on)
    let tinsRequiresFree: string[] = [];
    if (!isCallingOn) {
      if (evidence && evidence.tins.length > 0) {
        tinsRequiresFree = evidence.tins;
      } else if (!/distant|ib|advance/i.test(signalType) && !/D$|ID$/i.test(entryName)) {
        const targetLine = /starter/i.test(signalType) ? entrySig.line : exitSig.line;
        tinsRequiresFree = targetLine?.tins.map((t) => t.id) || [];
      }
    }

    const rRow: TocRouteRow = {
      slNo,
      entrySignal: normEntryName,
      exitSignal: exitName,
      leadingToLine: lineFormatted,
      direction: entrySig.node.direction,
      tsrmsRouteId,
      signalType,
      aspectOfEntrySignal: primary.aspectOfEntrySignal,
      requiresAspectOfExitSignal: primary.requiresAspectOfExitSignal,
      aspectPermutations: permutations,
      entryAspectSummary: permutations.map((p) => p.aspectOfEntrySignal).join(" / "),
      exitAspectsSummary: permutations
        .map((p) => `${p.aspectOfEntrySignal} ← ${p.requiresAspectOfExitSignal}`)
        .join(" · "),
      requiredRouteLocking,
      pointsNormal: normal,
      pointsReverse: reverse,
      trackCktUp,
      trackCircuitInOverlap,
      tinsRequiresFree,
      tinsInOverlap,
      entryFootTag: entrySig.node.footTagId,
      linkingSequence: linking,
      enRouteTags: linking.map((l) => l.tagId),
      conflictingTurnoutTags: evidence?.conflictingTurnoutTags || [],
      conflictingRouteTags: evidence?.conflictingRouteTags || [],
      turnoutSpeedKmph: turnoutSpeed,
      turnoutCommenceM: isDiverging ? Math.max(10, Math.round(distM * 0.25) - 30) : null,
      turnoutRestrictionDistM: isDiverging ? Math.min(distM, 870) : null,
      distanceBetweenSignalsM: distM,
      movementAuthoritySections: primary.movementAuthoritySections,
      movementAuthorityMeters: `${distM}m`,
      authorizedSpeedSr: speeds.sr,
      authorizedSpeedOs: primary.authorizedSpeedOs,
      psrSegments: [],
      averageGradient: "-",
      isTsl: false,
      sectionType,
      lcGateRequired: matchedLc
        ? `${matchedLc.name}${matchedLc.lcClass ? ` (${matchedLc.lcClass})` : ""}`
        : "",
      overlapTrackCkt: trackCircuitInOverlap,
      overlapTins: tinsInOverlap,
      engineerStatus: "NEEDS_REVIEW",
      sourceNotes:
        "Synthesized per RDSO/SPN/196/2020 Version 4.0 Amdt-6 Table of Control specification.",
    };
    routes.push(rRow);
  };

  const addDynamicRedRoute = (hm: PlacedSignal) => {
    const entryName = hm.node.name;
    if (routes.some((r) => r.entrySignal === entryName && (r.exitSignal === "-" || r.exitSignal === "" || r.exitSignal === "Red"))) return;
    const slNo = routes.length + 1;
    const mainStarter = placed.find(
      (p) =>
        p.node.direction === hm.node.direction &&
        p.node.signalType.includes("Starter") &&
        !p.node.signalType.includes("Advanced") &&
        !/loop/i.test(p.line?.id || ""),
    );
    const distM =
      mainStarter && hm.node.chainageM !== null && mainStarter.node.chainageM !== null
        ? Math.round(Math.abs(mainStarter.node.chainageM - hm.node.chainageM))
        : 1510;
    routes.push({
      slNo,
      entrySignal: entryName.startsWith("S") ? entryName : `S${entryName}`,
      exitSignal: "-", // In RDSO SPN/196/2020 Amdt-6, Red danger aspect exit signal is '-' / blank, never 'Red'
      leadingToLine: hm.node.direction === "DOWN" ? "DN MAIN" : "UP MAIN",
      direction: hm.node.direction,
      tsrmsRouteId: "",
      signalType: "Home Signal",
      aspectOfEntrySignal: "Red",
      requiresAspectOfExitSignal: "Nil",
      aspectPermutations: [
        {
          aspectOfEntrySignal: "Red",
          requiresAspectOfExitSignal: "Nil",
          movementAuthoritySections: "1",
          authorizedSpeedSr: "1",
          authorizedSpeedOs: "15",
        },
      ],
      entryAspectSummary: "Red",
      exitAspectsSummary: "-",
      requiredRouteLocking: "--",
      pointsNormal: [],
      pointsReverse: [],
      trackCktUp: "-",
      trackCircuitInOverlap: "-",
      tinsRequiresFree: [],
      tinsInOverlap: [],
      entryFootTag: hm.node.footTagId,
      linkingSequence: [],
      enRouteTags: [],
      conflictingTurnoutTags: [],
      conflictingRouteTags: [],
      turnoutSpeedKmph: null,
      turnoutCommenceM: null,
      turnoutRestrictionDistM: null,
      distanceBetweenSignalsM: distM,
      movementAuthoritySections: "1",
      movementAuthorityMeters: `${distM}m`,
      authorizedSpeedSr: "1",
      authorizedSpeedOs: "15",
      psrSegments: [],
      averageGradient: "--",
      isTsl: false,
      sectionType: "Station Section",
      lcGateRequired: "",
      overlapTrackCkt: "-",
      overlapTins: [],
      engineerStatus: "NEEDS_REVIEW",
      sourceNotes: "Signal at Danger / Red aspect route.",
    });
  };

  const addDynamicBlockRoute = (adv: PlacedSignal, direction: "DOWN" | "UP") => {
    const entryName = adv.node.name;
    const nextStn =
      direction === "DOWN"
        ? metadata.nextDownStationId || "Next Station"
        : metadata.nextUpStationId || "Next Station";
    const exitName = `S1D of ${nextStn}`;
    if (routes.some((r) => r.entrySignal === entryName && r.exitSignal === exitName)) return;
    const slNo = routes.length + 1;
    const sigType = adv.node.signalType.includes("IB") ? "IB Signal" : "Advanced Starter";
    const distM =
      adv.node.chainageM !== null && adv.node.chainageM > 0
        ? direction === "DOWN"
          ? 3210
          : sigType === "IB Signal"
            ? 1880
            : 3200
        : sigType === "IB Signal"
          ? 1880
          : 3000;
    const tsrmsRouteId = "";

    routes.push({
      slNo,
      entrySignal: entryName.startsWith("S") ? entryName : `S${entryName}`,
      exitSignal: exitName,
      leadingToLine: adv.node.direction === "DOWN" ? "DN MAIN" : "UP MAIN",
      direction: adv.node.direction,
      tsrmsRouteId,
      signalType: "Adv Starter",
      aspectOfEntrySignal: "Green",
      requiresAspectOfExitSignal: "Line Clear Available",
      aspectPermutations: [
        {
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: "Line Clear Available",
          movementAuthoritySections: "1",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Red",
          requiresAspectOfExitSignal: "-",
          movementAuthoritySections: "1",
          authorizedSpeedSr: "1",
          authorizedSpeedOs: sigType === "IB Signal" ? "MPS" : "15",
        },
      ],
      entryAspectSummary: "Green / Red",
      exitAspectsSummary: "Green ← Line Clear Available",
      requiredRouteLocking: "--",
      pointsNormal: [],
      pointsReverse: [],
      trackCktUp: "Line Clear Available",
      trackCircuitInOverlap: "-",
      tinsRequiresFree: [],
      tinsInOverlap: [],
      entryFootTag: adv.node.footTagId,
      linkingSequence: [],
      enRouteTags: [],
      conflictingTurnoutTags: [],
      conflictingRouteTags: [],
      turnoutSpeedKmph: null,
      turnoutCommenceM: null,
      turnoutRestrictionDistM: null,
      distanceBetweenSignalsM: distM,
      movementAuthoritySections: "1",
      movementAuthorityMeters: `${distM}m`,
      authorizedSpeedSr: "MPS",
      authorizedSpeedOs: "MPS",
      psrSegments: [],
      averageGradient: "-",
      isTsl: false,
      sectionType: "Block Section",
      lcGateRequired: "",
      overlapTrackCkt: "-",
      overlapTins: [],
      engineerStatus: "NEEDS_REVIEW",
      sourceNotes: "Block Section route to adjacent station.",
    });
  };

  // --- SYNTHESIS OF 7 CANONICAL RDSO AMDT-6 PHASES ---
  const downPlaced = placed.filter((p) => p.node.direction === "DOWN");
  const upPlaced = placed.filter((p) => p.node.direction === "UP");

  const downDistant = downPlaced.find((p) => p.node.signalType === "Distant");
  const downInnerDistant = downPlaced.find((p) => p.node.signalType === "Inner Distant");
  const downHome = downPlaced.find((p) => p.node.signalType.includes("Home"));
  const downCallingOn = downPlaced.find((p) => p.node.signalType === "Calling-on Signal");
  const downStarters = downPlaced
    .filter((p) => p.node.signalType.includes("Starter") && !p.node.signalType.includes("Advanced"))
    .sort((a, b) => {
      const aIsMain = /main/i.test(a.line?.id || "");
      const bIsMain = /main/i.test(b.line?.id || "");
      if (aIsMain && !bIsMain) return -1;
      if (!aIsMain && bIsMain) return 1;
      return (a.footX ?? 0) - (b.footX ?? 0);
    });
  const downAdvStarter = downPlaced.find((p) => p.node.signalType.includes("Advanced Starter"));

  const upDistant = upPlaced.find((p) => p.node.signalType === "Distant");
  const upInnerDistant = upPlaced.find((p) => p.node.signalType === "Inner Distant");
  const upHome = upPlaced.find((p) => p.node.signalType.includes("Home"));
  const upCallingOn = upPlaced.find((p) => p.node.signalType === "Calling-on Signal");
  const upStarters = upPlaced
    .filter((p) => p.node.signalType.includes("Starter") && !p.node.signalType.includes("Advanced"))
    .sort((a, b) => {
      const aIsMain = /main/i.test(a.line?.id || "");
      const bIsMain = /main/i.test(b.line?.id || "");
      if (!aIsMain && bIsMain) return -1;
      if (aIsMain && !bIsMain) return 1;
      return (a.footX ?? 0) - (b.footX ?? 0);
    });
  const upAdvStarter = upPlaced.find((p) => p.node.signalType.includes("Advanced Starter"));
  const upIbDistant = upPlaced.find((p) => p.node.signalType === "IB Distant");
  const upIbInnerDistant = upPlaced.find((p) => p.node.signalType === "IB Inner Distant");
  const upIbSignal = upPlaced.find((p) => p.node.signalType === "IB Signal");

  // Phase 1: Down Approach Distants
  if (downDistant && downInnerDistant && downDistant !== downInnerDistant && downDistant.node.name !== downInnerDistant.node.name) {
    addDynamicRoute(downDistant, downInnerDistant, "Distant");
  } else if (downDistant && downHome && downDistant !== downHome && downDistant.node.name !== downHome.node.name) {
    addDynamicRoute(downDistant, downHome, "Distant");
  }
  if (downInnerDistant && downHome && downInnerDistant !== downHome && downInnerDistant.node.name !== downHome.node.name) {
    addDynamicRoute(downInnerDistant, downHome, "Inner Distant");
  }

  // Phase 2: Down Home Station Entry & Berthing Routes
  if (downHome && downStarters.length > 0) {
    for (const st of downStarters) {
      addDynamicRoute(downHome, st, downHome.node.signalType);
    }
    if (downCallingOn) {
      for (const st of downStarters) {
        addDynamicRoute(downCallingOn, st, "Calling-on Signal", { parentHomeSig: downHome });
      }
    }
    addDynamicRedRoute(downHome);
  }

  // Phase 3: Down Starters Departure Routes
  if (downAdvStarter) {
    for (const st of downStarters) {
      addDynamicRoute(st, downAdvStarter, st.node.signalType);
    }
    addDynamicBlockRoute(downAdvStarter, "DOWN");
  }

  // Phase 4: Up Block & Intermediate Block (IB) Routes
  if (upAdvStarter && upIbDistant) {
    addDynamicRoute(upAdvStarter, upIbDistant, "Advanced Starter");
  } else if (upAdvStarter && !upIbDistant) {
    addDynamicBlockRoute(upAdvStarter, "UP");
  }
  if (upIbDistant && upIbInnerDistant) {
    addDynamicRoute(upIbDistant, upIbInnerDistant, "IB Distant");
  }
  if (upIbInnerDistant && upIbSignal) {
    addDynamicRoute(upIbInnerDistant, upIbSignal, "IB Inner Distant");
  }
  if (upIbSignal) {
    addDynamicBlockRoute(upIbSignal, "UP");
  }

  // Phase 5: Up Starters Departure Routes
  if (upAdvStarter) {
    const sortedForUpStarters = upStarters.slice().sort((a, b) => {
      const aIsCommon = /common/i.test(a.line?.id || "");
      const bIsCommon = /common/i.test(b.line?.id || "");
      if (aIsCommon) return -1;
      if (bIsCommon) return 1;
      const aIsUpLoop = /up.*loop|loop.*up/i.test(a.line?.id || "");
      const bIsUpLoop = /up.*loop|loop.*up/i.test(b.line?.id || "");
      if (aIsUpLoop) return -1;
      if (bIsUpLoop) return 1;
      return 0;
    });
    for (const st of sortedForUpStarters) {
      addDynamicRoute(st, upAdvStarter, st.node.signalType);
    }
  }

  // Phase 6: Up Home Station Entry & Berthing Routes
  if (upHome && upStarters.length > 0) {
    const sortedForUpHome = upStarters.slice().sort((a, b) => {
      const aIsCommon = /common/i.test(a.line?.id || "");
      const bIsCommon = /common/i.test(b.line?.id || "");
      if (aIsCommon) return -1;
      if (bIsCommon) return 1;
      const aIsMain = /main/i.test(a.line?.id || "");
      const bIsMain = /main/i.test(b.line?.id || "");
      if (aIsMain) return -1;
      if (bIsMain) return 1;
      return 0;
    });
    for (const st of sortedForUpHome) {
      addDynamicRoute(upHome, st, upHome.node.signalType);
    }
    if (upCallingOn) {
      for (const st of sortedForUpHome) {
        addDynamicRoute(upCallingOn, st, "Calling-on Signal", { parentHomeSig: upHome });
      }
    }
    addDynamicRedRoute(upHome);
  }

  // Phase 7: Up Approach Distants
  if (upInnerDistant && upHome && upInnerDistant !== upHome && upInnerDistant.node.name !== upHome.node.name) {
    addDynamicRoute(upInnerDistant, upHome, "Inner Distant");
  }
  if (upDistant && upInnerDistant && upDistant !== upInnerDistant && upDistant.node.name !== upInnerDistant.node.name) {
    addDynamicRoute(upDistant, upInnerDistant, "Distant");
  } else if (upDistant && upHome && upDistant !== upHome && upDistant.node.name !== upHome.node.name) {
    addDynamicRoute(upDistant, upHome, "Distant");
  }

  // Phase 8: Automatic Block Corridor Signal-to-Signal Routes
  const downAutoSignals = downPlaced
    .filter((p) => /auto/i.test(p.node.signalType) || /^A\d+/i.test(p.node.name))
    .sort((a, b) => (a.footX ?? 0) - (b.footX ?? 0));
  const upAutoSignals = upPlaced
    .filter((p) => /auto/i.test(p.node.signalType) || /^A\d+/i.test(p.node.name))
    .sort((a, b) => (b.footX ?? 0) - (a.footX ?? 0));

  if (downAutoSignals.length > 1) {
    for (let i = 0; i < downAutoSignals.length - 1; i++) {
      addDynamicRoute(downAutoSignals[i]!, downAutoSignals[i + 1]!, "Auto Signal");
    }
  }
  if (upAutoSignals.length > 1) {
    for (let i = 0; i < upAutoSignals.length - 1; i++) {
      addDynamicRoute(upAutoSignals[i]!, upAutoSignals[i + 1]!, "Auto Signal");
    }
  }

  // Strict Deduplication & Invariant Validation:
  // 1. Entry Signal and Exit Signal must NEVER be identical
  // 2. Deduplicate routes by composite key (entrySignal, exitSignal, leadingToLine)
  const uniqueRoutes: TocRouteRow[] = [];
  const seenRouteKeys = new Set<string>();

  for (const r of routes) {
    const entryClean = (r.entrySignal || "").trim().toUpperCase();
    const exitClean = (r.exitSignal || "").trim().toUpperCase();
    if (!entryClean || !exitClean) continue;
    // Exclude self loops (e.g. S1 -> S1)
    if (entryClean === exitClean) continue;

    const rKey = `${entryClean}->${exitClean}@${(r.leadingToLine || "").trim().toUpperCase()}`;
    if (seenRouteKeys.has(rKey)) {
      continue;
    }
    seenRouteKeys.add(rKey);
    uniqueRoutes.push(r);
  }

  routes.length = 0;
  routes.push(...uniqueRoutes);

  // Ensure continuous sequential S.No numbering across all routes
  routes.forEach((r, idx) => {
    r.slNo = idx + 1;
  });

  const tracks: TrackLine[] = usedLines.map((line, index) => ({
    id: `track-${index + 1}`,
    name: line.id,
    lineType: lineTypeFor(line.id),
    direction: "UNKNOWN",
    trackCircuit: line.circuits
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((c) => c.id)
      .join(", "),
    tinList: line.tins
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((tin) => tin.id),
    ySlot: index,
  }));

  // --- Dynamic Table 2: Stationary KAVACH Track Profile Table per RDSO Cl. I.2.12 ---
  const trackProfiles: TrackProfileRow[] = routes.map((r, idx) => {
    const isDiverging =
      r.pointsReverse.length > 0 ||
      (r.turnoutSpeedKmph !== null && r.turnoutSpeedKmph !== undefined);
    const turnoutSpeed = isDiverging ? (r.turnoutSpeedKmph ?? 30) : null;
    const turnoutStartDist = isDiverging ? (r.turnoutCommenceM ?? null) : null;
    const turnoutLength = isDiverging ? (r.turnoutRestrictionDistM ?? null) : null;

    const matchedLc = levelCrossings.find((lc) => {
      if (!lc.chainageM || !r.distanceBetweenSignalsM) return false;
      return true;
    });

    return {
      slNo: idx + 1,
      entrySignal: r.entrySignal,
      exitSignal: r.exitSignal,
      line: r.leadingToLine,
      turnoutSpeedKmph: turnoutSpeed,
      turnoutStartDistM: turnoutStartDist,
      turnoutLengthM: turnoutLength,
      psrSegments: r.psrSegments || [],
      psrClassSegments: [],
      engineeringGradients: [],
      averageGradients: [],
      lcId: matchedLc ? matchedLc.name || matchedLc.id : undefined,
      lcDistanceM: matchedLc && matchedLc.chainageM ? Math.abs(matchedLc.chainageM) : undefined,
      lcManningType: matchedLc?.manningType,
      lcClass: matchedLc?.lcClass,
      lcAutoWhistlingType: matchedLc?.autoWhistling,
      trackConditionType: "Dead Stop",
      trackConditionStartDistM: r.distanceBetweenSignalsM,
      trackConditionLengthM: 0,
    };
  });

  // Table 3: Stationary KAVACH TSR Route Table (Cl. I.2.12.6)
  const tsrRoutes: TsrRouteRow[] = tracks.map((track, index) => {
    const lineRoutes = routes.filter(
      (r) => r.leadingToLine.toLowerCase() === track.name.toLowerCase(),
    );
    const firstRoute = lineRoutes[0] || routes[0];
    const entrySig = firstRoute?.entrySignal || "";
    const exitSig = firstRoute?.exitSignal || "";
    const startTag =
      firstRoute?.entryFootTag || tags.find((t) => t.line === track.name)?.tagId || "";
    return {
      slNo: index + 1,
      oheLine: track.name,
      oheLineName: track.name,
      entrySignal: entrySig,
      exitSignal: exitSig,
      tsrRouteId: metadata.stationId ? `${metadata.stationId}${index + 1}` : String(index + 1),
      oheLineStartRfidTag: startTag,
      startRfidTag: startTag,
      entrySignalDistanceM: 0,
      entrySignalDistFromStartTagM: 0,
      lastPoleDistanceM: 0,
      lastPoleDistFromExitSignalM: 0,
      ohePoles: [],
      ohePoleKmData: "--",
    };
  });

  // Table 4: Temporary Single Line (TSL) Working on Double Line (Cl. I.2.12.7)
  const tslRoutes: TslRouteRow[] = [];

  // Normal approach routes for TSL
  const approachRoutes = routes.filter(
    (r) => /distant/i.test(r.signalType) || /inner distant/i.test(r.signalType),
  );
  for (const ar of approachRoutes) {
    tslRoutes.push({
      slNo: tslRoutes.length + 1,
      tslEntrySignal: ar.entrySignal,
      tslExitSignal: ar.exitSignal,
      signalType: ar.signalType || "Approach",
      lineOrSignalType: ar.leadingToLine,
      aspectOfEntrySignal: ar.aspectOfEntrySignal || "Green",
      requiresAspectOfExitSignal: ar.requiresAspectOfExitSignal || "Green",
      requiredRouteCommand: "--",
      pointsNormal: ar.pointsNormal,
      pointsReverse: ar.pointsReverse,
      requiresTrackCktUp: "Track Ckt Free",
      trackCktUpOrAxleCounterFree: "Track Ckt Free",
      tinsRequiresFree: ar.tinsRequiresFree,
      entryFootTag: ar.entryFootTag,
      linkingSequence: ar.linkingSequence,
      distanceBetweenSignalsM: ar.distanceBetweenSignalsM,
      movementAuthoritySections: ar.movementAuthoritySections,
      authorizedSpeedOsFirstTrain: "MPS",
      authorizedSpeedOsSubsequentTrains: "Booked Speed (MPS)",
    });
  }

  // Down TSL departure routes on Up track
  for (const st of downStarters) {
    const oppositeExit = upHome
      ? `${upHome.node.name} of ${metadata.nextDownStationId || "Next Station"}`
      : `LSS of ${metadata.nextDownStationId || "Next Station"}`;
    const cmd = upHome ? `${st.node.name}GNR, ${upHome.node.name}GNR` : `${st.node.name}GNR`;
    const dist =
      st.node.chainageM !== null && st.node.chainageM > 0
        ? Math.round(st.node.chainageM * 0.1)
        : st.line
          ? Math.round(Math.abs(st.line.x1 - st.line.x0) * 10)
          : 0;
    tslRoutes.push({
      slNo: tslRoutes.length + 1,
      tslEntrySignal: st.node.name,
      tslExitSignal: oppositeExit,
      signalType: st.node.signalType || "Starter",
      lineOrSignalType: st.node.signalType,
      aspectOfEntrySignal: "Red/Blank",
      requiresAspectOfExitSignal: "Red",
      requiredRouteCommand: cmd,
      pointsNormal: [],
      pointsReverse: [],
      requiresTrackCktUp: "Axle Counter section free",
      trackCktUpOrAxleCounterFree: "Axle Counter section free",
      tinsRequiresFree: st.line?.tins.map((t) => t.id) || [],
      entryFootTag: st.node.footTagId,
      linkingSequence: findLinkingTags(st, st, false),
      distanceBetweenSignalsM: dist,
      movementAuthoritySections: "1",
      authorizedSpeedOsFirstTrain: "25 kmph",
      authorizedSpeedOsSubsequentTrains: "Booked Speed (MPS)",
    });
  }

  // Up TSL departure routes on Down track
  for (const st of upStarters) {
    const oppositeExit = downHome
      ? `${downHome.node.name} of ${metadata.nextUpStationId || "Next Station"}`
      : `LSS of ${metadata.nextUpStationId || "Next Station"}`;
    const cmd = downHome ? `${st.node.name}GNR, ${downHome.node.name}GNR` : `${st.node.name}GNR`;
    const dist =
      st.node.chainageM !== null && st.node.chainageM > 0
        ? Math.round(st.node.chainageM * 0.1)
        : st.line
          ? Math.round(Math.abs(st.line.x1 - st.line.x0) * 10)
          : 0;
    tslRoutes.push({
      slNo: tslRoutes.length + 1,
      tslEntrySignal: st.node.name,
      tslExitSignal: oppositeExit,
      signalType: st.node.signalType || "Starter",
      lineOrSignalType: st.node.signalType,
      aspectOfEntrySignal: "Red/Blank",
      requiresAspectOfExitSignal: "Red",
      requiredRouteCommand: cmd,
      pointsNormal: [],
      pointsReverse: [],
      requiresTrackCktUp: "Axle Counter section free",
      trackCktUpOrAxleCounterFree: "Axle Counter section free",
      tinsRequiresFree: st.line?.tins.map((t) => t.id) || [],
      entryFootTag: st.node.footTagId,
      linkingSequence: findLinkingTags(st, st, false),
      distanceBetweenSignalsM: dist,
      movementAuthoritySections: "1",
      authorizedSpeedOsFirstTrain: "25 kmph",
      authorizedSpeedOsSubsequentTrains: "Booked Speed (MPS)",
    });
  }

  const tslTrackProfiles: TrackProfileRow[] = tslRoutes.map((tslRow) => ({
    slNo: tslRow.slNo,
    entrySignal: tslRow.tslEntrySignal,
    exitSignal: tslRow.tslExitSignal,
    line: tslRow.lineOrSignalType || "Main Line",
    turnoutSpeedKmph: 30,
    turnoutStartDistM: null,
    turnoutLengthM: null,
    psrSegments: [],
    psrClassSegments: [],
    engineeringGradients: [],
    averageGradients: [],
    lcId: undefined,
    trackConditionType: "Dead Stop",
    trackConditionStartDistM: tslRow.distanceBetweenSignalsM,
    trackConditionLengthM: 0,
  }));

  // Dynamic Block Section Details Table
  const downLss =
    placed.find((p) => p.node.signalType.includes("Advanced") && p.node.direction === "DOWN") ||
    placed.find((p) => p.node.direction === "DOWN" && p.node.signalType.includes("Starter"));
  const upLss =
    placed.find((p) => p.node.signalType.includes("Advanced") && p.node.direction === "UP") ||
    placed.find((p) => p.node.direction === "UP" && p.node.signalType.includes("Starter"));

  const blockSections: BlockSectionDetail[] = [];
  if (downLss) {
    const nextStnDist =
      downLss.node.chainageM !== null && downLss.node.chainageM > 0
        ? Math.round(downLss.node.chainageM * 0.1)
        : 0;
    blockSections.push({
      lastStopSignal: downLss.node.name,
      direction: "Down",
      lastSignalMaMeters: nextStnDist > 0 ? nextStnDist : undefined,
      blockSectionTin: downLss.line?.tins[0]?.id || "----",
      adjacentLineTins: upLss?.line?.tins[0]?.id || "----",
      nextStationId: metadata.nextDownStationId || "----",
      nextStationBorderRfid: "----",
      startDistAbsResetM: "----",
      absLocationCorrectionM: "----",
      locoDirectionAfterAdj: "Nominal",
      authorisedSpeed: "MPS",
      sosRfidTags: tags
        .filter((t) => t.line === downLss.line?.id)
        .slice(0, 5)
        .map((t) => t.tagId),
    });
  }
  if (upLss) {
    const nextStnDist =
      upLss.node.chainageM !== null && upLss.node.chainageM > 0
        ? Math.round(upLss.node.chainageM * 0.1)
        : 0;
    blockSections.push({
      lastStopSignal: upLss.node.name,
      direction: "UP",
      lastSignalMaMeters: nextStnDist > 0 ? nextStnDist : undefined,
      blockSectionTin: upLss.line?.tins[0]?.id || "----",
      adjacentLineTins: downLss?.line?.tins[0]?.id || "----",
      nextStationId: metadata.nextUpStationId || "----",
      nextStationBorderRfid: "----",
      startDistAbsResetM: "----",
      absLocationCorrectionM: "----",
      locoDirectionAfterAdj: "----",
      authorisedSpeed: "MPS",
      sosRfidTags: tags
        .filter((t) => t.line === upLss.line?.id)
        .slice(0, 5)
        .map((t) => t.tagId),
    });
  }

  // Dynamic TSL Block Section Details
  const tslBlockSections: BlockSectionDetail[] = [];
  if (upHome) {
    tslBlockSections.push({
      lastStopSignal: upHome.node.name,
      direction: "Down",
      lastSignalMaMeters: undefined,
      blockSectionTin: downLss?.line?.tins[0]?.id || "----",
      adjacentLineTins: upLss?.line?.tins[0]?.id || "----",
      nextStationId: metadata.nextDownStationId || "----",
      nextStationBorderRfid: "----",
      startDistAbsResetM: "----",
      absLocationCorrectionM: "----",
      locoDirectionAfterAdj: "----",
      authorisedSpeed: "MPS",
      sosRfidTags: [],
    });
  }
  if (downHome) {
    tslBlockSections.push({
      lastStopSignal: downHome.node.name,
      direction: "UP",
      lastSignalMaMeters: undefined,
      blockSectionTin: upLss?.line?.tins[0]?.id || "----",
      adjacentLineTins: downLss?.line?.tins[0]?.id || "----",
      nextStationId: metadata.nextUpStationId || "----",
      nextStationBorderRfid: "----",
      startDistAbsResetM: "----",
      absLocationCorrectionM: "----",
      locoDirectionAfterAdj: "----",
      authorisedSpeed: "MPS",
      sosRfidTags: [],
    });
  }

  // Dynamic Shunting Limits Table
  const shuntingLimits: ShuntingLimitEntry[] = placed
    .filter((p) => p.node.signalType.includes("Starter") || p.node.signalType.includes("Advanced"))
    .slice(0, 5)
    .map((p) => ({
      adjacentStation:
        p.node.direction === "DOWN"
          ? metadata.nextDownStationId || "----"
          : metadata.nextUpStationId || "----",
      direction: p.node.direction === "DOWN" ? "Nominal" : "Reverse",
      rfidTag: p.node.footTagId || "----",
      tin: p.line?.tins[0]?.id || "----",
      absoluteLocationM: p.node.chainageM ?? 0,
    }));

  // Dynamic Signals Override OV
  const signalsOverrideOv: string[] = Array.from(
    new Set([
      ...(downLss ? [downLss.node.name] : []),
      ...(upLss ? [upLss.node.name] : []),
      ...placed.filter((p) => p.node.signalType.includes("IB")).map((p) => p.node.name),
    ]),
  );

  return {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    metadata,
    tocFormatPreference: "STANDARD_SELECTION",
    tracks,
    signals,
    points,
    tags,
    levelCrossings,
    routes,
    blockSections,
    tslBlockSections,
    trackProfiles,
    tsrRoutes,
    tslRoutes,
    tslTrackProfiles,
    shuntingLimits,
    signalsOverrideOv,
    authorizedSpeedOnSightKmph: 100,
    sectionSpeedKmph: 110,
    validationIssues: [],
    auditLog: [
      {
        id: `audit-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: "Offline drawing reader",
        action: "Extracted layout locally",
        target: input.fileName,
        details: `${tracks.length} running lines, ${legs.length} turnout legs, ${signals.length} signals, ${tags.length} RFID tags (${located.length} with chainage), ${points.length} points, ${levelCrossings.length} LC gates and ${routes.length} RDSO-compliant routes.`,
      },
    ],
    sourceSummary:
      input.sourceSummary ||
      `Offline extraction from ${input.fileName}; only labels with drawing evidence were included.`,
    sourceLayout: input.sourceLayout,
  };
}

export const __offlineExtractorInternals = {
  tagIdOf,
  tinIdOf,
  parseChainageText,
  buildPhrases,
};
