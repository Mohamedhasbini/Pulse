// One-time codes: proof that a lead owns the phone (or email) they typed. 6 digits, 10 minutes, 5 tries, at most
// 3 codes an hour per number. Only an HMAC of the code is stored.
// Providers, picked by what is configured (no monthly fee for any of them):
//   twilio_verify   TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_VERIFY_SID   (SMS or WhatsApp; Twilio keeps the code)
//   whatsapp_cloud  WA_TOKEN + WA_PHONE_ID + WA_OTP_TEMPLATE (an approved "authentication" template; Meta Cloud API)
//   dev             nothing configured: the code is written to the app log only (this PC, for testing)
import crypto from 'node:crypto';
import { q, one, tx } from '../db.js';
import { rescore } from './capture.js';
import { TEXTABLE } from './checks.js';

const TTL_MIN = 10, MAX_TRIES = 5, PER_HOUR = 3;
const hashCode = (id, code) => crypto.createHmac('sha256', process.env.CERT_KEY || '').update(`otp:${id}:${code}`).digest('hex');
const auth = () => 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

export function provider(channel) {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SID && channel !== 'email') return 'twilio_verify';
  if (channel === 'whatsapp' && process.env.WA_TOKEN && process.env.WA_PHONE_ID && process.env.WA_OTP_TEMPLATE) return 'whatsapp_cloud';
  return 'dev';
}
export const providerStatus = () => ({ sms: provider('sms'), whatsapp: provider('whatsapp') });

async function twilio(path, form) {
  const r = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SID}/${path}`, {
    method: 'POST', headers: { Authorization: auth(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(15000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.message || `Twilio ${r.status}`), { status: 502 });
  return d;
}

async function whatsappCloud(to, code, lang) {
  const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WA_PHONE_ID}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace('+', ''), type: 'template', template: { name: process.env.WA_OTP_TEMPLATE, language: { code: lang || 'en' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] }] } }) });
  if (!r.ok) throw Object.assign(new Error(`WhatsApp ${r.status}`), { status: 502 });
}

// send a code to the person's phone (or email) on a channel: sms | whatsapp
export async function sendCode(personId, channel = 'whatsapp') {
  if (!['sms', 'whatsapp'].includes(channel)) throw Object.assign(new Error('Codes go by SMS or WhatsApp.'), { status: 400 });
  const ident = await one(`SELECT i.*, p.language FROM lp_identities i JOIN lp_persons p ON p.id=i.person_id WHERE i.person_id=$1 AND i.kind='phone' ORDER BY i.verified_at NULLS FIRST, i.id LIMIT 1`, [personId]);
  if (!ident) throw Object.assign(new Error('There is no mobile number to send a code to.'), { status: 400 });
  if (ident.verified_at) return { already: true };
  if (ident.line_type && !TEXTABLE.has(ident.line_type)) throw Object.assign(new Error('This number cannot receive messages (it is not a mobile number).'), { status: 400 });
  const recent = await one(`SELECT count(*)::int AS n FROM lp_codes WHERE identity_id=$1 AND created_at > now() - interval '1 hour'`, [ident.id]);
  if (recent.n >= PER_HOUR) throw Object.assign(new Error('Too many codes were sent. Please try again in an hour.'), { status: 429 });

  const via = provider(channel);
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  const row = await one(`INSERT INTO lp_codes (person_id, identity_id, channel, provider, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5)) RETURNING id`,
    [personId, ident.id, channel, via, TTL_MIN]);
  if (via === 'twilio_verify') await twilio('Verifications', { To: ident.value, Channel: channel });
  else {
    await q('UPDATE lp_codes SET code_hash=$2 WHERE id=$1', [row.id, hashCode(row.id, code)]);
    if (via === 'whatsapp_cloud') await whatsappCloud(ident.value, code, ident.language);
    else console.log(`[pool] one-time code for person ${personId} (${channel}, dev only, nothing was sent): ${code}`);
  }
  await q(`INSERT INTO lp_events (person_id, type, source, payload) VALUES ($1,'code_sent',$2,$3)`, [personId, via, JSON.stringify({ channel })]);
  return { sent: true, provider: via, channel, ...(via === 'dev' && process.env.NODE_ENV === 'test' ? { code } : {}) };
}

// check what the person typed; on success the number is marked verified and the score goes up
export async function checkCode(personId, code) {
  const c = await one(`SELECT c.*, i.value FROM lp_codes c JOIN lp_identities i ON i.id=c.identity_id WHERE c.person_id=$1 AND c.used_at IS NULL ORDER BY c.id DESC LIMIT 1`, [personId]);
  if (!c || new Date(c.expires_at) < new Date()) return { ok: false, error: 'The code has expired. Ask for a new one.' };
  if (c.attempts >= MAX_TRIES) return { ok: false, error: 'Too many wrong tries. Ask for a new code.' };
  const typed = String(code || '').replace(/\D/g, '').slice(0, 6);
  await q('UPDATE lp_codes SET attempts=attempts+1 WHERE id=$1', [c.id]);
  let good = false;
  if (c.provider === 'twilio_verify') good = typed.length === 6 && (await twilio('VerificationCheck', { To: c.value, Code: typed })).status === 'approved';
  else { const a = Buffer.from(hashCode(c.id, typed)), b = Buffer.from(c.code_hash || ''); good = typed.length === 6 && a.length === b.length && crypto.timingSafeEqual(a, b); }
  if (!good) return { ok: false, error: 'That code is not right.', left: MAX_TRIES - c.attempts - 1 };
  await tx(async db => {
    await db.q('UPDATE lp_codes SET used_at=now() WHERE id=$1', [c.id]);
    await db.q('UPDATE lp_identities SET verified_at=now(), verified_via=$2 WHERE id=$1', [c.identity_id, c.channel]);
    await db.q(`INSERT INTO lp_events (person_id, type, source, payload) VALUES ($1,'verified',$2,$3)`, [personId, c.provider, JSON.stringify({ channel: c.channel })]);
  });
  await rescore(personId);
  return { ok: true };
}
