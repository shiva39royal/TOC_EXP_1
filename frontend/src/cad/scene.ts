import type { Bounds, Chunk } from "./cadFormat";

export interface Camera { cx: number; cy: number; scale: number } // centre in origin-relative coords

export interface VisualComponent {
  id: string;
  bbox: [number, number, number, number]; // CAD absolute coords: minX, minY, maxX, maxY
  anchor: [number, number];               // CAD absolute coords: x, y
  layerId?: number;
  categoryId?: number;
}

export interface RouteHighlight {
  entryAnchor?: [number, number];
  exitAnchor?: [number, number];
  entryLabel?: string;
  exitLabel?: string;
  intermediatePoints: Array<[number, number]>;
  rfidPoints: Array<{ anchor: [number, number]; tag: string }>;
}

export interface DrawOpts {
  dark: boolean;
  lineweights: boolean;
  grid: boolean;
  interacting: boolean;
  hiddenLayers?: Set<number>;
  hiddenCategories?: Set<number>;
  selectedComponent?: VisualComponent | null;
  selectedComponents?: VisualComponent[];
  routeHighlight?: RouteHighlight | null;
  stagedAdditions?: Record<string, {
    temp_id: string;
    source_handle: string;
    source_anchor?: [number, number];
    insert_pos: [number, number];
    tags?: Record<string, string>;
    layer?: string;
    color?: number;
  }>;
  movedComponents?: Record<string, {
    dx: number;
    dy: number;
    originalAnchor: [number, number];
    currentAnchor: [number, number];
    isDeleted?: boolean;
    bbox?: [number, number, number, number];
    layerId?: number;
    categoryId?: number;
    tags?: Record<string, string>;
  }>;
  dragDelta?: { id: string; dx: number; dy: number } | null;
}

export const BG = { dark: "#000000", light: "#f4f5f6" };
const LOD_VERTEX_BUDGET = 400_000;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Cached = Chunk & { paths?: Path2D[] };

export class Scene {
  layers: Cached[][] = [[], [], []];
  constructor(public origin: [number, number], public bounds: Bounds, chunks: Chunk[]) {
    for (const c of chunks) this.layers[Math.min(c.z, 2)].push(c);
  }
  /** Bounds in origin-relative coordinates. */
  get rel() {
    const b = this.bounds, o = this.origin;
    return { minX: b.minX - o[0], minY: b.minY - o[1], maxX: b.maxX - o[0], maxY: b.maxY - o[1] };
  }
}

function buildPaths(c: Cached): Path2D[] {
  if (c.paths) return c.paths;
  const out: Path2D[] = [];
  const co = c.coords;
  if (c.kind === 1) {
    const merge = c.z === 2;
    let p = new Path2D(), pos = 0, prev = -1;
    for (let i = 0; i < c.lens.length; i++) {
      if (!merge && prev !== -1 && c.groups[i] !== prev) { out.push(p); p = new Path2D(); }
      prev = c.groups[i];
      const n = c.lens[i];
      p.moveTo(co[2 * pos], co[2 * pos + 1]);
      for (let k = 1; k < n; k++) p.lineTo(co[2 * (pos + k)], co[2 * (pos + k) + 1]);
      p.closePath();
      pos += n;
    }
    out.push(p);
  } else {
    const p = new Path2D();
    let pos = 0;
    for (let i = 0; i < c.lens.length; i++) {
      const n = c.lens[i];
      p.moveTo(co[2 * pos], co[2 * pos + 1]);
      for (let k = 1; k < n; k++) p.lineTo(co[2 * (pos + k)], co[2 * (pos + k) + 1]);
      pos += n;
    }
    const s = c.segs;
    for (let i = 0; i + 3 < s.length; i += 4) { p.moveTo(s[i], s[i + 1]); p.lineTo(s[i + 2], s[i + 3]); }
    out.push(p);
  }
  c.paths = out;
  return out;
}

const colorCache = new Map<string, string>();
function css(color: number, dark: boolean): string {
  const k = `${color}|${dark}`;
  let v = colorCache.get(k);
  if (!v) {
    let c = color;
    if (dark && (color === 0 || color < 0x1a1a1a)) {
      c = 0xffffff;
    } else if (!dark && (color === 0xffffff || color > 0xe5e5e5)) {
      c = 0x000000;
    }
    v = "#" + c.toString(16).padStart(6, "0");
    colorCache.set(k, v);
  }
  return v;
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function drawGrid(ctx: Ctx, scene: Scene, cam: Camera, w: number, h: number, dark: boolean) {
  const step = niceStep(90 / cam.scale);
  const ox = scene.origin[0], oy = scene.origin[1];
  const x0 = cam.cx - w / 2 / cam.scale, x1 = cam.cx + w / 2 / cam.scale;
  const y0 = cam.cy - h / 2 / cam.scale, y1 = cam.cy + h / 2 / cam.scale;
  ctx.lineWidth = 1;
  ctx.strokeStyle = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  ctx.beginPath();
  const sxp = (x: number) => Math.round(w / 2 + (x - cam.cx) * cam.scale) + 0.5;
  const syp = (y: number) => Math.round(h / 2 - (y - cam.cy) * cam.scale) + 0.5;
  let n = 0;
  for (let x = Math.ceil((x0 + ox) / step) * step; x <= x1 + ox && n++ < 400; x += step) { ctx.moveTo(sxp(x - ox), 0); ctx.lineTo(sxp(x - ox), h); }
  n = 0;
  for (let y = Math.ceil((y0 + oy) / step) * step; y <= y1 + oy && n++ < 400; y += step) { ctx.moveTo(0, syp(y - oy)); ctx.lineTo(w, syp(y - oy)); }
  ctx.stroke();
}

/** Draws one frame. Works for on-screen canvases, export canvases and Node (@napi-rs/canvas). */
export function drawScene(ctx: Ctx, scene: Scene | null, cam: Camera, w: number, h: number, dpr: number, o: DrawOpts): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = o.dark ? BG.dark : BG.light;
  ctx.fillRect(0, 0, w * dpr, h * dpr);
  if (!scene) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (o.grid) drawGrid(ctx, scene, cam, w, h, o.dark);

  const s = cam.scale;
  const ox = scene.origin[0], oy = scene.origin[1];
  ctx.setTransform(dpr * s, 0, 0, -dpr * s, dpr * (w / 2 - cam.cx * s), dpr * (h / 2 + cam.cy * s));
  const vx0 = cam.cx - w / 2 / s, vx1 = cam.cx + w / 2 / s, vy0 = cam.cy - h / 2 / s, vy1 = cam.cy + h / 2 / s;
  const pad = 6 / s;

  // Render visible CAD geometry cleanly without unintended cross-entity shifting
  const visible: Cached[][] = [[], [], []];
  let verts = 0;
  scene.layers.forEach((layer, z) => {
    for (const c of layer) {
      if (o.hiddenLayers && c.layerId > 0 && o.hiddenLayers.has(c.layerId)) continue;
      if (o.hiddenCategories && c.categoryId > 0 && o.hiddenCategories.has(c.categoryId)) continue;
      const b = c.bbox;
      if (b[2] < vx0 - pad || b[0] > vx1 + pad || b[3] < vy0 - pad || b[1] > vy1 + pad) continue;
      visible[z].push(c);
      verts += c.coords.length / 2 + c.segs.length / 2;
    }
  });
  const lod = o.interacting && verts > LOD_VERTEX_BUDGET;

  ctx.lineJoin = "round";
  ctx.lineCap = "butt";

  for (let z = 0; z < 3; z++) {
    if (lod && z === 2) break;
    for (const c of visible[z]) {
      let moved = c.handle && o.movedComponents ? o.movedComponents[c.handle] : null;
      let isDrag = c.handle && o.dragDelta && o.dragDelta.id === c.handle;

      if (!moved && c.handle && o.movedComponents) {
        const baseH = c.handle.includes("_") ? c.handle.split("_")[0] : null;
        if (baseH && o.movedComponents[baseH]) {
          moved = o.movedComponents[baseH];
        }
      }
      if (!isDrag && c.handle && o.dragDelta) {
        const baseH = c.handle.includes("_") ? c.handle.split("_")[0] : null;
        if (baseH && o.dragDelta.id === baseH) {
          isDrag = true;
        }
      }

      const dx = isDrag ? o.dragDelta!.dx : (moved ? moved.dx : 0);
      const dy = isDrag ? o.dragDelta!.dy : (moved ? moved.dy : 0);

      if (moved?.isDeleted) continue;

      if (dx !== 0 || dy !== 0) {
        ctx.translate(dx, dy);
      }

      const hasEditedText = !!(moved?.tags && (
        moved.tags.NAME || moved.tags.TEXT || moved.tags.TIN_NO || moved.tags.TRACK_NO ||
        moved.tags.POINT_NO || moved.tags["B_END_POINT_NO."] || moved.tags["A_END_POINT_NO."] ||
        moved.tags["RFID_TAG_NO."] || moved.tags.TYPE || moved.tags["FM_NO."] || moved.tags["LOCATION_(M)"] ||
        moved.tags.SIGNAL_NO || moved.tags.DP
      ));

      if (c.z === 2 && hasEditedText) {
        // Draw the edited text directly in place of the original CAD vector text!
        const newText = moved!.tags!.NAME || moved!.tags!.TEXT || moved!.tags!.TIN_NO || moved!.tags!.TRACK_NO ||
          moved!.tags!.POINT_NO || moved!.tags!["B_END_POINT_NO."] || moved!.tags!["A_END_POINT_NO."] ||
          moved!.tags!["RFID_TAG_NO."] || moved!.tags!.TYPE || moved!.tags!["FM_NO."] || moved!.tags!["LOCATION_(M)"] ||
          moved!.tags!.SIGNAL_NO || moved!.tags!.DP;
        if (newText) {
          const col = css(c.color, o.dark);
          const cx = (c.bbox[0] + c.bbox[2]) / 2;
          const cy = (c.bbox[1] + c.bbox[3]) / 2;
          const th = Math.max(c.bbox[3] - c.bbox[1], 2.2);

          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(1, -1);
          ctx.font = `bold ${th}px Inter, -apple-system, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = col;
          ctx.fillText(String(newText), 0, 0);
          ctx.restore();
        }
        if (dx !== 0 || dy !== 0) {
          ctx.translate(-dx, -dy);
        }
        continue;
      }

      const col = css(c.color, o.dark);
      if (c.kind === 1) {
        ctx.fillStyle = col;
        for (const p of buildPaths(c)) {
          ctx.fill(p, "evenodd");
          if (z === 1) {
            ctx.strokeStyle = col;
            ctx.lineWidth = (o.lineweights && c.wpx > 0 ? c.wpx : 1) / s;
            ctx.stroke(p);
          }
        }
      } else if (c.kind === 2) {
        ctx.fillStyle = col;
        const k = 2 / s;
        for (let i = 0; i < c.coords.length; i += 2) ctx.fillRect(c.coords[i] - k / 2, c.coords[i + 1] - k / 2, k, k);
      } else {
        ctx.strokeStyle = col;
        ctx.lineWidth = (o.lineweights ? c.wpx : 1) / s;
        ctx.stroke(buildPaths(c)[0]);
      }

      if (dx !== 0 || dy !== 0) {
        ctx.translate(-dx, -dy);
      }

      // Draw client preview of staged additions cloned from this chunk
      if (o.stagedAdditions && c.handle) {
        const adds = Object.values(o.stagedAdditions).filter(
          (a) => a.source_handle === c.handle || (c.handle!.includes("_") && a.source_handle === c.handle!.split("_")[0])
        );
        for (const a of adds) {
          const aMut = o.movedComponents ? o.movedComponents[a.temp_id] : null;
          if (aMut?.isDeleted) continue;
          const aDrag = o.dragDelta && o.dragDelta.id === a.temp_id;
          const adxMut = aDrag ? o.dragDelta!.dx : (aMut ? aMut.dx : 0);
          const adyMut = aDrag ? o.dragDelta!.dy : (aMut ? aMut.dy : 0);

          const baseAx = a.source_anchor ? a.source_anchor[0] : (a.insert_pos[0] - 15);
          const baseAy = a.source_anchor ? a.source_anchor[1] : a.insert_pos[1];
          const aDx = (a.insert_pos[0] - baseAx) + adxMut;
          const aDy = (a.insert_pos[1] - baseAy) + adyMut;

          ctx.translate(aDx, aDy);
          const aCol = css(a.color ?? c.color, o.dark);
          if (c.kind === 1) {
            ctx.fillStyle = aCol;
            for (const p of buildPaths(c)) {
              ctx.fill(p, "evenodd");
              if (z === 1) {
                ctx.strokeStyle = aCol;
                ctx.lineWidth = (o.lineweights && c.wpx > 0 ? c.wpx : 1) / s;
                ctx.stroke(p);
              }
            }
          } else if (c.kind === 2) {
            ctx.fillStyle = aCol;
            const k = 2 / s;
            for (let i = 0; i < c.coords.length; i += 2) ctx.fillRect(c.coords[i] - k / 2, c.coords[i + 1] - k / 2, k, k);
          } else {
            ctx.strokeStyle = aCol;
            ctx.lineWidth = (o.lineweights ? c.wpx : 1) / s;
            ctx.stroke(buildPaths(c)[0]);
          }
          ctx.translate(-aDx, -aDy);
        }
      }
    }
  }

  // Draw Selection Boxes & Grips for selected components
  const selectedList = (o.selectedComponents && o.selectedComponents.length > 0)
    ? o.selectedComponents
    : (o.selectedComponent ? [o.selectedComponent] : []);

  for (const sc of selectedList) {
    let dx = 0;
    let dy = 0;

    if (o.dragDelta && o.dragDelta.id === sc.id) {
      dx = o.dragDelta.dx;
      dy = o.dragDelta.dy;
    } else if (o.movedComponents && o.movedComponents[sc.id]) {
      const m = o.movedComponents[sc.id];
      if (!m.isDeleted) {
        dx = m.dx;
        dy = m.dy;
      }
    }

    const rx0 = sc.bbox[0] - ox + dx;
    const ry0 = sc.bbox[1] - oy + dy;
    const rx1 = sc.bbox[2] - ox + dx;
    const ry1 = sc.bbox[3] - oy + dy;
    const rw = rx1 - rx0;
    const rh = ry1 - ry0;

    // Red Dashed Leader Line (ONLY drawn when actively moved or dragged)
    const dist = Math.hypot(dx, dy);
    if (dist > 0.05) {
      const ax0 = sc.anchor[0] - ox;
      const ay0 = sc.anchor[1] - oy;
      const ax1 = ax0 + dx;
      const ay1 = ay0 + dy;

      ctx.setLineDash([5 / s, 4 / s]);
      ctx.strokeStyle = "#ff2222";
      ctx.lineWidth = 1.6 / s;
      ctx.beginPath();
      ctx.moveTo(ax0, ay0);
      ctx.lineTo(ax1, ay1);
      ctx.stroke();

      // Base anchor dot on the original position
      ctx.setLineDash([]);
      ctx.fillStyle = "#ffd600";
      ctx.beginPath();
      ctx.arc(ax0, ay0, 4.0 / s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ff2222";
      ctx.lineWidth = 1.2 / s;
      ctx.stroke();
    }

    // Red Dashed Bounding Box (Exact match to CAD Fast Viewer)
    ctx.setLineDash([6 / s, 4 / s]);
    ctx.strokeStyle = "#ff2222";
    ctx.lineWidth = 1.8 / s;
    ctx.strokeRect(rx0, ry0, rw, rh);

    // Grip handles
    ctx.setLineDash([]);
    const gripHalf = 4.0 / s;

    // 4 Corner grips (cyan square with white border)
    const corners: Array<[number, number]> = [
      [rx0, ry0],
      [rx1, ry0],
      [rx1, ry1],
      [rx0, ry1],
    ];

    for (const [gx, gy] of corners) {
      ctx.fillStyle = "#00b0ff";
      ctx.fillRect(gx - gripHalf, gy - gripHalf, gripHalf * 2, gripHalf * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.0 / s;
      ctx.strokeRect(gx - gripHalf, gy - gripHalf, gripHalf * 2, gripHalf * 2);
    }

    // Anchor grip (yellow circle with red border)
    const ax = sc.anchor[0] - ox + dx;
    const ay = sc.anchor[1] - oy + dy;
    ctx.fillStyle = "#ffd600";
    ctx.beginPath();
    ctx.arc(ax, ay, 4.5 / s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ff2222";
    ctx.lineWidth = 1.4 / s;
    ctx.stroke();
  }

  // Draw X-Tractor Route Illumination Overlay
  if (o.routeHighlight) {
    const rh = o.routeHighlight;
    const pts: Array<[number, number]> = [];
    if (rh.entryAnchor) pts.push([rh.entryAnchor[0] - ox, rh.entryAnchor[1] - oy]);
    for (const pt of rh.intermediatePoints) {
      pts.push([pt[0] - ox, pt[1] - oy]);
    }
    if (rh.exitAnchor) pts.push([rh.exitAnchor[0] - ox, rh.exitAnchor[1] - oy]);

    if (pts.length >= 2) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Outer neon cyan aura
      ctx.shadowColor = "#00e5ff";
      ctx.shadowBlur = 12;
      ctx.strokeStyle = "rgba(0, 229, 255, 0.45)";
      ctx.lineWidth = 9 / s;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();

      // Inner intense solid electric path
      ctx.shadowBlur = 4;
      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = 3.5 / s;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();

      // White dash flow
      ctx.shadowBlur = 0;
      ctx.setLineDash([8 / s, 6 / s]);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.6 / s;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // RFID tag beacon circles & labels along route
    for (const rfid of rh.rfidPoints) {
      const rx = rfid.anchor[0] - ox;
      const ry = rfid.anchor[1] - oy;
      ctx.save();
      ctx.strokeStyle = "#ffd600";
      ctx.lineWidth = 2.0 / s;
      ctx.shadowColor = "#ffd600";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(rx, ry, 7 / s, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(255, 214, 0, 0.25)";
      ctx.beginPath();
      ctx.arc(rx, ry, 7 / s, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffd600";
      ctx.font = `600 ${11 / s}px monospace`;
      ctx.fillText(rfid.tag, rx + 9 / s, ry - 5 / s);
      ctx.restore();
    }

    // Entry signal beacon (Green glowing badge)
    if (rh.entryAnchor) {
      const ex = rh.entryAnchor[0] - ox;
      const ey = rh.entryAnchor[1] - oy;
      ctx.save();
      ctx.fillStyle = "#00e676";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.0 / s;
      ctx.shadowColor = "#00e676";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(ex, ey, 8 / s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = "#00e676";
      ctx.font = `bold ${12 / s}px sans-serif`;
      ctx.fillText(`ENTRY: ${rh.entryLabel || ""}`, ex + 12 / s, ey + 4 / s);
      ctx.restore();
    }

    // Exit signal beacon (Red glowing badge)
    if (rh.exitAnchor) {
      const ex = rh.exitAnchor[0] - ox;
      const ey = rh.exitAnchor[1] - oy;
      ctx.save();
      ctx.fillStyle = "#ff1744";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.0 / s;
      ctx.shadowColor = "#ff1744";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(ex, ey, 8 / s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ff1744";
      ctx.font = `bold ${12 / s}px sans-serif`;
      ctx.fillText(`EXIT: ${rh.exitLabel || ""}`, ex + 12 / s, ey + 4 / s);
      ctx.restore();
    }
  }
}

export function fitCamera(scene: Scene, w: number, h: number, margin = 0.04): Camera {
  const r = scene.rel;
  const bw = Math.max(r.maxX - r.minX, 1e-9), bh = Math.max(r.maxY - r.minY, 1e-9);
  const scale = Math.min((w * (1 - 2 * margin)) / bw, (h * (1 - 2 * margin)) / bh);
  return { cx: (r.minX + r.maxX) / 2, cy: (r.minY + r.maxY) / 2, scale };
}
