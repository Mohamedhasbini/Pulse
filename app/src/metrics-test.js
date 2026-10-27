// Metrics checks: Home (/api/live), the AI team and metrics.js give the same numbers, "today" follows the
// business's time zone, and cancelled bookings never count.
//   docker compose exec app node src/metrics-test.js   (creates a temporary business and removes it)
import { q, one, pool } from './db.js';
import { createBusiness, signSession } from './accounts.js';
import { closeBusiness } from './ops.js';
import * as metrics from './metrics.js';

const BASE = 'http://localhost:3100', stamp = Date.now(), results = [], made = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
try {
  const A = await createBusiness({ name: `Metrics test ${stamp}`, vertical: 'salon', owner_email: `metrics-${stamp}@example.test`, timezone: 'Asia/Beirut', plan_key: 'business' });
  made.push(A.id);
  const cu = await one(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Metric Test','+96170000001') RETURNING id`, [A.id]);
  const sv = await one(`SELECT id FROM services WHERE business_id=$1 LIMIT 1`, [A.id]);
  // noon today in Beirut (counts), an AI booking; a cancelled one today (never counts); one yesterday in Beirut (not today)
  const at = d => `((now() AT TIME ZONE 'Asia/Beirut')::date + ${d} + time '12:00') AT TIME ZONE 'Asia/Beirut'`;
  const add = (when, price, status, source) => q(`INSERT INTO bookings (business_id, customer_id, service_id, starts_at, ends_at, price, status, source)
    VALUES ($1,$2,$3,${when},${when} + interval '1 hour',$4,$5,$6)`, [A.id, cu.id, sv.id, price, status, source]);
  await add(at(0), 50, 'confirmed', 'ai');
  await add(at(0), 30, 'cancelled', 'ai');
  await add(at(-1), 20, 'completed', 'manual');
  const m = await metrics.today(A.id);
  check('Today counts only non-cancelled appointments in Beirut today', m.visits_today === 1 && m.revenue_today === 50, JSON.stringify(m));
  const ai = await metrics.aiBookings(A.id, 7);
  check('AI bookings exclude cancelled and manual bookings', ai.ai_count === 1 && ai.ai_value === 50, JSON.stringify(ai));
  const u = await one(`SELECT id, session_version FROM users WHERE business_id=$1 AND role='owner'`, [A.id]);
  const live = await fetch(`${BASE}/api/live?days=7`, { headers: { cookie: `rb_session=${signSession(u.id, u.session_version)}`, origin: BASE } }).then(r => r.json());
  const same = ['visits_today', 'revenue_today', 'booked_today', 'value_today', 'ai_count', 'ai_value'].every(k => live.now?.[k] === { ...m, ...ai }[k]);
  check('Home shows the same numbers as metrics.js', same, JSON.stringify(live.now && { v: live.now.visits_today, r: live.now.revenue_today, a: live.now.ai_count }));
} catch (e) { check('Metrics test ran', false, e.message) } finally {
  for (const id of made) await closeBusiness(id).catch(() => {});
  console.log(`\n${results.filter(Boolean).length} passed, ${results.filter(x => !x).length} failed`);
  await pool.end(); process.exit(results.every(Boolean) ? 0 : 1);
}
