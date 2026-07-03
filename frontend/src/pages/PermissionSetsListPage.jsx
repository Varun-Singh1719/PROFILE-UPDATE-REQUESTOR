import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import Layout from "../components/Layout";
import notify from "../lib/notify";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import DateFilter from "../components/DateFilter";
import {
  ListChecks, Loader2, Eye, Pencil, Trash2, Plus, Filter, X, Search,
  Briefcase, Armchair, Copy,
} from "lucide-react";

/**
 * Permission Sets List Page (v3)
 *
 * Columns: Numeric ID | Name | Created By | Created On | View | Edit | Delete
 * Filters: created_from / created_to, created_by (user id), module (profix | desk_booking)
 * Actions:
 *   - View → /admin/permission-sets/:id (read-only by default, has Edit toggle on detail page)
 *   - Edit → /admin/permission-sets/:id?edit=1 (opens detail page in edit mode)
 *   - Delete → confirmation popup, calls DELETE /api/permission-sets/:id
 */

function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

function ConfirmDeleteModal({ open, item, busy, onCancel, onConfirm }) {
  if (!open || !item) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" data-testid="pset-delete-modal">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-lg font-semibold text-gray-900">Delete Permission Set</div>
            <div className="text-sm text-gray-600 mt-1">
              Are you sure you want to delete <strong>"{item.name}"</strong>? This will also un-assign it from any employees who currently have it.
            </div>
          </div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-testid="pset-delete-cancel"
            className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100"
          >Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="pset-delete-confirm"
            className="px-4 py-2 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PermissionSetsListPage() {
  const navigate = useNavigate();
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [moduleFilter, setModuleFilter] = useState({ profix: false, desk_booking: false });
  const [deletingItem, setDeletingItem] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState(null);
  const [creators, setCreators] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.q = search;
      if (createdBy) params.created_by = createdBy;
      if (createdFrom) params.created_from = createdFrom;
      if (createdTo) params.created_to = createdTo;
      // Module filter — if exactly one is selected, pass it; if both or none, no module filter.
      const mods = Object.entries(moduleFilter).filter(([_, v]) => v).map(([k]) => k);
      if (mods.length === 1) params.module = mods[0];
      const r = await api.get("/permission-sets", { params });
      let items = r.data || [];
      // If both modules selected, filter client-side to sets having BOTH
      if (mods.length === 2) {
        items = items.filter((s) => mods.every((m) => s.modules && s.modules[m]));
      }
      setSets(items);
      // Distinct creators for dropdown
      const seen = new Map();
      for (const s of items) {
        if (s.created_by?.id && !seen.has(s.created_by.id)) seen.set(s.created_by.id, s.created_by);
      }
      setCreators(Array.from(seen.values()));
    } catch (e) {
      notify.error("Failed to load Permission Sets");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const resetFilters = () => {
    setSearch(""); setCreatedBy(""); setCreatedFrom(""); setCreatedTo("");
    setModuleFilter({ profix: false, desk_booking: false });
    setTimeout(load, 0);
  };

  const hasFilters = !!(search || createdBy || createdFrom || createdTo || moduleFilter.profix || moduleFilter.desk_booking);

  const doDelete = async () => {
    if (!deletingItem) return;
    setDeleting(true);
    try {
      const r = await api.delete(`/permission-sets/${deletingItem.id}`);
      const unassigned = r.data?.unassigned_count || 0;
      notify.success(
        `Deleted "${deletingItem.name}"` + (unassigned ? ` · un-assigned from ${unassigned} employee(s)` : "")
      );
      setDeletingItem(null);
      load();
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const doDuplicate = async (item) => {
    if (!item || duplicatingId) return;
    setDuplicatingId(item.id);
    try {
      const r = await api.post(`/permission-sets/${item.id}/duplicate`);
      const copy = r.data || {};
      notify.success(`Duplicated as "${copy.name}" (#${copy.numeric_id})`);
      // Navigate straight into the new copy in edit mode so the admin can tweak it
      if (copy.id) {
        navigate(`/admin/permission-sets/${copy.id}?edit=1`);
      } else {
        load();
      }
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Duplicate failed");
    } finally {
      setDuplicatingId(null);
    }
  };

  return (
    <Layout
      title="Permission Sets"
      actions={
        <button
          onClick={() => navigate("/admin/permissions")}
          data-testid="pset-new-btn"
          className="inline-flex items-center gap-2 px-4 h-9 rounded-md text-sm font-medium bg-[#ec9324] text-white hover:bg-[#d8851f]"
        >
          <Plus size={14} /> New Permission Set
        </button>
      }
    >
      <div className="space-y-6">

        {/* Filters */}
        <div className="sticky top-14 z-30 -mx-4 px-4 pt-1 pb-2 bg-gray-50/95 backdrop-blur">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter size={14} className="text-gray-500" />
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Filters</div>
            {hasFilters && (
              <button
                onClick={resetFilters}
                className="ml-auto text-xs font-medium text-[#ec9324] hover:underline"
                data-testid="pset-reset-filters"
              >Reset</button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") load(); }}
                  placeholder="Name contains..."
                  data-testid="pset-filter-search"
                  className="w-full pl-8 pr-3 py-2 text-sm rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40"
                />
              </div>
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Created On</label>
              <DateFilter
                value={{
                  field: "created_at",
                  mode: createdFrom && createdTo && createdFrom === createdTo
                    ? "on"
                    : (createdFrom && createdTo ? "between" : (createdFrom ? "after" : (createdTo ? "before" : "between"))),
                  from: createdFrom ? new Date(`${createdFrom}T00:00:00`) : null,
                  to: createdTo ? new Date(`${createdTo}T00:00:00`) : null,
                }}
                onChange={(v) => {
                  const iso = (d) => {
                    if (!d) return "";
                    const dt = new Date(d);
                    const p = (n) => String(n).padStart(2, "0");
                    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
                  };
                  if (!v?.from && !v?.to) { setCreatedFrom(""); setCreatedTo(""); return; }
                  if (v.mode === "between") { setCreatedFrom(iso(v.from)); setCreatedTo(iso(v.to || v.from)); }
                  else if (v.mode === "on") { setCreatedFrom(iso(v.from)); setCreatedTo(iso(v.from)); }
                  else if (v.mode === "after") { setCreatedFrom(iso(v.from)); setCreatedTo(""); }
                  else if (v.mode === "before") { setCreatedFrom(""); setCreatedTo(iso(v.from)); }
                }}
                fields={["created_at"]}
                label="Created On"
                testId="pset-filter-created"
                className="w-full h-[38px] justify-start"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Created By</label>
              <MultiSelectFilter
                label="Created By"
                value={createdBy ? [createdBy] : []}
                onChange={(arr) => setCreatedBy(arr[0] || "")}
                options={creators.map((c) => ({ value: c.id, label: c.name || c.email }))}
                testIdPrefix="pset-filter-creator"
                single
                className="w-full"
              />
            </div>
            <div className="md:col-span-2 lg:col-span-5">
              <label className="block text-xs font-medium text-gray-600 mb-1">Module</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "profix", label: "ProfiX", icon: Briefcase, color: "#ec9324" },
                  { key: "desk_booking", label: "Desk Booking", icon: Armchair, color: "#3b82f6" },
                ].map((m) => {
                  const on = moduleFilter[m.key];
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setModuleFilter((prev) => ({ ...prev, [m.key]: !prev[m.key] }))}
                      data-testid={`pset-filter-module-${m.key}`}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                        on
                          ? "border-[#ec9324]/40 bg-[#ec9324]/10 text-[#ec9324]"
                          : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
                      }`}
                    >
                      <Icon size={12} /> {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              onClick={load}
              data-testid="pset-apply-filters"
              className="px-4 py-1.5 text-xs font-medium rounded-md bg-gray-900 text-white hover:bg-gray-800"
            >Apply</button>
          </div>
        </div>
        </div>

        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-[#ec9324]" size={28} /></div>
          ) : sets.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-500">
              No Permission Sets yet.{" "}
              <button onClick={() => navigate("/admin/permissions")} className="text-[#ec9324] font-medium hover:underline" data-testid="pset-empty-cta">Create your first one</button>.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[calc(100vh-22rem)] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left">ID</th>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Modules</th>
                    <th className="px-4 py-3 text-left">Created By</th>
                    <th className="px-4 py-3 text-left">Created On</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sets.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50" data-testid={`pset-row-${s.numeric_id}`}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">#{s.numeric_id}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{s.name}</div>
                        {s.description && <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{s.description}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {Object.keys(s.modules || {}).map((m) => {
                            const meta = m === "profix"
                              ? { label: "ProfiX", color: "#ec9324", Icon: Briefcase }
                              : { label: "Desk Booking", color: "#3b82f6", Icon: Armchair };
                            const I = meta.Icon;
                            return (
                              <span
                                key={m}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
                                style={{ background: `${meta.color}15`, color: meta.color }}
                              >
                                <I size={11} /> {meta.label}
                              </span>
                            );
                          })}
                          {(!s.modules || Object.keys(s.modules).length === 0) && (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900">{s.created_by?.name || "—"}</div>
                        <div className="text-xs text-gray-500">{s.created_by?.email}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(s.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => navigate(`/admin/permission-sets/${s.id}`)}
                            data-testid={`pset-view-${s.numeric_id}`}
                            title="View"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-600 hover:text-gray-900"
                          ><Eye size={15} /></button>
                          <button
                            onClick={() => navigate(`/admin/permission-sets/${s.id}?edit=1`)}
                            data-testid={`pset-edit-${s.numeric_id}`}
                            title="Edit"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-600 hover:text-[#ec9324]"
                          ><Pencil size={15} /></button>
                          <button
                            onClick={() => doDuplicate(s)}
                            disabled={duplicatingId === s.id}
                            data-testid={`pset-duplicate-${s.numeric_id}`}
                            title="Duplicate"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-600 hover:text-[#ec9324] disabled:opacity-50"
                          >{duplicatingId === s.id ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}</button>
                          <button
                            onClick={() => setDeletingItem(s)}
                            data-testid={`pset-delete-${s.numeric_id}`}
                            title="Delete"
                            className="p-1.5 rounded hover:bg-red-50 text-gray-600 hover:text-red-600"
                          ><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ConfirmDeleteModal
        open={!!deletingItem}
        item={deletingItem}
        busy={deleting}
        onCancel={() => !deleting && setDeletingItem(null)}
        onConfirm={doDelete}
      />
    </Layout>
  );
}
