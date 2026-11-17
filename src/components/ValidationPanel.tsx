import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Edit3,
  RefreshCw,
  Save,
  Search,
  X,
} from 'lucide-react';
import { recomputeRouteFromTags } from '../engine/validator';
import type {
  StationMetadata,
  StationProject,
  TocRouteRow,
} from '../types/signalling';

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
  onUpdateRoute,
  onUpdateMetadata,
  onSaveAndProceed,
}) => {
  const [editingSlNo, setEditingSlNo] = useState<number | null>(null);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [dirFilter, setDirFilter] = useState<'ALL' | 'DOWN' | 'UP'>('ALL');
  const [search, setSearch] = useState('');

  // Row edit state
  const [rowDraft, setRowDraft] = useState<{
    entrySignal: string;
    exitSignal: string;
    leadingToLine: string;
    tsrmsRouteId: string;
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
  });

  const filteredRoutes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return project.routes.filter((r) => {
      if (dirFilter === 'DOWN' && r.direction !== 'DOWN') return false;
      if (dirFilter === 'UP' && r.direction !== 'UP') return false;
      if (!q) return true;
      return (
        r.entrySignal.toLowerCase().includes(q) ||
        r.exitSignal.toLowerCase().includes(q) ||
        r.leadingToLine.toLowerCase().includes(q) ||
        r.entryFootTag.toLowerCase().includes(q) ||
        (r.tsrmsRouteId && r.tsrmsRouteId.toLowerCase().includes(q))
      );
    });
  }, [project.routes, dirFilter, search]);

  const startEditRow = (r: TocRouteRow) => {
    setEditingSlNo(r.slNo);
    const seqParts: string[] = [];
    for (const s of r.linkingSequence) {
      if (s.tagId !== r.entryFootTag) seqParts.push(`(${s.distanceM}, ${s.tagId})`);
    }
    const displaySeq = seqParts.length > 0 ? seqParts.join(', ') : r.enRouteTags.filter((t) => t !== r.entryFootTag).join(', ');

    setRowDraft({
      entrySignal: r.entrySignal,
      exitSignal: r.exitSignal,
      leadingToLine: r.leadingToLine,
      tsrmsRouteId: r.tsrmsRouteId || String(r.slNo),
      sectionType: r.sectionType || 'Station Section',
      signalType: r.signalType || 'Stop Signal',
      aspectOfEntrySignal: r.aspectOfEntrySignal || 'Green',
      requiresAspectOfExitSignal: r.requiresAspectOfExitSignal || `${r.exitSignal} Green`,
      requiredRouteLocking: r.requiredRouteLocking || '-',
      pointsNormalStr: r.pointsNormal.join(', '),
      pointsReverseStr: r.pointsReverse.join(', '),
      trackCktUp: r.trackCktUp || '-',
      trackCircuitInOverlap: r.trackCircuitInOverlap || r.overlapTrackCkt || '-',
      tinsRequiresFreeStr: r.tinsRequiresFree.join(', '),
      entryFootTag: r.entryFootTag || '',
      enRouteTagsStr: displaySeq,
      distanceBetweenSignalsM: r.distanceBetweenSignalsM || 0,
      movementAuthoritySections: r.movementAuthoritySections || '1',
      authorizedSpeedSr: r.authorizedSpeedSr || 'MPS',
      authorizedSpeedOs: r.authorizedSpeedOs || 'MPS',
    });
  };

  const handleSaveRow = (slNo: number) => {
    if (!rowDraft || !onUpdateRoute) return;
    const pointsNormal = rowDraft.pointsNormalStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== '-');
    const pointsReverse = rowDraft.pointsReverseStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== '-');
    const tinsRequiresFree = rowDraft.tinsRequiresFreeStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== '-');

    // Parse custom tags if entered
    const parsedEnRouteTags: string[] = rowDraft.enRouteTagsStr
      .replace(/[()]/g, ' ')
      .split(',')
      .map((s) => s.trim())
      .map((part) => {
        const tokens = part.split(/\s+/).filter(Boolean);
        return (tokens.length > 1 ? tokens[1] : tokens[0]) || '';
      })
      .filter((t) => Boolean(t) && t !== '-');

    const patch: Partial<TocRouteRow> = {
      entrySignal: rowDraft.entrySignal,
      exitSignal: rowDraft.exitSignal,
      leadingToLine: rowDraft.leadingToLine,
      tsrmsRouteId: rowDraft.tsrmsRouteId,
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
      {/* Top Engineer Validation Action Bar */}
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
            Engineer Validation
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Review and customize the Table of Control in editable format below. You can directly edit any route cells, modify points, track circuits, speeds, or RFID linking intervals. When finished, save your modifications and proceed to final TOC generation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Primary Save & Proceed Button */}
          <button
            type="button"
            onClick={handleSaveAndProceedClick}
            className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 active:bg-blue-900 rounded-md shadow-sm transition-all cursor-pointer whitespace-nowrap"
          >
            <span>Save Modifications &amp; Proceed to Next Page</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* EDITABLE PRINT PREVIEW (AUTHENTIC RDSO SELECTION TABLE WITH INLINE EDITING) */}
      <div className="bg-white border-2 border-slate-800 rounded-lg shadow-md overflow-hidden">
        {/* Engineering Sheet Header & Title Block */}
        <div className="p-4 border-b-2 border-slate-800 bg-slate-50">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-300 pb-3 mb-3">
            <div>
              <div className="text-[11px] font-mono tracking-wider uppercase text-slate-500">
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{editingMetadata ? 'Close Metadata Editor' : 'Edit Sheet Metadata'}</span>
              </button>
            </div>
          </div>

          {/* Editable or Display Sheet Metadata Grid */}
          {editingMetadata ? (
            <div className="bg-white p-4 rounded-md border border-slate-300 space-y-3 mb-3">
              <div className="text-xs font-bold text-slate-900 border-b pb-1">Edit Sheet Title Block</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-slate-500 mb-1">Station Name</label>
                  <input
                    type="text"
                    value={metaDraft.stationName || ''}
                    onChange={(e) => setMetaDraft({ ...metaDraft, stationName: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Station Code</label>
                  <input
                    type="text"
                    value={metaDraft.stationCode || ''}
                    onChange={(e) => setMetaDraft({ ...metaDraft, stationCode: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Station ID</label>
                  <input
                    type="text"
                    value={metaDraft.stationId || ''}
                    onChange={(e) => setMetaDraft({ ...metaDraft, stationId: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Division</label>
                  <input
                    type="text"
                    value={metaDraft.division || ''}
                    onChange={(e) => setMetaDraft({ ...metaDraft, division: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Railway / Zone</label>
                  <input
                    type="text"
                    value={metaDraft.railwayZone || ''}
                    onChange={(e) => setMetaDraft({ ...metaDraft, railwayZone: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Ref Layout Drawing</label>
                  <input
                    type="text"
                    value={metaDraft.refLayout || ''}
                    onChange={(e) => setMetaDraft({ ...metaDraft, refLayout: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Ref SIP No</label>
                  <input
                    type="text"
                    value={metaDraft.refSip || ''}
                    onChange={(e) => setMetaDraft({ ...metaDraft, refSip: e.target.value })}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingMetadata(false)}
                  className="px-3 py-1 text-xs text-slate-600 hover:text-slate-900 border rounded cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveMetadata}
                  className="px-4 py-1 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded cursor-pointer"
                >
                  Save Title Block
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-2 text-xs border border-slate-300 bg-white p-3 rounded">
              <div>
                <span className="text-slate-500 block">Station Name:</span>
                <span className="font-bold text-slate-900 text-sm">
                  {project.metadata.stationName || '----'} ({project.metadata.stationCode || '---'})
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Station ID:</span>
                <span className="font-mono font-bold text-slate-900">{project.metadata.stationId || '----'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Division &amp; Zone:</span>
                <span className="font-semibold text-slate-800">
                  {project.metadata.division || '----'} / {project.metadata.railwayZone || '----'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Ref SIP / Alt:</span>
                <span className="font-mono text-slate-800">{project.metadata.refSip || 'SIP-001'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Ref RFID Layout:</span>
                <span className="font-mono text-slate-800">{project.metadata.refLayout || 'LAYOUT-01'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Specification:</span>
                <span className="font-semibold text-emerald-800">RDSO SPN-196 Amdt-6</span>
              </div>
            </div>
          )}

          {/* Quick search and direction filter toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-200">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <span>Filter Direction:</span>
              {(['ALL', 'DOWN', 'UP'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirFilter(d)}
                  className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                    dirFilter === d
                      ? 'bg-slate-900 text-white font-bold'
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
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

        {/* Table 1: Stationary KAVACH Table of Control (22 RDSO Columns) */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-200/80 border-b border-slate-400 text-slate-900 font-bold text-[11px] uppercase tracking-wide">
                <th className="py-2.5 px-2 border-r border-slate-300 text-center">S.No</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Entry Sig</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Exit Sig</th>
                <th className="py-2.5 px-2 border-r border-slate-300">Line</th>
                <th className="py-2.5 px-2 border-r border-slate-300 text-center">TSRMS ID</th>
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
                <th className="py-2.5 px-2 border-r border-slate-300">Foot Tag</th>
                <th className="py-2.5 px-2 border-r border-slate-300 min-w-[200px]">Check RFID Sequence</th>
                <th className="py-2.5 px-2 border-r border-slate-300 text-right">Dist (m)</th>
                <th className="py-2.5 px-2 border-r border-slate-300 text-center">MA</th>
                <th className="py-2.5 px-2 border-r border-slate-300 text-center">SR Spd</th>
                <th className="py-2.5 px-2 border-r border-slate-300 text-center">OS Spd</th>
                <th className="py-2.5 px-2 text-center bg-slate-300/80">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 font-mono text-slate-800">
              {filteredRoutes.map((r) => {
                const isEditing = editingSlNo === r.slNo;
                const perms = r.aspectPermutations && r.aspectPermutations.length > 0
                  ? r.aspectPermutations
                  : [{
                      aspectOfEntrySignal: r.aspectOfEntrySignal || 'Green',
                      requiresAspectOfExitSignal: r.requiresAspectOfExitSignal || `${r.exitSignal} Green`,
                      movementAuthoritySections: r.movementAuthoritySections || '4',
                      authorizedSpeedOs: r.authorizedSpeedOs || 'MPS',
                    }];

                const seqParts: string[] = [];
                for (const s of r.linkingSequence) {
                  if (s.tagId !== r.entryFootTag) seqParts.push(`(${s.distanceM}, ${s.tagId})`);
                }
                const displaySeq = seqParts.length > 0 ? seqParts.join(', ') : (r.enRouteTags.filter((t) => t !== r.entryFootTag).join(', ') || '-');

                if (isEditing && rowDraft) {
                  return (
                    <tr key={`edit-${r.slNo}`} className="bg-blue-50/90 font-sans border-y-2 border-blue-600">
                      <td className="py-2 px-1 border-r border-slate-300 text-center font-bold">{r.slNo}</td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.entrySignal}
                          onChange={(e) => setRowDraft({ ...rowDraft, entrySignal: e.target.value })}
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
                          onChange={(e) => setRowDraft({ ...rowDraft, leadingToLine: e.target.value })}
                          className="w-24 px-1 py-0.5 border border-blue-400 bg-white rounded text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.tsrmsRouteId}
                          onChange={(e) => setRowDraft({ ...rowDraft, tsrmsRouteId: e.target.value })}
                          className="w-14 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-center"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.sectionType}
                          onChange={(e) => setRowDraft({ ...rowDraft, sectionType: e.target.value })}
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
                          onChange={(e) => setRowDraft({ ...rowDraft, aspectOfEntrySignal: e.target.value })}
                          className="w-20 px-1 py-0.5 border border-blue-400 bg-white rounded text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.requiresAspectOfExitSignal}
                          onChange={(e) => setRowDraft({ ...rowDraft, requiresAspectOfExitSignal: e.target.value })}
                          className="w-24 px-1 py-0.5 border border-blue-400 bg-white rounded text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.requiredRouteLocking}
                          onChange={(e) => setRowDraft({ ...rowDraft, requiredRouteLocking: e.target.value })}
                          className="w-16 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-center font-bold"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.pointsNormalStr}
                          onChange={(e) => setRowDraft({ ...rowDraft, pointsNormalStr: e.target.value })}
                          placeholder="e.g. 11, 13"
                          className="w-20 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-emerald-800"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.pointsReverseStr}
                          onChange={(e) => setRowDraft({ ...rowDraft, pointsReverseStr: e.target.value })}
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
                          onChange={(e) => setRowDraft({ ...rowDraft, trackCircuitInOverlap: e.target.value })}
                          className="w-16 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.tinsRequiresFreeStr}
                          onChange={(e) => setRowDraft({ ...rowDraft, tinsRequiresFreeStr: e.target.value })}
                          className="w-20 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.entryFootTag}
                          onChange={(e) => setRowDraft({ ...rowDraft, entryFootTag: e.target.value })}
                          className="w-16 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-amber-900 font-bold"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300 font-mono text-[11px] text-slate-700">
                        <input
                          type="text"
                          value={rowDraft.enRouteTagsStr}
                          onChange={(e) => setRowDraft({ ...rowDraft, enRouteTagsStr: e.target.value })}
                          className="w-full px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-[11px]"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="number"
                          value={rowDraft.distanceBetweenSignalsM}
                          onChange={(e) => setRowDraft({ ...rowDraft, distanceBetweenSignalsM: Number(e.target.value) })}
                          className="w-16 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-right"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.movementAuthoritySections}
                          onChange={(e) => setRowDraft({ ...rowDraft, movementAuthoritySections: e.target.value })}
                          className="w-8 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-center"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.authorizedSpeedSr}
                          onChange={(e) => setRowDraft({ ...rowDraft, authorizedSpeedSr: e.target.value })}
                          className="w-12 px-1 py-0.5 border border-blue-400 bg-white rounded font-mono text-xs text-center"
                        />
                      </td>
                      <td className="py-2 px-1 border-r border-slate-300">
                        <input
                          type="text"
                          value={rowDraft.authorizedSpeedOs}
                          onChange={(e) => setRowDraft({ ...rowDraft, authorizedSpeedOs: e.target.value })}
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
                              const recomputed = recomputeRouteFromTags(r, project.tags, project.signals);
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
                      pIdx === 0 ? 'border-t border-slate-300' : ''
                    }`}
                  >
                    <td className="py-2 px-2 border-r border-slate-300 text-center font-bold text-slate-900">
                      {pIdx === 0 ? r.slNo : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 font-bold text-slate-900 whitespace-nowrap">
                      {pIdx === 0 ? r.entrySignal : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 font-bold text-slate-900 whitespace-nowrap">
                      {pIdx === 0 ? r.exitSignal : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-800 whitespace-nowrap font-sans">
                      {pIdx === 0 ? r.leadingToLine : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-center font-bold">
                      {pIdx === 0 ? (r.tsrmsRouteId || String(r.slNo)) : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-700 font-sans whitespace-nowrap">
                      {pIdx === 0 ? (r.sectionType || 'Station Section') : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-700 font-sans">
                      {pIdx === 0 ? r.signalType : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 font-sans font-semibold text-slate-900">
                      {perm.aspectOfEntrySignal}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 font-sans text-slate-700">
                      {perm.requiresAspectOfExitSignal}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-center font-bold text-slate-900">
                      {pIdx === 0 ? (r.requiredRouteLocking || '-') : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-emerald-800">
                      {pIdx === 0 ? (r.pointsNormal.join(', ') || '-') : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-amber-800">
                      {pIdx === 0 ? (r.pointsReverse.join(', ') || '-') : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-700">
                      {pIdx === 0 ? (r.trackCktUp || '-') : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-600">
                      {pIdx === 0 ? (r.trackCircuitInOverlap || r.overlapTrackCkt || '-') : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-slate-800">
                      {pIdx === 0 ? (r.tinsRequiresFree.join(', ') || '-') : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 font-bold text-amber-900 whitespace-nowrap">
                      {pIdx === 0 ? r.entryFootTag : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-[11px] text-slate-800 leading-relaxed font-mono">
                      {pIdx === 0 ? displaySeq : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-right font-bold text-slate-900">
                      {pIdx === 0 ? r.distanceBetweenSignalsM : ''}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-center font-bold text-slate-900">
                      {perm.movementAuthoritySections}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-center font-bold text-slate-800">
                      {pIdx === 0 ? (r.authorizedSpeedSr || perm.authorizedSpeedSr || 'MPS') : (perm.authorizedSpeedSr || '')}
                    </td>
                    <td className="py-2 px-2 border-r border-slate-300 text-center font-bold text-slate-800">
                      {perm.authorizedSpeedOs}
                    </td>
                    <td className="py-2 px-2 text-center bg-slate-100/50 whitespace-nowrap font-sans">
                      {pIdx === 0 && (
                        <div className="inline-flex items-center gap-1">
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
                              const recomputed = recomputeRouteFromTags(r, project.tags, project.signals);
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
      </div>

      {/* Prominent Bottom Save & Redirect Banner */}
      <div className="bg-slate-900 text-white rounded-lg p-5 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-white tracking-wide">
            Ready to finalize Table of Control for {project.metadata.stationName || 'Station'} ({project.metadata.stationCode || '---'})?
          </h3>
          <p className="text-xs text-slate-300">
            All modifications will be saved and official Table of Control downloads (Excel &amp; PDF) will be generated.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSaveAndProceedClick}
          className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 active:bg-emerald-500 rounded-md shadow transition-all cursor-pointer whitespace-nowrap"
        >
          <span>Save Modifications &amp; Proceed to Next Page</span>
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
