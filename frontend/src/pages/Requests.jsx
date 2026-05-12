import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiErrorFromAxios } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "react-router-dom";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Textarea } from "../components/ui/textarea";
import { Check, X, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { fmtTimeShort } from "../lib/time";
import {
  pageTitleClass,
  pageCardClass,
  pageTextareaClass,
  pageBtnPrimaryClass,
  pageInputClass,
  glassBarHoverClass,
} from "../lib/pageTheme";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MemberSummaryDialog from "../components/members/MemberSummaryDialog";

const PREVIEW_LIMIT = 7;

/** Pending queue: earliest submission first (FIFO), then member name. */
function sortPendingByReceivedThenMember(a, b) {
  const ca = String(a.created_at || "");
  const cb = String(b.created_at || "");
  const byTime = ca.localeCompare(cb);
  if (byTime !== 0) return byTime;
  const na = String(a.member_name || a.member_email || "");
  const nb = String(b.member_name || b.member_email || "");
  return na.localeCompare(nb);
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfWeek(d) {
  const x = new Date(d);
  const wd = x.getDay();
  x.setDate(x.getDate() - wd);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function endOfWeekFrom(d) {
  const s = startOfWeek(d);
  return addDays(s, 6);
}
function firstYmdOfMonth(d) {
  return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
}
function lastYmdOfMonth(d) {
  return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

/** e.g. April 06, 2026 */
function fmtRequestDisplayDate(ymdStr) {
  if (!ymdStr || typeof ymdStr !== "string") return "";
  const d = new Date(`${ymdStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymdStr;
  return d.toLocaleDateString(undefined, { month: "long", day: "2-digit", year: "numeric" });
}

function rgbaFromHex(hex, alpha) {
  const h = (hex || "#888").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return `rgba(100,116,139,${alpha})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function FieldCircle({ colorHex, title, compact }) {
  const base = colorHex || "#64748b";
  const glow = compact ? `0 0 8px 1px ${rgbaFromHex(base, 0.45)}` : `0 0 12px 2px ${rgbaFromHex(base, 0.55)}`;
  return (
    <span
      title={title}
      aria-hidden
      className={cn(
        "inline-block shrink-0 self-center rounded-full ring-1 ring-black/10 dark:ring-white/15",
        compact ? "h-2.5 w-2.5" : "h-2.5 w-2.5"
      )}
      style={{
        backgroundColor: base,
        boxShadow: glow,
      }}
    />
  );
}

const requestsToolbarBtnClass = cn(
  "min-h-8 box-border inline-flex items-center justify-center border border-white/30 bg-white/80 text-xs leading-none text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] backdrop-blur-md transition-colors dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:shadow-[0_1px_3px_rgba(0,0,0,0.45)] rounded-[7px] px-2.5 sm:px-3",
  glassBarHoverClass
);

const requestsDialogNavBtnClass = cn(
  "min-h-8 box-border inline-flex h-8 w-8 shrink-0 items-center justify-center border border-white/30 bg-white/80 p-0 text-xs leading-none text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] backdrop-blur-md transition-colors dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:shadow-[0_1px_3px_rgba(0,0,0,0.45)] rounded-[7px]",
  glassBarHoverClass
);

function StatusBadge({ status, compact }) {
  const map = {
    pending:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:text-amber-300 dark:bg-amber-950/40",
    approved:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-950/40",
    denied: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:text-red-300 dark:bg-red-950/40",
  };
  const labels = { pending: "Pending", approved: "Accepted", denied: "Declined" };
  return (
    <span
      className={cn(
        "label-tech border rounded-[7px]",
        compact ? "px-1.5 py-0.5 text-xs uppercase tracking-wide" : "px-2 py-0.5",
        map[status] || map.pending
      )}
    >
      {labels[status] || status}
    </span>
  );
}

function RequestCard({
  b,
  calendars,
  canModerate,
  msg,
  setMsg,
  amount = {},
  setAmount = () => {},
  act,
  calName,
  setProfileMember,
  compact = false,
  assignableMembers = [],
  assignDraft = {},
  setAssignDraft = () => {},
  assignSavingId = null,
  onSaveAssign = () => {},
  resolveFlash = null,
}) {
  const cal = calendars.find((c) => c.id === b.calendar_id);
  const color = cal?.color || "#64748b";
  const needsPay = Boolean(b?.payment_required && b?.payment_status !== "paid" && b?.stripe_checkout_url && b?.status === "approved");
  const paid = Boolean(b?.payment_status === "paid");
  const calTitle = calName(b.calendar_id);
  const isPhotobooth = /photobooth/i.test(String(cal?.name || calTitle || ""));

  const stripVenueFromText = (s) => {
    if (!s) return "";
    let t = String(s).trim();
    t = t.replace(/\s*\n+\s*/g, " ").trim();
    t = t.replace(/^Google Calendar ·\s*/i, "").trim();
    t = t.replace(/^studio\s+7\s+miami\s*[·\-–—@|:]\s*/i, "").trim();
    // Hard remove any parenthetical containing "Studio 7" (never show).
    // Some sources may use full-width parentheses （ ）.
    t = t.replace(/\s*[（(]\s*[^）)]*studio\s*7[^）)]*[)）]\s*/gi, " ").trim();
    // Also remove any remaining bare venue mentions (sometimes imported without parentheses).
    t = t.replace(/\bstudio\s*7\s*miami\b/gi, " ").trim();
    t = t.replace(/\bstudio\s*7\b/gi, " ").trim();
    t = t.replace(/\s+at\s+studio\s+7\s+miami\b/gi, "").trim();
    t = t.replace(/\s*[@·,;|]\s*studio\s+7\s+miami\b/gi, "").trim();
    let prev;
    do {
      prev = t;
      t = t.replace(/\s*(?:@|·|\||—|-)\s*studio\s+7\s+miami\s*$/i, "").trim();
    } while (t !== prev);
    if (/^studio\s+7\s+miami$/i.test(t)) return "";
    // Cleanup leftover empty parens / punctuation after removals.
    t = t.replace(/[（(]\s*[)）]/g, " ").trim();
    // Remove any leading/trailing separators left behind by venue stripping.
    t = t.replace(/^\s*(?:@|·|\||—|-|:|,|;)\s*/g, "").trim();
    t = t.replace(/\s*[:·\-–—]\s*$/g, "").trim();
    t = t.replace(/\s{2,}/g, " ").trim();
    return t;
  };

  const notesText = stripVenueFromText(b.notes);

  const memberOptions = useMemo(() => {
    const o = [...(assignableMembers || [])];
    if (b.member_id && !o.some((u) => String(u.id) === String(b.member_id))) {
      o.unshift({
        id: b.member_id,
        name: b.member_name || "Assignee",
        email: b.member_email || "",
      });
    }
    return o;
  }, [assignableMembers, b.member_email, b.member_id, b.member_name]);

  const effectiveAssign =
    assignDraft[b.id] !== undefined ? assignDraft[b.id] : b.member_id || "";

  return (
    <div
      className={cn("relative overflow-hidden", compact ? "p-3 mb-2" : "p-4", pageCardClass)}
      data-testid={`request-card-${b.id}`}
    >
      {/* Calendar account indicator (top-right) */}
      <div className={cn("absolute right-3 top-3", compact && "right-2.5 top-2.5")}>
        <FieldCircle colorHex={color} title={calTitle} compact={false} />
      </div>
      <div className={cn("flex items-start", compact ? "gap-2" : "gap-4", "flex-col sm:flex-row", "text-left")}>
        <div className={cn("min-w-0 flex-1 text-left", compact ? "space-y-1.5" : "space-y-2")}>
          {resolveFlash === "approve" && b.status === "approved" && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-[7px] border border-emerald-200/90 bg-emerald-50/95 px-3 py-2 text-sm font-medium text-emerald-950 dark:border-emerald-800/70 dark:bg-emerald-950/35 dark:text-emerald-100",
                compact && "py-1.5 text-xs"
              )}
              role="status"
              data-testid={`request-accepted-flash-${b.id}`}
            >
              <Check className={cn("shrink-0 text-emerald-700 dark:text-emerald-300", compact ? "h-3.5 w-3.5" : "h-4 w-4")} strokeWidth={2} />
              You accepted this request.
            </div>
          )}
          {resolveFlash === "deny" && b.status === "denied" && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-[7px] border border-red-200/90 bg-red-50/95 px-3 py-2 text-sm font-medium text-red-950 dark:border-red-900/70 dark:bg-red-950/35 dark:text-red-100",
                compact && "py-1.5 text-xs"
              )}
              role="status"
              data-testid={`request-declined-flash-${b.id}`}
            >
              <X className={cn("shrink-0 text-red-700 dark:text-red-300", compact ? "h-3.5 w-3.5" : "h-4 w-4")} strokeWidth={2} />
              Request declined.
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className={cn("flex min-w-0 flex-1 flex-nowrap items-center gap-2")}>
              <StatusBadge status={b.status} compact={compact} />
              <span
                className={cn(
                  "label-tech min-w-0 flex-1 truncate text-left text-slate-600 dark:text-neutral-400",
                  compact && "text-xs uppercase tracking-wide"
                )}
              >
                {calTitle}
              </span>
            </div>
          </div>
          <div
            className={cn(
              "font-semibold text-left text-slate-900 dark:text-white",
              compact ? "text-[10px] leading-snug sm:text-xs" : "text-xs leading-snug sm:text-base"
            )}
          >
            {fmtRequestDisplayDate(b.date)} · {fmtTimeShort(b.start_time)}–{fmtTimeShort(b.end_time)}
          </div>
          {canModerate && b.member_name && (
            <div className={cn("text-left text-slate-500 dark:text-neutral-400", "text-xs leading-snug")}>
              <button
                type="button"
                className={cn(
                  "font-medium text-left text-slate-800 md:hover:underline dark:text-zinc-200",
                  "text-xs"
                )}
                onClick={() =>
                  setProfileMember({
                    id: b.member_id,
                    name: b.member_name,
                    email: b.member_email,
                    phone_e164: b.member_phone_e164,
                    sauce: b.member_sauce,
                    role: "member",
                  })
                }
              >
                {b.member_name}
              </button>
              <span className="text-slate-400 dark:text-zinc-600"> · </span>
              <span className="text-xs text-slate-700 tabular-nums dark:text-zinc-400">{b.member_email}</span>
            </div>
          )}
          {notesText && (
            <div
              className={cn(
                "text-left text-slate-600 dark:text-neutral-400",
                compact ? "text-xs leading-snug" : "text-xs leading-snug"
              )}
            >
              <span className="font-medium">Notes:</span> <span>{notesText}</span>
            </div>
          )}
          {b.approval_message && (
            <div
              className={cn(
                "text-slate-500 dark:text-neutral-500",
                compact ? "text-[10px] leading-snug" : "text-xs"
              )}
            >
              Message: {b.approval_message}
            </div>
          )}
          {(needsPay || paid) && (
            <div className={cn("mt-1 flex flex-wrap items-center gap-2", compact ? "text-xs" : "text-sm")}>
              {paid ? (
                <span className="label-tech rounded-[7px] border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                  Paid
                </span>
              ) : (
                <span className="label-tech rounded-[7px] border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  Payment needed
                </span>
              )}
              {needsPay && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => window.open(b.stripe_checkout_url, "_blank", "noopener,noreferrer")}
                  className={cn(pageBtnPrimaryClass, compact && "h-8 text-xs")}
                  data-testid={`pay-${b.id}`}
                >
                  Pay now
                </Button>
              )}
            </div>
          )}
        </div>

        {canModerate && b.status === "pending" && (
          <div
            className={cn(
              "flex w-full flex-col sm:w-auto",
              compact ? "gap-1.5 sm:min-w-[11rem]" : "gap-2 sm:min-w-[240px]"
            )}
          >
            <div className={cn("flex items-center gap-2", compact ? "flex-wrap" : "")}>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="Amount (USD)"
                value={amount[b.id] || ""}
                onChange={(e) => setAmount((m) => ({ ...m, [b.id]: e.target.value }))}
                className={cn(
                  pageInputClass,
                  "w-[9.5rem] shrink-0 tabular-nums text-right",
                  compact && "h-9 text-xs"
                )}
                data-testid={`request-amount-${b.id}`}
              />
            </div>
            <Textarea
              placeholder="Optional message to member…"
              value={msg[b.id] || ""}
              onChange={(e) => setMsg((m) => ({ ...m, [b.id]: e.target.value }))}
              rows={2}
              data-testid={`request-message-${b.id}`}
              className={cn(pageTextareaClass, compact && "min-h-[3.75rem] py-2 text-xs")}
            />
            <div className={cn("flex", compact ? "gap-1.5" : "gap-2")}>
              <Button
                onClick={() => act(b.id, "deny")}
                data-testid={`deny-${b.id}`}
                variant="ghost"
                className={cn(
                  "flex-1 rounded-[7px] border border-red-200 text-red-700 md:hover:bg-red-50 dark:border-red-900/70 dark:text-red-300 md:dark:hover:bg-red-950/40",
                  compact ? "h-8 text-xs" : "h-10"
                )}
              >
                <X className={cn("mr-1 shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} strokeWidth={1.5} /> Deny
              </Button>
              <Button
                onClick={() => act(b.id, "approve")}
                data-testid={`accept-${b.id}`}
                variant="ghost"
                className={cn("flex-1", pageBtnPrimaryClass, compact && "h-8 text-xs")}
              >
                <Check className={cn("mr-1 shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} strokeWidth={1.5} />{" "}
                {(amount[b.id] || "").trim() ? "Accept & send checkout" : "Accept"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {canModerate && b.status === "approved" && memberOptions.length > 0 && (
        <div
          className={cn(
            "border-t border-slate-200/80 dark:border-white/10",
            compact ? "mt-2 pt-2" : "mt-3 pt-3"
          )}
        >
          <div className="text-xs font-medium text-slate-600 dark:text-zinc-400">Assigned member</div>
          <div className={cn("mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center")}>
            <Select
              value={effectiveAssign ? String(effectiveAssign) : "__none__"}
              onValueChange={(v) =>
                setAssignDraft((m) => ({
                  ...m,
                  [b.id]: v === "__none__" ? "" : v,
                }))
              }
            >
              <SelectTrigger
                className={cn(pageInputClass, "h-9 w-full text-left text-xs sm:w-[min(100%,20rem)]")}
                data-testid={`assign-member-${b.id}`}
              >
                <SelectValue placeholder="Choose member" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs">
                  — Unassigned —
                </SelectItem>
                {memberOptions.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)} className="text-xs">
                    {u.name}
                    {u.email ? ` · ${u.email}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              className={cn(pageBtnPrimaryClass, "h-9 shrink-0 text-xs")}
              disabled={
                assignSavingId === b.id ||
                !effectiveAssign ||
                String(effectiveAssign) === String(b.member_id || "")
              }
              onClick={() => onSaveAssign(b.id, String(effectiveAssign))}
              data-testid={`assign-save-${b.id}`}
            >
              {assignSavingId === b.id ? "Saving…" : "Save assignment"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Requests() {
  const { user } = useAuth();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [items, setItems] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [msg, setMsg] = useState({});
  const [amount, setAmount] = useState({});
  const [profileMember, setProfileMember] = useState(null);
  const [allRequestsOpen, setAllRequestsOpen] = useState(false);
  const [allReqGranularity, setAllReqGranularity] = useState("week");
  const [allReqCursor, setAllReqCursor] = useState(() => new Date());
  const [statusTab, setStatusTab] = useState("pending"); // pending | approved | denied
  /** While on Pending, keep resolving request visible briefly after accept/deny (id → API verb). */
  const [resolveFlashById, setResolveFlashById] = useState({});
  const [assignableMembers, setAssignableMembers] = useState([]);
  const [assignDraft, setAssignDraft] = useState({});
  const [assignSavingId, setAssignSavingId] = useState(null);

  const canModerate = !!user?.permissions?.approve_deny_requests;

  const refresh = async () => {
    const [r, c] = await Promise.all([
      api.get("/bookings/requests"),
      api.get("/calendars"),
    ]);
    setItems(r.data);
    setCalendars(c.data);
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!canModerate) {
      setAssignableMembers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get("/bookings/assignable-members");
        if (!cancelled) setAssignableMembers(r.data || []);
      } catch {
        if (!cancelled) setAssignableMembers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canModerate]);

  useEffect(() => {
    if (!location?.search) return;
    const sp = new URLSearchParams(location.search);
    const openId = sp.get("open");
    if (!openId) return;
    if (!canModerate) return;
    if (!items || items.length === 0) return;
    const b = items.find((x) => String(x.id) === String(openId));
    if (!b?.date) return;
    setAllReqCursor(new Date(`${b.date}T12:00:00`));
    setAllReqGranularity("week");
    setAllRequestsOpen(true);
  }, [location?.search, items, canModerate]);

  useEffect(() => {
    if (items.length === 0) setAllRequestsOpen(false);
  }, [items.length]);

  const calName = (id) => calendars.find((c) => c.id === id)?.name || String(id ?? "");

  const dollarsToCents = (s) => {
    const v = Number(String(s || "").replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(v) || v <= 0) return 0;
    return Math.round(v * 100);
  };

  const act = async (id, verb) => {
    try {
      await api.post(`/bookings/${id}/${verb}`, { message: msg[id] || "" });
      if (verb === "approve") {
        const cents = dollarsToCents(amount[id]);
        if (cents > 0) {
          await api.post(`/bookings/${id}/payment/checkout`, { amount_cents: cents, currency: "usd" });
        }
      }
      setMsg((m) => ({ ...m, [id]: "" }));
      setAmount((m) => ({ ...m, [id]: "" }));
      await refresh();
      setResolveFlashById((prev) => ({ ...prev, [id]: verb }));
      window.setTimeout(() => {
        setResolveFlashById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 12000);
    } catch (e) {
      alert(formatApiErrorFromAxios(e));
    }
  };

  const onSaveAssign = async (bookingId, memberId) => {
    if (!memberId) return;
    setAssignSavingId(bookingId);
    try {
      await api.patch(`/bookings/${bookingId}`, { member_id: memberId });
      setAssignDraft((m) => {
        const next = { ...m };
        delete next[bookingId];
        return next;
      });
      await refresh();
    } catch (e) {
      alert(formatApiErrorFromAxios(e));
    } finally {
      setAssignSavingId(null);
    }
  };

  const filteredItems = useMemo(() => {
    if (statusTab === "pending") {
      const pending = items.filter((x) => x.status === "pending");
      const pendingSorted = pending.slice().sort(sortPendingByReceivedThenMember);
      const extras = Object.keys(resolveFlashById)
        .map((rid) => items.find((x) => String(x.id) === String(rid)))
        .filter((x) => x && x.status !== "pending");
      const seen = new Set(pendingSorted.map((x) => String(x.id)));
      const tail = extras.filter((x) => !seen.has(String(x.id)));
      return [...pendingSorted, ...tail];
    }
    if (statusTab === "approved") return items.filter((x) => x.status === "approved");
    if (statusTab === "denied") return items.filter((x) => x.status === "denied");
    return items;
  }, [items, statusTab, resolveFlashById]);

  const byRecent = useMemo(() => {
    const list = filteredItems.slice();
    if (statusTab === "pending") {
      return list.sort(sortPendingByReceivedThenMember);
    }
    // Approved / denied: sort by booking date (newest → oldest), then time, then submission time.
    return list.sort(
      (a, b) =>
        String(b.date || "").localeCompare(String(a.date || "")) ||
        String(a.start_time || "").localeCompare(String(b.start_time || "")) ||
        String(b.created_at || "").localeCompare(String(a.created_at || ""))
    );
  }, [filteredItems, statusTab]);

  const previewRequests = useMemo(() => byRecent.slice(0, PREVIEW_LIMIT), [byRecent]);

  const requestsInRange = useMemo(() => {
    const list = filteredItems.slice();
    if (allReqGranularity === "week") {
      const w0 = startOfWeek(allReqCursor);
      const w6 = endOfWeekFrom(allReqCursor);
      const a = ymd(w0);
      const b = ymd(w6);
      return list.filter((x) => x.date >= a && x.date <= b);
    }
    if (allReqGranularity === "month") {
      const a = firstYmdOfMonth(allReqCursor);
      const b = lastYmdOfMonth(allReqCursor);
      return list.filter((x) => x.date >= a && x.date <= b);
    }
    const y = allReqCursor.getFullYear();
    return list.filter((x) => x.date >= `${y}-01-01` && x.date <= `${y}-12-31`);
  }, [filteredItems, allReqGranularity, allReqCursor]);

  const requestsInRangeSorted = useMemo(() => {
    const slice = requestsInRange.slice();
    if (statusTab === "pending") {
      return slice.sort(sortPendingByReceivedThenMember);
    }
    return slice.sort(
      (a, b) => a.date.localeCompare(b.date) || String(a.start_time).localeCompare(String(b.start_time))
    );
  }, [requestsInRange, statusTab]);

  const requestsRangeTitle = useMemo(() => {
    if (allReqGranularity === "week") {
      const s = startOfWeek(allReqCursor);
      const e = endOfWeekFrom(allReqCursor);
      return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    if (allReqGranularity === "month") {
      return allReqCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    return String(allReqCursor.getFullYear());
  }, [allReqGranularity, allReqCursor]);

  const navigateAllReq = (dir) => {
    setAllReqCursor((prev) => {
      const c = new Date(prev);
      if (allReqGranularity === "week") c.setDate(c.getDate() + dir * 7);
      else if (allReqGranularity === "month") c.setMonth(c.getMonth() + dir);
      else c.setFullYear(c.getFullYear() + dir);
      return c;
    });
  };

  const requestListBody = (list) => (
    <div className="grid gap-4">
      {list.map((b) => (
        <RequestCard
          key={b.id}
          b={b}
          calendars={calendars}
          canModerate={canModerate}
          msg={msg}
          setMsg={setMsg}
          amount={amount}
          setAmount={setAmount}
          act={act}
          calName={calName}
          setProfileMember={setProfileMember}
          assignableMembers={assignableMembers}
          assignDraft={assignDraft}
          setAssignDraft={setAssignDraft}
          assignSavingId={assignSavingId}
          onSaveAssign={onSaveAssign}
          resolveFlash={resolveFlashById[b.id] || null}
        />
      ))}
    </div>
  );

  const allRequestsBrowseBody = (
    <div className="flex max-h-[min(70vh,32rem)] flex-col gap-2">
      <div
        className="inline-flex w-fit max-w-full select-none items-center gap-2.5 rounded-[7px] border border-gray-200/95 bg-[#FCFCFC] px-2.5 py-1.5 text-xs leading-none dark:border-white/10 dark:bg-white/[0.04] sm:gap-3 sm:px-3"
        role="tablist"
        aria-label="Booking requests range"
      >
        {[
          { id: "week", label: "Week" },
          { id: "month", label: "Month" },
          { id: "year", label: "Year" },
        ].map(({ id, label }) => {
          const on = allReqGranularity === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setAllReqGranularity(id)}
              className={cn(
                "-m-0.5 inline-flex items-center rounded-sm border-0 bg-transparent p-0.5 px-1.5 text-xs font-normal leading-none transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-500/30 sm:px-2",
                on
                  ? "text-black dark:text-zinc-200"
                  : "text-neutral-400 dark:text-zinc-500 md:hover:text-neutral-500 md:dark:hover:text-zinc-400"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 pb-2 dark:border-white/10">
        <button type="button" onClick={() => navigateAllReq(-1)} className={requestsDialogNavBtnClass} aria-label="Previous range">
          <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <div className="min-w-0 flex-1 text-center text-xs font-medium text-slate-800 dark:text-zinc-100">
          {requestsRangeTitle}
        </div>
        <button type="button" onClick={() => navigateAllReq(1)} className={requestsDialogNavBtnClass} aria-label="Next range">
          <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-0 overflow-y-auto pr-1">
        {requestsInRangeSorted.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-zinc-500">No requests in this range.</p>
        ) : (
          (() => {
            const rows = [];
            let lastDate = "";
            let lastMonthKey = "";
            for (const b of requestsInRangeSorted) {
              if (allReqGranularity === "year") {
                const mk = b.date.slice(0, 7);
                if (mk !== lastMonthKey) {
                  lastMonthKey = mk;
                  rows.push(
                    <div
                      key={`m-${mk}`}
                      className="label-tech sticky top-0 z-[1] border-b border-slate-200/90 bg-[#FAFAFA]/95 py-1.5 pt-0.5 text-[11px] text-slate-600 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-400"
                    >
                      {new Date(`${mk}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                    </div>
                  );
                }
              }
              if (b.date !== lastDate) {
                lastDate = b.date;
                rows.push(
                  <div key={`d-${b.date}`} className="label-tech pt-1.5 text-[11px] text-slate-500 dark:text-zinc-500">
                    {new Date(`${b.date}T12:00:00`).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: allReqGranularity === "year" ? undefined : "numeric",
                    })}
                  </div>
                );
              }
              rows.push(
                <RequestCard
                  key={b.id}
                  b={b}
                  calendars={calendars}
                  canModerate={canModerate}
                  msg={msg}
                  setMsg={setMsg}
                  amount={amount}
                  setAmount={setAmount}
                  act={act}
                  calName={calName}
                  setProfileMember={setProfileMember}
                  assignableMembers={assignableMembers}
                  assignDraft={assignDraft}
                  setAssignDraft={setAssignDraft}
                  assignSavingId={assignSavingId}
                  onSaveAssign={onSaveAssign}
                  resolveFlash={resolveFlashById[b.id] || null}
                  compact
                />
              );
            }
            return rows;
          })()
        )}
      </div>
    </div>
  );

  const allRequestsDialog =
    items.length > 0 &&
    allRequestsOpen &&
    (isMobile ? (
      <Drawer open={allRequestsOpen} onOpenChange={(v) => !v && setAllRequestsOpen(false)}>
        <DrawerContent className="border border-gray-200/95 bg-[#FAFAFA] p-0 text-slate-900 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-['Manrope',system-ui,sans-serif] text-lg font-semibold text-slate-900 dark:text-white">
              All booking requests
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6">{allRequestsBrowseBody}</div>
        </DrawerContent>
      </Drawer>
    ) : (
      <Dialog open={allRequestsOpen} onOpenChange={(v) => !v && setAllRequestsOpen(false)}>
        <DialogContent className="max-w-lg gap-0 border border-gray-200/95 bg-[#FAFAFA] p-0 shadow-lg dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 sm:max-w-xl">
          <div className="border-b border-slate-200/80 px-6 py-4 dark:border-white/10">
            <DialogHeader>
              <DialogTitle className="font-['Manrope',system-ui,sans-serif] text-xl font-semibold text-slate-900 dark:text-white">
                All booking requests
              </DialogTitle>
            </DialogHeader>
          </div>
          <div className="px-6 py-4">{allRequestsBrowseBody}</div>
        </DialogContent>
      </Dialog>
    ));

  return (
    <div className="space-y-6" data-testid="requests-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label-tech">Queue</div>
          <h1 className={pageTitleClass}>{canModerate ? "Booking requests" : "My requests"}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="min-h-8 box-border inline-flex select-none items-center gap-2.5 rounded-[7px] border border-gray-200/95 bg-[#FCFCFC] px-2.5 py-1.5 text-xs leading-none dark:border-white/10 dark:bg-white/[0.04] sm:gap-3 sm:px-3"
            role="tablist"
            aria-label="Request status filter"
          >
            {[
              { id: "pending", label: "Pending" },
              { id: "approved", label: "Accepted" },
              { id: "denied", label: "Denied" },
            ].map(({ id, label }) => {
              const on = statusTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setStatusTab(id)}
                  className={cn(
                    "-m-0.5 inline-flex items-center rounded-sm border-0 bg-transparent p-0.5 px-1.5 text-xs font-normal leading-none transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-500/30 sm:px-2",
                    on
                      ? "text-black dark:text-zinc-200"
                      : "text-neutral-400 dark:text-zinc-500 md:hover:text-neutral-500 md:dark:hover:text-zinc-400"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setAllReqCursor(new Date());
              setAllReqGranularity("week");
              setAllRequestsOpen(true);
            }}
            className={requestsToolbarBtnClass}
            data-testid="requests-view-all"
            title="All requests by week, month, or year"
          >
            View all
          </button>
        )}
        </div>
      </div>

      {items.length === 0 && (
        <div
          className={cn(
            "border border-dashed border-gray-200/90 bg-white/50 p-12 text-center text-slate-500 dark:border-white/20 dark:bg-zinc-900/30 dark:text-neutral-400",
            "rounded-[7px]"
          )}
          data-testid="requests-empty"
        >
          <Clock className="mx-auto mb-2 h-6 w-6 opacity-50" strokeWidth={1.5} />
          Nothing here yet.
        </div>
      )}

      {items.length > 0 && previewRequests.length === 0 && (
        <p
          className="rounded-[7px] border border-dashed border-gray-200/90 bg-white/50 px-4 py-8 text-center text-sm text-slate-600 dark:border-white/20 dark:bg-zinc-900/30 dark:text-zinc-400"
          data-testid="requests-tab-empty"
        >
          No {statusTab} requests right now.
        </p>
      )}

      {items.length > 0 && previewRequests.length > 0 && requestListBody(previewRequests)}

      {allRequestsDialog}

      <MemberSummaryDialog
        open={!!profileMember}
        onOpenChange={(v) => !v && setProfileMember(null)}
        member={profileMember}
        viewer={user}
        onRemoved={() => {
          setProfileMember(null);
          refresh();
        }}
      />
    </div>
  );
}
