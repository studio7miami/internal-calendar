import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
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
  glassBarHoverClass,
} from "../lib/pageTheme";
import { cn } from "@/lib/utils";
import MemberSummaryDialog from "../components/members/MemberSummaryDialog";

const PREVIEW_LIMIT = 7;

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
        "shrink-0 self-center rounded-full ring-1 ring-black/10 dark:ring-white/15",
        compact ? "h-2 w-2" : "h-2.5 w-2.5"
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
  return (
    <span
      className={cn(
        "label-tech border rounded-[7px]",
        compact ? "px-1.5 py-0.5 text-[10px] uppercase tracking-wide" : "px-2 py-0.5",
        map[status] || map.pending
      )}
    >
      {status}
    </span>
  );
}

function RequestCard({ b, calendars, canModerate, msg, setMsg, act, calName, setProfileMember, compact = false }) {
  const cal = calendars.find((c) => c.id === b.calendar_id);
  const color = cal?.color || "#64748b";

  return (
    <div
      className={cn("overflow-hidden", compact ? "p-3 mb-2" : "p-4", pageCardClass)}
      data-testid={`request-card-${b.id}`}
    >
      <div className={cn("flex flex-wrap items-start", compact ? "gap-2" : "gap-4")}>
        <div className={cn("min-w-0 flex-1", compact ? "space-y-1.5" : "space-y-2")}>
          <div className="flex items-center justify-between gap-2">
            <div className={cn("flex min-w-0 flex-wrap items-center", compact ? "gap-1.5" : "gap-2")}>
              <StatusBadge status={b.status} compact={compact} />
              <span
                className={cn(
                  "label-tech text-slate-600 dark:text-neutral-400",
                  compact && "text-[10px] uppercase tracking-wide"
                )}
              >
                {calName(b.calendar_id)}
              </span>
            </div>
            <FieldCircle colorHex={color} title={calName(b.calendar_id)} compact={compact} />
          </div>
          <div
            className={cn(
              "font-semibold text-slate-900 dark:text-white",
              compact ? "text-sm leading-snug" : "text-xl"
            )}
          >
            {fmtRequestDisplayDate(b.date)} · {fmtTimeShort(b.start_time)}–{fmtTimeShort(b.end_time)}
          </div>
          {canModerate && b.member_name && (
            <div className={cn("text-slate-500 dark:text-neutral-400", compact ? "text-xs leading-snug" : "text-sm")}>
              <button
                type="button"
                className={cn(
                  "font-medium text-slate-800 md:hover:underline dark:text-zinc-200",
                  compact && "text-xs"
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
              <span className="text-slate-700 tabular-nums dark:text-zinc-400">{b.member_email}</span>
            </div>
          )}
          {b.notes && (
            <div
              className={cn(
                "border-slate-200 text-slate-700 dark:border-white/20 dark:text-neutral-300",
                compact ? "border-l pl-2 text-xs leading-snug" : "border-l-2 pl-3 text-sm"
              )}
            >
              {b.notes}
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
        </div>

        {canModerate && b.status === "pending" && (
          <div
            className={cn(
              "flex w-full flex-col sm:w-auto",
              compact ? "gap-1.5 sm:min-w-[11rem]" : "gap-2 sm:min-w-[240px]"
            )}
          >
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
                data-testid={`approve-${b.id}`}
                variant="ghost"
                className={cn("flex-1", pageBtnPrimaryClass, compact && "h-8 text-xs")}
              >
                <Check className={cn("mr-1 shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} strokeWidth={1.5} /> Approve
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Requests() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [items, setItems] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [msg, setMsg] = useState({});
  const [profileMember, setProfileMember] = useState(null);
  const [allRequestsOpen, setAllRequestsOpen] = useState(false);
  const [allReqGranularity, setAllReqGranularity] = useState("week");
  const [allReqCursor, setAllReqCursor] = useState(() => new Date());

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
    if (items.length === 0) setAllRequestsOpen(false);
  }, [items.length]);

  const calName = (id) => calendars.find((c) => c.id === id)?.name || String(id ?? "");

  const act = async (id, verb) => {
    try {
      await api.post(`/bookings/${id}/${verb}`, { message: msg[id] || "" });
      setMsg((m) => ({ ...m, [id]: "" }));
      refresh();
    } catch (e) {
      alert(formatApiError(e?.response?.data?.detail) || "Action failed");
    }
  };

  const canModerate = !!user?.permissions?.approve_deny_requests;

  const byRecent = useMemo(
    () => items.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))),
    [items]
  );

  const previewRequests = useMemo(() => byRecent.slice(0, PREVIEW_LIMIT), [byRecent]);

  const requestsInRange = useMemo(() => {
    const list = items.slice();
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
  }, [items, allReqGranularity, allReqCursor]);

  const requestsInRangeSorted = useMemo(
    () =>
      requestsInRange
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.start_time).localeCompare(String(b.start_time))),
    [requestsInRange]
  );

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
          act={act}
          calName={calName}
          setProfileMember={setProfileMember}
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
                  act={act}
                  calName={calName}
                  setProfileMember={setProfileMember}
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

      {items.length > 0 && requestListBody(previewRequests)}

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
