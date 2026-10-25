# Ringback: AI front desk

WhatsApp receptionist for local businesses. The app stores everything and shows the dashboard; the n8n workflow "Ringback Receptionist" decides what to reply.

```
WhatsApp → Meta Cloud API → app.nexfoyz.dev (Cloudflare tunnel "jarvis") → app :3100
                                         app ⇄ n8n :5678 /webhook/ringback (Gemini)
```

## Run
```
docker compose up -d --build
```
Dashboard: http://localhost:3100. Sign in with email `admin` and the `ADMIN_PASSWORD` from `.env` (the platform admin login).

## Files
- `app/src/server.js`: WhatsApp webhook, dashboard API, password protection
- `app/src/brain.js`: one message in → asks n8n → books / hands off → reply out
- `app/src/slots.js`: free times from opening hours and bookings
- `app/src/schema.sql`: database tables
- `app/public/index.html`: dashboard, test chat, business setup
- `n8n/ringback-receptionist.json`: the workflow (already imported into your n8n)
- `n8n/receptionist-guidelines.md`: how the assistant behaves. Edit the prompt in the n8n "Receptionist" node.

## Make it public (once)
Cloudflare → Zero Trust → Networks → Tunnels → **jarvis** → Routes → add a public hostname:
`app.nexfoyz.dev` → `http://localhost:3100`

## Connect WhatsApp
1. developers.facebook.com → your app → WhatsApp → API setup. Note the **Phone number ID** and create an access token (use a permanent System User token for real use).
2. In `.env`, set `WA_ACCESS_TOKEN` and `WA_APP_SECRET` (App settings → Basic). Then `docker compose up -d`.
3. WhatsApp → Configuration → Webhook: URL `https://app.nexfoyz.dev/webhook/whatsapp`, verify token = `WA_VERIFY_TOKEN` from `.env`. Subscribe to **messages**.
4. Dashboard → Business setup → paste the Phone number ID → Save.

## Next
- Per-business time zone for slots and reminders (today all times use `TIMEZONE` from `.env`)
- Appointment reminders (WhatsApp templates), cancellations, staff alerts on handoff
- Voice (phase 2)


## AI model
The n8n workflow uses `gemini-3.1-flash-lite` (about 1-2 s per reply on the free key). `gemini-3.8-flash` took 70-90 s because of free-tier limits. Change it in the n8n "Gemini" node.

## Accounts, plans and security
- **Command center** (admin only, "Businesses" tab): create businesses with an owner login and plan; change plan, status, add-ons and per-business feature switches; create owner or staff logins and tick exactly which sections staff can open; switch a login off, sign it out, reset its password or two-factor; edit plans and add-ons; read the audit log. Every change applies on the user's next click.
- **Plans and add-ons** live in the `plans` and `addons` tables (seeded Starter / Pro / Business + Insights, Teach AI, Staff logins add-ons). Feature checks are in `app/src/features.js` and run on the server for every request; the dashboard only hides what the server would refuse.
- **Sign-in**: email + password (10+ characters with letters and numbers), optional two-factor codes (authenticator app), 5 wrong passwords lock the account for 15 minutes, sessions last 12 hours, "sign out everywhere" and password changes end all other sessions.
- **Protection**: security headers, cookies are HttpOnly + SameSite=Strict, changes from other websites are refused, every sign-in, refusal and admin action is in `audit_log`.
- Owners and staff sign in at `/login`; `admin` uses `ADMIN_PASSWORD` the first time (change it, and turn on two-factor, under "Account security").
