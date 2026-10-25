// Public website booking: no login. Only exposes what a customer needs to book,
// and applies exactly the same rules as the dashboard and the AI.
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hasFeature } from './features.js';
import { notify } from './notify.js';
import { unify } from './customers.js';
import { q, one, withBusinessLock } from './db.js';
import { loadBusiness, checkCoupon } from './brain.js';
import { dayRanges, isFree, bufferOf, parseLocal, localStamp, localDate, label } from './slots.js';
import { termsOf } from './verticals.js';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const REF = id => 'RB-' + String(id).padStart(4, '0');
const DAYS_AHEAD = 30;

// Simple per-IP limit so nobody can flood the calendar with fake bookings.
const hits = new Map();
function limited(req, max, windowMs) {
  const ip = req.get('cf-connecting-ip') || req.ip, key = ip + req.path.split('/')[3], now = Date.now();
  const h = (hits.get(key) || []).filter(t => now - t < windowMs);
  h.push(now); hits.set(key, h);
  return h.length > max;
}

async function snapshot(biz) {
  const bookings = await q(`SELECT * FROM bookings WHERE business_id=$1 AND ends_at > now() AND status <> 'cancelled'`, [biz.id]);
  const timeOff = await q('SELECT * FROM time_off WHERE business_id=$1 AND ends_at > now()', [biz.id]);
  return { bookings, timeOff };
}

// Every start time on `day` where the whole service fits.
function startsOn(biz, day, minutes, bookings, timeOff, buffer = biz.buffer_minutes || 0, serviceId = null) {
  const out = [], step = biz.slot_step || 30, earliest = Date.now() + Math.max(30, (biz.booking_min_notice_hours ?? 2) * 60) * 60000;
  const d0 = new Date(day); d0.setHours(0, 0, 0, 0);
  for (const [a, b] of dayRanges(biz, d0)) {
    for (let m = a; m + minutes <= b; m += step) {
      const s = new Date(d0.getTime() + m * 60000);
      if (s.getTime() >= earliest && isFree(biz, bookings, timeOff, s, new Date(s.getTime() + minutes * 60000), buffer, serviceId)) out.push(localStamp(s).slice(11));
    }
  }
  return out;
}

export function mountPublic(app, DEFAULT_BIZ) {
  // Works for any business: ?b=<id> (WeBook passes it); the website link defaults to the main business.
  const pick = req => +(req.query.b || req.body?.b) || DEFAULT_BIZ;
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);

  app.get('/book', (_req, res) => res.sendFile(PUBLIC + '/book.html'));
  // The booking page is an optional add-on; when it's off only existing booking links keep working.
  // Needs the owner's switch on and the booking-page feature in the business's plan.
  const enabled = async BIZ => (await one('SELECT booking_enabled FROM businesses WHERE id=$1', [BIZ]))?.booking_enabled !== false && await hasFeature(BIZ, 'booking_page');
  app.get('/booking/:token', (_req, res) => res.sendFile(PUBLIC + '/book.html'));

  app.get('/api/public/info', wrap(async (req, res) => {
    const BIZ = pick(req), b = await loadBusiness(BIZ);
    if (!b) return res.status(404).json({ error: 'Business not found.' });
    res.json({ terms: termsOf(b.vertical), enabled: b.booking_enabled !== false, title: b.booking_title, intro: b.booking_intro, color: b.booking_color, show_prices: b.booking_show_prices !== false,
      name: b.name, address: b.address, phone: b.phone, currency: b.currency || 'USD', cancel_hours: b.cancel_hours ?? 24,
      payment_methods: b.payment_methods, booking_note: b.booking_note, hours: b.hours, id: b.id, branding: b.show_branding !== false, logo_url: b.logo_url, cover_url: b.cover_url,
      services: b.services.map(s => ({ id: s.id, name: s.name, price: Number(s.price), minutes: s.minutes })) });
  }));

  // Which of the next 30 days have at least one free time for this service.
  app.get('/api/public/days', wrap(async (req, res) => {
    const biz = await loadBusiness(pick(req)), svc = biz.services.find(s => s.id === +req.query.service_id);
    if (!svc) return res.status(400).json({ error: 'Pick a service.' });
    const { bookings, timeOff } = await snapshot(biz);
    const out = [];
    for (let i = 0; i < (biz.booking_days_ahead || DAYS_AHEAD); i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      out.push({ date: localDate(d), open: dayRanges(biz, d).length > 0, free: startsOn(biz, d, svc.minutes, bookings, timeOff, bufferOf(biz, svc.id), svc.id).length });
    }
    res.json(out);
  }));

  app.get('/api/public/slots', wrap(async (req, res) => {
    const biz = await loadBusiness(pick(req)), svc = biz.services.find(s => s.id === +req.query.service_id);
    const day = parseLocal(`${req.query.date}T00:00`);
    if (!svc || isNaN(day)) return res.status(400).json({ error: 'Pick a service and a day.' });
    const { bookings, timeOff } = await snapshot(biz);
    res.json(startsOn(biz, day, svc.minutes, bookings, timeOff, bufferOf(biz, svc.id), svc.id));
  }));

  app.post('/api/public/coupon', wrap(async (req, res) => {
    if (limited(req, 20, 10 * 60000)) return res.status(429).json({ error: 'Too many tries. Please wait a few minutes.' });
    const BIZ = pick(req), biz = await loadBusiness(BIZ), svc = biz.services.find(s => s.id === +req.body.service_id);
    const c = await checkCoupon(BIZ, String(req.body.code || '').trim().toUpperCase());
    if (!c.ok || !svc) return res.status(400).json({ error: c.reason || 'Pick a service first.' });
    const price = Number(svc.price), off = c.coupon.kind === 'percent' ? price * Number(c.coupon.value) / 100 : Number(c.coupon.value);
    res.json({ code: c.coupon.code, price: Math.max(0, Math.round((price - off) * 100) / 100), was: price });
  }));

  app.post('/api/public/book', wrap(async (req, res) => {
    if (limited(req, 6, 60 * 60000)) return res.status(429).json({ error: 'Too many bookings from this connection. Please call us instead.' });
    const BIZ = pick(req);
    const { service_id, start, name, phone, email, notes, coupon, website, reminder_channel } = req.body;
    const channel = ['whatsapp', 'sms', 'email'].includes(reminder_channel) ? reminder_channel : 'whatsapp';
    if (channel === 'email' && !email) return res.status(400).json({ error: 'Add your email to get reminders by email.' });
    if (website) return res.status(400).json({ error: 'Something went wrong.' }); // hidden field only bots fill in
    if (!(await enabled(BIZ))) return res.status(403).json({ error: 'Online booking is not available right now. Please contact us directly.' });
    const nm = String(name || '').trim(), ph = String(phone || '').replace(/[^\d+]/g, '');
    if (nm.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
    if (ph.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Please enter a valid phone number.' });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please check your email address.' });
    const st = parseLocal(start);
    if (isNaN(st) || st < new Date()) return res.status(400).json({ error: 'Please pick a time.' });
    const nb = await loadBusiness(BIZ);
    if (!nb) return res.status(404).json({ error: 'Business not found.' });
    if (st - Date.now() < (nb.booking_min_notice_hours ?? 2) * 3600e3) return res.status(400).json({ error: `Please book at least ${nb.booking_min_notice_hours} hours ahead.` });

    const result = await withBusinessLock(BIZ, async () => {
      const biz = await loadBusiness(BIZ), svc = biz.services.find(s => s.id === +service_id);
      if (!svc) return { status: 400, error: 'Please pick a service.' };
      const end = new Date(st.getTime() + svc.minutes * 60000);
      const { bookings, timeOff } = await snapshot(biz);
      if (!isFree(biz, bookings, timeOff, st, end, bufferOf(biz, svc.id), svc.id)) return { status: 409, error: 'Sorry, that time was just taken. Please pick another one.' };
      let price = Number(svc.price), code = null, cp = null;
      if (coupon) {
        const c = await checkCoupon(BIZ, String(coupon).trim().toUpperCase());
        if (!c.ok) return { status: 400, error: c.reason };
        cp = c.coupon; code = cp.code;
        const off = cp.kind === 'percent' ? price * Number(cp.value) / 100 : Number(cp.value);
        price = Math.max(0, Math.round((price - off) * 100) / 100);
      }
      const cust = await one(`INSERT INTO customers (business_id, phone, name, email, reminder_channel) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (business_id, phone) DO UPDATE SET name = EXCLUDED.name, email = COALESCE(EXCLUDED.email, customers.email), reminder_channel = EXCLUDED.reminder_channel RETURNING id`,
        [BIZ, ph, nm, email || null, channel]);
      Object.assign(cust, await unify(BIZ, cust.id) || {});
      const token = crypto.randomBytes(18).toString('base64url');
      const note = String(notes || '').trim().slice(0, 500) || null;
      const b = await one(`INSERT INTO bookings (business_id, customer_id, service_id, starts_at, ends_at, price, list_price, coupon_code, source, notes, manage_token)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'web',$9,$10) RETURNING id`, [BIZ, cust.id, svc.id, st, end, price, svc.price, code, note, token]);
      if (cp) await q('UPDATE coupons SET uses = uses + 1 WHERE id=$1', [cp.id]);
      if (note) await q(`INSERT INTO requests (business_id, booking_id, type, details) VALUES ($1,$2,'extra',$3)`, [BIZ, b.id, note]);
      // Offers only with the client's explicit tick on the form.
      if (req.body.offers === true) await q('UPDATE customers SET marketing_ok=true, marketing_at=now() WHERE id=$1', [cust.id]);
      await notify(BIZ, 'booking', `${nm} booked online`, `${svc.name}, ${label(st)}${note ? ' · request: ' + note : ''}`, { bookingId: b.id });
      if (note) await notify(BIZ, 'approval', `${nm} added a special request`, note, { bookingId: b.id });
      return { status: 200, token };
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({ token: result.token, business_id: BIZ });
  }));

  app.get('/api/public/booking/:token', wrap(async (req, res) => {
    const b = await one(`SELECT b.id, b.business_id, b.status, b.price::float, b.list_price::float, b.coupon_code, b.notes, b.starts_at,
        to_char(b.starts_at,'YYYY-MM-DD"T"HH24:MI') AS start, to_char(b.ends_at,'YYYY-MM-DD"T"HH24:MI') AS "end",
        s.name service, s.minutes, cu.name, cu.phone,
        (SELECT status FROM requests r WHERE r.booking_id=b.id AND r.type='cancel' ORDER BY id DESC LIMIT 1) AS cancel_request
        FROM bookings b JOIN services s ON s.id=b.service_id JOIN customers cu ON cu.id=b.customer_id WHERE b.manage_token=$1`, [req.params.token]);
    if (!b) return res.status(404).json({ error: 'We could not find this booking.' });
    const biz = await loadBusiness(b.business_id);
    const hoursLeft = (new Date(b.starts_at) - Date.now()) / 3600000;
    delete b.starts_at;
    res.json({ ...b, ref: REF(b.id), can_cancel: b.status === 'confirmed' && hoursLeft >= (biz.cancel_hours ?? 24), past: hoursLeft < 0 });
  }));

  app.post('/api/public/booking/:token/cancel', wrap(async (req, res) => withBusinessLock('cancel', async () => {
    const b = await one(`SELECT b.*, s.name service FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.manage_token=$1`, [req.params.token]);
    if (!b) return res.status(404).json({ error: 'We could not find this booking.' });
    if (b.status !== 'confirmed') return res.status(409).json({ error: 'This booking is not active any more.' });
    if (new Date(b.starts_at) < new Date()) return res.status(409).json({ error: 'This appointment has already started.' });
    const BIZ = b.business_id, biz = await loadBusiness(BIZ), h = biz.cancel_hours ?? 24;
    if ((new Date(b.starts_at) - Date.now()) / 3600000 >= h) {
      await q("UPDATE bookings SET status='cancelled', cancelled_by='customer' WHERE id=$1", [b.id]);
      await notify(BIZ, 'cancel', 'A customer cancelled online', `${b.service}, ${label(new Date(b.starts_at))}`, { bookingId: b.id });
      return res.json({ result: 'cancelled' });
    }
    const pending = await one(`SELECT id FROM requests WHERE booking_id=$1 AND type='cancel' AND status='pending'`, [b.id]);
    if (!pending) await q(`INSERT INTO requests (business_id, booking_id, type, details) VALUES ($1,$2,'cancel',$3)`,
      [BIZ, b.id, `Cancel ${b.service} on ${label(new Date(b.starts_at))} (less than ${h}h before, from the website)`]);
    if (!pending) await notify(BIZ, 'approval', 'Late cancellation needs your approval', `${b.service}, ${label(new Date(b.starts_at))}`, { bookingId: b.id });
    res.json({ result: 'requested' });
  })));
}
