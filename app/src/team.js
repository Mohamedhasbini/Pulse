// The dashboard chat (MXAi Assistant) and the approval of what it proposes. The thinking lives in the MXAi
// orchestrator (mxai/index.js askMxai): it reads only the data this user may see, looks things up with the tools in
// mxai/tools.js, and proposes anything that changes data or contacts a client. This file keeps the daily cap, the
// memory, the live steps, the tables and links under each answer, and /api/team/act, which carries out an approved
// proposal. Daily cap: the owner's questions never use up the receptionist's AI quota.
import { q, one } from './db.js';
import { addShortcut } from './shortcuts.js';
import { addRule } from './rules.js';
import { isPlayground } from './playground.js';
// the safe database query and the dashboard's pages live with the MXAi tools now
export { fenceSql, safeQuery, PAGE_TABS } from './mxai/tools.js';

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
// The daily limit counts questions the owner asked (one row per question, however many AI steps it took),
// over the business's own calendar day. The receptionist is protected separately by takeAiSlot's per-minute pacing.
const DAILY_CAP = +process.env.TEAM_DAILY_QUESTIONS || 150;
const USED_TODAY = `SELECT count(*)::int AS n FROM team_calls WHERE business_id=$1
  AND (at AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE id=$1),'Asia/Beirut'))::date = (now() AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE id=$1),'Asia/Beirut'))::date`;

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
// what MXAi may propose; /api/team/act carries out each type after the owner approves it
const ACTION_TYPES = new Set(['send_message', 'teach_answer', 'add_rule', 'run_agent', 'book', 'move_booking', 'set_booking_status', 'block_time', 'open_page', 'add_shortcut']);

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
      (SELECT COALESCE(sum(price),0)::float FROM bookings WHERE business_id=$1 AND status='confirmed' AND starts_at BETWEEN now() AND now() + interval '7 days') AS next7_rev,
      (SELECT COALESCE(sum(price),0)::float FROM bookings WHERE business_id=$1 AND status IN ('confirmed','completed') AND starts_at BETWEEN now() - interval '7 days' AND now()) AS last7_rev,
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
      { id: 'sam', name: 'Sam', role: 'Analyst', open: (delta !== null && delta <= -10 ? 1 : 0) + (d.no_shows_7d ? 1 : 0) + (d.last7_rev >= 50 && d.next7_rev < d.last7_rev * 0.5 ? 1 : 0),
        advice: `This week so far: ${money(d.week_rev)}${delta === null ? '' : `, ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta)}% on the same days last week`}.`,
        progress: d.last_week_rev ? Math.min(100, Math.round(d.week_rev / d.last_week_rev * 100)) : null, of: 'of last week’s revenue at this point', ask: 'How is this week going and what should I improve?',
        // Sam flags what moves the money: a drop against last week and no-shows this week
        items: [delta !== null && delta <= -10 && { text: `Revenue down ${-delta}% on the same days last week`, tone: 'bad', go: { page: 'analytics', tab: 'overview' } },
          d.no_shows_7d && { text: `${d.no_shows_7d} no-show${d.no_shows_7d > 1 ? 's' : ''} this week (${money(d.no_show_value_7d)} lost)`, tone: 'bad', go: { view: 'calendar' } },
          d.last7_rev >= 50 && d.next7_rev < d.last7_rev * 0.5 && { text: `Next 7 days: only ${money(d.next7_rev)} booked (last 7 days earned ${money(d.last7_rev)})`, tone: 'need', go: { view: 'agents' } },
          { text: `This week: ${money(d.week_rev)}${delta === null ? '' : ` (${delta >= 0 ? '+' : '−'}${Math.abs(delta)}%)`}`, go: { page: 'analytics', tab: 'overview' } },
          { text: 'Trends', go: { page: 'performance', tab: 'summary' } }, { text: 'Busiest times', go: { page: 'analytics', tab: 'timing' } }].filter(Boolean) },
    ] });
  }));
  app.get('/api/team', wrap(async (_req, res) => {
    const B = await biz(), [used] = await q(USED_TODAY, [B.id]);
    res.json({ team: Object.entries(TEAM).map(([id, e]) => ({ id, name: e.name, role: e.title || e.role, avatar: e.avatar, skills: e.skills })), calls_left: Math.max(0, DAILY_CAP - used.n), cap: DAILY_CAP });
  }));
  app.post('/api/team/ask', wrap(async (req, res) => {
    // what the browser sends is only ever the owner's words or the employee's earlier replies: a "system" NOTE from the
    // browser would let anyone steer the employee as if the app had said it
    const B = await biz(), convo = (Array.isArray(req.body.messages) ? req.body.messages : []).slice(-10).filter(m => m && m.text)
      .map(m => ({ role: m.role === 'owner' ? 'owner' : 'assistant', text: String(m.text) }));
    if (!convo.length || convo[convo.length - 1].role !== 'owner') return res.status(400).json({ error: 'Ask a question first.' });
    const e = 'pulse'; // one MXAi; the column keeps its old name
    const [used] = await q(USED_TODAY, [B.id]);
    if (used.n >= DAILY_CAP) return res.status(429).json({ error: `You've asked your team ${DAILY_CAP} questions today, the daily limit. They're back at midnight. Your receptionist keeps answering customers as normal.` });
    const memory = (await q('SELECT fact FROM pulse_memory WHERE business_id=$1 ORDER BY id DESC LIMIT 40', [B.id])).map(r => r.fact).reverse();
    // ?stream=1: the owner sees each step live ("Reading bookings…"); headers go out only with the first step,
    // so an early error still answers as plain JSON
    const stream = req.query.stream === '1';
    const step = (label, thought) => { if (!stream) return; if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }); res.write(`data: ${JSON.stringify(thought ? { thought: label } : { step: label })}

`); };
    // The thinking is MXAi's (mxai/index.js askMxai): the dashboard data this user may see, the tools their plan,
    // the Lab and their permissions allow, proposals for anything that changes data, guardrails and a trace.
    const { askMxai } = await import('./mxai/index.js');
    await q('INSERT INTO team_calls (business_id, employee) VALUES ($1,$2)', [B.id, e]);
    let r;
    try {
      r = await askMxai({ businessId: B.id, user: req.user, text: convo[convo.length - 1].text, history: convo.slice(0, -1),
        page: String(req.body.page || '').slice(0, 40), memory, onStep: step });
    } catch (err) {
      const msg = err.busy || err.status === 429 ? 'The AI is busy right now. Try again in a minute.' : 'The AI isn’t reachable right now. Try again in a minute.';
      if (!res.headersSent) return res.status(err.busy ? 429 : 503).json({ error: msg });
      res.write(`data: ${JSON.stringify({ done: { employee: e, answer: msg, learned: [], actions: [], tools: [], sources: [], tables: [] } })}

`); return res.end();
    }
    const results = [{ name: 'today', args: {}, data: {} }, ...r.results], used_tools = r.results.map(x => x.name);
    const answer = r.answer || 'I couldn’t finish that one. Try asking it a bit more specifically.';
    const actions = r.proposals.filter(a => a && ACTION_TYPES.has(a.type)).slice(0, 5);
    // actions carry the client's name so the owner sees who they approve
    for (const a of actions) if (a.customer_id && !a.client) a.client = (await one('SELECT name FROM customers WHERE id=$1 AND business_id=$2', [+a.customer_id, B.id]))?.name || null;
    const out = { remember: req.user?.role === 'staff' ? [] : r.remember };
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
      return rows?.length && typeof rows[0] === 'object' ? { title: `${r.name.replace(/_/g, ' ')}${d?.period ? ` · ${d.period}` : ''}`, rows: rows.slice(0, 200), ...(r.name === 'forecast' ? { forecast: d } : {}) } : null;
    }).filter(Boolean).slice(0, 4);
    const payload = { employee: e, answer, learned, actions: actions.filter(a => a.type !== 'send_message' || a.client), tools, sources, tables, ...mentions(results) };
    if (res.headersSent) { res.write(`data: ${JSON.stringify({ done: payload })}

`); return res.end(); }
    res.json(payload);
  }));
  // what MXAi Assistant remembers: the owner can see and delete every fact
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
      // the chat was flagged only because the AI didn't know; now it does, so it no longer waits for the owner
      if (l.conversation_id) await q(`UPDATE conversations SET needs_attention=false WHERE id=$1 AND business_id=$2 AND attention_reason ILIKE '%didn''t know%'`, [l.conversation_id, B.id]);
      await audit(req, 'team_teach', l.question); return res.json({ ok: true, done: 'Saved. The receptionist uses this answer from now on.' });
    }
    if (a.type === 'send_message') {
      const c = await one(`SELECT cu.id, cu.name, cu.phone, cu.telegram_chat_id, (SELECT c.channel FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1) AS channel,
          (SELECT c.id FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1) AS conv_id,
          (SELECT max(m.created_at) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.customer_id=cu.id AND m.role='customer') AS last_msg
          FROM customers cu WHERE cu.id=$1 AND cu.business_id=$2`, [+a.customer_id, B.id]);
      if (!c) return res.sendStatus(404);
      const text = String(a.text || '').trim().slice(0, 900); if (!text) return res.status(400).json({ error: 'Empty message.' });
      if (await isPlayground(B.id)) return res.json({ ok: false, done: 'Not sent: this is a test business, so nothing goes to real people.' });
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
