// Compares AI models on a real booking conversation: speed per reply, stalls, and the replies themselves.
//   docker compose exec app node src/ai-bench.js [model ...]   (writes test conversations only)
import { handleMessage } from './brain.js';
import { one, pool } from './db.js';
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['models/gemini-3.1-flash-lite', 'models/gemini-2.5-flash-lite', 'models/gemini-3.5-flash-lite', 'models/gemini-3.8-flash'];
const biz = (await one("SELECT id FROM businesses WHERE subdomain='layla-demo'")).id;
process.env.AI_TIMEOUT_MS = '60000';
for (const model of models) {
  process.env.AI_MODEL = model;
  const times = []; let fails = 0, last = [];
  for (let run = 0; run < 2; run++) {
    const phone = `test-bench-${Date.now()}`; last = [];
    for (const step of ['okay what do you offer', 'manicure', 'PICK']) {
      const text = step === 'PICK' ? (last.at(-1)?.options?.[0] || 'tomorrow at 2pm') : step;
      const t0 = Date.now(), r = await handleMessage({ businessId: biz, phone, name: 'Mohamad', text, channel: 'test' });
      times.push((Date.now() - t0) / 1000); if (r.failed) fails++;
      last.push({ text, reply: r.reply, options: r.options, booked: r.bookedNow });
    }
  }
  times.sort((a, b) => a - b);
  console.log(`\n=== ${model} ===\nreplies: ${times.length} · median ${times[Math.floor(times.length / 2)].toFixed(1)}s · slowest ${times.at(-1).toFixed(1)}s · over 10s: ${times.filter(t => t > 10).length} · failed: ${fails}`);
  for (const m of last) console.log(`> ${m.text}\n  ${String(m.reply).replace(/\n/g, ' / ').slice(0, 260)}\n  [${(m.options || []).join(' | ')}]${m.booked ? '  ✓ BOOKED' : ''}`);
}
await pool.end(); process.exit(0);
