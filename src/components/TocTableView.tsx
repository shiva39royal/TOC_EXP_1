import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Edit3,
  FileSpreadsheet,
  GitBranch,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react';
import { recomputeRouteFromTags } from '../engine/validator';
import type { StationProject, TocFormatMode, TocRouteRow } from '../types/signalling';
import {
  exportCanonicalJson,
  exportTocToCsv,
  exportTocToExcel,
  exportTocToPdf,
} from '../utils/exportToc';

interface TocTableViewProps {
  project: StationProject;
  highlightedRouteSlNo: number | null;
  onChangeFormat: (mode: TocFormatMode) => void;
  onUpdateRoute: (slNo: number, patch: Partial<TocRouteRow>) => void;
  onHighlightOnSchematic: (slNo: number) => void;
}

type TableSection = 'selection' | 'track_profile' | 'tsr' | 'tsl' | 'block_sos' | 'tag_inventory';

export const TocTableView: React.FC<TocTableViewProps> = ({
  project,
  highlightedRouteSlNo,
  onChangeFormat,
  onUpdateRoute,
  onHighlightOnSchematic,
}) => {
  const [section, setSection] = useState<TableSection>('selection');
  const [dirFilter, setDirFilter] = useState<'ALL' | 'DOWN' | 'UP'>('ALL');
  const [search, setSearch] = useState('');
  const [editingSlNo, setEditingSlNo] = useState<number | null>(null);

  const isStandardSelection = project.tocFormatPreference !== 'TCAS_TOC' && project.tocFormatPreference !== 'JANKAMPET_TOC';

  const normalRoutes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return project.routes.filter((r) => {
      if (dirFilter !== 'ALL' && r.direction !== dirFilter) return false;
      if (!q) return true;
      return (
        r.entrySignal.toLowerCase().includes(q) ||
        r.exitSignal.toLowerCase().includes(q) ||
        r.leadingToLine.toLowerCase().includes(q) ||
        r.entryFootTag.toLowerCase().includes(q) ||
        r.tinsRequiresFree.join(',').toLowerCase().includes(q)
      );
    });
  }, [project.routes, dirFilter, search]);

  const tslCount = useMemo(() => (project.tslRoutes?.length || project.routes.filter((r) => r.isTsl).length), [project]);

  return (
    <div className="space-y-4">
      {/* TOC Header & Export Controls */}
      <div className="no-print bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => onChangeFormat('STANDARD_SELECTION')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                isStandardSelection ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Standard Selection Format (RDSO Amdt-6)
            </button>
            <button
              type="button"
              onClick={() => onChangeFormat('TCAS_TOC')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                !isStandardSelection ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              TCAS Station TOC Format
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setSection('selection')}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                section === 'selection' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600'
              }`}
            >
              Table 1: Table of Control ({project.routes.length})
            </button>
            <button
              type="button"
              onClick={() => setSection('track_profile')}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                section === 'track_profile' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600'
              }`}
            >
              Table 2: Track Profile ({project.trackProfiles?.length || project.routes.length})
            </button>
            <button
              type="button"
              onClick={() => setSection('tsr')}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                section === 'tsr' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600'
              }`}
            >
              Table 3: TSR Routes ({project.tsrRoutes?.length || project.tracks.length})
            </button>
            <button
              type="button"
              onClick={() => setSection('tsl')}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                section === 'tsl' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600'
              }`}
            >
              Table 4: TSL Working ({tslCount})
            </button>
            <button
              type="button"
              onClick={() => setSection('block_sos')}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                section === 'block_sos' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600'
              }`}
            >
              Block &amp; Shunting Limits ({project.blockSections?.length || 0})
            </button>
            <button
              type="button"
              onClick={() => setSection('tag_inventory')}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                section === 'tag_inventory' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600'
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
          <div className="h-4 w-px bg-slate-300 mx-1" aria-hidden="true" />
          <button
            type="button"
            onClick={() => exportTocToPdf(project, 'all')}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer whitespace-nowrap"
            title="Print entire 12-page RDSO booklet including all tables"
          >
            <span>Print All Tables</span>
          </button>
        </div>
      </div>

      {/* Engineering Drawing Container matching Indian Railways RDSO Amdt-6 Layout */}
      <div className="print-full bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-x-8 gap-y-1 text-xs">
            <div>
              <span className="text-slate-500">Station: </span>
              <span className="font-semibold text-slate-900">
                {project.metadata.stationName} ({project.metadata.stationCode})
              </span>
            </div>
            <div>
              <span className="text-slate-500">Station ID: </span>
              <span className="font-mono font-semibold text-slate-900">{project.metadata.stationId}</span>
            </div>
            <div>
              <span className="text-slate-500">Ref Layout: </span>
              <span className="font-mono text-slate-800">{project.metadata.refLayout || '----'}</span>
            </div>
            <div>
              <span className="text-slate-500">Specification: </span>
              <span className="font-medium text-emerald-800">RDSO/SPN/196/2020 v4.0 Amdt-6</span>
            </div>
          </div>

          <div className="no-print flex items-center gap-3">
            <div className="flex items-center gap-1 p-0.5 bg-white border border-slate-200 rounded text-xs">
              {(['ALL', 'DOWN', 'UP'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirFilter(d)}
                  className={`px-2 py-1 rounded font-medium cursor-pointer ${
                    dirFilter === d ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
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

        {/* ================================================================= */}
        {/* TABLE 1: Stationary KAVACH Table of Control                       */}
        {/* ================================================================= */}
        {section === 'selection' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-semibold">
                  <th className="py-2.5 px-2.5 border-r border-slate-200">S.No</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Entry Sig</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Exit Sig</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Line</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">TSRMS ID</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Section Type</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Signal Type</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Aspect of Entry Sig</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Requires Aspects Exit</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Req Route Locking</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Pts Normal</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Pts Reverse</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Track Ckt (Route)</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Track Ckt (Overlap)</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">TINs Free (Route)</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">TINs Free (Overlap)</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200">Foot Tag</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200 min-w-[200px]">Check RFID Sequence</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200 text-right">Dist (m)</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200 text-center">MA (Sec)</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200 text-center">SR Speed</th>
                  <th className="py-2.5 px-2.5 border-r border-slate-200 text-center">OS Speed</th>
                  <th className="py-2.5 px-2.5 no-print text-right">Actions</th>
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
                  const displaySeq = seqParts.length > 0 ? seqParts.join(', ') : (r.enRouteTags.filter((t) => t !== r.entryFootTag).join(', ') || '-');

                  const perms = r.aspectPermutations && r.aspectPermutations.length > 0
                    ? r.aspectPermutations
                    : [
                        {
                          aspectOfEntrySignal: r.aspectOfEntrySignal || r.entryAspectSummary || 'Green',
                          requiresAspectOfExitSignal: r.requiresAspectOfExitSignal || r.exitAspectsSummary || `${r.exitSignal} Green`,
                          movementAuthoritySections: r.movementAuthoritySections || '4',
                          authorizedSpeedOs: r.authorizedSpeedOs || 'MPS',
                        },
                      ];

                  return perms.map((perm, pIdx) => (
                    <tr
                      key={`${r.slNo}-${pIdx}`}
                      className={`align-top transition-colors ${
                        isHighlighted
                          ? 'bg-blue-50/80'
                          : r.engineerStatus === 'NEEDS_REVIEW'
                            ? 'bg-amber-50/30 hover:bg-amber-50/60'
                            : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono tabular-nums font-semibold text-slate-900">
                        {pIdx === 0 ? r.slNo : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {pIdx === 0 ? r.entrySignal : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {pIdx === 0 ? r.exitSignal : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 text-slate-800 whitespace-nowrap">
                        {pIdx === 0 ? r.leadingToLine : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono text-center">
                        {pIdx === 0 ? (r.tsrmsRouteId || String(r.slNo)) : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 text-slate-700 whitespace-nowrap">
                        {pIdx === 0 ? (r.sectionType || 'Station Section') : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 text-slate-700">
                        {pIdx === 0 ? r.signalType : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-medium text-slate-900">
                        {perm.aspectOfEntrySignal}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 text-slate-600">
                        {perm.requiresAspectOfExitSignal}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono text-center font-semibold text-slate-800">
                        {pIdx === 0 ? (r.requiredRouteLocking || '-') : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono text-emerald-800">
                        {pIdx === 0 ? (r.pointsNormal.join(', ') || '-') : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono text-amber-800">
                        {pIdx === 0 ? (r.pointsReverse.join(', ') || '-') : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono text-slate-700">
                        {pIdx === 0 ? (r.trackCktUp || '-') : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono text-slate-600">
                        {pIdx === 0 ? (r.trackCircuitInOverlap || r.overlapTrackCkt || '-') : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono text-slate-900">
                        {pIdx === 0 ? (r.tinsRequiresFree.join(', ') || '-') : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono text-slate-600">
                        {pIdx === 0 ? (r.tinsInOverlap?.join(', ') || r.overlapTins?.join(', ') || '-') : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono font-semibold text-amber-900 whitespace-nowrap">
                        {pIdx === 0 ? r.entryFootTag : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono text-[11px] text-slate-800 leading-relaxed">
                        {pIdx === 0 ? displaySeq : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 text-right font-mono tabular-nums font-medium text-slate-900">
                        {pIdx === 0 ? r.distanceBetweenSignalsM : ''}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 text-center font-mono font-semibold text-slate-900">
                        {perm.movementAuthoritySections}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 text-center font-mono font-semibold text-slate-800">
                        {pIdx === 0 ? (r.authorizedSpeedSr || perm.authorizedSpeedSr || 'MPS') : (perm.authorizedSpeedSr || '')}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 text-center font-mono font-semibold text-slate-800">
                        {perm.authorizedSpeedOs}
                      </td>
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
                                const recomputed = recomputeRouteFromTags(r, project.tags, project.signals);
                                onUpdateRoute(r.slNo, recomputed);
                              }}
                              title="Recompute linking sequence from RFID tags"
                              className="p-1 text-slate-500 hover:text-blue-700 rounded hover:bg-blue-50 cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSlNo(isEditing ? null : r.slNo)}
                              title={isEditing ? 'Done editing' : 'Edit row'}
                              className={`p-1 rounded cursor-pointer ${
                                isEditing ? 'text-blue-700 bg-blue-50' : 'text-slate-500 hover:text-slate-900'
                              }`}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateRoute(r.slNo, {
                                  engineerStatus: r.engineerStatus === 'VERIFIED' ? 'NEEDS_REVIEW' : 'VERIFIED',
                                })
                              }
                              title="Toggle route verification status"
                              className={`p-1 rounded cursor-pointer ${
                                r.engineerStatus === 'VERIFIED'
                                  ? 'text-emerald-700 hover:bg-emerald-50'
                                  : 'text-amber-700 hover:bg-amber-50'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
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
        )}

        {/* ================================================================= */}
        {/* TABLE 2: Track Profile Table                                      */}
        {/* ================================================================= */}
        {section === 'track_profile' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-semibold">
                  <th className="py-2.5 px-3 border-r border-slate-200">S.No</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Entry Sig</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Exit Sig</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Line</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">Turnout Speed (kmph)</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">Start Dist (m)</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">Restriction Len (m)</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Permanent Speed Restriction</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Engineering Gradient</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Avg Gradient</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">LC Gate ID</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">LC Dist (m)</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Track Condition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(project.trackProfiles || []).map((tp, idx) => (
                  <tr key={`${tp.entrySignal}-${tp.exitSignal}-${idx}`} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900">
                      {tp.slNo || idx + 1}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900">
                      {tp.entrySignal}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900">
                      {tp.exitSignal}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-slate-700">
                      {tp.line}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums font-semibold">
                      {tp.turnoutSpeedKmph ?? '--'}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums">
                      {tp.turnoutStartDistM ?? '--'}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums">
                      {tp.turnoutLengthM ?? '--'}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono text-[11px] text-slate-800">
                      {tp.psrSegments && tp.psrSegments.length > 0
                        ? tp.psrSegments.map((s) => `(${s.staticSpeedType}, ${s.speedKmph}, ${s.lengthM}m)`).join(' · ')
                        : '--'}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono text-[11px] text-slate-800">
                      {tp.engineeringGradients?.length > 0
                        ? tp.engineeringGradients.map((g) => `(${g.gradientValue}, ${g.lengthM}m)`).join(', ')
                        : '--'}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono text-slate-800">
                      {tp.averageGradients?.length > 0
                        ? tp.averageGradients.map((g) => `${g.avgGradientValue} ${g.lengthM}m`).join('; ')
                        : '--'}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono text-slate-800">
                      {tp.lcId || '--'}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums">
                      {tp.lcDistanceM ?? '--'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-800">
                      {tp.trackConditionType ? `${tp.trackConditionType} ${tp.trackConditionStartDistM ?? 0}m` : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ================================================================= */}
        {/* TABLE 3: TSR Route Table                                          */}
        {/* ================================================================= */}
        {section === 'tsr' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-semibold">
                  <th className="py-2.5 px-3 border-r border-slate-200">S.No</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">OHE Line Name</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Entry Sig</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Exit Sig</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">TSR Route ID</th>
                  <th className="py-2.5 px-3 border-r border-slate-200">Start RFID Tag</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">Entry Sig Dist (m)</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">Last Pole Dist (m)</th>
                  <th className="py-2.5 px-3">OHE Pole / Km Data (in meter)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(project.tsrRoutes || []).map((t, idx) => (
                  <tr key={`${t.tsrRouteId}-${idx}`} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900">
                      {t.slNo || idx + 1}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-semibold text-slate-900">
                      {t.oheLineName || t.oheLine}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900">
                      {t.entrySignal}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900">
                      {t.exitSignal}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-blue-800">
                      {t.tsrRouteId}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-amber-900">
                      {t.startRfidTag || t.oheLineStartRfidTag}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums">
                      {t.entrySignalDistFromStartTagM ?? t.entrySignalDistanceM ?? 0}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums">
                      {t.lastPoleDistFromExitSignalM ?? t.lastPoleDistanceM ?? 0}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-800 leading-relaxed">
                      {t.ohePoleKmData || (t.ohePoles ? t.ohePoles.map((p) => `(${p.distanceM}-${p.poleId})`).join(', ') : '--')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ================================================================= */}
        {/* TABLE 4: TSL Working on Double Line                               */}
        {/* ================================================================= */}
        {section === 'tsl' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
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
                  <th className="py-2.5 px-3 border-r border-slate-200 min-w-[200px]">Check RFID Sequence</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right">Dist (m)</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-center">MA</th>
                  <th className="py-2.5 px-3">Auth Speed (1st / Subseq)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(project.tslRoutes || []).map((tsl, idx) => (
                  <tr key={`${tsl.tslEntrySignal}-${idx}`} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900">
                      {tsl.slNo || idx + 1}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900">
                      {tsl.tslEntrySignal}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900">
                      {tsl.tslExitSignal}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-slate-700">
                      {tsl.lineOrSignalType}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-medium text-slate-900">
                      {tsl.aspectOfEntrySignal}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-slate-600">
                      {tsl.requiresAspectOfExitSignal}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-blue-800">
                      {tsl.requiredRouteCommand}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono">
                      {tsl.pointsNormal.join(', ')} / {tsl.pointsReverse.join(', ')}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-slate-700">
                      {tsl.trackCktUpOrAxleCounterFree}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono text-slate-900">
                      {tsl.tinsRequiresFree.join(', ')}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-amber-900">
                      {tsl.entryFootTag}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono text-[11px] text-slate-800 leading-relaxed">
                      {tsl.linkingSequence.map((s) => `(${s.distanceM}, ${s.tagId})`).join(', ')}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums font-medium text-slate-900">
                      {tsl.distanceBetweenSignalsM}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-center font-mono font-semibold">
                      {tsl.movementAuthoritySections}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">
                      {tsl.authorizedSpeedOsFirstTrain} / {tsl.authorizedSpeedOsSubsequentTrains}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ================================================================= */}
        {/* BLOCK SECTION & SHUNTING LIMITS TABLE                             */}
        {/* ================================================================= */}
        {section === 'block_sos' && (
          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">Block Section Details (Annexure-I Amdt-6)</h3>
              <div className="overflow-x-auto border border-slate-200 rounded-md">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-semibold">
                      <th className="py-2.5 px-3 border-r border-slate-200">Last Stop Signal</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 text-right">Distance to Next Stop (m)</th>
                      <th className="py-2.5 px-3 border-r border-slate-200">Block Section TIN</th>
                      <th className="py-2.5 px-3 border-r border-slate-200">Direction</th>
                      <th className="py-2.5 px-3 border-r border-slate-200">Adjacent Line TINs</th>
                      <th className="py-2.5 px-3 border-r border-slate-200">Next Station ID</th>
                      <th className="py-2.5 px-3 border-r border-slate-200">Border RFID with Location</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 text-center">Movement Auth Speed</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 text-right">Abs Reset Start (m)</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 text-right">Abs Correction (m)</th>
                      <th className="py-2.5 px-3">Loco Direction After Adj</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(project.blockSections || []).map((b, i) => (
                      <tr key={`${b.lastStopSignal}-${i}`} className="hover:bg-slate-50 align-top">
                        <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900">
                          {b.lastStopSignal}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums">
                          {b.lastSignalMaMeters ?? '--'}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-blue-800">
                          {b.blockSectionTin}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 text-slate-700">
                          {b.direction || '--'}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 font-mono text-slate-700">
                          {b.adjacentLineTins}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-slate-900">
                          {b.nextStationId}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 font-mono text-slate-700">
                          {b.nextStationBorderRfid}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 text-center font-semibold text-slate-800">
                          {b.authorisedSpeed || 'MPS'}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums text-slate-800">
                          {b.startDistAbsResetM}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums text-slate-800">
                          {b.absLocationCorrectionM}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">
                          {b.locoDirectionAfterAdj}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                <span className="text-xs text-slate-500 font-medium">Signals Override (OV) not required at zero speed:</span>
                <p className="text-xs font-mono font-bold text-slate-900 mt-1">
                  {(project.signalsOverrideOv || ['S6', 'S25', 'S24']).join(', ')}
                </p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                <span className="text-xs text-slate-500 font-medium">Authorized speed on detection of train in Onsight mode:</span>
                <p className="text-xs font-mono font-bold text-slate-900 mt-1">
                  {project.authorizedSpeedOnSightKmph || 100} kmph
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">Shunting Limit Table (Annexure-I Amdt-6)</h3>
              <div className="overflow-x-auto border border-slate-200 rounded-md">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-semibold">
                      <th className="py-2.5 px-4 border-r border-slate-200">Adjacent Station Name</th>
                      <th className="py-2.5 px-4 border-r border-slate-200">Direction</th>
                      <th className="py-2.5 px-4 border-r border-slate-200">RFID Tag No</th>
                      <th className="py-2.5 px-4 border-r border-slate-200">TIN</th>
                      <th className="py-2.5 px-4 text-right">Absolute Location in meter</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(project.shuntingLimits || []).map((s, idx) => (
                      <tr key={`${s.rfidTag}-${idx}`} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 border-r border-slate-200 font-bold text-slate-900">
                          {s.adjacentStation}
                        </td>
                        <td className="py-2.5 px-4 border-r border-slate-200 text-slate-700">
                          {s.direction}
                        </td>
                        <td className="py-2.5 px-4 border-r border-slate-200 font-mono font-bold text-amber-900">
                          {s.rfidTag}
                        </td>
                        <td className="py-2.5 px-4 border-r border-slate-200 font-mono text-blue-800">
                          {s.tin}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                          {s.absoluteLocationM}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* RFID TAG & TIN ALLOTMENT TABLE                                    */}
        {/* ================================================================= */}
        {section === 'tag_inventory' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
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
                {project.tags.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-bold text-amber-900">
                      {t.tagId}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono tabular-nums font-semibold">
                      {t.chainageM ?? '--'}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-slate-800">
                      {t.line}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-semibold text-blue-800">
                      {t.tin || '--'}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-slate-700">
                      {t.tagType}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-mono text-slate-900">
                      {t.linkedSignal || '--'}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        t.confidence === 'HIGH' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {t.confidence}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 text-center font-semibold">
                      {t.verified ? <span className="text-emerald-700">YES</span> : <span className="text-slate-400">NO</span>}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 text-[11px]">
                      {t.notes || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Print / Engineering Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          <div>
            Prepared by: <span className="font-medium text-slate-900">{project.metadata.preparedBy || 'JE/SSE/Proj/HQ/SCR'}</span>
            <span className="mx-2 text-slate-300">·</span>
            Checked by: <span className="font-medium text-slate-900">{project.metadata.checkedBy || 'ASTE/Proj/HQ/SCR'}</span>
          </div>
          <div>
            {project.metadata.engineerSignedOff ? (
              <span className="font-semibold text-emerald-800">
                Engineer Sign-Off: {project.metadata.signOffEngineerName} ({project.metadata.signOffTimestamp})
              </span>
            ) : (
              <span className="font-medium text-emerald-900 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                RDSO/SPN/196/2020 Version 4.0 Amdt-6 Automated Engineering Output
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
