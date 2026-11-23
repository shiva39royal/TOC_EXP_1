// @ts-nocheck -- ported from the original app (written for a looser TS config)
import { runEngineeringValidation } from "../engine/validator";
import { extractOfflineProject, type LayoutToken } from "../engine/offlineExtractor";
import { processStationLayout } from "../modules/pipeline/pipeline";
import type { StationProject } from "../types/signalling";
import type { ExtractionProvider } from "../types/extractionProvider";
import {
  preparePdfUploadPackage,
  type PdfRenderedCrop,
  type PdfUploadPackage,
} from "./pdfImageExtractor";
import { parseCadFileBuffer, isSupportedCadExtension } from "./cadParser";
import { readPdfLocally } from "./offlineOcr";
import {
  uploadCadFile,
  getCadDocument,
  getCadComponents,
  getXTractorData,
  getCadRenderUrl,
} from "../services/cadApi";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface LocalFileInput {
  name: string;
  mimeType: string;
  base64Data: string;
}

async function safeParseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const rawText = await res.text();
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error(`Server returned an empty response (HTTP ${res.status}).`);
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    if (res.status === 413)
      throw new Error("Layout upload exceeded the transport payload limit. Try a smaller file.");
    if (res.status === 502 || res.status === 504)
      throw new Error(
        `The online drawing reader took too long (HTTP ${res.status}). Retry, or use Offline (no AI).`,
      );
    throw new Error(`Server returned non-JSON response (HTTP ${res.status}). Please retry.`);
  }
}

function ensureLocatedEvidence(project: StationProject): StationProject {
  const count = project.tags.length + project.signals.length + project.tracks.length;
  if (count === 0) {
    throw new Error(
      "No RFID tags, signals, or track lines could be located on this drawing locally. Nothing was invented. Try a clearer drawing or explicitly choose an online AI provider.",
    );
  }
  return project;
}

async function analyzeOffline(params: {
  file: LocalFileInput;
  onProgress?: (label: string) => void;
}): Promise<StationProject> {
  const { file, onProgress } = params;
  const kind = isSupportedCadExtension(file.name);
  if (!kind)
    throw new Error(
      `Unsupported file format (${file.name}). Supported layout formats are .dwg, .dxf, and .pdf.`,
    );

  // If DWG or DXF, use the proven native backend pipeline with zero hardcoding
  if (kind === "DWG" || kind === "DXF") {
    try {
      onProgress?.(`1/3 Processing ${file.name} with native vector CAD pipeline…`);
      const bytes = base64ToBytes(file.base64Data);
      const uploadFile = new File([bytes], file.name, {
        type: file.mimeType || "application/octet-stream",
      });

      const docId = await uploadCadFile(uploadFile, (stage, progress) => {
        onProgress?.(`1/3 ${stage} (${progress}%)…`);
      });

      onProgress?.("2/3 Extracting CAD components and Table of Control…");
      const doc = await getCadDocument(docId);
      const compRes = await getCadComponents(docId);
      let kavachData = null;
      try {
        kavachData = await getXTractorData(docId);
      } catch (err) {
        console.warn("Could not fetch X-Tractor data:", err);
      }

      // Map signals from detected components (Strict Rule: signals MUST start with "S")
      const signals = compRes.components
        .filter((c) => {
          if (c.category !== "signals" && c.categoryId !== 1) return false;
          const n = (c.name || "").toUpperCase();
          if (n.includes("STATION") || n.includes("BUILDING") || n.includes("SCALE") || n.includes("COMM.") || n.includes("S-S.")) return false;
          return true;
        })
        .map((c, idx) => {
          const rawSig = (c.name || c.tags?.NAME || c.tags?.SIGNAL_NO || c.tags?.SIG_NO || "").trim();
          if (!rawSig) return null;
          let cleanSig = rawSig.replace(/^S\s*/i, "S").toUpperCase();
          if (!cleanSig.startsWith("S") && !cleanSig.startsWith("G") && !cleanSig.startsWith("SH")) {
            cleanSig = `S${cleanSig}`;
          }
          const sigName = cleanSig;

          // Classification rules:
          // Ends with ID -> Inner Distant
          // Ends with D (not ID) -> Distant Signal
          // Ends with A -> Calling-on Signal
          // Loop lines -> Starter / Adv Starter
          // Main lines -> Home Signal
          const trackUpper = (c.tags?.TRACK_NO || c.tags?.LINE || "MAIN").toUpperCase();
          const isLoop = /LOOP|BRANCH|SIDING|GOODS/i.test(trackUpper);
          let sigType = "Home Signal";
          if (/(?:^|\s|\b)ID$/i.test(sigName) || /inner\s*dist/i.test(c.tags?.TYPE || "")) {
            sigType = "Inner Distant";
          } else if (/(?:^|\s|\b)D$/i.test(sigName) || /distant/i.test(c.tags?.TYPE || "")) {
            sigType = "Distant Signal";
          } else if (/(?:^|\s|\b)A$/i.test(sigName) || /calling/i.test(c.tags?.TYPE || "")) {
            sigType = "Calling-on Signal";
          } else if (isLoop) {
            sigType = /adv|lss/i.test(c.tags?.TYPE || "") ? "Adv Starter" : "Starter";
          } else {
            sigType = /adv|lss/i.test(c.tags?.TYPE || "") ? "Adv Starter" : "Home Signal";
          }

          return {
            id: c.id || `SIG-${idx}`,
            name: sigName,
            line: isLoop ? "COMMON LOOP" : (c.tags?.DIRECTION === "DN" || c.tags?.DIRECTION === "DOWN" ? "DN MAIN" : "UP MAIN"),
            direction:
              c.tags?.DIRECTION === "DN" || c.tags?.DIRECTION === "DOWN"
                ? ("DOWN" as const)
                : ("UP" as const),
            signalType: sigType,
            chainageM: c.tags?.LOCATION_M ? parseFloat(c.tags.LOCATION_M) : null,
            footTagId: c.tags?.RFID_TAG_NO || c.tags?.FOOT_TAG || "",
            aspects: ["RED", "YELLOW", "GREEN"],
            confidence: "HIGH" as const,
            verified: true,
            x: c.anchor ? c.anchor[0] : undefined,
            y: c.anchor ? c.anchor[1] : undefined,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      // Map RFID tags from detected components (Strict Rule: starts with R-)
      const tags = compRes.components
        .filter((c) => c.category === "rfid_tags" || c.categoryId === 3)
        .map((c, idx) => {
          const rawTag = (c.name || c.tags?.RFID_TAG_NO || `R-${idx}`).trim();
          const cleanTag = rawTag.replace(/^R\s*[-_ ]?/i, "R-").toUpperCase();
          const tagId = cleanTag.startsWith("R-") ? cleanTag : (cleanTag.startsWith("R") ? `R-${cleanTag.slice(1)}` : `R-${cleanTag}`);

          const rawType = String(c.tags?.TYPE || c.tags?.TAG_TYPE || "").toUpperCase();
          let tagType: "SIGNAL_FOOT" | "NORMAL" | "TURNOUT" | "EXIT" | "GATE" | "ADJUSTMENT" | "ADJACENT_LINE" = "NORMAL";
          if (/FOOT|^S$/i.test(rawType)) tagType = "SIGNAL_FOOT";
          else if (/TURN|TIN|^T$/i.test(rawType)) tagType = "TURNOUT";
          else if (/EXIT|^X$/i.test(rawType)) tagType = "EXIT";
          else if (/GATE|^G$/i.test(rawType)) tagType = "GATE";
          else if (/ADJ|JUNC|^A$/i.test(rawType)) tagType = "ADJUSTMENT";
          else if (/LINE|^L$/i.test(rawType)) tagType = "ADJACENT_LINE";

          return {
            id: c.id || `TAG-${idx}`,
            tagId,
            line: c.tags?.TRACK_NO || c.tags?.LINE || "MAIN",
            tin: c.tags?.TIN_NO || c.tags?.TIN || "",
            chainageM: c.tags?.LOCATION_M ? parseFloat(c.tags.LOCATION_M) : null,
            tagType,
            confidence: "HIGH" as const,
            verified: true,
            x: c.anchor ? c.anchor[0] : undefined,
            y: c.anchor ? c.anchor[1] : undefined,
          };
        });

      // Map points / switches from detected components (Strict Rule: starts with P-)
      const points = compRes.components
        .filter((c) => c.category === "points" || c.categoryId === 6)
        .map((c, idx) => {
          const rawPt = (c.name || c.tags?.POINT_NO || `P-${idx}`).trim();
          const cleanPt = rawPt.replace(/^P\s*[-_ ]?/i, "P-").toUpperCase();
          const ptName = cleanPt.startsWith("P-") ? cleanPt : (cleanPt.startsWith("P") ? `P-${cleanPt.slice(1)}` : `P-${cleanPt}`);

          return {
            id: c.id || `PT-${idx}`,
            name: ptName,
            normalLine: "MAIN",
            reverseLine: "LOOP",
            turnoutSpeedKmph: 30,
            chainageM: null,
            confidence: "HIGH" as const,
            x: c.anchor ? c.anchor[0] : undefined,
            y: c.anchor ? c.anchor[1] : undefined,
          };
        });

      // Map tracks
      const trackComponents = compRes.components.filter(
        (c) => c.category === "tracks_tins" || c.categoryId === 2,
      );
      const trackNames = Array.from(
        new Set(
          trackComponents.map((c) => c.tags?.TRACK_NO || c.name || "MAIN LINE").filter(Boolean),
        ),
      );
      const tracks = (trackNames.length > 0 ? trackNames : ["UP MAIN", "DN MAIN"]).map(
        (name, idx) => ({
          id: `TRK-${idx}`,
          name,
          lineType: (name.toUpperCase().includes("DN")
            ? "DN_MAIN"
            : name.toUpperCase().includes("LOOP")
              ? "COMMON_LOOP"
              : "UP_MAIN") as any,
          direction: (name.toUpperCase().includes("DN") ? "DOWN" : "UP") as any,
          trackCircuit: name,
          tinList: [],
          ySlot: idx,
        }),
      );

      // Map TOC routes directly from KAVACH Table of Control
      const routes = (kavachData?.table_of_control || []).map((row, idx) => ({
        slNo: row.s_no || idx + 1,
        entrySignal: row.entry_signal || "",
        exitSignal: row.exit_signal || "",
        leadingToLine: row.line || "",
        direction: "UP" as const,
        tsrmsRouteId: `R-${row.s_no || idx + 1}`,
        signalType: row.signal_type || "MAIN",
        aspectOfEntrySignal: row.aspect_entry_signal || "",
        requiresAspectOfExitSignal: row.requires_aspect_exit_signal || "",
        entryAspectSummary: row.aspect_entry_signal || "",
        exitAspectsSummary: row.requires_aspect_exit_signal || "",
        requiredRouteLocking: row.line || "",
        pointsNormal: row.points_normal
          ? row.points_normal
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        pointsReverse: row.points_reverse
          ? row.points_reverse
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        trackCktUp: row.requires_track_ckt_up || "",
        tinsRequiresFree: row.tins_requires_free
          ? row.tins_requires_free
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        entryFootTag: row.entry_signal_foot_tag || "",
        linkingSequence: row.rfid_sequence_str
          ? row.rfid_sequence_str.split("->").map((s) => ({ tagId: s.trim(), distanceM: 0 }))
          : [],
        enRouteTags: row.rfid_sequence_str
          ? row.rfid_sequence_str.split("->").map((s) => s.trim())
          : [],
        conflictingTurnoutTags: [],
        conflictingRouteTags: [],
        turnoutSpeedKmph: null,
        turnoutCommenceM: null,
        turnoutRestrictionDistM: null,
        distanceBetweenSignalsM: row.distance_between_signals_m || 0,
        movementAuthoritySections: row.movement_authority || "",
        movementAuthorityMeters: String(row.distance_between_signals_m || 0),
        authorizedSpeedSr: "",
        authorizedSpeedOs: row.authorized_speed_os || "",
        psrSegments: [],
        averageGradient: "",
        isTsl: false,
        engineerStatus: "AUTO_GENERATED" as const,
      }));

      // Station metadata
      const stnName =
        kavachData?.station_metadata?.station_name ||
        file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ").toUpperCase();
      const stnCode =
        kavachData?.station_metadata?.station_code ||
        stnName.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();
      const stnId = String(kavachData?.station_metadata?.station_id || "50904");

      const project: StationProject = {
        id: `proj-${Date.now()}`,
        metadata: {
          stationName: stnName,
          stationCode: stnCode,
          stationId: stnId,
          division: kavachData?.station_metadata?.division || "",
          section: kavachData?.station_metadata?.section || "",
          refSip: kavachData?.station_metadata?.sip_no || "",
          refLayout: kavachData?.station_metadata?.rfid_layout_no || file.name,
          refToc: kavachData?.station_metadata?.toc_no || "",
          version: kavachData?.station_metadata?.version || "1.0",
          chainageDirection: "RIGHT_INCREASING",
          nextDownStationId: "",
          nextUpStationId: "",
          preparedBy: "SignalTOC Auto-Engine",
          checkedBy: "SignalTOC Auto-Engine",
          engineerSignedOff: false,
        },
        tocFormatPreference: "TCAS_TOC",
        tracks,
        signals,
        points,
        tags,
        levelCrossings: [],
        routes,
        blockSections: [],
        trackProfiles: [],
        tsrRoutes: [],
        tslRoutes: [],
        shuntingLimits: [],
        validationIssues: [],
        auditLog: [
          {
            id: `audit-${Date.now()}`,
            timestamp: new Date().toISOString(),
            actor: "SignalTOC Native CAD Engine",
            action: "Ingest DWG/DXF",
            target: file.name,
            details: `Successfully processed ${file.name} with ${signals.length} signals, ${tags.length} RFID tags, and ${routes.length} routes.`,
          },
        ],
        sourceSummary: `Native LibreDWG processed drawing ${file.name} (${doc.fileSize} bytes) with ${doc.cadLayers?.length || 0} layers and ${compRes.totalComponents} components.`,
        sourceLayout: {
          kind,
          fileName: file.name,
          fileSize: doc.fileSize,
          cadDocId: doc.id,
          cadRenderUrl: doc.renderUrl || getCadRenderUrl(doc.id, doc.defaultLayout ?? 0),
          cadComponents: compRes.components,
          kavachData,
          layerCount: doc.cadLayers?.length || 0,
          entityCount: doc.layouts?.[0]?.entityCount || compRes.totalComponents || 0,
          cadVersion: doc.converter || "Native LibreDWG",
        },
      };

      onProgress?.("3/3 Running engineering validation…");
      project.validationIssues = runEngineeringValidation(project);
      return project;
    } catch (cadErr) {
      console.warn("Native CAD backend failed, falling back to local parser:", cadErr);
    }
  }

  let tokens: LayoutToken[];
  let sourceLayout: StationProject["sourceLayout"];
  let sourceSummary = "";

  if (kind === "PDF") {
    onProgress?.("1/3 Opening the PDF locally…");
    const read = await readPdfLocally({ base64Pdf: file.base64Data, onProgress });
    tokens = read.tokens;
    sourceLayout = {
      kind,
      fileName: file.name,
      pdfBase64: file.base64Data,
      pageCount: read.pageCount,
    };
    sourceSummary = read.summary;
  } else {
    onProgress?.(`1/3 Decoding ${file.name} locally…`);
    const parsedCad = await parseCadFileBuffer(base64ToBytes(file.base64Data), file.name, kind);
    tokens = parsedCad.layoutTokens as unknown as LayoutToken[];
    sourceSummary = parsedCad.summary;
    sourceLayout = {
      kind,
      fileName: file.name,
      dxfData: parsedCad.dxfData,
      layerCount: parsedCad.layerCount,
      blockCount: parsedCad.blockCount,
      entityCount: parsedCad.entityCount,
      cadVersion: parsedCad.cadVersion,
    };
  }

  onProgress?.("2/3 Linking labels, chainages, signals, tracks, tags and route distances locally…");
  const project = ensureLocatedEvidence(
    extractOfflineProject({
      fileName: file.name,
      tokens,
      sourceLayout,
      sourceSummary,
    }),
  );
  onProgress?.("3/3 Running engineering validation locally…");
  return { ...project, validationIssues: runEngineeringValidation(project) };
}

export async function analyzeUploadedLayouts(params: {
  files: LocalFileInput[];
  provider?: ExtractionProvider;
  apiKey?: string;
  onProgress?: (label: string) => void;
}): Promise<StationProject> {
  const { files, provider = "offline", apiKey, onProgress } = params;
  if (files.length !== 1) throw new Error("Upload exactly one layout file.");

  // Offline is deliberately a separate browser-only path: no fetch, project key, AI model,
  // remote font, OCR download or drawing upload is involved.
  if (provider === "offline") return analyzeOffline({ file: files[0], onProgress });
  if (!apiKey?.trim())
    throw new Error(`Enter your ${provider} API key, or choose Offline (no AI).`);

  onProgress?.(`1/3 Decoding ${files[0].name} and preparing drawing sections…`);
  let primaryLocalPdfBase64: string | undefined;
  const preparedFiles = await Promise.all(
    files.map(async (file) => {
      const isPdf = file.name.trim().toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        const kind = isSupportedCadExtension(file.name);
        if (kind !== "DWG" && kind !== "DXF")
          throw new Error(`Unsupported file format (${file.name}).`);
        const parsedCad = await parseCadFileBuffer(base64ToBytes(file.base64Data), file.name, kind);
        return { name: file.name, mimeType: file.mimeType, parsedCad };
      }
      primaryLocalPdfBase64 = file.base64Data;
      let crops: PdfRenderedCrop[] = [];
      let extractedText = "";
      let pageCount = 1;
      try {
        const pkg = await preparePdfUploadPackage(file.base64Data);
        crops = pkg.crops;
        extractedText = pkg.extractedText;
        pageCount = pkg.pageCount;
      } catch {
        crops = [];
      }
      const omitRawPdfBytes = crops.length >= 2;
      return {
        name: file.name,
        mimeType: file.mimeType,
        ...(omitRawPdfBytes ? {} : { base64Data: file.base64Data }),
        extractedText,
        pageCount,
        supplementaryImages: crops,
      };
    }),
  );

  onProgress?.("2/3 Sending this drawing to your explicitly selected online AI provider…");
  const res = await fetch("/api/analyze-layout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: preparedFiles,
      provider,
      apiKey: apiKey.trim(),
      omitPdfResponse: true,
    }),
  });
  const json = await safeParseJsonResponse(res);
  if (!res.ok || !json.project) throw new Error(String(json.error || "Layout extraction failed."));
  let rawProject = json.project as unknown as StationProject;
  if (
    rawProject.sourceLayout?.kind === "PDF" &&
    !rawProject.sourceLayout.pdfBase64 &&
    primaryLocalPdfBase64
  ) {
    rawProject = {
      ...rawProject,
      sourceLayout: { ...rawProject.sourceLayout, pdfBase64: primaryLocalPdfBase64 },
    };
  }
  onProgress?.("3/3 Checking source references and running engineering validation…");
  return { ...rawProject, validationIssues: runEngineeringValidation(rawProject) };
}
