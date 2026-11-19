import type {
  BlockSectionDetail,
  ConfidenceLevel,
  LevelCrossing,
  LinkingTuple,
  PointSwitch,
  SignalNode,
  StationMetadata,
  TocRouteRow,
  TrackLine,
  TrackProfileRow,
  TslRouteRow,
  TsrRouteRow,
} from "@/types/signalling";

export interface TableGeneratorInput {
  routes: TocRouteRow[];
  trackLines: TrackLine[];
  signals: SignalNode[];
  points?: PointSwitch[];
  levelCrossings: LevelCrossing[];
  metadata: StationMetadata;
  rfidTags?: Array<{ id: string; chainageM: number | null; x: number }>;
}

export interface CompleteTocDataset {
  metadata: StationMetadata;
  routes: TocRouteRow[];
  trackProfiles: TrackProfileRow[];
  tsrRoutes: TsrRouteRow[];
  tslRoutes: TslRouteRow[];
  blockSections: BlockSectionDetail[];
  tslBlockSections: BlockSectionDetail[];
  tslTrackProfiles: TrackProfileRow[];
}

export function generateAllTables(input: TableGeneratorInput): CompleteTocDataset {
  const { routes, trackLines, signals, levelCrossings, metadata, rfidTags } = input;

  // 1. Table 2: Stationary KAVACH Track Profile Table (Cl. I.2.12)
  const trackProfiles: TrackProfileRow[] = routes.map((r, idx) => {
    const isDiverging =
      r.pointsReverse.length > 0 ||
      (r.turnoutSpeedKmph !== null && r.turnoutSpeedKmph !== undefined);
    const turnoutSpeed = isDiverging ? (r.turnoutSpeedKmph ?? 30) : null;
    const turnoutStartDist = isDiverging ? (r.turnoutCommenceM ?? null) : null;
    const turnoutLength = isDiverging ? (r.turnoutRestrictionDistM ?? null) : null;

    const matchedLc =
      levelCrossings.find((lc) => {
        if (r.lcGateRequired && lc.name && r.lcGateRequired.includes(lc.name)) return true;
        return false;
      }) || (levelCrossings.length > 0 ? levelCrossings[0] : undefined);

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
      lcId: matchedLc ? matchedLc.name : undefined,
      lcDistanceM: matchedLc?.chainageM ? Math.abs(matchedLc.chainageM) : undefined,
      lcManningType: matchedLc?.manningType,
      lcClass: matchedLc?.lcClass,
      lcAutoWhistlingType: matchedLc?.autoWhistling,
      trackConditionType: "Dead Stop",
      trackConditionStartDistM: r.distanceBetweenSignalsM,
      trackConditionLengthM: 0,
    };
  });

  // 2. Table 3: Stationary KAVACH TSR Route Table (Cl. I.2.12.6)
  const tsrRoutes: TsrRouteRow[] = trackLines.map((track, index) => {
    const lineRoutes = routes.filter(
      (r) => r.leadingToLine.toLowerCase() === track.name.toLowerCase(),
    );
    const firstRoute = lineRoutes[0] || routes[0];
    const entrySig = firstRoute?.entrySignal || "";
    const exitSig = firstRoute?.exitSignal || "";
    const startTag = firstRoute?.entryFootTag || "";
    const tsrRouteId = metadata.stationId ? `${metadata.stationId}${index + 1}` : String(index + 1);

    return {
      slNo: index + 1,
      oheLine: track.name,
      oheLineName: track.name,
      entrySignal: entrySig,
      exitSignal: exitSig,
      tsrRouteId,
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

  // 3. Table 4: Temporary Single Line (TSL) Working on Double Line (Cl. I.2.12.7)
  const tslRoutes: TslRouteRow[] = [];

  // TSL Approach Routes (Distants / Inner Distants)
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
      requiresTrackCktUp: ar.trackCktUp,
      tinsRequiresFree: ar.tinsRequiresFree,
      entryFootTag: ar.entryFootTag,
      linkingSequence: ar.linkingSequence,
      distanceBetweenSignalsM: ar.distanceBetweenSignalsM,
      movementAuthoritySections: ar.movementAuthoritySections,
      authorizedSpeedOsFirstTrain: "25 kmph",
      authorizedSpeedOsSubsequentTrains: "MPS",
    });
  }

  // TSL Wrong-Line Starter Departure Routes
  const downStarters = signals.filter(
    (s) => s.direction === "DOWN" && (s.signalType === "STARTER" || s.signalType === "AUTOMATIC"),
  );
  const upStarters = signals.filter(
    (s) => s.direction === "UP" && (s.signalType === "STARTER" || s.signalType === "AUTOMATIC"),
  );

  const nextDownStn = metadata.nextDownStationId || "Next Down Station";
  const nextUpStn = metadata.nextUpStationId || "Next Up Station";

  for (const st of downStarters) {
    const slNo = tslRoutes.length + 1;
    tslRoutes.push({
      slNo,
      tslEntrySignal: st.name,
      tslExitSignal: `Home of ${nextDownStn} (Wrong Line)`,
      signalType: st.signalType,
      lineOrSignalType: st.line,
      aspectOfEntrySignal: "Yellow",
      requiresAspectOfExitSignal: "Line Clear Available",
      requiredRouteCommand: "TSL_PILOT_OUT",
      pointsNormal: [],
      pointsReverse: [],
      requiresTrackCktUp: "Line Clear Available",
      tinsRequiresFree: [],
      entryFootTag: st.footTagId || "",
      linkingSequence: st.footTagId
        ? [{ tagId: st.footTagId, distanceM: 0, tagType: "SIGNAL_FOOT", chainageM: st.chainageM }]
        : [],
      distanceBetweenSignalsM: 0,
      movementAuthoritySections: "1",
      authorizedSpeedOsFirstTrain: "25 kmph",
      authorizedSpeedOsSubsequentTrains: "MPS",
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

  // 4. Table 5: Dynamic Block Section Details
  const downLss =
    signals.find((s) => s.direction === "DOWN" && s.signalType === "ADVANCED_STARTER") ||
    signals
      .filter(
        (s) =>
          s.direction === "DOWN" && (s.signalType === "AUTOMATIC" || s.signalType === "STARTER"),
      )
      .pop();

  const upLss =
    signals.find((s) => s.direction === "UP" && s.signalType === "ADVANCED_STARTER") ||
    signals
      .filter(
        (s) => s.direction === "UP" && (s.signalType === "AUTOMATIC" || s.signalType === "STARTER"),
      )
      .pop();

  const blockSections: BlockSectionDetail[] = [];
  if (downLss) {
    const nextStnDist = downLss.chainageM ? Math.round(downLss.chainageM * 0.1) : 3000;
    blockSections.push({
      lastStopSignal: downLss.name,
      direction: "Down",
      lastSignalMaMeters: nextStnDist > 0 ? nextStnDist : 3000,
      blockSectionTin: "TIN-DOWN",
      adjacentLineTins: "TIN-UP",
      nextStationId: metadata.nextDownStationId || "----",
      nextStationBorderRfid: "R-NEXT-STN",
      startDistAbsResetM: "----",
      absLocationCorrectionM: "----",
      locoDirectionAfterAdj: "Nominal",
      authorisedSpeed: "MPS",
      sosRfidTags: [downLss.footTagId],
    });
  }

  if (upLss) {
    const nextStnDist = upLss.chainageM ? Math.round(upLss.chainageM * 0.1) : 3000;
    blockSections.push({
      lastStopSignal: upLss.name,
      direction: "UP",
      lastSignalMaMeters: nextStnDist > 0 ? nextStnDist : 3000,
      blockSectionTin: "TIN-UP",
      adjacentLineTins: "TIN-DOWN",
      nextStationId: metadata.nextUpStationId || "----",
      nextStationBorderRfid: "R-NEXT-STN",
      startDistAbsResetM: "----",
      absLocationCorrectionM: "----",
      locoDirectionAfterAdj: "Nominal",
      authorisedSpeed: "MPS",
      sosRfidTags: [upLss.footTagId],
    });
  }

  const tslBlockSections: BlockSectionDetail[] = [];
  if (downLss) {
    tslBlockSections.push({
      lastStopSignal: downLss.name,
      direction: "Down",
      lastSignalMaMeters: 2500,
      blockSectionTin: "TIN-TSL-DN",
      adjacentLineTins: "TIN-TSL-UP",
      nextStationId: metadata.nextDownStationId || "----",
      nextStationBorderRfid: "R-TSL-BORDER",
      startDistAbsResetM: "----",
      absLocationCorrectionM: "----",
      locoDirectionAfterAdj: "Reverse",
      authorisedSpeed: "MPS",
      sosRfidTags: [],
    });
  }

  return {
    metadata,
    routes,
    trackProfiles,
    tsrRoutes,
    tslRoutes,
    blockSections,
    tslBlockSections,
    tslTrackProfiles,
  };
}
