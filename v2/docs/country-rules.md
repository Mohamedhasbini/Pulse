# Country rules for lead generation (research of 2026-11-07)

Source for MXAi v2's country rules layer. Not legal advice: ⚠ = unverified or sources disagree. Before launching in a country,
store a local legal opinion and a "last reviewed" date. Codes: OK / OPT-OUT / CONSENT / RESTRICTED / BANNED; "+" = registry or licence also needed.

**Default:** B2C outbound OFF everywhere. Only messages after recorded consent, plus B2B email where the code is OPT-OUT or OK.
Buying consumer lists OFF everywhere.

| Country | B2C email | B2C SMS/WhatsApp | B2C calls | B2B email | Data purchase |
|---|---|---|---|---|---|
| USA | OPT-OUT | CONSENT | RESTRICTED (AI voice = CONSENT) | OPT-OUT | RESTRICTED |
| Canada | CONSENT | CONSENT | RESTRICTED+DNCL | CONSENT | RESTRICTED |
| UK | CONSENT | CONSENT | RESTRICTED+TPS | OPT-OUT | RESTRICTED |
| Ireland | CONSENT | CONSENT | RESTRICTED | OPT-OUT | RESTRICTED |
| Germany | CONSENT (double opt-in) | CONSENT | CONSENT | CONSENT | RESTRICTED |
| France | CONSENT | CONSENT | CONSENT (since 11 Aug 2026) | OPT-OUT | RESTRICTED |
| Spain | CONSENT | CONSENT | CONSENT + 400-prefix numbers (since 17 Oct 2026) | CONSENT ⚠ | RESTRICTED |
| Italy | CONSENT | CONSENT | OPT-OUT+RPO | CONSENT ⚠ | RESTRICTED |
| Netherlands | CONSENT | CONSENT | CONSENT | OPT-OUT | RESTRICTED |
| Poland | CONSENT | CONSENT | CONSENT | CONSENT | RESTRICTED |
| Sweden | CONSENT | CONSENT | OPT-OUT+NIX | OPT-OUT ⚠ | RESTRICTED |
| Switzerland | CONSENT | CONSENT | OPT-OUT + directory asterisk | CONSENT | RESTRICTED |
| Australia | CONSENT (inferred ok) | CONSENT | RESTRICTED+DNCR | CONSENT (inferred) | RESTRICTED |
| New Zealand | CONSENT | CONSENT | OPT-OUT | CONSENT (deemed) | RESTRICTED |
| Singapore | CONSENT | RESTRICTED+DNC | RESTRICTED+DNC | OK | RESTRICTED |
| Malaysia | CONSENT ⚠ | CONSENT | OPT-OUT | OPT-OUT | RESTRICTED |
| Philippines | CONSENT | CONSENT | CONSENT ⚠ | OPT-OUT ⚠ | RESTRICTED |
| India | OPT-OUT (CONSENT by 2027) | RESTRICTED+DLT | RESTRICTED+140 series | OPT-OUT | RESTRICTED |
| Indonesia | CONSENT | CONSENT | CONSENT | OPT-OUT ⚠ | RESTRICTED |
| Japan | CONSENT | CONSENT | OPT-OUT | OPT-OUT ⚠ | RESTRICTED |
| South Korea | CONSENT (+ night consent, "(광고)" label) | CONSENT | CONSENT | CONSENT | RESTRICTED |
| Brazil | OPT-OUT | OPT-OUT ⚠ | RESTRICTED | OPT-OUT | RESTRICTED |
| Mexico | OPT-OUT | OPT-OUT | RESTRICTED+REPEP | OPT-OUT | RESTRICTED |
| Colombia | CONSENT | CONSENT | RESTRICTED (no Sundays/holidays) | CONSENT ⚠ | RESTRICTED |
| Argentina | OPT-OUT ("Publicidad" label) | OPT-OUT | RESTRICTED+No Llame | OPT-OUT | RESTRICTED |
| South Africa | CONSENT | CONSENT | CONSENT ⚠ | CONSENT | RESTRICTED |
| Nigeria | CONSENT | CONSENT+DND | RESTRICTED | OPT-OUT ⚠ | RESTRICTED |
| Kenya | CONSENT | CONSENT | CONSENT | OPT-OUT ⚠ | RESTRICTED |
| Egypt | CONSENT + licence | CONSENT + licence | CONSENT | CONSENT ⚠ | RESTRICTED |
| Turkey | CONSENT+İYS | CONSENT+İYS | CONSENT+İYS | OPT-OUT | RESTRICTED |
| UAE | CONSENT | CONSENT | RESTRICTED+DNCR (1/day, 2/week) | OPT-OUT ⚠ | RESTRICTED |
| Saudi Arabia | CONSENT | CONSENT | CONSENT | OPT-OUT ⚠ | RESTRICTED |
| Lebanon | OPT-OUT ⚠ | OPT-OUT ⚠ | OPT-OUT ⚠ | OPT-OUT | RESTRICTED ⚠ |

Key cross-market rules: US AI voices count as "artificial" (FCC, Feb 2024) → AI calls need written consent; US one-to-one consent rule vacated
(Jan 2025) but naming the seller in consent is still best practice; California Delete Act DROP checks every 45 days from 1 Aug 2026 if MXAi
acts as a data broker; EU AI Act Art. 50 (tell people they talk to an AI) applies from 2 Aug 2026.

## Launch markets for a consent-based B2C engine (ranked)
1 UK · 2 Australia · 3 USA (email/chat/WhatsApp replies; AI voice only as a call-back after written consent) · 4 UAE · 5 Canada · 6 Singapore · 7 Spain · 8 Netherlands.
Later: Germany, France (double opt-in, 1-year consent). Large but lower price: Brazil, Mexico.

## Minimum product features (every market)
1. Consent record per contact × channel: channel, purpose + brand named, exact wording, form URL/version, UTC + local time, IP/user agent or
   WhatsApp opt-in id, method (checkbox, double opt-in, keypress, recording), legal basis, jurisdiction, expiry (France 1 y, Canada 6/24 months, Korea 2 y ⚠).
2. Unchangeable proof store, kept ~5 years, exportable.
3. Double opt-in switch (on for Germany, Switzerland, Austria).
4. Opt-out by any reasonable means in any language, applied immediately, synced across channels and brands.
5. Global suppression list + registry checks with "checked on" dates: US DNC + states, Canada DNCL (≤31 days), UK TPS/CTPS, Spain Robinson,
   Italy RPO, Sweden NIX, Australia DNCR, Singapore DNC, India NCPR/DLT, Mexico REPEP, Argentina No Llame, UAE DNCR, Turkey İYS.
6. Quiet hours in the contact's local time (US 8-21, Florida/Oklahoma 8-20, Canada 9-21:30, Australia 9-20, Korea night consent, Colombia
   no Sundays/holidays) and frequency caps (Florida 3/day, UAE 1/day 2/week).
7. Sender rules: Spain 400 prefix, India 140/DLT, Saudi registered sender IDs, Texas registration.
8. AI disclosure at the first message or call; truthful answer when asked; human hand-over; sensitive topics flagged.
9. Content labels where required (Korea "(광고)", Argentina "Publicidad", Singapore <ADV> ⚠), sender identity, postal address (CAN-SPAM).
10. Retention: delete non-converting leads after 12–24 months; honour deletion requests; no scraped/broker consumer data by default.
11. Rules engine: a per-country policy table that turns channels on/off and logs which rule allowed each message.

Main sources: Cooley (FCC AI voice ruling), Reed Smith (one-to-one rule), CNIL, AEPD, BOE (Spain 400 prefix), ICO/DUA Act, CRTC, ACMA,
PDPC, Khaitan (India TRAI), Al Tamimi (Egypt, KSA), Clyde & Co (UAE), Goodwin (EU AI Act Art. 50). Full links in the research transcript of 7 Nov 2026.
