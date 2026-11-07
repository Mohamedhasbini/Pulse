// Finance: what the owner earns, what it costs to run, and where the money goes.
// Costs are entered by the owner in Settings (businesses.costs): fixed ones per month (rent, salaries, software),
// variable ones as a share of revenue (products, card fees) or an amount per booking (consumables). Revenue comes
// from bookings that happened and were not cancelled; its channel is the chat's channel for AI bookings, otherwise
// how the booking was made. Every figure is for the chosen period and the same length of time before it.
import { q, one } from './db.js';
import { membershipIncome } from './memberships.js';

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const BASIS = ['month', 'percent', 'booking'];
const CHANNEL = { membership: 'Memberships', whatsapp: 'WhatsApp', instagram: 'Instagram', telegram: 'Telegram', web: 'Website chat', webook: 'WeBook app', messenger: 'Messenger', manual: 'Walk-in and phone', ai: 'AI chat', page: 'Booking page', test: 'Test lab' };

// one cost line, cleaned: name, category, fixed or variable, basis and amount, and where it is paid (optional)
const clean = c => {
  const basis = BASIS.includes(c.basis) ? c.basis : 'month';
  return { name: String(c.name || '').trim().slice(0, 60), category: String(c.category || 'Other').trim().slice(0, 40) || 'Other',
    kind: basis === 'month' ? 'fixed' : 'variable', basis, amount: Math.max(0, Math.min(+c.amount || 0, basis === 'percent' ? 100 : 1e7)),
    channel: String(c.channel || '').trim().slice(0, 40) };
};

async function period(B, from, to) {
  const rows = await q(`SELECT b.price::float AS price, s.name AS service, COALESCE(c.channel, b.source, 'manual') AS ch
      FROM bookings b LEFT JOIN services s ON s.id=b.service_id LEFT JOIN conversations c ON c.id=b.conversation_id
      WHERE b.business_id=$1 AND b.status NOT IN ('cancelled','no_show') AND b.starts_at >= $2 AND b.starts_at < $3`, [B, from, to]);
  rows.push(...await membershipIncome(B, from, to)); // membership payments count as income on the day they were paid
  return { rows, revenue: rows.reduce((s, r) => s + (r.price || 0), 0), bookings: rows.filter(r => r.ch !== 'membership').length };
}
// what the costs come to for a stretch of time with this much revenue and this many bookings
const costFor = (costs, days, revenue, bookings) => costs.map(c => ({ ...c,
  total: c.basis === 'month' ? c.amount * days / 30.4 : c.basis === 'percent' ? revenue * c.amount / 100 : bookings * c.amount }));
const sumBy = (list, key, val) => Object.entries(list.reduce((m, x) => (m[x[key]] = (m[x[key]] || 0) + val(x), m), {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

export async function summary(B, days) {
  const now = new Date(), from = new Date(now - days * 864e5), prevFrom = new Date(now - 2 * days * 864e5);
  const [biz, cur, prev, funnel] = await Promise.all([
    one('SELECT COALESCE(costs, \'[]\'::jsonb) AS costs FROM businesses WHERE id=$1', [B]), period(B, from, now), period(B, prevFrom, from),
    one(`SELECT (SELECT count(*) FROM conversations WHERE business_id=$1 AND channel<>'test' AND created_at >= $2)::int AS chats,
        (SELECT count(*) FROM conversations c WHERE c.business_id=$1 AND c.channel<>'test' AND c.created_at >= $2 AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.role='assistant'))::int AS talked,
        (SELECT count(DISTINCT b.conversation_id) FROM bookings b JOIN conversations c ON c.id=b.conversation_id WHERE b.business_id=$1 AND c.channel<>'test' AND c.created_at >= $2 AND b.status<>'cancelled')::int AS booked,
        (SELECT count(DISTINCT b.conversation_id) FROM bookings b JOIN conversations c ON c.id=b.conversation_id WHERE b.business_id=$1 AND c.channel<>'test' AND c.created_at >= $2 AND b.starts_at < now() AND b.status IN ('completed','confirmed'))::int AS came`, [B, from])]);
  const costs = (biz?.costs || []).map(clean);
  const cc = costFor(costs, days, cur.revenue, cur.bookings), pc = costFor(costs, days, prev.revenue, prev.bookings);
  const spend = cc.reduce((s, c) => s + c.total, 0), spendPrev = pc.reduce((s, c) => s + c.total, 0);
  const fixed = cc.filter(c => c.kind === 'fixed').reduce((s, c) => s + c.total, 0);
  const profit = cur.revenue - spend, profitPrev = prev.revenue - spendPrev;
  const byService = sumBy(cur.rows, 'service', r => r.price || 0).map(x => ({ ...x, label: x.label === 'null' ? 'Other' : x.label }));
  const byChannel = sumBy(cur.rows.map(r => ({ ...r, ch: CHANNEL[r.ch] || r.ch })), 'ch', r => r.price || 0);
  const byCategory = sumBy(cc, 'category', c => c.total);
  // cash flow: each service's revenue is spread over the spending categories and profit in proportion
  const outs = [...byCategory, ...(profit > 0 ? [{ label: 'Profit', value: profit }] : [])], outTotal = outs.reduce((s, o) => s + o.value, 0) || 1;
  const flows = byService.slice(0, 5).flatMap(s => outs.map(o => ({ from: s.label, to: o.label, value: s.value * o.value / outTotal })));
  return { days, revenue: cur.revenue, revenue_prev: prev.revenue, bookings: cur.bookings, bookings_prev: prev.bookings,
    spend, spend_prev: spendPrev, fixed, variable: spend - fixed, profit, profit_prev: profitPrev, margin: cur.revenue ? profit / cur.revenue * 100 : null,
    costs: cc.map(c => ({ ...c, total: Math.round(c.total * 100) / 100 })), by_service: byService, by_channel: byChannel, by_category: byCategory,
    flow: { in: byService.slice(0, 5), out: outs, links: flows }, funnel: funnel || {}, has_costs: costs.length > 0 };
}

export function mountFinance(app, BIZ) {
  app.get('/api/finance/costs', wrap(async (_req, res) => res.json((await one('SELECT COALESCE(costs, \'[]\'::jsonb) AS costs FROM businesses WHERE id=$1', [BIZ()]))?.costs || [])));
  app.put('/api/finance/costs', wrap(async (req, res) => {
    const list = (Array.isArray(req.body?.costs) ? req.body.costs : []).map(clean).filter(c => c.name).slice(0, 60);
    await q('UPDATE businesses SET costs=$2 WHERE id=$1', [BIZ(), JSON.stringify(list)]);
    res.json(list);
  }));
  app.get('/api/finance/summary', wrap(async (req, res) => res.json(await summary(BIZ(), [7, 30, 90, 365].includes(+req.query.days) ? +req.query.days : 30))));
}
