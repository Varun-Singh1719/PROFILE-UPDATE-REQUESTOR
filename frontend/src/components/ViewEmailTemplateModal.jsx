/**
 * ViewEmailTemplateModal — pixel-perfect email preview.
 *
 * Renders the template exactly as the recipient would receive it, wrapping
 * the sanitised HTML body in a lightweight email chrome (From / To / Subject
 * header + branded footer). All Handlebars-style placeholders (`{{name}}`)
 * are replaced with sample values so the output is truly a rendered preview.
 *
 * Props:
 *   open, onOpenChange, template, onEdit, canEdit
 */
import React, { useMemo } from "react";
import DOMPurify from "dompurify";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Pencil, Mail } from "lucide-react";

/* ── Sample values for every known placeholder used across templates.
 *    Missing keys fall back to a friendly stand-in so unfamiliar templates
 *    still render without leftover `{{foo}}` text. ─── */
const SAMPLE_VALUES = {
  name: "XYZ",
  attendee_name: "XYZ",
  requested_by: "XYZ",
  organizer_name: "XYZ Manager",
  organizer_team: "TechKnights",
  closed_by: "Admin User",

  email: "xyz@example.com",
  password: "TempPass@123",
  login_url: "https://ticketing.infollion.com/login",
  reset_link: "https://ticketing.infollion.com/reset?token=abc123",
  booking_url: "https://ticketing.infollion.com/bookings",
  workspace_url: "https://ticketing.infollion.com/workspace",

  ticket_id: "TKT-1234",
  subject: "Sample Request Subject",
  closed_at: "16 Jul 2026, 02:30 PM",

  requested_on: "16 Jul 2026",
  requested_for_date: "20 Jul 2026",
  plan_name: "Floor 1 — Zone A",
  seat_labels: "A1, A2",

  room_name: "Meeting Room A",
  meeting_title: "Weekly Sync",
  meeting_date: "20 Jul 2026",
  start_time: "10:00 AM",
  end_time: "11:00 AM",
};

const fallback = (key) => {
  // Human-friendly stand-in for anything we haven't mapped explicitly.
  const words = String(key).replace(/[_-]+/g, " ").trim();
  return `Sample ${words}`;
};

function substitutePlaceholders(str) {
  if (!str) return "";
  return String(str).replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(SAMPLE_VALUES, key)) {
      return SAMPLE_VALUES[key];
    }
    return fallback(key);
  });
}

/* Prettifies the `kind` slug into a readable label for the "From" line. */
function templateSenderName(tpl) {
  if (!tpl) return "Infollion";
  if (tpl.kind?.startsWith("meeting_")) return "Infollion Workspace";
  if (tpl.kind?.startsWith("workstation_")) return "Infollion Workspace";
  if (tpl.kind === "request_closed") return "Infollion ProfiX";
  return "Infollion Admin";
}

function displayFromAddress(tpl) {
  const from = (tpl?.from_email || "").trim();
  if (!from || from === "TBD") return "no-reply@infollion.com";
  return from;
}

export default function ViewEmailTemplateModal({
  open, onOpenChange, template, onEdit, canEdit = true,
}) {
  const rendered = useMemo(() => {
    if (!template) return { subject: "", body: "" };
    return {
      subject: substitutePlaceholders(template.subject || ""),
      body: DOMPurify.sanitize(substitutePlaceholders(template.body || "")),
    };
  }, [template]);

  const senderName = templateSenderName(template);
  const fromAddr = displayFromAddress(template);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl p-0 gap-0 overflow-hidden bg-white"
        data-testid="view-email-template-modal"
      >
        {/* Modal chrome */}
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-gray-200 bg-gray-50/60">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <DialogTitle className="flex items-center gap-2 text-base font-semibold text-gray-900">
                <Mail size={16} className="text-[#ec9324]" />
                <span className="truncate" data-testid="view-tpl-title">
                  {template?.name || "Email Template"}
                </span>
                {template?.system && !template?.local && (
                  <span className="inline-flex text-[10px] font-semibold bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
                    SYSTEM
                  </span>
                )}
                {template?.local && (
                  <span className="inline-flex text-[10px] font-semibold bg-orange-50 border border-orange-200 text-[#ec9324] rounded px-1.5 py-0.5">
                    MEETING
                  </span>
                )}
              </DialogTitle>
              <div className="text-[11px] text-gray-500 mt-1">
                Kind <code className="px-1 bg-gray-100 rounded">{template?.kind}</code>
                {" · "}Category {template?.category}
                {" · "}Status {template?.status}
              </div>
            </div>
            {canEdit && (
              <Button
                size="sm"
                onClick={() => template && onEdit?.(template)}
                className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-8"
                data-testid="view-tpl-edit-btn"
              >
                <Pencil size={14} className="mr-1.5" /> Edit
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Email preview area */}
        <div className="max-h-[75vh] overflow-y-auto bg-gray-100 p-6">
          <div className="mx-auto max-w-[640px] bg-white rounded-lg shadow-md ring-1 ring-gray-200 overflow-hidden">
            {/* Email header — mimics a typical client's message header */}
            <div className="border-b border-gray-200 bg-white px-5 py-4">
              <div className="text-[13px] leading-snug space-y-1">
                <div className="flex gap-2">
                  <span className="w-14 shrink-0 font-semibold text-gray-500 uppercase tracking-wider text-[10px] pt-0.5">
                    From
                  </span>
                  <span className="text-gray-900">
                    <span className="font-medium">{senderName}</span>{" "}
                    <span className="text-gray-500">&lt;{fromAddr}&gt;</span>
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="w-14 shrink-0 font-semibold text-gray-500 uppercase tracking-wider text-[10px] pt-0.5">
                    To
                  </span>
                  <span className="text-gray-900">
                    <span className="font-medium">{SAMPLE_VALUES.name}</span>{" "}
                    <span className="text-gray-500">&lt;{SAMPLE_VALUES.email}&gt;</span>
                  </span>
                </div>
                <div className="flex gap-2 pt-1 border-t border-gray-100 mt-1">
                  <span className="w-14 shrink-0 font-semibold text-gray-500 uppercase tracking-wider text-[10px] pt-1">
                    Subject
                  </span>
                  <span className="text-gray-900 font-semibold pt-0.5" data-testid="view-tpl-subject">
                    {rendered.subject || <span className="italic text-gray-400">(no subject)</span>}
                  </span>
                </div>
              </div>
            </div>

            {/* Branded header strip */}
            <div
              className="px-6 py-4 border-b border-orange-200"
              style={{
                background: "linear-gradient(135deg, #ec9324 0%, #f59e0b 100%)",
              }}
            >
              <div className="flex items-center gap-2 text-white">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center ring-1 ring-white/30 backdrop-blur-sm">
                  <span className="text-white font-extrabold text-sm">i</span>
                </div>
                <div>
                  <div className="text-white font-bold text-sm tracking-wide">
                    Infollion Utilities
                  </div>
                  <div className="text-white/80 text-[10px] uppercase tracking-wider">
                    {template?.kind?.startsWith("meeting_") ? "Workspace" : "Notifications"}
                  </div>
                </div>
              </div>
            </div>

            {/* Email body */}
            <div
              className="px-8 py-6 text-sm text-gray-800 leading-relaxed email-preview-body"
              data-testid="view-tpl-body"
              dangerouslySetInnerHTML={{ __html: rendered.body }}
            />

            {/* Branded footer */}
            <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 text-center">
              <div className="text-[11px] text-gray-600 mb-1">
                You&apos;re receiving this email because your address is registered on Infollion Utilities.
              </div>
              <div className="text-[10px] text-gray-400">
                © {new Date().getFullYear()} Infollion Utilities ·
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="text-[#ec9324] hover:underline ml-1"
                >
                  Preferences
                </a>
                <span className="mx-1">·</span>
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="text-[#ec9324] hover:underline"
                >
                  Unsubscribe
                </a>
              </div>
            </div>
          </div>

          {/* Legend — helpful nudge for admins */}
          <div className="mx-auto max-w-[640px] mt-3 text-[10px] text-gray-500 text-center">
            Preview uses sample values for placeholders (e.g. <code className="px-1 bg-white rounded border border-gray-200">{`{{name}}`}</code> → <span className="text-gray-700 font-medium">XYZ</span>). Recipients see their real values.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
