# MXAi launch audit · 4 Nov 2026

Seven read-only audits (security, data, receptionist + channels, launch readiness, navigation/UX, front end +
accessibility, operations), each finding checked in the code before it was fixed. Every fix has a regression
test; all six suites pass on a fresh throwaway database (`bash scripts/test-fresh.sh`): 104 checks before, 131 after.

## Fixed (branch `redesign/board-system`, one commit each)

| # | What was wrong | What it means for a client | Commit |
|---|---|---|---|
| 1 | Typing another client's email in a chat merged the two records; the chat could then read and cancel that client's bookings. WeBook gave a session for any typed phone. Merging deleted memberships, payments and waitlist places. | Client data is private; merges lose nothing | `da76b00` |
| 2 | The MXAi Assistant's "any question" query could call `schema_to_xml` and read every business's tables (password hashes, 2FA secrets, all clients). | One business can never see another's data | `f008738` |
| 3 | Staff could use any API area not on the permissions map (API keys, integrations, the AI team); owners could run platform-wide jobs, set another WhatsApp number, claim another business's Instagram; script injection through the assistant name. | Staff see only their sections | `c181c76` |
| 4 | Every date used the server's Beirut clock: a Madrid salon would be offered times an hour off, and every clock-change day was wrong. | Spain works | `b2e748f` |
| 5 | A WhatsApp message being answered during a restart was lost; backups could age out every good copy; restore could leave a half-restored database. | Nothing lost on restarts; backups safe | `070e395` |
| 6 | Revenue had three definitions; Insights counted no-shows and next week's bookings as this month's income; the weekly brief always said "0 by your AI". | Numbers agree on every screen | `1d419ab` |
| 7 | الغداء (lunch) triggered a cancellation; "hair colouring" booked "Hair cut"; Spanish/French clients got English; silence when every AI failed; "Powered by Pulse"; owner's private notes given to the AI; Telegram answered twice after a restart. | The receptionist is trustworthy | `6f627d6` |
| 8 | 74 tab entries, 14 unreachable (incl. the AI on/off switch); links opened the wrong tabs; pop-ups under the phone menu and not real dialogs; focus hidden; low-contrast grey; dead pollers. | A calmer, working dashboard | `cb1e6ee` |
| 9 | No way to give a client their data or erase it (GDPR); sample site figures looked real; online cancellations used one shared lock and skipped the waitlist; 2FA guessing not limited per login. | Ready for EU clients | (this batch) |

## Needs the owner (decisions, accounts or money)

1. **Legal**: which company signs, a contact email, a terms page and a data processing agreement for each salon;
   lawyer review of `privacy.html` (it currently says "have it reviewed by a lawyer" in public).
2. **WhatsApp templates**: reminders and offers sent more than 24 h after a client's last message need
   Meta-approved templates, or Meta silently drops them. Create 2–3 templates in Meta Business Manager; the code
   then sends them (not built yet).
3. **Where it runs**: one home PC. Turn on Docker Desktop "start when you sign in", disable sleep on power, add a
   free uptime check on `https://app.nexfoyz.dev/health`. An off-site backup copy (free: Google Drive or R2) is
   still missing. A ~€5/month EU server is the real fix when the first client pays.
4. **Billing**: prices in EUR with VAT for Spain; first client by Stripe Payment Link, subscriptions later.
5. **Support contact** on the site and in the dashboard (WhatsApp number and email).
6. **Settings in `.env`**: `WEBOOK_DEMO=0` before real clients use WeBook (demo salons otherwise appear);
   decide `EDITION` (lab shows plans and upsells to clients).
7. **Private notes**: no longer given to the AI (privacy). If you want allergy-type notes to reach the AI, add a
   separate "Notes the AI may use" field.

## Next 30 days (engineering)

1. WhatsApp templates + read Meta's delivery `statuses` so failed sends show in the Inbox (after owner step 2).
2. Off-site encrypted backup + weekly automatic restore check into a throwaway database.
3. Booking writes in one transaction (insert, coupon use, request) with notifications after commit.
4. Self sign-up and password reset by email (needs an email provider key).
5. Spanish dashboard labels for Today, Inbox and Calendar.
6. Retire the live colour-contrast fixer (`js/guard.js`) once the token pass is done; one `tokens.css`.
7. ESLint (no-undef, no-unused-vars) in CI.
