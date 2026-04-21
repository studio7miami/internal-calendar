# Studio 7 Miami — Internal Calendar (PRD)

## Problem statement
Build a full-stack, members-only internal calendar web app for Studio 7 Miami. Private booking / scheduling tool for the founder (Seven) and the team (photographers, videographers). Two roles: Admin + Member. Invite-only auth. Calendars for Photobooth and Studio 7 Miami (admin can add more). Booking request flow with admin approval. Google Calendar integration (bidirectional). In-app notifications.

## Stack (as built)
- Backend: FastAPI + MongoDB (motor), JWT (Bearer) auth, bcrypt
- Frontend: React 19 + Shadcn/UI + Tailwind, React Router 7, axios
- Aesthetic: Dark Swiss & High-Contrast (Clash Display / Satoshi / JetBrains Mono)
- Stubs: Google Calendar API (logs + returns mock event ids), Resend email (invite link returned in admin API response)

## User personas
1. **Seven (admin)** — sees everything, approves/denies requests, invites members, manages calendars.
2. **Team member** — sees availability; submits booking requests; sees own bookings with detail; everyone else appears as neutral "Booked" block.

## What's been implemented (v1 — 2026-04-21)
- JWT auth (login, me, invite-based register)
- Admin seeded on startup: `seven@studio7miami.com` / `Studio7Miami`
- Default calendars seeded: Photobooth, Studio 7 Miami
- Admin: invite magic link (stubbed email), calendar CRUD, member list, manual bookings, approve/deny with message
- Members: submit booking requests, see own detail + anonymized "Booked"
- Month / Week / Day calendar views, calendar-color toggles
- Booking form: Dialog on desktop, Drawer (bottom sheet) on mobile
- In-app notifications: bell + dropdown, unread badge, mark-all-read
- Mobile bottom nav + desktop sidebar
- Google Calendar STUB (push/delete functions log + return mock ids)
- Row-level isolation via serializer: members only see own detail in /api/bookings
- 12/12 backend pytest passing; frontend E2E verified

## Backlog (prioritized)
### P0 (next)
- Wire Resend API key → real invite emails
- Wire real Google Calendar OAuth + bidirectional sync (inbound poll from Acuity/Cal.com via the already-synced GCal; outbound push on approve/manual)

### P1
- Booking time-range validation (end > start) + overlap detection per calendar
- Prevent calendar deletion if bookings exist (or cascade)
- PWA manifest + service worker + install prompt
- Pending-24h admin reminder notification

### P2
- Auth hardening: rate-limit login (lockout after 5 fails), refresh tokens, password reset
- Reschedule / cancel flow for bookings
- Weekly availability presets per calendar
- Email digest + push notifications

## Known stubs / mocks
- **GOOGLE CALENDAR IS MOCKED** — `gcal_push_event` / `gcal_delete_event` in `server.py` log + return mock ids; no real API calls.
- **RESEND EMAIL IS MOCKED** — invite links returned in `POST /api/invites` response and displayed in admin Members UI for copy/paste.

## Credentials
See `/app/memory/test_credentials.md`.
