-- =============================================================================
-- Manual one-off: remove integration-test users and invites (@studio7test.com)
-- =============================================================================
-- Created by backend/tests/test_api.py (invite + register flow). Those rows
-- stay in the DB after tests; this script deletes them like DELETE /api/users.
--
-- API note: GET /api/users and GET /api/invites already hide these emails in
-- responses (see server.py:_is_integration_test_account_email). This script
-- actually removes rows if you want a clean database.
--
-- How to run:
--   1. In Supabase Dashboard → SQL Editor, run the two SELECT blocks below
--      alone first and confirm the rows look like test data only.
--   2. Run the whole script (including BEGIN/COMMIT) once.
--
-- Safe to re-run: only touches emails ending with @studio7test.com (case
-- insensitive) and invites with the same pattern.
-- =============================================================================

begin;

-- --- Preview (optional: run these outside a transaction first) ---------------

-- select id, email, name, role, is_disabled
-- from public.users
-- where lower(email) like '%@studio7test.com';

-- select id, email, used, created_at
-- from public.invites
-- where lower(email) like '%@studio7test.com';

-- --- Deletes (order matches backend/server.py delete_user) -------------------

delete from public.notifications
where booking_id in (
  select b.id
  from public.bookings b
  where b.member_id in (
    select u.id from public.users u where lower(u.email) like '%@studio7test.com'
  )
);

delete from public.notifications
where user_id in (select id from public.users where lower(email) like '%@studio7test.com');

delete from public.bookings
where member_id in (select id from public.users where lower(email) like '%@studio7test.com');

delete from public.google_tokens
where user_id in (select id from public.users where lower(email) like '%@studio7test.com');

delete from public.users
where lower(email) like '%@studio7test.com';

delete from public.invites
where lower(email) like '%@studio7test.com';

commit;
