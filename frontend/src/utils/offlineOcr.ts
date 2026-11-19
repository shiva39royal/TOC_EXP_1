import { createScheduler, createWorker, OEM, PSM, type Scheduler, type Worker } from "tesseract.js";
import * as pdfjsLib from "pdfjs-dist";
import type { LayoutToken } from "../engine/offlineExtractor";
import {
  analyzeTileSymbols,
  detectTrackConnectors,
  isSignalLabelCandidate,
} from "../engine/drawingSymbols";
import { detectActiveBounds, detectPdfPageRotation } from "./pdfImageExtractor";

/**
 * Fully local drawing reader. Renders the drawing's active area at a resolution where labels are
 * ~25px tall, cuts it into overlapping tiles and reads each tile three ways (as drawn, rotated for
 * vertical labels, and rotated with long drawing lines removed). It also detects running-line bands
 * and signal-head circles. Coordinates are returned in PDF points of the upright page.
 */

const TARGET_LONG_SIDE = 9000;
const TILE = 2000;
const OVERLAP = 220;
const OCR_ASSETS = {
  workerPath: "/tesseract/worker.min.js",
  corePath: "/tesseract/tesseract-core-lstm.wasm.js",
  langPath: "/tesseract",
  gzip: true,
  cacheMethod: "none" as const,
};

let schedulerPromise: Promise<Scheduler> | null = null;
let labelWorkerPromise: Promise<Worker> | null = null;

function workerCount(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(3, cores - 1));
}

function getScheduler(): Promise<Scheduler> {
  if (!schedulerPromise) {
    schedulerPromise = (async () => {
      const scheduler = createScheduler();
      const workers = await Promise.all(
        Array.from({ length: workerCount() }, async () => {
          const worker = await createWorker("eng", OEM.LSTM_ONLY, OCR_ASSETS);
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SPARSE_TEXT,
            user_defined_dpi: "300",
          });
          return worker;
        }),
      );
      for (const worker of workers) scheduler.addWorker(worker);
      return scheduler;
    })().catch((error) => {
      schedulerPromise = null;
      throw error;
    });
  }
  return schedulerPromise;
}

function getLabelWorker(): Promise<Worker> {
  if (!labelWorkerPromise) {
    labelWorkerPromise = (async () => {
      const worker = await createWorker("eng", OEM.LSTM_ONLY, OCR_ASSETS);
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ -./()[]",
        user_defined_dpi: "300",
      });
      return worker;
    })().catch((error) => {
      labelWorkerPromise = null;
      throw error;
    });
  }
  return labelWorkerPromise;
}

interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

function wordsFromResult(data: unknown): OcrWord[] {
  const page = data as {
    blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: OcrWord[] }> }> }> | null;
  };
  return (page.blocks ?? []).flatMap((block) =>
    (block.paragraphs ?? []).flatMap((paragraph) =>
      (paragraph.lines ?? []).flatMap((line) => line.words ?? []),
    ),
  );
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Rotates 90° clockwise so bottom-to-top labels read left-to-right. */
function rotateClockwise(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = makeCanvas(source.height, source.width);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(Math.PI / 2);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

/** Grey copy with long horizontal/vertical strokes (tracks, leaders, dimension lines) removed. */
function withoutLongLines(image: ImageData, minRun: number): HTMLCanvasElement {
  const { width, height, data } = image;
  const ink = new Uint8Array(width * height);
  const grey = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < ink.length; i += 1, p += 4) {
    const r = data[p]!;
    const g = data[p + 1]!;
    const b = data[p + 2]!;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    grey[i] = Math.min(255, Math.round(lum));
    if (lum < 205 || (sat > 55 && lum < 242)) ink[i] = 1;
  }
  const remove = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    let start = -1;
    for (let x = 0; x <= width; x += 1) {
      const on = x < width && ink[y * width + x] === 1;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= minRun) for (let k = start; k < x; k += 1) remove[y * width + k] = 1;
        start = -1;
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    let start = -1;
    for (let y = 0; y <= height; y += 1) {
      const on = y < height && ink[y * width + x] === 1;
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        if (y - start >= minRun) for (let k = start; k < y; k += 1) remove[k * width + x] = 1;
        start = -1;
      }
    }
  }
  // Label boxes: short vertical sides whose ends meet a removed horizontal edge are frame, not text.
  for (let x = 0; x < width; x += 1) {
    let start = -1;
    for (let y = 0; y <= height; y += 1) {
      const on = y < height && ink[y * width + x] === 1 && !remove[y * width + x];
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        const touches = (yy: number) =>
          yy >= 0 &&
          yy < height &&
          [-2, -1, 0, 1, 2].some(
            (dx) => x + dx >= 0 && x + dx < width && remove[yy * width + x + dx] === 1,
          );
        if (
          y - start >= 8 &&
          (touches(start - 1) || touches(start - 2)) &&
          (touches(y) || touches(y + 1))
        ) {
          for (let k = start; k < y; k += 1) {
            for (const dx of [-1, 0, 1])
              if (x + dx >= 0 && x + dx < width) remove[k * width + x + dx] = 1;
          }
        }
        start = -1;
      }
    }
  }
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d")!;
  const out = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const near =
        remove[i] ||
        (x > 0 && remove[i - 1]) ||
        (x < width - 1 && remove[i + 1]) ||
        (y > 0 && remove[i - width]) ||
        (y < height - 1 && remove[i + width]);
      const value = ink[i] && !near ? grey[i]! : 255;
      const p = i * 4;
      out.data[p] = value;
      out.data[p + 1] = value;
      out.data[p + 2] = value;
      out.data[p + 3] = 255;
    }
  }
  context.putImageData(out, 0, 0);
  return canvas;
}

function spans(length: number): Array<[number, number]> {
  if (length <= TILE) return [[0, Math.ceil(length)]];
  const count = Math.ceil((length - OVERLAP) / (TILE - OVERLAP));
  const size = Math.ceil((length + OVERLAP * (count - 1)) / count);
  return Array.from({ length: count }, (_, index) => [
    Math.max(0, Math.min(index * (size - OVERLAP), Math.ceil(length) - size)),
    size,
  ]);
}

interface TilePixelWord {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  vertical: boolean;
  hint?: "signal-label";
}

/** Converts a recognition result into tile-pixel boxes, dropping words cut by an inner tile edge. */
function tileWords(
  result: unknown,
  rotated: boolean,
  tileW: number,
  tileH: number,
  edges: { left: boolean; top: boolean; right: boolean; bottom: boolean },
): TilePixelWord[] {
  const out: TilePixelWord[] = [];
  for (const word of wordsFromResult(result)) {
    const text = word.text.replace(/\s+/g, " ").trim();
    if (!text || word.confidence < 20) continue;
    const { x0, y0, x1, y1 } = word.bbox;
    // Clockwise rotation maps original (x, y) to (tileH - y, x); invert it.
    const box = rotated ? { x0: y0, y0: tileH - x1, x1: y1, y1: tileH - x0 } : { x0, y0, x1, y1 };
    const e = 4;
    if (
      (edges.left && box.x0 < e) ||
      (edges.top && box.y0 < e) ||
      (edges.right && box.x1 > tileW - e) ||
      (edges.bottom && box.y1 > tileH - e)
    )
      continue;
    out.push({ text, confidence: word.confidence, ...box, vertical: rotated });
  }
  return out;
}

function median(values: number[], fallback: number): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : fallback;
}

function vectorTokens(
  items: unknown[],
  viewport: pdfjsLib.PageViewport,
  page: number,
): LayoutToken[] {
  const tokens: LayoutToken[] = [];
  for (const raw of items) {
    const item = raw as { str?: string; transform?: number[]; width?: number; height?: number };
    const text = String(item.str ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || !Array.isArray(item.transform)) continue;
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = item.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || Number(item.height) || 1;
    const dirLen = Math.hypot(a, b) || 1;
    const advance = Number(item.width) || text.length * size * 0.55;
    const ux = a / dirLen;
    const uy = b / dirLen;
    const vx = c / (Math.hypot(c, d) || 1);
    const vy = d / (Math.hypot(c, d) || 1);
    const corners = [
      [e, f],
      [e + ux * advance, f + uy * advance],
      [e + vx * size, f + vy * size],
      [e + ux * advance + vx * size, f + uy * advance + vy * size],
    ].map(([x, y]) => viewport.convertToViewportPoint(x!, y!));
    const xs = corners.map((p) => p[0]!);
    const ys = corners.map((p) => p[1]!);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    tokens.push({
      text,
      page,
      x: (Math.max(...xs) + Math.min(...xs)) / 2,
      y: (Math.max(...ys) + Math.min(...ys)) / 2,
      width,
      height,
      vertical: height > width * 1.2 && text.length > 1,
      confidence: 100,
      kind: "text",
    });
  }
  return tokens;
}

export function pdfNeedsLocalOcr(tokens: LayoutToken[]): boolean {
  const tagCount = tokens.filter((token) => /\bR\s*[-–—]?\s*\d{2,4}\b/i.test(token.text)).length;
  return tokens.length < 40 || tagCount < 4;
}

function dedupe(tokens: LayoutToken[]): LayoutToken[] {
  const kept: LayoutToken[] = [];
  const sorted = tokens.slice().sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  for (const token of sorted) {
    if (token.kind === "track" || token.kind === "link") {
      kept.push(token);
      continue;
    }
    const size = Math.max(token.width ?? 0, token.height ?? 0, 1);
    const duplicate = kept.some(
      (other) =>
        other.kind === token.kind &&
        other.page === token.page &&
        other.text.toUpperCase() === token.text.toUpperCase() &&
        Math.hypot(other.x - token.x, other.y - token.y) < size * 0.5,
    );
    if (!duplicate) kept.push(token);
  }
  return kept;
}

export interface LocalPdfReadResult {
  tokens: LayoutToken[];
  pageCount: number;
  summary: string;
  usedOcr: boolean;
}

export async function readPdfLocally(params: {
  base64Pdf: string;
  onProgress?: (label: string) => void;
}): Promise<LocalPdfReadResult> {
  const { base64Pdf, onProgress } = params;
  const binary = atob(base64Pdf);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const doc = await loadingTask.promise;
  try {
    const page = await doc.getPage(1);
    const rotation = await detectPdfPageRotation(page);
    const viewport = page.getViewport({ scale: 1, rotation });
    const vector = vectorTokens((await page.getTextContent()).items as unknown[], viewport, 1);
    const usedOcr = pdfNeedsLocalOcr(vector);

    // Locate the drawn area so empty plotter margins are not rendered.
    const probeScale = Math.min(1, 1600 / Math.max(viewport.width, viewport.height));
    const probe = makeCanvas(viewport.width * probeScale, viewport.height * probeScale);
    await page.render({
      canvas: probe,
      viewport: page.getViewport({ scale: probeScale, rotation }),
      background: "#ffffff",
    }).promise;
    const bounds = detectActiveBounds(probe);
    const ax0 = bounds.leftFrac * viewport.width;
    const ay0 = bounds.topFrac * viewport.height;
    const aw = Math.max(1, (bounds.rightFrac - bounds.leftFrac) * viewport.width);
    const ah = Math.max(1, (bounds.bottomFrac - bounds.topFrac) * viewport.height);
    const scale = Math.max(0.8, Math.min(12, TARGET_LONG_SIDE / Math.max(aw, ah)));
    const fullW = aw * scale;
    const fullH = ah * scale;

    const tiles = spans(fullH).flatMap(([ty, th]) =>
      spans(fullW).map(([tx, tw]) => ({
        tx,
        ty,
        tw: Math.min(tw, Math.ceil(fullW)),
        th: Math.min(th, Math.ceil(fullH)),
      })),
    );
    const scheduler = usedOcr ? await getScheduler() : null;
    const tokens: LayoutToken[] = [...vector];
    const toPt = (tx: number, ty: number, x: number, y: number) => ({
      x: ax0 + (tx + x) / scale,
      y: ay0 + (ty + y) / scale,
    });
    let done = 0;
    const glyphsPt: number[] = [];

    const processTile = async (tile: (typeof tiles)[number]) => {
      const canvas = makeCanvas(tile.tw, tile.th);
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      await page.render({
        canvas,
        viewport: page.getViewport({
          scale,
          rotation,
          offsetX: -(ax0 * scale + tile.tx),
          offsetY: -(ay0 * scale + tile.ty),
        }),
        background: "#ffffff",
      }).promise;
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const edges = {
        left: tile.tx > 0,
        top: tile.ty > 0,
        right: tile.tx + tile.tw < fullW - 1,
        bottom: tile.ty + tile.th < fullH - 1,
      };
      let words: TilePixelWord[] = [];
      if (scheduler) {
        const clean = withoutLongLines(image, 60);
        const [asDrawn, cleanFlat, vertical, verticalClean] = await Promise.all([
          scheduler.addJob("recognize", canvas, {}, { blocks: true, text: false }),
          scheduler.addJob("recognize", clean, {}, { blocks: true, text: false }),
          scheduler.addJob("recognize", rotateClockwise(canvas), {}, { blocks: true, text: false }),
          scheduler.addJob("recognize", rotateClockwise(clean), {}, { blocks: true, text: false }),
        ]);
        words = [
          ...tileWords(asDrawn.data, false, canvas.width, canvas.height, edges),
          ...tileWords(cleanFlat.data, false, canvas.width, canvas.height, edges),
          ...tileWords(vertical.data, true, canvas.width, canvas.height, edges),
          ...tileWords(verticalClean.data, true, canvas.width, canvas.height, edges),
        ];
      } else {
        // Vector text: express the tile's existing labels in tile pixels for symbol analysis.
        for (const token of vector) {
          const px = (token.x - ax0) * scale - tile.tx;
          const py = (token.y - ay0) * scale - tile.ty;
          if (px < 0 || py < 0 || px > tile.tw || py > tile.th) continue;
          const w = (token.width ?? 0) * scale;
          const h = (token.height ?? 0) * scale;
          words.push({
            text: token.text,
            confidence: 100,
            x0: px - w / 2,
            y0: py - h / 2,
            x1: px + w / 2,
            y1: py + h / 2,
            vertical: Boolean(token.vertical),
          });
        }
      }

      const horizontal = words.filter((w) => !w.vertical);
      const glyph = median(
        horizontal.filter((w) => /R\s*-?\s*\d{2,4}/i.test(w.text)).map((w) => w.y1 - w.y0),
        median(
          horizontal.map((w) => w.y1 - w.y0),
          24,
        ),
      );
      const pad = 0.3 * glyph;
      const wordBoxes = horizontal
        .filter(
          (w) =>
            w.confidence >= 75 && (/^[A-Z]{3,}$/.test(w.text) || /\d{2,}|R-\d|N-\d/.test(w.text)),
        )
        .map((w) => ({ x0: w.x0 - pad, y0: w.y0 - pad, x1: w.x1 + pad, y1: w.y1 + pad }));
      glyphsPt.push(glyph / scale);
      const symbols = analyzeTileSymbols(image, glyph, wordBoxes);

      // Single-digit signal numbers are often skipped by page-level reading. Re-read the small areas
      // above, below and beside every head row (heads blanked), one line of text at a time.
      if (scheduler) {
        const labelWorker = await getLabelWorker();
        for (const chain of symbols.chains) {
          const r = Math.max(...chain.rings.map((ring) => ring.r));
          const ux0 = Math.max(0, chain.x0 - 4.5 * glyph);
          const ux1 = Math.min(canvas.width, chain.x1 + 4.5 * glyph);
          const uy0 = Math.max(0, chain.y - r - 3 * glyph);
          const uy1 = Math.min(canvas.height, chain.y + r + 3 * glyph);
          const zoom = 2;
          const area = makeCanvas((ux1 - ux0) * zoom, (uy1 - uy0) * zoom);
          const areaContext = area.getContext("2d")!;
          areaContext.fillStyle = "#ffffff";
          areaContext.fillRect(0, 0, area.width, area.height);
          areaContext.drawImage(
            canvas,
            ux0,
            uy0,
            ux1 - ux0,
            uy1 - uy0,
            0,
            0,
            area.width,
            area.height,
          );
          areaContext.fillStyle = "#ffffff";
          for (const ring of chain.rings) {
            areaContext.beginPath();
            areaContext.ellipse(
              (ring.x - ux0) * zoom,
              (ring.y - uy0) * zoom,
              ring.r * zoom,
              ring.r * zoom,
              0,
              0,
              Math.PI * 2,
            );
            areaContext.fill();
          }
          areaContext.fillRect(
            (chain.x0 - ux0) * zoom - 2,
            (chain.y - uy0 - r * 0.25) * zoom,
            (chain.x1 - chain.x0) * zoom + 4,
            r * zoom * 0.5,
          );
          const regions = [
            {
              x0: chain.x0 - 1.5 * glyph,
              x1: chain.x1 + 1.5 * glyph,
              y0: chain.y - r - 2.6 * glyph,
              y1: chain.y - r + 0.2 * glyph,
            },
            {
              x0: chain.x0 - 1.5 * glyph,
              x1: chain.x1 + 1.5 * glyph,
              y0: chain.y + r - 0.2 * glyph,
              y1: chain.y + r + 2.6 * glyph,
            },
            {
              x0: chain.x0 - 4.2 * glyph,
              x1: chain.x0 + 0.2 * glyph,
              y0: chain.y - 1.3 * glyph,
              y1: chain.y + 1.3 * glyph,
            },
            {
              x0: chain.x1 - 0.2 * glyph,
              x1: chain.x1 + 4.2 * glyph,
              y0: chain.y - 1.3 * glyph,
              y1: chain.y + 1.3 * glyph,
            },
          ];
          for (const region of regions) {
            const rx0 = Math.max(ux0, region.x0);
            const rx1 = Math.min(ux1, region.x1);
            const ry0 = Math.max(uy0, region.y0);
            const ry1 = Math.min(uy1, region.y1);
            if (rx1 - rx0 < glyph || ry1 - ry0 < glyph * 0.8) continue;
            // A white margin helps single-line recognition.
            const pad = 12;
            const crop = makeCanvas((rx1 - rx0) * zoom + pad * 2, (ry1 - ry0) * zoom + pad * 2);
            const cropContext = crop.getContext("2d")!;
            cropContext.fillStyle = "#ffffff";
            cropContext.fillRect(0, 0, crop.width, crop.height);
            cropContext.drawImage(
              area,
              (rx0 - ux0) * zoom,
              (ry0 - uy0) * zoom,
              (rx1 - rx0) * zoom,
              (ry1 - ry0) * zoom,
              pad,
              pad,
              (rx1 - rx0) * zoom,
              (ry1 - ry0) * zoom,
            );
            const result = await labelWorker.recognize(crop, {}, { blocks: true, text: false });
            for (const word of wordsFromResult(result.data)) {
              const text = word.text.trim();
              if (!isSignalLabelCandidate(text) || word.confidence < 45) continue;
              const height = (word.bbox.y1 - word.bbox.y0) / zoom;
              if (height < glyph * 0.55 || height > glyph * 1.8) continue;
              words.push({
                text,
                confidence: Math.min(word.confidence, 92),
                x0: rx0 + (word.bbox.x0 - pad) / zoom,
                y0: ry0 + (word.bbox.y0 - pad) / zoom,
                x1: rx0 + (word.bbox.x1 - pad) / zoom,
                y1: ry0 + (word.bbox.y1 - pad) / zoom,
                vertical: false,
                hint: "signal-label",
              });
            }
          }
        }
      }

      if (scheduler) {
        for (const word of words) {
          const centre = toPt(tile.tx, tile.ty, (word.x0 + word.x1) / 2, (word.y0 + word.y1) / 2);
          tokens.push({
            text: word.text,
            page: 1,
            ...centre,
            width: (word.x1 - word.x0) / scale,
            height: (word.y1 - word.y0) / scale,
            confidence: word.confidence,
            vertical: word.vertical,
            kind: "text",
            ...(word.hint ? { hint: word.hint } : {}),
          });
        }
      }
      for (const band of symbols.bands) {
        const start = toPt(tile.tx, tile.ty, band.x0, band.y);
        tokens.push({
          text: "",
          kind: "track",
          page: 1,
          x: start.x,
          y: start.y,
          x2: ax0 + (tile.tx + band.x1) / scale,
          height: band.thickness / scale,
        });
      }
      for (const ring of symbols.rings) {
        const centre = toPt(tile.tx, tile.ty, ring.x, ring.y);
        tokens.push({
          text: "",
          kind: "ring",
          page: 1,
          ...centre,
          width: (2 * ring.r) / scale,
          height: (2 * ring.r) / scale,
        });
      }
      done += 1;
      onProgress?.(`2/3 Reading drawing locally — section ${done} of ${tiles.length}…`);
    };

    onProgress?.(
      `2/3 Reading drawing locally — ${tiles.length} sections${usedOcr ? ` on ${workerCount()} reader(s)` : ""}…`,
    );
    const batch = Math.max(1, workerCount());
    for (let index = 0; index < tiles.length; index += batch) {
      await Promise.all(tiles.slice(index, index + batch).map(processTile));
    }

    // Turnout legs between running lines, traced once on a whole-drawing render (a leg can cross tiles).
    onProgress?.("2/3 Tracing the track connections…");
    try {
      const lowScale = Math.min(1.5, 4500 / Math.max(aw, ah));
      const low = makeCanvas(aw * lowScale, ah * lowScale);
      const lowContext = low.getContext("2d", { willReadFrequently: true })!;
      await page.render({
        canvas: low,
        viewport: page.getViewport({
          scale: lowScale,
          rotation,
          offsetX: -ax0 * lowScale,
          offsetY: -ay0 * lowScale,
        }),
        background: "#ffffff",
      }).promise;
      const glyphPt = median(glyphsPt, 24 / scale);
      for (const leg of detectTrackConnectors(
        lowContext.getImageData(0, 0, low.width, low.height),
        glyphPt * lowScale,
      )) {
        tokens.push({
          text: "",
          kind: "link",
          page: 1,
          x: ax0 + leg.x1 / lowScale,
          y: ay0 + leg.y1 / lowScale,
          x2: ax0 + leg.x2 / lowScale,
          y2: ay0 + leg.y2 / lowScale,
        });
      }
    } catch {
      // Without traced legs, routes are limited to straight runs along one line.
    }

    const result = dedupe(tokens);
    const summary = result
      .filter((token) => !token.kind || token.kind === "text")
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .slice(0, 1600)
      .map((token) => `${token.text} @(${Math.round(token.x)},${Math.round(token.y)})`)
      .join(" | ");
    return { tokens: result, pageCount: doc.numPages, summary, usedOcr };
  } finally {
    void loadingTask.destroy();
  }
}
