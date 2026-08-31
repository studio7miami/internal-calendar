-- Destructive rollback for 010_proposals.sql.
-- Back up proposal and linked booking data before running this file.

alter table public.proposals
  drop constraint if exists proposals_booking_fk;

alter table public.notifications
  drop column if exists proposal_id;

alter table public.bookings
  drop column if exists proposal_id;
alter table public.bookings
  drop column if exists hold_expires_at;

drop table if exists public.stripe_webhook_events;
drop table if exists public.proposal_payments;
drop table if exists public.proposal_signatures;
drop table if exists public.proposal_change_requests;
drop table if exists public.proposal_events;
drop table if exists public.proposal_shares;

alter table public.proposals
  drop constraint if exists proposals_current_revision_fk;
drop table if exists public.proposal_revisions;
drop table if exists public.proposals;

drop function if exists public.set_proposal_updated_at();
