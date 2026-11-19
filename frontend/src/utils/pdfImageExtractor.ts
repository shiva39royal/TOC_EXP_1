// @ts-nocheck -- ported from the original app (written for a looser TS config)
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { LayoutToken } from "../engine/offlineExtractor";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfRenderedCrop {
  mimeType: "image/jpeg" | "image/png";
  data: string;
  role?: "overview" | "detail";
  region?: { x: number; y: number; width: number; height: number };
}

/**
 * Finds the tight vertical bounding box of non-white ink on an overview canvas
 * so huge empty plot margins (common on Indian Railways CAD rolls) are trimmed
 * before zooming into high-DPI tiles.
 */
export interface ActiveBounds {
  topFrac: number;
  bottomFrac: number;
  leftFrac: number;
  rightFrac: number;
}

function rotationForContent(bounds: ActiveBounds, width: number, height: number): 0 | 270 {
  const contentW = (bounds.rightFrac - bounds.leftFrac) * width;
  const contentH = (bounds.bottomFrac - bounds.topFrac) * height;
  return contentH > contentW * 1.25 ? 270 : 0;
}

export function detectActiveBounds(canvas: HTMLCanvasElement): ActiveBounds {
  const full = { topFrac: 0, bottomFrac: 1, leftFrac: 0, rightFrac: 1 };
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return full;

  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height).data;
  const stepX = Math.max(1, Math.floor(width / 400));
  const stepY = Math.max(1, Math.floor(height / 400));
  const isInk = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    return img[idx]! < 215 || img[idx + 1]! < 215 || img[idx + 2]! < 215;
  };

  let firstInkRow = height;
  let lastInkRow = -1;
  let firstInkCol = width;
  let lastInkCol = -1;
  for (let y = 0; y < height; y += 2) {
    let darkPixels = 0;
    for (let x = 0; x < width; x += stepX) {
      if (isInk(x, y)) {
        darkPixels++;
        if (x < firstInkCol) firstInkCol = x;
        if (x > lastInkCol) lastInkCol = x;
        if (darkPixels >= 4) break;
      }
    }
    if (darkPixels >= 4) {
      if (y < firstInkRow) firstInkRow = y;
      if (y > lastInkRow) lastInkRow = y;
    }
  }
  // Sample columns as well: a row can reach its four-pixel threshold before the true left/right ink edge.
  for (let x = 0; x < width; x += 2) {
    let darkPixels = 0;
    for (let y = 0; y < height; y += stepY) if (isInk(x, y)) darkPixels++;
    if (darkPixels >= 4) {
      if (x < firstInkCol) firstInkCol = x;
      if (x > lastInkCol) lastInkCol = x;
    }
  }

  if (lastInkRow <= firstInkRow + 8 || lastInkCol <= firstInkCol + 8) return full;
  const topFrac = Math.max(0, firstInkRow / height - 0.02);
  const bottomFrac = Math.min(1, lastInkRow / height + 0.02);
  const leftFrac = Math.max(0, firstInkCol / width - 0.01);
  const rightFrac = Math.min(1, lastInkCol / width + 0.01);
  // A valid drawing can occupy a very thin strip of a large plotter page; keep those bounds.
  return { topFrac, bottomFrac, leftFrac, rightFrac };
}

export async function detectPdfPageRotation(page: pdfjsLib.PDFPageProxy): Promise<0 | 270> {
  const rawVp = page.getViewport({ scale: 1 });
  const probeScale = Math.min(1, 1200 / Math.max(1, rawVp.width, rawVp.height));
  const probeVp = page.getViewport({ scale: probeScale });
  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = Math.max(1, Math.floor(probeVp.width));
  probeCanvas.height = Math.max(1, Math.floor(probeVp.height));
  await page.render({ canvas: probeCanvas, viewport: probeVp, background: "#ffffff" }).promise;
  return rotationForContent(detectActiveBounds(probeCanvas), probeCanvas.width, probeCanvas.height);
}

export interface PdfUploadPackage {
  crops: PdfRenderedCrop[];
  extractedText: string;
  textTokens: LayoutToken[];
  pageCount: number;
}

/**
 * Renders an uploaded PDF's page(s) into upright horizontal high-resolution
 * JPEG overview + overlapping tiled detail strips + title block crops, and
 * extracts vector text items with sheet coordinates in a single pass.
 * Content orientation is detected from actual ink bounds, so horizontal drawings remain
 * upright even on tall plotter pages with large empty margins.
 */
export async function preparePdfUploadPackage(base64Pdf: string): Promise<PdfUploadPackage> {
  const binStr = atob(base64Pdf);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }

  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const doc = await loadingTask.promise;

  try {
    const crops: PdfRenderedCrop[] = [];
    const pageCount = doc.numPages;
    const allTokens: LayoutToken[] = [];

    for (let p = 1; p <= Math.min(4, pageCount); p++) {
      const page = await doc.getPage(p);
      // Page dimensions alone are misleading: rotate from the drawing's actual ink bounds.
      const autoRot = await detectPdfPageRotation(page);
      const baseVp = page.getViewport({ scale: 1, rotation: autoRot });
      try {
        const tc = await page.getTextContent();
        for (const item of tc.items) {
          if (!("str" in item)) continue;
          const str = String(item.str || "")
            .replace(/\s+/g, " ")
            .trim();
          if (!str) continue;
          const tr = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
          const point = baseVp.convertToViewportPoint(Number(tr[4] ?? 0), Number(tr[5] ?? 0));
          allTokens.push({
            page: p,
            text: str,
            x: point[0] / Math.max(1, baseVp.width),
            y: point[1] / Math.max(1, baseVp.height),
            width: Math.abs(Number(item.width ?? 0)) / Math.max(1, baseVp.width),
            height: Math.abs(Number(item.height ?? 0)) / Math.max(1, baseVp.height),
            confidence: 100,
          });
        }
      } catch {
        // Ignore font/text extraction edge cases
      }

      if (p > Math.min(2, pageCount)) continue;

      // 1) Upright Overview JPEG, bounded in both dimensions for very tall plotter PDFs.
      const ovScale = Math.min(
        2.5,
        Math.max(
          0.05,
          Math.min(2000 / Math.max(1, baseVp.width), 2400 / Math.max(1, baseVp.height)),
        ),
      );
      const ovVp = page.getViewport({ scale: ovScale, rotation: autoRot });
      const ovCanvas = document.createElement("canvas");
      ovCanvas.width = Math.max(1, Math.floor(ovVp.width));
      ovCanvas.height = Math.max(1, Math.floor(ovVp.height));
      await page.render({ canvas: ovCanvas, viewport: ovVp, background: "#ffffff" }).promise;

      const { topFrac, bottomFrac, leftFrac, rightFrac } = detectActiveBounds(ovCanvas);

      // Export the active drawing, not the empty plotter margins, on both axes.
      const activeTopPx = Math.floor(topFrac * ovCanvas.height);
      const activeBotPx = Math.ceil(bottomFrac * ovCanvas.height);
      const activeLeftPx = Math.floor(leftFrac * ovCanvas.width);
      const activeRightPx = Math.ceil(rightFrac * ovCanvas.width);
      const trimmedOv = document.createElement("canvas");
      trimmedOv.width = Math.max(1, activeRightPx - activeLeftPx);
      trimmedOv.height = Math.max(1, activeBotPx - activeTopPx);
      const tCtx = trimmedOv.getContext("2d");
      if (tCtx) {
        tCtx.fillStyle = "#ffffff";
        tCtx.fillRect(0, 0, trimmedOv.width, trimmedOv.height);
        tCtx.drawImage(
          ovCanvas,
          activeLeftPx,
          activeTopPx,
          trimmedOv.width,
          trimmedOv.height,
          0,
          0,
          trimmedOv.width,
          trimmedOv.height,
        );
        crops.push({
          mimeType: "image/jpeg",
          data: trimmedOv.toDataURL("image/jpeg", 0.85).split(",")[1],
          role: "overview",
          region: {
            x: leftFrac,
            y: topFrac,
            width: rightFrac - leftFrac,
            height: bottomFrac - topFrac,
          },
        });
      }

      // 2) For page 1, render high-DPI tiled detail strips via viewport offset clipping
      // (avoids allocating massive 10000px canvases while achieving crystal-clear label OCR)
      if (p === 1) {
        const targetLongWidth = Math.min(
          14000,
          Math.max(7200, Math.max(baseVp.width, baseVp.height) * 2.2),
        );
        const hiScale = Math.min(5.0, Math.max(1.2, targetLongWidth / Math.max(1, baseVp.width)));
        const fullHiW = baseVp.width * hiScale;
        const fullHiH = baseVp.height * hiScale;

        const bandY0 = topFrac * fullHiH;
        const bandH = Math.max(300, (bottomFrac - topFrac) * fullHiH);
        const bandX0 = leftFrac * fullHiW;
        const bandW = Math.max(300, (rightFrac - leftFrac) * fullHiW);

        const renderTile = async (
          rx: number,
          ry: number,
          rw: number,
          rh: number,
          maxOutPx = 2100,
        ) => {
          const clampRatio = Math.min(1, maxOutPx / Math.max(1, rw, rh));
          const effScale = hiScale * clampRatio;
          const tileW = Math.max(1, Math.round(rw * clampRatio));
          const tileH = Math.max(1, Math.round(rh * clampRatio));

          const tileCanvas = document.createElement("canvas");
          tileCanvas.width = tileW;
          tileCanvas.height = tileH;

          const tileVp = page.getViewport({
            scale: effScale,
            rotation: autoRot,
            offsetX: -rx * clampRatio,
            offsetY: -ry * clampRatio,
          });

          await page.render({ canvas: tileCanvas, viewport: tileVp, background: "#ffffff" })
            .promise;
          crops.push({
            mimeType: "image/jpeg",
            data: tileCanvas.toDataURL("image/jpeg", 0.86).split(",")[1],
            role: "detail",
            region: {
              x: rx / Math.max(1, fullHiW),
              y: ry / Math.max(1, fullHiH),
              width: rw / Math.max(1, fullHiW),
              height: rh / Math.max(1, fullHiH),
            },
          });
        };

        const isVeryWideRoll = bandW > bandH * 4;
        const stripW = bandW * (isVeryWideRoll ? 0.175 : 0.21);
        const needBandSplit = bandH > stripW * 1.15;
        const corrBandH = needBandSplit ? bandH * 0.74 : bandH;

        // Overlapping horizontal corridor strips covering 100% of the yard/section left-to-right
        const xFracs = isVeryWideRoll
          ? [0.0, 0.145, 0.285, 0.42, 0.555, 0.69, 0.825]
          : [0.0, 0.16, 0.32, 0.48, 0.64, 0.79];

        for (const xf of xFracs) {
          const rx = bandX0 + Math.min(Math.max(0, xf * bandW), Math.max(0, bandW - stripW));
          await renderTile(rx, bandY0, stripW, corrBandH, 2200);
        }

        // Dedicated zoomed Bottom-Right Title Block & RFID Allocation Table crop
        const tbW = bandW * (needBandSplit ? 0.38 : 0.34);
        const tbH = bandH * 0.52;
        await renderTile(bandX0 + Math.max(0, bandW - tbW), bandY0 + bandH - tbH, tbW, tbH, 1850);

        // Dedicated zoomed Bottom-Left Title Block & Notes crop
        await renderTile(bandX0, bandY0 + bandH - tbH, tbW, tbH, 1850);
      }
    }

    allTokens.sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      if (Math.abs(a.y - b.y) > 0.003) return a.y - b.y;
      return a.x - b.x;
    });
    const extractedText = allTokens
      .slice(0, 1600)
      .map((t) => `${t.text} @(p${t.page},${Math.round(t.x * 10000)},${Math.round(t.y * 10000)})`)
      .join(" | ");

    return { crops, extractedText, textTokens: allTokens, pageCount };
  } finally {
    void loadingTask.destroy();
  }
}

export const __pdfGeometryInternals = { rotationForContent };

export async function renderPdfHighResCrops(base64Pdf: string): Promise<PdfRenderedCrop[]> {
  const pkg = await preparePdfUploadPackage(base64Pdf);
  return pkg.crops;
}
