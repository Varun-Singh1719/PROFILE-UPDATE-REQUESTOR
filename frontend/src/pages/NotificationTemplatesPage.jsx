import React, { useEffect, useState, useCallback, useMemo } from "react";
import api, { formatApiError } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import notify from "../lib/notify";
import Edit from "@mui/icons-material/EditOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import Close from "@mui/icons-material/Close";
import CheckCircle from "@mui/icons-material/CheckCircleOutlined";
import PauseCircle from "@mui/icons-material/PauseCircleOutlined";
import { useAuth } from "../context/AuthContext";

/**
 * NotificationTemplatesPage
 *
 * Sibling of EmailTemplatesPage but scoped to *in-app* bell notifications.
 * Renders one card per template with its trigger (what fires it), title/body
 * (with {{variables}}), status pill, and an Edit button that opens a modal
 * mirroring the Email Templates edit UX.
 */
export default function NotificationTemplatesPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "Super Admin";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/notification-templates");
      setItems(r.data || []);
    } catch (e) {
      notify.error(formatApiError(e?.response?.data?.detail) || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [items],
  );

  return (
    <Layout
      title="Notification Templates"
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 sx={{ fontSize: 14 }} className="animate-spin" /> : "Refresh"}
        </Button>
      }
    >
      <div className="p-4 space-y-4" data-testid="notif-templates-page">
        <div className="text-sm text-gray-500 max-w-3xl">
          These are the notifications that appear in the bell dropdown next to
          your profile. Edit the wording below — <code className="px-1 bg-gray-100 rounded text-[11px]">{`{{variables}}`}</code>{" "}
          are substituted at send time (e.g. <code className="px-1 bg-gray-100 rounded text-[11px]">{`{{seat_label}}`}</code>).
        </div>

        {loading && items.length === 0 && (
          <div className="text-sm text-gray-400 py-10 text-center">Loading templates…</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sorted.map((t) => (
            <div
              key={t.id}
              data-testid={`notif-template-card-${t.kind}`}
              className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-gray-900 text-sm truncate" data-testid={`notif-template-name-${t.kind}`}>
                      {t.name}
                    </div>
                    <StatusPill status={t.status} />
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    <span className="uppercase tracking-wider font-semibold text-gray-400">Kind</span>{" "}
                    <code className="px-1 bg-gray-100 rounded text-[10px]">{t.kind}</code>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(t)}
                  data-testid={`notif-template-edit-${t.kind}`}
                  className="shrink-0"
                >
                  <Edit sx={{ fontSize: 14 }} className="mr-1.5" /> Edit
                </Button>
              </div>

              <div className="mt-4 p-3 rounded-lg bg-gray-50 border border-gray-100 space-y-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
                    Trigger
                  </div>
                  <div className="text-[12px] text-gray-700">{t.trigger || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
                    Title
                  </div>
                  <div className="text-[13px] font-medium text-gray-900" data-testid={`notif-template-title-${t.kind}`}>
                    {t.title}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
                    Body
                  </div>
                  <div className="text-[12px] text-gray-600 whitespace-pre-line leading-snug">
                    {t.body}
                  </div>
                </div>
              </div>

              {t.description && (
                <div className="text-[11px] text-gray-500 mt-3 italic">
                  {t.description}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <EditTemplateModal
        template={editing}
        canEditContent={isSuperAdmin}
        onClose={() => setEditing(null)}
        onSaved={(fresh) => {
          setItems((prev) => prev.map((x) => (x.id === fresh.id ? fresh : x)));
          setEditing(null);
        }}
      />
    </Layout>
  );
}

function StatusPill({ status }) {
  const active = status !== "Inactive";
  const Icon = active ? CheckCircle : PauseCircle;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
        active
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-gray-100 text-gray-500 border border-gray-200"
      }`}
      data-testid={`notif-template-status-${status}`}
    >
      <Icon sx={{ fontSize: 11 }} />
      {status || "Active"}
    </span>
  );
}

function EditTemplateModal({ template, canEditContent, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "",
    title: "",
    body: "",
    action_label: "",
    status: "Active",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template) {
      setForm({
        name: template.name || "",
        title: template.title || "",
        body: template.body || "",
        action_label: template.action_label || "",
        status: template.status || "Active",
      });
    }
  }, [template]);

  if (!template) return null;

  const save = async () => {
    setSaving(true);
    try {
      const payload = canEditContent
        ? form
        : { status: form.status }; // Admin: status-only
      const r = await api.patch(`/notification-templates/${template.id}`, payload);
      notify.success("Template updated");
      onSaved(r.data);
    } catch (e) {
      notify.error(formatApiError(e?.response?.data?.detail) || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden" data-testid="notif-template-edit-modal">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-gray-100">
          <DialogTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Edit sx={{ fontSize: 16 }} className="text-[#ec9324]" />
            Edit Notification Template
          </DialogTitle>
          <div className="text-[11px] text-gray-500 mt-1">
            Kind <code className="px-1 bg-gray-100 rounded">{template.kind}</code>
            {" · "}Trigger: {template.trigger}
          </div>
        </DialogHeader>

        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto space-y-4">
          {!canEditContent && (
            <div className="text-[11px] bg-amber-50 border border-amber-200 rounded p-2.5 text-amber-800">
              Only Super Admin can edit content. You can toggle the status.
            </div>
          )}
          <div>
            <Label htmlFor="ntpl-name">Name</Label>
            <Input
              id="ntpl-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              disabled={!canEditContent}
              className="mt-1.5"
              data-testid="notif-template-name-input"
            />
          </div>
          <div>
            <Label htmlFor="ntpl-title">
              Title <span className="text-gray-400 font-normal text-[11px]">— appears as the bold headline in the bell row</span>
            </Label>
            <Input
              id="ntpl-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              disabled={!canEditContent}
              className="mt-1.5"
              placeholder="e.g. Workstation request approved"
              data-testid="notif-template-title-input"
            />
          </div>
          <div>
            <Label htmlFor="ntpl-body">
              Body <span className="text-gray-400 font-normal text-[11px]">— use {`{{variable}}`} placeholders</span>
            </Label>
            <Textarea
              id="ntpl-body"
              rows={5}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              disabled={!canEditContent}
              className="mt-1.5 font-mono text-[12px]"
              placeholder={"e.g. Your workstation request for {{seat_label}} on {{date}} was approved by {{decided_by}}."}
              data-testid="notif-template-body-input"
            />
          </div>
          <div>
            <Label htmlFor="ntpl-action">Action label</Label>
            <Input
              id="ntpl-action"
              value={form.action_label}
              onChange={(e) => setForm((f) => ({ ...f, action_label: e.target.value }))}
              disabled={!canEditContent}
              className="mt-1.5"
              placeholder="e.g. View booking"
              data-testid="notif-template-action-input"
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Label className="mb-0">Status</Label>
            <div className="flex gap-2" data-testid="notif-template-status-toggle">
              {["Active", "Inactive"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, status: s }))}
                  className={`px-3 h-7 text-[11px] rounded-full font-semibold border transition-colors ${
                    form.status === s
                      ? s === "Active"
                        ? "bg-emerald-500 text-white border-emerald-500"
                        : "bg-gray-500 text-white border-gray-500"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                  data-testid={`notif-template-status-btn-${s}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="pt-3 border-t border-gray-100">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
              Preview (raw, no substitution)
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-[13px] font-semibold text-gray-900">{form.title || "(title)"}</div>
              <div className="text-[12px] text-gray-600 mt-0.5 whitespace-pre-line">{form.body || "(body)"}</div>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/50">
          <Button variant="outline" onClick={onClose} disabled={saving} data-testid="notif-template-cancel">
            <Close sx={{ fontSize: 14 }} className="mr-1.5" /> Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
            data-testid="notif-template-save"
          >
            {saving ? <Loader2 sx={{ fontSize: 14 }} className="mr-1.5 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
