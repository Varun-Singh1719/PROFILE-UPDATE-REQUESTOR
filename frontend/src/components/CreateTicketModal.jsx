import React, { useState, useEffect } from "react";
import api, { formatApiError } from "../lib/api";
import { Dialog, DialogContent } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import SingleSelect from "./SingleSelect";
import notify from "../lib/notify";
import { Upload, Loader2, X, Paperclip, Plus } from "lucide-react";

/**
 * CreateTicketModal — In-page popup to create a new ProfiX request.
 *
 * Mirrors the CreateTicketPage form (description, priority, due date, profile
 * count, multi-file attachments) but renders as a shadcn Dialog on top of the
 * current screen instead of a routed page.
 *
 * Props:
 *  - open (bool)             : dialog open state
 *  - onOpenChange(bool)      : setter fed to <Dialog>
 *  - onCreated(ticket)       : optional callback, fires after successful
 *                              creation so the caller can refresh its list
 *                              without any navigation happening.
 */
export default function CreateTicketModal({ open, onOpenChange, onCreated }) {
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [dueDate, setDueDate] = useState("");
  const [profiles, setProfiles] = useState("1");
  const [profilesError, setProfilesError] = useState("");
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  // Reset form each time the modal re-opens so old values don't linger.
  useEffect(() => {
    if (open) {
      setDescription("");
      setPriority("Medium");
      setDueDate("");
      setProfiles("1");
      setProfilesError("");
      setFiles([]);
      setLoading(false);
    }
  }, [open]);

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

  const removeFile = (idx) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const submit = async (e) => {
    e.preventDefault();
    if (!validateProfiles(profiles)) return;
    setLoading(true);
    try {
      const attachments = [];
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        const up = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        attachments.push({ path: up.data.path, filename: up.data.filename });
      }
      const first = attachments[0] || {};
      const r = await api.post("/tickets", {
        description,
        priority,
        due_date: dueDate || null,
        number_of_profiles: Number(profiles),
        attachment_path: first.path || null,
        attachment_name: first.filename || null,
        attachments,
      });
      notify.success(`Request ${r.data.ticket_id} created`);
      onOpenChange?.(false);
      onCreated?.(r.data);
    } catch (err) {
      notify.error(
        formatApiError(err?.response?.data?.detail) || "Failed to create"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl p-0 overflow-hidden bg-white"
        data-testid="new-request-modal"
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-900 font-semibold text-lg">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#ec9324]/10 text-[#ec9324]">
              <Plus size={18} />
            </span>
            Create New Request
          </div>
          <button
            type="button"
            onClick={() => onOpenChange?.(false)}
            className="text-gray-400 hover:text-gray-700 shrink-0"
            aria-label="Close"
            data-testid="new-request-modal-close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — form only */}
        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
          <form
            onSubmit={submit}
            className="space-y-5"
            data-testid="new-request-form"
          >
            <div>
              <Label htmlFor="mod-description">Description</Label>
              <Textarea
                id="mod-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="ticket-description-input"
                className="mt-1.5"
                rows={5}
                placeholder="Brief details about the request, expectations, profiles affected..."
              />
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
                <Label htmlFor="mod-due">Due Date</Label>
                <Input
                  id="mod-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  data-testid="ticket-due-date-input"
                  className="mt-1.5"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="mod-profiles">No. of Profiles *</Label>
              <Input
                id="mod-profiles"
                type="number"
                min="1"
                required
                value={profiles}
                onChange={(e) => {
                  setProfiles(e.target.value);
                  validateProfiles(e.target.value);
                }}
                onBlur={(e) => validateProfiles(e.target.value)}
                data-testid="ticket-profiles-input"
                className={`mt-1.5 ${
                  profilesError
                    ? "border-red-500 focus-visible:ring-red-500"
                    : ""
                }`}
              />
              {profilesError && (
                <div
                  className="mt-1 text-sm text-red-600"
                  data-testid="profiles-error"
                >
                  {profilesError}
                </div>
              )}
            </div>

            <div>
              <Label>Attachments</Label>
              <div className="mt-1.5 space-y-2">
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm text-gray-600 w-fit">
                  <Upload size={16} /> Add files
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFilesAdd}
                    data-testid="ticket-file-input"
                  />
                </label>
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {files.map((f, i) => (
                      <div
                        key={`${f.name}-${f.size}-${i}`}
                        className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700"
                        data-testid={`attached-file-${i}`}
                      >
                        <Paperclip size={12} className="text-[#ec9324]" />
                        <span className="max-w-[200px] truncate">
                          {f.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="text-gray-400 hover:text-red-500"
                          data-testid={`remove-file-${i}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-3 border-t border-gray-100">
              <Button
                type="submit"
                disabled={loading}
                data-testid="submit-ticket-btn"
                className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-10 px-5"
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={16} />{" "}
                    Creating...
                  </>
                ) : (
                  "Create Request"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange?.(false)}
                className="h-10 px-5"
                data-testid="cancel-new-request-btn"
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
