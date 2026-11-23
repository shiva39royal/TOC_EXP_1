import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Compass,
  Edit3,
  ExternalLink,
  Eye,
  Filter,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { recomputeRouteFromTags } from "../engine/validator";
import type {
  StationMetadata,
  StationProject,
  TocRouteRow,
  ValidationIssue,
} from "../types/signalling";

export interface ValidationPanelProps {
  project: StationProject;
  filterRouteSlNo?: number | null;
  onClearRouteFilter?: () => void;
  onResolveIssue?: (issueId: string, resolved: boolean, note?: string) => void;
  onInspectRouteOnSchematic?: (slNo: number) => void;
  onInspectRouteInToc?: (slNo: number) => void;
  onToggleEngineerSignOff?: (engineerName: string) => void;
  onVerifyAllWarnings?: () => void;
  onUpdateRoute?: (slNo: number, patch: Partial<TocRouteRow>) => void;
  onUpdateMetadata?: (patch: Partial<StationMetadata>) => void;
  onSaveAndProceed?: () => void;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = ({
  project,
  filterRouteSlNo,
  onClearRouteFilter,
  onResolveIssue,
  onInspectRouteOnSchematic,
  onInspectRouteInToc,
  onToggleEngineerSignOff,
  onVerifyAllWarnings,
  onUpdateRoute,
  onUpdateMetadata,
  onSaveAndProceed,
}) => {
  const [editingSlNo, setEditingSlNo] = useState<number | null>(null);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [dirFilter, setDirFilter] = useState<"ALL" | "DOWN" | "UP">("ALL");
  const [search, setSearch] = useState("");
  const [issueFilter, setIssueFilter] = useState<"ALL" | "ERRORS" | "WARNINGS" | "RESOLVED">("ALL");

  // Row edit state (without tsrmsRouteId)
  const [rowDraft, setRowDraft] = useState<{
    entrySignal: string;
    exitSignal: string;
    leadingToLine: string;
    sectionType: string;
    signalType: string;
    aspectOfEntrySignal: string;
    requiresAspectOfExitSignal: string;
    requiredRouteLocking: string;
    pointsNormalStr: string;
    pointsReverseStr: string;
    trackCktUp: string;
    trackCircuitInOverlap: string;
    tinsRequiresFreeStr: string;
    tinsInOverlapStr: string;
    entryFootTag: string;
    enRouteTagsStr: string;
    distanceBetweenSignalsM: number;
    movementAuthoritySections: string;
    authorizedSpeedSr: string;
    authorizedSpeedOs: string;
  } | null>(null);

  // Metadata edit state
  const [metaDraft, setMetaDraft] = useState<Partial<StationMetadata>>({
    stationName: project.metadata.stationName,
    stationCode: project.metadata.stationCode,
    stationId: project.metadata.stationId,
    division: project.metadata.division,
    railwayZone: project.metadata.railwayZone,
    refLayout: project.metadata.refLayout,
    refSip: project.metadata.refSip,
    refToc: project.metadata.refToc,
    preparedBy: project.metadata.preparedBy,
    checkedBy: project.metadata.checkedBy,
    approvedBy: project.metadata.approvedBy,
  });

  // Calculate issue counts
  const validationIssues = project.validationIssues || [];
  const openErrorsList = useMemo(
    () => validationIssues.filter((i) => i.severity === "ERROR" && !i.resolved),
    [validationIssues],
  );
  const openWarningsList = useMemo(
    () => validationIssues.filter((i) => i.severity === "WARNING" && !i.resolved),
    [validationIssues],
  );
  const resolvedList = useMemo(
    () => validationIssues.filter((i) => i.resolved),
    [validationIssues],
  );

  const filteredIssues = useMemo(() => {
    return validationIssues.filter((i) => {
      if (filterRouteSlNo && i.affectedRouteSlNo !== filterRouteSlNo) return false;
      if (issueFilter === "ERRORS") return i.severity === "ERROR" && !i.resolved;
      if (issueFilter === "WARNINGS") return i.severity === "WARNING" && !i.resolved;
      if (issueFilter === "RESOLVED") return i.resolved;
      return true;
    });
  }, [validationIssues, issueFilter, filterRouteSlNo]);

  const filteredRoutes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return project.routes.filter((r) => {
      if (filterRouteSlNo && r.slNo !== filterRouteSlNo) return false;
      if (dirFilter === "DOWN" && r.direction !== "DOWN") return false;
      if (dirFilter === "UP" && r.direction !== "UP") return false;
      if (!q) return true;
      return (
        r.entrySignal.toLowerCase().includes(q) ||
        r.exitSignal.toLowerCase().includes(q) ||
        r.leadingToLine.toLowerCase().includes(q) ||
        r.entryFootTag.toLowerCase().includes(q) ||
        r.pointsNormal.join(",").toLowerCase().includes(q) ||
        r.pointsReverse.join(",").toLowerCase().includes(q)
      );
    });
  }, [project.routes, dirFilter, search, filterRouteSlNo]);

  const startEditRow = (r: TocRouteRow) => {
    setEditingSlNo(r.slNo);
    const seqParts: string[] = [];
    for (const s of r.linkingSequence) {
      if (s.tagId !== r.entryFootTag) seqParts.push(`(${s.distanceM}, ${s.tagId})`);
    }
    const displaySeq =
      seqParts.length > 0
        ? seqParts.join(", ")
        : r.enRouteTags.filter((t) => t !== r.entryFootTag).join(", ");

    setRowDraft({
      entrySignal: r.entrySignal,
      exitSignal: r.exitSignal,
      leadingToLine: r.leadingToLine,
      sectionType: r.sectionType || "Station Section",
      signalType: r.signalType || "Stop Signal",
      aspectOfEntrySignal: r.aspectOfEntrySignal || "Green",
      requiresAspectOfExitSignal: r.requiresAspectOfExitSignal || `${r.exitSignal} Green`,
      requiredRouteLocking: r.requiredRouteLocking || "-",
      pointsNormalStr: r.pointsNormal.join(", "),
      pointsReverseStr: r.pointsReverse.join(", "),
      trackCktUp: r.trackCktUp || "-",
      trackCircuitInOverlap: r.trackCircuitInOverlap || r.overlapTrackCkt || "-",
      tinsRequiresFreeStr: r.tinsRequiresFree.join(", "),
      tinsInOverlapStr: r.tinsInOverlap?.join(", ") || r.overlapTins?.join(", ") || "-",
      entryFootTag: r.entryFootTag || "",
      enRouteTagsStr: displaySeq,
      distanceBetweenSignalsM: r.distanceBetweenSignalsM || 0,
      movementAuthoritySections: r.movementAuthoritySections || "1",
      authorizedSpeedSr: r.authorizedSpeedSr || "MPS",
      authorizedSpeedOs: r.authorizedSpeedOs || "MPS",
    });
  };

  const handleSaveRow = (slNo: number) => {
    if (!rowDraft || !onUpdateRoute) return;
    const pointsNormal = rowDraft.pointsNormalStr
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "-");
    const pointsReverse = rowDraft.pointsReverseStr
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "-");
    const tinsRequiresFree = rowDraft.tinsRequiresFreeStr
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "-");
    const tinsInOverlap = rowDraft.tinsInOverlapStr
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "-");

    const parsedEnRouteTags: string[] = rowDraft.enRouteTagsStr
      .replace(/[()]/g, " ")
      .split(",")
      .map((s) => s.trim())
      .map((part) => {
        const tokens = part.split(/\s+/).filter(Boolean);
        return (tokens.length > 1 ? tokens[1] : tokens[0]) || "";
      })
      .filter((t) => Boolean(t) && t !== "-");

    const patch: Partial<TocRouteRow> = {
      entrySignal: rowDraft.entrySignal,
      exitSignal: rowDraft.exitSignal,
      leadingToLine: rowDraft.leadingToLine,
      sectionType: rowDraft.sectionType,
      signalType: rowDraft.signalType,
      aspectOfEntrySignal: rowDraft.aspectOfEntrySignal,
      requiresAspectOfExitSignal: rowDraft.requiresAspectOfExitSignal,
      requiredRouteLocking: rowDraft.requiredRouteLocking,
      pointsNormal,
      pointsReverse,
      trackCktUp: rowDraft.trackCktUp,
      trackCircuitInOverlap: rowDraft.trackCircuitInOverlap,
      tinsRequiresFree,
      tinsInOverlap,
      entryFootTag: rowDraft.entryFootTag,
      distanceBetweenSignalsM: Number(rowDraft.distanceBetweenSignalsM) || 0,
      movementAuthoritySections: rowDraft.movementAuthoritySections,
      authorizedSpeedSr: rowDraft.authorizedSpeedSr,
      authorizedSpeedOs: rowDraft.authorizedSpeedOs,
    };
    if (parsedEnRouteTags.length > 0) {
      patch.enRouteTags = parsedEnRouteTags;
    }

    onUpdateRoute(slNo, patch);
    setEditingSlNo(null);
    setRowDraft(null);
  };

  const handleSaveMetadata = () => {
    if (onUpdateMetadata) {
      onUpdateMetadata(metaDraft);
    }
    setEditingMetadata(false);
  };

  const handleSaveAndProceedClick = () => {
    if (editingSlNo !== null && rowDraft) {
      handleSaveRow(editingSlNo);
    }
    if (editingMetadata) {
      handleSaveMetadata();
    }
    if (onSaveAndProceed) {
      onSaveAndProceed();
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Engineer Validation Action & KPI Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[11px] font-mono font-semibold uppercase tracking-wider bg-blue-100 text-blue-800 rounded">
              Step 03: Engineer Validation
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-xs font-semibold text-slate-700">
              {project.routes.length} Routes Configured · RDSO SPN-196 Amdt-6
            </span>
          </div>
          <h2 className="text-lg font-display font-bold text-slate-900">
            Signalling Safety Audit &amp; Table Validation
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Verify automated rule checks, resolve discrepancies, and edit Table of Control cells
            inline. Resolving an issue updates the layout and clears the error badge in real-time.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {onVerifyAllWarnings && openWarningsList.length > 0 && (
            <button
              type="button"
              onClick={onVerifyAllWarnings}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer transition-colors"
            >
              <Check className="w-3.5 h-3.5 text-amber-600" />
              <span>Verify All Warnings ({openWarningsList.length})</span>
            </button>
          )}

          {/* Primary Save & Proceed Button */}
          <button
            type="button"
            onClick={handleSaveAndProceedClick}
            className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 active:bg-blue-900 rounded-md shadow-sm transition-all cursor-pointer whitespace-nowrap"
          >
            <span>Save Modifications &amp; Proceed to TOC</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-slate-500 tracking-wider">
            Total Checks
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1 font-mono">
            {validationIssues.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Automated safety rules</div>
        </div>

        <div
          className={`border rounded-lg p-3.5 shadow-2xs cursor-pointer transition-all ${
            issueFilter === "ERRORS"
              ? "bg-rose-50 border-rose-400 ring-2 ring-rose-300"
              : "bg-white border-slate-200 hover:border-rose-300"
          }`}
          onClick={() => setIssueFilter(issueFilter === "ERRORS" ? "ALL" : "ERRORS")}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase text-rose-700 tracking-wider">
              Open Errors
            </span>
            <ShieldAlert className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-black text-rose-700 mt-1 font-mono">
            {openErrorsList.length}
          </div>
          <div className="text-[11px] text-rose-600 mt-0.5">
            {openErrorsList.length === 0 ? "All clear" : "Requires engineer verification"}
          </div>
        </div>

        <div
          className={`border rounded-lg p-3.5 shadow-2xs cursor-pointer transition-all ${
            issueFilter === "WARNINGS"
              ? "bg-amber-50 border-amber-400 ring-2 ring-amber-300"
              : "bg-white border-slate-200 hover:border-amber-300"
          }`}
          onClick={() => setIssueFilter(issueFilter === "WARNINGS" ? "ALL" : "WARNINGS")}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase text-amber-700 tracking-wider">
              Open Warnings
            </span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-amber-700 mt-1 font-mono">
            {openWarningsList.length}
          </div>
          <div className="text-[11px] text-amber-600 mt-0.5">Advisory consistency checks</div>
        </div>

        <div
          className={`border rounded-lg p-3.5 shadow-2xs cursor-pointer transition-all ${
            issueFilter === "RESOLVED"
              ? "bg-emerald-50 border-emerald-400 ring-2 ring-emerald-300"
              : "bg-white border-slate-200 hover:border-emerald-300"
          }`}
          onClick={() => setIssueFilter(issueFilter === "RESOLVED" ? "ALL" : "RESOLVED")}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase text-emerald-700 tracking-wider">
              Resolved Checks
            </span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-1 font-mono">
            {resolvedList.length}
          </div>
          <div className="text-[11px] text-emerald-600 mt-0.5">Verified by signalling engineer</div>
        </div>
      </div>

      {/* INTERACTIVE VALIDATION ISSUES LIST */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Engineering Rule Audit &amp; Consistency Issues
            </h3>
            {filterRouteSlNo && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-semibold">
                Filtering Route #{filterRouteSlNo}
                {onClearRouteFilter && (
                  <button
                    type="button"
                    onClick={onClearRouteFilter}
                    className="hover:text-blue-950 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 text-xs">
            {(
              [
                { id: "ALL", label: `All (${validationIssues.length})` },
                { id: "ERRORS", label: `Errors (${openErrorsList.length})` },
                { id: "WARNINGS", label: `Warnings (${openWarningsList.length})` },
                { id: "RESOLVED", label: `Resolved (${resolvedList.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setIssueFilter(tab.id)}
                className={`px-2.5 py-1 rounded font-medium cursor-pointer transition-colors ${
                  issueFilter === tab.id
                    ? "bg-slate-900 text-white font-bold"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Issue Cards */}
        <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
          {filteredIssues.length === 0 ? (
            <div className="p-6 text-center bg-emerald-50 border border-emerald-200 rounded-lg">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
              <div className="text-sm font-bold text-emerald-900">
                {issueFilter === "ERRORS"
                  ? "Zero Open Errors! All critical checks passed or resolved."
                  : issueFilter === "WARNINGS"
                    ? "Zero Open Warnings!"
                    : "No validation issues match current filter."}
              </div>
              <p className="text-xs text-emerald-700 mt-1">
                The Table of Control is clean and ready for official engineering sign-off.
              </p>
            </div>
          ) : (
            filteredIssues.map((issue) => {
              const isErr = issue.severity === "ERROR";
              const isResolved = issue.resolved;

              return (
                <div
                  key={issue.id}
                  className={`p-3.5 rounded-lg border transition-all ${
                    isResolved
                      ? "bg-slate-50/80 border-slate-200 opacity-80"
                      : isErr
                        ? "bg-rose-50/40 border-rose-300"
                        : "bg-amber-50/40 border-amber-300"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1 min-w-[280px]">
                      <div className="flex flex-wrap items-center gap-2">
                        {isResolved ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            VERIFIED &amp; RESOLVED
                          </span>
                        ) : isErr ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                            <AlertCircle className="w-3 h-3 text-rose-600" />
                            CRITICAL ERROR
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            WARNING
                          </span>
                        )}

                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700 font-semibold">
                          {issue.category}
                        </span>

                        <span className="text-[11px] font-mono text-slate-500">
                          {issue.ruleReference}
                        </span>

                        {issue.affectedRouteSlNo && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-semibold">
                            Route #{issue.affectedRouteSlNo}
                          </span>
                        )}

                        {issue.affectedEntityId && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-semibold">
                            Entity: {issue.affectedEntityId}
                          </span>
                        )}
                      </div>

                      <div className="text-xs font-bold text-slate-900">{issue.title}</div>
                      <p className="text-xs text-slate-700 leading-relaxed">{issue.description}</p>

                      {issue.suggestedFix && !isResolved && (
                        <div className="text-[11px] text-slate-600 bg-white/80 p-2 rounded border border-slate-200 mt-1">
                          <span className="font-semibold text-slate-800">Suggested Action: </span>
                          {issue.suggestedFix}
                        </div>
                      )}

                      {isResolved && issue.resolvedNote && (
                        <div className="text-[11px] text-emerald-800 font-medium mt-1">
                          Note: {issue.resolvedNote}
                        </div>
                      )}
                    </div>

                    {/* Actions & Resolve Toggle */}
                    <div className="flex items-center gap-2 shrink-0">
                      {issue.affectedRouteSlNo && onInspectRouteOnSchematic && (
                        <button
                          type="button"
                          onClick={() => onInspectRouteOnSchematic(issue.affectedRouteSlNo!)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded cursor-pointer transition-colors"
                          title="Highlight and inspect this route on the interactive track schematic"
                        >
                          <Compass className="w-3.5 h-3.5" />
                          <span>Inspect on Schematic</span>
                        </button>
                      )}

                      {issue.affectedRouteSlNo && onInspectRouteInToc && (
                        <button
                          type="button"
                          onClick={() => onInspectRouteInToc(issue.affectedRouteSlNo!)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded cursor-pointer transition-colors"
                          title="View this route in the TOC selection table"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View in TOC</span>
                        </button>
                      )}

                      {onResolveIssue && (
                        <button
                          type="button"
                          onClick={() =>
                            onResolveIssue(
                              issue.id,
                              !isResolved,
                              !isResolved ? "Verified by Signalling Engineer" : undefined,
                            )
                          }
                          className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded shadow-2xs transition-all cursor-pointer ${
                            isResolved
                              ? "text-slate-600 bg-white hover:bg-slate-100 border border-slate-300"
                              : isErr
                                ? "text-white bg-rose-600 hover:bg-rose-700"
                                : "text-white bg-emerald-600 hover:bg-emerald-700"
                          }`}
                        >
                          {isResolved ? (
                            <>
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Re-open Check</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Verify &amp; Resolve</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* =========================================================================
          REDESIGNED ENGINEERING TEMPLATE (RAILWAY SPEC PAGES 16 & 17)
          Top 5%: Station Details Corner Block
          Middle 75%: Table of Control (Selection Table)
          Bottom 20%: Standard RDSO Approval & Signatures Grid
         ========================================================================= */}
      <div className="bg-white border-2 border-slate-800 rounded-lg shadow-md overflow-hidden">
        {/* TOP 5%: Authentic Indian Railways Station Details & Plan Reference */}
        <div className="p-4 border-b-2 border-slate-800 bg-slate-50">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-300 pb-3 mb-3">
            <div>
              <div className="text-[11px] font-mono tracking-wider uppercase text-slate-500 font-semibold">
                Government of India · Ministry of Railways · RDSO Specification SPN-196 Amdt-6
              </div>
              <h1 className="text-xl font-display font-black text-slate-900 uppercase tracking-tight">
                Stationary KAVACH Table of Control (Selection Table)
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingMetadata(!editingMetadata)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 cursor-pointer transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{editingMetadata ? "Close Metadata Editor" : "Edit Sheet Metadata"}</span>
              </button>
            </div>
          </div>

          {/* Editable Metadata Drawer */}
          {editingMetadata && (
            <div className="p-4 mb-4 bg-blue-50/80 border border-blue-200 rounded-lg space-y-3 text-xs">
              <div className="font-bold text-blue-900 uppercase text-[11px]">
                Engineering Sheet Metadata (Zero Hardcoding)
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1">Station Name</label>
                  <input
                    type="text"
                    value={metaDraft.stationName || ""}
                    onChange={(e) => setMetaDraft({ ...metaDraft, stationName: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 bg-white rounded font-medium"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Station Code</label>
                  <input
                    type="text"
                    value={metaDraft.stationCode || ""}
                    onChange={(e) => setMetaDraft({ ...metaDraft, stationCode: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 bg-white rounded font-mono uppercase font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Station ID (Hex/Dec)</label>
                  <input
                    type="text"
                    value={metaDraft.stationId || ""}
                    onChange={(e) => setMetaDraft({ ...metaDraft, stationId: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 bg-white rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Division</label>
                  <input
                    type="text"
                    value={metaDraft.division || ""}
                    onChange={(e) => setMetaDraft({ ...metaDraft, division: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 bg-white rounded font-medium"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Railway Zone</label>
                  <input
                    type="text"
                    value={metaDraft.railwayZone || ""}
                    onChange={(e) => setMetaDraft({ ...metaDraft, railwayZone: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 bg-white rounded font-medium"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Ref SIP No.</label>
                  <input
                    type="text"
                    value={metaDraft.refSip || ""}
                    onChange={(e) => setMetaDraft({ ...metaDraft, refSip: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 bg-white rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Ref TOC No.</label>
                  <input
                    type="text"
                    value={metaDraft.refToc || ""}
                    onChange={(e) => setMetaDraft({ ...metaDraft, refToc: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 bg-white rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Prepared By (Engineer)</label>
                  <input
                    type="text"
                    value={metaDraft.preparedBy || ""}
                    onChange={(e) => setMetaDraft({ ...metaDraft, preparedBy: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 bg-white rounded"
                  />
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleSaveMetadata}
                  className="px-4 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded font-bold cursor-pointer"
                >
                  Save Metadata Changes
                </button>
              </div>
            </div>
          )}

          {/* Authentic Top 5% Corner Details Strip (Pages 16 & 17) */}
          <div className="flex flex-wrap items-center justify-between gap-6 text-sm font-sans font-bold text-slate-900 bg-white p-3.5 rounded border border-slate-300">
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

          {/* Quick search and direction filter toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-200">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <span>Filter Direction:</span>
              {(["ALL", "DOWN", "UP"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirFilter(d)}
                  className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                    dirFilter === d
                      ? "bg-slate-900 text-white font-bold"
                      : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {d}
                </button>
              ))}
              <span className="text-slate-400 ml-2">·</span>
              <span className="text-slate-500 font-normal">
                Showing {filteredRoutes.length} of {project.routes.length} routes
              </span>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter signal, line, tag..."
                className="pl-7 pr-3 py-1 text-xs border border-slate-300 rounded bg-white w-52 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>
        </div>

        {/* MIDDLE 75%: Authentic Table of Control (21 Authentic RDSO Columns, zero TSRMS) */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-200/90 border-b border-slate-400 text-slate-900 font-bold text-[11px] uppercase tracking-wide">
                <th className="py-2.5 px-2 border-r border-slate-300 text-center">S.No</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Entry Sig</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Exit Sig</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Line</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Section Type</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Signal Type</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Aspect Entry</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Requires Aspect Exit</th>
                <th className="py-2.5 px-2 border-r border-slate-300 text-center">Route Locking</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Pts Normal</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Pts Reverse</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Track Ckt Route</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Track Ckt Overlap</th>
                <th className="py-2.5 px-2 border-r border-slate-300">TINs Route</th>
                <th className="py-2.5 px-2 border-r border-slate-300">TINs Overlap</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Foot Tag</th>
                <th className="py-2.5 px-2 border-r border-slate-300 min-w-[200px]">
                  Check RFID Sequence
                </th>
                <th className="py-2.5 px-2 border-r border-slate-300 text-right">Dist (m)</th>
                <th className="py-2.5 px-2 border-r border-slate-300 text-center">MA (Sec)</th>
                <th className="py-2.5 px-2 border-r border-slate-300 text-center">SR Speed</th>
                <th className="py-2.5 px-2 border-r border-slate-300 text-center">OS Speed</th>
                <th className="py-2.5 px-2 text-center bg-slate-300/80">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
              {filteredRoutes.map((r) => {
                const isEditing = editingSlNo === r.slNo;
                const perms =
                  r.aspectPermutations && r.aspectPermutations.length > 0
                    ? r.aspectPermutations
                    : [
                        {
                          aspectOfEntrySignal: r.aspectOfEntrySignal || "Green",
                          requiresAspectOfExitSignal:
                            r.requiresAspectOfExitSignal || `${r.exitSignal} Green`,
                          movementAuthoritySections: r.movementAuthoritySections || "4",
                          authorizedSpeedSr: r.authorizedSpeedSr || "MPS",
                          authorizedSpeedOs: r.authorizedSpeedOs || "MPS",
                        },
                      ];

                const seqParts: string[] = [];
                for (const s of r.linkingSequence) {
                  if (s.tagId !== r.entryFootTag) seqParts.push(`(${s.distanceM}, ${s.tagId})`);
                }
                const displaySeq =
                  seqParts.length > 0
                    ? seqParts.join(", ")
                    : r.enRouteTags.filter((t) => t !== r.entryFootTag).join(", ") || "-";

                if (isEditing && rowDraft) {
                  return (
                    <tr
                      key={`edit-${r.slNo}`}
                      className="bg-blue-50/90 font-sans border-y-2 border-blue-600"
                    >
                      <td className="py-2 px-1 border-r border-slate-300 text-center font-bold">
                        {r.slNo}
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.entrySignal}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, entrySignal: e.target.value })
                          }
                          className="w-16 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs font-bold"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.exitSignal}
                          onChange={(e) => setRowDraft({ ...rowDraft, exitSignal: e.target.value })}
                          className="w-16 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs font-bold"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.leadingToLine}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, leadingToLine: e.target.value })
                          }
                          className="w-24 px-1 py-0.5 border border-blue-400 bg-white rounded text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.sectionType}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, sectionType: e.target.value })
                          }
                          className="w-24 px-1 py-0.5 border border-blue-400 bg-white rounded text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.signalType}
                          onChange={(e) => setRowDraft({ ...rowDraft, signalType: e.target.value })}
                          className="w-28 px-1 py-0.5 border border-blue-400 bg-white rounded text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.aspectOfEntrySignal}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, aspectOfEntrySignal: e.target.value })
                          }
                          className="w-20 px-1 py-0.5 border border-blue-400 bg-white rounded text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.requiresAspectOfExitSignal}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, requiresAspectOfExitSignal: e.target.value })
                          }
                          className="w-24 px-1 py-0.5 border border-blue-400 bg-white rounded text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.requiredRouteLocking}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, requiredRouteLocking: e.target.value })
                          }
                          className="w-16 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-center font-bold"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.pointsNormalStr}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, pointsNormalStr: e.target.value })
                          }
                          placeholder="e.g. 11, 13"
                          className="w-20 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-emerald-800"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.pointsReverseStr}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, pointsReverseStr: e.target.value })
                          }
                          placeholder="e.g. 12"
                          className="w-20 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-amber-800"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.trackCktUp}
                          onChange={(e) => setRowDraft({ ...rowDraft, trackCktUp: e.target.value })}
                          className="w-20 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.trackCircuitInOverlap}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, trackCircuitInOverlap: e.target.value })
                          }
                          className="w-16 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.tinsRequiresFreeStr}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, tinsRequiresFreeStr: e.target.value })
                          }
                          className="w-20 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.tinsInOverlapStr}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, tinsInOverlapStr: e.target.value })
                          }
                          className="w-20 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.entryFootTag}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, entryFootTag: e.target.value })
                          }
                          className="w-16 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-amber-900 font-bold"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300 font-mono text-[11px] text-slate-700">
                        <input
                          type="text"
                          value={rowDraft.enRouteTagsStr}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, enRouteTagsStr: e.target.value })
                          }
                          className="w-full px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-[11px]"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="number"
                          value={rowDraft.distanceBetweenSignalsM}
                          onChange={(e) =>
                            setRowDraft({
                              ...rowDraft,
                              distanceBetweenSignalsM: Number(e.target.value),
                            })
                          }
                          className="w-16 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-right"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.movementAuthoritySections}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, movementAuthoritySections: e.target.value })
                          }
                          className="w-8 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-center"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.authorizedSpeedSr}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, authorizedSpeedSr: e.target.value })
                          }
                          className="w-12 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-center"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.authorizedSpeedOs}
                          onChange={(e) =>
                            setRowDraft({ ...rowDraft, authorizedSpeedOs: e.target.value })
                          }
                          className="w-12 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-center"
                        />
                      </td>
                      <td className="py-2 px-1.5 text-center bg-blue-100/60 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleSaveRow(r.slNo)}
                            title="Save row modifications"
                            className="p-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded cursor-pointer"
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const recomputed = recomputeRouteFromTags(
                                r,
                                project.tags,
                                project.signals,
                              );
                              if (onUpdateRoute) onUpdateRoute(r.slNo, recomputed);
                              startEditRow({ ...r, ...recomputed });
                            }}
                            title="Recompute linking distance from tags"
                            className="p-1 bg-blue-600 hover:bg-blue-700 text-white rounded cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSlNo(null);
                              setRowDraft(null);
                            }}
                            title="Cancel editing"
                            className="p-1 bg-slate-300 hover:bg-slate-400 text-slate-800 rounded cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return perms.map((perm, pIdx) => (
                  <tr
                    key={`${r.slNo}-${pIdx}`}
                    className={`hover:bg-slate-100/80 transition-colors ${
                      pIdx === 0 ? "border-t border-slate-300" : ""
                    }`}
                  >
                    <td className="py-2 px-2 border-r border-slate-300 text-center font-bold text-slate-900">
                      {pIdx === 0 ? r.slNo : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 font-bold text-slate-900 whitespace-nowrap">
                      {pIdx === 0 ? r.entrySignal : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 font-bold text-slate-900 whitespace-nowrap">
                      {pIdx === 0 ? r.exitSignal : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-800 whitespace-nowrap font-sans">
                      {pIdx === 0 ? r.leadingToLine : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-700 font-sans whitespace-nowrap">
                      {pIdx === 0 ? r.sectionType || "Station Section" : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-700 font-sans">
                      {pIdx === 0 ? r.signalType : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 font-medium text-slate-900 whitespace-nowrap">
                      {perm.aspectOfEntrySignal}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-800 whitespace-nowrap">
                      {perm.requiresAspectOfExitSignal}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-center font-bold text-blue-900">
                      {pIdx === 0 ? r.requiredRouteLocking || "-" : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-emerald-800 font-bold">
                      {pIdx === 0 ? r.pointsNormal.join(", ") || "-" : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-amber-800 font-bold">
                      {pIdx === 0 ? r.pointsReverse.join(", ") || "-" : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-800">
                      {pIdx === 0 ? r.trackCktUp || "-" : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-800">
                      {pIdx === 0 ? r.trackCircuitInOverlap || r.overlapTrackCkt || "-" : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-800">
                      {pIdx === 0 ? r.tinsRequiresFree.join(", ") || "-" : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-800">
                      {pIdx === 0 ? r.tinsInOverlap?.join(", ") || r.overlapTins?.join(", ") || "-" : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 font-bold text-amber-900">
                      {pIdx === 0 ? r.entryFootTag : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 font-mono text-[10px] text-slate-700">
                      {pIdx === 0 ? displaySeq : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-right font-bold text-slate-900">
                      {pIdx === 0 ? r.distanceBetweenSignalsM : ""}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-center font-bold">
                      {perm.movementAuthoritySections}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-center font-bold text-slate-800">
                      {perm.authorizedSpeedSr || r.authorizedSpeedSr || "MPS"}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-center font-bold text-slate-800">
                      {perm.authorizedSpeedOs || r.authorizedSpeedOs || "MPS"}
                    </td>
                    <td className="py-2 px-1 text-center bg-slate-50">
                      {pIdx === 0 && (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEditRow(r)}
                            title="Edit route parameters"
                            className="p-1 text-blue-700 hover:bg-blue-100 rounded cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const recomputed = recomputeRouteFromTags(
                                r,
                                project.tags,
                                project.signals,
                              );
                              if (onUpdateRoute) onUpdateRoute(r.slNo, recomputed);
                            }}
                            title="Recompute linking distance from tags"
                            className="p-1 text-slate-600 hover:bg-slate-200 rounded cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>

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

      {/* Prominent Bottom Save & Redirect Banner */}
      <div className="bg-slate-900 text-white rounded-lg p-5 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-white tracking-wide">
            Ready to finalize Table of Control for {project.metadata.stationName || "Station"} (
            {project.metadata.stationCode || "---"})?
          </h3>
          <p className="text-xs text-slate-300">
            All modifications will be saved and official Table of Control downloads (Excel, PDF, CSV, JSON)
            will be updated with verified parameters.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSaveAndProceedClick}
          className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 active:bg-emerald-500 rounded-md shadow transition-all cursor-pointer whitespace-nowrap"
        >
          <span>Save Modifications &amp; Proceed to TOC</span>
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
