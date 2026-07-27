import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { API } from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Checkbox } from "../components/ui/checkbox";
import { BulkSelectCheckbox } from "../components/ui/bulk-select-checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import SingleSelect from "../components/SingleSelect";
import DeferredSearchInput from "../components/DeferredSearchInput";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "../components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator
} from "../components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "../components/ui/tooltip";
import MultiSelect from "../components/MultiSelect";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import UserAvatar from "../components/UserAvatar";
import Pagination from "../components/Pagination";
import notify from "../lib/notify";
import { useEffectivePage } from "../context/EffectivePermissionsContext";
import { __busyBridge } from "../context/BusyContext";
import Search from "@mui/icons-material/SearchOutlined";
import UserPlus from "@mui/icons-material/PersonAddOutlined";
import Pencil from "@mui/icons-material/EditOutlined";
import Eye from "@mui/icons-material/Visibility";
import EyeOff from "@mui/icons-material/VisibilityOff";
import Copy from "@mui/icons-material/ContentCopy";
import RefreshCw from "@mui/icons-material/Refresh";
import KeyRound from "@mui/icons-material/KeyOutlined";
import X from "@mui/icons-material/Close";
import Mail from "@mui/icons-material/MailOutlined";
import Phone from "@mui/icons-material/PhoneOutlined";
import Calendar from "@mui/icons-material/CalendarTodayOutlined";
import IdCard from "@mui/icons-material/BadgeOutlined";
import Briefcase from "@mui/icons-material/WorkOutlined";
import UsersRound from "@mui/icons-material/GroupsOutlined";
import Download from "@mui/icons-material/FileDownloadOutlined";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import MoreHorizontal from "@mui/icons-material/MoreHoriz";
import MoreVertical from "@mui/icons-material/MoreVert";
import ShieldCheck from "@mui/icons-material/GppGoodOutlined";
import Upload from "@mui/icons-material/FileUploadOutlined";
import FileSpreadsheet from "@mui/icons-material/TableChartOutlined";
import History from "@mui/icons-material/HistoryOutlined";
import CheckCircle2 from "@mui/icons-material/CheckCircleOutlined";
import AlertTriangle from "@mui/icons-material/WarningAmber";
import FileDown from "@mui/icons-material/FileDownloadOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import { teamBackground } from "../lib/teamColors";
import { confirm as confirmDialog } from '../lib/dialog';
import ISDPicker from "../components/ISDPicker";
import { DEFAULT_ISD } from "../lib/isdCodes";

function fmt(iso) { if (!iso) return "Never"; try { return new Date(iso).toLocaleString(); } catch { return iso; } }

// v3 role model — only Super Admin and Admin remain.
const ROLE_OPTIONS = ["Super Admin", "Admin"];
const ALL_ROLE_FILTERS = ["Super Admin", "Admin"];
const EMPTY_FORM = { email: "", name: "", phone: "", phone_isd: DEFAULT_ISD, role: "Admin", emp_id: "", doj: "", permission_set_ids: [] };

function PasswordField({ contactId, testIdPrefix = "contact" }) {
  const [pwd, setPwd] = useState(null); // decrypted password (or null)
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchPwd = async () => {
    if (pwd) { setShow((s) => !s); return; }
    setLoading(true);
    try {
      const r = await api.get(`/contacts/${contactId}/password`);
      setPwd(r.data.password);
      setShow(true);
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Could not retrieve password. Try Reset.");
    } finally { setLoading(false); }
  };

  const reset = async () => {
    const ok = await confirmDialog({ title: 'Reset password', message: 'Generate a new password? The old one will stop working.', confirmLabel: 'Reset' });
    if (!ok) return;
    setLoading(true);
    try {
      const r = await api.post(`/contacts/${contactId}/reset-password`);
      setPwd(r.data.password);
      setShow(true);
      notify.success("Password reset");
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Failed");
    } finally { setLoading(false); }
  };

  const copy = async () => {
    if (!pwd) return;
    try { await navigator.clipboard.writeText(pwd); notify.success("Password copied"); }
    catch (e) { console.error("clipboard write failed:", e); notify.error("Could not copy to clipboard"); }
  };

  const displayValue = pwd ? (show ? pwd : "•".repeat(Math.max(pwd.length, 10))) : "••••••••••";

  return (
    <div>
      <Label className="flex items-center gap-1.5">
        <KeyRound sx={{ fontSize: 14 }} className="text-gray-500"/> Password
      </Label>
      <div className="mt-1 flex items-center gap-2">
        <Input
          readOnly
          value={displayValue}
          className="font-mono"
          data-testid={`${testIdPrefix}-password-display`}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={fetchPwd}
          disabled={loading}
          data-testid={`${testIdPrefix}-password-toggle`}
          className="border-gray-300"
          aria-label={show ? "Hide password" : "Show password"}
          title={show ? "Hide" : "Show"}
        >
          {show ? <EyeOff sx={{ fontSize: 16 }}/> : <Eye sx={{ fontSize: 16 }}/>}
        </Button>
        {pwd && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={copy}
            data-testid={`${testIdPrefix}-password-copy`}
            className="border-gray-300"
            title="Copy"
            aria-label="Copy password"
          >
            <Copy sx={{ fontSize: 16 }}/>
          </Button>
        )}
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={reset}
          disabled={loading}
          data-testid={`${testIdPrefix}-password-reset`}
          className="border-gray-300"
          title="Reset password"
          aria-label="Reset password"
        >
          <RefreshCw sx={{ fontSize: 16 }}/>
        </Button>
      </div>
      <div className="text-xs text-gray-500 mt-1">Click the eye icon to reveal. Reset generates a new password.</div>
    </div>
  );
}

function EmployeeDetailModal({ contact, open, onClose }) {
  if (!contact) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <UserAvatar user={contact} size={44} showStatusDot={false}/>
            <div>
              <div className="text-lg font-bold">{contact.name}</div>
              <div className="text-xs text-gray-500 font-normal">{contact.role}</div>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">Employee details</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2 text-sm">
          <div className="flex items-center gap-2 text-gray-700">
            <Mail sx={{ fontSize: 14 }} className="text-gray-400"/>
            <span>{contact.email}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <Phone sx={{ fontSize: 14 }} className="text-gray-400"/>
            <span>
              {contact.phone ? (
                <>
                  <span className="text-gray-500">{contact.phone_isd || DEFAULT_ISD}</span>{" "}
                  <span>{contact.phone}</span>
                </>
              ) : (
                <span className="text-gray-400">No phone</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <IdCard sx={{ fontSize: 14 }} className="text-gray-400"/>
            <span><span className="text-gray-500">Emp ID:</span> {contact.emp_id || "—"}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <Calendar sx={{ fontSize: 14 }} className="text-gray-400"/>
            <span><span className="text-gray-500">DOJ:</span> {contact.doj || "—"}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <UsersRound sx={{ fontSize: 14 }} className="text-gray-400"/>
            <span>
              <span className="text-gray-500">Team:</span>{" "}
              {contact.team_name ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: teamBackground(contact.team_color) }} />
                  {contact.team_name}
                </span>
              ) : <span className="text-gray-400">No team</span>}
            </span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <Briefcase sx={{ fontSize: 14 }} className="text-gray-400"/>
            <span><span className="text-gray-500">Manager(s):</span> {(contact.manager_names || []).join(", ") || <span className="text-gray-400">—</span>}</span>
          </div>
          <div className="flex items-start gap-2 text-gray-700">
            <ShieldCheck sx={{ fontSize: 14 }} className="text-gray-400 mt-1"/>
            <div className="flex-1">
              <div className="text-gray-500 mb-1">Permission Sets:</div>
              {(contact.permission_sets || []).length === 0 ? (
                <span className="text-gray-400 text-xs">None assigned</span>
              ) : (
                <div className="flex flex-wrap gap-1.5" data-testid="detail-permission-sets">
                  {(contact.permission_sets || []).map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[#ec9324]/10 text-[#ec9324] border border-[#ec9324]/20"
                      data-testid={`detail-pset-chip-${p.numeric_id}`}
                    >
                      <span className="font-mono text-[10px] text-[#ec9324]/70">#{p.numeric_id}</span>
                      {p.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="border-t pt-3 mt-3">
            <PasswordField contactId={contact.id} testIdPrefix="detail" />
          </div>
          <div className="pt-2 text-xs text-gray-500">
            <div>Status: <span className={contact.status === "Active" ? "text-green-600 font-medium" : "text-gray-500"}>{contact.status}</span></div>
            <div>Created: {fmt(contact.created_on)}</div>
            <div>Last Login: {fmt(contact.last_login)}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Bulk Upload Modal ----------
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { document.body.removeChild(a); } catch (e) { /* noop */ }
    URL.revokeObjectURL(url);
  }, 150);
}

function authedFetch(path, opts = {}) {
  const token = localStorage.getItem("access_token") || "";
  return fetch(`${API}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

function BulkUploadModal({ open, onClose, onComplete }) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const reset = () => { setFile(null); setProgress(0); setResult(null); setUploading(false); };

  const close = () => { reset(); onClose(); };

  const pickFile = (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".xlsx")) {
      notify.error("Only .xlsx files are supported");
      return;
    }
    setFile(f);
    setResult(null);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    pickFile(f);
  };

  const downloadTemplate = async () => {
    const busyToken = __busyBridge.start("Downloading template…");
    try {
      const r = await authedFetch("/contacts/sample-template");
      if (!r.ok) {
        let detail = `HTTP ${r.status}`;
        try { const j = await r.json(); if (j?.detail) detail = j.detail; } catch (e) { /* not JSON */ }
        notify.error(`Could not download template: ${detail}`);
        return;
      }
      const blob = await r.blob();
      downloadBlob(blob, "employees_upload_template.xlsx");
    } catch (e) {
      notify.error(`Could not download template: ${e?.message || "network error"}`);
    } finally {
      __busyBridge.stop(busyToken);
    }
  };

  const startUpload = () => {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    // Push the overlay manually since this flow uses raw XHR (for progress).
    const busyToken = __busyBridge.start("Uploading employees…");
    const xhr = new XMLHttpRequest();
    const token = localStorage.getItem("access_token") || "";
    xhr.open("POST", `${API}/contacts/bulk-upload`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    const finish = () => { __busyBridge.stop(busyToken); };
    xhr.onload = () => {
      setUploading(false);
      setProgress(100);
      finish();
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          setResult(data);
          notify.success(`Upload complete — ${data.success} succeeded, ${data.failed} failed`);
          onComplete?.();
        } else {
          notify.error(data?.detail || "Upload failed");
        }
      } catch {
        notify.error("Upload failed");
      }
    };
    xhr.onerror = () => { setUploading(false); finish(); notify.error("Network error during upload"); };
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  };

  const downloadErrorReport = async () => {
    if (!result?.upload_id) return;
    try {
      const r = await authedFetch(`/contacts/upload-history/${result.upload_id}/error-report.xlsx`);
      if (!r.ok) { notify.error("Could not download error report"); return; }
      const blob = await r.blob();
      downloadBlob(blob, `error_report_${result.filename || "upload"}.xlsx`);
    } catch (e) { notify.error("Could not download error report"); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload sx={{ fontSize: 18 }} className="text-[#ec9324]"/> Upload Employees (.xlsx)
          </DialogTitle>
          <DialogDescription>
            Bulk-add employees from an Excel file. Download the sample template to see the required columns.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Button
                type="button" variant="outline" onClick={downloadTemplate}
                className="border-[#ec9324] text-[#ec9324] hover:bg-[#ec9324]/10"
                data-testid="download-sample-template-btn"
              >
                <FileSpreadsheet sx={{ fontSize: 14 }} className="mr-2"/> Download Sample Template
              </Button>
              <span className="text-xs text-gray-500">Only <b>.xlsx</b> files · Max ~5000 rows recommended</span>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => document.getElementById("bulk-upload-input")?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragOver ? "border-[#ec9324] bg-[#ec9324]/5" : "border-gray-300 hover:border-[#ec9324]"
              }`}
              data-testid="upload-dropzone"
            >
              <Upload sx={{ fontSize: 32 }} className="mx-auto text-gray-400 mb-2"/>
              <div className="text-sm font-medium text-gray-700">
                {file ? file.name : "Drag & drop your .xlsx file here"}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {file ? `${(file.size / 1024).toFixed(1)} KB` : "or click to browse"}
              </div>
              <input
                id="bulk-upload-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden" onChange={(e) => pickFile(e.target.files?.[0])}
                data-testid="upload-file-input"
              />
            </div>

            {uploading && (
              <div data-testid="upload-progress" className="space-y-1">
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Uploading…</span><span>{progress}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#ec9324] transition-all" style={{ width: `${progress}%` }}/>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={uploading}>Cancel</Button>
              <Button
                onClick={startUpload}
                disabled={!file || uploading}
                className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
                data-testid="start-upload-btn"
              >
                {uploading ? (<><Loader2 sx={{ fontSize: 14 }} className="mr-2 animate-spin"/>Uploading…</>) : (<><Upload sx={{ fontSize: 14 }} className="mr-2"/>Upload</>)}
              </Button>
            </DialogFooter>
          </div>
        )}

        {result && (
          <div className="space-y-4" data-testid="upload-result">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-gray-900" data-testid="upload-total">{result.total}</div>
                <div className="text-xs text-gray-500 uppercase tracking-wider">Total</div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-700 flex items-center justify-center gap-1" data-testid="upload-success">
                  <CheckCircle2 sx={{ fontSize: 20 }}/> {result.success}
                </div>
                <div className="text-xs text-green-600 uppercase tracking-wider">Success</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-700 flex items-center justify-center gap-1" data-testid="upload-failed">
                  <AlertTriangle sx={{ fontSize: 20 }}/> {result.failed}
                </div>
                <div className="text-xs text-red-600 uppercase tracking-wider">Failed</div>
              </div>
            </div>

            <div className="text-xs text-gray-500">
              Status: <span className="font-medium text-gray-700">{result.status}</span> · File: <span className="font-mono">{result.filename}</span>
            </div>

            {result.failed > 0 && (
              <>
                <div className="border border-red-100 rounded-lg overflow-hidden">
                  <div className="bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 flex items-center justify-between">
                    <span>Error preview ({Math.min(result.errors.length, 10)} of {result.failed})</span>
                    {result.has_more_errors && <span className="text-red-600">Download full report below</span>}
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="px-2 py-1 text-left">Row</th>
                          <th className="px-2 py-1 text-left">Name</th>
                          <th className="px-2 py-1 text-left">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.errors || []).slice(0, 10).map((e, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="px-2 py-1 text-gray-600 font-mono">{e.row}</td>
                            <td className="px-2 py-1 text-gray-700">{e.name || "—"}</td>
                            <td className="px-2 py-1 text-red-700">{e.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <Button
                  variant="outline" onClick={downloadErrorReport}
                  className="border-red-300 text-red-700 hover:bg-red-50 w-full"
                  data-testid="download-error-report-btn"
                >
                  <FileDown sx={{ fontSize: 14 }} className="mr-2"/> Download Error Report (.xlsx)
                </Button>
              </>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={reset} data-testid="upload-another-btn">Upload Another</Button>
              <Button onClick={close} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="close-upload-result-btn">Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Upload History Modal ----------
function UploadHistoryModal({ open, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/contacts/upload-history", { params: { page_size: 50 } });
      setItems(r.data.items || []);
      setTotal(r.data.total || 0);
    } catch (e) { notify.error("Could not load upload history"); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open]);

  const downloadErrorReport = async (id, filename) => {
    try {
      const r = await authedFetch(`/contacts/upload-history/${id}/error-report.xlsx`);
      if (!r.ok) { notify.error("Could not download error report"); return; }
      const blob = await r.blob();
      downloadBlob(blob, `error_report_${(filename || "upload").replace(/\.xlsx$/i, "")}.xlsx`);
    } catch (e) { notify.error("Could not download error report"); }
  };

  const statusPill = (s) => {
    const map = {
      Completed: "bg-green-100 text-green-700 border-green-200",
      Partial: "bg-amber-100 text-amber-700 border-amber-200",
      Failed: "bg-red-100 text-red-700 border-red-200",
      Empty: "bg-gray-100 text-gray-600 border-gray-200",
    };
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${map[s] || map.Empty}`}>{s}</span>;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History sx={{ fontSize: 18 }} className="text-[#ec9324]"/> Upload History
          </DialogTitle>
          <DialogDescription>
            Past bulk-upload sessions. Click an error count to download the per-row error report.
          </DialogDescription>
        </DialogHeader>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="max-h-[55vh] overflow-y-auto">
            <table className="w-full text-sm" data-testid="upload-history-table">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-left">File</th>
                  <th className="px-4 py-3 text-left">Uploaded By</th>
                  <th className="px-4 py-3 text-left">When</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Success</th>
                  <th className="px-4 py-3 text-right">Failed</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Errors</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">
                    <Loader2 sx={{ fontSize: 18 }} className="inline animate-spin mr-2"/> Loading…
                  </td></tr>
                )}
                {!loading && items.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">No uploads yet</td></tr>
                )}
                {!loading && items.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50/80" data-testid={`upload-row-${u.id}`}>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{u.filename}</td>
                    <td className="px-3 py-2 text-gray-700">{u.uploaded_by?.name || "—"}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{fmt(u.uploaded_at)}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{u.total_rows}</td>
                    <td className="px-3 py-2 text-right text-green-700 font-medium">{u.success_count}</td>
                    <td className="px-3 py-2 text-right text-red-700 font-medium">{u.failed_count}</td>
                    <td className="px-3 py-2">{statusPill(u.status)}</td>
                    <td className="px-3 py-2 text-right">
                      {u.failed_count > 0 ? (
                        <Button
                          size="sm" variant="outline"
                          onClick={() => downloadErrorReport(u.id, u.filename)}
                          className="border-red-300 text-red-700 hover:bg-red-50 h-7"
                          data-testid={`download-error-${u.id}`}
                        >
                          <FileDown sx={{ fontSize: 12 }} className="mr-1"/> Report
                        </Button>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-xs text-gray-500">{total} upload{total === 1 ? "" : "s"} total</div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



function GeneratedPasswordModal({ password, email, onClose }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(password); notify.success("Password copied"); }
    catch (e) { console.error("clipboard write failed:", e); notify.error("Could not copy to clipboard"); }
  };
  return (
    <Dialog open={!!password} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Employee Created</DialogTitle>
          <DialogDescription>An auto-generated password has been created. You can always view it later from the employee detail/edit screen.</DialogDescription>
        </DialogHeader>
        <div className="mt-3 space-y-3">
          <div className="text-sm text-gray-600">
            Login for <span className="font-semibold">{email}</span>:
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center gap-2 font-mono text-sm">
            <span className="flex-1 break-all" data-testid="generated-password-value">{password}</span>
            <Button size="icon" variant="outline" onClick={copy} className="border-gray-300" aria-label="Copy" data-testid="copy-generated-password">
              <Copy sx={{ fontSize: 16 }}/>
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="close-generated-password">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ContactListPage() {
  // ── Permissions V3 (Round 3) ──
  const { fn: permFn } = useEffectivePage("manage", "employees");
  const permCreate = permFn("create");
  const permEdit   = permFn("edit");
  const permInvite = permFn("invite");
  const permImport = permFn("import");
  const permExport = permFn("export");

  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [q, setQ] = useState("");
  const [role, setRole] = useState([]);
  const [status, setStatus] = useState([]);
  const [psetFilter, setPsetFilter] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkRoleOpen, setBulkRoleOpen] = useState(false);
  const [bulkRole, setBulkRole] = useState("Admin");

  const [detailContact, setDetailContact] = useState(null);
  const [generated, setGenerated] = useState(null); // {password, email}
  const [permissionSets, setPermissionSets] = useState([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Read `permission_set` URL param on mount (deep-link from Permission Sets tab)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const psetId = searchParams.get("permission_set");
    if (psetId) {
      setPsetFilter((prev) => (prev.includes(psetId) ? prev : [psetId]));
    }
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/permission-sets");
        setPermissionSets(r.data || []);
      } catch {
        setPermissionSets([]);
      }
    })();
  }, []);

  const load = async () => {
    const r = await api.get("/contacts", {
      params: {
        q: q || undefined,
        role: role.length ? role.join(",") : undefined,
        status: status.length ? status.join(",") : undefined,
        permission_set_id: psetFilter.length ? psetFilter.join(",") : undefined,
        page, page_size: pageSize, sort_by: sortBy, sort_dir: sortDir,
      },
    });
    // Paginated shape: { items, total, page, page_size }
    if (r.data && Array.isArray(r.data.items)) {
      setContacts(r.data.items);
      setTotal(r.data.total);
    } else {
      setContacts(r.data);
      setTotal(r.data.length);
    }
    setSelected([]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, role, status, psetFilter, page, pageSize, sortBy, sortDir]);
  useEffect(() => { setPage(1); /* reset on filter change */ }, [q, role, status, psetFilter, pageSize]);

  const toggleSort = (field) => {
    if (sortBy === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortDir("asc"); }
  };

  const toggleAll = (checked) => {
    setSelected(checked ? contacts.map((c) => c.id) : []);
  };
  const toggleOne = (id, checked) => {
    setSelected((s) => checked ? [...s, id] : s.filter((x) => x !== id));
  };

  const bulkActivate = async (newStatus) => {
    if (selected.length === 0) return;
    try {
      const r = await api.post("/contacts/bulk-status", { contact_ids: selected, status: newStatus });
      notify.success(`${r.data?.updated || 0} employee(s) → ${newStatus}`);
      setSelected([]);
      load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const applyBulkRole = async () => {
    if (selected.length === 0) return;
    try {
      const r = await api.post("/contacts/bulk-role", { contact_ids: selected, role: bulkRole });
      notify.success(`${r.data?.updated || 0} employee(s) → ${bulkRole}`);
      setBulkRoleOpen(false);
      setSelected([]);
      load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const exportCsv = () => {
    const token = localStorage.getItem("access_token") || "";
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (role.length) params.set("role", role.join(","));
    if (status.length) params.set("status", status.join(","));
    const busyToken = __busyBridge.start("Exporting CSV…");
    fetch(`${API}/contacts/export.csv?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(async (resp) => {
      if (!resp.ok) { notify.error("Export failed"); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `employees_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch(() => notify.error("Export failed"))
      .finally(() => __busyBridge.stop(busyToken));
  };

  const toggleStatus = async (c) => {
    const next = c.status === "Active" ? "Inactive" : "Active";
    try {
      await api.patch(`/contacts/${c.id}`, { status: next });
      notify.success(`${c.name} is now ${next}`);
      load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      email: c.email,
      name: c.name,
      phone: c.phone || "",
      phone_isd: c.phone_isd || DEFAULT_ISD,
      role: c.role,
      emp_id: c.emp_id || "",
      doj: c.doj || "",
      permission_set_ids: c.permission_set_ids || [],
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        const payload = {
          name: form.name,
          phone: form.phone,
          phone_isd: form.phone_isd || DEFAULT_ISD,
          role: form.role,
          emp_id: form.emp_id || "",
          doj: form.doj || null,
          permission_set_ids: form.permission_set_ids || [],
        };
        await api.patch(`/contacts/${editing.id}`, payload);
        notify.success("Employee updated");
      } else {
        const r = await api.post("/contacts", {
          email: form.email,
          name: form.name,
          phone: form.phone,
          phone_isd: form.phone_isd || DEFAULT_ISD,
          role: form.role,
          emp_id: form.emp_id || "",
          doj: form.doj || null,
          permission_set_ids: form.permission_set_ids || [],
        });
        notify.success("Employee created");
        if (r.data?.generated_password) {
          setGenerated({ password: r.data.generated_password, email: r.data.email });
        }
      }
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      notify.error(err?.response?.data?.detail || "Failed");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allSelected = contacts.length > 0 && contacts.every((c) => selected.includes(c.id));
  const anySelected = selected.length > 0;

  return (
    <Layout
      title="Employee List"
      contentClassName="w-full px-4 pt-4 pb-3 flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden"
      actions={
        <div className="flex items-center gap-2">
          {anySelected && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" data-testid="bulk-actions-btn" className="border-[#ec9324] text-[#ec9324] hover:bg-[#ec9324]/10">
                  Bulk actions ({selected.length})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Apply to {selected.length} selected</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => bulkActivate("Active")} data-testid="bulk-activate">Activate</DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkActivate("Inactive")} data-testid="bulk-deactivate">Deactivate</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBulkRoleOpen(true)} data-testid="bulk-change-role">Change role…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <TooltipProvider delayDuration={150}>
            {permExport.isVisible && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" onClick={exportCsv} data-testid="export-csv-btn"
                  size="icon" className="h-9 w-9 border-gray-300"
                  aria-label="Export CSV"
                  disabled={!permExport.canUse}
                >
                  <Download sx={{ fontSize: 16 }}/>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export CSV</TooltipContent>
            </Tooltip>
            )}
            {permImport.isVisible && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" onClick={() => setHistoryOpen(true)} data-testid="upload-history-btn"
                  size="icon" className="h-9 w-9 border-gray-300"
                  aria-label="Upload History"
                  disabled={!permImport.canUse}
                >
                  <History sx={{ fontSize: 16 }}/>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Upload History</TooltipContent>
            </Tooltip>
            )}
            {permImport.isVisible && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" onClick={() => setUploadOpen(true)} data-testid="open-bulk-upload-btn"
                  size="icon" className="h-9 w-9 border-[#ec9324] text-[#ec9324] hover:bg-[#ec9324]/10"
                  aria-label="Upload Employees"
                  disabled={!permImport.canUse}
                >
                  <Upload sx={{ fontSize: 16 }}/>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Upload Employees</TooltipContent>
            </Tooltip>
            )}
          </TooltipProvider>
          {permCreate.isVisible && (
          <Button onClick={openCreate} className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9" data-testid="add-contact-btn" disabled={!permCreate.canUse}>
            <UserPlus sx={{ fontSize: 16 }} className="mr-2"/> Add Employee
          </Button>
          )}
        </div>
      }
    >

      <Dialog open={bulkRoleOpen} onOpenChange={setBulkRoleOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change role for {selected.length} employee(s)</DialogTitle>
            <DialogDescription>This will overwrite the role on every selected employee.</DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <Label>New role</Label>
            <div className="mt-1.5">
              <SingleSelect
                testId="bulk-role-select"
                options={ROLE_OPTIONS.map((r) => ({ value: r, label: r }))}
                value={bulkRole}
                onChange={(v) => setBulkRole(v || bulkRole)}
                allowClear={false}
                placeholder="Select role"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkRoleOpen(false)}>Cancel</Button>
            <Button onClick={applyBulkRole} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="bulk-role-apply">
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(EMPTY_FORM); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Employee" : "Add New Employee"}</DialogTitle>
            <DialogDescription className="sr-only">Employee form</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Email {editing ? "" : "*"}</Label>
                <Input
                  type="email" required value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  data-testid="contact-email"
                  disabled={!!editing}
                />
              </div>
              <div className="col-span-2">
                <Label>Name *</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="contact-name"/>
              </div>
              <div>
                <Label>Phone</Label>
                <div className="mt-1.5 flex gap-2">
                  <div className="w-[110px] flex-shrink-0">
                    <ISDPicker
                      value={form.phone_isd || DEFAULT_ISD}
                      onChange={(dial) => setForm({ ...form, phone_isd: dial })}
                      testId="contact-phone-isd"
                    />
                  </div>
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^0-9]/g, "") })}
                    inputMode="numeric"
                    placeholder="Mobile Number"
                    className="flex-1"
                    data-testid="contact-phone"
                  />
                </div>
              </div>
              <div>
                <Label>Emp ID *</Label>
                <Input required={!editing} value={form.emp_id} onChange={(e) => setForm({ ...form, emp_id: e.target.value })} placeholder="EMP-0001" data-testid="contact-emp-id"/>
              </div>
              <div>
                <Label>DOJ (Date of Joining) *</Label>
                <Input required={!editing} type="date" value={form.doj || ""} onChange={(e) => setForm({ ...form, doj: e.target.value })} data-testid="contact-doj"/>
              </div>
              <div>
                <Label>Role *</Label>
                <div className="mt-1.5">
                  <SingleSelect
                    testId="contact-role"
                    options={ROLE_OPTIONS.map((r) => ({ value: r, label: r }))}
                    value={form.role}
                    onChange={(v) => setForm({ ...form, role: v || form.role })}
                    allowClear={false}
                    placeholder="Select role"
                  />
                </div>
              </div>
              <div className="col-span-2">
                <Label className="flex items-center gap-1.5">
                  <ShieldCheck sx={{ fontSize: 14 }} className="text-gray-500"/> Permission Sets
                </Label>
                <MultiSelectFilter
                  label="Permission Sets"
                  options={permissionSets.map((p) => ({
                    value: p.id,
                    label: `#${p.numeric_id} · ${p.name}`,
                  }))}
                  value={form.permission_set_ids || []}
                  onChange={(ids) => setForm({ ...form, permission_set_ids: ids })}
                  placeholder="Assign one or more Permission Sets…"
                  testIdPrefix="contact-permission-sets"
                  hideLabelPrefix
                  fullWidth
                />
                <div className="text-xs text-gray-500 mt-1">
                  Effective access = OR-union of all assigned sets (allow wins).
                </div>
              </div>
            </div>
            {editing && (
              <div className="border-t pt-4">
                <PasswordField contactId={editing.id} testIdPrefix="edit" />
              </div>
            )}
            {!editing && (
              <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-md p-2.5">
                A secure password will be generated automatically and shown after the employee is created.
              </div>
            )}
            <DialogFooter>
              <Button type="submit" className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="submit-contact-btn">
                {editing ? "Save Changes" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="shrink-0 -mx-4 px-4 pt-1 pb-3 bg-gray-50/95 backdrop-blur">
        {/* Prominent chip when filtering by a permission set (deep-link from Permission Sets tab) */}
        {psetFilter.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="contact-pset-chip-row">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Filtered by permission set:</span>
            {psetFilter.map((pid) => {
              const p = permissionSets.find((x) => x.id === pid);
              const label = p ? `#${p.numeric_id || p.seq_no || "?"} · ${p.title || p.name || "Untitled"}` : pid;
              return (
                <span
                  key={pid}
                  data-testid={`contact-pset-chip-${pid}`}
                  className="inline-flex items-center gap-1 rounded-full bg-[#ec9324]/10 border border-[#ec9324]/40 text-[#ec9324] px-3 py-1 text-xs font-semibold"
                >
                  {label}
                  <button
                    type="button"
                    onClick={() => {
                      const next = psetFilter.filter((x) => x !== pid);
                      setPsetFilter(next);
                      const sp = new URLSearchParams(searchParams);
                      if (next.length === 1) sp.set("permission_set", next[0]);
                      else sp.delete("permission_set");
                      setSearchParams(sp, { replace: true });
                    }}
                    className="rounded-full p-0.5 hover:bg-[#ec9324]/20"
                    aria-label="Remove filter"
                  ><X sx={{ fontSize: 11 }}/></button>
                </span>
              );
            })}
          </div>
        )}
        <div className="flex gap-3 flex-wrap items-center bg-white p-4 rounded-xl shadow-soft border border-gray-100" data-testid="contacts-filter-bar">
        <DeferredSearchInput
          className="flex-1 min-w-[240px]"
          placeholder="Search name or email..."
          testId="contact-search"
          value={q}
          onCommit={setQ}
        />
        <MultiSelectFilter
          label="Role"
          value={role}
          onChange={setRole}
          options={ALL_ROLE_FILTERS.map((r) => ({ value: r, label: r }))}
          testIdPrefix="contact-role-filter"
          className="w-48"
        />
        <MultiSelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "Active", label: "Active" },
            { value: "Inactive", label: "Inactive" },
          ]}
          testIdPrefix="contact-status-filter"
          className="w-40"
        />
        <MultiSelectFilter
          label="Permission Set"
          value={psetFilter}
          onChange={(v) => {
            setPsetFilter(v);
            // Keep the URL in sync so the deep-link is preserved / cleared
            const sp = new URLSearchParams(searchParams);
            if (v.length === 1) sp.set("permission_set", v[0]);
            else sp.delete("permission_set");
            setSearchParams(sp, { replace: true });
          }}
          options={permissionSets.map((p) => ({
            value: p.id,
            label: `#${p.numeric_id || p.seq_no || "?"} · ${p.title || p.name || "Untitled"}`,
          }))}
          testIdPrefix="contact-pset-filter"
          className="w-64"
        />
        </div>
      </div>

      <div className="mt-6 flex-1 min-h-0 flex flex-col bg-white rounded-xl shadow-soft border border-gray-100 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-3 text-left w-10">
                  <BulkSelectCheckbox checked={allSelected} onCheckedChange={(v) => toggleAll(!!v)} data-testid="select-all-employees" aria-label="Select all"/>
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-[#ec9324]" onClick={() => toggleSort("name")} data-testid="sort-name">
                  Name {sortBy === "name" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-[#ec9324]" onClick={() => toggleSort("emp_id")} data-testid="sort-emp-id">
                  Emp ID {sortBy === "emp_id" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-[#ec9324]" onClick={() => toggleSort("email")} data-testid="sort-email">
                  Email {sortBy === "email" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th className="px-4 py-3 text-left">Team</th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-[#ec9324]" onClick={() => toggleSort("doj")} data-testid="sort-doj">
                  DOJ {sortBy === "doj" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-[#ec9324]" onClick={() => toggleSort("role")} data-testid="sort-role">
                  Role {sortBy === "role" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th className="px-4 py-3 text-left">Permission Sets</th>
                <th className="px-4 py-3 text-left">Active</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className={`border-b border-gray-100 hover:bg-gray-50/80 ${selected.includes(c.id) ? "bg-[#ec9324]/5" : ""}`} data-testid={`contact-row-${c.email}`}>
                  <td className="px-3 py-3">
                    <BulkSelectCheckbox
                      checked={selected.includes(c.id)}
                      onCheckedChange={(v) => toggleOne(c.id, !!v)}
                      data-testid={`select-${c.email}`}
                      aria-label="Select row"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <button
                      type="button"
                      onClick={() => setDetailContact(c)}
                      data-testid={`contact-name-${c.email}`}
                      className="flex items-center gap-2.5 text-left hover:text-[#ec9324] focus:outline-none focus:text-[#ec9324] group"
                    >
                      <UserAvatar user={c} size={32} showStatusDot={false}/>
                      <span className="group-hover:underline">{c.name}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{c.emp_id || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.email}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.team_name ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: teamBackground(c.team_color) }} />
                        {c.team_name}
                      </span>
                    ) : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.doj || "-"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex text-xs font-semibold rounded-full px-2 py-1 bg-[#ec9324]/10 text-[#ec9324]">{c.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    {(c.permission_sets || []).length === 0 ? (
                      <span className="text-gray-300 text-xs">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1 max-w-[260px]">
                        {(c.permission_sets || []).slice(0, 2).map((p) => (
                          <span
                            key={p.id}
                            title={p.name}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-100 max-w-[120px] truncate"
                            data-testid={`row-pset-chip-${c.email}-${p.numeric_id}`}
                          >
                            <span className="font-mono text-blue-500">#{p.numeric_id}</span>
                            <span className="truncate">{p.name}</span>
                          </span>
                        ))}
                        {(c.permission_sets || []).length > 2 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                            +{(c.permission_sets || []).length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={c.status === "Active"}
                      onCheckedChange={() => toggleStatus(c)}
                      data-testid={`toggle-${c.email}`}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800"
                          data-testid={`row-actions-${c.email}`}
                          aria-label="Row actions"
                          title="Actions"
                        >
                          <MoreVertical sx={{ fontSize: 15 }}/>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() => setDetailContact(c)}
                          data-testid={`view-${c.email}`}
                        >
                          <Eye sx={{ fontSize: 13 }} className="mr-2 text-gray-500"/> View
                        </DropdownMenuItem>
                        {permEdit.isVisible && (
                          <DropdownMenuItem
                            onClick={() => openEdit(c)}
                            data-testid={`edit-${c.email}`}
                            disabled={!permEdit.canUse}
                          >
                            <Pencil sx={{ fontSize: 13 }} className="mr-2 text-gray-500"/> Edit
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && <tr><td colSpan={10} className="text-center py-10 text-gray-400">No employees</td></tr>}
            </tbody>
          </table>
        </div>
        {/* Pagination footer — sticks to viewport bottom when content is short */}
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          label="Employees"
          testIdPrefix="contacts-pg"
          className="mt-auto"
        />
      </div>

      <EmployeeDetailModal contact={detailContact} open={!!detailContact} onClose={() => setDetailContact(null)} />
      <BulkUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onComplete={() => load()}
      />
      <UploadHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
      {generated && (
        <GeneratedPasswordModal
          password={generated.password}
          email={generated.email}
          onClose={() => setGenerated(null)}
        />
      )}
    </Layout>
  );
}
