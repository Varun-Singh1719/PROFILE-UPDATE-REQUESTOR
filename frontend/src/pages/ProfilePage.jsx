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
import UserAvatar, { AVATAR_PRESETS, presetUrl, initialsFor } from "../components/UserAvatar";
import ChangePasswordModal from "../components/ChangePasswordModal";
import {
  Camera, Upload, Trash2, KeyRound, ShieldCheck, Mail, Phone, IdCard, Calendar,
  Users as UsersIcon, Loader2, X, Check,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";

function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, "0");
    const month = d.toLocaleString("en-US", { month: "short" });
    const year = d.getFullYear();
    const h = d.getHours();
    const min = String(d.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${day}-${month}-${year} ${h12}:${min} ${ampm}`;
  } catch { return iso; }
}

function InfoRow({ icon: Icon, label, value, testid }) {
  return (
    <div className="flex items-start gap-3 py-2" data-testid={testid}>
      <Icon size={15} className="text-gray-400 mt-0.5 flex-shrink-0"/>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</div>
        <div className="text-sm text-gray-900 break-words">{value || <span className="text-gray-400">—</span>}</div>
      </div>
    </div>
  );
}

// ---------- Avatar editor ----------
function AvatarEditor({ open, profile, onClose, onChange }) {
  const [tab, setTab] = useState("preset"); // 'preset' | 'upload'
  const [uploading, setUploading] = useState(false);
  const [savingPreset, setSavingPreset] = useState(null);

  const selectPreset = async (slug) => {
    setSavingPreset(slug);
    try {
      const r = await api.post("/profile/avatar/preset", { preset: slug });
      notify.success("Avatar updated");
      onChange?.({ avatar_kind: "preset", avatar_preset: slug, avatar_image: null });
      onClose();
      return r;
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
            <Camera size={18} className="text-[#ec9324]"/> Update Avatar
          </DialogTitle>
          <DialogDescription>Upload an image or pick a cartoon avatar.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b border-gray-200">
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
                >
                  <img src={presetUrl(slug)} alt={slug} className="w-16 h-16 object-cover bg-gray-100"/>
                  {isCurrent && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                      <Check size={20} className="text-white"/>
                    </div>
                  )}
                  {isSaving && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                      <Loader2 size={18} className="animate-spin text-[#ec9324]"/>
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
              <Upload size={28} className="mx-auto text-gray-400 mb-2"/>
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
              <Trash2 size={13} className="mr-1.5"/> Reset to initials
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
    <Layout breadcrumbs={[{ label: "Profile" }]}>
      {loading || !profile ? (
        <div className="flex items-center justify-center py-24 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2"/> Loading profile…
        </div>
      ) : (
        <div className="max-w-3xl space-y-5">
          {/* Header card — avatar + name + role */}
          <section className="bg-white border border-gray-200 rounded-xl p-6 flex items-center gap-5" data-testid="profile-header">
            <div className="relative">
              <UserAvatar user={profile} size={96} online showStatusDot/>
              <button
                onClick={() => setAvatarOpen(true)}
                className="absolute -bottom-1 -right-1 bg-[#ec9324] hover:bg-[#d4811f] text-white rounded-full p-1.5 shadow-md"
                data-testid="profile-edit-avatar-btn"
                aria-label="Edit avatar"
              >
                <Camera size={14}/>
              </button>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-gray-900 truncate" data-testid="profile-name">{profile.name || initialsFor(profile.name)}</h1>
              <div className="text-sm text-gray-600 truncate flex items-center gap-1.5 mt-0.5">
                <Mail size={13} className="text-gray-400"/> {profile.email}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#ec9324]/10 text-[#ec9324] rounded-full text-xs font-medium">
                  <ShieldCheck size={11}/> {profile.role}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/> Online
                </span>
              </div>
            </div>
          </section>

          {/* Basic + Team + Permissions */}
          <section className="bg-white border border-gray-200 rounded-xl p-6" data-testid="profile-info-card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wider">Employee Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 divide-y divide-gray-100 md:divide-y-0">
              <InfoRow icon={IdCard} label="Employee ID" value={profile.emp_id} testid="profile-empid"/>
              <InfoRow icon={Mail}   label="Email"       value={profile.email} testid="profile-email"/>
              <InfoRow icon={Phone}  label="Phone"       value={profile.phone} testid="profile-phone"/>
              <InfoRow icon={Calendar} label="Date of Joining" value={profile.doj} testid="profile-doj"/>
              <InfoRow icon={UsersIcon} label="Team Name" value={profile.team_name} testid="profile-team"/>
              <InfoRow icon={ShieldCheck} label="Permission Set(s)"
                value={(profile.permission_set_names || []).length
                  ? profile.permission_set_names.join(", ")
                  : ""}
                testid="profile-permission-sets"
              />
            </div>
          </section>

          {/* Password section */}
          <section className="bg-white border border-gray-200 rounded-xl p-6" data-testid="profile-password-card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wider">Password</h2>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <KeyRound size={18} className="text-gray-400 mt-0.5"/>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">Last Updated</div>
                  <div className="text-sm text-gray-900" data-testid="profile-password-last-updated">
                    {profile.password_changed_at
                      ? fmtDateTime(profile.password_changed_at)
                      : <span className="text-gray-400">Never changed since account creation</span>}
                  </div>
                </div>
              </div>
              <Button
                onClick={() => setCpOpen(true)}
                className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
                data-testid="profile-change-password-btn"
              >
                <KeyRound size={14} className="mr-2"/> Change Password
              </Button>
            </div>
          </section>
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
