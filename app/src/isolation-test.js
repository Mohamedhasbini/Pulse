// Proves one client can never see or change another client's data.
// Run any time (safe on live data; it creates two temporary businesses and removes them):
//   docker compose exec app node src/isolation-test.js
import { q, one, pool } from './db.js';
import { createBusiness, signSession } from './accounts.js';
import { closeBusiness } from './ops.js';

const BASE = 'http://localhost:3100', MARK = 'ZZ-SECRET-' + Date.now();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const mk = async tag => {
  const r = await createBusiness({ name: `Isolation test ${tag} ${MARK}`, vertical: 'salon', owner_email: `iso-${tag}-${Date.now()}@example.test`, timezone: 'Asia/Beirut', currency: 'USD' });
  const u = await one('SELECT id, session_version FROM users WHERE business_id=$1', [r.id]);
  return { id: r.id, cookie: `rb_session=${signSession(u.id, u.session_version)}` };
};
const call = (who, path, method = 'GET', body, extraCookie = '') => fetch(BASE + path, {
  method, headers: { cookie: who.cookie + extraCookie, 'Content-Type': 'application/json', origin: BASE }, body: body && JSON.stringify(body) })
  .then(async r => ({ status: r.status, text: await r.text() }));

let A, B;
try {
  A = await mk('A'); B = await mk('B');
  // Private data that only B owns
  const cust = await one(`INSERT INTO customers (business_id, phone, name) VALUES ($1,$2,$3) RETURNING id`, [B.id, '+96100' + Date.now() % 1e6, 'Customer ' + MARK]);
  const conv = await one(`INSERT INTO conversations (business_id, customer_id, channel) VALUES ($1,$2,'whatsapp') RETURNING id`, [B.id, cust.id]);
  await q(`INSERT INTO messages (conversation_id, role, text) VALUES ($1,'customer',$2)`, [conv.id, 'private message ' + MARK]);
  const svc = await one('SELECT id FROM services WHERE business_id=$1 LIMIT 1', [B.id]);
  await q(`INSERT INTO bookings (business_id, customer_id, service_id, conversation_id, starts_at, ends_at, notes) VALUES ($1,$2,$3,$4, now() + interval '2 days', now() + interval '2 days 1 hour', $5)`,
    [B.id, cust.id, svc.id, conv.id, 'note ' + MARK]);

  // 1. Every page of data A can load must not contain B's private data
  const today = new Date().toISOString().slice(0, 10);
  for (const p of ['/api/business', '/api/conversations', '/api/customers', `/api/calendar?from=${today}T00:00&to=2099-01-01T00:00`, '/api/live?days=30', '/api/stats?days=30',
    '/api/requests', '/api/learning', '/api/insights?days=30', '/api/notifications', '/api/coupons', '/api/review?filter=todo']) {
    const r = await call(A, p);
    const leaked = [`Isolation test B ${MARK}`, 'private message ' + MARK, 'Customer ' + MARK, 'note ' + MARK].filter(s => r.text.includes(s));
    check(`A cannot see B's data in ${p}`, !leaked.length, `HTTP ${r.status}${leaked.length ? ', leaked: ' + leaked.join(', ') : ''}`);
  }
  // 2. Opening B's records by number
  let r = await call(A, `/api/conversations/${conv.id}/messages`);
  check("A cannot read B's conversation by its id", !r.text.includes('private message'), `HTTP ${r.status}`);
  r = await call(A, `/api/customers/${cust.id}`);
  check("A cannot open B's customer by its id", !r.text.includes('Customer ' + MARK), `HTTP ${r.status}`);
  // 3. Changing B's records
  await call(A, `/api/customers/${cust.id}`, 'PUT', { name: 'hacked', staff_notes: 'hacked' });
  check("A cannot rename B's customer", (await one('SELECT name FROM customers WHERE id=$1', [cust.id])).name === 'Customer ' + MARK);
  const before = (await one('SELECT count(*)::int n FROM messages WHERE conversation_id=$1', [conv.id])).n;
  await call(A, `/api/conversations/${conv.id}/reply`, 'POST', { text: 'hacked reply' });
  check("A cannot reply in B's conversation", (await one('SELECT count(*)::int n FROM messages WHERE conversation_id=$1', [conv.id])).n === before);
  await call(A, `/api/conversations/${conv.id}/resolve`, 'POST', {});
  // 4. Switching business with the admin cookie does nothing for an owner
  r = await call(A, '/api/business', 'GET', null, `; rb_biz=${B.id}`);
  check('An owner cannot switch to another business', r.text.includes(`Isolation test A ${MARK}`) && !r.text.includes(`Isolation test B ${MARK}`));
  // 5. Platform admin pages are closed to owners
  for (const p of ['/api/admin/businesses', '/api/admin/users', '/api/admin/usage', `/api/admin/businesses/${B.id}/export`, '/api/admin/leads']) {
    r = await call(A, p);
    check(`Owner is refused ${p}`, r.status === 403, `HTTP ${r.status}`);
  }
  // 6. Not signed in: no data at all
  r = await fetch(BASE + '/api/conversations').then(x => ({ status: x.status }));
  check('Signed-out visitor is refused data', r.status === 401, `HTTP ${r.status}`);
} catch (e) {
  check('Test ran without errors', false, e.message);
} finally {
  for (const b of [A, B]) if (b) await closeBusiness(b.id).catch(() => {});
  const left = await one(`SELECT count(*)::int n FROM businesses WHERE name LIKE $1`, ['%' + MARK]);
  check('Temporary test businesses removed', left.n === 0);
  const bad = results.filter(x => !x.ok).length;
  console.log(`\n${results.length - bad} passed, ${bad} failed`);
  await pool.end();
  process.exit(bad ? 1 : 0);
}
