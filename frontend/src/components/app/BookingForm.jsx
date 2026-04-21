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
  const [mode, setMode] = useState(isAdmin ? "manual" : "request"); // admin picks
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
            className={`flex-1 px-3 py-2 text-xs uppercase tracking-wider border rounded-sm ${
              mode === "manual" ? "bg-white text-black border-white" : "border-neutral-800 text-neutral-400"
            }`}
          >
            Manual booking
          </button>
          <button
            type="button"
            data-testid="booking-mode-request"
            onClick={() => setMode("request")}
            className={`flex-1 px-3 py-2 text-xs uppercase tracking-wider border rounded-sm ${
              mode === "request" ? "bg-white text-black border-white" : "border-neutral-800 text-neutral-400"
            }`}
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
          className="w-full bg-[#121214] border border-neutral-800 rounded-sm h-10 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-white"
        >
          {calendars.map((c) => (
            <option key={c.id} value={c.id} style={{ background: "#121214" }}>
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
            className="w-full bg-[#121214] border border-neutral-800 rounded-sm h-10 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-white"
          >
            <option value="">{user?.name || "Admin"} (self)</option>
            {members.filter((m) => m.role === "member").map((m) => (
              <option key={m.id} value={m.id} style={{ background: "#121214" }}>
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
              className="w-full flex items-center justify-between bg-[#121214] border border-neutral-800 rounded-sm h-10 px-3 text-sm hover:bg-neutral-900 focus:outline-none focus:ring-1 focus:ring-white"
            >
              <span className={date ? "text-white" : "text-neutral-500"}>
                {date
                  ? new Date(date + "T00:00:00").toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Select a date"}
              </span>
              <CalendarIcon className="w-4 h-4 text-neutral-400" strokeWidth={1.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 bg-[#0F0F11] border-neutral-800" align="start">
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
              className="text-white"
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
            className="bg-[#121214] border-neutral-800 h-10 focus-visible:ring-white"
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
            className="bg-[#121214] border-neutral-800 h-10 focus-visible:ring-white"
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
          className="bg-[#121214] border-neutral-800 focus-visible:ring-white"
        />
      </div>

      {err && <div className="text-sm text-red-400 border border-red-900 bg-red-950/30 px-3 py-2">{err}</div>}

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          data-testid="booking-cancel-button"
          className="flex-1 border border-neutral-800 hover:bg-neutral-900 rounded-sm h-11"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={submitting}
          data-testid="booking-submit-button"
          className="flex-1 bg-white text-black hover:bg-neutral-200 rounded-sm h-11"
        >
          {submitting ? "Saving…" : isAdmin && mode === "manual" ? "Create booking" : "Send request"}
        </Button>
      </div>
    </form>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
        <DrawerContent className="bg-[#09090B] text-white border-neutral-900">
          <DrawerHeader>
            <DrawerTitle className="font-display text-2xl">New booking</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6">{Form}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#0F0F11] border-neutral-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">New booking</DialogTitle>
        </DialogHeader>
        {Form}
      </DialogContent>
    </Dialog>
  );
}
