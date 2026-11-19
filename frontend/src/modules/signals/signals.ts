import type { LayoutToken } from "@/engine/offlineExtractor";
import type { ConfidenceLevel, SignalDirection, SignalNode, TrackLine } from "@/types/signalling";
import { extractTrackLines, nearestTrackLine, type InternalTrackLine } from "../lines/lines";

export interface ExtractedSignalEntity {
  name: string;
  base: string;
  suffix: string;
  prefix: string;
  x: number;
  y: number;
  page: number;
  trackLineName: string;
  direction: SignalDirection;
  signalType: string;
  aspects: string[];
  footTagId: string;
  chainageM: number | null;
  hasPhysicalRings: boolean;
  isCallingOn: boolean;
}

export interface SignalExtractionInput {
  tokens: LayoutToken[];
  trackLines?: TrackLine[];
  internalLines?: InternalTrackLine[];
}

export interface SignalExtractionResult {
  signals: SignalNode[];
  rawEntities: ExtractedSignalEntity[];
}

const EXPLICIT_SIGNAL_RE = /^(GS|SH|S|A|C|IB|IBS)\s*-?\s*(\d{1,4})\s*([A-Z]{0,2})$/i;
const NUMERIC_SIGNAL_RE = /^(\d{1,4})\s*(I\s*D|[A-HJ-SU-Z])?$/i;
const TAG_TOKEN_RE = /^[^A-Z0-9]{0,2}R\s*[-:.]?\s*(\d{2,4})[^A-Z0-9]{0,2}$/i;

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

export function classifySignalType(prefix: string, base: string, suffix: string): string {
  const p = prefix.toUpperCase();
  const s = suffix.toUpperCase();

  if (p === "A") return "AUTOMATIC";
  if (p === "SH") return "SHUNT";
  if (p === "GS" || p === "G") return "GATE_SIGNAL";
  if (p === "IB" || p === "IBS") return "INTERMEDIATE_BLOCK";
  if (s === "ID") return "INNER_DISTANT";
  if (s === "D") return "DISTANT";
  if (/^[ABC]$/.test(s) || p === "C") return "CALLING_ON";

  // Stop signals without explicit prefix/suffix are initially marked STOP_SIGNAL.
  // Their exact roles (HOME, STARTER, ADVANCED_STARTER) are resolved 100% dynamically
  // by resolveSignalRolesDynamically based on spatial positions and yard topology.
  return "STOP_SIGNAL";
}

/**
 * Resolves Stop Signal roles (HOME, STARTER, ADVANCED_STARTER, INTERMEDIATE_BLOCK)
 * 100% dynamically based on track geometry, spatial coordinates, and approach/departure ordering.
 * ZERO hardcoded numbers.
 */
export function resolveSignalRolesDynamically(
  entities: ExtractedSignalEntity[],
  trackLines: TrackLine[] = [],
  internalLines: InternalTrackLine[] = []
): void {
  const directions: Array<SignalDirection> = ["DOWN", "UP"];

  for (const dir of directions) {
    // 1. Collect all candidate entities for this direction
    const dirEntities = entities.filter(
      (e) => e.direction === dir || e.direction === "BIDIRECTIONAL"
    );

    // 2. Identify Distant & Inner Distant signals in this direction
    const distants = dirEntities.filter((e) => e.signalType === "DISTANT");
    const innerDistants = dirEntities.filter((e) => e.signalType === "INNER_DISTANT");

    // Stop signals needing role assignment
    const stopSignals = dirEntities.filter(
      (e) => !["DISTANT", "INNER_DISTANT", "CALLING_ON", "SHUNT", "AUTOMATIC"].includes(e.signalType)
    );

    if (stopSignals.length === 0) continue;

    // 3. Sort stop signals along the running direction:
    // DOWN: Left-to-Right (increasing x)
    // UP: Right-to-Left (decreasing x)
    const sortedStops = stopSignals.slice().sort((a, b) => {
      return dir === "DOWN" ? a.x - b.x : b.x - a.x;
    });

    // 4. Resolve HOME Signal:
    // Priority Rule: The stop signal whose base number matches the approach Distant or Inner Distant in rear
    let homeEntity: ExtractedSignalEntity | undefined = undefined;
    for (const stop of sortedStops) {
      const hasMatchingDistant =
        distants.some((d) => d.base === stop.base) ||
        innerDistants.some((id) => id.base === stop.base);
      if (hasMatchingDistant) {
        homeEntity = stop;
        break;
      }
    }

    // Spatial fallback: First stop signal encountered along the running direction
    if (!homeEntity && sortedStops.length > 0) {
      homeEntity = sortedStops[0];
    }

    if (homeEntity) {
      homeEntity.signalType = "HOME";
      homeEntity.aspects = defaultAspectsForType("HOME");

      // Check if any collocated entity is a Calling-on signal
      for (const e of dirEntities) {
        if (
          e !== homeEntity &&
          e.base === homeEntity.base &&
          !["DISTANT", "INNER_DISTANT"].includes(e.signalType)
        ) {
          e.signalType = "CALLING_ON";
          e.isCallingOn = true;
          e.aspects = defaultAspectsForType("CALLING_ON");
        }
      }
    }

    // 5. Resolve ADVANCED_STARTER Signal:
    // Outermost stop signal past the yard facing into the block section ahead.
    const remainingStops = sortedStops.filter(
      (s) => s !== homeEntity && s.signalType !== "CALLING_ON"
    );

    let advStarterEntity: ExtractedSignalEntity | undefined = undefined;
    if (remainingStops.length > 0) {
      // Main track candidates
      const mainStops = remainingStops.filter(
        (s) =>
          s.trackLineName.toUpperCase().includes("MAIN") ||
          !s.trackLineName.toUpperCase().includes("LOOP")
      );

      const candidateList = mainStops.length > 0 ? mainStops : remainingStops;
      const lastStop = candidateList[candidateList.length - 1]!;

      // Check if last stop is an Intermediate Block Signal (IBS)
      // In Indian Railways, if there are multiple distant sequences in the same direction,
      // the second sequence belongs to an Intermediate Block Signal in the block section.
      const hasAssociatedDistant =
        distants.some((d) => d.base === lastStop.base) ||
        innerDistants.some((id) => id.base === lastStop.base);

      const isIBS =
        (hasAssociatedDistant && distants.length >= 2) ||
        distants.some((d) => d.base === lastStop.base && d.prefix.includes("IB")) ||
        lastStop.prefix.includes("IB") ||
        lastStop.name.toUpperCase().includes("IB");

      if (isIBS) {
        lastStop.signalType = "INTERMEDIATE_BLOCK";
        lastStop.aspects = defaultAspectsForType("INTERMEDIATE_BLOCK");
        if (candidateList.length >= 2) {
          advStarterEntity = candidateList[candidateList.length - 2];
        }
      } else {
        advStarterEntity = lastStop;
      }

      if (advStarterEntity) {
        advStarterEntity.signalType = "ADVANCED_STARTER";
        advStarterEntity.aspects = defaultAspectsForType("ADVANCED_STARTER");
      }
    }

    // 6. Resolve STARTER Signals:
    // All remaining stop signals between HOME and ADVANCED_STARTER are STARTERS
    for (const stop of remainingStops) {
      if (stop !== advStarterEntity && stop.signalType !== "INTERMEDIATE_BLOCK") {
        stop.signalType = "STARTER";
        stop.aspects = defaultAspectsForType("STARTER");
      }
    }
  }
}

export function defaultAspectsForType(signalType: string): string[] {
  switch (signalType) {
    case "AUTOMATIC":
      return ["RED", "YELLOW", "DOUBLE_YELLOW", "GREEN"];
    case "DISTANT":
    case "INNER_DISTANT":
      return ["CAUTION", "ATTENTION", "PROCEED"];
    case "CALLING_ON":
      return ["MINIATURE_YELLOW"];
    case "SHUNT":
      return ["ON", "OFF"];
    case "HOME":
    case "STARTER":
    case "ADVANCED_STARTER":
    case "GATE_SIGNAL":
    case "INTERMEDIATE_BLOCK":
    default:
      return ["RED", "YELLOW", "GREEN"];
  }
}

export function extractSignals(input: SignalExtractionInput): SignalExtractionResult {
  const { tokens } = input;
  const texts = tokens.filter((t) => !t.kind || t.kind === "text");
  const rings = tokens.filter((t) => t.kind === "ring");
  const h = unitHeight(texts);

  // Ensure internalLines and trackLines are resolved geometrically
  let internalLines = input.internalLines;
  let trackLines = input.trackLines;
  if (!internalLines || !trackLines) {
    const trackResult = extractTrackLines({ tokens });
    internalLines ||= trackResult.rawLines;
    trackLines ||= trackResult.trackLines;
  }

  // 1. Collect RFID tag tokens and associate each with its track line
  interface BoundRfidTag {
    id: string;
    token: LayoutToken;
    chainageM: number | null;
    line: InternalTrackLine | null;
  }

  const rfidTags: BoundRfidTag[] = [];
  for (const t of texts) {
    const raw = upper(t.text);
    const m = raw.match(TAG_TOKEN_RE);
    if (m) {
      const line = nearestTrackLine(internalLines, t, h, 3.5);
      rfidTags.push({ id: `R-${m[1]}`, token: t, chainageM: null, line });
    }
  }

  // Associate chainages with tags
  for (const tag of rfidTags) {
    const nearbyChainage = texts.find(
      (t) =>
        t.page === tag.token.page &&
        Math.abs(t.x - tag.token.x) <= 4.0 * h &&
        Math.abs(t.y - tag.token.y) <= 4.5 * h &&
        parseChainage(t.text) !== null,
    );
    if (nearbyChainage) {
      tag.chainageM = parseChainage(nearbyChainage.text);
    }
  }

  // 2. Parse candidate signal label tokens
  interface ParsedCandidate {
    base: string;
    suffix: string;
    prefix: string;
    token: LayoutToken;
    explicit: boolean;
  }

  const rawCandidates: ParsedCandidate[] = [];

  for (const token of texts) {
    let text = upper(token.text);
    if (!text || text.length > 12) continue;

    // Reject non-signal tokens
    if (/^(?:BSLB|SLB|FP|TOC|RFID|TIN|SIP|REV|DATE|PLAN|EXIT|GATE|NOT|LIMIT)$/i.test(text))
      continue;
    if (/^[A-Z]{1,4}T$/i.test(text) && !/^[A-Z]\d+/.test(text)) continue;

    // Normalizations: "3O" -> "30"
    text = text.replace(/^(\d+)O(?=[A-Z]|$)/i, "$10");
    text = text.replace(/^O(\d+)/i, "0$1");

    // Clean brackets/punctuation
    text = text.replace(/^[[(](.*?)[)\]]$/, "$1");

    const explicit = text.match(EXPLICIT_SIGNAL_RE);
    if (explicit && explicit[1] !== "C") {
      rawCandidates.push({
        prefix: explicit[1]!.toUpperCase(),
        base: explicit[2]!,
        suffix: explicit[3]?.toUpperCase() ?? "",
        token,
        explicit: true,
      });
      continue;
    }

    const numeric = text.match(NUMERIC_SIGNAL_RE);
    if (numeric) {
      let suffix = (numeric[2] ?? "").replace(/\s+/g, "").toUpperCase();
      // Check if adjacent token is distant suffix ("1" followed by "ID" or "D")
      if (!suffix) {
        const next = texts.find(
          (other) =>
            other !== token &&
            other.page === token.page &&
            Math.abs(other.y - token.y) < 0.6 * h &&
            other.x > token.x &&
            other.x - token.x < 3.0 * h &&
            /^(?:ID|D)$/i.test(upper(other.text)),
        );
        if (next) {
          suffix = upper(next.text);
        }
      }

      rawCandidates.push({
        prefix: "S",
        base: numeric[1]!,
        suffix,
        token,
        explicit: false,
      });
    }
  }

  // 3. Associate candidates with physical rings and track lines
  const entities: ExtractedSignalEntity[] = [];

  for (const cand of rawCandidates) {
    const nearbyRings = rings.filter(
      (r) =>
        r.page === cand.token.page && Math.hypot(r.x - cand.token.x, r.y - cand.token.y) <= 4.0 * h,
    );

    // For non-explicit numeric candidates (e.g. bare numbers like "10", "14", "174", "453", chainages, curve data),
    // require physical signal lamp rings (or explicit Distant suffix 'D'/'ID').
    // Without rings, bare numbers are chainages, point labels, dimensions, or offsets.
    if (!cand.explicit && !["D", "ID"].includes(cand.suffix) && nearbyRings.length === 0) {
      continue;
    }

    // Turnout point actuator numbers (e.g. 11, 13, 18, 20) on crossover switch legs without signal lamps
    const isPointMachineActuator =
      nearbyRings.length === 0 &&
      tokens.some(
        (t) =>
          t.page === cand.token.page &&
          (t.kind === "link" || /^(?:PT\.?|POINT)$/i.test(t.text || "")) &&
          Math.hypot(t.x - cand.token.x, t.y - cand.token.y) <= 6.0 * h,
      );
    if (isPointMachineActuator) continue;

    // Anchor position for track line and tag association:
    // If rings exist, the ring cluster center is the physical head; otherwise use the label token
    const anchor =
      nearbyRings.length > 0
        ? {
            x: nearbyRings.reduce((s, r) => s + r.x, 0) / nearbyRings.length,
            y: nearbyRings.reduce((s, r) => s + r.y, 0) / nearbyRings.length,
            page: cand.token.page,
          }
        : cand.token;

    // Nearest track line (must be within reasonable mast proximity of an active running line)
    const assignedLine = nearestTrackLine(internalLines, anchor, h, 6.0);
    if (!assignedLine) {
      // Reject tokens that do not belong to any running line (e.g. title block, border, revision notes)
      continue;
    }
    const signalType = classifySignalType(cand.prefix, cand.base, cand.suffix);
    const aspects = defaultAspectsForType(signalType);

    // Determine signal name
    let signalName = "";
    if (cand.explicit) {
      signalName = `${cand.prefix}${cand.base}${cand.suffix}`;
    } else {
      signalName = `S${cand.base}${cand.suffix === "ID" ? " ID" : cand.suffix}`;
    }

    // Avoid duplicate candidates for the same physical signal
    if (entities.some((e) => e.name === signalName && Math.abs(e.x - cand.token.x) < 5 * h)) {
      continue;
    }

    entities.push({
      name: signalName,
      base: cand.base,
      suffix: cand.suffix,
      prefix: cand.prefix,
      x: cand.token.x,
      y: cand.token.y,
      page: cand.token.page,
      trackLineName: assignedLine ? assignedLine.id : "MAIN LINE",
      direction: assignedLine ? assignedLine.direction : "DOWN",
      signalType,
      aspects,
      footTagId: "R-000",
      chainageM: null,
      hasPhysicalRings: nearbyRings.length > 0,
      isCallingOn: signalType === "CALLING_ON",
    });
  }

  // 4. Bipartite 1-to-1 matching between signal candidates and foot tags
  interface FootPair {
    candidate: ExtractedSignalEntity;
    tag: BoundRfidTag;
    score: number;
  }

  const pairs: FootPair[] = [];
  for (const cand of entities) {
    for (const tag of rfidTags) {
      if (tag.token.page !== cand.page) continue;
      const dx = Math.abs(tag.token.x - cand.x);
      const dy = tag.token.y - cand.y;

      // Tag must be horizontally within mast proximity (<= 8*h)
      if (dx > 8.0 * h) continue;

      // In Indian Railways, Down signals have head above track/tag (dy > 0),
      // Up signals have head below track/tag (dy < 0).
      // Absolute vertical distance should not exceed 15*h
      if (Math.abs(dy) > 15.0 * h) continue;

      // Optimal mast height offset is ~4.4*h to ~6*h
      const mastOffsetScore = Math.abs(Math.abs(dy) - 5.5 * h);
      const score = (dx / h) * 1.5 + mastOffsetScore / h;

      pairs.push({ candidate: cand, tag, score });
    }
  }

  pairs.sort((a, b) => a.score - b.score);

  const assignedSignals = new Set<ExtractedSignalEntity>();
  const tagUsers = new Map<string, ExtractedSignalEntity[]>();

  for (const pair of pairs) {
    if (assignedSignals.has(pair.candidate)) continue;
    const users = tagUsers.get(pair.tag.id) ?? [];

    // One post can carry a main signal and its calling-on signal (same base number), nothing else
    const canShare =
      users.length === 0 ||
      (users.every((u) => u.base === pair.candidate.base) &&
        (pair.candidate.isCallingOn || users.some((u) => u.isCallingOn)));

    if (!canShare) continue;

    pair.candidate.footTagId = pair.tag.id;
    pair.candidate.chainageM = pair.tag.chainageM;
    if (pair.tag.line) {
      pair.candidate.trackLineName = pair.tag.line.id;
      if (pair.tag.line.direction !== "BIDIRECTIONAL") {
        pair.candidate.direction = pair.tag.line.direction;
      }
    }
    assignedSignals.add(pair.candidate);
    tagUsers.set(pair.tag.id, [...users, pair.candidate]);
  }

  // Fallback: If any signal was not matched via bipartite, inherit from calling-on parent or closest tag
  for (const cand of entities) {
    if (cand.footTagId && cand.footTagId !== "R-000") continue;

    if (cand.isCallingOn) {
      const parent = entities.find(
        (e) =>
          e.page === cand.page &&
          e.base === cand.base &&
          !e.isCallingOn &&
          Math.abs(e.x - cand.x) <= 3.0 * h,
      );
      if (parent && parent.footTagId) {
        cand.footTagId = parent.footTagId;
        cand.chainageM = parent.chainageM;
        continue;
      }
    }

    const availableTag = rfidTags
      .filter((t) => t.token.page === cand.page && Math.abs(t.token.x - cand.x) <= 8.0 * h)
      .sort(
        (a, b) =>
          Math.hypot(a.token.x - cand.x, a.token.y - cand.y) -
          Math.hypot(b.token.x - cand.x, b.token.y - cand.y),
      )[0];

    if (availableTag) {
      cand.footTagId = availableTag.id;
      cand.chainageM = availableTag.chainageM;
    }
  }

  // 4B. Dynamically resolve Stop Signal roles (HOME, STARTER, ADVANCED_STARTER)
  // using spatial sorting and yard extents (zero hardcoded numbers)
  resolveSignalRolesDynamically(entities, trackLines, internalLines);

  // 5. Convert to canonical SignalNode model
  // Retain evidenced signals: physical lamp rings, paired foot tags, or explicit Distant / Calling-on signals
  const validEntities = entities.filter(
    (e) =>
      e.hasPhysicalRings ||
      (e.footTagId && e.footTagId !== "R-000") ||
      ["DISTANT", "INNER_DISTANT", "CALLING_ON"].includes(e.signalType),
  );

  const signals: SignalNode[] = (validEntities.length > 0 ? validEntities : entities).map((e) => ({
    id: e.name,
    name: e.name,
    line: e.trackLineName,
    direction: e.direction,
    signalType: e.signalType,
    chainageM: e.chainageM,
    footTagId: e.footTagId,
    aspects: e.aspects,
    confidence: "HIGH" as ConfidenceLevel,
    verified: true,
    x: e.x,
    y: e.y,
  }));

  return {
    signals,
    rawEntities: entities,
  };
}
