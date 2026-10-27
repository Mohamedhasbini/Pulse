# Pulse rebuild plan — audit, decision tree, master prompt

Date: 2026-10-27 · Status: DRAFT for approval · Nothing built yet

---

## 1. What I found (audit of the current code)

### Design layer — the main reason things feel messy
- `index.html` loads **10 stylesheets stacked on top of each other**: app → glossy → theme → compact → brand → exec → graphite → signature → alive → glass.
- They fight each other with **~455 `!important`** overrides (exec.css 181, glass.css 86, graphite.css 76, compact.css 49).
  Every new look was painted over the old one instead of replacing it. This is why a fix on one tab breaks another.
- The "glass background" today is a CSS-drawn gradient that imitates windows (`glass.css:26`), not a real ambient scene — so it can't reach the depth of the reel.
- `index.html` is 1,584 lines with most app logic inline; 19 separate UI scripts patch the DOM after load (`page-head.js`, `details.js`, `focus.js`, `signature.js`…) — the same "layer on top" pattern in JS.

### AI is split across 7 places with no single owner
| Surface | File | What it does |
|---|---|---|
| Teach AI (nav) | `coach.js` / `coach-ui.js` | Owner writes rules in plain words |
| Test chat (nav) | `index.html` demo view | Try the receptionist |
| Lab | `lab.js` / `lab-ui.js` | Suggested lessons, versions, scripted tests |
| Agents | `agents.js` / `agents-ui.js` | Data-only opportunity finders (no AI calls) |
| AI team dock | `team.js` / `team-dock.js` | 4 "employees" answering questions with tools |
| Approvals (Home sub) | `/api/ai-queue` | Proposed sends waiting for owner |
| Insights | `insights.js` | Charts + text |

Overlaps: Teach AI ↔ Lab lessons (both change the receptionist's rules); Agents ↔ AI team (both propose customer actions); Approvals ↔ Agents' "waiting to send" (same queue, two doors). The owner has to know which door to use.

### Navigation duplicates
- `overview` is used by 4 nav buttons (Home, Live, Conversations, Approvals); `people` by 2 (Customers, Offers). Sub-views hidden behind one view id = confusing back/active states and duplicated loading.

### Data
- Good: agents work on real data with no AI cost; team answers only from tool results (exact numbers); per-business lock in `db.js`.
- To verify in the build: same KPI computed in several places (Home, Insights, team tools, agents) — must come from **one metrics module** so numbers never disagree.

---

## 2. Decision tree (what we decide, in order)

```
1. Design foundation
   ├─ Keep patching 10 CSS layers?  → NO (root cause of breakage)
   └─ ONE token-based stylesheet (pulse.css) + 1 background layer  → YES
        ├─ Light mode: "Daylight lounge" — warm sunlit room behind frosted glass (the reel)
        └─ Dark mode: pick one ▼
             A. "Dusk lounge" — same room at golden hour/night, amber lamps, city lights through window (recommended: same scene = brand continuity)
             B. "Night city" — deep blue skyline bokeh, cool glass
             C. "Graphite plain" — no image, soft vignette (for low-power / accessibility; also the fallback)

2. Information architecture
   └─ 5 tabs max: Today · Inbox · Calendar · Customers · Pulse AI   (+ Settings in avatar menu)
        Rule: every tab opens on numbers/charts; text only after a click ("deep dive")

3. AI structure
   ├─ Keep 7 surfaces?            → NO
   ├─ Many named agents?          → only as "skills" inside one brain
   └─ ONE agent: "Pulse AI" (single owner, one chat, one approval queue)
        ├─ Ask    — answers anything from real data (today's team.js loop)
        ├─ Act    — finds opportunities + drafts sends (today's agents.js)
        ├─ Teach  — owner rules + suggested lessons merged (coach.js + lab.js)
        ├─ Test   — test chat + scripted lab runs in one place
        └─ Approve — the ONLY queue for anything that changes data or contacts a customer

4. Reliability
   └─ Every change must pass: test-all + visual check of every tab in light & dark + no console errors
```

---

## 3. Fix list (must) vs. improve list (should)

### Fix (stability & correctness)
1. Replace the 10 stylesheets with one `pulse.css` built on tokens; delete dead CSS. Target: **0 `!important`** outside a tiny reset.
2. Move inline logic out of `index.html` into modules; remove DOM-patching scripts whose job becomes the base markup.
3. One view per nav item (no shared `overview` ids); deep links work, back button works.
4. One metrics module → Home, Insights and Pulse AI read the same numbers.
5. One approval queue (merge `/api/ai-queue` + agent sends).
6. Merge Teach AI + Lab rules into one rules store with dedupe (`sameRule` already exists in `coach.js`).
7. Error boundaries: every card loads independently; a failing API shows "couldn't load · retry" in that card only — the page never goes blank.
8. Guard AI quota: keep receptionist and Pulse AI caps separate (already started in `team.js`), show usage in Settings.

### Improve (value above expectations)
- **Today** = 4 KPI glass tiles with sparklines (bookings, revenue saved, response time, AI-handled %), one main chart, a "next up" timeline, and 3 AI-suggested actions with one-tap approve.
- **Insights inside Pulse AI**: ask "why did Tuesday drop?" → answer + chart, not paragraphs.
- Weekly AI brief (auto) with 3 wins / 3 risks / 3 actions.
- Agent scorecard: what each skill found, sent, and earned (proves ROI to the owner = retention).
- Customer card: visit history chart, value, last mood, next best action.
- Quality score trend for the receptionist (from Lab) on Today.

---

## 4. Ambient background spec

- Real photographic scene, heavily blurred (backdrop 40–60px), one fixed layer behind everything, served as AVIF/WebP < 250 KB, with the plain gradient as fallback.
- Glass cards: `rgba(255,255,255,.55)` light / `rgba(20,18,16,.45)` dark, 1px inner rim highlight, 24px radius, soft long shadow.
- Accent: one blue (active bar / selected) like the reel, green for growth, amber for attention. No other colors in charts.
- Respect `prefers-reduced-transparency` → solid cards.
- Images: must be licensed (Unsplash/Pexels or generated) — not taken from the reel.

---

## 5. Master prompt (to run the build, phase by phase)

> You are rebuilding the Pulse dashboard front end and AI layer. Work in phases; each phase ends green before the next starts.
>
> **Non-negotiables:** one stylesheet on design tokens, no `!important` except reset; every tab works in light and dark; every card loads independently with its own error/retry state; numbers come only from `metrics.js`; nothing contacts a customer or changes data without passing through the single Approvals queue; `npm test` passes; no console errors on any tab.
>
> **Phase 1 – Foundation:** create `pulse.css` (tokens: ground image, glass, rim, text, accent, radius, shadow for light + dark) and the ambient background layer. Port Today first, compare screenshots light/dark, then port remaining tabs and delete the old 10 stylesheets.
> **Phase 2 – Structure:** nav = Today, Inbox, Calendar, Customers, Pulse AI (+ Settings). Split inline JS from `index.html` into one module per tab. Remove patch scripts that are no longer needed.
> **Phase 3 – Data:** build `metrics.js`; point Home, Insights and AI tools at it; add a test asserting the three agree.
> **Phase 4 – Pulse AI:** one agent with Ask / Act / Teach / Test / Approve. Merge coach + lab rules, agents + team proposals, ai-queue into one approvals table.
> **Phase 5 – Value:** KPI tiles with sparklines, weekly brief, agent scorecard, chart-first deep dives.
> **Phase 6 – Hardening:** run test-all, load-test, isolation-test; click through every tab at desktop + phone width in both themes; fix everything found.
>
> After each phase: list what changed, what was deleted, test output, and screenshots.

---

## 6. What I need from you to start
1. ✅ Decided 2026-10-27: **Light mode = Dusk lounge** (bright frosted glass over the dusk scene), **Dark mode = Graphite plain**.
2. OK to collapse nav to the 5 tabs above and merge all AI into one "Pulse AI".
3. OK to delete the old stylesheets once Phase 1 screenshots are approved.
