/**
 * Sliding panel showing the version history for the current floor plan.
 * Supports rollback (with confirmation) and compare-two-versions.
 */
import React, { useEffect, useState } from 'react';
import X from "@mui/icons-material/Close";
import History from "@mui/icons-material/HistoryOutlined";
import RotateCcw from "@mui/icons-material/RestartAlt";
import GitCompare from "@mui/icons-material/CompareArrows";
import Loader2 from "@mui/icons-material/Autorenew";
import api from '../../lib/api';
import notify from '../../lib/notify';
import { confirm as confirmDialog } from '../../lib/dialog';

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: "Asia/Kolkata" }); }
  catch { return iso; }
}

export default function VersionHistoryPanel({ planId, liveVersionId, open, onClose, onRollback }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [compareIds, setCompareIds] = useState([]); // up to 2
  const [compareResult, setCompareResult] = useState(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get(`/floor-plans/${planId}/versions`)
      .then(res => setVersions(res.data || []))
      .finally(() => setLoading(false));
  }, [open, planId, liveVersionId]);

  const toggleCompare = (id) => {
    setCompareResult(null);
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const runCompare = async () => {
    if (compareIds.length !== 2) return;
    setComparing(true);
    try {
      const [a, b] = compareIds;
      const res = await api.get(`/floor-plans/${planId}/versions/compare`, { params: { a, b } });
      setCompareResult(res.data);
    } catch (e) {
      notify.error(e, { what: 'Compare versions' });
    } finally { setComparing(false); }
  };

  const doRollback = async (v) => {
    const ok = await confirmDialog({ title: 'Restore version', message: `Restore version ${v.version_number}? A new published version will be created with these seats.`, confirmLabel: 'Restore' });
    if (!ok) return;
    try {
      await api.post(`/floor-plans/${planId}/versions/${v.id}/rollback`, { comments: `Rollback to v${v.version_number}` });
      onRollback?.();
    } catch (e) {
      notify.error(e, { what: 'Rollback version' });
    }
  };

  if (!open) return null;

  return (
    <div className="fixed top-0 right-0 h-full w-96 bg-white border-l shadow-2xl z-40 flex flex-col" data-testid="version-history-panel">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <History sx={{ fontSize: 18 }} className="text-[#ec9324]"/>
          <h2 className="font-bold text-gray-900">Version History</h2>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X sx={{ fontSize: 18 }}/></button>
      </div>

      {compareIds.length > 0 && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-semibold text-blue-900">Compare:</span> {compareIds.length}/2 selected
            </div>
            <div className="flex gap-1">
              <button onClick={() => { setCompareIds([]); setCompareResult(null); }} className="text-blue-700 hover:underline">Clear</button>
              <button onClick={runCompare} disabled={compareIds.length !== 2 || comparing} className="px-2 py-0.5 bg-blue-600 text-white rounded disabled:opacity-40">
                {comparing ? '…' : 'Diff'}
              </button>
            </div>
          </div>
          {compareResult && (
            <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[10px]">
              <div className="p-1 bg-emerald-100 rounded"><div className="font-bold text-emerald-800">{compareResult.diff.counts.added}</div>added</div>
              <div className="p-1 bg-red-100 rounded"><div className="font-bold text-red-800">{compareResult.diff.counts.removed}</div>removed</div>
              <div className="p-1 bg-blue-100 rounded"><div className="font-bold text-blue-800">{compareResult.diff.counts.moved}</div>moved</div>
              <div className="p-1 bg-purple-100 rounded"><div className="font-bold text-purple-800">{compareResult.diff.counts.rotated}</div>rotated</div>
              <div className="p-1 bg-amber-100 rounded"><div className="font-bold text-amber-800">{compareResult.diff.counts.resized}</div>resized</div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 flex items-center justify-center text-gray-500"><Loader2 className="animate-spin mr-2"/> Loading…</div>
        ) : versions.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">No versions yet. Publish to create one.</div>
        ) : (
          <ul className="divide-y">
            {versions.map(v => {
              const isLive = v.id === liveVersionId;
              const sel = compareIds.includes(v.id);
              return (
                <li key={v.id} data-testid={`version-row-v${v.version_number}`} className={`p-3 ${sel ? 'bg-blue-50' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900">v{v.version_number}</span>
                        {isLive && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">Live</span>}
                        {v.rolled_back_from && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">Rollback</span>}
                      </div>
                      <div className="text-xs text-gray-600 mt-0.5">{v.seat_count} seats · by {v.created_by?.name || 'system'}</div>
                      <div className="text-xs text-gray-500">{fmtDate(v.created_at)}</div>
                      {v.comments && <div className="text-xs text-gray-700 mt-1 italic line-clamp-2">"{v.comments}"</div>}
                      {v.diff_summary?.counts && (
                        <div className="flex gap-1 mt-1.5 text-[10px]">
                          {Object.entries(v.diff_summary.counts).filter(([, n]) => n > 0).map(([k, n]) => (
                            <span key={k} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">+{n} {k}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => toggleCompare(v.id)}
                        data-testid={`compare-toggle-v${v.version_number}`}
                        title="Add to compare"
                        className={`p-1.5 rounded ${sel ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                      >
                        <GitCompare sx={{ fontSize: 13 }}/>
                      </button>
                      {!isLive && (
                        <button
                          onClick={() => doRollback(v)}
                          data-testid={`rollback-v${v.version_number}`}
                          title="Restore this version"
                          className="p-1.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800"
                        >
                          <RotateCcw sx={{ fontSize: 13 }}/>
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
