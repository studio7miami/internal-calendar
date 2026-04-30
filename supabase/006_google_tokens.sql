-- Per-admin Google OAuth tokens (Calendar API). App client id/secret stay in server .env only.
-- Run in Supabase SQL editor after public.users exists.

create table if not exists public.google_tokens (
  user_id uuid primary key references public.users (id) on delete cascade,
  access_token text,
  refresh_token text not null,
  access_token_expires_at timestamptz,
  email text,
  updated_at timestamptz not null default now()
);

create index if not exists google_tokens_updated_at_idx on public.google_tokens (updated_at desc);

comment on table public.google_tokens is 'Google OAuth tokens per user; used by admins for Calendar API sync.';

grant all on table public.google_tokens to service_role;
grant all on table public.google_tokens to postgres;
