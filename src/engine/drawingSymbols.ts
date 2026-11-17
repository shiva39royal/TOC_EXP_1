/**
 * Pure raster helpers for the offline drawing reader. They run on RGBA pixel buffers so they can be
 * used in the browser (canvas ImageData) and in tests without any DOM.
 *
 * - Track bands: long, thick horizontal ink runs (the coloured/black running lines of a yard layout).
 * - Signal heads: small circles drawn next to numeric signal labels.
 */

export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface TrackBand {
  /** Band centre row (pixels). */
  y: number;
  x0: number;
  x1: number;
  /** Band thickness in pixels. */
  thickness: number;
}

export interface RingMark {
  x: number;
  y: number;
  r: number;
}

export interface InkMasks {
  width: number;
  height: number;
  /** Any visible ink, including light coloured track fills. */
  any: Uint8Array;
  /** Dark, low-saturation ink: black line work such as signal symbols. */
  dark: Uint8Array;
}

export function buildInkMasks(image: RasterImage): InkMasks {
  const { width, height, data } = image;
  const any = new Uint8Array(width * height);
  const dark = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < any.length; i += 1, p += 4) {
    const r = data[p]!;
    const g = data[p + 1]!;
    const b = data[p + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = max - min;
    if (lum < 205 || (sat > 55 && lum < 242)) any[i] = 1;
    if (lum < 215 && sat < 70) dark[i] = 1;
  }
  return { width, height, any, dark };
}

/**
 * Finds long horizontal bands. Each row is scanned for ink runs of at least `minRun` pixels; runs in
 * consecutive rows that overlap are joined into one band.
 */
export function detectTrackBands(masks: InkMasks, minRun = Math.max(140, Math.round(masks.width * 0.1))): TrackBand[] {
  const { width, height, any } = masks;
  interface Open { startRow: number; lastRow: number; x0s: number[]; x1s: number[] }
  const done: Open[] = [];
  let open: Open[] = [];
  for (let y = 0; y < height; y += 1) {
    const runs: Array<[number, number]> = [];
    let start = -1;
    let gap = 0;
    const row = y * width;
    for (let x = 0; x <= width; x += 1) {
      const ink = x < width && any[row + x] === 1;
      if (ink) {
        if (start < 0) start = x;
        gap = 0;
      } else if (start >= 0) {
        // Tolerate 2px breaks (anti-aliasing, joint ticks) inside a band.
        gap += 1;
        if (gap > 2 || x === width) {
          const end = x - gap;
          if (end - start + 1 >= minRun) runs.push([start, end]);
          start = -1;
          gap = 0;
        }
      }
    }
    const next: Open[] = [];
    for (const [x0, x1] of runs) {
      const match = open.find((band) => {
        const bx0 = band.x0s[band.x0s.length - 1]!;
        const bx1 = band.x1s[band.x1s.length - 1]!;
        const overlap = Math.min(bx1, x1) - Math.max(bx0, x0);
        return overlap > 0.5 * Math.min(bx1 - bx0, x1 - x0);
      });
      if (match && !next.includes(match)) {
        match.lastRow = y;
        match.x0s.push(x0);
        match.x1s.push(x1);
        next.push(match);
      } else {
        next.push({ startRow: y, lastRow: y, x0s: [x0], x1s: [x1] });
      }
    }
    for (const band of open) if (!next.includes(band)) done.push(band);
    open = next;
  }
  done.push(...open);
  const median = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  return done.map((band) => ({
    y: (band.startRow + band.lastRow) / 2,
    x0: median(band.x0s),
    x1: median(band.x1s),
    thickness: band.lastRow - band.startRow + 1,
  }));
}

function inkAt(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= width || yi >= height) return false;
  return mask[yi * width + xi] === 1;
}

function ringCoverage(masks: InkMasks, cx: number, cy: number, r: number, samples: number, maxMisses: number, quadrants?: number[], aspect = 1): number {
  const { dark, width, height } = masks;
  let hits = 0;
  let misses = 0;
  for (let i = 0; i < samples; i += 1) {
    const angle = (i / samples) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let hit = false;
    for (const dr of [0, -1, 1]) {
      if (inkAt(dark, width, height, cx + (r + dr) * cos, cy + (r * aspect + dr) * sin)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      hits += 1;
      if (quadrants) quadrants[Math.floor((i / samples) * 4)]! += 1;
    } else {
      misses += 1;
      if (misses > maxMisses) return hits / samples;
    }
  }
  return hits / samples;
}

/**
 * Searches a window for circle outlines of radius rMin..rMax (pixels). A circle must have a mostly
 * continuous outline, must not sit inside a solid area, and must not be a filled blob.
 */
export function findRingsNear(
  masks: InkMasks,
  window: { x0: number; y0: number; x1: number; y1: number },
  rMin: number,
  rMax: number,
  step = Math.max(1, Math.round(rMin / 4)),
): RingMark[] {
  const samples = 28;
  const candidates: Array<RingMark & { score: number }> = [];
  const rStep = Math.max(1, rMin / 4);
  const x0 = Math.max(0, Math.floor(window.x0));
  const y0 = Math.max(0, Math.floor(window.y0));
  const x1 = Math.min(masks.width - 1, Math.ceil(window.x1));
  const y1 = Math.min(masks.height - 1, Math.ceil(window.y1));
  for (let cy = y0; cy <= y1; cy += step) {
    for (let cx = x0; cx <= x1; cx += step) {
      for (let r = rMin; r <= rMax; r += rStep) {
        // Heads may be drawn as slightly flattened or stretched circles (non-uniformly scaled blocks).
        for (const aspect of [1, 0.8, 1.25]) {
          const quadrants = [0, 0, 0, 0];
          const coverage = ringCoverage(masks, cx, cy, r, samples, Math.floor(samples * 0.25), quadrants, aspect);
          if (coverage < 0.75 || quadrants.some((count) => count < (samples / 4) * 0.5)) continue;
          // A drawn circle is a thin outline: little ink just inside or just outside it.
          const outer = ringCoverage(masks, cx, cy, r * 1.35 + 1, 24, 24, undefined, aspect);
          if (outer > 0.45) continue;
          const inner = ringCoverage(masks, cx, cy, Math.max(1, r * 0.68 - 1), 20, 20, undefined, aspect);
          if (inner > 0.5) continue;
          candidates.push({ x: cx, y: cy, r: aspect > 1 ? r * aspect : r, score: coverage - outer * 0.3 });
          break;
        }
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept: RingMark[] = [];
  for (const candidate of candidates) {
    if (kept.some((ring) => Math.hypot(ring.x - candidate.x, ring.y - candidate.y) < Math.max(ring.r, candidate.r) * 1.2)) continue;
    kept.push({ x: candidate.x, y: candidate.y, r: candidate.r });
  }
  return kept;
}

export interface RingChain {
  x0: number;
  x1: number;
  y: number;
  rings: RingMark[];
}

export function poolMasks(masks: InkMasks, factor: number): InkMasks {
  const width = Math.floor(masks.width / factor);
  const height = Math.floor(masks.height / factor);
  const any = new Uint8Array(width * height);
  const dark = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let a = 0;
      let d = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        const row = (y * factor + dy) * masks.width + x * factor;
        for (let dx = 0; dx < factor; dx += 1) {
          a |= masks.any[row + dx]!;
          d |= masks.dark[row + dx]!;
        }
      }
      any[y * width + x] = a;
      dark[y * width + x] = d;
    }
  }
  return { width, height, any, dark };
}

/** Integral image of the dark mask, used to skip empty areas quickly. */
function darkIntegral(masks: InkMasks): Uint32Array {
  const { width, height, dark } = masks;
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += dark[y * width + x]!;
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1]! + rowSum;
    }
  }
  return integral;
}

function boxSum(integral: Uint32Array, width: number, x0: number, y0: number, x1: number, y1: number): number {
  const w = width + 1;
  return integral[y1 * w + x1]! - integral[y0 * w + x1]! - integral[y1 * w + x0]! + integral[y0 * w + x0]!;
}

/** Circle outlines anywhere in the image (radius rMin..rMax pixels). */
export function findRings(masks: InkMasks, rMin: number, rMax: number): RingMark[] {
  const integral = darkIntegral(masks);
  const { width, height } = masks;
  const minInk = Math.PI * 2 * rMin * 0.7;
  const pad = Math.ceil(rMax * 1.4) + 2;
  const step = Math.max(2, Math.round(rMin / 4));
  const centres: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const cell = Math.max(8, Math.round(rMax));
  for (let y = pad; y < height - pad; y += cell) {
    for (let x = pad; x < width - pad; x += cell) {
      const x0 = Math.max(0, x - Math.ceil(rMax) - 1);
      const y0 = Math.max(0, y - Math.ceil(rMax) - 1);
      const x1 = Math.min(width, x + cell + Math.ceil(rMax) + 1);
      const y1 = Math.min(height, y + cell + Math.ceil(rMax) + 1);
      if (boxSum(integral, width, x0, y0, x1, y1) < minInk) continue;
      centres.push({ x0: x, y0: y, x1: Math.min(width - pad, x + cell - 1), y1: Math.min(height - pad, y + cell - 1) });
    }
  }
  const all: RingMark[] = [];
  for (const area of centres) {
    for (const ring of findRingsNear(masks, area, rMin, rMax, step)) all.push(ring);
  }
  const kept: RingMark[] = [];
  for (const ring of all) {
    if (kept.some((other) => Math.hypot(other.x - ring.x, other.y - ring.y) < Math.max(other.r, ring.r) * 1.2)) continue;
    kept.push(ring);
  }
  return kept;
}

/** Rows of two or more touching circles of similar size: the head assembly of a drawn signal. */
export function groupRingChains(rings: RingMark[]): RingChain[] {
  const sorted = rings.slice().sort((a, b) => a.x - b.x);
  const parent = sorted.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      const sum = a.r + b.r;
      if (b.x - a.x > sum * 2.6) break;
      const ratio = Math.max(a.r, b.r) / Math.min(a.r, b.r);
      // Touching neighbours, or separated by a short stem (e.g. a "P" marker or junction indicator).
      if (Math.abs(a.y - b.y) <= 0.3 * Math.min(a.r, b.r) + 1 && b.x - a.x >= sum * 0.7 && b.x - a.x <= sum * 2.4 && ratio <= 2.2) {
        parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map<number, RingMark[]>();
  sorted.forEach((ring, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), ring]);
  });
  const chains: RingChain[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const big = members.filter((ring) => ring.r >= Math.max(...members.map((m) => m.r)) * 0.75);
    if (big.length < 2 && members.length < 3) continue;
    chains.push({
      x0: Math.min(...members.map((ring) => ring.x - ring.r)),
      x1: Math.max(...members.map((ring) => ring.x + ring.r)),
      y: members.reduce((sum, ring) => sum + ring.y, 0) / members.length,
      rings: members,
    });
  }
  return chains;
}

const SIGNAL_LABEL_RE = /^[([]?\d{1,3}\s*(?:I?\s*D|[A-Z])?[)\]]?$/i;

export function isSignalLabelCandidate(text: string): boolean {
  return SIGNAL_LABEL_RE.test(text.trim()) && !/T$/i.test(text.trim());
}

/**
 * Symbol analysis for one rendered tile. `h` is the typical text glyph height in pixels; `wordBoxes`
 * are confidently read words whose letters (e.g. "OO" in LOOP) must not be mistaken for signal heads.
 */
export function analyzeTileSymbols(
  image: RasterImage,
  h: number,
  wordBoxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [],
): { bands: TrackBand[]; rings: RingMark[]; chains: RingChain[] } {
  const masks = buildInkMasks(image);
  const bands = detectTrackBands(masks);
  const unit = Math.max(8, h);
  // Circle search runs on a 2x OR-pooled mask (thin outlines survive) for speed.
  const factor = unit >= 16 ? 2 : 1;
  const small = factor === 1 ? masks : poolMasks(masks, factor);
  const rings = findRings(small, Math.max(3, (0.45 * unit) / factor), Math.max(5, (0.95 * unit) / factor))
    .map((ring) => ({ x: ring.x * factor + (factor - 1) / 2, y: ring.y * factor + (factor - 1) / 2, r: ring.r * factor }))
    // Confirm each candidate at full resolution (pooling thickens small boxes into ring-like shapes).
    .flatMap((ring) => {
      if (factor === 1) return [ring];
      const confirmed = findRingsNear(
        masks,
        { x0: ring.x - 2 * factor, y0: ring.y - 2 * factor, x1: ring.x + 2 * factor, y1: ring.y + 2 * factor },
        Math.max(3, ring.r * 0.8),
        ring.r * 1.2,
        1,
      );
      return confirmed.length ? [confirmed[0]!] : [];
    })
    // Tag triangles and joints sitting on a running line are not signal heads.
    .filter((ring) => !bands.some((band) => band.thickness >= 3 && Math.abs(ring.y - band.y) <= band.thickness / 2 + ring.r && ring.x >= band.x0 - ring.r && ring.x <= band.x1 + ring.r))
    .filter((ring) => !wordBoxes.some((box) => ring.x >= box.x0 && ring.x <= box.x1 && ring.y >= box.y0 && ring.y <= box.y1));
  const chains = groupRingChains(rings);
  return { bands, rings: chains.flatMap((chain) => chain.rings), chains };
}

export interface TrackConnector {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Morphological opening with a (2k+1)² square: keeps thick strokes (track bands, turnout legs) only. */
function openMask(mask: Uint8Array, width: number, height: number, k: number): Uint8Array {
  const pass = (src: Uint8Array, horizontal: boolean, keepIfAll: boolean): Uint8Array => {
    const out = new Uint8Array(src.length);
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;
    for (let o = 0; o < outer; o += 1) {
      // Running count of ink in the window along the inner axis.
      let count = 0;
      const at = (i: number) => (horizontal ? o * width + i : i * width + o);
      for (let i = 0; i < Math.min(inner, k); i += 1) count += src[at(i)]!;
      for (let i = 0; i < inner; i += 1) {
        if (i + k < inner) count += src[at(i + k)]!;
        if (i - k - 1 >= 0) count -= src[at(i - k - 1)]!;
        const span = Math.min(inner - 1, i + k) - Math.max(0, i - k) + 1;
        out[at(i)] = keepIfAll ? (count === span ? 1 : 0) : (count > 0 ? 1 : 0);
      }
    }
    return out;
  };
  const eroded = pass(pass(mask, true, true), false, true);
  return pass(pass(eroded, true, false), false, false);
}

/**
 * Finds turnout legs: thick drawn strokes that leave one running line and join another. `h` is the
 * label glyph height in pixels. Coordinates are returned in image pixels (start on one line, end on the
 * other). A leg split by a boxed tag drawn on it is joined back together when its halves almost meet.
 */
export function detectTrackConnectors(image: RasterImage, h: number): TrackConnector[] {
  const masks = buildInkMasks(image);
  const { width, height } = masks;
  // Bands are found in narrow vertical strips so a slightly skewed scan still gives thin, local bands.
  const bands: TrackBand[] = [];
  const stripW = Math.max(200, Math.round(30 * h));
  for (let sx = 0; sx < width; sx += Math.round(stripW * 0.75)) {
    const sw = Math.min(stripW, width - sx);
    if (sw < stripW * 0.4 && sx > 0) break;
    const sub = new Uint8Array(sw * height);
    for (let y = 0; y < height; y += 1) sub.set(masks.any.subarray(y * width + sx, y * width + sx + sw), y * sw);
    for (const band of detectTrackBands({ width: sw, height, any: sub, dark: sub }, Math.min(Math.round(sw * 0.6), Math.max(40, Math.round(8 * h))))) {
      if (band.thickness >= 0.35 * h && band.thickness <= 2.6 * h) bands.push({ ...band, x0: band.x0 + sx, x1: band.x1 + sx });
    }
  }
  if (bands.length < 2) return [];
  const thicknesses = bands.map((band) => band.thickness).sort((a, b) => a - b);
  const typical = thicknesses[Math.floor(thicknesses.length * 0.25)]!;
  const k = typical >= 5 ? Math.max(1, Math.floor(typical * 0.3)) : 0;
  const thick = k ? openMask(masks.any, width, height, k) : masks.any.slice();

  // Legs often end in a short stub drawn just beside the other line rather than touching it, so the
  // contact zone extends a little above and below each band.
  const bandOf = new Int16Array(width * height).fill(-1);
  const reach = Math.round(0.9 * h);
  bands.forEach((band, index) => {
    const y0 = Math.max(0, Math.floor(band.y - band.thickness / 2 - 1));
    const y1 = Math.min(height - 1, Math.ceil(band.y + band.thickness / 2 + 1));
    const x0 = Math.max(0, Math.floor(band.x0));
    const x1 = Math.min(width - 1, Math.ceil(band.x1));
    for (let y = Math.max(0, y0 - reach); y <= Math.min(height - 1, y1 + reach); y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (bandOf[y * width + x]! < 0 || (y >= y0 && y <= y1)) bandOf[y * width + x] = index;
        if (y >= y0 && y <= y1) thick[y * width + x] = 0;
      }
    }
  });

  interface Piece { count: number; x0: number; y0: number; x1: number; y1: number; touches: Map<number, { sx: number; sy: number; n: number }> }
  const pieces: Piece[] = [];
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const minCount = Math.max(12, typical * typical * 1.5);
  for (let start = 0; start < thick.length; start += 1) {
    if (!thick[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    const piece: Piece = { count: 0, x0: width, y0: height, x1: 0, y1: 0, touches: new Map() };
    while (head < tail) {
      const p = queue[head++]!;
      const x = p % width;
      const y = (p - x) / width;
      piece.count += 1;
      if (x < piece.x0) piece.x0 = x;
      if (x > piece.x1) piece.x1 = x;
      if (y < piece.y0) piece.y0 = y;
      if (y > piece.y1) piece.y1 = y;
      for (let dy = -2; dy <= 2; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -2; dx <= 2; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          const band = bandOf[q]!;
          if (band >= 0) {
            const touch = piece.touches.get(band) ?? { sx: 0, sy: 0, n: 0 };
            touch.sx += x; touch.sy += y; touch.n += 1;
            piece.touches.set(band, touch);
          }
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && thick[q] && !seen[q]) {
            seen[q] = 1;
            queue[tail++] = q;
          }
        }
      }
    }
    // A turnout leg is a compact stroke; long or huge pieces are undetected lines, frames or fills.
    if (piece.count >= minCount && piece.touches.size > 0 && piece.x1 - piece.x0 <= 40 * h && piece.y1 - piece.y0 <= 30 * h) pieces.push(piece);
  }

  const touchPoint = (piece: Piece, band: number) => {
    const t = piece.touches.get(band)!;
    return { x: t.sx / t.n, y: bands[band]!.y };
  };
  const out: TrackConnector[] = [];
  const add = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    if (Math.abs(a.y - b.y) < 2 * h) return;
    if (out.some((c) => Math.hypot(c.x1 - a.x, c.y1 - a.y) < 2 * h && Math.hypot(c.x2 - b.x, c.y2 - b.y) < 2 * h)) return;
    out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  };
  const single: Array<{ piece: Piece; band: number }> = [];
  for (const piece of pieces) {
    const touched = Array.from(piece.touches.keys());
    const distinct = touched.filter((band, i) => !touched.slice(0, i).some((other) => Math.abs(bands[other]!.y - bands[band]!.y) < 2 * h));
    if (distinct.length >= 2) {
      for (let i = 0; i < distinct.length; i += 1) {
        for (let j = i + 1; j < distinct.length; j += 1) {
          const gap = Math.abs(bands[distinct[i]!]!.y - bands[distinct[j]!]!.y);
          if (piece.y1 - piece.y0 >= 0.45 * gap) add(touchPoint(piece, distinct[i]!), touchPoint(piece, distinct[j]!));
        }
      }
    } else if (piece.y1 - piece.y0 >= 0.8 * h) {
      single.push({ piece, band: distinct[0]! });
    }
  }
  // Halves of one leg separated by a tag box drawn across it.
  for (let i = 0; i < single.length; i += 1) {
    for (let j = i + 1; j < single.length; j += 1) {
      const a = single[i]!;
      const b = single[j]!;
      if (Math.abs(bands[a.band]!.y - bands[b.band]!.y) < 2 * h) continue;
      const gapX = Math.max(0, Math.max(a.piece.x0, b.piece.x0) - Math.min(a.piece.x1, b.piece.x1));
      const gapY = Math.max(0, Math.max(a.piece.y0, b.piece.y0) - Math.min(a.piece.y1, b.piece.y1));
      if (Math.hypot(gapX, gapY) > 2.5 * h) continue;
      add(touchPoint(a.piece, a.band), touchPoint(b.piece, b.band));
    }
  }
  return out;
}
