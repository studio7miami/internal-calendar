import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import BookingForm from "../components/app/BookingForm";
import { fmtTimeShort } from "../lib/time";
import { pageTitleClass } from "../lib/pageTheme";

const glassBarHoverClass =
  "hover:bg-slate-900/10 hover:text-black dark:hover:bg-white/[0.08] dark:hover:text-zinc-100";

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
  const who = b.member_name ? b.member_name.split(" ")[0] : "Member";
  const n = (calendar?.name || "").trim().toLowerCase();
  if (n === "studio 7 miami") return `${who} @ Studio 7 Miami`;
  if (n === "studio 7 photobooth") return `${who} @ Studio 7 Photobooth`;
  return b.notes?.trim() || calendar?.name || "Booking";
}


function BookingChip({ b, calendar, canSeeAllDetails, onClick }) {
  const isOwn = b.is_own;
  const isPending = b.status === "pending";
  const canSeeDetail = canSeeAllDetails || isOwn;

  if (canSeeDetail) {
    const color = calendar?.color || "#FAFAFA";
    const label = `${fmtTimeShort(b.start_time)} · ${chipLabel(b, calendar)}`;
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={`booking-chip-${b.id}`}
        className="text-[10px] leading-tight px-2 py-1.5 w-full text-left border rounded-[7px] truncate text-slate-900 transition-colors hover:brightness-110 dark:border-white/10 dark:text-zinc-200"
        style={{
          background: isPending ? rgba(color, 0.16) : rgba(color, 0.22),
          borderColor: isPending ? rgba(color, 0.34) : rgba(color, 0.46),
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
      className="text-[10px] leading-tight px-2 py-1.5 w-full text-left border rounded-[7px] truncate booked-stripe-light dark:booked-stripe text-slate-600 dark:text-neutral-300 border-slate-900/15 dark:border-white/14"
      style={{
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
  const canSeeAllDetails = !!user?.permissions?.see_all_booking_details;
  const canFetchMembers = isAdmin || !!user?.permissions?.view_members_directory;
  const canManualBook = isAdmin || !!user?.permissions?.create_manual_booking;

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [cals, bks] = await Promise.all([
      api.get("/calendars"),
      api.get("/bookings"),
    ]);
    setCalendars(cals.data);
    setBookings(bks.data);
    setEnabledCalIds((prev) =>
      prev.size === 0 ? new Set(cals.data.map((c) => c.id)) : prev
    );
    if (canFetchMembers) {
      try {
        const m = await api.get("/users");
        setMembers(m.data);
      } catch {
        setMembers([]);
      }
    } else {
      setMembers([]);
    }
  }, [user, canFetchMembers]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      <div className="w-full min-w-0 -mx-1 px-1 sm:mx-0 sm:px-0">
        <div className="w-full min-w-0 overflow-hidden rounded-[7px] bg-white/[0.15] dark:bg-white/[0.02]">
          <div className="grid min-w-0 grid-cols-7">
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

          <div className="grid min-h-0 min-w-0 auto-rows-fr grid-cols-7 gap-0.5 p-0.5 sm:gap-1 sm:p-1">
            {days.map((d, i) => {
            const key = ymd(d);
            const inMonth = sameMonth(d, cursor);
            const todaysBookings = visibleBookings.filter((b) => b.date === key);
            const isCellSelected = inMonth && key === selectedYmd;
            const isToday = key === todayKey;
            // Thin circle on “today” only when another (in-month) day is selected
            const showTodayRing = inMonth && isToday && selectedYmd !== todayKey;
            const tEase = "transition-[background-color,color,box-shadow] duration-200 ease-out";
            // In-month: same #222 hover + select for all days. Out-of-month: static, no hover/click.
            const cellShell = !inMonth
              ? `border border-gray-200/95 bg-white/[0.04] text-slate-500 shadow-none backdrop-blur-sm dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-zinc-500 ${tEase} pointer-events-none select-none`
              : isCellSelected
              ? `group bg-[#222222] text-zinc-100 ${tEase} motion-reduce:transition-none`
              : `group glass-tile text-slate-900 ${tEase} motion-reduce:transition-none hover:bg-[#222222] hover:text-zinc-100 dark:text-zinc-300 dark:hover:bg-[#222222] dark:hover:text-zinc-100`;
            return (
              <div
                key={i}
                data-testid={`month-cell-${key}`}
                className={`relative flex h-full min-h-[4.5rem] min-w-0 max-w-full flex-col rounded-[3px] p-1.5 sm:min-h-[5.5rem] sm:rounded-[5px] sm:p-2 md:min-h-[6rem] md:p-2.5 ${cellShell}`}
              >
                {inMonth && (
                  <button
                    type="button"
                    className="absolute top-0 right-0 bottom-0 left-0 z-0 min-h-0 w-full min-w-0 max-h-full max-w-full cursor-pointer rounded-[3px] border-0 bg-transparent p-0 sm:rounded-[5px] touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500/50 dark:focus-visible:ring-zinc-500/50"
                    aria-label={d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                    onClick={() => openForm(key)}
                  />
                )}
                <div className="pointer-events-none relative z-[1] flex h-full min-h-0 min-w-0 flex-1 flex-col gap-1 sm:gap-2">
                  <div className="min-w-0 shrink-0">
                    <div
                      className={`flex w-full min-h-[1.5rem] items-center text-left text-[11px] leading-none min-[380px]:text-xs sm:min-h-0 sm:text-[12px] ${
                        inMonth ? "justify-start" : "select-none"
                      }`}
                    >
                      <span
                        className={`w-fit min-w-0 text-left tabular-nums align-middle transition-all duration-200 ease-out motion-reduce:transition-none ${
                          showTodayRing
                            ? "inline-flex h-6 w-6 max-w-6 max-h-6 shrink-0 items-center justify-center rounded-full sm:h-7 sm:w-7 sm:max-h-7 sm:max-w-7 [box-shadow:inset_0_0_0_0.5px_#222222] group-hover:[box-shadow:none] dark:[box-shadow:inset_0_0_0_0.5px_#a1a1aa] dark:group-hover:[box-shadow:none] text-slate-900 group-hover:text-zinc-100 dark:text-zinc-200 dark:group-hover:text-zinc-100"
                            : inMonth
                            ? isCellSelected
                              ? "inline-block max-w-full text-zinc-100"
                              : "inline-block max-w-full text-current group-hover:text-zinc-100"
                            : "inline-block max-w-full text-slate-500 dark:text-zinc-500"
                        }`}
                      >
                        {d.getDate()}
                      </span>
                    </div>
                  </div>
                  <div className="pointer-events-none min-h-0 min-w-0 flex-1 space-y-0.5 overflow-hidden sm:space-y-1">
                    {todaysBookings.slice(0, 3).map((b) => (
                      <div key={b.id} className="pointer-events-auto w-full min-w-0">
                        <BookingChip
                          b={b}
                          calendar={calendarMap[b.calendar_id]}
                          canSeeAllDetails={canSeeAllDetails}
                          onClick={() => {}}
                        />
                      </div>
                    ))}
                    {todaysBookings.length > 3 && (
                      <div
                        className={`text-[9px] tracking-[0.12em] uppercase min-[400px]:text-[10px] min-[400px]:tracking-[0.18em] ${
                          inMonth
                            ? isCellSelected
                              ? "text-zinc-500"
                              : "text-slate-500 transition-colors duration-200 ease-out group-hover:text-zinc-500 dark:text-zinc-600 dark:group-hover:text-zinc-500"
                            : "text-slate-500/80 dark:text-zinc-600"
                        }`}
                      >
                        +{todaysBookings.length - 3} more
                      </div>
                    )}
                  </div>
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
    return (
      <div className="rounded-[7px] border soft-divider overflow-hidden bg-transparent">
        <div
          className="grid"
          style={{ gridTemplateColumns: `60px repeat(${dayList.length}, minmax(0, 1fr))` }}
        >
          <div className="p-3 border-r border-b soft-divider" />
          {dayList.map((d, idx) => (
            <div
              key={ymd(d)}
              className={`p-3 border-b soft-divider text-center ${
                idx === dayList.length - 1 ? "" : "border-r soft-divider"
              }`}
            >
              <div className="text-[11px] tracking-[0.22em] uppercase text-slate-500 dark:text-zinc-500">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div className="font-display mt-0.5 text-[18px] text-slate-900 dark:text-zinc-200">{d.getDate()}</div>
            </div>
          ))}
        </div>
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
                    className={`relative min-h-[56px] hover:bg-black/5 dark:hover:bg-white/[0.03] p-2 flex flex-col gap-1 text-left bg-transparent ${
                      idx === dayList.length - 1 ? "" : "border-r soft-divider"
                    } ${isLastHour(h) ? "" : "border-b soft-divider"}`}
                    data-testid={`slot-${key}-${h}`}
                  >
                    {inSlot.map((b) => (
                      <BookingChip
                        key={b.id}
                        b={b}
                        calendar={calendarMap[b.calendar_id]}
                        canSeeAllDetails={canSeeAllDetails}
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
          <h1 className={pageTitleClass}>{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            data-testid="today-button"
            className={`min-h-8 box-border inline-flex items-center justify-center border border-white/30 bg-white/80 px-3 py-1.5 text-xs leading-none text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] backdrop-blur-md transition-colors dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:shadow-[0_1px_3px_rgba(0,0,0,0.45)] ${glassBarHoverClass} rounded-[7px]`}
          >
            Today
          </button>

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
            onClick={() => navigate(1)}
            data-testid="nav-next-button"
            className={`min-h-8 w-8 p-0 inline-flex items-center justify-center border border-white/30 bg-white/80 text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] backdrop-blur-md transition-colors dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:shadow-[0_1px_3px_rgba(0,0,0,0.45)] ${glassBarHoverClass} rounded-[7px]`}
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
          </button>

          <button
            type="button"
            onClick={() => openForm(ymd(cursor))}
            data-testid="new-booking-button"
            className={`min-h-8 box-border inline-flex items-center justify-center gap-1.5 border border-white/30 bg-white/80 px-3 py-1.5 text-xs leading-none text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] backdrop-blur-md transition-colors dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:shadow-[0_1px_3px_rgba(0,0,0,0.45)] ${glassBarHoverClass} rounded-[7px]`}
          >
            <Plus className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            New
          </button>
        </div>
      </div>

      {/* ── View mode + calendar toggles (shared button style) ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div
          className="min-h-8 box-border inline-flex select-none items-center gap-2.5 rounded-[7px] border border-gray-200/95 bg-[#FCFCFC] px-2.5 py-1.5 text-xs leading-none dark:border-white/10 dark:bg-white/[0.04] sm:gap-3 sm:px-3"
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
                    : "text-neutral-400 dark:text-zinc-500 hover:text-neutral-500 dark:hover:text-zinc-400"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
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

      {view === "month" && (
        <div className="w-full min-w-0 max-w-full overflow-x-auto sm:overflow-visible">
          {renderMonth()}
        </div>
      )}
      {view === "week" && (
        <div className="overflow-x-auto scrollbar-thin">{renderWeek()}</div>
      )}
      {view === "day" && <div className="w-full min-w-0 overflow-x-auto sm:overflow-visible">{renderDay()}</div>}

      <BookingForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={fetchData}
        calendars={calendars}
        defaultDate={formInit.date}
        defaultStart={formInit.start}
        defaultEnd={formInit.end}
        canManualBook={canManualBook}
        members={members}
      />
    </div>
  );
}