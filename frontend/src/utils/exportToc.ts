import * as XLSX from "xlsx";
import type { StationProject, TocRouteRow } from "../types/signalling";

export type TocExportSection =
  "selection" | "track_profile" | "tsr" | "tsl" | "block_sos" | "tag_inventory" | "all";

function formatRfidSequence(r: TocRouteRow): string {
  const parts: string[] = [];
  for (const item of r.linkingSequence) {
    if (r.entryFootTag && item.tagId === r.entryFootTag) continue;
    parts.push(`(${item.distanceM}, ${item.tagId})`);
  }
  if (parts.length === 0) {
    return r.enRouteTags.filter((t) => t !== r.entryFootTag).join(", ") || "-";
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// 1. EXCEL EXPORT (Selected Table or All)
// ---------------------------------------------------------------------------
export function exportTocToExcel(
  project: StationProject,
  selectedSection: TocExportSection = "selection",
) {
  const wb = XLSX.utils.book_new();
  const safeCode = project.metadata.stationCode.replace(/[^A-Za-z0-9_-]/g, "") || "STATION";

  // Sheet 1: Stationary KAVACH Table of Control (TOC) - Table 1
  const tocRows: Array<Record<string, unknown>> = [];
  for (const r of project.routes) {
    const seqStr = formatRfidSequence(r);
    const permutations =
      r.aspectPermutations && r.aspectPermutations.length > 0
        ? r.aspectPermutations
        : [
            {
              aspectOfEntrySignal: r.aspectOfEntrySignal || r.entryAspectSummary || "Green",
              requiresAspectOfExitSignal:
                r.requiresAspectOfExitSignal || r.exitAspectsSummary || `${r.exitSignal} Green`,
              movementAuthoritySections: r.movementAuthoritySections || "4",
              authorizedSpeedSr: r.authorizedSpeedSr || "MPS",
              authorizedSpeedOs: r.authorizedSpeedOs || "MPS",
            },
          ];

    let prevAspect = "";
    permutations.forEach((perm, pIdx) => {
      const showAspect = perm.aspectOfEntrySignal !== prevAspect;
      prevAspect = perm.aspectOfEntrySignal;
      tocRows.push({
        "S.No": pIdx === 0 ? r.slNo : "",
        "Entry Signal": pIdx === 0 ? r.entrySignal : "",
        "Exit Signal": pIdx === 0 ? r.exitSignal : "",
        Line: pIdx === 0 ? r.leadingToLine : "",
        "TSRMS Route ID": pIdx === 0 ? r.tsrmsRouteId || String(r.slNo) : "",
        "Section Type": pIdx === 0 ? r.sectionType || "Station Section" : "",
        "Signal Type": pIdx === 0 ? r.signalType : "",
        "Aspect of Entry Signal": showAspect ? perm.aspectOfEntrySignal : "",
        "Requires Aspects of Exit Signal": perm.requiresAspectOfExitSignal,
        "Required Route Locking": pIdx === 0 ? r.requiredRouteLocking || "-" : "",
        "Points in Route (Normal)": pIdx === 0 ? r.pointsNormal.join(", ") || "-" : "",
        "Points in Route (Reverse)": pIdx === 0 ? r.pointsReverse.join(", ") || "-" : "",
        "Requires Track Ckt Up in Route": pIdx === 0 ? r.trackCktUp || "-" : "",
        "Requires Track Ckt Up in Overlap":
          pIdx === 0 ? r.trackCircuitInOverlap || r.overlapTrackCkt || "-" : "",
        "TINs Requires Free": pIdx === 0 ? r.tinsRequiresFree.join(", ") || "-" : "",
        "TIN Required Free in Overlap":
          pIdx === 0 ? r.tinsInOverlap?.join(", ") || r.overlapTins?.join(", ") || "-" : "",
        "Entry Signal Foot Tag": pIdx === 0 ? r.entryFootTag : "",
        "Check RFID Sequence (Distance, En-Route Tag)": pIdx === 0 ? seqStr : "",
        "Distance between Entry & Exit Signal (m)": pIdx === 0 ? r.distanceBetweenSignalsM : "",
        "Movement Authority From Foot of Entry Signal (in Sections)":
          perm.movementAuthoritySections,
        "Authorized Speed (kmph) in SR":
          pIdx === 0
            ? r.authorizedSpeedSr || perm.authorizedSpeedSr || "MPS"
            : perm.authorizedSpeedSr || "",
        "Authorized Speed (kmph) in OS": perm.authorizedSpeedOs,
      });
    });
  }
  const wsToc = XLSX.utils.json_to_sheet(tocRows);

  if (selectedSection === "selection" || selectedSection === "all") {
    const blockSectionDetails = project.blockSections || [];
    if (blockSectionDetails.length > 0) {
      const blockRows = blockSectionDetails.map((b) => ({
        "Last Stop Signal for entering into Block Section": b.lastStopSignal,
        "Distance from LSS to Next Approaching Stop Signal in meter": b.lastSignalMaMeters ?? "--",
        "Block Section TIN": b.blockSectionTin,
        "Direction UP/Down": b.direction || "Down",
        "Adjacent Line TINs": b.adjacentLineTins,
        "Next Station Id": b.nextStationId,
        "Next Station Border RFID with Location": b.nextStationBorderRfid,
        "Movement Authorised Speed": b.authorisedSpeed || "MPS",
        "Start Distance to Absolute Location Reset (m)": b.startDistAbsResetM,
        "Absolute Location Correction (m)": b.absLocationCorrectionM,
        "Loco Direction after Adjustment": b.locoDirectionAfterAdj,
      }));
      XLSX.utils.sheet_add_aoa(wsToc, [[""], ["BLOCK SECTION DETAILS (Annexure-I Amdt-6)"]], {
        origin: -1,
      });
      XLSX.utils.sheet_add_json(wsToc, blockRows, { origin: -1 });
    }

    const ovSignals =
      project.signalsOverrideOv && project.signalsOverrideOv.length > 0
        ? project.signalsOverrideOv.join(", ")
        : project.signals
            .filter((s) => s.signalType.includes("Advanced") || s.signalType.includes("IB"))
            .map((s) => s.name)
            .join(", ") || "None";
    const osSpeed = project.authorizedSpeedOnSightKmph || 100;
    XLSX.utils.sheet_add_aoa(
      wsToc,
      [
        [""],
        ["Signals Override (OV) not required at zero speed:", ovSignals],
        ["Authorized speed on detection of train in Onsight mode (kmph):", osSpeed],
        [""],
      ],
      { origin: -1 },
    );

    const shuntingLimits = project.shuntingLimits || [];
    if (selectedSection === "all" && shuntingLimits.length > 0) {
      const shuntingRows = shuntingLimits.map((s) => ({
        "Adjacent Station Name": s.adjacentStation || s.adjacentStationName || "",
        Direction: s.direction,
        "RFID Tag No": s.rfidTag || s.rfidTagNo || "",
        TIN: s.tin,
        "Absolute Location in meter": s.absoluteLocationM,
      }));
      XLSX.utils.sheet_add_aoa(wsToc, [["SHUNTING LIMIT TABLE (Annexure-I Amdt-6)"]], {
        origin: -1,
      });
      XLSX.utils.sheet_add_json(wsToc, shuntingRows, { origin: -1 });
    }
  }

  // Sheet 2: Track Profile Table - Table 2
  const trackProfileRows = (project.trackProfiles || []).map((tp, idx) => {
    const psrStr =
      (tp.psrSegments ?? [])
        .map((s) => `(${s.staticSpeedType}, ${s.speedKmph}, ${s.lengthM})`)
        .join("; ") || "--";
    const engGradStr =
      (tp.engineeringGradients ?? [])
        .map((g) => `(${g.gradientValue}, ${g.lengthM}m)`)
        .join(", ") || "--";
    const avgGradStr =
      (tp.averageGradients ?? []).map((g) => `${g.avgGradientValue} ${g.lengthM}m`).join("; ") ||
      "--";
    const tcStr = tp.trackConditionType
      ? `${tp.trackConditionType} ${tp.trackConditionStartDistM ?? 0}m from Entry`
      : "--";

    return {
      "S.No": tp.slNo || idx + 1,
      "Entry Signal": tp.entrySignal,
      "Exit Signal": tp.exitSignal,
      Line: tp.line,
      "Turnout Speed Value (kmph)": tp.turnoutSpeedKmph ?? "--",
      "Turnout Start Distance (m)": tp.turnoutStartDistM ?? "--",
      "Turnout Restriction Length (m)": tp.turnoutLengthM ?? "--",
      "Permanent Speed Restriction (Type, Speed, Length)": psrStr,
      "Engineering Gradient (Value, Length)": engGradStr,
      "Average Gradient (Value, Length)": avgGradStr,
      "LC Gate ID": tp.lcId || "--",
      "LC Distance from Entry Signal (m)": tp.lcDistanceM ?? "--",
      "LC Manning Type": tp.lcManningType || "--",
      "LC Class": tp.lcClass || "--",
      "LC Auto Whistling Type": tp.lcAutoWhistlingType || "--",
      "Track Condition (Type, Start Distance, Length)": tcStr,
    };
  });
  const wsTp = XLSX.utils.json_to_sheet(trackProfileRows);

  // Sheet 3: TSR Route Table - Table 3
  const tsrRows = (project.tsrRoutes || []).map((tsr, idx) => ({
    "S.No": tsr.slNo || idx + 1,
    "OHE Line Name": tsr.oheLineName || tsr.oheLine,
    "Entry Signal": tsr.entrySignal,
    "Exit Signal": tsr.exitSignal,
    "TSR Route ID": tsr.tsrRouteId,
    "Start RFID Tag": tsr.startRfidTag || tsr.oheLineStartRfidTag,
    "Entry Signal Distance from Start RFID Tag (m)":
      tsr.entrySignalDistFromStartTagM ?? tsr.entrySignalDistanceM ?? 0,
    "Last Pole Distance from Exit Signal (m)":
      tsr.lastPoleDistFromExitSignalM ?? tsr.lastPoleDistanceM ?? 0,
    "OHE Pole/Km Data (in meter)":
      tsr.ohePoleKmData ||
      (tsr.ohePoles ? tsr.ohePoles.map((p) => `(${p.distanceM}-${p.poleId})`).join(", ") : "--"),
  }));
  const wsTsr = XLSX.utils.json_to_sheet(tsrRows);

  // Sheet 4: TSL Working on Double Line - Table 4
  const tslRows = (project.tslRoutes || []).map((tsl, idx) => {
    const seqStr = tsl.linkingSequence.map((s) => `(${s.distanceM}, ${s.tagId})`).join(", ");
    return {
      "S.No": tsl.slNo || idx + 1,
      "TSL Entry Signal": tsl.tslEntrySignal,
      "TSL Exit Signal": tsl.tslExitSignal,
      "Signal / Line Type": tsl.lineOrSignalType,
      "Aspect of Entry Signal": tsl.aspectOfEntrySignal,
      "Requires Aspects of Exit Signal": tsl.requiresAspectOfExitSignal,
      "Required Route Command for TSL": tsl.requiredRouteCommand,
      "Points in Route (Normal)": tsl.pointsNormal.join(", ") || "-",
      "Points in Route (Reverse)": tsl.pointsReverse.join(", ") || "-",
      "Requires Track Ckt Up / Axle Counter Free": tsl.trackCktUpOrAxleCounterFree,
      "TINs Requires Free": tsl.tinsRequiresFree.join(", ") || "-",
      "Entry Signal Foot Tag": tsl.entryFootTag,
      "Check RFID Sequence (Distance, En-Route Tag)": seqStr,
      "Distance between Entry & Exit Signal (m)": tsl.distanceBetweenSignalsM,
      "Movement Authority (in Sections)": tsl.movementAuthoritySections,
      "Authorized Speed in OS (First Train / Subsequent Trains)": `${tsl.authorizedSpeedOsFirstTrain} / ${tsl.authorizedSpeedOsSubsequentTrains}`,
    };
  });
  const wsTsl = XLSX.utils.json_to_sheet(tslRows);

  // Sheet 5: RFID Tag & TIN Allotment Inventory
  const tagRows = project.tags.map((t) => ({
    "Tag ID": t.tagId,
    "Chainage (m)": t.chainageM ?? "--",
    "Track / Line": t.line,
    TIN: t.tin || "--",
    "Tag Function Type": t.tagType,
    "Linked Signal": t.linkedSignal || "--",
    "Extraction Confidence": t.confidence,
    "Engineer Verified": t.verified ? "YES" : "NO",
    Notes: t.notes || "",
  }));
  const wsTags = XLSX.utils.json_to_sheet(tagRows);

  switch (selectedSection) {
    case "track_profile":
      XLSX.utils.book_append_sheet(wb, wsTp, "Track Profile Table");
      XLSX.writeFile(wb, `${safeCode}_KAVACH_Table2_TrackProfile.xlsx`);
      break;

    case "tsr":
      XLSX.utils.book_append_sheet(wb, wsTsr, "KAVACH TSR Route Table");
      XLSX.writeFile(wb, `${safeCode}_KAVACH_Table3_TSRRoutes.xlsx`);
      break;

    case "tsl":
      XLSX.utils.book_append_sheet(wb, wsTsl, "TSL Working on Double Line");
      XLSX.writeFile(wb, `${safeCode}_KAVACH_Table4_TSLWorking.xlsx`);
      break;

    case "block_sos": {
      const blockRows = (project.blockSections || []).map((b) => ({
        "Last Stop Signal for entering into Block Section": b.lastStopSignal,
        "Distance from LSS to Next Approaching Stop Signal in meter": b.lastSignalMaMeters ?? "--",
        "Block Section TIN": b.blockSectionTin,
        "Direction UP/Down": b.direction || "Down",
        "Adjacent Line TINs": b.adjacentLineTins,
        "Next Station Id": b.nextStationId,
        "Next Station Border RFID with Location": b.nextStationBorderRfid,
        "Movement Authorised Speed": b.authorisedSpeed || "MPS",
        "Start Distance to Absolute Location Reset (m)": b.startDistAbsResetM,
        "Absolute Location Correction (m)": b.absLocationCorrectionM,
        "Loco Direction after Adjustment": b.locoDirectionAfterAdj,
      }));
      const wsBlock = XLSX.utils.json_to_sheet(blockRows);
      if ((project.shuntingLimits || []).length > 0) {
        XLSX.utils.sheet_add_aoa(wsBlock, [[""], ["SHUNTING LIMIT TABLE (Annexure-I Amdt-6)"]], {
          origin: -1,
        });
        XLSX.utils.sheet_add_json(
          wsBlock,
          (project.shuntingLimits || []).map((s) => ({
            "Adjacent Station Name": s.adjacentStation || s.adjacentStationName || "",
            Direction: s.direction,
            "RFID Tag No": s.rfidTag || s.rfidTagNo || "",
            TIN: s.tin,
            "Absolute Location in meter": s.absoluteLocationM,
          })),
          { origin: -1 },
        );
      }
      XLSX.utils.book_append_sheet(wb, wsBlock, "Block & Shunting Limits");
      XLSX.writeFile(wb, `${safeCode}_KAVACH_Block_Shunting_Limits.xlsx`);
      break;
    }

    case "tag_inventory":
      XLSX.utils.book_append_sheet(wb, wsTags, "RFID Tag & TIN Allotment");
      XLSX.writeFile(wb, `${safeCode}_KAVACH_Tag_TIN_Allotment.xlsx`);
      break;

    case "all":
      XLSX.utils.book_append_sheet(wb, wsToc, "Stationary KAVACH TOC");
      XLSX.utils.book_append_sheet(wb, wsTp, "Track Profile Table");
      XLSX.utils.book_append_sheet(wb, wsTsr, "KAVACH TSR Route Table");
      XLSX.utils.book_append_sheet(wb, wsTsl, "TSL Working on Double Line");
      XLSX.utils.book_append_sheet(wb, wsTags, "RFID Tag & TIN Allotment");
      XLSX.writeFile(
        wb,
        `${safeCode}_KAVACH_TOC_Amdt6_${project.metadata.stationId || "STN"}.xlsx`,
      );
      break;

    case "selection":
    default:
      XLSX.utils.book_append_sheet(wb, wsToc, "Stationary KAVACH TOC");
      XLSX.writeFile(wb, `${safeCode}_KAVACH_Table1_TOC.xlsx`);
      break;
  }
}

// ---------------------------------------------------------------------------
// 2. CSV EXPORT (Selected Table or All)
// ---------------------------------------------------------------------------
export function exportTocToCsv(
  project: StationProject,
  selectedSection: TocExportSection = "selection",
) {
  const safeCode = project.metadata.stationCode.replace(/[^A-Za-z0-9_-]/g, "") || "STATION";
  const escapeCsv = (val: string | number | null | undefined) => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines: string[] = [];
  let filename = `${safeCode}_Table1_TOC.csv`;

  switch (selectedSection) {
    case "track_profile": {
      filename = `${safeCode}_Table2_TrackProfile.csv`;
      lines.push(
        [
          "S.No",
          "Entry Signal",
          "Exit Signal",
          "Line",
          "Turnout Speed (kmph)",
          "Turnout Start Distance (m)",
          "Turnout Length (m)",
          "PSR Segments",
          "Engineering Gradient",
          "Average Gradient",
          "LC Gate ID",
          "LC Distance (m)",
          "LC Manning",
          "LC Class",
          "Track Condition",
        ].join(","),
      );

      const tps = project.trackProfiles || [];
      tps.forEach((tp, idx) => {
        const psrStr =
          (tp.psrSegments ?? [])
            .map((s) => `(${s.staticSpeedType}; ${s.speedKmph}; ${s.lengthM}m)`)
            .join(" | ") || "--";
        const engGradStr =
          (tp.engineeringGradients ?? [])
            .map((g) => `(${g.gradientValue}; ${g.lengthM}m)`)
            .join(" | ") || "--";
        const avgGradStr =
          (tp.averageGradients ?? [])
            .map((g) => `${g.avgGradientValue} ${g.lengthM}m`)
            .join(" | ") || "--";
        lines.push(
          [
            tp.slNo || idx + 1,
            tp.entrySignal,
            tp.exitSignal,
            tp.line,
            tp.turnoutSpeedKmph ?? "--",
            tp.turnoutStartDistM ?? "--",
            tp.turnoutLengthM ?? "--",
            psrStr,
            engGradStr,
            avgGradStr,
            tp.lcId || "--",
            tp.lcDistanceM ?? "--",
            tp.lcManningType || "--",
            tp.lcClass || "--",
            tp.trackConditionType || "--",
          ]
            .map(escapeCsv)
            .join(","),
        );
      });
      break;
    }

    case "tsr": {
      filename = `${safeCode}_Table3_TSRRoutes.csv`;
      lines.push(
        [
          "S.No",
          "OHE Line Name",
          "Entry Signal",
          "Exit Signal",
          "TSR Route ID",
          "Start RFID Tag",
          "Entry Signal Dist from Start Tag (m)",
          "Last Pole Dist from Exit Signal (m)",
          "OHE Pole/Km Data",
        ].join(","),
      );

      const tsrs = project.tsrRoutes || [];
      tsrs.forEach((t, idx) => {
        lines.push(
          [
            t.slNo || idx + 1,
            t.oheLineName || t.oheLine,
            t.entrySignal,
            t.exitSignal,
            t.tsrRouteId,
            t.startRfidTag || t.oheLineStartRfidTag,
            t.entrySignalDistFromStartTagM ?? t.entrySignalDistanceM ?? 0,
            t.lastPoleDistFromExitSignalM ?? t.lastPoleDistanceM ?? 0,
            t.ohePoleKmData || "--",
          ]
            .map(escapeCsv)
            .join(","),
        );
      });
      break;
    }

    case "tsl": {
      filename = `${safeCode}_Table4_TSLWorking.csv`;
      lines.push(
        [
          "S.No",
          "TSL Entry Signal",
          "TSL Exit Signal",
          "Signal / Line Type",
          "Aspect of Entry Signal",
          "Requires Aspects of Exit Signal",
          "Route Command for TSL",
          "Points Normal",
          "Points Reverse",
          "Track Ckt Up / Axle Counter Free",
          "TINs Requires Free",
          "Entry Foot Tag",
          "Check RFID Sequence",
          "Distance between Signals (m)",
          "MA (Sections)",
          "Authorized Speed OS First Train (kmph)",
          "Authorized Speed OS Subsequent Trains (kmph)",
        ].join(","),
      );

      const tsls = project.tslRoutes || [];
      tsls.forEach((tsl, idx) => {
        const seqStr = tsl.linkingSequence.map((s) => `(${s.distanceM}; ${s.tagId})`).join(" | ");
        lines.push(
          [
            tsl.slNo || idx + 1,
            tsl.tslEntrySignal,
            tsl.tslExitSignal,
            tsl.lineOrSignalType,
            tsl.aspectOfEntrySignal,
            tsl.requiresAspectOfExitSignal,
            tsl.requiredRouteCommand,
            tsl.pointsNormal.join("; ") || "-",
            tsl.pointsReverse.join("; ") || "-",
            tsl.trackCktUpOrAxleCounterFree,
            tsl.tinsRequiresFree.join("; ") || "-",
            tsl.entryFootTag,
            seqStr,
            tsl.distanceBetweenSignalsM,
            tsl.movementAuthoritySections,
            tsl.authorizedSpeedOsFirstTrain,
            tsl.authorizedSpeedOsSubsequentTrains,
          ]
            .map(escapeCsv)
            .join(","),
        );
      });
      break;
    }

    case "block_sos": {
      filename = `${safeCode}_Block_Shunting_Limits.csv`;
      lines.push("--- BLOCK SECTION DETAILS ---");
      lines.push(
        [
          "Last Stop Signal",
          "Distance to Next Stop Sig (m)",
          "Block Section TIN",
          "Direction",
          "Adjacent Line TINs",
          "Next Station ID",
          "Border RFID with Location",
          "Movement Authorised Speed",
        ].join(","),
      );
      (project.blockSections || []).forEach((b) => {
        lines.push(
          [
            b.lastStopSignal,
            b.lastSignalMaMeters ?? "--",
            b.blockSectionTin,
            b.direction || "--",
            b.adjacentLineTins,
            b.nextStationId,
            b.nextStationBorderRfid,
            b.authorisedSpeed || "MPS",
          ]
            .map(escapeCsv)
            .join(","),
        );
      });

      lines.push("");
      lines.push("--- SHUNTING LIMIT TABLE ---");
      lines.push(
        ["Adjacent Station Name", "Direction", "RFID Tag No", "TIN", "Absolute Location (m)"].join(
          ",",
        ),
      );
      (project.shuntingLimits || []).forEach((s) => {
        lines.push(
          [
            s.adjacentStation || s.adjacentStationName || "",
            s.direction,
            s.rfidTag || s.rfidTagNo || "",
            s.tin,
            s.absoluteLocationM,
          ]
            .map(escapeCsv)
            .join(","),
        );
      });
      break;
    }

    case "tag_inventory": {
      filename = `${safeCode}_Tag_TIN_Allotment.csv`;
      lines.push(
        [
          "Tag ID",
          "Chainage (m)",
          "Track / Line",
          "TIN",
          "Tag Function Type",
          "Linked Signal",
          "Extraction Confidence",
          "Engineer Verified",
          "Notes",
        ].join(","),
      );
      project.tags.forEach((t) => {
        lines.push(
          [
            t.tagId,
            t.chainageM ?? "--",
            t.line,
            t.tin || "--",
            t.tagType,
            t.linkedSignal || "--",
            t.confidence,
            t.verified ? "YES" : "NO",
            t.notes || "",
          ]
            .map(escapeCsv)
            .join(","),
        );
      });
      break;
    }

    case "selection":
    default: {
      filename = `${safeCode}_Table1_TOC.csv`;
      lines.push(
        [
          "S.No",
          "Entry Signal",
          "Exit Signal",
          "Line",
          "TSRMS Route ID",
          "Section Type",
          "Signal Type",
          "Aspect of Entry Signal",
          "Requires Aspects of Exit Signal",
          "Required Route Locking",
          "Points Normal",
          "Points Reverse",
          "Requires Track Ckt Up in Route",
          "Requires Track Ckt Up in Overlap",
          "TINs Requires Free",
          "TIN Required Free in Overlap",
          "Entry Signal Foot Tag",
          "Check RFID Sequence (Distance, En-Route Tag)",
          "Distance between Signals (m)",
          "MA (Sections)",
          "Authorized Speed SR (kmph)",
          "Authorized Speed OS (kmph)",
        ].join(","),
      );

      for (const r of project.routes) {
        const seqStr = formatRfidSequence(r);
        const permutations =
          r.aspectPermutations && r.aspectPermutations.length > 0
            ? r.aspectPermutations
            : [
                {
                  aspectOfEntrySignal: r.aspectOfEntrySignal || r.entryAspectSummary || "Green",
                  requiresAspectOfExitSignal:
                    r.requiresAspectOfExitSignal || r.exitAspectsSummary || `${r.exitSignal} Green`,
                  movementAuthoritySections: r.movementAuthoritySections || "4",
                  authorizedSpeedSr: r.authorizedSpeedSr || "MPS",
                  authorizedSpeedOs: r.authorizedSpeedOs || "MPS",
                },
              ];

        permutations.forEach((perm, pIdx) => {
          lines.push(
            [
              pIdx === 0 ? r.slNo : "",
              pIdx === 0 ? r.entrySignal : "",
              pIdx === 0 ? r.exitSignal : "",
              pIdx === 0 ? r.leadingToLine : "",
              pIdx === 0 ? r.tsrmsRouteId || String(r.slNo) : "",
              pIdx === 0 ? r.sectionType || "Station Section" : "",
              pIdx === 0 ? r.signalType : "",
              perm.aspectOfEntrySignal,
              perm.requiresAspectOfExitSignal,
              pIdx === 0 ? r.requiredRouteLocking || "-" : "",
              pIdx === 0 ? r.pointsNormal.join("; ") || "-" : "",
              pIdx === 0 ? r.pointsReverse.join("; ") || "-" : "",
              pIdx === 0 ? r.trackCktUp || "-" : "",
              pIdx === 0 ? r.trackCircuitInOverlap || r.overlapTrackCkt || "-" : "",
              pIdx === 0 ? r.tinsRequiresFree.join("; ") || "-" : "",
              pIdx === 0 ? r.tinsInOverlap?.join("; ") || r.overlapTins?.join("; ") || "-" : "",
              pIdx === 0 ? r.entryFootTag : "",
              pIdx === 0 ? seqStr : "",
              pIdx === 0 ? r.distanceBetweenSignalsM : "",
              perm.movementAuthoritySections,
              pIdx === 0
                ? r.authorizedSpeedSr || perm.authorizedSpeedSr || "MPS"
                : perm.authorizedSpeedSr || "",
              perm.authorizedSpeedOs,
            ]
              .map(escapeCsv)
              .join(","),
          );
        });
      }
      break;
    }
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// 3. CANONICAL JSON EXPORT (Selected Table or All)
// ---------------------------------------------------------------------------
export function exportCanonicalJson(
  project: StationProject,
  selectedSection: TocExportSection = "selection",
) {
  let data: unknown;
  const safeCode = project.metadata.stationCode.replace(/[^A-Za-z0-9_-]/g, "") || "STATION";
  let filename = safeCode;

  switch (selectedSection) {
    case "selection":
      data = {
        metadata: project.metadata,
        table: "Table 1: Table of Control",
        routes: project.routes,
      };
      filename += "_Table1_TOC.json";
      break;
    case "track_profile":
      data = {
        metadata: project.metadata,
        table: "Table 2: Track Profile",
        trackProfiles: project.trackProfiles || [],
      };
      filename += "_Table2_TrackProfile.json";
      break;
    case "tsr":
      data = {
        metadata: project.metadata,
        table: "Table 3: TSR Routes",
        tsrRoutes: project.tsrRoutes || [],
      };
      filename += "_Table3_TSRRoutes.json";
      break;
    case "tsl":
      data = {
        metadata: project.metadata,
        table: "Table 4: TSL Working",
        tslRoutes: project.tslRoutes || [],
        tslBlockSections: project.tslBlockSections || [],
      };
      filename += "_Table4_TSLWorking.json";
      break;
    case "block_sos":
      data = {
        metadata: project.metadata,
        table: "Block & Shunting Limits",
        blockSections: project.blockSections || [],
        shuntingLimits: project.shuntingLimits || [],
      };
      filename += "_Block_Shunting_Limits.json";
      break;
    case "tag_inventory":
      data = {
        metadata: project.metadata,
        table: "RFID Tag & TIN Allotment",
        tags: project.tags,
      };
      filename += "_Tag_TIN_Allotment.json";
      break;
    case "all":
    default:
      data = project;
      filename += "_Canonical_Model.json";
      break;
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// 4. PRINT PDF EXPORT (Selected Table Only or Full 12-page Booklet)
// ---------------------------------------------------------------------------
export function exportTocToPdf(
  project: StationProject,
  selectedSection: TocExportSection = "selection",
) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    window.print();
    return;
  }

  const stationName = project.metadata.stationName || "STATION";
  const stationCode = project.metadata.stationCode || "----";
  const stationId = project.metadata.stationId || "----";
  const division = project.metadata.division || "----";
  const railway = project.metadata.railwayZone || "Indian Railways";
  const refSip = project.metadata.refLayout || "----";
  const refToc = project.metadata.refToc || "----";

  const renderHeader = (sheetTitle: string, drgSuffix: string) => `
    <table class="header-table">
      <tr>
        <td style="width: 25%;">
          <div class="bold" style="font-size: 10pt;">INDIAN RAILWAYS</div>
          <div>${railway}</div>
          <div>${division} Division</div>
        </td>
        <td style="width: 50%;" class="text-center">
          <div class="title-banner">${sheetTitle}</div>
          <div class="subtitle">STATION: ${stationName} (${stationCode}) &nbsp;|&nbsp; STATION ID: ${stationId}</div>
          <div style="font-size: 7.5pt; margin-top: 2px;">IN ACCORDANCE WITH RDSO/SPN/196/2020 VERSION 4.0 AMDT-6 (ANNEXURE-I)</div>
        </td>
        <td style="width: 25%; font-size: 7.5pt;">
          <div><b>REF SIP NO:</b> ${refSip}</div>
          <div><b>REF TOC NO:</b> ${refToc}</div>
          <div><b>DRG NO:</b> KAVACH_${drgSuffix}_${stationCode}_2.0.0</div>
          <div><b>REV NO:</b> 0 (Initial Revision)</div>
        </td>
      </tr>
    </table>
  `;

  const renderFooter = (drgSuffix: string, pageNo: number, totalPages: number) => `
    <table class="approval-table" style="margin-top: 6px;">
      <tr>
        <td style="width: 20%; height: 32px;">
          <div style="font-size: 7pt; color: #555;">PREPARED BY:</div>
          <div class="bold" style="font-size: 7.5pt; margin-top: 10px;">${project.metadata.preparedBy || "JE / SSE / Signal"}</div>
        </td>
        <td style="width: 20%;">
          <div style="font-size: 7pt; color: #555;">CHECKED BY:</div>
          <div class="bold" style="font-size: 7.5pt; margin-top: 10px;">${project.metadata.checkedBy || "ASTE / DSTE"}</div>
        </td>
        <td style="width: 20%;">
          <div style="font-size: 7pt; color: #555;">RECOMMENDED BY:</div>
          <div class="bold" style="font-size: 7.5pt; margin-top: 10px;">${project.metadata.signOffEngineerName || "Dy.CSTE"}</div>
        </td>
        <td style="width: 20%;">
          <div style="font-size: 7pt; color: #555;">APPROVED BY:</div>
          <div class="bold" style="font-size: 7.5pt; margin-top: 10px;">${project.metadata.approvedBy || "RDSO"}</div>
        </td>
        <td style="width: 20%;" class="text-center">
          <div class="bold" style="font-size: 9pt;">SHEET ${pageNo} OF ${totalPages}</div>
          <div style="font-size: 7pt;">KAVACH_${drgSuffix}_${stationCode}</div>
        </td>
      </tr>
    </table>
  `;

  const renderRouteRows = (routesSubset: typeof project.routes) => {
    return routesSubset
      .map((r) => {
        const seqStr = formatRfidSequence(r);
        const permutations =
          r.aspectPermutations && r.aspectPermutations.length > 0
            ? r.aspectPermutations
            : [
                {
                  aspectOfEntrySignal: r.aspectOfEntrySignal || r.entryAspectSummary || "Green",
                  requiresAspectOfExitSignal:
                    r.requiresAspectOfExitSignal || r.exitAspectsSummary || `${r.exitSignal} Green`,
                  movementAuthoritySections: r.movementAuthoritySections || "4",
                  authorizedSpeedSr: r.authorizedSpeedSr || "MPS",
                  authorizedSpeedOs: r.authorizedSpeedOs || "MPS",
                },
              ];

        let prevAspect = "";
        return permutations
          .map((p, pIdx) => {
            const showAspect = p.aspectOfEntrySignal !== prevAspect;
            prevAspect = p.aspectOfEntrySignal;
            return `
        <tr>
          <td class="text-center mono bold">${pIdx === 0 ? r.slNo : ""}</td>
          <td class="mono bold text-center">${pIdx === 0 ? r.entrySignal : ""}</td>
          <td class="mono bold text-center">${pIdx === 0 ? r.exitSignal : ""}</td>
          <td>${pIdx === 0 ? r.leadingToLine : ""}</td>
          <td class="text-center mono">${pIdx === 0 ? r.tsrmsRouteId || r.slNo : ""}</td>
          <td>${pIdx === 0 ? r.sectionType || "Station Section" : ""}</td>
          <td>${pIdx === 0 ? r.signalType : ""}</td>
          <td class="bold text-center">${showAspect ? p.aspectOfEntrySignal : ""}</td>
          <td class="text-center">${p.requiresAspectOfExitSignal}</td>
          <td class="mono text-center bold">${pIdx === 0 ? r.requiredRouteLocking || "-" : ""}</td>
          <td class="mono text-center">${pIdx === 0 ? r.pointsNormal.join(", ") || "-" : ""}</td>
          <td class="mono text-center">${pIdx === 0 ? r.pointsReverse.join(", ") || "-" : ""}</td>
          <td class="mono">${pIdx === 0 ? r.trackCktUp || "-" : ""}</td>
          <td class="mono">${pIdx === 0 ? r.trackCircuitInOverlap || r.overlapTrackCkt || "-" : ""}</td>
          <td class="mono">${pIdx === 0 ? r.tinsRequiresFree.join(", ") || "-" : ""}</td>
          <td class="mono">${pIdx === 0 ? r.tinsInOverlap?.join(", ") || r.overlapTins?.join(", ") || "-" : ""}</td>
          <td class="mono text-center bold">${pIdx === 0 ? r.entryFootTag : ""}</td>
          <td class="mono" style="font-size: 6.5pt;">${pIdx === 0 ? seqStr : ""}</td>
          <td class="mono text-right bold">${pIdx === 0 ? r.distanceBetweenSignalsM : ""}</td>
          <td class="mono text-center bold">${p.movementAuthoritySections}</td>
          <td class="mono text-center bold">${pIdx === 0 ? r.authorizedSpeedSr || p.authorizedSpeedSr || "MPS" : p.authorizedSpeedSr || ""}</td>
          <td class="mono text-center bold">${p.authorizedSpeedOs || r.authorizedSpeedOs || "MPS"}</td>
        </tr>
      `;
          })
          .join("");
      })
      .join("");
  };

  // Dynamic Route Subsets for Paged Printing
  // Dynamically chunk routes by rendered aspect permutation rows (34-38 rows per A3 landscape page)
  // to eliminate empty white space, minimize page count, and ensure proper continuous page filling.
  const chunkRoutesForPrint = (
    routes: typeof project.routes,
    targetRowsPerPage = 32,
  ): (typeof project.routes)[] => {
    if (!routes || routes.length === 0) return [[]];
    const pages: (typeof project.routes)[] = [];
    let currentPage: typeof project.routes = [];
    let currentRows = 0;

    for (const r of routes) {
      const rRows =
        r.aspectPermutations && r.aspectPermutations.length > 0 ? r.aspectPermutations.length : 1;

      if (currentPage.length > 0 && currentRows + rRows > targetRowsPerPage) {
        pages.push(currentPage);
        currentPage = [r];
        currentRows = rRows;
      } else {
        currentPage.push(r);
        currentRows += rRows;
      }
    }

    if (currentPage.length > 0) {
      pages.push(currentPage);
    }
    return pages;
  };

  const t1Chunks = chunkRoutesForPrint(project.routes, 32);

  // Table 2 subsets (pack 18-20 track profile rows per page)
  const allTp = project.trackProfiles || [];
  const tpPerPage = 20;
  const tpChunks: (typeof project.trackProfiles)[] = [];
  for (let i = 0; i < allTp.length; i += tpPerPage) {
    tpChunks.push(allTp.slice(i, i + tpPerPage));
  }
  if (tpChunks.length === 0) tpChunks.push([]);
  const tp1 = tpChunks[0] || [];
  const tp2 = tpChunks[1] || [];

  // Table 4 subsets (pack 12-14 TSL rows per page)
  const allTsl = project.tslRoutes || [];
  const tslPerPage = 14;
  const tslChunks: (typeof project.tslRoutes)[] = [];
  for (let i = 0; i < allTsl.length; i += tslPerPage) {
    tslChunks.push(allTsl.slice(i, i + tslPerPage));
  }
  if (tslChunks.length === 0) tslChunks.push([]);
  const tsl1 = tslChunks[0] || [];
  const tsl2 = tslChunks[1] || [];

  // ---------------------------------------------------------------------------
  // Build Page HTML according to selectedSection
  // ---------------------------------------------------------------------------
  let pagesHtml = "";
  let docTitle = `${stationName} (${stationCode}) - KAVACH Table of Control`;

  // Helper generators
  const renderTable1Sheet = (
    chunk: typeof project.routes,
    tablePartNum: number,
    tableTotalParts: number,
    sheetNo: number,
    totalSheets: number,
    isLastPart: boolean,
  ) => `
    <div class="sheet-page">
      <div>
        ${renderHeader("STATIONARY KAVACH TABLE OF CONTROL - SELECTION TABLE", "TOC")}
        <div class="section-title">TABLE 1: STATIONARY KAVACH TABLE OF CONTROL - PART ${tablePartNum} OF ${tableTotalParts}</div>
        <table class="data-table" style="margin-top: 4px;">
          <thead>
            <tr>
              <th rowspan="2">S.No</th>
              <th rowspan="2">Entry Sig</th>
              <th rowspan="2">Exit Sig</th>
              <th rowspan="2">Line</th>
              <th rowspan="2">TSRMS ID</th>
              <th rowspan="2">Section Type</th>
              <th rowspan="2">Signal Type</th>
              <th rowspan="2">Aspect of Entry Sig</th>
              <th rowspan="2">Requires Aspects Exit</th>
              <th rowspan="2">Req Route Locking</th>
              <th colspan="2">Points in Route</th>
              <th colspan="2">Requires Track Ckt Up</th>
              <th colspan="2">TINs Required Free</th>
              <th rowspan="2">Foot Tag</th>
              <th rowspan="2">Check RFID Sequence</th>
              <th rowspan="2">Dist (m)</th>
              <th rowspan="2">MA</th>
              <th rowspan="2">SR Speed</th>
              <th rowspan="2">OS Speed</th>
            </tr>
            <tr>
              <th>Normal</th>
              <th>Reverse</th>
              <th>In Route</th>
              <th>In Overlap</th>
              <th>In Route</th>
              <th>In Overlap</th>
            </tr>
          </thead>
          <tbody>
            ${renderRouteRows(chunk)}
          </tbody>
        </table>

        ${
          isLastPart &&
          (selectedSection === "selection" || selectedSection === "all") &&
          (project.blockSections?.length || 0) > 0
            ? `
          <div class="section-title" style="margin-top: 10px;">BLOCK SECTION DETAILS (Annexure-I Amdt-6)</div>
          <table class="data-table" style="margin-top: 2px;">
            <thead>
              <tr>
                <th>Last Stop Sig</th>
                <th>Dist to Next Stop Sig (m)</th>
                <th>Block Section TIN</th>
                <th>Direction</th>
                <th>Adjacent Line TINs</th>
                <th>Next Stn ID</th>
                <th>Border RFID with Loc</th>
                <th>Auth Speed</th>
                <th>Start Dist Reset (m)</th>
                <th>Abs Loc Corr (m)</th>
                <th>Loco Dir After Adj</th>
              </tr>
            </thead>
            <tbody>
              ${(project.blockSections || [])
                .map(
                  (b) => `
                <tr>
                  <td class="mono bold text-center">${b.lastStopSignal}</td>
                  <td class="mono text-center">${b.lastSignalMaMeters ?? "--"}</td>
                  <td class="mono bold text-center">${b.blockSectionTin}</td>
                  <td class="text-center">${b.direction || "--"}</td>
                  <td class="mono text-center">${b.adjacentLineTins}</td>
                  <td class="mono bold text-center">${b.nextStationId}</td>
                  <td class="mono text-center">${b.nextStationBorderRfid}</td>
                  <td class="text-center bold">${b.authorisedSpeed || "MPS"}</td>
                  <td class="mono text-center">${b.startDistAbsResetM}</td>
                  <td class="mono text-center">${b.absLocationCorrectionM}</td>
                  <td class="text-center">${b.locoDirectionAfterAdj}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>

          <table class="meta-table" style="margin-top: 6px;">
            <tr>
              <td style="width: 50%; font-weight: bold; background: #fafafa;">Signals Override (OV) not required at zero speed:</td>
              <td style="width: 50%; font-family: monospace; font-weight: bold; color: #1e3a8a;">
                ${(project.signalsOverrideOv && project.signalsOverrideOv.length > 0 ? project.signalsOverrideOv : project.signals.filter((s) => s.signalType.includes("Advanced") || s.signalType.includes("IB")).map((s) => s.name)).join(", ") || "None"}
              </td>
            </tr>
            <tr>
              <td style="font-weight: bold; background: #fafafa;">Authorized speed on detection of train in Onsight mode (kmph):</td>
              <td style="font-family: monospace; font-weight: bold;">
                ${project.authorizedSpeedOnSightKmph || 100} kmph
              </td>
            </tr>
          </table>
        `
            : ""
        }
      </div>
      ${renderFooter("TOC", sheetNo, totalSheets)}
    </div>
  `;

  const renderTable2Sheet = (
    chunk: typeof project.trackProfiles,
    partNum: number,
    totalPages: number,
    startIdxOffset: number,
  ) => `
    <div class="sheet-page">
      <div>
        ${renderHeader("STATIONARY KAVACH TRACK PROFILE TABLE", "TP")}
        <div class="section-title">TABLE 2: TRACK PROFILE TABLE - PART ${partNum} OF ${totalPages}</div>
        <table class="data-table" style="margin-top: 4px;">
          <thead>
            <tr>
              <th rowspan="2">S.No</th>
              <th rowspan="2">Entry Sig</th>
              <th rowspan="2">Exit Sig</th>
              <th rowspan="2">Line</th>
              <th colspan="3">Turnout Speed</th>
              <th rowspan="2">PSR Segments</th>
              <th rowspan="2">PSR Class (A, B, C)</th>
              <th colspan="2">Gradient</th>
              <th colspan="4">Level Crossing Gate</th>
            </tr>
            <tr>
              <th>Speed</th>
              <th>Start (m)</th>
              <th>Len (m)</th>
              <th>Engineering</th>
              <th>Average</th>
              <th>Gate ID</th>
              <th>Dist (m)</th>
              <th>Manning</th>
              <th>Class</th>
            </tr>
          </thead>
          <tbody>
            ${(chunk || [])
              .map(
                (tp, idx) => `
              <tr>
                <td class="text-center mono bold">${tp.slNo || idx + startIdxOffset + 1}</td>
                <td class="mono bold text-center">${tp.entrySignal}</td>
                <td class="mono bold text-center">${tp.exitSignal}</td>
                <td>${tp.line}</td>
                <td class="mono text-center bold">${tp.turnoutSpeedKmph ?? "--"}</td>
                <td class="mono text-center">${tp.turnoutStartDistM ?? "--"}</td>
                <td class="mono text-center">${tp.turnoutLengthM ?? "--"}</td>
                <td class="mono" style="font-size: 6.5pt;">${tp.psrSegments?.map((s) => `(${s.staticSpeedType}, ${s.speedKmph}, ${s.lengthM}m)`).join("; ") || "--"}</td>
                <td class="mono text-center" style="font-size: 6.5pt;">${tp.psrClassSegments?.map((c) => `A:${c.classA}, B:${c.classB}, C:${c.classC}`).join("; ") || "--"}</td>
                <td class="mono" style="font-size: 6.5pt;">${tp.engineeringGradients?.map((g) => `(${g.gradientValue}, ${g.lengthM}m)`).join(", ") || "--"}</td>
                <td class="mono text-center" style="font-size: 6.5pt;">${tp.averageGradients?.map((g) => `${g.avgGradientValue}`).join("; ") || "--"}</td>
                <td class="mono bold text-center">${tp.lcId || "--"}</td>
                <td class="mono text-center">${tp.lcDistanceM ?? "--"}</td>
                <td class="text-center">${tp.lcManningType || "--"}</td>
                <td class="text-center">${tp.lcClass || "--"}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
      ${renderFooter("TP", partNum, totalPages)}
    </div>
  `;

  const renderTable3Sheet = (pageNum: number, totalPages: number) => `
    <div class="sheet-page">
      <div>
        ${renderHeader("STATIONARY KAVACH TSR ROUTE TABLE", "TSR")}
        <div class="section-title">TABLE 3: KAVACH TSR ROUTE TABLE (RDSO Cl. I.2.12.6)</div>
        <table class="data-table" style="margin-top: 4px;">
          <thead>
            <tr>
              <th>S.No</th>
              <th>OHE Line Name</th>
              <th>Entry Sig</th>
              <th>Exit Sig</th>
              <th>TSR Route ID</th>
              <th>Start RFID Tag</th>
              <th>Dist from Start (m)</th>
              <th>Last Pole Dist (m)</th>
              <th>OHE Pole/Km Data</th>
            </tr>
          </thead>
          <tbody>
            ${(project.tsrRoutes || [])
              .map(
                (t, idx) => `
              <tr>
                <td class="text-center mono bold">${t.slNo || idx + 1}</td>
                <td class="bold">${t.oheLineName || t.oheLine}</td>
                <td class="mono bold text-center">${t.entrySignal}</td>
                <td class="mono bold text-center">${t.exitSignal}</td>
                <td class="mono bold text-center">${t.tsrRouteId}</td>
                <td class="mono bold text-center">${t.startRfidTag || t.oheLineStartRfidTag}</td>
                <td class="mono text-center">${t.entrySignalDistFromStartTagM ?? t.entrySignalDistanceM ?? 0}</td>
                <td class="mono text-center">${t.lastPoleDistFromExitSignalM ?? t.lastPoleDistanceM ?? 0}</td>
                <td class="mono" style="font-size: 6.5pt;">${t.ohePoleKmData || (t.ohePoles ? t.ohePoles.map((p) => `(${p.distanceM}-${p.poleId})`).join(", ") : "--")}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
      ${renderFooter("TSR", pageNum, totalPages)}
    </div>
  `;

  const renderBlockLimitsSheet = (pageNum: number, totalPages: number) => `
    <div class="sheet-page">
      <div>
        ${renderHeader("BLOCK SECTION DETAILS & SHUNTING LIMITS TABLE", "BLOCK_LIMITS")}
        <div class="section-title">1. BLOCK SECTION DETAILS (Annexure-I Amdt-6)</div>
        <table class="data-table" style="margin-top: 4px;">
          <thead>
            <tr>
              <th>Last Stop Sig</th>
              <th>Dist to Next Stop Sig (m)</th>
              <th>Block Section TIN</th>
              <th>Direction</th>
              <th>Adjacent Line TINs</th>
              <th>Next Stn ID</th>
              <th>Border RFID with Loc</th>
              <th>Auth Speed</th>
              <th>Start Dist Reset (m)</th>
              <th>Abs Loc Corr (m)</th>
              <th>Loco Dir After Adj</th>
            </tr>
          </thead>
          <tbody>
            ${(project.blockSections || [])
              .map(
                (b) => `
              <tr>
                <td class="mono bold text-center">${b.lastStopSignal}</td>
                <td class="mono text-center">${b.lastSignalMaMeters ?? "--"}</td>
                <td class="mono bold text-center">${b.blockSectionTin}</td>
                <td class="text-center">${b.direction || "--"}</td>
                <td class="mono text-center">${b.adjacentLineTins}</td>
                <td class="mono bold text-center">${b.nextStationId}</td>
                <td class="mono text-center">${b.nextStationBorderRfid}</td>
                <td class="text-center bold">${b.authorisedSpeed || "MPS"}</td>
                <td class="mono text-center">${b.startDistAbsResetM}</td>
                <td class="mono text-center">${b.absLocationCorrectionM}</td>
                <td class="text-center">${b.locoDirectionAfterAdj}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>

        <div class="section-title" style="margin-top: 14px;">2. SHUNTING LIMIT TABLE (Annexure-I Amdt-6)</div>
        <table class="data-table" style="margin-top: 4px;">
          <thead>
            <tr>
              <th>S.No</th>
              <th>Adjacent Station Name</th>
              <th>Direction</th>
              <th>RFID Tag No</th>
              <th>TIN</th>
              <th>Absolute Location in meter</th>
            </tr>
          </thead>
          <tbody>
            ${(project.shuntingLimits || [])
              .map(
                (s, idx) => `
              <tr>
                <td class="text-center mono bold">${idx + 1}</td>
                <td class="bold">${s.adjacentStation || s.adjacentStationName || "--"}</td>
                <td class="text-center">${s.direction}</td>
                <td class="mono bold text-center">${s.rfidTag || s.rfidTagNo || "--"}</td>
                <td class="mono bold text-center">${s.tin}</td>
                <td class="mono text-right bold">${s.absoluteLocationM}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
      ${renderFooter("BLOCK_LIMITS", pageNum, totalPages)}
    </div>
  `;

  const renderTagInventorySheets = (startPage: number, totalPages: number) => {
    const tags = project.tags || [];
    const TAGS_PER_PAGE = 26;
    const tagChunks: (typeof project.tags)[] = [];
    for (let i = 0; i < tags.length; i += TAGS_PER_PAGE) {
      tagChunks.push(tags.slice(i, i + TAGS_PER_PAGE));
    }
    if (tagChunks.length === 0) tagChunks.push([]);

    return tagChunks
      .map(
        (chunk, idx) => `
      <div class="sheet-page">
        <div>
          ${renderHeader("RFID TAG & TIN ALLOTMENT INVENTORY", "TAGS")}
          <div class="section-title">RFID TAG & TIN ALLOTMENT INVENTORY - PART ${idx + 1} OF ${tagChunks.length}</div>
          <table class="data-table" style="margin-top: 4px;">
            <thead>
              <tr>
                <th>S.No</th>
                <th>Tag ID</th>
                <th>Chainage (m)</th>
                <th>Track / Line</th>
                <th>TIN</th>
                <th>Tag Function Type</th>
                <th>Linked Signal</th>
                <th>Confidence</th>
                <th>Engineer Verified</th>
              </tr>
            </thead>
            <tbody>
              ${chunk
                .map(
                  (t, cIdx) => `
                <tr>
                  <td class="text-center mono bold">${idx * TAGS_PER_PAGE + cIdx + 1}</td>
                  <td class="mono bold text-center">${t.tagId}</td>
                  <td class="mono text-center">${t.chainageM ?? "--"}</td>
                  <td class="mono text-center">${t.line}</td>
                  <td class="mono bold text-center">${t.tin || "--"}</td>
                  <td class="text-center">${t.tagType}</td>
                  <td class="mono text-center">${t.linkedSignal || "--"}</td>
                  <td class="text-center">${t.confidence}</td>
                  <td class="text-center bold">${t.verified ? "YES" : "NO"}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
        ${renderFooter("TAGS", startPage + idx, totalPages)}
      </div>
    `,
      )
      .join("");
  };

  // Switch on selectedSection
  switch (selectedSection) {
    case "track_profile": {
      docTitle = `${stationName} (${stationCode}) - Table 2 Track Profile`;
      const totalPages = tpChunks.length;
      pagesHtml = tpChunks
        .map((chunk, idx) => renderTable2Sheet(chunk, idx + 1, totalPages, idx * tpPerPage))
        .join("");
      break;
    }

    case "tsr": {
      docTitle = `${stationName} (${stationCode}) - Table 3 TSR Routes`;
      pagesHtml = renderTable3Sheet(1, 1);
      break;
    }

    case "tsl": {
      docTitle = `${stationName} (${stationCode}) - Table 4 TSL Working`;
      pagesHtml = `
        <div class="sheet-page">
          <div>
            ${renderHeader("TEMPORARY SINGLE LINE (TSL) WORKING - SELECTION TABLE", "TSL")}
            <div class="section-title">TABLE 4: TSL SELECTION TABLE - PART 1 OF 3</div>
            <table class="data-table" style="margin-top: 4px;">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>TSL Entry Sig</th>
                  <th>TSL Exit Sig</th>
                  <th>Signal / Line Type</th>
                  <th>Aspect Entry</th>
                  <th>Requires Aspect Exit</th>
                  <th>Route Command for TSL</th>
                  <th>Points Normal</th>
                  <th>Points Reverse</th>
                  <th>Track Ckt / Axle Counter</th>
                  <th>TINs Free</th>
                  <th>Foot Tag</th>
                  <th>Dist (m)</th>
                  <th>MA</th>
                  <th>Auth Speed (First / Subseq)</th>
                </tr>
              </thead>
              <tbody>
                ${tsl1
                  .map(
                    (tsl) => `
                  <tr>
                    <td class="text-center mono bold">${tsl.slNo}</td>
                    <td class="mono bold text-center">${tsl.tslEntrySignal}</td>
                    <td class="mono bold text-center">${tsl.tslExitSignal}</td>
                    <td>${tsl.lineOrSignalType}</td>
                    <td class="bold text-center">${tsl.aspectOfEntrySignal}</td>
                    <td class="text-center">${tsl.requiresAspectOfExitSignal}</td>
                    <td class="mono bold text-center">${tsl.requiredRouteCommand}</td>
                    <td class="mono text-center">${tsl.pointsNormal.join(", ") || "-"}</td>
                    <td class="mono text-center">${tsl.pointsReverse.join(", ") || "-"}</td>
                    <td>${tsl.trackCktUpOrAxleCounterFree}</td>
                    <td class="mono">${tsl.tinsRequiresFree.join(", ") || "-"}</td>
                    <td class="mono bold text-center">${tsl.entryFootTag}</td>
                    <td class="mono text-right bold">${tsl.distanceBetweenSignalsM}</td>
                    <td class="mono text-center bold">${tsl.movementAuthoritySections}</td>
                    <td class="mono text-center bold">${tsl.authorizedSpeedOsFirstTrain} / ${tsl.authorizedSpeedOsSubsequentTrains}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          ${renderFooter("TSL", 1, 3)}
        </div>

        <div class="sheet-page">
          <div>
            ${renderHeader("TEMPORARY SINGLE LINE (TSL) WORKING - SELECTION TABLE", "TSL")}
            <div class="section-title">TABLE 4: TSL SELECTION TABLE - PART 2 OF 3</div>
            <table class="data-table" style="margin-top: 4px;">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>TSL Entry Sig</th>
                  <th>TSL Exit Sig</th>
                  <th>Signal / Line Type</th>
                  <th>Aspect Entry</th>
                  <th>Requires Aspect Exit</th>
                  <th>Route Command for TSL</th>
                  <th>Points Normal</th>
                  <th>Points Reverse</th>
                  <th>Track Ckt / Axle Counter</th>
                  <th>TINs Free</th>
                  <th>Foot Tag</th>
                  <th>Dist (m)</th>
                  <th>MA</th>
                  <th>Auth Speed (First / Subseq)</th>
                </tr>
              </thead>
              <tbody>
                ${tsl2
                  .map(
                    (tsl) => `
                  <tr>
                    <td class="text-center mono bold">${tsl.slNo}</td>
                    <td class="mono bold text-center">${tsl.tslEntrySignal}</td>
                    <td class="mono bold text-center">${tsl.tslExitSignal}</td>
                    <td>${tsl.lineOrSignalType}</td>
                    <td class="bold text-center">${tsl.aspectOfEntrySignal}</td>
                    <td class="text-center">${tsl.requiresAspectOfExitSignal}</td>
                    <td class="mono bold text-center">${tsl.requiredRouteCommand}</td>
                    <td class="mono text-center">${tsl.pointsNormal.join(", ") || "-"}</td>
                    <td class="mono text-center">${tsl.pointsReverse.join(", ") || "-"}</td>
                    <td>${tsl.trackCktUpOrAxleCounterFree}</td>
                    <td class="mono">${tsl.tinsRequiresFree.join(", ") || "-"}</td>
                    <td class="mono bold text-center">${tsl.entryFootTag}</td>
                    <td class="mono text-right bold">${tsl.distanceBetweenSignalsM}</td>
                    <td class="mono text-center bold">${tsl.movementAuthoritySections}</td>
                    <td class="mono text-center bold">${tsl.authorizedSpeedOsFirstTrain} / ${tsl.authorizedSpeedOsSubsequentTrains}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>

            <div class="section-title" style="margin-top: 10px;">TSL BLOCK SECTION DETAILS (Annexure-I Amdt-6)</div>
            <table class="meta-table" style="margin-top: 2px;">
              <thead>
                <tr>
                  <th>Last Stop Signal</th>
                  <th>Dist to Next Stop Sig (m)</th>
                  <th>Block Section TIN</th>
                  <th>Direction</th>
                  <th>Adjacent Line TINs</th>
                  <th>Next Stn ID</th>
                  <th>Border RFID with Location</th>
                  <th>Authorised Speed</th>
                </tr>
              </thead>
              <tbody>
                ${(project.tslBlockSections || [])
                  .map(
                    (b) => `
                  <tr>
                    <td class="mono bold text-center">${b.lastStopSignal}</td>
                    <td class="mono text-center">${b.lastSignalMaMeters}</td>
                    <td class="mono bold text-center">${b.blockSectionTin}</td>
                    <td class="text-center">${b.direction}</td>
                    <td class="mono text-center">${b.adjacentLineTins}</td>
                    <td class="mono bold text-center">${b.nextStationId}</td>
                    <td class="mono text-center">${b.nextStationBorderRfid}</td>
                    <td class="text-center bold">${b.authorisedSpeed || "MPS"}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          ${renderFooter("TSL", 2, 3)}
        </div>

        <div class="sheet-page">
          <div>
            ${renderHeader("TEMPORARY SINGLE LINE (TSL) TRACK PROFILE TABLE", "TSL_TP")}
            <div class="section-title">TABLE 4: TSL TRACK PROFILE TABLE - PART 3 OF 3</div>
            <table class="data-table" style="margin-top: 4px;">
              <thead>
                <tr>
                  <th rowspan="2">S.No</th>
                  <th rowspan="2">Entry Sig</th>
                  <th rowspan="2">Exit Sig</th>
                  <th rowspan="2">Line</th>
                  <th colspan="3">Turnout Speed</th>
                  <th rowspan="2">PSR Segments</th>
                  <th rowspan="2">PSR Class (A, B, C)</th>
                  <th colspan="2">Gradient</th>
                  <th colspan="4">Level Crossing Gate</th>
                </tr>
                <tr>
                  <th>Speed</th>
                  <th>Start (m)</th>
                  <th>Len (m)</th>
                  <th>Engineering</th>
                  <th>Average</th>
                  <th>Gate ID</th>
                  <th>Dist (m)</th>
                  <th>Manning</th>
                  <th>Class</th>
                </tr>
              </thead>
              <tbody>
                ${(project.tslTrackProfiles || [])
                  .map(
                    (tp, idx) => `
                  <tr>
                    <td class="text-center mono bold">${tp.slNo || idx + 1}</td>
                    <td class="mono bold text-center">${tp.entrySignal}</td>
                    <td class="mono bold text-center">${tp.exitSignal}</td>
                    <td>${tp.line}</td>
                    <td class="mono text-center bold">${tp.turnoutSpeedKmph ?? "--"}</td>
                    <td class="mono text-center">${tp.turnoutStartDistM ?? "--"}</td>
                    <td class="mono text-center">${tp.turnoutLengthM ?? "--"}</td>
                    <td class="mono" style="font-size: 6.5pt;">${tp.psrSegments?.map((s) => `(${s.staticSpeedType}, ${s.speedKmph}, ${s.lengthM}m)`).join("; ") || "--"}</td>
                    <td class="mono text-center" style="font-size: 6.5pt;">${tp.psrClassSegments?.map((c) => `A:${c.classA}, B:${c.classB}, C:${c.classC}`).join("; ") || "--"}</td>
                    <td class="mono" style="font-size: 6.5pt;">${tp.engineeringGradients?.map((g) => `(${g.gradientValue}, ${g.lengthM}m)`).join(", ") || "--"}</td>
                    <td class="mono text-center" style="font-size: 6.5pt;">${tp.averageGradients?.map((g) => `${g.avgGradientValue}`).join("; ") || "--"}</td>
                    <td class="mono bold text-center">${tp.lcId || "--"}</td>
                    <td class="mono text-center">${tp.lcDistanceM ?? "--"}</td>
                    <td class="text-center">${tp.lcManningType || "--"}</td>
                    <td class="text-center">${tp.lcClass || "--"}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          ${renderFooter("TSL_TP", 3, 3)}
        </div>
      `;
      break;
    }

    case "block_sos": {
      docTitle = `${stationName} (${stationCode}) - Block Section & Shunting Limits`;
      pagesHtml = renderBlockLimitsSheet(1, 1);
      break;
    }

    case "tag_inventory": {
      docTitle = `${stationName} (${stationCode}) - RFID Tag & TIN Allotment`;
      const tagPages = Math.max(1, Math.ceil(project.tags.length / 26));
      pagesHtml = renderTagInventorySheets(1, tagPages);
      break;
    }

    case "all": {
      docTitle = `${stationName} (${stationCode}) - KAVACH Table of Control (Full Booklet)`;
      const t1PageCount = t1Chunks.length;
      const totalPages = 2 + t1PageCount + 2 + 3;
      pagesHtml = `
        <!-- PAGE 1: Station Config Data Testing & General Information -->
        <div class="sheet-page">
          <div>
            ${renderHeader("STATION CONFIGURATION & SYSTEM VALIDATION DATA", "CONFIG")}
            <div class="section-title">1. GENERAL STATION CONFIGURATION & INTERLOCKING PARAMETERS</div>
            <table class="meta-table" style="margin-top: 4px;">
              <tr>
                <td style="width: 25%; font-weight: bold; background: #fafafa;">Station Name</td>
                <td style="width: 25%; font-weight: bold;">${stationName}</td>
                <td style="width: 25%; font-weight: bold; background: #fafafa;">Station Code</td>
                <td style="width: 25%; font-weight: bold;">${stationCode}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; background: #fafafa;">Station ID</td>
                <td style="font-family: monospace; font-weight: bold;">${stationId}</td>
                <td style="font-weight: bold; background: #fafafa;">Railway / Division</td>
                <td>${railway} / ${division}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; background: #fafafa;">Chainage Direction</td>
                <td>${project.metadata.chainageDirection === "RIGHT_INCREASING" ? "Increasing Right (→)" : "Increasing Left (←)"}</td>
                <td style="font-weight: bold; background: #fafafa;">Interlocking System</td>
                <td>Electronic Interlocking (EI) / RDSO SPN-196 Amdt-6</td>
              </tr>
              <tr>
                <td style="font-weight: bold; background: #fafafa;">Left Adjacent Station ID</td>
                <td>${project.metadata.nextUpStationId || "----"}</td>
                <td style="font-weight: bold; background: #fafafa;">Right Adjacent Station ID</td>
                <td>${project.metadata.nextDownStationId || "----"}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; background: #fafafa;">Level Crossings in Yard</td>
                <td>${project.levelCrossings.length > 0 ? `${project.levelCrossings.length} (${project.levelCrossings.map((lc) => lc.name || lc.id).join(", ")})` : "NIL"}</td>
                <td style="font-weight: bold; background: #fafafa;">Running Lines Count</td>
                <td>${project.tracks.length} Running Lines (${project.tracks.map((t) => t.name).join(", ") || "----"})</td>
              </tr>
            </table>

            <div class="section-title" style="margin-top: 14px;">2. STATION LIMITS & TRACK INVENTORY SUMMARY</div>
            <table class="data-table" style="margin-top: 4px;">
              <thead>
                <tr>
                  <th>Line ID</th>
                  <th>Track Name</th>
                  <th>Line Classification</th>
                  <th>Direction</th>
                  <th>Track Circuits in Yard</th>
                  <th>TINs Configured</th>
                </tr>
              </thead>
              <tbody>
                ${project.tracks
                  .map(
                    (t) => `
                  <tr>
                    <td class="mono bold text-center">${t.id}</td>
                    <td class="bold">${t.name}</td>
                    <td>${t.lineType}</td>
                    <td class="text-center">${t.direction}</td>
                    <td class="mono">${t.trackCircuit || "--"}</td>
                    <td class="mono">${t.tinList?.join(", ") || "--"}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          ${renderFooter("CONFIG", 1, totalPages)}
        </div>

        <!-- PAGE 2: Handover Testing & Shunting Limits Table -->
        <div class="sheet-page">
          <div>
            ${renderHeader("HANDOVER TESTING & SHUNTING LIMITS TABLE", "HANDOVER")}
            <div class="section-title">1. SHUNTING LIMIT TABLE (RDSO Annexure-I Amdt-6)</div>
            <table class="meta-table" style="margin-top: 4px;">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Adjacent Station Name</th>
                  <th>Direction</th>
                  <th>RFID Tag No</th>
                  <th>TIN</th>
                  <th>Absolute Location in meter</th>
                </tr>
              </thead>
              <tbody>
                ${(project.shuntingLimits || [])
                  .map(
                    (s, idx) => `
                  <tr>
                    <td class="text-center mono bold">${idx + 1}</td>
                    <td class="bold text-center">${s.adjacentStation || s.adjacentStationName}</td>
                    <td class="text-center">${s.direction}</td>
                    <td class="mono bold text-center">${s.rfidTag || s.rfidTagNo}</td>
                    <td class="mono text-center">${s.tin}</td>
                    <td class="mono text-right bold">${s.absoluteLocationM}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>

            <div class="section-title" style="margin-top: 14px;">2. OPERATIONAL SPEEDS & SIGNAL OVERRIDE LIMITS</div>
            <table class="meta-table" style="margin-top: 4px;">
              <tr>
                <td style="width: 50%; font-weight: bold; background: #fafafa;">Signals Override (OV) not required at zero speed:</td>
                <td style="width: 50%; font-family: monospace; font-weight: bold; color: #1e3a8a;">
                  ${(project.signalsOverrideOv && project.signalsOverrideOv.length > 0 ? project.signalsOverrideOv : project.signals.filter((s) => s.signalType.includes("Advanced") || s.signalType.includes("IB")).map((s) => s.name)).join(", ") || "None"}
                </td>
              </tr>
              <tr>
                <td style="font-weight: bold; background: #fafafa;">Authorized speed on detection of train in Onsight mode (kmph):</td>
                <td style="font-family: monospace; font-weight: bold;">
                  ${project.authorizedSpeedOnSightKmph || 100} kmph
                </td>
              </tr>
              <tr>
                <td style="font-weight: bold; background: #fafafa;">Maximum Permissible Speed (MPS) in Station Section:</td>
                <td style="font-family: monospace; font-weight: bold;">
                  ${project.sectionSpeedKmph || 110} kmph
                </td>
              </tr>
            </table>
          </div>
          ${renderFooter("HANDOVER", 2, totalPages)}
        </div>

        <!-- Table 1 Parts (Dynamically Paged) -->
        ${t1Chunks.map((chunk, idx) => renderTable1Sheet(chunk, idx + 1, t1Chunks.length, idx + 3, totalPages, idx === t1Chunks.length - 1)).join("")}

        <!-- Table 2 Part 1 -->
        ${renderTable2Sheet(tp1, 3 + t1PageCount, totalPages, 0)}

        <div class="sheet-page">
          <div>
            ${renderHeader("STATIONARY KAVACH TRACK PROFILE TABLE & TSR ROUTE TABLE", "TP")}
            <div class="section-title">TABLE 2: TRACK PROFILE TABLE - PART 2</div>
            <table class="data-table" style="margin-top: 4px;">
              <thead>
                <tr>
                  <th rowspan="2">S.No</th>
                  <th rowspan="2">Entry Sig</th>
                  <th rowspan="2">Exit Sig</th>
                  <th rowspan="2">Line</th>
                  <th colspan="3">Turnout Speed</th>
                  <th rowspan="2">PSR Segments</th>
                  <th rowspan="2">PSR Class (A, B, C)</th>
                  <th colspan="2">Gradient</th>
                  <th colspan="4">Level Crossing Gate</th>
                </tr>
                <tr>
                  <th>Speed</th>
                  <th>Start (m)</th>
                  <th>Len (m)</th>
                  <th>Engineering</th>
                  <th>Average</th>
                  <th>Gate ID</th>
                  <th>Dist (m)</th>
                  <th>Manning</th>
                  <th>Class</th>
                </tr>
              </thead>
              <tbody>
                ${tp2
                  .map(
                    (tp, idx) => `
                  <tr>
                    <td class="text-center mono bold">${tp.slNo || idx + tp1.length + 1}</td>
                    <td class="mono bold text-center">${tp.entrySignal}</td>
                    <td class="mono bold text-center">${tp.exitSignal}</td>
                    <td>${tp.line}</td>
                    <td class="mono text-center bold">${tp.turnoutSpeedKmph ?? "--"}</td>
                    <td class="mono text-center">${tp.turnoutStartDistM ?? "--"}</td>
                    <td class="mono text-center">${tp.turnoutLengthM ?? "--"}</td>
                    <td class="mono" style="font-size: 6.5pt;">${tp.psrSegments?.map((s) => `(${s.staticSpeedType}, ${s.speedKmph}, ${s.lengthM}m)`).join("; ") || "--"}</td>
                    <td class="mono text-center" style="font-size: 6.5pt;">${tp.psrClassSegments?.map((c) => `A:${c.classA}, B:${c.classB}, C:${c.classC}`).join("; ") || "--"}</td>
                    <td class="mono" style="font-size: 6.5pt;">${tp.engineeringGradients?.map((g) => `(${g.gradientValue}, ${g.lengthM}m)`).join(", ") || "--"}</td>
                    <td class="mono text-center" style="font-size: 6.5pt;">${tp.averageGradients?.map((g) => `${g.avgGradientValue}`).join("; ") || "--"}</td>
                    <td class="mono bold text-center">${tp.lcId || "--"}</td>
                    <td class="mono text-center">${tp.lcDistanceM ?? "--"}</td>
                    <td class="text-center">${tp.lcManningType || "--"}</td>
                    <td class="text-center">${tp.lcClass || "--"}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>

            <div class="section-title" style="margin-top: 10px;">TABLE 3: KAVACH TSR ROUTE TABLE (RDSO Cl. I.2.12.6)</div>
            <table class="data-table" style="margin-top: 2px;">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>OHE Line Name</th>
                  <th>Entry Sig</th>
                  <th>Exit Sig</th>
                  <th>TSR Route ID</th>
                  <th>Start RFID Tag</th>
                  <th>Dist from Start (m)</th>
                  <th>Last Pole Dist (m)</th>
                  <th>OHE Pole/Km Data</th>
                </tr>
              </thead>
              <tbody>
                ${(project.tsrRoutes || [])
                  .map(
                    (t, idx) => `
                  <tr>
                    <td class="text-center mono bold">${t.slNo || idx + 1}</td>
                    <td class="bold">${t.oheLineName || t.oheLine}</td>
                    <td class="mono bold text-center">${t.entrySignal}</td>
                    <td class="mono bold text-center">${t.exitSignal}</td>
                    <td class="mono bold text-center">${t.tsrRouteId}</td>
                    <td class="mono bold text-center">${t.startRfidTag || t.oheLineStartRfidTag}</td>
                    <td class="mono text-center">${t.entrySignalDistFromStartTagM ?? t.entrySignalDistanceM ?? 0}</td>
                    <td class="mono text-center">${t.lastPoleDistFromExitSignalM ?? t.lastPoleDistanceM ?? 0}</td>
                    <td class="mono" style="font-size: 6.5pt;">${t.ohePoleKmData || (t.ohePoles ? t.ohePoles.map((p) => `(${p.distanceM}-${p.poleId})`).join(", ") : "--")}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          ${renderFooter("TP", 4 + t1PageCount, totalPages)}
        </div>

        <!-- Table 4 Parts -->
        <div class="sheet-page">
          <div>
            ${renderHeader("TEMPORARY SINGLE LINE (TSL) WORKING - SELECTION TABLE", "TSL")}
            <div class="section-title">TABLE 4: TSL SELECTION TABLE - PART 1</div>
            <table class="data-table" style="margin-top: 4px;">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>TSL Entry Sig</th>
                  <th>TSL Exit Sig</th>
                  <th>Signal / Line Type</th>
                  <th>Aspect Entry</th>
                  <th>Requires Aspect Exit</th>
                  <th>Route Command for TSL</th>
                  <th>Points Normal</th>
                  <th>Points Reverse</th>
                  <th>Track Ckt / Axle Counter</th>
                  <th>TINs Free</th>
                  <th>Foot Tag</th>
                  <th>Dist (m)</th>
                  <th>MA</th>
                  <th>Auth Speed (First / Subseq)</th>
                </tr>
              </thead>
              <tbody>
                ${tsl1
                  .map(
                    (tsl) => `
                  <tr>
                    <td class="text-center mono bold">${tsl.slNo}</td>
                    <td class="mono bold text-center">${tsl.tslEntrySignal}</td>
                    <td class="mono bold text-center">${tsl.tslExitSignal}</td>
                    <td>${tsl.lineOrSignalType}</td>
                    <td class="bold text-center">${tsl.aspectOfEntrySignal}</td>
                    <td class="text-center">${tsl.requiresAspectOfExitSignal}</td>
                    <td class="mono bold text-center">${tsl.requiredRouteCommand}</td>
                    <td class="mono text-center">${tsl.pointsNormal.join(", ") || "-"}</td>
                    <td class="mono text-center">${tsl.pointsReverse.join(", ") || "-"}</td>
                    <td>${tsl.trackCktUpOrAxleCounterFree}</td>
                    <td class="mono">${tsl.tinsRequiresFree.join(", ") || "-"}</td>
                    <td class="mono bold text-center">${tsl.entryFootTag}</td>
                    <td class="mono text-right bold">${tsl.distanceBetweenSignalsM}</td>
                    <td class="mono text-center bold">${tsl.movementAuthoritySections}</td>
                    <td class="mono text-center bold">${tsl.authorizedSpeedOsFirstTrain} / ${tsl.authorizedSpeedOsSubsequentTrains}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          ${renderFooter("TSL", 5 + t1PageCount, totalPages)}
        </div>

        <div class="sheet-page">
          <div>
            ${renderHeader("TEMPORARY SINGLE LINE (TSL) WORKING - SELECTION TABLE", "TSL")}
            <div class="section-title">TABLE 4: TSL SELECTION TABLE - PART 2</div>
            <table class="data-table" style="margin-top: 4px;">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>TSL Entry Sig</th>
                  <th>TSL Exit Sig</th>
                  <th>Signal / Line Type</th>
                  <th>Aspect Entry</th>
                  <th>Requires Aspect Exit</th>
                  <th>Route Command for TSL</th>
                  <th>Points Normal</th>
                  <th>Points Reverse</th>
                  <th>Track Ckt / Axle Counter</th>
                  <th>TINs Free</th>
                  <th>Foot Tag</th>
                  <th>Dist (m)</th>
                  <th>MA</th>
                  <th>Auth Speed (First / Subseq)</th>
                </tr>
              </thead>
              <tbody>
                ${tsl2
                  .map(
                    (tsl) => `
                  <tr>
                    <td class="text-center mono bold">${tsl.slNo}</td>
                    <td class="mono bold text-center">${tsl.tslEntrySignal}</td>
                    <td class="mono bold text-center">${tsl.tslExitSignal}</td>
                    <td>${tsl.lineOrSignalType}</td>
                    <td class="bold text-center">${tsl.aspectOfEntrySignal}</td>
                    <td class="text-center">${tsl.requiresAspectOfExitSignal}</td>
                    <td class="mono bold text-center">${tsl.requiredRouteCommand}</td>
                    <td class="mono text-center">${tsl.pointsNormal.join(", ") || "-"}</td>
                    <td class="mono text-center">${tsl.pointsReverse.join(", ") || "-"}</td>
                    <td>${tsl.trackCktUpOrAxleCounterFree}</td>
                    <td class="mono">${tsl.tinsRequiresFree.join(", ") || "-"}</td>
                    <td class="mono bold text-center">${tsl.entryFootTag}</td>
                    <td class="mono text-right bold">${tsl.distanceBetweenSignalsM}</td>
                    <td class="mono text-center bold">${tsl.movementAuthoritySections}</td>
                    <td class="mono text-center bold">${tsl.authorizedSpeedOsFirstTrain} / ${tsl.authorizedSpeedOsSubsequentTrains}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>

            <div class="section-title" style="margin-top: 10px;">TSL BLOCK SECTION DETAILS (Annexure-I Amdt-6)</div>
            <table class="meta-table" style="margin-top: 2px;">
              <thead>
                <tr>
                  <th>Last Stop Signal</th>
                  <th>Dist to Next Stop Sig (m)</th>
                  <th>Block Section TIN</th>
                  <th>Direction</th>
                  <th>Adjacent Line TINs</th>
                  <th>Next Stn ID</th>
                  <th>Border RFID with Location</th>
                  <th>Authorised Speed</th>
                </tr>
              </thead>
              <tbody>
                ${(project.tslBlockSections || [])
                  .map(
                    (b) => `
                  <tr>
                    <td class="mono bold text-center">${b.lastStopSignal}</td>
                    <td class="mono text-center">${b.lastSignalMaMeters}</td>
                    <td class="mono bold text-center">${b.blockSectionTin}</td>
                    <td class="text-center">${b.direction}</td>
                    <td class="mono text-center">${b.adjacentLineTins}</td>
                    <td class="mono bold text-center">${b.nextStationId}</td>
                    <td class="mono text-center">${b.nextStationBorderRfid}</td>
                    <td class="text-center bold">${b.authorisedSpeed || "MPS"}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          ${renderFooter("TSL", 6 + t1PageCount, totalPages)}
        </div>

        <div class="sheet-page">
          <div>
            ${renderHeader("TEMPORARY SINGLE LINE (TSL) TRACK PROFILE TABLE", "TSL_TP")}
            <div class="section-title">TABLE 4: TSL TRACK PROFILE TABLE</div>
            <table class="data-table" style="margin-top: 4px;">
              <thead>
                <tr>
                  <th rowspan="2">S.No</th>
                  <th rowspan="2">Entry Sig</th>
                  <th rowspan="2">Exit Sig</th>
                  <th rowspan="2">Line</th>
                  <th colspan="3">Turnout Speed</th>
                  <th rowspan="2">PSR Segments</th>
                  <th rowspan="2">PSR Class (A, B, C)</th>
                  <th colspan="2">Gradient</th>
                  <th colspan="4">Level Crossing Gate</th>
                </tr>
                <tr>
                  <th>Speed</th>
                  <th>Start (m)</th>
                  <th>Len (m)</th>
                  <th>Engineering</th>
                  <th>Average</th>
                  <th>Gate ID</th>
                  <th>Dist (m)</th>
                  <th>Manning</th>
                  <th>Class</th>
                </tr>
              </thead>
              <tbody>
                ${(project.tslTrackProfiles || [])
                  .map(
                    (tp, idx) => `
                  <tr>
                    <td class="text-center mono bold">${tp.slNo || idx + 1}</td>
                    <td class="mono bold text-center">${tp.entrySignal}</td>
                    <td class="mono bold text-center">${tp.exitSignal}</td>
                    <td>${tp.line}</td>
                    <td class="mono text-center bold">${tp.turnoutSpeedKmph ?? "--"}</td>
                    <td class="mono text-center">${tp.turnoutStartDistM ?? "--"}</td>
                    <td class="mono text-center">${tp.turnoutLengthM ?? "--"}</td>
                    <td class="mono" style="font-size: 6.5pt;">${tp.psrSegments?.map((s) => `(${s.staticSpeedType}, ${s.speedKmph}, ${s.lengthM}m)`).join("; ") || "--"}</td>
                    <td class="mono text-center" style="font-size: 6.5pt;">${tp.psrClassSegments?.map((c) => `A:${c.classA}, B:${c.classB}, C:${c.classC}`).join("; ") || "--"}</td>
                    <td class="mono" style="font-size: 6.5pt;">${tp.engineeringGradients?.map((g) => `(${g.gradientValue}, ${g.lengthM}m)`).join(", ") || "--"}</td>
                    <td class="mono text-center" style="font-size: 6.5pt;">${tp.averageGradients?.map((g) => `${g.avgGradientValue}`).join("; ") || "--"}</td>
                    <td class="mono bold text-center">${tp.lcId || "--"}</td>
                    <td class="mono text-center">${tp.lcDistanceM ?? "--"}</td>
                    <td class="text-center">${tp.lcManningType || "--"}</td>
                    <td class="text-center">${tp.lcClass || "--"}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          ${renderFooter("TSL_TP", 7 + t1PageCount, totalPages)}
        </div>
      `;
      break;
    }

    case "selection":
    default: {
      docTitle = `${stationName} (${stationCode}) - Table 1 Table of Control`;
      const totalPages = t1Chunks.length;
      pagesHtml = t1Chunks
        .map((chunk, idx) =>
          renderTable1Sheet(
            chunk,
            idx + 1,
            totalPages,
            idx + 1,
            totalPages,
            idx === t1Chunks.length - 1,
          ),
        )
        .join("");
      break;
    }
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${docTitle}</title>
  <style>
    @page {
      size: A3 landscape;
      margin: 8mm 6mm;
    }
    * {
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-size: 7.5pt;
      line-height: 1.25;
    }
    .sheet-page {
      width: 404mm;
      min-height: 275mm;
      page-break-after: always;
      page-break-inside: avoid;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      border: 2px solid #000;
      padding: 6px;
      margin-bottom: 20px;
      background: #fff;
    }
    .sheet-page:last-child {
      page-break-after: auto;
    }
    @media print {
      body {
        margin: 0;
        padding: 0;
      }
      .sheet-page {
        margin-bottom: 0 !important;
        border: 2px solid #000;
        page-break-after: always;
        page-break-inside: avoid;
        height: 279mm;
        max-height: 279mm;
        overflow: hidden;
      }
      .sheet-page:last-child {
        page-break-after: auto;
      }
    }
    .header-table, .data-table, .meta-table, .approval-table {
      width: 100%;
      border-collapse: collapse;
    }
    .header-table td {
      border: 1px solid #000;
      padding: 3px 6px;
      vertical-align: middle;
    }
    .data-table th, .data-table td, .meta-table th, .meta-table td, .approval-table td {
      border: 1px solid #000;
      padding: 2.5px 3.5px;
    }
    .data-table th, .meta-table th {
      background-color: #f0f0f0;
      font-weight: 700;
      text-align: center;
      font-size: 7pt;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 7pt; }
    .title-banner {
      font-size: 12pt;
      font-weight: 900;
      letter-spacing: 0.5px;
      text-align: center;
      text-transform: uppercase;
    }
    .subtitle {
      font-size: 8.5pt;
      font-weight: 600;
      text-align: center;
    }
    .section-title {
      font-size: 8.5pt;
      font-weight: 800;
      background: #e4e4e4;
      padding: 3px;
      margin-top: 6px;
      border: 1px solid #000;
      border-bottom: none;
    }
  </style>
</head>
<body>
  ${pagesHtml}
</body>
</html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 400);
}
