/**
 * LinkSegmentationTab — Client Detail View → "Link Segmentation" tab.
 * ===================================================================
 * Two equal columns:
 *   • LEFT  — the master Level-1 segmentation categories of
 *             "Infollion Research".
 *   • RIGHT — for each Infollion Level-1 category, a multi-select
 *             dropdown (same UI/UX as Manage → Teams → Add Team →
 *             Team Member) listing the SELECTED client's own Level-1
 *             segmentations. Selected values render as removable chips.
 *
 * If the client has no Level-1 segmentation, the right side shows a
 * "No Segmentation Available" empty state with a "+ Add Segmentation"
 * button that behaves exactly like the Client Detail Add Segmentation
 * button (navigates to the Segmentations editor pre-filled with the
 * client name).
 *
 * Nothing is persisted until Save is clicked. Cancel reverts to the
 * last-saved mapping. The parent (ClientDetailPage) is notified of the
 * dirty state via onDirtyChange so it can guard tab switches / page
 * navigation.
 */
import React, {
  useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef,
} from "react";
import api, { formatApiError } from "../lib/api";
import notify from "../lib/notify";
import MultiSelectFilter from "./ui/MultiSelectFilter";
import { Button } from "./ui/button";
import PieChart from "@mui/icons-material/PieChartOutlineOutlined";
import LinkIcon from "@mui/icons-material/LinkOutlined";
import Plus from "@mui/icons-material/AddOutlined";
import Save from "@mui/icons-material/SaveOutlined";
import Close from "@mui/icons-material/CloseOutlined";

// Deep-equal for a mapping object { key: [sorted names] }.
function mappingsEqual(a, b) {
  const ka = Object.keys(a || {}).filter((k) => (a[k] || []).length);
  const kb = Object.keys(b || {}).filter((k) => (b[k] || []).length);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = [...(a[k] || [])].sort();
    const vb = [...(b[k] || [])].sort();
    if (va.length !== vb.length) return false;
    for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false;
  }
  return true;
}

const LinkSegmentationTab = forwardRef(function LinkSegmentationTab(
  { clientId, clientName, onDirtyChange, onAddSegmentation },
  ref
) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [infollionL1, setInfollionL1] = useState([]);
  const [clientL1, setClientL1] = useState([]);
  const [hasClientSeg, setHasClientSeg] = useState(false);
  const [infollionExists, setInfollionExists] = useState(true);

  // Saved baseline (what's persisted) vs draft (in-memory edits).
  const [saved, setSaved] = useState({});
  const [draft, setDraft] = useState({});

  const dirty = useMemo(() => !mappingsEqual(saved, draft), [saved, draft]);

  // Keep the parent in sync so it can guard navigation.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/clients/${clientId}/segmentation-link`);
      setInfollionL1(data?.infollion?.level1 || []);
      setInfollionExists(!!data?.infollion?.exists);
      setClientL1(data?.client_level1 || []);
      setHasClientSeg(!!data?.client_has_segmentation);
      const m = data?.mappings || {};
      setSaved(m);
      setDraft(m);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to load segmentation link"));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // Reload when the window regains focus — e.g. after the user creates a
  // new segmentation on the Segmentations page and comes back — so the
  // dropdown options refresh without a manual page reload. We only auto
  // reload when there are NO unsaved edits, to avoid clobbering the draft.
  useEffect(() => {
    const onFocus = () => { if (!dirty) load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [dirty, load]);

  // Expose imperative helpers to the parent (discard on guarded leave).
  useImperativeHandle(ref, () => ({
    discard: () => setDraft(saved),
    reload: () => load(),
    isDirty: () => dirty,
  }), [saved, dirty, load]);

  const updateRow = (key, values) => {
    setDraft((prev) => {
      const next = { ...prev };
      if (!values || values.length === 0) delete next[key];
      else next[key] = values;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/clients/${clientId}/segmentation-link`, {
        mappings: draft,
      });
      const m = data?.mappings || {};
      setSaved(m);
      setDraft(m);
      notify.success("Segmentation mapping saved");
    } catch (e) {
      notify.error(formatApiError(e, "Failed to save mapping"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => setDraft(saved);

  const clientOptions = useMemo(
    () => clientL1.map((n) => ({ value: n, label: n, searchText: n })),
    [clientL1]
  );

  // ---------------- render ----------------
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm" data-testid="link-segmentation-tab">
      {/* Header with Save / Cancel top-right */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-100 text-[#ec9324] flex items-center justify-center">
            <LinkIcon />
          </div>
          <div>
            <div className="text-base font-semibold text-gray-900">Link Segmentation</div>
            <div className="text-[12px] text-gray-500">
              Map each Infollion Research category to this client&apos;s segmentations
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {dirty && (
            <span
              className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1"
              data-testid="link-seg-unsaved-badge"
            >
              Unsaved changes
            </span>
          )}
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={!dirty || saving}
            className="h-9"
            data-testid="link-seg-cancel"
          >
            <Close sx={{ fontSize: 18, marginRight: "4px" }} />
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="bg-[#ec9324] hover:bg-[#d3811b] text-white h-9"
            data-testid="link-seg-save"
          >
            <Save sx={{ fontSize: 18, marginRight: "4px" }} />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-sm text-gray-500">Loading…</div>
      ) : !infollionExists ? (
        <div className="text-center py-16 text-sm text-gray-500">
          The master “Infollion Research” segmentation was not found.
        </div>
      ) : (
        <div className="p-5">
          {/* Column headers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 pb-2 mb-1 border-b border-gray-100">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 flex items-center gap-1.5">
              <PieChart sx={{ fontSize: 16 }} className="text-[#ec9324]" />
              Infollion Research — Level 1
            </div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">
              {clientName} — Segmentation
            </div>
          </div>

          {!hasClientSeg ? (
            // Right column: no client segmentation available
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 pt-4">
              {/* LEFT — master categories still listed for context */}
              <div className="space-y-2" data-testid="link-seg-left-list">
                {infollionL1.map((name) => (
                  <div
                    key={name}
                    className="flex items-center min-h-[40px] px-3 rounded-lg bg-gray-50 border border-gray-200 text-sm font-medium text-gray-800"
                  >
                    {name}
                  </div>
                ))}
              </div>
              {/* RIGHT — empty state */}
              <div className="flex items-center justify-center">
                <div
                  className="w-full flex flex-col items-center justify-center text-center border border-dashed border-gray-300 rounded-xl bg-gray-50/60 py-12 px-6"
                  data-testid="link-seg-no-seg"
                >
                  <div className="w-12 h-12 rounded-full bg-orange-100 text-[#ec9324] flex items-center justify-center mb-3">
                    <PieChart />
                  </div>
                  <div className="text-sm font-semibold text-gray-700">No Segmentation Available</div>
                  <p className="text-xs text-gray-500 mt-1 mb-4 max-w-xs">
                    This client has no Level-1 segmentation yet. Add one to map it against the
                    Infollion Research categories.
                  </p>
                  <Button
                    onClick={() => onAddSegmentation?.()}
                    className="bg-[#ec9324] hover:bg-[#d3811b] text-white h-9"
                    data-testid="link-seg-add-segmentation"
                  >
                    <Plus sx={{ fontSize: 18, marginRight: "4px" }} />
                    Add Segmentation
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            // Row-aligned mapping grid
            <div className="divide-y divide-gray-100">
              {infollionL1.map((name, idx) => (
                <div
                  key={name}
                  className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 py-3 items-start"
                  data-testid={`link-seg-row-${idx}`}
                >
                  {/* LEFT — master category */}
                  <div className="flex items-center min-h-[40px] px-3 rounded-lg bg-gray-50 border border-gray-200 text-sm font-medium text-gray-800">
                    {name}
                  </div>
                  {/* RIGHT — Team-Member-style multi-select */}
                  <div className="relative">
                    <MultiSelectFilter
                      label="Segmentations"
                      options={clientOptions}
                      value={draft[name] || []}
                      onChange={(v) => updateRow(name, v)}
                      placeholder="Select segmentations..."
                      testIdPrefix={`link-seg-select-${idx}`}
                      hideLabelPrefix
                      fullWidth
                      searchInTrigger
                      countUnitLabel="segmentation(s) selected"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default LinkSegmentationTab;
