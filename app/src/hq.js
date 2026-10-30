// The Lab's HQ: the founder's view of the whole platform in one call. Revenue (what clients pay MXAi), the value MXAi
// creates for each client (bookings it made), what it costs to run, growth (leads, referrals, new clients),
// AI operations and platform health. Real data only; projections are computed in the browser and labelled as such.
import { q, one } from './db.js';
import { usage, health, lastBackup } from './ops.js';
import { routerStatus, PRIMARY } from './ai-router.js';

const INFRA = () => +process.env.INFRA_MONTHLY || 0; // servers, domains, tools per month (0 while it runs on this PC)

export function mountHQ(app, adminOnly, wrap, audit, aiHealth) {
  app.get('/api/admin/hq', adminOnly, wrap(async (req, res) => {
    const days = [7, 30, 90, 365].includes(+req.query.days) ? +req.query.days : 30;
    const [plans, addons] = await Promise.all([q('SELECT key, name, price::float FROM plans ORDER BY sort'), q('SELECT key, name, price::float FROM addons ORDER BY sort')]);
    const P = Object.fromEntries(plans.map(p => [p.key, p])), A = Object.fromEntries(addons.map(a => [a.key, a]));
    const [bizRows, value, use, leads, clicks, newPerMonth, daily, providers, ai, queue, db] = await Promise.all([
      q(`SELECT b.id, b.name, b.vertical, b.country, b.currency, b.plan_key, b.plan_status, b.addons, b.is_demo, b.ai_mode, b.created_at,
           GREATEST(0, ceil(extract(epoch FROM b.trial_ends_at - now()) / 86400))::int AS trial_days_left,
           (SELECT max(m.created_at) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=b.id) AS last_activity,
           (SELECT count(*) FROM users u WHERE u.business_id=b.id)::int AS logins
         FROM businesses b ORDER BY b.is_demo, b.created_at`),
      q(`SELECT business_id, count(*)::int AS bookings, COALESCE(sum(price),0)::float AS value,
           count(*) FILTER (WHERE source IN ('ai','web'))::int AS ai_bookings, COALESCE(sum(price) FILTER (WHERE source IN ('ai','web')),0)::float AS ai_value
         FROM bookings WHERE status <> 'cancelled' AND created_at > now() - make_interval(days => $1) GROUP BY 1`, [days]),
      usage(days),
      q(`SELECT COALESCE(status,'new') AS status, COALESCE(source,'direct') AS source, count(*)::int AS n FROM leads GROUP BY 1,2`),
      q(`SELECT COALESCE(source,'direct') AS source, count(*)::int AS n, count(DISTINCT business_id)::int AS from_clients FROM ref_clicks WHERE at > now() - make_interval(days => $1) GROUP BY 1 ORDER BY 2 DESC`, [days]),
      q(`SELECT to_char(m,'YYYY-MM') AS month, (SELECT count(*) FROM businesses b WHERE NOT b.is_demo AND date_trunc('month', b.created_at)=m)::int AS n
           FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m ORDER BY m`),
      q(`SELECT to_char(d,'YYYY-MM-DD') AS day,
           (SELECT count(*) FROM conversations c WHERE c.created_at::date = d)::int AS chats,
           (SELECT count(*) FROM messages m WHERE m.role='assistant' AND m.source='ai' AND m.created_at::date = d)::int AS ai_replies,
           (SELECT count(*) FROM bookings k WHERE k.status <> 'cancelled' AND k.created_at::date = d)::int AS bookings,
           (SELECT COALESCE(sum(price),0) FROM bookings k WHERE k.status <> 'cancelled' AND k.source IN ('ai','web') AND k.created_at::date = d)::float AS ai_value
         FROM generate_series(current_date - ($1::int - 1), current_date, interval '1 day') d ORDER BY d`, [Math.min(days, 90)]),
      q(`SELECT COALESCE(trail->>'provider', CASE WHEN source='ai' THEN 'ai (before trails)' ELSE source END) AS provider, count(*)::int AS n
         FROM messages WHERE role='assistant' AND created_at > now() - make_interval(days => $1) GROUP BY 1 ORDER BY 2 DESC`, [days]),
      one(`SELECT count(*) FILTER (WHERE m.source='ai')::int AS ai, count(*) FILTER (WHERE m.source='ai' AND c.channel <> 'test')::int AS ai_real,
           count(*) FILTER (WHERE m.failed)::int AS failed, count(*) FILTER (WHERE m.source='quick')::int AS quick,
           round(avg(m.latency_ms) FILTER (WHERE m.source='ai' AND NOT m.failed))::int AS avg_ms, count(*) FILTER (WHERE m.confidence='low')::int AS unsure
         FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.role='assistant' AND m.created_at > now() - make_interval(days => $1)`, [days]),
      one(`SELECT count(*) FILTER (WHERE status='waiting')::int AS waiting, count(*) FILTER (WHERE status='failed')::int AS failed FROM ai_queue`),
      one(`SELECT pg_database_size(current_database())::bigint AS bytes`),
    ]);
    const V = Object.fromEntries(value.map(v => [v.business_id, v])), U = Object.fromEntries(use.map(u => [u.id, u]));
    const clients = bizRows.map(b => {
      const plan = P[b.plan_key] || { price: 0, name: b.plan_key }, adds = (b.addons || []).map(k => A[k]).filter(Boolean);
      const price = plan.price + adds.reduce((s, a) => s + a.price, 0), v = V[b.id] || {}, u = U[b.id] || {};
      const paying = b.plan_status === 'active' && !b.is_demo;
      return { id: b.id, name: b.name, vertical: b.vertical, country: b.country, currency: b.currency, demo: b.is_demo, status: b.plan_status, trial_days_left: b.trial_days_left,
        plan: plan.name, plan_key: b.plan_key, addons: adds.map(a => a.name), price, mrr: paying ? price : 0, ai_mode: b.ai_mode || 'on', logins: b.logins,
        created: b.created_at, last_activity: b.last_activity, bookings: v.bookings || 0, ai_bookings: v.ai_bookings || 0, ai_value: v.ai_value || 0,
        messages: u.customer_messages ?? 0, ai_replies: u.ai_replies || 0, cost: u.est_cost || 0,
        roi: price ? Math.round((v.ai_value || 0) / (price * days / 30) * 10) / 10 : null };
    });
    const real = clients.filter(c => !c.demo), mrr = real.reduce((s, c) => s + c.mrr, 0), paying = real.filter(c => c.mrr).length;
    const aiCost = real.reduce((s, c) => s + c.cost, 0) * 30 / days, infra = INFRA(), costMonthly = Math.round((aiCost + infra) * 100) / 100;
    const mix = {}; real.forEach(c => { if (c.status === 'active') mix[c.plan] = (mix[c.plan] || 0) + c.price; });
    res.json({
      days, generated: new Date().toISOString(), plans, addons,
      money: { mrr, arr: mrr * 12, pipeline_mrr: real.filter(c => c.status === 'trial').reduce((s, c) => s + c.price, 0), paying,
        trials: real.filter(c => c.status === 'trial').length, paused: real.filter(c => c.status === 'paused').length, clients: real.length,
        arpa: paying ? Math.round(mrr / paying) : 0, cost_monthly: costMonthly, ai_cost_monthly: Math.round(aiCost * 100) / 100, infra_monthly: infra,
        gross_margin: mrr ? Math.round((mrr - costMonthly) / mrr * 100) : null, value_created: Math.round(real.reduce((s, c) => s + c.ai_value, 0)), mix },
      clients, growth: { leads, clicks, new_per_month: newPerMonth }, daily,
      ai: { ...ai, providers, queue, primary: PRIMARY || 'n8n (Gemini)', router: routerStatus(), last: { ok: aiHealth.ok, ms: aiHealth.ms, error: aiHealth.error } },
      platform: { checks: await health(aiHealth), db_mb: Math.round(Number(db.bytes) / 1048576), backup: lastBackup(), uptime_h: Math.round(process.uptime() / 360) / 10, node: process.version },
    });
  }));

  // control: switch the AI on or off for one client, or for every client at once (an emergency stop)
  app.put('/api/admin/ai-mode', adminOnly, wrap(async (req, res) => {
    const mode = req.body.mode === 'off' ? 'off' : 'on', id = req.body.business_id ? +req.body.business_id : null;
    const rows = await q(`UPDATE businesses SET ai_mode=$1, ai_mode_at=now() WHERE ($2::int IS NULL OR id=$2) AND NOT is_demo RETURNING id, name`, [mode, id]);
    if (mode === 'on') await q(`UPDATE conversations SET needs_attention=false, attention_reason=NULL WHERE ($1::int IS NULL OR business_id=$1) AND attention_reason LIKE 'AI is off%'`, [id]);
    await audit(req, 'ai_mode', `${mode} for ${id ? rows[0]?.name : 'every client'}`, id);
    res.json({ ok: true, mode, changed: rows.length });
  }));
}
