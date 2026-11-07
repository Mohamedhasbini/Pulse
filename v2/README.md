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

## Next (designed, not built yet)
- B2C engine: consented "hand-raiser" leads (ads, forms, WhatsApp, content, referrals) with AI qualification and booking.
- Lead pool: a consented, filterable database of B2C leads per country.
- Country rules layer: which channels and data each country allows.
