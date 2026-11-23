// @ts-nocheck
// Browser-side CAD decoding (ported from the original Express server).
// The edge server cannot load the LibreDWG WASM from disk, so DWG/DXF files are decoded here.
import { Dwg_File_Type, LibreDwg } from "@mlightcad/libredwg-web";
import type { DwgDatabase, LibreDwgEx } from "@mlightcad/libredwg-web";
import DxfParser from "dxf-parser";
import type { IDxf } from "dxf-parser";

let libreDwgPromise: Promise<LibreDwgEx> | null = null;
async function getLibreDwg(): Promise<LibreDwgEx> {
  if (!libreDwgPromise) {
    libreDwgPromise = LibreDwg.create("/libredwg");
  }
  return libreDwgPromise;
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function cleanCadText(raw: string): string {
  return raw
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\P/gi, " ")
    .replace(/\\[A-Za-z][^;]*;/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSupportedCadExtension(fileName: string): "DWG" | "DXF" | "PDF" | null {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith(".dwg")) return "DWG";
  if (lower.endsWith(".dxf")) return "DXF";
  if (lower.endsWith(".pdf")) return "PDF";
  return null;
}

function verifyCadBufferSignature(
  buffer: Uint8Array,
  kind: "DWG" | "DXF" | "PDF",
  fileName: string,
): void {
  if (buffer.length < 16) {
    throw new Error(`Invalid ${kind} file (${fileName}): file is empty or truncated.`);
  }
  const headAscii = latin1(buffer.subarray(0, 64));
  if (kind === "PDF") {
    if (!headAscii.startsWith("%PDF")) {
      throw new Error(`Invalid PDF file (${fileName}): missing %PDF header signature.`);
    }
    return;
  }

  if (headAscii.startsWith("%PDF")) {
    throw new Error(
      `Invalid ${kind} file (${fileName}): PDF bytes inside a .${kind.toLowerCase()} file. Rename or upload a genuine ${kind}.`,
    );
  }
  if (headAscii.startsWith("PK\x03\x04")) {
    throw new Error(
      `Invalid ${kind} file (${fileName}): archive/Office XML content detected. Supported formats are .dwg, .dxf, and .pdf.`,
    );
  }

  if (kind === "DWG") {
    if (!/^AC1\.\d|^AC10\d{2}/.test(headAscii)) {
      throw new Error(
        `Invalid DWG file (${fileName}): missing AutoCAD DWG signature (expected AC10xx header).`,
      );
    }
  } else {
    const isBinaryDxf = headAscii.startsWith("AutoCAD Binary DXF");
    if (!isBinaryDxf) {
      const sample = new TextDecoder("utf-8").decode(
        buffer.subarray(0, Math.min(buffer.length, 4096)),
      );
      if (!sample.includes("SECTION") && !sample.includes("ENTITIES") && !sample.includes("EOF")) {
        throw new Error(`Invalid DXF file (${fileName}): missing DXF SECTION/ENTITIES structure.`);
      }
    }
  }
}

function dwgDatabaseToIDxf(db: DwgDatabase): IDxf {
  const layersRecord: Record<
    string,
    { name: string; visible: boolean; colorIndex: number; color: number; frozen: boolean }
  > = {};
  for (const entry of db.tables?.LAYER?.entries ?? []) {
    layersRecord[entry.name] = {
      name: entry.name,
      visible: !entry.off,
      colorIndex: entry.colorIndex ?? 7,
      color: entry.color ?? 0,
      frozen: Boolean(entry.frozen),
    };
  }

  const mapDwgEntity = (e: Record<string, unknown>): Record<string, unknown> | null => {
    const t = String(e.type || "");
    const common = {
      type: t,
      layer: String(e.layer || "0"),
      colorIndex: typeof e.colorIndex === "number" ? e.colorIndex : 256,
      color: typeof e.color === "number" ? e.color : 0,
      visible: e.isVisible !== false,
      lineType: String(e.lineType || "BYLAYER"),
      lineTypeScale: Number(e.linetypeScale || 1),
      inPaperSpace: false,
    };

    if (t === "LINE") {
      const sp = e.startPoint as { x?: number; y?: number; z?: number } | undefined;
      const ep = e.endPoint as { x?: number; y?: number; z?: number } | undefined;
      if (!sp || !ep) return null;
      return {
        ...common,
        vertices: [
          { x: Number(sp.x ?? 0), y: Number(sp.y ?? 0), z: Number(sp.z ?? 0) },
          { x: Number(ep.x ?? 0), y: Number(ep.y ?? 0), z: Number(ep.z ?? 0) },
        ],
      };
    }
    if (t === "LWPOLYLINE") {
      const verts = Array.isArray(e.vertices) ? e.vertices : [];
      return {
        ...common,
        shape: Boolean((Number(e.flag || 0) & 1) === 1),
        vertices: verts.map((v: Record<string, unknown>) => ({
          x: Number(v.x ?? 0),
          y: Number(v.y ?? 0),
          z: 0,
          bulge: Number(v.bulge ?? 0),
        })),
      };
    }
    if (t === "POLYLINE2D" || t === "POLYLINE3D") {
      const verts = Array.isArray(e.vertices) ? e.vertices : [];
      return {
        ...common,
        type: "POLYLINE",
        shape: Boolean((Number(e.flag || 0) & 1) === 1),
        vertices: verts.map((v: Record<string, unknown>) => {
          const pt = (v.point as Record<string, unknown>) ?? v;
          return {
            x: Number(pt.x ?? 0),
            y: Number(pt.y ?? 0),
            z: Number(pt.z ?? 0),
            bulge: Number(v.bulge ?? 0),
          };
        }),
      };
    }
    if (t === "CIRCLE") {
      const c = e.center as { x?: number; y?: number; z?: number } | undefined;
      return {
        ...common,
        center: { x: Number(c?.x ?? 0), y: Number(c?.y ?? 0), z: Number(c?.z ?? 0) },
        radius: Number(e.radius ?? 0),
      };
    }
    if (t === "ARC") {
      const c = e.center as { x?: number; y?: number; z?: number } | undefined;
      return {
        ...common,
        center: { x: Number(c?.x ?? 0), y: Number(c?.y ?? 0), z: Number(c?.z ?? 0) },
        radius: Number(e.radius ?? 0),
        startAngle: Number(e.startAngle ?? 0),
        endAngle: Number(e.endAngle ?? 0),
      };
    }
    if (t === "ELLIPSE") {
      const c = e.center as { x?: number; y?: number; z?: number } | undefined;
      const m = e.majorAxisEndPoint as { x?: number; y?: number; z?: number } | undefined;
      return {
        ...common,
        center: { x: Number(c?.x ?? 0), y: Number(c?.y ?? 0), z: Number(c?.z ?? 0) },
        majorAxisEndPoint: { x: Number(m?.x ?? 1), y: Number(m?.y ?? 0), z: Number(m?.z ?? 0) },
        axisRatio: Number(e.axisRatio ?? 1),
        startAngle: Number(e.startAngle ?? 0),
        endAngle: Number(e.endAngle ?? Math.PI * 2),
      };
    }
    if (t === "SPLINE") {
      const fit = Array.isArray(e.fitPoints) ? e.fitPoints : [];
      const ctrl = Array.isArray(e.controlPoints) ? e.controlPoints : [];
      return {
        ...common,
        closed: Boolean(e.closed),
        fitPoints: fit.map((p: Record<string, unknown>) => ({
          x: Number(p.x ?? 0),
          y: Number(p.y ?? 0),
          z: Number(p.z ?? 0),
        })),
        controlPoints: ctrl.map((p: Record<string, unknown>) => ({
          x: Number(p.x ?? 0),
          y: Number(p.y ?? 0),
          z: Number(p.z ?? 0),
        })),
      };
    }
    if (t === "TEXT") {
      const sp = e.startPoint as { x?: number; y?: number; z?: number } | undefined;
      return {
        ...common,
        text: String(e.text ?? ""),
        startPoint: { x: Number(sp?.x ?? 0), y: Number(sp?.y ?? 0), z: Number(sp?.z ?? 0) },
        textHeight: Number(e.textHeight ?? 2.5),
        rotation: (Number(e.rotation ?? 0) * 180) / Math.PI,
      };
    }
    if (t === "MTEXT") {
      const pos = e.insertionPoint as { x?: number; y?: number; z?: number } | undefined;
      return {
        ...common,
        text: String(e.text ?? ""),
        position: { x: Number(pos?.x ?? 0), y: Number(pos?.y ?? 0), z: Number(pos?.z ?? 0) },
        height: Number(e.textHeight ?? 2.5),
        rotation: (Number(e.rotation ?? 0) * 180) / Math.PI,
      };
    }
    if (t === "ATTDEF" || t === "ATTRIB") {
      const sp = (e.insertionPoint || e.startPoint || e.alignmentPoint) as
        | { x?: number; y?: number; z?: number }
        | undefined;
      return {
        ...common,
        type: t,
        tag: String(e.tag || ""),
        text: String(e.text ?? e.value ?? ""),
        startPoint: { x: Number(sp?.x ?? 0), y: Number(sp?.y ?? 0), z: Number(sp?.z ?? 0) },
        position: { x: Number(sp?.x ?? 0), y: Number(sp?.y ?? 0), z: Number(sp?.z ?? 0) },
        textHeight: Number(e.textHeight ?? e.height ?? 2.5),
        height: Number(e.textHeight ?? e.height ?? 2.5),
        rotation: (Number(e.rotation ?? 0) * 180) / Math.PI,
      };
    }
    if (t === "INSERT") {
      const pos = e.insertionPoint as { x?: number; y?: number; z?: number } | undefined;
      const rawAttribs = Array.isArray(e.attribs)
        ? e.attribs
        : Array.isArray(e.attributes)
          ? e.attributes
          : Array.isArray(e.subentities)
            ? e.subentities.filter((se: any) => se && (se.type === "ATTRIB" || se.type === "ATTDEF"))
            : [];
      return {
        ...common,
        name: String(e.name ?? ""),
        position: { x: Number(pos?.x ?? 0), y: Number(pos?.y ?? 0), z: Number(pos?.z ?? 0) },
        xScale: Number(e.xScale ?? 1),
        yScale: Number(e.yScale ?? 1),
        zScale: Number(e.zScale ?? 1),
        rotation: (Number(e.rotation ?? 0) * 180) / Math.PI,
        columnCount: Number(e.columnCount ?? 1),
        rowCount: Number(e.rowCount ?? 1),
        columnSpacing: Number(e.columnSpacing ?? 0),
        rowSpacing: Number(e.rowSpacing ?? 0),
        attribs: rawAttribs.map((a: Record<string, unknown>) => {
          const apt = (a.insertionPoint || a.position || a.startPoint || a.alignmentPoint || pos) as
            | { x?: number; y?: number; z?: number }
            | undefined;
          return {
            tag: String(a.tag ?? ""),
            text: String(a.text ?? a.value ?? ""),
            startPoint: {
              x: Number(apt?.x ?? pos?.x ?? 0),
              y: Number(apt?.y ?? pos?.y ?? 0),
              z: Number(apt?.z ?? pos?.z ?? 0),
            },
            position: {
              x: Number(apt?.x ?? pos?.x ?? 0),
              y: Number(apt?.y ?? pos?.y ?? 0),
              z: Number(apt?.z ?? pos?.z ?? 0),
            },
          };
        }),
      };
    }
    if (t === "SOLID") {
      const pts = [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean) as Array<{
        x?: number;
        y?: number;
        z?: number;
      }>;
      return {
        ...common,
        points: pts.map((p) => ({ x: Number(p.x ?? 0), y: Number(p.y ?? 0), z: Number(p.z ?? 0) })),
      };
    }
    return null;
  };

  const blocksRecord: Record<
    string,
    { name: string; position: { x: number; y: number; z: number }; entities: unknown[] }
  > = {};
  for (const blk of db.tables?.BLOCK_RECORD?.entries ?? []) {
    const bp = blk.basePoint ?? { x: 0, y: 0, z: 0 };
    const mapped = (blk.entities ?? [])
      .map((ent) => mapDwgEntity(ent as unknown as Record<string, unknown>))
      .filter(Boolean);
    blocksRecord[blk.name] = {
      name: blk.name,
      position: { x: Number(bp.x ?? 0), y: Number(bp.y ?? 0), z: Number(bp.z ?? 0) },
      entities: mapped,
    };
  }

  const modelEntities = (db.entities ?? [])
    .map((ent) => mapDwgEntity(ent as unknown as Record<string, unknown>))
    .filter(Boolean);

  return {
    header: {},
    entities: modelEntities as unknown as IDxf["entities"],
    blocks: blocksRecord as unknown as IDxf["blocks"],
    tables: {
      layer: { handle: "0", ownerHandle: "0", layers: layersRecord },
      lineType: { handle: "0", ownerHandle: "0", lineTypes: {} },
      viewPort: { handle: "0", ownerHandle: "0", viewPorts: [] },
    },
  };
}

function cleanCadAttributeTag(tag: string): string {
  if (!tag) return "";
  return tag.trim().toUpperCase().replace(/[\s.:\-_]+/g, "_").replace(/^_+|_+$/g, "");
}

interface CadOntologyCategory {
  category: "signals" | "rfid_tags" | "points" | "tracks_tins" | "gates" | "axle_counters";
  tagKeys: string[];
  keywords: string[];
}

const CAD_DOMAIN_ONTOLOGY: CadOntologyCategory[] = [
  {
    category: "rfid_tags",
    tagKeys: ["RFID_TAG_NO", "RFID_NO", "TAG_NO", "TYPE", "R_", "R-"],
    keywords: ["rfid", "tag", "transponder"],
  },
  {
    category: "signals",
    tagKeys: ["SIGNAL_NO", "SIG_NO", "SIGNAL", "ASPECT", "ASPECTS", "SIGNAL_NAME", "BOARD_NAME"],
    keywords: ["signal", "sig", "home", "starter", "distant", "advance", "calling", "nom. sig", "rev. sig", "signal base"],
  },
  {
    category: "points",
    tagKeys: [
      "POINT_NO",
      "PT_NO",
      "SWITCH_NO",
      "A_END_POINT_NO",
      "B_END_POINT_NO",
      "PA",
      "PB",
      "P_",
      "P-",
      "POINT",
      "TURNOUT",
      "CROSSOVER",
    ],
    keywords: ["point", "turnout", "switch", "crossover", "mechine", "trap point", "sdg point"],
  },
  {
    category: "gates",
    tagKeys: ["LC_NO", "GATE_NO", "BARRIER_NO"],
    keywords: ["gate", "barrier", "level crossing", "lc"],
  },
  {
    category: "tracks_tins",
    tagKeys: ["TRACK_NO", "TIN_NO", "BERTH_NO"],
    keywords: ["track", "tin", "rail", "berth"],
  },
  {
    category: "axle_counters",
    tagKeys: ["DP_NO", "AXLE_NO", "RESET_NO", "BPAC_RIGHT", "BPAC_LEFT"],
    keywords: ["axle", "dp", "bpac", "counter"],
  },
];

function resolveBlockIdentity(
  blockName: string,
  blocksRecord?: Record<string, { name: string; position?: { x: number; y: number }; entities: unknown[] }>,
  depth = 0,
): { realName: string; attribs: Array<{ tag: string; text: string }>; tags: string[]; innerPos?: { x: number; y: number } } {
  if (depth > 5 || !blockName || !blocksRecord) {
    return { realName: blockName, attribs: [], tags: [] };
  }
  const blk = blocksRecord[blockName];
  if (!blk) return { realName: blockName, attribs: [], tags: [] };

  const attribs: Array<{ tag: string; text: string }> = [];
  const tags: string[] = [];
  let resolvedName = blockName;
  let innerPos: { x: number; y: number } | undefined = undefined;

  for (const be of (blk.entities ?? []) as any[]) {
    if (be.type === "ATTDEF" || be.type === "ATTRIB") {
      const tag = cleanCadAttributeTag(String(be.tag || be.text || ""));
      const text = cleanCadText(String(be.text || be.value || ""));
      attribs.push({ tag, text });
      tags.push(tag);
    } else if (be.type === "INSERT") {
      if (!innerPos && be.position) {
        innerPos = { x: be.position.x, y: be.position.y };
      }
      const inner = resolveBlockIdentity(String(be.name || ""), blocksRecord, depth + 1);
      attribs.push(...inner.attribs);
      tags.push(...inner.tags);
      if (!inner.realName.startsWith("*U")) {
        resolvedName = inner.realName;
      }
    }
  }

  return { realName: resolvedName, attribs, tags, innerPos };
}

function classifyCadEntity(
  blockName: string,
  layer: string,
  attribTags: string[] = [],
  text = "",
): "signals" | "rfid_tags" | "points" | "tracks_tins" | "gates" | "axle_counters" | "other" {
  const nameLow = blockName.toLowerCase();
  const layerLow = layer.toLowerCase();
  const textLow = text.toLowerCase();
  const normTags = new Set(attribTags.map(cleanCadAttributeTag));

  for (const rule of CAD_DOMAIN_ONTOLOGY) {
    if (rule.tagKeys.some((k) => normTags.has(k))) return rule.category;
  }
  for (const rule of CAD_DOMAIN_ONTOLOGY) {
    if (rule.keywords.some((kw) => nameLow.includes(kw) || layerLow.includes(kw))) {
      return rule.category;
    }
  }
  if (textLow) {
    for (const rule of CAD_DOMAIN_ONTOLOGY) {
      if (rule.keywords.some((kw) => textLow.includes(kw))) {
        return rule.category;
      }
    }
  }
  return "other";
}

function summarizeDxf(dxfData: IDxf, fileName: string, kind: "DWG" | "DXF", cadVersion?: string) {
  const layers = Object.keys(dxfData.tables?.layer?.layers ?? {});
  const collectedTexts: Array<{ text: string; x: number; y: number; priority: number }> = [];
  // Positioned primitives for the offline extractor (y flipped so it points down like a page).
  const layoutTokens: Array<Record<string, unknown>> = [];
  const entityCounts: Record<string, number> = {};
  let totalEntities = 0;

  const scoreTextPriority = (txt: string): number => {
    if (
      /^(R|N)[-\s]?\d+/i.test(txt) ||
      /\b(TIN|STN|STATION|CODE|KAVACH|TCAS|HOME|STARTER|DISTANT|ADV|LOOP|MAIN|LINE|LC[-\s]?\d+|PT\.?\s*\d+)\b/i.test(
        txt,
      )
    ) {
      return 3;
    }
    if (/^(S|A|C|G|L|SH)?\d+[A-Z]?$/i.test(txt) || /\d{3,5}/.test(txt)) {
      return 2;
    }
    return 1;
  };

  const pushText = (raw: string, x: number, y: number, height = 0, rotationDeg = 0) => {
    if (!raw || raw.length >= 160) return;
    const rot = ((rotationDeg % 180) + 180) % 180;
    const vertical = Math.abs(rot - 90) < 20;
    const len = Math.max(1, raw.length) * (height || 1) * 0.62;
    layoutTokens.push({
      text: raw,
      kind: "text",
      page: 1,
      // TEXT insertion points are baseline-left; approximate the label centre.
      x: vertical ? x - (height || 0) / 2 : x + len / 2,
      y: vertical ? -(y + len / 2) : -(y + (height || 0) / 2),
      width: vertical ? height || undefined : len,
      height: vertical ? len : height || undefined,
      vertical,
      confidence: 100,
    });
    collectedTexts.push({
      text: raw,
      x: Math.round(x),
      y: Math.round(y),
      priority: scoreTextPriority(raw),
    });
  };

  let nominalSigCount = 0;
  let reverseSigCount = 0;

  // Pre-collect top-level model space texts for geometric correlation
  const modelTexts: Array<{ text: string; x: number; y: number; layer: string }> = [];
  for (const ent of dxfData.entities ?? []) {
    if (ent.type === "TEXT" || ent.type === "MTEXT" || ent.type === "ATTDEF" || ent.type === "ATTRIB") {
      const pt = (ent as any).position ?? (ent as any).startPoint ?? { x: 0, y: 0 };
      const raw = cleanCadText(String((ent as any).text || (ent as any).value || ""));
      if (raw) modelTexts.push({ text: raw, x: pt.x, y: pt.y, layer: String((ent as any).layer || "0") });
    }
  }

  const walkEntities = (
    entities: IDxf["entities"] | undefined,
    offsetX: number,
    offsetY: number,
    scaleX: number,
    scaleY: number,
    rotRad: number,
    depth: number,
  ) => {
    if (!entities || depth > 5) return;
    const cos = Math.cos(rotRad);
    const sin = Math.sin(rotRad);

    const transformPt = (px: number, py: number) => {
      const sx = px * scaleX;
      const sy = py * scaleY;
      return {
        x: offsetX + sx * cos - sy * sin,
        y: offsetY + sx * sin + sy * cos,
      };
    };

    for (const ent of entities) {
      totalEntities += 1;
      entityCounts[ent.type] = (entityCounts[ent.type] ?? 0) + 1;

      if (ent.type === "INSERT") {
        const ins = ent as unknown as {
          name?: string;
          layer?: string;
          position?: { x: number; y: number };
          xScale?: number;
          yScale?: number;
          rotation?: number;
          attribs?: Array<{
            tag?: string;
            text?: string;
            value?: string;
            position?: { x: number; y: number };
            startPoint?: { x: number; y: number };
          }>;
        };

        const entLayer = String(ins.layer || (ent as any).layer || "0");
        const bName = String(ins.name || "");
        const rawAttribs = Array.isArray(ins.attribs) ? ins.attribs : [];
        const attribTags = rawAttribs.map((a) => a.tag || "");
        
        // Deep resolution for anonymous dynamic blocks (*U...)
        const resolved = resolveBlockIdentity(bName, dxfData.blocks as any);
        const effectiveName = !bName.startsWith("*U") ? bName : resolved.realName;
        const allTags = attribTags.concat(resolved.tags);

        // If block was inserted at origin (0, 0), resolve to inner insert's true position
        let actualX = ins.position?.x ?? 0;
        let actualY = ins.position?.y ?? 0;
        if (Math.abs(actualX) < 0.1 && Math.abs(actualY) < 0.1 && resolved.innerPos) {
          actualX = resolved.innerPos.x;
          actualY = resolved.innerPos.y;
        }

        const category = classifyCadEntity(effectiveName, entLayer, allTags);
        const worldPos = transformPt(actualX, actualY);

        // High-level semantic railway equipment is identified at top-level (depth === 0)
        // to prevent duplicate ghost entities from internal block symbol graphics.
        if (depth === 0 && category === "signals") {
          const isNominal = /nom|down|dn/i.test(entLayer) || /nom|down|dn/i.test(effectiveName);
          const isReverse = /rev|up/i.test(entLayer) || /rev|up/i.test(effectiveName);
          const dir = isNominal ? "DOWN" : isReverse ? "UP" : "UNKNOWN";

          let sigLabel = "";
          // 1. Explicit attribute tags
          for (const a of rawAttribs.concat(resolved.attribs)) {
            const t = (a.tag || "").toUpperCase();
            if (/SIGNAL|SIG|NAME|ID|NO/i.test(t)) {
              sigLabel = cleanCadText(String(a.text || a.value || ""));
              if (sigLabel && !/^(?:S|R|P|T)-?$/i.test(sigLabel)) break;
            }
          }

          // 2. Geometric spatial correlation with nearby modelspace text (within 120 units)
          if (!sigLabel) {
            const nearbyTexts = modelTexts
              .map((t) => ({ ...t, dist: Math.hypot(t.x - worldPos.x, t.y - worldPos.y) }))
              .filter((t) => t.dist <= 120)
              .sort((a, b) => a.dist - b.dist);

            for (const nt of nearbyTexts) {
              const cleaned = nt.text.trim();
              if (/^(?:S|SH|C|IB|G)\s*\d+[A-Z]?$/i.test(cleaned)) {
                sigLabel = cleaned.replace(/\s+/g, "");
                break;
              }
              const mSigRef = cleaned.match(/\bfor\s+(?:signal\s+)?([SC]\d{1,3}(?:\/[A-Z0-9]+)?)/i);
              if (mSigRef) {
                sigLabel = mSigRef[1].replace(/\s+/g, "");
                break;
              }
              const mGateRef = cleaned.match(/\bLC(?:\.|\s*No\.?:?|\s*Gate\.?:?)\s*(\d+)/i);
              if (mGateRef) {
                sigLabel = `G${mGateRef[1]}`;
                break;
              }
              if (/Mid Section Modified|Semi Automatic Stop Signal|IB Sort/i.test(cleaned)) {
                sigLabel = isNominal ? "IB-DN" : "IB-UP";
                break;
              }
            }
          }

          // 3. Keep authentic identity (never synthesize fake signal numbers!)
          if (!sigLabel) {
            if (/route\s*indicator/i.test(effectiveName)) {
              sigLabel = "RI";
            }
          }

          if (sigLabel) {
            layoutTokens.push({
              text: sigLabel,
              kind: "signal",
              page: 1,
              x: worldPos.x,
              y: -worldPos.y,
              width: 20,
              height: 20,
              direction: dir,
              layer: entLayer,
              blockName: bName,
            });

            pushText(sigLabel, worldPos.x, worldPos.y);
          }

          layoutTokens.push({
            text: "",
            kind: "ring",
            page: 1,
            x: worldPos.x,
            y: -worldPos.y,
            width: 10,
            height: 10,
          });
        } else if (depth === 0 && category === "rfid_tags") {
          let tagType = "";
          let tagId = "";
          for (const a of rawAttribs.concat(resolved.attribs)) {
            const t = (a.tag || "").toUpperCase();
            if (t === "TYPE" && a.text) {
              const parsedType = cleanCadText(String(a.text)).toUpperCase();
              if (/^[NSTXGALD]$/.test(parsedType)) tagType = parsedType;
            }
            if (/TAG|RFID|NO/i.test(t)) {
              const val = cleanCadText(String(a.text || (a as any).value || ""));
              if (val && !/^(?:R-?|0)$/i.test(val)) tagId = val;
            }
          }

          if (!tagType) {
            const mType = (bName + " " + resolved.realName).match(/RFID\s*-\s*([NSTXGALD])/i);
            if (mType) tagType = mType[1].toUpperCase();
          }

          const tagTypeNames: Record<string, string> = {
            N: "NORMAL TAG",
            S: "SIGNAL FOOT TAG",
            T: "TIN DISCRIMINATION / TURNOUT TAG",
            X: "EXIT TAG",
            G: "GATE TAG",
            A: "ADJUSTMENT / JUNCTION TAG",
            L: "ADJACENT LINE TAG",
            D: "DEAD STOP TAG",
          };

          if (!tagId) {
            const nearbyTagTexts = modelTexts
              .map((t) => ({ ...t, dist: Math.hypot(t.x - worldPos.x, t.y - worldPos.y) }))
              .filter((t) => t.dist <= 35)
              .sort((a, b) => a.dist - b.dist);
            for (const nt of nearbyTagTexts) {
              const cl = nt.text.trim();
              if (/^R[-_.]?\d+/i.test(cl) || /LOC\.[12]:/i.test(cl) || /COMM\./i.test(cl) || /\(\d+m\)/.test(cl)) {
                tagId = cl;
                break;
              }
            }
          }

          const effectiveTagLabel = tagId || (tagType ? `RFID-${tagType}` : "RFID");
          layoutTokens.push({
            text: effectiveTagLabel,
            tagType: tagType || "N",
            tagTypeName: tagTypeNames[tagType] || "RFID TAG",
            kind: "rfid",
            page: 1,
            x: worldPos.x,
            y: -worldPos.y,
            width: 15,
            height: 15,
            layer: entLayer,
            blockName: bName,
          });
          if (tagId) {
            pushText(tagId, worldPos.x, worldPos.y);
          }
        } else if (depth === 0 && category === "points") {
          const isCrossover =
            allTags.includes("A_END_POINT_NO") ||
            allTags.includes("B_END_POINT_NO") ||
            allTags.includes("PA") ||
            allTags.includes("PB") ||
            /crossover|mechine/i.test(effectiveName);

          let paVal = "";
          let pbVal = "";
          let ptVal = "";
          for (const a of rawAttribs.concat(resolved.attribs)) {
            const t = cleanCadAttributeTag(a.tag || "");
            const v = cleanCadText(a.text || (a as any).value || "");
            if (/A_END|PA/i.test(t) && v && !/^(?:P-|PA)$/i.test(v)) paVal = v;
            else if (/B_END|PB/i.test(t) && v && !/^(?:P-|PB)$/i.test(v)) pbVal = v;
            else if (/POINT_NO|PT_NO|POINT/i.test(t) && v && !/^(?:P-|P)$/i.test(v)) ptVal = v;
          }

          // If attribute values were template placeholders, correlate with nearby point texts in modelspace
          if (!paVal && !pbVal && !ptVal) {
            const nearbyPts = modelTexts
              .map((t) => ({ ...t, dist: Math.hypot(t.x - worldPos.x, t.y - worldPos.y) }))
              .filter((t) => t.dist <= 65 && (/^P[-_ ]?\d+[A-Z]?$/i.test(t.text.trim()) || /^P\d/i.test(t.text.trim())))
              .sort((a, b) => a.dist - b.dist);
            if (nearbyPts.length > 0) {
              ptVal = nearbyPts[0].text.trim();
              if (nearbyPts.length > 1) {
                paVal = nearbyPts[0].text.trim();
                pbVal = nearbyPts[1].text.trim();
              }
            }
          }

          if (paVal || pbVal || ptVal) {
            const nameA = paVal ? (paVal.startsWith("P") ? paVal : `P${paVal}`) : "P1A";
            const nameB = pbVal ? (pbVal.startsWith("P") ? pbVal : `P${pbVal}`) : "P1B";

            if (isCrossover) {
              layoutTokens.push({
                text: nameA,
                kind: "point",
                page: 1,
                x: worldPos.x - 20,
                y: -worldPos.y,
                width: 15,
                height: 15,
                layer: entLayer,
                blockName: bName,
              });
              pushText(nameA, worldPos.x - 20, worldPos.y);

              layoutTokens.push({
                text: nameB,
                kind: "point",
                page: 1,
                x: worldPos.x + 20,
                y: -worldPos.y,
                width: 15,
                height: 15,
                layer: entLayer,
                blockName: bName,
              });
              pushText(nameB, worldPos.x + 20, worldPos.y);

              layoutTokens.push({
                text: `${nameA}/${nameB}`,
                kind: "link",
                page: 1,
                x: worldPos.x - 20,
                y: -worldPos.y,
                x2: worldPos.x + 20,
                y2: -worldPos.y - 25,
                label: `${nameA}/${nameB}`,
              });
            } else {
              const ptLabel = ptVal || (effectiveName.includes("Trap") ? "P-Trap" : "P1");
              layoutTokens.push({
                text: ptLabel,
                kind: "point",
                page: 1,
                x: worldPos.x,
                y: -worldPos.y,
                width: 15,
                height: 15,
                layer: entLayer,
                blockName: bName,
              });
              pushText(ptLabel, worldPos.x, worldPos.y);
            }
          }
        }

        if (Array.isArray(ins.attribs)) {
          for (const attr of ins.attribs) {
            const val = cleanCadText(String(attr.text || attr.value || ""));
            if (val) {
              const apt = attr.position ?? attr.startPoint ?? ins.position ?? { x: 0, y: 0 };
              const tp = transformPt(apt.x ?? 0, apt.y ?? 0);
              const label = attr.tag ? `${attr.tag}:${val}` : val;
              pushText(label, tp.x, tp.y);
            }
          }
        }

        const block = ins.name ? dxfData.blocks?.[ins.name] : undefined;
        if (block?.entities) {
          const baseX = block.position?.x ?? 0;
          const baseY = block.position?.y ?? 0;
          const pos = transformPt(ins.position?.x ?? 0, ins.position?.y ?? 0);
          const nextRot = rotRad + ((ins.rotation ?? 0) * Math.PI) / 180;
          const nextSx = scaleX * (ins.xScale ?? 1);
          const nextSy = scaleY * (ins.yScale ?? 1);
          const cosNext = Math.cos(nextRot);
          const sinNext = Math.sin(nextRot);
          const adjX = pos.x - (baseX * nextSx * cosNext - baseY * nextSy * sinNext);
          const adjY = pos.y - (baseX * nextSx * sinNext + baseY * nextSy * cosNext);
          walkEntities(block.entities, adjX, adjY, nextSx, nextSy, nextRot, depth + 1);
        }
      } else if (
        ent.type === "TEXT" ||
        ent.type === "MTEXT" ||
        (depth === 0 && ent.type === "ATTDEF") ||
        ent.type === "ATTRIB"
      ) {
        const txtEnt = ent as unknown as {
          text?: string;
          layer?: string;
          startPoint?: { x: number; y: number };
          position?: { x: number; y: number };
          textHeight?: number;
          height?: number;
          rotation?: number;
        };
        const raw = txtEnt.text ? cleanCadText(txtEnt.text) : "";
        if (raw) {
          const pt = txtEnt.position ?? txtEnt.startPoint ?? { x: 0, y: 0 };
          const tp = transformPt(pt.x, pt.y);
          const textHeight = Number(txtEnt.textHeight ?? txtEnt.height ?? 0) * Math.abs(scaleY);
          pushText(
            raw,
            tp.x,
            tp.y,
            textHeight,
            Number(txtEnt.rotation ?? 0) + (rotRad * 180) / Math.PI,
          );
        }
      } else if (ent.type === "CIRCLE") {
        const circle = ent as unknown as { center?: { x: number; y: number }; radius?: number };
        if (circle.center && circle.radius) {
          const tp = transformPt(circle.center.x, circle.center.y);
          const r = circle.radius * Math.abs(scaleX);
          layoutTokens.push({
            text: "",
            kind: "ring",
            page: 1,
            x: tp.x,
            y: -tp.y,
            width: 2 * r,
            height: 2 * r,
          });
        }
      } else if (ent.type === "LINE" || ent.type === "LWPOLYLINE" || ent.type === "POLYLINE") {
        const entLayer = String((ent as any).layer || "0").toLowerCase();
        const isTrackLayer = entLayer.includes("track") || entLayer.includes("rail");
        const isPointLayer = entLayer.includes("point") || entLayer.includes("turnout") || entLayer.includes("crossover");

        const poly = ent as unknown as { vertices?: Array<{ x: number; y: number }> };
        const vertices = poly.vertices ?? [];
        for (let i = 0; i + 1 < vertices.length; i += 1) {
          const a = transformPt(vertices[i]!.x, vertices[i]!.y);
          const b = transformPt(vertices[i + 1]!.x, vertices[i + 1]!.y);
          const dx = Math.abs(b.x - a.x);
          const dy = Math.abs(b.y - a.y);
          if (isTrackLayer || (dx > 0 && dy <= dx * 0.05)) {
            layoutTokens.push({
              text: "",
              kind: "track",
              page: 1,
              x: Math.min(a.x, b.x),
              x2: Math.max(a.x, b.x),
              y: -(a.y + b.y) / 2,
            });
          } else if (isPointLayer || (dy > dx * 0.15 && dx > dy * 0.25)) {
            layoutTokens.push({
              text: "",
              kind: "link",
              page: 1,
              x: a.x,
              y: -a.y,
              x2: b.x,
              y2: -b.y,
            });
          }
        }
      } else if (ent.type === "DIMENSION") {
        const dimEnt = ent as unknown as {
          text?: string;
          actualMeasurement?: number;
          middleOfText?: { x: number; y: number };
          block?: string;
        };
        const dimLabel = dimEnt.text
          ? cleanCadText(dimEnt.text)
          : dimEnt.actualMeasurement !== undefined
            ? `${Math.round(dimEnt.actualMeasurement)}`
            : "";
        if (dimLabel) {
          const pt = dimEnt.middleOfText ?? { x: 0, y: 0 };
          const tp = transformPt(pt.x, pt.y);
          pushText(`DIM:${dimLabel}`, tp.x, tp.y);
        }
        if (dimEnt.block && dxfData.blocks?.[dimEnt.block]?.entities) {
          walkEntities(
            dxfData.blocks[dimEnt.block].entities,
            offsetX,
            offsetY,
            scaleX,
            scaleY,
            rotRad,
            depth + 1,
          );
        }
      }
    }
  };

  walkEntities(dxfData.entities, 0, 0, 1, 1, 0, 0);

  // Extract authentic modelspace RFID tags from layer "8. RFID Tags" and genuine tag annotations
  const seenTagCoords = new Set<string>();
  for (const t of modelTexts) {
    if (
      t.layer === "8. RFID Tags" ||
      /^LOC\.[12]:/i.test(t.text) ||
      /^\(\d+m\)$/.test(t.text) ||
      /COMM\.\s*(?:ENTRY|EXIT)/i.test(t.text) ||
      /^\(Nominal to Reverse\)/i.test(t.text) ||
      /^R[-_.]?\d+/i.test(t.text)
    ) {
      const coordKey = `${Math.round(t.x)}_${Math.round(t.y)}`;
      if (seenTagCoords.has(coordKey)) continue;
      seenTagCoords.add(coordKey);

      layoutTokens.push({
        text: t.text,
        kind: "rfid",
        page: 1,
        x: t.x,
        y: -t.y,
        width: 15,
        height: 15,
        layer: t.layer,
      });
      pushText(t.text, t.x, t.y);
    }
  }

  // Extract authentic point machine annotations from modelspace text (e.g. P12A, P12B, P18A, P18B)
  const seenPointCoords = new Set<string>();
  for (const t of modelTexts) {
    if (
      t.layer === "3. Points" ||
      /^P[-_ ]?\d+[A-Z]?$/i.test(t.text.trim()) ||
      /^P\d/i.test(t.text.trim())
    ) {
      const cleanPt = t.text.trim().replace(/\s+/g, "").toUpperCase();
      if (!/^(?:P|P-|POINT|PT)$/i.test(cleanPt)) {
        const coordKey = `${Math.round(t.x)}_${Math.round(t.y)}`;
        if (!seenPointCoords.has(coordKey)) {
          seenPointCoords.add(coordKey);
          layoutTokens.push({
            text: cleanPt,
            kind: "point",
            page: 1,
            x: t.x,
            y: -t.y,
            width: 15,
            height: 15,
            layer: t.layer,
          });
          pushText(cleanPt, t.x, t.y);
        }
      }
    }
  }

  // Scan block definitions ONLY if model space had very few texts (e.g. title block inside *T...)
  const hasRealModelTexts = collectedTexts.some((t) => t.x > 1000);
  if (!hasRealModelTexts) {
    for (const [blkName, blk] of Object.entries(dxfData.blocks ?? {})) {
      for (const be of (blk.entities ?? []) as any[]) {
        if (be.type === "TEXT" || be.type === "MTEXT") {
          const raw = be.text ? cleanCadText(be.text) : "";
          if (raw && (/KAVACH|TCAS|LAYOUT|\([A-Z]{2,5}\)|STATION|STN/i.test(raw) || scoreTextPriority(raw) >= 3)) {
            const pt = be.position ?? be.startPoint ?? { x: 0, y: 0 };
            pushText(raw, pt.x, pt.y, Number(be.textHeight ?? be.height ?? 0));
          }
        }
      }
    }
  }

  // Sort by signalling relevance first so critical station codes, signals, tags & TINs are never truncated,
  // then order selected items spatially (top-to-bottom band, left-to-right) for readable schematic reconstruction.
  const selectedTexts = collectedTexts
    .sort((a, b) => b.priority - a.priority || a.x - b.x)
    .slice(0, 2200)
    .sort((a, b) => (Math.abs(a.y - b.y) > 8 ? b.y - a.y : a.x - b.x))
    .map((t) => `${t.text} @(${t.x},${t.y})`);

  const countSummary = Object.entries(entityCounts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const summary = [
    `CAD File: ${fileName} (${kind}${cadVersion ? ` ${cadVersion}` : ""})`,
    `CAD Layers (${layers.length}): ${layers.slice(0, 80).join(", ")}`,
    `Blocks Defined: ${Object.keys(dxfData.blocks ?? {}).length}`,
    `Entity Counts (incl. block expansions): ${countSummary}`,
    `Extracted CAD Text Annotations (${selectedTexts.length} of ${collectedTexts.length}) with (X,Y):`,
    selectedTexts.join(" | "),
  ].join("\n");

  return {
    summary,
    layoutTokens,
    layerCount: layers.length,
    blockCount: Object.keys(dxfData.blocks ?? {}).length,
    entityCount: totalEntities,
  };
}

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return copy.buffer;
}

export async function parseCadFileBuffer(
  buffer: Uint8Array,
  fileName: string,
  kind: "DWG" | "DXF",
): Promise<{
  summary: string;
  layoutTokens: Array<Record<string, unknown>>;
  dxfData: IDxf;
  layerCount: number;
  blockCount: number;
  entityCount: number;
  cadVersion?: string;
}> {
  verifyCadBufferSignature(buffer, kind, fileName);
  const parser = new DxfParser();

  if (kind === "DXF") {
    const head = latin1(buffer.subarray(0, 22));
    let dxfData: IDxf | null = null;
    if (head.startsWith("AutoCAD Binary DXF")) {
      const libredwg = await getLibreDwg();
      const ab = toArrayBuffer(buffer);
      const ptr = libredwg.dwg_read_data(ab, Dwg_File_Type.DXF);
      if (!ptr) {
        throw new Error(`Could not decode binary DXF file (${fileName}).`);
      }
      try {
        const db = libredwg.convert(ptr);
        dxfData = dwgDatabaseToIDxf(db);
      } finally {
        libredwg.dwg_free(ptr);
      }
    } else {
      const rawText = new TextDecoder("utf-8").decode(buffer);
      dxfData = parser.parseSync(rawText);
    }

    if (!dxfData || (!dxfData.entities?.length && !Object.keys(dxfData.blocks ?? {}).length)) {
      throw new Error(`DXF file (${fileName}) contains no renderable CAD geometry.`);
    }
    const stats = summarizeDxf(dxfData, fileName, "DXF");
    return { dxfData, ...stats };
  }

  // DWG Parsing via LibreDWG WASM
  const cadVersion = latin1(buffer.subarray(0, 6)).replace(/[^\x20-\x7E]/g, "");
  const libredwg = await getLibreDwg();
  const ab = toArrayBuffer(buffer);

  let dxfData: IDxf | null = null;
  try {
    const dxfBytes = libredwg.dwg_write_dxf(ab);
    if (dxfBytes && dxfBytes.length > 0) {
      const dxfText = new TextDecoder("utf-8").decode(dxfBytes);
      dxfData = parser.parseSync(dxfText);
    }
  } catch {
    // Fallback to direct DwgDatabase conversion below
  }

  if (!dxfData || !dxfData.entities?.length) {
    const ptr = libredwg.dwg_read_data(ab, Dwg_File_Type.DWG);
    if (!ptr) {
      throw new Error(
        `Failed to decode DWG file (${fileName}, ${cadVersion || "unknown version"}).`,
      );
    }
    try {
      const db = libredwg.convert(ptr);
      dxfData = dwgDatabaseToIDxf(db);
    } finally {
      libredwg.dwg_free(ptr);
    }
  }

  if (!dxfData || (!dxfData.entities?.length && !Object.keys(dxfData.blocks ?? {}).length)) {
    throw new Error(`DWG file (${fileName}) decoded with zero CAD entities.`);
  }

  const stats = summarizeDxf(dxfData, fileName, "DWG", cadVersion);
  return { dxfData, cadVersion, ...stats };
}
