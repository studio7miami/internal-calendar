import React, { useEffect, useRef, useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "../ui/drawer";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Calendar as CalendarPicker } from "../ui/calendar";
import { Calendar as CalendarIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { api, formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { cn } from "@/lib/utils";

const r7 = "rounded-[7px]";

const calSurface =
  "border border-gray-200/[0.07] bg-[#FAFAFA] text-slate-900 dark:border-white/[0.07] dark:bg-zinc-950 dark:text-white";

const fieldClass =
  `h-10 w-full px-3 text-sm text-slate-900 placeholder:text-slate-400 border border-gray-200/95 dark:border-white/20 bg-white dark:bg-zinc-900/50 dark:text-white dark:placeholder:text-neutral-500 ` +
  `${r7} focus:outline-none focus:ring-1 focus:ring-slate-400/30 dark:focus:ring-white/20`;

const selectTriggerClass = cn(
  fieldClass,
  "flex items-center justify-between shadow-sm",
  "focus:outline-none focus:ring-1 focus:ring-slate-400/30 dark:focus:ring-white/20"
);

const SELF_MEMBER_VALUE = "__self__";

const chipToggle = (on) =>
  cn(
    "flex-1 min-h-8 box-border border px-3 py-1.5 text-xs leading-none transition-colors",
    r7,
    on
      ? "border border-gray-200/95 bg-[#FCFCFC] text-black dark:border-white/70 dark:bg-white/10 dark:text-white"
      : "border border-gray-200/50 text-neutral-400 dark:border-white/20 dark:text-neutral-500"
  );

function normTime(t) {
  if (!t) return "10:00";
  const s = String(t);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function fmtTimeLabel(hhmm) {
  const s = normTime(hhmm);
  const [hhRaw, mmRaw] = s.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return s;
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

const TIME_OPTIONS = (() => {
  const out = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

/** Local calendar date YYYY-MM-DD */
function ymdLocalFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Next half-hour at or after `now` (local), e.g. 11:20 → 11:30. */
function earliestNextHalfHourSlot(now = new Date()) {
  const z = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ms = now.getTime() - z.getTime();
  const half = 30 * 60 * 1000;
  const slot = Math.ceil(ms / half - 1e-9) * half;
  const totalMin = Math.floor(slot / 60000);
  if (totalMin >= 24 * 60) return null;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToMinutes(t) {
  const [h, mm] = normTime(t).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return 0;
  return h * 60 + mm;
}

function compareHHMM(a, b) {
  return hhmmToMinutes(a) - hhmmToMinutes(b);
}

/** Default end = start + 1h on the half-hour grid; same-day cap 23:30 (23:00 → 23:30). */
function addOneHourHHMM(hhmm) {
  const s = hhmmToMinutes(hhmm);
  const last = 23 * 60 + 30;
  const e = Math.min(s + 60, last);
  const h = Math.floor(e / 60);
  const m = e % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

export default function BookingForm({
  open,
  onClose,
  onSuccess,
  calendars,
  defaultDate,
  defaultStart,
  defaultEnd,
  canManualBook,
  members = [],
  /** Users eligible as assignees when reassigning an existing booking (role `member`). */
  reassignMembers = [],
  canReassignBooking = false,
  editingBooking = null,
  allBookings = [],
}) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const isAdmin = user?.role === "admin";
  const editMode = Boolean(editingBooking?.id);
  const [calendarId, setCalendarId] = useState(calendars?.[0]?.id || "");
  const [date, setDate] = useState(defaultDate || "");
  const [start, setStart] = useState(defaultStart || "10:00");
  const [end, setEnd] = useState(defaultEnd || "11:00");
  const [notes, setNotes] = useState("");
  const [memberId, setMemberId] = useState("");
  const [recurFreq, setRecurFreq] = useState("none"); // none | daily | weekly | monthly | yearly
  const [recurUntil, setRecurUntil] = useState("");
  const [recurUntilOpen, setRecurUntilOpen] = useState(false);
  const recurUntilAnchorRef = useRef(null);
  const [dateOpen, setDateOpen] = useState(false);
  // Admins only create manual bookings (no request submission).
  const [mode, setMode] = useState(isAdmin || canManualBook ? "manual" : "request");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const p = user?.permissions || {};
  const canCancelBooking =
    editMode &&
    (editingBooking.is_own ||
      p.delete_any_booking);

  const reassignSelectOptions = useMemo(() => {
    const rows = (reassignMembers || []).filter((m) => m?.role === "member");
    if (!editMode || !editingBooking?.member_id) return rows;
    const mid = String(editingBooking.member_id);
    if (rows.some((m) => String(m.id) === mid)) return rows;
    return [
      {
        id: editingBooking.member_id,
        name: editingBooking.member_name || "Member",
        email: editingBooking.member_email || "",
        role: "member",
      },
      ...rows,
    ];
  }, [reassignMembers, editMode, editingBooking]);

  React.useEffect(() => {
    if (!open) return;
    if (editMode) {
      setCalendarId(editingBooking.calendar_id || calendars?.[0]?.id || "");
      setDate(editingBooking.date || "");
      setStart(normTime(editingBooking.start_time));
      setEnd(normTime(editingBooking.end_time));
      setNotes(editingBooking.notes ?? "");
      setMemberId(editingBooking.member_id != null ? String(editingBooking.member_id) : "");
      setRecurFreq("none");
      setRecurUntil("");
      setRecurUntilOpen(false);
      setDateOpen(false);
      setErr("");
      return;
    }
    setCalendarId(calendars?.[0]?.id || "");
    const d0 = defaultDate || "";
    const today0 = ymdLocalFromDate(new Date());
    let s0 = defaultStart || "10:00";
    let e0 = defaultEnd || "11:00";
    if (d0 === today0) {
      const min0 = earliestNextHalfHourSlot(new Date());
      if (min0 && compareHHMM(s0, min0) < 0) {
        s0 = min0;
        e0 = addOneHourHHMM(min0);
      }
    }
    setDate(d0);
    setStart(s0);
    setEnd(e0);
    setNotes("");
    setMemberId("");
    setRecurFreq("none");
    setRecurUntil("");
    setRecurUntilOpen(false);
    setDateOpen(false);
    setErr("");
    setMode(isAdmin || canManualBook ? "manual" : "request");
  }, [open, editMode, editingBooking, defaultDate, defaultStart, defaultEnd, calendars, canManualBook, isAdmin]);

  useEffect(() => {
    if (!isMobile) return;
    if (!recurUntilOpen) return;
    // In the mobile drawer, ensure the inline calendar scrolls into view.
    const t = setTimeout(() => {
      recurUntilAnchorRef.current?.scrollIntoView?.({ block: "nearest" });
    }, 0);
    return () => clearTimeout(t);
  }, [isMobile, recurUntilOpen]);

  const startTimeOptions = useMemo(() => {
    let opts = TIME_OPTIONS.filter((t) => compareHHMM(addOneHourHHMM(t), t) > 0);
    if (date) {
      const today = ymdLocalFromDate(new Date());
      if (date === today) {
        const min = earliestNextHalfHourSlot(new Date());
        if (min) opts = opts.filter((t) => compareHHMM(t, min) >= 0);
        else opts = [];
      }
    }
    if (editMode && editingBooking?.start_time) {
      const cur = normTime(editingBooking.start_time);
      if (!opts.includes(cur)) opts = [...opts, cur].sort((a, b) => compareHHMM(a, b));
    }
    return opts;
  }, [date, editMode, editingBooking?.start_time]);

  const endTimeOptions = useMemo(
    () => TIME_OPTIONS.filter((t) => compareHHMM(t, start) > 0),
    [start]
  );

  useEffect(() => {
    if (!open || editMode || !date) return;
    const n = normTime(start);
    if (startTimeOptions.length && !startTimeOptions.includes(n)) {
      const fix = startTimeOptions[0];
      if (fix) {
        setStart(fix);
        setEnd(addOneHourHHMM(fix));
      }
    }
  }, [open, editMode, date, startTimeOptions, start]);

  const addDays = (ymdStr, days) => {
    const d = new Date(`${ymdStr}T00:00:00`);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  const daysInMonth = (y, m1to12) => new Date(y, m1to12, 0).getDate();

  const addMonths = (ymdStr, months) => {
    const d = new Date(`${ymdStr}T00:00:00`);
    const day = d.getDate();
    const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
    const dim = daysInMonth(target.getFullYear(), target.getMonth() + 1);
    target.setDate(Math.min(day, dim));
    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, "0");
    const dd = String(target.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  const addYears = (ymdStr, years) => addMonths(ymdStr, years * 12);

  const buildRecurrenceDates = () => {
    if (!date) return [];
    if (!recurFreq || recurFreq === "none") return [date];
    if (!recurUntil) return [date];
    if (recurUntil < date) return [date];

    const dates = [];
    let cur = date;
    const max = 366 * 5; // safety cap
    for (let i = 0; i < max; i++) {
      dates.push(cur);
      if (cur === recurUntil) break;
      if (recurFreq === "daily") cur = addDays(cur, 1);
      else if (recurFreq === "weekly") cur = addDays(cur, 7);
      else if (recurFreq === "monthly") cur = addMonths(cur, 1);
      else if (recurFreq === "yearly") cur = addYears(cur, 1);
      else break;
      if (cur > recurUntil) break;
    }
    return dates;
  };

  const handleDeleteBooking = async () => {
    if (!editingBooking?.id) return;
    if (!window.confirm("Cancel this booking? It will be removed from the calendar.")) return;
    setErr("");
    setDeleting(true);
    try {
      await api.delete(`/bookings/${editingBooking.id}`);
      onSuccess?.();
      onClose();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Could not cancel");
    } finally {
      setDeleting(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    try {
      if (editMode) {
        const patch = {
          date,
          start_time: start,
          end_time: end,
          notes,
        };
        if (canReassignBooking) {
          const orig = String(editingBooking.member_id ?? "");
          const next = String(memberId || "");
          if (next && next !== orig) patch.member_id = next;
        }
        await api.patch(`/bookings/${editingBooking.id}`, patch);
      } else {
        const basePayload = {
          calendar_id: calendarId,
          date,
          start_time: start,
          end_time: end,
          notes,
        };
        const dates = buildRecurrenceDates();
        for (const d of dates) {
          const payload = { ...basePayload, date: d };
          if ((isAdmin || canManualBook) && mode === "manual") {
            if (memberId) payload.member_id = memberId;
            await api.post("/bookings/manual", payload);
          } else {
            await api.post("/bookings/request", payload);
          }
        }
      }
      onSuccess?.();
      onClose();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const formTitle = editMode ? "Your booking" : "New booking";
  const statusLine =
    editMode && editingBooking.status === "pending" ? (
      <p className="text-sm text-slate-600 dark:text-zinc-400">Pending approval — you can still change the time or cancel.</p>
    ) : null;

  const Form = (
    <form onSubmit={submit} className="space-y-4" data-testid="booking-form">
      {statusLine}

      {canManualBook && !editMode && !isAdmin && (
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="booking-mode-manual"
            onClick={() => setMode("manual")}
            className={chipToggle(mode === "manual")}
          >
            Manual booking
          </button>
          <button
            type="button"
            data-testid="booking-mode-request"
            onClick={() => setMode("request")}
            className={chipToggle(mode === "request")}
          >
            Submit request
          </button>
        </div>
      )}

      <div>
        <label className="label-tech block mb-1">Calendar</label>
        <Select value={String(calendarId || "")} onValueChange={setCalendarId} disabled={editMode}>
          <SelectTrigger
            data-testid="booking-calendar-select"
            className={cn(selectTriggerClass, editMode && "cursor-not-allowed opacity-70")}
          >
            <SelectValue placeholder="Select calendar" />
          </SelectTrigger>
          <SelectContent>
            {calendars.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {editMode && canReassignBooking && reassignSelectOptions.length > 0 && (
        <div>
          <label className="label-tech block mb-1">Assign to member</label>
          <Select value={String(memberId || "")} onValueChange={setMemberId}>
            <SelectTrigger data-testid="booking-edit-member-select" className={selectTriggerClass}>
              <SelectValue placeholder="Select member" />
            </SelectTrigger>
            <SelectContent>
              {reassignSelectOptions.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name} · {m.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {canManualBook && mode === "manual" && !editMode && (
        <div>
          <label className="label-tech block mb-1">Assign member</label>
          <Select
            value={memberId ? String(memberId) : SELF_MEMBER_VALUE}
            onValueChange={(v) => setMemberId(v === SELF_MEMBER_VALUE ? "" : v)}
          >
            <SelectTrigger data-testid="booking-member-select" className={selectTriggerClass}>
              <SelectValue placeholder={`${user?.name || "Admin"} (self)`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SELF_MEMBER_VALUE}>{user?.name || "Admin"} (self)</SelectItem>
              {members
                .filter((m) => m.role === "member")
                .map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.name} · {m.email}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <label className="label-tech block mb-1">Date</label>
        <button
          type="button"
          data-testid="booking-date-button"
          onClick={() => {
            setDateOpen((v) => !v);
            setRecurUntilOpen(false);
          }}
          className={cn(
            "flex w-full h-10 items-center justify-between px-3 text-sm",
            "border border-gray-200/95 dark:border-white/20 bg-white dark:bg-zinc-900/50",
            "text-slate-900 dark:text-white transition-colors hover:bg-slate-50/80 dark:hover:bg-zinc-800/50",
            "focus:outline-none focus:ring-1 focus:ring-slate-400/30 dark:focus:ring-white/20",
            r7
          )}
        >
          <span className={date ? "text-slate-900 dark:text-white" : "text-slate-400 dark:text-neutral-500"}>
            {date
              ? new Date(date + "T00:00:00").toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "Select a date"}
          </span>
          <CalendarIcon className="h-4 w-4 text-slate-500 dark:text-neutral-400" strokeWidth={1.5} />
        </button>

        {dateOpen && (
          <div className="mt-2 w-full overflow-hidden rounded-[7px] border border-gray-200/95 bg-white p-0 text-slate-900 shadow-md dark:border-white/20 dark:bg-zinc-900 dark:text-white">
            <CalendarPicker
              mode="single"
              selected={date ? new Date(date + "T00:00:00") : undefined}
              classNames={{
                months: "w-full",
                month: "w-full space-y-4",
                table: "w-full border-collapse space-y-1",
                head_row: "flex w-full",
                head_cell: "flex-1 text-center text-muted-foreground rounded-md font-normal text-[0.8rem]",
                row: "flex w-full mt-2",
                cell:
                  "relative flex-1 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected])]:rounded-md",
                day: "h-9 w-full p-0 font-normal aria-selected:opacity-100",
              }}
              onSelect={(d) => {
                if (!d) return;
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const dd = String(d.getDate()).padStart(2, "0");
                const next = `${y}-${m}-${dd}`;
                setDate(next);
                setDateOpen(false);
                if (!editMode) {
                  const today = ymdLocalFromDate(new Date());
                  if (next === today) {
                    const min = earliestNextHalfHourSlot(new Date());
                    if (min) {
                      setStart(min);
                      setEnd(addOneHourHHMM(min));
                    }
                  }
                }
              }}
              initialFocus
              className="w-full text-slate-900 dark:text-white"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 overflow-hidden">
          <label className="label-tech block mb-1">Start</label>
          <Select
            value={String(normTime(start))}
            onValueChange={(v) => {
              setStart(v);
              setEnd(addOneHourHHMM(v));
            }}
          >
            <SelectTrigger data-testid="booking-start-input" className={cn(selectTriggerClass, "md:text-sm")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {startTimeOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {fmtTimeLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 overflow-hidden">
          <label className="label-tech block mb-1">End</label>
          <Select value={String(normTime(end))} onValueChange={setEnd}>
            <SelectTrigger data-testid="booking-end-input" className={cn(selectTriggerClass, "md:text-sm")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {endTimeOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {fmtTimeLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!editMode && (
        <div className="space-y-2" data-testid="booking-recurring-section">
          <div className="label-tech">RECURRING</div>
          <Select
            value={String(recurFreq || "none")}
            onValueChange={(v) => {
              setRecurFreq(v);
              if (v === "none") setRecurUntil("");
              else if (!recurUntil || recurUntil < date) setRecurUntil(date);
              setRecurUntilOpen(false);
            }}
          >
            <SelectTrigger data-testid="booking-recurring-frequency" className={selectTriggerClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Never</SelectItem>
              <SelectItem value="daily">Every day</SelectItem>
              <SelectItem value="monthly">Every month</SelectItem>
              <SelectItem value="weekly">Every week</SelectItem>
              <SelectItem value="yearly">Every year</SelectItem>
            </SelectContent>
          </Select>

          {recurFreq !== "none" && (
            <div className="space-y-2">
              <div className="label-tech">END DATE</div>
              {isMobile ? (
                <>
                  <button
                    type="button"
                    data-testid="booking-recurring-until-button"
                    onClick={() => setRecurUntilOpen((v) => !v)}
                    className={cn(
                      "flex w-full h-10 items-center justify-between px-3 text-sm",
                      "border border-gray-200/95 dark:border-white/20 bg-white dark:bg-zinc-900/50",
                      "text-slate-900 dark:text-white transition-colors hover:bg-slate-50/80 dark:hover:bg-zinc-800/50",
                      "focus:outline-none focus:ring-1 focus:ring-slate-400/30 dark:focus:ring-white/20",
                      r7
                    )}
                  >
                    <span className={recurUntil ? "text-slate-900 dark:text-white" : "text-slate-400 dark:text-neutral-500"}>
                      {recurUntil
                        ? new Date(recurUntil + "T00:00:00").toLocaleDateString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "Select end date"}
                    </span>
                    <CalendarIcon className="h-4 w-4 text-slate-500 dark:text-neutral-400" strokeWidth={1.5} />
                  </button>

                  {recurUntilOpen && (
                    <div
                      ref={recurUntilAnchorRef}
                      className="w-full overflow-hidden rounded-[7px] border border-gray-200/95 bg-white p-0 text-slate-900 shadow-md dark:border-white/20 dark:bg-zinc-900 dark:text-white"
                    >
                      <CalendarPicker
                        mode="single"
                        selected={recurUntil ? new Date(recurUntil + "T00:00:00") : undefined}
                        classNames={{
                          months: "w-full",
                          month: "w-full space-y-4",
                          table: "w-full border-collapse space-y-1",
                          head_row: "flex w-full",
                          head_cell: "flex-1 text-center text-muted-foreground rounded-md font-normal text-[0.8rem]",
                          row: "flex w-full mt-2",
                          cell:
                            "relative flex-1 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected])]:rounded-md",
                          day: "h-9 w-full p-0 font-normal aria-selected:opacity-100",
                        }}
                        onSelect={(d) => {
                          if (!d) return;
                          const y = d.getFullYear();
                          const m = String(d.getMonth() + 1).padStart(2, "0");
                          const dd = String(d.getDate()).padStart(2, "0");
                          const next = `${y}-${m}-${dd}`;
                          setRecurUntil(next);
                          setRecurUntilOpen(false);
                        }}
                        initialFocus
                        className="text-slate-900 dark:text-white"
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    data-testid="booking-recurring-until-button"
                    onClick={() => {
                      setRecurUntilOpen((v) => !v);
                      setDateOpen(false);
                    }}
                    className={cn(
                      "flex w-full h-10 items-center justify-between px-3 text-sm",
                      "border border-gray-200/95 dark:border-white/20 bg-white dark:bg-zinc-900/50",
                      "text-slate-900 dark:text-white transition-colors hover:bg-slate-50/80 dark:hover:bg-zinc-800/50",
                      "focus:outline-none focus:ring-1 focus:ring-slate-400/30 dark:focus:ring-white/20",
                      r7
                    )}
                  >
                    <span className={recurUntil ? "text-slate-900 dark:text-white" : "text-slate-400 dark:text-neutral-500"}>
                      {recurUntil
                        ? new Date(recurUntil + "T00:00:00").toLocaleDateString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "Select end date"}
                    </span>
                    <CalendarIcon className="h-4 w-4 text-slate-500 dark:text-neutral-400" strokeWidth={1.5} />
                  </button>

                  {recurUntilOpen && (
                    <div className="mt-2 w-full overflow-hidden rounded-[7px] border border-gray-200/95 bg-white p-0 text-slate-900 shadow-md dark:border-white/20 dark:bg-zinc-900 dark:text-white">
                      <CalendarPicker
                        mode="single"
                        selected={recurUntil ? new Date(recurUntil + "T00:00:00") : undefined}
                        classNames={{
                          months: "w-full",
                          month: "w-full space-y-4",
                          table: "w-full border-collapse space-y-1",
                          head_row: "flex w-full",
                          head_cell: "flex-1 text-center text-muted-foreground rounded-md font-normal text-[0.8rem]",
                          row: "flex w-full mt-2",
                          cell:
                            "relative flex-1 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected])]:rounded-md",
                          day: "h-9 w-full p-0 font-normal aria-selected:opacity-100",
                        }}
                        onSelect={(d) => {
                          if (!d) return;
                          const y = d.getFullYear();
                          const m = String(d.getMonth() + 1).padStart(2, "0");
                          const dd = String(d.getDate()).padStart(2, "0");
                          const next = `${y}-${m}-${dd}`;
                          setRecurUntil(next);
                          setRecurUntilOpen(false);
                        }}
                        initialFocus
                        className="w-full text-slate-900 dark:text-white"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <label className="label-tech block mb-1">Notes</label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          data-testid="booking-notes-input"
          className={cn(
            "min-h-[4.5rem] w-full border border-gray-200/95 dark:border-white/20 bg-white px-3 py-2 text-sm",
            "text-slate-900 dark:bg-zinc-900/50 dark:text-white",
            "placeholder:text-slate-400 dark:placeholder:text-neutral-500",
            r7,
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400/30 dark:focus-visible:ring-white/20"
          )}
        />
      </div>

      {err && (
        <div
          className={cn("border border-red-200 dark:border-red-900/50 bg-red-50 px-3 py-2 text-sm text-red-700", r7, "dark:bg-red-950/30 dark:text-red-300")}
        >
          {err}
        </div>
      )}

      {canCancelBooking && (
        <div className="border-t border-slate-200/80 pt-3 dark:border-white/10">
          <button
            type="button"
            onClick={handleDeleteBooking}
            disabled={deleting || submitting}
            data-testid="booking-delete-button"
            className={cn(
              "text-sm font-medium text-red-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
            )}
          >
            {deleting ? "Canceling…" : "Cancel booking"}
          </button>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          data-testid="booking-close-button"
          className={cn(
            "h-10 flex-1 min-h-8 box-border border border-gray-200/50 bg-transparent text-neutral-400",
            "hover:bg-slate-50/80 hover:text-neutral-500 dark:border-white/20 dark:text-neutral-500 dark:hover:bg-zinc-800/50 dark:hover:text-neutral-400",
            r7
          )}
        >
          Close
        </Button>
        <Button
          type="submit"
          variant="ghost"
          disabled={submitting || deleting}
          data-testid="booking-submit-button"
          className={cn(
            "h-10 flex-1 min-h-8 box-border",
            "border border-gray-200/95 bg-white/90 text-slate-900",
            "hover:bg-slate-100 dark:border-white/20 dark:bg-zinc-900/30 dark:text-white dark:hover:bg-zinc-800",
            "disabled:pointer-events-none disabled:opacity-60",
            r7
          )}
        >
          {submitting
            ? "Saving…"
            : editMode
            ? "Save changes"
            : (isAdmin || canManualBook) && mode === "manual"
            ? "Create booking"
            : "Send request"}
        </Button>
      </div>
    </form>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
        <DrawerContent className={cn("p-0 max-h-[calc(100dvh-3.5rem)] overflow-hidden", calSurface)}>
          <DrawerHeader>
            <DrawerTitle className="text-left font-['Manrope',system-ui,sans-serif] text-2xl font-semibold text-slate-900 dark:text-white">
              {formTitle}
            </DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{Form}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={cn(
          "max-w-md gap-0 p-0 shadow-lg",
          "max-h-[calc(100dvh-3.5rem)] overflow-hidden",
          calSurface
        )}
      >
        <div className="no-scrollbar max-h-[calc(100dvh-3.5rem)] overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle className="font-['Manrope',system-ui,sans-serif] text-2xl font-semibold text-slate-900 dark:text-white">
              {formTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="pt-2">{Form}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
