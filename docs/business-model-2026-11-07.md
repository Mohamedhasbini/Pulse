# MXAi business model review, 7 November 2026

Plain-words review of where MXAi stands, what to change, and in what order. Prices for competitors and for
Meta/AI providers are approximate (from public price lists as of mid-2026); check them before quoting a client.

## 1. Where things stand (facts from the system today)

| | |
|---|---|
| Paying clients | 0. One test business (Beauty S1) and 4 demo businesses, all on "trial". |
| Plans in the Lab | Starter $29, Pro $59, Business $99, plus 6 add-ons ($9–$19). Same USD price in Lebanon and Spain. |
| Hosting | This PC, through the Cloudflare tunnel. Zero monthly cost. |
| AI | Free tiers (Gemini, Groq, OpenRouter) through the AI router. |
| Product | Ready for salons and beauty: AI front desk on WhatsApp, Telegram, Instagram, web chat and WeBook; dashboard; Lab; client websites. Gym, clinic and restaurant demos exist. |

**What went wrong today:** sign-in "failed" because the PC had restarted and nothing starts on its own any more
(Docker and the tunnel startup tasks are switched off). The app, the AI replies and every client website were offline
until they were started by hand. With a paying salon, that is an outage at their front desk. This is the clearest
argument in this review: **the product is ready before the hosting is.**

Two small data issues found while reviewing:
- Each business's price field defaults to **$79**, which matches no plan (Pro is $59). Fix when pricing is decided.
- The gym demo is called "Pulse Fitness Club" (Pulse is the retired brand).

## 2. The Lab: keep it in the same app, give it its own front door

**How it works today**
- One app, one database, one sign-in page. An `admin` login lands in the Lab; owners land in their own dashboard.
  The admin can open any business from the Lab (every switch is in the audit log). The admin account has 2-step sign-in.
- The Lab is **already separate from client websites.** Client websites (`<name>.nexfoyz.dev`) are public pages with
  no sign-in and no route into the Lab or any dashboard.
- What is *not* separate: the Lab and the owners' dashboards share the same address (`app.nexfoyz.dev`) and the same
  sign-in page. Anyone who finds the admin email can try to sign in where every client signs in.

**Options**

| Option | What it means | Verdict |
|---|---|---|
| A. Leave as is | Lab behind the same sign-in as clients | Works, but the most powerful login sits on the most public page |
| **B. Same app, own address** | `lab.nexfoyz.dev` is the only place an admin can sign in; `app.nexfoyz.dev` refuses admin logins; a free Cloudflare Access gate (your Google account) in front of the Lab address, so the page doesn't even load for anyone else | **Recommended.** Small job, zero cost, the standard way SaaS companies protect their control panel |
| C. Separate Lab app | A second program and database for the Lab | Not worth it now: two things to update and keep in sync, and the Lab has to read client data anyway |

Option B is about a day of work: a host check in the server, sign-in cookies tied to each address, one tunnel line,
one DNS record and tests. Later, when you hire support staff, add a `support` role that can view but not change.

## 3. Business model: what to keep, what to change

### 3.1 Sell one thing, build the platform underneath
The vision (dashboards for any business from connectors and templates) stays: it is how the code is built. But
**sell one vertical at a time**, only where there is a working demo and a reference client:

1. **Salons and beauty**: product ready, demos ready. Sell now.
2. **Skin and aesthetic clinics**: same booking pattern, higher prices, more willing to pay. Next.
3. **Gyms**: demo exists; memberships and classes make it a different sale. Third.
4. **E-commerce, ads manager, social media**: park until 10 salons pay. Different buyers and much bigger competitors
   (Shopify apps, Meta's own tools).

**One-line promise:** *"Every WhatsApp and Instagram message answered and booked in seconds, day and night. You see
every booking and every client in one place."* Sell the result (bookings you would have missed), not the dashboard.

### 3.2 Who to sell to first
Owner-run salons with 2–10 staff that get many WhatsApp and Instagram messages and miss them after hours or when busy.
Stick to **one area per country** (Beirut and Mount Lebanon; one Spanish city where you have contacts). Clients close
together give you referrals, case studies the next salon recognises, and later a WeBook marketplace that isn't empty.

### 3.3 Pricing: simpler, by country, with a usage allowance
Problems now: three plans plus six add-ons is too much to explain at a first meeting. The plans charge for extras but
not for what actually costs money (AI conversations, paid WhatsApp messages). And one USD price for Lebanon and Spain
is either too high for Beirut or too low for Spain.

Proposed (for your decision):

| | Lebanon (USD/month) | Spain (EUR/month, + VAT) | Includes |
|---|---|---|---|
| **Starter** | $29 | €39 | AI front desk on 1 channel, booking page, reminders, WeBook listing, up to 300 AI conversations |
| **Pro** | $59 | €79 | All channels, Teach AI, discount codes, Insights, up to 1,000 AI conversations |
| **Business** | $99 | €149 | Everything: marketing, staff logins, own website, no MXAi branding, up to 3,000 AI conversations |

- Keep only two add-ons at launch: **Own website** and **Extra staff logins**. Hide the rest inside the plans.
- **Marketing messages** (WhatsApp promotions) are charged by Meta per message: pass them on at cost plus a margin.
- **Setup fee**: $99 Lebanon / €149 Spain, one-time, for doing the setup for them. Waived for founding clients.
- **Yearly payment**: 2 months free (better cash flow, less churn).
- **Founding offer**: the first 10 clients per country get 50% off for 12 months, in exchange for a testimonial,
  a case study and permission to use anonymised numbers.

**Later income, from the 4 Nov growth plan (`design/mxai-growth-plan.html`)**, once the basics sell:
- **Payments**: a small cut (0.5–1% on top of the provider's fee) once deposits and card payments exist. This is the
  main income for the big booking apps.
- **WeBook pays per result**: charge only for a client's *first* booking that came through the marketplace.
- **Free import** from Fresha, Booksy and spreadsheets to win businesses that want to switch.
- **Price per location**, not per staff member, so growing salons don't feel punished.

For reference, salon booking software in Spain typically costs €30–€100 a month and WhatsApp AI/inbox tools
€50–€150. MXAi combines both, so €79 for Pro is fair. In Lebanon, $29–$59 sits where small businesses already pay
for software.

### 3.4 What one client costs you (estimates)

| Cost | Per client per month |
|---|---|
| AI (paid tier, if free limits run out): ~1,000 conversations | about $3–$10 |
| WhatsApp: replies to messages the client started | free |
| WhatsApp: reminders/promotions sent outside the 24-hour window | a few cents each, depends on country |
| Server (once moved off the PC), shared by the first ~50 clients | under $0.50 |
| Card fees (Spain, Stripe) | about 1.5% + €0.25 |

At Pro prices that leaves **85–90% gross margin**. The real cost is your setup and support time, so the setup fee
and a short "done for you" setup are what make the numbers work.

### 3.5 Getting paid: Lebanon needs a different route
**Stripe does not support businesses in Lebanon.** Plan two billing routes:
- **Spain**: Stripe subscriptions. Needs an entity Stripe accepts (a Spanish autónomo/SL, or another EU or US
  company). Spanish VAT (21%) applies.
- **Lebanon**: monthly invoice from the Lab, paid by Whish Money, OMT, bank transfer or cash, with the Lab marking
  "paid until". The plan status field already exists (trial / active); it needs a "paid until" date and a reminder.

### 3.6 Selling and keeping clients
- **Founder-led sales for the first 20.** List 50 salons per area. Show the live demo on your phone, set up their
  WhatsApp in 30 minutes, and have a call at day 10 of the 14-day trial.
- **Weekly owner report on WhatsApp** (the main thing that keeps clients): *"This week MXAi answered 143 messages and
  booked 22 appointments worth $640."* The numbers already exist in `metrics.js`; it needs the message.
- **Referrals**: one month free for both salons.
- **Partners** who already visit salons (beauty product distributors, Instagram marketing agencies): 20–30% of the
  monthly fee for as long as the client stays.
- **WeBook marketplace**: keep it as a free listing perk. Don't advertise it to the public until ~30 businesses are
  listed in one city.

### 3.7 Numbers to watch (add to the Lab)
Monthly recurring revenue, paying businesses, trial → paid %, **activation** (first AI booking within 7 days),
share of messages handled by the AI, booking value the AI brought in, monthly churn, support hours per client.
The Lab already shows usage and health; monthly revenue and activation are missing.

## 4. Infrastructure: staged, never risking the live app

| Stage | When | What | Cost |
|---|---|---|---|
| **0. Now** | today | PC hosting. `start-mxai.cmd` starts everything (Docker, n8n, tunnel, home page). Optional: turn auto-start back on at Windows sign-in. Free uptime alert to your phone. Off-site copy of backups (free cloud storage). Lab on its own address. | €0 |
| **1. First pilot or payment** | first signed client | One small EU server (~€5–€8/month), built and tested on its own link **before** touching the live domain, then switch. The PC stays as a backup. Files are ready: `docker-compose.prod.yml`, `SETUP-GUIDE.md`. | ~€6/month |
| **2. ~20 clients** | | Paid AI tier with a spending cap, automatic off-site database backups, a staging copy for testing. | ~€30–€60/month |

## 5. Rules and risks

- **WhatsApp policy**: since January 2026 Meta doesn't allow general-purpose AI chatbots on the WhatsApp Business
  platform. Assistants for a specific business (bookings, questions about the business) are allowed. MXAi's assistant
  is business-specific; keep it that way and keep the hand-over to a human.
- **EU AI Act** (in force for this since August 2026): people must be told they are talking to an AI. Today the assistant
  says it is a virtual assistant **only when asked** (`app/src/prompts/receptionist.txt`). Change the first reply of
  every new chat to say it (e.g. "I'm Nora, Glow's AI assistant"), then re-export the n8n prompt.
- **GDPR (Spain)**: MXAi processes the salon's client data, so each salon signs a data processing agreement. Keep the
  data in the EU (stage 1 server in the EU).
- **Spanish e-invoicing (Verifactu)**: start dates were pushed back to 2027. Ask a gestor before invoicing in Spain.
- **One person, one PC**: today's outage shows it. Stage 1 fixes the PC; written guides (CLAUDE.md, SETUP-GUIDE.md)
  reduce the person risk.
- **Free AI limits**: fine for demos, risky for paying clients. The AI router already falls back between providers;
  budget a paid fallback from the first payment.

## 6. Decisions for you

1. Move the Lab to its own address (`lab.nexfoyz.dev`) with the extra Cloudflare gate. *Recommended, can be done now.*
2. Turn auto-start back on (Docker and the tunnel start when you sign in to Windows), or keep using `start-mxai.cmd`.
3. Approve the pricing by country in 3.3, then the $79 default gets fixed to match.
4. Pick the Spanish city.
5. Agree the trigger for moving to a server: the first signed pilot.

## 7. The next 90 days

| Weeks | Do |
|---|---|
| 1–2 | Lab on its own address. Auto-start or start file, uptime alert, off-site backups. Pricing in the Lab. Weekly owner report on WhatsApp. AI disclosure in the greeting. |
| 3–6 | 10 founding salons in Beirut on a done-for-you pilot. Measure activation and AI bookings per week. |
| 7–12 | Server move at the first payment. Lebanon billing (invoice + "paid until"). Start in the Spanish city with Stripe. First case study on the website. |
