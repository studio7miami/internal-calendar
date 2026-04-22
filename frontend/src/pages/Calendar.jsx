import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import BookingForm from "../components/app/BookingForm";
import { fmtTimeShort } from "../lib/time";

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfWeek(d) {
  const x = new Date(d);
  const wd = x.getDay(); // 0 Sun
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

// Convert #RRGGBB -> rgba(r,g,b,alpha)
function rgba(hex, alpha) {
  const h = (hex || "#888").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function chipLabel(b, calendar) {
  // Special titling for Studio 7 Miami calendar (member @ Studio 7 Miami)
  const isStudio7 = (calendar?.name || "").trim().toLowerCase() === "studio 7 miami";
  const who = b.member_name ? b.member_name.split(" ")[0] : "Member";
  if (isStudio7) return `${who} @ Studio 7 Miami`;
  return b.notes?.trim() || calendar?.name || "Booking";
}

function BookingChip({ b, calendar, viewerIsAdmin, onClick }) {
  const isOwn = b.is_own;
  const isPending = b.status === "pending";
  const canSeeDetail = viewerIsAdmin || isOwn;

  // Admin and owner: color-coded chip tinted with calendar color
  if (canSeeDetail) {
    const color = calendar?.color || "#FAFAFA";
    const label = `${fmtTimeShort(b.start_time)} · ${chipLabel(b, calendar)}`;
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={`booking-chip-${b.id}`}
        className="text-[10px] leading-tight px-1.5 py-1 w-full text-left border rounded-[16px] truncate text-white transition-colors hover:brightness-125"
        style={{
          background: isPending ? rgba(color, 0.12) : rgba(color, 0.22),
          borderColor: isPending ? rgba(color, 0.4) : rgba(color, 0.7),
          borderLeft: `3px solid ${color}`,
          opacity: isPending ? 0.9 : 1,
        }}
        title={isPending ? `Pending · ${label}` : label}
      >
        {isPending ? "⏳ " : ""}{label}
      </button>
    );
  }

  // Other members' bookings (member view only): anonymous stripe
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`booking-chip-${b.id}`}
      className="text-[10px] leading-tight px-1.5 py-1 w-full text-left border border-neutral-800 text-neutral-400 rounded-sm truncate booked-stripe"
      style={{ borderLeftColor: calendar?.color || "#333", borderLeftWidth: 3 }}
    >
      Booked
    </button>
  );
}

export default function CalendarPage() {
  const { user } = useAuth();
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(new Date());
  const [calendars, setCalendars] = useState([]);
  const [enabledCalIds, setEnabledCalIds] = useState(new Set());
  const [bookings, setBookings] = useState([]);
  const [members, setMembers] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [formInit, setFormInit] = useState({});

  const isAdmin = user?.role === "admin";

  const fetchData = async () => {
    const [cals, bks] = await Promise.all([
      api.get("/calendars"),
      api.get("/bookings"),
    ]);
    setCalendars(cals.data);
    setBookings(bks.data);
    setEnabledCalIds((prev) =>
      prev.size === 0 ? new Set(cals.data.map((c) => c.id)) : prev
    );
    if (isAdmin) {
      try {
        const u = await api.get("/users");
        setMembers(u.data);
      } catch {}
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const calendarMap = useMemo(
    () => Object.fromEntries(calendars.map((c) => [c.id, c])),
    [calendars]
  );

  const visibleBookings = useMemo(
    () => bookings.filter((b) => enabledCalIds.has(b.calendar_id)),
    [bookings, enabledCalIds]
  );

  const toggleCal = (id) => {
    setEnabledCalIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const openForm = (date, start = "10:00", end = "11:00") => {
    setFormInit({ date, start, end });
    setFormOpen(true);
  };

  // ---- Month grid ----
  const renderMonth = () => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    const days = [];
    for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));

    return (
      <div className="border border-neutral-900 rounded-sm">
        <div className="grid grid-cols-7 border-b border-neutral-900">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="label-tech px-2 py-2 text-center border-r border-neutral-900 last:border-r-0">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 auto-rows-fr">
          {days.map((d, i) => {
            const key = ymd(d);
            const inMonth = sameMonth(d, cursor);
            const todaysBookings = visibleBookings.filter((b) => b.date === key);
            return (
              <div
                key={i}
                className={`min-h-[92px] border-r border-b border-neutral-900 last:border-r-0 p-1 flex flex-col gap-1 ${
                  inMonth ? "bg-transparent" : "bg-neutral-950/50 text-neutral-600"
                }`}
                data-testid={`month-cell-${key}`}
              >
                <button
                  type="button"
                  onClick={() => openForm(key)}
                  className="flex items-center justify-between text-[11px] hover:text-white"
                >
                  <span className={`font-mono ${inMonth ? "" : "opacity-50"}`}>
                    {d.getDate()}
                  </span>
                  <Plus className="w-3 h-3 opacity-40 hover:opacity-100" strokeWidth={1.5} />
                </button>
                <div className="space-y-1 overflow-hidden">
                  {todaysBookings.slice(0, 3).map((b) => (
                    <BookingChip
                      key={b.id}
                      b={b}
                      calendar={calendarMap[b.calendar_id]}
                      viewerIsAdmin={isAdmin}
                      onClick={() => {}}
                    />
                  ))}
                  {todaysBookings.length > 3 && (
                    <div className="label-tech text-[9px]">+{todaysBookings.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ---- Week / Day views (hourly grid) ----
  const renderHourGrid = (dayList) => {
    const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 7am..8pm
    return (
      <div className="border border-neutral-900 rounded-sm overflow-hidden">
        <div className="grid" style={{ gridTemplateColumns: `60px repeat(${dayList.length}, minmax(0, 1fr))` }}>
          <div className="label-tech p-2 border-r border-b border-neutral-900"></div>
          {dayList.map((d) => (
            <div
              key={ymd(d)}
              className="p-2 border-r border-b border-neutral-900 last:border-r-0 text-center"
            >
              <div className="label-tech">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div className="font-display text-lg">{d.getDate()}</div>
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `60px repeat(${dayList.length}, minmax(0, 1fr))` }}>
          {hours.map((h) => (
            <React.Fragment key={h}>
              <div className="label-tech p-2 border-r border-b border-neutral-900 text-right font-mono">
                {fmtTimeShort(`${String(h).padStart(2, "0")}:00`)}
              </div>
              {dayList.map((d) => {
                const key = ymd(d);
                const slotStart = `${String(h).padStart(2, "0")}:00`;
                const slotEnd = `${String(h + 1).padStart(2, "0")}:00`;
                const inSlot = visibleBookings.filter(
                  (b) =>
                    b.date === key &&
                    b.start_time < slotEnd &&
                    b.end_time > slotStart
                );
                return (
                  <button
                    type="button"
                    key={`${key}-${h}`}
                    onClick={() => openForm(key, slotStart, slotEnd)}
                    className="relative min-h-[56px] border-r border-b border-neutral-900 last:border-r-0 hover:bg-neutral-900/40 p-1 flex flex-col gap-1 text-left"
                    data-testid={`slot-${key}-${h}`}
                  >
                    {inSlot.map((b) => (
                      <BookingChip
                        key={b.id}
                        b={b}
                        calendar={calendarMap[b.calendar_id]}
                        viewerIsAdmin={isAdmin}
                        onClick={(e) => {
                          e?.stopPropagation?.();
                        }}
                      />
                    ))}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
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

  const title =
    view === "month"
      ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : view === "week"
      ? `Week of ${startOfWeek(cursor).toLocaleDateString()}`
      : cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="space-y-6" data-testid="calendar-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label-tech">Calendar</div>
          <h1 className="font-display text-3xl sm:text-4xl mt-1">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setCursor(new Date())}
            data-testid="today-button"
            className="border border-neutral-800 hover:bg-neutral-900 rounded-sm h-9"
          >
            Today
          </Button>
          <button
            onClick={() => navigate(-1)}
            data-testid="nav-prev-button"
            className="p-2 border border-neutral-800 hover:bg-neutral-900 rounded-sm"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
          </button>
          <button
            onClick={() => navigate(1)}
            data-testid="nav-next-button"
            className="p-2 border border-neutral-800 hover:bg-neutral-900 rounded-sm"
          >
            <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
          </button>
          <Button
            onClick={() => openForm(ymd(cursor))}
            data-testid="new-booking-button"
            className="bg-white text-black hover:bg-neutral-200 rounded-sm h-9"
          >
            <Plus className="w-4 h-4 mr-1" strokeWidth={1.5} /> New
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-4">
        <Tabs value={view} onValueChange={setView}>
          <TabsList className="bg-[#121214] border border-neutral-800">
            <TabsTrigger value="month" data-testid="view-month-tab" className="data-[state=active]:bg-white data-[state=active]:text-black">
              Month
            </TabsTrigger>
            <TabsTrigger value="week" data-testid="view-week-tab" className="data-[state=active]:bg-white data-[state=active]:text-black">
              Week
            </TabsTrigger>
            <TabsTrigger value="day" data-testid="view-day-tab" className="data-[state=active]:bg-white data-[state=active]:text-black">
              Day
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap gap-2">
          {calendars.map((c) => {
            const on = enabledCalIds.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleCal(c.id)}
                data-testid={`calendar-toggle-${c.id}`}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs border rounded-sm transition-colors ${
                  on
                    ? "border-neutral-700 bg-neutral-900 text-white"
                    : "border-neutral-900 text-neutral-500"
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: on ? c.color : "#333" }}
                />
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      {view === "month" && renderMonth()}
      {view === "week" && (
        <div className="overflow-x-auto scrollbar-thin">{renderWeek()}</div>
      )}
      {view === "day" && renderDay()}

      <BookingForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={fetchData}
        calendars={calendars}
        defaultDate={formInit.date}
        defaultStart={formInit.start}
        defaultEnd={formInit.end}
        isAdmin={isAdmin}
        members={members}
      />
    </div>
  );
}
