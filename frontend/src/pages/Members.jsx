import React, { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Copy, Mail, Ban, CircleCheck, Info } from "lucide-react";
import { pageTitleClass, pageSubtextClass, pageCardClass, pageInputClass, pageBtnPrimaryClass } from "../lib/pageTheme";
import { cn } from "@/lib/utils";
import InviteLinkCallout from "../components/invite/InviteLinkCallout";
import {
  buildPreviewMe,
  PREVIEW_CALENDARS_DIRECTORY,
  PREVIEW_INVITES,
  PREVIEW_PERM_CFG,
  PREVIEW_TEAM_USERS,
} from "../lib/memberPreviewFixtures";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Reference copy for the role-permissions help dialog (matrix rows still come from the API). */
const ROLE_PERMISSION_HELP_SECTIONS = [
  {
    category: "VIEWING",
    items: [
      {
        title: "View calendar",
        intent:
          "Can open the calendar and see bookings. Without this, the entire calendar is blocked and they see nothing.",
      },
      {
        title: "See all booking details",
        intent:
          'By default, other people\'s bookings just show as "Booked" — no name, no notes, no detail. Turn this on and they can see the full picture of every booking, not just their own.',
      },
    ],
  },
  {
    category: "BOOKING",
    items: [
      {
        title: "Create booking requests",
        intent:
          "Members can click on an open slot and submit a booking request. The request goes into the admin's queue for approval.",
      },
      {
        title: "Add manual bookings",
        intent:
          "Can add a booking that's instantly confirmed — no request, no approval needed. It goes straight onto the calendar.",
      },
      {
        title: "Delete or cancel any booking",
        intent:
          "Can remove any booking from the calendar — not just their own. Permanent action.",
      },
    ],
  },
  {
    category: "REQUESTS QUEUE",
    items: [
      {
        title: "View and approve / deny requests",
        intent:
          "Can see all pending requests from the whole team and approve or deny them. Without this, a member only sees their own request status — they can't touch anyone else's.",
      },
    ],
  },
  {
    category: "TEAM MANAGEMENT",
    items: [
      {
        title: "View team list",
        intent:
          "Can open the Members page and see who's on the team — names, emails, roles. Also lets them assign a booking to a specific team member when adding one manually.",
      },
      {
        title: "Assign calendars to members",
        intent:
          "Can control which calendars a specific member has access to — like giving a photographer access to Photobooth only. Seven can always do this regardless of this setting.",
      },
    ],
  },
];

/** Category headers for the role-permissions matrix; keys must match backend `PERMISSION_KEYS`. */
const ROLE_PERMISSION_MATRIX_SECTIONS = [
  { category: "VIEWING", keys: ["view_schedule", "see_all_booking_details"] },
  { category: "BOOKING", keys: ["create_request", "create_manual_booking", "delete_any_booking"] },
  { category: "REQUESTS QUEUE", keys: ["approve_deny_requests"] },
  { category: "TEAM MANAGEMENT", keys: ["view_members_directory", "assign_member_calendars"] },
];

/** Match `BookingForm` dialog surface (calendar page booking modal). */
const calDialogSurface =
  "border border-gray-200/95 bg-[#FAFAFA] text-slate-900 dark:border-white/70 dark:bg-zinc-950 dark:text-white";

const glassBarHoverClass =
  "hover:bg-slate-900/10 hover:text-black dark:hover:bg-white/[0.08] dark:hover:text-zinc-100";

const glassIconBtnClass = cn(
  "min-h-8 w-8 shrink-0 p-0 inline-flex items-center justify-center rounded-[7px]",
  "border border-white/30 bg-white/0 text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] transition-colors",
  "dark:border-white/10 dark:bg-white/0 dark:text-zinc-200 dark:shadow-[0_1px_3px_rgba(0,0,0,0.45)]",
  glassBarHoverClass
);

export default function Members({ previewRole }) {
  const { user: authUser, loading } = useAuth();
  const isPreview = process.env.NODE_ENV === "development" && !!previewRole;
  const me = isPreview ? buildPreviewMe(previewRole) : authUser;
  const isFullAdmin = me?.role === "admin";
  const canAssignCalendars = isFullAdmin || !!me?.permissions?.assign_member_calendars;

  const [users, setUsers] = useState([]);
  const [allCals, setAllCals] = useState([]);
  const [calDraft, setCalDraft] = useState({}); // userId -> null | string[] (null = full access)
  const [savingCalFor, setSavingCalFor] = useState(null);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [latestLink, setLatestLink] = useState("");
  const [permCfg, setPermCfg] = useState(null);
  const [permErr, setPermErr] = useState("");
  const [permSaveSuccess, setPermSaveSuccess] = useState(false);
  const [permDirty, setPermDirty] = useState(null);
  const [savingPerms, setSavingPerms] = useState(false);
  const [rolePermHelpOpen, setRolePermHelpOpen] = useState(false);

  const permissionMatrixSections = useMemo(() => {
    const defs = permCfg?.definitions;
    if (!defs?.length) return [];
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const known = new Set(ROLE_PERMISSION_MATRIX_SECTIONS.flatMap((s) => s.keys));
    const sections = ROLE_PERMISSION_MATRIX_SECTIONS.map((sec) => ({
      category: sec.category,
      rows: sec.keys.map((k) => byKey.get(k)).filter(Boolean),
    })).filter((s) => s.rows.length > 0);
    const orphans = defs.filter((d) => !known.has(d.key));
    if (orphans.length) sections.push({ category: "OTHER", rows: orphans });
    return sections;
  }, [permCfg?.definitions]);

  const refresh = useCallback(async () => {
    if (isPreview) return;
    const u = await api.get("/users");
    setUsers(u.data);
    try {
      const i = await api.get("/invites");
      setInvites(i.data);
    } catch {
      setInvites([]);
    }
  }, [isPreview]);

  const loadPerms = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (!isPreview) return;
    setUsers(PREVIEW_TEAM_USERS);
    setInvites(PREVIEW_INVITES);
    setAllCals(PREVIEW_CALENDARS_DIRECTORY);
    setErr("");
    setPermErr("");
    if (isFullAdmin) {
      setPermCfg(PREVIEW_PERM_CFG);
      setPermDirty({
        member: { ...PREVIEW_PERM_CFG.effective.member },
        manager: { ...PREVIEW_PERM_CFG.effective.manager },
      });
    } else {
      setPermCfg(null);
      setPermDirty(null);
    }
  }, [isPreview, previewRole, isFullAdmin]);

  useEffect(() => {
    if (isPreview || loading) return;
    if (!authUser) return;
    refresh();
  }, [isPreview, loading, authUser, refresh]);

  useEffect(() => {
    if (isPreview || !isFullAdmin) return;
    loadPerms();
  }, [isPreview, isFullAdmin, loadPerms]);

  useEffect(() => {
    if (!canAssignCalendars || isPreview) return;
    (async () => {
      try {
        const { data } = await api.get("/calendars/directory");
        setAllCals(data || []);
      } catch {
        setAllCals([]);
      }
    })();
  }, [canAssignCalendars, isPreview]);

  const setRole = async (u, role) => {
    if (isPreview) {
      window.alert("Preview mode — role changes are not saved.");
      return;
    }
    if (u.id === me?.id) return;
    try {
      await api.patch(`/users/${u.id}/role`, { role });
      await refresh();
    } catch (e) {
      alert(formatApiError(e?.response?.data?.detail) || "Could not change role");
    }
  };

  const savePerms = async () => {
    if (isPreview) {
      window.alert("Preview mode — permission changes are not saved.");
      return;
    }
    if (!permDirty) return;
    setSavingPerms(true);
    setPermErr("");
    setPermSaveSuccess(false);
    try {
      await api.patch("/app-config/permissions", {
        member: permDirty.member,
        manager: permDirty.manager,
      });
      // Show "Success!" next to "Saving…" as soon as the write succeeds.
      setPermSaveSuccess(true);
      await loadPerms();
      // One frame so "Success!" + "Saving…" can paint before we clear in `finally` (fast networks batch otherwise).
      await new Promise((resolve) => requestAnimationFrame(resolve));
    } catch (e) {
      setPermErr(formatApiError(e?.response?.data?.detail) || "Save failed");
    } finally {
      // Clear success in the same update as the label returning to "Save role permissions".
      setPermSaveSuccess(false);
      setSavingPerms(false);
    }
  };

  const flipPerm = (row, col, next) => {
    setPermSaveSuccess(false);
    setPermErr("");
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
    if (isPreview) {
      window.alert("Preview mode — invites are not sent.");
      return;
    }
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
    if (isPreview) {
      window.alert("Preview mode — account status is not changed.");
      return;
    }
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

  const effCalIds = (u) =>
    Object.prototype.hasOwnProperty.call(calDraft, u.id) ? calDraft[u.id] : normalizeVis(u.visible_calendar_ids);

  function normalizeVis(v) {
    if (v == null) return null;
    if (Array.isArray(v) && v.length === 0) return [];
    return (Array.isArray(v) ? v : []).map(String);
  }

  const isCalChecked = (u, calId) => {
    const eff = effCalIds(u);
    if (eff === null) return true;
    return eff.includes(calId);
  };

  const toggleCal = (u, calId) => {
    if (u.role === "admin") return;
    setCalDraft((prev) => {
      const cur = Object.prototype.hasOwnProperty.call(prev, u.id) ? prev[u.id] : normalizeVis(u.visible_calendar_ids);
      const allIds = allCals.map((c) => c.id);
      let next;
      if (cur === null) {
        next = allIds.filter((id) => id !== calId);
      } else {
        const have = new Set(cur);
        if (have.has(calId)) have.delete(calId);
        else have.add(calId);
        next = allIds.filter((id) => have.has(id));
      }
      if (next.length === 0) next = [];
      else if (next.length === allIds.length && allIds.length > 0) next = null;
      return { ...prev, [u.id]: next };
    });
  };

  const saveCalendars = async (u) => {
    if (isPreview) {
      window.alert("Preview mode — calendar access is not saved.");
      return;
    }
    if (u.role === "admin") return;
    const v = effCalIds(u);
    setSavingCalFor(u.id);
    setErr("");
    try {
      await api.patch(`/users/${u.id}/visible-calendars`, { visible_calendar_ids: v });
      setCalDraft((d) => {
        const n = { ...d };
        delete n[u.id];
        return n;
      });
      await refresh();
    } catch (e) {
      alert(formatApiError(e?.response?.data?.detail) || "Could not update calendar access");
    } finally {
      setSavingCalFor(null);
    }
  };

  return (
    <div className="space-y-8" data-testid="members-page">
      {isPreview && (
        <div
          className="rounded-[7px] border border-amber-200/90 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100"
          data-testid="members-preview-banner"
        >
          Preview as <span className="font-medium">{previewRole}</span> — data is static and actions do not call the
          server.
        </div>
      )}
      <div>
        <div className="label-tech">{isFullAdmin ? "Admin" : "Team"}</div>
        <h1 className={pageTitleClass}>{isFullAdmin ? "Invite the team." : "Members & calendar access."}</h1>
        <p className={pageSubtextClass}>
          {isFullAdmin
            ? "Note: Invites are single-use and expire in 7 days."
            : "Choose which resource calendars each person can see. Admins always see every calendar."}
        </p>
      </div>

      <form onSubmit={invite} className={cn("space-y-3 p-4", pageCardClass, !isFullAdmin && "hidden")}>
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
        {latestLink && <InviteLinkCallout link={latestLink} onCopy={copy} />}
      </form>

      <div className="space-y-4">
        <div>
          <div className="label-tech mb-3">Team</div>
          <div className="grid gap-2">
            {users.map((u) => (
              <div
                key={u.id}
                className={cn("space-y-3 px-4 py-3", pageCardClass, u.is_disabled && "opacity-50")}
                data-testid={`user-row-${u.id}`}
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
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
                    {isFullAdmin && u.id !== me?.id ? (
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
                    ) : isFullAdmin ? (
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
                    ) : (
                      <span className="label-tech rounded-[7px] border border-gray-200/80 px-2 py-0.5 text-slate-600 dark:text-zinc-400">
                        {u.role}
                      </span>
                    )}
                    {isFullAdmin && u.role !== "admin" && (
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

                {canAssignCalendars && u.role !== "admin" && allCals.length > 0 && (
                  <div className="space-y-2 border-t border-slate-200/60 pt-3 dark:border-white/[0.08]">
                    <div className="label-tech">Calendars they can see</div>
                    <p className="mb-1 mt-0 text-xs text-slate-500 dark:text-zinc-500">
                      Leave all checked for full access (default). Admins always see every calendar regardless of this
                      list.
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      {allCals.map((c) => (
                        <label
                          key={c.id}
                          className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-800 dark:text-zinc-200"
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={isCalChecked(u, c.id)}
                            onChange={() => toggleCal(u, c.id)}
                            data-testid={`user-cal-${u.id}-${c.id}`}
                          />
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ background: c.color || "#999" }}
                          />
                          {c.name}
                        </label>
                      ))}
                      {Object.prototype.hasOwnProperty.call(calDraft, u.id) && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => saveCalendars(u)}
                          disabled={savingCalFor === u.id}
                          className={cn("h-8 text-xs", pageBtnPrimaryClass)}
                          data-testid={`save-user-cal-${u.id}`}
                        >
                          {savingCalFor === u.id ? "Saving…" : "Save access"}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {isFullAdmin && permCfg?.definitions && permDirty && (
          <div className={cn("space-y-4 px-4 py-3", pageCardClass)} data-testid="role-permissions-section">
            <div className="flex items-center justify-between gap-3">
              <div className="label-tech min-w-0">Role permissions</div>
              <button
                type="button"
                onClick={() => setRolePermHelpOpen(true)}
                className={glassIconBtnClass}
                aria-label="What each role permission means"
                data-testid="role-permissions-help"
              >
                <Info className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <Dialog open={rolePermHelpOpen} onOpenChange={setRolePermHelpOpen}>
              <DialogContent
                className={cn(
                  "max-h-[85vh] max-w-2xl gap-0 overflow-y-auto p-0 shadow-lg sm:rounded-[7px]",
                  calDialogSurface
                )}
              >
                <DialogHeader className="border-b border-gray-200/95 px-6 pb-4 pt-6 dark:border-white/20">
                  <DialogTitle className="text-left font-['Manrope',system-ui,sans-serif] text-xl font-semibold tracking-[-0.02em] text-slate-900 dark:text-white sm:text-2xl">
                    Role permissions
                  </DialogTitle>
                  <DialogDescription className="text-left text-sm text-slate-600 dark:text-zinc-400">
                    What each toggle does for member and manager accounts.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-8 px-6 py-5 text-sm text-slate-800 dark:text-zinc-200">
                  {ROLE_PERMISSION_HELP_SECTIONS.map((section) => (
                    <div key={section.category}>
                      <div className="label-tech mb-4 text-xs font-medium tracking-wide text-slate-500 dark:text-zinc-500">
                        {section.category}
                      </div>
                      <dl className="space-y-5">
                        {section.items.map((row) => (
                          <div key={row.title}>
                            <dt className="font-medium text-slate-900 dark:text-white">{row.title}</dt>
                            <dd className="mt-1.5 text-slate-600 dark:text-zinc-400">{row.intent}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
            <div className="-mx-1 overflow-x-auto px-1 sm:-mx-2 sm:px-2">
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
                  {permissionMatrixSections.map((sec) => (
                    <Fragment key={sec.category}>
                      <tr className="border-b border-slate-200/60 bg-slate-100/90 dark:border-white/10 dark:bg-white/[0.04]">
                        <th
                          scope="colgroup"
                          colSpan={4}
                          className="label-tech py-2 pl-2 pr-2 text-left text-[10px] font-semibold tracking-[0.14em] text-slate-600 dark:text-zinc-500"
                        >
                          {sec.category}
                        </th>
                      </tr>
                      {sec.rows.map((d) => (
                        <tr
                          key={d.key}
                          className="border-b border-slate-200/50 last:border-0 dark:border-white/5"
                          data-testid={`role-perm-row-${d.key}`}
                        >
                          <td className="py-2.5 pr-2 align-top pl-2">{d.label}</td>
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
                          <td className="px-1 text-center text-xs text-black dark:text-white">on</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
              data-testid="role-perm-save-row"
            >
              <Button
                onClick={savePerms}
                disabled={savingPerms}
                data-testid="save-role-permissions"
                className={cn("whitespace-nowrap", pageBtnPrimaryClass)}
              >
                {savingPerms ? "Saving…" : "Save role permissions"}
              </Button>
              {savingPerms && permSaveSuccess && !permErr && (
                <span
                  className="text-sm font-medium text-black dark:text-white"
                  data-testid="role-perm-save-success"
                >
                  Success!
                </span>
              )}
              {permErr && (
                <span
                  className="max-w-xl text-sm text-[#0033FF]"
                  data-testid="role-perm-save-error"
                >
                  {permErr}{" "}
                  <span className="whitespace-nowrap">Try again.</span>
                </span>
              )}
            </div>
          </div>
        )}

        <div className={cn(!isFullAdmin && "hidden")}>
          <div className="label-tech mb-3">Invites</div>
          <div className="grid gap-2">
            {invites.length === 0 && (
              <div className="text-sm text-black dark:text-white">No invites yet.</div>
            )}
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
