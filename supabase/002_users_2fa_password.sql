-- Optional: TOTP 2FA + password is handled in the API; add columns if missing.
alter table public.users
  add column if not exists totp_enabled boolean not null default false;
alter table public.users
  add column if not exists totp_secret text;
alter table public.users
  add column if not exists totp_pending_secret text;
