import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import SingleSelect from "../components/SingleSelect";
import notify from "../lib/notify";
import Upload from "@mui/icons-material/FileUploadOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import X from "@mui/icons-material/Close";
import Paperclip from "@mui/icons-material/AttachFile";
import Lightbulb from "@mui/icons-material/LightbulbOutlined";
import FileCheck2 from "@mui/icons-material/TaskAltOutlined";
import Users from "@mui/icons-material/PeopleOutlined";
import AlertCircle from "@mui/icons-material/ErrorOutlined";
import { useAuth } from "../context/AuthContext";

export default function CreateTicketPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [dueDate, setDueDate] = useState("");
  const [profiles, setProfiles] = useState("1");
  const [profilesError, setProfilesError] = useState("");
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  const validateProfiles = (val) => {
    if (val === "" || val === null || val === undefined) {
      setProfilesError("No. of Records is Blank");
      return false;
    }
    const n = Number(val);
    if (Number.isNaN(n)) {
      setProfilesError("No. of Records is Blank");
      return false;
    }
    if (n === 0) {
      setProfilesError("No. of Records cannot be 0");
      return false;
    }
    if (n < 0) {
      setProfilesError("No. of Records must be greater than 0");
      return false;
    }
    setProfilesError("");
    return true;
  };

  const handleFilesAdd = (e) => {
    const list = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...list]);
    e.target.value = "";
  };

  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const submit = async (e) => {
    e.preventDefault();
    if (!validateProfiles(profiles)) return;
    setLoading(true);
    try {
      // Upload all files
      const attachments = [];
      for (const f of files) {
        const fd = new FormData(); fd.append("file", f);
        const up = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" }});
        attachments.push({ path: up.data.path, filename: up.data.filename });
      }
      const first = attachments[0] || {};
      const r = await api.post("/tickets", {
        description, priority,
        due_date: dueDate || null,
        number_of_profiles: Number(profiles),
        attachment_path: first.path || null,
        attachment_name: first.filename || null,
        attachments,
      });
      notify.success(`Request ${r.data.ticket_id} created`);
      // v3 role model — everyone lands on the unified admin shell.
      navigate("/admin/open-tickets");
    } catch (e) {
      notify.error(formatApiError(e?.response?.data?.detail) || "Failed to create");
    } finally { setLoading(false); }
  };

  return (
    <Layout title="Create New Request">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5">
          <p className="text-sm text-gray-500 max-w-2xl">
            Give the data-quality team the essentials — a short description of what you need,
            how urgent it is, and how many profiles are affected. Attach any reference files
            that will help.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* ── Main form ─────────────────────────────────────────────── */}
          <form
            onSubmit={submit}
            className="lg:col-span-2 space-y-5 bg-white p-6 rounded-xl shadow-soft border border-gray-100"
            data-testid="new-request-form"
          >
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)}
                data-testid="ticket-description-input" className="mt-1.5" rows={5}
                placeholder="Brief details about the request, expectations, profiles affected..."/>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Priority *</Label>
                <div className="mt-1.5">
                  <SingleSelect
                    testId="ticket-priority-select"
                    options={[
                      { value: "High", label: "High" },
                      { value: "Medium", label: "Medium" },
                      { value: "Low", label: "Low" },
                    ]}
                    value={priority}
                    onChange={(v) => setPriority(v || "Medium")}
                    allowClear={false}
                    placeholder="Select priority"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="due">Due Date</Label>
                <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                  data-testid="ticket-due-date-input" className="mt-1.5" />
              </div>
            </div>
            <div>
              <Label htmlFor="profiles">No. of Profiles *</Label>
              <Input
                id="profiles" type="number" min="1" required value={profiles}
                onChange={(e) => { setProfiles(e.target.value); validateProfiles(e.target.value); }}
                onBlur={(e) => validateProfiles(e.target.value)}
                data-testid="ticket-profiles-input"
                className={`mt-1.5 ${profilesError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              />
              {profilesError && <div className="mt-1 text-sm text-red-600" data-testid="profiles-error">{profilesError}</div>}
            </div>
            <div>
              <Label>Attachments</Label>
              <div className="mt-1.5 space-y-2">
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm text-gray-600 w-fit">
                  <Upload sx={{ fontSize: 16 }}/> Add files
                  <input type="file" multiple className="hidden" onChange={handleFilesAdd} data-testid="ticket-file-input"/>
                </label>
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {files.map((f, i) => (
                      <div key={`${f.name}-${f.size}-${i}`} className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700" data-testid={`attached-file-${i}`}>
                        <Paperclip sx={{ fontSize: 12 }} className="text-[#ec9324]"/>
                        <span className="max-w-[200px] truncate">{f.name}</span>
                        <button type="button" onClick={() => removeFile(i)} className="text-gray-400 hover:text-red-500" data-testid={`remove-file-${i}`}>
                          <X sx={{ fontSize: 12 }}/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 pt-2 border-t border-gray-100 mt-2">
              <Button type="submit" disabled={loading} data-testid="submit-ticket-btn"
                className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-10 px-5">
                {loading ? <><Loader2 className="animate-spin mr-2" sx={{ fontSize: 16 }}/> Creating...</> : "Create Request"}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate(-1)} className="h-10 px-5">Cancel</Button>
            </div>
          </form>

          {/* ── Guidance side card ────────────────────────────────────── */}
          <aside className="space-y-4 lg:sticky lg:top-4">
            <div className="bg-white rounded-xl shadow-soft border border-gray-100 p-5">
              <div className="flex items-center gap-2 text-gray-900 font-semibold mb-3">
                <Lightbulb sx={{ fontSize: 16 }} className="text-[#ec9324]"/> Tips for a faster turnaround
              </div>
              <ul className="space-y-3 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <FileCheck2 sx={{ fontSize: 14 }} className="text-[#ec9324] mt-0.5 shrink-0"/>
                  <span>Be specific in the description — what to fix and the acceptance criteria.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Users sx={{ fontSize: 14 }} className="text-[#ec9324] mt-0.5 shrink-0"/>
                  <span>Set an accurate profile count so DQ can plan capacity correctly.</span>
                </li>
                <li className="flex items-start gap-2">
                  <AlertCircle sx={{ fontSize: 14 }} className="text-[#ec9324] mt-0.5 shrink-0"/>
                  <span>Use <span className="font-medium text-gray-800">High</span> priority only when the request is blocking downstream work.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Paperclip sx={{ fontSize: 14 }} className="text-[#ec9324] mt-0.5 shrink-0"/>
                  <span>Attach sample files, screenshots or CSVs when they clarify the ask.</span>
                </li>
              </ul>
            </div>

            <div className="bg-[#ec9324]/5 border border-[#ec9324]/20 rounded-xl p-4 text-sm text-gray-700">
              <div className="font-medium text-gray-900 mb-1">What happens next?</div>
              <p className="text-gray-600">
                Once submitted, your request goes to the Data Quality queue. You&apos;ll see it in
                <span className="font-medium text-gray-800"> My Requests</span> and get updates as
                the DQ team picks it up, works on it and closes it.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </Layout>
  );
}
