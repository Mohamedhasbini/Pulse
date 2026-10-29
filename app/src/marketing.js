// Marketing performance: what every offer, discount code and agent message actually brought in.
// Attribution rule, used everywhere here: a booking counts for a send when the same client books within 14 days
// after it (first send wins, cancelled bookings never count). Audience segments come from visit history; only
// clients who agreed to offers (marketing_ok) can receive promotions, so every segment shows its reachable size.
import { q } from './db.js';

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const WIN = "interval '14 days'";
const LIVE = "b.status IN ('confirmed','completed')";

export async function overview(B, days) {
  const P = [B, days];
  // every message sent to a client in the period: offers (campaign_sends) and agent messages (agent_actions)
  const SENDS = `(SELECT cs.customer_id, cs.at, 'campaign' AS src, cs.campaign_id::text AS ref FROM campaign_sends cs JOIN campaigns c ON c.id=cs.campaign_id
      WHERE c.business_id=$1 AND cs.status='sent' AND cs.at > now() - make_interval(days => $2)
    UNION ALL SELECT a.customer_id, a.created_at, 'agent', a.agent FROM agent_actions a WHERE a.business_id=$1 AND a.status='sent' AND a.created_at > now() - make_interval(days => $2))`;
  // one row per (send, booking it led to)
  const WON = `SELECT DISTINCT ON (b.id) s.src, s.ref, s.customer_id, b.id AS booking_id, b.price::float AS price, b.created_at
      FROM ${SENDS} s JOIN bookings b ON b.customer_id=s.customer_id AND b.business_id=$1 AND ${LIVE} AND b.created_at > s.at AND b.created_at < s.at + ${WIN}
      ORDER BY b.id, s.at`;

  const [[k], campaigns, coupons, agents, weekly, segments, funnel] = await Promise.all([
    q(`SELECT (SELECT count(*) FROM ${SENDS} x)::int AS sent, (SELECT count(DISTINCT customer_id) FROM ${SENDS} x)::int AS reached,
        (SELECT count(*) FROM (${WON}) w)::int AS won, (SELECT COALESCE(sum(price),0) FROM (${WON}) w)::float AS revenue,
        (SELECT count(DISTINCT customer_id) FROM (${WON}) w)::int AS converted,
        (SELECT COALESCE(sum(list_price - price),0) FROM bookings WHERE business_id=$1 AND coupon_code IS NOT NULL AND status IN ('confirmed','completed') AND created_at > now() - make_interval(days => $2))::float AS discounts,
        (SELECT count(*) FROM customers WHERE business_id=$1)::int AS customers,
        (SELECT count(*) FROM customers WHERE business_id=$1 AND marketing_ok)::int AS opted_in,
        (SELECT COALESCE(avg(price),0) FROM bookings WHERE business_id=$1 AND status IN ('confirmed','completed') AND starts_at > now() - interval '90 days')::float AS ticket`, P),
    q(`WITH w AS (${WON}) SELECT c.id, c.name, c.segment, c.message, to_char(c.created_at,'YYYY-MM-DD') AS date, c.sent, c.skipped,
        (SELECT count(DISTINCT customer_id) FROM w WHERE w.src='campaign' AND w.ref=c.id::text)::int AS booked,
        (SELECT COALESCE(sum(price),0) FROM w WHERE w.src='campaign' AND w.ref=c.id::text)::float AS revenue,
        (now() - c.created_at > interval '7 days') AS settled
        FROM campaigns c WHERE c.business_id=$1 AND c.created_at > now() - make_interval(days => $2) ORDER BY c.created_at DESC LIMIT 50`, P),
    q(`SELECT c.code, c.kind, c.value::float, c.uses, c.max_uses, c.active, to_char(c.expires_on,'YYYY-MM-DD') AS expires,
        count(b.id)::int AS bookings, COALESCE(sum(b.price),0)::float AS revenue, COALESCE(sum(b.list_price - b.price),0)::float AS discount
        FROM coupons c LEFT JOIN bookings b ON b.business_id=c.business_id AND upper(b.coupon_code)=upper(c.code) AND b.status IN ('confirmed','completed')
        WHERE c.business_id=$1 GROUP BY c.id ORDER BY 9 DESC, c.created_at DESC`, [B]),
    q(`WITH w AS (${WON}) SELECT a.agent, count(*)::int AS sent,
        (SELECT count(DISTINCT customer_id) FROM w WHERE w.src='agent' AND w.ref=a.agent)::int AS booked,
        (SELECT COALESCE(sum(price),0) FROM w WHERE w.src='agent' AND w.ref=a.agent)::float AS revenue
        FROM agent_actions a WHERE a.business_id=$1 AND a.status='sent' AND a.created_at > now() - make_interval(days => $2) GROUP BY a.agent ORDER BY 4 DESC`, P),
    q(`WITH w AS (${WON}) SELECT to_char(g,'YYYY-MM-DD') AS week,
        (SELECT count(*) FROM ${SENDS} s WHERE date_trunc('week', s.at)=g)::int AS sent,
        (SELECT count(*) FROM w WHERE date_trunc('week', w.created_at)=g)::int AS booked,
        (SELECT COALESCE(sum(price),0) FROM w WHERE date_trunc('week', w.created_at)=g)::float AS revenue
        FROM generate_series(date_trunc('week', now() - make_interval(days => $2)), date_trunc('week', now()), '1 week') g`, P),
    q(`WITH v AS (SELECT cu.id, cu.marketing_ok, count(b.id) FILTER (WHERE ${LIVE} AND b.starts_at < now()) AS visits,
          max(b.starts_at) FILTER (WHERE ${LIVE} AND b.starts_at < now()) AS last, min(b.starts_at) FILTER (WHERE ${LIVE}) AS first,
          COALESCE(sum(b.price) FILTER (WHERE ${LIVE} AND b.starts_at < now()),0) AS spent,
          bool_or(b.status='confirmed' AND b.starts_at > now()) AS upcoming
        FROM customers cu LEFT JOIN bookings b ON b.customer_id=cu.id WHERE cu.business_id=$1 AND cu.phone NOT LIKE 'walk-in-%'
          AND NOT (EXISTS (SELECT 1 FROM conversations x WHERE x.customer_id=cu.id AND x.channel='test') AND NOT EXISTS (SELECT 1 FROM conversations x WHERE x.customer_id=cu.id AND x.channel<>'test'))
        GROUP BY cu.id),
      t AS (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY spent) AS vip FROM v WHERE spent > 0)
      SELECT seg, count(*)::int AS n, count(*) FILTER (WHERE marketing_ok)::int AS reachable, COALESCE(sum(spent),0)::float AS spent FROM (
        SELECT v.*, CASE WHEN visits = 0 THEN 'never' WHEN spent >= (SELECT vip FROM t) AND visits >= 2 THEN 'vip'
          WHEN COALESCE(upcoming,false) THEN 'active' WHEN last < now() - interval '120 days' THEN 'lost'
          WHEN last < now() - interval '45 days' THEN 'lapsed' WHEN visits >= 3 THEN 'regular' WHEN first > now() - interval '30 days' THEN 'new' ELSE 'occasional' END AS seg FROM v) s
      GROUP BY seg`, [B]),
    q(`SELECT (SELECT count(*) FROM conversations WHERE business_id=$1 AND channel<>'test' AND created_at > now() - make_interval(days => $2))::int AS chats,
        (SELECT count(DISTINCT customer_id) FROM conversations WHERE business_id=$1 AND channel<>'test' AND created_at > now() - make_interval(days => $2))::int AS talked,
        (SELECT count(DISTINCT customer_id) FROM bookings WHERE business_id=$1 AND status IN ('confirmed','completed') AND created_at > now() - make_interval(days => $2))::int AS booked,
        (SELECT count(*) FROM (SELECT customer_id FROM bookings WHERE business_id=$1 AND status IN ('confirmed','completed') GROUP BY 1 HAVING count(*) >= 2
          AND max(created_at) > now() - make_interval(days => $2)) r)::int AS returned`, P)]);

  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  for (const c of campaigns) { c.rate = pct(c.booked, c.sent); c.result = !c.sent ? 'not sent' : c.booked ? (c.rate >= 10 ? 'success' : 'some') : c.settled ? 'no bookings' : 'too early'; }
  for (const c of coupons) c.status = !c.active ? 'off' : c.expires && c.expires < new Date().toISOString().slice(0, 10) ? 'expired' : c.max_uses && c.uses >= c.max_uses ? 'used up' : 'live';
  for (const a of agents) a.rate = pct(a.booked, a.sent);
  const seg = Object.fromEntries(segments.map(s => [s.seg, s]));

  // what to do next, ranked by what it is worth: each idea names the audience, the reachable size and the value
  const t = k.ticket || 0, ideas = [];
  // value = reachable clients x expected reply rate x average ticket; potential = the same if every client in the segment agreed to offers
  const add = (id, title, why, s, rate, go) => { const all = seg[s]?.n || 0, n = seg[s]?.reachable || 0; if (all) ideas.push({ id, title, why, audience: s, total: all, reachable: n, rate: Math.round(rate * 100), value: Math.round(n * rate * t), potential: Math.round(all * rate * t), go }); };
  add('winback', `Win back ${seg.lapsed?.n || 0} lapsed clients`, "Not seen in 45–120 days but agreed to offers. A short 'we miss you' with a small perk.", 'lapsed', 0.15, ['marketing', 3]);
  add('lost', `Re-activate ${seg.lost?.n || 0} lost clients`, 'Gone for 4+ months. Only a real offer moves them; expect a low reply rate.', 'lost', 0.05, ['marketing', 1]);
  add('vip', `Thank your ${seg.vip?.n || 0} VIPs`, 'Your top 10% by spend. Early access or a gift beats a discount here.', 'vip', 0.25, ['marketing', 1]);
  add('new', `Turn ${seg.new?.n || 0} new clients into regulars`, 'First visit in the last 30 days. A second visit within 6 weeks makes a regular.', 'new', 0.2, ['marketing', 1]);
  add('never', `Convert ${seg.never?.n || 0} who chatted but never booked`, 'They asked and left. A clear price and a first-visit code.', 'never', 0.08, ['marketing', 2]);
  ideas.sort((a, b) => b.potential - a.potential);
  const lessons = [];
  const best = [...campaigns].filter(c => c.sent >= 3).sort((a, b) => b.rate - a.rate)[0];
  if (best?.booked) lessons.push(`Best offer: “${best.name}” booked ${best.booked} of ${best.sent} (${best.rate}%). Reuse its wording.`);
  const flops = campaigns.filter(c => c.result === 'no bookings').length;
  if (flops) lessons.push(`${flops} offer${flops > 1 ? 's' : ''} brought no bookings after a week: try a narrower audience or a clearer deadline.`);
  if (k.customers && pct(k.opted_in, k.customers) < 40) lessons.push(`Only ${pct(k.opted_in, k.customers)}% of clients agreed to offers. Booking confirmations now ask every client once (reply OFFERS); the audience grows with each booking.`);
  const unsent = campaigns.filter(c => !c.sent).length;
  if (unsent) lessons.push(`${unsent} offer${unsent > 1 ? 's were' : ' was'} created but reached nobody, because no client in ${unsent > 1 ? 'their audiences' : 'its audience'} has agreed to offers yet.`);
  const topCode = coupons.find(c => c.bookings);
  if (topCode) lessons.push(`Code ${topCode.code} brought ${topCode.bookings} booking${topCode.bookings > 1 ? 's' : ''} (${Math.round(topCode.revenue)} revenue for ${Math.round(topCode.discount)} discount).`);

  return { days, kpis: { ...k, conversion: pct(k.converted, k.reached), roi: k.discounts ? Math.round(k.revenue / k.discounts * 10) / 10 : null, optin_rate: pct(k.opted_in, k.customers) },
    campaigns, coupons, agents, weekly, segments: seg, funnel: funnel[0], ideas, lessons, rule: 'A booking counts for a message when the client books within 14 days after it.' };
}

export function mountMarketing(app, BIZ) {
  app.get('/api/marketing/overview', wrap(async (req, res) => res.json(await overview(BIZ(), Math.min(Math.max(+req.query.days || 90, 7), 365)))));
}
