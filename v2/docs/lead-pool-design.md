# MXAi v2 — Lead pool, B2C engine and country rules (design, for approval)

Draft 1 · 2026-11-07 · based on the research saved in `country-rules.md` and the lead-pool/enrichment research of the same day.

## 1. The goal
A worldwide, **consented** pool of B2C leads that grows with every person who raises their hand through MXAi, enriched with every detail
that is legal to keep, filterable (country, city, language, stated gender and age range, interest, budget, timing, consent scope),
and reusable for clients **only within what each person agreed to**. A per-country rules layer decides automatically what is allowed.

## 2. Where leads come from (all with consent)
| Source | How it enters | Consent proof |
|---|---|---|
| MXAi forms and quizzes (built into v2, embeddable on any client site or landing page) | form submit | MXAi certificate: exact consent text + version, page hash, time, IP, user agent, UTM/click ids, named buyers, optional session replay (rrweb, MIT) |
| Meta Lead Ads | webhook → fetch answers by `leadgen_id` | Meta form's consent questions + form id |
| Google lead forms | webhook (checked with `google_key`) | Google form consent fields |
| Click-to-WhatsApp ads | first WhatsApp message (`referral`, `ctwa_clid`) | the person messaged first; marketing needs an explicit opt-in step in the chat |
| Website chat / WhatsApp / Instagram (MXAi receptionist) | conversation | opt-in question in the chat, recorded |
| Referrals | referral link | the referred person's own opt-in |
| Client's existing customers | import | only with the client's documented consent for each person |

Real-lead checks: WhatsApp/SMS one-time code (phase B), bot filter (ALTCHA, MIT, self-hosted), phone and email normalisation (libphonenumber-js).

## 3. The data model (Postgres, v2 database)
- `persons` (id, country, language, created_at)
- `identities` (person, kind: email | phone | wa_id | ig_id, normalised value, hash, verified_at)
- `attributes` (person, key, value, **source, confidence, consent_id**, observed_at, expires_at). E.g. age_range=25-34 (stated in form, confidence 1.0)
- `interests` (person, vertical, intent, budget band, timing, score, expires_at)
- `consents` (person, channel, purpose, **named buyers**, text version, jurisdiction, certificate hash, replay ref, ip, user agent, captured_at, expires_at, withdrawn_at)
- `events` (person, type, source, UTM, gclid/fbclid/ctwa_clid, payload)
- `deliveries` (lead, buyer client, price, exclusive?, consent used)
- `suppressions` (hash, reason, scope: global / client / channel)
- `country_rules` (country, channel → OK / OPT-OUT / CONSENT / RESTRICTED, registry needed, quiet hours, frequency cap, consent expiry, labels)
- `rule_log` (which rule allowed or blocked each message)

## 4. What may be stored
- **Everywhere:** contacts the person entered, country/city (stated or from IP), language, source and click ids, consent records,
  stated interest/budget/timing, bookings, opt-outs.
- **Only with consent (or a licence where legal):** age range and gender **as the person states them**, US demographic appends
  (internal use), conversation-based profiling, sharing with a named buyer, phone/SMS/WhatsApp marketing.
- **Never:** health conditions (a clinic *service* interest is fine, a diagnosis is not), religion, ethnicity, sexuality, politics,
  children's data, gender or age **guessed** from a name or photo, scraped profiles of private people, precise location trails,
  broker data for credit/insurance/jobs/housing decisions.

## 5. Enrichment (legal)
1. What the person tells us (forms, quiz answers, chat answers extracted by the AI with their consent).
2. Derived, low-risk: country/city from IP (MaxMind GeoLite2, attribution), language, email validity (Reacher, MIT, installed),
   phone line type (Twilio Lookup, ~$0.008, phase B).
3. Behaviour: source, campaign, pages, bookings, replies.
4. US only, later: licensed appends (Versium, Melissa) for internal use, with written pass-through terms before sharing.

## 6. Using the pool
- **Filter screen:** country, city, language, stated gender/age range, interest, budget, timing, freshness, source, consent scope,
  channels allowed now (the rules layer answers this per person).
- **Default owner:** a lead belongs to the client whose channel captured it.
- **Sharing to other clients:** only when the person named that buyer (or a frozen partner list in the US). Each delivery is logged with the consent used.
- **Later:** ping-post distribution (buyers bid on an anonymised preview; winner gets the lead after a consent check).

## 7. Country rules layer
Seeded from `country-rules.md`. Every outgoing message checks, in order: consent valid for this channel, buyer and purpose → not
withdrawn or expired → not on the suppression list or the country's do-not-call registry → inside quiet hours and frequency caps →
sender rules (Spain 400 prefix, India DLT, Saudi sender ids) → AI disclosure and labels. Each decision is written to `rule_log`.
**Default:** B2C outbound off everywhere; replies to a person who wrote first are always allowed.

## 8. Phases
- **A — BUILT 2026-11-07, $0/month:** data model, MXAi consent certificate, own forms and quizzes, Meta/Google/WhatsApp lead webhooks, the pool
  filter screen, country rules table with the decision check, global suppression and opt-out in any language, tests.
- **B — BUILT 2026-11-07, $0/month by default:** one-time codes after a form (WhatsApp or SMS; Twilio Verify or WhatsApp Cloud API when keys
  are added, test mode otherwise), free phone line type from libphonenumber (Twilio Lookup opt-in with `TWILIO_LOOKUP=1`), texts and WhatsApp
  blocked to landlines, email checks with Reacher, duplicates (same mailbox merged automatically; similar name + shared clue listed for review,
  pg_trgm in Postgres; Splink kept for big imports), consent certificates still valid after a merge (`signed_person_id`), daily upkeep at 03:30
  (consent expiry by date and country, unconfirmed double opt-ins closed, old codes deleted, checks, duplicates, scores), Data care tab.
- **C — US:** TrustedForm certificates on US forms (~$0.15 each), licensed appends, data broker registration if MXAi sells data about
  people who are not its own customers (California DROP checks every 45 days).
- **D — scale:** ping-post marketplace.

## 9. Decisions needed
1. First launch countries (research ranking: UK, Australia, USA, UAE, Canada, Singapore, Spain, Netherlands).
2. First B2C verticals (e.g. aesthetics and clinics, real estate, education, home services).
3. Approve phase A.
