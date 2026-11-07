# MXAi control model: the Lab controls everything (7 November 2026)

What the founder asked for, turned into rules the system can enforce, then what already exists, what is missing
and the order to build it. Goes with `docs/business-model-2026-11-07.md` (pricing, hosting, billing).

## 1. The rule

> Nothing is on unless the Lab says so. Only the admin can switch things on, and every switch is recorded.

Every feature, channel, connector, API, AI model and MCP tool passes **three gates**, checked on the server on every
request (never only hidden in the screen):

| Gate | Who sets it | Example |
|---|---|---|
| **1. Platform switch** | Admin, in the Lab | "Instagram is off for everyone" (a kill switch if a provider breaks or misbehaves) |
| **2. Business authorisation** | Admin, in the Lab: the plan, then add-ons, then the admin's own on/off per business | "Glow Hair is on Pro + Website add-on; Shopify allowed for Glow only" |
| **3. Login permission** | The owner, only inside what gate 2 allows | "Receptionist staff can see Calendar but not Insights" |

On = gate 1 **and** gate 2 **and** gate 3. An owner can never give a staff member more than the business has, and a
business can never have more than the platform allows.

## 2. The three kinds of dashboard

| | Playground (test) | Client dashboard | Lab |
|---|---|---|---|
| Who | Admin only | One business's owner and staff | Admin only |
| Sees | Demo data | **Only that business's data** | Every business, every switch |
| Features | Everything, plus "view as Starter / Pro / Business" to see exactly what a client sees | Basic (Starter) by default; more only through plan, add-on or admin approval | All controls |
| Channels | Sandboxed: never messages real people | Live | — |
| Billing | Never billed | Plan + add-ons | Revenue, usage, costs |

Playgrounds are where you find what is missing: open one, switch it to "view as Starter", and use it as a client would.

## 3. AI: free by default, Claude when a client pays

**Decided 7 Nov: no paid AI fallback.** When free limits run out, MXAi moves to the next *free* provider only; it never
switches to a paid AI on its own. Claude is used only for a business you have switched it on for (below).

- **Every business starts on Gemini (free tier)** for the receptionist and the basic assistant.
- **When a client buys**, the admin switches on **Claude (Anthropic)** for that business's MXAi Assistant, using
  **MXAi's own Anthropic key**, with a **monthly budget per business** (e.g. $5) and a usage meter in the Lab.
  The client never sees or handles a key. Sold as an add-on ("AI Assistant Pro", e.g. $19/month) so it pays for itself.
- If the budget runs out, that business falls back to Gemini automatically and the Lab warns you.
- A client may bring their own key only if the admin allows it for that business.

**Important, check before the first Spanish client:** Google's terms for the free Gemini tier allow Google to use
the prompts to improve its products, and the free tier is not offered for users in the EU/EEA, UK and Switzerland
(paid only there). Client conversations contain their customers' personal data. So: free Gemini for playgrounds and
Lebanon trials; **paid Gemini (very cheap) or Claude for any paying client, and always for Spain.**

## 4. Connectors, APIs and MCP

- **One registry in the Lab** lists every connector (WhatsApp, Telegram, Instagram, Shopify, HubSpot…), every
  outside API (AI providers, email, maps) and every MCP server. Each has a platform switch (gate 1).
- **Per business** the admin allows which ones it may use (gate 2). The owner can connect only allowed ones, or the
  admin connects them for the client.
- **All keys are kept encrypted.** Platform keys are visible to nobody, not even in the Lab after saving (replace only).
- **MCP**: the MXAi Assistant gets only the MCP tools switched on for that business. Later, MXAi can offer its own
  MCP server so a client's Claude can read their dashboard. That is a Business-plan add-on, off by default.

## 5. Upgrades go through you

Owner sees a locked feature → presses **Request** → it lands in a Lab inbox → you **approve** (feature on, price
updated, client told) or decline. Recorded in the audit log. Self-serve upgrades come later, with Stripe.

## 6. What already exists and what is missing

| Already built (server-enforced) | Missing |
|---|---|
| Plans, add-ons and the admin's per-business on/off switches (`features.js`) | **Platform switches** (gate 1) for connectors, APIs and AI providers |
| Staff permissions per section, limited by the owner | **Connectors are not gated**: today any owner can connect any integration (`integrations.js`) |
| Each business's connected accounts stored encrypted | **MCP registry**: none yet |
| Claude for MXAi Assistant per business, AI router with backup models | **AI per business**: choice of model, monthly budget, usage meter |
| Audit log, admin 2-step sign-in, demo businesses (`is_demo`) | **Upgrade requests** and approvals in the Lab |
| Connector catalogue (`connectors.js`) | **Playground**: "view as plan", channels sandboxed |
| | Lab on its own address with a Cloudflare gate |

## 6b. Built on 7 November

- **AI Assistant Pro (Claude)**: an add-on ($19). Claude answers the MXAi Assistant only where it is switched on, on
  MXAi's own key, inside a monthly budget per business (default $5, set in Lab › Businesses). Every Claude answer is
  logged with real tokens and cost (`ai_spend`). Over budget it goes back to the free AI and your phone is told once.
- **Cost vs revenue**: Lab › HQ › Clients shows each client's AI cost this month and margin; a client that costs more
  than it pays is flagged, and the Running cost figure counts it.
- **Locked features with Request**: pages a plan doesn't include are greyed in the sidebar and open a card with
  "Request this upgrade". Requests wait in Lab › HQ › Upgrade requests; Approve adds the matching add-on (or switches
  the feature on) and notifies the owner.
- **Playgrounds**: in any business you open, "View as" (under Back to Lab) shows it as a Starter, Pro or Business owner
  would see it. Test businesses never send anything to real people (reminders, campaigns, agents, Inbox replies).

## 6c. Built on 7 November (later)

- **Lab › Controls**: on/off for every channel, connector and AI provider, for everyone or per business.
- **Separate doors**: the Lab at lab.nexfoyz.dev (admin only), dashboards at app.nexfoyz.dev (admin refused).
- **Support access** replaces Open business: read-only, 60 minutes, banner, reason to change, owner notified and
  sees every visit. Cloudflare Access gate: founder's step, see `docs/lab-access-2026-11-07.md`.

## 7. Build order

| Phase | What | Size |
|---|---|---|
| **1. Control core** | Platform switches; per-business allow-list for connectors, APIs and AI; gate the integrations routes; one **Lab › Controls** page with on/off for everything; tests that a switched-off item is refused on the server | 2–3 days |
| **2. Money paths** | Upgrade requests + approvals; AI per business (Gemini/Claude, budget, meter, fallback); plan defaults fixed ($79 bug) | 2 days |
| **3. Reach** | MCP registry for the assistant; playground "view as plan" + sandboxed channels; Lab on `lab.nexfoyz.dev` | 2–3 days |

## 8. How this fits the business model

- **Starter ("basic")**: AI front desk on one channel (Gemini), booking page, reminders, WeBook listing. Nothing else
  unless you approve it.
- **Pro / Business**: more channels and features, unlocked by plan.
- **Add-ons approved by you**: Own website, Extra staff, AI Assistant Pro (Claude), each connector pack
  (e.g. "Shopify + HubSpot"), MCP access.
- Because every switch is per business, you can run a **pilot** with anything switched on, then move the client to
  the plan they pay for without rebuilding anything.
- Suggestions:
  - Show the client what's **locked but available** (greyed, with Request). It sells upgrades without a sales call.
  - Track in the Lab, per business: AI cost vs price paid, so no client costs more than they pay.
  - Keep one "kill switch" page you can reach from your phone: if WhatsApp or an AI provider misbehaves, switch it
    off for everyone in one tap.
