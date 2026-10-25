---
name: new-client
description: Onboard a new client business onto the Pulse platform (salon, clinic, restaurant, spa, gym, garage...). Use whenever the user says "create a new client", "add a business", "onboard <name>", "set up a restaurant/salon for <client>", or asks what is needed from a new customer. Also covers closing a client, platform health checks and the go-live checklist.
---

# New client on Pulse

Pulse is ONE shared multi-tenant system. A new client is a new row in `businesses`, never a new app, database, website or n8n workflow.
Everything below is done from the running platform (Command center) or with small SQL/API calls. Never copy the app or the n8n workflow per client.

## 0. Before starting, check the platform is healthy
- `docker compose ps` (app, db, backup all running) and `docker compose exec app npm test` → must end with "All 3 test suites passed". Never onboard or release on a failing test.
- Command center → **Platform** tab: all checks OK (database, AI, WhatsApp provider, daily backup, disk).
- If anything fails, fix it before onboarding.

## 1. Collect from the client (send them this list)
| Area | What |
|---|---|
| Basics | Business name, type, address, Google Maps link, phone, Instagram, website, country, city, currency (USD Lebanon / EUR Spain), time zone |
| Branding | Logo, a cover photo, menu or price list (PDF or image) |
| Hours | Opening hours per day (with breaks), holidays and closures |
| Services | Name, price, duration, short description. Restaurants: table types (Table for 2/4/Group) and **how many tables of each** |
| Capacity | How many customers at the same time (chairs/staff/rooms), booking step (15/30/60 min), buffer between bookings |
| Rules | Cancellation window, minimum notice, how far ahead, deposits, late policy, children/pets, large groups |
| FAQs | Their most common customer questions and exact answers. Restaurants: dietary (vegan, gluten-free, halal), allergies, parking, terrace, events |
| AI | Languages, tone (warm/professional/playful), assistant name (default Nora), things to always/never say |
| Channels | WhatsApp number to use (+ Meta Business access, or we create it), optional Telegram |
| People | Owner email for login; staff emails and what each may open; who gets alerts |
| Billing | Plan (Starter/Pro/Business), add-ons (incl. "Remove Pulse branding"), billing contact |
| Consent | Signed agreement; confirmation they may message their customers (WhatsApp policy, GDPR in Spain) |

## 2. Create it (about 1–2 hours)
1. **Command center → New business** (the admin ticks everything here first): name, type (vertical), country, city, currency, time zone, **plan**, **add-ons** (e.g. Own website, Remove Pulse branding), **website style** and **free address (subdomain)**, owner email. Fine-tune features later in Command center → Businesses → plan. This creates the business with the type's starter services/FAQs/policies and the owner login (temporary password shown once; send it privately and ask them to turn on two-factor).
2. **Switch to the business** (Command center → Businesses → open), then **Settings → Setup**:
   - Business details: description, address, links, languages, tone, **assistant name**, team, hours, capacity, step, services (+ "at once" per service for restaurants), policies, FAQs, AI instructions, phone, cancel window, payment methods, confirmation note.
   - Photos and menu: upload logo, cover, menu.
   - Tools and payments: buffers, payment options.
   - Reminders, Booking page (on/off, colour, notice), Discount codes.
3. **WhatsApp**: add the number in Kapso (our single Kapso account; the platform uses `KAPSO_API_KEY`), copy its **phone number ID** into Settings → Business details → WhatsApp phone number ID. Incoming messages are routed to the business by that ID.
4. **Telegram (optional)**: client creates a bot with @BotFather (or we do), paste the token in Settings → Channels. It is stored encrypted.
5. **Staff logins**: Command center → Logins (needs the Staff logins feature in the plan/add-on).
6. **Owner alerts**: in Pulse, bell → Alert settings → link Telegram for the owner.

## 2b. Website (if the plan or add-ons include "Own website")
- Switch to the business → **Website**. Admin tabs: Design (style Elegant/Modern/Warm/Bold, colour, sections and their order), Address and publishing (subdomain, own domain + DNS steps, Published).
- Texts and Photos: fill the hero title, subtitle, about; upload up to 12 gallery photos. Services, prices, hours, team, FAQs and contact come from Settings automatically.
- Preview at `/s/<ID>` (phone/computer toggle in the screen). Publish when approved by the client.
- Client websites are **English only** (user decision 2026-10-25).
- The client later edits only Texts and Photos; design and address stay with the admin.

## 3. Test before handing over
- Settings → Test chat: ask prices, hours, a FAQ, book, change, cancel. Restaurants: "table for 6 tomorrow at 8pm" must ask/record guests and respect table counts.
- Check the booking appears in Calendar, the confirmation ends with "Powered by Pulse" (unless branding add-on), reminders are on.
- Send a real WhatsApp message to their number and confirm a reply.

## 4. Hand over: send the client their links
- Dashboard: https://app.nexfoyz.dev/login
- Booking page: https://app.nexfoyz.dev/book?b=<ID>
- WeBook page: https://app.nexfoyz.dev/webook/<ID> (add `?book=1` or `?chat=1`)
- Website: https://<subdomain>.<SITES_DOMAIN> or their own domain (preview `/s/<ID>`)
- Their WhatsApp number / Telegram bot link

## 5. Closing a client
Command center → Platform → **Export** (download JSON, keep it) → **Close…** (type the exact business name). Deletes customers, chats, bookings, logins and uploaded photos in one transaction. Backups still hold it for up to 14 days.

## Where things are (for Claude)
- App: `app/src` (Express, `server.js`), pages in `app/public` (`index.html` = Pulse dashboard, `site.html` = website, `webook.html`, `book.html`, `privacy.html`).
- Business creation: `createBusiness()` in `app/src/accounts.js`; types/templates in `app/src/verticals.js`.
- Tenant separation: every table has `business_id`; the server sets the business from the login (`BIZ()`); test: `app/src/isolation-test.js`. End-to-end: `app/src/smoke-test.js`.
- Ops: `app/src/ops.js` (encryption via `DATA_KEY`, uploads in the `uploads` volume, usage/cost, export/close, health monitor + Telegram alerts via `ALERT_BOT_TOKEN`/`ALERT_CHAT_ID`).
- Backups: `backup` service in `docker-compose.yml` → `./backups` daily, 14 days. Restore: `sh scripts/restore.sh backups/<file>.sql.gz`.
- Client websites: `app/src/sitegen.js` (styles, sections, rendering, host routing, `/s/:id` preview), editor `app/public/website.js`, tests `app/src/site-test.js`, visual samples `app/src/site-samples.js`.
- Editions: `EDITION=product` in `.env` on the product server hides plans, add-ons, locks and upsells from clients; the Lab (no EDITION) shows everything. Showcase salon: `node src/demo-salon.js` (subdomain layla-demo).
- All tests: `docker compose exec app npm test`.
- AI: one n8n workflow (`n8n/ringback-receptionist.json`, Gemini Flash-Lite) receives each business's context per message.

## Go-live checklist (platform, not per client)
- [ ] Product server `.env`: `EDITION=product`, `SITES_DOMAIN=<your sites domain>`; Cloudflare: wildcard `*.<SITES_DOMAIN>` to the app (tunnel ingress + DNS), custom hostnames for client domains.
- [ ] Move from the home PC to a server (Hetzner, EU) with Docker Compose; copy `.env` (incl. `DATA_KEY`) and restore the latest backup there; point the Cloudflare tunnel to it.
- [ ] Copy `./backups` off the machine daily (Backblaze B2 / Cloudflare R2 / another disk). Keep `DATA_KEY` in a password manager.
- [ ] Set `ALERT_BOT_TOKEN` + `ALERT_CHAT_ID` in `.env` (create a bot with @BotFather, message it, get the chat id from `https://api.telegram.org/bot<token>/getUpdates`).
- [ ] Set spending limits on Google AI and Kapso/Meta.
- [ ] Have `privacy.html` and the client agreement reviewed by a lawyer (Spain: GDPR/AEPD).
- [ ] Hide the demo businesses on WeBook when real clients exist (`WEBOOK_DEMO=0`).
