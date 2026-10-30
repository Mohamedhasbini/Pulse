# MXAi · 360° audit and improvement plan (30 Oct 2026)

Scope: the Dashboard, the Lab, the Website, the receptionist brain and the delivery stack (Node 22 + Express 4 + Postgres 16 in Docker).
Method: code read of every server module, real measurements on the running app (browser timings signed in on Beauty S1, a
concurrency probe at 20–50 parallel requests, Postgres statistics and plans), then fixes applied and re-measured.

## 1 · What was measured

| Measure (signed in, Today page) | Before | After the fixes below |
|---|---|---|
| Requests on one page load | 114 (53 of them `/api/*`) | 104 (39 `/api/*`) |
| Same API called more than once in a load | `/api/stats` ×4, `/api/live` ×5, `/api/business` ×4, `/api/notifications` ×4 … | only the 60 s pollers repeat |
| Bytes a new browser downloads | 1.95 MB, uncompressed, re-validated on every visit | ~0.6 MB Brotli, then **0 bytes** (assets cached a year, keyed by content hash) |
| `charts.js` on the wire | 58 KB | 19 KB |
| Static file, 20 parallel (p50 / p95) | 43 / 46 ms | 14 / 19 ms |
| `/api/stats`, 20 parallel (p50 / p95) | 381 / 433 ms | 247 / 364 ms |
| Public pages at 50 parallel | `/login` p95 61 ms, `/health` 2,700 req/s | unchanged (already fine) |
| DB lookups per asset request | 1 (`users` row every time) | 0 for 10 s per signed-in user |
| Foreign keys without an index | 22 | 12 (the 10 on hot paths added) |
| Security headers | HSTS, X-Frame, nosniff, Referrer, Permissions | + Content-Security-Policy on the app pages |
| Test suites (no AI calls) | — | isolation 24/24, metrics 3/3, websites 28/28 pass |

Container at rest: app 41 MB RAM, 0.15 % CPU. Postgres: 128 MB shared buffers, 1,529 messages, 223 conversations: everything is
sequential scans today, so the indexes are for tomorrow, not for speed now.

## 2 · Critical fixes (done today, all zero cost)

1. **Compression** ([app/src/web.js](../app/src/web.js) `compress`): Brotli or gzip for HTML, JSON, JS, CSS and SVG, from Node's own zlib.
   Streams (`/api/events`) and tiny answers are left alone. Dashboard payload −65 %.
2. **Fingerprinted assets** (`fingerprint`): `index.html` is served with every local script and stylesheet rewritten to
   `?v=<content hash>`; such requests get `Cache-Control: immutable` for a year, anything else `no-cache`. The manual `?v=N` bumps
   in `index.html` are no longer needed (they're harmless and get replaced on the way out).
3. **Signed-in user cache** (`rememberUser / recallUser / forgetUser`): the `users` row is kept for 10 s; every place that bumps
   `session_version` (password change, sign out everywhere, admin disable/reset/delete) forgets it at once, so revocation stays instant.
4. **One network layer in the browser** ([app/public/js/net.js](../app/public/js/net.js), loaded first): identical GET `/api` calls
   in flight share one request and an answer lives 1.5 s; any POST/PUT/DELETE empties it. Panels that asked for the same data
   independently now cost one request. Streams and the public API are excluded.
5. **Content-Security-Policy** on `/`, `/index.html` and `/login`: scripts only from the app and cdnjs (QR library), styles from the
   app and Google Fonts, connections only to the app, no plugins, no foreign base URL, frames only from our own pages.
   Verified: fonts, QR library, Three.js module, service worker and all 51 sub-tabs load with no violation.
6. **Indexes** ([app/src/schema.sql](../app/src/schema.sql) tail): `messages(conversation_id,id)`, `messages(created_at)`,
   `bookings(customer_id,starts_at)`, `bookings(service_id)`, `bookings(conversation_id)`, `bookings(business_id,created_at)`,
   `conversations(customer_id,…)`, `conversations(business_id,updated_at)`, `services(business_id)`, `users(business_id)`.
   Every chat turn reads a conversation's history and a client's bookings; these keep that O(log n) when tables reach millions.
7. **AI provider switch** ([app/src/ai-router.js](../app/src/ai-router.js)): Anthropic is now a route (Messages API over fetch, no SDK
   needed) and `AI_PRIMARY=<route>` puts one provider first. With `AI_PRIMARY=anthropic` and `ANTHROPIC_API_KEY` set, the receptionist
   skips the n8n workflow and asks Claude directly, with every free provider still behind it as a fallback. Paid providers never
   answer as a silent fallback: only when chosen. Nothing changes until you set the variable (documented in `.env.example`).

## 3 · Findings still open, ranked

### A · Zero cost, do next (1–3 days each)

| # | Finding | Why it matters | Fix |
|---|---|---|---|
| A1 | `withBusinessLock` is an in-process `Map` ([db.js](../app/src/db.js)) | The moment a second app container runs (or PREVIEW_ONLY plus live), two bookings can land in the same slot | Replace with `pg_advisory_xact_lock(hashtext('biz:'||id))` inside one transaction, the way `takeAiSlot` already does |
| A2 | Login attempt counter and the user cache live in process memory | Same multi-instance gap; also lost on restart | Keep as is for one instance; move to a `rate_limits` table (or Postgres `UNLOGGED` table) when a second instance appears |
| A3 | `/api/stats` and `/api/live` run 12–15 queries each, serially | p50 250–380 ms under load; the Today page calls both | Run the independent queries with `Promise.all` (same connection pool, ~3× faster), then one `WITH` statement per endpoint |
| A4 | 51 script tags, no bundle; 9 stylesheets, 3,894 rules, 1,370 `!important` | Each new design pass stacks another override file; parse cost grows; hard to reason about | One `esbuild` step (free) producing `app.js` and `app.css` with source maps; then retire `pulse.css` (254 KB, 850 `!important`) section by section into `pulse-v6.css` |
| A5 | Every page polls on its own timer (60 s, 30 s, 5 min) even though `/api/events` already pushes changes | Wasted queries, numbers that disagree for a minute | Pollers subscribe to the SSE `change` event (`kinds`) and refresh only what changed; keep one 5-min safety poll |
| A6 | `/api/conversations/:id/messages` and friends scope by business inside the handler | Correct today (isolation tests pass), but every new route must remember | A `biz(req)` helper that joins `business_id=$1` for `:id` routes, and the isolation test extended to every `:id` route automatically |
| A7 | No request log, no error budget | You learn about a broken tab from a client | 20 lines: log method, path, status, ms, business to stdout as JSON; `docker logs` becomes a dashboard |
| A8 | `chip3d.js` + `vendor/three.module.min.js` (670 KB) still shipped; `listfit.js` retired but present | Dead weight in the image | Delete `chip3d.js`, `listfit.js`; keep Three only if `scene.js` stays (it is 3 KB of glue, Three is 670 KB: consider a CSS-only scene) |
| A9 | Fonts from Google (4 families, 215 KB, third-party) | Render-blocking on first visit, privacy footnote for EU clients | Self-host the two used weights of Geist and Instrument Serif as woff2 under `/fonts` (free licences) |
| A10 | Phone layouts of Studio, My view and the newer Insights sub-tabs unverified | Owners check the Dashboard from the salon floor | One pass at 375 px with the `mobile.js` bottom bar; fix wraps and horizontal scroll |

### B · Keep the infrastructure upgradable (design now, pay later)

| # | Principle | Where we stand | Next step |
|---|---|---|---|
| B1 | **One AI contract, many providers** | Done today: `complete(prompt, {json, business})` + `AI_PRIMARY`. The receptionist still sends one flat prompt string | Split into `{system, messages, tools}` so Claude gets a real system prompt, prompt caching (the 5.4 KB rules + business context are identical turn to turn) and tool use for `book / cancel / handoff` instead of JSON-in-text. Keep the flat form for the OpenAI-style free providers |
| B2 | **Per-business model choice** | `credentials(B, provider)` already lets a business bring its own key | Add `businesses.ai_provider` so a premium plan can run on Claude while free plans stay on free tiers: a pricing lever |
| B3 | **Stateless app** | State in process: locks (A1), login attempts (A2), SSE client sets (fine: Postgres NOTIFY already fans out across instances), AI queue (in Postgres: good) | After A1/A2 the app can scale to N containers behind Caddy with no code change |
| B4 | **Schema as migrations** | `schema.sql` is idempotent `IF NOT EXISTS`, runs on boot | Fine until the first destructive change; then a `migrations/` folder with numbered files and a `schema_version` table (no library needed) |
| B5 | **Tests before release** | 6 suites exist, run by hand | A `pre-commit` hook or GitHub Action running `isolation`, `metrics`, `site` (no AI calls, ~20 s) on every push: free |
| B6 | **Observability hooks** | `aiHealth`, `routerStatus()`, `/api/admin/health` exist | Expose them as one `/metrics` text endpoint (Prometheus format, 30 lines) so any free Grafana Cloud tier can graph them later |
| B7 | **Events, not polling** | SSE in place | Make `emit(kind, payload)` the single source: dashboards, Telegram alerts, future webhooks for clients (`/api/public` already has API keys) all subscribe to it |

### C · UI/UX blueprint (what a judge would still flag)

- **Hierarchy**: 24 running animations and 6,350 DOM nodes on Today. Keep motion for state changes (a booking landing, a chat turning
  to Needs you); make ambient motion (glows, waves) pause when the tab is hidden and respect `prefers-reduced-motion`.
- **Onboarding**: the "Getting started" list on Live is right; it should be the first thing a new owner sees on Today until the six
  items are done, then fold away. Time-to-value target: WhatsApp connected and first test chat answered in under 10 minutes.
- **Empty states**: new businesses see empty charts. Each chart needs its "what will appear here, and what to do now" line
  (the `pv-c` renderer can take an `empty` text).
- **Keyboard**: Ctrl+Shift+A exists; add `?` for a shortcut sheet, `/` to focus Ask, `g t / g i / g c` to jump pages (Linear-style).
- **Density switch**: Comfortable / Compact per user (Studio already stores per-user JSON).
- **Copy**: keep the formal register; run `better-writing` over Inbox and Settings labels once the structure is final.
- **Accessibility**: 39 `aria-label`s for ~120 icon buttons; charts are SVG without `<title>`; focus rings are hidden by the glass
  theme. One pass with `better-accessibility` gives WCAG 2.2 AA at near-zero design cost.

### D · Benchmark insights (what to borrow, not copy)

- **Linear**: command palette as the universal entry (we have Ask + shortcuts; merge them into one ⌘K with actions and navigation).
- **Stripe**: every number has a "how it's calculated" hover (we have `metrics.js` as the single definition: expose its comments as tooltips).
- **Vercel**: deploy-style timeline for "what the AI did today" (we have the feed; add a per-conversation decision trail: which provider,
  confidence, rule applied).
- **Supabase**: the table/SQL duality: Studio's Library tables could offer "copy as CSV" and a saved-view URL.
- **Raycast**: shortcut discoverability: show the key next to every action in menus.

### E · Flagship innovations (the "only MXAi" list)

1. **Decision trail per chat**: provider, confidence, rule, data used, and a one-click "teach" that creates the lesson. Honest AI you
   can audit: nobody else in the salon/clinic space shows it.
2. **Revenue forecast with and without the receptionist**: the Website already promises it; make the Insights forecast chart use real
   history (`bookings` by week) and the industry no-show and answer-rate deltas, with the assumptions listed.
3. **Studio as a marketplace**: owners publish a board layout; other owners install it. Zero backend beyond `users.studio` plus a
   `boards` table. It turns personalisation into retention and word-of-mouth.
4. **Owner's morning briefing on WhatsApp**: `briefing.js` exists in the Dashboard; send the same five lines to the owner's phone at
   opening time through the channel already connected. Daily habit = retention.
5. **AI off → human on, with assist**: when AI is off, the Inbox suggests a reply (drafted, not sent) so the owner answers in one tap.
   Same brain, new product surface, no new infrastructure.

## 3b · Weeks 1–3: done on 30 Oct 2026 (evening)

| Item | What changed | Proof |
|---|---|---|
| A1 booking lock | `withBusinessLock` now takes a Postgres advisory lock on its own connection ([db.js](../app/src/db.js)); covers every process | 5 simultaneous bookings of one slot → exactly 1 row |
| A3 parallel queries | `/api/stats` (14 queries) and `/api/live` (11 queries) run their independent queries with `Promise.all` | identical answers; metrics tests pass |
| A7 request log | one JSON line per `/api` request: method, path, status, ms, business, user; `slow:true` over 1 s or on 5xx ([web.js](../app/src/web.js) `requestLog`); `LOG_REQUESTS=0` turns it off | visible in `docker compose logs app` |
| A8 dead files | `chip3d.js`, `listfit.js` removed; Three.js kept for `scene.js` (670 KB, decision left open) | — |
| A5 push, not timers | the 5-second poller in `js/extras.js` and the 30 s / 60 s pollers only run when the live stream is down; a server change fires `mxai:change`, which empties the chart cache and redraws the open page; AI on/off is now pushed too | a PUT on AI mode produced one `mxai:change` on the open dashboard |
| C motion | all animations pause while the tab is hidden (`html.tab-hidden`); `prefers-reduced-motion` makes every animation and transition near-instant | — |
| A10 phone pass | at 375 px: tables scroll inside their card, Inbox panes stack, hero and overview strips never exceed the screen; swept all 51 sub-tabs | no element wider than the screen except one decorative hairline in Library |
| A4 one stylesheet | the 9 dashboard stylesheets are joined at boot into `/app.css?v=<hash>` served from memory with a year's cache; cascade order unchanged | 9 CSS requests → 1 |
| A4 scripts | **not bundled**: the 49 classic scripts share one global scope by design (`$`, `req`, `biz` in `js/core.js`), so a naïve join would let one file's error stop every file. They stay separate, Brotli'd and cached a year. The proper step is ES modules, planned with the Week 4 AI work. | — |
| A9 fonts | Geist, Geist Mono, Instrument Serif and Newsreader self-hosted under `/fonts` (47 subset files, browsers fetch only the subsets they use); Google Fonts link removed from Dashboard and sign-in; CSP no longer allows Google hosts | zero third-party requests except the QR library |

## 4 · Execution plan

| When | Items | Cost |
|---|---|---|
| Done today | §2: compression, fingerprinting, user cache, net layer, CSP, indexes, `AI_PRIMARY` + Anthropic route | 0 |
| Week 1 | A1 advisory locks · A3 parallel queries · A7 request log · A8 dead files · B5 test hook | 0 |
| Week 2 | A5 SSE-driven refresh · A10 phone pass · C empty states and reduced motion | 0 |
| Week 3 | A4 esbuild bundle and CSS consolidation (start with `pulse.css`) · A9 self-hosted fonts | 0 |
| Week 4 | B1 structured AI contract (system/messages/tools) · E1 decision trail (data already in `messages`) | 0 |
| When the first paying salon signs | Set `AI_PRIMARY=anthropic` for that business's plan (B2) · B6 metrics endpoint · E4 morning briefing | API usage only |
| At the second container | A2 shared rate limits · B4 migrations folder | 0 |

Everything in weeks 1–4 is code already in the repo being reorganised: no new services, no new monthly fees, in line with the
zero-cost stance until the first paying client.
