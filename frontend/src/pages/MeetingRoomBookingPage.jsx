import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  CalendarClock, Search, Users, Building2, X, Plus, Trash2, MapPin, Clock, Loader2,
} from "lucide-react";
import Layout from "../components/Layout";
import api from "../lib/api";

// ============================================================ Helpers
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch { return iso; }
};
const todayIso = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const tz = -d.getTimezoneOffset();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const combineDateTime = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) return null;
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
};

// ============================================================ MAIN
export default function MeetingRoomBookingPage() {
  const [rooms, setRooms] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(todayIso());
  const [bookFor, setBookFor] = useState(null);  // {plan_id, room_id, name, capacity, plan_name}
  const [error, setError] = useState("");

  const loadRooms = useCallback(async () => {
    const res = await api.get("/room-bookings/rooms");
    setRooms(res.data || []);
  }, []);
  const loadBookingsForDate = useCallback(async (d) => {
    const res = await api.get(`/room-bookings?date=${d}&include_past=true`);
    setBookings(res.data || []);
  }, []);
  const loadMyBookings = useCallback(async () => {
    const res = await api.get(`/room-bookings?mine=true`);
    setMyBookings(res.data || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([loadRooms(), loadBookingsForDate(date), loadMyBookings()]);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadBookingsForDate(date); }, [date, loadBookingsForDate]);

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(r =>
      r.name?.toLowerCase().includes(q) ||
      r.plan_name?.toLowerCase().includes(q)
    );
  }, [rooms, search]);

  // Booking → first active overlapping booking for a room on the picked date
  const bookingsByRoom = useMemo(() => {
    const map = {};
    bookings.forEach(b => {
      if (b.cancelled) return;
      (map[b.room_id] = map[b.room_id] || []).push(b);
    });
    return map;
  }, [bookings]);

  const handleCancel = async (id) => {
    if (!window.confirm("Cancel this booking?")) return;
    try {
      await api.delete(`/room-bookings/${id}`);
      await Promise.all([loadBookingsForDate(date), loadMyBookings()]);
    } catch (e) {
      alert(`Cancel failed: ${e?.response?.data?.detail || e.message}`);
    }
  };

  const handleCreate = async (payload) => {
    setError("");
    try {
      await api.post("/room-bookings", payload);
      setBookFor(null);
      await Promise.all([loadBookingsForDate(date), loadMyBookings()]);
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message;
      setError(msg);
      throw new Error(msg);
    }
  };

  return (
    <Layout breadcrumbs={[{ label: "Workspace Manager" }, { label: "Meeting Room Booking" }]}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-3">
          <CalendarClock className="text-emerald-600" size={28} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight" data-testid="mrb-title">Meeting Room Booking</h1>
            <p className="text-sm text-gray-500">Book meeting rooms across published floor calibrations.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rooms..."
              className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-emerald-500 w-56"
              data-testid="mrb-search"
            />
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-emerald-500"
            data-testid="mrb-date"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500"><Loader2 className="animate-spin mr-2" /> Loading meeting rooms…</div>
      ) : rooms.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center" data-testid="mrb-no-rooms">
          <Building2 className="mx-auto mb-3 text-gray-400" size={32} />
          <h2 className="font-semibold text-gray-700">No meeting rooms available</h2>
          <p className="text-sm text-gray-500 mt-1">Calibrate at least one meeting room in a Live floor plan to enable booking.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Rooms grid */}
          <div className="lg:col-span-2">
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Available rooms ({filteredRooms.length})</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="mrb-room-grid">
              {filteredRooms.map(r => {
                const todays = bookingsByRoom[r.room_id] || [];
                return (
                  <div
                    key={r.room_id}
                    data-testid={`mrb-room-card-${r.room_id}`}
                    className="bg-white rounded-xl border border-gray-200 hover:border-emerald-500 hover:shadow-md transition-all p-4 flex flex-col"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-gray-900 truncate" title={r.name}>{r.name}</h3>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-200">
                        <Users size={10} /> {r.capacity}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1 inline-flex items-center gap-1"><MapPin size={11} />{r.plan_name}</div>
                    <div className="mt-3 text-[11px] text-gray-600">
                      {todays.length === 0 ? (
                        <span className="text-emerald-700 font-semibold">Free on {date}</span>
                      ) : (
                        <span className="text-amber-700 font-semibold">{todays.length} booking{todays.length === 1 ? '' : 's'} on {date}</span>
                      )}
                    </div>
                    {todays.length > 0 && (
                      <div className="mt-2 space-y-1 max-h-24 overflow-y-auto">
                        {todays.map(b => (
                          <div key={b.id} className="text-[10px] text-gray-600 bg-gray-50 px-2 py-1 rounded border border-gray-100">
                            <Clock size={9} className="inline mr-0.5" />
                            {new Date(b.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            {' – '}
                            {new Date(b.end_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            <span className="ml-1 text-gray-500">· {b.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => setBookFor(r)}
                      className="mt-3 inline-flex items-center justify-center gap-1 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md text-xs font-semibold"
                      data-testid={`mrb-book-btn-${r.room_id}`}
                    ><Plus size={12} /> Book</button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* My Bookings */}
          <div>
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">My upcoming bookings ({myBookings.length})</h2>
            {myBookings.length === 0 ? (
              <div className="bg-white border border-dashed border-gray-200 rounded-xl p-6 text-center text-xs text-gray-500" data-testid="mrb-my-bookings-empty">
                You have no upcoming meeting room bookings.
              </div>
            ) : (
              <div className="space-y-3" data-testid="mrb-my-bookings-list">
                {myBookings.map(b => (
                  <div key={b.id} data-testid={`mrb-my-booking-${b.id}`} className="bg-white rounded-xl border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-gray-900 truncate" title={b.title}>{b.title}</div>
                        <div className="text-[11px] text-gray-600 mt-0.5 inline-flex items-center gap-1"><Building2 size={11} />{b.room_name} <span className="text-gray-400">·</span> {b.plan_name}</div>
                        <div className="text-[11px] text-gray-500 mt-1"><Clock size={10} className="inline mr-0.5" />{fmtDateTime(b.start_at)} – {fmtDateTime(b.end_at)}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">Attendees: {b.attendees_count} / {b.room_capacity}</div>
                      </div>
                      <button
                        onClick={() => handleCancel(b.id)}
                        title="Cancel booking"
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                        data-testid={`mrb-cancel-${b.id}`}
                      ><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {bookFor && (
        <BookingModal
          room={bookFor}
          date={date}
          error={error}
          onCancel={() => { setBookFor(null); setError(""); }}
          onSubmit={handleCreate}
        />
      )}
    </Layout>
  );
}

// ============================================================ Booking Modal
function BookingModal({ room, date, error, onCancel, onSubmit }) {
  const [title, setTitle] = useState("");
  const [attendees, setAttendees] = useState(1);
  const [bDate, setBDate] = useState(date);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    if (!title.trim()) return "Title is required";
    if (attendees < 1) return "Attendees must be ≥ 1";
    if (attendees > room.capacity) return `Attendees (${attendees}) exceed room capacity (${room.capacity})`;
    const s = combineDateTime(bDate, startTime);
    const e = combineDateTime(bDate, endTime);
    if (!s || !e) return "Invalid date/time";
    if (new Date(e) <= new Date(s)) return "End must be after start";
    return null;
  };

  const submit = async () => {
    const v = validate();
    if (v) { alert(v); return; }
    setSubmitting(true);
    try {
      await onSubmit({
        plan_id: room.plan_id,
        room_id: room.room_id,
        title: title.trim(),
        attendees_count: Number(attendees),
        start_at: combineDateTime(bDate, startTime),
        end_at: combineDateTime(bDate, endTime),
      });
    } catch { /* error shown by parent */ } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="mrb-modal">
      <div className="bg-white rounded-lg shadow-xl w-[440px] p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-sm font-bold text-gray-900">Book {room.name}</div>
            <div className="text-[11px] text-gray-500">{room.plan_name} · capacity {room.capacity}</div>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700" data-testid="mrb-modal-close"><X size={16} /></button>
        </div>

        <label className="block text-[11px] font-semibold text-gray-700 mt-1 mb-1">Title <span className="text-red-500">*</span></label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sprint planning"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-emerald-500"
          data-testid="mrb-modal-title" maxLength={120} />

        <div className="grid grid-cols-3 gap-2 mt-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">Date</label>
            <input type="date" value={bDate} onChange={(e) => setBDate(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-emerald-500"
              data-testid="mrb-modal-date" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">Start</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-emerald-500"
              data-testid="mrb-modal-start" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">End</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-emerald-500"
              data-testid="mrb-modal-end" />
          </div>
        </div>

        <label className="block text-[11px] font-semibold text-gray-700 mt-3 mb-1">Attendees (max {room.capacity})</label>
        <input type="number" min={1} max={room.capacity} value={attendees}
          onChange={(e) => setAttendees(parseInt(e.target.value, 10) || 1)}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-emerald-500"
          data-testid="mrb-modal-attendees" />

        {error && (
          <div className="mt-3 px-2.5 py-1.5 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded" data-testid="mrb-modal-error">{error}</div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-gray-200 rounded hover:bg-gray-50" data-testid="mrb-modal-cancel">Cancel</button>
          <button onClick={submit} disabled={submitting}
            className="px-3 py-1.5 text-sm bg-emerald-500 hover:bg-emerald-600 text-white rounded disabled:opacity-40"
            data-testid="mrb-modal-submit">
            {submitting ? "Booking…" : "Confirm Booking"}
          </button>
        </div>
      </div>
    </div>
  );
}
