/**
 * Diff modal shown before publishing a draft.
 * Receives a diff object: { added[], removed[], moved[], rotated[], resized[], counts }
 */
import React, { useState } from 'react';
import X from "@mui/icons-material/Close";
import AlertTriangle from "@mui/icons-material/WarningAmber";
import Plus from "@mui/icons-material/Add";
import Minus from "@mui/icons-material/Remove";
import Move from "@mui/icons-material/OpenWith";
import RotateCw from "@mui/icons-material/RotateRight";
import Maximize2 from "@mui/icons-material/OpenInFull";
import DoorOpen from "@mui/icons-material/MeetingRoomOutlined";
const ROWS = [
  { key: 'added',   Icon: Plus,      color: 'text-emerald-700 bg-emerald-50',  label: 'Seats added' },
  { key: 'removed', Icon: Minus,     color: 'text-red-700 bg-red-50',          label: 'Seats removed' },
  { key: 'moved',   Icon: Move,      color: 'text-blue-700 bg-blue-50',        label: 'Seats moved' },
  { key: 'rotated', Icon: RotateCw,  color: 'text-purple-700 bg-purple-50',    label: 'Seats rotated' },
  { key: 'resized', Icon: Maximize2, color: 'text-amber-700 bg-amber-50',      label: 'Seats resized' },
];

export default function PublishDialog({ diff, roomDiff, onCancel, onConfirm, busy }) {
  const [comments, setComments] = useState('');
  const seatTotal = (diff?.counts && Object.values(diff.counts).reduce((a, b) => a + b, 0)) || 0;
  const roomAdded = roomDiff?.added?.length || 0;
  const roomRemoved = roomDiff?.removed?.length || 0;
  const roomTotal = roomDiff?.total || 0;
  const total = seatTotal + roomAdded + roomRemoved;
  const noChanges = total === 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" data-testid="publish-dialog">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-bold text-gray-900 flex items-center gap-2">
            <AlertTriangle sx={{ fontSize: 18 }} className="text-amber-500"/>
            Publish to Live?
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700"><X sx={{ fontSize: 18 }}/></button>
        </div>

        <div className="p-5">
          <p className="text-sm text-gray-600 mb-4">
            Publishing will replace the current live floor plan and create a new version. Both workstation seats and meeting rooms in this draft will go Live together — end users will see these changes immediately.
          </p>

          {noChanges ? (
            <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded p-3 mb-4">
              No changes detected since the last published version. You can still publish to create a checkpoint.
            </div>
          ) : (
            <div className="space-y-2 mb-4">
              {ROWS.map(({ key, Icon, color, label }) => {
                const ids = diff[key] || [];
                if (ids.length === 0) return null;
                return (
                  <div key={key} className={`flex items-start gap-3 p-2.5 rounded-lg ${color}`} data-testid={`diff-row-${key}`}>
                    <Icon size={16} className="mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">{label}: {ids.length}</div>
                      <div className="text-xs mt-0.5 truncate">{ids.slice(0, 30).join(', ')}{ids.length > 30 ? ` … +${ids.length - 30}` : ''}</div>
                    </div>
                  </div>
                );
              })}

              {/* Meeting rooms summary */}
              {(roomAdded > 0 || roomRemoved > 0) && (
                <div className="flex items-start gap-3 p-2.5 rounded-lg text-orange-800 bg-orange-50" data-testid="diff-row-rooms">
                  <DoorOpen sx={{ fontSize: 16 }} className="mt-0.5 flex-shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">
                      Meeting rooms: {roomAdded > 0 ? `${roomAdded} added` : ''}{roomAdded > 0 && roomRemoved > 0 ? ', ' : ''}{roomRemoved > 0 ? `${roomRemoved} removed` : ''}
                    </div>
                    {roomAdded > 0 && (
                      <div className="text-xs mt-0.5 truncate"><span className="font-semibold">+</span> {roomDiff.added.slice(0, 10).join(', ')}{roomDiff.added.length > 10 ? ` … +${roomDiff.added.length - 10}` : ''}</div>
                    )}
                    {roomRemoved > 0 && (
                      <div className="text-xs mt-0.5 truncate"><span className="font-semibold">−</span> {roomDiff.removed.slice(0, 10).join(', ')}{roomDiff.removed.length > 10 ? ` … +${roomDiff.removed.length - 10}` : ''}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Totals footer so user sees the full picture even when no diff rows */}
          <div className="text-[11px] text-gray-500 mb-4" data-testid="publish-totals">
            Going Live with <span className="font-semibold text-gray-700">{roomTotal}</span> meeting room{roomTotal === 1 ? '' : 's'} on this floor plan.
          </div>

          <label className="block text-xs font-semibold text-gray-700 mb-1">Version notes (optional)</label>
          <textarea
            data-testid="publish-comments"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={2}
            placeholder="e.g. Added new desks in Bay C, rotated Bay D"
            className="w-full px-2 py-1.5 border rounded text-sm mb-4"
          />

          <div className="flex items-center justify-end gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded border">Cancel</button>
            <button
              data-testid="confirm-publish-btn"
              onClick={() => onConfirm(comments)}
              disabled={busy}
              className="px-4 py-1.5 text-sm rounded bg-[#ec9324] hover:bg-[#d6831f] text-white font-semibold disabled:opacity-50"
            >
              {busy ? 'Publishing…' : 'Publish Live'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
