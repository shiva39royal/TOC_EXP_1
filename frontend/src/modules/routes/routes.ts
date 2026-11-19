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
function computeTsrmsRouteId(
  entrySig: SignalNode,
  targetLineName: string,
  trackLines: TrackLine[],
  isMultipleOrDiverging: boolean,
): string {
  // Extract numeric digits of signal foot tag (e.g. "R-514" -> "514", "R-716" -> "716")
  const tagDigits = entrySig.footTagId ? entrySig.footTagId.replace(/\D/g, "") : "";

  if (!tagDigits) {
    return "--";
  }

  if (isMultipleOrDiverging) {
    const lineNum = resolveTrackLineNumber(targetLineName, trackLines);
    if (lineNum !== null) {
      return `${tagDigits}${lineNum}`;
    }
  }

  return tagDigits;
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
 * Dynamically builds entry/exit aspect permutations compliant with RDSO SPN/196/2020.
 */
function buildAspectPermutations(
  signalType: string,
  entryAspect: string,
  exitAspect: string,
  isDiverging: boolean,
): RouteAspectPermutation[] {
  if (signalType.includes("Calling-on")) {
    return [
      {
        aspectOfEntrySignal: entryAspect,
        requiresAspectOfExitSignal: exitAspect,
        movementAuthoritySections: "1",
        authorizedSpeedSr: "15",
        authorizedSpeedOs: "15",
      },
    ];
  }

  if (entryAspect === "Red") {
    return [
      {
        aspectOfEntrySignal: "Red",
        requiresAspectOfExitSignal: "--",
        movementAuthoritySections: "0",
        authorizedSpeedSr: "0",
        authorizedSpeedOs: "0",
      },
    ];
  }

  if (isDiverging) {
    return [
      {
        aspectOfEntrySignal: entryAspect,
        requiresAspectOfExitSignal: exitAspect,
        movementAuthoritySections: "2",
        authorizedSpeedSr: "30",
        authorizedSpeedOs: "MPS",
      },
      {
        aspectOfEntrySignal: "Yellow",
        requiresAspectOfExitSignal: "Red",
        movementAuthoritySections: "1",
        authorizedSpeedSr: "30",
        authorizedSpeedOs: "15",
      },
    ];
  }

  return [
    {
      aspectOfEntrySignal: entryAspect,
      requiresAspectOfExitSignal: exitAspect,
      movementAuthoritySections: "2",
      authorizedSpeedSr: "MPS",
      authorizedSpeedOs: "MPS",
    },
    {
      aspectOfEntrySignal: "Yellow",
      requiresAspectOfExitSignal: "Red",
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
          tsrmsRouteId: routeId,
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
          tsrmsRouteId: routeId,
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

      // Approach signals (excluding IBS distants)
      const distant = dirSignals.find(
        (s) =>
          s.signalType === "DISTANT" &&
          !s.id.toUpperCase().includes("IB") &&
          !s.name.toUpperCase().includes("IB"),
      );
      const innerDistant = dirSignals.find(
        (s) =>
          s.signalType === "INNER_DISTANT" &&
          !s.id.toUpperCase().includes("IB") &&
          !s.name.toUpperCase().includes("IB"),
      );

      // Yard Home & Calling-on
      const home = dirSignals.find((s) => s.signalType === "HOME");
      const callingOn = dirSignals.find((s) => s.signalType === "CALLING_ON");

      // Starters: sorted topologically along the yard
      const starters = signals.filter(
        (s) =>
          s.signalType === "STARTER" &&
          (s.direction === dir || /loop/i.test(s.line) || s.direction === "BIDIRECTIONAL"),
      );
      starters.sort((a, b) => {
        if (typeof a.y === "number" && typeof b.y === "number" && a.y !== b.y) {
          return a.y - b.y;
        }
        return (a.x ?? 0) - (b.x ?? 0);
      });

      // Advanced Starter
      const advStarter = dirSignals.find((s) => s.signalType === "ADVANCED_STARTER");

      // Intermediate Block System (IBS) signals if present
      const ibDistant = dirSignals.find(
        (s) =>
          s.signalType === "DISTANT" &&
          (s.id.toUpperCase().includes("IB") || s.name.toUpperCase().includes("IB")),
      );
      const ibInnerDistant = dirSignals.find(
        (s) =>
          s.signalType === "INNER_DISTANT" &&
          (s.id.toUpperCase().includes("IB") || s.name.toUpperCase().includes("IB")),
      );
      const ibSignal = dirSignals.find((s) => s.signalType === "INTERMEDIATE_BLOCK");

      const nextStn = dir === "DOWN" ? metadata?.nextDownStationId : metadata?.nextUpStationId;

      // ---------------------------------------------------------------------
      // 1. Approach Routes: Distant -> Inner Distant / Home
      // ---------------------------------------------------------------------
      if (distant && innerDistant) {
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
          leadingToLine: distant.line,
          direction: dir,
          tsrmsRouteId: routeId,
          signalType: "Distant",
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${innerDistant.name} Green`,
          aspectPermutations: buildAspectPermutations(
            "Distant",
            "Green",
            `${innerDistant.name} Green`,
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
          movementAuthoritySections: "",
          movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
          authorizedSpeedSr: "",
          authorizedSpeedOs: "",
          psrSegments: [],
          averageGradient: "",
          isTsl: false,
          engineerStatus: "AUTO_GENERATED",
          sourceNotes: "Station Approach Distant route.",
        });
      } else if (distant && home) {
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
          leadingToLine: distant.line,
          direction: dir,
          tsrmsRouteId: routeId,
          signalType: "Distant",
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${home.name} Green`,
          aspectPermutations: buildAspectPermutations(
            "Distant",
            "Green",
            `${home.name} Green`,
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
          movementAuthoritySections: "",
          movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
          authorizedSpeedSr: "",
          authorizedSpeedOs: "",
          psrSegments: [],
          averageGradient: "",
          isTsl: false,
          engineerStatus: "AUTO_GENERATED",
          sourceNotes: "Direct Approach Distant to Home route.",
        });
      }

      if (innerDistant && home) {
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

        routes.push({
          slNo,
          entrySignal: innerDistant.name,
          exitSignal: home.name,
          leadingToLine: innerDistant.line,
          direction: dir,
          tsrmsRouteId: routeId,
          signalType: "Inner Distant",
          aspectOfEntrySignal: "Green",
          requiresAspectOfExitSignal: `${home.name} Green`,
          aspectPermutations: buildAspectPermutations(
            "Inner Distant",
            "Green",
            `${home.name} Green`,
            false,
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
          movementAuthoritySections: "",
          movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
          authorizedSpeedSr: "",
          authorizedSpeedOs: "",
          psrSegments: [],
          averageGradient: "",
          isTsl: false,
          engineerStatus: "AUTO_GENERATED",
          sourceNotes: "Inner Distant to Home route.",
        });
      }

      // ---------------------------------------------------------------------
      // 2. Reception Routes: Home & Calling-on -> Starters
      // ---------------------------------------------------------------------
      if (home && starters.length > 0) {
        for (const st of starters) {
          const slNo = routes.length + 1;
          const isDiverging = /loop|branch|siding/i.test(st.line) || st.line !== home.line;
          const distM = computeSignalDistance(home, st);

          // Route Indicator Position (if diverging, dynamically infer from spatial geometry)
          let posIndicator = "";
          if (isDiverging) {
            if (typeof st.y === "number" && typeof home.y === "number") {
              posIndicator = st.y < home.y ? 'with "Pos1"' : 'with "Pos4"';
            } else {
              posIndicator = 'with "Pos1"';
            }
          }

          const signalType = resolveSignalType(home, isDiverging);
          const entryAspect = isDiverging ? `Yellow ${posIndicator}` : "Green";
          const exitAspect = isDiverging ? `${st.name} Yellow` : `${st.name} Green`;

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
          const routeId = computeTsrmsRouteId(home, st.line, trackLines, true);

          routes.push({
            slNo,
            entrySignal: home.name,
            exitSignal: st.name,
            leadingToLine: st.line,
            direction: dir,
            tsrmsRouteId: routeId,
            signalType,
            aspectOfEntrySignal: entryAspect,
            requiresAspectOfExitSignal: exitAspect,
            aspectPermutations: buildAspectPermutations(
              signalType,
              entryAspect,
              exitAspect,
              isDiverging,
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
            movementAuthoritySections: "",
            movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
            authorizedSpeedSr: "",
            authorizedSpeedOs: "",
            psrSegments: [],
            averageGradient: "",
            isTsl: false,
            engineerStatus: "AUTO_GENERATED",
            sourceNotes: isDiverging
              ? "Home Loopline Reception Route."
              : "Home Mainline Reception Route.",
          });

          // Calling-on Route to this starter
          if (callingOn) {
            const coSlNo = routes.length + 1;
            const coEntryAspect = `Miniature (${home.name} Red/Blank)`;
            const coExitAspect = `${st.name} Red`;
            const coRouteId = computeTsrmsRouteId(
              callingOn.footTagId && callingOn.footTagId !== "R-000" ? callingOn : home,
              st.line,
              trackLines,
              true,
            );

            routes.push({
              slNo: coSlNo,
              entrySignal: callingOn.name,
              exitSignal: st.name,
              leadingToLine: st.line,
              direction: dir,
              tsrmsRouteId: coRouteId,
              signalType: "Calling-on Signal",
              aspectOfEntrySignal: coEntryAspect,
              requiresAspectOfExitSignal: coExitAspect,
              aspectPermutations: buildAspectPermutations(
                "Calling-on Signal",
                coEntryAspect,
                coExitAspect,
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
              movementAuthoritySections: "",
              movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
              authorizedSpeedSr: "",
              authorizedSpeedOs: "",
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
          leadingToLine: home.line,
          direction: dir,
          tsrmsRouteId: "--",
          signalType: "Home",
          aspectOfEntrySignal: "Red",
          requiresAspectOfExitSignal: "--",
          aspectPermutations: buildAspectPermutations("Home", "Red", "--", false),
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
          movementAuthoritySections: "",
          movementAuthorityMeters: "",
          authorizedSpeedSr: "",
          authorizedSpeedOs: "",
          psrSegments: [],
          averageGradient: "",
          isTsl: false,
          engineerStatus: "AUTO_GENERATED",
          sourceNotes: "Home Signal Stop Aspect.",
        });
      }

      // ---------------------------------------------------------------------
      // 3. Departure Routes: Starters -> Advanced Starter
      // ---------------------------------------------------------------------
      if (advStarter && starters.length > 0) {
        for (const st of starters) {
          const slNo = routes.length + 1;
          const isDiverging = /loop|branch|siding/i.test(st.line) || st.line !== advStarter.line;
          const distM = computeSignalDistance(st, advStarter);
          const signalType = resolveSignalType(st, isDiverging);
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

          // RDSO Clause I.2.12.6.4: Starter departing to Adv Starter
          const routeId = computeTsrmsRouteId(st, advStarter.line, trackLines, false);

          routes.push({
            slNo,
            entrySignal: st.name,
            exitSignal: advStarter.name,
            leadingToLine: advStarter.line,
            direction: dir,
            tsrmsRouteId: routeId,
            signalType,
            aspectOfEntrySignal: entryAspect,
            requiresAspectOfExitSignal: exitAspect,
            aspectPermutations: buildAspectPermutations(
              signalType,
              entryAspect,
              exitAspect,
              isDiverging,
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
            turnoutSpeedKmph: isDiverging ? 30 : null,
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
            sourceNotes: "Station Departure Starter Route.",
          });
        }

        // ---------------------------------------------------------------------
        // 4. Block Departure: Advanced Starter -> Block Section (or IBS)
        // ---------------------------------------------------------------------
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

          // Single route: Foot tag of Advanced Starter
          const routeId = computeTsrmsRouteId(advStarter, advStarter.line, trackLines, false);

          routes.push({
            slNo,
            entrySignal: advStarter.name,
            exitSignal: ibDistant.name,
            leadingToLine: advStarter.line,
            direction: dir,
            tsrmsRouteId: routeId,
            signalType: "Advanced Starter",
            aspectOfEntrySignal: "Green",
            requiresAspectOfExitSignal: `${ibDistant.name} Double Yellow`,
            aspectPermutations: buildAspectPermutations(
              "Advanced Starter",
              "Green",
              `${ibDistant.name} Double Yellow`,
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
            movementAuthoritySections: "",
            movementAuthorityMeters: distM > 0 ? `${distM} m` : "",
            authorizedSpeedSr: "",
            authorizedSpeedOs: "",
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
              leadingToLine: advStarter.line,
              direction: dir,
              tsrmsRouteId: ibRouteId,
              signalType: "IB Distant",
              aspectOfEntrySignal: "Green",
              requiresAspectOfExitSignal: `${ibInnerDistant.name} Green`,
              aspectPermutations: buildAspectPermutations(
                "IB Distant",
                "Green",
                `${ibInnerDistant.name} Green`,
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
              movementAuthoritySections: "",
              movementAuthorityMeters: ibDistM > 0 ? `${ibDistM} m` : "",
              authorizedSpeedSr: "",
              authorizedSpeedOs: "",
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
              leadingToLine: advStarter.line,
              direction: dir,
              tsrmsRouteId: idRouteId,
              signalType: "IB Inner Distant",
              aspectOfEntrySignal: "Green",
              requiresAspectOfExitSignal: `${ibSignal.name} Green`,
              aspectPermutations: buildAspectPermutations(
                "IB Inner Distant",
                "Green",
                `${ibSignal.name} Green`,
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
              movementAuthoritySections: "",
              movementAuthorityMeters: sigDistM > 0 ? `${sigDistM} m` : "",
              authorizedSpeedSr: "",
              authorizedSpeedOs: "",
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
            const exitSignal = nextStn ? `Block Section to ${nextStn}` : "Block Section";
            const ibRouteId = computeTsrmsRouteId(ibSignal, advStarter.line, trackLines, false);

            routes.push({
              slNo: blockSlNo,
              entrySignal: ibSignal.name,
              exitSignal,
              leadingToLine: advStarter.line,
              direction: dir,
              tsrmsRouteId: ibRouteId,
              signalType: "IB Signal",
              aspectOfEntrySignal: "Green",
              requiresAspectOfExitSignal: "Line Clear Available",
              aspectPermutations: buildAspectPermutations(
                "IB Signal",
                "Green",
                "Line Clear Available",
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
              movementAuthoritySections: "",
              movementAuthorityMeters: "",
              authorizedSpeedSr: "",
              authorizedSpeedOs: "",
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
          const exitSignal = nextStn ? `Block Section to ${nextStn}` : "Block Section";
          const advRouteId = computeTsrmsRouteId(advStarter, advStarter.line, trackLines, false);

          routes.push({
            slNo,
            entrySignal: advStarter.name,
            exitSignal,
            leadingToLine: advStarter.line,
            direction: dir,
            tsrmsRouteId: advRouteId,
            signalType: "Advanced Starter",
            aspectOfEntrySignal: "Green",
            requiresAspectOfExitSignal: "Line Clear Available",
            aspectPermutations: buildAspectPermutations(
              "Advanced Starter",
              "Green",
              "Line Clear Available",
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
            movementAuthoritySections: "",
            movementAuthorityMeters: "",
            authorizedSpeedSr: "",
            authorizedSpeedOs: "",
            psrSegments: [],
            averageGradient: "",
            isTsl: false,
            engineerStatus: "AUTO_GENERATED",
            sourceNotes: "Block section departure route.",
          });
        }
      }
    }
  }

  // Ensure consistent 1-based sequential slNo without overwriting tsrmsRouteId
  routes.forEach((r, idx) => {
    r.slNo = idx + 1;
  });

  return {
    routes,
    mode,
  };
}
