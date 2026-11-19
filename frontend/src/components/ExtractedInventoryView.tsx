import React, { useMemo, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import type { RfidTag, SignalNode, StationProject } from "../types/signalling";

interface ExtractedInventoryViewProps {
  project: StationProject;
  onUpdateTag: (tagId: string, patch: Partial<RfidTag>) => void;
  onAddTag: (tag: RfidTag) => void;
  onUpdateSignal: (signalId: string, patch: Partial<SignalNode>) => void;
}

type SubTable = "tags" | "signals" | "points" | "tracks";

export const ExtractedInventoryView: React.FC<ExtractedInventoryViewProps> = ({
  project,
  onUpdateTag,
  onAddTag,
  onUpdateSignal,
}) => {
  const [subTable, setSubTable] = useState<SubTable>("tags");
  const [search, setSearch] = useState("");
  const [showAddTag, setShowAddTag] = useState(false);
  const [newTagId, setNewTagId] = useState("");
  const [newTagChainage, setNewTagChainage] = useState("");
  const [newTagLine, setNewTagLine] = useState(project.tracks[0]?.name || "Down Main");
  const [newTagTin, setNewTagTin] = useState("");

  const filteredTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return project.tags;
    return project.tags.filter(
      (t) =>
        t.tagId.toLowerCase().includes(q) ||
        t.tin.toLowerCase().includes(q) ||
        t.line.toLowerCase().includes(q) ||
        (t.linkedSignal || "").toLowerCase().includes(q),
    );
  }, [project.tags, search]);

  const filteredSignals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return project.signals;
    return project.signals.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.line.toLowerCase().includes(q) ||
        s.footTagId.toLowerCase().includes(q) ||
        s.signalType.toLowerCase().includes(q),
    );
  }, [project.signals, search]);

  const handleCreateTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagId.trim()) return;
    onAddTag({
      id: `tag-${Date.now()}`,
      tagId: newTagId.trim(),
      chainageM:
        newTagChainage.trim() === "" || !Number.isFinite(Number(newTagChainage))
          ? null
          : Number(newTagChainage),
      line: newTagLine,
      tin: newTagTin.trim(),
      tagType: "NORMAL",
      confidence: "HIGH",
      verified: true,
      notes: "Added manually by signalling engineer",
    });
    setNewTagId("");
    setNewTagChainage("");
    setNewTagTin("");
    setShowAddTag(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
          {(
            [
              { id: "tags", label: `RFID Tags (${project.tags.length})` },
              { id: "signals", label: `Signals (${project.signals.length})` },
              { id: "points", label: `Points (${project.points.length})` },
              { id: "tracks", label: `Tracks & TINs (${project.tracks.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTable(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                subTable === tab.id
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter Tag ID, TIN, Signal..."
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 w-56"
            />
          </div>
          {subTable === "tags" && (
            <button
              type="button"
              onClick={() => setShowAddTag((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Tag</span>
            </button>
          )}
        </div>
      </div>

      {/* Add Tag inline row */}
      {showAddTag && subTable === "tags" && (
        <form
          onSubmit={handleCreateTag}
          className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-end gap-3"
        >
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">RFID Tag ID</label>
            <input
              type="text"
              required
              value={newTagId}
              onChange={(e) => setNewTagId(e.target.value)}
              placeholder="e.g. R-720"
              className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white w-28"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Chainage (m)
            </label>
            <input
              type="number"
              required
              value={newTagChainage}
              onChange={(e) => setNewTagChainage(e.target.value)}
              placeholder="2450"
              className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white w-28"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Track Line</label>
            <select
              value={newTagLine}
              onChange={(e) => setNewTagLine(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
            >
              {project.tracks.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">TIN</label>
            <input
              type="text"
              value={newTagTin}
              onChange={(e) => setNewTagTin(e.target.value)}
              placeholder="e.g. N-46"
              className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white w-24"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded cursor-pointer"
          >
            Save Tag
          </button>
        </form>
      )}

      {/* RFID Tags Table */}
      {subTable === "tags" && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2.5 px-4">Tag ID</th>
                <th className="py-2.5 px-4">Track / Line</th>
                <th className="py-2.5 px-4 text-right">Chainage (m)</th>
                <th className="py-2.5 px-4">TIN</th>
                <th className="py-2.5 px-4">Function</th>
                <th className="py-2.5 px-4">Linked Signal</th>
                <th className="py-2.5 px-4">Confidence</th>
                <th className="py-2.5 px-4 text-right">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredTags.map((tag) => (
                <tr key={tag.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                    {tag.tagId}
                  </td>
                  <td className="py-2.5 px-4 text-slate-700">{tag.line}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                    <input
                      type="number"
                      value={tag.chainageM ?? ""}
                      onChange={(e) =>
                        onUpdateTag(tag.id, {
                          chainageM: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      aria-label={`Chainage for ${tag.tagId}`}
                      className="w-24 text-right font-mono tabular-nums px-2 py-1 border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white rounded bg-transparent"
                    />
                  </td>
                  <td className="py-2.5 px-4">
                    <input
                      type="text"
                      value={tag.tin}
                      onChange={(e) => onUpdateTag(tag.id, { tin: e.target.value })}
                      aria-label={`TIN for ${tag.tagId}`}
                      className="w-20 font-mono px-2 py-1 border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white rounded bg-transparent text-slate-900"
                    />
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">{tag.tagType}</td>
                  <td className="py-2.5 px-4 font-mono text-blue-800">
                    {tag.linkedSignal || "--"}
                  </td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`font-medium ${
                        tag.confidence === "HIGH"
                          ? "text-emerald-700"
                          : tag.confidence === "MEDIUM"
                            ? "text-amber-700"
                            : "text-red-700"
                      }`}
                    >
                      {tag.confidence === "HIGH"
                        ? "High"
                        : tag.confidence === "MEDIUM"
                          ? "Medium"
                          : "Low (Check)"}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => onUpdateTag(tag.id, { verified: !tag.verified })}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                        tag.verified
                          ? "text-emerald-800 bg-emerald-50 border border-emerald-200"
                          : "text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100"
                      }`}
                    >
                      <Check className="w-3 h-3" aria-hidden="true" />
                      <span>{tag.verified ? "Verified" : "Confirm"}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Signals Table */}
      {subTable === "signals" && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2.5 px-4">Signal</th>
                <th className="py-2.5 px-4">Track / Line</th>
                <th className="py-2.5 px-4">Direction</th>
                <th className="py-2.5 px-4">Signal Type</th>
                <th className="py-2.5 px-4 text-right">Chainage (m)</th>
                <th className="py-2.5 px-4">Foot Tag</th>
                <th className="py-2.5 px-4">Aspects</th>
                <th className="py-2.5 px-4 text-right">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredSignals.map((sig) => (
                <tr key={sig.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">{sig.name}</td>
                  <td className="py-2.5 px-4 text-slate-700">{sig.line}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-700">{sig.direction}</td>
                  <td className="py-2.5 px-4 text-slate-700">{sig.signalType}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                    <input
                      type="number"
                      value={sig.chainageM ?? ""}
                      onChange={(e) =>
                        onUpdateSignal(sig.id, {
                          chainageM: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      aria-label={`Chainage for ${sig.name}`}
                      className="w-24 text-right font-mono tabular-nums px-2 py-1 border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white rounded bg-transparent"
                    />
                  </td>
                  <td className="py-2.5 px-4">
                    <input
                      type="text"
                      value={sig.footTagId}
                      onChange={(e) => onUpdateSignal(sig.id, { footTagId: e.target.value })}
                      aria-label={`Foot tag for ${sig.name}`}
                      className="w-20 font-mono px-2 py-1 border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white rounded bg-transparent text-amber-800 font-medium"
                    />
                  </td>
                  <td className="py-2.5 px-4 text-slate-600">{sig.aspects.join(", ")}</td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => onUpdateSignal(sig.id, { verified: !sig.verified })}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                        sig.verified
                          ? "text-emerald-800 bg-emerald-50 border border-emerald-200"
                          : "text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100"
                      }`}
                    >
                      <Check className="w-3 h-3" aria-hidden="true" />
                      <span>{sig.verified ? "Verified" : "Confirm"}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Points Table */}
      {subTable === "points" && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2.5 px-4">Point No.</th>
                <th className="py-2.5 px-4 text-right">Chainage (m)</th>
                <th className="py-2.5 px-4">Normal Line</th>
                <th className="py-2.5 px-4">Reverse Line</th>
                <th className="py-2.5 px-4 text-right">Turnout Speed (kmph)</th>
                <th className="py-2.5 px-4">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {project.points.map((pt) => (
                <tr key={pt.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">{pt.name}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-800">
                    {pt.chainageM ?? "--"}
                  </td>
                  <td className="py-2.5 px-4 text-slate-700">{pt.normalLine}</td>
                  <td className="py-2.5 px-4 text-slate-700">{pt.reverseLine}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-800">
                    {pt.turnoutSpeedKmph ?? "--"}
                  </td>
                  <td className="py-2.5 px-4 text-emerald-700 font-medium">{pt.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tracks & TINs Table */}
      {subTable === "tracks" && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2.5 px-4">Track Name</th>
                <th className="py-2.5 px-4">Classification</th>
                <th className="py-2.5 px-4">Direction</th>
                <th className="py-2.5 px-4">Track Circuits</th>
                <th className="py-2.5 px-4">Assigned TIN Sequence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {project.tracks.map((trk) => (
                <tr key={trk.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-semibold text-slate-900">{trk.name}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">{trk.lineType}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-700">{trk.direction}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-800">
                    {trk.trackCircuit || "--"}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-900">
                    {trk.tinList.join(" → ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
