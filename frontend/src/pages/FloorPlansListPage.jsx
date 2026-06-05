import React, { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Plus, Copy, Trash2, History, Loader2, MapPin, FileText, Clock, X,
  Upload, Link2, CheckCircle2, Eye, Pencil,
} from "lucide-react";
import api from "../lib/api";
import Layout from "../components/Layout";

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch { return iso; }
}

export default function FloorPlansListPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showClone, setShowClone] = useState(null); // {id, name}
  const [createName, setCreateName] = useState("");
  const [createMode, setCreateMode] = useState("url"); // 'url' | 'upload'
  const [createPdf, setCreatePdf] = useState("https://customer-assets.emergentagent.com/job_workspace-manager-19/artifacts/m9mpuhb8_Without%20seat%20floor%20map.pdf");
  const [uploadedPdfPath, setUploadedPdfPath] = useState(null); // {path, filename}
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);
  const [cloneName, setCloneName] = useState("");
  const [working, setWorking] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/floor-plans");
      setPlans(res.data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const createPlan = async () => {
    const finalPdfUrl = createMode === "upload"
      ? (uploadedPdfPath ? uploadedPdfPath.path : "")
      : createPdf.trim();
    if (!createName.trim() || !finalPdfUrl) return;
    setWorking(true);
    try {
      const res = await api.post("/floor-plans", { name: createName.trim(), pdfUrl: finalPdfUrl });
      setShowCreate(false); setCreateName(""); setUploadedPdfPath(null); setUploadError("");
      navigate(`/workspace-manager/calibration/${res.data.id}`);
    } catch (e) {
      alert(`Create failed: ${e?.response?.data?.detail || e.message}`);
    } finally { setWorking(false); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Please pick a PDF file.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setUploadError("PDF too large (max 15 MB).");
      return;
    }
    setUploadError(""); setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post("/floor-plans/upload-pdf", form, { headers: { "Content-Type": "multipart/form-data" } });
      // server returns { path: "/api/floor-plans/pdf/<uuid>.pdf", pdfUrl, filename, size }
      setUploadedPdfPath({ path: res.data.path, filename: res.data.filename || file.name, size: res.data.size });
    } catch (err) {
      setUploadError(err?.response?.data?.detail || err.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const resetCreateModal = () => {
    setShowCreate(false);
    setUploadedPdfPath(null);
    setUploadError("");
    setCreateMode("url");
  };

  const clonePlan = async () => {
    if (!cloneName.trim()) return;
    setWorking(true);
    try {
      await api.post(`/floor-plans/${showClone.id}/clone`, { name: cloneName.trim() });
      setShowClone(null); setCloneName("");
      await load();
    } catch (e) {
      alert(`Clone failed: ${e?.response?.data?.detail || e.message}`);
    } finally { setWorking(false); }
  };

  const deletePlan = async (p) => {
    if (!window.confirm(`Delete floor plan "${p.name}"? This removes all versions and audit history. This cannot be undone.`)) return;
    try {
      await api.delete(`/floor-plans/${p.id}`);
      await load();
    } catch (e) {
      alert(`Delete failed: ${e?.response?.data?.detail || e.message}`);
    }
  };

  return (
    <Layout breadcrumbs={[{ label: "Workspace Manager" }, { label: "Floor Plans" }]}>
      <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="floor-plans-title">Floor Plans</h1>
            <p className="text-sm text-gray-600">Manage all calibrated floor maps. Multiple plans can be Live at the same time.</p>
          </div>
          <button
            onClick={() => { setCreateName(""); setShowCreate(true); }}
            data-testid="new-floor-plan-btn"
            className="px-4 py-2 bg-[#ec9324] hover:bg-[#d6831f] text-white rounded-lg flex items-center gap-2 font-semibold shadow-sm transition-colors"
          >
            <Plus size={16} /> New Floor Plan
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500"><Loader2 className="animate-spin mr-2" /> Loading…</div>
        ) : plans.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
            <FileText className="mx-auto mb-3 text-gray-400" size={32} />
            <h2 className="font-semibold text-gray-700">No floor plans yet</h2>
            <p className="text-sm text-gray-500 mt-1">Create your first floor plan to start calibrating seats.</p>
            <button onClick={() => setShowCreate(true)} className="mt-4 px-4 py-2 bg-[#ec9324] text-white rounded-lg">Create floor plan</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {plans.map(p => (
              <PlanCard
                key={p.id}
                plan={p}
                onClone={() => { setCloneName(`${p.name} (copy)`); setShowClone({ id: p.id, name: p.name }); }}
                onDelete={() => deletePlan(p)}
              />
            ))}
          </div>
        )}

      {/* Create Modal */}
      {showCreate && (
        <Modal title="New Floor Plan" onClose={resetCreateModal}>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Name</label>
          <input data-testid="create-plan-name" autoFocus className="w-full px-3 py-2 border rounded mb-3 text-sm" placeholder="e.g. Mumbai Floor 1" value={createName} onChange={(e) => setCreateName(e.target.value)} />

          <label className="block text-xs font-semibold text-gray-700 mb-1">Floor plan PDF</label>
          <div className="flex border border-gray-200 rounded mb-3 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setCreateMode("url")}
              data-testid="create-mode-url"
              className={`flex-1 py-1.5 flex items-center justify-center gap-1.5 transition-colors ${createMode === "url" ? "bg-[#ec9324] text-white font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              <Link2 size={12}/> PDF URL
            </button>
            <button
              type="button"
              onClick={() => setCreateMode("upload")}
              data-testid="create-mode-upload"
              className={`flex-1 py-1.5 flex items-center justify-center gap-1.5 transition-colors border-l border-gray-200 ${createMode === "upload" ? "bg-[#ec9324] text-white font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              <Upload size={12}/> Upload PDF
            </button>
          </div>

          {createMode === "url" ? (
            <input
              data-testid="create-plan-pdf"
              className="w-full px-3 py-2 border rounded mb-1 text-sm"
              placeholder="https://example.com/floor.pdf"
              value={createPdf}
              onChange={(e) => setCreatePdf(e.target.value)}
            />
          ) : (
            <div className="mb-1">
              {uploadedPdfPath ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2 border border-emerald-200 bg-emerald-50 rounded text-xs" data-testid="upload-success">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0"/>
                    <span className="truncate text-emerald-800 font-medium">{uploadedPdfPath.filename}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUploadedPdfPath(null)}
                    className="text-emerald-700 hover:text-emerald-900 text-[11px] underline flex-shrink-0"
                    data-testid="upload-replace-btn"
                  >Replace</button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-1.5 px-3 py-6 border-2 border-dashed border-gray-300 hover:border-[#ec9324] rounded cursor-pointer transition-colors text-center" data-testid="upload-dropzone">
                  <Upload size={20} className="text-gray-400"/>
                  <span className="text-xs text-gray-600">
                    {uploading ? "Uploading…" : "Click to choose a PDF (max 15 MB)"}
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={uploading}
                    onChange={handleFileUpload}
                    className="hidden"
                    data-testid="create-plan-upload-input"
                  />
                </label>
              )}
              {uploadError && (
                <div className="mt-1.5 text-[11px] text-red-600" data-testid="upload-error">{uploadError}</div>
              )}
            </div>
          )}

          <div className="mt-4 flex gap-2 justify-end">
            <button onClick={resetCreateModal} className="px-3 py-1.5 text-sm rounded border">Cancel</button>
            <button
              data-testid="create-plan-submit"
              onClick={createPlan}
              disabled={
                !createName.trim() || working || uploading ||
                (createMode === "url" ? !createPdf.trim() : !uploadedPdfPath)
              }
              className="px-3 py-1.5 text-sm rounded bg-[#ec9324] text-white disabled:opacity-50"
            >{working ? "Creating…" : "Create & Open"}</button>
          </div>
        </Modal>
      )}

      {/* Clone Modal */}
      {showClone && (
        <Modal title={`Clone "${showClone.name}"`} onClose={() => setShowClone(null)}>
          <p className="text-xs text-gray-600 mb-3">All seats from the live version will be copied into the new plan as version 1.</p>
          <label className="block text-xs font-semibold text-gray-700 mb-1">New name</label>
          <input data-testid="clone-plan-name" autoFocus className="w-full px-3 py-2 border rounded mb-4 text-sm" value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowClone(null)} className="px-3 py-1.5 text-sm rounded border">Cancel</button>
            <button data-testid="clone-plan-submit" onClick={clonePlan} disabled={!cloneName.trim() || working} className="px-3 py-1.5 text-sm rounded bg-[#ec9324] text-white disabled:opacity-50">{working ? "Cloning…" : "Clone"}</button>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// -------------------- Status badge --------------------------------------- //
// Brand tokens: Orange #ec9324 · Gray #b2b2b2 · Green #15B867
const STATUS_STYLE = {
  live: { color: "#15B867", bg: "#15B86715", border: "#15B86755" },
  inactive: { color: "#b2b2b2", bg: "#b2b2b220", border: "#b2b2b266" },
  draft: { color: "#ec9324", bg: "#ec932415", border: "#ec932455" },
};
const STATUS_LABEL = { live: "Live", inactive: "Inactive", draft: "Draft" };

function StatusBadge({ status }) {
  const s = (status || "draft").toLowerCase();
  const style = STATUS_STYLE[s] || STATUS_STYLE.draft;
  return (
    <span
      data-testid={`status-badge-${s}`}
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border"
      style={{ color: style.color, backgroundColor: style.bg, borderColor: style.border }}
    >
      {STATUS_LABEL[s] || "Draft"}
    </span>
  );
}

// -------------------- Icon-only action button --------------------------- //
const ICON_BTN_BASE = "relative group inline-flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 transition-colors";
const TOOLTIP_CLASS = "pointer-events-none absolute top-full mt-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-1 rounded bg-gray-800 text-white text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-md";

function IconBtn({ icon: Icon, label, onClick, disabled, danger, testId }) {
  const color = danger
    ? "text-red-600 hover:bg-red-100"
    : "text-gray-600 hover:bg-gray-200 hover:text-gray-900";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`${ICON_BTN_BASE} ${color} disabled:opacity-40 disabled:cursor-not-allowed`}
      aria-label={label}
    >
      <Icon size={15} />
      <span className={TOOLTIP_CLASS}>{label}</span>
    </button>
  );
}

// -------------------- Plan card ----------------------------------------- //
function PlanCard({ plan: p, onClone, onDelete }) {
  return (
    <div
      data-testid={`plan-card-${p.id}`}
      className="bg-white border border-gray-200 rounded-xl hover:shadow-md transition-shadow"
    >
      {/* Thumbnail */}
      <div className="relative h-36 bg-gradient-to-br from-gray-50 to-gray-100 border-b border-gray-100 flex items-center justify-center overflow-hidden rounded-t-xl">
        {p.thumbnail ? (
          <img src={p.thumbnail} alt={`${p.name} preview`} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center text-gray-400">
            <FileText size={28} />
            <span className="text-[10px] mt-1">No preview yet</span>
          </div>
        )}
        {p.has_draft && p.status === "live" && (
          <span
            className="absolute top-2 left-2 inline-flex items-center px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold border border-blue-200"
            title="A draft is pending publish"
            data-testid="draft-pending-sub-badge"
          >
            Draft pending
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        {/* Header row: name + status (right) */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="font-bold text-gray-900 truncate text-base" title={p.name}>{p.name}</h3>
          <StatusBadge status={p.status} />
        </div>

        {/* Meta */}
        <div className="text-xs text-gray-500 flex items-center flex-wrap gap-x-3 gap-y-1 mb-3">
          <span className="inline-flex items-center gap-1"><MapPin size={11} /> {p.live_seat_count} seats</span>
          <span className="inline-flex items-center gap-1"><History size={11} /> {p.version_count} versions</span>
          <span className="inline-flex items-center gap-1"><Clock size={11} /> {fmtDate(p.updated_at)}</span>
        </div>

        {/* Icon-only action row */}
        <div className="flex items-center justify-end gap-1.5 pt-3 border-t border-gray-100">
          <Link
            to={`/workspace-manager/floor-layout`}
            className={`${ICON_BTN_BASE} ${
              p.status === "live"
                ? "text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                : "text-gray-300 cursor-not-allowed pointer-events-none bg-gray-50"
            }`}
            aria-label="View"
            data-testid={`view-plan-${p.id}`}
            onClick={(e) => { if (p.status !== "live") e.preventDefault(); }}
          >
            <Eye size={15} />
            <span className={TOOLTIP_CLASS}>
              {p.status === "live" ? "View" : "No live version"}
            </span>
          </Link>
          <Link
            to={`/workspace-manager/calibration/${p.id}`}
            className={`${ICON_BTN_BASE} text-gray-600 hover:bg-gray-200 hover:text-gray-900`}
            aria-label="Edit"
            data-testid={`open-plan-${p.id}`}
          >
            <Pencil size={15} />
            <span className={TOOLTIP_CLASS}>Edit</span>
          </Link>
          <IconBtn icon={Copy} label="Clone" onClick={onClone} testId={`clone-plan-${p.id}`} />
          <IconBtn icon={Trash2} label="Delete" onClick={onDelete} danger testId={`delete-plan-${p.id}`} />
        </div>
      </div>
    </div>
  );
}
