// Autopilot: the jobs that run by themselves, each once per business per day (or week), in the business's own time.
//   11:00  agents on autopilot send to the clients they found (same rules as a manual Send: consent, cool-downs,
//          reachable channels only)
//   Monday 09:00  weekly report to the owner (bell + phone): revenue, bookings, new clients, AI work, vs last week
//   03:00  accuracy check: every alarm number must match the database (trust-test); a mismatch alerts the admin
// Waitlist: clients who wanted a full day join it; when a booking on that day is cancelled, the first one waiting is
// offered the freed time on their channel.
import { execFile } from 'node:child_process';
import { q, one } from './db.js';
import { AGENTS, sendAgent, route } from './agents.js';
import { notify } from './notify.js';

let S = {}; // senders, set by the server: { sendWhatsApp, sendTelegram }
export const setSenders = s => { S = s; };
const TZ = b => b.timezone || process.env.TIMEZONE || 'Asia/Beirut';
const local = b => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: TZ(b) })); return { h: d.getHours(), dow: d.getDay(), day: d.toISOString().slice(0, 10) }; };
// claims a job for a period; false when it already ran
const claim = async (B, job, period) => !!(await one(`INSERT INTO autopilot_runs (business_id, job, period) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`, [B, job, period]));

async function runAgents(b) {
  const on = b.autopilot || {}, out = [];
  for (const id of Object.keys(AGENTS)) {
    if (!on[id]) continue;
    const found = await AGENTS[id].find(b.id, b), list = Array.isArray(found) ? found.filter(c => route(c)) : [];
    if (!list.length) continue;
    const r = await sendAgent(b, id, list.map(c => c.id), {}, false, S);
    if (r.sent) out.push(`${AGENTS[id].name}: ${r.sent}`);
  }
  if (out.length) await notify(b.id, 'marketing', 'Autopilot sent today', out.join(' · '));
}

async function weekly(b) {
  const [w] = await q(`SELECT
      count(*) FILTER (WHERE created_at > now() - interval '7 days' AND status <> 'cancelled')::int AS bookings,
      count(*) FILTER (WHERE created_at BETWEEN now() - interval '14 days' AND now() - interval '7 days' AND status <> 'cancelled')::int AS bookings_prev,
      COALESCE(sum(price) FILTER (WHERE starts_at BETWEEN now() - interval '7 days' AND now() AND status IN ('confirmed','completed')),0)::float AS revenue,
      COALESCE(sum(price) FILTER (WHERE starts_at BETWEEN now() - interval '14 days' AND now() - interval '7 days' AND status IN ('confirmed','completed')),0)::float AS revenue_prev,
      count(*) FILTER (WHERE created_at > now() - interval '7 days' AND source IN ('whatsapp','telegram','webook','web','chat'))::int AS by_ai,
      count(*) FILTER (WHERE starts_at BETWEEN now() - interval '7 days' AND now() AND status='no_show')::int AS no_shows,
      COALESCE(sum(price) FILTER (WHERE starts_at BETWEEN now() AND now() + interval '7 days' AND status='confirmed'),0)::float AS next_week
    FROM bookings WHERE business_id=$1`, [b.id]);
  const [c] = await q(`SELECT count(*)::int AS n FROM customers WHERE business_id=$1 AND created_at > now() - interval '7 days' AND phone !~ '^(test|e2e|walk-in)'`, [b.id]);
  const pct = (a, p) => p ? ` (${a >= p ? '+' : ''}${Math.round((a - p) / p * 100)}%)` : '';
  const m = v => `${b.currency || 'USD'} ${Math.round(v).toLocaleString()}`;
  await notify(b.id, 'report', `Your week: ${m(w.revenue)}${pct(w.revenue, w.revenue_prev)}`,
    `${w.bookings} bookings${pct(w.bookings, w.bookings_prev)} · ${w.by_ai} by your AI · ${c.n} new clients · ${w.no_shows} no-shows · ${m(w.next_week)} booked for next week`);
}

function accuracy() {
  execFile('node', ['src/trust-test.js'], { timeout: 120000 }, async (err, out) => {
    if (!err) return console.log('[autopilot] accuracy check passed');
    const fails = String(out).split('\n').filter(l => l.startsWith('FAIL') || l.startsWith('--')).join('\n');
    await q(`INSERT INTO audit_log (action, detail) VALUES ('system_alert', $1)`, ['Accuracy check: ' + fails.slice(0, 450)]).catch(() => {});
    const token = process.env.ALERT_BOT_TOKEN, chat = process.env.ALERT_CHAT_ID;
    if (token && chat) fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: '⚠️ Pulse accuracy check found a mismatch:\n' + fails.slice(0, 3500) }) }).catch(() => {});
  });
}

async function tick() {
  for (const b of await q(`SELECT id, name, review_url, wa_phone_number_id, timezone, currency, autopilot FROM businesses`)) {
    const t = local(b);
    try {
      if (t.h >= 11 && t.h < 20 && await claim(b.id, 'agents', t.day)) await runAgents(b);
      if (t.dow === 1 && t.h >= 9 && await claim(b.id, 'weekly', t.day)) await weekly(b);
    } catch (e) { console.error(`[autopilot] ${b.name}:`, e.message); }
  }
  const d = new Date(), day = d.toISOString().slice(0, 10);
  if (d.getUTCHours() === 1 && await claim(0, 'accuracy', day)) accuracy(); // 03:00/04:00 Beirut
}
export function startAutopilot() {
  setTimeout(() => tick().catch(e => console.error('[autopilot]', e.message)), 60000);
  setInterval(() => tick().catch(e => console.error('[autopilot]', e.message)), 10 * 60000);
}

// ---------- waitlist ----------
export async function joinWaitlist(B, customerId, serviceId, day) {
  await q(`INSERT INTO waitlist (business_id, customer_id, service_id, day) SELECT $1,$2,$3,$4::date
      WHERE NOT EXISTS (SELECT 1 FROM waitlist WHERE customer_id=$2 AND day=$4::date AND status='waiting')`, [B, customerId, serviceId, day]);
}
// a booking was cancelled: offer the freed time to the first client waiting for that day
export async function offerWaitlist(bookingId) {
  const bk = await one(`SELECT b.business_id, b.starts_at, s.name service, bz.name biz, bz.wa_phone_number_id, bz.timezone, bz.waitlist_on
      FROM bookings b JOIN services s ON s.id=b.service_id JOIN businesses bz ON bz.id=b.business_id WHERE b.id=$1`, [bookingId]);
  if (!bk || bk.waitlist_on === false || new Date(bk.starts_at) < new Date()) return;
  const tz = bk.timezone || 'Asia/Beirut', day = new Date(bk.starts_at).toLocaleDateString('en-CA', { timeZone: tz });
  const w = await one(`SELECT w.id, cu.id cid, cu.name, cu.phone, cu.telegram_chat_id,
      (SELECT c.channel FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1) AS channel,
      (SELECT c.id FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1) AS conv_id,
      (SELECT max(m.created_at) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.customer_id=cu.id AND m.role='customer') AS last_msg
    FROM waitlist w JOIN customers cu ON cu.id=w.customer_id WHERE w.business_id=$1 AND w.day=$2::date AND w.status='waiting' ORDER BY w.id LIMIT 1`, [bk.business_id, day]);
  if (!w) return;
  const when = new Date(bk.starts_at).toLocaleString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const text = `Good news ${String(w.name || '').split(' ')[0] || ''}! A time just opened at ${bk.biz}: ${when}. Reply YES and I'll book it for you.`.replace('  ', ' ');
  const r = route(w); let ok = false;
  if (r === 'telegram') ok = (await S.sendTelegram?.(w.telegram_chat_id, text, bk.business_id))?.ok;
  if (r === 'whatsapp') ok = (await S.sendWhatsApp?.(bk.wa_phone_number_id, w.phone, text))?.ok;
  if (w.conv_id && (ok || w.channel === 'webook' || w.channel === 'test')) {
    await q(`INSERT INTO messages (conversation_id, role, text, source) VALUES ($1,'assistant',$2,'waitlist')`, [w.conv_id, text]);
    await q('UPDATE conversations SET updated_at=now() WHERE id=$1', [w.conv_id]); ok = true;
  }
  await q(`UPDATE waitlist SET status=$2, notified_at=now() WHERE id=$1`, [w.id, ok ? 'offered' : 'unreachable']);
  await notify(bk.business_id, 'booking', `Waitlist: ${w.name || w.phone} offered ${when}`, ok ? 'They can reply YES to book it.' : "Couldn't reach them on their channel; call them.");
}
