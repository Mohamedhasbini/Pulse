import * as metrics from './metrics.js';
import express from 'express';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { hashPassword, checkPassword, newPassword, signSession, readSession, signTicket, readTicket, newTotpSecret, checkTotp, totpUrl, newEmailCode, hashCode, weakPassword, ensureAdmin, createBusiness } from './accounts.js';
import { MODULES, FEATURES, MODULE_FEATURE, featuresOf, hasFeature, canOpen, moduleOf, seedPlans } from './features.js';
import { q, one, migrate, withBusinessLock } from './db.js';
import { mountLab } from './lab.js';
import { mountAgents } from './agents.js';
import { mountTeam } from './team.js';
import { mountPulse } from './pulse.js';
import { mountMarketing } from './marketing.js';
import { mountIntegrations, mountPublicApi } from './integrations.js';
import { mountShortcuts } from './shortcuts.js';
import { mountInbox } from './inbox.js';
import { handleMessage, loadBusiness, aiHealth, startAiQueue, aiQueueStatus, aiQueueList } from './brain.js';
import { mountLive } from './live.js';
import { isFree, bufferOf, parseLocal, localStamp, localDate } from './slots.js';
import { sendWhatsApp, validSignature, parseIncoming, validKapsoSignature, parseKapso, whatsappReady } from './whatsapp.js';
import { mountPublic } from './public.js';
import { sendEmail, emailEnabled } from './email.js';
import { mountWeBook } from './webook.js';
import { mountSite, mountSiteAdmin } from './site.js';
import { mountMedia, mountUploads, usage, exportBusiness, closeBusiness, health, startMonitor, sealExistingSecrets, removeMedia, backfillMedia } from './ops.js';
import { mountCoach } from './coach.js';
import { mountClientSites, siteOf, mergeSite, STYLES, SECTIONS, LANGS, validSubdomain, validDomain } from './sitegen.js';
import { seedDemo, removeDemo } from './demo.js';
import { startTelegram, sendTelegram, telegramStatus, connectTelegram, stopBot } from './telegram.js';
import { notify, KINDS, ownerLinkCode } from './notify.js';
import { unify, unifyAll } from './customers.js';
import { insights } from './insights.js';
import { VERTICALS, listVerticals, termsOf } from './verticals.js';
import { startReminders, runReminders, fill } from './reminders.js';

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// ---------- WhatsApp webhook (public, no password; protected by Meta's signature) ----------
app.get('/webhook/whatsapp', (req, res) => {
  const ok = req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WA_VERIFY_TOKEN;
  ok ? res.send(req.query['hub.challenge']) : res.sendStatus(403);
});

app.post('/webhook/whatsapp', async (req, res) => {
  if (!process.env.WA_APP_SECRET) return res.status(503).send('Set WA_APP_SECRET in .env first');
  if (!validSignature(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  res.sendStatus(200); // answer Meta fast, then work
  for (const m of parseIncoming(req.body)) {
    try {
      const biz = await one('SELECT id FROM businesses WHERE wa_phone_number_id=$1', [m.phoneNumberId]);
      if (!biz) { console.warn('No business for phone number id', m.phoneNumberId); continue; }
      const text = m.text || '(The customer sent a ' + m.type + ' message that cannot be read.)';
      const r = await handleMessage({ businessId: biz.id, phone: m.from, name: m.name, text, waId: m.id });
      if (!r.duplicate && r.reply) await sendWhatsApp(m.phoneNumberId, m.from, r.reply, r.options);
    } catch (e) { console.error('Failed to handle WhatsApp message', e); }
  }
});

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// ---------- WhatsApp through Kapso (public, protected by Kapso's signature) ----------
app.post('/webhook/kapso', async (req, res) => {
  if (!validKapsoSignature(req.rawBody, req.get('x-webhook-signature'))) return res.sendStatus(401);
  res.sendStatus(200); // Kapso expects 200 within 10 seconds; the AI answers after
  if (!/message\.received/.test(req.get('x-webhook-event') || 'whatsapp.message.received')) return;
  for (const m of parseKapso(req.body)) {
    try {
      const biz = await one('SELECT id FROM businesses WHERE wa_phone_number_id=$1', [m.phoneNumberId]);
      if (!biz) { console.warn('Kapso: no business for phone number id', m.phoneNumberId); continue; }
      const text = m.text || '(The customer sent a ' + m.type + ' message that cannot be read.)';
      const r = await handleMessage({ businessId: biz.id, phone: m.from, name: m.name, text, waId: m.id });
      if (!r.duplicate && r.reply) await sendWhatsApp(m.phoneNumberId, m.from, r.reply, r.options);
    } catch (e) { console.error('Failed to handle Kapso message', e); }
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// Client websites answer on their own domain or subdomain before anything else
mountClientSites(app, readSession);

// Public website booking page (before the login check)
mountPublic(app, 1);
mountWeBook(app);
mountSite(app);
mountMedia(app);

// ---------- Security basics for every response ----------
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({ 'X-Frame-Options': 'SAMEORIGIN', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' });
  // Requests that change something must come from our own pages, so another website can't act with a signed-in owner's cookie.
  if (req.method !== 'GET' && req.path.startsWith('/api/') && !req.path.startsWith('/api/public/') && !req.path.startsWith('/api/webook/')) {
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Blocked: request from another website.' });
  }
  next();
});

// ---------- Login: each user has their own account; everything below needs it ----------
const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const attempts = new Map(); // ip -> { n, until }
const secureCookie = req => req.get('x-forwarded-proto') === 'https' || !!req.get('cf-ray') ? '; Secure' : '';
const ipOf = req => req.get('cf-connecting-ip') || req.ip;
async function audit(req, action, detail = null, bizId = null, who = req.user) {
  await q('INSERT INTO audit_log (user_id, user_email, business_id, action, detail, ip) VALUES ($1,$2,$3,$4,$5,$6)',
    [who?.id || null, who?.email || null, bizId ?? ctx.getStore()?.biz ?? null, action, detail ? String(detail).slice(0, 500) : null, ipOf(req)]).catch(e => console.error('audit:', e.message));
}
function startSession(req, res, u) {
  res.set('Set-Cookie', `rb_session=${signSession(u.id, u.session_version)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${12 * 3600}${secureCookie(req)}`);
}

// Email two-factor: mail a fresh 6-digit code (valid 10 minutes, 5 tries), at most one every 30 seconds.
const maskEmail = e => String(e || '').replace(/^(.)[^@]*(@.*)$/, (_m, a, b) => a + '•••' + b);
async function mailCode(u, why = 'sign in') {
  if (u.email_code_sent && Date.now() - new Date(u.email_code_sent) < 30000) return { ok: false, reason: 'A code was just sent. Wait 30 seconds before asking for another.' };
  const code = newEmailCode();
  await q(`UPDATE users SET email_code_hash=$1, email_code_exp=now() + interval '10 minutes', email_code_tries=0, email_code_sent=now() WHERE id=$2`, [hashCode(u.id, code), u.id]);
  return sendEmail(u.email, `${code} is your Pulse code`, `Your Pulse code to ${why} is:

*${code}*

It works for 10 minutes. If you didn't try to ${why}, change your password and tell your administrator.`, 'Pulse');
}
async function emailCodeOk(u, code) {
  const r = await one('SELECT email_code_hash, email_code_exp > now() AS live, email_code_tries FROM users WHERE id=$1', [u.id]);
  if (!r?.email_code_hash || !r.live || r.email_code_tries >= 5) return false;
  if (r.email_code_hash !== hashCode(u.id, code)) { await q('UPDATE users SET email_code_tries=email_code_tries+1 WHERE id=$1', [u.id]); return false; }
  await q('UPDATE users SET email_code_hash=NULL, email_code_exp=NULL WHERE id=$1', [u.id]);
  return true;
}

app.get('/login', (_req, res) => res.sendFile(PUBLIC + '/login.html'));
app.post('/api/login', wrap(async (req, res) => {
  const ip = ipOf(req), a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: 'Too many tries from this network. Wait 15 minutes and try again.' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = await one('SELECT * FROM users WHERE email=$1', [email]);
  if (u?.locked_until && new Date(u.locked_until) > new Date())
    return res.status(423).json({ error: 'This account is locked for 15 minutes after too many wrong passwords. Ask your administrator if you need help.' });
  if (!u || u.disabled || !checkPassword(req.body.password, u.password_hash)) {
    a.n++; if (a.n >= 10) { a.n = 0; a.until = Date.now() + 15 * 60000; }
    attempts.set(ip, a);
    if (u) {
      const n = u.failed_logins + 1;
      await q(`UPDATE users SET failed_logins=$1, locked_until=CASE WHEN $3 THEN now() + interval '15 minutes' END WHERE id=$2`, [n >= 5 ? 0 : n, u.id, n >= 5]);
      await audit(req, n >= 5 ? 'login_locked' : 'login_failed', null, u.business_id, u);
    }
    return res.status(401).json({ error: u?.disabled ? 'This login is switched off. Ask your administrator.' : 'Wrong email or password.' });
  }
  attempts.delete(ip);
  await q('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1', [u.id]);
  if (u.totp_enabled || u.email_2fa) {
    let sent = null;
    if (u.email_2fa && !u.totp_enabled) sent = await mailCode(u);
    return res.json({ need_code: true, ticket: signTicket(u.id), app: !!u.totp_enabled, email: u.email_2fa ? maskEmail(u.email) : null,
      sent: sent ? sent.ok : false, send_error: sent && !sent.ok ? sent.reason : null });
  }
  await q('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
  await audit(req, 'login', null, u.business_id, u);
  startSession(req, res, u);
  res.json({ ok: true, setup_2fa: u.role !== 'staff' });
}));
// Second step: the 6-digit code from their authenticator app.
app.post('/api/login/code', wrap(async (req, res) => {
  const uid = readTicket(req.body.ticket);
  if (!uid) return res.status(401).json({ error: 'That took too long. Sign in again.' });
  const u = await one('SELECT * FROM users WHERE id=$1 AND NOT disabled', [uid]);
  const ip = ipOf(req), a = attempts.get('code' + ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: 'Too many wrong codes. Wait 15 minutes and sign in again.' });
  if (!u || !((u.totp_enabled && checkTotp(u.totp_secret, req.body.code)) || (u.email_2fa && await emailCodeOk(u, req.body.code)))) {
    a.n++; if (a.n >= 6) { a.n = 0; a.until = Date.now() + 15 * 60000; }
    attempts.set('code' + ip, a);
    if (u) await audit(req, 'code_failed', null, u.business_id, u);
    return res.status(401).json({ error: 'Wrong code. Use the newest 6-digit code from your authenticator app.' });
  }
  attempts.delete('code' + ip);
  await q('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
  await audit(req, 'login', '2FA', u.business_id, u);
  startSession(req, res, u);
  res.json({ ok: true });
}));
// Sign-in step 2: mail a code (first time for app users who prefer email, or a new one).
app.post('/api/login/email-code', wrap(async (req, res) => {
  const uid = readTicket(req.body.ticket);
  if (!uid) return res.status(401).json({ error: 'That took too long. Sign in again.' });
  const u = await one('SELECT * FROM users WHERE id=$1 AND NOT disabled', [uid]);
  if (!u?.email_2fa) return res.status(400).json({ error: 'Email codes are not switched on for this login.' });
  const r = await mailCode(u);
  if (!r.ok) return res.status(400).json({ error: r.reason });
  res.json({ ok: true, email: maskEmail(u.email) });
}));
app.post('/api/logout', (_req, res) => { res.set('Set-Cookie', 'rb_session=; Path=/; Max-Age=0').json({ ok: true }); });

// The public API authenticates with a business API key, so it sits before the session check.
mountPublicApi(app);

// Who is signed in, and which business this request is about. Owners and staff only ever get their own business;
// the admin works on whichever business they switched to (rb_biz cookie).
const ctx = new AsyncLocalStorage();
const BIZ = () => ctx.getStore().biz;
app.use(wrap(async (req, res, next) => {
  const s = readSession(req.get('cookie'));
  const user = s && await one('SELECT id, email, name, role, business_id, permissions, totp_enabled, email_2fa, session_version FROM users WHERE id=$1 AND NOT disabled', [s.uid]);
  if (!user || user.session_version !== s.version) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Please sign in again.' });
    return res.redirect('/login');
  }
  let biz = user.business_id;
  if (user.role === 'admin') {
    const want = +(/(?:^|;\s*)rb_biz=(\d+)/.exec(req.get('cookie') || '')?.[1]);
    biz = (want && await one('SELECT id FROM businesses WHERE id=$1', [want]))?.id || null;
    // In the Lab (no business opened) only platform pages work; business pages wait until a business is opened.
    if (!biz && req.path.startsWith('/api/') && !/^\/api\/(me(\/|$)|admin\/|logout$|verticals$)/.test(req.path))
      return res.status(409).json({ error: 'Open a business first.', lab: true });
  }
  req.user = user;
  // Plan / add-on and permission checks for the section this request belongs to.
  const mod = moduleOf(req.method, req.path);
  if (mod && user.role !== 'admin') {
    if (!canOpen(user, mod)) { await audit(req, 'denied', `${req.method} ${req.path}`, biz); return res.status(403).json({ error: "You don't have access to this section. Ask the account owner.", locked: 'permission' }); }
  }
  // The platform admin is never blocked by a plan: they test and set up every business.
  if (user.role === 'admin') return ctx.run({ biz }, next);
  if (mod && MODULE_FEATURE[mod] && !(await hasFeature(biz, MODULE_FEATURE[mod])))
    return res.status(402).json({ error: `${FEATURES[MODULE_FEATURE[mod]]} is not in your plan. Upgrade or add it to unlock it.`, locked: 'plan', feature: MODULE_FEATURE[mod] });
  if (/^\/api\/marketing/.test(req.path) && !(await hasFeature(biz, 'marketing')))
    return res.status(402).json({ error: 'Marketing campaigns are not in your plan. Add the Marketing add-on to unlock them.', locked: 'plan', feature: 'marketing' });
  if (req.method !== 'GET' && /^\/api\/coupons/.test(req.path) && !(await hasFeature(biz, 'coupons')))
    return res.status(402).json({ error: 'Discount codes are not in your plan.', locked: 'plan', feature: 'coupons' });
  if (req.method === 'PUT' && req.path === '/api/channels/telegram' && req.body.token && !(await hasFeature(biz, 'telegram')))
    return res.status(402).json({ error: 'A Telegram bot is not in your plan.', locked: 'plan', feature: 'telegram' });
  ctx.run({ biz }, next);
}));
app.use(express.static(PUBLIC));
const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Only the platform admin can do this.' });
mountSiteAdmin(app, adminOnly);
mountUploads(app, () => BIZ(), audit);
mountCoach(app, () => BIZ(), audit, wrap);
// ---------- Website settings: the owner edits texts and photos; style, sections, languages, addresses and publishing are the admin's ----------
const siteBase = () => (process.env.SITES_DOMAIN || '').toLowerCase();
app.get('/api/site', wrap(async (req, res) => {
  const b = await one('SELECT id, name, vertical, description, site, subdomain, custom_domain FROM businesses WHERE id=$1', [BIZ()]);
  res.json({ site: siteOf(b), subdomain: b.subdomain, custom_domain: b.custom_domain, sites_domain: siteBase(), is_admin: req.user.role === 'admin',
    allowed: await hasFeature(BIZ(), 'website'), styles: Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, { label: v.label, accent: v.accent }])), sections: SECTIONS, langs: LANGS, id: b.id });
}));
app.put('/api/site', wrap(async (req, res) => {
  const admin = req.user.role === 'admin', b = await one('SELECT id, name, vertical, description, site, subdomain, custom_domain FROM businesses WHERE id=$1', [BIZ()]);
  const before = siteOf(b), next = mergeSite(before, req.body || {}, admin);
  if (admin && 'subdomain' in req.body) {
    const sub = String(req.body.subdomain || '').trim().toLowerCase() || null;
    if (sub && !validSubdomain(sub)) return res.status(400).json({ error: 'Subdomain: 3 to 40 letters, numbers or dashes, and not a reserved word.' });
    if (sub && await one('SELECT 1 FROM businesses WHERE subdomain=$1 AND id<>$2', [sub, b.id])) return res.status(409).json({ error: 'That subdomain is taken.' });
    await q('UPDATE businesses SET subdomain=$1 WHERE id=$2', [sub, b.id]);
  }
  if (admin && 'custom_domain' in req.body) {
    const dom = String(req.body.custom_domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null;
    if (dom && !validDomain(dom)) return res.status(400).json({ error: 'Write the domain like laylabeauty.com' });
    if (dom && siteBase() && (dom === siteBase() || dom.endsWith('.' + siteBase()))) return res.status(400).json({ error: 'Use the subdomain field for addresses on the platform domain.' });
    if (dom && await one('SELECT 1 FROM businesses WHERE custom_domain=$1 AND id<>$2', [dom, b.id])) return res.status(409).json({ error: 'That domain is already connected to another business.' });
    await q('UPDATE businesses SET custom_domain=$1 WHERE id=$2', [dom, b.id]);
  }
  removeMedia(b.id, before.gallery.filter(g => !next.gallery.includes(g)));
  await q('UPDATE businesses SET site=$1 WHERE id=$2', [JSON.stringify(next), b.id]);
  await audit(req, 'website_saved', admin ? 'admin' : 'owner');
  res.json({ ok: true, site: next });
}));
// Platform operations: usage and cost per client, system health, export and closing a client.
app.get('/api/admin/usage', adminOnly, wrap(async (req, res) => res.json(await usage(Math.min(Math.max(+req.query.days || 30, 1), 365)))));
app.get('/api/admin/health', adminOnly, wrap(async (_req, res) => res.json(await health(aiHealth))));
app.get('/api/admin/businesses/:id/export', adminOnly, wrap(async (req, res) => {
  const data = await exportBusiness(+req.params.id);
  if (!data) return res.status(404).json({ error: 'Business not found.' });
  await audit(req, 'business_exported', data.business.name, +req.params.id);
  res.set('Content-Disposition', `attachment; filename="business-${req.params.id}-export.json"`).json(data);
}));
app.delete('/api/admin/businesses/:id', adminOnly, wrap(async (req, res) => {
  const id = +req.params.id, b = await one('SELECT name FROM businesses WHERE id=$1', [id]);
  if (!b) return res.status(404).json({ error: 'Business not found.' });
  if (String(req.body?.confirm || '').trim() !== b.name) return res.status(400).json({ error: `Type the business name exactly (${b.name}) to confirm.` });
  stopBot(id);
  await closeBusiness(id);
  await audit(req, 'business_closed', b.name, null);
  res.json({ ok: true });
}));

// ---------- Me: account, plan, what I can open, security ----------
// Leave the business you opened and go back to the Lab
app.post('/api/admin/lab', adminOnly, (req, res) => res.set('Set-Cookie', `rb_biz=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie(req)}`).json({ ok: true }));
app.get('/api/me', wrap(async (req, res) => {
  const b = await one(`SELECT b.id, b.name, b.plan_status, b.trial_ends_at, b.country, b.currency, b.timezone, b.plan_key, p.name AS plan_name,
      GREATEST(0, b.trial_ends_at::date - current_date)::int AS trial_days_left FROM businesses b LEFT JOIN plans p ON p.key=b.plan_key WHERE b.id=$1`, [BIZ()]);
  const u = req.user;
  res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role, totp_enabled: u.totp_enabled, email_2fa: u.email_2fa }, email_ready: emailEnabled(), business: b,
    features: [...await featuresOf(BIZ())], modules: Object.keys(MODULES).filter(m => u.role === 'admin' || canOpen(u, m)), module_feature: MODULE_FEATURE,
    edition: process.env.EDITION === 'product' ? 'product' : 'lab', lab: u.role === 'admin' && !BIZ(),
    // links we show or share must work outside this computer, even when the dashboard is opened on localhost
    public_url: (process.env.PUBLIC_URL || '').replace(/\/$/, '') || null });
}));
app.post('/api/me/password', wrap(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!checkPassword(req.body.current, u.password_hash)) return res.status(400).json({ error: 'Your current password is wrong.' });
  const weak = weakPassword(req.body.next); if (weak) return res.status(400).json({ error: weak });
  // A new password signs out every other device.
  const r = await one('UPDATE users SET password_hash=$1, password_changed_at=now(), session_version=session_version+1 WHERE id=$2 RETURNING id, session_version', [hashPassword(req.body.next), u.id]);
  await audit(req, 'password_changed');
  startSession(req, res, r);
  res.json({ ok: true });
}));
app.post('/api/me/signout-everywhere', wrap(async (req, res) => {
  await q('UPDATE users SET session_version=session_version+1 WHERE id=$1', [req.user.id]);
  await audit(req, 'signout_everywhere');
  res.set('Set-Cookie', 'rb_session=; Path=/; Max-Age=0').json({ ok: true });
}));
// Two-factor: get a secret (shown as a QR code), confirm with a code to switch it on, or switch it off with a code.
app.post('/api/me/2fa/setup', wrap(async (req, res) => {
  if (req.user.totp_enabled) return res.status(400).json({ error: 'Two-factor is already on.' });
  // Keep the key that is waiting to be confirmed, so a second click doesn't break the phone that already scanned it.
  // "Start over" (fresh: true) makes a new one.
  const cur = await one('SELECT totp_secret FROM users WHERE id=$1', [req.user.id]);
  const secret = !req.body?.fresh && cur?.totp_secret ? cur.totp_secret : newTotpSecret();
  if (secret !== cur?.totp_secret) await q('UPDATE users SET totp_secret=$1 WHERE id=$2', [secret, req.user.id]);
  res.json({ secret, url: totpUrl(secret, req.user.email) });
}));
app.post('/api/me/2fa/enable', wrap(async (req, res) => {
  const u = await one('SELECT totp_secret FROM users WHERE id=$1', [req.user.id]);
  if (!checkTotp(u.totp_secret, req.body.code)) { await audit(req, '2fa_code_wrong'); return res.status(400).json({ error: 'That code is not right. Use the newest code for "Pulse" in your app. If you scanned an older QR code, delete that entry and scan this one.' }); }
  await q('UPDATE users SET totp_enabled=true WHERE id=$1', [req.user.id]);
  await audit(req, '2fa_on');
  res.json({ ok: true });
}));
// Email codes: send a test code to the login's email, then switch on with that code.
app.post('/api/me/2fa/email/start', wrap(async (req, res) => {
  if (!emailEnabled()) return res.status(400).json({ error: 'Email sending is not connected yet. Ask your Pulse administrator to connect it.' });
  const u = await one('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email)) return res.status(400).json({ error: 'This login has no email address to send codes to.' });
  const r = await mailCode(u, 'switch on email codes');
  if (!r.ok) return res.status(400).json({ error: r.reason });
  res.json({ ok: true, email: maskEmail(u.email) });
}));
app.post('/api/me/2fa/email/enable', wrap(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!await emailCodeOk(u, req.body.code)) return res.status(400).json({ error: 'That code is not right or has expired. Send a new one.' });
  await q('UPDATE users SET email_2fa=true WHERE id=$1', [u.id]);
  await audit(req, '2fa_email_on');
  res.json({ ok: true });
}));
app.post('/api/me/2fa/email/disable', wrap(async (req, res) => {
  const u = await one('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!checkPassword(req.body.password, u.password_hash)) return res.status(400).json({ error: 'Password is not right.' });
  await q('UPDATE users SET email_2fa=false, email_code_hash=NULL WHERE id=$1', [req.user.id]);
  await audit(req, '2fa_email_off');
  res.json({ ok: true });
}));
app.post('/api/me/2fa/disable', wrap(async (req, res) => {
  const u = await one('SELECT totp_secret, password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!checkPassword(req.body.password, u.password_hash) || !checkTotp(u.totp_secret, req.body.code)) return res.status(400).json({ error: 'Password or code is not right.' });
  await q('UPDATE users SET totp_enabled=false, totp_secret=NULL WHERE id=$1', [req.user.id]);
  await audit(req, '2fa_off');
  res.json({ ok: true });
}));
app.get('/api/me/activity', wrap(async (req, res) => res.json(await q(`SELECT action, detail, ip, ${"to_char(at,'YYYY-MM-DD HH24:MI')"} AS at FROM audit_log WHERE user_id=$1 ORDER BY id DESC LIMIT 30`, [req.user.id]))));

// ---------- Command center (admin only): businesses, plans, add-ons, logins, audit ----------
app.get('/api/admin/catalog', adminOnly, wrap(async (_req, res) => res.json({
  modules: MODULES, features: FEATURES, module_feature: MODULE_FEATURE,
  plans: await q('SELECT * FROM plans ORDER BY sort, key'), addons: await q('SELECT * FROM addons ORDER BY sort, key') })));
app.put('/api/admin/plans/:key', adminOnly, wrap(async (req, res) => {
  const table = req.query.kind === 'addon' ? 'addons' : 'plans', key = String(req.params.key).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!key || !name) return res.status(400).json({ error: 'Add a name.' });
  const features = (Array.isArray(req.body.features) ? req.body.features : []).filter(f => FEATURES[f]);
  await q(`INSERT INTO ${table} (key, name, price, currency, features) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, price=EXCLUDED.price, currency=EXCLUDED.currency, features=EXCLUDED.features`,
    [key, name, Math.max(0, +req.body.price || 0), /^[A-Z]{3}$/.test(req.body.currency) ? req.body.currency : 'USD', JSON.stringify(features)]);
  await audit(req, table === 'plans' ? 'plan_saved' : 'addon_saved', `${key}: ${features.join(', ')}`, 0);
  res.json({ ok: true });
}));
app.delete('/api/admin/plans/:key', adminOnly, wrap(async (req, res) => {
  const table = req.query.kind === 'addon' ? 'addons' : 'plans';
  if (table === 'plans' && await one('SELECT 1 FROM businesses WHERE plan_key=$1', [req.params.key])) return res.status(400).json({ error: 'Move the businesses on this plan to another plan first.' });
  await q(`DELETE FROM ${table} WHERE key=$1`, [req.params.key]);
  if (table === 'addons') await q(`UPDATE businesses SET addons = addons - $1`, [req.params.key]);
  await audit(req, table === 'plans' ? 'plan_deleted' : 'addon_deleted', req.params.key, 0);
  res.json({ ok: true });
}));
app.get('/api/admin/businesses', adminOnly, wrap(async (_req, res) => res.json(await q(`SELECT b.id, b.name, b.vertical, b.country, b.city, b.currency, b.timezone, b.is_demo,
    b.plan_status, b.plan_key, b.addons, b.feature_overrides, to_char(b.trial_ends_at,'YYYY-MM-DD') AS trial_ends, GREATEST(0, b.trial_ends_at::date - current_date)::int AS trial_days_left,
    (SELECT string_agg(u.email, ', ') FROM users u WHERE u.business_id=b.id AND u.role='owner') AS owners,
    (SELECT count(*) FROM users u WHERE u.business_id=b.id)::int AS logins,
    (SELECT to_char(max(u.last_login_at),'YYYY-MM-DD HH24:MI') FROM users u WHERE u.business_id=b.id) AS last_login,
    (SELECT count(*) FROM bookings k WHERE k.business_id=b.id AND k.status <> 'cancelled')::int AS bookings,
    (SELECT count(*) FROM conversations c WHERE c.business_id=b.id)::int AS chats,
    (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=b.id AND m.role='customer')::int AS questions
    FROM businesses b ORDER BY b.is_demo, b.id`))));
app.post('/api/admin/businesses', adminOnly, wrap(async (req, res) => {
  // Checked before creating, so a bad subdomain never leaves a half-made business behind.
  const sub = String(req.body.subdomain || '').trim().toLowerCase() || null;
  if (sub && !validSubdomain(sub)) return res.status(400).json({ error: 'Subdomain: 3 to 40 letters, numbers or dashes, and not a reserved word.' });
  if (sub && await one('SELECT 1 FROM businesses WHERE subdomain=$1', [sub])) return res.status(409).json({ error: 'That subdomain is taken.' });
  let r;
  try { r = await createBusiness(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  const known = new Set((await q('SELECT key FROM addons')).map(a => a.key));
  const addons = (Array.isArray(req.body.addons) ? req.body.addons : []).filter(a => known.has(a));
  const style = STYLES[req.body.site_style] ? req.body.site_style : null;
  await q(`UPDATE businesses SET addons=$1, subdomain=$2, site=CASE WHEN $3::text IS NULL THEN site ELSE jsonb_build_object('style', $3::text) END WHERE id=$4`, [JSON.stringify(addons), sub, style, r.id]);
  await audit(req, 'business_created', `${req.body.name} (${r.email})${addons.length ? ' + ' + addons.join(', ') : ''}`, r.id);
  res.json(r);
}));
app.post('/api/admin/switch', adminOnly, wrap(async (req, res) => {
  const b = await one('SELECT id, name FROM businesses WHERE id=$1', [+req.body.id]);
  if (!b) return res.status(404).json({ error: 'Business not found.' });
  await audit(req, 'opened_business', b.name, b.id);
  res.set('Set-Cookie', `rb_biz=${b.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${365 * 86400}${secureCookie(req)}`).json(b);
}));
// Plan, add-ons, per-business feature switches, status and trial: all take effect on the business's next click.
app.post('/api/admin/businesses/:id/plan', adminOnly, wrap(async (req, res) => {
  const id = +req.params.id, b = await one('SELECT * FROM businesses WHERE id=$1', [id]);
  if (!b) return res.status(404).json({ error: 'Business not found.' });
  const status = ['trial', 'active', 'paused'].includes(req.body.status) ? req.body.status : b.plan_status;
  const plan = req.body.plan_key && await one('SELECT key FROM plans WHERE key=$1', [req.body.plan_key]) ? req.body.plan_key : b.plan_key;
  const addons = Array.isArray(req.body.addons) ? (await q('SELECT key FROM addons WHERE key = ANY($1)', [req.body.addons])).map(a => a.key) : b.addons;
  const overrides = req.body.feature_overrides && typeof req.body.feature_overrides === 'object'
    ? Object.fromEntries(Object.entries(req.body.feature_overrides).filter(([k, v]) => FEATURES[k] && typeof v === 'boolean')) : b.feature_overrides;
  await q(`UPDATE businesses SET plan_status=$1, plan_key=$2, addons=$3, feature_overrides=$4, trial_ends_at = trial_ends_at + make_interval(days => $5) WHERE id=$6`,
    [status, plan, JSON.stringify(addons), JSON.stringify(overrides), Math.min(Math.max(+req.body.extend_days || 0, 0), 365), id]);
  await audit(req, 'plan_changed', `${b.name}: ${status}, ${plan}, add-ons [${addons}], switches ${JSON.stringify(overrides)}${req.body.extend_days ? `, +${req.body.extend_days}d` : ''}`, id);
  res.json({ ok: true });
}));

// Logins: every user of every business, with what they can open.
app.get('/api/admin/users', adminOnly, wrap(async (_req, res) => res.json(await q(`SELECT u.id, u.email, u.name, u.role, u.business_id, b.name AS business, u.permissions, u.disabled,
    u.totp_enabled, u.locked_until > now() AS locked, to_char(u.last_login_at,'YYYY-MM-DD HH24:MI') AS last_login, to_char(u.created_at,'YYYY-MM-DD') AS created
    FROM users u LEFT JOIN businesses b ON b.id=u.business_id ORDER BY u.role='admin' DESC, b.name, u.role, u.email`))));
app.post('/api/admin/users', adminOnly, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), role = req.body.role === 'staff' ? 'staff' : 'owner';
  const biz = await one('SELECT id, name FROM businesses WHERE id=$1', [+req.body.business_id]);
  if (!biz) return res.status(400).json({ error: 'Choose the business.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Add an email for the login.' });
  if (await one('SELECT 1 FROM users WHERE email=$1', [email])) return res.status(400).json({ error: 'That email already has a login.' });
  if (role === 'staff' && !(await hasFeature(biz.id, 'staff_logins'))) return res.status(400).json({ error: `${biz.name}'s plan has no staff logins. Add the Staff logins add-on first.` });
  const perms = role === 'staff' ? (Array.isArray(req.body.permissions) ? req.body.permissions : []).filter(m => MODULES[m]) : null;
  const password = newPassword();
  const u = await one(`INSERT INTO users (email, name, password_hash, business_id, role, permissions) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [email, String(req.body.name || '').trim() || null, hashPassword(password), biz.id, role, perms && JSON.stringify(perms)]);
  await audit(req, 'login_created', `${email} (${role}) for ${biz.name}${perms ? ': ' + perms.join(', ') : ''}`, biz.id);
  res.json({ id: u.id, email, password });
}));
// Change what a login can open, switch it off/on, or force it out. Takes effect on their next click.
app.patch('/api/admin/users/:id', adminOnly, wrap(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id=$1', [+req.params.id]);
  if (!u) return res.status(404).json({ error: 'Login not found.' });
  if (u.role === 'admin' && req.body.disabled) return res.status(400).json({ error: "The admin login can't be switched off." });
  const perms = u.role === 'staff' && Array.isArray(req.body.permissions) ? req.body.permissions.filter(m => MODULES[m]) : u.permissions;
  const disabled = typeof req.body.disabled === 'boolean' ? req.body.disabled : u.disabled;
  await q(`UPDATE users SET permissions=$1, disabled=$2, name=COALESCE($3, name), session_version = session_version + $4 WHERE id=$5`,
    [perms && JSON.stringify(perms), disabled, req.body.name ? String(req.body.name).trim() : null, req.body.signout || disabled ? 1 : 0, u.id]);
  await audit(req, 'login_changed', `${u.email}: ${disabled ? 'off' : 'on'}${perms ? ', ' + perms.join(', ') : ''}${req.body.signout ? ', signed out' : ''}`, u.business_id);
  res.json({ ok: true });
}));
app.post('/api/admin/users/:id/reset', adminOnly, wrap(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id=$1', [+req.params.id]);
  if (!u) return res.status(404).json({ error: 'Login not found.' });
  const out = { email: u.email };
  if (req.body.what === '2fa') await q('UPDATE users SET totp_enabled=false, totp_secret=NULL, email_2fa=false, email_code_hash=NULL, session_version=session_version+1 WHERE id=$1', [u.id]);
  else { out.password = newPassword(); await q('UPDATE users SET password_hash=$1, failed_logins=0, locked_until=NULL, session_version=session_version+1 WHERE id=$2', [hashPassword(out.password), u.id]); }
  await audit(req, req.body.what === '2fa' ? '2fa_reset' : 'password_reset', u.email, u.business_id);
  res.json(out);
}));
app.delete('/api/admin/users/:id', adminOnly, wrap(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id=$1', [+req.params.id]);
  if (!u || u.role === 'admin') return res.status(400).json({ error: "This login can't be deleted." });
  await q('DELETE FROM users WHERE id=$1', [u.id]);
  await audit(req, 'login_deleted', u.email, u.business_id);
  res.json({ ok: true });
}));
app.get('/api/admin/audit', adminOnly, wrap(async (req, res) => res.json(await q(`SELECT a.id, to_char(a.at,'YYYY-MM-DD HH24:MI:SS') AS at, a.user_email, a.action, a.detail, a.ip, b.name AS business
    FROM audit_log a LEFT JOIN businesses b ON b.id=a.business_id WHERE ($1 = '' OR a.action ILIKE $1 || '%' OR a.user_email ILIKE '%' || $1 || '%' OR b.name ILIKE '%' || $1 || '%')
    ORDER BY a.id DESC LIMIT 200`, [String(req.query.q || '').trim()]))));

app.get('/api/business', wrap(async (_req, res) => { const b = await loadBusiness(BIZ()); delete b.telegram_token; delete b.telegram_token_hash; res.json({ ...b, terms: termsOf(b.vertical) }); }));
app.get('/api/verticals', (_req, res) => res.json(listVerticals()));

// Switch business type. With template=true it also loads that type's starter services, FAQs and policies
// (existing services are hidden, not deleted, so past bookings stay intact).
app.post('/api/business/vertical', wrap(async (req, res) => {
  const v = VERTICALS[req.body.key];
  if (!v) return res.status(400).json({ error: 'Unknown business type.' });
  if (v.comingSoon) return res.status(400).json({ error: v.note });
  await q('UPDATE businesses SET vertical=$1 WHERE id=$2', [req.body.key, BIZ()]);
  if (req.body.template) {
    await q('UPDATE services SET active=false WHERE business_id=$1', [BIZ()]);
    await q('DELETE FROM services s WHERE s.business_id=$1 AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.service_id=s.id)', [BIZ()]);
    for (const [name, price, minutes, description] of v.services)
      await q('INSERT INTO services (business_id, name, price, minutes, description) VALUES ($1,$2,$3,$4,$5)', [BIZ(), name, price, minutes, description || '']);
    await q('UPDATE businesses SET faqs=$1, policies=$2, ai_instructions=$3 WHERE id=$4',
      [JSON.stringify((v.faqs || []).map(([q2, a]) => ({ q: q2, a }))), v.policies || '', v.ai_instructions || '', BIZ()]);
  }
  const b = await loadBusiness(BIZ());
  res.json({ ...b, terms: termsOf(b.vertical) });
}));

const HHMM = /^([01]\d|2[0-4]):[0-5]\d$/;
function cleanHours(hours) {
  const out = {};
  for (let d = 0; d < 7; d++) {
    out[d] = (hours?.[d] || []).filter(r => HHMM.test(r[0]) && HHMM.test(r[1]) && r[0] < r[1]);
  }
  return out;
}

app.put('/api/business', wrap(async (req, res) => {
  const b = req.body;
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Add the business name.' });
  for (const s of b.services || []) {
    if (s.name && (!(+s.price >= 0) || !(+s.minutes >= 5 && +s.minutes <= 600))) return res.status(400).json({ error: `Check ${s.name}: price must be 0 or more and length between 5 and 600 minutes.` });
  }
  await q(`UPDATE businesses SET name=$1, address=$2, faq=$3, wa_phone_number_id=NULLIF($4,''), hours=$5, capacity=$6, slot_step=$7, payment_methods=$9, booking_note=$10, phone=$11, cancel_hours=$12,
      reminders_enabled=$13, reminder_hours=$14, reminder_text=$15, booking_enabled=$16, booking_title=$17, booking_intro=$18,
      booking_color=$19, booking_show_prices=$20, booking_min_notice_hours=$21, booking_days_ahead=$22,
      description=$23, website=$24, instagram=$25, maps_url=$26, languages=$27, tone=$28, team=$29, policies=$30, ai_instructions=$31, faqs=$32, ask_email=$33, assistant_name=$34 WHERE id=$8`,
    [b.name, b.address, b.faq, b.wa_phone_number_id || '', JSON.stringify(cleanHours(b.hours)), Math.max(1, +b.capacity || 1), [15, 30, 60].includes(+b.slot_step) ? +b.slot_step : 30, BIZ(), b.payment_methods || '', b.booking_note || '', String(b.phone || '').trim(), Math.min(Math.max(+b.cancel_hours || 0, 0), 168),
     b.reminders_enabled !== false, [2, 12, 24, 48].includes(+b.reminder_hours) ? +b.reminder_hours : 24, String(b.reminder_text || '').trim() || null,
     b.booking_enabled !== false, String(b.booking_title || '').trim(), String(b.booking_intro || '').trim(),
     /^#[0-9a-f]{6}$/i.test(b.booking_color) ? b.booking_color : '#10a35a', b.booking_show_prices !== false,
     Math.min(Math.max(+b.booking_min_notice_hours || 0, 0), 72), Math.min(Math.max(+b.booking_days_ahead || 30, 1), 90),
     ...['description', 'website', 'instagram', 'maps_url', 'languages'].map(k => String(b[k] || '').trim().slice(0, 2000)),
     ['warm', 'professional', 'playful'].includes(b.tone) ? b.tone : 'warm',
     ...['team', 'policies', 'ai_instructions'].map(k => String(b[k] || '').trim().slice(0, 4000)),
     JSON.stringify((Array.isArray(b.faqs) ? b.faqs : []).map(f => ({ q: String(f.q || '').trim().slice(0, 300), a: String(f.a || '').trim().slice(0, 1500) })).filter(f => f.q && f.a).slice(0, 60)),
     b.ask_email !== false, String(b.assistant_name || '').trim().slice(0, 40) || 'Nora']);
  const keep = (b.services || []).filter(s => s.id).map(s => s.id);
  // Services that already have bookings are kept so past bookings stay intact.
  await q(`DELETE FROM services s WHERE s.business_id=$1 AND s.id <> ALL($2::int[]) AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.service_id=s.id)`, [BIZ(), keep]);
  await q(`UPDATE services SET active=false WHERE business_id=$1 AND id <> ALL($2::int[])`, [BIZ(), keep]);
  for (const s of b.services || []) {
    if (!s.name) continue;
    const desc = String(s.description || '').trim().slice(0, 600);
    const cap = Math.min(Math.max(parseInt(s.capacity, 10) || 0, 0), 500) || null;
    if (s.id) await q('UPDATE services SET name=$1, price=$2, minutes=$3, description=$6, capacity=$7, active=true WHERE id=$4 AND business_id=$5', [s.name, +s.price, +s.minutes, s.id, BIZ(), desc, cap]);
    else await q('INSERT INTO services (business_id, name, price, minutes, description, capacity) VALUES ($1,$2,$3,$4,$5,$6)', [BIZ(), s.name, +s.price, +s.minutes, desc, cap]);
  }
  { const nb = await loadBusiness(BIZ()); res.json({ ...nb, terms: termsOf(nb.vertical) }); }
}));

// ---------- Calendar ----------
// All times sent to and from the dashboard are the business's local time ("2026-10-26T10:30"),
// so the calendar is right no matter which time zone the owner's device is in.
const LOCAL = col => `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI')`;

app.get('/api/calendar', wrap(async (req, res) => {
  const from = parseLocal(req.query.from), to = parseLocal(req.query.to);
  if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'Pick a date range.' });
  const bookings = await q(`SELECT b.id, ${LOCAL('b.starts_at')} AS start, ${LOCAL('b.ends_at')} AS "end", b.price::float, b.status, b.source,
      b.service_id, b.conversation_id, b.notes, b.coupon_code, b.reminder_status, s.name service, cu.name customer, cu.phone
      FROM bookings b JOIN services s ON s.id=b.service_id JOIN customers cu ON cu.id=b.customer_id
      WHERE b.business_id=$1 AND b.starts_at < $3 AND b.ends_at > $2 ORDER BY b.starts_at`, [BIZ(), from, to]);
  const timeOff = await q(`SELECT id, ${LOCAL('starts_at')} AS start, ${LOCAL('ends_at')} AS "end", reason FROM time_off
      WHERE business_id=$1 AND starts_at < $3 AND ends_at > $2`, [BIZ(), from, to]);
  res.json({ bookings, timeOff, now: localStamp(new Date()) });
}));

async function checkSlot(start, serviceId, ignoreId) {
  const biz = await loadBusiness(BIZ());
  const svc = biz.services.find(s => s.id === +serviceId);
  if (!svc) return { error: 'Pick a service.', hard: true };
  const end = new Date(start.getTime() + svc.minutes * 60000);
  const bookings = await q(`SELECT * FROM bookings WHERE business_id=$1 AND status <> 'cancelled' AND id <> $2`, [BIZ(), ignoreId || 0]);
  const timeOff = await q('SELECT * FROM time_off WHERE business_id=$1', [BIZ()]);
  if (!isFree(biz, bookings, timeOff, start, end, bufferOf(biz, svc.id), svc.id)) return { svc, error: 'That time is outside opening hours, blocked, or already full.' };
  return { svc };
}

app.post('/api/bookings', wrap(async (req, res) => withBusinessLock(BIZ(), async () => {
  const { name, phone, service_id, start, force } = req.body;
  const st = parseLocal(start);
  if (isNaN(st)) return res.status(400).json({ error: 'Pick a date and time.' });
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Add the customer name.' });
  const chk = await checkSlot(st, service_id);
  if (chk.error && (chk.hard || !force)) return res.status(chk.hard ? 400 : 409).json({ error: chk.error });
  const cust = await one(`INSERT INTO customers (business_id, phone, name) VALUES ($1,$2,$3)
      ON CONFLICT (business_id, phone) DO UPDATE SET name = COALESCE(EXCLUDED.name, customers.name) RETURNING id`,
    [BIZ(), String(phone || '').trim() || 'walk-in-' + Date.now(), name.trim()]);
  Object.assign(cust, await unify(BIZ(), cust.id) || {});
  const b = await one(`INSERT INTO bookings (business_id, customer_id, service_id, starts_at, ends_at, price, source)
      VALUES ($1,$2,$3,$4,$5,$6,'manual') RETURNING id`, [BIZ(), cust.id, chk.svc.id, st, new Date(st.getTime() + chk.svc.minutes * 60000), chk.svc.price]);
  res.json(b);
})));

app.patch('/api/bookings/:id', wrap(async (req, res) => withBusinessLock(BIZ(), async () => {
  const cur = await one('SELECT * FROM bookings WHERE id=$1 AND business_id=$2', [req.params.id, BIZ()]);
  if (!cur) return res.sendStatus(404);
  const { start, service_id, status, force } = req.body;
  if (start || service_id) {
    const st = start ? parseLocal(start) : new Date(cur.starts_at), sid = service_id || cur.service_id;
    if (isNaN(st)) return res.status(400).json({ error: 'Pick a date and time.' });
    const chk = await checkSlot(st, sid, cur.id);
    if (chk.error && (chk.hard || !force)) return res.status(chk.hard ? 400 : 409).json({ error: chk.error });
    await q('UPDATE bookings SET starts_at=$1, ends_at=$2, service_id=$3, price=$4 WHERE id=$5',
      [st, new Date(st.getTime() + chk.svc.minutes * 60000), chk.svc.id, chk.svc.price, cur.id]);
  }
  if (['confirmed', 'cancelled', 'completed', 'no_show'].includes(status)) await q('UPDATE bookings SET status=$1 WHERE id=$2', [status, cur.id]);
  res.json({ ok: true });
})));

app.post('/api/time-off', wrap(async (req, res) => {
  const s = parseLocal(req.body.start), e = parseLocal(req.body.end);
  if (isNaN(s) || isNaN(e) || e <= s) return res.status(400).json({ error: 'The end must be after the start.' });
  res.json(await one('INSERT INTO time_off (business_id, starts_at, ends_at, reason) VALUES ($1,$2,$3,$4) RETURNING id', [BIZ(), s, e, req.body.reason || '']));
}));
app.delete('/api/time-off/:id', wrap(async (req, res) => {
  await q('DELETE FROM time_off WHERE id=$1 AND business_id=$2', [req.params.id, BIZ()]);
  res.json({ ok: true });
}));

// Removes everything created from the dashboard's test chat.
app.post('/api/test-data/clear', wrap(async (_req, res) => {
  await q(`DELETE FROM bookings WHERE conversation_id IN (SELECT id FROM conversations WHERE business_id=$1 AND channel='test')`, [BIZ()]);
  await q(`DELETE FROM conversations WHERE business_id=$1 AND channel='test'`, [BIZ()]);
  await q(`DELETE FROM customers c WHERE c.business_id=$1 AND NOT EXISTS (SELECT 1 FROM conversations v WHERE v.customer_id=c.id)
           AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id=c.id)`, [BIZ()]);
  res.json({ ok: true });
}));

// Test chat in the dashboard: same brain as WhatsApp, no WhatsApp needed.
app.post('/api/test-chat', wrap(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Write a message first.' });
  res.json(await handleMessage({ businessId: BIZ(), phone: req.body.phone || 'test-user', name: req.body.name, text, channel: 'test' }));
}));

// Messages waiting for the AI (rate limit or AI down) and how long the oldest has waited.
app.get('/api/ai-queue', wrap(async (_req, res) => res.json(await aiQueueStatus(BIZ()))));
app.get('/api/ai-queue/list', wrap(async (req, res) => res.json(await aiQueueList(BIZ(), String(req.query.status || '')))));
mountLive(app, () => BIZ());
mountLab(app, () => BIZ());
mountAgents(app, () => BIZ(), { sendWhatsApp, sendTelegram, notify, audit });
mountTeam(app, () => BIZ(), { sendWhatsApp, sendTelegram, audit });
mountPulse(app, () => BIZ());
mountMarketing(app, () => BIZ());
mountIntegrations(app, () => BIZ());
mountShortcuts(app, () => BIZ());
mountInbox(app, () => BIZ(), LOCAL);

// Reviews: customers rate a chat 1-5 when it ends. Satisfaction = share of ratings that are 4 or 5.
app.get('/api/ratings', wrap(async (req, res) => {
  const days = Math.min(Math.max(+req.query.days || 30, 1), 365), P = [BIZ(), days];
  const [s] = await q(`SELECT count(*) FILTER (WHERE rating IS NOT NULL)::int AS rated, count(*) FILTER (WHERE rating_asked_at IS NOT NULL)::int AS asked,
      round(avg(rating)::numeric, 2)::float AS avg, count(*) FILTER (WHERE rating >= 4)::int AS happy,
      count(*) FILTER (WHERE rating <= 2)::int AS unhappy, count(*) FILTER (WHERE rating_comment IS NOT NULL)::int AS comments
    FROM conversations WHERE business_id=$1 AND COALESCE(rated_at, rating_asked_at) > now() - make_interval(days => $2::int)`, P);
  const dist = await q(`SELECT rating, count(*)::int n FROM conversations WHERE business_id=$1 AND rating IS NOT NULL
    AND rated_at > now() - make_interval(days => $2::int) GROUP BY rating ORDER BY rating`, P);
  const list = await q(`SELECT v.id, v.rating, v.rating_comment, v.rated_at, v.outcome, v.channel, COALESCE(c.name, c.phone) AS customer
    FROM conversations v JOIN customers c ON c.id=v.customer_id WHERE v.business_id=$1 AND v.rating IS NOT NULL
    AND v.rated_at > now() - make_interval(days => $2::int) ORDER BY v.rated_at DESC LIMIT 200`, P);
  res.json({ ...s, satisfaction: s.rated ? Math.round(100 * s.happy / s.rated) : null, response_rate: s.asked ? Math.round(100 * s.rated / s.asked) : null, dist, list });
}));

// ---------- Dashboard numbers ----------
// Every number comes straight from the database for the chosen period.
app.get('/api/stats', wrap(async (req, res) => {
  const days = Math.min(Math.max(+req.query.days || 30, 1), 365);
  const noTest = req.query.test === '0';
  const convF = noTest ? `AND c.channel <> 'test'` : '';
  const bookF = noTest ? `AND COALESCE(c.channel, '') <> 'test'` : ''; // manual bookings have no conversation
  const P = [BIZ(), days];
  const since = days === 1 ? `date_trunc('day', now()) + make_interval(days => $2::int - 1)` : `now() - make_interval(days => $2::int)`;
  const [t] = await q(`SELECT count(*)::int AS conv,
      count(*) FILTER (WHERE c.outcome='handoff')::int AS handoff,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.role='assistant' AND NOT m.failed))::int AS answered,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.conversation_id=c.id AND b.status <> 'cancelled'))::int AS booked_conv,
      count(DISTINCT c.customer_id)::int AS customers
      FROM conversations c WHERE c.business_id=$1 AND c.created_at > ${since} ${convF}`, P);
  const [bk] = await q(`SELECT count(*) FILTER (WHERE b.source IN ('ai','web'))::int AS ai_bookings,
      COALESCE(sum(b.price) FILTER (WHERE b.source IN ('ai','web')),0)::float AS ai_value,
      count(*) FILTER (WHERE b.source='ai')::int AS chat_bookings, count(*) FILTER (WHERE b.source='web')::int AS web_bookings,
      count(*)::int AS all_bookings, COALESCE(sum(b.price),0)::float AS all_value
      FROM bookings b LEFT JOIN conversations c ON c.id=b.conversation_id
      WHERE b.business_id=$1 AND b.created_at > ${since} AND b.status <> 'cancelled' ${bookF}`, P);
  const [ai] = await q(`SELECT round(avg(m.latency_ms) FILTER (WHERE NOT m.failed))::int AS avg_ms,
      count(*) FILTER (WHERE m.failed)::int AS failures, count(*)::int AS replies
      FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE c.business_id=$1 AND m.role='assistant' AND m.created_at > ${since} ${convF}`, P);
  const [outcomes] = await q(`SELECT count(*) FILTER (WHERE b.status='completed')::int AS completed, count(*) FILTER (WHERE b.status='no_show')::int AS no_show,
      count(*) FILTER (WHERE b.status='cancelled')::int AS cancelled, count(*) FILTER (WHERE b.status='confirmed')::int AS unmarked
      FROM bookings b LEFT JOIN conversations c ON c.id=b.conversation_id
      WHERE b.business_id=$1 AND b.starts_at > ${since} AND b.starts_at < now() ${bookF}`, P);
  const daily = await q(`SELECT to_char(d,'YYYY-MM-DD') AS day,
      (SELECT count(*) FROM conversations c WHERE c.business_id=$1 AND c.created_at::date=d ${convF})::int AS conv,
      (SELECT count(*) FROM bookings b LEFT JOIN conversations c ON c.id=b.conversation_id WHERE b.business_id=$1 AND b.source IN ('ai','web')
         AND b.status <> 'cancelled' AND b.created_at::date=d ${bookF})::int AS booked
      FROM generate_series((now() - make_interval(days => $2::int - 1))::date, now()::date, '1 day') d`, P);
  const heat = await q(`SELECT extract(dow FROM m.created_at)::int AS dow, extract(hour FROM m.created_at)::int AS hour, count(*)::int AS n
      FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE c.business_id=$1 AND m.role='customer' AND m.created_at > ${since} ${convF} GROUP BY 1,2`, P);
  const channels = await q(`SELECT c.channel, count(*)::int AS n FROM conversations c WHERE c.business_id=$1 AND c.created_at > ${since} ${convF} GROUP BY 1`, P);
  const services = await q(`SELECT s.name, count(b.id)::int AS n, COALESCE(sum(b.price),0)::float AS value FROM services s
      LEFT JOIN (SELECT b.* FROM bookings b LEFT JOIN conversations c ON c.id=b.conversation_id
                 WHERE b.created_at > ${since} AND b.status <> 'cancelled' ${bookF}) b ON b.service_id=s.id
      WHERE s.business_id=$1 AND (s.active OR b.id IS NOT NULL) GROUP BY s.id ORDER BY n DESC, s.id`, P);
  const today = await q(`SELECT b.id, ${LOCAL('b.starts_at')} AS start, b.status, b.price::float, b.source, s.name service, cu.name customer
      FROM bookings b JOIN services s ON s.id=b.service_id JOIN customers cu ON cu.id=b.customer_id
      WHERE b.business_id=$1 AND b.starts_at::date = now()::date AND b.status <> 'cancelled' ORDER BY b.starts_at`, [BIZ()]);
  const upcoming = await q(`SELECT b.id, ${LOCAL('b.starts_at')} AS start, b.price::float, b.source, s.name service, cu.name customer FROM bookings b
      JOIN services s ON s.id=b.service_id JOIN customers cu ON cu.id=b.customer_id
      WHERE b.business_id=$1 AND b.starts_at > now() AND b.status='confirmed' ORDER BY b.starts_at LIMIT 5`, [BIZ()]);
  const attention = await q(`SELECT c.id, c.attention_reason, ${LOCAL('c.updated_at')} AS at, cu.name, cu.phone, c.channel,
      (SELECT text FROM messages m WHERE m.conversation_id=c.id AND m.role='customer' ORDER BY id DESC LIMIT 1) AS last
      FROM conversations c JOIN customers cu ON cu.id=c.customer_id
      WHERE c.business_id=$1 AND c.needs_attention ${convF} ORDER BY c.updated_at DESC LIMIT 10`, [BIZ()]);
  const [pend] = await q(`SELECT count(*)::int AS n FROM requests WHERE business_id=$1 AND status='pending'`, [BIZ()]);
  const [learn] = await q(`SELECT count(*)::int AS n FROM learning WHERE business_id=$1 AND status='open'`, [BIZ()]);
  const biz = await one('SELECT name, plan_price::float FROM businesses WHERE id=$1', [BIZ()]);
  res.json({ ...t, ...bk, approvals: pend.n, to_learn: learn.n, ai: { ...ai, last: aiHealth }, outcomes, daily, heat, channels, services, today, upcoming, attention,
    business: biz, now: localStamp(new Date()), tz: process.env.TZ,
    booking_url: (process.env.PUBLIC_URL || 'https://app.nexfoyz.dev').replace(/\/$/, '') + '/book?b=' + BIZ() });
}));

app.get('/api/conversations', wrap(async (req, res) => {
  const convF = req.query.test === '0' ? `AND c.channel <> 'test'` : '';
  res.json(await q(`SELECT c.id, c.channel, c.outcome, c.value::float, c.needs_attention, c.ai_paused, c.kind, c.topic, c.mood, ${LOCAL('c.updated_at')} AS at, c.updated_at, cu.name, cu.phone,
      (SELECT count(*) FROM messages m WHERE m.conversation_id=c.id)::int AS messages,
      (SELECT text FROM messages m WHERE m.conversation_id=c.id ORDER BY id DESC LIMIT 1) AS last
      FROM conversations c JOIN customers cu ON cu.id=c.customer_id WHERE c.business_id=$1 ${convF} ORDER BY c.updated_at DESC LIMIT 25`, [BIZ()]));
}));

app.get('/api/conversations/:id/messages', wrap(async (req, res) => {
  res.json(await q(`SELECT m.role, m.text, ${LOCAL('m.created_at')} AS at, m.latency_ms, m.failed FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE c.id=$1 AND c.business_id=$2 ORDER BY m.id`, [req.params.id, BIZ()]));
}));

// ---------- Approvals: late cancellations, late time changes, extra requests ----------
const REF = id => 'RB-' + String(id).padStart(4, '0');
const nice = d => new Date(d).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Tells the customer the decision in their chat (and on WhatsApp when that's where they wrote from).
async function notifyCustomer(conversationId, text) {
  const c = await one(`SELECT c.id, c.channel, c.business_id, cu.phone, cu.telegram_chat_id, b.wa_phone_number_id FROM conversations c
      JOIN customers cu ON cu.id=c.customer_id JOIN businesses b ON b.id=c.business_id WHERE c.id=$1`, [conversationId]);
  if (!c) return;
  await q(`INSERT INTO messages (conversation_id, role, text) VALUES ($1,'assistant',$2)`, [c.id, text]);
  await q('UPDATE conversations SET updated_at=now() WHERE id=$1', [c.id]);
  if (c.channel === 'whatsapp') await sendWhatsApp(c.wa_phone_number_id, c.phone, text);
  if (c.channel === 'telegram') await sendTelegram(c.telegram_chat_id, text, c.business_id);
}

app.get('/api/requests', wrap(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  res.json(await q(`SELECT r.id, r.type, r.details, r.status, r.staff_note, ${LOCAL('r.created_at')} AS at, ${LOCAL('r.new_start')} AS new_start,
      r.booking_id, r.conversation_id, ${LOCAL('b.starts_at')} AS start, b.status AS booking_status, b.price::float, s.name service, cu.name, cu.phone
      FROM requests r JOIN bookings b ON b.id=r.booking_id JOIN services s ON s.id=b.service_id JOIN customers cu ON cu.id=b.customer_id
      WHERE r.business_id=$1 AND r.status=$2 ORDER BY r.created_at DESC LIMIT 30`, [BIZ(), status]));
}));

app.post('/api/requests/:id/:decision(approve|reject)', wrap(async (req, res) => withBusinessLock(BIZ(), async () => {
  const r = await one(`SELECT r.*, b.starts_at, b.ends_at, b.service_id, b.price FROM requests r JOIN bookings b ON b.id=r.booking_id
      WHERE r.id=$1 AND r.business_id=$2`, [req.params.id, BIZ()]);
  if (!r) return res.sendStatus(404);
  if (r.status !== 'pending') return res.status(409).json({ error: 'This request was already decided.' });
  const approve = req.params.decision === 'approve', note = String(req.body.note || '').trim();
  const svc = await one('SELECT * FROM services WHERE id=$1', [r.service_id]);
  let msg;
  if (r.type === 'cancel') {
    if (approve) {
      await q("UPDATE bookings SET status='cancelled', cancelled_by='customer' WHERE id=$1", [r.booking_id]);
      await q('UPDATE conversations SET value = GREATEST(value - $1, 0) WHERE id=$2', [r.price, r.conversation_id || 0]);
    }
    msg = approve ? `*✅ Your cancellation is approved*\n\n• Booking ref: ${REF(r.booking_id)}\n• ${svc.name}, ${nice(r.starts_at)}\n\nYour booking is cancelled. Hope to see you soon!`
      : `*Your cancellation was not approved*\n\n• Booking ref: ${REF(r.booking_id)}\n• ${svc.name}, ${nice(r.starts_at)}\n\nYour booking is still on. We look forward to seeing you!`;
  } else if (r.type === 'reschedule') {
    if (approve) {
      const start = new Date(r.new_start), end = new Date(start.getTime() + svc.minutes * 60000);
      const biz = await loadBusiness(BIZ());
      const others = await q(`SELECT * FROM bookings WHERE business_id=$1 AND status <> 'cancelled' AND id <> $2`, [BIZ(), r.booking_id]);
      const timeOff = await q('SELECT * FROM time_off WHERE business_id=$1', [BIZ()]);
      if (!isFree(biz, others, timeOff, start, end, bufferOf(biz, svc.id), svc.id) && !req.body.force)
        return res.status(409).json({ error: 'The requested time is no longer free. Approve anyway to double-book, or reject.' });
      await q('UPDATE bookings SET starts_at=$1, ends_at=$2 WHERE id=$3', [start, end, r.booking_id]);
    }
    msg = approve ? `*🔄 Your new time is approved*\n\n• Booking ref: ${REF(r.booking_id)}\n• ${svc.name}\n• New time: ${nice(r.new_start)}\n\nSee you then!`
      : `*Your time change was not approved*\n\n• Booking ref: ${REF(r.booking_id)}\n• Your booking stays: ${svc.name}, ${nice(r.starts_at)}`;
  } else {
    msg = approve ? `*✅ Your request is approved*\n\n• Booking ref: ${REF(r.booking_id)}\n• Request: ${r.details}`
      : `*Your request was not approved*\n\n• Booking ref: ${REF(r.booking_id)}\n• Request: ${r.details}\n\nYour booking itself is still confirmed.`;
  }
  if (note) msg += `\n\nNote from the team: ${note}`;
  await q("UPDATE requests SET status=$1, staff_note=$2, decided_at=now() WHERE id=$3", [approve ? 'approved' : 'rejected', note || null, r.id]);
  if (r.conversation_id) await notifyCustomer(r.conversation_id, msg);
  res.json({ ok: true });
})));

// ---------- Coupons ----------
app.get('/api/coupons', wrap(async (_req, res) => res.json(await q(`SELECT id, code, kind, value::float, to_char(expires_on,'YYYY-MM-DD') AS expires_on, max_uses, uses, active
    FROM coupons WHERE business_id=$1 ORDER BY created_at DESC`, [BIZ()]))));
app.post('/api/coupons', wrap(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase().replace(/\s/g, '');
  const kind = req.body.kind === 'amount' ? 'amount' : 'percent', value = +req.body.value;
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return res.status(400).json({ error: 'Use 3–24 letters or numbers for the code.' });
  if (!(value > 0) || (kind === 'percent' && value > 100)) return res.status(400).json({ error: kind === 'percent' ? 'Percent must be between 1 and 100.' : 'Amount must be more than 0.' });
  try {
    res.json(await one(`INSERT INTO coupons (business_id, code, kind, value, expires_on, max_uses) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [BIZ(), code, kind, value, req.body.expires_on || null, +req.body.max_uses || null]));
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'That code already exists.' }); throw e; }
}));
app.patch('/api/coupons/:id', wrap(async (req, res) => {
  await q('UPDATE coupons SET active=$1 WHERE id=$2 AND business_id=$3', [!!req.body.active, req.params.id, BIZ()]);
  res.json({ ok: true });
}));

// ---------- Staff replies and take-over ----------
// Sends a staff message to the customer in their chat (WhatsApp when that's where they wrote from).
async function staffReply(conversationId, text) {
  const c = await one(`SELECT c.id, c.channel, c.business_id, cu.phone, cu.telegram_chat_id, b.wa_phone_number_id FROM conversations c
      JOIN customers cu ON cu.id=c.customer_id JOIN businesses b ON b.id=c.business_id WHERE c.id=$1 AND c.business_id=$2`, [conversationId, BIZ()]);
  if (!c) return { error: 'Conversation not found.' };
  let sent = { ok: true };
  if (c.channel === 'whatsapp') sent = await sendWhatsApp(c.wa_phone_number_id, c.phone, text);
  if (c.channel === 'telegram') sent = await sendTelegram(c.telegram_chat_id, text, c.business_id);
  await q(`INSERT INTO messages (conversation_id, role, text, failed) VALUES ($1,'staff',$2,$3)`, [c.id, text, !sent.ok]);
  await q(`UPDATE conversations SET updated_at=now(), needs_attention=false WHERE id=$1`, [c.id]);
  return { ok: sent.ok, warning: sent.ok ? null : `Saved, but not delivered: ${sent.reason}` };
}

app.post('/api/conversations/:id/reply', wrap(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Write a reply first.' });
  // Replying means a person is handling this chat now: pause the AI unless told otherwise.
  if (req.body.pause_ai !== false) await q('UPDATE conversations SET ai_paused=true WHERE id=$1 AND business_id=$2', [req.params.id, BIZ()]);
  const r = await staffReply(req.params.id, text.slice(0, 2000));
  if (r.error) return res.status(404).json(r);
  res.json(r);
}));
app.post('/api/conversations/:id/ai', wrap(async (req, res) => {
  await q('UPDATE conversations SET ai_paused=$1 WHERE id=$2 AND business_id=$3', [!!req.body.paused, req.params.id, BIZ()]);
  res.json({ ok: true });
}));

// ---------- AI Training: questions the AI couldn't answer ----------
app.get('/api/learning', wrap(async (req, res) => {
  const status = ['open', 'answered', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
  // one row per question (the latest time it was asked), with how many times: the same question is answered once
  res.json(await q(`SELECT * FROM (SELECT DISTINCT ON (lower(l.question)) l.id, l.question, l.reason, l.status, l.answer, ${LOCAL('l.created_at')} AS at, l.created_at AS sort_at, l.conversation_id, c.channel, c.ai_paused, cu.name, cu.phone,
      (SELECT count(*) FROM learning l2 WHERE l2.business_id=l.business_id AND l2.status=l.status AND lower(l2.question)=lower(l.question))::int AS times
      FROM learning l LEFT JOIN conversations c ON c.id=l.conversation_id LEFT JOIN customers cu ON cu.id=c.customer_id
      WHERE l.business_id=$1 AND l.status=$2 ORDER BY lower(l.question), l.created_at DESC) x ORDER BY sort_at DESC LIMIT 60`, [BIZ(), status]));
}));
app.post('/api/learning/:id/answer', wrap(async (req, res) => {
  const l = await one('SELECT * FROM learning WHERE id=$1 AND business_id=$2', [req.params.id, BIZ()]);
  if (!l) return res.sendStatus(404);
  const answer = String(req.body.answer || '').trim(), faqQ = String(req.body.faq_question || l.question).trim();
  if (!answer) return res.status(400).json({ error: 'Write the answer first.' });
  let warning = null;
  if (req.body.send !== false && l.conversation_id) {
    const r = await staffReply(l.conversation_id, answer);
    warning = r.warning;
    if (req.body.hand_back !== false) await q('UPDATE conversations SET ai_paused=false WHERE id=$1', [l.conversation_id]);
  }
  if (req.body.save_faq !== false) {
    const b = await one('SELECT faqs FROM businesses WHERE id=$1', [BIZ()]);
    const faqs = (b.faqs || []).filter(f => f.q.toLowerCase() !== faqQ.toLowerCase());
    faqs.push({ q: faqQ.slice(0, 300), a: answer.slice(0, 1500) });
    await q('UPDATE businesses SET faqs=$1 WHERE id=$2', [JSON.stringify(faqs.slice(-60)), BIZ()]);
  }
  // The same question asked by others is answered too.
  await q(`UPDATE learning SET status='answered', answer=$1, answered_at=now() WHERE business_id=$2 AND status='open' AND (id=$3 OR lower(question)=lower($4))`, [answer, BIZ(), l.id, l.question]);
  res.json({ ok: true, warning });
}));
app.post('/api/learning/:id/dismiss', wrap(async (req, res) => {
  // dismissing a question dismisses every open copy of it, like answering does
  await q(`UPDATE learning SET status='dismissed', answered_at=now() WHERE business_id=$2 AND status='open'
      AND (id=$1 OR lower(question)=(SELECT lower(question) FROM learning WHERE id=$1 AND business_id=$2))`, [req.params.id, BIZ()]);
  res.json({ ok: true });
}));

// ---------- Teach AI: review replies, correct them, strict rules ----------
async function addFaq(question, answer) {
  const b = await one('SELECT faqs FROM businesses WHERE id=$1', [BIZ()]);
  const faqs = (b.faqs || []).filter(f => f.q.toLowerCase() !== question.toLowerCase());
  faqs.push({ q: question.slice(0, 300), a: answer.slice(0, 1500) });
  await q('UPDATE businesses SET faqs=$1 WHERE id=$2', [JSON.stringify(faqs.slice(-60)), BIZ()]);
}

// AI replies with the customer message they answered. "todo" puts the AI's own unsure replies first.
app.get('/api/review', wrap(async (req, res) => {
  const f = ['todo', 'approved', 'corrected', 'wrong'].includes(req.query.filter) ? req.query.filter : 'todo';
  res.json(await q(`SELECT m.id, m.text AS answer, m.confidence, m.review, m.corrected_text, ${LOCAL('m.created_at')} AS at, m.conversation_id, cv.channel, cu.name, cu.phone,
      (SELECT c.text FROM messages c WHERE c.conversation_id=m.conversation_id AND c.role='customer' AND c.id < m.id ORDER BY c.id DESC LIMIT 1) AS question
      FROM messages m JOIN conversations cv ON cv.id=m.conversation_id LEFT JOIN customers cu ON cu.id=cv.customer_id
      WHERE cv.business_id=$1 AND m.role='assistant' AND m.source='ai' AND ${f === 'todo' ? 'm.review IS NULL' : 'm.review=$2'}
      ORDER BY ${f === 'todo' ? "(m.confidence='low') DESC, " : ''}m.id DESC LIMIT 60`, f === 'todo' ? [BIZ()] : [BIZ(), f]));
}));
app.get('/api/review/stats', wrap(async (_req, res) => {
  const [r] = await q(`SELECT count(*) FILTER (WHERE m.review IS NULL)::int AS todo,
      count(*) FILTER (WHERE m.review IS NULL AND m.confidence='low')::int AS low,
      count(*) FILTER (WHERE m.review='approved')::int AS approved, count(*) FILTER (WHERE m.review='corrected')::int AS corrected,
      count(*) FILTER (WHERE m.review='wrong')::int AS wrong
      FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE cv.business_id=$1 AND m.role='assistant' AND m.source='ai'`, [BIZ()]);
  const done = r.approved + r.corrected + r.wrong;
  const b = await one('SELECT ai_rules, faqs FROM businesses WHERE id=$1', [BIZ()]);
  res.json({ ...r, accuracy: done ? Math.round(100 * r.approved / done) : null, rules: (b.ai_rules || []).length, faqs: (b.faqs || []).length });
}));
// approved: a good answer the AI repeats. corrected: the owner's better answer is taught (and can go to the customer and the FAQs). wrong: marked so it isn't used.
app.post('/api/review/:id', wrap(async (req, res) => {
  const m = await one(`SELECT m.*, (SELECT c.text FROM messages c WHERE c.conversation_id=m.conversation_id AND c.role='customer' AND c.id < m.id ORDER BY c.id DESC LIMIT 1) AS question
      FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE m.id=$1 AND cv.business_id=$2 AND m.role='assistant'`, [+req.params.id, BIZ()]);
  if (!m) return res.status(404).json({ error: 'Reply not found.' });
  const verdict = ['approved', 'corrected', 'wrong', 'undo'].includes(req.body.verdict) ? req.body.verdict : null;
  if (!verdict) return res.status(400).json({ error: 'Choose approve, correct or wrong.' });
  if (verdict === 'undo') { await q('UPDATE messages SET review=NULL, corrected_text=NULL, reviewed_at=NULL WHERE id=$1', [m.id]); return res.json({ ok: true }); }
  const better = String(req.body.better || '').trim().slice(0, 1500);
  if (verdict === 'corrected' && !better) return res.status(400).json({ error: 'Write the better answer first.' });
  await q('UPDATE messages SET review=$1, corrected_text=$2, reviewed_at=now() WHERE id=$3', [verdict, verdict === 'corrected' ? better : null, m.id]);
  let warning = null;
  if (verdict === 'corrected') {
    if (req.body.send) warning = (await staffReply(m.conversation_id, better)).warning;
    if (req.body.save_faq && m.question) await addFaq(String(req.body.faq_question || m.question).trim(), better);
  }
  res.json({ ok: true, warning });
}));

app.get('/api/ai-rules', wrap(async (_req, res) => res.json((await one('SELECT ai_rules FROM businesses WHERE id=$1', [BIZ()])).ai_rules || [])));
app.put('/api/ai-rules', wrap(async (req, res) => {
  const rules = (Array.isArray(req.body.rules) ? req.body.rules : []).map(r => ({ text: String(r.text || r).trim().slice(0, 400) })).filter(r => r.text).slice(0, 40);
  await q('UPDATE businesses SET ai_rules=$1 WHERE id=$2', [JSON.stringify(rules), BIZ()]);
  res.json(rules);
}));

app.post('/api/conversations/:id/resolve', wrap(async (req, res) => {
  await q('UPDATE conversations SET needs_attention=false WHERE id=$1 AND business_id=$2', [req.params.id, BIZ()]);
  res.json({ ok: true });
}));

// ---------- Customers ----------
const realPhone = "cu.phone NOT LIKE 'test-%' AND cu.phone NOT LIKE 'e2e-%'";
app.get('/api/customers', wrap(async (req, res) => {
  const s = String(req.query.q || '').trim(), test = req.query.test === '1';
  res.json(await q(`SELECT cu.id, cu.name, cu.marketing_ok, CASE WHEN cu.phone ~ '^(test|e2e|walk-in|tg-)' THEN cu.contact_phone ELSE cu.phone END AS phone, cu.email, cu.reminder_channel, cu.staff_notes,
      to_char(cu.created_at,'YYYY-MM-DD') AS since,
      count(b.id) FILTER (WHERE b.status IN ('completed','confirmed') AND b.starts_at < now())::int AS visits,
      count(b.id) FILTER (WHERE b.status='confirmed' AND b.starts_at >= now())::int AS upcoming,
      count(b.id) FILTER (WHERE b.status='no_show')::int AS no_shows,
      COALESCE(sum(b.price) FILTER (WHERE b.status IN ('completed','confirmed')),0)::float AS spent,
      to_char(max(b.starts_at) FILTER (WHERE b.status <> 'cancelled'),'YYYY-MM-DD') AS last_booking
      FROM customers cu LEFT JOIN bookings b ON b.customer_id=cu.id
      WHERE cu.business_id=$1 ${test ? '' : 'AND ' + realPhone}
        AND ($2 = '' OR cu.name ILIKE '%'||$2||'%' OR cu.phone LIKE '%'||$2||'%' OR cu.contact_phone LIKE '%'||$2||'%' OR cu.email ILIKE '%'||$2||'%')
      GROUP BY cu.id ORDER BY max(b.starts_at) DESC NULLS LAST, cu.created_at DESC LIMIT 200`, [BIZ(), s]));
}));
app.get('/api/customers/:id', wrap(async (req, res) => {
  const c = await one('SELECT * FROM customers WHERE id=$1 AND business_id=$2', [req.params.id, BIZ()]);
  if (!c) return res.sendStatus(404);
  const bookings = await q(`SELECT b.id, ${LOCAL('b.starts_at')} AS start, b.status, b.price::float, b.source, b.coupon_code, s.name service
      FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.customer_id=$1 ORDER BY b.starts_at DESC LIMIT 50`, [c.id]);
  const convs = await q(`SELECT c.id, c.channel, ${LOCAL('c.updated_at')} AS at, (SELECT text FROM messages m WHERE m.conversation_id=c.id ORDER BY id DESC LIMIT 1) AS last
      FROM conversations c WHERE c.customer_id=$1 ORDER BY c.updated_at DESC LIMIT 20`, [c.id]);
  res.json({ ...c, bookings, conversations: convs });
}));
// ---------- Live desk: what is happening right now (polled every few seconds by the Overview) ----------
// Support: how well the AI solves what customers need. Resolved by AI = no handover and no owner reply;
// a chat counts in the period it started. Topics and kinds come from the tags the AI adds to each conversation.
app.get('/api/support', wrap(async (req, res) => {
  const B = BIZ(), P = [1, 7, 30, 90, 365].includes(+req.query.days) ? +req.query.days : 30, T = req.query.test === '0' ? `AND c.channel <> 'test'` : '';
  const base = (from, to) => `SELECT c.*, EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.role='owner') AS staff,
      (c.attention_reason IS NOT NULL OR c.outcome='handoff') AS handed FROM conversations c
      WHERE c.business_id=$1 AND c.created_at > now() - make_interval(days => ${from}) AND c.created_at <= now() - make_interval(days => ${to}) ${T}`;
  const sum = `count(*)::int AS n, count(*) FILTER (WHERE NOT handed AND NOT staff AND outcome IN ('booked','answered'))::int AS ai,
      count(*) FILTER (WHERE NOT staff)::int AS auto, round(avg(rating) FILTER (WHERE NOT staff),1)::float AS csat_ai, round(avg(rating) FILTER (WHERE staff),1)::float AS csat_you,
      round(avg(rating),1)::float AS csat, count(rating)::int AS rated`;
  const [[cur], [prev], [lat], [open], channels, kinds, topics, reasons, dist] = await Promise.all([
    q(`SELECT ${sum} FROM (${base('$2', '0')}) c`, [B, P]),
    q(`SELECT ${sum} FROM (${base('$2 * 2', '$2')}) c`, [B, P]),
    q(`SELECT round(avg(m.latency_ms))::int AS ms FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 AND m.role='assistant' AND m.latency_ms IS NOT NULL AND m.created_at > now() - make_interval(days => $2) ${T}`, [B, P]),
    q(`SELECT count(*)::int AS n FROM conversations c WHERE c.business_id=$1 AND c.needs_attention ${T}`, [B]),
    q(`SELECT channel, ${sum} FROM (${base('$2', '0')}) c GROUP BY 1 ORDER BY 2 DESC`, [B, P]),
    q(`SELECT COALESCE(kind,'untagged') AS kind, count(*)::int AS n FROM (${base('$2', '0')}) c GROUP BY 1 ORDER BY 2 DESC`, [B, P]),
    q(`SELECT t.topic, t.n, t.ai, t.csat, COALESCE(p.n,0)::int AS prev FROM
        (SELECT initcap(topic) AS topic, ${sum} FROM (${base('$2', '0')}) c WHERE topic IS NOT NULL GROUP BY 1) t
        LEFT JOIN (SELECT initcap(topic) AS topic, count(*) AS n FROM (${base('$2 * 2', '$2')}) c WHERE topic IS NOT NULL GROUP BY 1) p USING (topic)
        ORDER BY t.n DESC LIMIT 15`, [B, P]),
    q(`SELECT attention_reason AS reason, count(*)::int AS n FROM (${base('$2', '0')}) c WHERE attention_reason IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, [B, P]),
    q(`SELECT rating, count(*)::int AS n FROM (${base('$2', '0')}) c WHERE rating IS NOT NULL GROUP BY 1 ORDER BY 1 DESC`, [B, P]),
  ]);
  const pct = (a, n) => n ? Math.round(a / n * 100) : null;
  res.json({ days: P, n: cur.n, resolved: pct(cur.ai, cur.n), resolved_prev: pct(prev.ai, prev.n), automation: pct(cur.auto, cur.n), automation_prev: pct(prev.auto, prev.n),
    first_reply_ms: lat.ms, open: open.n, csat: cur.csat, csat_prev: prev.csat, csat_ai: cur.csat_ai, csat_you: cur.csat_you, rated: cur.rated,
    channels: channels.map(c => ({ channel: c.channel, n: c.n, resolved: pct(c.ai, c.n) })), kinds, reasons, dist,
    topics: topics.map(t => ({ topic: t.topic, n: t.n, prev: t.prev, resolved: pct(t.ai, t.n), csat: t.csat })) });
}));

app.get('/api/live', wrap(async (req, res) => {
  const B = BIZ();
  // The period picked on Home (Today, 7, 30 or 90 days) drives every range below except the true "now" figures.
  const P = [1, 7, 30, 90, 365].includes(+req.query.days) ? +req.query.days : 30;
  const [now] = await q(`SELECT
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 AND m.role='customer' AND m.created_at >= date_trunc('day', now()))::int AS msgs_today,
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 AND m.role='assistant' AND m.created_at >= date_trunc('day', now()))::int AS replies_today,
      (SELECT round(avg(m.latency_ms))::int FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 AND m.role='assistant' AND m.latency_ms IS NOT NULL AND m.created_at > now() - interval '24 hours') AS avg_ms,
      (SELECT count(*) FROM conversations WHERE business_id=$1 AND updated_at > now() - interval '30 minutes')::int AS active_now,
      (SELECT count(*) FROM conversations WHERE business_id=$1 AND needs_attention AND channel<>'test')::int AS waiting,
      (SELECT count(*) FROM bookings WHERE business_id=$1 AND starts_at > now() AND status='confirmed')::int AS upcoming_count,
      (SELECT COALESCE(sum(price),0)::float FROM bookings WHERE business_id=$1 AND starts_at > now() AND status='confirmed') AS upcoming_value,
      (SELECT COALESCE(sum(price),0)::float FROM bookings WHERE business_id=$1 AND status IN ('confirmed','completed') AND starts_at <= now() AND starts_at > now() - make_interval(days => $2)) AS earned,
      (SELECT COALESCE(sum(price),0)::float FROM bookings WHERE business_id=$1 AND status IN ('confirmed','completed') AND starts_at <= now() - make_interval(days => $2) AND starts_at > now() - make_interval(days => $2 * 2)) AS earned_prev,
      (SELECT count(*) FROM requests WHERE business_id=$1 AND status='pending')::int AS approvals,
      (SELECT count(*) FROM learning WHERE business_id=$1 AND status='open')::int AS to_learn,
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 AND m.role='assistant' AND m.source='ai' AND m.review IS NULL AND m.confidence='low' AND c.channel<>'test')::int AS unsure`, [B, P]);
  Object.assign(now, await metrics.today(B), await metrics.aiBookings(B, P));
  // Messages and bookings per hour, today.
  const hourly = await q(`SELECT h, COALESCE(m.n,0)::int AS msgs, COALESCE(b.n,0)::int AS booked FROM generate_series(0,23) h
      LEFT JOIN (SELECT extract(hour FROM m.created_at)::int hr, count(*) n FROM messages m JOIN conversations c ON c.id=m.conversation_id
        WHERE c.business_id=$1 AND m.role='customer' AND m.created_at >= date_trunc('day', now()) GROUP BY 1) m ON m.hr=h
      LEFT JOIN (SELECT extract(hour FROM created_at)::int hr, count(*) n FROM bookings WHERE business_id=$1 AND created_at >= date_trunc('day', now()) AND status <> 'cancelled' GROUP BY 1) b ON b.hr=h
      ORDER BY h`, [B]);
  // Where bookings come from, last 30 days.
  const channels = await q(`SELECT COALESCE(CASE WHEN b.source='ai' THEN c.channel ELSE b.source END, 'other') AS channel, count(*)::int AS n, COALESCE(sum(b.price),0)::float AS value
      FROM bookings b LEFT JOIN conversations c ON c.id=b.conversation_id WHERE b.business_id=$1 AND b.created_at > now() - make_interval(days => $2) AND b.status <> 'cancelled'
      GROUP BY 1 ORDER BY 2 DESC`, [B, P]);
  // The live stream: latest messages and bookings, newest first.
  const feed = await q(`(SELECT 'msg' AS kind, m.id, m.role, left(m.text, 220) AS text, ${LOCAL('m.created_at')} AS at, m.created_at AS ts, c.channel, c.id AS conv, cu.name, m.confidence
        FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN customers cu ON cu.id=c.customer_id
        WHERE c.business_id=$1 ORDER BY m.id DESC LIMIT 30)
      UNION ALL
      (SELECT 'booking', b.id, b.source, s.name || ' · ' || to_char(b.starts_at,'Dy DD Mon HH24:MI') || ' · ' || b.price::float, ${LOCAL('b.created_at')}, b.created_at, b.source, b.conversation_id, cu.name, b.status
        FROM bookings b JOIN services s ON s.id=b.service_id JOIN customers cu ON cu.id=b.customer_id WHERE b.business_id=$1 ORDER BY b.id DESC LIMIT 10)
      ORDER BY ts DESC LIMIT 30`, [B]);
  // Open conversations: who is talking to us and how it is going.
  const active = await q(`SELECT c.id, c.channel, c.outcome, c.needs_attention, c.ai_paused, ${LOCAL('c.updated_at')} AS at, cu.name,
      CASE WHEN cu.phone ~ '^(test|e2e|walk-in|tg-)' THEN cu.contact_phone ELSE cu.phone END AS phone,
      (SELECT count(*) FROM messages m WHERE m.conversation_id=c.id)::int AS msgs,
      (SELECT left(text, 90) FROM messages m WHERE m.conversation_id=c.id ORDER BY id DESC LIMIT 1) AS last, c.value::float
      FROM conversations c LEFT JOIN customers cu ON cu.id=c.customer_id WHERE c.business_id=$1 AND c.updated_at > now() - make_interval(days => $2)
      ORDER BY c.needs_attention DESC, c.updated_at DESC LIMIT 12`, [B, P]);
  const upcoming = await q(`SELECT b.id, ${LOCAL('b.starts_at')} AS start, s.name AS service, s.minutes, cu.name, b.price::float, b.source, b.status
      FROM bookings b JOIN services s ON s.id=b.service_id JOIN customers cu ON cu.id=b.customer_id
      WHERE b.business_id=$1 AND b.starts_at > now() AND b.status='confirmed' ORDER BY b.starts_at LIMIT 8`, [B]);
  // ---- richer desk data ----
  const biz = await loadBusiness(B);
  // Micro charts: last 24 hours of messages (and failed replies), last 14 days of bookings and booked value.
  const h24 = await q(`SELECT g AS slot, COALESCE(x.msgs,0)::int AS msgs, COALESCE(x.failed,0)::int AS failed, x.ms::int AS ms
      FROM generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') g
      LEFT JOIN (SELECT date_trunc('hour', m.created_at) h, count(*) FILTER (WHERE m.role='customer') msgs, count(*) FILTER (WHERE m.failed) failed,
        avg(m.latency_ms) FILTER (WHERE m.role='assistant') ms FROM messages m JOIN conversations c ON c.id=m.conversation_id
        WHERE c.business_id=$1 AND m.created_at > now() - interval '24 hours' GROUP BY 1) x ON x.h=g ORDER BY g`, [B]);
  const d14 = await q(`SELECT to_char(g,'YYYY-MM-DD') AS d, COALESCE(x.n,0)::int AS n, COALESCE(x.v,0)::float AS v
      FROM generate_series(current_date - ($2::int - 1), current_date, interval '1 day') g
      LEFT JOIN (SELECT created_at::date dd, count(*) n, sum(price) v FROM bookings WHERE business_id=$1 AND status <> 'cancelled' AND created_at > current_date - $2::int GROUP BY 1) x ON x.dd=g::date
      ORDER BY g`, [B, Math.max(P, 2) * 2]);
  // This week, Monday to Sunday: booked minutes against open minutes per day (capsule bars) and today's capacity (gauge).
  const mon = new Date(); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const wk = await q(`SELECT starts_at, ends_at FROM bookings WHERE business_id=$1 AND status <> 'cancelled' AND starts_at >= $2 AND starts_at < $2::timestamptz + interval '7 days'`, [B, mon]);
  const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const week = [...Array(7)].map((_, i) => {
    const day = new Date(mon); day.setDate(mon.getDate() + i);
    const open = (biz.hours?.[day.getDay()] || []).reduce((a, [x, y]) => a + toMin(y) - toMin(x), 0) * (biz.capacity || 1);
    const booked = wk.filter(b => new Date(b.starts_at).toDateString() === day.toDateString()).reduce((a, b) => a + (new Date(b.ends_at) - new Date(b.starts_at)) / 60000, 0);
    return { d: localDate(day), open, booked: Math.round(booked), pct: open ? Math.min(100, Math.round(booked / open * 100)) : null, today: day.toDateString() === new Date().toDateString() };
  });
  // From channel to result, last 30 days (flow chart).
  const flow = await q(`SELECT c.channel, COALESCE(c.outcome,'answered') AS outcome, count(*)::int AS n FROM conversations c
      WHERE c.business_id=$1 AND c.updated_at > now() - make_interval(days => $2) GROUP BY 1,2`, [B, P]);
  // Busiest moments: messages by weekday and hour, last 30 days (heat grid).
  const heat = await q(`SELECT extract(isodow FROM m.created_at)::int AS dow, extract(hour FROM m.created_at)::int AS h, count(*)::int AS n
      FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 AND m.role='customer' AND m.created_at > now() - make_interval(days => $2) GROUP BY 1,2`, [B, Math.max(P, 7)]);
  // Getting started: what is still missing for this business to run on its own.
  const ch = await one(`SELECT (telegram_token IS NOT NULL) tg, (wa_phone_number_id IS NOT NULL) wa, (owner_telegram_chat IS NOT NULL) alerts,
      jsonb_array_length(COALESCE(ai_rules,'[]')) rules, jsonb_array_length(COALESCE(faqs,'[]')) faqs, description, address FROM businesses WHERE id=$1`, [B]);
  const setup = [
    { key: 'profile', label: 'Describe the business and its address', done: !!(ch.description && ch.address), view: 'setup' },
    { key: 'services', label: 'Add services with prices and durations', done: biz.services.length > 0, view: 'setup' },
    { key: 'channel', label: 'Connect WhatsApp or Telegram', done: ch.tg || ch.wa, view: 'setup' },
    { key: 'faq', label: 'Teach at least 3 answers (FAQs)', done: ch.faqs >= 3, view: 'training' },
    { key: 'rules', label: 'Set one strict rule for the AI', done: ch.rules > 0, view: 'training' },
    { key: 'alerts', label: 'Get instant alerts on your phone', done: ch.alerts, view: 'bell' },
  ];
  res.json({ now, ai: { ok: aiHealth.ok, ms: aiHealth.ms, error: aiHealth.error }, hourly, channels, feed, active, upcoming,
    h24, d14, week, flow, heat, setup, days: P, currency: biz.currency || 'USD', server_time: localStamp(new Date()) });
}));

// ---------- Notification center ----------
app.get('/api/notifications', wrap(async (req, res) => {
  const list = await q(`SELECT id, kind, title, body, conversation_id, booking_id, ${LOCAL('created_at')} AS at, read_at IS NOT NULL AS read
      FROM notifications WHERE business_id=$1 AND ($2::bigint = 0 OR id > $2) ORDER BY id DESC LIMIT 60`, [BIZ(), +req.query.after || 0]);
  const [{ n }] = await q('SELECT count(*)::int AS n FROM notifications WHERE business_id=$1 AND read_at IS NULL', [BIZ()]);
  res.json({ items: list, unread: n });
}));
app.post('/api/notifications/read', wrap(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean);
  await q(`UPDATE notifications SET read_at=now() WHERE business_id=$1 AND read_at IS NULL AND ($2 OR id = ANY($3))`, [BIZ(), !!req.body.all, ids]);
  res.json({ ok: true });
}));
app.get('/api/notifications/settings', wrap(async (_req, res) => {
  const b = await one('SELECT alert_kinds, owner_telegram_chat IS NOT NULL AS linked FROM businesses WHERE id=$1', [BIZ()]);
  res.json({ kinds: KINDS, on: b.alert_kinds || [], telegram_linked: b.linked, bot: telegramStatus(BIZ()).bot || null });
}));
app.put('/api/notifications/settings', wrap(async (req, res) => {
  const on = (Array.isArray(req.body.on) ? req.body.on : []).filter(k => KINDS[k]);
  await q('UPDATE businesses SET alert_kinds=$1 WHERE id=$2', [JSON.stringify(on), BIZ()]);
  if (req.body.unlink) await q('UPDATE businesses SET owner_telegram_chat=NULL WHERE id=$1', [BIZ()]);
  res.json({ ok: true });
}));
app.post('/api/notifications/link-telegram', wrap(async (_req, res) => {
  const bot = telegramStatus(BIZ()).bot;
  if (!bot) return res.status(400).json({ error: "Connect this business's Telegram bot first (Setup, Channels)." });
  res.json({ code: await ownerLinkCode(BIZ()), bot });
}));

// ---------- Tools: buffer time and payment options ----------
app.get('/api/tools', wrap(async (_req, res) => {
  const b = await loadBusiness(BIZ());
  res.json({ buffer_minutes: b.buffer_minutes || 0, pay_later: !!b.pay_later, pay_now: !!b.pay_now, pay_deposit: !!b.pay_deposit, deposit_amount: +b.deposit_amount || 0,
    payment_link: b.payment_link || '', deposit_for: b.deposit_for || 'risky',
    currency: b.currency || 'USD', payments_live: !!process.env.PAYMENTS_LIVE,
    services: b.services.map(s => ({ id: s.id, name: s.name, minutes: s.minutes, buffer_minutes: s.buffer_minutes })) });
}));
app.put('/api/tools', wrap(async (req, res) => {
  const b = req.body, clampMin = v => Math.min(Math.max(Math.round(+v || 0), 0), 240);
  const link = /^https:\/\/\S{4,300}$/.test(String(b.payment_link || '').trim()) ? String(b.payment_link).trim() : null;
  const live = !!process.env.PAYMENTS_LIVE;
  // Online payment stays off until a payment provider is connected; a reservation fee also works with the owner's own payment link.
  await q(`UPDATE businesses SET buffer_minutes=$1, pay_later=$2, pay_now=$3, pay_deposit=$4, deposit_amount=$5, payment_link=$6, deposit_for=$7 WHERE id=$8`,
    [clampMin(b.buffer_minutes), !!b.pay_later, live && !!b.pay_now, (live || !!link) && !!b.pay_deposit, Math.max(0, +b.deposit_amount || 0), link, b.deposit_for === 'all' ? 'all' : 'risky', BIZ()]);
  for (const s of Array.isArray(b.services) ? b.services : [])
    await q('UPDATE services SET buffer_minutes=$1 WHERE id=$2 AND business_id=$3', [s.buffer_minutes === '' || s.buffer_minutes === null || s.buffer_minutes === undefined ? null : clampMin(s.buffer_minutes), +s.id, BIZ()]);
  await audit(req, 'tools_saved', `buffer ${clampMin(b.buffer_minutes)}m, pay later ${!!b.pay_later}`);
  res.json({ ok: true, payments_live: live });
}));

// ---------- Marketing: offers to clients who agreed ----------
// Segment = who gets it. Only opted-in clients are ever counted or sent to.
// everyone = also clients who haven't agreed (only to size an audience; sending always uses consenting clients)
async function segmentOf(seg = {}, everyone = false) {
  const type = ['all', 'inactive', 'service', 'regulars', 'new'].includes(seg.type) ? seg.type : 'all';
  const days = Math.min(Math.max(+seg.days || 60, 7), 730), min = Math.min(Math.max(+seg.min || 3, 2), 50);
  return q(`SELECT cu.id, cu.name, cu.phone, cu.telegram_chat_id,
      (SELECT c.channel FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1) AS channel,
      (SELECT c.id FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1) AS conv_id,
      (SELECT max(m.created_at) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.customer_id=cu.id AND m.role='customer') AS last_msg
      FROM customers cu WHERE cu.business_id=$1 AND (cu.marketing_ok OR $6) AND cu.phone !~ '^(test|e2e|walk-in)'
      AND NOT (EXISTS (SELECT 1 FROM conversations x WHERE x.customer_id=cu.id AND x.channel='test') AND NOT EXISTS (SELECT 1 FROM conversations x WHERE x.customer_id=cu.id AND x.channel<>'test'))
      AND CASE $2
        WHEN 'inactive' THEN NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id=cu.id AND b.starts_at > now() - make_interval(days => $3))
          AND EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id=cu.id AND b.status IN ('confirmed','completed'))
        WHEN 'service' THEN EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id=cu.id AND b.service_id=$4 AND b.status <> 'cancelled')
        WHEN 'regulars' THEN (SELECT count(*) FROM bookings b WHERE b.customer_id=cu.id AND b.status IN ('confirmed','completed')) >= $5
        WHEN 'new' THEN (SELECT min(b.starts_at) FROM bookings b WHERE b.customer_id=cu.id AND b.status IN ('confirmed','completed')) > now() - make_interval(days => $3)
        ELSE true END`, [BIZ(), type, days, +seg.service_id || 0, min, everyone]);
}
// Which channel can carry an offer right now. WhatsApp only inside 24h of the client's last message (templates come later).
function marketingRoute(c) {
  if (c.channel === 'telegram' && c.telegram_chat_id) return 'telegram';
  if (c.channel === 'webook') return 'webook';
  if (c.channel === 'whatsapp') return c.last_msg && Date.now() - new Date(c.last_msg) < 23.5 * 3600e3 ? 'whatsapp' : null;
  return null;
}
// Campaign studio: five ready-to-send drafts built from this business's own numbers. Each has its audience (the same
// segments the Offers form uses), who is reachable right now, a message with a code and deadline, and a profit estimate:
// expected bookings = reachable x a typical reply rate; discount cost = expected revenue x the discount.
app.get('/api/marketing/studio', wrap(async (_req, res) => {
  const biz = await loadBusiness(BIZ()), cur = biz.currency || 'USD', money = v => `${cur === 'USD' ? '$' : cur + ' '}${Math.round(v)}`;
  const [st] = await q(`SELECT COALESCE(avg(price),0)::float AS ticket,
      (SELECT s.id FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.business_id=$1 AND b.status IN ('confirmed','completed') GROUP BY s.id ORDER BY sum(b.price) DESC LIMIT 1) AS top_service,
      (SELECT extract(dow FROM starts_at)::int FROM bookings WHERE business_id=$1 AND status IN ('confirmed','completed') AND starts_at > now() - interval '60 days' GROUP BY 1 ORDER BY count(*) ASC LIMIT 1) AS quiet_dow,
      (SELECT count(*) FROM customers cu WHERE business_id=$1 AND phone !~ '^(test|e2e|walk-in)' AND NOT (EXISTS (SELECT 1 FROM conversations x WHERE x.customer_id=cu.id AND x.channel='test') AND NOT EXISTS (SELECT 1 FROM conversations x WHERE x.customer_id=cu.id AND x.channel<>'test')))::int AS clients,
      (SELECT count(*) FROM customers WHERE business_id=$1 AND marketing_ok AND phone !~ '^(test|e2e|walk-in)')::int AS opted
      FROM bookings WHERE business_id=$1 AND status IN ('confirmed','completed') AND starts_at > now() - interval '90 days'`, [BIZ()]);
  const svc = biz.services.find(s => s.id === st.top_service) || biz.services[0], DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const end = new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const quiet = st.quiet_dow != null ? DAY[st.quiet_dow] : 'Tuesday', t = st.ticket || svc?.price || 0;
  const drafts = [
    { id: 'winback', name: 'We miss you', goal: 'Bring back clients who stopped coming', segment: { type: 'inactive', days: 60 }, audience: 'Clients with no visit in 60 days', pct: 15, code: 'BACK15', rate: 0.15,
      message: `It's been a while! Come back to ${biz.name} this week and get 15% off any service with code BACK15. Valid until ${end}. Reply here to book.` },
    { id: 'quiet', name: `${quiet} special`, goal: `Fill your quietest day (${quiet})`, segment: { type: 'all' }, audience: 'Everyone who agreed to offers', pct: 20, code: `${quiet.slice(0, 3).toUpperCase()}20`, rate: 0.08,
      message: `${quiet}s just got better: 20% off at ${biz.name} every ${quiet} with code ${quiet.slice(0, 3).toUpperCase()}20, until ${end}. Reply with a time and we'll book you.` },
    { id: 'second', name: 'Second visit', goal: 'Turn new clients into regulars', segment: { type: 'new', days: 30 }, audience: 'Clients who joined in the last 30 days', pct: 10, code: 'NEXT10', rate: 0.2,
      message: `Thanks for choosing ${biz.name}! Your next visit is 10% off with code NEXT10, valid until ${end}. Want us to find you a time?` },
    svc && { id: 'hero', name: `Spotlight: ${svc.name}`, goal: `Sell more of your best earner (${svc.name})`, segment: { type: 'all' }, audience: 'Everyone who agreed to offers', pct: 10, code: 'STAR10', rate: 0.06,
      message: `Our most-loved service, ${svc.name} (${svc.minutes} min, ${money(svc.price)}), is 10% off this week with code STAR10, until ${end}. Reply to grab a slot.`, price: svc.price },
    { id: 'vip', name: 'Thank you, regulars', goal: 'Reward loyal clients so they keep coming', segment: { type: 'regulars', min: 3 }, audience: 'Clients with 3+ visits', pct: 0, code: null, rate: 0.25,
      message: `You're one of our favourite clients at ${biz.name}. As a thank-you, you get first pick of next week's times. Reply and we'll hold one for you.` },
  ].filter(Boolean);
  const recent = await q(`SELECT name, sent, created_at FROM campaigns WHERE business_id=$1 AND created_at > now() - interval '7 days' ORDER BY id DESC`, [BIZ()]);
  for (const d of drafts) {
    const ran = recent.find(c => c.name === d.name); if (ran) d.ran = { sent: ran.sent, at: ran.created_at };
    const list = await segmentOf(d.segment), reachable = list.filter(marketingRoute).length, price = d.price || t, size = (await segmentOf(d.segment, true)).length;
    const bookings = reachable * d.rate, revenue = bookings * price, cost = revenue * d.pct / 100, pot = size * d.rate * price * (1 - d.pct / 100);
    Object.assign(d, { size, potential: Math.round(pot), matched: list.length, reachable, estimate: { bookings: Math.round(bookings * 10) / 10, revenue: Math.round(revenue), discount_cost: Math.round(cost), net: Math.round(revenue - cost), reply_rate: Math.round(d.rate * 100) },
      warning: d.pct > 20 ? 'Over 20% off often costs more than it brings in.' : null });
  }
  res.json({ drafts: drafts.sort((a, b) => b.estimate.net - a.estimate.net || b.potential - a.potential), audience: { clients: st.clients, opted: st.opted }, ticket: Math.round(t), currency: cur });
}));
app.post('/api/marketing/preview', wrap(async (req, res) => {
  const list = await segmentOf(req.body.segment);
  const by = {}; let reachable = 0;
  for (const c of list) { const r = marketingRoute(c) || 'not reachable now'; by[r] = (by[r] || 0) + 1; if (marketingRoute(c)) reachable++; }
  const [{ total, opted }] = await q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE marketing_ok)::int AS opted FROM customers WHERE business_id=$1 AND phone !~ '^(test|e2e|walk-in)'`, [BIZ()]);
  res.json({ matched: list.length, reachable, by_channel: by, opted_in: opted, clients: total });
}));
app.post('/api/marketing/send', wrap(async (req, res) => {
  const message = String(req.body.message || '').trim().slice(0, 900);
  if (message.length < 5) return res.status(400).json({ error: 'Write the offer first.' });
  const biz = await loadBusiness(BIZ()), list = await segmentOf(req.body.segment);
  const text = `${message}\n\n${biz.name}. Reply STOP to stop offers.`;
  const camp = await one(`INSERT INTO campaigns (business_id, name, message, segment, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [BIZ(), String(req.body.name || 'Offer').slice(0, 80), message, JSON.stringify(req.body.segment || {}), req.user.email]);
  let sent = 0, skipped = 0;
  for (const c of list) {
    // Never more than one offer per client per 24 hours.
    const recent = await one(`SELECT 1 FROM campaign_sends s JOIN campaigns k ON k.id=s.campaign_id WHERE s.customer_id=$1 AND s.status='sent' AND s.at > now() - interval '24 hours'`, [c.id]);
    const route = recent ? null : marketingRoute(c);
    let status = recent ? 'skipped: had an offer today' : route ? 'sent' : 'skipped: not reachable now';
    if (route === 'telegram') { const r = await sendTelegram(c.telegram_chat_id, text, BIZ()); if (!r.ok) status = 'failed: ' + r.reason; }
    if (route === 'whatsapp') { const r = await sendWhatsApp(biz.wa_phone_number_id, c.phone, text); if (!r.ok) status = 'failed: ' + r.reason; }
    if (route && status === 'sent') {
      await q(`INSERT INTO messages (conversation_id, role, text, source) VALUES ($1,'staff',$2,'campaign')`, [c.conv_id, text]);
      await q('UPDATE conversations SET updated_at=now() WHERE id=$1', [c.conv_id]);
    }
    await q('INSERT INTO campaign_sends (campaign_id, customer_id, channel, status) VALUES ($1,$2,$3,$4)', [camp.id, c.id, route, status]);
    status === 'sent' ? sent++ : skipped++;
  }
  await q('UPDATE campaigns SET sent=$1, skipped=$2 WHERE id=$3', [sent, skipped, camp.id]);
  await audit(req, 'campaign_sent', `${req.body.name || 'Offer'}: ${sent} sent, ${skipped} skipped`);
  await notify(BIZ(), 'marketing', `Offer sent to ${sent} client${sent === 1 ? '' : 's'}`, skipped ? `${skipped} skipped (no consent channel open or already contacted today)` : null);
  res.json({ sent, skipped });
}));
app.get('/api/marketing/campaigns', wrap(async (_req, res) => res.json(await q(`SELECT id, name, message, sent, skipped, created_by, ${LOCAL('created_at')} AS at,
    (SELECT count(DISTINCT b.customer_id) FROM campaign_sends cs JOIN bookings b ON b.customer_id=cs.customer_id AND b.status IN ('confirmed','completed') AND b.created_at BETWEEN cs.at AND cs.at + interval '14 days' WHERE cs.campaign_id=campaigns.id)::int AS booked,
    (SELECT COALESCE(sum(b.price),0) FROM campaign_sends cs JOIN bookings b ON b.customer_id=cs.customer_id AND b.status IN ('confirmed','completed') AND b.created_at BETWEEN cs.at AND cs.at + interval '14 days' WHERE cs.campaign_id=campaigns.id)::float AS revenue
    FROM campaigns WHERE business_id=$1 ORDER BY id DESC LIMIT 30`, [BIZ()]))));
app.post('/api/customers/:id/offers', wrap(async (req, res) => {
  await q('UPDATE customers SET marketing_ok=$1, marketing_at=now() WHERE id=$2 AND business_id=$3', [!!req.body.on, +req.params.id, BIZ()]);
  await audit(req, 'consent_changed', `client ${req.params.id}: offers ${req.body.on ? 'on' : 'off'}`);
  res.json({ ok: true });
}));

app.put('/api/customers/:id', wrap(async (req, res) => {
  const b = req.body, email = String(b.email || '').trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Check the email address.' });
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Add a name.' });
  await q(`UPDATE customers SET name=$1, email=NULLIF($2,''), reminder_channel=$3, staff_notes=NULLIF($4,'') WHERE id=$5 AND business_id=$6`,
    [String(b.name).trim(), email, ['whatsapp', 'sms', 'email'].includes(b.reminder_channel) ? b.reminder_channel : 'whatsapp', String(b.staff_notes || '').trim(), req.params.id, BIZ()]);
  const u = await unify(BIZ(), +req.params.id);
  res.json({ ok: true, merged_into: u && u.id !== +req.params.id ? u.id : null });
}));

// ---------- WeBook demo businesses ----------
app.get('/api/channels', wrap(async (_req, res) => {
  const b = await one('SELECT telegram_token IS NOT NULL AS tg FROM businesses WHERE id=$1', [BIZ()]);
  res.json({ telegram: { ...telegramStatus(BIZ()), configured: !!b?.tg }, whatsapp: { configured: whatsappReady(), via: process.env.KAPSO_API_KEY ? 'Kapso' : 'Meta' } });
}));
// Each business connects its own Telegram bot (token from @BotFather); an empty token disconnects it.
app.put('/api/channels/telegram', wrap(async (req, res) => {
  const r = await connectTelegram(BIZ(), req.body.token);
  r.ok ? res.json(r) : res.status(400).json({ error: r.error || 'Could not connect the bot.' });
}));
app.get('/api/webook-demo', wrap(async (_req, res) => res.json(await one('SELECT count(*)::int AS n FROM businesses WHERE is_demo'))));
app.post('/api/webook-demo/remove', wrap(async (_req, res) => res.json({ removed: await removeDemo() })));
app.post('/api/webook-demo/add', wrap(async (_req, res) => res.json({ added: await seedDemo({ force: true }) })));

// ---------- Insights ----------
app.put('/api/insights/goal', wrap(async (req, res) => {
  const v = Math.round(+req.body.goal || 0); await q('UPDATE businesses SET revenue_goal=$1 WHERE id=$2', [v > 0 ? v : null, BIZ()]); res.json({ ok: true });
}));
app.get('/api/insights', wrap(async (req, res) => res.json(await insights(BIZ(), Math.min(Math.max(+req.query.days || 30, 1), 365)))));

// ---------- Reminders ----------
app.post('/api/reminders/run', wrap(async (_req, res) => res.json({ checked: await runReminders() })));
app.post('/api/reminders/preview', wrap(async (req, res) => {
  const b = await loadBusiness(BIZ());
  res.json({ text: fill(String(req.body.text || b.reminder_text), { id: 42, customer: 'Rana Khalil', service: b.services[0]?.name || 'Haircut', business: b.name,
    starts_at: new Date(Date.now() + 24 * 3600e3).setMinutes(0, 0, 0) }) });
}));

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Something went wrong' }); });
process.on('unhandledRejection', e => console.error('Unhandled:', e));

await migrate();
await ensureAdmin();
await seedPlans();
unifyAll().catch(e => console.error('Client merge:', e.message));
backfillMedia().catch(e => console.error('Media backfill:', e.message));
if (process.env.WEBOOK_DEMO !== '0') seedDemo().then(n => n && console.log(`Added ${n} demo businesses to WeBook`)).catch(e => console.error('Demo seed:', e.message));
const PORT = process.env.PORT || 3100;
app.listen(PORT, () => console.log(`Ringback running on http://localhost:${PORT}`));
// PREVIEW_ONLY: a second copy for checking changes against the real data; it sends nothing and runs no background jobs
const LIVE = !process.env.PREVIEW_ONLY;
if (LIVE) startReminders();
if (LIVE) startAiQueue(async ({ channel, businessId, phone, reply, options }) => {
  if (channel === 'whatsapp') {
    const b = await one('SELECT wa_phone_number_id FROM businesses WHERE id=$1', [businessId]);
    if (b?.wa_phone_number_id) await sendWhatsApp(b.wa_phone_number_id, phone, reply, options);
  } else if (channel === 'telegram') {
    const c = await one('SELECT telegram_chat_id FROM customers WHERE business_id=$1 AND phone=$2', [businessId, phone]);
    if (c?.telegram_chat_id) await sendTelegram(c.telegram_chat_id, reply, businessId, options);
  }
});
await sealExistingSecrets().catch(e => console.error('Encrypt secrets:', e.message));
if (LIVE) startTelegram();
if (LIVE) startMonitor(aiHealth);
