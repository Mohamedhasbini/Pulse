// Load test for one business: N customers spread over S seconds, each sending one message through the
// real brain (same path as WhatsApp, channel 'test'). Grades answers against known facts and times the
// dashboard while the load runs. Usage: node src/load-test.js <customers> <seconds> [bizId] [label]
// Clean up afterwards with: Test chat -> Clear test data (or POST /api/test-data/clear).
import { handleMessage } from './brain.js';
import { pool } from './db.js';

const [N = 100, S = 180, BIZ = 1, LABEL = 'run'] = process.argv.slice(2).map((v, i) => i < 3 ? +v : v);
const tomorrow = new Date(Date.now() + 86400e3), dow = tomorrow.getDay();
const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow === 0 ? 1 : dow];
const has = (...w) => r => w.some(x => r.toLowerCase().includes(x));
const CASES = [
  { kind: 'price manicure', text: 'How much is a manicure?', ok: has('20') },
  { kind: 'price colour', text: 'what is the price for hair colour', ok: has('90') },
  { kind: 'price facial', text: 'how much do you charge for a facial?', ok: has('55') },
  { kind: 'price haircut', text: 'Haircut and blow dry price please', ok: has('35') },
  { kind: 'closed sunday', text: 'Are you open on Sunday?', ok: has('closed', 'not open', "aren't open", 'are not open', 'no,', 'unfortunately') },
  { kind: 'closing time', text: 'What time do you close on Tuesday?', ok: has('20:00', '8 pm', '8pm', '8:00', '20h') },
  { kind: 'booking', text: i => `Hi, I'm Load Tester ${i}. Please book me a manicure on ${day} at any free time.`, book: true },
];

const results = [], probes = [];
let inflight = 0, maxInflight = 0;
async function one(i) {
  const c = CASES[i % CASES.length], text = typeof c.text === 'function' ? c.text(i) : c.text;
  const t0 = Date.now(); inflight++; maxInflight = Math.max(maxInflight, inflight);
  try {
    const r = await handleMessage({ businessId: BIZ, phone: `load-${LABEL}-${i}`, name: `Load Tester ${i}`, text, channel: 'test' });
    results.push({ kind: c.kind, ms: Date.now() - t0, failed: !!r.failed, booked: !!r.bookedNow, correct: c.book ? null : c.ok(String(r.reply || '')), reply: r.reply });
  } catch (e) {
    results.push({ kind: c.kind, ms: Date.now() - t0, error: e.message.slice(0, 80) });
  } finally { inflight--; }
}
// dashboard probe: the heaviest dashboard query plus the login page, every 2 s
async function probe() {
  const t0 = Date.now(); let db = null, web = null;
  try { await pool.query(`SELECT count(*) FROM conversations c WHERE c.business_id=$1 AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.role='assistant')`, [BIZ]); db = Date.now() - t0; } catch {}
  const t1 = Date.now();
  try { await fetch('http://localhost:3100/login', { signal: AbortSignal.timeout(15000) }); web = Date.now() - t1; } catch {}
  probes.push({ db, web });
}

const pct = (a, p) => a.length ? a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
const start = Date.now(), jobs = [];
const pt = setInterval(probe, 2000);
for (let i = 0; i < N; i++) {
  const due = start + (i * S * 1000) / N;
  const wait = due - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  jobs.push(one(i));
}
await Promise.all(jobs);
clearInterval(pt); await probe();
const total = (Date.now() - start) / 1000, ms = results.map(r => r.ms);
const graded = results.filter(r => r.correct !== null && r.correct !== undefined), bookings = results.filter(r => r.kind === 'booking');
const [dbl] = (await pool.query(`SELECT count(*)::int n FROM (SELECT starts_at FROM bookings WHERE business_id=$1 AND status<>'cancelled' AND starts_at > now()
  GROUP BY starts_at HAVING count(*) > 1) x`, [BIZ]).catch(() => ({ rows: [{ n: 'n/a' }] }))).rows;
const byKind = {};
for (const r of graded) { const k = byKind[r.kind] ||= { ok: 0, n: 0 }; k.n++; if (r.correct) k.ok++; }
console.log(JSON.stringify({
  label: LABEL, customers: N, window_s: S, finished_s: +total.toFixed(1), rate_per_min: +(N / (S / 60)).toFixed(1), max_in_flight: maxInflight,
  latency_ms: { p50: pct([...ms], .5), p95: pct([...ms], .95), max: Math.max(...ms) },
  errors: results.filter(r => r.error).length, ai_failed: results.filter(r => r.failed).length,
  accuracy: { correct: graded.filter(r => r.correct).length, graded: graded.length, by_kind: byKind },
  bookings: { asked: bookings.length, booked: bookings.filter(r => r.booked).length }, overlapping_slots: dbl.n,
  dashboard_ms: { db_p95: pct(probes.map(p => p.db).filter(x => x != null), .95), web_p95: pct(probes.map(p => p.web).filter(x => x != null), .95), web_timeouts: probes.filter(p => p.web == null).length },
  sample_wrong: graded.filter(r => !r.correct).slice(0, 3).map(r => `${r.kind}: ${String(r.reply).slice(0, 120)}`),
  sample_errors: [...new Set(results.filter(r => r.error).map(r => r.error))].slice(0, 3),
}, null, 1));
// Queue drain: wait until every queued customer of this run got their real answer (max 15 min).
const qStart = Date.now(); let left = 0;
do {
  left = (await pool.query(`SELECT count(*)::int n FROM ai_queue a JOIN customers c ON c.business_id=a.business_id AND c.phone=a.phone
    WHERE a.business_id=$1 AND a.phone LIKE $2 AND a.status IN ('waiting','working')`, [BIZ, `load-${LABEL}-%`])).rows[0].n;
  if (left) await new Promise(r => setTimeout(r, 5000));
} while (left && Date.now() - qStart < 15 * 60000);
const fin = (await pool.query(`SELECT count(*)::int total,
    count(*) FILTER (WHERE last.text LIKE 'Thanks for your message! I''m checking%')::int still_waiting,
    count(*) FILTER (WHERE last.source='ai')::int ai_answered
  FROM customers c JOIN conversations v ON v.customer_id=c.id
  JOIN LATERAL (SELECT text, source FROM messages m WHERE m.conversation_id=v.id AND m.role='assistant' ORDER BY id DESC LIMIT 1) last ON true
  WHERE c.business_id=$1 AND c.phone LIKE $2`, [BIZ, `load-${LABEL}-%`])).rows[0];
const failedQ = (await pool.query(`SELECT count(*)::int n FROM ai_queue WHERE business_id=$1 AND phone LIKE $2 AND status='failed'`, [BIZ, `load-${LABEL}-%`])).rows[0].n;
console.log(JSON.stringify({ queue_drain_s: Math.round((Date.now() - qStart) / 1000), customers_total: fin.total, last_reply_from_ai: fin.ai_answered, still_on_hold: fin.still_waiting, queue_failed: failedQ }));
await pool.end();
