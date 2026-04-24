-- One-time: run in Supabase SQL editor for configurable role permissions (member / manager).
create table if not exists public.app_config (
  id text primary key,
  role_permissions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Optional: seed an empty default row (API will also insert on first save).
insert into public.app_config (id, role_permissions)
values ('default', '{}'::jsonb)
on conflict (id) do nothing;
