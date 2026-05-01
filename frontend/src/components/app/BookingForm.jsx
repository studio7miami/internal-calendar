import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "../ui/drawer";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar as CalendarPicker } from "../ui/calendar";
import { Calendar as CalendarIcon } from "lucide-react";
import { api, formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { cn } from "@/lib/utils";

const r7 = "rounded-[7px]";

const calSurface =
  "border border-gray-200/95 bg-[#FAFAFA] text-slate-900 dark:border-white/70 dark:bg-zinc-950 dark:text-white";

const fieldClass =
  `h-10 w-full px-3 text-sm text-slate-900 placeholder:text-slate-400 border border-gray-200/95 dark:border-white/20 bg-white dark:bg-zinc-900/50 dark:text-white dark:placeholder:text-neutral-500 ` +
  `${r7} focus:outline-none focus:ring-1 focus:ring-slate-400/30 dark:focus:ring-white/20`;

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
  // Admins only create manual bookings (no request submission).
  const [mode, setMode] = useState(isAdmin || canManualBook ? "manual" : "request");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const p = user?.permissions || {};
  const canCancelBooking =
    editMode &&
    (editingBooking.is_own ||
      p.delete_any_booking ||
      (p.create_manual_booking && !editingBooking.is_own));

  React.useEffect(() => {
    if (!open) return;
    if (editMode) {
      setCalendarId(editingBooking.calendar_id || calendars?.[0]?.id || "");
      setDate(editingBooking.date || "");
      setStart(normTime(editingBooking.start_time));
      setEnd(normTime(editingBooking.end_time));
      setNotes(editingBooking.notes ?? "");
      setMemberId("");
      setRecurFreq("none");
      setRecurUntil("");
      setErr("");
      return;
    }
    setCalendarId(calendars?.[0]?.id || "");
    setDate(defaultDate || "");
    setStart(defaultStart || "10:00");
    setEnd(defaultEnd || "11:00");
    setNotes("");
    setMemberId("");
    setRecurFreq("none");
    setRecurUntil("");
    setErr("");
    setMode(isAdmin || canManualBook ? "manual" : "request");
  }, [open, editMode, editingBooking, defaultDate, defaultStart, defaultEnd, calendars, canManualBook, isAdmin]);

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
        await api.patch(`/bookings/${editingBooking.id}`, {
          date,
          start_time: start,
          end_time: end,
          notes,
        });
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
        <select
          value={calendarId}
          onChange={(e) => setCalendarId(e.target.value)}
          required
          disabled={editMode}
          data-testid="booking-calendar-select"
          className={cn(fieldClass, editMode && "cursor-not-allowed opacity-70")}
        >
          {calendars.map((c) => (
            <option key={c.id} value={c.id} className="text-slate-900 dark:bg-zinc-900">
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {canManualBook && mode === "manual" && !editMode && (
        <div>
          <label className="label-tech block mb-1">Assign member</label>
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            data-testid="booking-member-select"
            className={fieldClass}
          >
            <option value="">{user?.name || "Admin"} (self)</option>
            {members.filter((m) => m.role === "member").map((m) => (
              <option key={m.id} value={m.id} className="text-slate-900 dark:bg-zinc-900">
                {m.name} · {m.email}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="label-tech block mb-1">Date</label>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="booking-date-button"
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
          </PopoverTrigger>
          <PopoverContent
            className="w-auto rounded-[7px] border border-gray-200/95 bg-white p-0 text-slate-900 shadow-md dark:border-white/20 dark:bg-zinc-900 dark:text-white"
            sideOffset={4}
            align="start"
          >
            <CalendarPicker
              mode="single"
              selected={date ? new Date(date + "T00:00:00") : undefined}
              onSelect={(d) => {
                if (!d) return;
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const dd = String(d.getDate()).padStart(2, "0");
                setDate(`${y}-${m}-${dd}`);
              }}
              initialFocus
              className="text-slate-900 dark:text-white"
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
        <div className="min-w-0 overflow-hidden">
          <label className="label-tech block mb-1">Start</label>
          <Input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            data-testid="booking-start-input"
            className={cn("min-w-0 shadow-sm", fieldClass, "md:text-sm")}
          />
        </div>
        <div className="min-w-0 overflow-hidden">
          <label className="label-tech block mb-1">End</label>
          <Input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
            data-testid="booking-end-input"
            className={cn("min-w-0 shadow-sm", fieldClass, "md:text-sm")}
          />
        </div>
      </div>

      {!editMode && (
        <div className="space-y-2" data-testid="booking-recurring-section">
          <div className="label-tech">RECURRING</div>
          <select
            value={recurFreq}
            onChange={(e) => {
              const v = e.target.value;
              setRecurFreq(v);
              if (v === "none") setRecurUntil("");
              else if (!recurUntil || recurUntil < date) setRecurUntil(date);
            }}
            className={fieldClass}
            data-testid="booking-recurring-frequency"
          >
            <option value="none">Never</option>
            <option value="daily">Every day</option>
            <option value="monthly">Every month</option>
            <option value="weekly">Every week</option>
            <option value="yearly">Every year</option>
          </select>

          {recurFreq !== "none" && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="booking-recurring-until-button"
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
              </PopoverTrigger>
              <PopoverContent
                className="w-auto rounded-[7px] border border-gray-200/95 bg-white p-0 text-slate-900 shadow-md dark:border-white/20 dark:bg-zinc-900 dark:text-white"
                sideOffset={4}
                align="start"
              >
                <CalendarPicker
                  mode="single"
                  selected={recurUntil ? new Date(recurUntil + "T00:00:00") : undefined}
                  onSelect={(d) => {
                    if (!d) return;
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, "0");
                    const dd = String(d.getDate()).padStart(2, "0");
                    const next = `${y}-${m}-${dd}`;
                    setRecurUntil(next);
                  }}
                  initialFocus
                  className="text-slate-900 dark:text-white"
                />
              </PopoverContent>
            </Popover>
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
        <DrawerContent className={cn("p-0", calSurface)}>
          <DrawerHeader>
            <DrawerTitle className="text-left font-['Manrope',system-ui,sans-serif] text-2xl font-semibold text-slate-900 dark:text-white">
              {formTitle}
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6">{Form}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={cn("max-w-md gap-0 p-0 shadow-lg", calSurface)}>
        <div className="p-6">
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
