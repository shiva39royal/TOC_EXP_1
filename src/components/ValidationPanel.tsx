import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { StationProject, ValidationIssue } from '../types/signalling';

interface ValidationPanelProps {
  project: StationProject;
  filterRouteSlNo: number | null;
  onClearRouteFilter: () => void;
  onResolveIssue: (issueId: string, resolved: boolean, note?: string) => void;
  onInspectRouteOnSchematic: (slNo: number) => void;
  onInspectRouteInToc: (slNo: number) => void;
  onToggleEngineerSignOff: (engineerName: string) => void;
  onVerifyAllWarnings?: () => void;
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
}) => {
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'ERROR' | 'WARNING' | 'INFO'>('ALL');
  const [engineerName, setEngineerName] = useState(project.metadata.signOffEngineerName || '');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const counts = useMemo(() => {
    const openErrors = project.validationIssues.filter((i) => i.severity === 'ERROR' && !i.resolved).length;
    const openWarnings = project.validationIssues.filter((i) => i.severity === 'WARNING' && !i.resolved).length;
    const resolved = project.validationIssues.filter((i) => i.resolved).length;
    return { openErrors, openWarnings, resolved, total: project.validationIssues.length };
  }, [project.validationIssues]);

  const visibleIssues = useMemo(() => {
    return project.validationIssues.filter((issue) => {
      if (filterRouteSlNo !== null && issue.affectedRouteSlNo !== filterRouteSlNo) return false;
      if (severityFilter !== 'ALL' && issue.severity !== severityFilter) return false;
      return true;
    });
  }, [project.validationIssues, filterRouteSlNo, severityFilter]);

  const renderSeverityLabel = (issue: ValidationIssue) => {
    if (issue.resolved) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          Resolved
        </span>
      );
    }
    if (issue.severity === 'ERROR') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
          <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
          Critical Error
        </span>
      );
    }
    if (issue.severity === 'WARNING') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
          Ambiguity / Warning
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
        Info Notice
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Engineering Sign-Off Gate */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <div className="flex items-center gap-2">
            <ShieldCheck
              className={`w-4 h-4 ${project.metadata.engineerSignedOff ? 'text-emerald-700' : 'text-amber-700'}`}
              aria-hidden="true"
            />
            <h2 className="text-sm font-display font-semibold text-slate-900">
              Signalling Engineer Verification Gate
            </h2>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Automated checks verify chainage spacing, linking sums, point conflicts, and TIN coverage. Ambiguous annotations or alterations must be confirmed by a qualified signalling engineer before commissioning.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={engineerName}
            onChange={(e) => setEngineerName(e.target.value)}
            placeholder="Engineer Name / Designation (e.g. SSE/TCAS)"
            aria-label="Signalling Engineer Name"
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 w-64 focus:outline-none focus:border-blue-600"
          />
          <button
            type="button"
            disabled={counts.openErrors > 0 || !engineerName.trim()}
            onClick={() => onToggleEngineerSignOff(engineerName.trim())}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              project.metadata.engineerSignedOff
                ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                : 'bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {project.metadata.engineerSignedOff ? 'Verified & Signed Off' : 'Approve Draft TOC'}
          </button>
        </div>
      </div>

      {/* Filter & Summary Row */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                { id: 'ALL', label: `All Checks (${counts.total})` },
                { id: 'ERROR', label: `Critical Errors (${counts.openErrors})` },
                { id: 'WARNING', label: `Warnings (${counts.openWarnings})` },
                { id: 'INFO', label: 'Notices' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSeverityFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                  severityFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            {filterRouteSlNo !== null && (
              <button
                type="button"
                onClick={onClearRouteFilter}
                className="text-blue-700 font-medium hover:underline cursor-pointer"
              >
                Showing Route #{filterRouteSlNo} only · Clear filter
              </button>
            )}
            {onVerifyAllWarnings && counts.openWarnings > 0 && (
              <button
                type="button"
                onClick={onVerifyAllWarnings}
                className="px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 cursor-pointer transition-colors"
              >
                Mark Warnings Verified ({counts.openWarnings})
              </button>
            )}
            <span className="font-mono tabular-nums">
              {counts.resolved} of {counts.total} resolved
            </span>
          </div>
        </div>

        {/* Issues List */}
        {visibleIssues.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-600">
            <CheckCircle2 className="w-6 h-6 text-emerald-700 mx-auto mb-2" aria-hidden="true" />
            <p className="font-medium text-slate-900">No open engineering issues in this filter</p>
            <p className="text-xs text-slate-500 mt-1">
              All chainage, linking distance, point exclusion, and TIN checks passed for the selected scope.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {visibleIssues.map((issue) => (
              <div key={issue.id} className="p-4 hover:bg-slate-50/70 transition-colors">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5 max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {renderSeverityLabel(issue)}
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-mono text-slate-500">{issue.category}</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="text-slate-500">{issue.ruleReference}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900">{issue.title}</h3>
                    <p className="text-xs text-slate-700 leading-relaxed">{issue.description}</p>
                    {issue.suggestedFix && (
                      <p className="text-xs text-slate-500">
                        Recommended action: {issue.suggestedFix}
                      </p>
                    )}
                    {issue.resolvedNote && (
                      <p className="text-xs text-emerald-800 font-medium">
                        Engineer Note: {issue.resolvedNote}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex items-center gap-2">
                      {issue.affectedRouteSlNo && (
                        <>
                          <button
                            type="button"
                            onClick={() => onInspectRouteOnSchematic(issue.affectedRouteSlNo!)}
                            className="px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-300 rounded hover:bg-white cursor-pointer"
                          >
                            View Schematic
                          </button>
                          <button
                            type="button"
                            onClick={() => onInspectRouteInToc(issue.affectedRouteSlNo!)}
                            className="px-2.5 py-1 text-xs font-medium text-blue-700 border border-blue-200 bg-blue-50 rounded hover:bg-blue-100 cursor-pointer"
                          >
                            Edit Route #{issue.affectedRouteSlNo}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          onResolveIssue(
                            issue.id,
                            !issue.resolved,
                            noteDrafts[issue.id] || issue.resolvedNote || 'Verified against SIP'
                          )
                        }
                        className={`px-3 py-1 text-xs font-semibold rounded cursor-pointer transition-colors ${
                          issue.resolved
                            ? 'bg-slate-200 text-slate-800 hover:bg-slate-300'
                            : 'bg-emerald-700 text-white hover:bg-emerald-800'
                        }`}
                      >
                        {issue.resolved ? 'Reopen' : 'Mark Verified'}
                      </button>
                    </div>
                    {!issue.resolved && (
                      <input
                        type="text"
                        value={noteDrafts[issue.id] ?? ''}
                        onChange={(e) =>
                          setNoteDrafts((prev) => ({ ...prev, [issue.id]: e.target.value }))
                        }
                        placeholder="Add verification note..."
                        className="px-2.5 py-1 text-xs border border-slate-300 rounded bg-white w-56 focus:outline-none focus:border-blue-600"
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Audit Log */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-900 mb-3">Engineering Audit Trail</h3>
        <div className="divide-y divide-slate-100 text-xs">
          {project.auditLog.slice(0, 8).map((entry) => (
            <div key={entry.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium text-slate-900">{entry.action}</span>
                <span className="text-slate-400 mx-1.5">·</span>
                <span className="font-mono text-slate-700">{entry.target}</span>
                <span className="text-slate-400 mx-1.5">·</span>
                <span className="text-slate-600">{entry.details}</span>
              </div>
              <span className="font-mono tabular-nums text-slate-400">
                {entry.actor} · {entry.timestamp}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
