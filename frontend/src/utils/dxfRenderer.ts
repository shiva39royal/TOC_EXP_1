// @ts-nocheck -- ported from the original app (written for a looser TS config)
import type { IDxf } from "dxf-parser";
import type { IEntity, IPoint } from "dxf-parser/dist/entities/geomtry";
import type { IArcEntity } from "dxf-parser/dist/entities/arc";
import type { ICircleEntity } from "dxf-parser/dist/entities/circle";
import type { IDimensionEntity } from "dxf-parser/dist/entities/dimension";
import type { IEllipseEntity } from "dxf-parser/dist/entities/ellipse";
import type { IInsertEntity } from "dxf-parser/dist/entities/insert";
import type { ILineEntity } from "dxf-parser/dist/entities/line";
import type { ILwpolylineEntity } from "dxf-parser/dist/entities/lwpolyline";
import type { IMtextEntity } from "dxf-parser/dist/entities/mtext";
import type { IPointEntity } from "dxf-parser/dist/entities/point";
import type { IPolylineEntity } from "dxf-parser/dist/entities/polyline";
import type { ISolidEntity } from "dxf-parser/dist/entities/solid";
import type { ISplineEntity } from "dxf-parser/dist/entities/spline";
import type { ITextEntity } from "dxf-parser/dist/entities/text";

export interface DxfLayerSummary {
  name: string;
  colorIndex: number;
  visible: boolean;
  entityCount: number;
}

export interface DxfExtents {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface DxfTextMatch {
  text: string;
  x: number;
  y: number;
  layer: string;
}

interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function mulMatrix(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    tx: m1.a * m2.tx + m1.c * m2.ty + m1.tx,
    ty: m1.b * m2.tx + m1.d * m2.ty + m1.ty,
  };
}

function applyMatrix(m: Matrix2D, x: number, y: number): { x: number; y: number } {
  return {
    x: m.a * x + m.c * y + m.tx,
    y: m.b * x + m.d * y + m.ty,
  };
}

const ACI_PRIMARY: Record<number, string> = {
  1: "#ef4444",
  2: "#eab308",
  3: "#22c55e",
  4: "#06b6d4",
  5: "#3b82f6",
  6: "#d946ef",
  7: "#e2e8f0",
  8: "#64748b",
  9: "#94a3b8",
  10: "#dc2626",
  11: "#f87171",
  12: "#b91c1c",
  20: "#ea580c",
  30: "#f97316",
  40: "#f59e0b",
  50: "#eab308",
  60: "#84cc16",
  70: "#65a30d",
  80: "#22c55e",
  90: "#16a34a",
  100: "#10b981",
  110: "#14b8a6",
  120: "#06b6d4",
  130: "#0ea5e9",
  140: "#0284c7",
  150: "#3b82f6",
  160: "#2563eb",
  170: "#6366f1",
  180: "#8b5cf6",
  190: "#a855f7",
  200: "#d946ef",
  210: "#ec4899",
  220: "#f43f5e",
  230: "#e11d48",
  240: "#be123c",
  250: "#334155",
  251: "#475569",
  252: "#64748b",
  253: "#94a3b8",
  254: "#cbd5e1",
  255: "#f8fafc",
};

export function resolveAciColor(
  colorIndex: number | undefined,
  trueColor: number | undefined,
  darkTheme: boolean,
): string {
  if (trueColor && trueColor > 0) {
    const r = (trueColor >> 16) & 255;
    const g = (trueColor >> 8) & 255;
    const b = trueColor & 255;
    if (!darkTheme && r > 225 && g > 225 && b > 225) return "#0f172a";
    if (darkTheme && r < 30 && g < 30 && b < 30) return "#e2e8f0";
    return `rgb(${r},${g},${b})`;
  }

  const idx = Math.abs(colorIndex ?? 7);
  if (idx === 7 || idx === 0 || idx === 256) {
    return darkTheme ? "#e2e8f0" : "#0f172a";
  }
  if (!darkTheme && idx === 2) return "#b45309"; // Make yellow readable on white paper
  if (!darkTheme && idx === 4) return "#0369a1"; // Make cyan readable on white paper
  if (!darkTheme && idx === 3) return "#15803d"; // Make green crisp on white paper
  if (ACI_PRIMARY[idx]) return ACI_PRIMARY[idx];

  if (idx >= 10 && idx <= 249) {
    const hue = Math.round(((idx - 10) / 240) * 360);
    const lightness = darkTheme ? 62 : 42;
    return `hsl(${hue}, 82%, ${lightness}%)`;
  }
  return darkTheme ? "#e2e8f0" : "#0f172a";
}

export function cleanCadMtext(raw: string): string {
  return raw
    .replace(/\\P/gi, "\n")
    .replace(/\\~/g, " ")
    .replace(/\\[A-Za-z][^;]*;/g, "")
    .replace(/[{}]/g, "")
    .trim();
}

function getEntityColor(
  ent: IEntity,
  dxf: IDxf,
  parentLayer: string,
  parentColorIdx: number,
  darkTheme: boolean,
): { color: string; effectiveLayer: string; effectiveColorIdx: number } {
  const effectiveLayer = ent.layer && ent.layer !== "0" ? ent.layer : parentLayer || "0";
  const layerMeta = dxf.tables?.layer?.layers?.[effectiveLayer];

  let effectiveColorIdx = ent.colorIndex ?? 256;
  if (effectiveColorIdx === 0) {
    effectiveColorIdx = parentColorIdx; // ByBlock
  } else if (effectiveColorIdx === 256 || ent.colorIndex === undefined) {
    effectiveColorIdx = layerMeta?.colorIndex ?? 7; // ByLayer
  }

  return {
    color: resolveAciColor(effectiveColorIdx, ent.color || layerMeta?.color, darkTheme),
    effectiveLayer,
    effectiveColorIdx,
  };
}

function computeBulgeArc(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  bulge: number,
) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9 || Math.abs(bulge) < 1e-6) return null;

  const theta = 4 * Math.atan(bulge);
  const radius = Math.abs(chord / (2 * Math.sin(theta / 2)));
  const sagitta = Math.abs((bulge * chord) / 2);
  const distToCenter = radius - sagitta;

  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const nx = -dy / chord;
  const ny = dx / chord;

  // Sign: positive bulge arcs CCW (to the right of chord if theta > pi, or left if theta < pi)
  const sign = bulge > 0 ? (Math.abs(bulge) <= 1 ? 1 : -1) : Math.abs(bulge) <= 1 ? -1 : 1;
  const cx = mx + sign * distToCenter * nx;
  const cy = my + sign * distToCenter * ny;

  const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
  const endAngle = Math.atan2(p2.y - cy, p2.x - cx);
  return { cx, cy, radius, startAngle, endAngle, anticlockwise: bulge < 0 };
}

function buildInsertMatrix(
  ins: IInsertEntity,
  blockPos?: IPoint,
  colOffset = 0,
  rowOffset = 0,
): Matrix2D {
  const rot = ((ins.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const sx = ins.xScale ?? 1;
  const sy = ins.yScale ?? 1;

  const bx = blockPos?.x ?? 0;
  const by = blockPos?.y ?? 0;

  const px = (ins.position?.x ?? 0) + colOffset * cos - rowOffset * sin;
  const py = (ins.position?.y ?? 0) + colOffset * sin + rowOffset * cos;

  const scaleRotate: Matrix2D = {
    a: sx * cos,
    b: sx * sin,
    c: -sy * sin,
    d: sy * cos,
    tx: px,
    ty: py,
  };

  if (bx === 0 && by === 0) return scaleRotate;
  return mulMatrix(scaleRotate, { a: 1, b: 0, c: 0, d: 1, tx: -bx, ty: -by });
}

export function getDxfLayerInventory(dxf: IDxf): DxfLayerSummary[] {
  const counts: Record<string, number> = {};
  const countEntities = (entities: IEntity[] | undefined, depth: number) => {
    if (!entities || depth > 5) return;
    for (const ent of entities) {
      const layer = ent.layer || "0";
      counts[layer] = (counts[layer] ?? 0) + 1;
      if (ent.type === "INSERT") {
        const ins = ent as IInsertEntity;
        const blk = ins.name ? dxf.blocks?.[ins.name] : undefined;
        if (blk?.entities) countEntities(blk.entities, depth + 1);
      }
    }
  };
  countEntities(dxf.entities, 0);

  const tableLayers = dxf.tables?.layer?.layers ?? {};
  const allNames = new Set([...Object.keys(tableLayers), ...Object.keys(counts)]);

  return Array.from(allNames)
    .map((name) => {
      const meta = tableLayers[name];
      return {
        name,
        colorIndex: meta?.colorIndex ?? 7,
        visible: meta ? meta.visible !== false && !meta.frozen : true,
        entityCount: counts[name] ?? 0,
      };
    })
    .filter((l) => l.entityCount > 0 || tableLayers[l.name])
    .sort((a, b) => b.entityCount - a.entityCount);
}

export function extractDxfExtentsAndTexts(
  dxf: IDxf,
  visibleLayers?: Record<string, boolean>,
): { extents: DxfExtents; texts: DxfTextMatch[] } {
  const sampleXs: number[] = [];
  const sampleYs: number[] = [];
  const texts: DxfTextMatch[] = [];

  const expandPt = (x: number, y: number, layer: string) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (layer.toUpperCase() === "DEFPOINTS" && Math.abs(x) < 1e-3 && Math.abs(y) < 1e-3) return;
    sampleXs.push(x);
    sampleYs.push(y);
  };

  const walk = (
    entities: IEntity[] | undefined,
    mat: Matrix2D,
    parentLayer: string,
    depth: number,
  ) => {
    if (!entities || depth > 6) return;
    for (const ent of entities) {
      if (ent.visible === false || ent.inPaperSpace) continue;
      const effectiveLayer = ent.layer && ent.layer !== "0" ? ent.layer : parentLayer || "0";
      if (visibleLayers && visibleLayers[effectiveLayer] === false) continue;

      if (ent.type === "INSERT") {
        const ins = ent as IInsertEntity & {
          attribs?: Array<{ text?: string; position?: IPoint; startPoint?: IPoint }>;
        };
        if (Array.isArray(ins.attribs)) {
          for (const attr of ins.attribs) {
            const pt = attr.position ?? attr.startPoint ?? ins.position;
            if (pt && attr.text) {
              const p = applyMatrix(mat, pt.x, pt.y);
              expandPt(p.x, p.y, effectiveLayer);
              const cleaned = cleanCadMtext(attr.text);
              if (cleaned) texts.push({ text: cleaned, x: p.x, y: p.y, layer: effectiveLayer });
            }
          }
        }
        const blk = ins.name ? dxf.blocks?.[ins.name] : undefined;
        if (!blk?.entities) continue;
        const cols = Math.max(1, Math.min(20, ins.columnCount ?? 1));
        const rows = Math.max(1, Math.min(20, ins.rowCount ?? 1));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const subMat = mulMatrix(
              mat,
              buildInsertMatrix(
                ins,
                blk.position,
                c * (ins.columnSpacing ?? 0),
                r * (ins.rowSpacing ?? 0),
              ),
            );
            walk(blk.entities, subMat, effectiveLayer, depth + 1);
          }
        }
      } else if (ent.type === "LINE") {
        const l = ent as ILineEntity;
        for (const v of l.vertices ?? []) {
          const p = applyMatrix(mat, v.x, v.y);
          expandPt(p.x, p.y, effectiveLayer);
        }
      } else if (ent.type === "LWPOLYLINE" || ent.type === "POLYLINE") {
        const pl = ent as ILwpolylineEntity | IPolylineEntity;
        for (const v of pl.vertices ?? []) {
          const p = applyMatrix(mat, v.x, v.y);
          expandPt(p.x, p.y, effectiveLayer);
        }
      } else if (ent.type === "CIRCLE" || ent.type === "ARC") {
        const c = ent as ICircleEntity | IArcEntity;
        if (c.center) {
          const center = applyMatrix(mat, c.center.x, c.center.y);
          const scale = Math.max(Math.hypot(mat.a, mat.b), Math.hypot(mat.c, mat.d));
          const rad = (c.radius ?? 0) * scale;
          expandPt(center.x - rad, center.y - rad, effectiveLayer);
          expandPt(center.x + rad, center.y + rad, effectiveLayer);
        }
      } else if (ent.type === "ELLIPSE") {
        const el = ent as IEllipseEntity;
        if (el.center && el.majorAxisEndPoint) {
          const c = applyMatrix(mat, el.center.x, el.center.y);
          const maj =
            Math.hypot(el.majorAxisEndPoint.x, el.majorAxisEndPoint.y) *
            Math.max(Math.hypot(mat.a, mat.b), Math.hypot(mat.c, mat.d));
          expandPt(c.x - maj, c.y - maj, effectiveLayer);
          expandPt(c.x + maj, c.y + maj, effectiveLayer);
        }
      } else if (ent.type === "SPLINE") {
        const sp = ent as ISplineEntity;
        for (const pt of sp.fitPoints ?? sp.controlPoints ?? []) {
          const p = applyMatrix(mat, pt.x, pt.y);
          expandPt(p.x, p.y, effectiveLayer);
        }
      } else if (ent.type === "SOLID") {
        const s = ent as ISolidEntity;
        for (const pt of s.points ?? []) {
          const p = applyMatrix(mat, pt.x, pt.y);
          expandPt(p.x, p.y, effectiveLayer);
        }
      } else if (
        ent.type === "TEXT" ||
        ent.type === "MTEXT" ||
        ent.type === "ATTDEF" ||
        ent.type === "ATTRIB"
      ) {
        const t = ent as any;
        const pos = t.position ?? t.startPoint;
        if (pos) {
          const p = applyMatrix(mat, pos.x, pos.y);
          expandPt(p.x, p.y, effectiveLayer);
          const raw = t.text ? cleanCadMtext(t.text) : (t.value ? cleanCadMtext(t.value) : "");
          if (raw) {
            texts.push({ text: raw, x: p.x, y: p.y, layer: effectiveLayer });
          }
        }
      } else if (ent.type === "DIMENSION") {
        const d = ent as IDimensionEntity;
        if (d.block && dxf.blocks?.[d.block]?.entities) {
          walk(dxf.blocks[d.block].entities, mat, effectiveLayer, depth + 1);
        } else if (d.middleOfText) {
          const p = applyMatrix(mat, d.middleOfText.x, d.middleOfText.y);
          expandPt(p.x, p.y, effectiveLayer);
        }
      }
    }
  };

  walk(dxf.entities, IDENTITY_MATRIX, "0", 0);

  if (sampleXs.length === 0) {
    return {
      extents: { minX: 0, maxX: 1000, minY: 0, maxY: 400, width: 1000, height: 400 },
      texts,
    };
  }

  // Trim extreme isolated construction outliers (e.g., stray 0,0 origin point far from drawing)
  let minX = Math.min(...sampleXs);
  let maxX = Math.max(...sampleXs);
  let minY = Math.min(...sampleYs);
  let maxY = Math.max(...sampleYs);

  if (sampleXs.length >= 24) {
    const sx = [...sampleXs].sort((a, b) => a - b);
    const sy = [...sampleYs].sort((a, b) => a - b);
    const loIdx = Math.floor(sx.length * 0.02);
    const hiIdx = Math.min(sx.length - 1, Math.ceil(sx.length * 0.98) - 1);
    const coreW = sx[hiIdx] - sx[loIdx];
    const coreH = sy[hiIdx] - sy[loIdx];
    if (coreW > 0 && maxX - minX > coreW * 4) {
      minX = sx[loIdx] - coreW * 0.06;
      maxX = sx[hiIdx] + coreW * 0.06;
    }
    if (coreH > 0 && maxY - minY > coreH * 4) {
      minY = sy[loIdx] - coreH * 0.06;
      maxY = sy[hiIdx] + coreH * 0.06;
    }
  }

  return {
    extents: {
      minX,
      maxX,
      minY,
      maxY,
      width: Math.max(1e-3, maxX - minX),
      height: Math.max(1e-3, maxY - minY),
    },
    texts,
  };
}

export interface DxfRenderOptions {
  dxf: IDxf;
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  viewCenterX: number;
  viewCenterY: number;
  pixelsPerWorldUnit: number;
  visibleLayers: Record<string, boolean>;
  darkTheme: boolean;
  searchQuery?: string;
}

export function renderDxfToCanvas(opts: DxfRenderOptions): void {
  const {
    dxf,
    ctx,
    canvasWidth,
    canvasHeight,
    viewCenterX,
    viewCenterY,
    pixelsPerWorldUnit,
    visibleLayers,
    darkTheme,
    searchQuery,
  } = opts;

  const query = searchQuery?.trim().toLowerCase() ?? "";

  ctx.save();
  ctx.fillStyle = darkTheme ? "#000000" : "#ffffff";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Subtle CAD coordinate grid
  const targetGridPx = 90;
  const rawWorldStep = targetGridPx / pixelsPerWorldUnit;
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, rawWorldStep))));
  const norm = rawWorldStep / pow10;
  const niceStep = norm < 2 ? pow10 : norm < 5 ? 2 * pow10 : 5 * pow10;

  const worldLeft = viewCenterX - canvasWidth / (2 * pixelsPerWorldUnit);
  const worldRight = viewCenterX + canvasWidth / (2 * pixelsPerWorldUnit);
  const worldBottom = viewCenterY - canvasHeight / (2 * pixelsPerWorldUnit);
  const worldTop = viewCenterY + canvasHeight / (2 * pixelsPerWorldUnit);

  const worldToScreenX = (wx: number) => canvasWidth / 2 + (wx - viewCenterX) * pixelsPerWorldUnit;
  const worldToScreenY = (wy: number) => canvasHeight / 2 - (wy - viewCenterY) * pixelsPerWorldUnit;

  ctx.strokeStyle = darkTheme ? "rgba(148, 163, 184, 0.08)" : "rgba(15, 23, 42, 0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const startGx = Math.floor(worldLeft / niceStep) * niceStep;
  for (let gx = startGx; gx <= worldRight; gx += niceStep) {
    const sx = worldToScreenX(gx);
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, canvasHeight);
  }
  const startGy = Math.floor(worldBottom / niceStep) * niceStep;
  for (let gy = startGy; gy <= worldTop; gy += niceStep) {
    const sy = worldToScreenY(gy);
    ctx.moveTo(0, sy);
    ctx.lineTo(canvasWidth, sy);
  }
  ctx.stroke();

  const drawPolyline = (
    vertices: Array<{ x: number; y: number; bulge?: number }>,
    closed: boolean,
    mat: Matrix2D,
  ) => {
    if (!vertices || vertices.length < 2) return;
    ctx.beginPath();
    const first = applyMatrix(mat, vertices[0].x, vertices[0].y);
    ctx.moveTo(worldToScreenX(first.x), worldToScreenY(first.y));

    const totalSegs = closed ? vertices.length : vertices.length - 1;
    for (let i = 0; i < totalSegs; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      const p1 = applyMatrix(mat, v1.x, v1.y);
      const p2 = applyMatrix(mat, v2.x, v2.y);

      if (v1.bulge && Math.abs(v1.bulge) > 1e-5) {
        const det = mat.a * mat.d - mat.b * mat.c;
        const effectiveBulge = det < 0 ? -v1.bulge : v1.bulge;
        const arc = computeBulgeArc(p1, p2, effectiveBulge);
        if (arc && Number.isFinite(arc.radius) && arc.radius * pixelsPerWorldUnit < 50000) {
          // Canvas Y is inverted relative to CAD world Y
          ctx.arc(
            worldToScreenX(arc.cx),
            worldToScreenY(arc.cy),
            arc.radius * pixelsPerWorldUnit,
            -arc.startAngle,
            -arc.endAngle,
            !arc.anticlockwise,
          );
          continue;
        }
      }
      ctx.lineTo(worldToScreenX(p2.x), worldToScreenY(p2.y));
    }
    ctx.stroke();
  };

  const drawEntityList = (
    entities: IEntity[] | undefined,
    mat: Matrix2D,
    parentLayer: string,
    parentColorIdx: number,
    depth: number,
  ) => {
    if (!entities || depth > 6) return;

    for (const ent of entities) {
      if (ent.visible === false || ent.inPaperSpace) continue;
      const { color, effectiveLayer, effectiveColorIdx } = getEntityColor(
        ent,
        dxf,
        parentLayer,
        parentColorIdx,
        darkTheme,
      );
      if (visibleLayers[effectiveLayer] === false) continue;

      if (ent.type === "INSERT") {
        const ins = ent as IInsertEntity & {
          attribs?: Array<{
            text?: string;
            position?: IPoint;
            startPoint?: IPoint;
            endPoint?: IPoint;
            tag?: string;
            invisible?: boolean;
            horizontalJustification?: number;
            verticalJustification?: number;
          }>;
        };
        if (Array.isArray(ins.attribs)) {
          for (const attr of ins.attribs) {
            if (attr.invisible) continue;
            const rawAttr = attr.text
              ? cleanCadMtext(attr.text)
              : (attr as any).value
                ? cleanCadMtext((attr as any).value)
                : "";
            // Suppress unpopulated block prototype attribute templates
            if (!rawAttr || /^(?:S-S\.|R-|P-|PA|PB|0|\(CSR-\s*m\))$/i.test(rawAttr.trim())) continue;
            const hasJust = Boolean(attr.horizontalJustification || attr.verticalJustification);
            const pt = hasJust ? (attr.endPoint ?? attr.position ?? attr.startPoint) : (attr.position ?? attr.startPoint ?? ins.position);
            if (rawAttr && pt) {
              const tp = applyMatrix(mat, pt.x, pt.y);
              const matRot = Math.atan2(mat.b, mat.a);
              let effRot = -matRot;
              while (effRot > Math.PI) effRot -= 2 * Math.PI;
              while (effRot < -Math.PI) effRot += 2 * Math.PI;
              if (effRot > Math.PI / 2 || effRot < -Math.PI / 2) {
                effRot += Math.PI;
              }
              ctx.save();
              ctx.translate(worldToScreenX(tp.x), worldToScreenY(tp.y));
              ctx.rotate(effRot);
              ctx.fillStyle = color;
              ctx.font = '600 11px "JetBrains Mono", monospace';
              if (attr.horizontalJustification === 1) ctx.textAlign = "center";
              else if (attr.horizontalJustification === 2) ctx.textAlign = "right";
              else ctx.textAlign = "left";
              if (attr.verticalJustification === 2) ctx.textBaseline = "middle";
              else if (attr.verticalJustification === 3) ctx.textBaseline = "top";
              else if (attr.verticalJustification === 1) ctx.textBaseline = "bottom";
              else ctx.textBaseline = "alphabetic";
              ctx.fillText(rawAttr, 0, 0);
              ctx.restore();
            }
          }
        }
        const blk = ins.name ? dxf.blocks?.[ins.name] : undefined;
        if (!blk?.entities) continue;
        const cols = Math.max(1, Math.min(20, ins.columnCount ?? 1));
        const rows = Math.max(1, Math.min(20, ins.rowCount ?? 1));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const subMat = mulMatrix(
              mat,
              buildInsertMatrix(
                ins,
                blk.position,
                c * (ins.columnSpacing ?? 0),
                r * (ins.rowSpacing ?? 0),
              ),
            );
            drawEntityList(blk.entities, subMat, effectiveLayer, effectiveColorIdx, depth + 1);
          }
        }
        continue;
      }

      if (ent.type === "DIMENSION") {
        const dim = ent as IDimensionEntity;
        if (dim.block && dxf.blocks?.[dim.block]?.entities) {
          drawEntityList(
            dxf.blocks[dim.block].entities,
            mat,
            effectiveLayer,
            effectiveColorIdx,
            depth + 1,
          );
        } else if (dim.middleOfText) {
          const tp = applyMatrix(mat, dim.middleOfText.x, dim.middleOfText.y);
          const label = dim.text
            ? cleanCadMtext(dim.text)
            : dim.actualMeasurement !== undefined
              ? dim.actualMeasurement.toFixed(1)
              : "";
          if (label) {
            ctx.fillStyle = color;
            ctx.font = '11px "JetBrains Mono", monospace';
            ctx.fillText(label, worldToScreenX(tp.x), worldToScreenY(tp.y));
          }
        }
        continue;
      }

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(
        0.9,
        Math.min(2.2, ent.lineweight && ent.lineweight > 0 ? ent.lineweight / 35 : 1.05),
      );

      if (ent.type === "LINE") {
        const l = ent as ILineEntity;
        if (l.vertices && l.vertices.length >= 2) {
          const p1 = applyMatrix(mat, l.vertices[0].x, l.vertices[0].y);
          const p2 = applyMatrix(mat, l.vertices[1].x, l.vertices[1].y);
          ctx.beginPath();
          ctx.moveTo(worldToScreenX(p1.x), worldToScreenY(p1.y));
          ctx.lineTo(worldToScreenX(p2.x), worldToScreenY(p2.y));
          ctx.stroke();
        }
      } else if (ent.type === "LWPOLYLINE" || ent.type === "POLYLINE") {
        const pl = ent as ILwpolylineEntity | IPolylineEntity;
        drawPolyline(pl.vertices ?? [], Boolean(pl.shape), mat);
      } else if (ent.type === "CIRCLE") {
        const c = ent as ICircleEntity;
        if (c.center && c.radius > 0) {
          const cp = applyMatrix(mat, c.center.x, c.center.y);
          const sx = Math.hypot(mat.a, mat.b);
          const sy = Math.hypot(mat.c, mat.d);
          const rx = c.radius * sx * pixelsPerWorldUnit;
          const ry = c.radius * sy * pixelsPerWorldUnit;
          if (rx > 0.4 || ry > 0.4) {
            const rot = Math.atan2(mat.b, mat.a);
            ctx.beginPath();
            ctx.ellipse(worldToScreenX(cp.x), worldToScreenY(cp.y), rx, ry, -rot, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      } else if (ent.type === "ARC") {
        const a = ent as IArcEntity;
        if (a.center && a.radius > 0) {
          const cp = applyMatrix(mat, a.center.x, a.center.y);
          const scale = Math.hypot(mat.a, mat.b);
          const rPx = a.radius * scale * pixelsPerWorldUnit;
          if (rPx > 0.4) {
            const matRot = Math.atan2(mat.b, mat.a);
            const det = mat.a * mat.d - mat.b * mat.c;
            const sAng = -(a.startAngle + matRot);
            const eAng = -(a.endAngle + matRot);
            ctx.beginPath();
            ctx.arc(worldToScreenX(cp.x), worldToScreenY(cp.y), rPx, sAng, eAng, det >= 0);
            ctx.stroke();
          }
        }
      } else if (ent.type === "ELLIPSE") {
        const el = ent as IEllipseEntity;
        if (el.center && el.majorAxisEndPoint) {
          const cp = applyMatrix(mat, el.center.x, el.center.y);
          const majEnd = applyMatrix(
            mat,
            el.center.x + el.majorAxisEndPoint.x,
            el.center.y + el.majorAxisEndPoint.y,
          );
          const rx = Math.hypot(majEnd.x - cp.x, majEnd.y - cp.y) * pixelsPerWorldUnit;
          const ry = rx * (el.axisRatio ?? 1);
          const rot = Math.atan2(majEnd.y - cp.y, majEnd.x - cp.x);
          const sAng = el.startAngle ?? 0;
          const eAng = el.endAngle ?? Math.PI * 2;
          ctx.beginPath();
          ctx.ellipse(worldToScreenX(cp.x), worldToScreenY(cp.y), rx, ry, -rot, -sAng, -eAng, true);
          ctx.stroke();
        }
      } else if (ent.type === "SPLINE") {
        const sp = ent as ISplineEntity;
        const pts = sp.fitPoints && sp.fitPoints.length >= 2 ? sp.fitPoints : sp.controlPoints;
        if (pts && pts.length >= 2) {
          drawPolyline(pts, Boolean(sp.closed), mat);
        }
      } else if (ent.type === "SOLID") {
        const s = ent as ISolidEntity;
        if (s.points && s.points.length >= 3) {
          // DXF SOLID order swaps indices 2 & 3
          const order =
            s.points.length >= 4 ? [s.points[0], s.points[1], s.points[3], s.points[2]] : s.points;
          ctx.beginPath();
          const p0 = applyMatrix(mat, order[0].x, order[0].y);
          ctx.moveTo(worldToScreenX(p0.x), worldToScreenY(p0.y));
          for (let k = 1; k < order.length; k++) {
            const pk = applyMatrix(mat, order[k].x, order[k].y);
            ctx.lineTo(worldToScreenX(pk.x), worldToScreenY(pk.y));
          }
          ctx.closePath();
          ctx.globalAlpha = 0.35;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.stroke();
        }
      } else if (ent.type === "POINT") {
        const pt = ent as IPointEntity;
        if (pt.position) {
          const p = applyMatrix(mat, pt.position.x, pt.position.y);
          const sx = worldToScreenX(p.x);
          const sy = worldToScreenY(p.y);
          ctx.beginPath();
          ctx.moveTo(sx - 4, sy);
          ctx.lineTo(sx + 4, sy);
          ctx.moveTo(sx, sy - 4);
          ctx.lineTo(sx, sy + 4);
          ctx.stroke();
        }
      } else if (
        ent.type === "TEXT" ||
        ent.type === "MTEXT" ||
        ent.type === "ATTRIB"
      ) {
        const t = ent as any;
        if (t.invisible === true) continue;
        const raw = t.text
          ? cleanCadMtext(t.text)
          : t.value
            ? cleanCadMtext(t.value)
            : "";
        if (!raw || /^(?:S-S\.|R-|P-|PA|PB|0|\(CSR-\s*m\)|\(-N\)|AT Occupied|ROUTES?|TIN_NO|TRACK_NO)$/i.test(raw.trim())) continue;

        const hasJust = Boolean(t.horizontalJustification || t.verticalJustification);
        const anchor = hasJust ? (t.endPoint ?? t.position ?? t.startPoint) : (t.position ?? t.startPoint);
        if (!anchor) continue;

        const tp = applyMatrix(mat, anchor.x, anchor.y);
        const sx = worldToScreenX(tp.x);
        const sy = worldToScreenY(tp.y);
        const rawHeight = t.textHeight ?? t.height ?? 2.5;
        const worldScale = Math.hypot(mat.a, mat.b);
        const pxHeight = rawHeight * worldScale * pixelsPerWorldUnit;

        // Keep labels legible: if font is small, clamp to at least 7px when user is zoomed in
        if (pxHeight < 0.7 && !query) continue;

        const matRot = Math.atan2(mat.b, mat.a);
        let entityRot = 0;
        if (typeof t.rotation === "number" && Number.isFinite(t.rotation)) {
          entityRot = (t.rotation * Math.PI) / 180;
        } else if (t.directionVector) {
          entityRot = Math.atan2(t.directionVector.y, t.directionVector.x);
        }

        const isMatch = query.length > 0 && raw.toLowerCase().includes(query);
        const fontPx = Math.max(7.0, Math.min(48, pxHeight || 10));

        const det = mat.a * mat.d - mat.b * mat.c;
        const signY = det < 0 ? -1 : 1;
        let effRot = -(matRot + signY * entityRot);
        while (effRot > Math.PI) effRot -= 2 * Math.PI;
        while (effRot < -Math.PI) effRot += 2 * Math.PI;
        // AutoCAD standard text reading: keep text reading from left-to-right (never upside down)
        if (effRot > Math.PI / 2) {
          effRot -= Math.PI;
        } else if (effRot < -Math.PI / 2) {
          effRot += Math.PI;
        }

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(effRot);
        ctx.font = `${isMatch ? "700" : "600"} ${fontPx.toFixed(1)}px "JetBrains Mono", monospace`;

        if (t.horizontalJustification === 1) {
          ctx.textAlign = "center";
        } else if (t.horizontalJustification === 2) {
          ctx.textAlign = "right";
        } else {
          ctx.textAlign = "left";
        }

        if (t.verticalJustification === 2) {
          ctx.textBaseline = "middle";
        } else if (t.verticalJustification === 3) {
          ctx.textBaseline = "top";
        } else if (t.verticalJustification === 1) {
          ctx.textBaseline = "bottom";
        } else {
          ctx.textBaseline = ent.type === "MTEXT" ? "top" : "alphabetic";
        }

        const lines = raw.split("\n");
        if (isMatch) {
          const maxW = Math.max(...lines.map((ln) => ctx.measureText(ln).width), 24);
          ctx.fillStyle = "rgba(245, 158, 11, 0.35)";
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 1.5;
          const boxY = ent.type === "MTEXT" ? -3 : -fontPx - 2;
          ctx.fillRect(-4, boxY, maxW + 8, lines.length * fontPx * 1.15 + 6);
          ctx.strokeRect(-4, boxY, maxW + 8, lines.length * fontPx * 1.15 + 6);
        }

        ctx.fillStyle = isMatch ? (darkTheme ? "#fde68a" : "#b45309") : color;
        lines.forEach((ln, idx) => {
          ctx.fillText(ln, 0, idx * fontPx * 1.18);
        });
        ctx.restore();
      }
    }
  };

  drawEntityList(dxf.entities, IDENTITY_MATRIX, "0", 7, 0);
  ctx.restore();
}
