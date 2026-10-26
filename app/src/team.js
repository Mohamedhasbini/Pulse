// The AI team: four employees the owner can ask anything about the business. Each has a role, skills and a set of
// tools. A question runs a short loop: the employee picks tools, Pulse runs them on the real data, and the employee
// answers using only what the tools returned, so numbers are exact. Anything that changes something or contacts a
// customer is only proposed; the owner approves it with a button and /api/team/act carries it out.
// AI: the n8n "Pulse assistant" workflow (prompt in, text out). Calls share the receptionist's per-minute pacing and
// have their own daily cap, so the team can never use up the receptionist's quota.
import { q, one } from './db.js';
import { loadBusiness, takeAiSlot } from './brain.js';
import { freeSlots, bufferOf, hoursText } from './slots.js';
import { agentFindings } from './agents.js';

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const DAILY_CAP = +process.env.TEAM_DAILY_CALLS || 60, MAX_STEPS = 4;
const URL_ = () => process.env.ASSISTANT_WEBHOOK_URL || String(process.env.N8N_WEBHOOK_URL || '').replace(/\/webhook\/.*$/, '/webhook/pulse-assistant');
const TZ = `COALESCE(bz.timezone,'Asia/Beirut')`;
const day = d => `to_char(${d} AT TIME ZONE ${TZ},'Dy DD Mon HH24:MI')`;
// real clients: no test phones, and not people whose latest chat is a test chat
const REAL = `cu.phone !~ '^(test|e2e|walk-in|tg-)' AND COALESCE((SELECT c.channel FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1),'') <> 'test'`;

export const TEAM = {
  maya: { name: 'Maya', role: 'Front desk manager', avatar: 'M', skills: 'bookings, the calendar, free times, who is coming, customer profiles',
    tools: ['today', 'bookings', 'free_slots', 'find_customer', 'customer', 'services'], actions: ['send_message'] },
  omar: { name: 'Omar', role: 'Customer support lead', avatar: 'O', skills: 'conversations, complaints, handovers, unanswered questions, ratings and reviews, the AI receptionist’s rules',
    tools: ['support', 'conversations', 'conversation', 'unanswered', 'reviews', 'rules', 'find_customer'], actions: ['send_message', 'teach_answer', 'add_rule'] },
  lina: { name: 'Lina', role: 'Growth manager', avatar: 'L', skills: 'bringing clients back, warm leads, filling quiet days, offers, loyal customers',
    tools: ['opportunities', 'top_customers', 'quiet_days', 'find_customer', 'customer', 'services'], actions: ['send_message', 'run_agent'] },
  sam: { name: 'Sam', role: 'Business analyst', avatar: 'S', skills: 'revenue, trends, services, channels, no-shows, busiest times, what to improve',
    tools: ['overview', 'revenue', 'by_service', 'by_channel', 'busy_times', 'top_customers', 'support', 'today'], actions: [] },
};
// who answers when the owner doesn't pick: by the words in the question
export function route(text) {
  const t = String(text).toLowerCase();
  if (/complain|unhappy|review|rating|handover|handed|unanswer|support|rule|teach|reply|answer/.test(t)) return 'omar';
  if (/win back|lapsed|haven.?t come|offer|promo|campaign|lead|quiet|fill|loyal|regular|grow|marketing|best (client|customer)|top (client|customer)|vip/.test(t)) return 'lina';
  if (/revenue|money|earn|trend|month|week|compare|average|ticket|channel|service sold|no.?show rate|analy|report|best|worst/.test(t)) return 'sam';
  return 'maya';
}

// ---------- tools: every one reads the business's real data ----------
const TOOLS = {
  today: { about: 'today: appointments, revenue, chats waiting for the owner, approvals, AI replies', args: '{}',
    run: async B => (await q(`SELECT
      (SELECT count(*) FROM bookings WHERE business_id=$1 AND status<>'cancelled' AND (starts_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date)::int AS appointments_today,
      (SELECT COALESCE(sum(price),0)::float FROM bookings WHERE business_id=$1 AND status<>'cancelled' AND (starts_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date) AS revenue_today,
      (SELECT count(*) FROM bookings WHERE business_id=$1 AND status<>'cancelled' AND created_at > now() - interval '24 hours')::int AS booked_last_24h,
      (SELECT count(*) FROM conversations WHERE business_id=$1 AND needs_attention AND channel<>'test')::int AS chats_waiting_for_owner,
      (SELECT count(*) FROM requests WHERE business_id=$1 AND status='pending')::int AS approvals_waiting,
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 AND m.role='assistant' AND m.created_at > now() - interval '24 hours')::int AS ai_replies_24h,
      to_char(now() AT TIME ZONE $2,'Dy DD Mon YYYY HH24:MI') AS now`, [B.id, B.tz]))[0] },
  bookings: { about: 'bookings in a date range (default: next 7 days), with time, client, service, price, status and who booked it', args: '{"from":"YYYY-MM-DD","to":"YYYY-MM-DD","status":"confirmed|completed|no_show|cancelled|any"}',
    run: async (B, a) => { const list = await q(`SELECT ${day('b.starts_at')} AS at, cu.name AS client, s.name AS service, b.price::float, b.status, b.source AS booked_by
      FROM bookings b JOIN customers cu ON cu.id=b.customer_id JOIN services s ON s.id=b.service_id JOIN businesses bz ON bz.id=b.business_id
      WHERE b.business_id=$1 AND (b.starts_at AT TIME ZONE $2)::date BETWEEN COALESCE($3::date,(now() AT TIME ZONE $2)::date) AND COALESCE($4::date,(now() AT TIME ZONE $2)::date + 7)
      AND ($5='any' OR b.status=$5) ORDER BY b.starts_at LIMIT 60`, [B.id, B.tz, a.from || null, a.to || null, a.status || (a.from && new Date(a.from) < new Date() ? 'any' : 'confirmed')]);
      return { count: list.length, total_value: list.reduce((x, b) => x + (b.status === 'cancelled' ? 0 : b.price), 0), bookings: list }; } },
  free_slots: { about: 'free times for a service (default: the first service) from a date, exactly as the receptionist offers them', args: '{"service":"name","from":"YYYY-MM-DD","count":8}',
    run: async (B, a) => {
      const biz = await loadBusiness(B.id), svc = biz.services.find(s => a.service && s.name.toLowerCase().includes(String(a.service).toLowerCase())) || biz.services[0];
      if (!svc) return { error: 'No services set up.' };
      const [bk, off] = await Promise.all([q(`SELECT * FROM bookings WHERE business_id=$1 AND ends_at > now() AND status <> 'cancelled'`, [B.id]), q('SELECT * FROM time_off WHERE business_id=$1 AND ends_at > now()', [B.id])]);
      const from = a.from ? new Date(a.from + 'T00:00') : new Date();
      return { service: svc.name, minutes: svc.minutes, opening_hours: hoursText(biz), free: freeSlots(biz, bk, off, svc.minutes, Math.min(+a.count || 8, 20), from > new Date() ? from : new Date(), bufferOf(biz, svc.id), svc.id).map(s => s.label) };
    } },
  services: { about: 'the services with price and length', args: '{}', run: async B => q(`SELECT name, price::float, minutes FROM services WHERE business_id=$1 ORDER BY name`, [B.id]) },
  find_customer: { about: 'search clients by name or phone', args: '{"query":"text"}',
    run: async (B, a) => q(`SELECT cu.id, cu.name, cu.phone, cu.marketing_ok AS agreed_to_offers,
      (SELECT count(*) FROM bookings b WHERE b.customer_id=cu.id AND b.status IN ('completed','confirmed') AND b.starts_at<now())::int AS visits
      FROM customers cu WHERE cu.business_id=$1 AND ${REAL} AND (cu.name ILIKE $2 OR cu.phone ILIKE $2) ORDER BY visits DESC LIMIT 10`, [B.id, `%${String(a.query || '').trim()}%`]) },
  customer: { about: 'one client in full: visits, spend, no-shows, upcoming and last bookings, last chat', args: '{"id":123}',
    run: async (B, a) => {
      const c = await one(`SELECT cu.id, cu.name, cu.phone, cu.marketing_ok AS agreed_to_offers, to_char(cu.created_at,'DD Mon YYYY') AS client_since FROM customers cu WHERE cu.id=$1 AND cu.business_id=$2`, [+a.id, B.id]);
      if (!c) return { error: 'No such client.' };
      const [stats] = await q(`SELECT count(*) FILTER (WHERE status IN ('completed','confirmed') AND starts_at<now())::int AS visits, COALESCE(sum(price) FILTER (WHERE status IN ('completed','confirmed') AND starts_at<now()),0)::float AS spent,
          count(*) FILTER (WHERE status='no_show')::int AS no_shows, count(*) FILTER (WHERE status='cancelled')::int AS cancellations FROM bookings WHERE customer_id=$1`, [c.id]);
      const list = await q(`SELECT ${day('b.starts_at')} AS at, s.name AS service, b.status, b.price::float FROM bookings b JOIN services s ON s.id=b.service_id JOIN businesses bz ON bz.id=b.business_id WHERE b.customer_id=$1 ORDER BY b.starts_at DESC LIMIT 8`, [c.id]);
      const chat = await one(`SELECT c.kind, c.topic, c.mood, c.rating, (SELECT text FROM messages m WHERE m.conversation_id=c.id AND m.role='customer' ORDER BY id DESC LIMIT 1) AS last_message FROM conversations c WHERE c.customer_id=$1 ORDER BY c.updated_at DESC LIMIT 1`, [c.id]);
      return { ...c, ...stats, bookings: list, last_chat: chat };
    } },
  support: { about: 'support results for N days: chats, share solved by the AI alone, handovers and why, ratings, open cases, kinds and top topics', args: '{"days":30}',
    run: async (B, a) => {
      const d = Math.min(Math.max(+a.days || 30, 1), 365), P = [B.id, d];
      const [s] = await q(`SELECT count(*)::int AS chats, count(*) FILTER (WHERE attention_reason IS NULL AND COALESCE(outcome,'') IN ('booked','answered'))::int AS solved_by_ai,
          count(*) FILTER (WHERE attention_reason IS NOT NULL)::int AS handed_to_owner, round(avg(rating),2)::float AS avg_rating, count(rating)::int AS ratings,
          count(*) FILTER (WHERE kind='complaint')::int AS complaints, count(*) FILTER (WHERE mood='negative')::int AS unhappy
          FROM conversations WHERE business_id=$1 AND channel<>'test' AND created_at > now() - make_interval(days => $2)`, P);
      const reasons = await q(`SELECT attention_reason AS reason, count(*)::int AS n FROM conversations WHERE business_id=$1 AND channel<>'test' AND attention_reason IS NOT NULL AND created_at > now() - make_interval(days => $2) GROUP BY 1 ORDER BY 2 DESC LIMIT 5`, P);
      const topics = await q(`SELECT initcap(topic) AS topic, count(*)::int AS n FROM conversations WHERE business_id=$1 AND channel<>'test' AND topic IS NOT NULL AND created_at > now() - make_interval(days => $2) GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, P);
      const [open] = await q(`SELECT count(*)::int AS open_cases FROM conversations WHERE business_id=$1 AND needs_attention AND channel<>'test'`, [B.id]);
      return { days: d, ...s, ...open, handover_reasons: reasons, top_topics: topics, note: 'test chats are excluded' };
    } },
  conversations: { about: 'recent conversations, optionally only those waiting for the owner, or of one kind (booking, question, change, complaint, cancel)', args: '{"waiting":true,"kind":"complaint","days":7}',
    run: async (B, a) => q(`SELECT c.id, cu.name AS client, c.channel, c.kind, c.topic, c.mood, c.outcome, c.needs_attention AS waiting_for_owner, c.attention_reason AS why,
      ${day('c.updated_at')} AS updated, (SELECT left(text,160) FROM messages m WHERE m.conversation_id=c.id AND m.role='customer' ORDER BY id DESC LIMIT 1) AS last_customer_message
      FROM conversations c JOIN customers cu ON cu.id=c.customer_id JOIN businesses bz ON bz.id=c.business_id
      WHERE c.business_id=$1 AND c.channel<>'test' AND c.updated_at > now() - make_interval(days => $2) AND (NOT $3 OR c.needs_attention) AND ($4='' OR c.kind=$4)
      ORDER BY c.needs_attention DESC, c.updated_at DESC LIMIT 25`, [B.id, Math.min(+a.days || 14, 90), !!a.waiting, String(a.kind || '')]) },
  conversation: { about: 'the messages of one conversation', args: '{"id":123}',
    run: async (B, a) => { const c = await one('SELECT id FROM conversations WHERE id=$1 AND business_id=$2', [+a.id, B.id]); if (!c) return { error: 'No such conversation.' };
      return q(`SELECT role, left(text,400) AS text, ${"to_char(created_at,'DD Mon HH24:MI')"} AS at FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 20`, [c.id]); } },
  unanswered: { about: 'questions the AI could not answer, most asked first, with their id for teaching', args: '{}',
    run: async B => q(`SELECT min(id) AS id, min(question) AS question, count(*)::int AS times FROM learning WHERE business_id=$1 AND status='open' GROUP BY lower(question) ORDER BY 3 DESC LIMIT 15`, [B.id]) },
  reviews: { about: 'latest ratings and comments from clients', args: '{"days":30}',
    run: async (B, a) => q(`SELECT cu.name AS client, c.rating, c.rating_comment AS comment, c.topic, ${day('c.rated_at')} AS at FROM conversations c JOIN customers cu ON cu.id=c.customer_id JOIN businesses bz ON bz.id=c.business_id
      WHERE c.business_id=$1 AND c.rating IS NOT NULL AND c.channel<>'test' AND c.rated_at > now() - make_interval(days => $2) ORDER BY c.rated_at DESC LIMIT 20`, [B.id, Math.min(+a.days || 30, 365)]) },
  rules: { about: 'the strict rules the AI receptionist follows', args: '{}', run: async B => (await one('SELECT ai_rules FROM businesses WHERE id=$1', [B.id])).ai_rules || [] },
  opportunities: { about: 'what the growth agents found now: clients to win back, warm leads, quiet days, risky bookings, review requests (with counts and names)', args: '{}',
    run: async B => (await agentFindings(B.id)).out.map(a => ({ agent: a.id, name: a.name, blocked: a.blocked, found: a.list.length, examples: a.list.slice(0, 5).map(f => `${f.name || f.phone}: ${f.why}`) })) },
  top_customers: { about: 'best clients by spend, with visits and last visit', args: '{"limit":10}',
    run: async (B, a) => q(`SELECT cu.id, cu.name, count(*)::int AS visits, sum(b.price)::float AS spent, to_char(max(b.starts_at),'DD Mon YYYY') AS last_visit
      FROM bookings b JOIN customers cu ON cu.id=b.customer_id WHERE b.business_id=$1 AND ${REAL} AND b.status IN ('completed','confirmed') AND b.starts_at<now()
      GROUP BY cu.id ORDER BY spent DESC LIMIT $2`, [B.id, Math.min(+a.limit || 10, 30)]) },
  quiet_days: { about: 'how full each of the next 7 days is', args: '{}',
    run: async B => q(`WITH d AS (SELECT generate_series((now() AT TIME ZONE $2)::date + 1, (now() AT TIME ZONE $2)::date + 7, '1 day')::date AS day)
      SELECT to_char(d.day,'Dy DD Mon') AS day, (SELECT count(*) FROM bookings b WHERE b.business_id=$1 AND b.status='confirmed' AND (b.starts_at AT TIME ZONE $2)::date=d.day)::int AS bookings,
      (SELECT COALESCE(sum(extract(epoch FROM b.ends_at-b.starts_at)/3600),0)::float FROM bookings b WHERE b.business_id=$1 AND b.status='confirmed' AND (b.starts_at AT TIME ZONE $2)::date=d.day) AS booked_hours FROM d`, [B.id, B.tz]) },
  overview: { about: 'totals for a period and the period before: revenue, bookings, average ticket, no-shows, cancellations, new clients', args: '{"days":30}',
    run: async (B, a) => { const d = Math.min(Math.max(+a.days || 30, 1), 365);
      // same definition as the Insights page: bookings not cancelled whose start falls in the period (the current one runs on into booked future dates)
      const row = (f, t) => one(`SELECT COALESCE(sum(price) FILTER (WHERE status<>'cancelled'),0)::float AS revenue, count(*) FILTER (WHERE status<>'cancelled')::int AS bookings,
          round(avg(price) FILTER (WHERE status<>'cancelled'),2)::float AS avg_ticket, count(*) FILTER (WHERE status='no_show')::int AS no_shows, count(*) FILTER (WHERE status='cancelled')::int AS cancellations,
          COALESCE(sum(price) FILTER (WHERE status<>'cancelled' AND starts_at > now()),0)::float AS of_which_still_ahead
          FROM bookings WHERE business_id=$1 AND starts_at > now() - make_interval(days => $2) AND ($3 = 0 OR starts_at <= now() - make_interval(days => $3))`, [B.id, f, t]);
      const [cur, prev, nc] = await Promise.all([row(d, 0), row(d * 2, d), one(`SELECT count(*)::int AS n FROM customers cu WHERE business_id=$1 AND ${REAL} AND created_at > now() - make_interval(days => $2)`, [B.id, d])]);
      return { days: d, this_period: cur, previous_period: prev, new_clients: nc.n, note: 'same numbers as the Insights page: bookings not cancelled starting in the period; test chats excluded from new clients' }; } },
  revenue: { about: 'revenue and bookings per week for the last N weeks', args: '{"weeks":8}',
    run: async (B, a) => q(`SELECT to_char(date_trunc('week', starts_at AT TIME ZONE $2),'DD Mon') AS week, count(*)::int AS bookings, sum(price)::float AS revenue FROM bookings
      WHERE business_id=$1 AND status IN ('completed','confirmed') AND starts_at <= now() AND starts_at > now() - make_interval(weeks => $3) GROUP BY 1, date_trunc('week', starts_at AT TIME ZONE $2) ORDER BY date_trunc('week', starts_at AT TIME ZONE $2)`, [B.id, B.tz, Math.min(+a.weeks || 8, 52)]) },
  by_service: { about: 'bookings, revenue, cancellations and no-shows per service for N days', args: '{"days":30}',
    run: async (B, a) => q(`SELECT s.name AS service, count(*) FILTER (WHERE b.status IN ('completed','confirmed'))::int AS bookings, COALESCE(sum(b.price) FILTER (WHERE b.status IN ('completed','confirmed')),0)::float AS revenue,
      count(*) FILTER (WHERE b.status='cancelled')::int AS cancelled, count(*) FILTER (WHERE b.status='no_show')::int AS no_shows
      FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.business_id=$1 AND b.starts_at > now() - make_interval(days => $2) GROUP BY s.name ORDER BY revenue DESC`, [B.id, Math.min(+a.days || 30, 365)]) },
  by_channel: { about: 'where bookings came from for N days (AI chat per channel, online page, manual)', args: '{"days":30}',
    run: async (B, a) => q(`SELECT COALESCE(CASE WHEN b.source='ai' THEN c.channel ELSE b.source END,'other') AS channel, count(*)::int AS bookings, sum(b.price)::float AS value
      FROM bookings b LEFT JOIN conversations c ON c.id=b.conversation_id WHERE b.business_id=$1 AND b.status<>'cancelled' AND b.created_at > now() - make_interval(days => $2) GROUP BY 1 ORDER BY 2 DESC`, [B.id, Math.min(+a.days || 30, 365)]) },
  busy_times: { about: 'booked appointments by weekday and hour for N days', args: '{"days":60}',
    run: async (B, a) => q(`SELECT to_char(starts_at AT TIME ZONE $2,'Dy') AS weekday, extract(hour FROM starts_at AT TIME ZONE $2)::int AS hour, count(*)::int AS bookings FROM bookings
      WHERE business_id=$1 AND status<>'cancelled' AND starts_at > now() - make_interval(days => $3) GROUP BY 1,2 ORDER BY 3 DESC LIMIT 15`, [B.id, B.tz, Math.min(+a.days || 60, 365)]) },
};
// actions are only proposed; the owner approves each one
const ACTIONS = {
  send_message: 'message one client: {"type":"send_message","customer_id":123,"text":"..."}',
  teach_answer: 'save the answer to an unanswered question: {"type":"teach_answer","learning_id":12,"answer":"..."}',
  add_rule: 'add a strict rule for the AI receptionist: {"type":"add_rule","text":"..."}',
  run_agent: 'let a growth agent send its prepared messages: {"type":"run_agent","agent":"winback|leads|fill|noshow|reviews"}',
};

function prompt(B, e, convo, results) {
  const emp = TEAM[e];
  return `You are ${emp.name}, the ${emp.role} at ${B.name}, a ${B.vertical || 'service'} business. You work for the owner inside their Pulse dashboard.
Your skills: ${emp.skills}. You are accurate, brief and practical, like a senior employee who owns this area.
Today is ${B.now} (${B.tz}). Currency: ${B.currency || 'USD'}.

HOW YOU WORK
- To get facts, call tools. Never guess or invent numbers, names or dates: use only what tools returned. If the data doesn't show something, say so.
- Never count or add up yourself when a tool gives a count or total: copy it exactly (count, total_value, revenue, bookings).
- Reply with ONE JSON object and nothing else:
  {"tools":[{"name":"tool","args":{...}}]}  to fetch data (up to 3 tools at once), or
  {"answer":"your reply to the owner","actions":[...]}  when you can answer.
- The answer: plain language, short paragraphs or a short list, the key numbers first, then one practical recommendation when useful.
- LANGUAGE: write your answer in ${/[؀-ۿ]/.test(convo.filter(m => m.role === 'owner').pop()?.text || '') ? 'Arabic' : 'English'}, the language of the owner's question (customer messages stay in the client's language).
- Actions are proposals the owner approves with one click. Only propose an action when it clearly helps; write customer messages warm, short and in the client's language.
- Never invent facts about the business (prices, products, policies, opening times, offers). In a teach_answer or a message, any fact the tools didn't give you goes in square brackets for the owner to fill, e.g. "[Yes / No], we [do / don't] sell gift cards[, from amount]." Even yes or no goes in brackets when the tools don't say.
- If the question belongs to a colleague (Maya: front desk, Omar: support, Lina: growth, Sam: numbers), still answer what you can with your tools and say who to ask for more.

YOUR TOOLS
${emp.tools.map(t => `- ${t} ${TOOLS[t].args}: ${TOOLS[t].about}`).join('\n')}
${emp.actions.length ? `\nACTIONS YOU MAY PROPOSE\n${emp.actions.map(a => `- ${ACTIONS[a]}`).join('\n')}` : '\nYou propose no actions; you explain and recommend.'}

CONVERSATION
${convo.map(m => `${m.role === 'owner' ? 'OWNER' : m.role === 'system' ? 'NOTE' : emp.name.toUpperCase()}: ${String(m.text).slice(0, 1500)}`).join('\n')}
${results.length ? `\nTOOL RESULTS (real data)\n${results.map(r => `${r.name}(${JSON.stringify(r.args)}) => ${JSON.stringify(r.data).slice(0, 6000)}`).join('\n')}` : ''}

Your JSON:`;
}
async function ask(text) {
  if (!(await takeAiSlot())) throw Object.assign(new Error('The AI is busy right now. Try again in a minute.'), { status: 429 });
  const r = await fetch(URL_(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text, model: process.env.AI_MODEL || undefined }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`The AI didn't respond (${r.status}).`);
  const body = await r.json(), raw = typeof body === 'string' ? body : body.output ?? body.text ?? '';
  const m = String(raw).match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : raw); } catch { return { answer: String(raw).trim() }; }
}

export function mountTeam(app, BIZ, { sendWhatsApp, sendTelegram, audit }) {
  const biz = async () => {
    const b = await one(`SELECT id, name, vertical, currency, COALESCE(timezone,'Asia/Beirut') AS tz, to_char(now() AT TIME ZONE COALESCE(timezone,'Asia/Beirut'),'Dy DD Mon YYYY HH24:MI') AS now FROM businesses WHERE id=$1`, [BIZ()]);
    return b;
  };
  // what each employee is on right now, for the Today page: one line of advice, open tasks and progress.
  // Straight from the data, no AI call, so it can refresh as often as Today does.
  app.get('/api/team/status', wrap(async (_req, res) => {
    const B = await biz(), P = [B.id, B.tz];
    const [[d], ag] = await Promise.all([q(`SELECT
      (SELECT count(*) FROM bookings WHERE business_id=$1 AND status<>'cancelled' AND (starts_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date)::int AS today,
      (SELECT count(*) FROM bookings WHERE business_id=$1 AND status IN ('confirmed','completed','no_show') AND starts_at < now() AND (starts_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date)::int AS past_today,
      (SELECT count(*) FROM bookings WHERE business_id=$1 AND status IN ('completed','no_show') AND (starts_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date)::int AS marked_today,
      (SELECT to_char(min(starts_at) AT TIME ZONE $2,'HH24:MI') FROM bookings WHERE business_id=$1 AND status='confirmed' AND starts_at > now() AND (starts_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date) AS next_at,
      (SELECT count(*) FROM conversations WHERE business_id=$1 AND needs_attention)::int AS open_cases,
      (SELECT count(*) FROM conversations c WHERE business_id=$1 AND attention_reason IS NOT NULL AND NOT needs_attention AND updated_at > now() - interval '7 days')::int AS solved_cases_7d,
      (SELECT count(DISTINCT lower(question)) FROM learning WHERE business_id=$1 AND status='open')::int AS unanswered,
      (SELECT count(*) FROM learning WHERE business_id=$1 AND status='answered' AND answered_at > now() - interval '7 days')::int AS taught_7d,
      (SELECT count(*) FROM agent_actions WHERE business_id=$1 AND status='sent' AND created_at > now() - interval '7 days')::int AS sent_7d,
      (SELECT COALESCE(sum(price),0)::float FROM bookings WHERE business_id=$1 AND status<>'cancelled' AND starts_at >= date_trunc('week', now() AT TIME ZONE $2) AT TIME ZONE $2 AND starts_at < now()) AS week_rev,
      (SELECT COALESCE(sum(price),0)::float FROM bookings WHERE business_id=$1 AND status<>'cancelled' AND starts_at >= (date_trunc('week', now() AT TIME ZONE $2) - interval '7 days') AT TIME ZONE $2 AND starts_at < now() - interval '7 days') AS last_week_rev`, P),
      agentFindings(B.id).catch(() => ({ out: [] }))]);
    const found = id => ag.out.find(a => a.id === id)?.list.length || 0, growth = found('winback') + found('leads') + found('fill') + found('reviews');
    const pct = (done, open) => done + open ? Math.round(done / (done + open) * 100) : 100, money = v => `${!B.currency || B.currency === 'USD' ? '$' : B.currency + ' '}${Math.round(v)}`;
    const delta = d.last_week_rev ? Math.round((d.week_rev - d.last_week_rev) / d.last_week_rev * 100) : null;
    res.json({ team: [
      { id: 'maya', name: 'Maya', role: 'Front desk', open: found('noshow') + Math.max(0, d.past_today - d.marked_today),
        advice: d.today ? `${d.today} appointment${d.today > 1 ? 's' : ''} today${d.next_at ? `, next at ${d.next_at}` : ', all done'}.${found('noshow') ? ` ${found('noshow')} risky booking${found('noshow') > 1 ? 's' : ''} to confirm.` : ''}` : 'No appointments today. Ask me to find who could fill the day.',
        progress: d.today ? Math.round(d.past_today / d.today * 100) : null, of: 'of today’s appointments done', ask: 'Who is coming today and is anyone likely to miss?' },
      { id: 'omar', name: 'Omar', role: 'Support', open: d.open_cases + d.unanswered,
        advice: d.open_cases || d.unanswered ? `${d.open_cases} chat${d.open_cases === 1 ? '' : 's'} waiting for you, ${d.unanswered} question${d.unanswered === 1 ? '' : 's'} to teach.` : 'All chats handled. Nothing waiting for you.',
        progress: pct(d.solved_cases_7d + d.taught_7d, d.open_cases + d.unanswered), of: 'handovers and questions cleared this week', ask: 'What is waiting for me in support and what should I answer first?' },
      { id: 'lina', name: 'Lina', role: 'Growth', open: growth,
        advice: growth ? `${growth} client${growth > 1 ? 's' : ''} ready to contact: ${[found('winback') && `${found('winback')} to win back`, found('leads') && `${found('leads')} warm leads`, found('fill') && `${found('fill')} for quiet days`, found('reviews') && `${found('reviews')} for reviews`].filter(Boolean).join(', ')}.` : 'No one to contact right now. I keep watching for lapsed regulars and warm leads.',
        progress: pct(d.sent_7d, growth), of: 'prepared messages sent this week', ask: 'Who should I contact this week to get more bookings?' },
      { id: 'sam', name: 'Sam', role: 'Analyst', open: 0,
        advice: `This week so far: ${money(d.week_rev)}${delta === null ? '' : `, ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta)}% on the same days last week`}.`,
        progress: d.last_week_rev ? Math.min(100, Math.round(d.week_rev / d.last_week_rev * 100)) : null, of: 'of last week’s revenue at this point', ask: 'How is this week going and what should I improve?' },
    ] });
  }));
  app.get('/api/team', wrap(async (_req, res) => {
    const B = await biz(), [used] = await q(`SELECT count(*)::int AS n FROM team_calls WHERE business_id=$1 AND at > now() - interval '24 hours'`, [B.id]);
    res.json({ team: Object.entries(TEAM).map(([id, e]) => ({ id, name: e.name, role: e.role, avatar: e.avatar, skills: e.skills })), calls_left: Math.max(0, DAILY_CAP - used.n), cap: DAILY_CAP });
  }));
  app.post('/api/team/ask', wrap(async (req, res) => {
    const B = await biz(), convo = (Array.isArray(req.body.messages) ? req.body.messages : []).slice(-10).filter(m => m && m.text);
    if (!convo.length || convo[convo.length - 1].role !== 'owner') return res.status(400).json({ error: 'Ask a question first.' });
    const e = TEAM[req.body.employee] ? req.body.employee : route(convo[convo.length - 1].text);
    const [used] = await q(`SELECT count(*)::int AS n FROM team_calls WHERE business_id=$1 AND at > now() - interval '24 hours'`, [B.id]);
    if (used.n >= DAILY_CAP) return res.status(429).json({ error: `Your team answered ${DAILY_CAP} questions today; they’re back tomorrow. This keeps the receptionist’s AI free for your customers.` });
    const results = [], used_tools = [];
    let out = null;
    for (let step = 0; step < MAX_STEPS; step++) {
      try { out = await ask(prompt(B, e, convo, results)); }
      catch (err) { if (step === 0) return res.status(err.status || 503).json({ error: err.status ? err.message : 'The AI isn’t reachable right now. Try again in a minute.' }); break; }
      await q('INSERT INTO team_calls (business_id, employee) VALUES ($1,$2)', [B.id, e]);
      const calls = Array.isArray(out.tools) ? out.tools.slice(0, 3) : [];
      if (!calls.length || out.answer) break;
      for (const c of calls) {
        const t = TOOLS[c.name];
        const data = t && TEAM[e].tools.includes(c.name) ? await t.run(B, c.args || {}).catch(err => ({ error: err.message })) : { error: `No tool called ${c.name}.` };
        results.push({ name: c.name, args: c.args || {}, data }); used_tools.push(c.name);
      }
      if (step === MAX_STEPS - 2) convo.push({ role: 'system', text: 'Answer now with what you have.' });
    }
    const answer = out?.answer || 'I couldn’t finish that one. Try asking it a bit more specifically.';
    const actions = (Array.isArray(out?.actions) ? out.actions : []).filter(a => a && TEAM[e].actions.includes(a.type)).slice(0, 5);
    // actions carry the client's name so the owner sees who they approve
    for (const a of actions) if (a.customer_id) a.client = (await one('SELECT name FROM customers WHERE id=$1 AND business_id=$2', [+a.customer_id, B.id]))?.name || null;
    res.json({ employee: e, answer, actions: actions.filter(a => a.type !== 'send_message' || a.client), tools: [...new Set(used_tools)] });
  }));
  // the owner approved one proposed action
  app.post('/api/team/act', wrap(async (req, res) => {
    const B = await biz(), a = req.body || {};
    if (a.type === 'add_rule') {
      const text = String(a.text || '').trim().slice(0, 400); if (!text) return res.status(400).json({ error: 'Empty rule.' });
      const r = (await one('SELECT ai_rules FROM businesses WHERE id=$1', [B.id])).ai_rules || [];
      await q('UPDATE businesses SET ai_rules=$1 WHERE id=$2', [JSON.stringify([...r, { text }].slice(-40)), B.id]);
      await q('INSERT INTO ai_versions (business_id, note) VALUES ($1,$2)', [B.id, `Rule: ${text.slice(0, 80)}`]);
      await audit(req, 'team_rule', text); return res.json({ ok: true, done: 'Rule added. The receptionist follows it from now on.' });
    }
    if (a.type === 'teach_answer') {
      const l = await one('SELECT * FROM learning WHERE id=$1 AND business_id=$2', [+a.learning_id, B.id]); if (!l) return res.sendStatus(404);
      const answer = String(a.answer || '').trim().slice(0, 1500); if (!answer) return res.status(400).json({ error: 'Empty answer.' });
      const b = await one('SELECT faqs FROM businesses WHERE id=$1', [B.id]), faqs = (b.faqs || []).filter(f => f.q.toLowerCase() !== l.question.toLowerCase());
      await q('UPDATE businesses SET faqs=$1 WHERE id=$2', [JSON.stringify([...faqs, { q: l.question.slice(0, 300), a: answer }].slice(-60)), B.id]);
      await q(`UPDATE learning SET status='answered', answer=$1, answered_at=now() WHERE business_id=$2 AND status='open' AND lower(question)=lower($3)`, [answer, B.id, l.question]);
      await audit(req, 'team_teach', l.question); return res.json({ ok: true, done: 'Saved. The receptionist uses this answer from now on.' });
    }
    if (a.type === 'send_message') {
      const c = await one(`SELECT cu.id, cu.name, cu.phone, cu.telegram_chat_id, (SELECT c.channel FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1) AS channel,
          (SELECT c.id FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1) AS conv_id,
          (SELECT max(m.created_at) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.customer_id=cu.id AND m.role='customer') AS last_msg
          FROM customers cu WHERE cu.id=$1 AND cu.business_id=$2`, [+a.customer_id, B.id]);
      if (!c) return res.sendStatus(404);
      const text = String(a.text || '').trim().slice(0, 900); if (!text) return res.status(400).json({ error: 'Empty message.' });
      const wa = c.channel === 'whatsapp' && c.last_msg && Date.now() - new Date(c.last_msg) < 23.5 * 3600e3, tg = c.channel === 'telegram' && c.telegram_chat_id;
      if (!wa && !tg) return res.json({ ok: false, link: /^\+?\d{7,15}$/.test(String(c.phone).replace(/[\s-]/g, '')) ? `https://wa.me/${String(c.phone).replace(/\D/g, '')}?text=${encodeURIComponent(text)}` : null,
        done: `${c.name} can’t be reached by the app right now (WhatsApp allows it only within 24 hours of their last message).` });
      const r = tg ? await sendTelegram(c.telegram_chat_id, text, B.id) : await sendWhatsApp((await one('SELECT wa_phone_number_id FROM businesses WHERE id=$1', [B.id])).wa_phone_number_id, c.phone, text);
      if (!r.ok) return res.json({ ok: false, done: `Not sent: ${r.reason}` });
      if (c.conv_id) await q(`INSERT INTO messages (conversation_id, role, text, source) VALUES ($1,'staff',$2,'team')`, [c.conv_id, text]);
      await audit(req, 'team_message', `to ${c.name}`); return res.json({ ok: true, done: `Sent to ${c.name}.` });
    }
    if (a.type === 'run_agent') return res.json({ ok: false, open: 'agents', done: 'Open Agents to review and send this agent’s messages.' });
    res.status(400).json({ error: 'Unknown action.' });
  }));
}
