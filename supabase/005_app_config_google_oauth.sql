-- Stores workspace Google OAuth tokens (service_role only). Run in Supabase SQL editor.
alter table public.app_config
  add column if not exists google_oauth jsonb;

comment on column public.app_config.google_oauth is
  'Workspace Google Calendar OAuth: { refresh_token, access_token?, access_token_expires_at?, email }';
