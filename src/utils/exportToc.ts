import * as XLSX from 'xlsx';
import type { StationProject } from '../types/signalling';

function formatRfidSequence(r: StationProject['routes'][0]): string {
  const parts: string[] = [];
  if (r.entryFootTag && r.entryFootTag !== '-' && r.entryFootTag !== '--') {
    parts.push(`(0, ${r.entryFootTag})`);
  }
  for (const item of r.linkingSequence) {
    if (r.entryFootTag && item.tagId === r.entryFootTag) continue;
    parts.push(`(${item.distanceM}, ${item.tagId})`);
  }
  if (parts.length === 0) {
    return r.enRouteTags.join(', ') || '-';
  }
  return parts.join(', ');
}

export function exportTocToExcel(project: StationProject) {
  const wb = XLSX.utils.book_new();

  // ---------------------------------------------------------------------------
  // Sheet 1: Stationary KAVACH Table of Control (TOC) - RDSO SPN-196 Amdt-6 Table 1
  // ---------------------------------------------------------------------------
  const tocRows: Array<Record<string, unknown>> = [];

  for (const r of project.routes) {
    const seqStr = formatRfidSequence(r);
    const permutations = (r.aspectPermutations && r.aspectPermutations.length > 0)
      ? r.aspectPermutations
      : [
          {
            aspectOfEntrySignal: r.aspectOfEntrySignal || r.entryAspectSummary || 'Green',
            requiresAspectOfExitSignal: r.requiresAspectOfExitSignal || r.exitAspectsSummary || `${r.exitSignal} Green`,
            movementAuthoritySections: r.movementAuthoritySections || '4',
            authorizedSpeedOs: r.authorizedSpeedOs || 'MPS',
          },
        ];

    permutations.forEach((perm, pIdx) => {
      tocRows.push({
        'S.No': pIdx === 0 ? r.slNo : '',
        'Entry Signal': pIdx === 0 ? r.entrySignal : '',
        'Exit Signal': pIdx === 0 ? r.exitSignal : '',
        'Line': pIdx === 0 ? r.leadingToLine : '',
        'TSRMS Route ID': pIdx === 0 ? (r.tsrmsRouteId || String(r.slNo)) : '',
        'Section Type': pIdx === 0 ? (r.sectionType || 'Station Section') : '',
        'Signal Type': pIdx === 0 ? r.signalType : '',
        'Aspect of Entry Signal': perm.aspectOfEntrySignal,
        'Requires Aspects of Exit Signal': perm.requiresAspectOfExitSignal,
        'Points in Route (Normal)': pIdx === 0 ? (r.pointsNormal.join(', ') || '-') : '',
        'Points in Route (Reverse)': pIdx === 0 ? (r.pointsReverse.join(', ') || '-') : '',
        'Requires Track Ckt Up in Route': pIdx === 0 ? (r.trackCktUp || '-') : '',
        'Requires Track Ckt Up in Overlap': pIdx === 0 ? (r.trackCircuitInOverlap || r.overlapTrackCkt || '-') : '',
        'TINs Requires Free': pIdx === 0 ? (r.tinsRequiresFree.join(', ') || '-') : '',
        'TIN Required Free in Overlap': pIdx === 0 ? (r.tinsInOverlap?.join(', ') || r.overlapTins?.join(', ') || '-') : '',
        'Entry Signal Foot Tag': pIdx === 0 ? r.entryFootTag : '',
        'Check RFID Sequence (Distance, En-Route Tag)': pIdx === 0 ? seqStr : '',
        'Distance between Entry & Exit Signal (m)': pIdx === 0 ? r.distanceBetweenSignalsM : '',
        'Movement Authority From Foot of Entry Signal (in Sections)': perm.movementAuthoritySections,
        'Authorized Speed (kmph) in OS': perm.authorizedSpeedOs,
      });
    });
  }

  const wsToc = XLSX.utils.json_to_sheet(tocRows);

  // Append Blank lines then Block Section Details, Signals Override, Shunting Limits
  const blockSectionDetails = project.blockSections || [];
  if (blockSectionDetails.length > 0) {
    const blockRows = blockSectionDetails.map((b) => ({
      'Last Stop Signal for entering into Block Section': b.lastStopSignal,
      'Distance from LSS to Next Approaching Stop Signal in meter': b.lastSignalMaMeters || 5230,
      'Block Section TIN': b.blockSectionTin,
      'Direction UP/Down': b.direction || 'Down',
      'Adjacent Line TINs': b.adjacentLineTins,
      'Next Station Id': b.nextStationId,
      'Next Station Border RFID with Location': b.nextStationBorderRfid,
      'Movement Authorised Speed': b.authorisedSpeed || 'MPS',
      'Start Distance to Absolute Location Reset (m)': b.startDistAbsResetM,
      'Absolute Location Correction (m)': b.absLocationCorrectionM,
      'Loco Direction after Adjustment': b.locoDirectionAfterAdj,
    }));
    XLSX.utils.sheet_add_aoa(wsToc, [[''], ['BLOCK SECTION DETAILS (Annexure-I Amdt-6)']], { origin: -1 });
    XLSX.utils.sheet_add_json(wsToc, blockRows, { origin: -1 });
  }

  // Signals Override OV & On-Sight Speed
  const ovSignals = project.signalsOverrideOv?.join(', ') || 'S6, S25, S24';
  const osSpeed = project.authorizedSpeedOnSightKmph || 100;
  XLSX.utils.sheet_add_aoa(
    wsToc,
    [
      [''],
      ['Signals Override (OV) not required at zero speed:', ovSignals],
      ['Authorized speed on detection of train in Onsight mode (kmph):', osSpeed],
      [''],
    ],
    { origin: -1 }
  );

  // Shunting Limits Table
  const shuntingLimits = project.shuntingLimits || [
    { adjacentStation: project.metadata.nextDownStationId || 'GGD', direction: 'Nominal', rfidTag: 'R-716', tin: 'N-96', absoluteLocationM: 122790 },
    { adjacentStation: project.metadata.nextDownStationId || 'GGD', direction: 'Nominal', rfidTag: 'R-683', tin: 'N-91', absoluteLocationM: 122670 },
    { adjacentStation: project.metadata.nextDownStationId || 'GGD', direction: 'Nominal', rfidTag: 'R-687', tin: 'N-53', absoluteLocationM: 122240 },
    { adjacentStation: project.metadata.nextUpStationId || 'VKB', direction: 'Reverse', rfidTag: 'R-709', tin: 'N-94', absoluteLocationM: 121160 },
    { adjacentStation: project.metadata.nextUpStationId || 'VKB', direction: 'Reverse', rfidTag: 'R-690', tin: 'N-95', absoluteLocationM: 121280 },
  ];
  const shuntingRows = shuntingLimits.map((s) => ({
    'Adjacent Station Name': s.adjacentStation,
    'Direction': s.direction,
    'RFID Tag No': s.rfidTag,
    'TIN': s.tin,
    'Absolute Location in meter': s.absoluteLocationM,
  }));
  XLSX.utils.sheet_add_aoa(wsToc, [['SHUNTING LIMIT TABLE (Annexure-I Amdt-6)']], { origin: -1 });
  XLSX.utils.sheet_add_json(wsToc, shuntingRows, { origin: -1 });

  XLSX.utils.book_append_sheet(wb, wsToc, 'Stationary KAVACH TOC');

  // ---------------------------------------------------------------------------
  // Sheet 2: Stationary KAVACH Track Profile Table - RDSO SPN-196 Amdt-6 Table 2
  // ---------------------------------------------------------------------------
  const trackProfileRows = (project.trackProfiles || []).map((tp, idx) => {
    const psrStr = tp.psrSegments.map((s) => `(${s.staticSpeedType}, ${s.speedKmph}, ${s.lengthM})`).join('; ') || '--';
    const engGradStr = tp.engineeringGradients.map((g) => `(${g.gradientValue}, ${g.lengthM}m)`).join(', ') || '--';
    const avgGradStr = tp.averageGradients.map((g) => `${g.avgGradientValue} ${g.lengthM}m`).join('; ') || '--';
    const tcStr = tp.trackConditionType ? `${tp.trackConditionType} ${tp.trackConditionStartDistM ?? 0}m from Entry` : '--';

    return {
      'S.No': tp.slNo || idx + 1,
      'Entry Signal': tp.entrySignal,
      'Exit Signal': tp.exitSignal,
      'Line': tp.line,
      'Turnout Speed Value (kmph)': tp.turnoutSpeedKmph ?? '--',
      'Turnout Start Distance (m)': tp.turnoutStartDistM ?? '--',
      'Turnout Restriction Length (m)': tp.turnoutLengthM ?? '--',
      'Permanent Speed Restriction (Type, Speed, Length)': psrStr,
      'Engineering Gradient (Value, Length)': engGradStr,
      'Average Gradient (Value, Length)': avgGradStr,
      'LC Gate ID': tp.lcId || '--',
      'LC Distance from Entry Signal (m)': tp.lcDistanceM ?? '--',
      'LC Manning Type': tp.lcManningType || '--',
      'LC Class': tp.lcClass || '--',
      'LC Auto Whistling Type': tp.lcAutoWhistlingType || '--',
      'Track Condition (Type, Start Distance, Length)': tcStr,
    };
  });

  const wsTp = XLSX.utils.json_to_sheet(trackProfileRows);
  XLSX.utils.book_append_sheet(wb, wsTp, 'Track Profile Table');

  // ---------------------------------------------------------------------------
  // Sheet 3: Stationary KAVACH TSR Route Table - RDSO SPN-196 Amdt-6 Table 3
  // ---------------------------------------------------------------------------
  const tsrRows = (project.tsrRoutes || []).map((tsr, idx) => ({
    'S.No': tsr.slNo || idx + 1,
    'OHE Line Name': tsr.oheLineName,
    'Entry Signal': tsr.entrySignal,
    'Exit Signal': tsr.exitSignal,
    'TSR Route ID': tsr.tsrRouteId,
    'Start RFID Tag': tsr.startRfidTag,
    'Entry Signal Distance from Start RFID Tag (m)': tsr.entrySignalDistFromStartTagM,
    'Last Pole Distance from Exit Signal (m)': tsr.lastPoleDistFromExitSignalM,
    'OHE Pole/Km Data (in meter)': tsr.ohePoleKmData,
  }));

  const wsTsr = XLSX.utils.json_to_sheet(tsrRows);
  XLSX.utils.book_append_sheet(wb, wsTsr, 'KAVACH TSR Route Table');

  // ---------------------------------------------------------------------------
  // Sheet 4: Temporary Single Line (TSL) Working on Double Line - Table 4
  // ---------------------------------------------------------------------------
  const tslRows = (project.tslRoutes || []).map((tsl, idx) => {
    const seqStr = tsl.linkingSequence.map((s) => `(${s.distanceM}, ${s.tagId})`).join(', ');
    return {
      'S.No': tsl.slNo || idx + 1,
      'TSL Entry Signal': tsl.tslEntrySignal,
      'TSL Exit Signal': tsl.tslExitSignal,
      'Signal / Line Type': tsl.lineOrSignalType,
      'Aspect of Entry Signal': tsl.aspectOfEntrySignal,
      'Requires Aspects of Exit Signal': tsl.requiresAspectOfExitSignal,
      'Required Route Command for TSL': tsl.requiredRouteCommand,
      'Points in Route (Normal)': tsl.pointsNormal.join(', ') || '-',
      'Points in Route (Reverse)': tsl.pointsReverse.join(', ') || '-',
      'Requires Track Ckt Up / Axle Counter Free': tsl.trackCktUpOrAxleCounterFree,
      'TINs Requires Free': tsl.tinsRequiresFree.join(', ') || '-',
      'Entry Signal Foot Tag': tsl.entryFootTag,
      'Check RFID Sequence (Distance, En-Route Tag)': seqStr,
      'Distance between Entry & Exit Signal (m)': tsl.distanceBetweenSignalsM,
      'Movement Authority (in Sections)': tsl.movementAuthoritySections,
      'Authorized Speed in OS (First Train / Subsequent Trains)': `${tsl.authorizedSpeedOsFirstTrain} / ${tsl.authorizedSpeedOsSubsequentTrains}`,
    };
  });

  const wsTsl = XLSX.utils.json_to_sheet(tslRows);
  XLSX.utils.book_append_sheet(wb, wsTsl, 'TSL Working on Double Line');

  // ---------------------------------------------------------------------------
  // Sheet 5: RFID Tag & TIN Allotment Inventory
  // ---------------------------------------------------------------------------
  const tagRows = project.tags.map((t) => ({
    'Tag ID': t.tagId,
    'Chainage (m)': t.chainageM ?? '--',
    'Track / Line': t.line,
    'TIN': t.tin || '--',
    'Tag Function Type': t.tagType,
    'Linked Signal': t.linkedSignal || '--',
    'Extraction Confidence': t.confidence,
    'Engineer Verified': t.verified ? 'YES' : 'NO',
    'Notes': t.notes || '',
  }));
  const wsTags = XLSX.utils.json_to_sheet(tagRows);
  XLSX.utils.book_append_sheet(wb, wsTags, 'RFID Tag & TIN Allotment');

  const safeCode = project.metadata.stationCode.replace(/[^A-Za-z0-9_-]/g, '') || 'STATION';
  XLSX.writeFile(wb, `${safeCode}_KAVACH_TOC_Amdt6_${project.metadata.stationId || '520'}.xlsx`);
}

export function exportTocToCsv(project: StationProject) {
  const headers = [
    'S.No',
    'Entry Signal',
    'Exit Signal',
    'Line',
    'TSRMS Route ID',
    'Section Type',
    'Signal Type',
    'Aspect of Entry Signal',
    'Requires Aspects of Exit Signal',
    'Points Normal',
    'Points Reverse',
    'Requires Track Ckt Up in Route',
    'Requires Track Ckt Up in Overlap',
    'TINs Requires Free',
    'TIN Required Free in Overlap',
    'Entry Signal Foot Tag',
    'Check RFID Sequence (Distance, En-Route Tag)',
    'Distance between Signals (m)',
    'MA (Sections)',
    'Authorized Speed OS (kmph)',
  ];

  const escapeCsv = (val: string | number | null | undefined) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines: string[] = [headers.join(',')];

  for (const r of project.routes) {
    const seqStr = formatRfidSequence(r);
    const permutations = (r.aspectPermutations && r.aspectPermutations.length > 0)
      ? r.aspectPermutations
      : [
          {
            aspectOfEntrySignal: r.aspectOfEntrySignal || r.entryAspectSummary || 'Green',
            requiresAspectOfExitSignal: r.requiresAspectOfExitSignal || r.exitAspectsSummary || `${r.exitSignal} Green`,
            movementAuthoritySections: r.movementAuthoritySections || '4',
            authorizedSpeedOs: r.authorizedSpeedOs || 'MPS',
          },
        ];

    permutations.forEach((perm, pIdx) => {
      lines.push(
        [
          pIdx === 0 ? r.slNo : '',
          pIdx === 0 ? r.entrySignal : '',
          pIdx === 0 ? r.exitSignal : '',
          pIdx === 0 ? r.leadingToLine : '',
          pIdx === 0 ? (r.tsrmsRouteId || String(r.slNo)) : '',
          pIdx === 0 ? (r.sectionType || 'Station Section') : '',
          pIdx === 0 ? r.signalType : '',
          perm.aspectOfEntrySignal,
          perm.requiresAspectOfExitSignal,
          pIdx === 0 ? (r.pointsNormal.join('; ') || '-') : '',
          pIdx === 0 ? (r.pointsReverse.join('; ') || '-') : '',
          pIdx === 0 ? (r.trackCktUp || '-') : '',
          pIdx === 0 ? (r.trackCircuitInOverlap || r.overlapTrackCkt || '-') : '',
          pIdx === 0 ? (r.tinsRequiresFree.join('; ') || '-') : '',
          pIdx === 0 ? (r.tinsInOverlap?.join('; ') || r.overlapTins?.join('; ') || '-') : '',
          pIdx === 0 ? r.entryFootTag : '',
          pIdx === 0 ? seqStr : '',
          pIdx === 0 ? r.distanceBetweenSignalsM : '',
          perm.movementAuthoritySections,
          perm.authorizedSpeedOs,
        ]
          .map(escapeCsv)
          .join(',')
      );
    });
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.metadata.stationCode || 'STATION'}_KAVACH_TOC_Amdt6.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportTocToPdf(project: StationProject) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    window.print();
    return;
  }

  const stationName = project.metadata.stationName || 'CHITGIDDA';
  const stationCode = project.metadata.stationCode || 'CTF';
  const stationId = project.metadata.stationId || '520';
  const division = project.metadata.division || 'Secunderabad';
  const railway = project.metadata.railwayZone || 'South Central Railway';
  const refSip = project.metadata.refLayout || 'IPU.0012C/ALT-5';
  const refToc = project.metadata.refToc || 'TC0012C/ALT-5';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${stationName} (${stationCode}) - KAVACH Table of Control</title>
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
      font-size: 8pt;
      line-height: 1.25;
    }
    .drawing-sheet {
      border: 2px solid #000;
      padding: 6px;
      margin-bottom: 20px;
      page-break-after: always;
    }
    .header-table, .data-table, .meta-table, .approval-table {
      width: 100%;
      border-collapse: collapse;
    }
    .header-table td {
      border: 1px solid #000;
      padding: 4px 6px;
      vertical-align: middle;
    }
    .data-table th, .data-table td, .meta-table th, .meta-table td, .approval-table td {
      border: 1px solid #000;
      padding: 3px 4px;
    }
    .data-table th, .meta-table th {
      background-color: #f0f0f0;
      font-weight: 700;
      text-align: center;
      font-size: 7.5pt;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 7.5pt; }
    .title-banner {
      font-size: 13pt;
      font-weight: 900;
      letter-spacing: 0.5px;
      text-align: center;
      text-transform: uppercase;
    }
    .subtitle {
      font-size: 9pt;
      font-weight: 600;
      text-align: center;
    }
    .section-title {
      font-size: 9pt;
      font-weight: 800;
      background: #e4e4e4;
      padding: 4px;
      margin-top: 8px;
      border: 1px solid #000;
      border-bottom: none;
    }
  </style>
</head>
<body>
  <!-- ===================================================================== -->
  <!-- SHEET 1: Stationary KAVACH Table of Control                           -->
  <!-- ===================================================================== -->
  <div class="drawing-sheet">
    <table class="header-table">
      <tr>
        <td style="width: 25%;">
          <div class="bold" style="font-size: 10pt;">INDIAN RAILWAYS</div>
          <div>${railway}</div>
          <div>${division} Division</div>
        </td>
        <td style="width: 50%;" class="text-center">
          <div class="title-banner">STATIONARY KAVACH TABLE OF CONTROL</div>
          <div class="subtitle">STATION: ${stationName} (${stationCode}) &nbsp;|&nbsp; STATION ID: ${stationId}</div>
          <div style="font-size: 7.5pt; margin-top: 2px;">IN ACCORDANCE WITH RDSO/SPN/196/2020 VERSION 4.0 AMDT-6 (ANNEXURE-I)</div>
        </td>
        <td style="width: 25%; font-size: 7.5pt;">
          <div><b>REF SIP NO:</b> ${refSip}</div>
          <div><b>REF TOC NO:</b> ${refToc}</div>
          <div><b>DRG NO:</b> KAVACH_TOC_${stationCode}_2.0.0</div>
          <div><b>REV NO:</b> 0 (Initial Revision)</div>
        </td>
      </tr>
    </table>

    <table class="data-table" style="margin-top: 6px;">
      <thead>
        <tr>
          <th rowspan="2">S.No</th>
          <th rowspan="2">Entry Sig</th>
          <th rowspan="2">Exit Sig</th>
          <th rowspan="2">Line</th>
          <th rowspan="2">TSRMS Route ID</th>
          <th rowspan="2">Section Type</th>
          <th rowspan="2">Signal Type</th>
          <th rowspan="2">Aspect of Entry Signal</th>
          <th rowspan="2">Requires Aspects of Exit Signal</th>
          <th colspan="2">Points in Route</th>
          <th colspan="2">Requires Track Ckt Up</th>
          <th colspan="2">TINs Required Free</th>
          <th rowspan="2">Entry Signal Foot Tag</th>
          <th rowspan="2">Check RFID Sequence (Distance, En-Route Tag)</th>
          <th rowspan="2">Dist (m)</th>
          <th rowspan="2">MA (Sec)</th>
          <th rowspan="2">Auth Speed OS (kmph)</th>
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
        ${project.routes
          .map((r) => {
            const seqStr = formatRfidSequence(r);
            const permutations = r.aspectPermutations && r.aspectPermutations.length > 0
              ? r.aspectPermutations
              : [
                  {
                    aspectOfEntrySignal: r.aspectOfEntrySignal || r.entryAspectSummary || 'Green',
                    requiresAspectOfExitSignal: r.requiresAspectOfExitSignal || r.exitAspectsSummary || `${r.exitSignal} Green`,
                    movementAuthoritySections: r.movementAuthoritySections || '4',
                    authorizedSpeedOs: r.authorizedSpeedOs || 'MPS',
                  },
                ];

            return permutations
              .map((p, pIdx) => `
              <tr>
                <td class="text-center mono bold">${pIdx === 0 ? r.slNo : ''}</td>
                <td class="mono bold text-center">${pIdx === 0 ? r.entrySignal : ''}</td>
                <td class="mono bold text-center">${pIdx === 0 ? r.exitSignal : ''}</td>
                <td>${pIdx === 0 ? r.leadingToLine : ''}</td>
                <td class="text-center mono">${pIdx === 0 ? (r.tsrmsRouteId || r.slNo) : ''}</td>
                <td>${pIdx === 0 ? (r.sectionType || 'Station Section') : ''}</td>
                <td>${pIdx === 0 ? r.signalType : ''}</td>
                <td class="bold text-center">${p.aspectOfEntrySignal}</td>
                <td class="text-center">${p.requiresAspectOfExitSignal}</td>
                <td class="mono text-center">${pIdx === 0 ? (r.pointsNormal.join(', ') || '-') : ''}</td>
                <td class="mono text-center">${pIdx === 0 ? (r.pointsReverse.join(', ') || '-') : ''}</td>
                <td class="mono">${pIdx === 0 ? (r.trackCktUp || '-') : ''}</td>
                <td class="mono">${pIdx === 0 ? (r.trackCircuitInOverlap || r.overlapTrackCkt || '-') : ''}</td>
                <td class="mono">${pIdx === 0 ? (r.tinsRequiresFree.join(', ') || '-') : ''}</td>
                <td class="mono">${pIdx === 0 ? (r.tinsInOverlap?.join(', ') || r.overlapTins?.join(', ') || '-') : ''}</td>
                <td class="mono text-center bold">${pIdx === 0 ? r.entryFootTag : ''}</td>
                <td class="mono" style="font-size: 7pt;">${pIdx === 0 ? seqStr : ''}</td>
                <td class="mono text-right bold">${pIdx === 0 ? r.distanceBetweenSignalsM : ''}</td>
                <td class="mono text-center bold">${p.movementAuthoritySections}</td>
                <td class="mono text-center bold">${p.authorizedSpeedOs}</td>
              </tr>
            `).join('');
          })
          .join('')}
      </tbody>
    </table>

    <!-- Block Section Details Table -->
    <div class="section-title">BLOCK SECTION DETAILS (Annexure-I Amdt-6)</div>
    <table class="meta-table">
      <thead>
        <tr>
          <th>Last Stop Signal</th>
          <th>Dist to Next Stop Signal (m)</th>
          <th>Block Section TIN</th>
          <th>Direction UP/Down</th>
          <th>Adjacent Line TINs</th>
          <th>Next Station ID</th>
          <th>Next Station Border RFID with Location</th>
          <th>Movement Auth Speed</th>
          <th>Start Dist Abs Reset (m)</th>
          <th>Abs Location Correction (m)</th>
          <th>Loco Direction After Adj</th>
        </tr>
      </thead>
      <tbody>
        ${(project.blockSections || []).map((b) => `
          <tr>
            <td class="mono bold text-center">${b.lastStopSignal}</td>
            <td class="mono text-center">${b.lastSignalMaMeters || 5230}</td>
            <td class="mono bold text-center">${b.blockSectionTin}</td>
            <td class="text-center">${b.direction || 'Down'}</td>
            <td class="mono text-center">${b.adjacentLineTins}</td>
            <td class="mono bold text-center">${b.nextStationId}</td>
            <td class="mono text-center">${b.nextStationBorderRfid}</td>
            <td class="text-center bold">${b.authorisedSpeed || 'MPS'}</td>
            <td class="mono text-center">${b.startDistAbsResetM}</td>
            <td class="mono text-center">${b.absLocationCorrectionM}</td>
            <td class="text-center">${b.locoDirectionAfterAdj}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <table style="width: 100%; margin-top: 6px; font-size: 7.5pt; border-collapse: collapse;">
      <tr>
        <td style="border: 1px solid #000; padding: 4px; width: 50%;">
          <b>Signals Override (OV) not required at zero speed:</b> ${(project.signalsOverrideOv || ['S6', 'S25', 'S24']).join(', ')}
        </td>
        <td style="border: 1px solid #000; padding: 4px; width: 50%;">
          <b>Authorized speed on detection of train in Onsight mode:</b> ${project.authorizedSpeedOnSightKmph || 100} kmph
        </td>
      </tr>
    </table>

    <!-- Shunting Limit Table -->
    <div class="section-title">SHUNTING LIMIT TABLE (Annexure-I Amdt-6)</div>
    <table class="meta-table">
      <thead>
        <tr>
          <th>Adjacent Station Name</th>
          <th>Direction</th>
          <th>RFID Tag No</th>
          <th>TIN</th>
          <th>Absolute Location in meter</th>
        </tr>
      </thead>
      <tbody>
        ${(project.shuntingLimits || []).map((s) => `
          <tr>
            <td class="bold text-center">${s.adjacentStation}</td>
            <td class="text-center">${s.direction}</td>
            <td class="mono bold text-center">${s.rfidTag}</td>
            <td class="mono text-center">${s.tin}</td>
            <td class="mono text-right bold">${s.absoluteLocationM}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- Approval Footer -->
    <table class="approval-table" style="margin-top: 8px;">
      <tr>
        <td style="width: 20%; height: 35px;">
          <div style="font-size: 7pt; color: #555;">PREPARED BY:</div>
          <div class="bold" style="font-size: 7.5pt; margin-top: 14px;">JE/SSE/Proj/HQ/SCR</div>
        </td>
        <td style="width: 20%;">
          <div style="font-size: 7pt; color: #555;">CHECKED BY:</div>
          <div class="bold" style="font-size: 7.5pt; margin-top: 14px;">ASTE/Proj/HQ/SCR</div>
        </td>
        <td style="width: 20%;">
          <div style="font-size: 7pt; color: #555;">RECOMMENDED BY:</div>
          <div class="bold" style="font-size: 7.5pt; margin-top: 14px;">Dy.CSTE/Proj/HQ/SCR</div>
        </td>
        <td style="width: 20%;">
          <div style="font-size: 7pt; color: #555;">APPROVED BY:</div>
          <div class="bold" style="font-size: 7.5pt; margin-top: 14px;">DIRECTOR / RDSO / LKO</div>
        </td>
        <td style="width: 20%;" class="text-center">
          <div class="bold">SHEET 1 OF 3</div>
          <div style="font-size: 7pt;">KAVACH_TOC_${stationCode}_2.0.0</div>
        </td>
      </tr>
    </table>
  </div>

  <!-- ===================================================================== -->
  <!-- SHEET 2: Track Profile Table & TSR Route Table                        -->
  <!-- ===================================================================== -->
  <div class="drawing-sheet">
    <table class="header-table">
      <tr>
        <td style="width: 25%;">
          <div class="bold" style="font-size: 10pt;">INDIAN RAILWAYS</div>
          <div>${railway} - ${division} Division</div>
        </td>
        <td style="width: 50%;" class="text-center">
          <div class="title-banner">STATIONARY KAVACH TRACK PROFILE TABLE</div>
          <div class="subtitle">STATION: ${stationName} (${stationCode}) &nbsp;|&nbsp; STATION ID: ${stationId}</div>
        </td>
        <td style="width: 25%; font-size: 7.5pt;">
          <div><b>DRG NO:</b> KAVACH_TP_${stationCode}_2.0.0</div>
          <div><b>REV NO:</b> 0 (Initial Revision)</div>
        </td>
      </tr>
    </table>

    <table class="data-table" style="margin-top: 6px;">
      <thead>
        <tr>
          <th rowspan="2">S.No</th>
          <th rowspan="2">Entry Sig</th>
          <th rowspan="2">Exit Sig</th>
          <th rowspan="2">Line</th>
          <th colspan="3">Turnout Speed</th>
          <th rowspan="2">Permanent Speed Restriction</th>
          <th colspan="2">Gradient</th>
          <th colspan="5">Level Crossing Gate</th>
          <th colspan="2">Track Condition</th>
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
          <th>Whistling</th>
          <th>Type &amp; Loc</th>
          <th>Len (m)</th>
        </tr>
      </thead>
      <tbody>
        ${(project.trackProfiles || []).map((tp, idx) => `
          <tr>
            <td class="text-center mono bold">${tp.slNo || idx + 1}</td>
            <td class="mono bold text-center">${tp.entrySignal}</td>
            <td class="mono bold text-center">${tp.exitSignal}</td>
            <td>${tp.line}</td>
            <td class="mono text-center bold">${tp.turnoutSpeedKmph ?? '--'}</td>
            <td class="mono text-center">${tp.turnoutStartDistM ?? '--'}</td>
            <td class="mono text-center">${tp.turnoutLengthM ?? '--'}</td>
            <td class="mono" style="font-size: 7pt;">${tp.psrSegments.map((s) => `(${s.staticSpeedType}, ${s.speedKmph}, ${s.lengthM}m)`).join('; ') || '--'}</td>
            <td class="mono" style="font-size: 7pt;">${tp.engineeringGradients.map((g) => `(${g.gradientValue}, ${g.lengthM}m)`).join(', ') || '--'}</td>
            <td class="mono" style="font-size: 7pt;">${tp.averageGradients.map((g) => `${g.avgGradientValue} ${g.lengthM}m`).join('; ') || '--'}</td>
            <td class="mono bold text-center">${tp.lcId || '--'}</td>
            <td class="mono text-center">${tp.lcDistanceM ?? '--'}</td>
            <td class="text-center">${tp.lcManningType || '--'}</td>
            <td class="text-center">${tp.lcClass || '--'}</td>
            <td class="text-center">${tp.lcAutoWhistlingType || '--'}</td>
            <td class="mono">${tp.trackConditionType ? `${tp.trackConditionType} ${tp.trackConditionStartDistM ?? 0}m` : '--'}</td>
            <td class="mono text-center">${tp.trackConditionLengthM ?? 0}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- TSR Route Table -->
    <div class="section-title">KAVACH TSR ROUTE TABLE (RDSO Cl. I.2.12.6)</div>
    <table class="data-table">
      <thead>
        <tr>
          <th>S.No</th>
          <th>OHE Line Name</th>
          <th>Entry Sig</th>
          <th>Exit Sig</th>
          <th>TSR Route ID</th>
          <th>Start RFID Tag</th>
          <th>Entry Sig Dist from Start Tag (m)</th>
          <th>Last Pole Dist from Exit (m)</th>
          <th>OHE Pole/Km Data (in meter)</th>
        </tr>
      </thead>
      <tbody>
        ${(project.tsrRoutes || []).map((t, idx) => `
          <tr>
            <td class="text-center mono bold">${t.slNo || idx + 1}</td>
            <td class="bold">${t.oheLineName}</td>
            <td class="mono bold text-center">${t.entrySignal}</td>
            <td class="mono bold text-center">${t.exitSignal}</td>
            <td class="mono bold text-center">${t.tsrRouteId}</td>
            <td class="mono bold text-center">${t.startRfidTag}</td>
            <td class="mono text-center">${t.entrySignalDistFromStartTagM}</td>
            <td class="mono text-center">${t.lastPoleDistFromExitSignalM}</td>
            <td class="mono" style="font-size: 7pt;">${t.ohePoleKmData}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <table class="approval-table" style="margin-top: 8px;">
      <tr>
        <td style="width: 25%;"><div style="font-size: 7pt; color: #555;">PREPARED BY:</div><div class="bold" style="margin-top: 14px;">JE/SSE/Proj/HQ/SCR</div></td>
        <td style="width: 25%;"><div style="font-size: 7pt; color: #555;">CHECKED BY:</div><div class="bold" style="margin-top: 14px;">ASTE/Proj/HQ/SCR</div></td>
        <td style="width: 25%;"><div style="font-size: 7pt; color: #555;">APPROVED BY:</div><div class="bold" style="margin-top: 14px;">DIRECTOR / RDSO / LKO</div></td>
        <td style="width: 25%;" class="text-center"><div class="bold">SHEET 2 OF 3</div><div>KAVACH_TP_${stationCode}_2.0.0</div></td>
      </tr>
    </table>
  </div>

  <!-- ===================================================================== -->
  <!-- SHEET 3: Temporary Single Line (TSL) Working on Double Line           -->
  <!-- ===================================================================== -->
  <div class="drawing-sheet">
    <table class="header-table">
      <tr>
        <td style="width: 25%;">
          <div class="bold" style="font-size: 10pt;">INDIAN RAILWAYS</div>
          <div>${railway} - ${division} Division</div>
        </td>
        <td style="width: 50%;" class="text-center">
          <div class="title-banner">TEMPORARY SINGLE LINE (TSL) WORKING ON DOUBLE LINE</div>
          <div class="subtitle">STATION: ${stationName} (${stationCode}) &nbsp;|&nbsp; STATION ID: ${stationId}</div>
        </td>
        <td style="width: 25%; font-size: 7.5pt;">
          <div><b>DRG NO:</b> KAVACH_TSL_${stationCode}_2.0.0</div>
          <div><b>REV NO:</b> 0 (Initial Revision)</div>
        </td>
      </tr>
    </table>

    <table class="data-table" style="margin-top: 6px;">
      <thead>
        <tr>
          <th>S.No</th>
          <th>TSL Entry Sig</th>
          <th>TSL Exit Sig</th>
          <th>Signal / Line Type</th>
          <th>Aspect of Entry Sig</th>
          <th>Requires Aspects Exit</th>
          <th>Route Command for TSL</th>
          <th>Points Normal</th>
          <th>Points Reverse</th>
          <th>Track Ckt / Axle Counter Free</th>
          <th>TINs Free</th>
          <th>Entry Foot Tag</th>
          <th>Check RFID Sequence</th>
          <th>Dist (m)</th>
          <th>MA (Sec)</th>
          <th>Auth Speed (First / Subseq)</th>
        </tr>
      </thead>
      <tbody>
        ${(project.tslRoutes || []).map((tsl, idx) => `
          <tr>
            <td class="text-center mono bold">${tsl.slNo || idx + 1}</td>
            <td class="mono bold text-center">${tsl.tslEntrySignal}</td>
            <td class="mono bold text-center">${tsl.tslExitSignal}</td>
            <td>${tsl.lineOrSignalType}</td>
            <td class="bold text-center">${tsl.aspectOfEntrySignal}</td>
            <td class="text-center">${tsl.requiresAspectOfExitSignal}</td>
            <td class="mono bold text-center">${tsl.requiredRouteCommand}</td>
            <td class="mono text-center">${tsl.pointsNormal.join(', ') || '-'}</td>
            <td class="mono text-center">${tsl.pointsReverse.join(', ') || '-'}</td>
            <td>${tsl.trackCktUpOrAxleCounterFree}</td>
            <td class="mono">${tsl.tinsRequiresFree.join(', ') || '-'}</td>
            <td class="mono bold text-center">${tsl.entryFootTag}</td>
            <td class="mono" style="font-size: 7pt;">${tsl.linkingSequence.map((s) => `(${s.distanceM}, ${s.tagId})`).join(', ')}</td>
            <td class="mono text-right bold">${tsl.distanceBetweenSignalsM}</td>
            <td class="mono text-center bold">${tsl.movementAuthoritySections}</td>
            <td class="mono text-center bold">${tsl.authorizedSpeedOsFirstTrain} / ${tsl.authorizedSpeedOsSubsequentTrains}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <table class="approval-table" style="margin-top: 14px;">
      <tr>
        <td style="width: 25%;"><div style="font-size: 7pt; color: #555;">PREPARED BY:</div><div class="bold" style="margin-top: 14px;">JE/SSE/Proj/HQ/SCR</div></td>
        <td style="width: 25%;"><div style="font-size: 7pt; color: #555;">CHECKED BY:</div><div class="bold" style="margin-top: 14px;">ASTE/Proj/HQ/SCR</div></td>
        <td style="width: 25%;"><div style="font-size: 7pt; color: #555;">APPROVED BY:</div><div class="bold" style="margin-top: 14px;">DIRECTOR / RDSO / LKO</div></td>
        <td style="width: 25%;" class="text-center"><div class="bold">SHEET 3 OF 3</div><div>KAVACH_TSL_${stationCode}_2.0.0</div></td>
      </tr>
    </table>
  </div>
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

export function exportCanonicalJson(project: StationProject) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.metadata.stationCode || 'STATION'}_Canonical_Model.json`;
  a.click();
  URL.revokeObjectURL(url);
}
