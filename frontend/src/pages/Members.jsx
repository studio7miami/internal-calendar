import React, { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Copy, Mail, Info } from "lucide-react";
import {
  pageTitleClass,
  pageSubtextClass,
  pageInputClass,
  pageBtnPrimaryClass,
  pageBtnOutlineClass,
} from "../lib/pageTheme";
import { cn } from "@/lib/utils";
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
import MemberSummaryDialog from "../components/members/MemberSummaryDialog";
import { formatSauceLabel } from "../lib/memberSauce";

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
        intent: "Can control which calendars a specific member has access to.",
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
  "md:hover:bg-slate-900/10 md:hover:text-black md:dark:hover:bg-white/[0.08] md:dark:hover:text-zinc-100";

const glassIconBtnClass = cn(
  "min-h-8 w-8 shrink-0 p-0 inline-flex items-center justify-center rounded-[7px]",
  "border border-white/30 bg-white/0 text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] transition-colors",
  "dark:border-white/10 dark:bg-white/0 dark:text-zinc-200 dark:shadow-[0_1px_3px_rgba(0,0,0,0.45)]",
  glassBarHoverClass
);

export default function Members({ previewRole }) {
  const { user: authUser, loading, refreshUser } = useAuth();
  const isPreview = process.env.NODE_ENV === "development" && !!previewRole;
  const me = isPreview ? buildPreviewMe(previewRole) : authUser;
  const isFullAdmin = me?.role === "admin";
  const isManagerOnly = me?.role === "manager";
  const canAssignCalendars = isFullAdmin || (!isManagerOnly && !!me?.permissions?.assign_member_calendars);

  /** `null` = live team list not loaded yet (skeleton). Preview hydrates from fixtures immediately. */
  const [users, setUsers] = useState(() =>
    process.env.NODE_ENV === "development" && previewRole ? PREVIEW_TEAM_USERS : null
  );
  const [allCals, setAllCals] = useState([]);
  const [calDraft, setCalDraft] = useState({}); // userId -> null | string[] (null = full access)
  const [savingCalFor, setSavingCalFor] = useState(null);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  /** After sending an invite: success message, or failure + optional copy link. */
  const [inviteNotice, setInviteNotice] = useState(null);
  const [invitesVisible, setInvitesVisible] = useState(3);
  const [permCfg, setPermCfg] = useState(null);
  const [permErr, setPermErr] = useState("");
  const [permSaveSuccess, setPermSaveSuccess] = useState(false);
  const [permDirty, setPermDirty] = useState(null);
  const [savingPerms, setSavingPerms] = useState(false);
  const [rolePermHelpOpen, setRolePermHelpOpen] = useState(false);
  const [profileMember, setProfileMember] = useState(null);
  const lastMembersAuthId = useRef(null);

  /** Flat list for the on-page matrix (no category headers); order follows backend sections then unknown keys. */
  const permissionMatrixRows = useMemo(() => {
    const defs = permCfg?.definitions;
    if (!defs?.length) return [];
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const known = new Set(ROLE_PERMISSION_MATRIX_SECTIONS.flatMap((s) => s.keys));
    const ordered = ROLE_PERMISSION_MATRIX_SECTIONS.flatMap((sec) =>
      sec.keys.map((k) => byKey.get(k)).filter(Boolean)
    );
    const orphans = defs.filter((d) => !known.has(d.key));
    return [...ordered, ...orphans];
  }, [permCfg?.definitions]);

  const refresh = useCallback(async () => {
    if (isPreview) return;
    const [u, invitesData] = await Promise.all([
      api.get("/users"),
      api.get("/invites")
        .then((r) => r.data)
        .catch(() => []),
    ]);
    startTransition(() => {
      setUsers(u.data);
      setInvites(Array.isArray(invitesData) ? invitesData : []);
    });
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
    if (isPreview) return;
    if (loading || !authUser) {
      if (!loading && authUser === false) lastMembersAuthId.current = null;
      return;
    }
    let cancelled = false;
    const aid = String(authUser.id);
    const switched = lastMembersAuthId.current != null && lastMembersAuthId.current !== aid;
    lastMembersAuthId.current = aid;
    if (switched) setUsers(null);

    const isAdmin = authUser.role === "admin";
    const canCalDir = isAdmin || !!authUser.permissions?.assign_member_calendars;

    (async () => {
      try {
        const { data } = await api.get("/members/bootstrap");
        if (cancelled) return;
        setUsers(Array.isArray(data.users) ? data.users : []);
        setInvites(Array.isArray(data.invites) ? data.invites : []);
        if (isAdmin && data.permissions) {
          const perm = data.permissions;
          setPermCfg(perm);
          setPermDirty(
            perm?.effective
              ? {
                  member: { ...perm.effective.member },
                  manager: { ...perm.effective.manager },
                }
              : null
          );
          setPermErr("");
        } else if (isAdmin) {
          setPermErr(
            "Could not load permissions. Create `app_config` in Supabase (see supabase/001_app_config.sql)."
          );
          setPermCfg(null);
          setPermDirty(null);
        } else {
          setPermCfg(null);
          setPermDirty(null);
        }
        if (canCalDir && Array.isArray(data.calendars)) setAllCals(data.calendars);
      } catch (e) {
        if (!cancelled) {
          setErr(formatApiError(e?.response?.data?.detail) || "Could not load team data. Try refreshing the page.");
          setUsers([]);
          setInvites([]);
          setPermCfg(null);
          setPermDirty(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isPreview, loading, authUser]);

  const setRole = async (u, role) => {
    if (isPreview) {
      window.alert("Preview mode — role changes are not saved.");
      return false;
    }
    if (u.id === me?.id) return false;
    try {
      await api.patch(`/users/${u.id}/role`, { role });
      await refresh();
      return true;
    } catch (e) {
      alert(formatApiError(e?.response?.data?.detail) || "Could not change role");
      return false;
    }
  };

  const handleDialogRoleChange = async (u, role) => {
    const ok = await setRole(u, role);
    if (ok) setProfileMember((prev) => (prev && prev.id === u.id ? { ...prev, role } : prev));
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
    setInviteNotice(null);
    try {
      const { data } = await api.post("/invites", { email });
      if (data.email_sent) {
        setInviteNotice({ kind: "success", email: data.email, copyLink: data.invite_link });
      } else {
        setInviteNotice({
          kind: "fail",
          message: typeof data.email_error === "string" ? data.email_error : "Email could not be sent.",
          copyLink: data.invite_link,
        });
      }
      setEmail("");
      refresh();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Failed");
    }
  };

  const copy = (txt) => {
    navigator.clipboard.writeText(txt);
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
        <div className="label-tech">
          {isFullAdmin ? "Admin" : "Team"}
        </div>
        <h1 className={pageTitleClass}>{isFullAdmin ? "Invite the team." : "Members"}</h1>
        {!isFullAdmin && (
          <p className={pageSubtextClass}>
            {isManagerOnly
              ? "Tap a name for details."
              : "Choose which resource calendars each person can see. Admins always see every calendar."}
          </p>
        )}
      </div>

      <form onSubmit={invite} className={cn("space-y-3 rounded-[7px] p-4", calDialogSurface, !isFullAdmin && "hidden")}>
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
        <p className="text-xs leading-relaxed text-black dark:text-zinc-500">
          Note: Invites are single-use and expire in 7 days.
        </p>
        {err && <div className="text-sm text-red-600 dark:text-red-400">{err}</div>}
        {inviteNotice?.kind === "success" && (
          <div className="space-y-2" data-testid="invite-email-success" role="status">
            <div className="rounded-[7px] border border-emerald-200/90 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-800/40 dark:bg-emerald-950/25 dark:text-emerald-100">
              Invitation emailed to <span className="font-medium">{inviteNotice.email}</span>.
            </div>
            {inviteNotice.copyLink && (
              <div className="flex flex-wrap items-center gap-2 rounded-[7px] border border-gray-200/90 bg-white/60 px-2 py-1.5 text-xs dark:border-white/10 dark:bg-white/[0.04]">
                <code className="min-w-0 flex-1 truncate text-slate-800 dark:text-zinc-200">{inviteNotice.copyLink}</code>
                <button
                  type="button"
                  onClick={() => copy(inviteNotice.copyLink)}
                  className="shrink-0 rounded-[7px] border border-gray-200/90 px-2 py-1 text-slate-700 dark:border-white/20 dark:text-zinc-300"
                  data-testid="copy-invite-link"
                >
                  <Copy className="mr-1 inline h-3 w-3" strokeWidth={1.5} /> Copy link
                </button>
              </div>
            )}
          </div>
        )}
        {inviteNotice?.kind === "fail" && (
          <div className="space-y-2" data-testid="invite-email-fail">
            <div className="rounded-[7px] border border-amber-200/90 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100">
              {inviteNotice.message}
            </div>
            {inviteNotice.copyLink && (
              <div className="flex flex-wrap items-center gap-2 rounded-[7px] border border-gray-200/90 bg-white/60 px-2 py-1.5 text-xs dark:border-white/10 dark:bg-white/[0.04]">
                <code className="min-w-0 flex-1 truncate text-slate-800 dark:text-zinc-200">{inviteNotice.copyLink}</code>
                <button
                  type="button"
                  onClick={() => copy(inviteNotice.copyLink)}
                  className="shrink-0 rounded-[7px] border border-gray-200/90 px-2 py-1 text-slate-700 dark:border-white/20 dark:text-zinc-300"
                  data-testid="copy-failed-invite-link"
                >
                  <Copy className="mr-1 inline h-3 w-3" strokeWidth={1.5} /> Copy link
                </button>
              </div>
            )}
          </div>
        )}
      </form>

      <div className="space-y-4">
        <div>
          <div className="label-tech mb-3">Team</div>
          {users === null && (
            <div className="grid gap-2" aria-busy="true" data-testid="members-team-skeleton">
              {[1, 2, 3].map((k) => (
                <div
                  key={k}
                  className="h-[4.5rem] animate-pulse rounded-[7px] bg-slate-100/90 dark:bg-white/[0.06]"
                />
              ))}
            </div>
          )}
          <div className={cn("grid gap-2", users === null && "hidden")}>
            {(users ?? []).map((u) => (
              <div
                key={u.id}
                className={cn(
                  "space-y-3 rounded-[7px] border border-gray-200/95 bg-[#FAFAFA] px-4 py-3 text-slate-900 dark:border-white/70 dark:bg-zinc-950 dark:text-zinc-200",
                  u.is_disabled && "opacity-50"
                )}
                data-testid={`user-row-${u.id}`}
              >
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <button
                    type="button"
                    data-testid={`user-open-profile-${u.id}`}
                    onClick={() => setProfileMember(u)}
                    className={cn(
                      "min-w-0 flex-1 text-left font-medium text-slate-900 md:hover:underline dark:text-zinc-100",
                      "rounded-[7px] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50 dark:focus-visible:ring-zinc-500/50"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{u.name}</span>
                      {u.is_disabled && (
                        <span className="label-tech shrink-0 rounded-[7px] border border-red-200 bg-red-50 px-1.5 py-0.5 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                          Disabled
                        </span>
                      )}
                    </span>
                  </button>
                  <span
                    className="shrink-0 text-sm font-medium text-slate-600 dark:text-zinc-400"
                    data-testid={`user-sauce-${u.id}`}
                  >
                    {formatSauceLabel(u.sauce ?? u.member_sauce)}
                  </span>
                </div>

                {canAssignCalendars && u.role !== "admin" && allCals.length > 0 && (
                  <div className="space-y-2 border-t border-slate-200/60 pt-3 dark:border-white/[0.08]">
                    <div className="label-tech">CALENDAR ACCESS</div>
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
          <div data-testid="role-permissions-section">
            <div className="mb-3 flex items-center justify-between gap-3">
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
                {rolePermHelpOpen && (
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
                )}
              </DialogContent>
            </Dialog>
            <div className={cn("space-y-4 rounded-[7px] px-4 py-3", calDialogSurface)}>
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
                    {permissionMatrixRows.map((d) => (
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
          </div>
        )}

        <div className={cn(!isFullAdmin && "hidden")}>
          <div className="label-tech mb-3">Invites</div>
          <div className="grid gap-2">
            {invites.length === 0 && (
              <div className="text-sm text-black dark:text-white">No invites yet.</div>
            )}
            {invites.slice(0, invitesVisible).map((i) => (
              <div
                key={i.id}
                className={cn("flex items-center justify-between gap-3 rounded-[7px] px-4 py-3 text-sm", calDialogSurface)}
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
            {invites.length > invitesVisible && (
              <button
                type="button"
                className={cn("w-full rounded-[7px] py-2 text-sm font-medium text-slate-700 dark:text-zinc-300", pageBtnOutlineClass)}
                data-testid="invites-load-more"
                onClick={() => setInvitesVisible((n) => Math.min(n + 3, invites.length))}
              >
                Load more ({invites.length - invitesVisible} more)
              </button>
            )}
          </div>
        </div>
      </div>

      <MemberSummaryDialog
        open={!!profileMember}
        onOpenChange={(v) => !v && setProfileMember(null)}
        member={profileMember}
        viewer={me}
        disableEdits={isPreview}
        onRoleChange={isFullAdmin ? handleDialogRoleChange : undefined}
        onProfileSaved={async () => {
          await refresh();
        }}
        refreshUser={refreshUser}
        onRemoved={() => {
          setProfileMember(null);
          refresh();
        }}
      />
    </div>
  );
}
