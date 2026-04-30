-- Email / SMS-style OTP 2FA (no authenticator app). Run after 002_users_2fa_password.sql.
alter table public.users add column if not exists phone_e164 text;
alter table public.users add column if not exists mfa_channel text;
alter table public.users add column if not exists mfa_otp_hash text;
alter table public.users add column if not exists mfa_otp_expires timestamptz;
alter table public.users add column if not exists mfa_otp_purpose text;
alter table public.users add column if not exists mfa_pending_channel text;

-- Legacy TOTP-only accounts: turn off 2FA so users can re-enroll with email or phone.
update public.users
set totp_enabled = false,
    totp_secret = null,
    totp_pending_secret = null
where totp_enabled = true
  and (mfa_channel is null or mfa_channel = '');
