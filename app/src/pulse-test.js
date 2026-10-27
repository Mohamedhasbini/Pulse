// Pulse AI checks: every rule path shares one writer (no duplicates, nothing pushed out when full), and the
// Approvals list shows what waits for the owner, for that business only.
//   docker compose exec app node src/pulse-test.js   (creates temporary businesses and removes them)
import { q, one, pool } from './db.js';
import { createBusiness, signSession } from './accounts.js';
import { closeBusiness } from './ops.js';
import { addRule, getRules, MAX_RULES } from './rules.js';

const BASE = 'http://localhost:3100', stamp = Date.now(), results = [], made = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const owner = async id => { const u = await one(`SELECT id, session_version FROM users WHERE business_id=$1 AND role='owner'`, [id]); return `rb_session=${signSession(u.id, u.session_version)}`; };
const get = (path, cookie) => fetch(BASE + path, { headers: { cookie, origin: BASE } }).then(r => r.json());
const post = (path, body, cookie) => fetch(BASE + path, { method: 'POST', headers: { cookie, origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
try {
  const A = await createBusiness({ name: `Pulse test A ${stamp}`, vertical: 'salon', owner_email: `pulse-a-${stamp}@example.test`, timezone: 'Asia/Beirut', plan_key: 'business' });
  const B = await createBusiness({ name: `Pulse test B ${stamp}`, vertical: 'salon', owner_email: `pulse-b-${stamp}@example.test`, timezone: 'Asia/Beirut', plan_key: 'business' });
  made.push(A.id, B.id);
  const OA = await owner(A.id), OB = await owner(B.id);

  check('A new rule is added', (await addRule(A.id, 'Never use emojis.')).added);
  check('The same rule in other words is not added twice', (await addRule(A.id, 'Do not use emojis')).reason === 'known');
  const r = await post('/api/team/act', { type: 'add_rule', text: 'never use emojis' }, OA);
  check('The AI team uses the same writer', r.ok === false && (await getRules(A.id)).length === 1, r.done);
  const full = Array.from({ length: MAX_RULES - 1 }, (_, i) => ({ text: `Filler rule number ${i} about topic${i}` }));
  await q('UPDATE businesses SET ai_rules=$1 WHERE id=$2', [JSON.stringify([{ text: 'Never use emojis.' }, ...full]), A.id]);
  const l = await post('/api/lessons', { title: 'Say when you need to check', body: 'If unsure, say you will check with the team.', kind: 'rule' }, OA);
  const after = await getRules(A.id);
  check('A full list never pushes out the oldest rule', after.length === MAX_RULES && after[0].text === 'Never use emojis.' && !!l.note, l.note);

  const cu = await one(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Pulse Test','+96170000002') RETURNING id`, [A.id]);
  const sv = await one('SELECT id FROM services WHERE business_id=$1 LIMIT 1', [A.id]);
  const bk = await one(`INSERT INTO bookings (business_id, customer_id, service_id, starts_at, ends_at, price) VALUES ($1,$2,$3, now() + interval '2 days', now() + interval '2 days 1 hour', 40) RETURNING id`, [A.id, cu.id, sv.id]);
  await q(`INSERT INTO requests (business_id, booking_id, type, status) VALUES ($1,$2,'cancel','pending')`, [A.id, bk.id]);
  await q(`INSERT INTO learning (business_id, question, status) VALUES ($1,'Do you have parking?','open')`, [A.id]);
  const w = await get('/api/pulse/waiting', OA);
  const kinds = new Set((w.items || []).map(x => x.kind));
  check('Approvals lists the customer request and the open question', kinds.has('request') && kinds.has('question'), JSON.stringify(w.items?.map(x => x.title)));
  const wb = await get('/api/pulse/waiting', OB);
  check("Business B never sees A's approvals", !(wb.items || []).some(x => /Pulse Test|parking/.test(x.title)));

  // an agent message, then a booking from that customer: the scorecard credits the agent
  await q(`INSERT INTO agent_actions (business_id, agent, customer_id, status, message, created_at) VALUES ($1,'winback',$2,'sent','Come back soon', now() - interval '1 day')`, [A.id, cu.id]);
  const br = await get('/api/pulse/brief', OA), wb2 = br.agents?.find(a => a.agent === 'winback');
  check('Agent scorecard counts the booking that followed the message', wb2?.sent === 1 && wb2?.booked === 1 && wb2?.value === 40, JSON.stringify(br.agents));
  check('The weekly brief has wins, risks and next steps', ['wins', 'risks', 'next'].every(k => Array.isArray(br[k])) && br.next.length > 0, JSON.stringify(br.next));
  check('The KPI series has one row per day', (await get('/api/kpis?days=14', OA)).length === 14);

  // Home shortcuts: added by the owner or by Pulse AI's action, checked, capped, per business
  const add = b => fetch(BASE + '/api/shortcuts', { method: 'POST', headers: { cookie: OA, origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  check('A shortcut to a page and tab is added', (await add({ label: 'Requests', page: 'calendar', tab: 1 })).ok);
  check('A shortcut to a page that does not exist is refused', (await add({ label: 'Nope', page: 'nowhere', tab: 0 })).status === 400);
  const viaPulse = await post('/api/team/act', { type: 'add_shortcut', label: 'How was my week', ask: 'How did this week go?' }, OA);
  const mine = (await get('/api/shortcuts', OA)).shortcuts || [];
  check('Pulse AI adds a shortcut with its action', viaPulse.ok && mine.length === 2 && mine[1].ask === 'How did this week go?', viaPulse.done);
  check("Business B doesn't see A's shortcuts", ((await get('/api/shortcuts', OB)).shortcuts || []).length === 0);
} catch (e) { check('Pulse test ran', false, e.message) } finally {
  for (const id of made) await closeBusiness(id).catch(() => {});
  console.log(`\n${results.filter(Boolean).length} passed, ${results.filter(x => !x).length} failed`);
  await pool.end(); process.exit(results.every(Boolean) ? 0 : 1);
}
