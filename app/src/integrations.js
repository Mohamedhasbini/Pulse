// Integrations: each business connects its own accounts (its AI provider, WhatsApp, Telegram, email, payments, a
// webhook) and gets API keys for its own systems. Secrets are encrypted at rest (ops.seal) and never sent back to the
// browser in full; every connection has a live Test. Outgoing webhooks are signed (HMAC-SHA256 of the body).
//   GET/PUT/DELETE /api/integrations[/:provider], POST /api/integrations/:provider/test
//   GET/POST/DELETE /api/integrations/keys[/:id]     business API keys (shown once, stored as a hash)
//   GET /api/v1/{summary,bookings,customers}          public read API, "Authorization: Bearer pk_..."
import crypto from 'node:crypto';
import { q, one } from './db.js';
import { seal, unseal } from './ops.js';

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const T = 8000; // every outside call gives up after 8 seconds
const get = (url, headers = {}) => fetch(url, { headers, signal: AbortSignal.timeout(T) });
const ok = async (r, pick) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error?.message || j.message || j.description || `HTTP ${r.status}`); return pick(j); };

// The catalogue. Each field: k (key), label, secret (encrypted, masked), hint. test() returns a short "connected as" line.
export const PROVIDERS = {
  anthropic: { group: 'AI', name: 'Claude (Anthropic)', does: 'Runs Pulse AI on your own Claude account.',
    fields: [{ k: 'api_key', label: 'API key', secret: true, hint: 'console.anthropic.com → API keys' }, { k: 'model', label: 'Model', hint: 'claude-opus-5-5' }],
    test: async c => { const A = (await import('@anthropic-ai/sdk')).default; const page = await new A({ apiKey: c.api_key }).models.list({ limit: 5 }); return `Key works · ${page.data.length ? page.data.map(m => m.id).slice(0, 2).join(', ') : 'models available'}`; } },
  gemini: { group: 'AI', name: 'Gemini (Google)', does: 'Use your own Google AI key.',
    fields: [{ k: 'api_key', label: 'API key', secret: true, hint: 'aistudio.google.com → Get API key' }, { k: 'model', label: 'Model', hint: 'gemini-3.5-flash' }],
    test: async c => ok(await get(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=3&key=${encodeURIComponent(c.api_key)}`), j => `Key works · ${(j.models || []).length} models visible`) },
  openai: { group: 'AI', name: 'OpenAI', does: 'Use your own OpenAI key.',
    fields: [{ k: 'api_key', label: 'API key', secret: true }, { k: 'model', label: 'Model' }],
    test: async c => ok(await get('https://api.openai.com/v1/models', { Authorization: `Bearer ${c.api_key}` }), j => `Key works · ${(j.data || []).length} models visible`) },
  whatsapp: { group: 'Messaging', name: 'WhatsApp Business (Meta)', does: 'Your own WhatsApp number answers customers.',
    fields: [{ k: 'access_token', label: 'Access token', secret: true, hint: 'Meta Business → System user token' }, { k: 'phone_number_id', label: 'Phone number ID' }],
    test: async c => ok(await get(`https://graph.facebook.com/v21.0/${encodeURIComponent(c.phone_number_id)}?fields=display_phone_number,verified_name`, { Authorization: `Bearer ${c.access_token}` }), j => `Connected · ${j.verified_name || ''} ${j.display_phone_number || ''}`.trim()) },
  telegram: { group: 'Messaging', name: 'Telegram bot', does: 'A Telegram bot answers customers.',
    fields: [{ k: 'bot_token', label: 'Bot token', secret: true, hint: 'From @BotFather' }],
    test: async c => ok(await get(`https://api.telegram.org/bot${c.bot_token}/getMe`), j => `Connected · @${j.result?.username}`) },
  resend: { group: 'Email', name: 'Email (Resend)', does: 'Confirmations and reminders from your own domain.',
    fields: [{ k: 'api_key', label: 'API key', secret: true }, { k: 'from', label: 'From address', hint: 'bookings@yourdomain.com' }],
    test: async c => ok(await get('https://api.resend.com/domains', { Authorization: `Bearer ${c.api_key}` }), j => `Connected · ${(j.data || []).length} domain(s)`) },
  stripe: { group: 'Payments', name: 'Stripe', does: 'Deposits and online payments on your Stripe account.',
    fields: [{ k: 'secret_key', label: 'Secret key', secret: true, hint: 'Use a restricted key: read balance, write payment links' }],
    test: async c => ok(await get('https://api.stripe.com/v1/balance', { Authorization: `Bearer ${c.secret_key}` }), j => `Connected · ${j.livemode ? 'live' : 'test'} mode`) },
  webhook: { group: 'Automation', name: 'Webhook', does: 'Send every booking, cancellation and handoff to your own system (Zapier, Make, n8n, your CRM).',
    fields: [{ k: 'url', label: 'URL', hint: 'https://…' }, { k: 'secret', label: 'Signing secret', secret: true, hint: 'Leave empty to generate one' }],
    test: async (c, B) => { const r = await post(c, { event: 'ping', business_id: B, at: new Date().toISOString() }); if (!r.ok) throw new Error(`Your URL answered ${r.status}`); return `Delivered · ${r.status}`; } },
};

const mask = v => v ? `••••${String(v).slice(-4)}` : '';
async function load(B, provider) {
  const r = await one('SELECT * FROM integrations WHERE business_id=$1 AND provider=$2', [B, provider]); if (!r) return null;
  const c = {}; for (const [k, v] of Object.entries(r.config || {})) c[k] = unseal(v);
  return { ...r, config: c };
}
// the decrypted config of a connected provider, for the rest of the app (Pulse AI, messaging, payments)
export async function credentials(B, provider) { const r = await load(B, provider); return r && r.status !== 'off' ? r.config : null; }

function post(c, payload) {
  const body = JSON.stringify(payload), sig = crypto.createHmac('sha256', c.secret || '').update(body).digest('hex');
  return fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pulse-Event': payload.event, 'X-Pulse-Signature': `sha256=${sig}` }, body, signal: AbortSignal.timeout(T) });
}
// fire-and-forget: a slow or broken webhook never delays a customer reply; the last error shows in Integrations
export function emitWebhook(B, event, data) {
  credentials(B, 'webhook').then(c => c?.url && post(c, { event, business_id: B, at: new Date().toISOString(), data })
    .then(r => q(`UPDATE integrations SET checked_at=now(), error=$3 WHERE business_id=$1 AND provider=$2`, [B, 'webhook', r.ok ? null : `Last delivery: HTTP ${r.status}`]))
    .catch(e => q(`UPDATE integrations SET error=$3 WHERE business_id=$1 AND provider=$2`, [B, 'webhook', `Last delivery failed: ${e.message}`]))).catch(() => {});
}

const hash = k => crypto.createHash('sha256').update(k).digest('hex');
export function mountIntegrations(app, BIZ) {
  app.get('/api/integrations', wrap(async (_req, res) => {
    const rows = await q('SELECT provider, config, status, checked_at, error, updated_at FROM integrations WHERE business_id=$1', [BIZ()]);
    const saved = Object.fromEntries(rows.map(r => [r.provider, r]));
    res.json({ providers: Object.entries(PROVIDERS).map(([id, p]) => {
      const s = saved[id], c = {}; if (s) for (const f of p.fields) c[f.k] = f.secret ? mask(unseal(s.config?.[f.k])) : s.config?.[f.k] || '';
      return { id, group: p.group, name: p.name, does: p.does, fields: p.fields.map(({ k, label, secret, hint }) => ({ k, label, secret: !!secret, hint })),
        connected: !!s, status: s?.status || 'off', checked_at: s?.checked_at, error: s?.error, values: c };
    }), keys: await q('SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE business_id=$1 ORDER BY id DESC', [BIZ()]) });
  }));
  app.put('/api/integrations/:p', wrap(async (req, res) => {
    const p = PROVIDERS[req.params.p]; if (!p) return res.sendStatus(404);
    const old = (await load(BIZ(), req.params.p))?.config || {}, cfg = {};
    for (const f of p.fields) {
      let v = String(req.body?.[f.k] ?? '').trim();
      if (f.secret && (!v || v.startsWith('••••'))) v = old[f.k] || ''; // blank or masked = keep the saved secret
      if (req.params.p === 'webhook' && f.k === 'secret' && !v) v = 'whsec_' + crypto.randomBytes(18).toString('hex');
      if (req.params.p === 'webhook' && f.k === 'url' && v && !/^https:\/\//.test(v)) return res.status(400).json({ error: 'The webhook URL must start with https://' });
      cfg[f.k] = f.secret ? seal(v) : v;
    }
    if (p.fields.some(f => f.secret) && !p.fields.filter(f => f.secret && f.k !== 'secret').every(f => unseal(cfg[f.k]))) return res.status(400).json({ error: 'Add the key first.' });
    await q(`INSERT INTO integrations (business_id, provider, config, status, updated_at) VALUES ($1,$2,$3,'saved',now())
      ON CONFLICT (business_id, provider) DO UPDATE SET config=EXCLUDED.config, status='saved', error=NULL, updated_at=now()`, [BIZ(), req.params.p, cfg]);
    res.json({ ok: true, secret: req.params.p === 'webhook' && !old.secret ? unseal(cfg.secret) : undefined });
  }));
  app.post('/api/integrations/:p/test', wrap(async (req, res) => {
    const p = PROVIDERS[req.params.p], r = p && await load(BIZ(), req.params.p); if (!r) return res.status(404).json({ error: 'Save it first.' });
    try { const msg = await p.test(r.config, BIZ()); await q(`UPDATE integrations SET status='connected', checked_at=now(), error=NULL WHERE business_id=$1 AND provider=$2`, [BIZ(), req.params.p]); res.json({ ok: true, message: msg }); }
    catch (e) { const m = e.name === 'TimeoutError' ? 'No answer within 8 seconds.' : String(e.message || e).slice(0, 200); await q(`UPDATE integrations SET status='error', checked_at=now(), error=$3 WHERE business_id=$1 AND provider=$2`, [BIZ(), req.params.p, m]); res.json({ ok: false, message: m }); }
  }));
  app.delete('/api/integrations/:p', wrap(async (req, res) => { await q('DELETE FROM integrations WHERE business_id=$1 AND provider=$2', [BIZ(), req.params.p]); res.json({ ok: true }); }));
  // business API keys: shown once at creation, only the hash is stored
  app.post('/api/integration-keys', wrap(async (req, res) => {
    const key = 'pk_' + crypto.randomBytes(24).toString('base64url'), name = String(req.body?.name || 'API key').slice(0, 60);
    await q('INSERT INTO api_keys (business_id, name, hash, prefix) VALUES ($1,$2,$3,$4)', [BIZ(), name, hash(key), key.slice(0, 10)]);
    res.json({ key });
  }));
  app.delete('/api/integration-keys/:id', wrap(async (req, res) => { await q('DELETE FROM api_keys WHERE id=$1 AND business_id=$2', [+req.params.id, BIZ()]); res.json({ ok: true }); }));
}

// The public read API. Mounted before the session check: it authenticates with a business API key instead.
export function mountPublicApi(app) {
  const auth = wrap(async (req, res, next) => {
    const k = /^Bearer\s+(pk_\S+)$/.exec(req.get('authorization') || '')?.[1];
    const row = k && await one('UPDATE api_keys SET last_used_at=now() WHERE hash=$1 RETURNING business_id', [hash(k)]);
    if (!row) return res.status(401).json({ error: 'Send a valid key: Authorization: Bearer pk_…' });
    req.biz = row.business_id; next();
  });
  const day = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  app.get('/api/v1/summary', auth, wrap(async (req, res) => res.json(await one(`SELECT
      (SELECT count(*) FROM bookings WHERE business_id=$1 AND status='confirmed' AND starts_at > now())::int AS upcoming_bookings,
      (SELECT COALESCE(sum(price),0) FROM bookings WHERE business_id=$1 AND status IN ('confirmed','completed') AND starts_at BETWEEN now() - interval '30 days' AND now())::float AS revenue_30d,
      (SELECT count(*) FROM customers WHERE business_id=$1)::int AS customers,
      (SELECT count(*) FROM conversations WHERE business_id=$1 AND needs_attention AND channel<>'test')::int AS chats_waiting`, [req.biz]))));
  app.get('/api/v1/bookings', auth, wrap(async (req, res) => res.json({ data: await q(`SELECT b.id, b.starts_at, b.ends_at, b.status, b.price::float, b.source, s.name AS service, c.name AS customer, c.phone
      FROM bookings b JOIN services s ON s.id=b.service_id JOIN customers c ON c.id=b.customer_id
      WHERE b.business_id=$1 AND b.starts_at >= COALESCE($2::date, now()::date) AND b.starts_at < COALESCE($3::date, now()::date + 30) ORDER BY b.starts_at LIMIT 500`, [req.biz, day(req.query.from), day(req.query.to)]) })));
  app.get('/api/v1/customers', auth, wrap(async (req, res) => res.json({ data: await q(`SELECT id, name, phone, email, marketing_ok, created_at FROM customers WHERE business_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3`,
      [req.biz, Math.min(+req.query.limit || 100, 500), Math.max(+req.query.offset || 0, 0)]) })));
}
