// MXAi public website: the page for business owners (sign-up and demo requests),
// "Powered by MXAi" link tracking, and the leads list for the platform admin.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { q, one } from './db.js';
import { readSession } from './accounts.js';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const SOURCES = ['confirm', 'book', 'webook', 'chat', 'site', 'direct'];
const tries = new Map(); // ip -> [timestamps] of lead submissions

export function mountSite(app) {
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);
  const ipOf = req => req.get('cf-connecting-ip') || req.ip;

  // the website: one file, each address shows its own sections
  // each address gets its own title, description and canonical link in the HTML itself (search engines and link
  // previews read it before any script runs), plus the Spanish and Arabic versions as alternates
  const PAGES = {
    '/pulse': ['MXAi · AI front desk on WhatsApp for salons and clinics', 'MXAi answers your WhatsApp in seconds, day and night, in Arabic, English or Spanish, books clients into your calendar and reminds them so they show up.'],
    '/product': ['MXAi product · Your business on one screen', 'Every chat, booking, client and dollar on one dashboard, with an AI front desk that answers and books for you.'],
    '/how-it-works': ['How MXAi works · From scattered chats to bookings', 'Connect WhatsApp once. MXAi answers, books, reminds and hands you only what needs a person.'],
    '/pricing': ['MXAi pricing · Plans from $29 a month', 'Simple monthly plans, no contract. Priced below the value of one recovered booking a week.'],
    '/templates': ['MXAi templates · Dashboards for salons, clinics and gyms', 'Pick a ready dashboard for your kind of business. It is live in a minute.'],
    '/start': ['Get set up free · MXAi', 'Share a few details and our team sets up your AI front desk with you, usually within one business day.'],
  };
  const BASE = () => (process.env.PUBLIC_URL || 'https://app.nexfoyz.dev').replace(/\/$/, '');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let siteHtml = null, siteAt = 0;
  const siteFile = () => { const st = fs.statSync(PUBLIC + '/site.html'); if (!siteHtml || st.mtimeMs !== siteAt) { siteHtml = fs.readFileSync(PUBLIC + '/site.html', 'utf8'); siteAt = st.mtimeMs; } return siteHtml; };
  app.get(Object.keys(PAGES), (req, res) => {
    const [title, desc] = PAGES[req.path], url = BASE() + req.path;
    const head = `<title>${esc(title)}</title>\n<meta name="description" content="${esc(desc)}">\n<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="en" href="${url}"><link rel="alternate" hreflang="es" href="${url}?lang=es"><link rel="alternate" hreflang="ar" href="${url}?lang=ar"><link rel="alternate" hreflang="x-default" href="${url}">
<meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:site_name" content="MXAi"><meta name="twitter:card" content="summary">`;
    const html = siteFile().replace(/<title>[\s\S]*?<\/title>\s*<meta name="description"[^>]*>/, head)
      .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
      .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`);
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  });
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /login\nSitemap: ${BASE()}/sitemap.xml\n`));
  app.get('/sitemap.xml', (_req, res) => res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...Object.keys(PAGES).filter(p => p !== '/start'), '/privacy'].map(p => `<url><loc>${BASE()}${p}</loc></url>`).join('')}</urlset>\n`));
  // privacy page: the company name and contact come from .env (SITE_COMPANY, SITE_CONTACT_EMAIL)
  app.get('/privacy', (_req, res) => {
    const company = process.env.SITE_COMPANY || 'MXAi', mail = process.env.SITE_CONTACT_EMAIL;
    const contact = mail ? `Email <a href="mailto:${esc(mail)}">${esc(mail)}</a>, or ask the business you booked with.` : 'Use the form on the <a href="/pulse#start">MXAi website</a> and write "Privacy" in the message, or ask the business you booked with.';
    res.type('html').send(fs.readFileSync(PUBLIC + '/privacy.html', 'utf8').replace(/\{\{COMPANY\}\}/g, esc(company)).replace('{{CONTACT}}', contact));
  });
  // Brand files are public: the sign-in page and the website use them before anyone signs in
  app.get(['/brand.css', '/pulse-logo.svg', '/manifest.webmanifest', '/stream.js', '/site-i18n.js'], (req, res) => res.set('Cache-Control', 'public, max-age=3600').sendFile(PUBLIC + req.path));
  // fonts are public too: the sign-in page uses them, and the browser may keep them for a month
  app.get(['/fonts.css', /^\/fonts\/[\w.-]+\.woff2$/], (req, res) => res.set('Cache-Control', 'public, max-age=2592000').sendFile(PUBLIC + req.path));
  // real dashboard screenshots for the website's templates and tools (public, cached a day)
  app.get(/^\/shots\/[\w-]+\.jpg$/, (req, res) => res.set('Cache-Control', 'public, max-age=86400').sendFile(PUBLIC + req.path));
  app.get('/', (req, res, next) => readSession(req.get('cookie')) ? next() : res.sendFile(PUBLIC + '/site.html'));
  app.get(['/dashboard', '/app'], (req, res) => res.redirect(readSession(req.get('cookie')) ? '/' : '/login'));

  // Every "Powered by MXAi" link goes through here, so we know which business sent the visitor.
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
