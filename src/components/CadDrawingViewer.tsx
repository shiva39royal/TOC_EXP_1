// @ts-nocheck -- ported from the original app (written for a looser TS config)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IDxf } from 'dxf-parser';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Download,
  Layers,
  Loader2,
  Maximize2,
  Moon,
  RotateCw,
  Search,
  Sun,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { SourceLayoutAsset } from '../types/signalling';
import { detectPdfPageRotation } from '../utils/pdfImageExtractor';
import {
  extractDxfExtentsAndTexts,
  getDxfLayerInventory,
  renderDxfToCanvas,
  type DxfLayerSummary,
} from '../utils/dxfRenderer';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface CadDrawingViewerProps {
  sourceLayout?: SourceLayoutAsset;
  stationTitle: string;
}

const ZOOM_PRESETS = [
  { label: '50%', value: 0.5 },
  { label: '100%', value: 1 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2 },
  { label: '400%', value: 4 },
  { label: '600%', value: 6 },
  { label: '800%', value: 8 },
  { label: '1000%', value: 10 },
  { label: '1500%', value: 15 },
  { label: '2000%', value: 20 },
  { label: '2500%', value: 25 },
  { label: '3000%', value: 30 },
];

export const CadDrawingViewer: React.FC<CadDrawingViewerProps> = ({
  sourceLayout,
  stationTitle,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [canvasSize, setCanvasSize] = useState({ width: 960, height: 560 });
  const canvasSizeRef = useRef(canvasSize);
  canvasSizeRef.current = canvasSize;

  const [backgroundMode, setBackgroundMode] = useState<'white' | 'dark'>('white');
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [cursorCoords, setCursorCoords] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // DXF/DWG camera & UI state
  const [camera, setCamera] = useState<{ cx: number; cy: number; scale: number }>({
    cx: 500,
    cy: 250,
    scale: 1,
  });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const [fitBaselineScale, setFitBaselineScale] = useState<number>(1);
  const fitBaselineRef = useRef(fitBaselineScale);
  fitBaselineRef.current = fitBaselineScale;

  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [matchCursor, setMatchCursor] = useState(0);

  // PDF & CAD viewer state
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfPageNum, setPdfPageNum] = useState(1);
  const [pdfRotation, setPdfRotation] = useState<0 | 90 | 180 | 270>(0);
  const [cadRotation, setCadRotation] = useState<0 | 90 | 180 | 270>(0);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [pdfPan, setPdfPan] = useState({ x: 0, y: 0 });
  const [pdfBaseDims, setPdfBaseDims] = useState<{ width: number; height: number } | null>(null);
  const [isPdfRendering, setIsPdfRendering] = useState(false);

  const pdfBaseDimsRef = useRef(pdfBaseDims);
  pdfBaseDimsRef.current = pdfBaseDims;
  const backgroundModeRef = useRef(backgroundMode);
  backgroundModeRef.current = backgroundMode;
  const pdfPageNumRef = useRef(pdfPageNum);
  pdfPageNumRef.current = pdfPageNum;
  const pdfRotationRef = useRef(pdfRotation);
  pdfRotationRef.current = pdfRotation;
  const pdfZoomRef = useRef(pdfZoom);
  pdfZoomRef.current = pdfZoom;
  const pdfPanRef = useRef(pdfPan);
  pdfPanRef.current = pdfPan;

  // Dual-buffer offscreen canvases for 60fps pan/zoom + crisp vector refill on settle
  const pdfBaseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfCrispCanvasRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const pdfBaseTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const pdfHiResTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  const isPdf = sourceLayout?.kind === 'PDF';
  const isPdfRef = useRef(isPdf);
  isPdfRef.current = isPdf;

  const dxfData = useMemo(() => {
    if (!sourceLayout?.dxfData || isPdf) return null;
    return sourceLayout.dxfData as IDxf;
  }, [sourceLayout, isPdf]);

  const dxfLayers: DxfLayerSummary[] = useMemo(() => {
    if (!dxfData) return [];
    return getDxfLayerInventory(dxfData);
  }, [dxfData]);

  useEffect(() => {
    if (dxfLayers.length > 0) {
      const initial: Record<string, boolean> = {};
      for (const l of dxfLayers) {
        initial[l.name] = l.visible;
      }
      setVisibleLayers(initial);
    }
  }, [dxfLayers]);

  const dxfAnalysis = useMemo(() => {
    if (!dxfData) return null;
    return extractDxfExtentsAndTexts(dxfData, visibleLayers);
  }, [dxfData, visibleLayers]);

  const dxfMatches = useMemo(() => {
    if (!dxfAnalysis || !searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return dxfAnalysis.texts.filter((t) => t.text.toLowerCase().includes(q));
  }, [dxfAnalysis, searchQuery]);

  // Reset per-file state on layout change
  useEffect(() => {
    setSearchQuery('');
    setMatchCursor(0);
    setPdfPageNum(1);
    setPdfRotation(0);
    setCadRotation(0);
    setPdfZoom(1);
    setPdfPan({ x: 0, y: 0 });
    setPdfBaseDims(null);
    pdfBaseCanvasRef.current = null;
    pdfCrispCanvasRef.current = null;
  }, [sourceLayout]);

  const currentRotation = isPdf ? pdfRotation : cadRotation;
  const handleRotateLayout = useCallback(() => {
    if (isPdf) {
      setPdfRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270);
    } else {
      setCadRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270);
    }
  }, [isPdf]);

  // Measure viewport container reliably whenever sourceLayout becomes active
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = (wRaw: number, hRaw: number) => {
      const w = Math.max(320, Math.floor(wRaw));
      const h = Math.max(480, Math.floor(hRaw));
      setCanvasSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };

    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      updateSize(rect.width, rect.height);
    }

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateSize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sourceLayout, dxfData, isPdf]);

  // Load PDF document when sourceLayout is PDF
  useEffect(() => {
    if (!isPdf || !sourceLayout?.pdfBase64) {
      setPdfDoc(null);
      setPdfPageCount(0);
      return;
    }

    let cancelled = false;
    let activeTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

    const load = async () => {
      setIsPdfRendering(true);
      try {
        const binStr = atob(sourceLayout.pdfBase64!);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        activeTask = pdfjsLib.getDocument({ data: bytes });
        const doc = await activeTask.promise;
        if (cancelled) {
          void activeTask.destroy();
          return;
        }
        setPdfDoc(doc);
        setPdfPageCount(doc.numPages);
      } catch (err) {
        if (!cancelled) {
          console.error('PDF load error:', err);
          setIsPdfRendering(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (activeTask) {
        void activeTask.destroy();
      }
    };
  }, [isPdf, sourceLayout]);

  // Detect orientation for each displayed page; manual rotation remains available afterwards.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    const detect = async () => {
      try {
        const page = await pdfDoc.getPage(Math.min(Math.max(1, pdfPageNum), pdfDoc.numPages));
        const contentRotation = await detectPdfPageRotation(page);
        if (!cancelled) setPdfRotation(contentRotation);
      } catch {
        // Keep the current/manual rotation if content detection cannot render this page.
      }
    };
    void detect();
    return () => { cancelled = true; };
  }, [pdfDoc, pdfPageNum]);

  // Zoom-to-Fit helper
  const fitToView = useCallback(() => {
    if (isPdfRef.current) {
      setPdfZoom(1);
      setPdfPan({ x: 0, y: 0 });
      return;
    }
    if (!dxfAnalysis) return;
    const { extents } = dxfAnalysis;
    const size = canvasSizeRef.current;
    const pad = 0.92;
    const sx = (size.width * pad) / extents.width;
    const sy = (size.height * pad) / extents.height;
    const scale = Math.min(sx, sy);
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    setFitBaselineScale(safeScale);
    fitBaselineRef.current = safeScale;
    setCamera({
      cx: (extents.minX + extents.maxX) / 2,
      cy: (extents.minY + extents.maxY) / 2,
      scale: safeScale,
    });
  }, [dxfAnalysis]);

  // Auto-fit when a new DXF file finishes parsing
  useEffect(() => {
    if (dxfData && dxfAnalysis) {
      fitToView();
    }
  }, [dxfData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recompute baseline scale if canvas resizes while fitting
  useEffect(() => {
    if (!dxfAnalysis) return;
    const { extents } = dxfAnalysis;
    const sx = (canvasSize.width * 0.92) / extents.width;
    const sy = (canvasSize.height * 0.92) / extents.height;
    const safe = Math.min(sx, sy);
    if (Number.isFinite(safe) && safe > 0) {
      setFitBaselineScale((prev) => (Math.abs(prev - safe) < 1e-12 ? prev : safe));
    }
  }, [dxfAnalysis, canvasSize.width, canvasSize.height]);

  // Render DXF to canvas
  useEffect(() => {
    if (isPdf) return;
    const canvas = canvasRef.current;
    if (!canvas || !dxfData) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(canvasSize.width * dpr));
    canvas.height = Math.max(1, Math.floor(canvasSize.height * dpr));
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    if (cadRotation !== 0) {
      ctx.translate(canvasSize.width / 2, canvasSize.height / 2);
      ctx.rotate((cadRotation * Math.PI) / 180);
      ctx.translate(-canvasSize.width / 2, -canvasSize.height / 2);
    }

    renderDxfToCanvas({
      dxf: dxfData,
      ctx,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      viewCenterX: camera.cx,
      viewCenterY: camera.cy,
      pixelsPerWorldUnit: camera.scale,
      visibleLayers,
      darkTheme: backgroundMode === 'dark',
      searchQuery,
    });

    ctx.restore();
  }, [isPdf, dxfData, canvasSize, camera, visibleLayers, backgroundMode, searchQuery, cadRotation]);

  // Paint PDF viewport synchronously from cached high-res bitmap or settled native vector snapshot
  const paintPdfViewport = useCallback(() => {
    if (!isPdfRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const size = canvasSizeRef.current;
    const bgMode = backgroundModeRef.current;
    const pageNum = pdfPageNumRef.current;
    const rotation = pdfRotationRef.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const targetW = Math.max(1, Math.floor(size.width * dpr));
    const targetH = Math.max(1, Math.floor(size.height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bgMode === 'dark' ? '#0b1120' : '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    const viewKey = `${pageNum}|${rotation}|${bgMode}|${size.width}x${size.height}|${pdfZoomRef.current.toFixed(4)}|${Math.round(pdfPanRef.current.x)},${Math.round(pdfPanRef.current.y)}`;
    const crisp = pdfCrispCanvasRef.current;
    if (crisp && crisp.key === viewKey) {
      ctx.drawImage(crisp.canvas, 0, 0, targetW, targetH);
      ctx.restore();
      return;
    }

    const baseCanvas = pdfBaseCanvasRef.current;
    const dims = pdfBaseDimsRef.current;
    if (baseCanvas && dims) {
      const fitScale = Math.min(
        (size.width * 0.94) / Math.max(1, dims.width),
        (size.height * 0.94) / Math.max(1, dims.height)
      );
      const effectiveCssScale = Math.max(0.01, fitScale * pdfZoomRef.current);
      const pageW = dims.width * effectiveCssScale;
      const pageH = dims.height * effectiveCssScale;
      const leftCss = size.width / 2 + pdfPanRef.current.x - pageW / 2;
      const topCss = size.height / 2 + pdfPanRef.current.y - pageH / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        baseCanvas,
        leftCss * dpr,
        topCss * dpr,
        pageW * dpr,
        pageH * dpr
      );
    }
    ctx.restore();
  }, []);

  // Buffer 1: Render cached full-page high-DPI offscreen PDF bitmap when page/rotation/theme changes
  useEffect(() => {
    if (!isPdf || !pdfDoc) return;
    let cancelled = false;

    const buildBaseBitmap = async () => {
      setIsPdfRendering(true);
      if (pdfBaseTaskRef.current) {
        try {
          pdfBaseTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }

      const page = await pdfDoc.getPage(Math.min(Math.max(1, pdfPageNum), pdfDoc.numPages));
      if (cancelled) return;

      const baseVp = page.getViewport({ scale: 1, rotation: pdfRotation });
      const nextDims = { width: baseVp.width, height: baseVp.height };
      pdfBaseDimsRef.current = nextDims;
      setPdfBaseDims((prev) =>
        prev && prev.width === nextDims.width && prev.height === nextDims.height ? prev : nextDims
      );

      // Crisp offscreen cache (up to 3200px max side, safely under browser 4096px GPU limit)
      const maxDim = Math.max(1, baseVp.width, baseVp.height);
      const cacheScale = Math.min(3.0, Math.max(0.8, 3200 / maxDim));
      const vp = page.getViewport({ scale: cacheScale, rotation: pdfRotation });

      const offCanvas = document.createElement('canvas');
      offCanvas.width = Math.max(1, Math.floor(vp.width));
      offCanvas.height = Math.max(1, Math.floor(vp.height));

      const isDark = backgroundMode === 'dark';
      const task = page.render({
        canvas: offCanvas,
        viewport: vp,
        background: isDark ? '#0b1120' : '#ffffff',
        pageColors: isDark ? { background: '#0b1120', foreground: '#e2e8f0' } : undefined,
      });
      pdfBaseTaskRef.current = task;

      try {
        await task.promise;
        if (!cancelled) {
          pdfBaseCanvasRef.current = offCanvas;
          pdfCrispCanvasRef.current = null;
          setIsPdfRendering(false);
          paintPdfViewport();
        }
      } catch (err) {
        if ((err as { name?: string })?.name !== 'RenderingCancelledException') {
          console.error('PDF base render error:', err);
          if (!cancelled) setIsPdfRendering(false);
        }
      }
    };

    void buildBaseBitmap();

    return () => {
      cancelled = true;
      if (pdfBaseTaskRef.current) {
        try {
          pdfBaseTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [isPdf, pdfDoc, pdfPageNum, pdfRotation, backgroundMode]);

  // Immediate 60fps composite + debounced crisp native vector pass when zoomed in
  useEffect(() => {
    if (!isPdf || !pdfDoc || !pdfBaseDims) return;

    paintPdfViewport();

    if (pdfZoom <= 1.2) return;

    let cancelled = false;
    const snapKey = `${pdfPageNum}|${pdfRotation}|${backgroundMode}|${canvasSize.width}x${canvasSize.height}|${pdfZoom.toFixed(4)}|${Math.round(pdfPan.x)},${Math.round(pdfPan.y)}`;

    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      if (pdfHiResTaskRef.current) {
        try {
          pdfHiResTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }

      try {
        const page = await pdfDoc.getPage(Math.min(Math.max(1, pdfPageNum), pdfDoc.numPages));
        if (cancelled) return;

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const fitScale = Math.min(
          (canvasSize.width * 0.94) / Math.max(1, pdfBaseDims.width),
          (canvasSize.height * 0.94) / Math.max(1, pdfBaseDims.height)
        );
        const effectiveCssScale = Math.max(0.01, fitScale * pdfZoom);
        const pageW = pdfBaseDims.width * effectiveCssScale;
        const pageH = pdfBaseDims.height * effectiveCssScale;
        const leftPx = (canvasSize.width / 2 + pdfPan.x - pageW / 2) * dpr;
        const topPx = (canvasSize.height / 2 + pdfPan.y - pageH / 2) * dpr;

        const hiCanvas = document.createElement('canvas');
        hiCanvas.width = Math.max(1, Math.floor(canvasSize.width * dpr));
        hiCanvas.height = Math.max(1, Math.floor(canvasSize.height * dpr));

        const viewport = page.getViewport({
          scale: effectiveCssScale * dpr,
          rotation: pdfRotation,
          offsetX: leftPx,
          offsetY: topPx,
        });

        const isDark = backgroundMode === 'dark';
        const task = page.render({
          canvas: hiCanvas,
          viewport,
          background: isDark ? '#0b1120' : '#ffffff',
          pageColors: isDark ? { background: '#0b1120', foreground: '#e2e8f0' } : undefined,
        });
        pdfHiResTaskRef.current = task;
        await task.promise;

        if (!cancelled) {
          pdfCrispCanvasRef.current = { key: snapKey, canvas: hiCanvas };
          paintPdfViewport();
        }
      } catch (err) {
        if ((err as { name?: string })?.name !== 'RenderingCancelledException') {
          console.error('PDF crisp refill error:', err);
        }
      }
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (pdfHiResTaskRef.current) {
        try {
          pdfHiResTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [isPdf, pdfDoc, pdfBaseDims, pdfPageNum, pdfRotation, pdfZoom, pdfPan, canvasSize, backgroundMode, paintPdfViewport]);

  // Unified zoom helper around a CSS viewport coordinate (mx, my)
  const zoomAtPoint = useCallback((factor: number, mx: number, my: number) => {
    const size = canvasSizeRef.current;

    if (isPdfRef.current) {
      const dxCenter = mx - size.width / 2;
      const dyCenter = my - size.height / 2;
      const prevZoom = pdfZoomRef.current;
      const nextZoom = Math.max(0.2, Math.min(30, prevZoom * factor));
      const ratio = nextZoom / prevZoom;
      const prevPan = pdfPanRef.current;
      const nextPan = {
        x: dxCenter - (dxCenter - prevPan.x) * ratio,
        y: dyCenter - (dyCenter - prevPan.y) * ratio,
      };
      pdfZoomRef.current = nextZoom;
      pdfPanRef.current = nextPan;
      setPdfZoom(nextZoom);
      setPdfPan(nextPan);
      return;
    }

    const prev = cameraRef.current;
    const base = Math.max(1e-12, fitBaselineRef.current);
    const minScale = base * 0.12;
    const maxScale = base * 80;
    const nextScale = Math.max(minScale, Math.min(maxScale, prev.scale * factor));
    const actualFactor = nextScale / prev.scale;
    const dxPx = mx - size.width / 2;
    const dyPx = my - size.height / 2;
    const worldX = prev.cx + dxPx / prev.scale;
    const worldY = prev.cy - dyPx / prev.scale;
    const nextCam = {
      cx: worldX - (worldX - prev.cx) / actualFactor,
      cy: worldY - (worldY - prev.cy) / actualFactor,
      scale: nextScale,
    };
    cameraRef.current = nextCam;
    setCamera(nextCam);
  }, []);

  // Cursor-centered native wheel zoom (supports notched wheels & high-res trackpads)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rawDelta = e.deltaMode === 1 ? e.deltaY * 28 : e.deltaMode === 2 ? e.deltaY * 240 : e.deltaY;
      const clampedDelta = Math.max(-140, Math.min(140, rawDelta));
      if (clampedDelta === 0) return;

      const factor = Math.pow(1.0024, -clampedDelta);
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      zoomAtPoint(factor, mx, my);
    };

    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleNativeWheel);
  }, [sourceLayout, dxfData, isPdf, zoomAtPoint]);

  const handleZoomIn = () => {
    const size = canvasSizeRef.current;
    zoomAtPoint(1.3, size.width / 2, size.height / 2);
  };

  const handleZoomOut = () => {
    const size = canvasSizeRef.current;
    zoomAtPoint(1 / 1.3, size.width / 2, size.height / 2);
  };

  const handleSetZoomPercent = (multiplier: number) => {
    if (isPdf) {
      const clamped = Math.max(0.2, Math.min(30, multiplier));
      const ratio = clamped / Math.max(0.01, pdfZoomRef.current);
      setPdfPan((p) => ({ x: p.x * ratio, y: p.y * ratio }));
      setPdfZoom(clamped);
    } else {
      setCamera((p) => ({ ...p, scale: Math.max(1e-12, fitBaselineRef.current) * multiplier }));
    }
  };

  const handleNudgePan = (dxPx: number, dyPx: number) => {
    if (isPdf) {
      setPdfPan((p) => ({ x: p.x + dxPx, y: p.y + dyPx }));
    } else {
      setCamera((p) => ({
        ...p,
        cx: p.cx - dxPx / p.scale,
        cy: p.cy + dyPx / p.scale,
      }));
    }
  };

  // Window-level drag tracking so panning remains smooth even outside canvas edges
  const dragSessionRef = useRef<{
    isPdf: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    scale: number;
  } | null>(null);

  useEffect(() => {
    const onWinMouseMove = (e: MouseEvent) => {
      const sess = dragSessionRef.current;
      if (!sess) return;
      const dx = e.clientX - sess.startX;
      const dy = e.clientY - sess.startY;

      if (sess.isPdf) {
        const nextPan = { x: sess.origX + dx, y: sess.origY + dy };
        pdfPanRef.current = nextPan;
        setPdfPan(nextPan);
      } else {
        const nextCam = {
          cx: sess.origX - dx / sess.scale,
          cy: sess.origY + dy / sess.scale,
          scale: sess.scale,
        };
        cameraRef.current = nextCam;
        setCamera(nextCam);
      }
    };

    const stopDrag = () => {
      if (!dragSessionRef.current) return;
      dragSessionRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('mousemove', onWinMouseMove);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('blur', stopDrag);
    return () => {
      window.removeEventListener('mousemove', onWinMouseMove);
      window.removeEventListener('mouseup', stopDrag);
      window.removeEventListener('blur', stopDrag);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    if (isPdf) {
      dragSessionRef.current = {
        isPdf: true,
        startX: e.clientX,
        startY: e.clientY,
        origX: pdfPanRef.current.x,
        origY: pdfPanRef.current.y,
        scale: 1,
      };
    } else {
      dragSessionRef.current = {
        isPdf: false,
        startX: e.clientX,
        startY: e.clientY,
        origX: cameraRef.current.cx,
        origY: cameraRef.current.cy,
        scale: cameraRef.current.scale,
      };
    }
  };

  const handleContainerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPdf) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const size = canvasSizeRef.current;
    const cam = cameraRef.current;
    setCursorCoords({
      x: cam.cx + (mx - size.width / 2) / cam.scale,
      y: cam.cy - (my - size.height / 2) / cam.scale,
    });
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    zoomAtPoint(1.45, e.clientX - rect.left, e.clientY - rect.top);
  };

  const handleJumpNextMatch = () => {
    if (dxfMatches.length === 0) return;
    const idx = matchCursor % dxfMatches.length;
    const target = dxfMatches[idx];
    setMatchCursor((c) => c + 1);
    setCamera((prev) => ({
      cx: target.x,
      cy: target.y,
      scale: Math.max(
        prev.scale,
        dxfAnalysis ? (canvasSize.width * 0.25) / Math.max(10, dxfAnalysis.extents.width * 0.08) : fitBaselineScale * 4
      ),
    }));
  };

  const handleExportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${stationTitle.replace(/\s+/g, '_')}_Layout.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  if (!sourceLayout || (!dxfData && !isPdf)) {
    return null;
  }

  const displayZoomPct = isPdf
    ? Math.round(pdfZoom * 100)
    : Math.max(1, Math.round((camera.scale / Math.max(1e-12, fitBaselineScale)) * 100));

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
      {/* Primary CAD / PDF Toolbar */}
      <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold text-slate-800 px-2 py-1 bg-white border border-slate-200 rounded">
            {sourceLayout.kind}
          </span>
          <span className="text-slate-600 font-medium truncate max-w-[160px]" title={sourceLayout.fileName}>
            {sourceLayout.fileName}
          </span>

          {!isPdf && (
            <>
              <button
                type="button"
                onClick={() => setShowLayersPanel((s) => !s)}
                className={`inline-flex items-center gap-1 px-2 py-1 border rounded cursor-pointer whitespace-nowrap ${
                  showLayersPanel
                    ? 'bg-blue-50 border-blue-300 text-blue-800 font-medium'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Layers ({dxfLayers.length})</span>
              </button>

              <div className="inline-flex items-center bg-white border border-slate-300 rounded px-2 py-0.5 gap-1.5">
                <Search className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setMatchCursor(0);
                  }}
                  placeholder="Find tag/signal..."
                  className="text-xs w-28 focus:outline-none text-slate-800 placeholder:text-slate-400"
                />
                {searchQuery.trim() && (
                  <button
                    type="button"
                    onClick={handleJumpNextMatch}
                    className="text-[11px] font-mono text-blue-700 hover:underline cursor-pointer whitespace-nowrap"
                  >
                    {dxfMatches.length > 0 ? `Next (${dxfMatches.length})` : '0 found'}
                  </button>
                )}
              </div>
            </>
          )}

          {isPdf && (
            <>
              {pdfPageCount > 1 && (
                <div className="inline-flex items-center gap-1 bg-white border border-slate-300 rounded px-1.5 py-0.5">
                  <button
                    type="button"
                    disabled={pdfPageNum <= 1}
                    onClick={() => setPdfPageNum((p) => Math.max(1, p - 1))}
                    className="p-0.5 text-slate-600 hover:text-slate-900 disabled:opacity-30 cursor-pointer"
                    aria-label="Previous PDF Page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono text-[11px] text-slate-700 px-1 tabular-nums">
                    Pg {pdfPageNum}/{pdfPageCount}
                  </span>
                  <button
                    type="button"
                    disabled={pdfPageNum >= pdfPageCount}
                    onClick={() => setPdfPageNum((p) => Math.min(pdfPageCount, p + 1))}
                    className="p-0.5 text-slate-600 hover:text-slate-900 disabled:opacity-30 cursor-pointer"
                    aria-label="Next PDF Page"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Zoom & Pan Navigation Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Directional Pan Controls */}
          <div className="inline-flex items-center bg-white border border-slate-300 rounded overflow-hidden" role="group" aria-label="Pan Controls">
            <button
              type="button"
              onClick={() => handleNudgePan(120, 0)}
              className="p-1.5 hover:bg-slate-100 text-slate-700 border-r border-slate-200 cursor-pointer"
              title="Pan Left"
              aria-label="Pan Left"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleNudgePan(0, 90)}
              className="p-1.5 hover:bg-slate-100 text-slate-700 border-r border-slate-200 cursor-pointer"
              title="Pan Up"
              aria-label="Pan Up"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleNudgePan(0, -90)}
              className="p-1.5 hover:bg-slate-100 text-slate-700 border-r border-slate-200 cursor-pointer"
              title="Pan Down"
              aria-label="Pan Down"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleNudgePan(-120, 0)}
              className="p-1.5 hover:bg-slate-100 text-slate-700 cursor-pointer"
              title="Pan Right"
              aria-label="Pan Right"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleZoomOut}
            className="p-1.5 bg-white border border-slate-300 rounded hover:bg-slate-100 text-slate-700 cursor-pointer"
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <select
            aria-label="Zoom Level Preset"
            value={
              ZOOM_PRESETS.find((p) => Math.abs(p.value * 100 - displayZoomPct) < 5)?.value ?? 'custom'
            }
            onChange={(e) => {
              const val = Number(e.target.value);
              if (!Number.isNaN(val) && val > 0) handleSetZoomPercent(val);
            }}
            className="font-mono text-[11px] tabular-nums bg-white border border-slate-300 rounded px-1.5 py-1 text-slate-800 cursor-pointer focus:outline-none focus:border-blue-600"
          >
            <option value="custom">{displayZoomPct}%</option>
            {ZOOM_PRESETS.map((p) => (
              <option key={p.label} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleZoomIn}
            className="p-1.5 bg-white border border-slate-300 rounded hover:bg-slate-100 text-slate-700 cursor-pointer"
            title="Zoom In"
            aria-label="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={fitToView}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 text-slate-800 font-medium cursor-pointer whitespace-nowrap"
            title="Zoom to Fit Entire Drawing"
          >
            <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Zoom to Fit</span>
          </button>

          <div
            className="inline-flex items-center bg-white border border-slate-300 rounded overflow-hidden"
            role="group"
            aria-label="Canvas Background"
          >
            <button
              type="button"
              onClick={() => setBackgroundMode('white')}
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium cursor-pointer border-r border-slate-200 transition-colors ${
                backgroundMode === 'white'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              title="White Drafting Sheet Background"
            >
              <Sun className="w-3.5 h-3.5" aria-hidden="true" />
              <span>White</span>
            </button>
            <button
              type="button"
              onClick={() => setBackgroundMode('dark')}
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium cursor-pointer transition-colors ${
                backgroundMode === 'dark'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              title="Dark CAD Blueprint Background"
            >
              <Moon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Dark</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleRotateLayout}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 text-slate-800 font-medium cursor-pointer whitespace-nowrap shadow-xs"
            title="Rotate layout 90° clockwise"
            aria-label="Rotate layout 90° clockwise"
          >
            <RotateCw className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
            <span>Rotate Layout ({currentRotation}°)</span>
          </button>

          {!isPdf && (
            <button
              type="button"
              onClick={() => setShowCrosshair((c) => !c)}
              className={`p-1.5 border rounded cursor-pointer ${
                showCrosshair
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-slate-300 text-slate-600'
              }`}
              title="Toggle CAD Coordinate Readout"
              aria-label="Toggle CAD Coordinate Readout"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleExportPng}
            className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 text-slate-700 cursor-pointer whitespace-nowrap"
            title="Download Current View as PNG"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>PNG</span>
          </button>
        </div>
      </div>

      {/* Main Viewport + Optional CAD Layers Drawer */}
      <div className="relative flex flex-1 min-h-[540px] max-h-[680px]">
        {!isPdf && showLayersPanel && (
          <div className="w-60 border-r border-slate-200 bg-slate-50 flex flex-col shrink-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-800">
              <span>CAD Layers</span>
              <div className="flex gap-2 text-[11px] font-normal">
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    dxfLayers.forEach((l) => (next[l.name] = true));
                    setVisibleLayers(next);
                  }}
                  className="text-blue-700 hover:underline cursor-pointer"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    dxfLayers.forEach((l) => (next[l.name] = false));
                    setVisibleLayers(next);
                  }}
                  className="text-slate-600 hover:underline cursor-pointer"
                >
                  None
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
              {dxfLayers.map((layer) => {
                const checked = visibleLayers[layer.name] !== false;
                return (
                  <label
                    key={layer.name}
                    className="flex items-center justify-between px-3 py-1.5 text-xs hover:bg-white cursor-pointer"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setVisibleLayers((prev) => ({
                            ...prev,
                            [layer.name]: e.target.checked,
                          }))
                        }
                        className="rounded border-slate-300 text-blue-700"
                      />
                      <span className="truncate font-mono text-slate-800" title={layer.name}>
                        {layer.name}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-500 ml-2 shrink-0">
                      {layer.entityCount}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleContainerMouseMove}
          onDoubleClick={handleDoubleClick}
          onMouseLeave={() => setCursorCoords(null)}
          className={`relative flex-1 overflow-hidden select-none touch-none ${
            backgroundMode === 'dark' ? 'bg-slate-950' : 'bg-white'
          } ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        >
          <canvas ref={canvasRef} className="w-full h-full block" />

          {isPdf && isPdfRendering && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-900/10">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-slate-900/85 text-white text-xs font-medium shadow-sm">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                <span>Rendering CAD sheet...</span>
              </div>
            </div>
          )}

          {/* Bottom Navigation & Status Bar */}
          <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center justify-between text-[11px] font-mono">
            <div className="bg-slate-900/80 text-slate-100 px-2.5 py-1 rounded">
              Drag or Arrows to Pan · Scroll or Double-Click to Zoom · {displayZoomPct}%
            </div>
            {!isPdf && showCrosshair && cursorCoords && (
              <div className="bg-slate-900/80 text-slate-100 px-2.5 py-1 rounded tabular-nums">
                X: {cursorCoords.x.toFixed(2)} · Y: {cursorCoords.y.toFixed(2)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
