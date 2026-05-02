import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { LogOut, KeyRound, Loader2 } from "lucide-react";
import {
  pageTitleClass,
  pageSubtextClass,
  pageCardClass,
  pageInputClass,
  pageBtnPrimaryClass,
  pageBtnOutlineClass,
} from "../lib/pageTheme";
import { cn } from "@/lib/utils";
import CalendarsAdmin from "./Calendars";

export default function Profile() {
  const { user, refreshUser, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const stripeParam = searchParams.get("stripe");
  const stripeReason = searchParams.get("reason");
  const stripeBanner =
    stripeParam === "connected"
      ? { kind: "ok", text: "Stripe is connected." }
      : stripeParam === "error"
        ? { kind: "err", text: `Stripe connection failed${stripeReason ? `: ${stripeReason}` : "."}` }
        : null;
  const clearStripeParams = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("stripe");
    next.delete("reason");
    setSearchParams(next, { replace: true });
  };

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwOk, setPwOk] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const [stripeStatus, setStripeStatus] = useState(null); // null=loading
  const [stripeErr, setStripeErr] = useState("");
  const [stripeBusy, setStripeBusy] = useState(false);

  useEffect(() => {
    if (!user || user.role !== "admin") return;
    api
      .get("/integrations/stripe/status")
      .then((r) => setStripeStatus(r.data))
      .catch(() => setStripeStatus({ configured: false, connected: false, account_id: null }));
  }, [user]);

  if (!user) return null;


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
    <div className="space-y-8 max-md:pb-4" data-testid="profile-page">
      <div>
        <div className="label-tech">Profile</div>
        <h1 className={pageTitleClass}>{user.name}</h1>
      </div>

      {stripeBanner && (
        <div
          className={cn(
            "rounded-[7px] border px-4 py-3 text-sm",
            stripeBanner.kind === "ok"
              ? "border-emerald-200/90 bg-emerald-50 text-emerald-950 dark:border-emerald-800/40 dark:bg-emerald-950/25 dark:text-emerald-100"
              : "border-red-200/90 bg-red-50 text-red-950 dark:border-red-900/40 dark:bg-red-950/25 dark:text-red-100"
          )}
          role="status"
        >
          <div className="flex items-center justify-between gap-3">
            <span>{stripeBanner.text}</span>
            <button
              type="button"
              className="text-xs underline underline-offset-2"
              onClick={clearStripeParams}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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

      {user?.role === "admin" && (
        <div className="pt-4">
          <div className="label-tech">ACCOUNTS</div>
          <div className="mt-4 space-y-4">
            <CalendarsAdmin embedded />
            <div>
              <div className="label-tech">PAYMENT PROCESSING</div>
              <div className={cn(pageCardClass, "mt-4 p-4 sm:p-6")}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    {stripeStatus == null ? (
                      <div className="text-sm text-slate-600 dark:text-zinc-400">Loading…</div>
                    ) : stripeStatus.configured ? (
                      stripeStatus.connected ? (
                        <div className="text-sm text-slate-700 dark:text-zinc-300">
                          Connected{stripeStatus.account_id ? ` · ${stripeStatus.account_id}` : ""}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-600 dark:text-zinc-400">Not connected</div>
                      )
                    ) : (
                      <div className="text-sm text-slate-600 dark:text-zinc-400">Stripe is not configured on the server.</div>
                    )}
                    {stripeErr && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{stripeErr}</div>}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {stripeStatus?.configured && !stripeStatus?.connected && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={stripeBusy}
                        className={cn("h-9", pageBtnPrimaryClass)}
                        onClick={async () => {
                          setStripeErr("");
                          setStripeBusy(true);
                          try {
                            const { data } = await api.post("/integrations/stripe/start");
                            window.location.href = data.authorization_url;
                          } catch (e) {
                            setStripeErr(formatApiError(e?.response?.data?.detail) || "Could not start Stripe connection.");
                            setStripeBusy(false);
                          }
                        }}
                      >
                        {stripeBusy ? "Connecting…" : "Connect Stripe"}
                      </Button>
                    )}
                    {stripeStatus?.configured && stripeStatus?.connected && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={stripeBusy}
                        className={cn("h-9", pageBtnOutlineClass)}
                        onClick={async () => {
                          if (!window.confirm("Disconnect Stripe from this workspace?")) return;
                          setStripeErr("");
                          setStripeBusy(true);
                          try {
                            await api.post("/integrations/stripe/disconnect");
                            const { data } = await api.get("/integrations/stripe/status");
                            setStripeStatus(data);
                          } catch (e) {
                            setStripeErr(formatApiError(e?.response?.data?.detail) || "Could not disconnect Stripe.");
                          } finally {
                            setStripeBusy(false);
                          }
                        }}
                      >
                        Disconnect
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
