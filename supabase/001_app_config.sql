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

-- API uses the service_role key; without this, new tables can lack grants if created after other GRANTs.
grant all on table public.app_config to service_role;
grant all on table public.app_config to postgres;
