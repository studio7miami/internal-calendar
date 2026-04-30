-- Stripe payments: checkout-required booking requests + single-tenant Stripe Connect status.
-- Run after 009_*.

-- Payment fields live on bookings so Requests + Calendar can display status.
alter table public.bookings
  add column if not exists payment_required boolean not null default false;

alter table public.bookings
  add column if not exists payment_amount_cents integer;

alter table public.bookings
  add column if not exists payment_currency text not null default 'usd';

alter table public.bookings
  add column if not exists payment_status text not null default 'unpaid';

alter table public.bookings
  add column if not exists stripe_checkout_session_id text;

alter table public.bookings
  add column if not exists stripe_payment_intent_id text;

alter table public.bookings
  add column if not exists stripe_checkout_url text;

alter table public.bookings
  add column if not exists paid_at timestamptz;

comment on column public.bookings.payment_required is 'If true, booking requires Stripe payment after approval.';
comment on column public.bookings.payment_amount_cents is 'Amount (in cents) required to pay for this booking.';
comment on column public.bookings.payment_currency is 'ISO currency for Stripe Checkout (default usd).';
comment on column public.bookings.payment_status is 'unpaid | checkout_created | paid | failed | refunded';
comment on column public.bookings.stripe_checkout_session_id is 'Stripe Checkout Session id for this booking.';
comment on column public.bookings.stripe_payment_intent_id is 'Stripe PaymentIntent id (if created) for this booking.';
comment on column public.bookings.stripe_checkout_url is 'Stripe-hosted Checkout URL for the member.';
comment on column public.bookings.paid_at is 'Timestamp when Stripe payment was confirmed.';

-- Store workspace-level Stripe connection in app_config (single-tenant).
alter table public.app_config
  add column if not exists stripe_connect jsonb;

comment on column public.app_config.stripe_connect is
  'Stripe Connect status: { connected: boolean, account_id: string, connected_at: string }';

