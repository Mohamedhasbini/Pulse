// MXAi v2 server. For now: the growth engine (lead quality lab) behind one admin key. It listens on this PC only
// (127.0.0.1:3200); public access, client logins and the full product come later.
import express from 'express';
import crypto from 'node:crypto';
import { migrate, pool } from './db.js';
import { mountEngine, startEngine } from './engine/index.js';

const PORT = 3200;
const KEY = process.env.V2_ADMIN_TOKEN || '';
if (KEY.length < 24) { console.error('V2_ADMIN_TOKEN is missing or too short in v2/.env'); process.exit(1); }

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' }); next(); });

// changes must come from this site's own pages (no cross-site requests)
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Request from another site.' }); } catch { return res.status(403).json({ error: 'Bad origin.' }); } }
  next();
});

// sign-in: the admin key from v2/.env, then a signed cookie for 7 days
const COOKIE = 'mxv2';
const sign = v => crypto.createHmac('sha256', KEY).update(v).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const signedIn = req => {
  const raw = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (!raw) return false;
  const [exp, sig] = decodeURIComponent(raw.slice(COOKIE.length + 1)).split('.');
  return +exp > Date.now() && !!sig && same(sig, sign(exp));
};
const tries = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.socket.remoteAddress, t = tries.get(ip) || { n: 0, at: 0 };
  if (t.n >= 5 && Date.now() - t.at < 15 * 60000) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
  if (!same(String(req.body.token || ''), KEY)) { tries.set(ip, { n: t.n + 1, at: Date.now() }); return res.status(401).json({ error: 'That key is not right.' }); }
  tries.delete(ip);
  const exp = String(Date.now() + 7 * 864e5);
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(`${exp}.${sign(exp)}`)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}`);
  res.json({ ok: true });
});
app.post('/api/logout', (_req, res) => { res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`); res.json({ ok: true }); });
const adminOnly = (req, res, next) => (signedIn(req) ? next() : res.status(401).json({ error: 'Sign in first.' }));
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

app.get('/health', wrap(async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true, app: 'mxai-v2' }); }));
app.get('/', (req, res) => res.redirect(signedIn(req) ? '/eng-lab.html' : '/login.html'));
app.get('/eng-lab.html', (req, res, next) => (signedIn(req) ? next() : res.redirect('/login.html')));
mountEngine(app, { adminOnly, wrap });
app.use(express.static(new URL('../public', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Something went wrong.' }); });

await migrate();
app.listen(PORT, () => console.log(`MXAi v2 running on http://localhost:${PORT}`));
startEngine().catch(e => console.error('Growth engine did not start:', e.message));
