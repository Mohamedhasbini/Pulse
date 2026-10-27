// Pulse AI: everything the AI has prepared and that waits for the owner, in one list. Each item says what it is,
// why, and the action that carries it out; the actions are the existing ones, so this list never acts on its own.
//   request  a customer asked to cancel or move a booking       → approve / reject  (/api/requests/:id/…)
//   lesson   a rule the AI suggests from its own chats          → approve / dismiss (/api/lessons)
//   question a question the AI couldn't answer, asked again     → answer in Teach AI
//   agent    customers an agent found, with messages ready      → review and send in AI team
import { q } from './db.js';
import { agentFindings } from './agents.js';
import { lessonSuggestions } from './lab.js';
import * as metrics from './metrics.js';

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

export async function waiting(B) {
  const [requests, lessons, questions, agents] = await Promise.all([
    q(`SELECT r.id, r.type, r.details, to_char(b.starts_at AT TIME ZONE COALESCE(bz.timezone,'Asia/Beirut'),'Dy DD Mon HH24:MI') AS start, s.name AS service, cu.name
        FROM requests r JOIN bookings b ON b.id=r.booking_id JOIN services s ON s.id=b.service_id JOIN customers cu ON cu.id=b.customer_id JOIN businesses bz ON bz.id=r.business_id
        WHERE r.business_id=$1 AND r.status='pending' ORDER BY r.created_at LIMIT 30`, [B]),
    lessonSuggestions(B),
    q(`SELECT min(id) AS id, min(question) AS question, count(*)::int AS n FROM learning WHERE business_id=$1 AND status='open' GROUP BY lower(question) ORDER BY 3 DESC LIMIT 10`, [B]),
    agentFindings(B).then(r => r.out.filter(a => a.list.length && !a.blocked))]);
  const items = [
    ...requests.map(r => ({ kind: 'request', id: r.id, title: `${r.name} wants to ${r.type === 'cancel' ? 'cancel' : r.type === 'reschedule' ? 'move' : 'change'} ${r.service}`, why: [r.start, r.details].filter(Boolean).join(' · ') })),
    ...lessons.filter(l => l.kind === 'rule').map(l => ({ kind: 'lesson', title: l.title, why: l.evidence, body: l.body })),
    ...questions.map(x => ({ kind: 'question', id: x.id, title: `Answer “${x.question}”`, why: `asked ${x.n} time${x.n === 1 ? '' : 's'}, the AI couldn't answer` })),
    ...agents.map(a => ({ kind: 'agent', id: a.id, title: `${a.name}: ${a.list.length} customer${a.list.length === 1 ? '' : 's'} to contact`, why: a.does }))];
  return { count: items.length, items };
}

// The weekly brief: this week against last week, in three wins, three risks and three next steps, from the data
// alone (no AI call), so it is free, instant and always matches the numbers on Today.
export async function brief(B) {
  const rows = await metrics.daily(B, 14), wk = rows.slice(-7), pw = rows.slice(0, 7);
  const sum = (set, k) => set.reduce((a, r) => a + (r[k] || 0), 0);
  const pct = (a, b) => b ? Math.round((a - b) / b * 100) : null;
  const money = n => '$' + Math.round(n).toLocaleString();
  const [w, p] = [wk, pw].map(set => ({ bookings: sum(set, 'bookings'), revenue: sum(set, 'revenue'), chats: sum(set, 'chats'), handled: sum(set, 'handled') }));
  const share = x => x.chats ? Math.round(x.handled / x.chats * 100) : null;
  const [extra] = await q(`SELECT
      (SELECT count(*) FROM bookings WHERE business_id=$1 AND status='no_show' AND starts_at > now() - interval '7 days')::int AS no_shows,
      (SELECT count(*) FROM conversations WHERE business_id=$1 AND needs_attention)::int AS waiting,
      (SELECT count(DISTINCT lower(question)) FROM learning WHERE business_id=$1 AND status='open')::int AS questions,
      (SELECT count(*) FROM bookings WHERE business_id=$1 AND status='confirmed' AND starts_at BETWEEN now() AND now() + interval '7 days')::int AS next_week`, [B]);
  const wins = [], risks = [], next = [];
  const rb = pct(w.revenue, p.revenue), bb = pct(w.bookings, p.bookings), hs = share(w);
  if (w.revenue && rb !== null && rb >= 0) wins.push(`Revenue ${money(w.revenue)}, up ${rb}% on last week`);
  if (w.bookings && bb !== null && bb > 0) wins.push(`${w.bookings} new bookings, ${bb}% more than last week`);
  if (hs !== null && hs >= 80) wins.push(`The AI handled ${hs}% of chats without you`);
  if (rb !== null && rb < 0) risks.push(`Revenue down ${-rb}% on last week (${money(w.revenue)} vs ${money(p.revenue)})`);
  if (bb !== null && bb < 0) risks.push(`${-bb}% fewer new bookings than last week`);
  if (extra.no_shows) risks.push(`${extra.no_shows} no-show${extra.no_shows === 1 ? '' : 's'} this week`);
  if (hs !== null && hs < 60) risks.push(`Only ${hs}% of chats were handled without a person`);
  if (extra.waiting) next.push(`Reply to ${extra.waiting} chat${extra.waiting === 1 ? '' : 's'} waiting for you`);
  if (extra.questions) next.push(`Teach the AI ${extra.questions} answer${extra.questions === 1 ? '' : 's'} it didn't know`);
  if (extra.no_shows) next.push('Turn on reminders 24 hours before, if they are off');
  if (extra.next_week < 5) next.push(`${extra.next_week ? `Only ${extra.next_week} booking${extra.next_week === 1 ? '' : 's'}` : 'No bookings'} in the next 7 days: let Win back regulars invite past clients`);
  return { week: w, wins: wins.slice(0, 3), risks: risks.slice(0, 3), next: next.slice(0, 3) };
}

// What each agent did in the last 30 days: messages sent, and how many of those customers booked within 14 days.
export const scorecard = B => q(`SELECT a.agent, count(*) FILTER (WHERE a.status='sent')::int AS sent,
    count(DISTINCT a.customer_id) FILTER (WHERE a.status='sent' AND EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id=a.customer_id
      AND b.status<>'cancelled' AND b.created_at > a.created_at AND b.created_at < a.created_at + interval '14 days'))::int AS booked,
    COALESCE((SELECT sum(b.price) FROM bookings b WHERE b.business_id=$1 AND b.status<>'cancelled' AND EXISTS (SELECT 1 FROM agent_actions x WHERE x.agent=a.agent
      AND x.customer_id=b.customer_id AND x.status='sent' AND b.created_at > x.created_at AND b.created_at < x.created_at + interval '14 days' AND x.created_at > now() - interval '30 days')),0)::float AS value
  FROM agent_actions a WHERE a.business_id=$1 AND a.created_at > now() - interval '30 days' GROUP BY a.agent ORDER BY 2 DESC`, [B]);

export function mountPulse(app, BIZ) {
  app.get('/api/pulse/waiting', wrap(async (_req, res) => res.json(await waiting(BIZ()))));
  app.get('/api/pulse/brief', wrap(async (_req, res) => {
    const B = BIZ(), [b, agents] = await Promise.all([brief(B), scorecard(B)]);
    const names = (await agentFindings(B)).out.reduce((m, a) => ({ ...m, [a.id]: a.name }), {});
    res.json({ ...b, agents: agents.map(a => ({ ...a, name: names[a.agent] || a.agent })) });
  }));
  // the Today tiles: one row per day, from metrics.js
  app.get('/api/kpis', wrap(async (req, res) => res.json(await metrics.daily(BIZ(), Math.min(Math.max(+req.query.days || 14, 7), 90)))));
}
