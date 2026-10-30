// Agents: each one watches one kind of opportunity in the business's own data, prepares who to contact and what to
// say, and waits. Nothing reaches a customer until the owner presses Send. No AI calls: the work is in the data.
// Sending follows the offer rules: promotions only to clients who agreed to offers, WhatsApp only inside the 24-hour
// window after the client's last message, and an agent never contacts the same client twice within its cool-down.
// Clients who can't be reached by the app get a ready WhatsApp link the owner can send from their own phone.
import { q, one } from './db.js';

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const first = n => String(n || '').trim().split(/\s+/)[0] || 'there';
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// the client's latest conversation, its channel and when they last wrote
const CLIENT = `cu.id, cu.name, cu.phone, cu.telegram_chat_id, cu.marketing_ok,
  (SELECT c.channel FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1) AS channel,
  (SELECT c.id FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1) AS conv_id,
  (SELECT max(m.created_at) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.customer_id=cu.id AND m.role='customer') AS last_msg`;
// real clients only: no test phones, and not people whose latest chat is a test chat
const REAL = `cu.phone !~ '^(test|e2e|walk-in|tg-)' AND COALESCE((SELECT c.channel FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1),'') <> 'test'`;
// not contacted by this agent lately; promotional agents also skip clients who got an offer or any other agent message
// in the last 7 days (no-show confirmations are about a booking, so they still go)
const fresh = (agent, days) => `NOT EXISTS (SELECT 1 FROM agent_actions a WHERE a.customer_id=cu.id AND a.agent='${agent}' AND a.created_at > now() - interval '${days} days')`
  + (agent === 'noshow' ? '' : ` AND NOT EXISTS (SELECT 1 FROM campaign_sends s WHERE s.customer_id=cu.id AND s.status='sent' AND s.at > now() - interval '7 days')
  AND NOT EXISTS (SELECT 1 FROM agent_actions a WHERE a.customer_id=cu.id AND a.status='sent' AND a.agent<>'noshow' AND a.created_at > now() - interval '7 days')`);
function route(c) {
  if (c.channel === 'telegram' && c.telegram_chat_id) return 'telegram';
  if (c.channel === 'whatsapp' && c.last_msg && Date.now() - new Date(c.last_msg) < 23.5 * 3600e3) return 'whatsapp';
  return null;
}
const waLink = (phone, text) => /^\+?\d{7,15}$/.test(String(phone).replace(/[\s-]/g, '')) ? `https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(text)}` : null;

// free share of each of the next 7 open days, from opening hours and confirmed bookings
async function quietDays(biz) {
  const b = await one('SELECT hours FROM businesses WHERE id=$1', [biz]);
  const booked = await q(`SELECT (starts_at AT TIME ZONE 'UTC')::date AS d, sum(extract(epoch FROM ends_at - starts_at)/60)::int AS m FROM bookings
      WHERE business_id=$1 AND status='confirmed' AND starts_at > now() AND starts_at < now() + interval '8 days' GROUP BY 1`, [biz]);
  const out = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const open = (b.hours?.[d.getDay()] || []).reduce((a, [s, e]) => { const m = t => +t.split(':')[0] * 60 + +(t.split(':')[1] || 0); return a + m(e) - m(s); }, 0);
    if (!open) continue;
    const used = booked.find(x => new Date(x.d).toDateString() === d.toDateString())?.m || 0;
    out.push({ day: DAY[d.getDay()], date: d.toISOString().slice(0, 10), pct: Math.round(used / open * 100) });
  }
  return out;
}

const AGENTS = {
  winback: { name: 'Win back regulars', does: 'Finds regulars who haven’t been back in 45 days and invites them again.', promo: true, cool: 30,
    async find(biz, B) {
      return (await q(`SELECT ${CLIENT}, (SELECT s.name FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.customer_id=cu.id AND b.status IN ('confirmed','completed') ORDER BY b.starts_at DESC LIMIT 1) AS service,
          (SELECT max(b.starts_at) FROM bookings b WHERE b.customer_id=cu.id AND b.status IN ('confirmed','completed')) AS last_visit
          FROM customers cu WHERE cu.business_id=$1 AND ${REAL} AND cu.marketing_ok AND ${fresh('winback', 30)}
          AND (SELECT count(*) FROM bookings b WHERE b.customer_id=cu.id AND b.status IN ('confirmed','completed') AND b.starts_at < now()) >= 2
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id=cu.id AND b.status='confirmed' AND (b.starts_at > now() OR b.starts_at > now() - interval '45 days'))
          ORDER BY last_visit DESC LIMIT 25`, [biz])).map(c => ({ ...c,
          why: `last visit ${Math.round((Date.now() - new Date(c.last_visit)) / 864e5)} days ago`,
          message: `Hi ${first(c.name)}! It’s been a while since your last ${c.service || 'visit'} at ${B.name}. We’d love to see you again. Shall I find you a time this week?` }));
    } },
  leads: { name: 'Follow up warm leads', does: 'Writes to people who asked about a service in the last 3 days but didn’t book.', promo: false, cool: 7,
    async find(biz, B) {
      return (await q(`SELECT ${CLIENT}, (SELECT c.topic FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1) AS topic
          FROM customers cu WHERE cu.business_id=$1 AND ${REAL} AND ${fresh('leads', 7)}
          AND EXISTS (SELECT 1 FROM conversations c WHERE c.customer_id=cu.id AND c.updated_at > now() - interval '3 days' AND COALESCE(c.outcome,'answered') <> 'booked' AND NOT c.needs_attention
            AND COALESCE(c.kind,'question') IN ('question','booking'))
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id=cu.id AND b.created_at > now() - interval '3 days')
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id=cu.id AND b.status='confirmed' AND b.starts_at > now())
          ORDER BY last_msg DESC NULLS LAST LIMIT 25`, [biz])).map(c => ({ ...c,
          why: c.topic ? `asked about ${c.topic.toLowerCase()}` : 'chatted, didn’t book',
          message: `Hi ${first(c.name)}! Just checking in${c.topic ? ` about ${c.topic.toLowerCase()}` : ''}. Would you like me to book you in? I can send you the free times.` }));
    } },
  fill: { name: 'Fill quiet days', does: 'Spots days this week that are mostly empty and invites regulars to book them.', promo: true, cool: 14,
    async find(biz, B) {
      const quiet = (await quietDays(biz)).filter(d => d.pct < 40).slice(0, 2);
      if (!quiet.length) return [];
      const days = quiet.map(d => d.day).join(' or ');
      return (await q(`SELECT ${CLIENT} FROM customers cu WHERE cu.business_id=$1 AND ${REAL} AND cu.marketing_ok AND ${fresh('fill', 14)}
          AND (SELECT count(*) FROM bookings b WHERE b.customer_id=cu.id AND b.status IN ('confirmed','completed')) >= 2
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id=cu.id AND b.status='confirmed' AND b.starts_at > now())
          LIMIT 25`, [biz])).map(c => ({ ...c, why: `${quiet.map(d => `${d.day} is ${d.pct}% booked`).join(', ')}`,
          message: `Hi ${first(c.name)}! We have free times on ${days} at ${B.name}. Want me to book you in?` }));
    } },
  noshow: { name: 'Confirm risky bookings', does: 'Asks clients who missed appointments before to confirm their next one.', promo: false, cool: 2,
    async find(biz, B) {
      return (await q(`SELECT ${CLIENT}, s.name AS service, to_char(b.starts_at AT TIME ZONE COALESCE(bz.timezone,'UTC'),'Dy DD Mon HH24:MI') AS at,
          (SELECT count(*) FROM bookings x WHERE x.customer_id=cu.id AND x.status='no_show')::int AS missed
          FROM bookings b JOIN customers cu ON cu.id=b.customer_id JOIN services s ON s.id=b.service_id JOIN businesses bz ON bz.id=b.business_id
          WHERE b.business_id=$1 AND ${REAL} AND b.status='confirmed' AND b.starts_at BETWEEN now() AND now() + interval '48 hours' AND ${fresh('noshow', 2)}
          AND (SELECT count(*) FROM bookings x WHERE x.customer_id=cu.id AND x.status='no_show') >= 2 LIMIT 25`, [biz])).map(c => ({ ...c,
          why: `missed ${c.missed} times · ${c.at}`,
          message: `Hi ${first(c.name)}, a quick check on your ${c.service} at ${B.name} on ${c.at}. Reply YES to keep it, or tell me if you need another time.` }));
    } },
  reviews: { name: 'Ask for reviews', does: 'Asks clients who rated their chat 5 stars to leave a Google review.', promo: false, cool: 90,
    async find(biz, B) {
      if (!B.review_url) return { blocked: 'Add your Google review link below to switch this agent on.' };
      return (await q(`SELECT ${CLIENT} FROM customers cu WHERE cu.business_id=$1 AND ${REAL} AND ${fresh('reviews', 90)}
          AND EXISTS (SELECT 1 FROM conversations c WHERE c.customer_id=cu.id AND c.rating=5 AND c.rated_at > now() - interval '14 days') LIMIT 25`, [biz])).map(c => ({ ...c,
          why: 'rated 5 stars', message: `Thank you ${first(c.name)}! If you enjoyed your visit at ${B.name}, a short Google review would mean a lot: ${B.review_url}` }));
    } },
};

// what every agent finds right now for one business (also read by Lina in team.js)
export async function agentFindings(bizId) {
  const B = await one('SELECT id, name, review_url FROM businesses WHERE id=$1', [bizId]), out = [];
  for (const [id, a] of Object.entries(AGENTS)) {
    const found = await a.find(B.id, B), list = Array.isArray(found) ? found : [];
    out.push({ id, name: a.name, does: a.does, promo: a.promo, blocked: found.blocked || null, list });
  }
  return { B, out };
}

export function mountAgents(app, BIZ, { sendWhatsApp, sendTelegram, notify, audit }) {
  app.get('/api/agents', wrap(async (_req, res) => {
    const { B, out: all } = await agentFindings(BIZ()), out = [];
    for (const { id, name, does, promo, blocked, list } of all) {
      const last = await one(`SELECT count(*) FILTER (WHERE status='sent')::int AS sent, max(created_at) AS at FROM agent_actions WHERE business_id=$1 AND agent=$2 AND created_at > now() - interval '30 days'`, [B.id, id]);
      out.push({ id, name, does, promo, blocked, sent30: last.sent, last: last.at,
        found: list.map(c => ({ id: c.id, name: c.name || c.phone, why: c.why, message: c.message, channel: c.channel, reach: route(c), wa: route(c) ? null : waLink(c.phone, c.message) })) });
    }
    res.json({ agents: out, review_url: B.review_url || '' });
  }));
  app.put('/api/agents/settings', wrap(async (req, res) => {
    const url = String(req.body.review_url || '').trim();
    if (url && !/^https:\/\/\S+$/.test(url)) return res.status(400).json({ error: 'The review link should start with https://' });
    await q('UPDATE businesses SET review_url=$1 WHERE id=$2', [url || null, BIZ()]);
    res.json({ ok: true });
  }));
  // the owner approved: send to the chosen clients (or mark manual sends from their phone)
  app.post('/api/agents/:id/send', wrap(async (req, res) => {
    const a = AGENTS[req.params.id]; if (!a) return res.sendStatus(404);
    const B = await one('SELECT id, name, review_url, wa_phone_number_id FROM businesses WHERE id=$1', [BIZ()]);
    const found = await a.find(B.id, B), list = Array.isArray(found) ? found : [];
    const pick = new Set((req.body.ids || []).map(Number)), edits = req.body.messages || {}, manual = !!req.body.manual;
    let sent = 0, skipped = 0;
    for (const c of list.filter(x => pick.has(x.id))) {
      let text = String(edits[c.id] || c.message).slice(0, 900);
      if (a.promo) text += `\n\n${B.name}. Reply STOP to stop offers.`;
      let status = manual ? 'sent manually' : 'skipped: not reachable now';
      const r = manual ? null : route(c);
      if (r === 'telegram') { const x = await sendTelegram(c.telegram_chat_id, text, B.id); status = x.ok ? 'sent' : 'failed: ' + x.reason; }
      if (r === 'whatsapp') { const x = await sendWhatsApp(B.wa_phone_number_id, c.phone, text); status = x.ok ? 'sent' : 'failed: ' + x.reason; }
      if (status.startsWith('sent') && c.conv_id) {
        await q(`INSERT INTO messages (conversation_id, role, text, source) VALUES ($1,'staff',$2,'agent')`, [c.conv_id, text]);
        await q('UPDATE conversations SET updated_at=now() WHERE id=$1', [c.conv_id]);
      }
      await q('INSERT INTO agent_actions (business_id, agent, customer_id, status, message) VALUES ($1,$2,$3,$4,$5)', [B.id, req.params.id, c.id, status.startsWith('sent') ? 'sent' : status, text]);
      status.startsWith('sent') ? sent++ : skipped++;
    }
    await audit(req, 'agent_sent', `${a.name}: ${sent} sent, ${skipped} skipped`);
    if (sent) await notify(B.id, 'marketing', `${a.name}: ${sent} message${sent === 1 ? '' : 's'} sent`, skipped ? `${skipped} couldn't be reached now` : null);
    res.json({ sent, skipped });
  }));
  app.get('/api/agents/log', wrap(async (_req, res) => {
    // agent messages and campaign sends together, so every message a client got shows in one log
    res.json(await q(`SELECT agent, status, message, to_char(t,'Mon DD HH24:MI') AS at, name FROM (
        SELECT a.agent, a.status, left(a.message, 120) AS message, a.created_at AS t, cu.name
          FROM agent_actions a LEFT JOIN customers cu ON cu.id=a.customer_id WHERE a.business_id=$1
        UNION ALL SELECT 'Campaign: ' || COALESCE(c.name,'Offer'), cs.status, left(c.message, 120), cs.at, cu.name
          FROM campaign_sends cs JOIN campaigns c ON c.id=cs.campaign_id LEFT JOIN customers cu ON cu.id=cs.customer_id WHERE c.business_id=$1
      ) x ORDER BY t DESC LIMIT 30`, [BIZ()]));
  }));
}
