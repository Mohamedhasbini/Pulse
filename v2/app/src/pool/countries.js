// Country rules for contacting people (source: v2/docs/country-rules.md, research of 2026-11-07; not legal advice).
// Codes per channel: OK | OPT_OUT (allowed until the person objects) | CONSENT (prior consent needed) | RESTRICTED (consent
// plus extra rules: registries, hours, sender rules) | BANNED. MXAi only ever contacts people with consent; OPT_OUT is used
// only when the admin switches "cold_allowed" on for that country. `quiet` = allowed local hours [from, to);
// `cap` = most marketing messages per person per day/week; `consentMonths` = consent stops counting after this many months;
// `doubleOptIn` = consent counts only after the confirmation click; `labels` = text the message must carry.
const C = 'CONSENT', O = 'OPT_OUT', R = 'RESTRICTED', K = 'OK';
const row = (name, tz, email, sms, call, b2b, extra = {}) => ({ name, tz, channels: { email, sms, whatsapp: sms, call, ai_call: call === O ? R : call === K ? C : call === R ? C : call, b2b_email: b2b }, quiet: [9, 20], cap: { day: 1, week: 3 }, registries: [], consentMonths: null, doubleOptIn: false, labels: [], ...extra });

export const COUNTRIES = {
  US: row('United States', 'America/New_York', O, C, R, O, { quiet: [8, 21], registries: ['National Do Not Call Registry'], labels: ['opt_out_link', 'postal_address'], note: 'AI voices count as artificial voices (FCC 2024): AI calls need prior express written consent. State rules (Florida, Oklahoma, Texas) stricter.' }),
  CA: row('Canada', 'America/Toronto', C, C, R, C, { quiet: [9, 21], registries: ['National DNCL'], consentMonths: 24, labels: ['opt_out_link', 'sender_identity'] }),
  GB: row('United Kingdom', 'Europe/London', C, C, R, O, { quiet: [9, 20], registries: ['TPS', 'CTPS'], labels: ['opt_out_link'], note: 'Soft opt-in for existing customers; sole traders count as consumers.' }),
  IE: row('Ireland', 'Europe/Dublin', C, C, R, O, { labels: ['opt_out_link'] }),
  DE: row('Germany', 'Europe/Berlin', C, C, C, C, { doubleOptIn: true, labels: ['opt_out_link', 'imprint'], note: 'Double opt-in standard; keep consent records 5 years.' }),
  FR: row('France', 'Europe/Paris', C, C, C, O, { consentMonths: 12, labels: ['opt_out_link'], note: 'B2C phone opt-in since 11 Aug 2026.' }),
  ES: row('Spain', 'Europe/Madrid', C, C, C, C, { registries: ['Lista Robinson'], labels: ['opt_out_link'], note: 'Sales calls from 400-prefix numbers since 17 Oct 2026.' }),
  IT: row('Italy', 'Europe/Rome', C, C, O, C, { registries: ['Registro Pubblico delle Opposizioni'], labels: ['opt_out_link'] }),
  NL: row('Netherlands', 'Europe/Amsterdam', C, C, C, O, { labels: ['opt_out_link'] }),
  PL: row('Poland', 'Europe/Warsaw', C, C, C, C, { labels: ['opt_out_link'] }),
  SE: row('Sweden', 'Europe/Stockholm', C, C, O, O, { registries: ['NIX'], labels: ['opt_out_link'] }),
  CH: row('Switzerland', 'Europe/Zurich', C, C, O, C, { doubleOptIn: true, registries: ['Directory asterisk (*)'], labels: ['opt_out_link', 'sender_identity'] }),
  AT: row('Austria', 'Europe/Vienna', C, C, C, C, { doubleOptIn: true, labels: ['opt_out_link', 'imprint'] }),
  AU: row('Australia', 'Australia/Sydney', C, C, R, C, { quiet: [9, 20], registries: ['Do Not Call Register'], labels: ['opt_out_link', 'sender_identity'], note: 'Inferred consent allowed; calls Sat 9-17, none Sunday.' }),
  NZ: row('New Zealand', 'Pacific/Auckland', C, C, O, C, { labels: ['opt_out_link', 'sender_identity'] }),
  SG: row('Singapore', 'Asia/Singapore', C, R, R, K, { registries: ['DNC Registry'], labels: ['opt_out_link', '<ADV>'] }),
  MY: row('Malaysia', 'Asia/Kuala_Lumpur', C, C, O, O),
  PH: row('Philippines', 'Asia/Manila', C, C, C, O),
  IN: row('India', 'Asia/Kolkata', O, R, R, O, { registries: ['NCPR / DLT'], note: 'Messages only via registered DLT senders; promotional calls from the 140 series.' }),
  ID: row('Indonesia', 'Asia/Jakarta', C, C, C, O),
  JP: row('Japan', 'Asia/Tokyo', C, C, O, O, { labels: ['opt_out_link', 'sender_identity'] }),
  KR: row('South Korea', 'Asia/Seoul', C, C, C, C, { quiet: [8, 21], consentMonths: 24, labels: ['(광고)', 'opt_out_link'] }),
  BR: row('Brazil', 'America/Sao_Paulo', O, O, R, O, { labels: ['opt_out_link'] }),
  MX: row('Mexico', 'America/Mexico_City', O, O, R, O, { registries: ['REPEP'], labels: ['opt_out_link'] }),
  CO: row('Colombia', 'America/Bogota', C, C, R, C, { quiet: [7, 19], note: 'No contact on Sundays or public holidays (Ley 2300).' }),
  AR: row('Argentina', 'America/Argentina/Buenos_Aires', O, O, R, O, { registries: ['Registro No Llame'], labels: ['Publicidad', 'opt_out_link'] }),
  ZA: row('South Africa', 'Africa/Johannesburg', C, C, C, C, { labels: ['opt_out_link', 'sender_identity'] }),
  NG: row('Nigeria', 'Africa/Lagos', C, C, R, O, { registries: ['DND 2442'] }),
  KE: row('Kenya', 'Africa/Nairobi', C, C, C, O),
  EG: row('Egypt', 'Africa/Cairo', C, C, C, C, { note: 'Electronic marketing needs a licence; keep consent records 3 years.' }),
  TR: row('Turkey', 'Europe/Istanbul', C, C, C, O, { registries: ['İYS'], note: 'Consent must be registered in İYS.' }),
  AE: row('United Arab Emirates', 'Asia/Dubai', C, C, R, O, { quiet: [9, 18], cap: { day: 1, week: 2 }, registries: ['DNCR'], labels: ['opt_out_link', 'sender_identity'] }),
  SA: row('Saudi Arabia', 'Asia/Riyadh', C, C, C, O, { labels: ['opt_out_link', 'sender_identity'], note: 'SMS sender IDs must be registered with CST.' }),
  LB: row('Lebanon', 'Asia/Beirut', O, O, O, O, { labels: ['opt_out_link'] }),
};
// Countries not listed are treated with the strictest rules.
export const STRICT = row('Other country', 'UTC', C, C, C, C, { labels: ['opt_out_link', 'sender_identity'] });
export const CHANNELS = ['email', 'sms', 'whatsapp', 'call', 'ai_call'];
