// Memberships: recurring plans (gym monthly, class packs, salon subscriptions). Each payment is a row in
// membership_payments, so Finance counts membership income on the day it was paid, next to booking income.
// Renewals are recorded here (Record payment); automatic card charging comes with the Stripe connector.
import { q, one } from './db.js';

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const STATUS = ['active', 'paused', 'cancelled'];

export async function membershipIncome(B, from, to) {
  return q(`SELECT p.amount::float AS price, 'Memberships' AS service, 'membership' AS ch FROM membership_payments p
    WHERE p.business_id=$1 AND p.paid_at >= $2 AND p.paid_at < $3`, [B, from, to]).catch(() => []);
}

export function mountMemberships(app, BIZ) {
  app.get('/api/memberships', wrap(async (_req, res) => {
    const list = await q(`SELECT m.id, m.plan, m.price::float AS price, m.every_days, m.status, m.started_at, m.renews_at, cu.id AS customer_id, cu.name, cu.phone,
        (SELECT max(b.starts_at) FROM bookings b WHERE b.customer_id=cu.id AND b.status IN ('completed','confirmed') AND b.starts_at < now()) AS last_visit,
        (SELECT count(*) FROM bookings b WHERE b.customer_id=cu.id AND b.status='completed' AND b.starts_at > now() - interval '30 days')::int AS visits_30
      FROM memberships m JOIN customers cu ON cu.id=m.customer_id WHERE m.business_id=$1 ORDER BY m.status, m.renews_at`, [BIZ()]);
    const act = list.filter(m => m.status === 'active'), soon = Date.now() + 7 * 864e5;
    const s = await one(`SELECT COALESCE(sum(amount) FILTER (WHERE paid_at > now() - interval '30 days'),0)::float AS paid_30,
        count(*) FILTER (WHERE paid_at > now() - interval '30 days')::int AS payments_30 FROM membership_payments WHERE business_id=$1`, [BIZ()]);
    res.json({ items: list, summary: {
      active: act.length, paused: list.filter(m => m.status === 'paused').length,
      cancelled_30: list.filter(m => m.status === 'cancelled' && m.renews_at && new Date(m.renews_at) > Date.now() - 30 * 864e5).length,
      monthly: Math.round(act.reduce((t, m) => t + m.price * 30 / (m.every_days || 30), 0)),
      renewing_7: act.filter(m => new Date(m.renews_at) < soon).length,
      // active members who haven't come in 14 days: the ones most likely to cancel at renewal
      at_risk: act.filter(m => !m.last_visit || new Date(m.last_visit) < Date.now() - 14 * 864e5).length,
      ...s } });
  }));
  app.post('/api/memberships', wrap(async (req, res) => {
    const { customer_id, plan, price, every_days = 30 } = req.body || {};
    const cu = await one('SELECT id FROM customers WHERE id=$1 AND business_id=$2', [customer_id, BIZ()]);
    if (!cu || !String(plan || '').trim() || !(+price >= 0)) return res.status(400).json({ error: 'Choose a member, a plan name and a price.' });
    const m = await one(`INSERT INTO memberships (business_id, customer_id, plan, price, every_days, renews_at) VALUES ($1,$2,$3,$4,$5, now() + make_interval(days => $5)) RETURNING id`,
      [BIZ(), cu.id, String(plan).trim().slice(0, 60), +price, Math.max(1, Math.min(+every_days || 30, 365))]);
    await q('INSERT INTO membership_payments (membership_id, business_id, amount) VALUES ($1,$2,$3)', [m.id, BIZ(), +price]);
    res.json({ ok: true, id: m.id });
  }));
  // a renewal paid: record it and move the renewal date on by one period
  app.post('/api/memberships/:id/pay', wrap(async (req, res) => {
    const m = await one(`UPDATE memberships SET status='active', renews_at=GREATEST(renews_at, now()) + make_interval(days => every_days) WHERE id=$1 AND business_id=$2 RETURNING id, price`, [req.params.id, BIZ()]);
    if (!m) return res.sendStatus(404);
    await q('INSERT INTO membership_payments (membership_id, business_id, amount) VALUES ($1,$2,$3)', [m.id, BIZ(), m.price]);
    res.json({ ok: true });
  }));
  app.patch('/api/memberships/:id', wrap(async (req, res) => {
    const st = String(req.body?.status || ''); if (!STATUS.includes(st)) return res.status(400).json({ error: 'Unknown status.' });
    await q('UPDATE memberships SET status=$3 WHERE id=$1 AND business_id=$2', [req.params.id, BIZ(), st]);
    res.json({ ok: true });
  }));
}
