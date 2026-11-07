# MXAi v2

The new MXAi product, built separately from MXAi v1 (the dashboard, Lab and website in the folders above, which stay untouched).
v2 starts with the **growth engine**: it finds leads for a business, checks how to reach them, and scores how well they fit.

## Run it

```
cd v2
docker compose up -d --build        # app on http://localhost:3200 (this PC only) + its own database
docker compose exec -T app npm test # tests
```
Sign in at http://localhost:3200 with the admin key `V2_ADMIN_TOKEN` from `v2/.env` (never committed).
Needs the engine services in `C:\Users\Mohamad\mxai-stack` (Crawl4AI, SearXNG, Reacher) and the Docker network `mxai-net`. See `../docs/repos.md`.

## What's inside

| Part | File |
|---|---|
| Server, sign-in, security | `app/src/server.js` |
| Database + schema (additive only, pgvector) | `app/src/db.js`, `app/src/schema.sql` |
| Outside services (crawl, search, email check, OpenStreetMap) | `app/src/engine/services.js` |
| AI gateway (Gemini via Vercel AI SDK, own pace and models) | `app/src/engine/ai.js` |
| Business brain: a client's profile from its website | `app/src/engine/brain.js` |
| Finding companies | `app/src/engine/discover.js` |
| Reading each company's site (only facts really on the page) | `app/src/engine/enrich.js` |
| Contacts and email checks | `app/src/engine/verify.js` |
| Scoring (AI judge + meaning match) | `app/src/engine/score.js` |
| A whole batch | `app/src/engine/pipeline.js` |
| Background jobs (pg-boss) and API | `app/src/engine/index.js` |
| Lead lab page (grade leads) | `app/public/eng-lab.html` |

## Lead pool (phase A, built 2026-11-07)
A worldwide, consented B2C lead database. Screen: http://localhost:3200/pool.html (People · Capture forms · Country rules).
| Part | File |
|---|---|
| Country rules data (33 countries) | `app/src/pool/countries.js` (from `docs/country-rules.md`) |
| May we send this? (consent, suppression, quiet hours, limits, labels) | `app/src/pool/rules.js` |
| Identities, consent certificates, sensitive-data guard, opt-out words | `app/src/pool/core.js` |
| Capture: merge duplicates, keep allowed facts, sign consents, score | `app/src/pool/capture.js` |
| Public form `/f/<slug>`, confirm `/c/<token>`, unsubscribe `/u/<token>`, Meta/Google webhooks, admin API | `app/src/pool/routes.js`, `form-page.js` |
| The screen | `app/public/pool.html` |
| One-time codes (WhatsApp/SMS; Twilio Verify, WhatsApp Cloud API or test mode) | `app/src/pool/codes.js` |
| Phone line type, gmail match key, email checks (Reacher) | `app/src/pool/checks.js` |
| Duplicates: auto-merge the same mailbox, list likely ones, merge safely | `app/src/pool/dedupe.js` |
| Daily upkeep at 03:30 (consent expiry, checks, duplicates, scores) | `app/src/pool/jobs.js` |
| Example people (add / remove) | `docker compose exec -T app node src/pool/demo-seed.js [--remove]` |

## Next
- Real code sending: add Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SID`) or WhatsApp Cloud API (`WA_TOKEN`, `WA_PHONE_ID`,
  `WA_OTP_TEMPLATE`) to `v2/.env`. Until then codes run in test mode and appear only in the app log.
- Meta lead ads: fetch the answers for each `leadgen_id` once a page token is connected.
- Public address for forms (Cloudflare tunnel) when the first client goes live.
