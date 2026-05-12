import { PREVIEW_CALENDARS_DIRECTORY, PREVIEW_TEAM_USERS, buildPreviewMe } from "./memberPreviewFixtures";

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function uuid() {
  // Good enough for dev mocks; not used as a security boundary.
  return `mock-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function clone(x) {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

function defaultSeed() {
  const today = new Date();
  const d1 = ymd(today);
  const d2 = ymd(new Date(today.getTime() + 50 * 864e5));
  const d3 = ymd(new Date(today.getTime() - 10 * 864e5));
  const [miami, photobooth] = PREVIEW_CALENDARS_DIRECTORY;

  return {
    me: buildPreviewMe("admin"),
    calendars: clone(PREVIEW_CALENDARS_DIRECTORY),
    users: clone(PREVIEW_TEAM_USERS),
    bookings: [
      {
        id: uuid(),
        calendar_id: miami.id,
        member_id: PREVIEW_TEAM_USERS[0].id,
        member_name: PREVIEW_TEAM_USERS[0].name,
        member_email: PREVIEW_TEAM_USERS[0].email,
        member_sauce: PREVIEW_TEAM_USERS[0].sauce,
        date: d1,
        start_time: "15:00",
        end_time: "17:00",
        notes: "Zona private model coaching",
        status: "approved",
        is_own: true,
        source: "manual",
        created_at: new Date().toISOString(),
      },
    ],
    requests: [
      {
        id: uuid(),
        calendar_id: photobooth.id,
        member_id: PREVIEW_TEAM_USERS[1].id,
        member_name: "Tiffany",
        member_email: "tiffany@example.com",
        member_sauce: "videography",
        date: d2,
        start_time: "18:00",
        end_time: "22:00",
        notes: "Tiffany and Michael Brown: Event Media Package",
        status: "approved",
        is_own: false,
        source: "member_request",
        created_at: new Date().toISOString(),
        payment_required: false,
        payment_status: "unpaid",
      },
      {
        id: uuid(),
        calendar_id: miami.id,
        member_id: PREVIEW_TEAM_USERS[2].id,
        member_name: PREVIEW_TEAM_USERS[2].name,
        member_email: PREVIEW_TEAM_USERS[2].email,
        member_sauce: PREVIEW_TEAM_USERS[2].sauce,
        date: d3,
        start_time: "19:30",
        end_time: "21:30",
        notes: "Acting Class w/ CJ Bornacelli",
        status: "approved",
        is_own: false,
        source: "member_request",
        created_at: new Date().toISOString(),
        payment_required: false,
        payment_status: "unpaid",
      },
    ],
  };
}

export function createMockApi() {
  const state = defaultSeed();

  const ok = (data) => Promise.resolve({ data: clone(data) });
  const fail = (status, detail) =>
    Promise.reject({ response: { status, data: { detail } } });

  const normHm = (t) => {
    const s = String(t || "");
    return s.length >= 5 ? s.slice(0, 5) : s;
  };
  const timeOverlap = (a0, a1, b0, b1) => normHm(a0) < normHm(b1) && normHm(a1) > normHm(b0);

  /** Same rules as backend: pending + approved on same calendar/date block overlapping times. */
  const hasBookingConflict = (calendarId, date, start, end, excludeBookingId) => {
    const cid = String(calendarId ?? "");
    const d = String(date ?? "");
    const st = String(start ?? "");
    const et = String(end ?? "");
    const blocks = [...state.bookings, ...state.requests];
    for (const row of blocks) {
      if (excludeBookingId && String(row.id) === String(excludeBookingId)) continue;
      const status = row.status;
      if (status !== "approved" && status !== "pending") continue;
      if (String(row.calendar_id) !== cid) continue;
      if (String(row.date) !== d) continue;
      if (timeOverlap(st, et, row.start_time, row.end_time)) return true;
    }
    return false;
  };

  const firstNameOnly = (displayName) => {
    const s = String(displayName || "").trim();
    if (!s) return "";
    const parts = s.split(/\s+/);
    return parts[0] || "";
  };

  const memberCalendarConflictMsg = (displayName) => {
    const first = firstNameOnly(displayName) || "Member";
    return `${first}, this time conflicts with another booking on the calendar. Choose another time.`;
  };

  const parseId = (url, prefix) => {
    const m = String(url || "").match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^/]+)`));
    return m ? m[1] : null;
  };

  const api = {
    get: async (url) => {
      if (url === "/auth/me") return ok(state.me);
      if (url === "/calendars") return ok(state.calendars);
      if (url === "/users") return ok(state.users);
      if (url === "/bookings") return ok(state.bookings);
      if (url === "/bookings/requests") return ok(state.requests);
      if (url === "/bookings/assignable-members") return ok(state.users);
      return fail(404, `Mock API: GET ${url} not implemented`);
    },

    post: async (url, body) => {
      if (url === "/bookings/request") {
        const me = state.me;
        const calId = String(body?.calendar_id || "");
        const date = String(body?.date || "");
        const st = String(body?.start_time || "");
        const et = String(body?.end_time || "");
        if (hasBookingConflict(calId, date, st, et, null)) {
          return fail(400, memberCalendarConflictMsg(me.name));
        }
        const id = uuid();
        const cal = state.calendars.find((c) => String(c.id) === String(body?.calendar_id));
        const row = {
          id,
          calendar_id: String(body?.calendar_id || ""),
          member_id: me.id,
          member_name: me.name,
          member_email: me.email,
          member_sauce: me.sauce,
          date: String(body?.date || ""),
          start_time: String(body?.start_time || ""),
          end_time: String(body?.end_time || ""),
          notes: String(body?.notes || ""),
          status: "pending",
          is_own: true,
          source: "member_request",
          created_at: new Date().toISOString(),
          calendar_name: cal?.name,
        };
        state.requests.unshift(row);
        return ok(row);
      }

      if (url === "/bookings/manual") {
        const member = body?.member_id
          ? state.users.find((u) => String(u.id) === String(body.member_id))
          : state.me;
        const calId = String(body?.calendar_id || "");
        const date = String(body?.date || "");
        const st = String(body?.start_time || "");
        const et = String(body?.end_time || "");
        if (hasBookingConflict(calId, date, st, et, null)) {
          return fail(400, memberCalendarConflictMsg(member?.name || state.me.name));
        }
        const id = uuid();
        const cal = state.calendars.find((c) => String(c.id) === String(body?.calendar_id));
        const row = {
          id,
          calendar_id: String(body?.calendar_id || ""),
          member_id: member?.id,
          member_name: member?.name,
          member_email: member?.email,
          member_sauce: member?.sauce,
          date: String(body?.date || ""),
          start_time: String(body?.start_time || ""),
          end_time: String(body?.end_time || ""),
          notes: String(body?.notes || ""),
          status: "approved",
          is_own: String(member?.id) === String(state.me.id),
          source: "manual",
          created_at: new Date().toISOString(),
          calendar_name: cal?.name,
        };
        state.bookings.unshift(row);
        return ok(row);
      }

      const approveId = parseId(url, "/bookings") && url.endsWith("/approve") ? parseId(url, "/bookings") : null;
      const denyId = parseId(url, "/bookings") && url.endsWith("/deny") ? parseId(url, "/bookings") : null;
      if (approveId || denyId) {
        const id = approveId || denyId;
        const idx = state.requests.findIndex((r) => String(r.id) === String(id));
        if (idx === -1) return fail(404, "Request not found");
        if (approveId) {
          const r = state.requests[idx];
          if (
            hasBookingConflict(r.calendar_id, r.date, r.start_time, r.end_time, id)
          ) {
            return fail(400, memberCalendarConflictMsg(r.member_name));
          }
        }
        state.requests[idx].status = approveId ? "approved" : "denied";
        state.requests[idx].approval_message = String(body?.message || "");
        return ok({ ok: true });
      }

      if (/^\/bookings\/[^/]+\/payment\/checkout$/.test(url)) {
        return ok({ ok: true });
      }

      return fail(404, `Mock API: POST ${url} not implemented`);
    },

    patch: async (url, body) => {
      const bookingId = parseId(url, "/bookings");
      if (bookingId && /^\/bookings\/[^/]+$/.test(url)) {
        const patchBooking = (row) => {
          if (!row) return row;
          const next = { ...row, ...clone(body) };
          if (body && body.member_id) {
            const mu = state.users.find((u) => String(u.id) === String(body.member_id));
            if (mu) {
              next.member_id = mu.id;
              next.member_name = mu.name;
              next.member_email = mu.email;
              next.member_sauce = mu.sauce;
            }
          }
          return next;
        };
        const bi = state.bookings.findIndex((b) => String(b.id) === String(bookingId));
        if (bi !== -1) {
          const cur = state.bookings[bi];
          const merged = patchBooking(cur);
          const timeKeys = ["date", "start_time", "end_time", "calendar_id"];
          if (timeKeys.some((k) => k in (body || {}))) {
            if (
              hasBookingConflict(
                merged.calendar_id,
                merged.date,
                merged.start_time,
                merged.end_time,
                bookingId,
              )
            ) {
              return fail(400, memberCalendarConflictMsg(merged.member_name));
            }
          }
          state.bookings[bi] = merged;
          return ok(state.bookings[bi]);
        }
        const ri = state.requests.findIndex((b) => String(b.id) === String(bookingId));
        if (ri !== -1) {
          const cur = state.requests[ri];
          const merged = patchBooking(cur);
          const timeKeys = ["date", "start_time", "end_time", "calendar_id"];
          if (timeKeys.some((k) => k in (body || {}))) {
            if (
              hasBookingConflict(
                merged.calendar_id,
                merged.date,
                merged.start_time,
                merged.end_time,
                bookingId,
              )
            ) {
              return fail(400, memberCalendarConflictMsg(merged.member_name));
            }
          }
          state.requests[ri] = merged;
          return ok(state.requests[ri]);
        }
        return fail(404, "Booking not found");
      }
      return fail(404, `Mock API: PATCH ${url} not implemented`);
    },

    delete: async (url) => {
      const bookingId = parseId(url, "/bookings");
      if (bookingId && /^\/bookings\/[^/]+$/.test(url)) {
        state.bookings = state.bookings.filter((b) => String(b.id) !== String(bookingId));
        return ok({ ok: true });
      }
      return fail(404, `Mock API: DELETE ${url} not implemented`);
    },
  };

  return api;
}

