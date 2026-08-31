Studio 7 Miami — Internal Calendar

This is your team’s home for the schedule: see what’s free, ask for time, get a yes or no, and keep everyone aligned without chasing threads. As of 8.31.26, it is also where proposals are written, sent, signed, and paid.

---

**What this is**

This is the internal calendar for Studio 7 Miami. Your team can open one place to view availability, send booking requests, and see decisions—so the day stays organized and nobody’s guessing what’s held or what’s open.

*Proposals* (new — 8.31.26) is the studio’s way to send a client a creative plan, collect a signature, and take a deposit without giving them a team login. The team app stays internal. The client gets a private link.

---

**How it works (briefly)**

*The experience you see* 
This is a single web app: you sign in, land on the [calendar], and move through the sidebar (or bottom bar on your phone) to [requests], [profile], and—if your role allows—[proposals], [members], or [calendars]. Everything you tap talks to a secure [api] behind the scenes, which reads and writes your team’s data in [supabase] (that’s the database where users, calendars, bookings, proposals, and invites live).

*Calendar* shows approved and pending holds by day, week, or month. You can turn resource calendars on or off, open a day to see detail or request a slot, and—depending on role—see who a booking is for or just see that time is booked. *Requests* is where booking asks land: you submit new ones, and managers or admins review, approve, or decline them. *Proposals* is where a session is packaged for a client: vision, content, investment, then a private link to review, sign, and pay. *Members* (for admins and certain managers) is where invites go out, roles are set, and people are connected to the calendars they’re allowed to see. *Calendars* (admins) is where room or resource calendars are created, colored, and wired to availability rules. *Profile* is each person’s account home—password, optional extra verification, and how they show up to the team.

When email is configured, [magic.invite.link], [booking.decisions], and [proposal.links] arrive by mail. When [google.calendar] is connected, the system can mirror studio bookings outward and, on a schedule you configure, pull external holds inward so Acuity- or Cal.com-style blocks appear on the internal calendar without double entry. The small [concierge] chat in the corner answers natural-language questions about the schedule using the same booking data your team already trusts—handy for “what’s free Friday?” without digging through every row.

---

**Proposals** *(new — 8.31.26)*

Proposals live in the team app. Clients never sign into `team.studio7.miami`. They open a private `/p/…` link from a text or email.

*Who sees it in the team app:* Admin always sees the Proposals tab. Members and managers do not, unless an admin turns on **View proposals** (and any related proposal permissions) on Members.

*What the team does:* Draft the client, session, vision, content, and investment. Preview it. Send it. If the client already said yes by text or in person, mark it accepted and send the sign-and-pay link instead of making them review the deck again.

*What the client does:* Open the link → read the proposal → accept → review and sign the agreement → pay the deposit (or pay in full). After they have accepted, the same link goes straight to the agreement so they are not asked to approve the proposal twice. **← Back to proposal** stays on the agreement if they want to reread the plan.

*What happens on the calendar:* Sending a proposal holds the session date. After the deposit is paid, that hold becomes a confirmed booking.

*The client path, in order:* Proposal → Agreement → Pay.

---

**How to access it**

*Where to go:* Use the live web address your team was given (bookmark it on your phone and desktop). If you don’t have the link, ask your Studio 7 admin or reach out to TAĪSTU.

*Signing in:* Open the link, sign in with the email that was invited, and follow any prompts for password or verification your admin has turned on.

---

**As an admin, you can:**

- *Invite teammates* so they can sign in and use the calendar  
- *Turn calendars on or off* and keep the right rooms or resources visible  
- *Review booking requests* and approve or decline them  
- *Add bookings by hand* when something needs to go on the schedule without a self-serve request  
- *See the full picture*—who asked, what’s pending, and what’s already locked in  
- *Grant proposal access* so the right people can draft, send, or manage client proposals  
- *Send a proposal* (or a sign-and-pay link after a verbal yes) without giving the client a team account  

---

Your accounts (where things live)

The app relies on a few services you control or subscribe to. **Passwords and API keys belong in 1Password (or your vault)—not in email or screenshots.**

| Service | Role in this project |
|--------|------------------------|
| **[Supabase](https://supabase.com)** | Database and secure storage for app data |
| **[GitHub](https://github.com)** | Source code repository (version history + deployment source) |
| **[Railway](https://railway.app)** *(or similar)* | Where the live API often runs—ask TAĪSTU which host you’re on |
| **[Vercel](https://vercel.com)** *(or similar)* | Where the public website / calendar front end is hosted |
| **[Resend](https://resend.com)** *(if configured)* | Sends invite links, booking emails, and proposal emails from your domain |
| **[Stripe](https://stripe.com)** *(if configured)* | Checkout for proposal deposits and remaining balances |
| **[Google Cloud](https://cloud.google.com)** | Connects Google Calendar for sync, when your team enables it |

If you’re not sure which provider you’re on, TAĪSTU can confirm from your deployment notes.

---

**If something breaks**

*First step:* Note what you were doing, what you expected, and what you saw (a screenshot helps).

*Who to contact:* For outages, mis-sent email, or anything that feels like a product bug, contact TAĪSTU via [taistu.com].

*Have ready:* The time it happened, which browser or device, and whether others see the same thing. Don’t send passwords or secret keys—use a call or a secure channel if something sensitive is involved.

---

**What’s coming in v2**

- *SMS / email notifications* so fewer things get missed    
- *Recurring blocked windows* for standing holds or maintenance  
- *Client-facing booking page* so guests can request time in a guided way  

---

BUILT BY:

TAĪSTU — [https://www.taistu.com]
delivered with care - April 30, 2026  
proposals added - August 31, 2026