import React, { useState } from "react";
import {
  Compass,
  Database,
  ShieldCheck,
  FileSpreadsheet,
  Upload,
  RotateCcw,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import type { StationProject } from "@/types/signalling";

export type WorkspaceTab = "schematic" | "inventory" | "validation" | "toc";

interface SidebarNavProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onResetApp?: () => void;
  onOpenUpload: () => void;
  project: StationProject | null;
  openErrors?: number;
  openWarnings?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface NavItemConfig {
  id: WorkspaceTab;
  label: string;
  description: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItemConfig[] = [
  {
    id: "schematic",
    label: "Track Schematic",
    description: "Interactive CAD / Layout viewer",
    icon: Compass,
  },
  {
    id: "inventory",
    label: "Extracted Data",
    description: "Signals, points, tracks & RFID tags",
    icon: Database,
  },
  {
    id: "validation",
    label: "Engineer Validation",
    description: "Rule checks & consistency audit",
    icon: ShieldCheck,
  },
  {
    id: "toc",
    label: "TOC Output",
    description: "Selection Table & KAVACH TOC",
    icon: FileSpreadsheet,
  },
];

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeTab,
  onSelectTab,
  onResetApp,
  onOpenUpload,
  project,
  openErrors = 0,
  openWarnings = 0,
  collapsed: controlledCollapsed,
  onToggleCollapse,
}) => {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;
  const toggleCollapse = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalCollapsed((prev) => !prev);
    }
  };

  return (
    <>
      {/* Mobile Top Bar (only visible on mobile screens < lg) */}
      <div className="lg:hidden no-print sticky top-0 z-30 bg-slate-900 text-white px-4 py-3 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
            XT
          </div>
          <span className="font-display font-bold text-sm tracking-tight">X-Tractor</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-1.5 text-slate-300 hover:text-white rounded-md hover:bg-slate-800 cursor-pointer"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Main Professional Sidebar Container */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 bg-slate-900 text-slate-200 border-r border-slate-800 flex flex-col justify-between transition-all duration-200 ease-in-out lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0 w-72" : "-translate-x-0 max-lg:-translate-x-full"
        } ${isCollapsed ? "lg:w-20" : "lg:w-72"}`}
      >
        {/* Top Section: Brand + Active Station Card */}
        <div className="flex flex-col flex-1 overflow-y-auto min-h-0">
          {/* Header Brand */}
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between gap-2">
            {!isCollapsed ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (onResetApp) onResetApp();
                    else onSelectTab("schematic");
                  }}
                  className="flex items-center gap-3 text-left group cursor-pointer"
                  title="Return to home / reset"
                >
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center font-black text-sm tracking-tighter shadow-md shadow-blue-900/40 group-hover:from-blue-600 group-hover:to-blue-800 transition-all">
                    XT
                  </div>
                  <div>
                    <div className="font-display font-extrabold text-white text-base tracking-tight leading-none group-hover:text-blue-400 transition-colors">
                      X-Tractor
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1 font-medium tracking-normal">
                      Signalling &amp; TOC
                    </div>
                  </div>
                </button>

                {/* Collapse button for desktop */}
                <button
                  type="button"
                  onClick={toggleCollapse}
                  className="hidden lg:flex p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              </>
            ) : (
              <div className="w-full flex flex-col items-center gap-3">
                <div
                  className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center font-black text-sm tracking-tighter shadow-md shadow-blue-900/40 cursor-pointer"
                  onClick={() => {
                    if (onResetApp) onResetApp();
                    else onSelectTab("schematic");
                  }}
                  title="X-Tractor"
                >
                  XT
                </div>
                <button
                  type="button"
                  onClick={toggleCollapse}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                  title="Expand sidebar"
                  aria-label="Expand sidebar"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Active Station Card (when a project is uploaded) */}
          {project ? (
            !isCollapsed ? (
              <div className="p-3.5 mx-3 mt-3 bg-slate-800/70 border border-slate-700/60 rounded-lg space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                      Active Station
                    </div>
                    <div className="text-sm font-semibold text-white truncate mt-0.5">
                      {project.metadata.stationName || "Loaded Layout"}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 shrink-0">
                    {project.metadata.stationCode || "STN"}
                  </span>
                </div>

                <div className="text-[11px] text-slate-300 flex items-center justify-between pt-1 border-t border-slate-700/50">
                  <span className="text-slate-400 font-mono">
                    ID: {project.metadata.stationId || "--"}
                  </span>
                  <span
                    className="text-slate-400 truncate max-w-[120px] text-right"
                    title={project.sourceLayout?.fileName}
                  >
                    {project.sourceLayout?.fileName || "Layout"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onOpenUpload();
                    setMobileOpen(false);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 bg-slate-700/80 hover:bg-slate-700 hover:text-white rounded border border-slate-600/60 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Another Layout</span>
                </button>
              </div>
            ) : (
              <div className="p-2 mx-2 mt-2 flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => onOpenUpload()}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-white transition-colors cursor-pointer"
                  title={`Active: ${project.metadata.stationName || "Loaded Layout"} (${project.metadata.stationCode || "STN"}). Click to upload another layout.`}
                >
                  <Upload className="w-4 h-4" />
                </button>
              </div>
            )
          ) : (
            !isCollapsed ? (
              <div className="p-3.5 mx-3 mt-3 bg-blue-950/40 border border-blue-800/40 rounded-lg">
                <div className="text-xs font-semibold text-blue-200">No Layout Loaded</div>
                <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                  Upload a station layout drawing (.dwg, .dxf, .pdf) to start processing.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onOpenUpload();
                    setMobileOpen(false);
                  }}
                  className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors cursor-pointer shadow-xs"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Layout</span>
                </button>
              </div>
            ) : (
              <div className="p-2 mx-2 mt-2 flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => onOpenUpload()}
                  className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors cursor-pointer shadow-xs"
                  title="Upload Layout"
                >
                  <Upload className="w-4 h-4" />
                </button>
              </div>
            )
          )}

          {/* Navigation Items */}
          <nav className="p-2 space-y-1.5 mt-2" aria-label="Workbench sections">
            {!isCollapsed && (
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Workbench Modules
              </div>
            )}

            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              const Icon = item.icon;

              if (isCollapsed) {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelectTab(item.id);
                      setMobileOpen(false);
                    }}
                    className={`w-full relative flex items-center justify-center p-3 rounded-lg transition-all cursor-pointer group ${
                      isActive
                        ? "bg-blue-600 text-white shadow-sm shadow-blue-900/30"
                        : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                    }`}
                    title={`${item.label} - ${item.description}`}
                  >
                    <Icon className="w-5 h-5" />
                    {/* Badge notification dot */}
                    {item.id === "validation" && openErrors > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-rose-500 border border-slate-900" />
                    )}
                    {item.id === "validation" && openErrors === 0 && openWarnings > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-amber-500 border border-slate-900" />
                    )}
                  </button>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectTab(item.id);
                    setMobileOpen(false);
                  }}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-all cursor-pointer group ${
                    isActive
                      ? "bg-blue-600 text-white shadow-sm shadow-blue-900/30"
                      : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      isActive ? "text-white" : "text-slate-400 group-hover:text-slate-200"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold tracking-tight">{item.label}</span>

                      {/* Dynamic badge counts */}
                      {item.id === "schematic" && project && (
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                            isActive ? "bg-blue-700 text-blue-100" : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {project.tracks.length}T
                        </span>
                      )}
                      {item.id === "inventory" && project && (
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                            isActive ? "bg-blue-700 text-blue-100" : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {project.signals.length}S · {project.points.length}P
                        </span>
                      )}
                      {item.id === "validation" && project && (
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold transition-colors ${
                            openErrors > 0
                              ? "bg-rose-500/30 text-rose-300 border border-rose-500/40"
                              : openWarnings > 0
                                ? "bg-amber-500/30 text-amber-300 border border-amber-500/40"
                                : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          }`}
                        >
                          {openErrors > 0
                            ? `${openErrors} Err`
                            : openWarnings > 0
                              ? `${openWarnings} Warn`
                              : "0 Issues"}
                        </span>
                      )}
                      {item.id === "toc" && project && (
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                            isActive ? "bg-blue-700 text-blue-100" : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {project.routes.length} R
                        </span>
                      )}
                    </div>
                    <div
                      className={`text-[11px] truncate mt-0.5 ${
                        isActive ? "text-blue-100/80" : "text-slate-400"
                      }`}
                    >
                      {item.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Bar: Version & Reset */}
        <div className="p-3 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs text-slate-400">
          {!isCollapsed ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-300">X-Tractor</span>
                <span className="text-slate-600">·</span>
                <span className="text-[11px] font-mono text-slate-400">v2.4</span>
              </div>

              {onResetApp && (
                <button
                  type="button"
                  onClick={onResetApp}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer px-2 py-1 rounded hover:bg-slate-800"
                  title="Reset session and unload layout"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              )}
            </>
          ) : (
            <div className="w-full flex justify-center">
              {onResetApp && (
                <button
                  type="button"
                  onClick={onResetApp}
                  className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer rounded hover:bg-slate-800"
                  title="Reset session"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Backdrop for mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  );
};
