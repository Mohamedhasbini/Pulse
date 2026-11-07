// Lead pool core: identities, consent certificates, the sensitive-data guard and opt-out detection.
import crypto from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

const PEPPER = () => process.env.HASH_PEPPER || '';
const CERT_KEY = () => process.env.CERT_KEY || '';
export const keysReady = () => PEPPER().length >= 24 && CERT_KEY().length >= 24;

// ---- identities -------------------------------------------------------------------------------------------
export function normEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) && e.length <= 254 ? e : null;
}
// E.164 phone and the country it belongs to; `country` is the default when the number has no +code
export function normPhone(v, country) {
  const p = parsePhoneNumberFromString(String(v || '').trim(), country ? String(country).toUpperCase() : undefined);
  return p && p.isValid() ? { value: p.number, country: p.country || null } : null;
}
export const idHash = (kind, value) => crypto.createHmac('sha256', PEPPER()).update(`${kind}:${value}`).digest('hex');

// ---- consent certificate ----------------------------------------------------------------------------------
// The certificate is an HMAC over a canonical copy of everything recorded at the moment of consent. Changing any
// recorded field later (who, what wording, which businesses, when, from where) makes it fail verification.
const canon = v => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',')}}` : JSON.stringify(v ?? null));
export const certFields = c => ({
  person_id: c.person_id, channel: c.channel, purpose: c.purpose, buyers: [...(c.buyers || [])].map(Number).sort((a, b) => a - b),
  text_hash: c.text_hash, method: c.method, jurisdiction: c.jurisdiction || null, source: c.source || null, page_url: c.page_url || null,
  ip: c.ip || null, user_agent: c.user_agent || null, evidence: c.evidence || {}, captured_at: new Date(c.captured_at).toISOString(),
});
export const certify = c => crypto.createHmac('sha256', CERT_KEY()).update(canon(certFields(c))).digest('hex');
export const verifyCert = c => { const a = Buffer.from(certify(c)), b = Buffer.from(String(c.certificate || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };
export const textHash = t => crypto.createHash('sha256').update(String(t)).digest('hex');

// ---- what may never be stored -----------------------------------------------------------------------------
// Special categories (health, religion, ethnicity, sexuality, politics, union, biometrics, criminal records),
// children, and guessed demographics. A clinic *service* interest is fine; a condition or diagnosis is not.
const SENSITIVE = /health|medical|diagnos|condition|disease|illness|disab|pregnan|medication|allerg|hiv|cancer|mental|religio|faith|church|mosque|ethnic|race|racial|national_origin|sexual|orientation|gay|lesbian|politic|party_member|union|biometric|fingerprint|face_?id|criminal|convict|child|kid|minor|son_age|daughter|passport|national_id|emirates_id|ssn|iban|card_number|password/i;
export const ALLOWED_KEYS = new Set(['age_range', 'gender', 'budget', 'timing', 'occupation', 'preferred_contact', 'preferred_time', 'household', 'property_type', 'company', 'job_title', 'how_heard', 'notes']);
export function attributeAllowed(key, { source = '' } = {}) {
  const k = String(key || '').toLowerCase();
  if (!k || SENSITIVE.test(k)) return { ok: false, why: 'sensitive or forbidden category' };
  if (!ALLOWED_KEYS.has(k) && !/^q_[a-z0-9_]{1,40}$/.test(k)) return { ok: false, why: 'unknown key (form questions use q_<name>)' };
  if ((k === 'gender' || k === 'age_range') && !/^(form|meta_lead|google_lead|chat|import)/.test(source)) return { ok: false, why: 'demographics only when the person states them' };
  return { ok: true };
}
// values are checked too: free text that mentions a condition is not kept as an attribute
export const valueAllowed = v => !/\b(diabet|cancer|hiv|pregnan|depress|anxiety|disorder|diagnos|surgery for|chemo|autis|adhd)\w*/i.test(String(v || ''));

// ---- opt-out in any language ------------------------------------------------------------------------------
// A single keyword counts only when it is (nearly) the whole message ("STOP", "baja"); clear phrases count anywhere
// ("please don't contact me again"). So "stop by tomorrow?" is not an opt-out.
const WORDS = /^\s*(stop|stopp|unsubscribe|unsub|optout|opt[\s-]out|cancel|quit|end|arr[eê]t|arr[eê]ter|d[ée]sabonner|baja|parar|abmelden|abbestellen|cancella|basta|cancelar|sair|afmelden|uitschrijven|iptal|durdur|توقف|أوقف|اوقف|إلغاء|الغاء|ستوب|रोकें)\s*[.!؟?]*\s*$/i;
const PHRASES = /(unsubscribe me|remove me from|no more (messages|texts|emails)|don'?t (contact|message|text|call|email) me|do not (contact|message|text|call|email) me|leave me alone|stop (messaging|texting|emailing|calling|sending)|ne plus (me )?(contacter|envoyer)|me d[ée]sabonner|darme de baja|no me (escrib|llam|contact)\w+|nicht mehr (kontaktieren|schreiben|anrufen)|non contattarmi|parar de enviar|إلغاء الاشتراك|الغاء الاشتراك|لا ترسل|لا تراسلني|لا تتصل|abonelikten [çc]ık)/i;
export const isOptOut = text => { const t = String(text || ''); return WORDS.test(t) || PHRASES.test(t); };
