import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import BookingForm from "../components/app/BookingForm";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "../components/ui/drawer";
import { fmtTimeShort } from "../lib/time";
import { pageTitleClass, glassBarHoverClass, pageBtnPrimaryClass, pageBtnOutlineClass } from "../lib/pageTheme";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import MemberSummaryDialog from "../components/members/MemberSummaryDialog";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
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
function sameMonth(a, b) {
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

function firstYmdOfMonth(d) {
  return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
}

function lastYmdOfMonth(d) {
  return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function endOfWeekFrom(d) {
  const s = startOfWeek(d);
  return addDays(s, 6);
}

/** Unique calendars that have bookings on this day, stable order (first booking wins). */
function calendarsWithBookingsOnDay(todaysBookings, calendarMap) {
  const out = [];
  const seen = new Set();
  const sorted = todaysBookings.slice().sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  for (const b of sorted) {
    if (seen.has(b.calendar_id)) continue;
    const cal = calendarMap[b.calendar_id];
    const color = cal?.color;
    if (!color) continue;
    seen.add(b.calendar_id);
    out.push({ id: b.calendar_id, color, name: cal?.name || "" });
  }
  return out;
}

function rgba(hex, alpha) {
  const h = (hex || "#888").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Translucent fill in the calendar hue; subtle edge so pills read on glass tiles. */
function monthPillStyle(hex) {
  const edge = rgba(hex, 0.72);
  return {
    backgroundColor: rgba(hex, 0.58),
    boxShadow: `0 0.5px 2px rgba(0,0,0,0.1), inset 0 0 0 1px ${edge}`,
  };
}

/** Apple-style bottom pills: one pill per calendar account; multiple = side-by-side. Fits inside the day cell. */
function MonthDayEventPills({ entries }) {
  if (!entries.length) return null;
  const pill =
    "h-[5px] shrink-0 rounded-full dark:shadow-[0_1px_2px_rgba(0,0,0,0.28)] sm:h-1.5";
  if (entries.length === 1) {
    return (
      <span
        className={cn(pill, "w-[85%] max-w-[2.4rem] sm:max-w-[2.75rem]")}
        style={monthPillStyle(entries[0].color)}
        title={entries[0].name}
      />
    );
  }
  return (
    <div className="flex w-full min-w-0 max-w-full items-center justify-center gap-px px-px sm:gap-0.5">
      {entries.map((e) => (
        <span
          key={e.id}
          className={cn(pill, "min-w-0 flex-1 basis-0 max-w-[47%]")}
          style={monthPillStyle(e.color)}
          title={e.name}
        />
      ))}
    </div>
  );
}


/** Strip redundant venue from titles/notes in booking detail lines (popover, day panel, chips). */
function stripVenueFromBookingDetail(s) {
  if (!s) return "";
  let t = s.trim();
  t = t.replace(/^Google Calendar ·\s*/i, "").trim();
  t = t.replace(/^studio\s+7\s+miami\s*[·\-–—@|:]\s*/i, "").trim();
  t = t.replace(/\s*\(\s*studio\s+7\s+miami\s*\)/gi, "").trim();
  t = t.replace(/\s+at\s+studio\s+7\s+miami\b/gi, "").trim();
  t = t.replace(/\s*[@·,;|]\s*studio\s+7\s+miami\b/gi, "").trim();
  let prev;
  do {
    prev = t;
    t = t.replace(/\s*(?:@|·|\||—|-)\s*studio\s+7\s+miami\s*$/i, "").trim();
  } while (t !== prev);
  if (/^studio\s+7\s+miami$/i.test(t)) return "";
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

function chipLabel(b, calendar) {
  if (b.source === "google_external") {
    const t = stripVenueFromBookingDetail(b.external_title || b.notes || "");
    return t ? `Booked · ${t}` : "Booked";
  }
  const who = b.member_name ? b.member_name.split(" ")[0] : "Member";
  return `Booked · ${who}`;
}

function BookingChip({ b, calendar, showBookingDetails, onManageBooking, onMemberProfile, staffCanManageAnyBooking }) {
  const isOwn = b.is_own;
  // Calendar only shows approved bookings, but keep styling defensive.
  const isPending = b.status === "pending";
  const canSeeDetail = showBookingDetails;
  const approved = b.status === "approved";
  const canManageOwn = isOwn && approved;
  const canStaffManage = Boolean(staffCanManageAnyBooking && approved);
  const canManageBooking = canManageOwn || canStaffManage;
  const canNameProfile = Boolean(
    canSeeDetail && b.member_id && onMemberProfile && !canManageBooking
  );

  const onClick = (e) => {
    if (!canManageBooking || !onManageBooking) return;
    e.stopPropagation();
    onManageBooking();
  };

  if (canSeeDetail) {
    const color = calendar?.color || "#FAFAFA";
    const sub = chipLabel(b, calendar);
    const timeBit = `${fmtTimeShort(b.start_time)}–${fmtTimeShort(b.end_time)} · `;
    const chipStyle = {
      background: isPending ? rgba(color, 0.16) : rgba(color, 0.22),
      borderColor: isPending ? rgba(color, 0.34) : rgba(color, 0.46),
      borderLeft: `3px solid ${color}`,
      opacity: isPending ? 0.9 : 1,
    };
    const label = `${timeBit}${sub}`;
    const manageTitle = canStaffManage && !canManageOwn
      ? "Click to reschedule or cancel (admin)"
      : "Click to reschedule or cancel";

    if (canManageBooking) {
      return (
        <button
          type="button"
          onClick={onClick}
          data-testid={`booking-chip-${b.id}`}
          className={cn(
            "w-full cursor-pointer touch-manipulation truncate rounded-[7px] border px-2 py-1.5 text-left text-[10px] leading-tight text-slate-900 transition-colors dark:border-white/10 dark:text-zinc-200",
            "md:hover:brightness-110"
          )}
          style={chipStyle}
          title={manageTitle}
        >
          {isPending ? "⏳ " : ""}
          {label}
        </button>
      );
    }

    if (canNameProfile) {
      return (
        <div
          data-testid={`booking-chip-${b.id}`}
          className="w-full truncate rounded-[7px] border px-2 py-1.5 text-left text-[10px] leading-tight text-slate-900 dark:border-white/10 dark:text-zinc-200"
          style={chipStyle}
        >
          <span className="pointer-events-none">{isPending ? "⏳ " : ""}{timeBit}</span>
          <span
            role="button"
            tabIndex={0}
            className="cursor-pointer text-left md:hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onMemberProfile(b);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              onMemberProfile(b);
            }}
            title="View member"
          >
            {sub}
          </span>
        </div>
      );
    }

    return (
      <div
        data-testid={`booking-chip-${b.id}`}
        className="pointer-events-none w-full truncate rounded-[7px] border px-2 py-1.5 text-left text-[10px] leading-tight text-slate-900 dark:border-white/10 dark:text-zinc-200"
        style={chipStyle}
        title={isPending ? `Pending · ${label}` : label}
      >
        {isPending ? "⏳ " : ""}
        {label}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`booking-chip-${b.id}`}
      className={cn(
        "truncate rounded-[7px] border border-slate-900/15 px-2 py-1.5 text-left text-[10px] leading-tight booked-stripe-light text-slate-600 dark:border-white/14 dark:text-neutral-300 dark:booked-stripe",
        canManageBooking && "cursor-pointer touch-manipulation md:hover:brightness-110 md:dark:hover:brightness-110"
      )}
      style={{
        borderLeftColor: calendar?.color || "#333",
        borderLeftWidth: 3,
      }}
      title={canManageBooking ? "Your booking — click to reschedule or cancel" : "Booked"}
    >
      Booked
    </button>
  );
}


export default function CalendarPage() {
  const { user, refreshUser } = useAuth();
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(new Date());
  const [selectedYmd, setSelectedYmd] = useState(() => ymd(new Date()));
  const [calendars, setCalendars] = useState([]);
  const [enabledCalIds, setEnabledCalIds] = useState(new Set());
  const [bookings, setBookings] = useState([]);
  const [members, setMembers] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [formInit, setFormInit] = useState({});
  const [editingBooking, setEditingBooking] = useState(null);
  const [dayPanelOpen, setDayPanelOpen] = useState(false);
  const [dayPanelYmd, setDayPanelYmd] = useState("");
  const [adminAllOpen, setAdminAllOpen] = useState(false);
  const [adminAllGranularity, setAdminAllGranularity] = useState("week");
  const [adminAllCursor, setAdminAllCursor] = useState(() => new Date());
  const [profileMember, setProfileMember] = useState(null);

  const isMobile = useIsMobile();
  const isAdmin = user?.role === "admin";
  const isMember = user?.role === "member";
  /** Only admin + manager see booking labels / names on the calendar; members see time + "Booked" only. */
  const showBookingDetails = user?.role === "admin" || user?.role === "manager";
  const canFetchMembers = isAdmin || !!user?.permissions?.view_members_directory;
  const canManualBook = isAdmin || !!user?.permissions?.create_manual_booking;
  /** Admins always; managers only if Role permissions → Edit or cancel any booking. */
  const staffCanManageAnyBooking = isAdmin || !!user?.permissions?.delete_any_booking;
  const canRequestBooking = !!user?.permissions?.create_request;
  const calendarTodayYmd = ymd(new Date());
  const dayPanelAllowRequest = Boolean(
    canRequestBooking && dayPanelYmd && dayPanelYmd >= calendarTodayYmd
  );

  const openProfileFromBooking = useCallback((b) => {
    const row = members.find((m) => String(m.id) === String(b.member_id));
    setProfileMember({
      id: b.member_id,
      name: b.member_name,
      email: b.member_email,
      phone_e164: b.member_phone_e164 ?? row?.phone_e164,
      sauce: b.member_sauce ?? row?.sauce,
      role: row?.role ?? "member",
    });
  }, [members]);

  const fetchBookingsOnly = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await api.get("/bookings");
      const list = Array.isArray(data) ? data : [];
      setBookings(list.filter((b) => b?.status === "approved"));
    } catch {
      setBookings([]);
    }
  }, [user]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const calRes = await api.get("/calendars");
      const rows = Array.isArray(calRes.data) ? calRes.data : [];
      const activeOnly = rows.filter((c) => c.is_active);
      setCalendars(activeOnly);
      setEnabledCalIds((prev) =>
        prev.size === 0 ? new Set(activeOnly.map((c) => c.id)) : prev
      );
    } catch {
      setCalendars([]);
    }

    try {
      const secondaries = [api.get("/bookings")];
      if (canFetchMembers) secondaries.push(api.get("/users"));
      const results = await Promise.all(secondaries);
      {
        const list = Array.isArray(results[0].data) ? results[0].data : [];
        setBookings(list.filter((b) => b?.status === "approved"));
      }
      if (canFetchMembers && results[1]) {
        setMembers(Array.isArray(results[1].data) ? results[1].data : []);
      } else if (!canFetchMembers) {
        setMembers([]);
      }
    } catch {
      setBookings([]);
      setMembers([]);
    }
  }, [user, canFetchMembers]);

  const handleCalendarMemberRoleChange = useCallback(
    async (u, role) => {
      if (!user || user.role !== "admin") return false;
      try {
        await api.patch(`/users/${u.id}/role`, { role });
        await fetchData();
        setProfileMember((prev) => (prev && String(prev.id) === String(u.id) ? { ...prev, role } : prev));
        return true;
      } catch (e) {
        alert(formatApiError(e?.response?.data?.detail) || "Could not change role");
        return false;
      }
    },
    [user, fetchData]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!user) return undefined;
    const id = window.setInterval(() => {
      void fetchBookingsOnly();
    }, 60000);
    return () => window.clearInterval(id);
  }, [user, fetchBookingsOnly]);

  const calendarMap = useMemo(
    () => Object.fromEntries(calendars.map((c) => [c.id, c])),
    [calendars]
  );

  const visibleBookings = useMemo(
    () => bookings.filter((b) => enabledCalIds.has(b.calendar_id)),
    [bookings, enabledCalIds]
  );

  /** Admin overview: every calendar, ignores toolbar toggles. */
  const adminAllBookings = useMemo(() => {
    if (!isAdmin) return [];
    return (bookings || []).filter((b) => b.status === "approved");
  }, [bookings, isAdmin]);

  const adminAllInRange = useMemo(() => {
    if (!isAdmin) return [];
    const list = adminAllBookings;
    if (adminAllGranularity === "week") {
      const w0 = startOfWeek(adminAllCursor);
      const w6 = endOfWeekFrom(adminAllCursor);
      const a = ymd(w0);
      const b = ymd(w6);
      return list.filter((x) => x.date >= a && x.date <= b);
    }
    if (adminAllGranularity === "month") {
      const a = firstYmdOfMonth(adminAllCursor);
      const b = lastYmdOfMonth(adminAllCursor);
      return list.filter((x) => x.date >= a && x.date <= b);
    }
    const y = adminAllCursor.getFullYear();
    return list.filter((x) => x.date >= `${y}-01-01` && x.date <= `${y}-12-31`);
  }, [isAdmin, adminAllBookings, adminAllGranularity, adminAllCursor]);

  const adminAllRangeTitle = useMemo(() => {
    if (adminAllGranularity === "week") {
      const s = startOfWeek(adminAllCursor);
      const e = endOfWeekFrom(adminAllCursor);
      return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    if (adminAllGranularity === "month") {
      return adminAllCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    return String(adminAllCursor.getFullYear());
  }, [adminAllGranularity, adminAllCursor]);

  const toggleCal = (id) => {
    setEnabledCalIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const normSlotTime = (t) => {
    if (!t) return "10:00";
    const s = String(t);
    return s.length >= 5 ? s.slice(0, 5) : s;
  };

  const openForm = (date, start = "10:00", end = "11:00") => {
    const today = ymd(new Date());
    if (date < today) return;
    setEditingBooking(null);
    setSelectedYmd(date);
    setFormInit({ date, start, end });
    setFormOpen(true);
  };

  const openDayPanel = (dateKey) => {
    const today = ymd(new Date());
    if (isMember && dateKey < today) return;
    setSelectedYmd(dateKey);
    setDayPanelYmd(dateKey);
    setDayPanelOpen(true);
  };

  const dayPanelBookings = useMemo(() => {
    if (!dayPanelYmd) return [];
    return visibleBookings
      .filter((b) => b.date === dayPanelYmd)
      .slice()
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  }, [visibleBookings, dayPanelYmd]);

  const dayPanelTitle = useMemo(() => {
    if (!dayPanelYmd) return "";
    return new Date(`${dayPanelYmd}T12:00:00`).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [dayPanelYmd]);

  const openEditBooking = (b) => {
    if (!b?.id) return;
    if (!b.is_own && !staffCanManageAnyBooking) return;
    if (b.status !== "pending" && b.status !== "approved") return;
    setEditingBooking(b);
    setSelectedYmd(b.date);
    setFormInit({
      date: b.date,
      start: normSlotTime(b.start_time),
      end: normSlotTime(b.end_time),
    });
    setFormOpen(true);
  };

  // ---- Month grid ----
  const renderMonth = () => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    const days = [];
    for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));
    const todayKey = ymd(new Date());

    return (
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col basis-0">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col basis-0 overflow-hidden rounded-[7px] bg-white/[0.15] dark:bg-white/[0.02]">
          <div className="grid min-w-0 shrink-0 grid-cols-7">
            {[
              { short: "Su", day: "Sun" },
              { short: "Mo", day: "Mon" },
              { short: "Tu", day: "Tue" },
              { short: "We", day: "Wed" },
              { short: "Th", day: "Thu" },
              { short: "Fr", day: "Fri" },
              { short: "Sa", day: "Sat" },
            ].map(({ short, day }) => (
              <div
                key={day}
                className="px-0.5 py-1.5 text-center text-[9px] font-medium uppercase leading-tight tracking-tight text-slate-600 dark:text-zinc-500 sm:px-1 sm:py-2 sm:text-[11px] sm:tracking-[0.22em] sm:font-normal md:px-2"
              >
                <span className="sm:hidden" title={day}>
                  {short}
                </span>
                <span className="hidden sm:inline">{day}</span>
              </div>
            ))}
          </div>

          <div className="grid min-h-0 min-w-0 flex-1 basis-0 grid-cols-7 gap-0.5 p-0.5 [grid-template-rows:repeat(6,minmax(0,1fr))] sm:gap-1 sm:p-1">
            {days.map((d, i) => {
            const key = ymd(d);
            const inMonth = sameMonth(d, cursor);
            const todaysBookings = visibleBookings.filter((b) => b.date === key);
            const pastForMember = isMember && key < todayKey;
            const isCellSelected = key === selectedYmd;
            const showCellSelected = isCellSelected && !pastForMember;
            const isToday = key === todayKey;
            const showTodayRing = isToday && !showCellSelected;
            const calStripEntries = pastForMember ? [] : calendarsWithBookingsOnDay(todaysBookings, calendarMap);
            const hasCalStrip = calStripEntries.length > 0;
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            const tEase = "transition-[background-color,color,box-shadow] duration-200 ease-out";
            const cellShell = pastForMember
              ? `border border-gray-200/90 bg-white/[0.03] text-slate-400 shadow-none backdrop-blur-sm dark:border-white/[0.06] dark:bg-white/[0.015] dark:text-zinc-600 ${tEase} pointer-events-none select-none`
              : showCellSelected
              ? `group bg-[#222222] text-zinc-100 ${tEase} motion-reduce:transition-none`
              : inMonth
              ? `group glass-tile text-slate-900 ${tEase} motion-reduce:transition-none md:hover:bg-[#222222] md:hover:text-zinc-100 dark:text-zinc-300 md:dark:hover:bg-[#222222] md:dark:hover:text-zinc-100`
              : `group border border-gray-200/95 bg-white/[0.04] text-slate-500 shadow-none backdrop-blur-sm dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-zinc-500 ${tEase} md:hover:bg-[#222222] md:hover:text-zinc-100 md:dark:hover:bg-[#222222] md:dark:hover:text-zinc-100`;
            return (
              <div
                key={i}
                data-testid={`month-cell-${key}`}
                className={`relative flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-visible rounded-[3px] p-1.5 sm:rounded-[5px] sm:p-2 md:p-2.5 ${cellShell}`}
              >
                {pastForMember ? (
                  <div
                    className="absolute top-0 right-0 bottom-0 left-0 z-0 cursor-default rounded-[3px] sm:rounded-[5px]"
                    aria-hidden
                  />
                ) : (
                  <button
                    type="button"
                    className="absolute top-0 right-0 bottom-0 left-0 z-0 min-h-0 w-full min-w-0 max-h-full max-w-full cursor-pointer rounded-[3px] border-0 bg-transparent p-0 sm:rounded-[5px] touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500/50 dark:focus-visible:ring-zinc-500/50"
                    aria-label={d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                    onClick={() => openDayPanel(key)}
                  />
                )}
                <div className="pointer-events-none relative z-[1] flex h-full min-h-0 min-w-0 flex-1 flex-col justify-between gap-0.5">
                  <div className="min-h-0 min-w-0 shrink-0 pt-px">
                    <div className="flex min-h-0 w-full items-center justify-start text-left text-[11px] leading-none min-[380px]:text-xs sm:min-h-[1.1rem] sm:text-[12px]">
                      <span
                        className={`w-fit min-w-0 text-left tabular-nums align-middle transition-all duration-200 ease-out motion-reduce:transition-none ${
                          showTodayRing
                            ? "inline-flex aspect-square min-w-[1.125rem] w-[min(1.75rem,100%)] max-w-[1.75rem] shrink-0 items-center justify-center rounded-full bg-red-500 text-[11px] font-semibold leading-none text-white shadow-sm [box-sizing:border-box] md:group-hover:brightness-110 min-[380px]:text-xs dark:bg-red-600"
                            : showCellSelected
                            ? "inline-block max-w-full text-zinc-100"
                            : inMonth && isWeekend
                            ? "inline-block max-w-full font-medium text-slate-400 md:group-hover:text-zinc-100 dark:text-zinc-500 md:dark:group-hover:text-zinc-100"
                            : inMonth
                            ? "inline-block max-w-full font-semibold text-slate-900 md:group-hover:text-zinc-100 dark:text-zinc-100 md:dark:group-hover:text-zinc-100"
                            : isWeekend
                            ? "inline-block max-w-full font-medium text-slate-400/90 md:group-hover:text-zinc-100 dark:text-zinc-600 md:dark:group-hover:text-zinc-100"
                            : "inline-block max-w-full font-medium text-slate-500 md:group-hover:text-zinc-100 dark:text-zinc-500 md:dark:group-hover:text-zinc-100"
                        }`}
                      >
                        {d.getDate()}
                      </span>
                    </div>
                  </div>
                  {hasCalStrip && !pastForMember && (
                    <div className="pointer-events-auto flex w-full min-w-0 shrink-0 justify-center px-0.5 pb-px pt-0.5">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            aria-label={`Calendars and bookings on ${key}`}
                            className={cn(
                              "flex w-full max-w-full min-w-0 items-center justify-center rounded-md py-0.5 outline-none transition-opacity sm:py-1",
                              "opacity-95 md:hover:opacity-100 focus-visible:ring-2 focus-visible:ring-slate-400/45 dark:focus-visible:ring-zinc-500/45"
                            )}
                          >
                            <MonthDayEventPills entries={calStripEntries} />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          side="top"
                          align="center"
                          sideOffset={6}
                          className="w-[min(18rem,calc(100vw-2rem))] max-h-[min(22rem,50vh)] overflow-y-auto border border-gray-200/95 bg-[#FAFAFA] p-3 text-slate-900 shadow-lg dark:border-white/15 dark:bg-zinc-950 dark:text-zinc-100"
                          onOpenAutoFocus={(e) => e.preventDefault()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="label-tech mb-2 text-slate-500 dark:text-zinc-500">
                            {new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </div>
                          <div className="space-y-3">
                            {(() => {
                              const sorted = todaysBookings
                                .slice()
                                .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
                              const byCal = new Map();
                              for (const b of sorted) {
                                const cid = b.calendar_id;
                                if (!byCal.has(cid)) byCal.set(cid, []);
                                byCal.get(cid).push(b);
                              }
                              return Array.from(byCal.entries()).map(([cid, list]) => {
                                const cal = calendarMap[cid];
                                return (
                                  <div key={cid}>
                                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-zinc-100">
                                      <span
                                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                                        style={{ background: cal?.color || "#888" }}
                                      />
                                      <span className="truncate">{cal?.name || "Calendar"}</span>
                                    </div>
                                    <ul className="mt-1.5 space-y-1 border-l border-slate-200/80 pl-3 dark:border-white/10">
                                      {list.map((b) => {
                                        const show = showBookingDetails;
                                        const line = show
                                          ? `${fmtTimeShort(b.start_time)}–${fmtTimeShort(b.end_time)} · ${chipLabel(b, cal)}`
                                          : `${fmtTimeShort(b.start_time)}–${fmtTimeShort(b.end_time)} · Booked`;
                                        return (
                                          <li key={b.id} className="text-xs leading-snug text-slate-600 dark:text-zinc-400">
                                            {staffCanManageAnyBooking && b.status === "approved" ? (
                                              <button
                                                type="button"
                                                className="w-full cursor-pointer rounded-sm text-left underline-offset-2 md:hover:underline"
                                                onClick={() => openEditBooking(b)}
                                              >
                                                {line}
                                              </button>
                                            ) : (
                                              line
                                            )}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>
    );
  };


  // ---- Week / Day views (hourly grid) ----
  const renderHourGrid = (dayList) => {
    const hours = Array.from({ length: 14 }, (_, i) => i + 7);
    const isLastHour = (h) => h === hours[hours.length - 1];
    const todayYmdGrid = ymd(new Date());
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[7px] border soft-divider bg-transparent">
        <div
          className="grid shrink-0"
          style={{ gridTemplateColumns: `60px repeat(${dayList.length}, minmax(0, 1fr))` }}
        >
          <div className="p-3 border-r border-b soft-divider" />
          {dayList.map((d, idx) => {
            const dKey = ymd(d);
            const pastHeaderMember = isMember && dKey < todayYmdGrid;
            return (
              <div
                key={dKey}
                className={`p-3 border-b soft-divider text-center ${
                  idx === dayList.length - 1 ? "" : "border-r soft-divider"
                }`}
              >
                {pastHeaderMember ? (
                  <div className="mx-auto w-full max-w-[5rem] cursor-default rounded-md p-1 text-center opacity-55">
                    <div className="text-[11px] tracking-[0.22em] uppercase text-slate-500 dark:text-zinc-500">
                      {d.toLocaleDateString(undefined, { weekday: "short" })}
                    </div>
                    <div className="font-display mt-0.5 text-[18px] text-slate-600 dark:text-zinc-500">{d.getDate()}</div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openDayPanel(dKey)}
                    className="mx-auto w-full max-w-[5rem] rounded-md border-0 bg-transparent p-1 text-center transition-colors md:hover:bg-black/[0.04] md:dark:hover:bg-white/[0.05]"
                  >
                    <div className="text-[11px] tracking-[0.22em] uppercase text-slate-500 dark:text-zinc-500">
                      {d.toLocaleDateString(undefined, { weekday: "short" })}
                    </div>
                    <div className="font-display mt-0.5 text-[18px] text-slate-900 dark:text-zinc-200">{d.getDate()}</div>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div
            className="grid"
            style={{ gridTemplateColumns: `60px repeat(${dayList.length}, minmax(0, 1fr))` }}
          >
            {hours.map((h) => (
              <React.Fragment key={h}>
                <div
                  className={`p-2 border-r soft-divider text-right text-[11px] text-slate-500 dark:text-zinc-500 ${
                    isLastHour(h) ? "" : "border-b soft-divider"
                  }`}
                >
                  {fmtTimeShort(`${String(h).padStart(2, "0")}:00`)}
                </div>
                {dayList.map((d, idx) => {
                  const key = ymd(d);
                  const pastSlotMember = isMember && key < todayYmdGrid;
                  const slotStart = `${String(h).padStart(2, "0")}:00`;
                  const slotEnd = `${String(h + 1).padStart(2, "0")}:00`;
                  const inSlot = visibleBookings.filter(
                    (b) =>
                      b.date === key &&
                      b.start_time < slotEnd &&
                      b.end_time > slotStart
                  );
                  const slotClass = `relative min-h-[56px] p-2 flex flex-col gap-1 text-left ${
                    idx === dayList.length - 1 ? "" : "border-r soft-divider"
                  } ${isLastHour(h) ? "" : "border-b soft-divider"}`;
                  if (pastSlotMember) {
                    return (
                      <div
                        key={`${key}-${h}`}
                        className={cn(slotClass, "cursor-default bg-transparent opacity-60")}
                        data-testid={`slot-${key}-${h}`}
                      >
                        <div className="pointer-events-none">
                          {inSlot.map((b) => (
                            <BookingChip
                              key={b.id}
                              b={b}
                              calendar={calendarMap[b.calendar_id]}
                              showBookingDetails={showBookingDetails}
                              staffCanManageAnyBooking={staffCanManageAnyBooking}
                              onManageBooking={() => openEditBooking(b)}
                              onMemberProfile={openProfileFromBooking}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <button
                      type="button"
                      key={`${key}-${h}`}
                      onClick={() => openForm(key, slotStart, slotEnd)}
                      className={cn(
                        slotClass,
                        "bg-transparent md:hover:bg-black/5 md:dark:hover:bg-white/[0.03]"
                      )}
                      data-testid={`slot-${key}-${h}`}
                    >
                      {inSlot.map((b) => (
                        <BookingChip
                          key={b.id}
                          b={b}
                          calendar={calendarMap[b.calendar_id]}
                          showBookingDetails={showBookingDetails}
                          staffCanManageAnyBooking={staffCanManageAnyBooking}
                          onManageBooking={() => openEditBooking(b)}
                          onMemberProfile={openProfileFromBooking}
                        />
                      ))}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderWeek = () => {
    const s = startOfWeek(cursor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(s, i));
    return renderHourGrid(days);
  };

  const renderDay = () => renderHourGrid([cursor]);

  const navigate = (dir) => {
    const c = new Date(cursor);
    if (view === "month") c.setMonth(c.getMonth() + dir);
    else if (view === "week") c.setDate(c.getDate() + dir * 7);
    else c.setDate(c.getDate() + dir);
    setCursor(c);
  };

  const navigateAdminAll = (dir) => {
    setAdminAllCursor((prev) => {
      const c = new Date(prev);
      if (adminAllGranularity === "week") c.setDate(c.getDate() + dir * 7);
      else if (adminAllGranularity === "month") c.setMonth(c.getMonth() + dir);
      else c.setFullYear(c.getFullYear() + dir);
      return c;
    });
  };

  const title =
    view === "month"
      ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : view === "week"
      ? `Week of ${startOfWeek(cursor).toLocaleDateString()}`
      : cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const toolbarBtnClass = `min-h-8 box-border inline-flex items-center justify-center border border-white/30 bg-white/80 text-xs leading-none text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] backdrop-blur-md transition-colors dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:shadow-[0_1px_3px_rgba(0,0,0,0.45)] ${glassBarHoverClass} rounded-[7px]`;

  const adminAllSorted = useMemo(
    () =>
      adminAllInRange
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.start_time).localeCompare(String(b.start_time))),
    [adminAllInRange]
  );

  const adminAllBody = (
    <div className="flex max-h-[min(70vh,32rem)] flex-col gap-3">
      <div
        className="inline-flex w-fit max-w-full select-none items-center gap-2.5 rounded-[7px] border border-gray-200/95 bg-[#FCFCFC] px-2.5 py-1.5 text-xs leading-none dark:border-white/10 dark:bg-white/[0.04] sm:gap-3 sm:px-3"
        role="tablist"
        aria-label="All bookings range"
      >
        {[
          { id: "week", label: "Week" },
          { id: "month", label: "Month" },
          { id: "year", label: "Year" },
        ].map(({ id, label }) => {
          const on = adminAllGranularity === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setAdminAllGranularity(id)}
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
        <button
          type="button"
          onClick={() => navigateAdminAll(-1)}
          className={cn(toolbarBtnClass, "h-8 w-8 shrink-0 p-0")}
          aria-label="Previous range"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <div className="min-w-0 flex-1 text-center text-sm font-medium text-slate-800 dark:text-zinc-100">{adminAllRangeTitle}</div>
        <button
          type="button"
          onClick={() => navigateAdminAll(1)}
          className={cn(toolbarBtnClass, "h-8 w-8 shrink-0 p-0")}
          aria-label="Next range"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-0 overflow-y-auto pr-1">
        {adminAllSorted.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-zinc-500">No bookings in this range.</p>
        ) : (
          (() => {
            const rows = [];
            let lastDate = "";
            let lastMonthKey = "";
            for (const b of adminAllSorted) {
              const cal = calendarMap[b.calendar_id];
              if (adminAllGranularity === "year") {
                const mk = b.date.slice(0, 7);
                if (mk !== lastMonthKey) {
                  lastMonthKey = mk;
                  rows.push(
                    <div
                      key={`m-${mk}`}
                      className="label-tech sticky top-0 z-[1] border-b border-slate-200/90 bg-[#FAFAFA]/95 py-2 pt-1 text-slate-600 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-400"
                    >
                      {new Date(`${mk}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                    </div>
                  );
                }
              }
              if (b.date !== lastDate) {
                lastDate = b.date;
                rows.push(
                  <div key={`d-${b.date}`} className="label-tech pt-2 text-slate-500 dark:text-zinc-500">
                    {new Date(`${b.date}T12:00:00`).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: adminAllGranularity === "year" ? undefined : "numeric",
                    })}
                  </div>
                );
              }
              rows.push(
                <div
                  key={b.id}
                  className="flex items-start gap-2 rounded-[7px] border border-slate-200/80 bg-white/70 px-2.5 py-2 dark:border-white/10 dark:bg-zinc-900/40"
                >
                  <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cal?.color || "#888" }} />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="font-medium text-slate-900 dark:text-zinc-100">{cal?.name || "Calendar"}</div>
                    <div className="mt-0.5 text-slate-600 dark:text-zinc-400">
                      {fmtTimeShort(b.start_time)}–{fmtTimeShort(b.end_time)} ·{" "}
                      {showBookingDetails ? chipLabel(b, cal) : "Booked"}
                    </div>
                  </div>
                </div>
              );
            }
            return rows;
          })()
        )}
      </div>
    </div>
  );

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col basis-0 gap-4 overflow-hidden -mx-1 px-1 sm:mx-0 sm:px-0"
      data-testid="calendar-page"
    >
      <div className="flex shrink-0 flex-col items-start gap-2 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="label-tech">Calendar</div>
          <h1 className={cn(pageTitleClass, "whitespace-nowrap overflow-hidden text-ellipsis")}>{title}</h1>
        </div>
        <div className="no-scrollbar flex h-9 w-full max-w-full items-center overflow-x-auto pb-1 -mx-1 px-1 sm:ml-auto sm:w-auto">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate(-1)}
              data-testid="nav-prev-button"
              className={`min-h-8 w-8 p-0 inline-flex items-center justify-center border border-white/30 bg-white/80 text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] backdrop-blur-md transition-colors dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:shadow-[0_1px_3px_rgba(0,0,0,0.45)] ${glassBarHoverClass} rounded-[7px]`}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
            </button>

            <button
              type="button"
              onClick={() => setCursor(new Date())}
              data-testid="today-button"
              className={`min-h-8 box-border inline-flex items-center justify-center border border-white/30 bg-white/80 px-2.5 py-1.5 text-[11px] leading-none text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] backdrop-blur-md transition-colors dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:shadow-[0_1px_3px_rgba(0,0,0,0.45)] ${glassBarHoverClass} rounded-[7px] sm:px-3 sm:text-xs`}
            >
              Today
            </button>

            <button
              type="button"
              onClick={() => navigate(1)}
              data-testid="nav-next-button"
              className={`min-h-8 w-8 p-0 inline-flex items-center justify-center border border-white/30 bg-white/80 text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] backdrop-blur-md transition-colors dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:shadow-[0_1px_3px_rgba(0,0,0,0.45)] ${glassBarHoverClass} rounded-[7px]`}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>

          <div className="ml-auto flex items-center gap-1.5 pl-2">
            <button
              type="button"
              onClick={() => openForm(ymd(cursor))}
              data-testid="new-booking-button"
              className={`min-h-8 box-border inline-flex items-center justify-center gap-1 border border-white/30 bg-white/80 px-2.5 py-1.5 text-[11px] leading-none text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] backdrop-blur-md transition-colors dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:shadow-[0_1px_3px_rgba(0,0,0,0.45)] ${glassBarHoverClass} rounded-[7px] sm:gap-1.5 sm:px-3 sm:text-xs`}
            >
              <Plus className="w-4 h-4 shrink-0" strokeWidth={1.5} />
              New
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setAdminAllCursor(new Date(cursor));
                  setAdminAllOpen(true);
                }}
                title="All bookings by week, month, or year"
                data-testid="admin-all-bookings-button"
                className={cn(toolbarBtnClass, "px-2.5 sm:px-3")}
              >
                View all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── View mode + calendar accounts (same row) ── */}
      <div className="no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto pb-1">
        <div
          className="min-h-8 box-border inline-flex shrink-0 select-none items-center gap-2.5 rounded-[7px] border border-gray-200/95 bg-[#FCFCFC] px-2.5 py-1.5 text-xs leading-none dark:border-white/10 dark:bg-white/[0.04] sm:gap-3 sm:px-3"
          role="tablist"
          aria-label="Calendar view"
        >
          {[
            { id: "month", label: "Month" },
            { id: "week", label: "Week" },
            { id: "day", label: "Day" },
          ].map(({ id, label }) => {
            const on = view === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`view-tab-${id}`}
                aria-selected={on}
                data-testid={`view-${id}-tab`}
                onClick={() => setView(id)}
                className={`-m-0.5 inline-flex items-center rounded-sm border-0 bg-transparent p-0.5 px-1.5 text-xs font-normal leading-none transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FCFCFC] focus-visible:dark:ring-zinc-600/40 focus-visible:dark:ring-offset-[#0b0b0c] sm:px-2 ${
                  on
                    ? "text-black dark:text-zinc-200"
                    : "text-neutral-400 dark:text-zinc-500 md:hover:text-neutral-500 md:dark:hover:text-zinc-400"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex shrink-0 gap-2">
          {calendars.map((c) => {
            const on = enabledCalIds.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleCal(c.id)}
                data-testid={`calendar-toggle-${c.id}`}
                className={`min-h-8 box-border inline-flex items-center gap-2 rounded-[7px] border border-gray-200/95 px-3 py-1.5 text-xs leading-none transition-colors dark:border-white/10 ${
                  on
                    ? "bg-[#FCFCFC] text-black dark:bg-white/[0.05] dark:text-zinc-200"
                    : "text-neutral-400 dark:bg-transparent dark:text-zinc-500"
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: on ? c.color : "#ccc" }} />
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      {view === "month" && (
        <div className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col basis-0 overflow-x-auto overscroll-x-contain sm:overflow-x-visible">
          {renderMonth()}
        </div>
      )}
      {view === "week" && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto scrollbar-thin">
          {renderWeek()}
        </div>
      )}
      {view === "day" && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto sm:overflow-x-visible">
          {renderDay()}
        </div>
      )}

      {isMobile ? (
        <Drawer open={dayPanelOpen} onOpenChange={(v) => !v && setDayPanelOpen(false)}>
          <DrawerContent className={cn("border border-gray-200/95 bg-[#FAFAFA] p-0 text-slate-900 dark:border-white/20 dark:bg-zinc-950 dark:text-white")}>
            <DrawerHeader className="text-left">
              <DrawerTitle className="font-['Manrope',system-ui,sans-serif] text-xl font-semibold text-slate-900 dark:text-white">
                {dayPanelTitle}
              </DrawerTitle>
            </DrawerHeader>
            <div className="space-y-4 px-4 pb-6">
              {dayPanelBookings.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-zinc-400">Nothing scheduled this day.</p>
              ) : (
                <ul className="max-h-[min(50vh,20rem)] space-y-2 overflow-y-auto">
                  {dayPanelBookings.map((b) => {
                    const cal = calendarMap[b.calendar_id];
                    const label = chipLabel(b, cal);
                    const detailLine = `${fmtTimeShort(b.start_time)}–${fmtTimeShort(b.end_time)}`;
                    const showText = showBookingDetails;
                    const canManageBooking =
                      (b.is_own && b.status === "approved") ||
                      (staffCanManageAnyBooking && b.status === "approved");
                    return (
                      <li
                        key={b.id}
                        className="flex items-start gap-3 rounded-[7px] border border-slate-200/80 bg-white/80 p-3 dark:border-white/10 dark:bg-zinc-900/40"
                      >
                        <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cal?.color || "#999" }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-slate-900 dark:text-zinc-100">{detailLine}</div>
                          {showText ? (
                            b.member_id ? (
                              <button
                                type="button"
                                className="mt-0.5 block w-full text-left text-xs text-slate-600 md:hover:underline dark:text-zinc-400"
                                onClick={() => openProfileFromBooking(b)}
                              >
                                {label}
                              </button>
                            ) : (
                              <div className="mt-0.5 text-xs text-slate-600 dark:text-zinc-400">{label}</div>
                            )
                          ) : (
                            <div className="mt-0.5 text-xs text-slate-600 dark:text-zinc-400">Booked</div>
                          )}
                        </div>
                        {canManageBooking && (
                          <Button
                            type="button"
                            variant="ghost"
                            className={cn("h-8 shrink-0 text-xs", pageBtnOutlineClass)}
                            onClick={() => {
                              setDayPanelOpen(false);
                              openEditBooking(b);
                            }}
                          >
                            Edit
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex flex-col gap-2 border-t border-slate-200/80 pt-3 dark:border-white/10 sm:flex-row">
                {dayPanelAllowRequest && (
                  <Button
                    type="button"
                    className={cn("h-10 w-full sm:flex-1", pageBtnPrimaryClass)}
                    onClick={() => {
                      setDayPanelOpen(false);
                      openForm(dayPanelYmd);
                    }}
                  >
                    {isAdmin ? "Add a booking" : "Request a time"}
                  </Button>
                )}
                <Button type="button" variant="ghost" className={cn("h-10 w-full sm:flex-1", pageBtnOutlineClass)} onClick={() => setDayPanelOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={dayPanelOpen} onOpenChange={(v) => !v && setDayPanelOpen(false)}>
          <DialogContent className={cn("max-w-md gap-0 border border-gray-200/95 bg-[#FAFAFA] p-0 shadow-lg dark:border-white/20 dark:bg-zinc-950 dark:text-white")}>
            <div className="p-6 pb-2">
              <DialogHeader>
                <DialogTitle className="font-['Manrope',system-ui,sans-serif] text-xl font-semibold text-slate-900 dark:text-white">
                  {dayPanelTitle}
                </DialogTitle>
              </DialogHeader>
            </div>
            <div className="space-y-4 px-6 pb-6">
              {dayPanelBookings.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-zinc-400">Nothing scheduled this day.</p>
              ) : (
                <ul className="max-h-[min(50vh,20rem)] space-y-2 overflow-y-auto">
                  {dayPanelBookings.map((b) => {
                    const cal = calendarMap[b.calendar_id];
                    const label = chipLabel(b, cal);
                    const detailLine = `${fmtTimeShort(b.start_time)}–${fmtTimeShort(b.end_time)}`;
                    const showText = showBookingDetails;
                    const canManageBooking =
                      (b.is_own && b.status === "approved") ||
                      (staffCanManageAnyBooking && b.status === "approved");
                    return (
                      <li
                        key={b.id}
                        className="flex items-start gap-3 rounded-[7px] border border-slate-200/80 bg-white/80 p-3 dark:border-white/10 dark:bg-zinc-900/40"
                      >
                        <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cal?.color || "#999" }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-slate-900 dark:text-zinc-100">{detailLine}</div>
                          {showText ? (
                            b.member_id ? (
                              <button
                                type="button"
                                className="mt-0.5 block w-full text-left text-xs text-slate-600 md:hover:underline dark:text-zinc-400"
                                onClick={() => openProfileFromBooking(b)}
                              >
                                {label}
                              </button>
                            ) : (
                              <div className="mt-0.5 text-xs text-slate-600 dark:text-zinc-400">{label}</div>
                            )
                          ) : (
                            <div className="mt-0.5 text-xs text-slate-600 dark:text-zinc-400">Booked</div>
                          )}
                        </div>
                        {canManageBooking && (
                          <Button
                            type="button"
                            variant="ghost"
                            className={cn("h-8 shrink-0 text-xs", pageBtnOutlineClass)}
                            onClick={() => {
                              setDayPanelOpen(false);
                              openEditBooking(b);
                            }}
                          >
                            Edit
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex flex-col gap-2 border-t border-slate-200/80 pt-3 dark:border-white/10 sm:flex-row">
                {dayPanelAllowRequest && (
                  <Button
                    type="button"
                    className={cn("h-10 w-full sm:flex-1", pageBtnPrimaryClass)}
                    onClick={() => {
                      setDayPanelOpen(false);
                      openForm(dayPanelYmd);
                    }}
                  >
                    {isAdmin ? "Add a booking" : "Request a time"}
                  </Button>
                )}
                <Button type="button" variant="ghost" className={cn("h-10 w-full sm:flex-1", pageBtnOutlineClass)} onClick={() => setDayPanelOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {isAdmin && adminAllOpen && (
        isMobile ? (
          <Drawer open={adminAllOpen} onOpenChange={(v) => !v && setAdminAllOpen(false)}>
            <DrawerContent className="border border-gray-200/95 bg-[#FAFAFA] p-0 text-slate-900 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100">
              <DrawerHeader className="text-left">
                <DrawerTitle className="font-['Manrope',system-ui,sans-serif] text-lg font-semibold text-slate-900 dark:text-white">
                  All bookings
                </DrawerTitle>
              </DrawerHeader>
              <div className="px-4 pb-6">{adminAllBody}</div>
            </DrawerContent>
          </Drawer>
        ) : (
          <Dialog open={adminAllOpen} onOpenChange={(v) => !v && setAdminAllOpen(false)}>
            <DialogContent className="max-w-lg gap-0 border border-gray-200/95 bg-[#FAFAFA] p-0 shadow-lg dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 sm:max-w-xl">
              <div className="border-b border-slate-200/80 px-6 py-4 dark:border-white/10">
                <DialogHeader>
                  <DialogTitle className="font-['Manrope',system-ui,sans-serif] text-xl font-semibold text-slate-900 dark:text-white">
                    All bookings
                  </DialogTitle>
                </DialogHeader>
              </div>
              <div className="px-6 py-4">{adminAllBody}</div>
            </DialogContent>
          </Dialog>
        )
      )}

      <MemberSummaryDialog
        open={!!profileMember}
        onOpenChange={(v) => !v && setProfileMember(null)}
        member={profileMember}
        viewer={user}
        onRoleChange={isAdmin ? handleCalendarMemberRoleChange : undefined}
        onProfileSaved={async () => {
          await fetchData();
        }}
        refreshUser={refreshUser}
        onRemoved={() => {
          setProfileMember(null);
          fetchData();
        }}
      />

      <BookingForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingBooking(null);
        }}
        onSuccess={fetchData}
        calendars={calendars}
        defaultDate={formInit.date}
        defaultStart={formInit.start}
        defaultEnd={formInit.end}
        canManualBook={canManualBook}
        members={members}
        editingBooking={editingBooking}
        allBookings={bookings}
      />
    </div>
  );
}