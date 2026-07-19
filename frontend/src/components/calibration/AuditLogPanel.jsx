/**
 * Slide-out audit log panel for the current floor plan.
 */
import React, { useEffect, useState } from 'react';
import X from "@mui/icons-material/Close";
import Activity from "@mui/icons-material/Timeline";
import Loader2 from "@mui/icons-material/Autorenew";
import api from '../../lib/api';

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
}

const ACTION_LABELS = {
  'floor_plan.create': 'Created plan',
  'floor_plan.delete': 'Deleted plan',
  'floor_plan.clone': 'Cloned plan',
  'floor_plan.publish': 'Published version',
  'floor_plan.rollback': 'Rolled back',
  'floor_plan.set_default': 'Set as default',
};

export default function AuditLogPanel({ planId, open, onClose }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get(`/floor-plans/${planId}/audit`)
      .then(res => setEntries(res.data || []))
      .finally(() => setLoading(false));
  }, [open, planId]);

  if (!open) return null;
  return (
    <div className="fixed top-0 right-0 h-full w-96 bg-white border-l shadow-2xl z-40 flex flex-col" data-testid="audit-log-panel">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Activity sx={{ fontSize: 18 }} className="text-[#ec9324]"/>
          <h2 className="font-bold text-gray-900">Audit Log</h2>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X sx={{ fontSize: 18 }}/></button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 flex items-center justify-center text-gray-500"><Loader2 className="animate-spin mr-2"/> Loading…</div>
        ) : entries.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">No activity recorded yet.</div>
        ) : (
          <ul className="divide-y">
            {entries.map(e => (
              <li key={e.id} className="p-3" data-testid={`audit-row-${e.action.replace('.','-')}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900">{ACTION_LABELS[e.action] || e.action}</div>
                    <div className="text-xs text-gray-600">{e.actor_name || '—'} · {fmtDate(e.at)}</div>
                    {e.metadata?.diff && (
                      <div className="flex gap-1 mt-1.5 text-[10px] flex-wrap">
                        {Object.entries(e.metadata.diff).filter(([, n]) => n > 0).map(([k, n]) => (
                          <span key={k} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">+{n} {k}</span>
                        ))}
                      </div>
                    )}
                    {e.metadata?.comments && <div className="text-xs italic text-gray-500 mt-1">"{e.metadata.comments}"</div>}
                    {e.metadata?.version_number && <div className="text-[10px] text-gray-400 mt-0.5">v{e.metadata.version_number}</div>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
