import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../lib/api";
import Layout from "../components/Layout";
import { StatusBadge, PriorityBadge } from "../components/Badges";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "../components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";
import notify from "../lib/notify";
import { useAuth } from "../context/AuthContext";
import { useEffectivePage } from "../context/EffectivePermissionsContext";
import { numericId } from "../lib/ticketId";
import ArrowLeft from "@mui/icons-material/ArrowBack";
import Paperclip from "@mui/icons-material/AttachFile";
import Calendar from "@mui/icons-material/CalendarTodayOutlined";
import User from "@mui/icons-material/PersonOutlined";
import Hash from "@mui/icons-material/TagOutlined";
import Activity from "@mui/icons-material/Timeline";
import RefreshIcon from "@mui/icons-material/Refresh";

function fmt(iso) { if (!iso) return "-"; try { return new Date(iso).toLocaleString(); } catch { return iso; } }

export default function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // ── Permissions V3 (Round 3) ──
  const { fn: permFn } = useEffectivePage("profix", "ticket_detail");
  const permChangeStatus = permFn("change_status");
  const permAssign       = permFn("assign");
  const permComment      = permFn("add_comment");
  const permEdit         = permFn("edit");
  const permDelete       = permFn("delete");
  const [ticket, setTicket] = useState(null);
  const [activity, setActivity] = useState([]);
  const [comments, setComments] = useState([]);
  const [members, setMembers] = useState([]);
  const [comment, setComment] = useState("");
  // Reopen dialog state
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenSubmitting, setReopenSubmitting] = useState(false);

  const load = async () => {
    const r = await api.get(`/tickets/${id}`); setTicket(r.data);
    const a = await api.get(`/tickets/${id}/activity`); setActivity(a.data);
    const c = await api.get(`/tickets/${id}/comments`); setComments(c.data);
  };
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    // v3 role model — Super Admin/Admin can fetch the assignee list.
    if (user?.role === "Super Admin" || user?.role === "Admin") api.get("/contacts", { params: { role: "Admin" }}).then(r => setMembers(r.data));
  }, [user]);

  if (!ticket) return <Layout><div className="text-gray-400">Loading...</div></Layout>;

  // v3 role model: Super Admin and Admin both have admin-level ticket access.
  const isAdmin = user.role === "Super Admin" || user.role === "Admin";
  const isDQ = false; // Role 'DQ Team' no longer exists post-v3 collapse.
  const canUpdateStatus = isAdmin || (isDQ && ticket.assigned_to_id === user.id);

  const update = async (body) => {
    try { await api.patch(`/tickets/${id}`, body); notify.success("Updated"); load(); }
    catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const postComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    await api.post(`/tickets/${id}/comments`, { content: comment });
    setComment(""); load();
  };

  // ── Reopen flow ─────────────────────────────────────────────
  // Visible when the ticket is Closed AND the viewer is the creator OR an admin.
  const isCreator = ticket && user && ticket.created_by_id === user.id;
  const canReopen = ticket?.status === "Closed" && (isCreator || isAdmin);
  const reopenReasonTrimmed = reopenReason.trim();
  const reopenReasonValid = reopenReasonTrimmed.length >= 5 && reopenReasonTrimmed.length <= 500;

  const openReopenDialog = () => {
    setReopenReason("");
    setReopenOpen(true);
  };

  const confirmReopen = async () => {
    if (!reopenReasonValid || reopenSubmitting) return;
    setReopenSubmitting(true);
    try {
      await api.post(`/tickets/${id}/reopen`, { reason: reopenReasonTrimmed });
      notify.success("Request reopened");
      setReopenOpen(false);
      setReopenReason("");
      load();
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Failed to reopen request");
    } finally {
      setReopenSubmitting(false);
    }
  };

  return (
    <Layout
      title={`Request ${numericId(ticket.ticket_id)}`}
      actions={
        <div className="flex gap-2">
          {canReopen && (
            <Button
              onClick={openReopenDialog}
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9 flex items-center gap-1.5"
              data-testid="detail-reopen-btn"
            >
              <RefreshIcon sx={{ fontSize: 16 }}/> Reopen Request
            </Button>
          )}
          {canUpdateStatus && permChangeStatus.isVisible && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" data-testid="detail-status-btn" className="h-9" disabled={!permChangeStatus.canUse}>Update Status</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => update({ status: "Open" })}>Open</DropdownMenuItem>
                <DropdownMenuItem onClick={() => update({ status: "In Progress" })}>In Progress</DropdownMenuItem>
                <DropdownMenuItem onClick={() => update({ status: "Closed" })}>Closed</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isAdmin && permAssign.isVisible && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9" data-testid="detail-assign-btn" disabled={!permAssign.canUse}>
                  {ticket.assigned_to_id ? "Reassign" : "Assign"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {members.map(m => (
                  <DropdownMenuItem key={m.id} onClick={() => update({ assigned_to: m.id })}>{m.name}</DropdownMenuItem>
                ))}
                {ticket.assigned_to_id && <DropdownMenuItem onClick={() => update({ assigned_to: "" })}>Unassign</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isDQ && !ticket.assigned_to_id && (
            <Button className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9" data-testid="detail-assign-me-btn"
              onClick={() => update({ assigned_to: user.id })}>Assign to Me</Button>
          )}
        </div>
      }
    >
      <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1 mb-4" data-testid="back-btn">
        <ArrowLeft sx={{ fontSize: 14 }}/> Back
      </button>

      <div className="bg-white rounded-xl shadow-soft border border-gray-100 p-6">
        <div className="flex gap-2 mb-2" data-testid="ticket-id">
          <span className="text-xs font-mono text-[#ec9324] font-semibold">{numericId(ticket.ticket_id)}</span>
        </div>
        <div className="flex gap-2"><StatusBadge status={ticket.status}/><PriorityBadge priority={ticket.priority}/></div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8 text-sm">
          <Field label="Created By" icon={User} value={ticket.created_by_name}/>
          <Field label="Assigned To" icon={User} value={ticket.assigned_to_name || "Unassigned"}/>
          <Field label="Due Date" icon={Calendar} value={ticket.due_date || "-"}/>
          <Field label="No. of Records" icon={Hash} value={ticket.number_of_profiles}/>
          <Field label="Created On" icon={Calendar} value={fmt(ticket.created_on)}/>
          <Field label="Updated On" icon={Calendar} value={fmt(ticket.updated_on)}/>
        </div>

        {ticket.description && (
          <div className="mt-6 p-4 rounded-lg border border-gray-100 bg-gray-50/50">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">Description</div>
            <div className="text-sm text-gray-800 whitespace-pre-wrap" data-testid="ticket-description">{ticket.description}</div>
          </div>
        )}

        {(ticket.attachments?.length > 0 || ticket.attachment_path) && (
          <div className="mt-6 p-4 rounded-lg border border-gray-200 bg-gray-50">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">Attachments</div>
            <div className="flex flex-wrap gap-2">
              {(ticket.attachments?.length ? ticket.attachments : [{ path: ticket.attachment_path, filename: ticket.attachment_name }]).map((a, i) => a?.path && (
                <a
                  key={a.path || `att-${i}`}
                  href={`${api.defaults.baseURL}/files/${a.path}?auth=${localStorage.getItem("access_token") || ""}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 text-[#ec9324] font-medium hover:underline bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs"
                  data-testid={`attachment-link-${i}`}
                >
                  <Paperclip sx={{ fontSize: 12 }}/> {a.filename || `Attachment ${i + 1}`}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="bg-white rounded-xl shadow-soft border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Comments</h2>
          <form onSubmit={postComment} className="space-y-2">
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment..." data-testid="comment-input" disabled={!permComment.canUse}/>
            {permComment.isVisible && (
              <Button type="submit" className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="post-comment-btn" disabled={!permComment.canUse}>Post</Button>
            )}
          </form>
          <div className="mt-6 space-y-3">
            {comments.length === 0 && <div className="text-sm text-gray-400">No comments yet.</div>}
            {comments.map((c) => (
              <div key={c.id} className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <div className="text-xs text-gray-500 flex justify-between"><span className="font-medium text-gray-700">{c.by_name}</span><span>{fmt(c.at)}</span></div>
                <div className="mt-1 text-sm text-gray-800">{c.content}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-soft border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2"><Activity sx={{ fontSize: 18 }}/> Activity</h2>
          <div className="space-y-3">
            {activity.length === 0 && <div className="text-sm text-gray-400">No activity yet.</div>}
            {activity.map((a) => (
              <div key={a.id} className="flex gap-3 text-sm">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${a.action === "reopened" ? "bg-emerald-500" : "bg-[#ec9324]"}`}/>
                <div>
                  <div className="text-gray-800">{a.detail}</div>
                  <div className="text-xs text-gray-500">{a.by_name} · {fmt(a.at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Reopen Request Dialog */}
      <Dialog open={reopenOpen} onOpenChange={(v) => { if (!reopenSubmitting) setReopenOpen(v); }}>
        <DialogContent className="max-w-md" data-testid="reopen-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshIcon sx={{ fontSize: 20 }} className="text-[#ec9324]"/> Reopen Request
            </DialogTitle>
            <DialogDescription>
              This request will move back to <span className="font-medium">Open</span> and the team will be notified through the activity log. Please share why it needs to be reopened.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-600">
              Reason <span className="text-red-500">*</span>
            </label>
            <Textarea
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Describe why this request needs to be reopened (minimum 5 characters)"
              rows={4}
              maxLength={500}
              data-testid="reopen-reason-input"
              disabled={reopenSubmitting}
            />
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>
                {reopenReasonTrimmed.length < 5
                  ? `At least ${5 - reopenReasonTrimmed.length} more character${5 - reopenReasonTrimmed.length === 1 ? "" : "s"} required`
                  : "Looks good."}
              </span>
              <span>{reopenReasonTrimmed.length}/500</span>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setReopenOpen(false)}
              disabled={reopenSubmitting}
              data-testid="reopen-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmReopen}
              disabled={!reopenReasonValid || reopenSubmitting}
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
              data-testid="reopen-confirm-btn"
            >
              {reopenSubmitting ? "Reopening..." : "Reopen Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function Field({ label, value, icon: Icon }) {
  return (
    <div className="p-3 rounded-lg border border-gray-100 bg-gray-50/50">
      <div className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1"><Icon size={12}/> {label}</div>
      <div className="mt-1 text-sm font-medium text-gray-900">{value ?? "-"}</div>
    </div>
  );
}
