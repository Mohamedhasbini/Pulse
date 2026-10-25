// Running the platform safely: encrypted secrets, per-client usage, export and closing a client,
// photo/file uploads kept per business, and health checks that alert the platform admin.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { q, one, pool } from './db.js';

/* ---------- secrets at rest (bot tokens) ---------- */
// DATA_KEY in .env (64 hex chars). Without it a key is derived from ADMIN_PASSWORD, like the session key.
const DATA_KEY = /^[0-9a-f]{64}$/i.test(process.env.DATA_KEY || '') ? Buffer.from(process.env.DATA_KEY, 'hex')
  : crypto.createHash('sha256').update((process.env.ADMIN_PASSWORD || 'ringback') + ':data-key').digest();
export function seal(text) {
  if (text == null || text === '') return text;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', DATA_KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'enc:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function unseal(v) {
  if (!v || !String(v).startsWith('enc:')) return v;
  const b = Buffer.from(String(v).slice(4), 'base64'), d = crypto.createDecipheriv('aes-256-gcm', DATA_KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
// Stable fingerprint, so "is this bot already used by another business?" works without decrypting everything.
export const fingerprint = v => crypto.createHmac('sha256', DATA_KEY).update(String(v)).digest('hex');
// One-time: encrypt tokens saved before encryption existed.
export async function sealExistingSecrets() {
  for (const b of await q(`SELECT id, telegram_token FROM businesses WHERE telegram_token IS NOT NULL AND telegram_token NOT LIKE 'enc:%'`))
    await q('UPDATE businesses SET telegram_token=$1, telegram_token_hash=$2 WHERE id=$3', [seal(b.telegram_token), fingerprint(b.telegram_token), b.id]);
}

/* ---------- uploads: one folder per business ---------- */
export const UPLOADS = process.env.UPLOADS_DIR || '/data/uploads';
const KINDS = { logo: 'logo_url', cover: 'cover_url', menu: 'menu_url' };
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
export function mountMedia(app) {
  // Public: logos, covers and menus are shown on WeBook and the booking page.
  app.get('/media/:biz/:file', (req, res) => {
    const biz = String(+req.params.biz), file = path.basename(req.params.file);
    if (!/^\d+$/.test(biz) || !/^[\w.-]+$/.test(file)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400').sendFile(path.join(UPLOADS, biz, file), err => err && !res.headersSent && res.status(404).end());
  });
}
// Signed-in owners upload to their own business only (BIZ comes from the login).
export function mountUploads(app, BIZ, audit) {
  app.post('/api/business/upload/:kind', express.raw({ type: Object.keys(TYPES), limit: '8mb' }), async (req, res, next) => {
    try {
      const col = KINDS[req.params.kind], ext = TYPES[req.get('content-type')];
      if (!col) return res.status(400).json({ error: 'Unknown upload.' });
      if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Upload a JPG, PNG, WEBP image or a PDF (max 8 MB).' });
      if (req.params.kind !== 'menu' && ext === 'pdf') return res.status(400).json({ error: 'Use an image for the logo and cover.' });
      const biz = BIZ(), dir = path.join(UPLOADS, String(biz)), name = `${req.params.kind}-${Date.now()}.${ext}`;
      fs.mkdirSync(dir, { recursive: true });
      const old = (await one(`SELECT ${col} AS u FROM businesses WHERE id=$1`, [biz]))?.u;
      fs.writeFileSync(path.join(dir, name), req.body);
      const url = `/media/${biz}/${name}`;
      await q(`UPDATE businesses SET ${col}=$1 WHERE id=$2`, [url, biz]);
      if (old?.startsWith(`/media/${biz}/`)) fs.rm(path.join(dir, path.basename(old)), { force: true }, () => {});
      await audit(req, 'upload', `${req.params.kind} ${Math.round(req.body.length / 1024)} KB`);
      res.json({ ok: true, url });
    } catch (e) { next(e); }
  });
  app.delete('/api/business/upload/:kind', async (req, res, next) => {
    try {
      const col = KINDS[req.params.kind]; if (!col) return res.status(400).json({ error: 'Unknown upload.' });
      const biz = BIZ(), old = (await one(`SELECT ${col} AS u FROM businesses WHERE id=$1`, [biz]))?.u;
      await q(`UPDATE businesses SET ${col}=NULL WHERE id=$1`, [biz]);
      if (old?.startsWith(`/media/${biz}/`)) fs.rm(path.join(UPLOADS, String(biz), path.basename(old)), { force: true }, () => {});
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}

/* ---------- usage and cost per client ---------- */
// Rough unit costs, editable in .env when prices change.
const COST_AI = +process.env.COST_PER_AI_REPLY || 0.001;      // Gemini Flash-Lite, one reply with full business context
const COST_WA = +process.env.COST_PER_WA_TEMPLATE || 0.02;    // WhatsApp message sent outside the 24 h window (reminders, offers)
export async function usage(days = 30) {
  const rows = await q(`SELECT b.id, b.name, b.plan_key, b.is_demo,
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=b.id AND m.role='assistant' AND m.source='ai' AND m.created_at > now() - make_interval(days => $1))::int AS ai_replies,
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=b.id AND m.role='customer' AND m.created_at > now() - make_interval(days => $1))::int AS customer_messages,
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=b.id AND c.channel='whatsapp' AND m.role IN ('assistant','staff') AND m.created_at > now() - make_interval(days => $1))::int AS wa_replies,
      ((SELECT count(*) FROM bookings k WHERE k.business_id=b.id AND k.reminder_sent_at > now() - make_interval(days => $1))
        + (SELECT count(*) FROM campaign_sends s JOIN campaigns c ON c.id=s.campaign_id WHERE c.business_id=b.id AND s.channel='whatsapp' AND s.status='sent' AND s.at > now() - make_interval(days => $1)))::int AS wa_outbound,
      (SELECT count(*) FROM bookings k WHERE k.business_id=b.id AND k.created_at > now() - make_interval(days => $1) AND k.status <> 'cancelled')::int AS bookings,
      COALESCE((SELECT price FROM plans p WHERE p.key=b.plan_key), 0)::float AS plan_price
    FROM businesses b ORDER BY b.is_demo, b.name`, [days]);
  return rows.map(r => {
    const cost = Math.round((r.ai_replies * COST_AI + r.wa_outbound * COST_WA) * 100) / 100;
    return { ...r, est_cost: cost, margin: Math.round((r.plan_price * days / 30 - cost) * 100) / 100 };
  });
}

/* ---------- export and close a client ---------- */
const TENANT_TABLES = ['services', 'customers', 'conversations', 'bookings', 'time_off', 'requests', 'coupons', 'learning', 'reviews', 'notifications', 'campaigns'];
export async function exportBusiness(id) {
  const biz = await one('SELECT * FROM businesses WHERE id=$1', [id]);
  if (!biz) return null;
  delete biz.telegram_token; delete biz.telegram_token_hash;
  const out = { exported_at: new Date().toISOString(), business: biz };
  for (const t of TENANT_TABLES) out[t] = await q(`SELECT * FROM ${t} WHERE business_id=$1 ORDER BY id`, [id]);
  out.messages = await q('SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 ORDER BY m.id', [id]);
  out.campaign_sends = await q('SELECT s.* FROM campaign_sends s JOIN campaigns c ON c.id=s.campaign_id WHERE c.business_id=$1 ORDER BY s.id', [id]);
  out.logins = await q('SELECT id, email, name, role, permissions, created_at, last_login_at FROM users WHERE business_id=$1', [id]);
  return out;
}
// Deletes the business and everything that belongs to it, in one transaction. Uploaded files go too.
export async function closeBusiness(id) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE business_id=$1)', [id]);
    await c.query('DELETE FROM campaign_sends WHERE campaign_id IN (SELECT id FROM campaigns WHERE business_id=$1)', [id]);
    for (const t of ['requests', 'reviews', 'bookings', 'learning', 'notifications', 'campaigns', 'coupons', 'time_off', 'conversations', 'customers', 'services'])
      await c.query(`DELETE FROM ${t} WHERE business_id=$1`, [id]);
    await c.query('DELETE FROM users WHERE business_id=$1', [id]);
    const r = await c.query('DELETE FROM businesses WHERE id=$1 RETURNING name', [id]);
    await c.query('COMMIT');
    fs.rm(path.join(UPLOADS, String(id)), { recursive: true, force: true }, () => {});
    return r.rows[0]?.name || null;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

/* ---------- health checks and alerts to the platform admin ---------- */
const BACKUPS = process.env.BACKUPS_DIR || '/backups';
export function lastBackup() {
  try {
    const f = fs.readdirSync(BACKUPS).filter(x => x.endsWith('.sql.gz')).map(x => ({ x, t: fs.statSync(path.join(BACKUPS, x)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
    return f ? { file: f.x, at: new Date(f.t).toISOString(), hours: Math.round((Date.now() - f.t) / 36e5 * 10) / 10, count: fs.readdirSync(BACKUPS).filter(x => x.endsWith('.sql.gz')).length } : null;
  } catch { return null; }
}
async function alertAdmin(text) {
  const token = process.env.ALERT_BOT_TOKEN, chat = process.env.ALERT_CHAT_ID;
  console.warn('[alert]', text);
  await q(`INSERT INTO audit_log (action, detail) VALUES ('system_alert', $1)`, [text.slice(0, 500)]).catch(() => {});
  if (token && chat) await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: '⚠️ Pulse: ' + text }) }).catch(e => console.error('alert send failed:', e.message));
}
export async function health(aiHealth) {
  const checks = [];
  try { await one('SELECT 1'); checks.push({ name: 'Database', ok: true }); } catch (e) { checks.push({ name: 'Database', ok: false, detail: e.message }); }
  const a = aiHealth || {};
  checks.push({ name: 'AI (n8n + Gemini)', ok: a.ok !== false, detail: a.ok === false ? (a.error || 'not answering') : a.ok ? `last reply ${a.ms} ms` : 'no messages yet' });
  checks.push({ name: 'WhatsApp provider', ok: !!(process.env.KAPSO_API_KEY || process.env.WA_ACCESS_TOKEN), detail: process.env.KAPSO_API_KEY ? 'Kapso' : process.env.WA_ACCESS_TOKEN ? 'Meta' : 'not configured' });
  const b = lastBackup();
  checks.push({ name: 'Daily backup', ok: !!b && b.hours < 26, detail: b ? `last ${b.hours} h ago · ${b.count} kept` : 'no backup found' });
  const failed = await one(`SELECT count(*)::int n FROM messages WHERE failed AND created_at > now() - interval '1 hour'`).catch(() => ({ n: 0 }));
  checks.push({ name: 'AI replies (last hour)', ok: failed.n < 5, detail: `${failed.n} failed` });
  try { const st = fs.statfsSync('/'); const freePct = Math.round(st.bavail / st.blocks * 100); checks.push({ name: 'Disk space', ok: freePct > 10, detail: `${freePct}% free` }); } catch {}
  checks.push({ name: 'Alerts to your phone', ok: !!(process.env.ALERT_BOT_TOKEN && process.env.ALERT_CHAT_ID), detail: process.env.ALERT_CHAT_ID ? 'Telegram' : 'set ALERT_BOT_TOKEN and ALERT_CHAT_ID in .env' });
  return checks;
}
// Every 5 minutes; an alert is sent when a check turns bad, and again when it recovers.
export function startMonitor(aiHealth) {
  const state = new Map();
  const run = async () => {
    for (const c of await health(aiHealth).catch(() => [])) {
      if (c.name === 'Alerts to your phone') continue;
      const was = state.get(c.name);
      if (was !== undefined && was !== c.ok) await alertAdmin(c.ok ? `${c.name} is working again.` : `${c.name} has a problem: ${c.detail || 'check Command center'}`);
      if (was === undefined && !c.ok) await alertAdmin(`${c.name} has a problem: ${c.detail || 'check Command center'}`);
      state.set(c.name, c.ok);
    }
  };
  setTimeout(run, 60e3); setInterval(run, 5 * 60e3);
}
