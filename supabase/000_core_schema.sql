-- Core schema (base tables) for Studio 7 Miami Internal Calendar.
-- Run this FIRST in a fresh Supabase project before 001..010.
--
-- Notes:
-- - Uses uuid primary keys (backend sends uuid strings; Postgres will cast).
-- - Keeps schema intentionally minimal; later scripts add optional columns.

create extension if not exists pgcrypto;

-- ---------- Users ----------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null default 'member', -- member | manager | admin
  password_hash text,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.users is 'Application users (not Supabase Auth). Password handled in API.';

-- ---------- Invites ----------
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  invite_token text not null unique,
  email text not null,
  used boolean not null default false,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists invites_email_idx on public.invites (email);
create index if not exists invites_created_at_idx on public.invites (created_at desc);

comment on table public.invites is 'One-time signup links issued by admins. Tokens are emailed via Resend/SMTP when configured.';

-- ---------- Calendars (resources) ----------
create table if not exists public.calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#111111',
  is_active boolean not null default true,
  google_calendar_id text,
  created_at timestamptz not null default now()
);

create index if not exists calendars_created_at_idx on public.calendars (created_at);
create index if not exists calendars_google_calendar_id_idx on public.calendars (google_calendar_id);

comment on table public.calendars is 'Resource calendars (rooms / bays / equipment).';

-- ---------- Bookings ----------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.calendars (id) on delete cascade,
  member_id uuid not null references public.users (id) on delete set null,
  date date not null,
  start_time text not null,
  end_time text not null,
  notes text not null default '',
  status text not null default 'pending', -- pending | approved | denied | cancelled
  source text not null default 'member_request', -- member_request | manual | google_external | etc.
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.users (id) on delete set null,
  decision_message text,
  google_event_id text
);

create index if not exists bookings_date_idx on public.bookings (date);
create index if not exists bookings_calendar_date_idx on public.bookings (calendar_id, date);
create index if not exists bookings_member_id_idx on public.bookings (member_id);
create index if not exists bookings_status_idx on public.bookings (status);

comment on table public.bookings is 'Booking requests and approved holds for resource calendars.';

-- ---------- Notifications ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_at_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_booking_id_idx on public.notifications (booking_id);

comment on table public.notifications is 'In-app notification feed (requests submitted, approved/denied, etc.).';

-- Grants (API uses service_role key)
grant all on table public.users to service_role;
grant all on table public.invites to service_role;
grant all on table public.calendars to service_role;
grant all on table public.bookings to service_role;
grant all on table public.notifications to service_role;

grant all on table public.users to postgres;
grant all on table public.invites to postgres;
grant all on table public.calendars to postgres;
grant all on table public.bookings to postgres;
grant all on table public.notifications to postgres;

