import React, { useState, useEffect } from "react";
import api, { formatApiError } from "../lib/api";
import { Dialog, DialogContent } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import SingleSelect from "./SingleSelect";
import notify from "../lib/notify";
import { numericId } from "../lib/ticketId";
import Upload from "@mui/icons-material/FileUploadOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import X from "@mui/icons-material/Close";
import Paperclip from "@mui/icons-material/AttachFile";
import Edit from "@mui/icons-material/Edit";
import CalendarIcon from "@mui/icons-material/CalendarTodayOutlined";

/**
 * EditTicketModal — Edit an existing ProfiX request.
 *
 * Mirrors CreateTicketModal but PATCHes the fields the user changed. Gated
 * server-side by `profix.ticket_detail.edit` + `max_editable_status`.
 *
 * Props:
 *  - open (bool)              : dialog open state
 *  - onOpenChange(bool)       : setter fed to <Dialog>
 *  - ticket (object|null)     : the ticket being edited; the modal populates
 *                               its fields from here when `open` flips true
 *  - onSaved(updatedTicket)   : called on success so caller can refresh list
 */
export default function EditTicketModal({ open, onOpenChange, ticket, onSaved }) {
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [dueDate, setDueDate] = useState("");
  const [profiles, setProfiles] = useState("1");
  const [profilesError, setProfilesError] = useState("");
  // existing attachments already on the ticket (from server); user can remove any.
  const [existingAttachments, setExistingAttachments] = useState([]);
  // newly-added files (not yet uploaded)
  const [newFiles, setNewFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  // Prefill on open
  useEffect(() => {
    if (open && ticket) {
      setDescription(ticket.description || "");
      setPriority(ticket.priority || "Medium");
      setDueDate(ticket.due_date || "");
      setProfiles(
        ticket.number_of_profiles === null || ticket.number_of_profiles === undefined
          ? "1"
          : String(ticket.number_of_profiles)
      );
      setProfilesError("");
      const atts =
        (ticket.attachments && ticket.attachments.length
          ? ticket.attachments
          : ticket.attachment_path
            ? [{ path: ticket.attachment_path, filename: ticket.attachment_name }]
            : []) || [];
      setExistingAttachments(atts);
      setNewFiles([]);
      setLoading(false);
    }
  }, [open, ticket]);

  const validateProfiles = (val) => {
    if (val === "" || val === null || val === undefined) {
      setProfilesError("No. of Records is Blank"); return false;
    }
    const n = Number(val);
    if (Number.isNaN(n)) { setProfilesError("No. of Records is Blank"); return false; }
    if (n === 0)  { setProfilesError("No. of Records cannot be 0"); return false; }
    if (n < 0)    { setProfilesError("No. of Records must be greater than 0"); return false; }
    setProfilesError(""); return true;
  };

  const handleFilesAdd = (e) => {
    const list = Array.from(e.target.files || []);
    setNewFiles((prev) => [...prev, ...list]);
    e.target.value = "";
  };
  const removeNewFile = (idx) => setNewFiles((prev) => prev.filter((_, i) => i !== idx));
  const removeExistingAttachment = (idx) =>
    setExistingAttachments((prev) => prev.filter((_, i) => i !== idx));

  const submit = async (e) => {
    e.preventDefault();
    if (!ticket) return;
    if (!validateProfiles(profiles)) return;
    setLoading(true);
    try {
      // Upload each new file, then combine with the existing attachments we kept.
      const uploaded = [];
      for (const f of newFiles) {
        const fd = new FormData();
        fd.append("file", f);
        const up = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        uploaded.push({ path: up.data.path, filename: up.data.filename });
      }
      const attachments = [...existingAttachments, ...uploaded];

      // Send only fields whose value has changed (keeps PATCH surgical).
      const payload = {};
      if ((description || "") !== (ticket.description || "")) payload.description = description;
      if (priority !== ticket.priority) payload.priority = priority;
      if ((dueDate || null) !== (ticket.due_date || null)) payload.due_date = dueDate || null;
      if (Number(profiles) !== ticket.number_of_profiles) payload.number_of_profiles = Number(profiles);
      // Attachments — send if anything was added, removed, or reordered.
      const beforeKey = JSON.stringify((ticket.attachments || []).map((a) => a.path));
      const afterKey = JSON.stringify(attachments.map((a) => a.path));
      if (beforeKey !== afterKey) payload.attachments = attachments;

      if (Object.keys(payload).length === 0) {
        notify.info("No changes to save");
        onOpenChange?.(false);
        return;
      }
      const r = await api.patch(`/tickets/${ticket.id}`, payload);
      notify.success(`Request ${numericId(ticket.ticket_id)} updated`);
      onOpenChange?.(false);
      onSaved?.(r.data);
    } catch (err) {
      notify.error(formatApiError(err?.response?.data?.detail) || "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl p-0 overflow-hidden bg-white"
        data-testid="edit-request-modal"
      >
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-900 font-semibold text-lg">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#ec9324]/10 text-[#ec9324]">
              <Edit sx={{ fontSize: 18 }}/>
            </span>
            Edit Request {ticket ? numericId(ticket.ticket_id) : ""}
          </div>
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
          <form onSubmit={submit} className="space-y-5" data-testid="edit-request-form">
            <div>
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="edit-description-input"
                className="mt-1.5"
                rows={5}
                placeholder="Brief details about the request..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Priority *</Label>
                <div className="mt-1.5">
                  <SingleSelect
                    testId="edit-priority-select"
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
                <Label htmlFor="edit-due">Due Date</Label>
                <div className="relative mt-1.5">
                  <Input
                    id="edit-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    data-testid="edit-due-date-input"
                    className="pr-9 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                  <CalendarIcon sx={{ fontSize: 16 }} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"/>
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="edit-profiles">No. of Records *</Label>
              <Input
                id="edit-profiles"
                type="number"
                min="1"
                required
                value={profiles}
                onChange={(e) => { setProfiles(e.target.value); validateProfiles(e.target.value); }}
                onBlur={(e) => validateProfiles(e.target.value)}
                data-testid="edit-profiles-input"
                className={`mt-1.5 ${profilesError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              />
              {profilesError && (
                <div className="mt-1 text-sm text-red-600" data-testid="edit-profiles-error">
                  {profilesError}
                </div>
              )}
            </div>

            <div>
              <Label>Attachments</Label>
              <div className="mt-1.5 space-y-2">
                {/* Existing attachments (from the server) */}
                {existingAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {existingAttachments.map((a, i) => (
                      <div
                        key={`ex-${a.path || i}`}
                        className="inline-flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 text-xs text-gray-700"
                        data-testid={`edit-existing-attachment-${i}`}
                      >
                        <Paperclip sx={{ fontSize: 12 }} className="text-[#ec9324]"/>
                        <span className="max-w-[220px] truncate">{a.filename || `Attachment ${i + 1}`}</span>
                        <button
                          type="button"
                          onClick={() => removeExistingAttachment(i)}
                          className="text-gray-400 hover:text-red-500"
                          data-testid={`edit-remove-existing-${i}`}
                          title="Remove attachment"
                        >
                          <X sx={{ fontSize: 12 }}/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm text-gray-600 w-fit">
                  <Upload sx={{ fontSize: 16 }}/> Add files
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFilesAdd}
                    data-testid="edit-file-input"
                  />
                </label>
                {newFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {newFiles.map((f, i) => (
                      <div
                        key={`${f.name}-${f.size}-${i}`}
                        className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700"
                        data-testid={`edit-new-file-${i}`}
                      >
                        <Paperclip sx={{ fontSize: 12 }} className="text-[#ec9324]"/>
                        <span className="max-w-[220px] truncate">{f.name}</span>
                        <button
                          type="button"
                          onClick={() => removeNewFile(i)}
                          className="text-gray-400 hover:text-red-500"
                          data-testid={`edit-remove-new-${i}`}
                        >
                          <X sx={{ fontSize: 12 }}/>
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
                data-testid="save-edit-btn"
                className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-10 px-5"
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin mr-2" sx={{ fontSize: 16 }}/>
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange?.(false)}
                className="h-10 px-5"
                data-testid="cancel-edit-btn"
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
