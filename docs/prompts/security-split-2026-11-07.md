# Prompt: separate the Lab, the dashboards and the website; add Support access

Paste everything below the line into Claude Code, opened in `C:\Users\Mohamad\Ai receptionist`.

---

You are working on MXAi (read `CLAUDE.md` first: stack, rules, tests, the founder is not a developer). Branch:
`redesign/board-system`. Proceed step by step without asking, commit after each step that passes the tests, and push at
the end. Never type into or submit forms on the real dashboard during browser checks (read-only sweeps). Explain the
result in plain words with a Links table.

## Why
Today one app at one address (`app.nexfoyz.dev`) serves the public MXAi website (`/pulse`), the sign-in page, the
admin's Lab and HQ, and every client dashboard. Client data is separated correctly (server-side `business_id` checks,
`isolation-test.js`), but:
1. The public website, client sign-in and the Lab share one origin, so a flaw on a public page could reach the admin's
   session, and the most powerful login sits on the most public page.
2. "Open business" in the Lab gives the admin full write access to any client, silently, with an `rb_biz` cookie that
   lasts 365 days. The client is never told. This is the main GDPR and trust problem.
3. The Lab and the dashboards are the same pages behind a role check, so they feel mixed.

Goal: **one app and one database, but separate doors**, and admin access to client data that is limited, visible and
recorded. Zero monthly cost (Cloudflare free plan).

## Target

| Address | Serves | Who can get in |
|---|---|---|
| `nexfoyz.dev`, `www.` | public website (unchanged for now, see step 6) | everyone |
| `app.nexfoyz.dev` | client dashboards, sign-in for owners and staff, booking page and public APIs | owners and staff; **admin logins refused** |
| `lab.nexfoyz.dev` | the Lab, HQ, Controls, Support access | admin only: Cloudflare Access gate + password + 2-step code |
| `<name>.nexfoyz.dev` | client websites | everyone, no sign-in |

## Steps

### 1. Hosts in config
- Add `LAB_HOST=lab.nexfoyz.dev` and `APP_HOST=app.nexfoyz.dev` to `.env.example` and `.env` (keep `PUBLIC_URL`).
- One helper (e.g. `app/src/hosts.js`): `surfaceOf(req)` returns `lab`, `app`, `site` (a client website) or `dev`.
  `localhost`/`127.0.0.1` = `dev`: everything works there as today, so the PC and the tests keep working. Also
  accept `lab.localhost:3100` as `lab` for local checks.
- Reserve the subdomain `lab` (and `app`, `www`) so it can never be given to a client website
  (`sitegen.js` `validSubdomain` / `businessForHost`). Add a test.

### 2. Admin only on the Lab address
- `POST /api/login`: on `app` surface, an `admin` account gets 403 "Sign in to the Lab at https://lab.nexfoyz.dev";
  on `lab` surface, owners and staff get 403 "Sign in at https://app.nexfoyz.dev". Don't reveal whether the password
  was right: check the surface before the password, and count the attempt like a wrong password.
- Middleware: on `lab`, any non-admin session gets 401 for `/api/*` and the login page for pages; on `app`, an admin
  session is treated as signed out (except `dev`). Every `/api/admin/*` route answers only on `lab` or `dev`.
- Cookies stay host-only (no `Domain=` attribute, check every `Set-Cookie`), so a session on one address is never
  sent to the other. `SameSite=Strict`, `HttpOnly`, `Secure` on https, as today. Admin sessions: 8 hours.
- Apply the dashboard CSP (`web.js` `CSP`) to every page on `lab` and `app`, not only `/` and `/login`.
- The login page shows a small line on `app`: "MXAi staff sign in at lab.nexfoyz.dev" is NOT shown (don't advertise
  the Lab); on `lab` it says "MXAi Lab".

### 3. Support access replaces "Open business"
- New table `support_sessions` (`id, admin_id, business_id, reason, can_edit bool, started_at, expires_at, ended_at,
  ended_by`), additive migration in `schema.sql`.
- Lab › "Open" becomes **"Open with support access"**: creates a session, **read-only**, **expires after 60 minutes**
  (button "Extend 30 min"). The `rb_biz` cookie is replaced by `rb_support=<signed session id>` (HMAC like
  `rb_session`), Max-Age = time left. The server reads the business from the support session row, never from a bare id.
- **Read-only is enforced on the server**: while `can_edit` is false, any non-GET request from the admin inside a
  business gets 403 "Read-only support access. Press Allow changes." (keep `/api/admin/*`, `/api/me`, logout working).
- **"Allow changes"** asks for a reason (required, 5+ characters), sets `can_edit`, logs it, and stays until the
  session ends.
- A fixed **banner** in the dashboard while support access is on: business name, read-only or editing, minutes left,
  buttons Extend, Allow changes, End. "End" and expiry return to the Lab.
- **The client can see it**: Settings › Security gets "MXAi support access" (date, how long, read-only or edited,
  reason). The owner also gets a notification (`notify.js` kind `support`) when a session starts and when changes are
  allowed. Test businesses (`is_demo`) skip the notification.
- Audit log entries: `support_started`, `support_edit_allowed`, `support_extended`, `support_ended`, with the reason.
- "View as" (rb_viewas) keeps working inside a support session.

### 4. Cloudflare (the founder does the dashboard part; you prepare and explain)
- Tunnel: add `lab.nexfoyz.dev -> http://localhost:3100` to `C:\Users\Mohamad\.cloudflared\config.yml` **above** the
  `*.nexfoyz.dev` wildcard (back the file up first, as `config.yml.bak5`), then run
  `cloudflared tunnel route dns jarvis lab.nexfoyz.dev` and restart the tunnel (the watchdog,
  `scripts/mxai-watchdog.ps1`, restarts it if it stops). Check `https://lab.nexfoyz.dev/health`.
- Cloudflare Access (free, Zero Trust): write step-by-step instructions for the founder: create a self-hosted
  application for `lab.nexfoyz.dev`, one policy "Allow" for their email (mhmdhasbini@gmail.com), session 24 h.
  Do not do this yourself: it needs their Cloudflare login.
- Optional extra lock: if `CF_ACCESS_AUD` is set in `.env`, the server checks the `Cf-Access-Jwt-Assertion` header on
  the `lab` surface (verify against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`) and refuses without it.
  Off when not set, so nothing breaks before the founder finishes the Access setup.

### 5. Separate the Lab visually
- On `lab`, `/` opens the Lab (HQ first). The client dashboard is reachable only through Support access, with the
  banner. On `app`, nothing of the Lab is sent: no `admin.js`/`hq.js`/`controls.js` code paths, no "Back to Lab"
  button. If the scripts are shared, gate them on `me.surface === 'lab'` from `/api/me`.

### 6. The public website
- Keep `/pulse` working on `app.nexfoyz.dev` for now (links already shared). Do not move it to `nexfoyz.dev` in this
  task: the apex currently serves the Jarvis home, privacy and terms pages that Google OAuth needs. Write the plan for
  moving it in `docs/` and list it as an open item.

### 7. Tests (every step; a crash is a failure)
Add to `app/src/smoke-test.js` (use the `Host` header to simulate addresses; the app listens on localhost):
- admin login refused with Host `app.nexfoyz.dev`, allowed with Host `lab.nexfoyz.dev` and on localhost
- owner login refused on the lab host
- `/api/admin/hq` refused on the app host
- `lab` cannot be claimed as a client subdomain
- support access: opening creates a read-only session; a POST inside the business is refused; after Allow changes
  (with reason) it works; an expired session (set `expires_at` in the past) no longer opens the business; the owner
  sees the session in `/api/me/support-log` (or wherever you put it) and got a notification
- no `Set-Cookie` has a `Domain=` attribute
Run `docker compose up -d --build app` and `docker compose exec app npm test`; all 6 suites must pass.

### 8. Finish
- Update `CLAUDE.md` (addresses, support access, Cloudflare Access steps) and `docs/control-model-2026-11-07.md`
  (mark these items built).
- Check in the browser read-only: lab and app addresses, banner, Settings › Security log. Screenshot for the founder.
- Commit, push, and report in plain words: what changed for the founder, what changed for clients, the Cloudflare
  Access steps still to do, and links.
