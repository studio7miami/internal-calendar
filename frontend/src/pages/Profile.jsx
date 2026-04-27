import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api, formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { LogOut, Shield, KeyRound, Loader2 } from "lucide-react";
import {
  pageTitleClass,
  pageSubtextClass,
  pageCardClass,
  pageInputClass,
  pageBtnPrimaryClass,
  pageBtnOutlineClass,
} from "../lib/pageTheme";
import { cn } from "@/lib/utils";

export default function Profile() {
  const { user, refreshUser, logout } = useAuth();

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwOk, setPwOk] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const [channelChoice, setChannelChoice] = useState("email");
  const [phoneForSetup, setPhoneForSetup] = useState("");
  const [setupHint, setSetupHint] = useState(null);
  const [enableCode, setEnableCode] = useState("");
  const [mfaErr, setMfaErr] = useState("");
  const [mfaOk, setMfaOk] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);
  const [disPw, setDisPw] = useState("");
  const [disCode, setDisCode] = useState("");
  const [disableCodeSent, setDisableCodeSent] = useState(false);

  const mfaOn = !!user?.mfa_enabled;
  const mfaPending = !!user?.mfa_setup_pending;

  useEffect(() => {
    if (!user) return;
    if (user.mfa_setup_pending && user.mfa_pending_channel) {
      setChannelChoice(user.mfa_pending_channel === "phone" ? "phone" : "email");
      if (user.phone_e164) setPhoneForSetup(user.phone_e164);
    }
  }, [user]);

  if (!user) return null;

  const sendSetupCode = async () => {
    setMfaErr("");
    setMfaOk("");
    if (channelChoice === "phone" && !phoneForSetup.trim()) {
      setMfaErr("Enter your phone number for SMS codes.");
      return;
    }
    setMfaLoading(true);
    try {
      const body = { channel: channelChoice };
      if (channelChoice === "phone") body.phone_e164 = phoneForSetup;
      const { data } = await api.post("/auth/mfa/setup", body);
      setSetupHint({ channel: data.channel, sent_hint: data.sent_hint });
      setEnableCode("");
      await refreshUser();
    } catch (e) {
      setMfaErr(formatApiError(e?.response?.data?.detail) || "Could not send verification code");
    } finally {
      setMfaLoading(false);
    }
  };

  const cancelMfa = async () => {
    setMfaLoading(true);
    setMfaErr("");
    setMfaOk("");
    try {
      await api.post("/auth/mfa/cancel");
      setSetupHint(null);
      setEnableCode("");
      setDisableCodeSent(false);
      await refreshUser();
    } catch (e) {
      setMfaErr(formatApiError(e?.response?.data?.detail) || "Failed to cancel");
    } finally {
      setMfaLoading(false);
    }
  };

  const enableMfa = async (e) => {
    e.preventDefault();
    setMfaErr("");
    setMfaOk("");
    setMfaLoading(true);
    try {
      await api.post("/auth/mfa/enable", { code: enableCode });
      setSetupHint(null);
      setEnableCode("");
      setMfaOk("Two-factor authentication is now turned on.");
      await refreshUser();
    } catch (e) {
      setMfaErr(formatApiError(e?.response?.data?.detail) || "Code did not match");
    } finally {
      setMfaLoading(false);
    }
  };

  const sendDisableCode = async () => {
    setMfaErr("");
    setMfaOk("");
    if (!disPw) {
      setMfaErr("Enter your password first.");
      return;
    }
    setMfaLoading(true);
    try {
      await api.post("/auth/mfa/disable/send-code", { password: disPw });
      setDisableCodeSent(true);
      setDisCode("");
      setMfaOk(`Verification code sent to your ${user?.mfa_channel === "phone" ? "phone" : "email"}.`);
    } catch (e) {
      setMfaErr(formatApiError(e?.response?.data?.detail) || "Could not send code");
    } finally {
      setMfaLoading(false);
    }
  };

  const disableMfa = async (e) => {
    e.preventDefault();
    setMfaErr("");
    setMfaOk("");
    setMfaLoading(true);
    try {
      await api.post("/auth/mfa/disable", { password: disPw, code: disCode });
      setDisPw("");
      setDisCode("");
      setDisableCodeSent(false);
      setMfaOk("Two-factor authentication is turned off.");
      await refreshUser();
    } catch (e) {
      setMfaErr(formatApiError(e?.response?.data?.detail) || "Could not turn off 2FA");
    } finally {
      setMfaLoading(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwErr("");
    setPwOk(false);
    if (newPw !== newPw2) {
      setPwErr("New passwords do not match.");
      return;
    }
    if (newPw.length < 8) {
      setPwErr("New password must be at least 8 characters.");
      return;
    }
    setPwLoading(true);
    try {
      await api.post("/auth/password/change", { current_password: curPw, new_password: newPw });
      setCurPw("");
      setNewPw("");
      setNewPw2("");
      setPwOk(true);
    } catch (e) {
      setPwErr(formatApiError(e?.response?.data?.detail) || "Could not update password");
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="max-w-xl space-y-8" data-testid="profile-page">
      <div>
        <div className="label-tech">Profile</div>
        <h1 className={pageTitleClass}>{user.name}</h1>
      </div>

      <div className={cn("space-y-4 p-6", pageCardClass)}>
        <div>
          <div className="label-tech">Email</div>
          <div className="text-slate-900 tabular-nums dark:text-zinc-200">{user.email}</div>
        </div>
        <div>
          <div className="label-tech">Role</div>
          <div className="text-slate-900 dark:text-zinc-200">
            <span className="capitalize">{user.role}</span>
          </div>
        </div>
        <div>
          <div className="label-tech">Member since</div>
          <div className="text-slate-900 tabular-nums dark:text-zinc-200">
            {user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-zinc-100">
          <KeyRound className="h-4 w-4" strokeWidth={1.5} />
          Change password
        </h2>
        <p className={pageSubtextClass}>
          This updates your sign-in password for the calendar app. Use a strong, unique password.
        </p>
        <form onSubmit={changePassword} className={cn("space-y-3 p-4 sm:p-6", pageCardClass)}>
          {pwErr && <div className="text-sm text-red-600 dark:text-red-400">{pwErr}</div>}
          {pwOk && (
            <div className="text-sm text-emerald-800 dark:text-emerald-200">Your password was updated.</div>
          )}
          <div>
            <label className="label-tech mb-1 block">Current password</label>
            <Input
              type="password"
              value={curPw}
              onChange={(e) => setCurPw(e.target.value)}
              required
              autoComplete="current-password"
              className={pageInputClass}
              data-testid="profile-current-password"
            />
          </div>
          <div>
            <label className="label-tech mb-1 block">New password (min. 8 characters)</label>
            <Input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className={pageInputClass}
              data-testid="profile-new-password"
            />
          </div>
          <div>
            <label className="label-tech mb-1 block">Confirm new password</label>
            <Input
              type="password"
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className={pageInputClass}
              data-testid="profile-confirm-password"
            />
          </div>
          <Button
            type="submit"
            variant="ghost"
            disabled={pwLoading}
            className={pageBtnPrimaryClass}
            data-testid="profile-save-password"
          >
            {pwLoading ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Update password"
            )}
          </Button>
        </form>
      </div>

      <div className="space-y-3" data-testid="profile-2fa-section">
        <h2 className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-zinc-100">
          <Shield className="h-4 w-4" strokeWidth={1.5} />
          Two-factor authentication (2FA)
        </h2>
        <p className={pageSubtextClass}>
          {mfaOn
            ? `After your password, you receive a one-time code by ${user.mfa_channel === "phone" ? "SMS" : "email"}.`
            : mfaPending
              ? "A verification code was sent or is ready to resend. Enter the code below to finish, or request a new one."
              : "Choose email or SMS. After each password sign-in we send a one-time code to the option you turn on."}
        </p>

        {(mfaErr || mfaOk) && (
          <div
            className={cn(
              "text-sm",
              mfaErr ? "text-red-600 dark:text-red-400" : "text-emerald-800 dark:text-emerald-200"
            )}
          >
            {mfaErr || mfaOk}
          </div>
        )}

        {mfaOn && (
          <form onSubmit={disableMfa} className={cn("space-y-3 p-4 sm:p-6", pageCardClass)}>
            <p className="text-sm text-slate-600 dark:text-zinc-400">
              Turn off 2FA: confirm your password, send a verification code to your {user.mfa_channel === "phone" ? "phone" : "email"}, then enter that code.
            </p>
            <div>
              <label className="label-tech mb-1 block">Password</label>
              <Input
                type="password"
                value={disPw}
                onChange={(e) => {
                  setDisPw(e.target.value);
                  setDisableCodeSent(false);
                }}
                required
                className={pageInputClass}
                data-testid="mfa-disable-password"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={sendDisableCode}
              disabled={mfaLoading || !disPw}
              className={pageBtnPrimaryClass}
              data-testid="mfa-disable-send-code"
            >
              {mfaLoading ? "Sending…" : "Send verification code"}
            </Button>
            <div>
              <label className="label-tech mb-1 block">6-digit code</label>
              <Input
                type="text"
                inputMode="numeric"
                value={disCode}
                onChange={(e) => setDisCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                className={pageInputClass + " max-w-[12rem]"}
                data-testid="mfa-disable-code"
                placeholder={disableCodeSent ? "" : "Send code first"}
              />
            </div>
            <Button
              type="submit"
              variant="ghost"
              disabled={mfaLoading}
              className="border border-red-200/80 text-red-800 transition-colors hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40"
              data-testid="mfa-disable-submit"
            >
              {mfaLoading ? "Working…" : "Turn off 2FA"}
            </Button>
          </form>
        )}

        {!mfaOn && (mfaPending || setupHint) && (
          <div className={cn("space-y-4 p-4 sm:p-6", pageCardClass)}>
            {mfaPending && !setupHint && (
              <div className="space-y-3 rounded-[7px] border border-amber-200/80 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
                <p>Set-up is in progress. Choose delivery again and tap send to get a fresh code.</p>
                <div className="flex flex-wrap gap-4">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="mfa-ch-pending"
                      checked={channelChoice === "email"}
                      onChange={() => setChannelChoice("email")}
                    />
                    Email
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="mfa-ch-pending"
                      checked={channelChoice === "phone"}
                      onChange={() => setChannelChoice("phone")}
                    />
                    Phone (SMS)
                  </label>
                </div>
                {channelChoice === "phone" && (
                  <div>
                    <label className="label-tech mb-1 block">Mobile number</label>
                    <Input
                      type="tel"
                      value={phoneForSetup}
                      onChange={(e) => setPhoneForSetup(e.target.value)}
                      className={pageInputClass}
                      placeholder="+1 305 555 0100"
                      data-testid="mfa-pending-phone"
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" onClick={sendSetupCode} disabled={mfaLoading} className={pageBtnPrimaryClass}>
                    Send verification code
                  </Button>
                  <Button type="button" variant="ghost" onClick={cancelMfa} className={pageBtnOutlineClass}>
                    Cancel set-up
                  </Button>
                </div>
              </div>
            )}
            {setupHint && (
              <p className="text-sm text-slate-600 dark:text-zinc-400">
                Code sent to {setupHint.channel === "phone" ? "phone" : "email"}:{" "}
                <span className="font-medium text-slate-900 dark:text-zinc-200">{setupHint.sent_hint}</span>
              </p>
            )}
            <form onSubmit={enableMfa} className="space-y-3">
              <div>
                <label className="label-tech mb-1 block">6-digit code</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={enableCode}
                  onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  required
                  className={pageInputClass + " max-w-[12rem] text-center text-lg tracking-widest"}
                  data-testid="mfa-enable-code"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="ghost" disabled={mfaLoading} className={pageBtnPrimaryClass} data-testid="mfa-enable-submit">
                  {mfaLoading ? "Saving…" : "Confirm and turn on 2FA"}
                </Button>
                <Button type="button" variant="ghost" onClick={cancelMfa} className={pageBtnOutlineClass}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}

        {!mfaOn && !mfaPending && !setupHint && (
          <div className={cn("space-y-4 p-4 sm:p-6", pageCardClass)}>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-zinc-200">
                <input
                  type="radio"
                  name="mfa-ch"
                  checked={channelChoice === "email"}
                  onChange={() => setChannelChoice("email")}
                  data-testid="mfa-channel-email"
                />
                Email
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-zinc-200">
                <input
                  type="radio"
                  name="mfa-ch"
                  checked={channelChoice === "phone"}
                  onChange={() => setChannelChoice("phone")}
                  data-testid="mfa-channel-phone"
                />
                Phone (SMS)
              </label>
            </div>
            {channelChoice === "phone" && (
              <div>
                <label className="label-tech mb-1 block">Mobile number</label>
                <Input
                  type="tel"
                  value={phoneForSetup}
                  onChange={(e) => setPhoneForSetup(e.target.value)}
                  className={pageInputClass}
                  placeholder="+1 305 555 0100"
                  data-testid="mfa-setup-phone"
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">
                  US numbers: 10 digits or +1… . Codes are stub-logged in development (no real SMS yet).
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={sendSetupCode}
                disabled={mfaLoading}
                className={pageBtnPrimaryClass}
                data-testid="mfa-start-setup"
              >
                {mfaLoading ? "Sending…" : "Send verification code"}
              </Button>
            </div>
          </div>
        )}
      </div>

      <Button
        onClick={logout}
        data-testid="profile-logout-button"
        variant="ghost"
        className={pageBtnPrimaryClass}
      >
        <LogOut className="mr-1 h-4 w-4" strokeWidth={1.5} /> Sign out
      </Button>
    </div>
  );
}
