/**
 * ProfilePage — current user's profile (avatar, basic info, team, permission sets,
 * password timestamp + change-password button). Edit own avatar via:
 *   - upload an image (POST /api/profile/avatar)
 *   - pick a predefined cartoon preset (POST /api/profile/avatar/preset)
 *   - reset to initials (DELETE /api/profile/avatar)
 */
import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import api from "../lib/api";
import notify from "../lib/notify";
import { useAuth } from "../context/AuthContext";
import UserAvatar, { AVATAR_PRESETS, presetUrl, initialsFor, INITIALS_PALETTES } from "../components/UserAvatar";
import ChangePasswordModal from "../components/ChangePasswordModal";
import Camera from "@mui/icons-material/PhotoCameraOutlined";
import Upload from "@mui/icons-material/FileUploadOutlined";
import Trash2 from "@mui/icons-material/DeleteOutlined";
import KeyRound from "@mui/icons-material/KeyOutlined";
import ShieldCheck from "@mui/icons-material/GppGoodOutlined";
import Mail from "@mui/icons-material/MailOutlined";
import Phone from "@mui/icons-material/PhoneOutlined";
import IdCard from "@mui/icons-material/BadgeOutlined";
import Calendar from "@mui/icons-material/CalendarTodayOutlined";
import UsersIcon from "@mui/icons-material/PeopleOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import X from "@mui/icons-material/Close";
import Check from "@mui/icons-material/Check";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";

function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, "0");
    const month = d.toLocaleString("en-US", { month: "short", timeZone: "Asia/Kolkata" });
    const year = d.getFullYear();
    const h = d.getHours();
    const min = String(d.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${day}-${month}-${year} ${h12}:${min} ${ampm}`;
  } catch { return iso; }
}

// Format an ISO/date string as "Mon YYYY" (e.g. "Jan 2024"); null on failure.
function monthYear(iso) {
  if (!iso) return null;
  try {
    const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00` : iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  } catch { return null; }
}

// Icon-chip info tile used in the Employee Information grid.
function InfoTile({ icon: Icon, label, value, muted, testid }) {
  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-gray-100 p-3.5 hover:border-[#ec9324]/40 transition-colors"
      data-testid={testid}
    >
      <span className="w-9 h-9 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center flex-shrink-0">
        <Icon sx={{ fontSize: 18 }}/>
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
        <div className={`text-sm font-medium mt-0.5 break-words ${muted ? "text-gray-400" : "text-gray-900"}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

// ---------- Avatar editor ----------
function AvatarEditor({ open, profile, onClose, onChange }) {
  const [tab, setTab] = useState("initials"); // 'initials' | 'preset' | 'upload'
  const [uploading, setUploading] = useState(false);
  const [savingPreset, setSavingPreset] = useState(null);
  const [savingColor, setSavingColor] = useState(null);

  // Default the tab to whichever mode the user is currently in, when the
  // dialog opens. (Re-runs each time `open` flips to true.)
  useEffect(() => {
    if (!open) return;
    if (profile?.avatar_kind === "preset") setTab("preset");
    else if (profile?.avatar_kind === "upload") setTab("upload");
    else setTab("initials");
    // eslint-disable-next-line
  }, [open]);

  const selectColor = async (paletteId) => {
    setSavingColor(paletteId);
    try {
      await api.post("/profile/avatar/initials", { color: paletteId });
      notify.success("Avatar color updated");
      onChange?.({ avatar_kind: "initials", avatar_color: paletteId, avatar_preset: null, avatar_image: null });
      onClose();
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Could not set color");
    } finally { setSavingColor(null); }
  };

  const selectPreset = async (slug) => {
    setSavingPreset(slug);
    try {
      await api.post("/profile/avatar/preset", { preset: slug });
      notify.success("Avatar updated");
      onChange?.({ avatar_kind: "preset", avatar_preset: slug, avatar_image: null });
      onClose();
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Could not set avatar");
    } finally {
      setSavingPreset(null);
    }
  };

  const onFile = async (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      notify.error("Please choose an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      notify.error("Image must be smaller than 2 MB");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/profile/avatar", fd, { headers: { "Content-Type": "multipart/form-data" } });
      notify.success("Avatar updated");
      onChange?.({ avatar_kind: "upload", avatar_image: r.data.avatar_image, avatar_preset: null });
      onClose();
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Could not upload avatar");
    } finally { setUploading(false); }
  };

  const removeAvatar = async () => {
    try {
      await api.delete("/profile/avatar");
      notify.success("Avatar reset");
      onChange?.({ avatar_kind: "initials", avatar_preset: null, avatar_image: null });
      onClose();
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Could not reset avatar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera sx={{ fontSize: 18 }} className="text-[#ec9324]"/> Update Avatar
          </DialogTitle>
          <DialogDescription>Upload an image or pick a cartoon avatar.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setTab("initials")}
            className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${tab === "initials" ? "border-[#ec9324] text-[#ec9324]" : "border-transparent text-gray-500 hover:text-gray-800"}`}
            data-testid="avatar-tab-initials"
          >Initials</button>
          <button
            type="button"
            onClick={() => setTab("preset")}
            className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${tab === "preset" ? "border-[#ec9324] text-[#ec9324]" : "border-transparent text-gray-500 hover:text-gray-800"}`}
            data-testid="avatar-tab-preset"
          >Cartoon Avatars</button>
          <button
            type="button"
            onClick={() => setTab("upload")}
            className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${tab === "upload" ? "border-[#ec9324] text-[#ec9324]" : "border-transparent text-gray-500 hover:text-gray-800"}`}
            data-testid="avatar-tab-upload"
          >Upload Photo</button>
        </div>

        {tab === "initials" && (
          <div className="py-3 space-y-3" data-testid="avatar-initials-panel">
            <div className="text-xs text-gray-600">
              Pick a color shade for <span className="font-semibold">{initialsFor(profile?.name)}</span>:
            </div>
            <div className="grid grid-cols-6 gap-3" data-testid="avatar-color-grid">
              {INITIALS_PALETTES.map((p) => {
                const isCurrent = profile?.avatar_kind === "initials" && profile?.avatar_color === p.id;
                const isSaving = savingColor === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => selectColor(p.id)}
                    disabled={isSaving}
                    data-testid={`avatar-color-${p.id}`}
                    className={`relative rounded-full overflow-hidden ring-2 transition-all flex items-center justify-center font-extrabold text-white ${
                      isCurrent ? "ring-[#ec9324]" : "ring-transparent hover:ring-gray-300"
                    }`}
                    style={{
                      width: 56, height: 56,
                      background: `linear-gradient(135deg, ${p.stops[0]} 0%, ${p.stops[1]} 100%)`,
                      fontSize: 18,
                      letterSpacing: "0.02em",
                    }}
                    aria-label={`Color ${p.id}`}
                  >
                    {initialsFor(profile?.name)}
                    {isCurrent && (
                      <span className="absolute inset-0 bg-black/30 flex items-center justify-center rounded-full">
                        <Check sx={{ fontSize: 18 }} className="text-white"/>
                      </span>
                    )}
                    {isSaving && (
                      <span className="absolute inset-0 bg-white/70 flex items-center justify-center rounded-full">
                        <Loader2 sx={{ fontSize: 18 }} className="animate-spin text-[#ec9324]"/>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tab === "preset" && (
          <div className="grid grid-cols-4 gap-3 py-3" data-testid="avatar-preset-grid">
            {AVATAR_PRESETS.map((slug) => {
              const isCurrent = profile?.avatar_kind === "preset" && profile?.avatar_preset === slug;
              const isSaving = savingPreset === slug;
              return (
                <button
                  key={slug}
                  onClick={() => selectPreset(slug)}
                  disabled={isSaving}
                  data-testid={`avatar-preset-${slug}`}
                  className={`relative rounded-full overflow-hidden ring-2 transition-all ${
                    isCurrent ? "ring-[#ec9324]" : "ring-transparent hover:ring-gray-300"
                  }`}
                  style={{ width: 64, height: 64 }}
                >
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ background: "radial-gradient(circle at 30% 30%, #ffe0c2, #f8d7da 60%, #e0c3fc 100%)" }}
                  >
                    <img src={presetUrl(slug)} alt={slug} className="block" style={{ width: "82%", height: "82%", objectFit: "contain" }}/>
                  </div>
                  {isCurrent && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                      <Check sx={{ fontSize: 20 }} className="text-white"/>
                    </div>
                  )}
                  {isSaving && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                      <Loader2 sx={{ fontSize: 18 }} className="animate-spin text-[#ec9324]"/>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {tab === "upload" && (
          <div className="py-3" data-testid="avatar-upload-panel">
            <label
              htmlFor="avatar-upload-input"
              className="block border-2 border-dashed border-gray-300 hover:border-[#ec9324] rounded-xl p-6 text-center cursor-pointer transition-colors"
            >
              <Upload sx={{ fontSize: 28 }} className="mx-auto text-gray-400 mb-2"/>
              <div className="text-sm font-medium text-gray-700">
                {uploading ? "Uploading…" : "Click to choose an image"}
              </div>
              <div className="text-xs text-gray-500 mt-1">PNG, JPG or WEBP. Max 2 MB.</div>
              <input
                id="avatar-upload-input" type="file" accept="image/*"
                className="hidden" onChange={(e) => onFile(e.target.files?.[0])}
                disabled={uploading}
                data-testid="avatar-upload-input"
              />
            </label>
          </div>
        )}

        <DialogFooter className="flex sm:flex-row justify-between items-center w-full">
          {profile?.avatar_kind !== "initials" ? (
            <Button variant="outline" size="sm" onClick={removeAvatar} className="text-red-600 border-red-200 hover:bg-red-50" data-testid="avatar-reset-btn">
              <Trash2 sx={{ fontSize: 13 }} className="mr-1.5"/> Reset to initials
            </Button>
          ) : <div/>}
          <Button variant="outline" onClick={onClose} data-testid="avatar-close-btn">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Page ----------
export default function ProfilePage() {
  const { refresh } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [cpOpen, setCpOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/profile/me");
      setProfile(r.data);
    } catch (e) {
      notify.error("Could not load profile");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const onAvatarChange = (partial) => {
    setProfile((p) => ({ ...(p || {}), ...partial }));
    refresh?.();
  };

  const onPasswordChange = (resp) => {
    setProfile((p) => p ? { ...p, password_changed_at: resp?.password_changed_at || new Date().toISOString() } : p);
  };

  return (
    <Layout title="My Profile" breadcrumbs={[{ label: "Profile" }]}>
      {loading || !profile ? (
        <div className="flex items-center justify-center py-24 text-gray-400">
          <Loader2 sx={{ fontSize: 20 }} className="animate-spin mr-2"/> Loading profile…
        </div>
      ) : (
        <div className="max-w-6xl">
          <div className="grid grid-cols-12 gap-5">

            {/* LEFT — identity card */}
            <section className="col-span-12 lg:col-span-4" data-testid="profile-header">
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="h-24" style={{ background: "linear-gradient(120deg,#ec9324 0%,#f6b35c 55%,#8ec06c 100%)" }}/>
                <div className="px-6 pb-6 -mt-12 flex flex-col items-center text-center">
                  <div className="relative">
                    <div className="rounded-full ring-4 ring-white shadow-md">
                      <UserAvatar user={profile} size={96} online showStatusDot/>
                    </div>
                    <button
                      onClick={() => setAvatarOpen(true)}
                      className="absolute bottom-0 right-0 bg-[#ec9324] hover:bg-[#d4811f] text-white rounded-full p-1.5 shadow-md ring-2 ring-white"
                      data-testid="profile-edit-avatar-btn"
                      aria-label="Edit avatar"
                    >
                      <Camera sx={{ fontSize: 14 }}/>
                    </button>
                  </div>
                  <h1 className="mt-3 text-xl font-bold text-gray-900 truncate max-w-full" data-testid="profile-name">
                    {profile.name || initialsFor(profile.name)}
                  </h1>
                  <div className="mt-0.5 text-sm text-gray-500 flex items-center gap-1.5 max-w-full">
                    <Mail sx={{ fontSize: 13 }} className="text-gray-400 flex-shrink-0"/>
                    <span className="truncate">{profile.email}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#ec9324]/10 text-[#ec9324] rounded-full text-xs font-semibold">
                      <ShieldCheck sx={{ fontSize: 11 }}/> {profile.role}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/> Online
                    </span>
                  </div>
                  <div className="w-full border-t border-gray-100 mt-5 pt-4 grid grid-cols-2 gap-3 text-left">
                    <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Employee ID</div>
                      <div className="text-sm font-semibold text-gray-900 mt-0.5 truncate">{profile.emp_id || "—"}</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Member Since</div>
                      <div className="text-sm font-semibold text-gray-900 mt-0.5 truncate">
                        {monthYear(profile.doj) || monthYear(profile.created_on) || "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* RIGHT — details */}
            <div className="col-span-12 lg:col-span-8 space-y-5">
              {/* Employee information */}
              <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6" data-testid="profile-info-card">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-8 rounded-lg bg-[#ec9324]/10 text-[#ec9324] flex items-center justify-center">
                    <IdCard sx={{ fontSize: 18 }}/>
                  </span>
                  <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Employee Information</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoTile icon={IdCard} label="Employee ID" value={profile.emp_id || "—"} muted={!profile.emp_id} testid="profile-empid"/>
                  <InfoTile icon={Mail} label="Email" value={profile.email} testid="profile-email"/>
                  <InfoTile icon={Phone} label="Phone" value={profile.phone || "—"} muted={!profile.phone} testid="profile-phone"/>
                  <InfoTile icon={Calendar} label="Date of Joining" value={profile.doj || "—"} muted={!profile.doj} testid="profile-doj"/>
                  <InfoTile icon={UsersIcon} label="Team Name" value={profile.team_name || "Not assigned"} muted={!profile.team_name} testid="profile-team"/>
                  <InfoTile
                    icon={ShieldCheck}
                    label="Permission Set(s)"
                    value={(profile.permission_set_names || []).length ? profile.permission_set_names.join(", ") : "None"}
                    muted={!(profile.permission_set_names || []).length}
                    testid="profile-permission-sets"
                  />
                </div>
              </section>

              {/* Security */}
              <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6" data-testid="profile-password-card">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-8 rounded-lg bg-[#ec9324]/10 text-[#ec9324] flex items-center justify-center">
                    <KeyRound sx={{ fontSize: 18 }}/>
                  </span>
                  <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Security</h2>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-gray-100 p-4">
                  <div className="flex items-start gap-3">
                    <span className="w-10 h-10 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center flex-shrink-0">
                      <KeyRound sx={{ fontSize: 18 }}/>
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">Password</div>
                      <div className="text-xs text-gray-500 mt-0.5" data-testid="profile-password-last-updated">
                        {profile.password_changed_at
                          ? `Last updated ${fmtDateTime(profile.password_changed_at)}`
                          : "Never changed since account creation"}
                      </div>
                    </div>
                  </div>
                  <Button
                    onClick={() => setCpOpen(true)}
                    className="bg-[#ec9324] hover:bg-[#d4811f] text-white flex-shrink-0"
                    data-testid="profile-change-password-btn"
                  >
                    <KeyRound sx={{ fontSize: 14 }} className="mr-2"/> Change Password
                  </Button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      <AvatarEditor
        open={avatarOpen}
        profile={profile}
        onClose={() => setAvatarOpen(false)}
        onChange={onAvatarChange}
      />
      <ChangePasswordModal
        open={cpOpen}
        onClose={() => setCpOpen(false)}
        onSuccess={onPasswordChange}
      />
    </Layout>
  );
}
