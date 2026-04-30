-- Per-user: which resource calendars this account can see (bookings, requests, etc.).
-- NULL = not restricted (all active calendars) — default for existing rows and new users until an admin scopes access.
-- []  = no calendars (blocked from schedule content).
-- ["uuid", ...] = only these calendar ids.
alter table public.users
  add column if not exists visible_calendar_ids jsonb;
