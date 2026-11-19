import type { LayoutToken } from "@/engine/offlineExtractor";
import type {
  RfidTag,
  SourceLayoutAsset,
  StationProject,
  TagFunctionType,
} from "@/types/signalling";
import { extractStationMetadata } from "../metadata/metadata";
import { extractTrackLines } from "../lines/lines";
import { extractSignals } from "../signals/signals";
import { buildRailwayGraph } from "../topology/topology_graph";
import { synthesizeTocRoutes } from "../routes/routes";
import { generateAllTables } from "../tables/table_generator";

export interface StationProcessingInput {
  fileName: string;
  tokens: LayoutToken[];
  sourceLayout?: SourceLayoutAsset;
  sourceSummary?: string;
}

const TAG_TOKEN_RE = /^[^A-Z0-9]{0,2}R\s*[-:.]?\s*(\d{2,4})[^A-Z0-9]{0,2}$/i;

function parseChainage(raw: string): number | null {
  const text = raw
    .toUpperCase()
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

export function processStationLayout(input: StationProcessingInput): StationProject {
  const { fileName, tokens } = input;
  const texts = tokens.filter((t) => !t.kind || t.kind === "text");
  const heights = texts.map((t) => t.height || 0).filter((h) => h > 0);
  heights.sort((a, b) => a - b);
  const h = heights[Math.floor(heights.length / 2)] || 8;

  // Module 1: Extract Station Metadata
  const metadata = extractStationMetadata({ fileName, tokens });

  // Module 2: Extract Track Lines & Direction
  const trackResult = extractTrackLines({ tokens, metadata });
  const { trackLines, rawLines } = trackResult;

  // Collect RFID tags with chainages for topology and linking
  const rfidTagList: Array<{ id: string; chainageM: number | null; x: number; lineId?: string }> =
    [];
  const rfidTagsForProject: RfidTag[] = [];

  const rawTags = texts.filter((t) => TAG_TOKEN_RE.test(t.text));
  rawTags.forEach((t, idx) => {
    const m = t.text.toUpperCase().match(TAG_TOKEN_RE);
    if (!m) return;
    const tagId = `R-${m[1]}`;

    // Find nearest chainage text using scale-independent distance (6.0 * h)
    const nearbyChainage = texts.find(
      (c) =>
        c.page === t.page &&
        Math.hypot(c.x - t.x, c.y - t.y) <= 6.0 * h &&
        parseChainage(c.text) !== null,
    );
    const chainageM = nearbyChainage ? parseChainage(nearbyChainage.text) : null;

    rfidTagList.push({ id: tagId, chainageM, x: t.x });

    // Determine tag type (SIGNAL_FOOT if near signal, GATE if near gate, else NORMAL)
    let tagType: TagFunctionType = "NORMAL";
    if (
      /S$/i.test(t.text) ||
      texts.some(
        (ot) =>
          ot.page === t.page &&
          Math.hypot(ot.x - t.x, ot.y - t.y) <= 2.5 * h &&
          /\bS\b/.test(ot.text),
      )
    ) {
      tagType = "SIGNAL_FOOT";
    } else if (
      texts.some(
        (ot) =>
          ot.page === t.page &&
          Math.hypot(ot.x - t.x, ot.y - t.y) <= 4.0 * h &&
          /\b(?:LC|GATE|G)\b/i.test(ot.text),
      )
    ) {
      tagType = "GATE";
    }

    rfidTagsForProject.push({
      id: `tag-${idx + 1}`,
      tagId,
      chainageM,
      line: trackLines[0]?.name || "MAIN LINE",
      tin: "",
      tagType,
      confidence: "HIGH",
      verified: true,
    });
  });

  // Module 3: Extract Physical Signals & Foot Tags
  const signalResult = extractSignals({
    tokens,
    trackLines,
    internalLines: rawLines,
  });

  // Module 3B: Compute Chainage Direction dynamically from tags, signals, and track chainage labels
  const chainagePoints: Array<{ x: number; chainageM: number }> = [];
  for (const tag of rfidTagList) {
    if (tag.chainageM !== null && Number.isFinite(tag.chainageM) && tag.chainageM > 0) {
      chainagePoints.push({ x: tag.x, chainageM: tag.chainageM });
    }
  }
  for (const sig of signalResult.signals) {
    if (
      sig.chainageM !== null &&
      Number.isFinite(sig.chainageM) &&
      sig.chainageM > 0 &&
      typeof sig.x === "number"
    ) {
      chainagePoints.push({ x: sig.x, chainageM: sig.chainageM });
    }
  }
  for (const t of texts) {
    const ch = parseChainage(t.text);
    if (ch !== null && Number.isFinite(ch) && ch > 0) {
      chainagePoints.push({ x: t.x, chainageM: ch });
    }
  }

  if (chainagePoints.length >= 2) {
    const meanX = chainagePoints.reduce((s, p) => s + p.x, 0) / chainagePoints.length;
    const meanC = chainagePoints.reduce((s, p) => s + p.chainageM, 0) / chainagePoints.length;
    const covariance = chainagePoints.reduce(
      (s, p) => s + (p.x - meanX) * (p.chainageM - meanC),
      0,
    );
    if (Math.abs(covariance) > 0) {
      metadata.chainageDirection = covariance > 0 ? "RIGHT_INCREASING" : "LEFT_INCREASING";
    }
  }

  // Module 4: Points and Level Crossings purged (deferred per 7-column scope)
  const points: any[] = [];
  const levelCrossings: any[] = [];

  // Module 5: Build Railway Topological Connectivity Graph
  const graph = buildRailwayGraph({
    signals: signalResult.signals,
    points,
    levelCrossings,
    trackLines,
    internalLines: rawLines,
    rfidTags: rfidTagList,
  });

  // Module 6: Route Discovery & 7-Column Synthesis
  const routeResult = synthesizeTocRoutes({
    graph,
    signals: signalResult.signals,
    points,
    levelCrossings,
    trackLines,
    metadata,
    rfidTags: rfidTagList,
  });

  // Module 7: Generate Complete 5-Table Dataset
  const tableDataset = generateAllTables({
    routes: routeResult.routes,
    trackLines,
    signals: signalResult.signals,
    points,
    levelCrossings,
    metadata,
    rfidTags: rfidTagList,
  });

  // Assemble full StationProject
  const downLss = signalResult.signals.find(
    (s) =>
      s.direction === "DOWN" &&
      (s.signalType === "ADVANCED_STARTER" || s.signalType === "AUTOMATIC"),
  );
  const upLss = signalResult.signals.find(
    (s) =>
      s.direction === "UP" && (s.signalType === "ADVANCED_STARTER" || s.signalType === "AUTOMATIC"),
  );

  const signalsOverrideOv: string[] = Array.from(
    new Set([
      ...(downLss ? [downLss.name] : []),
      ...(upLss ? [upLss.name] : []),
      ...signalResult.signals.filter((s) => s.signalType.includes("IB")).map((s) => s.name),
    ]),
  );

  const shuntingLimits = signalResult.signals
    .filter((s) => s.signalType === "STARTER" || s.signalType === "ADVANCED_STARTER")
    .slice(0, 5)
    .map((s) => ({
      adjacentStation:
        s.direction === "DOWN"
          ? metadata.nextDownStationId || "----"
          : metadata.nextUpStationId || "----",
      direction: s.direction === "DOWN" ? "Nominal" : "Reverse",
      rfidTag: s.footTagId || "----",
      tin: "----",
      absoluteLocationM: s.chainageM ?? 0,
    }));

  return {
    id: `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    metadata,
    tocFormatPreference: "STANDARD_SELECTION",
    tracks: trackLines,
    signals: signalResult.signals,
    points,
    tags: rfidTagsForProject,
    levelCrossings,
    routes: tableDataset.routes,
    blockSections: tableDataset.blockSections,
    tslBlockSections: tableDataset.tslBlockSections,
    trackProfiles: tableDataset.trackProfiles,
    tsrRoutes: tableDataset.tsrRoutes,
    tslRoutes: tableDataset.tslRoutes,
    tslTrackProfiles: tableDataset.tslTrackProfiles,
    shuntingLimits,
    signalsOverrideOv,
    authorizedSpeedOnSightKmph: 100,
    sectionSpeedKmph: 110,
    validationIssues: [],
    auditLog: [
      {
        id: `audit-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: "X-Tractor Universal Signal Engine",
        action: "Dynamic Multi-Station Extraction",
        target: fileName,
        details: `Processed in ${routeResult.mode} mode: ${trackLines.length} track lines, ${signalResult.signals.length} signals, ${points.length} points, ${levelCrossings.length} LC gates, and ${tableDataset.routes.length} synthesized TOC routes.`,
      },
    ],
    sourceSummary:
      input.sourceSummary || `X-Tractor universal dynamic pipeline extraction for ${fileName}`,
    sourceLayout: input.sourceLayout || {
      kind: (fileName.toLowerCase().endsWith(".dwg")
        ? "DWG"
        : fileName.toLowerCase().endsWith(".dxf")
          ? "DXF"
          : "PDF") as "DWG" | "DXF" | "PDF",
      fileName,
    },
  };
}
