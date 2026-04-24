import React, { useEffect, useState } from "react";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Copy, Mail, Ban, CircleCheck } from "lucide-react";
import { pageTitleClass, pageSubtextClass, pageCardClass, pageInputClass, pageBtnPrimaryClass } from "../lib/pageTheme";
import { cn } from "@/lib/utils";

export default function Members() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [latestLink, setLatestLink] = useState("");
  const [permCfg, setPermCfg] = useState(null);
  const [permErr, setPermErr] = useState("");
  const [permDirty, setPermDirty] = useState(null);
  const [savingPerms, setSavingPerms] = useState(false);

  const refresh = async () => {
    const [u, i] = await Promise.all([api.get("/users"), api.get("/invites")]);
    setUsers(u.data);
    setInvites(i.data);
  };

  const loadPerms = async () => {
    setPermErr("");
    try {
      const { data } = await api.get("/app-config/permissions");
      setPermCfg(data);
      setPermDirty(
        data?.effective
          ? {
              member: { ...data.effective.member },
              manager: { ...data.effective.manager },
            }
          : null
      );
    } catch (e) {
      setPermErr(formatApiError(e?.response?.data?.detail) || "Could not load permissions. Create `app_config` in Supabase (see supabase/001_app_config.sql).");
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    loadPerms();
  }, []);

  const setRole = async (u, role) => {
    if (u.id === me?.id) return;
    try {
      await api.patch(`/users/${u.id}/role`, { role });
      await refresh();
    } catch (e) {
      alert(formatApiError(e?.response?.data?.detail) || "Could not change role");
    }
  };

  const savePerms = async () => {
    if (!permDirty) return;
    setSavingPerms(true);
    setPermErr("");
    try {
      await api.patch("/app-config/permissions", {
        member: permDirty.member,
        manager: permDirty.manager,
      });
      await loadPerms();
    } catch (e) {
      setPermErr(formatApiError(e?.response?.data?.detail) || "Save failed");
    } finally {
      setSavingPerms(false);
    }
  };

  const flipPerm = (row, col, next) => {
    setPermDirty((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [col]: { ...prev[col], [row]: next },
      };
    });
  };

  const invite = async (e) => {
    e.preventDefault();
    setErr("");
    setLatestLink("");
    try {
      const { data } = await api.post("/invites", { email });
      setLatestLink(data.invite_link);
      setEmail("");
      refresh();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Failed");
    }
  };

  const copy = (txt) => {
    navigator.clipboard.writeText(txt);
  };

  const toggleDisabled = async (u) => {
    const next = !u.is_disabled;
    const verb = next ? "disable" : "re-enable";
    if (!window.confirm(`Are you sure you want to ${verb} ${u.name}'s account?`)) return;
    try {
      await api.patch(`/users/${u.id}/disable`, { disabled: next });
      refresh();
    } catch (e) {
      alert(formatApiError(e?.response?.data?.detail) || "Action failed");
    }
  };

  return (
    <div className="space-y-8" data-testid="members-page">
      <div>
        <div className="label-tech">Admin</div>
        <h1 className={pageTitleClass}>Invite the team.</h1>
        <p className={pageSubtextClass}>Note: Invites are single-use and expire in 7 days.</p>
      </div>

      <form onSubmit={invite} className={cn("space-y-3 p-4", pageCardClass)}>
        <div className="label-tech">Send invite</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <Input
            type="email"
            placeholder="member@studio7.miami"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            data-testid="invite-email-input"
            className={pageInputClass}
          />
          <Button type="submit" data-testid="send-invite-button" variant="ghost" className={cn("whitespace-nowrap", pageBtnPrimaryClass)}>
            <Mail className="mr-1 h-4 w-4" strokeWidth={1.5} /> Send invite
          </Button>
        </div>
        {err && <div className="text-sm text-red-600 dark:text-red-400">{err}</div>}
        {latestLink && (
          <div
            className="rounded-[7px] border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
            data-testid="invite-link-display"
          >
            <div className="label-tech mb-1 text-emerald-800 dark:text-emerald-300">Invite link (stubbed email)</div>
            <div className="flex items-center gap-2">
              <code className="truncate font-sans text-xs tabular-nums text-emerald-900 dark:text-emerald-200">{latestLink}</code>
              <button
                onClick={() => copy(latestLink)}
                className="ml-auto text-emerald-800 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-white"
                data-testid="copy-invite-link"
                type="button"
              >
                <Copy className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}
      </form>

      <div className="space-y-4">
        <div>
          <div className="label-tech mb-3">Team</div>
          <div className="grid gap-2">
            {users.map((u) => (
              <div
                key={u.id}
                className={cn(
                  "flex items-center justify-between gap-3 px-4 py-3",
                  pageCardClass,
                  u.is_disabled && "opacity-50"
                )}
                data-testid={`user-row-${u.id}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 truncate text-sm font-medium text-slate-900 dark:text-white">
                    {u.name}
                    {u.is_disabled && (
                      <span className="label-tech rounded-[7px] border border-red-200 bg-red-50 px-1.5 py-0.5 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="label-tech truncate text-slate-500 dark:text-neutral-400">{u.email}</div>
                </div>
                <div className="flex items-center gap-2 min-w-0 max-w-full flex-wrap sm:flex-nowrap sm:justify-end">
                  {u.id !== me?.id ? (
                    <select
                      value={u.role}
                      onChange={(e) => setRole(u, e.target.value)}
                      className="label-tech max-w-[140px] rounded-[7px] border border-gray-200/80 bg-white px-2 py-1.5 text-slate-900 dark:border-white/20 dark:bg-zinc-900 dark:text-zinc-200"
                      data-testid={`user-role-select-${u.id}`}
                    >
                      <option value="member">member</option>
                      <option value="manager">manager</option>
                      <option value="admin">admin</option>
                    </select>
                  ) : (
                    <span
                      className={cn(
                        "label-tech rounded-[7px] border px-2 py-0.5",
                        u.role === "admin"
                          ? "border-slate-300 text-slate-900 dark:border-white dark:text-white"
                          : "border-gray-200/80 text-slate-500 dark:border-white/20 dark:text-neutral-400"
                      )}
                    >
                      {u.role} (you)
                    </span>
                  )}
                  {u.role !== "admin" && (
                    <button
                      type="button"
                      onClick={() => toggleDisabled(u)}
                      data-testid={`toggle-disabled-${u.id}`}
                      title={u.is_disabled ? "Re-enable account" : "Disable account"}
                      className={cn(
                        "rounded-[7px] border px-3 py-2 transition-colors",
                        u.is_disabled
                          ? "border-emerald-200 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-900/70 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                          : "border-red-200 text-red-800 hover:bg-red-50 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950/40"
                      )}
                    >
                      {u.is_disabled ? (
                        <CircleCheck className="h-4 w-4" strokeWidth={1.5} />
                      ) : (
                        <Ban className="h-4 w-4" strokeWidth={1.5} />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {permCfg?.definitions && permDirty && (
          <div className="space-y-3" data-testid="role-permissions-section">
            <div>
              <div className="label-tech mb-2">Role permissions</div>
              <p className={cn(pageSubtextClass, "mb-3")}>
                Admins always have full access. The matrix below sets capabilities for the member and manager account types.
              </p>
            </div>
            <div className={cn("overflow-x-auto p-2", pageCardClass)}>
              <table className="w-full min-w-[360px] text-left text-sm text-slate-800 dark:text-zinc-200">
                <thead>
                  <tr className="label-tech border-b border-slate-200/80 text-slate-500 dark:border-white/10 dark:text-zinc-500">
                    <th className="py-2 pr-2 font-medium">Permission</th>
                    <th className="px-1 py-2 font-medium">Member</th>
                    <th className="px-1 py-2 font-medium">Manager</th>
                    <th className="px-1 py-2 font-medium">Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {permCfg.definitions.map((d) => (
                    <tr key={d.key} className="border-b border-slate-200/50 last:border-0 dark:border-white/5">
                      <td className="py-2.5 pr-2 align-top">{d.label}</td>
                      <td className="px-1 align-middle text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer"
                          checked={!!permDirty.member?.[d.key]}
                          onChange={(e) => flipPerm(d.key, "member", e.target.checked)}
                        />
                      </td>
                      <td className="px-1 align-middle text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer"
                          checked={!!permDirty.manager?.[d.key]}
                          onChange={(e) => flipPerm(d.key, "manager", e.target.checked)}
                        />
                      </td>
                      <td className="px-1 text-center text-xs text-slate-500 dark:text-zinc-500">on</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {permErr && <div className="text-sm text-red-600 dark:text-red-400">{permErr}</div>}
            <Button
              onClick={savePerms}
              disabled={savingPerms}
              data-testid="save-role-permissions"
              className={cn("whitespace-nowrap", pageBtnPrimaryClass)}
            >
              {savingPerms ? "Saving…" : "Save role permissions"}
            </Button>
          </div>
        )}

        <div>
          <div className="label-tech mb-3">Invites</div>
          <div className="grid gap-2">
            {invites.length === 0 && <div className="text-sm text-slate-500 dark:text-neutral-500">No invites yet.</div>}
            {invites.map((i) => (
              <div
                key={i.id}
                className={cn("flex items-center justify-between gap-3 px-4 py-3 text-sm", pageCardClass)}
                data-testid={`invite-row-${i.id}`}
              >
                <div className="min-w-0 text-slate-900 dark:text-white">
                  <div className="truncate">{i.email}</div>
                  <div className="label-tech truncate text-slate-500 dark:text-neutral-400">
                    {i.used ? "used" : "pending"} · exp {new Date(i.expires_at).toLocaleDateString()}
                  </div>
                </div>
                {!i.used && (
                  <button
                    onClick={() => copy(i.invite_link)}
                    className="rounded-[7px] border border-gray-200/90 px-2 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/20 dark:text-neutral-300 dark:hover:bg-zinc-800/50"
                    data-testid={`copy-invite-${i.id}`}
                    type="button"
                  >
                    <Copy className="mr-1 inline h-3 w-3" strokeWidth={1.5} /> Copy link
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
