import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function CreateTicketPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [dueDate, setDueDate] = useState("");
  const [profiles, setProfiles] = useState(0);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      let attachment_path = null, attachment_name = null;
      if (file) {
        const fd = new FormData(); fd.append("file", file);
        const up = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" }});
        attachment_path = up.data.path; attachment_name = up.data.filename;
      }
      const r = await api.post("/tickets", {
        subject, description, priority, due_date: dueDate || null,
        number_of_profiles: Number(profiles) || 0,
        attachment_path, attachment_name
      });
      toast.success(`Request ${r.data.ticket_id} created`);
      const dest = user?.type === "Admin" ? "/admin/open-tickets" : "/ra/tickets";
      navigate(dest);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Failed to create");
    } finally { setLoading(false); }
  };

  return (
    <Layout>
      <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Create New Request</h1>
      <p className="text-gray-500 mt-1">Provide request details below.</p>
      <form onSubmit={submit} className="mt-8 max-w-2xl space-y-5 bg-white p-6 rounded-xl shadow-soft border border-gray-100">
        <div>
          <Label htmlFor="subject">Subject *</Label>
          <Input id="subject" required value={subject} onChange={(e) => setSubject(e.target.value)}
            data-testid="ticket-subject-input" className="mt-1.5" placeholder="e.g. Expert Profile Not Updated"/>
        </div>
        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)}
            data-testid="ticket-description-input" className="mt-1.5" rows={4}
            placeholder="Brief details about the request, expectations, profiles affected..."/>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Priority *</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger data-testid="ticket-priority-select" className="mt-1.5"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="High">High</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="due">Due Date</Label>
            <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              data-testid="ticket-due-date-input" className="mt-1.5" />
          </div>
        </div>
        <div>
          <Label htmlFor="profiles">Number of Profiles</Label>
          <Input id="profiles" type="number" min="0" value={profiles}
            onChange={(e) => setProfiles(e.target.value)} data-testid="ticket-profiles-input" className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="file">Attachment</Label>
          <div className="mt-1.5 flex items-center gap-3">
            <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm text-gray-600">
              <Upload size={16}/> {file ? file.name : "Choose file"}
              <input id="file" type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0])} data-testid="ticket-file-input"/>
            </label>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={loading} data-testid="submit-ticket-btn"
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white">
            {loading ? <><Loader2 className="animate-spin mr-2" size={16}/> Creating...</> : "Create Request"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>
    </Layout>
  );
}
