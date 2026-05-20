/** JS weekday: Sunday = 0 … Saturday = 6 (same as Date.getDay). */
export function jsWeekdayFromYmd(ymd) {
  if (!ymd) return 0;
  const d = new Date(`${ymd}T12:00:00`);
  return d.getDay();
}

export const DEFAULT_AVAILABILITY_WEEKLY = [
  { weekday: 1, start: "09:00", end: "17:00" },
  { weekday: 2, start: "09:00", end: "17:00" },
  { weekday: 3, start: "09:00", end: "17:00" },
  { weekday: 4, start: "09:00", end: "17:00" },
  { weekday: 5, start: "09:00", end: "17:00" },
];

export function normHm(t) {
  if (!t) return "09:00";
  const s = String(t);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

/** @param {Array<{weekday:number,start:string,end:string}>|null|undefined} slots */
export function slotsForWeekday(slots, weekday) {
  const list = Array.isArray(slots) && slots.length ? slots : DEFAULT_AVAILABILITY_WEEKLY;
  return list.filter((b) => Number(b.weekday) === Number(weekday));
}

/**
 * @param {string} ymd
 * @param {{ availability_weekly?: unknown }} calendar
 * @param {Array<{start_time:string,end_time:string,status?:string}>} dayBookings same calendar + date
 * @param {number} stepMins
 * @param {number} maxSlots
 */
export function suggestedSlots(ymd, calendar, dayBookings, stepMins = 30, maxSlots = 14) {
  const wd = jsWeekdayFromYmd(ymd);
  const windows = slotsForWeekday(calendar?.availability_weekly, wd);
  const busy = (dayBookings || [])
    .filter((b) => b.status !== "denied")
    .map((b) => ({ s: normHm(b.start_time), e: normHm(b.end_time) }))
    .sort((a, b) => a.s.localeCompare(b.s));

  const out = [];
  const step = Math.max(15, stepMins);

  const overlaps = (s, e) => busy.some((b) => s < b.e && e > b.s);

  for (const w of windows) {
    let cur = normHm(w.start);
    const endCap = normHm(w.end);
    while (cur < endCap && out.length < maxSlots) {
      const next = addMinutesToHm(cur, step);
      if (next > endCap) break;
      if (!overlaps(cur, next)) out.push({ start: cur, end: next });
      cur = next;
    }
  }
  return out;
}

function addMinutesToHm(hm, mins) {
  const [h, m] = hm.split(":").map(Number);
  const t = h * 60 + m + mins;
  const hh = Math.floor(t / 60);
  const mm = t % 60;
  if (hh >= 24) return "24:00";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Build 7 rows for admin UI: { weekday, label, enabled, start, end } */
export function weekRowsFromSlots(slots) {
  const list = Array.isArray(slots) && slots.length ? slots : DEFAULT_AVAILABILITY_WEEKLY;
  const byWd = {};
  for (const s of list) {
    const wd = Number(s.weekday);
    if (wd >= 0 && wd <= 6) byWd[wd] = { start: normHm(s.start), end: normHm(s.end) };
  }
  return DAY_LABELS.map((label, weekday) => {
    const hit = byWd[weekday];
    return {
      weekday,
      label,
      enabled: !!hit,
      start: hit?.start || "09:00",
      end: hit?.end || "17:00",
    };
  });
}

export function slotsFromWeekRows(rows) {
  return rows
    .filter((r) => r.enabled)
    .map((r) => ({
      weekday: r.weekday,
      start: normHm(r.start),
      end: normHm(r.end),
    }))
    .filter((r) => r.start < r.end);
}

/** Seven days, midnight–11:59 PM — for Studio / photobooth calendars. */
export function weekRows24Hours() {
  return DAY_LABELS.map((label, weekday) => ({
    weekday,
    label,
    enabled: true,
    start: "00:00",
    end: "23:59",
  }));
}
