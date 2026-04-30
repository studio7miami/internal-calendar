-- Inbound Google Calendar → bookings (Acuity, Cal.com, etc. mirrored as approved blocks)
alter table public.bookings add column if not exists external_title text;

comment on column public.bookings.external_title is 'Event summary from Google when source is google_external; member_id may be null.';

-- Allow imported external events without a Studio member
alter table public.bookings alter column member_id drop not null;
