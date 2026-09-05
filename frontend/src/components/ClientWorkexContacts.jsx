import React, { useCallback, useEffect, useMemo, useState } from "react";
import api, { formatApiError } from "../lib/api";
import Plus from "@mui/icons-material/AddOutlined";
import Upload from "@mui/icons-material/UploadFileOutlined";
import {
  ClientContactDetailModal,
  AddContactDialog,
  BulkUploadModal,
} from "../pages/ClientContactsPage";

/**
 * Client Detail → "Client Contacts" tab.
 * Lists every client contact that has THIS client mapped in their work
 * experience, split into two sub-tabs:
 *   • Current — currently working at this client (client_name matches)
 *   • Ex      — worked here in the past (present in previous_work_experience)
 *
 * Clicking a contact opens the full detail view in a popup (no page redirect).
 */
function initials(name) {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function SubTab({ active, label, count, onClick, testId }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={
        "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold transition-colors " +
        (active
          ? "bg-[#ec9324] text-white shadow-sm"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200")
      }
    >
      {label}
      <span
        className={
          "inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold " +
          (active ? "bg-white/25 text-white" : "bg-white text-gray-500 border border-gray-200")
        }
      >
        {count}
      </span>
    </button>
  );
}

function IconAction({ icon, tooltip, onClick, testId, primary = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-label={tooltip}
      className={
        "group relative inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors " +
        (primary
          ? "bg-[#ec9324] border-[#ec9324] text-white hover:bg-[#d3811b]"
          : "bg-white border-gray-300 text-gray-600 hover:border-[#ec9324] hover:text-[#ec9324]")
      }
    >
      {icon}
      <span className="pointer-events-none absolute top-full right-0 mt-1.5 px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
        {tooltip}
      </span>
    </button>
  );
}

function fmtMini(v, money = false) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (money) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    if (Math.abs(n) >= 10_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
    return `$${n.toLocaleString()}`;
  }
  return n.toLocaleString();
}

function ContactMiniCard({ c, ex, onOpen }) {
  const exp = c.ex_experience || {};
  const location = [c.city, c.country_name].filter(Boolean).join(", ") || c.base_location || "";
  return (
    <button
      type="button"
      onClick={() => onOpen(c.id)}
      data-testid={`workex-contact-${c.display_id}`}
      className="text-left w-full block bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:shadow-md hover:border-[#ec9324]/50 transition"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={
              "w-11 h-11 rounded-full grid place-items-center text-white font-bold text-sm flex-shrink-0 " +
              (ex ? "bg-gray-400" : "")
            }
            style={ex ? {} : { background: "linear-gradient(135deg,#f0a84a,#ec9324)" }}
          >
            {initials(c.name)}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-gray-900 truncate">{c.name}</div>
            <div className="text-[12px] text-gray-500 truncate">
              {ex ? (exp.designation || c.designation || "—") : (c.designation || "—")}
            </div>
            <div className="text-[11px] text-gray-400">ID: {c.display_id}</div>
          </div>
        </div>
        {ex ? (
          <span className="inline-flex items-center h-5 px-2 rounded-full bg-gray-500 text-white text-[10px] font-bold flex-shrink-0">
            FORMER
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Current
          </span>
        )}
      </div>

      <div className="mt-3 space-y-1 text-[13px]">
        <div className="flex">
          <span className="w-24 text-gray-500 flex-shrink-0">Type</span>
          <span className="text-gray-900 font-medium truncate">{c.type || "—"}</span>
        </div>
        {ex ? (
          <>
            <div className="flex">
              <span className="w-24 text-gray-500 flex-shrink-0">Tenure here</span>
              <span className="text-gray-900 font-medium truncate">
                {(exp.start_month_year || "—") + " – " + (exp.end_month_year || "—")}
              </span>
            </div>
            <div className="flex">
              <span className="w-24 text-gray-500 flex-shrink-0">Now at</span>
              <span className="text-gray-900 font-medium truncate">{c.current_client || "—"}</span>
            </div>
          </>
        ) : (
          <div className="flex">
            <span className="w-24 text-gray-500 flex-shrink-0">Location</span>
            <span className="text-gray-900 font-medium truncate">{location || "—"}</span>
          </div>
        )}
      </div>

      {/* Numbers — same as the Client Contact card view (totals_till_date) */}
      <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-4 gap-1 text-center" data-testid={`workex-contact-metrics-${c.display_id}`}>
        {[
          ["Projects", fmtMini(c.totals_till_date?.projects)],
          ["Serviced", fmtMini(c.totals_till_date?.serviced)],
          ["Calls", fmtMini(c.totals_till_date?.calls)],
          ["Revenue", fmtMini(c.totals_till_date?.revenue, true)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="text-[15px] font-bold text-[#ec9324] leading-tight tabular-nums">{value}</div>
            <div className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold truncate">{label}</div>
          </div>
        ))}
      </div>

      {ex && (
        <div className="mt-3 pt-2 border-t border-gray-100">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M7 16H3m0 0 4-4m-4 4 4 4" />
              <path d="M17 8h4m0 0-4-4m4 4-4 4" />
            </svg>
            Previously worked here
          </span>
        </div>
      )}
    </button>
  );
}

export default function ClientWorkexContacts({ clientId, clientName }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [subTab, setSubTab] = useState("current");

  // Detail popup + create/bulk-upload dialogs
  const [openContactId, setOpenContactId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await api.get(`/clients/${clientId}/contacts`);
      setData(r.data);
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const list = useMemo(() => {
    if (!data) return [];
    return subTab === "current" ? data.current || [] : data.ex || [];
  }, [data, subTab]);

  const currentCount = data?.current_count ?? 0;
  const exCount = data?.ex_count ?? 0;

  // Order used by the detail pop-up's trackpad swipe / arrow-key navigation:
  // exactly the cards of the ACTIVE sub-tab (Current / Ex), in the order
  // shown on screen. Names feed the faint "peek" chips at the pop-up edges.
  const navItems = useMemo(() => list.map((c) => ({ id: c.id, name: c.name })), [list]);

  return (
    <div>
      {/* Sub-tabs + action buttons */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2" role="tablist">
          <SubTab
            active={subTab === "current"}
            label="Current"
            count={currentCount}
            onClick={() => setSubTab("current")}
            testId="workex-subtab-current"
          />
          <SubTab
            active={subTab === "ex"}
            label="Ex"
            count={exCount}
            onClick={() => setSubTab("ex")}
            testId="workex-subtab-ex"
          />
          <span className="ml-2 text-[12px] text-gray-400 hidden md:inline">
            {subTab === "current"
              ? `People currently at ${clientName}`
              : `People who previously worked at ${clientName}`}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <IconAction
            icon={<Plus sx={{ fontSize: 20 }} />}
            tooltip="+ New Client Contact"
            onClick={() => setAddOpen(true)}
            testId="workex-add-contact-btn"
            primary
          />
          <IconAction
            icon={<Upload sx={{ fontSize: 18 }} />}
            tooltip="Bulk Upload Client Contacts"
            onClick={() => setBulkOpen(true)}
            testId="workex-bulk-upload-btn"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-sm text-gray-500">Loading contacts…</div>
      ) : err ? (
        <div className="text-center py-16 text-sm text-red-500">{err}</div>
      ) : list.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl">
          {subTab === "current"
            ? `No client contacts are currently mapped to ${clientName}.`
            : `No client contacts previously worked at ${clientName}.`}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="workex-contacts-grid">
          {list.map((c) => (
            <ContactMiniCard key={c.id} c={c} ex={subTab === "ex"} onOpen={setOpenContactId} />
          ))}
        </div>
      )}

      {/* Detail popup (same detail view, no redirect). Horizontal trackpad
          swipe or ← / → keys inside the popup move to the previous / next
          contact of the list currently shown (Current or Ex sub-tab). */}
      <ClientContactDetailModal
        contactId={openContactId}
        open={!!openContactId}
        onClose={() => setOpenContactId(null)}
        navItems={navItems}
        onNavigate={setOpenContactId}
      />

      {/* Add new client contact — Client field pre-filled with this client */}
      <AddContactDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultClientName={clientName}
        onSaved={load}
      />

      {/* Bulk upload client contacts */}
      <BulkUploadModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onComplete={load}
      />
    </div>
  );
}
