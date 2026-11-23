import React, { useMemo, useState } from "react";
import {
  Bold,
  Check,
  CheckCircle2,
  Download,
  Edit3,
  FileSpreadsheet,
  GitBranch,
  MousePointer,
  Palette,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Type,
  X,
} from "lucide-react";
import { recomputeRouteFromTags } from "../engine/validator";
import type { LinkingTuple, StationProject, TocFormatMode, TocRouteRow } from "../types/signalling";
import {
  exportCanonicalJson,
  exportTocToCsv,
  exportTocToExcel,
  exportTocToPdf,
} from "../utils/exportToc";

interface TocTableViewProps {
  project: StationProject;
  highlightedRouteSlNo: number | null;
  onChangeFormat: (mode: TocFormatMode) => void;
  onUpdateRoute: (slNo: number, patch: Partial<TocRouteRow>) => void;
  onHighlightOnSchematic: (slNo: number) => void;
}

type TableSection = "selection" | "track_profile" | "tsr" | "tsl" | "block_sos" | "tag_inventory";

interface CellStyle {
  fontSize?: string;
  fontFamily?: string;
  bold?: boolean;
  color?: string;
}

interface EditRowState {
  entrySignal: string;
  exitSignal: string;
  leadingToLine: string;
  sectionType: string;
  signalType: string;
  aspectOfEntrySignal: string;
  requiresAspectOfExitSignal: string;
  requiredRouteLocking: string;
  pointsNormal: string;
  pointsReverse: string;
  trackCktUp: string;
  trackCircuitInOverlap: string;
  tinsRequiresFree: string;
  tinsInOverlap: string;
  entryFootTag: string;
  linkingSequence: string;
  distanceBetweenSignalsM: number;
  movementAuthoritySections: string;
  authorizedSpeedSr: string;
  authorizedSpeedOs: string;
}

export const TocTableView: React.FC<TocTableViewProps> = ({
  project,
  highlightedRouteSlNo,
  onChangeFormat,
  onUpdateRoute,
  onHighlightOnSchematic,
}) => {
  const [section, setSection] = useState<TableSection>("selection");
  const [dirFilter, setDirFilter] = useState<"ALL" | "DOWN" | "UP">("ALL");
  const [search, setSearch] = useState("");
  const [editingSlNo, setEditingSlNo] = useState<number | null>(null);
  const [editRowState, setEditRowState] = useState<EditRowState | null>(null);

  // Typography & Styling toolbar state
  const [tableFontSize, setTableFontSize] = useState<string>("12px");
  const [tableFontFamily, setTableFontFamily] = useState<string>("JetBrains Mono, monospace");
  const [tableBold, setTableBold] = useState<boolean>(false);
  const [tableTextColor, setTableTextColor] = useState<string>("");
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null);
  const [cellStyles, setCellStyles] = useState<Record<string, CellStyle>>({});

  const isStandardSelection = project.tocFormatPreference !== "TCAS_TOC";

  const normalRoutes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return project.routes.filter((r) => {
      if (dirFilter !== "ALL" && r.direction !== dirFilter) return false;
      if (!q) return true;
      return (
        r.entrySignal.toLowerCase().includes(q) ||
        r.exitSignal.toLowerCase().includes(q) ||
        r.leadingToLine.toLowerCase().includes(q) ||
        r.entryFootTag.toLowerCase().includes(q) ||
        r.tinsRequiresFree.join(",").toLowerCase().includes(q)
      );
    });
  }, [project.routes, dirFilter, search]);

  const tslCount = useMemo(
    () => project.tslRoutes?.length || project.routes.filter((r) => r.isTsl).length,
    [project],
  );

  // Helper to infer signal attributes strictly following user rules
  const inferSignalAttributes = (sig: string, line: string) => {
    let cleanSig = sig.trim().toUpperCase();
    if (cleanSig && !cleanSig.startsWith("S")) {
      cleanSig = `S${cleanSig}`;
    }
    const isLoop = /LOOP/i.test(line);

    let inferredSignalType = "Home Signal";
    let inferredSectionType = "Station Section";

    if (cleanSig.endsWith("ID") || cleanSig.endsWith(" ID")) {
      inferredSignalType = "Inner Distant";
      inferredSectionType = "Absolute Block Section";
    } else if (cleanSig.endsWith("D") || cleanSig.endsWith(" D")) {
      inferredSignalType = "Distant Signal";
      inferredSectionType = "Absolute Block Section";
    } else if (cleanSig.endsWith("A") || cleanSig.endsWith(" A")) {
      inferredSignalType = "Calling-on Signal";
      inferredSectionType = "Station Section";
    } else if (isLoop) {
      inferredSignalType = "Starter";
      inferredSectionType = "Station Section";
    } else {
      inferredSignalType = "Home Signal";
      inferredSectionType = "Station Section";
    }

    return { cleanSig, inferredSignalType, inferredSectionType };
  };

  const getCellStyle = (cellKey: string): React.CSSProperties => {
    const specific = cellStyles[cellKey] || {};
    return {
      fontSize: specific.fontSize || tableFontSize,
      fontFamily: specific.fontFamily || (tableFontFamily || undefined),
      fontWeight: (specific.bold !== undefined ? specific.bold : tableBold) ? "700" : undefined,
      color: specific.color || (tableTextColor || undefined),
    };
  };

  const handleApplyFontSize = (size: string) => {
    if (selectedCellKey) {
      setCellStyles((prev) => ({
        ...prev,
        [selectedCellKey]: { ...prev[selectedCellKey], fontSize: size },
      }));
    } else {
      setTableFontSize(size);
    }
  };

  const handleApplyFontFamily = (family: string) => {
    if (selectedCellKey) {
      setCellStyles((prev) => ({
        ...prev,
        [selectedCellKey]: { ...prev[selectedCellKey], fontFamily: family },
      }));
    } else {
      setTableFontFamily(family);
    }
  };

  const handleToggleBold = () => {
    if (selectedCellKey) {
      const curr =
        cellStyles[selectedCellKey]?.bold !== undefined ? cellStyles[selectedCellKey].bold : tableBold;
      setCellStyles((prev) => ({
        ...prev,
        [selectedCellKey]: { ...prev[selectedCellKey], bold: !curr },
      }));
    } else {
      setTableBold((prev) => !prev);
    }
  };

  const handleApplyColor = (color: string) => {
    if (selectedCellKey) {
      setCellStyles((prev) => ({
        ...prev,
        [selectedCellKey]: { ...prev[selectedCellKey], color },
      }));
    } else {
      setTableTextColor(color);
    }
  };

  const handleResetStyles = () => {
    setCellStyles({});
    setTableFontSize("12px");
    setTableFontFamily("JetBrains Mono, monospace");
    setTableBold(false);
    setTableTextColor("");
    setSelectedCellKey(null);
  };

  const handleStartEdit = (r: TocRouteRow) => {
    setEditingSlNo(r.slNo);
    const primaryAspect =
      r.aspectPermutations?.[0]?.aspectOfEntrySignal ||
      r.aspectOfEntrySignal ||
      r.entryAspectSummary ||
      "Green";
    const primaryExitAspect =
      r.aspectPermutations?.[0]?.requiresAspectOfExitSignal ||
      r.requiresAspectOfExitSignal ||
      r.exitAspectsSummary ||
      `${r.exitSignal} Green`;
    const primaryMa =
      r.aspectPermutations?.[0]?.movementAuthoritySections ||
      r.movementAuthoritySections ||
      "4";
    const primaryOsSpeed =
      r.aspectPermutations?.[0]?.authorizedSpeedOs || r.authorizedSpeedOs || "MPS";
    const primarySrSpeed =
      r.aspectPermutations?.[0]?.authorizedSpeedSr || r.authorizedSpeedSr || "MPS";

    const seqParts: string[] = [];
    for (const s of r.linkingSequence) {
      if (s.tagId !== r.entryFootTag) seqParts.push(`(${s.distanceM}, ${s.tagId})`);
    }
    const displaySeq =
      seqParts.length > 0
        ? seqParts.join(", ")
        : r.enRouteTags.filter((t) => t !== r.entryFootTag).join(", ");

    let entrySig = r.entrySignal.trim();
    if (!entrySig.startsWith("S")) {
      entrySig = `S${entrySig}`;
    }

    setEditRowState({
      entrySignal: entrySig,
      exitSignal: r.exitSignal,
      leadingToLine: r.leadingToLine || "DN MAIN",
      sectionType:
        r.sectionType ||
        (entrySig.endsWith("D") || entrySig.endsWith("ID")
          ? "Absolute Block Section"
          : "Station Section"),
      signalType: r.signalType || "Home Signal",
      aspectOfEntrySignal: primaryAspect,
      requiresAspectOfExitSignal: primaryExitAspect,
      requiredRouteLocking: r.requiredRouteLocking || "",
      pointsNormal: r.pointsNormal.join(", "),
      pointsReverse: r.pointsReverse.join(", "),
      trackCktUp: r.trackCktUp || "",
      trackCircuitInOverlap: r.trackCircuitInOverlap || r.overlapTrackCkt || "",
      tinsRequiresFree: r.tinsRequiresFree.join(", "),
      tinsInOverlap: r.tinsInOverlap?.join(", ") || r.overlapTins?.join(", ") || "",
      entryFootTag: r.entryFootTag.startsWith("R-")
        ? r.entryFootTag
        : r.entryFootTag
          ? `R-${r.entryFootTag.replace(/^R-?/i, "")}`
          : "",
      linkingSequence: displaySeq,
      distanceBetweenSignalsM: r.distanceBetweenSignalsM,
      movementAuthoritySections: primaryMa,
      authorizedSpeedSr: primarySrSpeed,
      authorizedSpeedOs: primaryOsSpeed,
    });
  };

  const handleSaveEdit = (slNo: number) => {
    if (!editRowState) return;

    let formattedEntrySig = editRowState.entrySignal.trim();
    if (!formattedEntrySig.toUpperCase().startsWith("S")) {
      formattedEntrySig = `S${formattedEntrySig}`;
    }

    let formattedFootTag = editRowState.entryFootTag.trim();
    if (formattedFootTag && !formattedFootTag.toUpperCase().startsWith("R-")) {
      formattedFootTag = `R-${formattedFootTag.replace(/^R-?/i, "")}`;
    }

    const normPointsNormal = editRowState.pointsNormal
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        if (/^\d+[A-Z]?(\/\d+[A-Z]?)?$/.test(p)) return p;
        if (!p.toUpperCase().startsWith("P-") && /^\d+$/.test(p)) return `P-${p}`;
        return p;
      });

    const normPointsReverse = editRowState.pointsReverse
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        if (/^\d+[A-Z]?(\/\d+[A-Z]?)?$/.test(p)) return p;
        if (!p.toUpperCase().startsWith("P-") && /^\d+$/.test(p)) return `P-${p}`;
        return p;
      });

    const tinsReq = editRowState.tinsRequiresFree
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const tinsOv = editRowState.tinsInOverlap
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const seqTuples: LinkingTuple[] = [];
    const seqRegex = /\(?\s*(\d+)\s*,\s*([A-Za-z0-9_-]+)\s*\)?/g;
    let match;
    while ((match = seqRegex.exec(editRowState.linkingSequence)) !== null) {
      const dist = parseInt(match[1], 10);
      let tag = match[2];
      if (!tag.toUpperCase().startsWith("R-") && /^\d+$/.test(tag)) {
        tag = `R-${tag}`;
      }
      seqTuples.push({ distanceM: dist, tagId: tag });
    }

    const existingRoute = project.routes.find((r) => r.slNo === slNo);
    const updatedPermutations = (existingRoute?.aspectPermutations || []).map((perm, idx) => {
      if (idx === 0) {
        return {
          ...perm,
          aspectOfEntrySignal: editRowState.aspectOfEntrySignal,
          requiresAspectOfExitSignal: editRowState.requiresAspectOfExitSignal,
          movementAuthoritySections: editRowState.movementAuthoritySections,
          authorizedSpeedSr: editRowState.authorizedSpeedSr,
          authorizedSpeedOs: editRowState.authorizedSpeedOs,
        };
      }
      return perm;
    });

    const patch: Partial<TocRouteRow> = {
      entrySignal: formattedEntrySig,
      exitSignal: editRowState.exitSignal.trim(),
      leadingToLine: editRowState.leadingToLine.trim(),
      tsrmsRouteId: editRowState.tsrmsRouteId.trim(),
      sectionType: editRowState.sectionType.trim(),
      signalType: editRowState.signalType.trim(),
      aspectOfEntrySignal: editRowState.aspectOfEntrySignal,
      requiresAspectOfExitSignal: editRowState.requiresAspectOfExitSignal,
      requiredRouteLocking: editRowState.requiredRouteLocking.trim(),
      pointsNormal: normPointsNormal,
      pointsReverse: normPointsReverse,
      trackCktUp: editRowState.trackCktUp.trim(),
      trackCircuitInOverlap: editRowState.trackCircuitInOverlap.trim(),
      tinsRequiresFree: tinsReq,
      tinsInOverlap: tinsOv,
      entryFootTag: formattedFootTag,
      distanceBetweenSignalsM: Number(editRowState.distanceBetweenSignalsM) || 0,
      movementAuthoritySections: editRowState.movementAuthoritySections,
      authorizedSpeedSr: editRowState.authorizedSpeedSr,
      authorizedSpeedOs: editRowState.authorizedSpeedOs,
      linkingSequence: seqTuples.length > 0 ? seqTuples : existingRoute?.linkingSequence || [],
      aspectPermutations:
        updatedPermutations.length > 0
          ? updatedPermutations
          : [
              {
                aspectOfEntrySignal: editRowState.aspectOfEntrySignal,
                requiresAspectOfExitSignal: editRowState.requiresAspectOfExitSignal,
                movementAuthoritySections: editRowState.movementAuthoritySections,
                authorizedSpeedSr: editRowState.authorizedSpeedSr,
                authorizedSpeedOs: editRowState.authorizedSpeedOs,
              },
            ],
    };

    onUpdateRoute(slNo, patch);
    setEditingSlNo(null);
    setEditRowState(null);
  };

  return (
    <div className="space-y-4">
      {/* TOC Header & Export Controls */}
      <div className="no-print bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => onChangeFormat("STANDARD_SELECTION")}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                isStandardSelection
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Standard Selection Format (RDSO Amdt-6)
            </button>
            <button
              type="button"
              onClick={() => onChangeFormat("TCAS_TOC")}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                !isStandardSelection
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              TCAS Station TOC Format
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setSection("selection")}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                section === "selection"
                  ? "bg-white text-slate-900 shadow-xs font-semibold"
                  : "text-slate-600"
              }`}
            >
              Table 1: Table of Control ({project.routes.length})
            </button>
            <button
              type="button"
              onClick={() => setSection("track_profile")}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                section === "track_profile"
                  ? "bg-white text-slate-900 shadow-xs font-semibold"
                  : "text-slate-600"
              }`}
            >
              Table 2: Track Profile ({project.trackProfiles?.length || project.routes.length})
            </button>
            <button
              type="button"
              onClick={() => setSection("tsr")}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                section === "tsr"
                  ? "bg-white text-slate-900 shadow-xs font-semibold"
                  : "text-slate-600"
              }`}
            >
              Table 3: TSR Routes ({project.tsrRoutes?.length || project.tracks.length})
            </button>
            <button
              type="button"
              onClick={() => setSection("tsl")}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                section === "tsl"
                  ? "bg-white text-slate-900 shadow-xs font-semibold"
                  : "text-slate-600"
              }`}
            >
              Table 4: TSL Working ({tslCount})
            </button>
            <button
              type="button"
              onClick={() => setSection("block_sos")}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                section === "block_sos"
                  ? "bg-white text-slate-900 shadow-xs font-semibold"
                  : "text-slate-600"
              }`}
            >
              Block &amp; Shunting Limits ({project.blockSections?.length || 0})
            </button>
            <button
              type="button"
              onClick={() => setSection("tag_inventory")}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                section === "tag_inventory"
                  ? "bg-white text-slate-900 shadow-xs font-semibold"
                  : "text-slate-600"
              }`}
            >
              Tag &amp; TIN Allotment ({project.tags.length})
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => exportTocToExcel(project, section)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md cursor-pointer whitespace-nowrap"
            title="Export currently selected table to Excel"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            onClick={() => exportTocToCsv(project, section)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap"
            title="Export currently selected table to CSV"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={() => exportCanonicalJson(project, section)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap"
            title="Export currently selected table to JSON"
          >
            <span>JSON</span>
          </button>
          <button
            type="button"
            onClick={() => exportTocToPdf(project, section)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer whitespace-nowrap"
            title="Print currently selected table as PDF"
          >
            <Printer className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Print PDF</span>
          </button>
        </div>
      </div>

      {/* Engineering Drawing Container matching Indian Railways RDSO Amdt-6 Layout */}
      <div className="print-full bg-white border border-slate-200 rounded-lg overflow-hidden">
        {/* TOP 5%: Authentic Indian Railways Station Details Common Header (Pages 16 & 17) */}
        <div className="p-3.5 border-b-2 border-slate-800 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-6 text-sm font-sans font-bold text-slate-900 mb-2">
            <div className="flex items-center gap-10">
              <div>
                <span className="font-normal text-slate-600">Station Name: </span>
                <span>{project.metadata.stationName || "----"}</span>
              </div>
              <div>
                <span className="font-normal text-slate-600">Division: </span>
                <span>{project.metadata.division || "----"}</span>
              </div>
            </div>
            <div className="flex items-center gap-10">
              <div>
                <span className="font-normal text-slate-600">Station ID: </span>
                <span>{project.metadata.stationId || "----"}</span>
              </div>
              <div>
                <span className="font-normal text-slate-600">Section: </span>
                <span>{project.metadata.section || "Station Section"}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
            <div className="text-xs text-slate-600">
              <span className="font-bold text-slate-800">Specification: </span>
              <span className="font-semibold text-emerald-800">RDSO/SPN/196/2020 Version 4.0 Amdt-6</span>
            </div>

            <div className="no-print flex items-center gap-3">
              <div className="flex items-center gap-1 p-0.5 bg-white border border-slate-200 rounded text-xs">
                {(["ALL", "DOWN", "UP"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirFilter(d)}
                    className={`px-2 py-1 rounded font-medium cursor-pointer ${
                      dirFilter === d
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search signal, TIN, tag..."
                  className="pl-7 pr-3 py-1 text-xs border border-slate-300 rounded bg-white w-48 focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Typography & Formatting Toolbar */}
        <div className="no-print p-3 border-b border-slate-200 bg-slate-50/90 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
              <Type className="w-4 h-4 text-slate-600" />
              <span>Typography &amp; Style:</span>
            </span>

            {/* Target indicator */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-white border border-slate-200 text-xs shadow-2xs">
              <MousePointer
                className={`w-3.5 h-3.5 ${selectedCellKey ? "text-blue-600 animate-pulse" : "text-slate-400"}`}
              />
              {selectedCellKey ? (
                <>
                  <span className="font-medium text-blue-900">
                    Target Cell: <span className="font-mono font-bold">{selectedCellKey}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedCellKey(null)}
                    className="ml-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    title="Deselect cell and target entire table"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-slate-600 font-medium">Target: Entire Table</span>
              )}
            </div>

            {/* Font Family selector */}
            <div className="flex items-center gap-1">
              <select
                value={
                  selectedCellKey && cellStyles[selectedCellKey]?.fontFamily !== undefined
                    ? cellStyles[selectedCellKey].fontFamily
                    : tableFontFamily
                }
                onChange={(e) => handleApplyFontFamily(e.target.value)}
                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-800 focus:outline-none focus:border-blue-600 cursor-pointer font-medium"
                title="Font Type / Family"
              >
                <option value="JetBrains Mono, monospace">JetBrains Mono (Monospace)</option>
                <option value="Inter, sans-serif">Inter (Modern Sans)</option>
                <option value="Arial, sans-serif">Arial (Standard Sans)</option>
                <option value="Roboto, sans-serif">Roboto (Clean Sans)</option>
                <option value="Courier New, monospace">Courier New (Fixed Width)</option>
                <option value="Georgia, serif">Georgia (Serif)</option>
              </select>
            </div>

            {/* Font Size selector */}
            <div className="flex items-center gap-1">
              <select
                value={
                  selectedCellKey && cellStyles[selectedCellKey]?.fontSize !== undefined
                    ? cellStyles[selectedCellKey].fontSize
                    : tableFontSize
                }
                onChange={(e) => handleApplyFontSize(e.target.value)}
                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-800 focus:outline-none focus:border-blue-600 cursor-pointer font-medium"
                title="Font Size"
              >
                <option value="10px">10px (Compact)</option>
                <option value="11px">11px (Fine)</option>
                <option value="12px">12px (Standard)</option>
                <option value="13px">13px (Medium)</option>
                <option value="14px">14px (Large)</option>
                <option value="16px">16px (Extra Large)</option>
              </select>
            </div>

            {/* Bold Toggle */}
            <button
              type="button"
              onClick={handleToggleBold}
              className={`px-2.5 py-1 border rounded font-bold cursor-pointer transition-colors inline-flex items-center gap-1 ${
                (selectedCellKey && cellStyles[selectedCellKey]?.bold !== undefined
                  ? cellStyles[selectedCellKey].bold
                  : tableBold)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
              }`}
              title="Toggle Bold (B)"
            >
              <Bold className="w-3.5 h-3.5" />
              <span>Bold</span>
            </button>

            {/* Color Palette */}
            <div className="flex items-center gap-1 pl-1 border-l border-slate-300">
              <Palette className="w-3.5 h-3.5 text-slate-500 mr-0.5" />
              {[
                { label: "Default", color: "" },
                { label: "Slate", color: "#0f172a" },
                { label: "Blue", color: "#1d4ed8" },
                { label: "Emerald", color: "#047857" },
                { label: "Crimson", color: "#b91c1c" },
                { label: "Amber", color: "#b45309" },
                { label: "Purple", color: "#6d28d9" },
              ].map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => handleApplyColor(c.color)}
                  className={`w-5 h-5 rounded-full border cursor-pointer transition-transform hover:scale-110 flex items-center justify-center ${
                    !c.color
                      ? "border-slate-400 bg-white"
                      : "border-slate-300 shadow-2xs"
                  }`}
                  style={{ backgroundColor: c.color || "#f8fafc" }}
                  title={`${c.label} text color`}
                >
                  {!c.color && <span className="text-[9px] text-slate-500 font-bold">D</span>}
                </button>
              ))}

              {/* Custom color input */}
              <input
                type="color"
                value={
                  selectedCellKey && cellStyles[selectedCellKey]?.color
                    ? cellStyles[selectedCellKey].color
                    : tableTextColor || "#0f172a"
                }
                onChange={(e) => handleApplyColor(e.target.value)}
                className="w-6 h-6 p-0 border border-slate-300 rounded cursor-pointer bg-transparent"
                title="Custom Color"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetStyles}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-600 hover:text-slate-900 border border-slate-300 bg-white hover:bg-slate-100 rounded cursor-pointer text-xs transition-colors"
              title="Reset all custom font formatting and cell colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Formatting</span>
            </button>
          </div>
        </div>

        {/* ================================================================= */}
        {/* TABLE 1: Stationary KAVACH Table of Control                       */}
        {/* ================================================================= */}
        {section === "selection" && (
          <div className="overflow-x-auto">
            <table
              className="w-full text-left border-collapse"
              style={{ fontSize: tableFontSize, fontFamily: tableFontFamily }}
            >
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-semibold">
                  <th className="py-2.5 px-2 border-r border-slate-200">S.No</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Entry Sig</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Exit Sig</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Line</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Section Type</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Signal Type</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Aspect of Entry Sig</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Requires Aspects Exit</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Req Route Locking</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Pts Normal</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Pts Reverse</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Track Ckt (Route)</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Track Ckt (Overlap)</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">TINs Free (Route)</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">TINs Free (Overlap)</th>
                  <th className="py-2.5 px-2 border-r border-slate-200">Foot Tag</th>
                  <th className="py-2.5 px-2 border-r border-slate-200 min-w-[200px]">
                    Check RFID Sequence
                  </th>
                  <th className="py-2.5 px-2 border-r border-slate-200 text-right">Dist (m)</th>
                  <th className="py-2.5 px-2 border-r border-slate-200 text-center">MA (Sec)</th>
                  <th className="py-2.5 px-2 border-r border-slate-200 text-center">SR Speed</th>
                  <th className="py-2.5 px-2 border-r border-slate-200 text-center">OS Speed</th>
                  <th className="py-2.5 px-2 no-print text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {normalRoutes.map((r) => {
                  const isHighlighted = highlightedRouteSlNo === r.slNo;
                  const isEditing = editingSlNo === r.slNo;
                  const seqParts: string[] = [];
                  for (const s of r.linkingSequence) {
                    if (s.tagId !== r.entryFootTag) seqParts.push(`(${s.distanceM}, ${s.tagId})`);
                  }
                  const displaySeq =
                    seqParts.length > 0
                      ? seqParts.join(", ")
                      : r.enRouteTags.filter((t) => t !== r.entryFootTag).join(", ") || "-";

                  const perms =
                    r.aspectPermutations && r.aspectPermutations.length > 0
                      ? r.aspectPermutations
                      : [
                          {
                            aspectOfEntrySignal:
                              r.aspectOfEntrySignal || r.entryAspectSummary || "Green",
                            requiresAspectOfExitSignal:
                              r.requiresAspectOfExitSignal ||
                              r.exitAspectsSummary ||
                              `${r.exitSignal} Green`,
                            movementAuthoritySections: r.movementAuthoritySections || "4",
                            authorizedSpeedOs: r.authorizedSpeedOs || "MPS",
                          },
                        ];

                  // If in edit mode, render the editable row
                  if (isEditing && editRowState) {
                    const isLoop = /LOOP/i.test(editRowState.leadingToLine);
                    return (
                      <tr key={`edit-${r.slNo}`} className="bg-blue-50/90 border-2 border-blue-400">
                        <td className="py-2 px-1.5 border-r border-blue-200 font-mono font-bold text-blue-900 text-center">
                          {r.slNo}
                        </td>
                        {/* Entry Signal */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <input
                            type="text"
                            value={editRowState.entrySignal}
                            onChange={(e) => {
                              let val = e.target.value.trim();
                              if (val && !val.toUpperCase().startsWith("S")) {
                                val = `S${val}`;
                              }
                              const { inferredSignalType, inferredSectionType } =
                                inferSignalAttributes(val, editRowState.leadingToLine);
                              setEditRowState({
                                ...editRowState,
                                entrySignal: val,
                                signalType: inferredSignalType,
                                sectionType: inferredSectionType,
                              });
                            }}
                            placeholder="S1"
                            title="Signal must start with S. Ends with D = Distant, ID = Inner Distant, A = Calling-on"
                            className="w-16 px-1.5 py-0.5 border border-blue-400 rounded bg-white text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* Exit Signal */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <input
                            type="text"
                            value={editRowState.exitSignal}
                            onChange={(e) =>
                              setEditRowState({ ...editRowState, exitSignal: e.target.value })
                            }
                            placeholder="S18"
                            className="w-16 px-1.5 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* Line */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <select
                            value={editRowState.leadingToLine}
                            onChange={(e) => {
                              const line = e.target.value;
                              const { inferredSignalType, inferredSectionType } =
                                inferSignalAttributes(editRowState.entrySignal, line);
                              setEditRowState({
                                ...editRowState,
                                leadingToLine: line,
                                signalType: inferredSignalType,
                                sectionType: inferredSectionType,
                              });
                            }}
                            className="px-1.5 py-0.5 border border-slate-300 rounded bg-white text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                          >
                            <option value="DN MAIN">DN MAIN</option>
                            <option value="UP MAIN">UP MAIN</option>
                            <option value="COMMON LOOP">COMMON LOOP</option>
                            <option value="UP LOOP">UP LOOP</option>
                            <option value="DN LOOP">DN LOOP</option>
                          </select>
                        </td>
                        {/* Section Type */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <select
                            value={editRowState.sectionType}
                            onChange={(e) =>
                              setEditRowState({ ...editRowState, sectionType: e.target.value })
                            }
                            className="px-1.5 py-0.5 border border-slate-300 rounded bg-white text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                          >
                            <option value="Station Section">Station Section</option>
                            <option value="Absolute Block Section">Absolute Block Section</option>
                          </select>
                        </td>
                        {/* Signal Type */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <select
                            value={editRowState.signalType}
                            onChange={(e) =>
                              setEditRowState({ ...editRowState, signalType: e.target.value })
                            }
                            className="px-1.5 py-0.5 border border-slate-300 rounded bg-white text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                          >
                            {isLoop ? (
                              <>
                                <option value="Starter">Starter</option>
                                <option value="Adv Starter">Adv Starter</option>
                                <option value="Loopline Starter">Loopline Starter</option>
                                <option value="Calling-on Signal">Calling-on Signal</option>
                                <option value="Shunt Signal">Shunt Signal</option>
                              </>
                            ) : (
                              <>
                                <option value="Home Signal">Home Signal</option>
                                <option value="Main Home">Main Home</option>
                                <option value="Mainline Starter">Mainline Starter</option>
                                <option value="Adv Starter">Adv Starter</option>
                                <option value="Advanced Starter">Advanced Starter</option>
                                <option value="Distant Signal">Distant Signal</option>
                                <option value="Inner Distant">Inner Distant</option>
                                <option value="Calling-on Signal">Calling-on Signal</option>
                                <option value="Automatic Stop Signal">Automatic Stop Signal</option>
                              </>
                            )}
                          </select>
                        </td>
                        {/* Aspect Entry */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <select
                            value={editRowState.aspectOfEntrySignal}
                            onChange={(e) =>
                              setEditRowState({
                                ...editRowState,
                                aspectOfEntrySignal: e.target.value,
                              })
                            }
                            className="px-1.5 py-0.5 border border-slate-300 rounded bg-white text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                          >
                            <option value="Green">Green</option>
                            <option value="Yellow">Yellow</option>
                            <option value="Double Yellow">Double Yellow</option>
                            <option value="Red">Red</option>
                            <option value="Miniature (S1 Red/Blank)">Miniature (S1 Red/Blank)</option>
                            <option value="Yellow with Pos1">Yellow with Pos1</option>
                            <option value="Yellow with Pos2">Yellow with Pos2</option>
                            <option value="Yellow with Pos3">Yellow with Pos3</option>
                            <option value="Yellow with Pos4">Yellow with Pos4</option>
                            <option value="Yellow with Pos5">Yellow with Pos5</option>
                            <option value="Yellow with Pos6">Yellow with Pos6</option>
                          </select>
                        </td>
                        {/* Requires Aspect Exit */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <input
                            type="text"
                            value={editRowState.requiresAspectOfExitSignal}
                            onChange={(e) =>
                              setEditRowState({
                                ...editRowState,
                                requiresAspectOfExitSignal: e.target.value,
                              })
                            }
                            className="w-24 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* Route Locking */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <input
                            type="text"
                            value={editRowState.requiredRouteLocking}
                            onChange={(e) =>
                              setEditRowState({
                                ...editRowState,
                                requiredRouteLocking: e.target.value,
                              })
                            }
                            placeholder="1ASR"
                            className="w-14 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono font-semibold text-center focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* Points Normal */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <input
                            type="text"
                            value={editRowState.pointsNormal}
                            onChange={(e) =>
                              setEditRowState({ ...editRowState, pointsNormal: e.target.value })
                            }
                            placeholder="11, P-13"
                            title="Points starting with P- or numbered"
                            className="w-24 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono text-emerald-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* Points Reverse */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <input
                            type="text"
                            value={editRowState.pointsReverse}
                            onChange={(e) =>
                              setEditRowState({ ...editRowState, pointsReverse: e.target.value })
                            }
                            placeholder="27A/27B"
                            className="w-24 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono text-amber-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* Track Ckt Route */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <input
                            type="text"
                            value={editRowState.trackCktUp}
                            onChange={(e) =>
                              setEditRowState({ ...editRowState, trackCktUp: e.target.value })
                            }
                            placeholder="DMT"
                            className="w-14 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* Track Ckt Overlap */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <input
                            type="text"
                            value={editRowState.trackCircuitInOverlap}
                            onChange={(e) =>
                              setEditRowState({
                                ...editRowState,
                                trackCircuitInOverlap: e.target.value,
                              })
                            }
                            className="w-14 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* TINs Free Route */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <input
                            type="text"
                            value={editRowState.tinsRequiresFree}
                            onChange={(e) =>
                              setEditRowState({
                                ...editRowState,
                                tinsRequiresFree: e.target.value,
                              })
                            }
                            placeholder="N-46, N-52"
                            className="w-28 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* TINs Free Overlap */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <input
                            type="text"
                            value={editRowState.tinsInOverlap}
                            onChange={(e) =>
                              setEditRowState({ ...editRowState, tinsInOverlap: e.target.value })
                            }
                            className="w-16 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* Foot Tag */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <input
                            type="text"
                            value={editRowState.entryFootTag}
                            onChange={(e) => {
                              let val = e.target.value.trim();
                              if (val && !val.toUpperCase().startsWith("R-") && /^\d+$/.test(val)) {
                                val = `R-${val}`;
                              }
                              setEditRowState({ ...editRowState, entryFootTag: val });
                            }}
                            placeholder="R-678"
                            title="RFID tags strictly start with R-"
                            className="w-16 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono font-bold text-amber-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* Check RFID Sequence */}
                        <td className="py-2 px-1 border-r border-blue-200">
                          <input
                            type="text"
                            value={editRowState.linkingSequence}
                            onChange={(e) =>
                              setEditRowState({
                                ...editRowState,
                                linkingSequence: e.target.value,
                              })
                            }
                            placeholder="(810, R-680), (190, R-682)"
                            className="w-48 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* Dist (m) */}
                        <td className="py-2 px-1 border-r border-blue-200 text-right">
                          <input
                            type="number"
                            value={editRowState.distanceBetweenSignalsM}
                            onChange={(e) =>
                              setEditRowState({
                                ...editRowState,
                                distanceBetweenSignalsM: Number(e.target.value) || 0,
                              })
                            }
                            className="w-16 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* MA (Sec) */}
                        <td className="py-2 px-1 border-r border-blue-200 text-center">
                          <select
                            value={editRowState.movementAuthoritySections}
                            onChange={(e) =>
                              setEditRowState({
                                ...editRowState,
                                movementAuthoritySections: e.target.value,
                              })
                            }
                            className="px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-600"
                          >
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                          </select>
                        </td>
                        {/* SR Speed */}
                        <td className="py-2 px-1 border-r border-blue-200 text-center">
                          <input
                            type="text"
                            value={editRowState.authorizedSpeedSr}
                            onChange={(e) =>
                              setEditRowState({
                                ...editRowState,
                                authorizedSpeedSr: e.target.value,
                              })
                            }
                            placeholder="MPS"
                            className="w-12 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono text-center focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* OS Speed */}
                        <td className="py-2 px-1 border-r border-blue-200 text-center">
                          <input
                            type="text"
                            value={editRowState.authorizedSpeedOs}
                            onChange={(e) =>
                              setEditRowState({
                                ...editRowState,
                                authorizedSpeedOs: e.target.value,
                              })
                            }
                            placeholder="MPS"
                            className="w-12 px-1 py-0.5 border border-slate-300 rounded bg-white text-xs font-mono text-center focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </td>
                        {/* Actions */}
                        <td className="py-2 px-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(r.slNo)}
                              title="Save Changes"
                              className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-xs font-bold cursor-pointer shadow-xs"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Save</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSlNo(null);
                                setEditRowState(null);
                              }}
                              title="Cancel Edit"
                              className="inline-flex items-center gap-1 px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded text-xs cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Cancel</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  let prevAspect = "";
                  return perms.map((perm, pIdx) => {
                    const showAspect = perm.aspectOfEntrySignal !== prevAspect;
                    prevAspect = perm.aspectOfEntrySignal;
                    const rKey = `${r.slNo}-${pIdx}`;

                    return (
                      <tr
                        key={rKey}
                        className={`align-top transition-colors ${
                          isHighlighted
                            ? "bg-blue-50/80"
                            : r.engineerStatus === "NEEDS_REVIEW"
                              ? "bg-amber-50/30 hover:bg-amber-50/60"
                              : "hover:bg-slate-50"
                        }`}
                      >
                        {/* S.No */}
                        <td
                          style={getCellStyle(`${rKey}-slNo`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-slNo` ? null : `${rKey}-slNo`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-mono tabular-nums font-semibold text-slate-900 cursor-pointer ${
                            selectedCellKey === `${rKey}-slNo`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.slNo : ""}
                        </td>
                        {/* Entry Sig */}
                        <td
                          style={getCellStyle(`${rKey}-entrySig`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-entrySig` ? null : `${rKey}-entrySig`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-mono font-semibold text-slate-900 whitespace-nowrap cursor-pointer ${
                            selectedCellKey === `${rKey}-entrySig`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.entrySignal : ""}
                        </td>
                        {/* Exit Sig */}
                        <td
                          style={getCellStyle(`${rKey}-exitSig`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-exitSig` ? null : `${rKey}-exitSig`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-mono font-semibold text-slate-900 whitespace-nowrap cursor-pointer ${
                            selectedCellKey === `${rKey}-exitSig`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.exitSignal : ""}
                        </td>
                        {/* Line */}
                        <td
                          style={getCellStyle(`${rKey}-line`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-line` ? null : `${rKey}-line`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 text-slate-800 whitespace-nowrap cursor-pointer ${
                            selectedCellKey === `${rKey}-line`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.leadingToLine : ""}
                        </td>
                        {/* Section Type */}
                        <td
                          style={getCellStyle(`${rKey}-sectionType`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-sectionType`
                                ? null
                                : `${rKey}-sectionType`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 text-slate-700 whitespace-nowrap cursor-pointer ${
                            selectedCellKey === `${rKey}-sectionType`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.sectionType || "Station Section" : ""}
                        </td>
                        {/* Signal Type */}
                        <td
                          style={getCellStyle(`${rKey}-sigType`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-sigType` ? null : `${rKey}-sigType`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 text-slate-700 cursor-pointer ${
                            selectedCellKey === `${rKey}-sigType`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.signalType : ""}
                        </td>
                        {/* Aspect Entry */}
                        <td
                          style={getCellStyle(`${rKey}-aspectEntry`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-aspectEntry`
                                ? null
                                : `${rKey}-aspectEntry`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-medium text-slate-900 cursor-pointer ${
                            selectedCellKey === `${rKey}-aspectEntry`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {showAspect ? perm.aspectOfEntrySignal : ""}
                        </td>
                        {/* Requires Aspect Exit */}
                        <td
                          style={getCellStyle(`${rKey}-aspectExit`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-aspectExit`
                                ? null
                                : `${rKey}-aspectExit`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 text-slate-600 cursor-pointer ${
                            selectedCellKey === `${rKey}-aspectExit`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {perm.requiresAspectOfExitSignal}
                        </td>
                        {/* Req Route Locking */}
                        <td
                          style={getCellStyle(`${rKey}-locking`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-locking` ? null : `${rKey}-locking`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-mono text-center font-semibold text-slate-800 cursor-pointer ${
                            selectedCellKey === `${rKey}-locking`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.requiredRouteLocking || "-" : ""}
                        </td>
                        {/* Pts Normal */}
                        <td
                          style={getCellStyle(`${rKey}-ptsNorm`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-ptsNorm` ? null : `${rKey}-ptsNorm`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-mono text-emerald-800 cursor-pointer ${
                            selectedCellKey === `${rKey}-ptsNorm`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.pointsNormal.join(", ") || "-" : ""}
                        </td>
                        {/* Pts Reverse */}
                        <td
                          style={getCellStyle(`${rKey}-ptsRev`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-ptsRev` ? null : `${rKey}-ptsRev`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-mono text-amber-800 cursor-pointer ${
                            selectedCellKey === `${rKey}-ptsRev`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.pointsReverse.join(", ") || "-" : ""}
                        </td>
                        {/* Track Ckt Route */}
                        <td
                          style={getCellStyle(`${rKey}-tcRoute`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-tcRoute` ? null : `${rKey}-tcRoute`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-mono text-slate-700 cursor-pointer ${
                            selectedCellKey === `${rKey}-tcRoute`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.trackCktUp || "-" : ""}
                        </td>
                        {/* Track Ckt Overlap */}
                        <td
                          style={getCellStyle(`${rKey}-tcOverlap`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-tcOverlap` ? null : `${rKey}-tcOverlap`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-mono text-slate-600 cursor-pointer ${
                            selectedCellKey === `${rKey}-tcOverlap`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.trackCircuitInOverlap || r.overlapTrackCkt || "-" : ""}
                        </td>
                        {/* TINs Free Route */}
                        <td
                          style={getCellStyle(`${rKey}-tinsRoute`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-tinsRoute` ? null : `${rKey}-tinsRoute`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-mono text-slate-900 cursor-pointer ${
                            selectedCellKey === `${rKey}-tinsRoute`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.tinsRequiresFree.join(", ") || "-" : ""}
                        </td>
                        {/* TINs Free Overlap */}
                        <td
                          style={getCellStyle(`${rKey}-tinsOverlap`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-tinsOverlap`
                                ? null
                                : `${rKey}-tinsOverlap`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-mono text-slate-600 cursor-pointer ${
                            selectedCellKey === `${rKey}-tinsOverlap`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0
                            ? r.tinsInOverlap?.join(", ") || r.overlapTins?.join(", ") || "-"
                            : ""}
                        </td>
                        {/* Foot Tag */}
                        <td
                          style={getCellStyle(`${rKey}-footTag`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-footTag` ? null : `${rKey}-footTag`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-mono font-semibold text-amber-900 whitespace-nowrap cursor-pointer ${
                            selectedCellKey === `${rKey}-footTag`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.entryFootTag : ""}
                        </td>
                        {/* Check RFID Sequence */}
                        <td
                          style={getCellStyle(`${rKey}-seq`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-seq` ? null : `${rKey}-seq`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 font-mono text-[11px] text-slate-800 leading-relaxed cursor-pointer ${
                            selectedCellKey === `${rKey}-seq`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? displaySeq : ""}
                        </td>
                        {/* Dist (m) */}
                        <td
                          style={getCellStyle(`${rKey}-dist`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-dist` ? null : `${rKey}-dist`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 text-right font-mono tabular-nums font-medium text-slate-900 cursor-pointer ${
                            selectedCellKey === `${rKey}-dist`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0 ? r.distanceBetweenSignalsM : ""}
                        </td>
                        {/* MA (Sec) */}
                        <td
                          style={getCellStyle(`${rKey}-ma`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-ma` ? null : `${rKey}-ma`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 text-center font-mono font-semibold text-slate-900 cursor-pointer ${
                            selectedCellKey === `${rKey}-ma`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {perm.movementAuthoritySections}
                        </td>
                        {/* SR Speed */}
                        <td
                          style={getCellStyle(`${rKey}-srSpeed`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-srSpeed` ? null : `${rKey}-srSpeed`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 text-center font-mono font-semibold text-slate-800 cursor-pointer ${
                            selectedCellKey === `${rKey}-srSpeed`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {pIdx === 0
                            ? r.authorizedSpeedSr || perm.authorizedSpeedSr || "MPS"
                            : perm.authorizedSpeedSr || ""}
                        </td>
                        {/* OS Speed */}
                        <td
                          style={getCellStyle(`${rKey}-osSpeed`)}
                          onClick={() =>
                            setSelectedCellKey(
                              selectedCellKey === `${rKey}-osSpeed` ? null : `${rKey}-osSpeed`,
                            )
                          }
                          className={`py-2 px-2.5 border-r border-slate-200 text-center font-mono font-semibold text-slate-800 cursor-pointer ${
                            selectedCellKey === `${rKey}-osSpeed`
                              ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                              : ""
                          }`}
                        >
                          {perm.authorizedSpeedOs}
                        </td>
                        {/* Actions */}
                        <td className="py-2 px-2.5 no-print text-right whitespace-nowrap">
                          {pIdx === 0 && (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => onHighlightOnSchematic(r.slNo)}
                                title="Highlight route on schematic"
                                className="p-1 text-slate-500 hover:text-blue-700 rounded hover:bg-blue-50 cursor-pointer"
                              >
                                <GitBranch className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const recomputed = recomputeRouteFromTags(
                                    r,
                                    project.tags,
                                    project.signals,
                                  );
                                  onUpdateRoute(r.slNo, recomputed);
                                }}
                                title="Recompute linking sequence from RFID tags"
                                className="p-1 text-slate-500 hover:text-blue-700 rounded hover:bg-blue-50 cursor-pointer"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStartEdit(r)}
                                title="Edit route inline"
                                className="p-1 text-slate-500 hover:text-blue-700 rounded hover:bg-blue-50 cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateRoute(r.slNo, {
                                    engineerStatus:
                                      r.engineerStatus === "VERIFIED" ? "NEEDS_REVIEW" : "VERIFIED",
                                  })
                                }
                                title="Toggle route verification status"
                                className={`p-1 rounded cursor-pointer ${
                                  r.engineerStatus === "VERIFIED"
                                    ? "text-emerald-700 hover:bg-emerald-50"
                                    : "text-amber-700 hover:bg-amber-50"
                                }`}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ================================================================= */}
        {/* TABLE 2: Track Profile Table                                      */}
        {/* ================================================================= */}
        {section === "track_profile" && (
          <div className="overflow-x-auto">
            <table
              className="w-full text-left border-collapse"
              style={{ fontSize: tableFontSize, fontFamily: tableFontFamily }}
            >
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-semibold">
                  <th className="py-2.5 px-3 border-r border-slate-200">S.No</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Entry Sig</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Exit Sig</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Line</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">
                    Turnout Speed (kmph)
                  </th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">
                    Start Dist (m)
                  </th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">
                    Restriction Len (m)
                  </th>
                  <th className="py-2.5 px-3 border-r border-slate-200">
                    Permanent Speed Restriction
                  </th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Engineering Gradient</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Avg Gradient</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">LC Gate ID</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">LC Dist (m)</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Track Condition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(project.trackProfiles || []).map((tp, idx) => {
                  const tpKey = `tp-${idx}`;
                  return (
                    <tr
                      key={`${tp.entrySignal}-${tp.exitSignal}-${idx}`}
                      className="hover:bg-slate-50"
                    >
                      <td
                        style={getCellStyle(`${tpKey}-slNo`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-slNo` ? null : `${tpKey}-slNo`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tpKey}-slNo`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.slNo || idx + 1}
                      </td>
                      <td
                        style={getCellStyle(`${tpKey}-entrySig`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-entrySig` ? null : `${tpKey}-entrySig`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tpKey}-entrySig`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.entrySignal}
                      </td>
                      <td
                        style={getCellStyle(`${tpKey}-exitSig`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-exitSig` ? null : `${tpKey}-exitSig`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tpKey}-exitSig`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.exitSignal}
                      </td>
                      <td
                        style={getCellStyle(`${tpKey}-line`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-line` ? null : `${tpKey}-line`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-slate-700 cursor-pointer ${
                          selectedCellKey === `${tpKey}-line`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.line}
                      </td>
                      <td
                        style={getCellStyle(`${tpKey}-toSpeed`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-toSpeed` ? null : `${tpKey}-toSpeed`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums font-semibold cursor-pointer ${
                          selectedCellKey === `${tpKey}-toSpeed`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.turnoutSpeedKmph ?? "--"}
                      </td>
                      <td
                        style={getCellStyle(`${tpKey}-toStart`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-toStart` ? null : `${tpKey}-toStart`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums cursor-pointer ${
                          selectedCellKey === `${tpKey}-toStart`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.turnoutStartDistM ?? "--"}
                      </td>
                      <td
                        style={getCellStyle(`${tpKey}-toLen`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-toLen` ? null : `${tpKey}-toLen`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums cursor-pointer ${
                          selectedCellKey === `${tpKey}-toLen`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.turnoutLengthM ?? "--"}
                      </td>
                      <td
                        style={getCellStyle(`${tpKey}-psr`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-psr` ? null : `${tpKey}-psr`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono text-[11px] text-slate-800 cursor-pointer ${
                          selectedCellKey === `${tpKey}-psr`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.psrSegments && tp.psrSegments.length > 0
                          ? tp.psrSegments
                              .map((s) => `(${s.staticSpeedType}, ${s.speedKmph}, ${s.lengthM}m)`)
                              .join(" · ")
                          : "--"}
                      </td>
                      <td
                        style={getCellStyle(`${tpKey}-engGrad`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-engGrad` ? null : `${tpKey}-engGrad`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono text-[11px] text-slate-800 cursor-pointer ${
                          selectedCellKey === `${tpKey}-engGrad`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.engineeringGradients && tp.engineeringGradients.length > 0
                          ? tp.engineeringGradients
                              .map((g) => `(${g.gradientValue}, ${g.lengthM}m)`)
                              .join(", ")
                          : "--"}
                      </td>
                      <td
                        style={getCellStyle(`${tpKey}-avgGrad`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-avgGrad` ? null : `${tpKey}-avgGrad`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono text-slate-800 cursor-pointer ${
                          selectedCellKey === `${tpKey}-avgGrad`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.averageGradients && tp.averageGradients.length > 0
                          ? tp.averageGradients
                              .map((g) => `${g.avgGradientValue} ${g.lengthM}m`)
                              .join("; ")
                          : "--"}
                      </td>
                      <td
                        style={getCellStyle(`${tpKey}-lcId`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-lcId` ? null : `${tpKey}-lcId`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono text-slate-800 cursor-pointer ${
                          selectedCellKey === `${tpKey}-lcId`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.lcId || "--"}
                      </td>
                      <td
                        style={getCellStyle(`${tpKey}-lcDist`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-lcDist` ? null : `${tpKey}-lcDist`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums cursor-pointer ${
                          selectedCellKey === `${tpKey}-lcDist`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.lcDistanceM ?? "--"}
                      </td>
                      <td
                        style={getCellStyle(`${tpKey}-cond`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tpKey}-cond` ? null : `${tpKey}-cond`,
                          )
                        }
                        className={`py-2.5 px-3 font-mono text-slate-800 cursor-pointer ${
                          selectedCellKey === `${tpKey}-cond`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tp.trackConditionType
                          ? `${tp.trackConditionType} ${tp.trackConditionStartDistM ?? 0}m`
                          : "--"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ================================================================= */}
        {/* TABLE 3: TSR Route Table                                          */}
        {/* ================================================================= */}
        {section === "tsr" && (
          <div className="overflow-x-auto">
            <table
              className="w-full text-left border-collapse"
              style={{ fontSize: tableFontSize, fontFamily: tableFontFamily }}
            >
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-semibold">
                  <th className="py-2.5 px-3 border-r border-slate-200">S.No</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">OHE Line Name</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Entry Sig</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Exit Sig</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">TSR Route ID</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Start RFID Tag</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">
                    Entry Sig Dist (m)
                  </th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">
                    Last Pole Dist (m)
                  </th>
                  <th className="py-2.5 px-3">OHE Pole / Km Data (in meter)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(project.tsrRoutes || []).map((t, idx) => {
                  const tsrKey = `tsr-${idx}`;
                  return (
                    <tr key={`${t.tsrRouteId}-${idx}`} className="hover:bg-slate-50">
                      <td
                        style={getCellStyle(`${tsrKey}-slNo`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tsrKey}-slNo` ? null : `${tsrKey}-slNo`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tsrKey}-slNo`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.slNo || idx + 1}
                      </td>
                      <td
                        style={getCellStyle(`${tsrKey}-oheLine`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tsrKey}-oheLine` ? null : `${tsrKey}-oheLine`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-semibold text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tsrKey}-oheLine`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.oheLineName || t.oheLine}
                      </td>
                      <td
                        style={getCellStyle(`${tsrKey}-entrySig`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tsrKey}-entrySig` ? null : `${tsrKey}-entrySig`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tsrKey}-entrySig`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.entrySignal}
                      </td>
                      <td
                        style={getCellStyle(`${tsrKey}-exitSig`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tsrKey}-exitSig` ? null : `${tsrKey}-exitSig`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tsrKey}-exitSig`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.exitSignal}
                      </td>
                      <td
                        style={getCellStyle(`${tsrKey}-routeId`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tsrKey}-routeId` ? null : `${tsrKey}-routeId`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-blue-800 cursor-pointer ${
                          selectedCellKey === `${tsrKey}-routeId`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.tsrRouteId}
                      </td>
                      <td
                        style={getCellStyle(`${tsrKey}-startTag`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tsrKey}-startTag` ? null : `${tsrKey}-startTag`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-amber-900 cursor-pointer ${
                          selectedCellKey === `${tsrKey}-startTag`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.startRfidTag || t.oheLineStartRfidTag}
                      </td>
                      <td
                        style={getCellStyle(`${tsrKey}-entryDist`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tsrKey}-entryDist`
                              ? null
                              : `${tsrKey}-entryDist`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums cursor-pointer ${
                          selectedCellKey === `${tsrKey}-entryDist`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.entrySignalDistFromStartTagM ?? t.entrySignalDistanceM ?? 0}
                      </td>
                      <td
                        style={getCellStyle(`${tsrKey}-poleDist`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tsrKey}-poleDist` ? null : `${tsrKey}-poleDist`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums cursor-pointer ${
                          selectedCellKey === `${tsrKey}-poleDist`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.lastPoleDistFromExitSignalM ?? t.lastPoleDistanceM ?? 0}
                      </td>
                      <td
                        style={getCellStyle(`${tsrKey}-poleData`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tsrKey}-poleData` ? null : `${tsrKey}-poleData`,
                          )
                        }
                        className={`py-2.5 px-3 font-mono text-[11px] text-slate-800 leading-relaxed cursor-pointer ${
                          selectedCellKey === `${tsrKey}-poleData`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.ohePoleKmData ||
                          (t.ohePoles
                            ? t.ohePoles.map((p) => `(${p.distanceM}-${p.poleId})`).join(", ")
                            : "--")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ================================================================= */}
        {/* TABLE 4: TSL Working on Double Line                               */}
        {/* ================================================================= */}
        {section === "tsl" && (
          <div className="overflow-x-auto">
            <table
              className="w-full text-left border-collapse"
              style={{ fontSize: tableFontSize, fontFamily: tableFontFamily }}
            >
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-semibold">
                  <th className="py-2.5 px-3 border-r border-slate-200">S.No</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">TSL Entry Sig</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">TSL Exit Sig</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Signal / Line Type</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Aspect Entry</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Aspect Exit</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Route Command</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Points (N / R)</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Track Ckt Proving</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">TINs Free</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Foot Tag</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 min-w-[200px]">
                    Check RFID Sequence
                  </th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">Dist (m)</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-center">MA</th>
                  <th className="py-2.5 px-3">Auth Speed (1st / Subseq)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(project.tslRoutes || []).map((tsl, idx) => {
                  const tslKey = `tsl-${idx}`;
                  return (
                    <tr key={`${tsl.tslEntrySignal}-${idx}`} className="hover:bg-slate-50">
                      <td
                        style={getCellStyle(`${tslKey}-slNo`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-slNo` ? null : `${tslKey}-slNo`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tslKey}-slNo`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.slNo || idx + 1}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-entrySig`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-entrySig` ? null : `${tslKey}-entrySig`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tslKey}-entrySig`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.tslEntrySignal}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-exitSig`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-exitSig` ? null : `${tslKey}-exitSig`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tslKey}-exitSig`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.tslExitSignal}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-lineType`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-lineType` ? null : `${tslKey}-lineType`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-slate-700 cursor-pointer ${
                          selectedCellKey === `${tslKey}-lineType`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.lineOrSignalType}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-aspectEntry`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-aspectEntry`
                              ? null
                              : `${tslKey}-aspectEntry`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-medium text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tslKey}-aspectEntry`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.aspectOfEntrySignal}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-aspectExit`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-aspectExit`
                              ? null
                              : `${tslKey}-aspectExit`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-slate-600 cursor-pointer ${
                          selectedCellKey === `${tslKey}-aspectExit`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.requiresAspectOfExitSignal}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-cmd`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-cmd` ? null : `${tslKey}-cmd`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-blue-800 cursor-pointer ${
                          selectedCellKey === `${tslKey}-cmd`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.requiredRouteCommand}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-points`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-points` ? null : `${tslKey}-points`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono cursor-pointer ${
                          selectedCellKey === `${tslKey}-points`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.pointsNormal.join(", ")} / {tsl.pointsReverse.join(", ")}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-tc`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-tc` ? null : `${tslKey}-tc`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-slate-700 cursor-pointer ${
                          selectedCellKey === `${tslKey}-tc`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.trackCktUpOrAxleCounterFree}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-tins`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-tins` ? null : `${tslKey}-tins`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tslKey}-tins`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.tinsRequiresFree.join(", ")}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-footTag`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-footTag` ? null : `${tslKey}-footTag`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-amber-900 cursor-pointer ${
                          selectedCellKey === `${tslKey}-footTag`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.entryFootTag}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-seq`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-seq` ? null : `${tslKey}-seq`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono text-[11px] text-slate-800 leading-relaxed cursor-pointer ${
                          selectedCellKey === `${tslKey}-seq`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.linkingSequence.map((s) => `(${s.distanceM}, ${s.tagId})`).join(", ")}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-dist`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-dist` ? null : `${tslKey}-dist`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums font-medium text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tslKey}-dist`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.distanceBetweenSignalsM}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-ma`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-ma` ? null : `${tslKey}-ma`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-center font-mono font-semibold cursor-pointer ${
                          selectedCellKey === `${tslKey}-ma`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.movementAuthoritySections}
                      </td>
                      <td
                        style={getCellStyle(`${tslKey}-speed`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tslKey}-speed` ? null : `${tslKey}-speed`,
                          )
                        }
                        className={`py-2.5 px-3 font-mono font-semibold text-slate-800 cursor-pointer ${
                          selectedCellKey === `${tslKey}-speed`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {tsl.authorizedSpeedOsFirstTrain} / {tsl.authorizedSpeedOsSubsequentTrains}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ================================================================= */}
        {/* BLOCK SECTION & SHUNTING LIMITS TABLE                             */}
        {/* ================================================================= */}
        {section === "block_sos" && (
          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">
                Block Section Details (Annexure-I Amdt-6)
              </h3>
              <div className="overflow-x-auto border border-slate-200 rounded-md">
                <table
                  className="w-full text-left border-collapse"
                  style={{ fontSize: tableFontSize, fontFamily: tableFontFamily }}
                >
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-semibold">
                      <th className="py-2.5 px-3 border-r border-slate-200">Last Stop Signal</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 text-right">
                        Distance to Next Stop (m)
                      </th>
                      <th className="py-2.5 px-3 border-r border-slate-200">Block Section TIN</th>
                      <th className="py-2.5 px-3 border-r border-slate-200">Direction</th>
                      <th className="py-2.5 px-3 border-r border-slate-200">Adjacent Line TINs</th>
                      <th className="py-2.5 px-3 border-r border-slate-200">Next Station ID</th>
                      <th className="py-2.5 px-3 border-r border-slate-200">
                        Border RFID with Location
                      </th>
                      <th className="py-2.5 px-3 border-r border-slate-200 text-center">
                        Movement Auth Speed
                      </th>
                      <th className="py-2.5 px-3 border-r border-slate-200 text-right">
                        Start Dist Reset (m)
                      </th>
                      <th className="py-2.5 px-3 border-r border-slate-200 text-right">
                        Correction (m)
                      </th>
                      <th className="py-2.5 px-3">Loco Dir after Adj</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(project.blockSections || []).map((b, idx) => {
                      const blkKey = `blk-${idx}`;
                      return (
                        <tr key={`${b.lastStopSignal}-${idx}`} className="hover:bg-slate-50">
                          <td
                            style={getCellStyle(`${blkKey}-lss`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${blkKey}-lss` ? null : `${blkKey}-lss`,
                              )
                            }
                            className={`py-2.5 px-3 border-r border-slate-200 font-mono font-bold text-slate-900 cursor-pointer ${
                              selectedCellKey === `${blkKey}-lss`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {b.lastStopSignal}
                          </td>
                          <td
                            style={getCellStyle(`${blkKey}-dist`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${blkKey}-dist` ? null : `${blkKey}-dist`,
                              )
                            }
                            className={`py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums font-semibold cursor-pointer ${
                              selectedCellKey === `${blkKey}-dist`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {b.lastSignalMaMeters ?? "--"}
                          </td>
                          <td
                            style={getCellStyle(`${blkKey}-tin`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${blkKey}-tin` ? null : `${blkKey}-tin`,
                              )
                            }
                            className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-blue-800 cursor-pointer ${
                              selectedCellKey === `${blkKey}-tin`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {b.blockSectionTin}
                          </td>
                          <td
                            style={getCellStyle(`${blkKey}-dir`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${blkKey}-dir` ? null : `${blkKey}-dir`,
                              )
                            }
                            className={`py-2.5 px-3 border-r border-slate-200 font-medium text-slate-800 cursor-pointer ${
                              selectedCellKey === `${blkKey}-dir`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {b.direction}
                          </td>
                          <td
                            style={getCellStyle(`${blkKey}-adjTins`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${blkKey}-adjTins`
                                  ? null
                                  : `${blkKey}-adjTins`,
                              )
                            }
                            className={`py-2.5 px-3 border-r border-slate-200 font-mono text-slate-700 cursor-pointer ${
                              selectedCellKey === `${blkKey}-adjTins`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {b.adjacentLineTins}
                          </td>
                          <td
                            style={getCellStyle(`${blkKey}-nextStn`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${blkKey}-nextStn`
                                  ? null
                                  : `${blkKey}-nextStn`,
                              )
                            }
                            className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900 cursor-pointer ${
                              selectedCellKey === `${blkKey}-nextStn`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {b.nextStationId}
                          </td>
                          <td
                            style={getCellStyle(`${blkKey}-borderRfid`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${blkKey}-borderRfid`
                                  ? null
                                  : `${blkKey}-borderRfid`,
                              )
                            }
                            className={`py-2.5 px-3 border-r border-slate-200 font-mono text-amber-900 cursor-pointer ${
                              selectedCellKey === `${blkKey}-borderRfid`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {b.nextStationBorderRfid}
                          </td>
                          <td
                            style={getCellStyle(`${blkKey}-authSpeed`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${blkKey}-authSpeed`
                                  ? null
                                  : `${blkKey}-authSpeed`,
                              )
                            }
                            className={`py-2.5 px-3 border-r border-slate-200 text-center font-mono font-semibold text-slate-800 cursor-pointer ${
                              selectedCellKey === `${blkKey}-authSpeed`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {b.authorisedSpeed || "MPS"}
                          </td>
                          <td
                            style={getCellStyle(`${blkKey}-startReset`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${blkKey}-startReset`
                                  ? null
                                  : `${blkKey}-startReset`,
                              )
                            }
                            className={`py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums cursor-pointer ${
                              selectedCellKey === `${blkKey}-startReset`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {b.startDistAbsResetM ?? "--"}
                          </td>
                          <td
                            style={getCellStyle(`${blkKey}-corr`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${blkKey}-corr` ? null : `${blkKey}-corr`,
                              )
                            }
                            className={`py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums cursor-pointer ${
                              selectedCellKey === `${blkKey}-corr`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {b.absLocationCorrectionM ?? "--"}
                          </td>
                          <td
                            style={getCellStyle(`${blkKey}-locoDir`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${blkKey}-locoDir`
                                  ? null
                                  : `${blkKey}-locoDir`,
                              )
                            }
                            className={`py-2.5 px-3 font-mono text-slate-800 cursor-pointer ${
                              selectedCellKey === `${blkKey}-locoDir`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {b.locoDirectionAfterAdj || "--"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Shunting Limits */}
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">
                Shunting Limits Table (Annexure-I Amdt-6)
              </h3>
              <div className="overflow-x-auto border border-slate-200 rounded-md">
                <table
                  className="w-full text-left border-collapse"
                  style={{ fontSize: tableFontSize, fontFamily: tableFontFamily }}
                >
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-semibold">
                      <th className="py-2.5 px-4 border-r border-slate-200">
                        Adjacent Station Name
                      </th>
                      <th className="py-2.5 px-4 border-r border-slate-200">Direction</th>
                      <th className="py-2.5 px-4 border-r border-slate-200">RFID Tag No</th>
                      <th className="py-2.5 px-4 border-r border-slate-200">TIN</th>
                      <th className="py-2.5 px-4 text-right">Absolute Location (m)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(project.shuntingLimits || []).map((s, idx) => {
                      const shKey = `sh-${idx}`;
                      return (
                        <tr key={`${s.adjacentStationName}-${idx}`} className="hover:bg-slate-50">
                          <td
                            style={getCellStyle(`${shKey}-stn`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${shKey}-stn` ? null : `${shKey}-stn`,
                              )
                            }
                            className={`py-2.5 px-4 border-r border-slate-200 font-semibold text-slate-900 cursor-pointer ${
                              selectedCellKey === `${shKey}-stn`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {s.adjacentStationName || s.adjacentStation || "--"}
                          </td>
                          <td
                            style={getCellStyle(`${shKey}-dir`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${shKey}-dir` ? null : `${shKey}-dir`,
                              )
                            }
                            className={`py-2.5 px-4 border-r border-slate-200 text-slate-800 cursor-pointer ${
                              selectedCellKey === `${shKey}-dir`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {s.direction}
                          </td>
                          <td
                            style={getCellStyle(`${shKey}-rfid`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${shKey}-rfid` ? null : `${shKey}-rfid`,
                              )
                            }
                            className={`py-2.5 px-4 border-r border-slate-200 font-mono font-bold text-amber-900 cursor-pointer ${
                              selectedCellKey === `${shKey}-rfid`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {s.rfidTag}
                          </td>
                          <td
                            style={getCellStyle(`${shKey}-tin`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${shKey}-tin` ? null : `${shKey}-tin`,
                              )
                            }
                            className={`py-2.5 px-4 border-r border-slate-200 font-mono text-blue-800 cursor-pointer ${
                              selectedCellKey === `${shKey}-tin`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {s.tin}
                          </td>
                          <td
                            style={getCellStyle(`${shKey}-loc`)}
                            onClick={() =>
                              setSelectedCellKey(
                                selectedCellKey === `${shKey}-loc` ? null : `${shKey}-loc`,
                              )
                            }
                            className={`py-2.5 px-4 text-right font-mono font-bold text-slate-900 cursor-pointer ${
                              selectedCellKey === `${shKey}-loc`
                                ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                                : ""
                            }`}
                          >
                            {s.absoluteLocationM}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* RFID TAG & TIN ALLOTMENT TABLE                                    */}
        {/* ================================================================= */}
        {section === "tag_inventory" && (
          <div className="overflow-x-auto">
            <table
              className="w-full text-left border-collapse"
              style={{ fontSize: tableFontSize, fontFamily: tableFontFamily }}
            >
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-semibold">
                  <th className="py-2.5 px-3 border-r border-slate-200">Tag ID</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">Chainage (m)</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Track / Line</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">TIN</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Function Type</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Linked Signal</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-center">Confidence</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-center">Verified</th>
                  <th className="py-2.5 px-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {project.tags.map((t) => {
                  const tagKey = `tag-${t.id}`;
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td
                        style={getCellStyle(`${tagKey}-tagId`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tagKey}-tagId` ? null : `${tagKey}-tagId`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-bold text-amber-900 cursor-pointer ${
                          selectedCellKey === `${tagKey}-tagId`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.tagId}
                      </td>
                      <td
                        style={getCellStyle(`${tagKey}-chainage`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tagKey}-chainage` ? null : `${tagKey}-chainage`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums font-semibold cursor-pointer ${
                          selectedCellKey === `${tagKey}-chainage`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.chainageM ?? "--"}
                      </td>
                      <td
                        style={getCellStyle(`${tagKey}-line`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tagKey}-line` ? null : `${tagKey}-line`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-slate-800 cursor-pointer ${
                          selectedCellKey === `${tagKey}-line`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.line}
                      </td>
                      <td
                        style={getCellStyle(`${tagKey}-tin`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tagKey}-tin` ? null : `${tagKey}-tin`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-blue-800 cursor-pointer ${
                          selectedCellKey === `${tagKey}-tin`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.tin || "--"}
                      </td>
                      <td
                        style={getCellStyle(`${tagKey}-type`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tagKey}-type` ? null : `${tagKey}-type`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-slate-700 cursor-pointer ${
                          selectedCellKey === `${tagKey}-type`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.tagType}
                      </td>
                      <td
                        style={getCellStyle(`${tagKey}-sig`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tagKey}-sig` ? null : `${tagKey}-sig`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 font-mono text-slate-900 cursor-pointer ${
                          selectedCellKey === `${tagKey}-sig`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.linkedSignal || "--"}
                      </td>
                      <td
                        style={getCellStyle(`${tagKey}-conf`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tagKey}-conf` ? null : `${tagKey}-conf`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-center cursor-pointer ${
                          selectedCellKey === `${tagKey}-conf`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            t.confidence === "HIGH"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {t.confidence}
                        </span>
                      </td>
                      <td
                        style={getCellStyle(`${tagKey}-ver`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tagKey}-ver` ? null : `${tagKey}-ver`,
                          )
                        }
                        className={`py-2.5 px-3 border-r border-slate-200 text-center font-semibold cursor-pointer ${
                          selectedCellKey === `${tagKey}-ver`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.verified ? (
                          <span className="text-emerald-700">YES</span>
                        ) : (
                          <span className="text-slate-400">NO</span>
                        )}
                      </td>
                      <td
                        style={getCellStyle(`${tagKey}-notes`)}
                        onClick={() =>
                          setSelectedCellKey(
                            selectedCellKey === `${tagKey}-notes` ? null : `${tagKey}-notes`,
                          )
                        }
                        className={`py-2.5 px-3 text-slate-600 text-[11px] cursor-pointer ${
                          selectedCellKey === `${tagKey}-notes`
                            ? "ring-2 ring-blue-500 bg-blue-100/60 shadow-inner"
                            : ""
                        }`}
                      >
                        {t.notes || ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* BOTTOM 20%: Authentic RDSO Engineering Title & Approval Block (Common for all pages, Pages 16 & 17) */}
        <div className="p-4 border-t-2 border-slate-800 bg-white space-y-0">
          {/* Upper Tier of Bottom 20% Block */}
          <div className="grid grid-cols-1 md:grid-cols-12 border border-slate-800 text-xs">
            {/* Left References Box */}
            <div className="md:col-span-5 p-3 border-b md:border-b-0 md:border-r border-slate-800 space-y-1">
              <div className="font-bold text-sm text-slate-900">
                {project.metadata.stationName || "STATION"}({project.metadata.stationCode || "STN"})-{project.metadata.stationId || "000"}&nbsp;&nbsp;&nbsp;&nbsp;SIGNAL &amp; TELECOMMUNICATIONS
              </div>
              <div className="text-xs text-slate-700">
                <span className="font-bold">REF: SIP NO: </span>
                <span className="font-mono">{project.metadata.refSip || project.metadata.refLayout || "IPU. 0011C Alt-5"}</span>
                <span className="mx-2">&amp;</span>
                <span className="font-bold">TOC: </span>
                <span className="font-mono">{project.metadata.refToc || "TC. 0011C"}</span>
              </div>
              <div className="text-xs text-slate-700">
                <span className="font-bold">REF: </span>
                <span className="font-mono">KAVACH_RFID_TAG_LAYOUT_{project.metadata.stationCode || "STN"}_2.0.2</span>
              </div>
              <div className="text-xs text-slate-700">
                <span className="font-bold">TABLE NO: </span>
                <span className="font-mono">KAVACH_TABLE_OF_CONTROL_{project.metadata.stationCode || "STN"}_2.0.2</span>
              </div>
            </div>

            {/* Middle HQ / Designations Box */}
            <div className="md:col-span-4 p-3 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col justify-around text-center text-[11px] font-bold text-slate-800 space-y-2">
              <div className="flex justify-around border-b border-slate-400 pb-2">
                <span>JE/SSE/Proj/HQ/SCR</span>
                <span>ASTE/Proj/HQ/SCR</span>
                <span>Dy.CSTE/Proj/HQ/SCR</span>
              </div>
              <div className="flex justify-around pt-1">
                <span>JE/SSE/RDSO/LKO</span>
                <span>ADE/RDSO/LKO</span>
                <span>DIRECTOR/RDSO/LKO</span>
              </div>
            </div>

            {/* Right KAVACH Header Box */}
            <div className="md:col-span-3 p-3 flex flex-col items-center justify-center text-center bg-slate-50">
              <div className="text-lg font-black tracking-widest text-slate-900">KAVACH</div>
              <div className="text-xs font-bold text-slate-700 mt-1">
                {project.metadata.stationName || "STATION"}({project.metadata.stationCode || "STN"})-{project.metadata.stationId || "000"}
              </div>
            </div>
          </div>

          {/* Lower Tier of Bottom 20% Block: Signatures, Firm Logo, Drg No, Sheet X of Y */}
          <div className="grid grid-cols-1 md:grid-cols-12 border-x border-b border-slate-800 text-xs">
            {/* Signatures Table */}
            <div className="md:col-span-5 border-b md:border-b-0 md:border-r border-slate-800">
              <table className="w-full text-center border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-100 font-bold">
                    <th className="w-16 py-1 px-2 border-r border-slate-800">&nbsp;</th>
                    <th className="py-1 px-2 border-r border-slate-800">PREPARED BY</th>
                    <th className="py-1 px-2">CHECKED BY</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-800 h-9">
                    <td className="py-1 px-2 border-r border-slate-800 font-bold bg-slate-50 text-[10px]">SIGN</td>
                    <td className="py-1 px-2 border-r border-slate-800">&nbsp;</td>
                    <td className="py-1 px-2">&nbsp;</td>
                  </tr>
                  <tr className="border-b border-slate-800">
                    <td className="py-1 px-2 border-r border-slate-800 font-bold bg-slate-50 text-[10px]">NAME</td>
                    <td className="py-1 px-2 border-r border-slate-800 font-semibold">{project.metadata.preparedBy || "CH MASTANAIAH"}</td>
                    <td className="py-1 px-2 font-semibold">{project.metadata.checkedBy || "V VARUN KUMAR"}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="py-1 px-2 bg-slate-50 text-center text-[10px] text-slate-700">
                      <span className="font-bold">APPROVED BY: </span>
                      {project.metadata.approvedBy || "EXE. DIRECTOR TELE-II"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Firm Logo Box */}
            <div className="md:col-span-2 p-3 border-b md:border-b-0 md:border-r border-slate-800 flex items-center justify-center">
              <div className="w-full h-full min-h-[50px] border border-dashed border-slate-400 rounded flex items-center justify-center text-xs font-bold text-slate-500">
                Firm Logo
              </div>
            </div>

            {/* Drawing No & Sheet Info Box */}
            <div className="md:col-span-5 p-3 flex flex-col justify-between space-y-2 bg-white">
              <div className="text-center font-black text-sm tracking-wide text-slate-900">
                KAVACH &nbsp; TABLE OF CONTROL
              </div>
              <div className="flex items-end justify-between pt-1 text-xs">
                <div>
                  <div className="font-bold text-[10px] text-slate-500 uppercase">S.C.RLY.DRG.NO.</div>
                  <div className="font-bold text-slate-900">
                    KAVACH: <span className="font-mono">{project.metadata.refSip || project.metadata.refLayout || "IPU. 0011C Alt-5"}</span>
                  </div>
                </div>
                <div className="border border-slate-800 text-center font-mono text-xs">
                  <div className="flex border-b border-slate-800 bg-slate-100 font-bold text-[10px]">
                    <span className="px-3 py-0.5 border-r border-slate-800">SHEET</span>
                    <span className="px-3 py-0.5">SHEETS</span>
                  </div>
                  <div className="flex font-bold text-sm">
                    <span className="px-3 py-1 border-r border-slate-800">1</span>
                    <span className="px-3 py-1">1</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
