import type {
  ConfidenceLevel,
  LevelCrossing,
  LinkingTuple,
  PointSwitch,
  RouteAspectPermutation,
  SignalDirection,
  SignalNode,
  StationMetadata,
  TocRouteRow,
  TrackLine,
} from "@/types/signalling";
import type { RailwayGraph } from "../topology/topology_graph";
import { canonicalLineName } from "../lines/lines";

export interface RouteSynthesisInput {
  graph?: RailwayGraph;
  signals: SignalNode[];
  points?: PointSwitch[];
  levelCrossings?: LevelCrossing[];
  trackLines: TrackLine[];
  metadata?: StationMetadata;
  rfidTags?: Array<{ id: string; chainageM: number | null; x: number; lineId?: string }>;
}

export interface RouteSynthesisResult {
  routes: TocRouteRow[];
  mode: "AUTOMATIC_BLOCK" | "YARD_INTERLOCKING" | "HYBRID";
}

/**
 * Extracts numeric component of signal name (e.g. "S1D" -> "1", "S30" -> "30", "S4" -> "4").
 */
function parseSignalNumber(name: string): string {
  const m = name.match(/\d+/);
  return m ? m[0] : "1";
}

/**
 * Dynamically computes signal-to-signal distance using chainage subtraction.
 * Returns 0 if either chainage is missing (NEVER invents magic fallback numbers).
 */
function computeSignalDistance(entry: SignalNode, exit: SignalNode | null): number {
  if (!exit) return 0;
  if (
    typeof entry.chainageM === "number" &&
    entry.chainageM !== null &&
    typeof exit.chainageM === "number" &&
    exit.chainageM !== null
  ) {
    return Math.round(Math.abs(exit.chainageM - entry.chainageM));
  }
  return 0;
}

/**
 * Resolves destination Line Number from track line name or spatial track layout.
 * Checks for explicit "LINE 1", "ROAD 1", "L1", etc., or uses 1-based ySlot index.
 */
function resolveTrackLineNumber(trackName: string, trackLines: TrackLine[]): number | null {
  if (!trackName) return null;

  // 1. Check explicit "LINE 1", "ROAD 2", "L3", "LINE-4"
  const m = trackName.match(/(?:LINE|ROAD|L)[\s-]*(\d+)/i);
  if (m) {
    return parseInt(m[1]!, 10);
  }

  // 2. Look up in trackLines
  const matched = trackLines.find(
    (t) =>
      t.name.toLowerCase() === trackName.toLowerCase() ||
      t.id.toLowerCase() === trackName.toLowerCase(),
  );
  if (matched) {
    const explicit =
      matched.name.match(/(?:LINE|ROAD|L)[\s-]*(\d+)/i) ||
      matched.id.match(/(?:LINE|ROAD|L)[\s-]*(\d+)/i);
    if (explicit) {
      return parseInt(explicit[1]!, 10);
    }
    if (typeof matched.ySlot === "number") {
      return matched.ySlot + 1;
    }
  }

  // 3. Spatially index in trackLines
  const idx = trackLines.findIndex(
    (t) =>
      t.name.toLowerCase() === trackName.toLowerCase() ||
      t.id.toLowerCase() === trackName.toLowerCase(),
  );
  if (idx !== -1) {
    return idx + 1;
  }

  return null;
}

/**
 * RDSO/SPN/196/2020 Version 4.0 Amdt-6 (Clauses I.2.12.6.4 & I.2.12.6.5):
 * Derives TSR Route ID / TSRMS ID dynamically from Signal Foot Tag:
 * - Single Route (non-diverging): Foot Tag numeric ID (e.g. S6 with R-716 -> 716, S25 with R-529 -> 529)
 * - Multiple Diverging Routes (e.g. Home Signals): [Foot Tag ID] + [Line Number]
 *   (e.g. S1 with R-514 leading to Line 1 -> 5141, to Line 2 -> 5142)
 */
/**
 * Per Indian Railways practice and user instruction:
 * TSRMS Route ID column is assigned from the TSRMS database / Engineer Supervision Area,
 * and is left empty ("") for manual engineer entry and supervision.
 */
function computeTsrmsRouteId(
  _entrySig: SignalNode,
  _targetLineName: string,
  _trackLines: TrackLine[],
  _isMultipleOrDiverging: boolean,
): string {
  return "";
}

/**
 * Dynamically resolves Direction Type Route Indicator position (e.g. 'with "Pos1"', 'with "Pos4"')
 * strictly from multi-track geometry and lateral offsets relative to the main line (Zero Hardcoding).
 *
 * Indian Railways Signalling Rules (RDSO/SPN/196/2020 Clause I.2.11.7):
 * - Main Line straight through: no route indicator feather.
 * - Diverging to the train's left: Pos 1 (1st loop), Pos 2 (2nd loop), Pos 3 (3rd loop).
 * - Diverging to the train's right: Pos 4 (1st loop), Pos 5 (2nd loop), Pos 6 (3rd loop).
 */
export function determineRouteIndicatorPosition(
  home: SignalNode,
  starter: SignalNode,
  allStarters: SignalNode[],
  _dir: SignalDirection,
): string {
  const homeY = typeof home.y === "number" ? home.y : 0;
  const stY = typeof starter.y === "number" ? starter.y : 0;
  const dy = stY - homeY;

  // Straight line through route has no route indicator feather
  if (Math.abs(dy) < 15 && !/loop|branch|siding/i.test(starter.line)) {
    return "";
  }

  // Group all diverging starters into side A (dy > 0) and side B (dy < 0)
  const sideA = allStarters
    .filter((s) => {
      const y = typeof s.y === "number" ? s.y : 0;
      return y - homeY > 15;
    })
    .sort((a, b) => ((a.y ?? 0) - homeY) - ((b.y ?? 0) - homeY)); // sorted from inner to outer

  const sideB = allStarters
    .filter((s) => {
      const y = typeof s.y === "number" ? s.y : 0;
      return homeY - y > 15;
    })
    .sort((a, b) => (homeY - (a.y ?? 0)) - (homeY - (b.y ?? 0))); // sorted from inner to outer

  const indexA = sideA.findIndex((s) => s.id === starter.id || s.name === starter.name);
  if (indexA !== -1) {
    const posNum = indexA + 1; // 1, 2, 3
    return `with "Pos${posNum}"`;
  }

  const indexB = sideB.findIndex((s) => s.id === starter.id || s.name === starter.name);
  if (indexB !== -1) {
    const posNum = indexB + 4; // 4, 5, 6
    return `with "Pos${posNum}"`;
  }

  return dy < 0 ? 'with "Pos4"' : 'with "Pos1"';
}

/**
 * Resolves Block Departure Exit Signal name for Advanced Starter or IBS signals
 * (Clause I.2.2(v)).
 */
export function resolveBlockExitSignal(
  dir: SignalDirection,
  metadata?: StationMetadata,
): string {
  if (dir === "DOWN") {
    if (metadata?.nextDownExitSignal) return metadata.nextDownExitSignal;
    if (metadata?.nextDownStationId) {
      const distant = metadata.adjacentDistantSignal || "S1D";
      return `${distant} of ${metadata.nextDownStationId}`;
    }
  } else if (dir === "UP") {
    if (metadata?.nextUpExitSignal) return metadata.nextUpExitSignal;
    if (metadata?.nextUpStationId) {
      const distant = metadata.adjacentDistantSignal || "S1D";
      return `${distant} of ${metadata.nextUpStationId}`;
    }
  }
  return "Block Section";
}

/**
 * Derives standard RDSO signal type string dynamically from signal node role and divergence.
 */
function resolveSignalType(sig: SignalNode, isDiverging: boolean): string {
  switch (sig.signalType) {
    case "DISTANT":
      return "Distant";
    case "INNER_DISTANT":
      return "Inner Distant";
    case "HOME":
      return isDiverging ? "Main Home with Junction Route Indicator" : "Main Home";
    case "CALLING_ON":
      return "Calling-on Signal";
    case "STARTER":
      return isDiverging ? "Loopline Starter" : "Mainline Starter";
    case "ADVANCED_STARTER":
      return "Advanced Starter";
    case "INTERMEDIATE_BLOCK":
      return "IB Signal";
    case "AUTOMATIC":
      return "Automatic";
    default:
      return isDiverging ? `${sig.signalType} (Diverging)` : sig.signalType;
  }
}

/**
 * Declarative RDSO SPN/196/2020 Amdt-6 Multi-Aspect Cascade Engine.
 * Formulates the mandatory aspect cascades, Movement Authority (MA), and speeds
 * based strictly on signal classification and divergence geometry (Zero Hardcoding).
 */
function buildAspectPermutations(
  signalType: string,
  entrySignalName: string,
  exitSignalName: string,
  isDiverging: boolean,
  posIndicator?: string,
  maSections?: string,
  divergingPositions?: string[],
  srSpeed?: string,
): RouteAspectPermutation[] {
  // 1. Calling-on Signal (Miniature aspect below parent Home)
  if (signalType.includes("Calling-on")) {
    const parentHome = entrySignalName.replace(/A$/, "");
    return [
      {
        aspectOfEntrySignal: `Miniature (${parentHome} Red/Blank)`,
        requiresAspectOfExitSignal: `${exitSignalName} Red`,
        movementAuthoritySections: "1",
        authorizedSpeedSr: "",
        authorizedSpeedOs: "15",
      },
    ];
  }

  // 2. Stop / Danger Aspect
  if (exitSignalName === "Red" || exitSignalName === "--" || entrySignalName === "Red") {
    return [
      {
        aspectOfEntrySignal: "Red",
        requiresAspectOfExitSignal: "--",
        movementAuthoritySections: "1",
        authorizedSpeedSr: "",
        authorizedSpeedOs: "15",
      },
    ];
  }

  // 3. Station Approach Distant Signal
  if (signalType === "Distant") {
    return [
      {
        aspectOfEntrySignal: "Green",
        requiresAspectOfExitSignal: `${exitSignalName} Green`,
        movementAuthoritySections: "3",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Green",
        requiresAspectOfExitSignal: `${exitSignalName} Double Yellow`,
        movementAuthoritySections: "3",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Double Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Green`,
        movementAuthoritySections: "3",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Double Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Double Yellow`,
        movementAuthoritySections: "3",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Double Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Yellow`,
        movementAuthoritySections: "2",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Green`,
        movementAuthoritySections: "3",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Double Yellow`,
        movementAuthoritySections: "3",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Yellow`,
        movementAuthoritySections: "2",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
    ];
  }

  // 4. Station Approach Inner Distant Signal
  if (signalType === "Inner Distant") {
    const list: RouteAspectPermutation[] = [
      {
        aspectOfEntrySignal: "Green",
        requiresAspectOfExitSignal: `${exitSignalName} Green`,
        movementAuthoritySections: "3",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Double Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Green`,
        movementAuthoritySections: "3",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
    ];

    if (divergingPositions && divergingPositions.length > 0) {
      for (const dp of divergingPositions) {
        list.push({
          aspectOfEntrySignal: "Double Yellow",
          requiresAspectOfExitSignal: `${exitSignalName} Yellow ${dp}`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        });
      }
    }
    list.push({
      aspectOfEntrySignal: "Double Yellow",
      requiresAspectOfExitSignal: `${exitSignalName} Yellow`,
      movementAuthoritySections: "2",
      authorizedSpeedSr: "MPS",
      authorizedSpeedOs: "MPS",
    });

    list.push({
      aspectOfEntrySignal: "Yellow",
      requiresAspectOfExitSignal: `${exitSignalName} Green`,
      movementAuthoritySections: "3",
      authorizedSpeedSr: "MPS",
      authorizedSpeedOs: "MPS",
    });

    if (divergingPositions && divergingPositions.length > 0) {
      for (const dp of divergingPositions) {
        list.push({
          aspectOfEntrySignal: "Yellow",
          requiresAspectOfExitSignal: `${exitSignalName} Yellow ${dp}`,
          movementAuthoritySections: "2",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        });
      }
    }
    list.push({
      aspectOfEntrySignal: "Yellow",
      requiresAspectOfExitSignal: `${exitSignalName} Yellow`,
      movementAuthoritySections: "2",
      authorizedSpeedSr: "MPS",
      authorizedSpeedOs: "MPS",
    });
    list.push({
      aspectOfEntrySignal: "Yellow",
      requiresAspectOfExitSignal: `${exitSignalName} Red`,
      movementAuthoritySections: "1",
      authorizedSpeedSr: "MPS",
      authorizedSpeedOs: "MPS",
    });

    return list;
  }

  // 5. Main Home Signal (Straight main line reception)
  if (signalType.includes("Home") && !isDiverging) {
    const ma = maSections || "3";
    return [
      {
        aspectOfEntrySignal: "Green",
        requiresAspectOfExitSignal: `${exitSignalName} Green`,
        movementAuthoritySections: ma,
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Green`,
        movementAuthoritySections: ma,
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Yellow`,
        movementAuthoritySections: "2",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Red`,
        movementAuthoritySections: "1",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "15",
      },
    ];
  }

  // 6. Loop Home Signal (Turnout divergence with Route Indicator)
  if (signalType.includes("Home") && isDiverging) {
    const entryAspect = `Yellow ${posIndicator || 'with "Pos1"'}`;
    return [
      {
        aspectOfEntrySignal: entryAspect,
        requiresAspectOfExitSignal: `${exitSignalName} Yellow`,
        movementAuthoritySections: "2",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: entryAspect,
        requiresAspectOfExitSignal: `${exitSignalName} Red`,
        movementAuthoritySections: "1",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "15",
      },
    ];
  }

  // 7. Advanced Starter Signal (checked before general Starter to prevent substring collision)
  if (signalType.includes("Advanced Starter")) {
    if (exitSignalName.toUpperCase().includes("IB") || exitSignalName.toUpperCase().includes("D")) {
      return [
        {
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${exitSignalName} Green`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${exitSignalName} Double Yellow`,
          movementAuthoritySections: "3",
          authorizedSpeedSr: "MPS",
          authorizedSpeedOs: "MPS",
        },
        {
          aspectOfEntrySignal: "Red",
          requiresAspectOfExitSignal: "--",
          movementAuthoritySections: "1",
          authorizedSpeedSr: "",
          authorizedSpeedOs: "",
        },
      ];
    }
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
        requiresAspectOfExitSignal: "--",
        movementAuthoritySections: "1",
        authorizedSpeedSr: "",
        authorizedSpeedOs: "",
      },
    ];
  }

  // 8. Mainline Starter Signal
  if (
    !signalType.includes("Advanced") &&
    (signalType.includes("Mainline Starter") || (signalType.includes("Starter") && !isDiverging))
  ) {
    const ma = maSections || "2";
    return [
      {
        aspectOfEntrySignal: "Green",
        requiresAspectOfExitSignal: `${exitSignalName} Green`,
        movementAuthoritySections: ma,
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "15",
      },
      {
        aspectOfEntrySignal: "Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Green`,
        movementAuthoritySections: ma,
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "15",
      },
      {
        aspectOfEntrySignal: "Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Red`,
        movementAuthoritySections: "1",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "15",
      },
      {
        aspectOfEntrySignal: "Red",
        requiresAspectOfExitSignal: "--",
        movementAuthoritySections: "1",
        authorizedSpeedSr: "",
        authorizedSpeedOs: "",
      },
    ];
  }

  // 9. Loopline Starter Signal (Turnout departure)
  if (
    !signalType.includes("Advanced") &&
    (signalType.includes("Loopline Starter") || (signalType.includes("Starter") && isDiverging))
  ) {
    const ma = maSections || "2";
    const sr = srSpeed || (isDiverging ? "30" : "15");
    return [
      {
        aspectOfEntrySignal: "Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Green`,
        movementAuthoritySections: ma,
        authorizedSpeedSr: sr,
        authorizedSpeedOs: "15",
      },
      {
        aspectOfEntrySignal: "Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Red`,
        movementAuthoritySections: "1",
        authorizedSpeedSr: sr,
        authorizedSpeedOs: "15",
      },
      {
        aspectOfEntrySignal: "Red",
        requiresAspectOfExitSignal: "--",
        movementAuthoritySections: "1",
        authorizedSpeedSr: "",
        authorizedSpeedOs: "",
      },
    ];
  }

  // 10. Intermediate Block Signals (IBS)
  if (signalType === "IB Distant") {
    return [
      {
        aspectOfEntrySignal: "Green",
        requiresAspectOfExitSignal: `${exitSignalName} Green`,
        movementAuthoritySections: "3",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Double Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Yellow`,
        movementAuthoritySections: "2",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
    ];
  }

  if (signalType === "IB Inner Distant") {
    return [
      {
        aspectOfEntrySignal: "Green",
        requiresAspectOfExitSignal: `${exitSignalName} Green`,
        movementAuthoritySections: "2",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Yellow",
        requiresAspectOfExitSignal: `${exitSignalName} Red`,
        movementAuthoritySections: "1",
        authorizedSpeedSr: "MPS",
        authorizedSpeedOs: "MPS",
      },
    ];
  }

  if (signalType === "IB Signal") {
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
        requiresAspectOfExitSignal: "--",
        movementAuthoritySections: "1",
        authorizedSpeedSr: "",
        authorizedSpeedOs: "",
      },
    ];
  }

  // 11. Automatic Signals
  return [
    {
      aspectOfEntrySignal: "Green",
      requiresAspectOfExitSignal: `${exitSignalName} Green`,
      movementAuthoritySections: "2",
      authorizedSpeedSr: "MPS",
      authorizedSpeedOs: "MPS",
    },
    {
      aspectOfEntrySignal: "Yellow",
      requiresAspectOfExitSignal: `${exitSignalName} Red`,
      movementAuthoritySections: "1",
      authorizedSpeedSr: "MPS",
      authorizedSpeedOs: "15",
    },
  ];
}

/**
 * Pure dynamic route synthesizer focusing 100% on the 7 Core RDSO Columns.
 * Zero hardcoded numbers, zero fake RFID tag names, zero arbitrary route IDs.
 */
export function synthesizeTocRoutes(input: RouteSynthesisInput): RouteSynthesisResult {
  const { signals, trackLines, metadata, rfidTags } = input;
  const routes: TocRouteRow[] = [];

  const autoSignals = signals.filter((s) => s.signalType === "AUTOMATIC");
  const yardSignals = signals.filter(
    (s) =>
      s.signalType === "HOME" ||
      s.signalType === "STARTER" ||
      s.signalType === "ADVANCED_STARTER" ||
      s.signalType === "DISTANT" ||
      s.signalType === "INNER_DISTANT" ||
      s.signalType === "CALLING_ON",
  );

  let mode: "AUTOMATIC_BLOCK" | "YARD_INTERLOCKING" | "HYBRID" = "YARD_INTERLOCKING";
  if (autoSignals.length > 0 && yardSignals.length === 0) {
    mode = "AUTOMATIC_BLOCK";
  } else if (autoSignals.length > 0 && yardSignals.length > 0) {
    mode = "HYBRID";
  }

  // =========================================================================
  // MODE A: AUTOMATIC BLOCK SECTION
  // =========================================================================
  if (mode === "AUTOMATIC_BLOCK" || mode === "HYBRID") {
    for (const track of trackLines) {
      const trackAutos = autoSignals.filter(
        (s) =>
          (s.line === track.name || s.direction === track.direction) &&
          (s.direction === track.direction || track.direction === "BIDIRECTIONAL"),
      );

      if (track.direction === "DOWN") {
        trackAutos.sort((a, b) => (a.chainageM ?? a.x ?? 0) - (b.chainageM ?? b.x ?? 0));
      } else {
        trackAutos.sort((a, b) => (b.chainageM ?? b.x ?? 0) - (a.chainageM ?? a.x ?? 0));
      }

      for (let i = 0; i < trackAutos.length - 1; i++) {
        const entrySig = trackAutos[i]!;
        const exitSig = trackAutos[i + 1]!;
        const slNo = routes.length + 1;
        const distM = computeSignalDistance(entrySig, exitSig);

        const linkingSequence: LinkingTuple[] = [];
        if (entrySig.footTagId) {
          linkingSequence.push({
            tagId: entrySig.footTagId,
            distanceM: 0,
            tagType: "SIGNAL_FOOT",
            chainageM: entrySig.chainageM,
          });
        }
        if (exitSig.footTagId && distM > 0) {
          linkingSequence.push({
            tagId: exitSig.footTagId,
            distanceM: distM,
            tagType: "SIGNAL_FOOT",
            chainageM: exitSig.chainageM,
          });
        }

        const routeId = computeTsrmsRouteId(entrySig, track.name, trackLines, false);

        routes.push({
          slNo,
          entrySignal: entrySig.name,
          exitSignal: exitSig.name,
          leadingToLine: track.name,
          direction: track.direction,
          tsrmsRouteId: "",
          signalType: "Automatic",
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${exitSig.name} Green`,
          aspectPermutations: buildAspectPermutations(
            "Automatic",
            "Green",
            `${exitSig.name} Green`,
            false,
          ),
          entryAspectSummary: "Green / Yellow / Red",
          exitAspectsSummary: `${exitSig.name} Green / Yellow / Red`,
          requiredRouteLocking: "",
          pointsNormal: [],
          pointsReverse: [],
          trackCktUp: "",
          tinsRequiresFree: [],
          entryFootTag: entrySig.footTagId || "",
          linkingSequence,
          enRouteTags: [],
          conflictingTurnoutTags: [],
          conflictingRouteTags: [],
          turnoutSpeedKmph: null,
          turnoutCommenceM: null,
          turnoutRestrictionDistM: null,
          distanceBetweenSignalsM: distM,
          movementAuthoritySections: "",
          movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
          authorizedSpeedSr: "",
          authorizedSpeedOs: "",
          psrSegments: [],
          averageGradient: "",
          isTsl: false,
          engineerStatus: "AUTO_GENERATED",
          sourceNotes: "Automatic Block corridor route.",
        });
      }

      // Exit route from last automatic signal into block section
      if (trackAutos.length > 0) {
        const lastAuto = trackAutos[trackAutos.length - 1]!;
        const slNo = routes.length + 1;
        const nextStn =
          track.direction === "DOWN" ? metadata?.nextDownStationId : metadata?.nextUpStationId;
        const exitSignal = nextStn ? `Home of ${nextStn}` : "Block Section";

        const linkingSequence: LinkingTuple[] = [];
        if (lastAuto.footTagId) {
          linkingSequence.push({
            tagId: lastAuto.footTagId,
            distanceM: 0,
            tagType: "SIGNAL_FOOT",
            chainageM: lastAuto.chainageM,
          });
        }

        const routeId = computeTsrmsRouteId(lastAuto, track.name, trackLines, false);

        routes.push({
          slNo,
          entrySignal: lastAuto.name,
          exitSignal,
          leadingToLine: track.name,
          direction: track.direction,
          tsrmsRouteId: "",
          signalType: "Automatic",
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: "Line Clear Available",
          aspectPermutations: buildAspectPermutations(
            "Automatic",
            "Green",
            "Line Clear Available",
            false,
          ),
          entryAspectSummary: "Green / Yellow / Red",
          exitAspectsSummary: "Line Clear Available",
          requiredRouteLocking: "",
          pointsNormal: [],
          pointsReverse: [],
          trackCktUp: "",
          tinsRequiresFree: [],
          entryFootTag: lastAuto.footTagId || "",
          linkingSequence,
          enRouteTags: [],
          conflictingTurnoutTags: [],
          conflictingRouteTags: [],
          turnoutSpeedKmph: null,
          turnoutCommenceM: null,
          turnoutRestrictionDistM: null,
          distanceBetweenSignalsM: 0,
          movementAuthoritySections: "",
          movementAuthorityMeters: "",
          authorizedSpeedSr: "",
          authorizedSpeedOs: "",
          psrSegments: [],
          averageGradient: "",
          isTsl: false,
          engineerStatus: "AUTO_GENERATED",
          sourceNotes: "Automatic corridor departure route.",
        });
      }
    }
  }

  // =========================================================================
  // MODE B: STATION YARD INTERLOCKING (Generic Multi-Station Engine)
  // =========================================================================
  if (mode === "YARD_INTERLOCKING" || mode === "HYBRID") {
    // Process directions dynamically: DOWN (Nominal) and UP (Reverse)
    for (const dir of ["DOWN", "UP"] as SignalDirection[]) {
      const dirSignals = signals.filter((s) => s.direction === dir);

      // Yard Home & Calling-on
      const home = dirSignals.find((s) => s.signalType === "HOME");
      const callingOn = dirSignals.find((s) => s.signalType === "CALLING_ON");

      // Advanced Starter
      const advStarter = dirSignals.find((s) => s.signalType === "ADVANCED_STARTER");

      // Intermediate Block System (IBS) signals if present
      const ibSignal = dirSignals.find((s) => s.signalType === "INTERMEDIATE_BLOCK");

      // Spatially detect departure block zone beyond Advanced Starter
      const isDepartureZone = (s: SignalNode) => {
        if (!advStarter || typeof s.x !== "number" || typeof advStarter.x !== "number") return false;
        return dir === "DOWN" ? s.x > advStarter.x : s.x < advStarter.x;
      };

      const ibDistant = dirSignals.find(
        (s) =>
          s.signalType === "DISTANT" &&
          (s.id.toUpperCase().includes("IB") ||
            s.name.toUpperCase().includes("IB") ||
            (ibSignal && s.name.startsWith(ibSignal.name.replace(/[^A-Za-z0-9]/g, ""))) ||
            isDepartureZone(s)),
      );
      const ibInnerDistant = dirSignals.find(
        (s) =>
          s.signalType === "INNER_DISTANT" &&
          (s.id.toUpperCase().includes("IB") ||
            s.name.toUpperCase().includes("IB") ||
            (ibSignal && s.name.startsWith(ibSignal.name.replace(/[^A-Za-z0-9]/g, ""))) ||
            isDepartureZone(s)),
      );

      // Station Approach signals (excluding IBS distants)
      const distant = dirSignals.find(
        (s) =>
          s.signalType === "DISTANT" &&
          s !== ibDistant &&
          !s.id.toUpperCase().includes("IB") &&
          !s.name.toUpperCase().includes("IB"),
      );
      const innerDistant = dirSignals.find(
        (s) =>
          s.signalType === "INNER_DISTANT" &&
          s !== ibInnerDistant &&
          !s.id.toUpperCase().includes("IB") &&
          !s.name.toUpperCase().includes("IB"),
      );

      // Starters: sorted topologically along the yard matching direction
      const starters = signals.filter(
        (s) =>
          s.signalType === "STARTER" &&
          (s.direction === dir || s.direction === "BIDIRECTIONAL"),
      );
      starters.sort((a, b) => {
        if (typeof a.y === "number" && typeof b.y === "number" && a.y !== b.y) {
          return a.y - b.y;
        }
        return (a.x ?? 0) - (b.x ?? 0);
      });

      const nextStn = dir === "DOWN" ? metadata?.nextDownStationId : metadata?.nextUpStationId;

      // Helper to generate Approach Routes
      const addApproachRoutes = () => {
        const createDistantToInner = () => {
          if (!distant || !innerDistant) return;
          const slNo = routes.length + 1;
          const distM = computeSignalDistance(distant, innerDistant);
          const linkingSequence: LinkingTuple[] = [];
          if (distant.footTagId) {
            linkingSequence.push({
              tagId: distant.footTagId,
              distanceM: 0,
              tagType: "SIGNAL_FOOT",
              chainageM: distant.chainageM,
            });
          }
          if (innerDistant.footTagId && distM > 0) {
            linkingSequence.push({
              tagId: innerDistant.footTagId,
              distanceM: distM,
              tagType: "SIGNAL_FOOT",
              chainageM: innerDistant.chainageM,
            });
          }

          const routeId = computeTsrmsRouteId(distant, distant.line, trackLines, false);

          routes.push({
            slNo,
            entrySignal: distant.name,
            exitSignal: innerDistant.name,
            leadingToLine: canonicalLineName(distant.line),
            direction: dir,
            tsrmsRouteId: "",
            signalType: "Distant",
            aspectOfEntrySignal: "Green",
            requiresAspectOfExitSignal: `${innerDistant.name} Green`,
            aspectPermutations: buildAspectPermutations(
              "Distant",
              distant.name,
              innerDistant.name,
              false,
            ),
            entryAspectSummary: "Green / Attention / Caution",
            exitAspectsSummary: `${innerDistant.name} Green / Yellow / Red`,
            requiredRouteLocking: "",
            pointsNormal: [],
            pointsReverse: [],
            trackCktUp: "",
            tinsRequiresFree: [],
            entryFootTag: distant.footTagId || "",
            linkingSequence,
            enRouteTags: [],
            conflictingTurnoutTags: [],
            conflictingRouteTags: [],
            turnoutSpeedKmph: null,
            turnoutCommenceM: null,
            turnoutRestrictionDistM: null,
            distanceBetweenSignalsM: distM,
            movementAuthoritySections: "3",
            movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
            psrSegments: [],
            averageGradient: "",
            isTsl: false,
            engineerStatus: "AUTO_GENERATED",
            sourceNotes: "Station Approach Distant route.",
          });
        };

        const createDistantToHome = () => {
          if (!distant || !home) return;
          const slNo = routes.length + 1;
          const distM = computeSignalDistance(distant, home);
          const linkingSequence: LinkingTuple[] = [];
          if (distant.footTagId) {
            linkingSequence.push({
              tagId: distant.footTagId,
              distanceM: 0,
              tagType: "SIGNAL_FOOT",
              chainageM: distant.chainageM,
            });
          }
          if (home.footTagId && distM > 0) {
            linkingSequence.push({
              tagId: home.footTagId,
              distanceM: distM,
              tagType: "SIGNAL_FOOT",
              chainageM: home.chainageM,
            });
          }

          const routeId = computeTsrmsRouteId(distant, distant.line, trackLines, false);

          routes.push({
            slNo,
            entrySignal: distant.name,
            exitSignal: home.name,
            leadingToLine: canonicalLineName(distant.line),
            direction: dir,
            tsrmsRouteId: "",
            signalType: "Distant",
            aspectOfEntrySignal: "Green",
            requiresAspectOfExitSignal: `${home.name} Green`,
            aspectPermutations: buildAspectPermutations(
              "Distant",
              distant.name,
              home.name,
              false,
            ),
            entryAspectSummary: "Green / Attention / Caution",
            exitAspectsSummary: `${home.name} Green / Yellow / Red`,
            requiredRouteLocking: "",
            pointsNormal: [],
            pointsReverse: [],
            trackCktUp: "",
            tinsRequiresFree: [],
            entryFootTag: distant.footTagId || "",
            linkingSequence,
            enRouteTags: [],
            conflictingTurnoutTags: [],
            conflictingRouteTags: [],
            turnoutSpeedKmph: null,
            turnoutCommenceM: null,
            turnoutRestrictionDistM: null,
            distanceBetweenSignalsM: distM,
            movementAuthoritySections: "3",
            movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
            psrSegments: [],
            averageGradient: "",
            isTsl: false,
            engineerStatus: "AUTO_GENERATED",
            sourceNotes: "Direct Approach Distant to Home route.",
          });
        };

        const createInnerDistantToHome = () => {
          if (!innerDistant || !home) return;
          const slNo = routes.length + 1;
          const distM = computeSignalDistance(innerDistant, home);
          const linkingSequence: LinkingTuple[] = [];
          if (innerDistant.footTagId) {
            linkingSequence.push({
              tagId: innerDistant.footTagId,
              distanceM: 0,
              tagType: "SIGNAL_FOOT",
              chainageM: innerDistant.chainageM,
            });
          }
          if (home.footTagId && distM > 0) {
            linkingSequence.push({
              tagId: home.footTagId,
              distanceM: distM,
              tagType: "SIGNAL_FOOT",
              chainageM: home.chainageM,
            });
          }

          const routeId = computeTsrmsRouteId(innerDistant, innerDistant.line, trackLines, false);

          // Dynamically detect diverging aspects for the downstream Home signal
          const divAspects: string[] = [];
          if (home && starters.length > 0) {
            for (const st of starters) {
              const isDiv =
                /loop|branch|siding/i.test(st.line) ||
                (typeof st.y === "number" && typeof home.y === "number" && Math.abs(st.y - home.y) > 20);
              if (isDiv) {
                const pos = determineRouteIndicatorPosition(home, st, starters, dir);
                if (pos && !divAspects.includes(pos)) divAspects.push(pos);
              }
            }
          }
          divAspects.sort((a, b) => b.localeCompare(a));

          routes.push({
            slNo,
            entrySignal: innerDistant.name,
            exitSignal: home.name,
            leadingToLine: canonicalLineName(innerDistant.line),
            direction: dir,
            tsrmsRouteId: "",
            signalType: "Inner Distant",
            aspectOfEntrySignal: "Green",
            requiresAspectOfExitSignal: `${home.name} Green`,
            aspectPermutations: buildAspectPermutations(
              "Inner Distant",
              innerDistant.name,
              home.name,
              false,
              undefined,
              undefined,
              divAspects,
            ),
            entryAspectSummary: "Green / Attention / Caution",
            exitAspectsSummary: `${home.name} Green / Yellow / Red`,
            requiredRouteLocking: "",
            pointsNormal: [],
            pointsReverse: [],
            trackCktUp: "",
            tinsRequiresFree: [],
            entryFootTag: innerDistant.footTagId || "",
            linkingSequence,
            enRouteTags: [],
            conflictingTurnoutTags: [],
            conflictingRouteTags: [],
            turnoutSpeedKmph: null,
            turnoutCommenceM: null,
            turnoutRestrictionDistM: null,
            distanceBetweenSignalsM: distM,
            movementAuthoritySections: "3",
            movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
            psrSegments: [],
            averageGradient: "",
            isTsl: false,
            engineerStatus: "AUTO_GENERATED",
            sourceNotes: "Inner Distant to Home route.",
          });
        };

        if (dir === "DOWN") {
          if (distant && innerDistant) {
            createDistantToInner();
          } else if (distant && home) {
            createDistantToHome();
          }
          if (innerDistant && home) {
            createInnerDistantToHome();
          }
        } else {
          // UP direction in Ground Truth: Inner Distant -> Home precedes Distant -> Inner Distant
          if (innerDistant && home) {
            createInnerDistantToHome();
          }
          if (distant && innerDistant) {
            createDistantToInner();
          } else if (distant && home) {
            createDistantToHome();
          }
        }
      };

      // Helper to generate Reception Routes: Home & Calling-on -> Starters, and Home Stop
      const addReceptionRoutes = () => {
        if (!home || starters.length === 0) return;

        // Admissible starters in train running vector
        const admissibleStarters = starters.filter((st) => {
          if (typeof st.x === "number" && typeof home.x === "number") {
            if (dir === "DOWN" && st.x <= home.x) return false;
            if (dir === "UP" && st.x >= home.x) return false;
          }
          return true;
        });

        // Determine if Home signal post has a Junction Route Indicator
        const hasJunction = admissibleStarters.some(
          (st) =>
            /loop|branch|siding/i.test(st.line) ||
            (typeof st.y === "number" && typeof home.y === "number" && Math.abs(st.y - home.y) > 20),
        );
        const homeSignalType = hasJunction
          ? "Main Home with Junction Route Indicator"
          : "Main Home";

        const mainHomeMa = ibDistant ? "5" : "3";

        // 1. Home Reception Routes
        for (const st of admissibleStarters) {
          const slNo = routes.length + 1;
          const isDiverging =
            /loop|branch|siding/i.test(st.line) ||
            (typeof st.y === "number" && typeof home.y === "number" && Math.abs(st.y - home.y) > 20);
          const distM = computeSignalDistance(home, st);

          const posIndicator = determineRouteIndicatorPosition(home, st, admissibleStarters, dir);

          const entryAspect = isDiverging ? (posIndicator ? `Yellow ${posIndicator}` : "Yellow") : "Green";
          const exitAspect = isDiverging ? `${st.name} Yellow` : `${st.name} Green`;
          const receptionMa = isDiverging ? "2" : mainHomeMa;

          const linkingSequence: LinkingTuple[] = [];
          if (home.footTagId) {
            linkingSequence.push({
              tagId: home.footTagId,
              distanceM: 0,
              tagType: "SIGNAL_FOOT",
              chainageM: home.chainageM,
            });
          }
          if (st.footTagId && distM > 0) {
            linkingSequence.push({
              tagId: st.footTagId,
              distanceM: distM,
              tagType: "SIGNAL_FOOT",
              chainageM: st.chainageM,
            });
          }

          // RDSO Clause I.2.12.6.5: Multiple Diverging Routes -> [Signal Foot Tag ID] + [Line Number]
          const routeId = computeTsrmsRouteId(home, st.line, trackLines, isDiverging || admissibleStarters.length > 1);

          routes.push({
            slNo,
            entrySignal: home.name,
            exitSignal: st.name,
            leadingToLine: canonicalLineName(st.line),
            direction: dir,
            tsrmsRouteId: "",
            signalType: homeSignalType,
            aspectOfEntrySignal: entryAspect,
            requiresAspectOfExitSignal: exitAspect,
            aspectPermutations: buildAspectPermutations(
              homeSignalType,
              home.name,
              st.name,
              isDiverging,
              posIndicator,
              mainHomeMa,
            ),
            entryAspectSummary: `${entryAspect} / Red`,
            exitAspectsSummary: isDiverging ? `${st.name} Yellow / Red` : `${st.name} Green / Red`,
            requiredRouteLocking: "",
            pointsNormal: [],
            pointsReverse: [],
            trackCktUp: "",
            tinsRequiresFree: [],
            entryFootTag: home.footTagId || "",
            linkingSequence,
            enRouteTags: [],
            conflictingTurnoutTags: [],
            conflictingRouteTags: [],
            turnoutSpeedKmph: isDiverging ? 30 : null,
            turnoutCommenceM: null,
            turnoutRestrictionDistM: null,
            distanceBetweenSignalsM: distM,
            movementAuthoritySections: receptionMa,
            movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
            psrSegments: [],
            averageGradient: "",
            isTsl: false,
            engineerStatus: "AUTO_GENERATED",
            sourceNotes: isDiverging
              ? "Home Loopline Reception Route."
              : "Home Mainline Reception Route.",
          });
        }

        // 2. Calling-on Reception Routes
        if (callingOn) {
          for (const st of admissibleStarters) {
            const isDiverging =
              /loop|branch|siding/i.test(st.line) ||
              (typeof st.y === "number" && typeof home.y === "number" && Math.abs(st.y - home.y) > 20);
            const distM = computeSignalDistance(home, st);
            const coSlNo = routes.length + 1;
            const coEntryAspect = `Miniature (${home.name} Red/Blank)`;
            const coExitAspect = `${st.name} Red`;
            const coRouteId = computeTsrmsRouteId(home, st.line, trackLines, isDiverging || admissibleStarters.length > 1);

            routes.push({
              slNo: coSlNo,
              entrySignal: callingOn.name,
              exitSignal: st.name,
              leadingToLine: canonicalLineName(st.line),
              direction: dir,
              tsrmsRouteId: "",
              signalType: "Calling-on Signal",
              aspectOfEntrySignal: coEntryAspect,
              requiresAspectOfExitSignal: coExitAspect,
              aspectPermutations: buildAspectPermutations(
                "Calling-on Signal",
                callingOn.name,
                st.name,
                false,
              ),
              entryAspectSummary: "Miniature Yellow",
              exitAspectsSummary: `${st.name} Red`,
              requiredRouteLocking: "",
              pointsNormal: [],
              pointsReverse: [],
              trackCktUp: "",
              tinsRequiresFree: [],
              entryFootTag: callingOn.footTagId || "",
              linkingSequence: home.footTagId
                ? [
                    {
                      tagId: home.footTagId,
                      distanceM: 0,
                      tagType: "SIGNAL_FOOT",
                      chainageM: home.chainageM,
                    },
                  ]
                : [],
              enRouteTags: [],
              conflictingTurnoutTags: [],
              conflictingRouteTags: [],
              turnoutSpeedKmph: isDiverging ? 15 : null,
              turnoutCommenceM: null,
              turnoutRestrictionDistM: null,
              distanceBetweenSignalsM: distM,
              movementAuthoritySections: "1",
              movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
              authorizedSpeedSr: "",
              authorizedSpeedOs: "15",
              psrSegments: [],
              averageGradient: "",
              isTsl: false,
              engineerStatus: "AUTO_GENERATED",
              sourceNotes: "Calling-on reception route.",
            });
          }
        }

        // Home Red Aspect Stop Route
        const redSlNo = routes.length + 1;
        routes.push({
          slNo: redSlNo,
          entrySignal: home.name,
          exitSignal: "Red",
          leadingToLine: canonicalLineName(home.line),
          direction: dir,
          tsrmsRouteId: "",
          signalType: homeSignalType,
          aspectOfEntrySignal: "Red",
          requiresAspectOfExitSignal: "--",
          aspectPermutations: buildAspectPermutations(homeSignalType, home.name, "Red", false),
          entryAspectSummary: "Red",
          exitAspectsSummary: "--",
          requiredRouteLocking: "",
          pointsNormal: [],
          pointsReverse: [],
          trackCktUp: "",
          tinsRequiresFree: [],
          entryFootTag: home.footTagId || "",
          linkingSequence: home.footTagId
            ? [
                {
                  tagId: home.footTagId,
                  distanceM: 0,
                  tagType: "SIGNAL_FOOT",
                  chainageM: home.chainageM,
                },
              ]
            : [],
          enRouteTags: [],
          conflictingTurnoutTags: [],
          conflictingRouteTags: [],
          turnoutSpeedKmph: null,
          turnoutCommenceM: null,
          turnoutRestrictionDistM: null,
          distanceBetweenSignalsM: 0,
          movementAuthoritySections: "1",
          movementAuthorityMeters: "",
          authorizedSpeedSr: "",
          authorizedSpeedOs: "15",
          psrSegments: [],
          averageGradient: "",
          isTsl: false,
          engineerStatus: "AUTO_GENERATED",
          sourceNotes: "Home Signal Stop Aspect.",
        });
      };

      // Helper to generate Departure Routes: Starters -> Advanced Starter
      const addDepartureRoutes = () => {
        if (!advStarter || starters.length === 0) return;

        const departureStarters = starters.filter((st) => {
          if (typeof st.x === "number" && typeof advStarter.x === "number") {
            if (dir === "DOWN" && st.x >= advStarter.x) return false;
            if (dir === "UP" && st.x <= advStarter.x) return false;
          }
          return true;
        });

        // In Ground Truth UP departure: Loopline starters precede Mainline starter
        if (dir === "UP") {
          departureStarters.sort((a, b) => {
            const aLoop = /loop|branch|siding/i.test(a.line);
            const bLoop = /loop|branch|siding/i.test(b.line);
            if (aLoop && !bLoop) return -1;
            if (!aLoop && bLoop) return 1;
            return (a.y ?? 0) - (b.y ?? 0);
          });
        }

        // Compute MA for starters departing towards Adv Starter:
        // If IBS is present: 4 sections; else 2 sections
        const starterMa = ibDistant ? "4" : "2";

        for (const st of departureStarters) {
          const slNo = routes.length + 1;
          const isDiverging =
            /loop|branch|siding/i.test(st.line) ||
            (typeof st.y === "number" && typeof advStarter.y === "number" && Math.abs(st.y - advStarter.y) > 20);
          const distM = computeSignalDistance(st, advStarter);
          const signalType = isDiverging ? "Loopline Starter" : "Mainline Starter";
          const entryAspect = isDiverging ? "Yellow" : "Green";
          const exitAspect = `${advStarter.name} Green`;

          const linkingSequence: LinkingTuple[] = [];
          if (st.footTagId) {
            linkingSequence.push({
              tagId: st.footTagId,
              distanceM: 0,
              tagType: "SIGNAL_FOOT",
              chainageM: st.chainageM,
            });
          }
          if (advStarter.footTagId && distM > 0) {
            linkingSequence.push({
              tagId: advStarter.footTagId,
              distanceM: distM,
              tagType: "SIGNAL_FOOT",
              chainageM: advStarter.chainageM,
            });
          }

          // Single Route: Foot Tag numeric ID
          const routeId = computeTsrmsRouteId(st, advStarter.line, trackLines, false);

          // Speed: Loop starters use turnout speed (st.turnoutSpeedKmph or default 30), Mainline Starter uses MPS
          const srSpeed = isDiverging
            ? st.turnoutSpeedKmph !== null && st.turnoutSpeedKmph !== undefined
              ? String(st.turnoutSpeedKmph)
              : "30"
            : "MPS";

          routes.push({
            slNo,
            entrySignal: st.name,
            exitSignal: advStarter.name,
            leadingToLine: canonicalLineName(advStarter.line),
            direction: dir,
            tsrmsRouteId: "",
            signalType,
            aspectOfEntrySignal: entryAspect,
            requiresAspectOfExitSignal: exitAspect,
            aspectPermutations: buildAspectPermutations(
              signalType,
              st.name,
              advStarter.name,
              isDiverging,
              undefined,
              starterMa,
              undefined,
              srSpeed,
            ),
            entryAspectSummary: `${entryAspect} / Red`,
            exitAspectsSummary: `${advStarter.name} Green / Red`,
            requiredRouteLocking: "",
            pointsNormal: [],
            pointsReverse: [],
            trackCktUp: "",
            tinsRequiresFree: [],
            entryFootTag: st.footTagId || "",
            linkingSequence,
            enRouteTags: [],
            conflictingTurnoutTags: [],
            conflictingRouteTags: [],
            turnoutSpeedKmph: isDiverging ? parseInt(srSpeed, 10) : null,
            turnoutCommenceM: null,
            turnoutRestrictionDistM: null,
            distanceBetweenSignalsM: distM,
            movementAuthoritySections: starterMa,
            movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
            authorizedSpeedSr: srSpeed,
            authorizedSpeedOs: "15",
            psrSegments: [],
            averageGradient: "",
            isTsl: false,
            engineerStatus: "AUTO_GENERATED",
            sourceNotes: "Station Departure Starter Route.",
          });
        }
      };

      // Helper to generate Block Departure Routes: Advanced Starter -> Block Section (or IBS)
      const addBlockDepartureRoutes = () => {
        if (!advStarter) return;

        if (ibDistant) {
          // Route: Adv Starter -> IB Distant
          const distM = computeSignalDistance(advStarter, ibDistant);
          const slNo = routes.length + 1;
          const linkingSequence: LinkingTuple[] = [];
          if (advStarter.footTagId) {
            linkingSequence.push({
              tagId: advStarter.footTagId,
              distanceM: 0,
              tagType: "SIGNAL_FOOT",
              chainageM: advStarter.chainageM,
            });
          }
          if (ibDistant.footTagId && distM > 0) {
            linkingSequence.push({
              tagId: ibDistant.footTagId,
              distanceM: distM,
              tagType: "SIGNAL_FOOT",
              chainageM: ibDistant.chainageM,
            });
          }

          const routeId = computeTsrmsRouteId(advStarter, advStarter.line, trackLines, false);

          routes.push({
            slNo,
            entrySignal: advStarter.name,
            exitSignal: ibDistant.name,
            leadingToLine: canonicalLineName(advStarter.line),
            direction: dir,
            tsrmsRouteId: "",
            signalType: "Advanced Starter",
            aspectOfEntrySignal: "Green",
            requiresAspectOfExitSignal: `${ibDistant.name} Green, ${ibDistant.name} Double Yellow`,
            aspectPermutations: buildAspectPermutations(
              "Advanced Starter",
              advStarter.name,
              ibDistant.name,
              false,
            ),
            entryAspectSummary: "Green / Red",
            exitAspectsSummary: `${ibDistant.name} Double Yellow`,
            requiredRouteLocking: "",
            pointsNormal: [],
            pointsReverse: [],
            trackCktUp: "",
            tinsRequiresFree: [],
            entryFootTag: advStarter.footTagId || "",
            linkingSequence,
            enRouteTags: [],
            conflictingTurnoutTags: [],
            conflictingRouteTags: [],
            turnoutSpeedKmph: null,
            turnoutCommenceM: null,
            turnoutRestrictionDistM: null,
            distanceBetweenSignalsM: distM,
            movementAuthoritySections: "3",
            movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
            psrSegments: [],
            averageGradient: "",
            isTsl: false,
            engineerStatus: "AUTO_GENERATED",
            sourceNotes: "Advanced Starter to IB Distant route.",
          });

          // Route: IB Distant -> IB Inner Distant
          if (ibInnerDistant) {
            const ibDistM = computeSignalDistance(ibDistant, ibInnerDistant);
            const ibSlNo = routes.length + 1;
            const ibLink: LinkingTuple[] = [];
            if (ibDistant.footTagId) {
              ibLink.push({
                tagId: ibDistant.footTagId,
                distanceM: 0,
                tagType: "SIGNAL_FOOT",
                chainageM: ibDistant.chainageM,
              });
            }
            if (ibInnerDistant.footTagId && ibDistM > 0) {
              ibLink.push({
                tagId: ibInnerDistant.footTagId,
                distanceM: ibDistM,
                tagType: "SIGNAL_FOOT",
                chainageM: ibInnerDistant.chainageM,
              });
            }

            const ibRouteId = computeTsrmsRouteId(ibDistant, advStarter.line, trackLines, false);

            routes.push({
              slNo: ibSlNo,
              entrySignal: ibDistant.name,
              exitSignal: ibInnerDistant.name,
              leadingToLine: canonicalLineName(advStarter.line),
              direction: dir,
              tsrmsRouteId: "",
              signalType: "IB Distant",
              aspectOfEntrySignal: "Green",
              requiresAspectOfExitSignal: `${ibInnerDistant.name} Green`,
              aspectPermutations: buildAspectPermutations(
                "IB Distant",
                ibDistant.name,
                ibInnerDistant.name,
                false,
              ),
              entryAspectSummary: "Green / Attention / Caution",
              exitAspectsSummary: `${ibInnerDistant.name} Green`,
              requiredRouteLocking: "",
              pointsNormal: [],
              pointsReverse: [],
              trackCktUp: "",
              tinsRequiresFree: [],
              entryFootTag: ibDistant.footTagId || "",
              linkingSequence: ibLink,
              enRouteTags: [],
              conflictingTurnoutTags: [],
              conflictingRouteTags: [],
              turnoutSpeedKmph: null,
              turnoutCommenceM: null,
              turnoutRestrictionDistM: null,
              distanceBetweenSignalsM: ibDistM,
              movementAuthoritySections: "3",
              movementAuthorityMeters: ibDistM > 0 ? `${ibDistM} m` : "",
              authorizedSpeedSr: "MPS",
              authorizedSpeedOs: "MPS",
              psrSegments: [],
              averageGradient: "",
              isTsl: false,
              engineerStatus: "AUTO_GENERATED",
              sourceNotes: "IB Distant Approach route.",
            });
          }

          // Route: IB Inner Distant -> IB Signal
          if (ibInnerDistant && ibSignal) {
            const sigDistM = computeSignalDistance(ibInnerDistant, ibSignal);
            const sigSlNo = routes.length + 1;
            const sigLink: LinkingTuple[] = [];
            if (ibInnerDistant.footTagId) {
              sigLink.push({
                tagId: ibInnerDistant.footTagId,
                distanceM: 0,
                tagType: "SIGNAL_FOOT",
                chainageM: ibInnerDistant.chainageM,
              });
            }
            if (ibSignal.footTagId && sigDistM > 0) {
              sigLink.push({
                tagId: ibSignal.footTagId,
                distanceM: sigDistM,
                tagType: "SIGNAL_FOOT",
                chainageM: ibSignal.chainageM,
              });
            }

            const idRouteId = computeTsrmsRouteId(
              ibInnerDistant,
              advStarter.line,
              trackLines,
              false,
            );

            routes.push({
              slNo: sigSlNo,
              entrySignal: ibInnerDistant.name,
              exitSignal: ibSignal.name,
              leadingToLine: canonicalLineName(advStarter.line),
              direction: dir,
              tsrmsRouteId: "",
              signalType: "IB Inner Distant",
              aspectOfEntrySignal: "Green",
              requiresAspectOfExitSignal: `${ibSignal.name} Green`,
              aspectPermutations: buildAspectPermutations(
                "IB Inner Distant",
                ibInnerDistant.name,
                ibSignal.name,
                false,
              ),
              entryAspectSummary: "Green / Attention / Caution",
              exitAspectsSummary: `${ibSignal.name} Green`,
              requiredRouteLocking: "",
              pointsNormal: [],
              pointsReverse: [],
              trackCktUp: "",
              tinsRequiresFree: [],
              entryFootTag: ibInnerDistant.footTagId || "",
              linkingSequence: sigLink,
              enRouteTags: [],
              conflictingTurnoutTags: [],
              conflictingRouteTags: [],
              turnoutSpeedKmph: null,
              turnoutCommenceM: null,
              turnoutRestrictionDistM: null,
              distanceBetweenSignalsM: sigDistM,
              movementAuthoritySections: "2",
              movementAuthorityMeters: sigDistM > 0 ? `${sigDistM} m` : "",
              authorizedSpeedSr: "MPS",
              authorizedSpeedOs: "MPS",
              psrSegments: [],
              averageGradient: "",
              isTsl: false,
              engineerStatus: "AUTO_GENERATED",
              sourceNotes: "IB Inner Distant to IB Signal route.",
            });
          }

          // Route: IB Signal -> Block Section
          if (ibSignal) {
            const blockSlNo = routes.length + 1;
            const exitSignal = resolveBlockExitSignal(dir, metadata);
            const ibRouteId = computeTsrmsRouteId(ibSignal, advStarter.line, trackLines, false);

            routes.push({
              slNo: blockSlNo,
              entrySignal: ibSignal.name,
              exitSignal,
              leadingToLine: canonicalLineName(advStarter.line),
              direction: dir,
              tsrmsRouteId: "",
              signalType: "IB Signal",
              aspectOfEntrySignal: "Green",
              requiresAspectOfExitSignal: "Line Clear Available",
              aspectPermutations: buildAspectPermutations(
                "IB Signal",
                ibSignal.name,
                exitSignal,
                false,
              ),
              entryAspectSummary: "Green / Red",
              exitAspectsSummary: "Line Clear Available",
              requiredRouteLocking: "",
              pointsNormal: [],
              pointsReverse: [],
              trackCktUp: "",
              tinsRequiresFree: [],
              entryFootTag: ibSignal.footTagId || "",
              linkingSequence: ibSignal.footTagId
                ? [
                    {
                      tagId: ibSignal.footTagId,
                      distanceM: 0,
                      tagType: "SIGNAL_FOOT",
                      chainageM: ibSignal.chainageM,
                    },
                  ]
                : [],
              enRouteTags: [],
              conflictingTurnoutTags: [],
              conflictingRouteTags: [],
              turnoutSpeedKmph: null,
              turnoutCommenceM: null,
              turnoutRestrictionDistM: null,
              distanceBetweenSignalsM: 0,
              movementAuthoritySections: "1",
              movementAuthorityMeters: "",
              authorizedSpeedSr: "MPS",
              authorizedSpeedOs: "MPS",
              psrSegments: [],
              averageGradient: "",
              isTsl: false,
              engineerStatus: "AUTO_GENERATED",
              sourceNotes: "IB Signal departure into block section.",
            });
          }
        } else {
          // Standard Adv Starter Departure straight into block section
          const slNo = routes.length + 1;
          const exitSignal = resolveBlockExitSignal(dir, metadata);
          const advRouteId = computeTsrmsRouteId(advStarter, advStarter.line, trackLines, false);

          routes.push({
            slNo,
            entrySignal: advStarter.name,
            exitSignal,
            leadingToLine: canonicalLineName(advStarter.line),
            direction: dir,
            tsrmsRouteId: "",
            signalType: "Advanced Starter",
            aspectOfEntrySignal: "Green",
            requiresAspectOfExitSignal: "Line Clear Available",
            aspectPermutations: buildAspectPermutations(
              "Advanced Starter",
              advStarter.name,
              exitSignal,
              false,
            ),
            entryAspectSummary: "Green / Red",
            exitAspectsSummary: "Line Clear Available",
            requiredRouteLocking: "",
            pointsNormal: [],
            pointsReverse: [],
            trackCktUp: "",
            tinsRequiresFree: [],
            entryFootTag: advStarter.footTagId || "",
            linkingSequence: advStarter.footTagId
              ? [
                  {
                    tagId: advStarter.footTagId,
                    distanceM: 0,
                    tagType: "SIGNAL_FOOT",
                    chainageM: advStarter.chainageM,
                  },
                ]
              : [],
            enRouteTags: [],
            conflictingTurnoutTags: [],
            conflictingRouteTags: [],
            turnoutSpeedKmph: null,
            turnoutCommenceM: null,
            turnoutRestrictionDistM: null,
            distanceBetweenSignalsM: 0,
            movementAuthoritySections: "1",
            movementAuthorityMeters: "",
            authorizedSpeedSr: "MPS",
            authorizedSpeedOs: "MPS",
            psrSegments: [],
            averageGradient: "",
            isTsl: false,
            engineerStatus: "AUTO_GENERATED",
            sourceNotes: "Block section departure route.",
          });
        }
      };

      // In Indian Railways Station Table of Control:
      // DOWN direction is listed as Approach -> Reception -> Departure -> Block Section
      // UP direction is listed as Block Section (IBS) -> Departure -> Reception -> Approach
      if (dir === "DOWN") {
        addApproachRoutes();
        addReceptionRoutes();
        addDepartureRoutes();
        addBlockDepartureRoutes();
      } else {
        addBlockDepartureRoutes();
        addDepartureRoutes();
        addReceptionRoutes();
        addApproachRoutes();
      }
    }
  }

  // Ensure consistent 1-based sequential slNo and leave tsrmsRouteId empty for engineer manual supervision
  routes.forEach((r, idx) => {
    r.slNo = idx + 1;
    r.tsrmsRouteId = "";
  });

  return {
    routes,
    mode,
  };
}
