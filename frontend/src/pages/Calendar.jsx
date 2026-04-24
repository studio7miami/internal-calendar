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


function rgba(hex, alpha) {
  const h = (hex || "#888").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}


function chipLabel(b, calendar) {
  const isStudio7 = (calendar?.name || "").trim().toLowerCase() === "studio 7 miami";
  const who = b.member_name ? b.member_name.split(" ")[0] : "Member";
  if (isStudio7) return `${who} @ Studio 7 Miami`;
  return b.notes?.trim() || calendar?.name || "Booking";
}


function BookingChip({ b, calendar, viewerIsAdmin, onClick }) {
  const isOwn = b.is_own;
  const isPending = b.status === "pending";
  const canSeeDetail = viewerIsAdmin || isOwn;

  if (canSeeDetail) {
    const color = calendar?.color || "#FAFAFA";
    const label = `${fmtTimeShort(b.start_time)} · ${chipLabel(b, calendar)}`;
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={`booking-chip-${b.id}`}
        className="text-[10px] leading-tight px-2 py-1.5 w-full text-left border rounded-md truncate text-slate-900 transition-colors hover:brightness-105"
        style={{
          background: isPending ? rgba(color, 0.14) : rgba(color, 0.20),
          borderColor: isPending ? rgba(color, 0.28) : rgba(color, 0.38),
          borderLeft: `3px solid ${color}`,
          opacity: isPending ? 0.9 : 1,
        }}
        title={isPending ? `Pending · ${label}` : label}
      >
        {isPending ? "⏳ " : ""}{label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`booking-chip-${b.id}`}
      className="text-[10px] leading-tight px-2 py-1.5 w-full text-left border rounded-md truncate booked-stripe-light text-slate-600"
      style={{
        borderColor: "rgba(15, 23, 42, 0.16)",
        borderLeftColor: calendar?.color || "#333",
        borderLeftWidth: 3,
      }}
    >
      Booked
    </button>
  );
}


export default function CalendarPage() {
  const { user } = useAuth();
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(new Date());
  const [selectedYmd, setSelectedYmd] = useState(() => ymd(new Date()));
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
    setSelectedYmd(date);
    setFormInit({ date, start, end });
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
      <div className="glass-card rounded-[28px] overflow-hidden">
        <div className="grid grid-cols-7 border-b soft-divider">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, idx) => (
            <div
              key={d}
              className={`px-3 py-3 text-center text-[11px] tracking-[0.22em] uppercase font-mono text-slate-500 soft-divider ${
                idx !== 6 ? "border-r" : ""
              }`}
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 auto-rows-fr">
          {days.map((d, i) => {
            const key = ymd(d);
            const inMonth = sameMonth(d, cursor);
            const todaysBookings = visibleBookings.filter((b) => b.date === key);
            const isSelected = key === selectedYmd;
            const isToday = key === todayKey;
            const isLastRow = i >= 35;
            return (
              <div
                key={i}
                className={`group min-h-[96px] ${isLastRow ? "" : "border-b"} soft-divider p-2.5 flex flex-col gap-2 ${
                  (i % 7) !== 6 ? "border-r soft-divider" : ""
                } ${inMonth ? "text-slate-900" : "text-slate-400"}`}
                data-testid={`month-cell-${key}`}
              >
                <button
                  type="button"
                  onClick={() => openForm(key)}
                  className="relative flex items-center justify-between text-[12px] leading-none"
                >
                  <span
                    className={`h-8 w-8 rounded-full grid place-items-center font-mono transition-colors ${
                      isSelected
                        ? "bg-slate-900 text-white"
                        : isToday
                        ? "bg-slate-900/10 text-slate-900"
                        : "text-current"
                    } ${inMonth ? "" : "opacity-70"}`}
                  >
                    {d.getDate()}
                  </span>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <Plus className="w-3.5 h-3.5 text-slate-500 hover:text-slate-900" strokeWidth={1.5} />
                  </span>
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
                    <div className="text-[10px] font-mono tracking-[0.18em] uppercase text-slate-500">
                      +{todaysBookings.length - 3} more
                    </div>
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
    const hours = Array.from({ length: 14 }, (_, i) => i + 7);
    return (
      <div className="glass-card rounded-[28px] overflow-hidden">
        <div
          className="grid"
          style={{ gridTemplateColumns: `60px repeat(${dayList.length}, minmax(0, 1fr))` }}
        >
          <div className="p-3 border-r border-b soft-divider" />
          {dayList.map((d) => (
            <div
              key={ymd(d)}
              className="p-3 border-r border-b soft-divider last:border-r-0 text-center"
            >
              <div className="text-[11px] tracking-[0.22em] uppercase font-mono text-slate-500">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div className="font-display text-[18px] text-slate-900 mt-0.5">{d.getDate()}</div>
            </div>
          ))}
        </div>
        <div
          className="grid"
          style={{ gridTemplateColumns: `60px repeat(${dayList.length}, minmax(0, 1fr))` }}
        >
          {hours.map((h) => (
            <React.Fragment key={h}>
              <div className="p-2 border-r border-b soft-divider text-right font-mono text-[11px] text-slate-500">
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
                    className="relative min-h-[56px] border-r border-b soft-divider last:border-r-0 hover:bg-black/5 p-2 flex flex-col gap-1 text-left"
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
          {/* Today — matches New button style */}
          <Button
            variant="ghost"
            onClick={() => setCursor(new Date())}
            data-testid="today-button"
            className="bg-white/80 backdrop-blur-md text-black hover:bg-white rounded-[14px] h-9 border border-white/30"
            style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.10)" }}
          >
            Today
          </Button>

          {/* Prev — matches New button style */}
          <button
            onClick={() => navigate(-1)}
            data-testid="nav-prev-button"
            className="p-2 bg-white/80 backdrop-blur-md text-black hover:bg-white rounded-[14px] h-9 flex items-center justify-center border border-white/30"
            style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.10)" }}
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
          </button>

          {/* Next — matches New button style */}
          <button
            onClick={() => navigate(1)}
            data-testid="nav-next-button"
            className="p-2 bg-white/80 backdrop-blur-md text-black hover:bg-white rounded-[14px] h-9 flex items-center justify-center border border-white/30"
            style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.10)" }}
          >
            <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
          </button>

          {/* New — unchanged reference */}
          <Button
            onClick={() => openForm(ymd(cursor))}
            data-testid="new-booking-button"
            className="bg-white/80 backdrop-blur-md text-black hover:bg-white rounded-[14px] h-9 border border-white/30"
          >
            <Plus className="w-4 h-4 mr-1" strokeWidth={1.5} /> New
          </Button>
        </div>
      </div>

      {/* ── View tabs + Calendar toggles ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <Tabs value={view} onValueChange={setView}>
          <TabsList
            className="border border-neutral-200"
            style={{ background: "#FCFCFC", borderRadius: "7px" }}
          >
            <TabsTrigger
              value="month"
              data-testid="view-month-tab"
              className="text-black data-[state=active]:bg-white data-[state=active]:text-black"
              style={{ borderRadius: "25px" }}
            >
              Month
            </TabsTrigger>
            <TabsTrigger
              value="week"
              data-testid="view-week-tab"
              className="text-black data-[state=active]:bg-white data-[state=active]:text-black"
              style={{ borderRadius: "25px" }}
            >
              Week
            </TabsTrigger>
            <TabsTrigger
              value="day"
              data-testid="view-day-tab"
              className="text-black data-[state=active]:bg-white data-[state=active]:text-black"
              style={{ borderRadius: "25px" }}
            >
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
                className={`flex items-center gap-2 px-3 py-1.5 text-xs border transition-colors ${
                  on
                    ? "border-neutral-300 text-black"
                    : "border-neutral-200 text-neutral-400"
                }`}
                style={{
                  background: on ? "#FCFCFC" : "transparent",
                  borderRadius: "7px",
                }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: on ? c.color : "#ccc" }}
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