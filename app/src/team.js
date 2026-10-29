// The AI team: four employees the owner can ask anything about the business. Each has a role, skills and a set of
// tools. A question runs a short loop: the employee picks tools, Pulse runs them on the real data, and the employee
// answers using only what the tools returned, so numbers are exact. Anything that changes something or contacts a
// customer is only proposed; the owner approves it with a button and /api/team/act carries it out.
// AI: the n8n "Pulse assistant" workflow (prompt in, text out). Calls share the receptionist's per-minute pacing and
// have their own daily cap, so the team can never use up the receptionist's quota.
import { q, one, pool } from './db.js';
import { loadBusiness, takeAiSlot } from './brain.js';
import { freeSlots, bufferOf, hoursText } from './slots.js';
import { agentFindings } from './agents.js';
import * as metrics from './metrics.js';
import { addShortcut } from './shortcuts.js';
import { addRule } from './rules.js';

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
// The daily limit counts questions the owner asked (one row per question, however many AI steps it took),
// over the business's own calendar day. The receptionist is protected separately by takeAiSlot's per-minute pacing.
const DAILY_CAP = +process.env.TEAM_DAILY_QUESTIONS || 150, MAX_STEPS = 5;
const USED_TODAY = `SELECT count(*)::int AS n FROM team_calls WHERE business_id=$1
  AND (at AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE id=$1),'Asia/Beirut'))::date = (now() AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE id=$1),'Asia/Beirut'))::date`;
const URL_ = () => process.env.ASSISTANT_WEBHOOK_URL || String(process.env.N8N_WEBHOOK_URL || '').replace(/\/webhook\/.*$/, '/webhook/pulse-assistant');
const TZ = `COALESCE(bz.timezone,'Asia/Beirut')`;
const day = d => `to_char(${d} AT TIME ZONE ${TZ},'Dy DD Mon HH24:MI')`;
// real clients: no test phones, and not people whose latest chat is a test chat
const REAL = `cu.phone !~ '^(test|e2e|walk-in|tg-)' AND COALESCE((SELECT c.channel FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1),'') <> 'test'`;

// Every employee can read every tool (the business is one piece); the ones listed per employee are their own
// and come first. Actions stay with the role that owns them.
export const TEAM = {
  maya: { name: 'Maya', role: 'Front desk manager', avatar: 'M', skills: 'bookings, the calendar, free times, who is coming, customer profiles',
    tools: ['today', 'bookings', 'free_slots', 'find_customer', 'customer', 'services'], actions: ['send_message'] },
  omar: { name: 'Omar', role: 'Customer support lead', avatar: 'O', skills: 'conversations, complaints, handovers, unanswered questions, ratings and reviews, the AI receptionist’s rules',
    tools: ['support', 'conversations', 'conversation', 'unanswered', 'reviews', 'rules', 'find_customer'], actions: ['send_message', 'teach_answer', 'add_rule'] },
  lina: { name: 'Lina', role: 'Growth manager', avatar: 'L', skills: 'bringing clients back, warm leads, filling quiet days, offers, loyal customers',
    tools: ['opportunities', 'top_customers', 'quiet_days', 'find_customer', 'customer', 'services'], actions: ['send_message', 'run_agent'] },
  sam: { name: 'Sam', role: 'Business analyst', avatar: 'S', skills: 'revenue, trends, services, channels, no-shows, busiest times, what to improve',
    tools: ['overview', 'revenue', 'by_service', 'by_channel', 'busy_times', 'top_customers', 'support', 'today'], actions: [] },
  // Pulse AI: one assistant for the whole dashboard, with every tool and every action of the four above
  pulse: { name: 'Pulse AI', title: 'Business partner', role: 'business partner: senior consultant and chief of staff with deep expertise in strategy, marketing, sales, operations, finance, pricing, customer experience, HR and data analysis', avatar: 'P',
    skills: 'everything in the dashboard: bookings and the calendar, customers, conversations and support, Nora the receptionist and her rules, growth and offers, revenue and trends, and the dashboard itself (shortcuts, where to find things, how to use each page)',
    tools: ['today', 'bookings', 'free_slots', 'find_customer', 'customer', 'services', 'support', 'conversations', 'conversation', 'unanswered', 'reviews', 'rules', 'opportunities', 'top_customers', 'quiet_days', 'overview', 'revenue', 'by_service', 'by_channel', 'busy_times'],
    actions: ['send_message', 'teach_answer', 'add_rule', 'run_agent', 'add_shortcut', 'book', 'move_booking', 'set_booking_status', 'block_time', 'open_page'] },
};
// who answers when the owner doesn't pick: by the words in the question
export function route(text) {
  return 'pulse';
}
export function routeByTopic(text) {
  const t = String(text).toLowerCase();
  if (/complain|unhappy|review|rating|handover|handed|unanswer|support|rule|teach|reply|answer/.test(t)) return 'omar';
  if (/win back|lapsed|haven.?t come|offer|promo|campaign|lead|quiet|fill|loyal|regular|grow|marketing|best (client|customer)|top (client|customer)|vip/.test(t)) return 'lina';
  if (/revenue|money|earn|trend|month|week|compare|average|ticket|channel|service sold|no.?show rate|analy|report|best|worst/.test(t)) return 'sam';
  return 'maya';
}

// ---------- tools: every one reads the business's real data ----------
const TOOLS = {
  today: { about: 'today: appointments, revenue, chats waiting for the owner, approvals, AI replies', args: '{}',
    run: async B => ({ ...await metrics.today(B.id).then(m => ({ appointments_today: m.visits_today, revenue_today: m.revenue_today })), ...(await q(`SELECT
      (SELECT count(*) FROM bookings WHERE business_id=$1 AND status<>'cancelled' AND created_at > now() - interval '24 hours')::int AS booked_last_24h,
      (SELECT count(*) FROM conversations WHERE business_id=$1 AND needs_attention AND channel<>'test')::int AS chats_waiting_for_owner,
      (SELECT count(*) FROM requests WHERE business_id=$1 AND status='pending')::int AS approvals_waiting,
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 AND m.role='assistant' AND m.created_at > now() - interval '24 hours')::int AS ai_replies_24h,
      to_char(now() AT TIME ZONE $2,'Dy DD Mon YYYY HH24:MI') AS now`, [B.id, B.tz]))[0] }) },
  bookings: { about: 'bookings in a date range (default: next 7 days), with time, client, service, price, status and who booked it', args: '{"from":"YYYY-MM-DD","to":"YYYY-MM-DD","status":"confirmed|completed|no_show|cancelled|any"}',
    run: async (B, a) => { const list = await q(`SELECT b.id AS booking_id, ${day('b.starts_at')} AS at, cu.name AS client, cu.id AS client_id, s.name AS service, b.price::float, b.status, b.source AS booked_by
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
  services: { about: 'the services with price and length', args: '{}', run: async B => q(`SELECT id AS service_id, name, price::float, minutes FROM services WHERE business_id=$1 ORDER BY name`, [B.id]) },
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
      return { period: `last ${d} days`, ...s, ...open, handover_reasons: reasons, top_topics: topics, note: 'test chats are excluded' };
    } },
  conversations: { about: 'recent conversations, optionally only those waiting for the owner, or of one kind (booking, question, change, complaint, cancel)', args: '{"waiting":true,"kind":"complaint","days":7}',
    run: async (B, a) => q(`SELECT c.id AS chat_id, cu.name AS client, cu.id AS client_id, c.channel, c.kind, c.topic, c.mood, c.outcome, c.needs_attention AS waiting_for_owner, c.attention_reason AS why,
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
    run: async (B, a) => q(`SELECT c.id AS chat_id, cu.name AS client, cu.id AS client_id, c.rating, c.rating_comment AS comment, c.topic, ${day('c.rated_at')} AS at FROM conversations c JOIN customers cu ON cu.id=c.customer_id JOIN businesses bz ON bz.id=c.business_id
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
      return { period: `last ${d} days`, compared_with: `the ${d} days before`, this_period: cur, previous_period: prev, new_clients: nc.n, note: 'same numbers as the Insights page: bookings not cancelled starting in the period; test chats excluded from new clients' }; } },
  revenue: { about: 'revenue and bookings per week for the last N weeks', args: '{"weeks":8}',
    run: async (B, a) => q(`SELECT to_char(date_trunc('week', starts_at AT TIME ZONE $2),'DD Mon') AS week, count(*)::int AS bookings, sum(price)::float AS revenue FROM bookings
      WHERE business_id=$1 AND status IN ('completed','confirmed') AND starts_at <= now() AND starts_at > now() - make_interval(weeks => $3) GROUP BY 1, date_trunc('week', starts_at AT TIME ZONE $2) ORDER BY date_trunc('week', starts_at AT TIME ZONE $2)`, [B.id, B.tz, Math.min(+a.weeks || 8, 52)]) },
  by_service: { about: 'bookings, revenue, cancellations and no-shows per service for N days', args: '{"days":30}',
    run: async (B, a) => ({ period: `last ${Math.min(+a.days || 30, 365)} days`, services: await q(`SELECT s.name AS service, count(*) FILTER (WHERE b.status IN ('completed','confirmed'))::int AS bookings, COALESCE(sum(b.price) FILTER (WHERE b.status IN ('completed','confirmed')),0)::float AS revenue,
      count(*) FILTER (WHERE b.status='cancelled')::int AS cancelled, count(*) FILTER (WHERE b.status='no_show')::int AS no_shows
      FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.business_id=$1 AND b.starts_at > now() - make_interval(days => $2) GROUP BY s.name ORDER BY revenue DESC`, [B.id, Math.min(+a.days || 30, 365)]) }) },
  by_channel: { about: 'where bookings came from for N days (AI chat per channel, online page, manual)', args: '{"days":30}',
    run: async (B, a) => q(`SELECT COALESCE(CASE WHEN b.source='ai' THEN c.channel ELSE b.source END,'other') AS channel, count(*)::int AS bookings, sum(b.price)::float AS value
      FROM bookings b LEFT JOIN conversations c ON c.id=b.conversation_id WHERE b.business_id=$1 AND b.status<>'cancelled' AND b.created_at > now() - make_interval(days => $2) GROUP BY 1 ORDER BY 2 DESC`, [B.id, Math.min(+a.days || 30, 365)]) },
  busy_times: { about: 'booked appointments by weekday and hour for N days', args: '{"days":60}',
    run: async (B, a) => q(`SELECT to_char(starts_at AT TIME ZONE $2,'Dy') AS weekday, extract(hour FROM starts_at AT TIME ZONE $2)::int AS hour, count(*)::int AS bookings FROM bookings
      WHERE business_id=$1 AND status<>'cancelled' AND starts_at > now() - make_interval(days => $3) GROUP BY 1,2 ORDER BY 3 DESC LIMIT 15`, [B.id, B.tz, Math.min(+a.days || 60, 365)]) },
};
// ---------- any question about the data: a read-only query, fenced in ----------
// The model writes one SELECT against these views only; each one is this business's rows and nothing else.
// Any other real table name, any write, and any system function are refused before the query runs; it runs in a
// read-only transaction with a 3 second limit and returns at most 200 rows.
const VIEWS = {
  bookings: `SELECT id, customer_id, service_id, conversation_id, starts_at, ends_at, price::float AS price, status, source, created_at FROM public.bookings WHERE business_id=$1`,
  customers: `SELECT id, name, phone, email, marketing_ok, created_at FROM public.customers WHERE business_id=$1`,
  services: `SELECT id, name, price::float AS price, minutes FROM public.services WHERE business_id=$1`,
  conversations: `SELECT id, customer_id, channel, outcome, kind, topic, mood, rating, rating_comment, needs_attention, attention_reason, created_at, updated_at FROM public.conversations WHERE business_id=$1`,
  messages: `SELECT m.id, m.conversation_id, m.role, m.text, m.source, m.created_at FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id WHERE c.business_id=$1`,
  requests: `SELECT id, booking_id, conversation_id, type, details, status, created_at FROM public.requests WHERE business_id=$1`,
  questions: `SELECT id, question, status, answer, created_at FROM public.learning WHERE business_id=$1`,
  campaigns: `SELECT id, name, message, sent, skipped, created_at FROM public.campaigns WHERE business_id=$1`,
  time_off: `SELECT id, starts_at, ends_at, reason FROM public.time_off WHERE business_id=$1`,
};
let REAL_TABLES = null;
async function safeQuery(B, sql) {
  sql = String(sql || '').trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(sql)) return { error: 'Only one SELECT query is allowed.' };
  if (/;|--|\/\*/.test(sql)) return { error: 'One statement only, no comments.' };
  if (/\b(insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|vacuum|analyze|set|reset|listen|notify|lock|prepare|refresh|security|into)\b/i.test(sql)) return { error: 'Read-only: that keyword is not allowed.' };
  if (/\b(pg_\w+|information_schema|current_setting|set_config|dblink\w*|lo_\w+|version|inet_\w+|txid_\w+|query_to_xml\w*|xpath)\b|\bpublic\s*\.|"/i.test(sql)) return { error: 'System functions, schema names and quoted names are not allowed.' };
  REAL_TABLES ||= new Set((await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).map(r => r.table_name));
  const words = new Set((sql.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || []));
  const bad = [...words].filter(w => REAL_TABLES.has(w) && !VIEWS[w]);
  if (bad.length) return { error: `Only these tables can be used: ${Object.keys(VIEWS).join(', ')}.` };
  const used = Object.keys(VIEWS).filter(v => words.has(v));
  const full = `WITH ${used.map(v => `${v} AS (${VIEWS[v]})`).join(', ') || 'nothing AS (SELECT 1)'} SELECT * FROM (${sql}) AS answer LIMIT 200`;
  const c = await pool.connect();
  try {
    await c.query('BEGIN READ ONLY'); await c.query(`SET LOCAL statement_timeout = 3000`); await c.query(`SET LOCAL TIME ZONE '${B.tz.replace(/'/g, '')}'`);
    const r = await c.query(full, [B.id]);
    // dates leave as the business's local time ("2026-10-27 18:00"), never as UTC the model could misread
    const local = d => d.toLocaleString('sv-SE', { timeZone: B.tz }).slice(0, 16);
    const rows = r.rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? local(v) : v])));
    return { rows, count: rows.length, times: `local time (${B.tz})`, note: rows.length === 200 ? 'only the first 200 rows' : undefined };
  } catch (e) { return { error: `Query failed: ${e.message}` }; }
  finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
}
TOOLS.query = { about: 'ANY other question about this business’s data: write one PostgreSQL SELECT using only these tables (already limited to this business; times in its time zone): '
  + 'bookings(id, customer_id, service_id, conversation_id, starts_at, ends_at, price, status confirmed|completed|no_show|cancelled, source ai|web|manual, created_at), customers(id, name, phone, email, marketing_ok, created_at), '
  + 'services(id, name, price, minutes), conversations(id, customer_id, channel, outcome booked|answered|handoff, kind, topic, mood, rating 1-5, rating_comment, needs_attention, attention_reason, created_at, updated_at), '
  + 'messages(id, conversation_id, role customer|assistant|owner|staff, text, source, created_at), requests(id, booking_id, conversation_id, type, details, status, created_at), questions(id, question, status, answer, created_at), '
  + 'campaigns(id, name, message, sent, skipped, created_at), time_off(id, starts_at, ends_at, reason). Use it whenever the other tools don’t fit.', args: '{"sql":"SELECT ..."}',
  run: (B, a) => safeQuery(B, a.sql) };
// Forecast from the business's own history: a straight-line trend over the last 12 weeks, never below what is
// already booked, with a low-high range from how much past weeks swung around the trend. No AI guessing.
TOOLS.forecast = { about: 'forecast revenue and bookings for the next N weeks (default 4) from the last 12 weeks trend plus what is already booked, with a low-high range and the method', args: '{"weeks":4}',
  run: async (B, a) => {
    const n = Math.min(Math.max(+a.weeks || 4, 1), 12);
    const past = await q(`SELECT w.wk, COALESCE(sum(b.price),0)::float AS revenue, count(b.id)::int AS bookings
        FROM generate_series(date_trunc('week', now() AT TIME ZONE $2) - interval '12 weeks', date_trunc('week', now() AT TIME ZONE $2) - interval '1 week', interval '1 week') AS w(wk)
        LEFT JOIN bookings b ON b.business_id=$1 AND b.status IN ('completed','confirmed') AND date_trunc('week', b.starts_at AT TIME ZONE $2)=w.wk GROUP BY 1 ORDER BY 1`, [B.id, B.tz]);
    const booked = await q(`SELECT w.wk, COALESCE(sum(b.price),0)::float AS revenue, count(b.id)::int AS bookings
        FROM generate_series(date_trunc('week', now() AT TIME ZONE $2), date_trunc('week', now() AT TIME ZONE $2) + make_interval(weeks => $3 - 1), interval '1 week') AS w(wk)
        LEFT JOIN bookings b ON b.business_id=$1 AND b.status='confirmed' AND date_trunc('week', b.starts_at AT TIME ZONE $2)=w.wk GROUP BY 1 ORDER BY 1`, [B.id, B.tz, n]);
    const fit = k => { const y = past.map(r => r[k]), m = y.length, xm = (m - 1) / 2, ym = y.reduce((a, b) => a + b, 0) / m;
      const slope = y.reduce((a, v, i) => a + (i - xm) * (v - ym), 0) / (y.reduce((a, _, i) => a + (i - xm) ** 2, 0) || 1);
      const sd = Math.sqrt(y.reduce((a, v, i) => a + (v - (ym + slope * (i - xm))) ** 2, 0) / Math.max(m - 2, 1));
      return { at: i => Math.max(0, ym + slope * (m - xm + i)), slope, sd, avg: ym }; };
    const R = fit('revenue'), K = fit('bookings'), d = x => x.toISOString().slice(0, 10), r0 = x => Math.round(x);
    const weeks = booked.map((w, i) => { const rev = Math.max(R.at(i), w.revenue), bk = Math.max(K.at(i), w.bookings);
      return { week_of: d(w.wk), already_booked_revenue: w.revenue, already_booked: w.bookings, forecast_revenue: r0(rev), low: r0(Math.max(w.revenue, rev - R.sd)), high: r0(rev + R.sd), forecast_bookings: r0(bk) }; });
    return { method: 'linear trend over the last 12 full weeks, never below what is already booked; low/high = ±1 typical weekly swing', currency: B.currency || 'USD',
      last_12_weeks_avg_revenue: r0(R.avg), trend_per_week: r0(R.slope), total_forecast_revenue: weeks.reduce((a, w) => a + w.forecast_revenue, 0),
      confidence: past.filter(r => r.bookings).length >= 6 ? 'normal' : 'low: fewer than 6 weeks with bookings, treat as a rough guide', weeks, history: past.map(r => ({ week_of: d(r.wk), revenue: r.revenue, bookings: r.bookings })) };
  } };
TOOLS.business_info = { about: 'the business itself: name, address, opening hours, services with prices, policies, FAQ answers, team, payment methods, languages', args: '{}',
  run: async B => { const b = await loadBusiness(B.id);
    return { name: b.name, type: b.vertical, address: b.address, phone: b.phone, opening_hours: hoursText(b), services: b.services.map(s => ({ name: s.name, price: Number(s.price), minutes: s.minutes })),
      policies: b.policies, faq: [b.faq, ...(b.faqs || []).map(f => `Q: ${f.q} A: ${f.a}`)].filter(Boolean).join('\n').slice(0, 3000), team: b.team, payment_methods: b.payment_methods, languages: b.languages, booking_note: b.booking_note,
      cancellation_notice_hours: b.cancel_hours ?? 24, reminder_hours_before: b.reminder_hours, minimum_booking_notice_hours: b.booking_min_notice_hours }; } };

// where each tool's data lives in the dashboard, so an answer can send the owner to the source
const SOURCE = {
  today: ['Today', { page: 'home' }], bookings: ['Calendar', { view: 'calendar' }], free_slots: ['Calendar', { view: 'calendar' }], services: ['Services', { page: 'settings', tab: 'details' }],
  find_customer: ['Customers', { page: 'people', tab: 'clients' }], customer: ['Customers', { page: 'people', tab: 'board' }], top_customers: ['Best clients', { page: 'people', tab: 'board' }],
  support: ['Support', { page: 'support', tab: 'live' }], conversations: ['Inbox', { page: 'inbox', tab: 'conversations' }], conversation: ['Inbox', { page: 'inbox', tab: 'conversations' }],
  unanswered: ['Knowledge gaps', { page: 'support', tab: 'gaps' }], reviews: ['Satisfaction', { page: 'support', tab: 'reviews' }], rules: ['Teach AI', { view: 'training' }],
  opportunities: ['Waiting for your OK', { view: 'agents' }], quiet_days: ['Calendar', { view: 'calendar' }],
  business_info: ['Business details', { page: 'settings', tab: 'details' }],
  overview: ['Insights · Money', { page: 'analytics', tab: 'overview' }], revenue: ['Insights · Money', { page: 'analytics', tab: 'overview' }], by_service: ['Insights · Money', { page: 'analytics', tab: 'overview' }],
  by_channel: ['Performance · Channels', { page: 'performance', tab: 'channels' }], busy_times: ['Insights · Timing', { page: 'analytics', tab: 'timing' }],
};
// clients and chats named in the data, so the owner can open them from the answer
function mentions(results) {
  const clients = new Map(), chats = new Map();
  const walk = (o, tool) => { if (Array.isArray(o)) return o.forEach(x => walk(x, tool)); if (!o || typeof o !== 'object') return;
    if (o.client_id && o.client) clients.set(o.client_id, o.client);
    if ((tool === 'find_customer' || tool === 'top_customers' || tool === 'customer') && o.id && o.name) clients.set(o.id, o.name);
    if (o.chat_id && o.client) chats.set(o.chat_id, o.client);
    Object.values(o).forEach(v => typeof v === 'object' && walk(v, tool)); };
  results.forEach(r => walk(r.data, r.name));
  return { clients: [...clients].map(([id, name]) => ({ id, name })).slice(0, 30), chats: [...chats].map(([id, client]) => ({ id, client })).slice(0, 20) };
}
// actions are only proposed; the owner approves each one
// the dashboard's pages and tabs, for shortcuts (same order as public/pulse.js)
export const PAGE_TABS = {
  today: ['Today'], inbox: ['Conversations', 'Needs you', 'Delivery queue'], calendar: ['Schedule', 'Requests', 'Booking page'],
  customers: ['Clients', 'Board', 'Win back', 'Reviews'], marketing: ['Offers', 'Discount codes', 'Agents', 'Website texts', 'Website photos', 'Website design', 'Website address'],
  pulse: ['Approvals', 'Ask Pulse', 'Brief'], train: ['Coach', 'Rules', 'Answers', 'Review replies'], lab: ['Scenarios', 'Test chat', 'Versions'],
  insights: ['AI performance', 'Live flow', 'Topics', 'Business', 'Services', 'Timing', 'Channels'],
  settings: ['Profile', 'Assistant', 'Hours & team', 'Services', 'FAQs', 'Policies & payments', 'Tools', 'Channels', 'Reminders', 'Security & devices', 'Look & layout'],
};
const SHORTCUT_PAGES = Object.entries(PAGE_TABS).map(([p, t]) => `${p} [${t.map((x, i) => `${i} ${x}`).join(', ')}]`).join('; ');
const ACTIONS = {
  send_message: 'message one client: {"type":"send_message","customer_id":123,"text":"..."}',
  teach_answer: 'save the answer to an unanswered question: {"type":"teach_answer","learning_id":12,"answer":"..."}',
  add_rule: 'add a strict rule for the AI receptionist: {"type":"add_rule","text":"..."}',
  run_agent: 'let a growth agent send its prepared messages: {"type":"run_agent","agent":"winback|leads|fill|noshow|reviews"}',
  book: 'book an appointment (check free_slots first): {"type":"book","name":"client name","phone":"+961...","service_id":3,"start":"YYYY-MM-DDTHH:MM","label":"Book Rana, Manicure, Mon 10:30"}',
  move_booking: 'move a booking (booking_id from the bookings tool; check free_slots first): {"type":"move_booking","booking_id":12,"start":"YYYY-MM-DDTHH:MM","label":"Move Rana to Tue 14:00"}',
  set_booking_status: 'cancel a booking or mark it: {"type":"set_booking_status","booking_id":12,"status":"cancelled|completed|no_show|confirmed","label":"Cancel Rana, Mon 10:30"}',
  block_time: 'block time in the calendar so nobody can book it: {"type":"block_time","start":"YYYY-MM-DDTHH:MM","end":"YYYY-MM-DDTHH:MM","reason":"...","label":"Block Fri 13:00-15:00"}',
  open_page: `take the owner to a dashboard page (no approval needed): {"type":"open_page","page":"page id","tab":0,"label":"Open Calendar"}. Pages: ${SHORTCUT_PAGES}`,
  add_shortcut: `add a shortcut button to the owner's Home page: {"type":"add_shortcut","label":"short name","page":"page id","tab":0} to open a page, or {"type":"add_shortcut","label":"short name","ask":"a question for Pulse AI"} to ask you something in one click. Pages and their tabs (tab is the 0-based index): ${SHORTCUT_PAGES}`,
};

function prompt(B, e, convo, results, page, memory = []) {
  const emp = TEAM[e];
  return `You are ${emp.name}, the ${emp.role} at ${B.name}, a ${B.vertical || 'service'} business. You work for the owner inside their Pulse dashboard.
Your skills: ${emp.skills}. You are accurate, brief and practical, like a senior employee who owns this area.
Today is ${B.now} (${B.tz}). Currency: ${B.currency || 'USD'}.${page ? `\nThe owner is looking at the ${page} page of the dashboard right now; questions like "this" or "here" mean that page.` : ''}

${e === 'pulse' ? `WHO YOU ARE: the owner's full-time partner. Think like a top consultant who knows this business inside out: diagnose with the data, then recommend the single best move and why, with the expected impact. Push back politely when the owner's idea is weaker than an alternative. Be proactive: point out risks and opportunities you see in the data. For forecasts use the forecast tool and always give the range and how sure it is.
WHAT YOU REMEMBER ABOUT THIS OWNER AND BUSINESS (from earlier chats; use it, don't repeat it back):
${memory.length ? memory.map(m => `- ${m}`).join('\n') : '- nothing yet'}
MEMORY: when the owner tells you a lasting preference, goal, fact or decision (e.g. "I want 20% more revenue by December", "never discount haircuts", "my busiest stylist is Rana"), add "remember":["one short fact"] to your JSON. Only lasting things, never one-off questions or numbers you can fetch.

` : ''}HOW YOU WORK
- You can answer ANY question the owner asks. Facts about this business (numbers, names, dates, bookings, chats, settings) come only from tools; use the query tool for anything the other tools don't cover. General know-how (marketing ideas, writing a post or message, pricing, customer service, how to handle a situation, how Pulse works) comes from your own expertise: give a real, specific answer, tailored with the business's data when it helps.
- Never guess or invent business facts. If the data truly doesn't have it, say so and say what would.
- Never ask the owner whether you should look something up: if the answer needs more data, fetch it now and answer completely.
- Never count or add up yourself when a tool gives a count or total: copy it exactly (count, total_value, revenue, bookings).
- Think like the owner's best employee: answer the question, then add what they would want to know next (a risk, a gap, an opportunity) if the data shows one. Compare with a previous period when it makes a number meaningful.
- Before you answer, check: every number, name, date and time you wrote appears in TOOL RESULTS. If one doesn't, fetch it or leave it out.
- Always say the period a number covers, exactly as the tool's "period" or dates say ("last 30 days", "today"). If the owner asked for a different period, fetch that period (e.g. days: 7 for this week).
- FILES AND TABLES: every tool result you fetch is shown under your answer as a table the owner can download as CSV or print as a PDF report. So for "export", "list", "download", "report" or "send me a file", fetch the data with the right tool (or query) and say the file is ready below; never say exports aren't possible.
- You can act in the dashboard: book, move, cancel or mark bookings, block time, message clients, teach the receptionist, add rules and shortcuts, and open any page. Propose these as actions; the owner approves each one. Never tell the owner to do something by hand that an action can do.
- Fetch everything you need in as few rounds as possible: you may call up to 4 tools at once. For a big question (advice, a plan, a diagnosis) fetch from several angles first: the numbers, the trend, the customers and the capacity.
- Reply with ONE JSON object and nothing else:
  {"thinking":"one short sentence: what you need to find out and why","tools":[{"name":"tool","args":{...}}]}  to fetch data (up to 4 tools at once), or
  {"answer":"your reply to the owner","actions":[...],"remember":[...]}  when you can answer (actions and remember are optional).
- WRITE LIKE A TOP ANALYST (Markdown):
  1. Start with the direct answer in one or two sentences, with the key number in **bold**. No preamble, no "Here is", no "Great question".
  2. Then the evidence: a short list, or a Markdown table (| a | b |) when you compare 3+ things. Every figure with its period.
  3. Then "### Recommendation": the single best move, why it works, and the expected impact in numbers. Add a second move only if it is clearly worth it.
  4. Use ### headings only in longer answers; short questions get short answers (2-4 lines, no headings).
  Never pad, never repeat the question, never list generic tips that ignore the data. Be specific: names, dates, amounts.
- LANGUAGE: write your answer in ${/[؀-ۿ]/.test(convo.filter(m => m.role === 'owner').pop()?.text || '') ? 'Arabic' : 'English'}, the language of the owner's question (customer messages stay in the client's language).
- Actions are proposals the owner approves with one click. Only propose an action when it clearly helps; write customer messages warm, short and in the client's language.
- Never invent facts about the business (prices, products, policies, opening times, offers). In a teach_answer or a message, any fact the tools didn't give you goes in square brackets for the owner to fill, e.g. "[Yes / No], we [do / don't] sell gift cards[, from amount]." Even yes or no goes in brackets when the tools don't say.
- Answer every question fully yourself, whatever the topic; never send the owner to a colleague instead of answering.

YOUR TOOLS
${[...emp.tools, ...Object.keys(TOOLS).filter(t => !emp.tools.includes(t))].map(t => `- ${t} ${TOOLS[t].args}: ${TOOLS[t].about}`).join('\n')}
${emp.actions.length ? `\nACTIONS YOU MAY PROPOSE\n${emp.actions.map(a => `- ${ACTIONS[a]}`).join('\n')}` : '\nYou propose no actions; you explain and recommend.'}

CONVERSATION
${convo.map(m => `${m.role === 'owner' ? 'OWNER' : m.role === 'system' ? 'NOTE' : emp.name.toUpperCase()}: ${String(m.text).slice(0, 1500)}`).join('\n')}
${results.length ? `\nTOOL RESULTS (real data)\n${results.map(r => `${r.name}(${JSON.stringify(r.args)}) => ${JSON.stringify(r.data).slice(0, 3500)}`).join('\n')}` : ''}

Your JSON:`;
}
// The team thinks with a stronger model than the receptionist (TEAM_MODEL); Gemini counts its free quota separately.
// If that model fails or is out of quota, the receptionist's model answers instead.
const TEAM_MODEL = () => process.env.TEAM_MODEL || 'models/gemini-3.5-flash';
async function ask(text) {
  // the per-minute allowance is shared with the receptionist: wait a little for a free slot before giving up
  let slot = false;
  for (let i = 0; i < 6 && !(slot = await takeAiSlot()); i++) await new Promise(r => setTimeout(r, 2500));
  if (!slot) throw Object.assign(new Error('The AI is busy right now. Try again in a minute.'), { status: 429 });
  let r;
  for (const model of [TEAM_MODEL(), process.env.AI_MODEL].filter(Boolean)) {
    r = await fetch(URL_(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text, model }), signal: AbortSignal.timeout(40000) }).catch(() => null);
    if (r && r.ok) break;
  }
  if (!r || !r.ok) throw new Error(`The AI didn't respond (${r ? r.status : 'no connection'}).`);
  const body = await r.json();
  return readReply(typeof body === 'string' ? body : body.output ?? body.text ?? '');
}
// The model answers in JSON, but not always perfectly. Repair what can be repaired; a reply that is still
// broken JSON is marked so the loop asks again instead of showing it to the owner.
export function readReply(raw) {
  raw = String(raw).trim();
  const m = raw.match(/\{[\s\S]*\}/), body = m ? m[0] : raw;
  try { return JSON.parse(body); } catch {}
  try { return JSON.parse(body.replace(/,\s*\{\s*\}/g, ',"args":{}').replace(/("name"\s*:\s*"\w+")\s*,\s*\{/g, '$1,"args":{').replace(/,\s*([}\]])/g, '$1')); } catch {}
  const names = [...body.matchAll(/"name"\s*:\s*"(\w+)"/g)].map(x => x[1]);
  if (/"tools"/.test(body) && names.length) return { tools: names.map(name => ({ name, args: {} })) };
  const ans = body.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (ans) { try { return { answer: JSON.parse(`"${ans[1]}"`) }; } catch { return { answer: ans[1] }; } }
  if (/^\{|^```/.test(raw)) return { broken: true };
  return { answer: raw };
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
      (SELECT count(*) FROM conversations WHERE business_id=$1 AND needs_attention AND channel<>'test')::int AS open_cases,
      (SELECT count(*) FROM conversations c WHERE business_id=$1 AND attention_reason IS NOT NULL AND NOT needs_attention AND updated_at > now() - interval '7 days')::int AS solved_cases_7d,
      (SELECT count(DISTINCT lower(l.question)) FROM learning l LEFT JOIN conversations c ON c.id=l.conversation_id WHERE l.business_id=$1 AND l.status='open' AND c.channel IS DISTINCT FROM 'test')::int AS unanswered,
      (SELECT count(*) FROM learning WHERE business_id=$1 AND status='answered' AND answered_at > now() - interval '7 days')::int AS taught_7d,
      (SELECT count(*) FROM agent_actions WHERE business_id=$1 AND status='sent' AND created_at > now() - interval '7 days')::int AS sent_7d,
      (SELECT count(*) FROM bookings WHERE business_id=$1 AND status='no_show' AND starts_at > now() - interval '7 days')::int AS no_shows_7d,
      (SELECT COALESCE(sum(price),0)::float FROM bookings WHERE business_id=$1 AND status='no_show' AND starts_at > now() - interval '7 days') AS no_show_value_7d,
      (SELECT COALESCE(sum(price),0)::float FROM bookings WHERE business_id=$1 AND status<>'cancelled' AND starts_at >= date_trunc('week', now() AT TIME ZONE $2) AT TIME ZONE $2 AND starts_at < now()) AS week_rev,
      (SELECT COALESCE(sum(price),0)::float FROM bookings WHERE business_id=$1 AND status<>'cancelled' AND starts_at >= (date_trunc('week', now() AT TIME ZONE $2) - interval '7 days') AT TIME ZONE $2 AND starts_at < now() - interval '7 days') AS last_week_rev`, P),
      agentFindings(B.id).catch(() => ({ out: [] }))]);
    const found = id => ag.out.find(a => a.id === id)?.list.length || 0, growth = found('winback') + found('leads') + found('fill') + found('reviews');
    const pct = (done, open) => done + open ? Math.round(done / (done + open) * 100) : 100, money = v => `${!B.currency || B.currency === 'USD' ? '$' : B.currency + ' '}${Math.round(v)}`;
    const delta = d.last_week_rev ? Math.round((d.week_rev - d.last_week_rev) / d.last_week_rev * 100) : null;
    res.json({ team: [
      { id: 'maya', name: 'Maya', role: 'Front desk', open: found('noshow') + Math.max(0, d.past_today - d.marked_today),
        advice: d.today ? `${d.today} appointment${d.today > 1 ? 's' : ''} today${d.next_at ? `, next at ${d.next_at}` : ', all done'}.${found('noshow') ? ` ${found('noshow')} risky booking${found('noshow') > 1 ? 's' : ''} to confirm.` : ''}` : 'No appointments today. Ask me to find who could fill the day.',
        progress: d.today ? Math.round(d.past_today / d.today * 100) : null, of: 'of today’s appointments done', ask: 'Who is coming today and is anyone likely to miss?',
        items: [d.today && { text: `${d.today} appointment${d.today > 1 ? 's' : ''} today${d.next_at ? `, next at ${d.next_at}` : ''}`, go: { view: 'calendar' } },
          found('noshow') && { text: `${found('noshow')} risky booking${found('noshow') > 1 ? 's' : ''} to confirm`, tone: 'need', go: { view: 'agents' } },
          d.past_today > d.marked_today && { text: `${d.past_today - d.marked_today} visit${d.past_today - d.marked_today > 1 ? 's' : ''} to mark came / no-show`, tone: 'need', go: { view: 'calendar' } }].filter(Boolean) },
      { id: 'omar', name: 'Omar', role: 'Support', open: d.open_cases + d.unanswered,
        advice: d.open_cases || d.unanswered ? `${d.open_cases} chat${d.open_cases === 1 ? '' : 's'} waiting for you, ${d.unanswered} question${d.unanswered === 1 ? '' : 's'} to teach.` : 'All chats handled. Nothing waiting for you.',
        progress: pct(d.solved_cases_7d + d.taught_7d, d.open_cases + d.unanswered), of: 'handovers and questions cleared this week', ask: 'What is waiting for me in support and what should I answer first?',
        items: [d.open_cases && { text: `${d.open_cases} chat${d.open_cases > 1 ? 's' : ''} waiting for you`, tone: 'need', go: { page: 'inbox', tab: 'conversations' } },
          d.unanswered && { text: `${d.unanswered} question${d.unanswered > 1 ? 's' : ''} the AI couldn't answer`, tone: 'need', go: { page: 'support', tab: 'gaps' } },
          { text: 'Support results', go: { page: 'support', tab: 'live' } }].filter(Boolean) },
      { id: 'lina', name: 'Lina', role: 'Growth', open: growth,
        advice: growth ? `${growth} client${growth > 1 ? 's' : ''} ready to contact: ${[found('winback') && `${found('winback')} to win back`, found('leads') && `${found('leads')} warm leads`, found('fill') && `${found('fill')} for quiet days`, found('reviews') && `${found('reviews')} for reviews`].filter(Boolean).join(', ')}.` : 'No one to contact right now. I keep watching for lapsed regulars and warm leads.',
        progress: pct(d.sent_7d, growth), of: 'prepared messages sent this week', ask: 'Who should I contact this week to get more bookings?',
        items: [...[['winback', 'to win back'], ['leads', 'warm leads'], ['fill', 'to invite for quiet days'], ['reviews', 'to ask for a review']].filter(([k]) => found(k)).map(([k, l]) => ({ text: `${found(k)} ${l}`, tone: 'need', go: { view: 'agents' } })),
          { text: 'Clients', go: { page: 'people', tab: 'board' } }] },
      { id: 'sam', name: 'Sam', role: 'Analyst', open: (delta !== null && delta <= -10 ? 1 : 0) + (d.no_shows_7d ? 1 : 0),
        advice: `This week so far: ${money(d.week_rev)}${delta === null ? '' : `, ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta)}% on the same days last week`}.`,
        progress: d.last_week_rev ? Math.min(100, Math.round(d.week_rev / d.last_week_rev * 100)) : null, of: 'of last week’s revenue at this point', ask: 'How is this week going and what should I improve?',
        // Sam flags what moves the money: a drop against last week and no-shows this week
        items: [delta !== null && delta <= -10 && { text: `Revenue down ${-delta}% on the same days last week`, tone: 'bad', go: { page: 'analytics', tab: 'overview' } },
          d.no_shows_7d && { text: `${d.no_shows_7d} no-show${d.no_shows_7d > 1 ? 's' : ''} this week (${money(d.no_show_value_7d)} lost)`, tone: 'bad', go: { view: 'calendar' } },
          { text: `This week: ${money(d.week_rev)}${delta === null ? '' : ` (${delta >= 0 ? '+' : '−'}${Math.abs(delta)}%)`}`, go: { page: 'analytics', tab: 'overview' } },
          { text: 'Trends', go: { page: 'performance', tab: 'summary' } }, { text: 'Busiest times', go: { page: 'analytics', tab: 'timing' } }].filter(Boolean) },
    ] });
  }));
  app.get('/api/team', wrap(async (_req, res) => {
    const B = await biz(), [used] = await q(USED_TODAY, [B.id]);
    res.json({ team: Object.entries(TEAM).map(([id, e]) => ({ id, name: e.name, role: e.title || e.role, avatar: e.avatar, skills: e.skills })), calls_left: Math.max(0, DAILY_CAP - used.n), cap: DAILY_CAP });
  }));
  app.post('/api/team/ask', wrap(async (req, res) => {
    const B = await biz(), convo = (Array.isArray(req.body.messages) ? req.body.messages : []).slice(-10).filter(m => m && m.text);
    if (!convo.length || convo[convo.length - 1].role !== 'owner') return res.status(400).json({ error: 'Ask a question first.' });
    const e = TEAM[req.body.employee] ? req.body.employee : route(convo[convo.length - 1].text);
    const [used] = await q(USED_TODAY, [B.id]);
    if (used.n >= DAILY_CAP) return res.status(429).json({ error: `You've asked your team ${DAILY_CAP} questions today, the daily limit. They're back at midnight. Your receptionist keeps answering customers as normal.` });
    let counted = false;
    // today's snapshot comes with every question, so simple ones need no lookup
    const results = [{ name: 'today', args: {}, data: await TOOLS.today.run(B).catch(() => ({})) }], used_tools = [];
    let out = null;
    const memory = (await q('SELECT fact FROM pulse_memory WHERE business_id=$1 ORDER BY id DESC LIMIT 40', [B.id])).map(r => r.fact).reverse();
    // ?stream=1: the owner sees each step live ("Reading bookings…"); headers go out only with the first step,
    // so an early error still answers as plain JSON
    const stream = req.query.stream === '1';
    const step = (label, thought) => { if (!stream) return; if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }); res.write(`data: ${JSON.stringify(thought ? { thought: label } : { step: label })}

`); };
    for (let step_ = 0; step_ < MAX_STEPS; step_++) { const step0 = step_;
      try { out = await ask(prompt(B, e, convo, results, String(req.body.page || '').slice(0, 40), memory)); }
      catch (err) { if (step0 === 0 && !res.headersSent) return res.status(err.status || 503).json({ error: err.status ? err.message : 'The AI isn’t reachable right now. Try again in a minute.' }); out = { busy: true }; break; }
      if (!counted) { await q('INSERT INTO team_calls (business_id, employee) VALUES ($1,$2)', [B.id, e]); counted = true; }
      if (out.broken) { convo.push({ role: 'system', text: 'Your last reply was not valid JSON. Reply with one valid JSON object only.' }); continue; }
      // an answer that offers to look something up instead of looking: send it back to do the work
      if (out.answer && step0 < MAX_STEPS - 1 && /\b(shall|should|would you like|do you want|want) (me to |i )?(pull|check|fetch|look|get|dig|find)\b|\bi (can|could|need to) (pull|fetch|check|look)\b/i.test(out.answer)) {
        convo.push({ role: 'system', text: 'Do not offer to look it up: fetch that data now with a tool and give the complete answer.' }); continue; }
      const calls = Array.isArray(out.tools) ? out.tools.slice(0, 4) : [];
      if (calls.length && out.thinking) step(String(out.thinking).slice(0, 160), true);
      if (!calls.length || out.answer) break;
      for (const c of calls) {
        const t = TOOLS[c.name]; step(`Reading ${String(c.name).replace(/_/g, ' ')}`);
        const data = t ? await t.run(B, c.args || {}).catch(err => ({ error: err.message })) : { error: `No tool called ${c.name}.` };
        results.push({ name: c.name, args: c.args || {}, data }); used_tools.push(c.name);
      }
      if (step0 === MAX_STEPS - 2) convo.push({ role: 'system', text: 'Answer now with what you have.' });
    }
    const answer = out?.answer || (out?.busy ? 'The AI got busy halfway through. Ask me again in a minute.' : 'I couldn’t finish that one. Try asking it a bit more specifically.');
    const actions = (Array.isArray(out?.actions) ? out.actions : []).filter(a => a && TEAM[e].actions.includes(a.type)).slice(0, 5);
    // actions carry the client's name so the owner sees who they approve
    for (const a of actions) if (a.customer_id) a.client = (await one('SELECT name FROM customers WHERE id=$1 AND business_id=$2', [+a.customer_id, B.id]))?.name || null;
    const tools = [...new Set(used_tools)], seen = new Set();
    const sources = tools.map(t => SOURCE[t]).filter(x => x && !seen.has(x[0]) && seen.add(x[0])).map(([label, go]) => ({ label, go }));
    // lasting facts the owner shared: kept (no duplicates, newest 40) so the next chat starts knowing them
    const learned = [];
    for (const f of (Array.isArray(out?.remember) ? out.remember : []).map(x => String(x).trim().slice(0, 240)).filter(Boolean).slice(0, 3))
      if (!memory.some(m => m.toLowerCase() === f.toLowerCase())) { await q('INSERT INTO pulse_memory (business_id, fact) VALUES ($1,$2)', [B.id, f]); learned.push(f); }
    if (learned.length) await q('DELETE FROM pulse_memory WHERE business_id=$1 AND id NOT IN (SELECT id FROM pulse_memory WHERE business_id=$1 ORDER BY id DESC LIMIT 40)', [B.id]);
    // the rows behind the answer, straight from the database: shown as tables and downloadable as CSV
    const tables = results.slice(1).map(r => {
      const d = r.data, rows = Array.isArray(d) ? d : Array.isArray(d?.rows) ? d.rows : Object.values(d || {}).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
      return rows?.length && typeof rows[0] === 'object' ? { title: `${r.name.replace(/_/g, ' ')}${d?.period ? ` · ${d.period}` : ''}`, rows: rows.slice(0, 200) } : null;
    }).filter(Boolean).slice(0, 4);
    const payload = { employee: e, answer, learned, actions: actions.filter(a => a.type !== 'send_message' || a.client), tools, sources, tables, ...mentions(results) };
    if (res.headersSent) { res.write(`data: ${JSON.stringify({ done: payload })}

`); return res.end(); }
    res.json(payload);
  }));
  // what Pulse AI remembers: the owner can see and delete every fact
  app.get('/api/team/memory', wrap(async (_req, res) => res.json(await q('SELECT id, fact, created_at FROM pulse_memory WHERE business_id=$1 ORDER BY id DESC', [(await biz()).id]))));
  app.delete('/api/team/memory/:id', wrap(async (req, res) => { await q('DELETE FROM pulse_memory WHERE id=$1 AND business_id=$2', [+req.params.id, (await biz()).id]); res.json({ ok: true }); }));
  // the owner approved one proposed action
  app.post('/api/team/act', wrap(async (req, res) => {
    const B = await biz(), a = req.body || {};
    if (a.type === 'add_rule') {
      const text = String(a.text || '').trim().slice(0, 400); if (!text) return res.status(400).json({ error: 'Empty rule.' });
      const r = await addRule(B.id, text);
      if (!r.added) return res.json({ ok: false, done: r.reason === 'full' ? 'Rules are full (40). Remove one in Teach AI first.' : 'The receptionist already follows this rule.' });
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
    if (a.type === 'add_shortcut') {
      const r = await addShortcut(B.id, a);
      if (!r.ok) return res.json({ ok: false, done: r.error });
      await audit(req, 'shortcut_added', r.shortcut.label); return res.json({ ok: true, done: `Added “${r.shortcut.label}” to your Home page.`, shortcuts: true });
    }
    if (a.type === 'run_agent') return res.json({ ok: false, open: 'agents', done: 'Open Agents to review and send this agent’s messages.' });
    res.status(400).json({ error: 'Unknown action.' });
  }));
}

// exported for the safety tests
export { safeQuery };
