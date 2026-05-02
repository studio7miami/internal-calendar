import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, formatApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatSauceLabel, SAUCE_OPTIONS } from "@/lib/memberSauce";
import { isPrimaryAdminEmail } from "@/lib/primaryAdmin";
import { pageBtnOutlineClass, pageBtnPrimaryClass, pageInputClass } from "@/lib/pageTheme";

/** Matches `BookingForm` dialog shell. */
const calSurface =
  "border border-gray-200/95 bg-[#FAFAFA] text-slate-900 dark:border-white/70 dark:bg-zinc-950 dark:text-white";

function Field({ label, children }) {
  return (
    <div>
      <label className="label-tech mb-1 block text-slate-500 dark:text-zinc-500">{label}</label>
      <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">{children}</div>
    </div>
  );
}

function roleDisplayText(member, viewer, isSelf) {
  const r = (member.role || "").toUpperCase() || "—";
  if (isSelf && member.role === "admin") return `${r} (you)`;
  return r;
}

/**
 * Admins can edit role (others), phone, and sauce. Members can update their own phone (password).
 */
export default function MemberSummaryDialog({
  open,
  onOpenChange,
  member,
  viewer,
  onRemoved,
  onRoleChange,
  onProfileSaved,
  refreshAuth,
  disableEdits = false,
}) {
  const [busy, setBusy] = useState(false);
  const [draftPhone, setDraftPhone] = useState("");
  const [draftSauce, setDraftSauce] = useState("");
  const [selfPassword, setSelfPassword] = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  const [profileErr, setProfileErr] = useState("");

  const isAdmin = viewer?.role === "admin";
  const isSelf = viewer?.id && String(member?.id) === String(viewer?.id);
  const viewerIsPrimaryAdmin = isPrimaryAdminEmail(viewer?.email);
  const memberEmail = member?.email || member?.member_email || "";
  const memberIsPrimaryAdmin = isPrimaryAdminEmail(memberEmail);
  const canDelete =
    isAdmin &&
    viewer?.id &&
    !isSelf &&
    !memberIsPrimaryAdmin &&
    (member?.role !== "admin" || viewerIsPrimaryAdmin);

  const showRoleEditor = Boolean(onRoleChange && isAdmin && member?.id && viewer?.id && !isSelf);
  /** Admin role cannot be assigned via UI; only member/manager. */
  const showRoleDropdown = showRoleEditor && member?.role !== "admin";
  const adminCanEditProfile = isAdmin && member?.id && !disableEdits;
  const memberEditsOwnPhone = !isAdmin && isSelf && member?.id && !disableEdits;

  useEffect(() => {
    if (!open || !member) return;
    setDraftPhone(member.phone_e164 || member.member_phone_e164 || "");
    setDraftSauce(member.sauce ?? member.member_sauce ?? "");
    setSelfPassword("");
    setProfileMsg("");
    setProfileErr("");
  }, [open, member]);

  if (!member) return null;

  const phoneDisplay = member.phone_e164 || member.member_phone_e164 || "—";
  const sauceVal = member.sauce ?? member.member_sauce;

  const handleDelete = async () => {
    if (!canDelete) return;
    if (!window.confirm(`Remove ${member.name} from the team? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.delete(`/users/${member.id}`);
      onOpenChange(false);
      onRemoved?.();
    } catch (e) {
      alert(formatApiError(e?.response?.data?.detail) || "Could not remove member");
    } finally {
      setBusy(false);
    }
  };

  const saveAdminProfile = async () => {
    if (!adminCanEditProfile) return;
    setBusy(true);
    setProfileErr("");
    setProfileMsg("");
    try {
      const body = {};
      const curPhone = member.phone_e164 || member.member_phone_e164 || "";
      const nextPhone = draftPhone.trim();
      if (nextPhone !== curPhone) {
        if (!nextPhone) {
          setProfileErr("Phone cannot be empty.");
          setBusy(false);
          return;
        }
        body.phone_e164 = nextPhone;
      }
      const curSauce = (member.sauce ?? member.member_sauce ?? "").toLowerCase();
      if ((draftSauce || "").toLowerCase() !== curSauce) {
        body.sauce = draftSauce;
      }
      if (Object.keys(body).length === 0) {
        setProfileMsg("No changes to save.");
        setBusy(false);
        return;
      }
      const { data } = await api.patch(`/users/${member.id}/profile`, body);
      if (isSelf && data?.user) await refreshAuth?.();
      await onProfileSaved?.();
      onOpenChange(false);
    } catch (e) {
      setProfileErr(formatApiError(e?.response?.data?.detail) || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const saveSelfPhone = async () => {
    if (!memberEditsOwnPhone) return;
    setBusy(true);
    setProfileErr("");
    setProfileMsg("");
    try {
      const payload = {
        phone_e164: draftPhone.trim(),
        password: selfPassword,
      };
      await api.patch("/auth/me/phone", payload);
      setProfileMsg("Phone number updated.");
      await refreshAuth?.();
      await onProfileSaved?.();
      onOpenChange(false);
    } catch (e) {
      setProfileErr(formatApiError(e?.response?.data?.detail) || "Could not update phone");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-md gap-0 p-0 shadow-lg", calSurface)} data-testid="member-summary-dialog">
        <div className="p-6">
          <DialogHeader>
            <DialogTitle className="text-left font-['Manrope',system-ui,sans-serif] text-2xl font-semibold text-black dark:text-white">
              {member.name || "Member"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2 text-sm">
            {showRoleDropdown ? (
              <div>
                <label className="label-tech mb-1 block text-slate-500 dark:text-zinc-500" htmlFor="member-summary-role-select">
                  Role
                </label>
                <select
                  id="member-summary-role-select"
                  value={member.role || "member"}
                  onChange={(e) => onRoleChange(member, e.target.value)}
                  data-testid="member-summary-role-select"
                  className={cn(pageInputClass, "md:text-sm")}
                >
                  <option value="member">MEMBER</option>
                  <option value="manager">MANAGER</option>
                </select>
              </div>
            ) : (
              <Field label="Role">{roleDisplayText(member, viewer, isSelf)}</Field>
            )}
            <Field label="Email">{member.email || member.member_email || "—"}</Field>

            {adminCanEditProfile ? (
              <>
                <div>
                  <label className="label-tech mb-1 block text-slate-500 dark:text-zinc-500" htmlFor="member-summary-phone">
                    Phone
                  </label>
                  <Input
                    id="member-summary-phone"
                    type="tel"
                    value={draftPhone}
                    onChange={(e) => setDraftPhone(e.target.value)}
                    className={cn(pageInputClass, "md:text-sm")}
                    placeholder="+1…"
                    data-testid="member-summary-phone-input"
                  />
                </div>
                <div>
                  <label className="label-tech mb-1 block text-slate-500 dark:text-zinc-500" htmlFor="member-summary-sauce">
                    What’s your sauce
                  </label>
                  <select
                    id="member-summary-sauce"
                    value={draftSauce || "photography"}
                    onChange={(e) => setDraftSauce(e.target.value)}
                    className={cn(pageInputClass, "md:text-sm")}
                    data-testid="member-summary-sauce-select"
                  >
                    {SAUCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : memberEditsOwnPhone ? (
              <>
                <div>
                  <label className="label-tech mb-1 block text-slate-500 dark:text-zinc-500" htmlFor="member-self-phone">
                    Phone
                  </label>
                  <Input
                    id="member-self-phone"
                    type="tel"
                    value={draftPhone}
                    onChange={(e) => setDraftPhone(e.target.value)}
                    className={cn(pageInputClass, "md:text-sm")}
                    placeholder="+1…"
                    data-testid="member-self-phone-input"
                  />
                </div>
                <div>
                  <label className="label-tech mb-1 block text-slate-500 dark:text-zinc-500" htmlFor="member-self-pw">
                    Password
                  </label>
                  <Input
                    id="member-self-pw"
                    type="password"
                    autoComplete="current-password"
                    value={selfPassword}
                    onChange={(e) => setSelfPassword(e.target.value)}
                    className={cn(pageInputClass, "md:text-sm")}
                    data-testid="member-self-password"
                  />
                </div>
                <Field label="What&apos;s your sauce">{formatSauceLabel(sauceVal)}</Field>
              </>
            ) : (
              <>
                <Field label="Phone">{phoneDisplay}</Field>
                <Field label="What&apos;s your sauce">{formatSauceLabel(sauceVal)}</Field>
              </>
            )}

            {profileErr && (
              <div className="rounded-[7px] border border-red-200/90 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                {profileErr}
              </div>
            )}
            {profileMsg && !profileErr && (
              <div className="text-xs font-medium text-emerald-800 dark:text-emerald-300">{profileMsg}</div>
            )}
          </div>

          <div className="space-y-3 pt-2">
            {adminCanEditProfile && (
              <Button
                type="button"
                disabled={busy}
                onClick={saveAdminProfile}
                className={cn("h-10 w-full", pageBtnPrimaryClass)}
                data-testid="member-summary-save-profile"
              >
                {busy ? "Saving…" : "Save profile"}
              </Button>
            )}
            {memberEditsOwnPhone && (
              <Button
                type="button"
                disabled={busy}
                onClick={saveSelfPhone}
                className={cn("h-10 w-full", pageBtnPrimaryClass)}
                data-testid="member-self-save-phone"
              >
                {busy ? "Saving…" : "Save phone"}
              </Button>
            )}
            {canDelete && (
              <div className="border-t border-slate-200/80 pt-3 dark:border-white/10">
                <button
                  type="button"
                  disabled={busy}
                  data-testid="member-summary-delete"
                  onClick={handleDelete}
                  className={cn(
                    "text-sm font-medium text-red-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
                  )}
                >
                  {busy ? "Removing…" : "Remove from team"}
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                data-testid="member-summary-close"
                className={cn("h-10 min-h-8 w-full flex-1 box-border", pageBtnOutlineClass)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
