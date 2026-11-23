import type { Bounds, ComponentMutation } from "./cadFormat";
import { Camera, DrawOpts, RouteHighlight, Scene, VisualComponent, drawScene, fitCamera } from "./scene";
import type { WorkerRequest, WorkerResponse } from "./cadWorker";
import type { ComponentRecord } from "../services/cadApi";

export interface ViewInfo { zoom: number; panX: number; panY: number }
export interface RendererEvents {
  onView(v: ViewInfo): void;
  onCursor(x: number | null, y: number | null): void;
  onStage(stage: string): void;
  onLoaded(info: { vertices: number; bounds: Bounds }): void;
  onError(message: string): void;
  onSelectComponent?(id: string | null, multi?: boolean): void;
  onMoveComponent?(id: string, dx: number, dy: number): void;
}

interface DragState {
  id: string;
  startWx: number;
  startWy: number;
  initialDx: number;
  initialDy: number;
  curDx: number;
  curDy: number;
  hasMoved: boolean;
}

/** Owns the canvas, camera, input handling, geometry worker and CAD component interaction. */
export class CadRenderer {
  private ctx: CanvasRenderingContext2D;
  private scene: Scene | null = null;
  private cam: Camera = { cx: 0, cy: 0, scale: 1 };
  private fitScale = 1;
  private w = 1; private h = 1; private dpr = 1;
  private opts: DrawOpts = { dark: true, lineweights: true, grid: false, interacting: false };
  private raf = 0;
  private idleTimer = 0;
  private worker: Worker;
  private loadId = 0;
  private pan: { x: number; y: number } | null = null;
  private space = false;
  private tool: string = "select";
  private ro: ResizeObserver;
  private cleanup: Array<() => void> = [];

  // CAD interactive components & grips
  private components: ComponentRecord[] = [];
  private selectedComponentId: string | null = null;
  private selectedComponentIds: Set<string> = new Set();
  private stagedAdditions: Record<string, any> = {};
  private movedComponents: Record<string, ComponentMutation> = {};
  private drag: DragState | null = null;

  constructor(private canvas: HTMLCanvasElement, private ev: RendererEvents) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.worker = new Worker(new URL("./cadWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (m: MessageEvent<WorkerResponse>) => this.onWorker(m.data);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.bind();
    this.resize();
  }

  // ---- loading ---------------------------------------------------------
  load(url: string) {
    this.scene = null;
    this.ev.onCursor(null, null);
    this.requestDraw();
    const req: WorkerRequest = { type: "load", url, id: ++this.loadId };
    this.worker.postMessage(req);
  }

  private onWorker(m: WorkerResponse) {
    if (m.id !== this.loadId) return;
    if (m.type === "stage") this.ev.onStage(m.stage);
    else if (m.type === "error") this.ev.onError(m.message);
    else {
      try {
        this.scene = new Scene(m.origin, m.bounds, m.chunks);
        this.fit();
        this.ev.onLoaded({ vertices: m.vertices, bounds: m.bounds });
      } catch (e) {
        this.ev.onError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  // ---- public controls ---------------------------------------------------
  fit() {
    if (!this.scene) return;
    this.cam = fitCamera(this.scene, this.w, this.h);
    this.fitScale = this.cam.scale;
    this.requestDraw();
  }

  zoomBy(factor: number, sx = this.w / 2, sy = this.h / 2) {
    if (!this.scene) return;
    const c = this.cam, s = c.scale;
    const ns = Math.min(this.fitScale * 5e5, Math.max(this.fitScale * 0.05, s * factor));
    const wx = c.cx + (sx - this.w / 2) / s, wy = c.cy - (sy - this.h / 2) / s;
    this.cam = { scale: ns, cx: wx - (sx - this.w / 2) / ns, cy: wy + (sy - this.h / 2) / ns };
    this.touch();
  }

  setTool(t: string) {
    this.tool = t;
    this.canvas.style.cursor = t === "pan" ? "grab" : "crosshair";
  }

  setOptions(o: Partial<DrawOpts>) {
    Object.assign(this.opts, o);
    this.syncComponentOptions();
    this.requestDraw();
  }

  setComponents(comps: ComponentRecord[]) {
    this.components = comps;
    this.syncComponentOptions();
    this.requestDraw();
  }

  setSelectedComponentId(id: string | null) {
    this.selectedComponentId = id;
    if (id) {
      if (!this.selectedComponentIds.has(id)) {
        this.selectedComponentIds = new Set([id]);
      }
    } else {
      this.selectedComponentIds = new Set();
    }
    this.syncComponentOptions();
    this.requestDraw();
  }

  setSelectedComponentIds(ids: Set<string>) {
    this.selectedComponentIds = ids;
    if (ids.size === 1) {
      this.selectedComponentId = Array.from(ids)[0];
    } else if (ids.size === 0) {
      this.selectedComponentId = null;
    }
    this.syncComponentOptions();
    this.requestDraw();
  }

  setStagedAdditions(adds: Record<string, any>) {
    this.stagedAdditions = adds;
    this.syncComponentOptions();
    this.requestDraw();
  }

  setMovedComponents(moved: Record<string, ComponentMutation>) {
    this.movedComponents = moved;
    this.syncComponentOptions();
    this.requestDraw();
  }

  setRouteHighlight(rh: RouteHighlight | null) {
    this.opts.routeHighlight = rh;
    this.requestDraw();
  }

  focusRoute(rh: RouteHighlight) {
    if (!this.scene) return;
    const pts: Array<[number, number]> = [];
    if (rh.entryAnchor) pts.push(rh.entryAnchor);
    for (const p of rh.intermediatePoints) pts.push(p);
    if (rh.exitAnchor) pts.push(rh.exitAnchor);
    if (!pts.length) return;

    let minX = pts[0][0], maxX = pts[0][0], minY = pts[0][1], maxY = pts[0][1];
    for (const [x, y] of pts) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const ox = this.scene.origin[0], oy = this.scene.origin[1];
    const cx = (minX + maxX) / 2 - ox;
    const cy = (minY + maxY) / 2 - oy;
    const bw = Math.max(maxX - minX, 60);
    const bh = Math.max(maxY - minY, 30);
    const targetScale = Math.min((this.w * 0.7) / bw, (this.h * 0.5) / bh);
    this.cam = {
      cx,
      cy,
      scale: Math.max(this.fitScale * 0.4, Math.min(this.fitScale * 100, targetScale)),
    };
    this.requestDraw();
  }

  focusComponent(comp: ComponentRecord) {
    if (!this.scene) return;
    const ox = this.scene.origin[0], oy = this.scene.origin[1];
    const b = comp.bbox;
    const cx = (b[0] + b[2]) / 2 - ox;
    const cy = (b[1] + b[3]) / 2 - oy;
    const bw = Math.max(b[2] - b[0], 20);
    const bh = Math.max(b[3] - b[1], 20);
    const targetScale = Math.min(this.w / (bw * 3), this.h / (bh * 3));
    this.cam = {
      cx,
      cy,
      scale: Math.max(this.fitScale * 2, Math.min(this.fitScale * 1000, targetScale)),
    };
    this.requestDraw();
  }

  private syncComponentOptions() {
    const selVisuals: VisualComponent[] = [];
    const targetIds = this.selectedComponentIds.size > 0
      ? Array.from(this.selectedComponentIds)
      : (this.selectedComponentId ? [this.selectedComponentId] : []);

    for (const id of targetIds) {
      const c = this.components.find((item) => item.id === id);
      if (c) {
        selVisuals.push({
          id: c.id,
          bbox: c.bbox,
          anchor: c.anchor,
          layerId: c.layerId,
          categoryId: c.categoryId,
        });
      }
    }

    this.opts.selectedComponents = selVisuals;
    this.opts.selectedComponent = selVisuals[0] || null;
    this.opts.movedComponents = this.movedComponents as any;
    this.opts.stagedAdditions = this.stagedAdditions;
    if (this.drag) {
      this.opts.dragDelta = { id: this.drag.id, dx: this.drag.curDx, dy: this.drag.curDy };
    } else {
      this.opts.dragDelta = null;
    }
  }

  /** Hit test against components and grips with priority for discrete and compact elements */
  private hitTest(wx: number, wy: number): ComponentRecord | null {
    if (!this.components.length || !this.scene) return null;
    const s = this.cam.scale;
    const tol = Math.max(14 / s, 1.5); // 14 screen pixels or 1.5m CAD units precision

    const matches: Array<{ comp: ComponentRecord; area: number; dist: number; isDiscrete: boolean }> = [];

    for (const c of this.components) {
      const mut = this.movedComponents[c.id];
      if (mut?.isDeleted) continue;
      const dx = mut ? mut.dx : 0;
      const dy = mut ? mut.dy : 0;
      const b = c.bbox;

      const minX = b[0] + dx - tol;
      const minY = b[1] + dy - tol;
      const maxX = b[2] + dx + tol;
      const maxY = b[3] + dy + tol;

      if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) {
        const w = Math.max(b[2] - b[0], 0.1);
        const h = Math.max(b[3] - b[1], 0.1);
        const area = w * h;

        // Calculate distance to closest anchor/grip/center point
        let dist = Math.hypot(wx - ((b[0] + b[2]) / 2 + dx), wy - ((b[1] + b[3]) / 2 + dy));
        if (c.anchor) {
          dist = Math.min(dist, Math.hypot(wx - (c.anchor[0] + dx), wy - (c.anchor[1] + dy)));
        }
        if (c.grips) {
          for (const g of c.grips) {
            dist = Math.min(dist, Math.hypot(wx - (g[0] + dx), wy - (g[1] + dy)));
          }
        }

        // Discrete components (crossovers, TINs, signals, tags, shunts, axle counters, points)
        const isDiscrete = ["signals", "rfid_tags", "shunts", "axle_counters", "points"].includes(c.category) ||
          c.name.includes("RFID") || c.name.includes("Direction") || c.name.includes("Axle") ||
          c.name.includes("Detection") || c.name.includes("Crossover") ||
          c.name.includes("TIN") || w < 40;

        matches.push({ comp: c, area, dist, isDiscrete });
      }
    }

    if (matches.length === 0) return null;

    // Prioritize discrete components first, then closest grip distance, then smallest area
    matches.sort((a, b) => {
      if (a.isDiscrete && !b.isDiscrete) return -1;
      if (!a.isDiscrete && b.isDiscrete) return 1;
      if (Math.abs(a.dist - b.dist) > 8.0) return a.dist - b.dist;
      if (Math.abs(a.area - b.area) > 1.0) return a.area - b.area;
      return a.dist - b.dist;
    });

    return matches[0].comp;
  }

  /** Renders the whole drawing (fit) to an image, for PNG export and the validation view. */
  snapshot(width: number, height: number, view: "fit" | "current" = "fit"): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const cam = view === "fit" && this.scene ? fitCamera(this.scene, width, height)
      : { ...this.cam, scale: this.cam.scale * (width / this.w) };
    drawScene(c.getContext("2d")!, this.scene, cam, width, height, 1, { ...this.opts, interacting: false });
    return c;
  }

  exportPng(): Promise<Blob | null> {
    const c = this.snapshot(Math.round(this.w * this.dpr), Math.round(this.h * this.dpr), "current");
    return new Promise((r) => c.toBlob(r, "image/png"));
  }

  dispose() {
    cancelAnimationFrame(this.raf); clearTimeout(this.idleTimer);
    this.ro.disconnect(); this.worker.terminate();
    this.cleanup.forEach((f) => f());
    this.scene = null;
  }

  // ---- internals ---------------------------------------------------------
  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (this.scene && (w !== this.w || h !== this.h)) {
      const ratio = Math.min(w / this.w, h / this.h);
      this.cam.scale *= ratio; this.fitScale *= ratio;
    }
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.requestDraw();
  }

  private touch() {
    this.opts.interacting = true;
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => { this.opts.interacting = false; this.requestDraw(); }, 140);
    this.requestDraw();
  }

  private requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      try {
        drawScene(this.ctx, this.scene, this.cam, this.w, this.h, this.dpr, this.opts);
      } catch (e) {
        this.ev.onError(e instanceof Error ? e.message : "Draw failed");
        return;
      }
      if (this.scene) {
        this.ev.onView({ zoom: this.cam.scale / this.fitScale, panX: this.scene.origin[0] + this.cam.cx, panY: this.scene.origin[1] + this.cam.cy });
      }
    });
  }

  private world(sx: number, sy: number): [number, number] | null {
    if (!this.scene) return null;
    const c = this.cam;
    return [this.scene.origin[0] + c.cx + (sx - this.w / 2) / c.scale, this.scene.origin[1] + c.cy - (sy - this.h / 2) / c.scale];
  }

  private bind() {
    const cv = this.canvas;
    const on = (el: HTMLElement | Window, t: string, f: (e: any) => void, opt?: AddEventListenerOptions) => {
      el.addEventListener(t, f, opt); this.cleanup.push(() => el.removeEventListener(t, f));
    };
    cv.style.cursor = "crosshair";
    cv.style.touchAction = "none";

    on(cv, "wheel", (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.zoomBy(Math.pow(1.0018, -dy), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    on(cv, "pointerdown", (e: PointerEvent) => {
      const wantsPan = e.button === 1 || (e.button === 0 && (this.space || this.tool === "pan"));
      if (wantsPan) {
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        this.pan = { x: e.clientX, y: e.clientY };
        cv.style.cursor = "grabbing";
        return;
      }

      if (e.button === 0) {
        const r = cv.getBoundingClientRect();
        const wp = this.world(e.clientX - r.left, e.clientY - r.top);
        if (!wp) return;

        // Perform precision hit-test
        const hit = this.hitTest(wp[0], wp[1]);
        if (hit) {
          this.ev.onSelectComponent?.(hit.id, e.shiftKey);

          // Start drag for this component
          const curMut = this.movedComponents[hit.id];
          const initDx = curMut ? curMut.dx : 0;
          const initDy = curMut ? curMut.dy : 0;
          this.drag = {
            id: hit.id,
            startWx: wp[0],
            startWy: wp[1],
            initialDx: initDx,
            initialDy: initDy,
            curDx: initDx,
            curDy: initDy,
            hasMoved: false,
          };
          cv.setPointerCapture(e.pointerId);
          cv.style.cursor = "move";
        } else {
          // Clicked empty background
          this.ev.onSelectComponent?.(null, false);
        }
      }
    });

    on(cv, "pointermove", (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const wp = this.world(e.clientX - r.left, e.clientY - r.top);
      if (wp) this.ev.onCursor(wp[0], wp[1]);

      if (this.pan) {
        this.cam.cx -= (e.clientX - this.pan.x) / this.cam.scale;
        this.cam.cy += (e.clientY - this.pan.y) / this.cam.scale;
        this.pan = { x: e.clientX, y: e.clientY };
        this.touch();
        return;
      }

      if (this.drag && wp) {
        const dx = wp[0] - this.drag.startWx;
        const dy = wp[1] - this.drag.startWy;
        const screenDist = Math.hypot(dx, dy) * this.cam.scale;
        if (screenDist > 3) {
          this.drag.hasMoved = true;
          this.drag.curDx = this.drag.initialDx + dx;
          this.drag.curDy = this.drag.initialDy + dy;
          this.opts.dragDelta = { id: this.drag.id, dx: this.drag.curDx, dy: this.drag.curDy };
          this.requestDraw();
        }
      }
    });

    const end = (e: PointerEvent) => {
      if (this.pan) {
        this.pan = null;
        if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
        cv.style.cursor = this.tool === "pan" || this.space ? "grab" : "crosshair";
      }

      if (this.drag) {
        if (this.drag.hasMoved) {
          this.ev.onMoveComponent?.(this.drag.id, this.drag.curDx, this.drag.curDy);
        }
        this.drag = null;
        this.opts.dragDelta = null;
        if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
        cv.style.cursor = this.tool === "pan" || this.space ? "grab" : "crosshair";
        this.requestDraw();
      }
    };

    on(cv, "pointerup", end);
    on(cv, "pointercancel", end);
    on(cv, "pointerleave", () => this.ev.onCursor(null, null));
    on(cv, "auxclick", (e: MouseEvent) => e.preventDefault());

    const typing = (e: KeyboardEvent) => ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName);
    on(window, "keydown", (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.code === "Space") { this.space = true; if (!this.pan) cv.style.cursor = "grab"; e.preventDefault(); }
      else if (e.key === "f" || e.key === "Home") this.fit();
      else if (e.key === "+" || e.key === "=") this.zoomBy(1.25);
      else if (e.key === "-") this.zoomBy(1 / 1.25);
    });
    on(window, "keyup", (e: KeyboardEvent) => {
      if (e.code === "Space") { this.space = false; if (!this.pan) cv.style.cursor = this.tool === "pan" ? "grab" : "crosshair"; }
    });
  }
}
