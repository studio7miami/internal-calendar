-- Proposal platform: immutable revisions, public shares, approvals, signatures,
-- payments, audit trail, and proposal-backed booking holds.
-- The API uses service_role; public clients never query these tables directly.

create extension if not exists pgcrypto;

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft' check (
    status in (
      'draft', 'pending_approval', 'approved', 'sent', 'viewed',
      'changes_requested', 'client_approved', 'signed', 'deposit_paid', 'paid',
      'completed', 'expired', 'cancelled', 'archived'
    )
  ),
  title text not null default 'Untitled proposal',
  client_name text not null default '',
  client_email text not null default '',
  client_phone text,
  calendar_id uuid references public.calendars(id) on delete restrict,
  session_date date,
  arrival_time time,
  setup_time time,
  shoot_time time,
  wrap_time time,
  creative_brief jsonb not null default '{}'::jsonb,
  content_items jsonb not null default '[]'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  share_settings jsonb not null default '{}'::jsonb,
  rate_cents integer not null default 0 check (rate_cents >= 0),
  deposit_percent integer not null default 50 check (deposit_percent between 0 and 100),
  deliverables text not null default '',
  turnaround text not null default '',
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.users(id) on delete restrict,
  assigned_to uuid references public.users(id) on delete set null,
  current_revision_id uuid,
  booking_id uuid,
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  sent_at timestamptz,
  client_approved_at timestamptz,
  signed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposals_schedule_order check (
    (arrival_time is null or setup_time is null or arrival_time < setup_time)
    and (setup_time is null or shoot_time is null or setup_time < shoot_time)
    and (shoot_time is null or wrap_time is null or shoot_time < wrap_time)
    and (arrival_time is null or wrap_time is null or arrival_time < wrap_time)
  )
);

create table if not exists public.proposal_revisions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  proposal_version integer not null check (proposal_version > 0),
  snapshot jsonb not null,
  agreement_snapshot jsonb not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (proposal_id, revision_number)
);

create table if not exists public.proposal_shares (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  revision_id uuid not null references public.proposal_revisions(id) on delete restrict,
  token_hash text not null unique check (length(token_hash) = 64),
  sent_to_email text not null,
  created_by uuid not null references public.users(id) on delete restrict,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  revoked_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.proposal_events (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references public.users(id) on delete set null,
  share_id uuid references public.proposal_shares(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.proposal_change_requests (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  revision_id uuid not null references public.proposal_revisions(id) on delete restrict,
  share_id uuid references public.proposal_shares(id) on delete set null,
  client_name text,
  message text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.proposal_signatures (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  revision_id uuid not null references public.proposal_revisions(id) on delete restrict,
  share_id uuid references public.proposal_shares(id) on delete set null,
  signer_name text not null,
  signer_email text not null,
  signature_data text not null,
  consent_text text not null,
  agreement_snapshot jsonb not null,
  agreement_sha256 text not null check (length(agreement_sha256) = 64),
  ip_address inet,
  user_agent text,
  signed_at timestamptz not null default now(),
  unique (proposal_id, revision_id)
);

create table if not exists public.proposal_payments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  revision_id uuid not null references public.proposal_revisions(id) on delete restrict,
  share_id uuid references public.proposal_shares(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  payment_type text not null default 'deposit' check (payment_type in ('deposit', 'full')),
  currency text not null default 'usd' check (length(currency) = 3),
  status text not null default 'pending' check (
    status in ('pending', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded')
  ),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  stripe_event_id text,
  checkout_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep this migration safe when an earlier 010 revision was already applied.
alter table public.proposals
  add column if not exists title text not null default 'Untitled proposal';
alter table public.proposals
  add column if not exists pricing jsonb not null default '{}'::jsonb;
alter table public.proposals
  add column if not exists share_settings jsonb not null default '{}'::jsonb;
alter table public.proposals alter column client_name set default '';
alter table public.proposals alter column client_email set default '';

alter table public.proposals drop constraint if exists proposals_status_check;
alter table public.proposals
  add constraint proposals_status_check check (
    status in (
      'draft', 'pending_approval', 'approved', 'sent', 'viewed',
      'changes_requested', 'client_approved', 'signed', 'deposit_paid', 'paid',
      'completed', 'expired', 'cancelled', 'archived'
    )
  );

alter table public.proposal_payments
  add column if not exists payment_type text not null default 'deposit';
alter table public.proposal_payments
  drop constraint if exists proposal_payments_payment_type_check;
alter table public.proposal_payments
  add constraint proposal_payments_payment_type_check
  check (payment_type in ('deposit', 'full'));

create table if not exists public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Add circular references only after all proposal tables exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'proposals_current_revision_fk'
  ) then
    alter table public.proposals
      add constraint proposals_current_revision_fk
      foreign key (current_revision_id) references public.proposal_revisions(id) on delete set null;
  end if;
end $$;

alter table public.bookings
  add column if not exists proposal_id uuid references public.proposals(id) on delete set null;
alter table public.bookings
  add column if not exists hold_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'proposals_booking_fk'
  ) then
    alter table public.proposals
      add constraint proposals_booking_fk
      foreign key (booking_id) references public.bookings(id) on delete set null;
  end if;
end $$;

alter table public.notifications
  add column if not exists proposal_id uuid references public.proposals(id) on delete cascade;
alter table public.notifications
  alter column booking_id drop not null;

create unique index if not exists bookings_one_per_proposal_idx
  on public.bookings (proposal_id) where proposal_id is not null;
create index if not exists bookings_active_proposal_holds_idx
  on public.bookings (calendar_id, date, hold_expires_at)
  where source = 'proposal' and status = 'pending';
create index if not exists proposals_status_updated_idx
  on public.proposals (status, updated_at desc);
create index if not exists proposals_created_by_idx
  on public.proposals (created_by, updated_at desc);
create index if not exists proposals_assigned_to_idx
  on public.proposals (assigned_to, updated_at desc);
create index if not exists proposal_events_proposal_created_idx
  on public.proposal_events (proposal_id, created_at desc);
create index if not exists proposal_shares_proposal_created_idx
  on public.proposal_shares (proposal_id, created_at desc);
create index if not exists proposal_change_requests_open_idx
  on public.proposal_change_requests (proposal_id, created_at desc)
  where status = 'open';
create index if not exists proposal_payments_proposal_created_idx
  on public.proposal_payments (proposal_id, created_at desc);
create index if not exists proposal_payments_intent_idx
  on public.proposal_payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create index if not exists notifications_proposal_idx
  on public.notifications (proposal_id, created_at desc)
  where proposal_id is not null;

create or replace function public.set_proposal_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists proposals_set_updated_at on public.proposals;
create trigger proposals_set_updated_at
before update on public.proposals
for each row execute function public.set_proposal_updated_at();

drop trigger if exists proposal_payments_set_updated_at on public.proposal_payments;
create trigger proposal_payments_set_updated_at
before update on public.proposal_payments
for each row execute function public.set_proposal_updated_at();

comment on column public.proposal_shares.token_hash is
  'SHA-256 of the bearer token. The raw token is returned once and never stored.';
comment on column public.proposal_revisions.agreement_snapshot is
  'Immutable agreement shown to the client for this revision.';
comment on column public.proposal_signatures.agreement_snapshot is
  'Exact immutable agreement accepted by this signature.';
comment on column public.bookings.hold_expires_at is
  'Expiry for tentative proposal holds; null for confirmed bookings.';

grant all on table public.proposals to service_role, postgres;
grant all on table public.proposal_revisions to service_role, postgres;
grant all on table public.proposal_shares to service_role, postgres;
grant all on table public.proposal_events to service_role, postgres;
grant all on table public.proposal_change_requests to service_role, postgres;
grant all on table public.proposal_signatures to service_role, postgres;
grant all on table public.proposal_payments to service_role, postgres;
grant all on table public.stripe_webhook_events to service_role, postgres;

revoke all on table public.proposals from anon, authenticated;
revoke all on table public.proposal_revisions from anon, authenticated;
revoke all on table public.proposal_shares from anon, authenticated;
revoke all on table public.proposal_events from anon, authenticated;
revoke all on table public.proposal_change_requests from anon, authenticated;
revoke all on table public.proposal_signatures from anon, authenticated;
revoke all on table public.proposal_payments from anon, authenticated;
revoke all on table public.stripe_webhook_events from anon, authenticated;
