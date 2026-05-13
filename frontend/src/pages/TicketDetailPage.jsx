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
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { ArrowLeft, Paperclip, Calendar, User, Hash, Activity } from "lucide-react";

function fmt(iso) { if (!iso) return "-"; try { return new Date(iso).toLocaleString(); } catch { return iso; } }

export default function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [activity, setActivity] = useState([]);
  const [comments, setComments] = useState([]);
  const [members, setMembers] = useState([]);
  const [comment, setComment] = useState("");

  const load = async () => {
    const r = await api.get(`/tickets/${id}`); setTicket(r.data);
    const a = await api.get(`/tickets/${id}/activity`); setActivity(a.data);
    const c = await api.get(`/tickets/${id}/comments`); setComments(c.data);
  };
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    if (user?.type === "Admin") api.get("/contacts", { params: { type: "DQ Team" }}).then(r => setMembers(r.data));
  }, [user]);

  if (!ticket) return <Layout><div className="text-gray-400">Loading...</div></Layout>;

  const isAdmin = user.type === "Admin";
  const isDQ = user.type === "DQ Team";
  const canUpdateStatus = isAdmin || (isDQ && ticket.assigned_to_id === user.id);

  const update = async (body) => {
    try { await api.patch(`/tickets/${id}`, body); toast.success("Updated"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const postComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    await api.post(`/tickets/${id}/comments`, { content: comment });
    setComment(""); load();
  };

  return (
    <Layout>
      <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1 mb-4" data-testid="back-btn">
        <ArrowLeft size={14}/> Back
      </button>

      <div className="bg-white rounded-xl shadow-soft border border-gray-100 p-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight" data-testid="ticket-subject">{ticket.subject}</h1>
          <div className="text-xs font-mono text-[#ec9324] font-semibold mt-1" data-testid="ticket-id">{ticket.ticket_id}</div>
          <div className="mt-3 flex gap-2"><StatusBadge status={ticket.status}/><PriorityBadge priority={ticket.priority}/></div>
        </div>
          <div className="flex gap-2">
            {canUpdateStatus && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" data-testid="detail-status-btn">Update Status</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => update({ status: "Open" })}>Open</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => update({ status: "In Progress" })}>In Progress</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => update({ status: "Closed" })}>Closed</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="detail-assign-btn">
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
              <Button className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="detail-assign-me-btn"
                onClick={() => update({ assigned_to: user.id })}>Assign to Me</Button>
            )}
          </div>
        </div>

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
                  key={i}
                  href={`${api.defaults.baseURL}/files/${a.path}?auth=${localStorage.getItem("access_token") || ""}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 text-[#ec9324] font-medium hover:underline bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs"
                  data-testid={`attachment-link-${i}`}
                >
                  <Paperclip size={12}/> {a.filename || `Attachment ${i + 1}`}
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
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment..." data-testid="comment-input"/>
            <Button type="submit" className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="post-comment-btn">Post</Button>
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
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2"><Activity size={18}/> Activity</h2>
          <div className="space-y-3">
            {activity.length === 0 && <div className="text-sm text-gray-400">No activity yet.</div>}
            {activity.map((a) => (
              <div key={a.id} className="flex gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-[#ec9324] mt-2 flex-shrink-0"/>
                <div>
                  <div className="text-gray-800">{a.detail}</div>
                  <div className="text-xs text-gray-500">{a.by_name} · {fmt(a.at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
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
