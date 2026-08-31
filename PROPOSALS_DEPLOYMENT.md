# Proposals deployment

## Before deployment

1. Back up the Supabase database.
2. Apply `supabase/010_proposals.sql`.
3. Deploy the backend before the frontend so the new routes are available when the UI goes live.
4. Deploy the frontend with `/p/*` routed to the React application.

## Backend configuration

Set the existing database, JWT, email, Google Calendar, and frontend environment variables, plus:

- `FRONTEND_URL`: frontend origin, such as `https://team.studio7.miami`
- `PROPOSAL_PUBLIC_URL`: optional full public route prefix, such as `https://team.studio7.miami/p`
- `PROPOSAL_HOLD_HOURS`: tentative hold lifetime; defaults to `72`
- `PROPOSAL_SHARE_EXPIRES_DAYS`: client-link lifetime; defaults to `30`
- `PROPOSAL_CURRENCY`: fallback three-letter Stripe currency; defaults to `usd`
- `STRIPE_SECRET_KEY`: Stripe restricted or secret key used to create Checkout Sessions
- `STRIPE_WEBHOOK_SECRET`: signing secret for the proposal webhook endpoint
- `STRIPE_WEBHOOK_TOLERANCE_SEC`: optional signature tolerance; defaults to `300`
- `RESEND_API_KEY` and the existing sender variables: branded proposal delivery

Never expose backend or Stripe secrets through frontend environment variables.

## Stripe

Register `POST /api/webhooks/stripe` as a webhook endpoint. Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `payment_intent.succeeded`

Use the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`. Payment completion is webhook-driven; the browser redirect is not treated as proof of payment.

## Production smoke checks

Use a test client and future calendar slot:

1. Sign in as a manager with proposal permissions and create a blank draft.
2. Complete every section, save, and submit it for founder approval.
3. Sign in as the founder, approve it, and send it.
4. Confirm the client receives the branded email and `/p/{token}` opens without authentication.
5. Confirm sending created one pending internal-calendar hold and that the slot blocks conflicting bookings.
6. Request a change and confirm the proposal returns to `changes_requested`.
7. Resubmit, approve, resend, then approve and sign from the client page.
8. Complete a Stripe test payment and confirm the webhook marks the proposal `deposit_paid` or `paid`.
9. Confirm the linked calendar booking changes from pending to approved, clears its expiration, and receives a Google Calendar event ID when sync is configured.
10. Replay the same Stripe event and confirm no duplicate payment, booking, or calendar event is created.

Also run:

```sh
cd backend
/opt/homebrew/bin/python3.11 -m pytest tests/test_proposals_unit.py

cd ../frontend
CI=true npm test -- --watchAll=false --runTestsByPath src/lib/proposals.test.js
npm run build
```

## Rollback

Disable access to the proposal UI and stop proposal webhook delivery first. Back up proposal records and any proposal-backed bookings, then run `supabase/010_proposals_rollback.sql`.

The rollback is destructive: it removes proposal history, shares, signatures, payment records, audit events, and proposal links on bookings and notifications. It does not delete the booking rows themselves.
