// WeBook: our own chat app. Customers pick a business, say who they are once, and chat with its AI.
// Every WeBook user becomes a normal customer profile, so the dashboard, calendar and staff replies just work.
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { q, one } from './db.js';
import { handleMessage, loadBusiness } from './brain.js';
import { unify } from './customers.js';
import { VERTICALS } from './verticals.js';
import { hasFeature } from './features.js';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const KEY = crypto.createHmac('sha256', process.env.ADMIN_PASSWORD || 'webook').update('webook-session').digest();

// A WeBook session is "customerId.businessId.signature", stored on the customer's phone.
const sign = (c, b) => `${c}.${b}.${crypto.createHmac('sha256', KEY).update(`${c}.${b}`).digest('base64url').slice(0, 32)}`;
function verify(token) {
  const [c, b, s] = String(token || '').split('.');
  if (!c || !b || !s) return null;
  const good = sign(c, b);
  return good.length === String(token).length && crypto.timingSafeEqual(Buffer.from(good), Buffer.from(String(token))) ? { customerId: +c, businessId: +b } : null;
}

const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const CATEGORY = { salon: 'Beauty', barber: 'Barbers', clinic: 'Health', dental: 'Health', spa: 'Spa & wellness', gym: 'Fitness', restaurant: 'Food & drinks', car: 'Car care', tutoring: 'Learning' };

const hits = new Map();
function limited(req, key, max, ms) {
  const k = (req.get('cf-connecting-ip') || req.ip) + key, now = Date.now();
  const h = (hits.get(k) || []).filter(t => now - t < ms); h.push(now); hits.set(k, h);
  return h.length > max;
}

export function mountWeBook(app) {
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);
  app.get(['/webook', '/webook/*'], (_req, res) => res.sendFile(PUBLIC + '/webook.html'));
  app.get('/webook-manifest.json', (_req, res) => res.json({
    name: 'WeBook', short_name: 'WeBook', start_url: '/webook', display: 'standalone', background_color: '#eef1f4', theme_color: '#0a6cb5',
    icons: [{ src: '/webook-icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  }));
  app.get('/webook-icon.svg', (_req, res) => res.type('image/svg+xml').send(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a6cb5"/><stop offset="1" stop-color="#10a35a"/></linearGradient></defs><rect width="96" height="96" rx="24" fill="url(#g)"/><path d="M26 30h44a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H44l-12 10v-10h-6a6 6 0 0 1-6-6V36a6 6 0 0 1 6-6z" fill="#fff"/><path d="M37 47l7 7 15-15" stroke="#10a35a" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`));

  // Discovery: every listed business with rating, popularity, cheapest price and whether it's open now.
  app.get('/api/webook/businesses', wrap(async (_req, res) => {
    const list = await q(`SELECT b.id, b.name, b.vertical, b.address, b.city, b.description, b.cover, b.cover_url, b.logo_url, b.is_demo, b.hours,
        (SELECT count(*) FROM services s WHERE s.business_id=b.id AND s.active)::int AS services,
        (SELECT min(price)::float FROM services s WHERE s.business_id=b.id AND s.active) AS from_price,
        (SELECT round(avg(stars)::numeric, 1)::float FROM reviews r WHERE r.business_id=b.id) AS rating,
        (SELECT count(*) FROM reviews r WHERE r.business_id=b.id)::int AS reviews,
        ((SELECT count(*) FROM bookings k WHERE k.business_id=b.id AND k.created_at > now() - interval '14 days' AND k.status <> 'cancelled') * 2
          + (SELECT count(*) FROM reviews r WHERE r.business_id=b.id AND r.created_at > now() - interval '30 days'))::int AS trend,
        b.currency FROM businesses b WHERE b.listed ORDER BY b.name`);
    // Only businesses whose plan includes the WeBook listing (demo businesses always show).
    const allowed = new Set(); for (const b of list) if (b.is_demo || await hasFeature(b.id, 'webook_listing')) allowed.add(b.id);
    const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
    res.json(list.filter(b => allowed.has(b.id)).map(b => {
      const v = VERTICALS[b.vertical] || VERTICALS.salon;
      const today = (b.hours?.[now.getDay()] || []).map(([a, z]) => [toMin(a), toMin(z)]);
      const open = today.some(([a, z]) => mins >= a && mins < z);
      const closesAt = open ? (b.hours[now.getDay()].find(([a, z]) => mins >= toMin(a) && mins < toMin(z)) || [])[1] : null;
      delete b.hours;
      return { ...b, type: v.label, emoji: v.emoji, category: CATEGORY[b.vertical] || 'Other', open, closes_at: closesAt };
    }));
  }));

  // One business: everything the profile page shows.
  app.get('/api/webook/business/:id', wrap(async (req, res) => {
    const b = await loadBusiness(+req.params.id);
    if (!b || !b.listed) return res.status(404).json({ error: 'Business not found.' });
    const v = VERTICALS[b.vertical] || VERTICALS.salon;
    const [r] = await q(`SELECT round(avg(stars)::numeric,1)::float AS rating, count(*)::int AS n,
        count(*) FILTER (WHERE stars=5)::int AS s5, count(*) FILTER (WHERE stars=4)::int AS s4, count(*) FILTER (WHERE stars=3)::int AS s3,
        count(*) FILTER (WHERE stars=2)::int AS s2, count(*) FILTER (WHERE stars=1)::int AS s1 FROM reviews WHERE business_id=$1`, [b.id]);
    const reviews = await q(`SELECT stars, text, COALESCE(author, 'Customer') AS author, to_char(created_at,'YYYY-MM-DD') AS at FROM reviews
        WHERE business_id=$1 ORDER BY created_at DESC LIMIT 8`, [b.id]);
    res.json({ id: b.id, name: b.name, description: b.description, address: b.address, city: b.city, maps_url: b.maps_url, phone: b.phone,
      instagram: b.instagram, website: b.website, team: b.team, policies: b.policies, payment_methods: b.payment_methods, cover: b.cover, cover_url: b.cover_url, logo_url: b.logo_url, menu_url: b.menu_url, is_demo: b.is_demo,
      currency: b.currency || 'USD', hours: b.hours, cancel_hours: b.cancel_hours ?? 24, booking_enabled: b.booking_enabled !== false,
      type: v.label, emoji: v.emoji, terms: v.terms, rating: r, reviews,
      services: b.services.map(s => ({ id: s.id, name: s.name, price: Number(s.price), minutes: s.minutes, description: s.description })) });
  }));

  // My bookings across every business I've used on this phone (the app sends all its session tokens).
  app.post('/api/webook/my-bookings', wrap(async (req, res) => {
    const out = [];
    for (const t of (Array.isArray(req.body.tokens) ? req.body.tokens : []).slice(0, 30)) {
      const s = verify(t); if (!s) continue;
      const c = await one('SELECT * FROM customers WHERE id=$1 AND business_id=$2', [s.customerId, s.businessId]); if (!c) continue;
      // Every booking with this phone at this business (chat, WeBook or website) belongs to this person.
      const rows = await q(`SELECT k.id, k.business_id, b.name AS business, b.vertical, k.status, k.price::float, k.manage_token,
          to_char(k.starts_at,'YYYY-MM-DD"T"HH24:MI') AS start, to_char(k.ends_at,'YYYY-MM-DD"T"HH24:MI') AS "end", s.name AS service,
          (k.starts_at - now() >= make_interval(hours => b.cancel_hours)) AS can_cancel, k.starts_at < now() AS past,
          (SELECT stars FROM reviews r WHERE r.booking_id=k.id) AS my_stars,
          (SELECT status FROM requests r WHERE r.booking_id=k.id AND r.type='cancel' ORDER BY id DESC LIMIT 1) AS cancel_request
          FROM bookings k JOIN services s ON s.id=k.service_id JOIN businesses b ON b.id=k.business_id JOIN customers cu ON cu.id=k.customer_id
          WHERE k.business_id=$1 AND (cu.id=$2 OR cu.phone=$3) ORDER BY k.starts_at DESC LIMIT 50`, [s.businessId, c.id, c.phone]);
      for (const r of rows) {
        if (!r.manage_token) { r.manage_token = crypto.randomBytes(18).toString('base64url'); await q('UPDATE bookings SET manage_token=$1 WHERE id=$2', [r.manage_token, r.id]); }
        out.push({ ...r, token: t, emoji: (VERTICALS[r.vertical] || VERTICALS.salon).emoji });
      }
    }
    res.json(out.sort((a, b) => a.start < b.start ? 1 : -1));
  }));

  // Rate a visit (only for my own completed booking, once).
  app.post('/api/webook/review', wrap(async (req, res) => {
    const s = await sessionOf(req);
    if (!s) return res.status(401).json({ error: 'Please start again.' });
    const stars = Math.round(+req.body.stars);
    if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Choose 1 to 5 stars.' });
    const k = await one(`SELECT k.* FROM bookings k JOIN customers cu ON cu.id=k.customer_id WHERE k.id=$1 AND k.business_id=$2 AND (cu.id=$3 OR cu.phone=$4)`,
      [+req.body.booking_id, s.businessId, s.customerId, s.customer.phone]);
    if (!k) return res.status(404).json({ error: 'Booking not found.' });
    if (new Date(k.starts_at) > new Date() || ['cancelled', 'no_show'].includes(k.status)) return res.status(400).json({ error: 'You can rate a visit after it happens.' });
    const first = (s.customer.name || 'Customer').split(' ')[0];
    try {
      await q(`INSERT INTO reviews (business_id, customer_id, booking_id, stars, text, author) VALUES ($1,$2,$3,$4,$5,$6)`,
        [s.businessId, s.customerId, k.id, stars, String(req.body.text || '').trim().slice(0, 600) || null, first]);
    } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'You already rated this visit.' }); throw e; }
    res.json({ ok: true });
  }));

  // Start (or resume) a chat: name + phone once; the same phone on the same business is the same customer.
  app.post('/api/webook/session', wrap(async (req, res) => {
    if (limited(req, 'session', 10, 60 * 60000)) return res.status(429).json({ error: 'Too many tries. Please wait a little.' });
    const biz = await loadBusiness(+req.body.business_id);
    if (!biz) return res.status(404).json({ error: 'Business not found.' });
    const name = String(req.body.name || '').trim().slice(0, 60), phone = String(req.body.phone || '').replace(/[^\d+]/g, '');
    if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
    if (phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Please enter a valid phone number.' });
    const c = await one(`INSERT INTO customers (business_id, phone, name) VALUES ($1,$2,$3)
        ON CONFLICT (business_id, phone) DO UPDATE SET name = COALESCE(customers.name, EXCLUDED.name) RETURNING id, name`, [biz.id, phone, name]);
    // Same number used on WhatsApp, Telegram or the booking page: same client.
    Object.assign(c, await unify(biz.id, c.id) || {});
    res.json({ token: sign(c.id, biz.id), name: c.name, business: { id: biz.id, name: biz.name } });
  }));

  async function sessionOf(req) {
    const s = verify(req.get('x-webook') || req.query.t);
    if (!s) return null;
    const c = await one('SELECT * FROM customers WHERE id=$1 AND business_id=$2', [s.customerId, s.businessId]);
    return c ? { ...s, customer: c } : null;
  }

  // Full chat history for this customer with this business (all their WeBook conversations).
  app.get('/api/webook/messages', wrap(async (req, res) => {
    const s = await sessionOf(req);
    if (!s) return res.status(401).json({ error: 'Please start again.' });
    const after = +req.query.after || 0;
    const msgs = await q(`SELECT m.id, m.role, m.text, m.options, to_char(m.created_at,'YYYY-MM-DD"T"HH24:MI') AS at FROM messages m
        JOIN conversations c ON c.id=m.conversation_id WHERE c.customer_id=$1 AND c.channel='webook' AND m.id > $2 ORDER BY m.id LIMIT 300`, [s.customerId, after]);
    const biz = await one('SELECT name, phone, address FROM businesses WHERE id=$1', [s.businessId]);
    const paused = await one(`SELECT ai_paused FROM conversations WHERE customer_id=$1 AND channel='webook' ORDER BY updated_at DESC LIMIT 1`, [s.customerId]);
    res.json({ messages: msgs.map(m => ({ ...m, role: m.role === 'customer' ? 'me' : m.role })), business: biz, customer: { name: s.customer.name }, staff: !!paused?.ai_paused });
  }));

  app.post('/api/webook/send', wrap(async (req, res) => {
    const s = await sessionOf(req);
    if (!s) return res.status(401).json({ error: 'Please start again.' });
    if (limited(req, 'send' + s.customerId, 40, 10 * 60000)) return res.status(429).json({ error: 'You are sending messages very fast. Please wait a moment.' });
    const text = String(req.body.text || '').trim().slice(0, 1500);
    if (!text) return res.status(400).json({ error: 'Write a message first.' });
    const r = await handleMessage({ businessId: s.businessId, phone: s.customer.phone, name: s.customer.name, text, channel: 'webook' });
    res.json({ ok: true, paused: !!r.paused, booked: !!r.bookedNow });
  }));
}
