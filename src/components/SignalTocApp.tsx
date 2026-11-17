// @ts-nocheck -- ported from the original app (written for a looser TS config)
import { useEffect, useMemo, useState } from 'react';
import { ExtractedInventoryView } from './ExtractedInventoryView';
import { TopNav, type WorkspaceTab } from './TopNav';
import { TocTableView } from './TocTableView';
import { TrackSchematicView } from './TrackSchematicView';
import { UploadModal } from './UploadModal';
import { ValidationPanel } from './ValidationPanel';
import { runEngineeringValidation } from '../engine/validator';
import { clearAllStoredData, saveLocalProjects } from '../utils/projectStore';
import type {
  RfidTag,
  SignalNode,
  StationMetadata,
  StationProject,
  TocFormatMode,
  TocRouteRow,
} from '../types/signalling';

export default function App() {
  const [projects, setProjects] = useState<StationProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('schematic');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedRouteSlNo, setSelectedRouteSlNo] = useState<number | null>(null);
  const [validationRouteFilter, setValidationRouteFilter] = useState<number | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    let active = true;
    void clearAllStoredData().finally(() => {
      if (active) {
        setProjects([]);
        setActiveProjectId(null);
        setStorageReady(true);
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (storageReady && projects.length > 0) {
      void saveLocalProjects(projects).catch(() => undefined);
    }
  }, [projects, storageReady]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId]
  );

  const updateProjectWithRevalidation = (
    projectId: string,
    updater: (prev: StationProject) => StationProject,
    auditAction?: { action: string; target: string; details: string }
  ) => {
    setProjects((prevList) =>
      prevList.map((proj) => {
        if (proj.id !== projectId) return proj;
        const updated = updater(proj);
        const existingResolutions: Record<string, { resolved: boolean; resolvedNote?: string }> = {};
        for (const issue of updated.validationIssues) {
          if (issue.resolved || issue.resolvedNote) {
            existingResolutions[issue.id] = {
              resolved: issue.resolved,
              resolvedNote: issue.resolvedNote,
            };
          }
        }
        const recomputedIssues = runEngineeringValidation(updated, existingResolutions);
        const nextAudit = auditAction
          ? [
              {
                id: `aud-${Date.now()}`,
                timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
                actor: updated.metadata.signOffEngineerName || 'Signalling Engineer',
                action: auditAction.action,
                target: auditAction.target,
                details: auditAction.details,
              },
              ...updated.auditLog,
            ]
          : updated.auditLog;

        return {
          ...updated,
          validationIssues: recomputedIssues,
          auditLog: nextAudit,
        };
      })
    );
  };

  const handleProjectCreated = (newProject: StationProject) => {
    void clearAllStoredData().catch(() => undefined);
    setProjects([newProject]);
    setActiveProjectId(newProject.id);
    setSelectedRouteSlNo(null);
    setValidationRouteFilter(null);
    setActiveTab('schematic');
  };

  const handleResetApp = async () => {
    await clearAllStoredData();
    setProjects([]);
    setActiveProjectId(null);
    setSelectedRouteSlNo(null);
    setValidationRouteFilter(null);
    setActiveTab('schematic');
    window.location.reload();
  };

  const handleUpdateTag = (tagId: string, patch: Partial<RfidTag>) => {
    if (!activeProject) return;
    updateProjectWithRevalidation(
      activeProject.id,
      (proj) => ({
        ...proj,
        tags: proj.tags.map((t) => (t.id === tagId ? { ...t, ...patch } : t)),
      }),
      {
        action: 'Updated RFID Tag',
        target: activeProject.tags.find((t) => t.id === tagId)?.tagId || tagId,
        details: `Modified ${Object.keys(patch).join(', ')}`,
      }
    );
  };

  const handleAddTag = (tag: RfidTag) => {
    if (!activeProject) return;
    updateProjectWithRevalidation(
      activeProject.id,
      (proj) => ({
        ...proj,
        tags: [...proj.tags, tag],
      }),
      {
        action: 'Added RFID Tag',
        target: tag.tagId,
        details: `Added at ${tag.chainageM}m on ${tag.line} (TIN ${tag.tin})`,
      }
    );
  };

  const handleUpdateSignal = (signalId: string, patch: Partial<SignalNode>) => {
    if (!activeProject) return;
    updateProjectWithRevalidation(
      activeProject.id,
      (proj) => ({
        ...proj,
        signals: proj.signals.map((s) => (s.id === signalId ? { ...s, ...patch } : s)),
      }),
      {
        action: 'Updated Signal',
        target: activeProject.signals.find((s) => s.id === signalId)?.name || signalId,
        details: `Modified ${Object.keys(patch).join(', ')}`,
      }
    );
  };

  const handleUpdateRoute = (slNo: number, patch: Partial<TocRouteRow>) => {
    if (!activeProject) return;
    updateProjectWithRevalidation(
      activeProject.id,
      (proj) => ({
        ...proj,
        routes: proj.routes.map((r) => (r.slNo === slNo ? { ...r, ...patch } : r)),
      }),
      {
        action: 'Edited TOC Route',
        target: `Route #${slNo}`,
        details: `Updated ${Object.keys(patch).join(', ')}`,
      }
    );
  };

  const handleUpdateMetadata = (patch: Partial<StationMetadata>) => {
    if (!activeProject) return;
    updateProjectWithRevalidation(
      activeProject.id,
      (proj) => ({
        ...proj,
        metadata: { ...proj.metadata, ...patch },
      }),
      {
        action: 'Updated Station Metadata',
        target: patch.stationCode || activeProject.metadata.stationCode,
        details: `Updated ${Object.keys(patch).join(', ')}`,
      }
    );
  };

  const handleChangeTocFormat = (mode: TocFormatMode) => {
    if (!activeProject) return;
    setProjects((prev) =>
      prev.map((p) => (p.id === activeProject.id ? { ...p, tocFormatPreference: mode } : p))
    );
  };

  const handleResolveIssue = (issueId: string, resolved: boolean, note?: string) => {
    if (!activeProject) return;
    updateProjectWithRevalidation(
      activeProject.id,
      (proj) => ({
        ...proj,
        validationIssues: proj.validationIssues.map((i) =>
          i.id === issueId ? { ...i, resolved, resolvedNote: note } : i
        ),
      }),
      {
        action: resolved ? 'Verified Validation Check' : 'Reopened Validation Check',
        target: issueId,
        details: note || 'Status toggled by signalling engineer',
      }
    );
  };

  const handleVerifyAllWarnings = () => {
    if (!activeProject) return;
    updateProjectWithRevalidation(
      activeProject.id,
      (proj) => ({
        ...proj,
        validationIssues: proj.validationIssues.map((i) =>
          i.severity === 'WARNING' || i.severity === 'INFO'
            ? { ...i, resolved: true, resolvedNote: i.resolvedNote || 'Verified against CAD layout' }
            : i
        ),
      }),
      {
        action: 'Verified Open Warnings',
        target: activeProject.metadata.stationCode,
        details: 'Marked open advisory warnings and notices verified against CAD layout',
      }
    );
  };

  const handleToggleSignOff = (engineerName: string) => {
    if (!activeProject) return;
    updateProjectWithRevalidation(
      activeProject.id,
      (proj) => ({
        ...proj,
        metadata: {
          ...proj.metadata,
          engineerSignedOff: !proj.metadata.engineerSignedOff,
          signOffEngineerName: engineerName,
          signOffTimestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
        },
      }),
      {
        action: activeProject.metadata.engineerSignedOff ? 'Revoked TOC Sign-off' : 'Signed Off TOC',
        target: activeProject.metadata.stationCode,
        details: `Signalling Engineer: ${engineerName}`,
      }
    );
  };

  const openErrors = activeProject
    ? activeProject.validationIssues.filter((i) => i.severity === 'ERROR' && !i.resolved).length
    : 0;
  const openWarnings = activeProject
    ? activeProject.validationIssues.filter((i) => i.severity === 'WARNING' && !i.resolved).length
    : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <TopNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onResetApp={handleResetApp}
      />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6 space-y-6">
        {/* Station Context Header (shown once a CAD layout is loaded in session) */}
        {activeProject && (
          <section className="no-print bg-white border border-slate-200 rounded-lg p-5 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>KAVACH Signalling Workbench</span>
                  <span aria-hidden="true">·</span>
                  <span>Station Code {activeProject.metadata.stationCode}</span>
                  <span aria-hidden="true">·</span>
                  <span>Station ID {activeProject.metadata.stationId}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-700">{activeProject.metadata.refLayout}</span>
                </div>
                <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight text-balance">
                  {activeProject.metadata.stationName} ({activeProject.metadata.stationCode})
                </h1>
              </div>
            </div>

            {/* 4-Step Workflow Strip */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="text-left p-3 rounded-md border border-slate-200 hover:border-blue-400 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <div className="text-xs font-medium text-slate-500">01. Upload Layout</div>
                <div className="text-sm font-semibold text-slate-900 mt-1 truncate">
                  {activeProject.sourceLayout?.fileName || activeProject.metadata.refSip}
                </div>
                <div className="text-xs text-blue-700 mt-1">Replace (.dwg / .dxf / .pdf)</div>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('inventory')}
                className={`text-left p-3 rounded-md border transition-colors cursor-pointer ${
                  activeTab === 'inventory' || activeTab === 'schematic'
                    ? 'border-blue-300 bg-blue-50/40'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="text-xs font-medium text-slate-500">02. Extract &amp; Map</div>
                <div className="text-sm font-mono tabular-nums font-semibold text-slate-900 mt-1">
                  {activeProject.signals.length} Signals · {activeProject.tags.length} Tags
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {activeProject.tracks.length} Tracks · {activeProject.points.length} Points
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('validation')}
                className={`text-left p-3 rounded-md border transition-colors cursor-pointer ${
                  activeTab === 'validation'
                    ? 'border-blue-300 bg-blue-50/40'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="text-xs font-medium text-slate-500">03. Engineer Validation</div>
                <div className="text-sm font-mono tabular-nums font-semibold text-slate-900 mt-1">
                  {activeProject.routes.length} Routes Configured
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  Editable Preview &amp; Verification
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('toc')}
                className={`text-left p-3 rounded-md border transition-colors cursor-pointer ${
                  activeTab === 'toc'
                    ? 'border-blue-300 bg-blue-50/40'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="text-xs font-medium text-slate-500">04. Generate TOC</div>
                <div className="text-sm font-mono tabular-nums font-semibold text-slate-900 mt-1">
                  {activeProject.routes.length} Routes Compiled
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  Export Excel · CSV · Print PDF
                </div>
              </button>
            </div>
          </section>
        )}

        {/* Active Workspace View */}
        {activeTab === 'schematic' && (
          <TrackSchematicView
            project={activeProject}
            selectedRouteSlNo={selectedRouteSlNo}
            onSelectRoute={setSelectedRouteSlNo}
            onJumpToValidation={(slNo) => {
              setValidationRouteFilter(slNo ?? null);
              setActiveTab('validation');
            }}
            onUpdateMetadata={handleUpdateMetadata}
            onOpenUpload={() => setUploadOpen(true)}
          />
        )}

        {activeTab !== 'schematic' && !activeProject && (
          <div className="bg-white border border-slate-200 rounded-lg p-10 text-center space-y-3">
            <h2 className="text-base font-display font-semibold text-slate-900">
              No Layout Loaded
            </h2>
            <p className="text-xs text-slate-600 max-w-md mx-auto">
              Upload a station layout (.dwg, .dxf, or .pdf) in Track Schematic to inspect extracted signalling data, validation checks, and the generated Table of Control.
            </p>
            <button
              type="button"
              onClick={() => setActiveTab('schematic')}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
            >
              Go to Upload Layout
            </button>
          </div>
        )}

        {activeTab === 'inventory' && activeProject && (
          <ExtractedInventoryView
            project={activeProject}
            onUpdateTag={handleUpdateTag}
            onAddTag={handleAddTag}
            onUpdateSignal={handleUpdateSignal}
          />
        )}

        {activeTab === 'validation' && activeProject && (
          <ValidationPanel
            project={activeProject}
            filterRouteSlNo={validationRouteFilter}
            onClearRouteFilter={() => setValidationRouteFilter(null)}
            onResolveIssue={handleResolveIssue}
            onUpdateRoute={handleUpdateRoute}
            onUpdateMetadata={handleUpdateMetadata}
            onSaveAndProceed={() => {
              setActiveTab('toc');
            }}
            onInspectRouteOnSchematic={(slNo) => {
              setSelectedRouteSlNo(slNo);
              setActiveTab('schematic');
            }}
            onInspectRouteInToc={(slNo) => {
              setSelectedRouteSlNo(slNo);
              setActiveTab('toc');
            }}
            onToggleEngineerSignOff={handleToggleSignOff}
            onVerifyAllWarnings={handleVerifyAllWarnings}
          />
        )}

        {activeTab === 'toc' && activeProject && (
          <TocTableView
            project={activeProject}
            highlightedRouteSlNo={selectedRouteSlNo}
            onChangeFormat={handleChangeTocFormat}
            onUpdateRoute={handleUpdateRoute}
            onHighlightOnSchematic={(slNo) => {
              setSelectedRouteSlNo(slNo);
              setActiveTab('schematic');
            }}
          />
        )}
      </main>

      <footer className="no-print border-t border-slate-200 bg-white mt-8">
        <div className="max-w-[1440px] mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>
            SignalTOC Draft Generation Aid — Generated Tables of Control must be verified by a qualified Signalling Engineer prior to commissioning.
          </span>
          <span>RDSO SPN-196 KAVACH · Indian Railways Signalling Workflow</span>
        </div>
      </footer>

      <UploadModal
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onProjectCreated={handleProjectCreated}
      />
    </div>
  );
}
