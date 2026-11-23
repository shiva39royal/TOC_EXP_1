import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { ComponentRecord, FullKavachExport } from "../services/cadApi";
import type { ComponentMutation } from "./cadFormat";
import { CadRenderer } from "./CadRenderer";
import { cursorBus } from "./cursorBus";
import type { RouteHighlight } from "./scene";

export interface CadViewerHandle {
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
  snapshot(w: number, h: number): string;
  exportPng(): Promise<Blob | null>;
  focusComponent(comp: ComponentRecord): void;
  reload(): void;
}

export interface CadViewerProps {
  renderUrl: string;
  components?: ComponentRecord[];
  kavachData?: FullKavachExport | null;
  selectedRouteIndex?: number | null;
  selectedComponentId?: string | null;
  selectedComponentIds?: Set<string>;
  backgroundMode?: "dark" | "light";
  showGrid?: boolean;
  showLineweights?: boolean;
  selectedTool?: "select" | "pan";
  hiddenLayers?: Set<number>;
  hiddenCategories?: Set<number>;
  stagedAdditions?: Record<string, any>;
  movedComponents?: Record<string, ComponentMutation>;
  onStage?: (stage: string) => void;
  onLoaded?: () => void;
  onError?: (msg: string) => void;
  onSelectComponent?: (id: string | null, multi?: boolean) => void;
  onMoveComponent?: (id: string, dx: number, dy: number) => void;
  onViewChange?: (view: { zoom: number; panX: number; panY: number }) => void;
}

/**
 * Universal CAD Vector Viewport.
 * Renders decompressed .cadr.gz binary vectors on HTML5 canvas via CadRenderer.
 */
export const CadViewer = forwardRef<CadViewerHandle, CadViewerProps>(function CadViewer(
  {
    renderUrl,
    components = [],
    kavachData = null,
    selectedRouteIndex = null,
    selectedComponentId = null,
    selectedComponentIds = new Set(),
    backgroundMode = "dark",
    showGrid = false,
    showLineweights = true,
    selectedTool = "select",
    hiddenLayers = new Set(),
    hiddenCategories = new Set(),
    stagedAdditions = {},
    movedComponents = {},
    onStage,
    onLoaded,
    onError,
    onSelectComponent,
    onMoveComponent,
    onViewChange,
  },
  ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<CadRenderer | null>(null);

  const routeHighlight = useMemo<RouteHighlight | null>(() => {
    if (selectedRouteIndex === null || selectedRouteIndex === undefined || !kavachData) return null;
    const row = kavachData.table_of_control?.find((r) => r.s_no === selectedRouteIndex);
    if (!row) return null;

    const normalize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const entryNorm = normalize(row.entry_signal || "");
    const exitNorm = normalize(row.exit_signal || "");

    const entryComp = components.find((c) => {
      const n = normalize(c.name || "");
      const t = c.tags ? Object.values(c.tags).map(normalize) : [];
      return n === entryNorm || t.includes(entryNorm);
    });

    const exitComp = components.find((c) => {
      const n = normalize(c.name || "");
      const t = c.tags ? Object.values(c.tags).map(normalize) : [];
      return n === exitNorm || t.includes(exitNorm);
    });

    const ptNorms = [
      ...(row.points_normal ? row.points_normal.split(",").map(normalize) : []),
      ...(row.points_reverse ? row.points_reverse.split(",").map(normalize) : []),
    ].filter(Boolean);

    const intermediatePoints: Array<[number, number]> = [];
    for (const pt of ptNorms) {
      const pComp = components.find((c) => {
        const n = normalize(c.name || "");
        const t = c.tags ? Object.values(c.tags).map(normalize) : [];
        return n === pt || t.includes(pt);
      });
      if (pComp?.anchor) intermediatePoints.push(pComp.anchor);
    }

    if (entryComp?.anchor) {
      intermediatePoints.sort((a, b) => {
        const d1 = Math.hypot(a[0] - entryComp.anchor[0], a[1] - entryComp.anchor[1]);
        const d2 = Math.hypot(b[0] - entryComp.anchor[0], b[1] - entryComp.anchor[1]);
        return d1 - d2;
      });
    }

    const rfidTokens = row.rfid_sequence_str
      ? row.rfid_sequence_str.split("->").map((s) => s.trim())
      : [];
    const rfidPoints: Array<{ anchor: [number, number]; tag: string }> = [];
    for (const tag of rfidTokens) {
      const tagNorm = normalize(tag);
      const rComp = components.find((c) => {
        const n = normalize(c.name || "");
        const t = c.tags ? Object.values(c.tags).map(normalize) : [];
        return n === tagNorm || t.includes(tagNorm);
      });
      if (rComp?.anchor) {
        rfidPoints.push({ anchor: rComp.anchor, tag });
      }
    }

    return {
      entryAnchor: entryComp?.anchor,
      exitAnchor: exitComp?.anchor,
      entryLabel: row.entry_signal,
      exitLabel: row.exit_signal,
      intermediatePoints,
      rfidPoints,
    };
  }, [selectedRouteIndex, kavachData, components]);

  useEffect(() => {
    renderer.current?.setRouteHighlight(routeHighlight);
    if (routeHighlight) {
      renderer.current?.focusRoute(routeHighlight);
    }
  }, [routeHighlight]);

  useEffect(() => {
    if (!canvas.current) return;
    const r = new CadRenderer(canvas.current, {
      onView: (v) => onViewChange?.(v),
      onCursor: cursorBus.emit,
      onStage: (s) => onStage?.(s),
      onLoaded: () => onLoaded?.(),
      onError: (m) => onError?.(m),
      onSelectComponent: (id, multi) => onSelectComponent?.(id, multi),
      onMoveComponent: (id, dx, dy) => onMoveComponent?.(id, dx, dy),
    });
    renderer.current = r;
    return () => {
      r.dispose();
      renderer.current = null;
    };
  }, [onViewChange, onStage, onLoaded, onError, onSelectComponent, onMoveComponent]);

  useEffect(() => {
    if (renderUrl) {
      renderer.current?.load(renderUrl);
    }
  }, [renderUrl]);

  useEffect(() => {
    renderer.current?.setOptions({
      dark: backgroundMode === "dark",
      grid: showGrid,
      lineweights: showLineweights,
      hiddenLayers,
      hiddenCategories,
    });
  }, [backgroundMode, showGrid, showLineweights, hiddenLayers, hiddenCategories]);

  useEffect(() => {
    renderer.current?.setTool(selectedTool);
  }, [selectedTool]);

  useEffect(() => {
    renderer.current?.setComponents(components);
  }, [components]);

  useEffect(() => {
    renderer.current?.setSelectedComponentId(selectedComponentId);
  }, [selectedComponentId]);

  useEffect(() => {
    renderer.current?.setSelectedComponentIds(selectedComponentIds);
  }, [selectedComponentIds]);

  useEffect(() => {
    renderer.current?.setStagedAdditions(stagedAdditions);
  }, [stagedAdditions]);

  useEffect(() => {
    renderer.current?.setMovedComponents(movedComponents);
  }, [movedComponents]);

  useImperativeHandle(ref, () => ({
    fit: () => renderer.current?.fit(),
    zoomIn: () => renderer.current?.zoomBy(1.4),
    zoomOut: () => renderer.current?.zoomBy(1 / 1.4),
    snapshot: (w, h) => renderer.current?.snapshot(w, h).toDataURL("image/png") ?? "",
    exportPng: () => renderer.current?.exportPng() ?? Promise.resolve(null),
    focusComponent: (comp) => renderer.current?.focusComponent(comp),
    reload: () => {
      if (renderUrl) {
        const cacheBust = `${renderUrl}${renderUrl.includes("?") ? "&" : "?"}_t=${Date.now()}`;
        renderer.current?.load(cacheBust);
      }
    },
  }));

  return (
    <div className="relative w-full h-full min-h-[500px] bg-black overflow-hidden select-none">
      <canvas
        ref={canvas}
        className="w-full h-full block cursor-crosshair"
        aria-label="CAD Vector Drawing"
      />
    </div>
  );
});

export default CadViewer;
