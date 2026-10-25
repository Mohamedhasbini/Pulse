// Coach checks: owner instructions become the right changes, apply only to that business, and nothing changes without "apply".
//   docker compose exec app node src/coach-test.js   (creates temporary businesses and removes them)
import { q, one, pool } from './db.js';
import { createBusiness, signSession } from './accounts.js';
import { closeBusiness } from './ops.js';

const BASE = 'http://localhost:3100', stamp = Date.now(), results = [], made = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const call = (path, method, body, cookie) => fetch(BASE + path, { method, headers: { cookie, origin: BASE, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const owner = async id => { const u = await one(`SELECT id, session_version FROM users WHERE business_id=$1 AND role='owner'`, [id]); return `rb_session=${signSession(u.id, u.session_version)}`; };
try {
  const A = await createBusiness({ name: `Coach test A ${stamp}`, vertical: 'salon', owner_email: `coach-a-${stamp}@example.test`, timezone: 'Asia/Beirut', plan_key: 'business' });
  const B = await createBusiness({ name: `Coach test B ${stamp}`, vertical: 'salon', owner_email: `coach-b-${stamp}@example.test`, timezone: 'Asia/Beirut', plan_key: 'business' });
  made.push(A.id, B.id);
  const OA = await owner(A.id), OB = await owner(B.id);
  let r = await call('/api/coach/understand', 'POST', { text: 'Be more formal and stop using emojis. Always mention free parking behind the building.' }, OA);
  const types = (r.json.changes || []).map(c => c.type).sort().join(',');
  check('Understands tone, emojis and a custom rule', types === 'rule,rule,tone', JSON.stringify(r.json.changes));
  check('Nothing is saved before Apply', ((await one('SELECT ai_rules FROM businesses WHERE id=$1', [A.id])).ai_rules || []).length === 0);
  r = await call('/api/coach/apply', 'POST', { changes: r.json.changes }, OA);
  let b = await one('SELECT tone, ai_rules FROM businesses WHERE id=$1', [A.id]);
  check('Apply saves tone and rules', b.tone === 'professional' && b.ai_rules.length === 2, JSON.stringify(b.ai_rules));
  r = await call('/api/coach/understand', 'POST', { text: 'Call yourself Lina' }, OA);
  await call('/api/coach/apply', 'POST', { changes: r.json.changes }, OA);
  check('Rename the assistant', (await one('SELECT assistant_name FROM businesses WHERE id=$1', [A.id])).assistant_name === 'Lina');
  r = await call('/api/coach/understand', 'POST', { text: 'Never use emojis.' }, OA);
  check('An existing rule is not added twice', (r.json.changes || []).length === 0);
  r = await call('/api/coach/understand', 'POST', { text: 'remove rule 1' }, OA);
  await call('/api/coach/apply', 'POST', { changes: r.json.changes }, OA);
  b = await one('SELECT ai_rules FROM businesses WHERE id=$1', [A.id]);
  check('Remove a rule', b.ai_rules.length === 1);
  r = await call('/api/coach/apply', 'POST', { changes: [{ type: 'remove_rule', index: 0, text: 'some other text' }] }, OA);
  check('A stale remove (text changed) does nothing', (await one('SELECT ai_rules FROM businesses WHERE id=$1', [A.id])).ai_rules.length === 1);
  r = await call('/api/coach/apply', 'POST', { changes: [{ type: 'tone', value: 'rude' }, { type: 'name', value: '' }, { type: 'evil', value: 'x' }] }, OA);
  b = await one('SELECT tone, assistant_name FROM businesses WHERE id=$1', [A.id]);
  check('Invalid changes are ignored', b.tone === 'professional' && b.assistant_name === 'Lina');
  b = await one('SELECT tone, assistant_name, ai_rules FROM businesses WHERE id=$1', [B.id]);
  check("Coaching A never changes B", (b.ai_rules || []).length === 0 && b.assistant_name !== 'Lina' && b.tone !== 'professional');
  r = await call('/api/coach', 'GET', undefined, OB);
  check("B sees only its own coach settings", r.status === 200 && r.json.assistant_name !== 'Lina' && r.json.rules.length === 0);
  await q(`UPDATE businesses SET feature_overrides='{"teach":false}' WHERE id=$1`, [B.id]);
  r = await call('/api/coach/understand', 'POST', { text: 'be formal' }, OB);
  check('Coach is locked when Teach AI is not in the plan', r.status === 402, `HTTP ${r.status}`);
  check('Signed-out visitors are refused', (await call('/api/coach', 'GET', undefined, '')).status === 401);
} catch (e) { check('Test ran without errors', false, e.stack); }
finally {
  for (const id of made) await closeBusiness(id).catch(() => {});
  const bad = results.filter(x => !x).length;
  console.log(`\n${results.length - bad} passed, ${bad} failed`); await pool.end(); process.exit(bad ? 1 : 0);
}
