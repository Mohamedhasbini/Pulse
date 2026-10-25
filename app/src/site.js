// Pulse public website: the page for business owners (sign-up and demo requests),
// "Powered by Pulse" link tracking, and the leads list for the platform admin.
import { fileURLToPath } from 'node:url';
import { q, one } from './db.js';
import { readSession } from './accounts.js';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const SOURCES = ['confirm', 'book', 'webook', 'chat', 'site', 'direct'];
const tries = new Map(); // ip -> [timestamps] of lead submissions

export function mountSite(app) {
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);
  const ipOf = req => req.get('cf-connecting-ip') || req.ip;

  app.get(['/pulse', '/start'], (_req, res) => res.sendFile(PUBLIC + '/site.html'));
  app.get('/privacy', (_req, res) => res.sendFile(PUBLIC + '/privacy.html'));
  // Brand files are public: the sign-in page and the website use them before anyone signs in
  app.get(['/brand.css', '/pulse-logo.svg'], (req, res) => res.set('Cache-Control', 'public, max-age=3600').sendFile(PUBLIC + req.path));
  app.get('/', (req, res, next) => readSession(req.get('cookie')) ? next() : res.sendFile(PUBLIC + '/site.html'));
  app.get(['/dashboard', '/app'], (_req, res) => res.redirect('/'));

  // Every "Powered by Pulse" link goes through here, so we know which business sent the visitor.
  app.get('/go', wrap(async (req, res) => {
    const biz = +req.query.b || null, src = SOURCES.includes(req.query.s) ? req.query.s : 'direct';
    const known = biz && await one('SELECT id FROM businesses WHERE id=$1', [biz]);
    await q('INSERT INTO ref_clicks (business_id, source, ip) VALUES ($1,$2,$3)', [known ? biz : null, src, ipOf(req)]).catch(e => console.error('ref click:', e.message));
    res.redirect(302, `/pulse${known ? `?ref=${biz}&s=${src}` : `?s=${src}`}`);
  }));

  // Plans and add-ons for the pricing section.
  app.get('/api/public/pricing', wrap(async (_req, res) => {
    res.json({
      plans: await q('SELECT key, name, price, currency, features FROM plans ORDER BY sort, price'),
      addons: await q('SELECT key, name, price, currency, features FROM addons ORDER BY sort, price'),
    });
  }));

  app.post('/api/public/lead', wrap(async (req, res) => {
    const b = req.body || {}, ip = ipOf(req), now = Date.now();
    const recent = (tries.get(ip) || []).filter(t => now - t < 3600e3);
    if (recent.length >= 5) return res.status(429).json({ error: 'Too many requests from this network. Try again in an hour.' });
    const s = (k, n = 200) => String(b[k] || '').trim().slice(0, n);
    const name = s('name'), business = s('business'), phone = s('phone', 40), email = s('email', 160).toLowerCase();
    if (!name || !business) return res.status(400).json({ error: 'Add your name and your business name.' });
    if (!phone && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Add a phone number or an email so we can reach you.' });
    recent.push(now); tries.set(ip, recent);
    const ref = +b.ref && await one('SELECT id FROM businesses WHERE id=$1', [+b.ref]);
    await q(`INSERT INTO leads (kind, name, business, business_type, phone, email, country, message, ref_business_id, source, ip)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [b.kind === 'demo' ? 'demo' : 'signup', name, business, s('business_type', 60), phone, email, s('country', 60), s('message', 1000),
       ref ? ref.id : null, SOURCES.includes(b.source) ? b.source : 'direct', ip]);
    res.json({ ok: true });
  }));
}

// Admin only (mounted after the login check).
export function mountSiteAdmin(app, adminOnly) {
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);
  app.get('/api/admin/leads', adminOnly, wrap(async (_req, res) => {
    res.json({
      leads: await q(`SELECT l.*, b.name AS ref_name FROM leads l LEFT JOIN businesses b ON b.id=l.ref_business_id ORDER BY l.created_at DESC LIMIT 500`),
      referrers: await q(`SELECT b.id, b.name, count(c.*)::int AS clicks,
          count(c.*) FILTER (WHERE c.at > now() - interval '30 days')::int AS clicks_30d,
          (SELECT count(*)::int FROM leads l WHERE l.ref_business_id=b.id) AS leads
        FROM ref_clicks c JOIN businesses b ON b.id=c.business_id GROUP BY b.id, b.name ORDER BY clicks DESC`),
      sources: await q(`SELECT source, count(*)::int AS clicks FROM ref_clicks GROUP BY source ORDER BY clicks DESC`),
    });
  }));
  app.put('/api/admin/leads/:id', adminOnly, wrap(async (req, res) => {
    const status = ['new', 'contacted', 'demo_booked', 'won', 'lost'].includes(req.body.status) ? req.body.status : 'new';
    await q('UPDATE leads SET status=$1, notes=$2 WHERE id=$3', [status, String(req.body.notes ?? '').slice(0, 2000), +req.params.id]);
    res.json({ ok: true });
  }));
}
