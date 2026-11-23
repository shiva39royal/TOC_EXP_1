/**
 * Parser + spatial tiler for the backend ".cadr" render format (see backend render_service.py).
 * Pure functions, no DOM: runs in a Web Worker and in Node tests.
 */
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface ComponentMutation {
  dx: number;
  dy: number;
  originalAnchor: [number, number];
  currentAnchor: [number, number];
  rotation?: number;
  tags?: Record<string, string>;
  layer?: string;
  color?: string;
  isDeleted?: boolean;
}

export interface Parsed {
  origin: [number, number]; // original CAD coordinate = origin + vertex
  bounds: Bounds;           // absolute CAD coordinates
  meta: Uint32Array;        // [color, lineweight, flags, count, group] * paths
  verts: Float32Array;      // x,y pairs relative to origin
  handles?: string[];       // entity handle per path
}

/** kind 0 = stroke, 1 = fill, 2 = point. z 0 = fills, 1 = lines, 2 = text. */
export interface Chunk {
  kind: 0 | 1 | 2;
  z: number;
  color: number;
  wpx: number;                 // line width in CSS px when lineweights are shown
  layerId: number;
  categoryId: number;
  handle?: string;             // associated CAD entity handle
  bbox: [number, number, number, number]; // relative coordinates
  coords: Float32Array;        // polyline / fill / point vertices
  lens: Uint32Array;           // vertex count per sub-path
  groups: Uint32Array;         // fill group id per sub-path
  segs: Float32Array;          // independent segments (pairs of vertices)
}

export function parseCadr(buf: ArrayBuffer): Parsed {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || dv.getUint32(0, true) !== 0x52444143) throw new Error("Not a CADR render file");
  const jsonLen = dv.getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLen)));
  let off = 12 + jsonLen;
  const meta = new Uint32Array(buf, off, head.paths * 5);
  off += head.paths * 20;
  const verts = new Float32Array(buf, off, head.vertices * 2);
  return { origin: head.origin, bounds: head.bounds, meta, verts, handles: head.handles };
}

class GrowF {
  a = new Float32Array(32); n = 0;
  push(x: number, y: number) {
    if (this.n + 2 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = x; this.a[this.n++] = y;
  }
  done() { return this.a.slice(0, this.n); }
}
class GrowU {
  a = new Uint32Array(16); n = 0;
  push(v: number) {
    if (this.n + 1 > this.a.length) { const b = new Uint32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  done() { return this.a.slice(0, this.n); }
}
interface Acc {
  kind: 0 | 1 | 2; z: number; color: number; wpx: number;
  layerId: number; categoryId: number; handle?: string;
  poly: GrowF; lens: GrowU; groups: GrowU; segs: GrowF;
  bbox: [number, number, number, number];
}

const PIECE = 64; // long polylines are split so spatial culling stays effective
const LW_PX = 26.5; // 1/100 mm -> CSS px (96 dpi)

export function buildChunks(p: Parsed): Chunk[] {
  const { meta, verts, origin, bounds, handles } = p;
  const G = verts.length / 2 > 200_000 ? 32 : 16;
  const minX = bounds.minX - origin[0], minY = bounds.minY - origin[1];
  const sx = G / Math.max(bounds.maxX - bounds.minX, 1e-9), sy = G / Math.max(bounds.maxY - bounds.minY, 1e-9);
  const tile = (x: number, y: number) =>
    Math.min(G - 1, Math.max(0, Math.floor((y - minY) * sy))) * G + Math.min(G - 1, Math.max(0, Math.floor((x - minX) * sx)));

  const accs = new Map<string, Acc>();
  const get = (kind: 0 | 1 | 2, z: number, color: number, wpx: number, t: number, lid: number, cid: number, h: string): Acc => {
    const key = `${kind}:${z}:${color}:${wpx}:${t}:${lid}:${cid}:${h}`;
    let a = accs.get(key);
    if (!a) {
      a = { kind, z, color, wpx, layerId: lid, categoryId: cid, handle: h, poly: new GrowF(), lens: new GrowU(), groups: new GrowU(), segs: new GrowF(),
            bbox: [Infinity, Infinity, -Infinity, -Infinity] };
      accs.set(key, a);
    }
    return a;
  };
  const grow = (a: Acc, x: number, y: number) => {
    const b = a.bbox;
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  };
  const addPoly = (a: Acc, from: number, count: number, group: number) => {
    for (let k = from; k < from + count; k++) { const x = verts[2 * k], y = verts[2 * k + 1]; a.poly.push(x, y); grow(a, x, y); }
    a.lens.push(count); a.groups.push(group);
  };

  let pos = 0, curGroup = -1, groupAcc: Acc | null = null;
  for (let i = 0; i < meta.length / 5; i++) {
    const color = meta[5 * i], lw = meta[5 * i + 1], flags = meta[5 * i + 2], cnt = meta[5 * i + 3], grp = meta[5 * i + 4];
    const z = (flags >> 1) & 3;
    const layerId = (flags >> 8) & 0xFFFF;
    const categoryId = (flags >> 24) & 0xFF;
    const h = handles && handles[i] ? handles[i] : "";
    const wpx = Math.min(12, Math.max(1, Math.round(lw / LW_PX)));
    if (flags & 1) {                              // fill: keep a hatch group in one chunk (holes!)
      if (grp !== curGroup || !groupAcc) { curGroup = grp; groupAcc = get(1, z, color, 1, tile(verts[2 * pos], verts[2 * pos + 1]), layerId, categoryId, h); }
      addPoly(groupAcc, pos, cnt, grp);
    } else if (flags & 16) {
      addPoly(get(2, z, color, 1, tile(verts[2 * pos], verts[2 * pos + 1]), layerId, categoryId, h), pos, 1, 0);
    } else if (flags & 8) {                       // independent segments, tiled one by one
      for (let k = pos; k + 1 < pos + cnt; k += 2) {
        const x0 = verts[2 * k], y0 = verts[2 * k + 1], x1 = verts[2 * k + 2], y1 = verts[2 * k + 3];
        const a = get(0, z, color, wpx, tile((x0 + x1) / 2, (y0 + y1) / 2), layerId, categoryId, h);
        a.segs.push(x0, y0); a.segs.push(x1, y1); grow(a, x0, y0); grow(a, x1, y1);
      }
    } else {                                      // polyline, split in overlapping pieces
      for (let k = 0; k < cnt - 1; k += PIECE - 1) {
        const n = Math.min(PIECE, cnt - k);
        addPoly(get(0, z, color, wpx, tile(verts[2 * (pos + k)], verts[2 * (pos + k) + 1]), layerId, categoryId, h), pos + k, n, 0);
        if (k + n >= cnt) break;
      }
    }
    pos += cnt;
  }
  return [...accs.values()].map((a) => ({
    kind: a.kind, z: a.z, color: a.color, wpx: a.wpx,
    layerId: a.layerId, categoryId: a.categoryId,
    handle: a.handle,
    bbox: a.bbox,
    coords: a.poly.done(), lens: a.lens.done(), groups: a.groups.done(), segs: a.segs.done(),
  }));
}
