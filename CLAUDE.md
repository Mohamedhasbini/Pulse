# MXAi — project guide for Claude

Read this first. It is loaded automatically in every Claude Code session in this folder.

## What this product is
**MXAi** is an AI front desk and business dashboard sold as a subscription to local service businesses
(salons first; also clinics, restaurants, spas, gyms, garages) in **Lebanon and Spain**.
- An AI receptionist answers clients on WhatsApp, Telegram, Instagram, website chat and the **WeBook** marketplace app,
  books appointments, and hands hard cases to the owner.
- The owner runs the business from the **Dashboard** (Today, Inbox, Calendar, Clients, Growth, Insights, AI Control, Settings).
- The platform admin (the founder) manages every client business from the **Lab**.
- Each client business can also get a generated **Website**.

Naming: the brand is **MXAi**. Old names still appear in code and must not appear in new UI copy:
`ringback` (package/database/n8n names), `Pulse` (retired brand; `pulse.js`, `pulse.css`, `P10`), `Nora` (default
assistant name; each business can rename it, use `window.P10.named('Nora')` in the UI).

Roles: `admin` (platform), `owner`, `staff` (permissions per section). Plans and add-ons gate features (`features.js`).

## Stack and how it runs
- Node 22 + Express 4 (ES modules, no build step, no TypeScript), PostgreSQL 16, plain HTML/CSS/JS front end.
- Everything runs in Docker on the founder's Windows PC: `docker compose up -d --build`
  - `app` → http://localhost:3100 (public: https://app.nexfoyz.dev via Cloudflare tunnel "jarvis")
  - **Separate doors** (`app/src/hosts.js`): `lab.nexfoyz.dev` = the Lab, admin only; `app.nexfoyz.dev` = client dashboards,
    admin refused; localhost = everything. The admin enters a client only through **Support access** (`support.js`):
    read-only, 60 min, banner, owner notified and sees it in Settings › Security. See `docs/lab-access-2026-11-07.md`.
  - `db` (Postgres), `backup` (daily `pg_dump` + uploads into `./backups`, kept 14 days)
- AI replies: n8n workflow at :5678 (`n8n/ringback-receptionist.json`, Gemini) with backup models in `app/src/ai-router.js`.
- **Stays online by itself:** the Windows task "MXAi watchdog" (`scripts/mxai-watchdog.ps1`) starts at sign-in and every 2 minutes
  restarts whatever dropped (Docker, app, n8n, Cloudflare tunnel, home page). Log: `logs/watchdog.log`. `start-mxai.cmd` is the manual fallback.
- **The code is baked into the image.** After any change to `app/`, rebuild: `docker compose up -d --build app`.
- Cloud hosting (Render) was tried and rolled back on 2026-10-25. Cost stance: zero monthly fees until the first paying client.

## Where everything is
| Area | Files |
|---|---|
| Server, auth, sessions, API routes | `app/src/server.js` (security headers, CSRF origin check, login/2FA, permissions, plan gates) |
| Startup safety (refuses weak secrets on a public URL) | `app/src/startup-check.js` |
| Database pool + migrations | `app/src/db.js`, `app/src/schema.sql` (additive `ALTER … IF NOT EXISTS` only; never destroy data) |
| One message in → AI → booking/handoff → reply | `app/src/brain.js` (chat housekeeping), `slots.js`, `ai-router.js` |
| **MXAi orchestrator** (8 layers): customer roles (receptionist/support/sales) and the dashboard chat (`askMxai`, used by `team.js /api/team/ask`) | `app/src/mxai/` (read `CONTRACT.md` first; tools in `tools.js`, guardrails, access, persona) |
| Business numbers (single source of truth) | `app/src/metrics.js` |
| Clients, merging duplicates | `app/src/customers.js` |
| Inbox, campaigns, finance, team agents | `inbox.js`, `marketing.js`, `finance.js`, `team.js`, `agents.js` |
| Channels | `telegram.js`, `instagram.js`, WhatsApp in `server.js`, WeBook in `webook.js` |
| Client websites | `site.js`, `sitegen.js` |
| Delivery (compression, hashed assets, CSP) | `app/src/web.js` |
| Dashboard shell + navigation (all tabs and sub-tabs) | `app/public/index.html`, `app/public/pulse.js` (`PAGES` list; link to tabs by name: `P10.go('pulse', 'Answers')`) |
| Business clock (each business's time zone) | `app/src/clock.js` (`inZone`, `wall`, `at`); never use `setHours`/`getDay` on the server |
| Today tab | `app/public/home.js` |
| Charts / tab pages (Clients, Growth, Insights, AI performance) | `app/public/charts.js`, component kit `mx-ui.js` + `mx-ui.css` |
| Inbox UI | `app/public/inbox.js` |
| Public site, booking page, privacy | `app/public/site.html`, `book.html`, `privacy.html` |
| Design references | `design/` (design system, plans), `.interface-design/` |
| Plans and audits | `docs/launch-audit-2026-11-04.md` (latest: fixed + open), `docs/improvement-plan-2026-10-30.md` |
| New client onboarding | `.claude/skills/new-client/` |
| Server setup / restore | `scripts/` (`restore.sh <backup>`) |
| CI | `.github/workflows/test.yml` |

## Tests (must pass before every commit)
Tests need the database, so they run inside the container:
```
docker compose up -d --build app
docker compose exec app npm test
```
Six suites: client data separation, end-to-end platform, client websites, Coach, metrics agree, MXAi Assistant.
A crash counts as a failure. Fresh-database run without touching real data: `bash scripts/test-fresh.sh [name]`
(throwaway stack, own `.env.ci` with channels and AI off; use a different name per parallel run). Never point a
throwaway stack at the real `.env`: the app long-polls the real Telegram bot and would steal live messages.
Every bug fix gets a regression test (usually in `app/src/smoke-test.js`).

## Rules
- **Never type into or submit forms during automated browser checks** on the real dashboard: sweeps are read-only
  (an automated check once saved data by typing + Enter). The test account is "Beauty S1" (business id 1).
- **Before deleting or overwriting data, look first. Backups:** `./backups/ringback-*.sql.gz`; check file sizes are not tiny.
- Keep the visual direction: graphite + silver, lime used rarely; calm, businesslike, no gradients/glass ornament.
  Today is the quality benchmark for every other tab: lead with what to act on, figures after, detail on demand.
- Keyboard focus must stay visible; touch targets ≥ 24px; respect reduced motion.
- Prefer small, verified, reviewable commits on a branch; push only when asked. Current work branch: `redesign/board-system`.
- The owner is not a developer: explain in plain words, say what they get from each step, list links at the end.
- Be token-efficient: few screenshots, batch edits, no repeated full sweeps.

## Known open items
- Backups: hourly check (one a day), encrypted daily copy to OneDrive (scripts/offsite-backup.ps1, key BACKUP_KEY), weekly
  restore test (scripts/restore-test.sh); none are made while the PC is off.
- No type checking or linting in the project yet.
- Bookings have no `updated_at`, so "cancelled since…" can't be counted.
- Next business steps: self sign-up/login for new businesses, plans and billing (Stripe), staff accounts.
