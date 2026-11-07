// Billing without a card processor (Stripe does not serve Lebanon): the admin records each payment in the Lab
// (Whish, OMT, bank transfer, cash, card) and that moves the business's "paid until" date forward.
// What a business may do follows from three dates:
//   trial  -> works until trial_ends_at + 3 days of grace
//   active -> works until paid_until + 7 days of grace (active with no paid_until = an older account, keeps working)
//   paused -> stopped by the admin
// When a plan has ended or is paused: the AI stops answering and hands every chat to the owner, the booking page
// closes, and the dashboard becomes read-only except replying to clients. Nothing is deleted.
// Test businesses (is_demo) never end.
import { q, one } from './db.js';

export const GRACE = { trial: 3, active: 7 };
const DAY = 86400e3, cache = new Map(); // business id -> { v, at }

export async function accessOf(bizId, fresh = false) {
  const c = cache.get(bizId); if (!fresh && c && Date.now() - c.at < 60000) return c.v;
  const b = await one('SELECT is_demo, plan_status, trial_ends_at, paid_until FROM businesses WHERE id=$1', [bizId]);
  let v;
  if (!b) v = { state: 'ended', reason: 'missing' };
  else if (b.is_demo) v = { state: 'ok', test: true };
  else if (b.plan_status === 'paused') v = { state: 'paused' };
  else {
    const base = b.plan_status === 'active' ? b.paid_until : b.trial_ends_at;
    if (!base) v = { state: 'ok' };
    else {
      const end = new Date(base).getTime() + (b.plan_status === 'active' ? GRACE.active : GRACE.trial) * DAY;
      const daysLeft = Math.ceil((new Date(base).getTime() - Date.now()) / DAY);
      v = Date.now() > end ? { state: 'ended', kind: b.plan_status, until: base }
        : { state: daysLeft <= 3 ? 'ending' : 'ok', kind: b.plan_status, until: base, days_left: daysLeft, grace: daysLeft < 0 };
    }
  }
  cache.set(bizId, { v, at: Date.now() });
  return v;
}
export const stopped = a => a.state === 'ended' || a.state === 'paused';
export const forgetAccess = id => (id ? cache.delete(+id) : cache.clear());

// while a plan has ended the owner can still read everything, answer clients and talk to MXAi
export const STILL_ALLOWED = /^\/api\/(conversations\/\d+\/(reply|resolve|ai)$|me(\/|$)|logout$|upgrade-requests$|notifications(\/|$))/;

export function mountBilling(app, { adminOnly, wrap, audit }) {
  app.post('/api/admin/businesses/:id/payment', adminOnly, wrap(async (req, res) => {
    const id = +req.params.id, b = await one('SELECT id, name, currency FROM businesses WHERE id=$1', [id]);
    if (!b) return res.status(404).json({ error: 'Business not found.' });
    const months = Math.min(Math.max(Math.round(+req.body.months || 1), 1), 24), amount = Math.max(0, +req.body.amount || 0);
    const method = ['whish', 'omt', 'bank', 'cash', 'card', 'other'].includes(req.body.method) ? req.body.method : 'other';
    if (!amount) return res.status(400).json({ error: 'Write the amount received.' });
    const r = await one(`UPDATE businesses SET plan_status='active',
        paid_until = GREATEST(COALESCE(paid_until, current_date), current_date) + make_interval(months => $2)
      WHERE id=$1 RETURNING to_char(paid_until,'YYYY-MM-DD') AS paid_until`, [id, months]);
    await q(`INSERT INTO payments (business_id, amount, currency, method, months, note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, amount, String(req.body.currency || b.currency || 'USD').slice(0, 3).toUpperCase(), method, months, String(req.body.note || '').slice(0, 200) || null, req.user.email]);
    forgetAccess(id);
    await audit(req, 'payment_recorded', `${b.name}: ${amount} ${req.body.currency || b.currency || 'USD'} by ${method}, ${months} month(s), paid until ${r.paid_until}`, id);
    res.json({ ok: true, paid_until: r.paid_until });
  }));
  app.get('/api/admin/businesses/:id/payments', adminOnly, wrap(async (req, res) => {
    res.json(await q(`SELECT to_char(at,'YYYY-MM-DD') AS at, amount::float, currency, method, months, note, recorded_by FROM payments WHERE business_id=$1 ORDER BY at DESC LIMIT 24`, [+req.params.id]));
  }));
}
