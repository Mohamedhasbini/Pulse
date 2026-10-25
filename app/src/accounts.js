// Accounts and businesses: the platform admin creates each business with its owner's login.
// Passwords are stored as scrypt hashes; sessions are signed cookies carrying the user id.
import crypto from 'node:crypto';
import { q, one } from './db.js';
import { VERTICALS } from './verticals.js';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
export function checkPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const given = crypto.scryptSync(String(pw), salt, 64);
  return crypto.timingSafeEqual(given, Buffer.from(hash, 'hex'));
}
// Easy to read out: no 0/O or 1/l. Always contains a number so it passes the password rule.
export const newPassword = () => Array.from(crypto.randomBytes(11), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('') + (crypto.randomInt(8) + 2);

const KEY = crypto.createHmac('sha256', process.env.ADMIN_PASSWORD || 'ringback').update('ringback-user-session').digest();
const sig = s => crypto.createHmac('sha256', KEY).update(s).digest('hex');
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Session = user id + session version (raised by "sign out everywhere" and password changes) + expiry, signed.
export const signSession = (userId, version, hours = 12) => { const s = `${userId}.${version}.${Date.now() + hours * 3600e3}`; return `${s}.${sig(s)}`; };
export function readSession(cookie) {
  const v = /(?:^|;\s*)rb_session=([^;]+)/.exec(cookie || '')?.[1];
  const [uid, ver, exp, s] = String(v || '').split('.');
  if (!uid || !ver || !exp || !s || +exp < Date.now()) return null;
  return safeEq(s, sig(`${uid}.${ver}.${exp}`)) ? { uid: +uid, version: +ver } : null;
}
// Short-lived proof that the password was right, while we wait for the two-factor code.
export const signTicket = uid => { const s = `2fa.${uid}.${Date.now() + 5 * 60000}`; return `${s}.${sig(s)}`; };
export function readTicket(t) {
  const [k, uid, exp, s] = String(t || '').split('.');
  return k === '2fa' && +exp > Date.now() && s && safeEq(s, sig(`2fa.${uid}.${exp}`)) ? +uid : null;
}

// Two-factor codes (TOTP, RFC 6238): the 6-digit codes from Google Authenticator, Microsoft Authenticator, 1Password...
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// Standard authenticator key: 20 random bytes (160 bits) in base32 = 32 characters, what every authenticator app expects.
export function newTotpSecret() {
  let bits = '', out = '';
  for (const byte of crypto.randomBytes(20)) bits += byte.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function b32decode(str) {
  let bits = '';
  for (const c of String(str).replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
}
function totp(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
// Accepts the current code and one step either side, for phone clocks that are a little off.
export function checkTotp(secret, code) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return false;
  const now = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some(d => safeEq(totp(secret, now + d), c));
}
export const totpUrl = (secret, email) => `otpauth://totp/${encodeURIComponent('Pulse:' + email)}?secret=${secret}&issuer=Pulse&digits=6&period=30`;

// Strong enough for a confidential dashboard: 10+ characters with letters and numbers.
export function weakPassword(pw) {
  const p = String(pw || '');
  if (p.length < 10) return 'Use at least 10 characters.';
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return 'Use both letters and numbers.';
  return null;
}

// First start: the platform admin account (login "admin" + ADMIN_PASSWORD), and owners for nothing yet.
export async function ensureAdmin() {
  if (await one(`SELECT 1 FROM users WHERE role='admin'`)) return;
  if (!process.env.ADMIN_PASSWORD) return console.warn('Set ADMIN_PASSWORD in .env to create the admin login.');
  await q(`INSERT INTO users (email, name, password_hash, role) VALUES ('admin', 'Admin', $1, 'admin')`, [hashPassword(process.env.ADMIN_PASSWORD)]);
  console.log('Created admin login: admin / ADMIN_PASSWORD');
}

const WEEK = JSON.stringify({ 0: [], 1: [['10:00', '19:00']], 2: [['10:00', '19:00']], 3: [['10:00', '19:00']], 4: [['10:00', '19:00']], 5: [['10:00', '19:00']], 6: [['10:00', '17:00']] });

// New business from its type's starter template, with a 14-day trial and an owner login.
export async function createBusiness(o) {
  const v = VERTICALS[o.vertical];
  if (!v || v.comingSoon) throw new Error('Choose a business type.');
  const name = String(o.name || '').trim(), email = String(o.owner_email || '').trim().toLowerCase();
  if (name.length < 2) throw new Error('Add the business name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Add the owner's email.");
  if (await one('SELECT 1 FROM users WHERE email=$1', [email])) throw new Error('That email already has an account.');
  const currency = String(o.currency || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a 3-letter code, like USD, EUR or AED.');
  const tz = String(o.timezone || '').trim();
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw new Error('Choose a valid time zone.'); }
  const plan = (await one('SELECT key FROM plans WHERE key=$1', [o.plan_key || 'pro']))?.key || 'pro';
  const b = await one(`INSERT INTO businesses (name, vertical, country, city, currency, timezone, hours, faq, policies, ai_instructions, faqs, listed, plan_status, trial_ends_at, plan_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'',$8,$9,$10,true,'trial', now() + interval '14 days', $11) RETURNING id`,
    [name, o.vertical, String(o.country || '').trim(), String(o.city || '').trim(), currency, tz, WEEK, v.policies || '', v.ai_instructions || '',
     JSON.stringify((v.faqs || []).map(([q2, a]) => ({ q: q2, a }))), plan]);
  for (const [sname, price, minutes, description] of v.services)
    await q('INSERT INTO services (business_id, name, price, minutes, description) VALUES ($1,$2,$3,$4,$5)', [b.id, sname, price, minutes, description || '']);
  const password = newPassword();
  await q(`INSERT INTO users (email, name, password_hash, business_id, role) VALUES ($1,$2,$3,$4,'owner')`,
    [email, String(o.owner_name || '').trim() || null, hashPassword(password), b.id]);
  return { id: b.id, email, password };
}
