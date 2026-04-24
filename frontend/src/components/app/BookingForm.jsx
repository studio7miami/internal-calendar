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
  isAdmin,
  members = [],
}) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [calendarId, setCalendarId] = useState(calendars?.[0]?.id || "");
  const [date, setDate] = useState(defaultDate || "");
  const [start, setStart] = useState(defaultStart || "10:00");
  const [end, setEnd] = useState(defaultEnd || "11:00");
  const [notes, setNotes] = useState("");
  const [memberId, setMemberId] = useState("");
  const [mode, setMode] = useState(isAdmin ? "manual" : "request");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (open) {
      setCalendarId(calendars?.[0]?.id || "");
      setDate(defaultDate || "");
      setStart(defaultStart || "10:00");
      setEnd(defaultEnd || "11:00");
      setNotes("");
      setMemberId("");
      setErr("");
      setMode(isAdmin ? "manual" : "request");
    }
  }, [open, defaultDate, defaultStart, defaultEnd, calendars, isAdmin]);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    try {
      const payload = {
        calendar_id: calendarId,
        date,
        start_time: start,
        end_time: end,
        notes,
      };
      if (isAdmin && mode === "manual") {
        if (memberId) payload.member_id = memberId;
        await api.post("/bookings/manual", payload);
      } else {
        await api.post("/bookings/request", payload);
      }
      onSuccess?.();
      onClose();
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const Form = (
    <form onSubmit={submit} className="space-y-4" data-testid="booking-form">
      {isAdmin && (
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
          data-testid="booking-calendar-select"
          className={fieldClass}
        >
          {calendars.map((c) => (
            <option key={c.id} value={c.id} className="text-slate-900 dark:bg-zinc-900">
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {isAdmin && mode === "manual" && (
        <div>
          <label className="label-tech block mb-1">Assign member (optional)</label>
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label-tech block mb-1">Start</label>
          <Input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            data-testid="booking-start-input"
            className={cn("shadow-sm", fieldClass, "md:text-sm")}
          />
        </div>
        <div>
          <label className="label-tech block mb-1">End</label>
          <Input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
            data-testid="booking-end-input"
            className={cn("shadow-sm", fieldClass, "md:text-sm")}
          />
        </div>
      </div>

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

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          data-testid="booking-cancel-button"
          className={cn(
            "h-10 flex-1 min-h-8 box-border border border-gray-200/50 bg-transparent text-neutral-400",
            "hover:bg-slate-50/80 hover:text-neutral-500 dark:border-white/20 dark:text-neutral-500 dark:hover:bg-zinc-800/50 dark:hover:text-neutral-400",
            r7
          )}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="ghost"
          disabled={submitting}
          data-testid="booking-submit-button"
          className={cn(
            "h-10 flex-1 min-h-8 box-border",
            "border border-gray-200/95 bg-white/90 text-slate-900",
            "hover:bg-slate-100 dark:border-white/20 dark:bg-zinc-900/30 dark:text-white dark:hover:bg-zinc-800",
            "disabled:pointer-events-none disabled:opacity-60",
            r7
          )}
        >
          {submitting ? "Saving…" : isAdmin && mode === "manual" ? "Create booking" : "Send request"}
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
              New booking
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
              New booking
            </DialogTitle>
          </DialogHeader>
          <div className="pt-2">{Form}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
