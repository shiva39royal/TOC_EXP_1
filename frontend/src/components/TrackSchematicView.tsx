// @ts-nocheck -- ported from the original app (written for a looser TS config)
import React, { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Edit2,
  FileCode2,
  FileSpreadsheet,
  Layers,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import type { StationMetadata, StationProject } from "../types/signalling";
import { CadDrawingViewer } from "./CadDrawingViewer";

interface TrackSchematicViewProps {
  project: StationProject | null;
  selectedRouteSlNo: number | null;
  onSelectRoute: (slNo: number | null) => void;
  onJumpToValidation: (slNo?: number) => void;
  onUpdateMetadata?: (patch: Partial<StationMetadata>) => void;
  onOpenUpload?: () => void;
}

export const TrackSchematicView: React.FC<TrackSchematicViewProps> = ({
  project,
  selectedRouteSlNo,
  onSelectRoute,
  onJumpToValidation,
  onUpdateMetadata,
  onOpenUpload,
}) => {
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editId, setEditId] = useState("");
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const selectedRoute = useMemo(
    () => project?.routes.find((r) => r.slNo === selectedRouteSlNo) ?? null,
    [project, selectedRouteSlNo],
  );

  if (!project) {
    return (
      <div className="space-y-6">
        {/* Upload Hero Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-8 md:p-12 shadow-xs">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingOver(false);
              onOpenUpload?.();
            }}
            className={`max-w-2xl mx-auto border-2 border-dashed rounded-xl p-8 md:p-12 text-center space-y-6 transition-all ${
              isDraggingOver
                ? "border-blue-600 bg-blue-50/60"
                : "border-slate-300 bg-slate-50/60 hover:border-slate-400"
            }`}
          >
            <div className="space-y-3">
              <div className="w-14 h-14 rounded-xl bg-blue-50 border border-blue-200/80 flex items-center justify-center mx-auto shadow-xs">
                <Upload className="w-7 h-7 text-blue-700" aria-hidden="true" />
              </div>
              <h2 className="text-xl md:text-2xl font-display font-bold text-slate-900 tracking-tight">
                X-Tractor Signalling Layout &amp; TOC Workbench
              </h2>
              <p className="text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
                Upload any station signalling plan or RFID layout (
                <span className="font-mono font-semibold text-slate-800">.dwg</span>,{" "}
                <span className="font-mono font-semibold text-slate-800">.dxf</span>, or{" "}
                <span className="font-mono font-semibold text-slate-800">.pdf</span>) to
                automatically extract layout topology and compile an accurate Table of Control.
              </p>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={onOpenUpload}
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg shadow-sm transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                <Upload className="w-4 h-4" aria-hidden="true" />
                <span>Upload Station Layout</span>
              </button>
              <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-slate-500 pt-1">
                <span className="inline-flex items-center gap-1 font-mono">
                  Supported: .DWG · .DXF · .PDF
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-700 font-medium">100% Offline Processing</span>
              </div>
            </div>
          </div>
        </div>

        {/* Informative Workflow Matter (Compact, informative, helpful) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
            <div className="w-8 h-8 rounded-md bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs">
              01
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Dynamic Asset Discovery</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Detects running track lines, signal masts, turnout point machines, and RFID tags with
              absolute chainages from CAD or scanned PDF drawings.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
            <div className="w-8 h-8 rounded-md bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs">
              02
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Topological Route Tracing</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Automatically discovers routes from Home signals to Starters and Advanced Starters
              across normal/reverse point paths and determines overlaps.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
            <div className="w-8 h-8 rounded-md bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs">
              03
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Table of Control Generation</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Synthesizes Selection Tables, Track Profiles, TSR/TSL routes, and RFID linking
              sequences ready for review and Excel/CSV/PDF export.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* CAD Header Controls */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
            <FileCode2 className="w-4 h-4 text-blue-700" aria-hidden="true" />
            <span>CAD Layout Viewer</span>
          </div>

          <span className="text-slate-300" aria-hidden="true">
            |
          </span>

          <div className="flex items-center gap-2">
            <label
              htmlFor="schematic-route-select"
              className="text-xs font-semibold text-slate-700 whitespace-nowrap"
            >
              Inspect Route:
            </label>
            <select
              id="schematic-route-select"
              value={selectedRouteSlNo ?? ""}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                onSelectRoute(val);
              }}
              className="text-xs border border-slate-300 rounded-md px-2.5 py-1.5 bg-white text-slate-900 focus:outline-none focus:border-blue-600 max-w-xs"
            >
              <option value="">Station CAD Overview (No Route Selected)</option>
              {project.routes.map((r) => (
                <option key={r.slNo} value={r.slNo}>
                  #{r.slNo} · {r.entrySignal} → {r.exitSignal} ({r.leadingToLine})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs font-mono tabular-nums text-slate-500">
            {project.tracks.length} Tracks · {project.points.length} Points ·{" "}
            {project.signals.length} Signals · {project.tags.length} RFID Tags
          </div>
          {onOpenUpload && (
            <button
              type="button"
              onClick={onOpenUpload}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Upload Another Layout</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Split: CAD Viewport + Right Station Metadata Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-9 flex flex-col">
          <CadDrawingViewer
            sourceLayout={project.sourceLayout}
            stationTitle={`${project.metadata.stationName} (${project.metadata.stationCode})`}
            project={project}
            selectedRouteId={selectedRoute ? selectedRoute.slNo : null}
          />
        </div>

        {/* Right Station Metadata & Route Inspector */}
        <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-start">
          {!selectedRoute ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-display font-semibold text-slate-900">
                    CAD Metadata &amp; Station Info
                  </h3>
                </div>
                {onUpdateMetadata && !isEditingMetadata && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditName(project.metadata.stationName);
                      setEditCode(project.metadata.stationCode);
                      setEditId(project.metadata.stationId);
                      setIsEditingMetadata(true);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer shrink-0 transition-colors"
                    title="Edit Station Name, Code & ID"
                  >
                    <Edit2 className="w-3 h-3" aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                )}
              </div>

              {isEditingMetadata ? (
                <div className="pt-3 border-t border-slate-200 space-y-3 text-xs bg-slate-50 p-2.5 rounded-md border border-slate-200">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-slate-700">Station Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="e.g. STATION NAME"
                      className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white font-medium focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-slate-700">
                      Station Code (2-5 letters)
                    </label>
                    <input
                      type="text"
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                      placeholder="e.g. STN"
                      className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white font-mono uppercase focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-slate-700">
                      Station ID (Numeric)
                    </label>
                    <input
                      type="text"
                      value={editId}
                      onChange={(e) => setEditId(e.target.value)}
                      placeholder="e.g. 520"
                      className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white font-mono focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsEditingMetadata(false)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 border border-slate-300 rounded bg-white cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                      <span>Cancel</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (onUpdateMetadata) {
                          onUpdateMetadata({
                            stationName: editName.trim() || project.metadata.stationName,
                            stationCode:
                              editCode.trim().toUpperCase() || project.metadata.stationCode,
                            stationId: editId.trim() || project.metadata.stationId,
                          });
                        }
                        setIsEditingMetadata(false);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>Save</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="pt-3 border-t border-slate-200 space-y-2.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 shrink-0">Station Name</span>
                    <span className="font-semibold text-slate-900 text-right">
                      {project.metadata.stationName}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 shrink-0">Station Code</span>
                    <span className="font-mono font-bold text-blue-900 bg-blue-50 px-1.5 py-0.5 rounded">
                      {project.metadata.stationCode}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 shrink-0">Station ID</span>
                    <span className="font-mono tabular-nums font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">
                      {project.metadata.stationId}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 shrink-0">Chainage Direction</span>
                    <span className="font-mono text-slate-900">
                      {project.metadata.chainageDirection === "LEFT_INCREASING"
                        ? "← Inc. Left"
                        : project.metadata.chainageDirection === "RIGHT_INCREASING"
                          ? "Inc. Right →"
                          : "--"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 shrink-0">Left Adjacent</span>
                    <span className="font-mono text-slate-900">
                      {project.metadata.nextUpStationId}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 shrink-0">Right Adjacent</span>
                    <span className="font-mono text-slate-900">
                      {project.metadata.nextDownStationId}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 shrink-0">Level Crossings</span>
                    <span className="font-mono tabular-nums text-slate-900">
                      {project.levelCrossings.length}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="font-display font-semibold text-sm text-slate-900">
                  Route #{selectedRoute.slNo}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectRoute(null)}
                  className="text-blue-700 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
              <div className="flex items-center gap-2 font-mono font-semibold text-sm text-slate-900">
                <span>{selectedRoute.entrySignal}</span>
                {selectedRoute.direction === "DOWN" ? (
                  <ArrowRight className="w-3.5 h-3.5 text-blue-700" />
                ) : (
                  <ArrowLeft className="w-3.5 h-3.5 text-blue-700" />
                )}
                <span>{selectedRoute.exitSignal}</span>
              </div>
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Line</span>
                  <span className="font-medium text-slate-900">{selectedRoute.leadingToLine}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Signal Distance</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {selectedRoute.distanceBetweenSignalsM > 0
                      ? `${selectedRoute.distanceBetweenSignalsM} m`
                      : "--"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Entry Foot Tag</span>
                  <span className="font-mono text-amber-800 font-medium">
                    {selectedRoute.entryFootTag}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Points Normal</span>
                  <span className="font-mono text-emerald-800">
                    {selectedRoute.pointsNormal.join(", ") || "--"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Points Reverse</span>
                  <span className="font-mono text-amber-800">
                    {selectedRoute.pointsReverse.join(", ") || "--"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">TINs Free</span>
                  <span className="font-mono text-slate-900">
                    {selectedRoute.tinsRequiresFree.join(", ") || "--"}
                  </span>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-200">
                <span className="text-slate-500 block mb-1">RFID Linking / En-Route Sequence</span>
                <p className="font-mono text-[11px] text-slate-800 leading-relaxed break-words">
                  {selectedRoute.linkingSequence.length > 0
                    ? selectedRoute.linkingSequence
                        .map((s) => `(${s.distanceM}, ${s.tagId})`)
                        .join(" · ")
                    : selectedRoute.enRouteTags.join(", ") || "--"}
                </p>
              </div>
              {selectedRoute.sourceNotes && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-amber-900 leading-relaxed">
                  {selectedRoute.sourceNotes}
                </div>
              )}
              <button
                type="button"
                onClick={() => onJumpToValidation(selectedRoute.slNo)}
                className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium rounded-md transition-colors cursor-pointer"
              >
                Inspect Validation Checks
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
