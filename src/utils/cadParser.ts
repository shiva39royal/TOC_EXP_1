// @ts-nocheck
// Browser-side CAD decoding (ported from the original Express server).
// The edge server cannot load the LibreDWG WASM from disk, so DWG/DXF files are decoded here.
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
import type { DwgDatabase, LibreDwgEx } from '@mlightcad/libredwg-web';
import DxfParser from 'dxf-parser';
import type { IDxf } from 'dxf-parser';

let libreDwgPromise: Promise<LibreDwgEx> | null = null;
async function getLibreDwg(): Promise<LibreDwgEx> {
  if (!libreDwgPromise) {
    libreDwgPromise = LibreDwg.create('/libredwg');
  }
  return libreDwgPromise;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function cleanCadText(raw: string): string {
  return raw
    .replace(/\\P/gi, ' ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSupportedCadExtension(fileName: string): 'DWG' | 'DXF' | 'PDF' | null {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.dwg')) return 'DWG';
  if (lower.endsWith('.dxf')) return 'DXF';
  if (lower.endsWith('.pdf')) return 'PDF';
  return null;
}

function verifyCadBufferSignature(buffer: Uint8Array, kind: 'DWG' | 'DXF' | 'PDF', fileName: string): void {
  if (buffer.length < 16) {
    throw new Error(`Invalid ${kind} file (${fileName}): file is empty or truncated.`);
  }
  const headAscii = latin1(buffer.subarray(0, 64));
  if (kind === 'PDF') {
    if (!headAscii.startsWith('%PDF')) {
      throw new Error(`Invalid PDF file (${fileName}): missing %PDF header signature.`);
    }
    return;
  }

  if (headAscii.startsWith('%PDF')) {
    throw new Error(`Invalid ${kind} file (${fileName}): PDF bytes inside a .${kind.toLowerCase()} file. Rename or upload a genuine ${kind}.`);
  }
  if (headAscii.startsWith('PK\x03\x04')) {
    throw new Error(`Invalid ${kind} file (${fileName}): archive/Office XML content detected. Supported formats are .dwg, .dxf, and .pdf.`);
  }

  if (kind === 'DWG') {
    if (!/^AC1\.\d|^AC10\d{2}/.test(headAscii)) {
      throw new Error(
        `Invalid DWG file (${fileName}): missing AutoCAD DWG signature (expected AC10xx header).`
      );
    }
  } else {
    const isBinaryDxf = headAscii.startsWith('AutoCAD Binary DXF');
    if (!isBinaryDxf) {
      const sample = new TextDecoder('utf-8').decode(buffer.subarray(0, Math.min(buffer.length, 4096)));
      if (!sample.includes('SECTION') && !sample.includes('ENTITIES') && !sample.includes('EOF')) {
        throw new Error(
          `Invalid DXF file (${fileName}): missing DXF SECTION/ENTITIES structure.`
        );
      }
    }
  }
}

function dwgDatabaseToIDxf(db: DwgDatabase): IDxf {
  const layersRecord: Record<string, { name: string; visible: boolean; colorIndex: number; color: number; frozen: boolean }> = {};
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
    const t = String(e.type || '');
    const common = {
      type: t,
      layer: String(e.layer || '0'),
      colorIndex: typeof e.colorIndex === 'number' ? e.colorIndex : 256,
      color: typeof e.color === 'number' ? e.color : 0,
      visible: e.isVisible !== false,
      lineType: String(e.lineType || 'BYLAYER'),
      lineTypeScale: Number(e.linetypeScale || 1),
      inPaperSpace: false,
    };

    if (t === 'LINE') {
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
    if (t === 'LWPOLYLINE') {
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
    if (t === 'POLYLINE2D' || t === 'POLYLINE3D') {
      const verts = Array.isArray(e.vertices) ? e.vertices : [];
      return {
        ...common,
        type: 'POLYLINE',
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
    if (t === 'CIRCLE') {
      const c = e.center as { x?: number; y?: number; z?: number } | undefined;
      return {
        ...common,
        center: { x: Number(c?.x ?? 0), y: Number(c?.y ?? 0), z: Number(c?.z ?? 0) },
        radius: Number(e.radius ?? 0),
      };
    }
    if (t === 'ARC') {
      const c = e.center as { x?: number; y?: number; z?: number } | undefined;
      return {
        ...common,
        center: { x: Number(c?.x ?? 0), y: Number(c?.y ?? 0), z: Number(c?.z ?? 0) },
        radius: Number(e.radius ?? 0),
        startAngle: Number(e.startAngle ?? 0),
        endAngle: Number(e.endAngle ?? 0),
      };
    }
    if (t === 'ELLIPSE') {
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
    if (t === 'SPLINE') {
      const fit = Array.isArray(e.fitPoints) ? e.fitPoints : [];
      const ctrl = Array.isArray(e.controlPoints) ? e.controlPoints : [];
      return {
        ...common,
        closed: Boolean(e.closed),
        fitPoints: fit.map((p: Record<string, unknown>) => ({ x: Number(p.x ?? 0), y: Number(p.y ?? 0), z: Number(p.z ?? 0) })),
        controlPoints: ctrl.map((p: Record<string, unknown>) => ({ x: Number(p.x ?? 0), y: Number(p.y ?? 0), z: Number(p.z ?? 0) })),
      };
    }
    if (t === 'TEXT') {
      const sp = e.startPoint as { x?: number; y?: number; z?: number } | undefined;
      return {
        ...common,
        text: String(e.text ?? ''),
        startPoint: { x: Number(sp?.x ?? 0), y: Number(sp?.y ?? 0), z: Number(sp?.z ?? 0) },
        textHeight: Number(e.textHeight ?? 2.5),
        rotation: (Number(e.rotation ?? 0) * 180) / Math.PI,
      };
    }
    if (t === 'MTEXT') {
      const pos = e.insertionPoint as { x?: number; y?: number; z?: number } | undefined;
      return {
        ...common,
        text: String(e.text ?? ''),
        position: { x: Number(pos?.x ?? 0), y: Number(pos?.y ?? 0), z: Number(pos?.z ?? 0) },
        height: Number(e.textHeight ?? 2.5),
        rotation: (Number(e.rotation ?? 0) * 180) / Math.PI,
      };
    }
    if (t === 'INSERT') {
      const pos = e.insertionPoint as { x?: number; y?: number; z?: number } | undefined;
      const rawAttribs = Array.isArray(e.attribs)
        ? e.attribs
        : Array.isArray(e.attributes)
          ? e.attributes
          : [];
      return {
        ...common,
        name: String(e.name ?? ''),
        position: { x: Number(pos?.x ?? 0), y: Number(pos?.y ?? 0), z: Number(pos?.z ?? 0) },
        xScale: Number(e.xScale ?? 1),
        yScale: Number(e.yScale ?? 1),
        zScale: Number(e.zScale ?? 1),
        rotation: (Number(e.rotation ?? 0) * 180) / Math.PI,
        columnCount: Number(e.columnCount ?? 1),
        rowCount: Number(e.rowCount ?? 1),
        columnSpacing: Number(e.columnSpacing ?? 0),
        rowSpacing: Number(e.rowSpacing ?? 0),
        attribs: rawAttribs.map((a: Record<string, unknown>) => ({
          tag: String(a.tag ?? ''),
          text: String(a.text ?? a.value ?? ''),
          startPoint: a.startPoint ?? a.position ?? pos,
          position: a.position ?? a.startPoint ?? pos,
        })),
      };
    }
    if (t === 'SOLID') {
      const pts = [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean) as Array<{ x?: number; y?: number; z?: number }>;
      return {
        ...common,
        points: pts.map((p) => ({ x: Number(p.x ?? 0), y: Number(p.y ?? 0), z: Number(p.z ?? 0) })),
      };
    }
    return null;
  };

  const blocksRecord: Record<string, { name: string; position: { x: number; y: number; z: number }; entities: unknown[] }> = {};
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
    entities: modelEntities as unknown as IDxf['entities'],
    blocks: blocksRecord as unknown as IDxf['blocks'],
    tables: {
      layer: { handle: '0', ownerHandle: '0', layers: layersRecord },
      lineType: { handle: '0', ownerHandle: '0', lineTypes: {} },
      viewPort: { handle: '0', ownerHandle: '0', viewPorts: [] },
    },
  };
}

function summarizeDxf(dxfData: IDxf, fileName: string, kind: 'DWG' | 'DXF', cadVersion?: string) {
  const layers = Object.keys(dxfData.tables?.layer?.layers ?? {});
  const collectedTexts: Array<{ text: string; x: number; y: number; priority: number }> = [];
  // Positioned primitives for the offline extractor (y flipped so it points down like a page).
  const layoutTokens: Array<Record<string, unknown>> = [];
  const entityCounts: Record<string, number> = {};
  let totalEntities = 0;

  const scoreTextPriority = (txt: string): number => {
    if (/^(R|N)[-\s]?\d+/i.test(txt) || /\b(TIN|STN|STATION|CODE|KAVACH|TCAS|HOME|STARTER|DISTANT|ADV|LOOP|MAIN|LINE|LC[-\s]?\d+|PT\.?\s*\d+)\b/i.test(txt)) {
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
      kind: 'text',
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

  const walkEntities = (
    entities: IDxf['entities'] | undefined,
    offsetX: number,
    offsetY: number,
    scaleX: number,
    scaleY: number,
    rotRad: number,
    depth: number
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

      if (ent.type === 'INSERT') {
        const ins = ent as unknown as {
          name?: string;
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

        if (Array.isArray(ins.attribs)) {
          for (const attr of ins.attribs) {
            const val = cleanCadText(String(attr.text || attr.value || ''));
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
      } else if (ent.type === 'TEXT' || ent.type === 'MTEXT' || ent.type === 'ATTDEF' || ent.type === 'ATTRIB') {
        const txtEnt = ent as unknown as {
          text?: string;
          startPoint?: { x: number; y: number };
          position?: { x: number; y: number };
          textHeight?: number;
          height?: number;
          rotation?: number;
        };
        const raw = txtEnt.text ? cleanCadText(txtEnt.text) : '';
        if (raw) {
          const pt = txtEnt.position ?? txtEnt.startPoint ?? { x: 0, y: 0 };
          const tp = transformPt(pt.x, pt.y);
          const textHeight = Number(txtEnt.textHeight ?? txtEnt.height ?? 0) * Math.abs(scaleY);
          pushText(raw, tp.x, tp.y, textHeight, Number(txtEnt.rotation ?? 0) + (rotRad * 180) / Math.PI);
        }
      } else if (ent.type === 'CIRCLE') {
        const circle = ent as unknown as { center?: { x: number; y: number }; radius?: number };
        if (circle.center && circle.radius) {
          const tp = transformPt(circle.center.x, circle.center.y);
          const r = circle.radius * Math.abs(scaleX);
          layoutTokens.push({ text: '', kind: 'ring', page: 1, x: tp.x, y: -tp.y, width: 2 * r, height: 2 * r });
        }
      } else if (ent.type === 'LINE' || ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
        const poly = ent as unknown as { vertices?: Array<{ x: number; y: number }> };
        const vertices = poly.vertices ?? [];
        for (let i = 0; i + 1 < vertices.length; i += 1) {
          const a = transformPt(vertices[i]!.x, vertices[i]!.y);
          const b = transformPt(vertices[i + 1]!.x, vertices[i + 1]!.y);
          const dx = Math.abs(b.x - a.x);
          const dy = Math.abs(b.y - a.y);
          if (dx > 0 && dy <= dx * 0.01) {
            layoutTokens.push({ text: '', kind: 'track', page: 1, x: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), y: -(a.y + b.y) / 2 });
          } else if (dy > dx * 0.15 && dx > dy * 0.25) {
            // Slanted segment: a possible turnout leg; the extractor keeps it only if it joins two lines.
            layoutTokens.push({ text: '', kind: 'link', page: 1, x: a.x, y: -a.y, x2: b.x, y2: -b.y });
          }
        }
      } else if (ent.type === 'DIMENSION') {
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
            : '';
        if (dimLabel) {
          const pt = dimEnt.middleOfText ?? { x: 0, y: 0 };
          const tp = transformPt(pt.x, pt.y);
          pushText(`DIM:${dimLabel}`, tp.x, tp.y);
        }
        if (dimEnt.block && dxfData.blocks?.[dimEnt.block]?.entities) {
          walkEntities(dxfData.blocks[dimEnt.block].entities, offsetX, offsetY, scaleX, scaleY, rotRad, depth + 1);
        }
      }
    }
  };

  walkEntities(dxfData.entities, 0, 0, 1, 1, 0, 0);

  // Sort by signalling relevance first so critical station codes, signals, tags & TINs are never truncated,
  // then order selected items spatially (top-to-bottom band, left-to-right) for readable schematic reconstruction.
  const selectedTexts = collectedTexts
    .sort((a, b) => b.priority - a.priority || a.x - b.x)
    .slice(0, 2200)
    .sort((a, b) => (Math.abs(a.y - b.y) > 8 ? b.y - a.y : a.x - b.x))
    .map((t) => `${t.text} @(${t.x},${t.y})`);

  const countSummary = Object.entries(entityCounts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const summary = [
    `CAD File: ${fileName} (${kind}${cadVersion ? ` ${cadVersion}` : ''})`,
    `CAD Layers (${layers.length}): ${layers.slice(0, 80).join(', ')}`,
    `Blocks Defined: ${Object.keys(dxfData.blocks ?? {}).length}`,
    `Entity Counts (incl. block expansions): ${countSummary}`,
    `Extracted CAD Text Annotations (${selectedTexts.length} of ${collectedTexts.length}) with (X,Y):`,
    selectedTexts.join(' | '),
  ].join('\n');

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
  kind: 'DWG' | 'DXF'
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

  if (kind === 'DXF') {
    const head = latin1(buffer.subarray(0, 22));
    let dxfData: IDxf | null = null;
    if (head.startsWith('AutoCAD Binary DXF')) {
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
      const rawText = new TextDecoder('utf-8').decode(buffer);
      dxfData = parser.parseSync(rawText);
    }

    if (!dxfData || (!dxfData.entities?.length && !Object.keys(dxfData.blocks ?? {}).length)) {
      throw new Error(`DXF file (${fileName}) contains no renderable CAD geometry.`);
    }
    const stats = summarizeDxf(dxfData, fileName, 'DXF');
    return { dxfData, ...stats };
  }

  // DWG Parsing via LibreDWG WASM
  const cadVersion = latin1(buffer.subarray(0, 6)).replace(/[^\x20-\x7E]/g, '');
  const libredwg = await getLibreDwg();
  const ab = toArrayBuffer(buffer);

  let dxfData: IDxf | null = null;
  try {
    const dxfBytes = libredwg.dwg_write_dxf(ab);
    if (dxfBytes && dxfBytes.length > 0) {
      const dxfText = new TextDecoder('utf-8').decode(dxfBytes);
      dxfData = parser.parseSync(dxfText);
    }
  } catch {
    // Fallback to direct DwgDatabase conversion below
  }

  if (!dxfData || !dxfData.entities?.length) {
    const ptr = libredwg.dwg_read_data(ab, Dwg_File_Type.DWG);
    if (!ptr) {
      throw new Error(`Failed to decode DWG file (${fileName}, ${cadVersion || 'unknown version'}).`);
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

  const stats = summarizeDxf(dxfData, fileName, 'DWG', cadVersion);
  return { dxfData, cadVersion, ...stats };
}
