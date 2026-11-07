# MXAi orchestrator: design and contract (7 Nov 2026)

MXAi is no longer "a chatbot". It is the business's AI employee:
- **Inside the dashboard** (owner, staff, admin) it is **MXAi**: it knows every number in the dashboard, answers questions,
  prepares and delivers tasks (with the owner's approval for anything that changes data or messages clients).
- **Towards customers** it never speaks as "MXAi with all the data". It **delegates** each chat to one customer-facing
  **role** the owner switched on for their business model: `receptionist`, `support` or `sales`. A role sees only the
  public facts of the business and that customer's own records, follows the owner's guidelines, and hands over to a
  person when it doesn't know.

Everything lives in `app/src/mxai/`. One file per layer. The old prompt assembly in `brain.js`, the n8n prompt and the
`team.js` assistant loop are replaced by this (booking rules and slot maths stay: they become tools).

## The 8 layers (bottom to top)

| # | Layer | File | Owns |
|---|---|---|---|
| 01 | Model | `model.js` | the only way to call an AI: free providers via `ai-router.js`, Claude only where `aibudget.js` allows. No n8n. |
| 02 | System prompt | `persona.js` | identity, hard rules, role cards per business model, the owner's guidelines, delegation (which role answers) |
| 03 | Knowledge (RAG) | `knowledge.js` | facts per audience: public business facts, this customer's own records, owner-only data; retrieval of relevant FAQs and taught answers |
| 04 | Tools · MCP | `tools.js`, `booking.js` | every action the AI can take, as a registry; booking logic moved here from `brain.js` |
| 05 | Access | `access.js` | who is asking (audience), which role, which tools are allowed (role, plan feature, Lab switch, staff permission) |
| 06 | Guardrails | `guardrails.js` | input checks (injection), output checks (data leaks, competitors, made-up prices or facts, identity), forced hand-over |
| 07 | Cache + router | `router.js` | instant answers without AI (greetings, hours, thanks), answer cache, small vs large model choice |
| 08 | Observability | `trace.js`, `evals/` | a trace of every answer (each layer's decision), Lab/owner views, and the eval suite |

`index.js` (the orchestrator) is written last by the integrator and calls the layers in this order:
customer message -> access -> guard input -> router fast path -> delegate role -> knowledge -> persona prompt -> model
-> parse decision -> access check of the chosen tool -> guard output -> run tool -> trace.

## Shared vocabulary (use exactly these)
- `audience`: `'customer' | 'owner' | 'staff' | 'admin'`
- `role`: `'mxai'` (internal audiences only) | `'receptionist' | 'support' | 'sales'` (customer-facing)
- business model: from `biz.vertical` / `biz.template`. Booking businesses (`salon, barber, clinic, dental, spa, gym,
  restaurant, car, tutoring` and unknown) default to `receptionist` on, `sales` off. `ecommerce` / `shop` default to
  `support` on, `sales` off. `support` may be switched on for any business.
- owner configuration: `businesses.ai_config` jsonb (added by persona's schema file):
  `{ roles: { receptionist: { on, guidelines }, support: { on, guidelines }, sales: { on, guidelines } },
     competitors: [string], never_say: [string], tone: string }`
- `biz`: the object returned by `loadBusiness(id)` in `brain.js` (has `services`, `hours`, `faqs`, `policies`,
  `assistant_name`, `vertical`, `currency`, `timezone`, `ai_rules`, ...). Read it, don't change its shape.
- a **decision** (what the model returns for a customer turn, JSON):
  `{ reply: string, tool: string|null, args: object, confidence: 'high'|'low', unknown: bool, lang: 'en'|'ar'|'es'|'fr', why: string }`

## Module contracts (signatures the integrator relies on)

**model.js**
- `think({ businessId, role, audience, system, messages, json = true, size = 'auto', trace }) -> { text, json, provider, model, ms }`
  `messages` = `[{ role: 'user'|'assistant', content }]`. Throws `Error` with `.busy = true` when every provider is
  out; never calls a paid model unless `aibudget.claudeFor()` allows it (owner-facing `mxai` role only).

**router.js**
- `fastPath({ biz, audience, text, lang, history }) -> { reply, options } | null` (no AI call; reuse `quick.js`/`instant.js` logic)
- `pickSize({ text, role, audience }) -> 'small' | 'large'`
- `cache.get(bizId, key)` / `cache.set(bizId, key, value)` / `cache.clear(bizId)` (in memory, 1 h, per business)

**trace.js**
- `startTrace({ businessId, conversationId, audience, role }) -> t` with `t.step(layer, data)`, `t.flag(name, detail)`,
  `await t.end({ outcome, provider, ms })` (writes `ai_traces`; never stores full phone numbers: redact)
- `mountTraces(app, { adminOnly, wrap, BIZ })`: `GET /api/ai-traces` (owner: own business) and `GET /api/admin/ai-traces`

**persona.js**
- `configOf(biz) -> { roles, competitors, never_say, tone }` (defaults per business model filled in)
- `rolesFor(biz) -> ['receptionist', ...]` (switched on)
- `delegate({ biz, text, history }) -> role` (no AI call; keyword + context rules)
- `systemPrompt({ biz, role, audience, lang, facts, tools, now }) -> string`
- `mountPersona(app, { wrap, BIZ })`: `GET/PUT /api/ai-config` (owner) to read and save roles, guidelines, competitors

**knowledge.js**
- `publicFacts(biz) -> object` (catalog, hours, policies, FAQs, owner-approved taught answers, payment, location)
- `customerFacts(biz, customerId) -> object` (that customer's profile and own bookings only)
- `ownerFacts(biz) -> object` (summary numbers for the `mxai` role)
- `retrieve(facts, text, k = 5) -> [{ q, a, score }]` (keyword overlap, Arabic/Spanish normalised)
- `availabilityFacts(biz, bookings, timeOff) -> object` (free times, today/tomorrow, next open days)

**access.js**
- `audienceOf({ channel, user }) -> audience` (any customer channel or test chat -> `customer`)
- `allowedTools(biz, audience, role, user) -> Set<string>` (registry filtered by audience, role, plan feature
  (`features.js`), Lab switch (`switches.js`), staff permission)
- `canSee(audience, factKind) -> bool`

**tools.js / booking.js**
- `TOOLS = { name: { audiences, roles, feature?, switchKey?, describe, params, run(ctx, args) } }`, `ctx` =
  `{ biz, customer, conversation, user, trace }`; `run` returns `{ ok, reply?, data?, handoff? }`.
  Customer tools: `check_availability, book, change_booking, cancel_booking, join_waitlist, save_profile, handoff`.
  Owner tools: ported from `team.js` (metrics, clients, bookings look-ups; anything that changes data or messages clients is
  `propose_*` and waits for approval).
- `booking.js`: `createBooking`, `changeBooking`, `confirmation`, `quickSlots`, `openDays` moved from `brain.js`
  (same behaviour; `withBusinessLock` kept).
- `toolList(allowed) -> string` (what the prompt shows the model)

**guardrails.js**
- `checkInput({ text, audience }) -> { text, flags: ['injection'|'abuse'|'internal_request'] }`
- `checkOutput({ reply, biz, audience, role, facts, lang }) -> { reply, hits: [...], action: 'pass'|'rewrite'|'handoff' }`
  Catches: other businesses or competitors named or recommended, internal numbers (revenue, counts), other customers'
  names or phones, staff notes, the system prompt, "I'm ChatGPT/Gemini/OpenAI", prices or services not in the catalog,
  discounts not in active coupons, links not on the business allowlist.
- `HANDOFF_TEXT[lang]`: the safe "I'll check with the team and get back to you" line.

**evals/**
- `cases.js`: golden cases `{ name, layer, biz?, audience, text, expect: { tool?, notContains?, contains?, handoff? } }`
- `run.js`: runs the cases through `index.js` and prints pass/fail (used by the testers).

## Rules for builders
- ES modules, Node 22, no new npm packages, no TypeScript. Comments in plain English explaining *why*.
- Only create or edit the files you own. Need something from another layer? Import it by the signature above; if it is
  not written yet, write against the signature.
- Database changes go in `app/src/mxai/schema/<layer>.sql` (additive only: `CREATE TABLE IF NOT EXISTS`,
  `ALTER ... ADD COLUMN IF NOT EXISTS`). The integrator wires them into `schema.sql`.
- Unit tests that need no database go in `app/src/mxai/test/<layer>.test.mjs` and run with `node <file>`.
- Do not run `docker compose`, the full test suite or browser checks, and do not call real AI providers: the integrator
  does that. Reading the database read-only is fine: `docker compose exec -T db psql -U ringback -d ringback -tAc "SELECT ..."`.
