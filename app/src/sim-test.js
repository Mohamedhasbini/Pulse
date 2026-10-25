// Real-life simulation: N fake clients with their own goal hold a full conversation with the AI (multi-turn),
// spread over S seconds. They follow the AI's choices, give their details, wait when queued, and rate the chat
// from what actually happened (booked fast = 5, slow or not helped = lower).
// Usage: node src/sim-test.js <clients> <seconds> [bizId]   (data: phones 'sim-*', channel 'test')
import { handleMessage } from './brain.js';
import { pool, q, one } from './db.js';

const [N = 100, S = 180, BIZ = 1] = process.argv.slice(2).map(Number);
const FIRST = ['Lara', 'Maya', 'Nour', 'Rita', 'Sara', 'Hiba', 'Yara', 'Dana', 'Lina', 'Rania', 'Carla', 'Joelle', 'Tala', 'Zeina', 'Mira', 'Aya', 'Karim', 'Omar', 'Elie', 'Fadi', 'Lucia', 'Marta', 'Ines', 'Sofia', 'Chloe'];
const LAST = ['Haddad', 'Khoury', 'Saad', 'Nassar', 'Fares', 'Aoun', 'Gemayel', 'Hayek', 'Mansour', 'Salem', 'Garcia', 'Lopez', 'Martin', 'Daher', 'Azar'];
const SVC = ['manicure', 'facial', 'hair colour', 'haircut and blow dry'];
const DAYS = ['tomorrow', 'on Tuesday', 'on Wednesday', 'Thursday afternoon', 'Friday morning', 'on Saturday', 'next week'];
const pick = (a, i) => a[i % a.length];
// goal, opening line, and facts the first answer must contain (graded)
const SCRIPTS = [
  i => ({ goal: 'book', open: `Hi! Can I book a ${pick(SVC, i)} ${pick(DAYS, i)}?` }),
  i => ({ goal: 'book', open: `hello, I need an appointment for ${pick(SVC, i + 1)}` }),
  i => ({ goal: 'book', open: `Do you have any free time ${pick(DAYS, i + 2)} for a ${pick(SVC, i + 2)}?` }),
  i => ({ goal: 'price+book', open: `How much is a ${pick(SVC, i)}?`, must: [['manicure', '20'], ['facial', '55'], ['hair colour', '90'], ['haircut and blow dry', '35']].find(x => x[0] === pick(SVC, i))[1] }),
  () => ({ goal: 'info', open: 'What are your opening hours?', must: '10' }),
  () => ({ goal: 'info', open: 'Are you open on Sunday?', mustAny: ['closed', 'not open', "don't open", 'sunday off', 'unfortunately'] }),
  () => ({ goal: 'info', open: 'Where are you located?', mustAny: ['hamra', 'street', 'beirut', 'address', 'located'] }),
  () => ({ goal: 'info', open: 'Can I pay by card?', mustAny: ['card', 'cash', 'pay'] }),
  () => ({ goal: 'info', open: 'What services do you offer?', mustAny: ['manicure', 'facial'] }),
  () => ({ goal: 'unknown', open: 'Do you sell gift cards for my mother?' }),
  i => ({ goal: 'book', open: `بدي احجز ${pick(['مانيكور', 'فيشل', 'صبغة شعر'], i)} ${pick(['بكرا', 'يوم الثلاثاء', 'يوم الخميس'], i)}`, ar: true }),
  () => ({ goal: 'info', open: 'قديش سعر المانيكور؟', must: '20', ar: true }),
];
const HOLD = /checking and will reply|أتحقق الآن/;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// what a real customer would answer next, given the AI's last reply
function nextLine(c, r) {
  const t = String(r.reply || '').toLowerCase(), opts = (r.options || []).filter(o => !/another|other day|يوم آخر|later/i.test(o));
  if (/1 to 5|1 إلى 5/.test(t)) return null; // rating is handled by the caller
  if (/(your|full) name|may i have your name|what's your name|اسمك/.test(t)) return c.name;
  if (/phone|number|رقم/.test(t) && !/our number|call us/.test(t)) return c.phone.replace('sim-', '+9617');
  if (/email/.test(t)) return /optional|skip/.test(t) ? 'skip' : `${c.first.toLowerCase()}.${c.last.toLowerCase()}@example.com`;
  if (/whatsapp or|telegram or|sms or|reminder|تذكير/.test(t)) return c.ar ? 'واتساب' : 'WhatsApp please';
  if (opts.length) return opts[rnd(0, Math.min(2, opts.length - 1))];
  const time = t.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
  if (time && c.goal !== 'info') return c.ar ? `${time[0]} منيح` : `${time[0]} works for me`;
  if (/would you like to book|shall i book|want me to book|confirm|بتحب احجزلك/.test(t)) return c.goal === 'info' || c.goal === 'unknown' ? (c.ar ? 'لا شكراً' : 'No thanks, just asking. Thanks!') : (c.ar ? 'اي اكيد' : 'Yes please');
  if (c.goal === 'price+book' && c.turns === 1) return `Great, can I book it ${pick(DAYS, c.i)}?`;
  if (c.goal === 'info' || c.goal === 'unknown') return c.ar ? 'شكراً' : 'Thanks!';
  return c.ar ? 'اي وقت متاح' : 'Any time that is free is fine';
}

async function waitForAnswer(convId, afterId, maxMs = 75 * 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const m = await one(`SELECT id, text, options FROM messages WHERE conversation_id=$1 AND role='assistant' AND id > $2 ORDER BY id DESC LIMIT 1`, [convId, afterId]);
    if (m && !HOLD.test(m.text)) return { reply: m.text, options: m.options || [], waited: Date.now() - t0 };
    await sleep(1500);
  }
  return null;
}

async function client(i) {
  const s = pick(SCRIPTS, i)(i), first = pick(FIRST, i * 7 + 3), last = pick(LAST, i * 3 + 1);
  const c = { i, ...s, first, last, name: `${first} ${last}`, phone: `sim-${String(10000 + i)}`, turns: 0, queuedMs: 0, queued: 0, booked: false, firstOk: null, failed: 0 };
  let text = s.open, r, maxMs = 0;
  for (; c.turns < 9 && text; c.turns++) {
    const t0 = Date.now();
    r = await handleMessage({ businessId: BIZ, phone: c.phone, name: c.turns ? c.name : null, text, channel: 'test' });
    maxMs = Math.max(maxMs, Date.now() - t0);
    if (r.failed) c.failed++;
    if (r.queued || HOLD.test(r.reply || '')) {
      c.queued++;
      const last = await one(`SELECT max(id) id FROM messages WHERE conversation_id=$1 AND role='assistant'`, [r.conversationId]);
      const w = await waitForAnswer(r.conversationId, HOLD.test(r.reply || '') ? last.id : last.id - 1);
      if (!w) { c.lost = true; break; }
      c.queuedMs += w.waited; r = { ...r, reply: w.reply, options: w.options, bookedNow: /confirmed|booked|تم الحجز|✅/i.test(w.reply) };
    }
    if (c.turns === 0 && (s.must || s.mustAny)) {
      const t = String(r.reply).toLowerCase();
      c.firstOk = s.must ? t.includes(s.must) : s.mustAny.some(x => t.includes(x));
    }
    if (r.bookedNow) c.booked = true;
    if (/1 to 5|1 إلى 5/.test(String(r.reply))) break;
    await sleep(rnd(1500, 4000)); // people take a moment to type
    text = nextLine(c, r);
  }
  // rate from the experience
  const wanted = /book/.test(c.goal);
  let stars = 5;
  if (wanted && !c.booked) stars = 2; else if (wanted && c.turns > 6) stars = 4;
  if (c.queuedMs > 90000) stars -= 1;
  if (c.firstOk === false) stars -= 2;
  if (c.goal === 'unknown') stars = Math.min(stars, 4);
  stars = Math.max(1, Math.min(5, stars));
  const conv = await one(`SELECT v.id, v.rating_asked_at FROM conversations v JOIN customers k ON k.id=v.customer_id WHERE k.business_id=$1 AND k.phone=$2 ORDER BY v.id DESC LIMIT 1`, [BIZ, c.phone]);
  if (conv && !conv.rating_asked_at) await handleMessage({ businessId: BIZ, phone: c.phone, name: c.name, text: c.ar ? 'شكراً' : 'Thanks, bye!', channel: 'test' });
  const rr = await handleMessage({ businessId: BIZ, phone: c.phone, name: c.name, text: String(stars), channel: 'test' });
  c.ratedOk = !!rr.rated; c.stars = stars;
  if (stars <= 3) await handleMessage({ businessId: BIZ, phone: c.phone, name: c.name, text: c.booked ? 'It took too long to get an answer' : 'I could not get a booking easily', channel: 'test' });
  return c;
}

const probes = []; let stop = false;
(async () => { while (!stop) { const t0 = Date.now(); try { await fetch('http://localhost:3100/login', { signal: AbortSignal.timeout(15000) }); probes.push(Date.now() - t0); } catch { probes.push(null); } await sleep(2000); } })();
const start = Date.now(), jobs = [];
for (let i = 0; i < N; i++) { const due = start + (i * S * 1000) / N; const w = due - Date.now(); if (w > 0) await sleep(w); jobs.push(client(i).catch(e => ({ i, error: e.message }))); }
const all = await Promise.all(jobs); stop = true;
const ok = all.filter(c => !c.error), wantBook = ok.filter(c => /book/.test(c.goal)), graded = ok.filter(c => c.firstOk !== null);
const pct = (a, p) => { a = a.filter(x => x != null).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0; };
const [dbl] = (await q(`SELECT count(*)::int n FROM (SELECT starts_at FROM bookings WHERE business_id=$1 AND status<>'cancelled' AND starts_at > now() GROUP BY starts_at HAVING count(*) > 1) x`, [BIZ]));
const ratings = await one(`SELECT count(*)::int n, round(avg(rating)::numeric,2)::float avg, round(100.0*count(*) FILTER (WHERE rating>=4)/nullif(count(*),0))::int sat
  FROM conversations v JOIN customers k ON k.id=v.customer_id WHERE k.business_id=$1 AND k.phone LIKE 'sim-%' AND v.rating IS NOT NULL`, [BIZ]);
const byGoal = {};
for (const c of ok) { const g = byGoal[c.goal] ||= { n: 0, booked: 0, turns: 0 }; g.n++; g.turns += c.turns; if (c.booked) g.booked++; }
for (const g of Object.values(byGoal)) g.avg_turns = +(g.turns / g.n).toFixed(1), delete g.turns;
console.log(JSON.stringify({
  clients: N, window_s: S, finished_s: Math.round((Date.now() - start) / 1000), crashed: all.length - ok.length, crash_samples: all.filter(c => c.error).slice(0, 2).map(c => c.error),
  booking: { wanted: wantBook.length, booked: wantBook.filter(c => c.booked).length, rate_pct: Math.round(100 * wantBook.filter(c => c.booked).length / Math.max(1, wantBook.length)),
    avg_turns_to_book: +(wantBook.filter(c => c.booked).reduce((a, c) => a + c.turns, 0) / Math.max(1, wantBook.filter(c => c.booked).length)).toFixed(1) },
  first_answer_correct: `${graded.filter(c => c.firstOk).length}/${graded.length}`, wrong_first: graded.filter(c => !c.firstOk).map(c => c.open).slice(0, 5),
  queue: { clients_queued: ok.filter(c => c.queued).length, wait_p50_s: Math.round(pct(ok.filter(c => c.queued).map(c => c.queuedMs), .5) / 1000), wait_max_s: Math.round(Math.max(0, ...ok.map(c => c.queuedMs)) / 1000), lost: ok.filter(c => c.lost).length },
  ratings: { sent: ok.length, captured: ok.filter(c => c.ratedOk).length, ...ratings }, by_goal: byGoal, overlapping_slots: dbl.n,
  dashboard_ms: { p50: pct(probes, .5), p95: pct(probes, .95), timeouts: probes.filter(x => x == null).length },
}, null, 1));
await pool.end();
