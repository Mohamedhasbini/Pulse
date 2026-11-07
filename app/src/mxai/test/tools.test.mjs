// Layer 04 tests: registry shape, strict arguments, and the customer/owner boundary. No database, no AI:
// the database and notification modules are replaced by recording fakes. Run: node app/src/mxai/test/tools.test.mjs
import assert from 'node:assert/strict';
import { TOOLS, validate, toolList, paramText, mcpTools, registryFor, fenceSql, _setMods } from '../tools.js';
import * as booking from '../booking.js';
import { wall } from '../../clock.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; console.log('  FAIL', name, '\n       ', e.message); }
}

// ---------- fakes ----------
const calls = [];
const OTHER = { name: 'Zeina Haddad', phone: '+96171999888' }; // another customer: must never reach a customer tool's output
let oneAnswer = sql => undefined;
const fakeDb = {
  q: async (sql, p) => { calls.push(sql); return /FROM bookings WHERE business_id/.test(sql) ? [{ id: 7, customer_id: 99, service_id: 1, status: 'confirmed', customer_name: OTHER.name, phone: OTHER.phone,
    starts_at: new Date(Date.now() + 10 * 86400e3), ends_at: new Date(Date.now() + 10 * 86400e3 + 1800e3) }] : []; },
  one: async (sql, p) => { calls.push(sql); return oneAnswer(sql, p); },
};
const notes = [];
booking._setDeps({ ...fakeDb, withBusinessLock: (_id, fn) => fn(), joinWaitlist: async (...a) => notes.push(['waitlist', ...a]),
  offerWaitlist: async () => {}, notify: async (...a) => notes.push(['notify', ...a]), emit: () => {} });
_setMods({ ...fakeDb, pool: null, metrics: {}, agentFindings: async () => ({ out: [] }), marketingOverview: async () => ({}) });

const allDays = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, [['09:00', '18:00']]]));
const biz = { id: 1, name: 'Test Salon', timezone: 'Asia/Beirut', hours: allDays, capacity: 1, slot_step: 30, currency: 'USD', cancel_hours: 24, show_branding: true,
  services: [{ id: 1, name: 'Hair cut', minutes: 30, price: 20 }, { id: 2, name: 'Hair colouring', minutes: 90, price: 60 }, { id: 3, name: 'Manicure', minutes: 45, price: 15 }] };
const ctx = (extra = {}) => ({ biz, customer: { id: 5, name: 'Rana', phone: '+96170111222' }, conversation: { id: 11, channel: 'whatsapp' }, text: '', ...extra });
const tomorrow = wall(new Date(Date.now() + 86400e3), 'Asia/Beirut').date;

const AUDIENCES = new Set(['customer', 'owner', 'staff', 'admin']), ROLES = new Set(['mxai', 'receptionist', 'support', 'sales']);
const KNOWN_FEATURES = ['booking_page', 'webook_listing', 'reminders', 'teach', 'insights', 'coupons', 'telegram', 'staff_logins', 'marketing', 'remove_branding', 'website', 'assistant_pro'];
const MODULES = ['overview', 'calendar', 'customers', 'insights', 'teach', 'testchat', 'setup', 'channels', 'website'];

console.log('registry shape');
await test('every tool has name, kind, audiences, roles, describe, params and run', () => {
  for (const [n, t] of Object.entries(TOOLS)) {
    assert.equal(t.name, n, n);
    assert.ok(['customer', 'read', 'action'].includes(t.kind), `${n} kind`);
    assert.ok(Array.isArray(t.audiences) && t.audiences.length && t.audiences.every(a => AUDIENCES.has(a)), `${n} audiences`);
    assert.ok(Array.isArray(t.roles) && t.roles.length && t.roles.every(r => ROLES.has(r)), `${n} roles`);
    assert.ok(typeof t.describe === 'string' && t.describe.length > 10 && !t.describe.includes('\n'), `${n} describe is one line`);
    assert.equal(t.params?.type, 'object', `${n} params`);
    assert.equal(typeof t.run, 'function', `${n} run`);
    if (t.feature) assert.ok(KNOWN_FEATURES.includes(t.feature), `${n} feature ${t.feature}`);
    if (t.switchKey) assert.match(t.switchKey, /^(channel|integration|ai|mcp):[a-z0-9_-]+$/, `${n} switchKey`);
    if (t.permission) assert.ok(MODULES.includes(t.permission), `${n} permission ${t.permission}`);
    for (const k of t.params.required || []) assert.ok(t.params.properties[k], `${n} requires a declared arg ${k}`);
  }
});
await test('the contract\'s customer tools all exist', () => {
  for (const n of ['check_availability', 'book', 'change_booking', 'cancel_booking', 'join_waitlist', 'save_profile', 'handoff', 'order_status']) assert.ok(TOOLS[n], n);
  assert.deepEqual(TOOLS.order_status.roles, ['support']);
  assert.ok(TOOLS.handoff.roles.includes('support'));
});
await test('no customer tool can read owner data: customer tools are customer-only and never mxai', () => {
  for (const t of Object.values(TOOLS)) {
    if (t.audiences.includes('customer')) {
      assert.deepEqual(t.audiences, ['customer'], t.name);
      assert.equal(t.kind, 'customer', t.name);
      assert.ok(!t.roles.includes('mxai'), t.name);
    } else {
      assert.ok(t.roles.every(r => r === 'mxai'), `${t.name}: owner tools are for the mxai role only`);
      assert.notEqual(t.kind, 'customer', t.name);
    }
  }
});
await test('every action tool for mxai is a propose_*, and no read tool is', () => {
  for (const t of Object.values(TOOLS).filter(t => t.roles.includes('mxai'))) {
    if (t.kind === 'action') assert.match(t.name, /^propose_/, t.name);
    else { assert.equal(t.kind, 'read', t.name); assert.doesNotMatch(t.name, /^propose_/, t.name); }
  }
  assert.ok(Object.values(TOOLS).filter(t => t.kind === 'action').length >= 9);
});
await test('the fenced SQL query is not open to staff', () => assert.deepEqual(TOOLS.query.audiences, ['owner', 'admin']));
await test('MCP: no server yet, registry unchanged', () => { assert.deepEqual(mcpTools(biz), []); assert.equal(registryFor(biz), TOOLS); });

console.log('arguments');
await test('unknown argument is refused', () => assert.equal(validate(TOOLS.book.params, { service: 'Hair cut', slot: '2026-11-08 10:00', price: 0 }).ok, false));
await test('required argument missing is refused', () => assert.match(validate(TOOLS.book.params, { service: 'Hair cut' }).errors[0], /slot/));
await test('wrong type is refused (no coercion)', () => {
  assert.equal(validate(TOOLS.book.params, { service: 'Hair cut', slot: '2026-11-08 10:00', guests: '4' }).ok, false);
  assert.equal(validate(TOOLS.book.params, { service: 'Hair cut', slot: '2026-11-08 10:00', guests: 2.5 }).ok, false);
  assert.equal(validate(TOOLS.customer.params, { id: '12' }).ok, false);
});
await test('bad formats are refused', () => {
  assert.equal(validate(TOOLS.book.params, { service: 'Hair cut', slot: 'tomorrow at 3' }).ok, false);
  assert.equal(validate(TOOLS.check_availability.params, { day: '8/11/2026' }).ok, false);
  assert.equal(validate(TOOLS.save_profile.params, { email: 'not-an-email' }).ok, false);
  assert.equal(validate(TOOLS.change_booking.params, { ref: 'booking 12', slot: '2026-11-08 10:00' }).ok, false);
  assert.equal(validate(TOOLS.book.params, { service: 'x'.repeat(81), slot: '2026-11-08 10:00' }).ok, false);
  assert.equal(validate(TOOLS.book.params, { service: 'Hair cut', slot: '2026-11-08 10:00', guests: 0 }).ok, false);
  assert.equal(validate(TOOLS.propose_set_booking_status.params, { booking_id: 1, status: 'deleted' }).ok, false);
});
await test('good arguments pass; empty optional values count as not given; enums normalise', () => {
  const v = validate(TOOLS.book.params, { service: ' Hair cut ', slot: '2026-11-08T10:00', coupon: '', notes: null, guests: 3 });
  assert.ok(v.ok); assert.deepEqual(v.args, { service: 'Hair cut', slot: '2026-11-08T10:00', guests: 3 });
  assert.equal(validate(TOOLS.check_availability.params, { part: 'Morning' }).args.part, 'morning');
  assert.ok(validate(TOOLS.change_booking.params, { ref: 'rb-0012', slot: '2026-11-08 10:00' }).ok);
  assert.ok(validate(TOOLS.today.params, undefined).ok);
  assert.equal(validate(TOOLS.today.params, ['x']).ok, false);
});

console.log('customer tools');
await test('book: unknown service hands over instead of guessing (nothing written)', async () => {
  calls.length = 0;
  const r = await TOOLS.book.run(ctx(), { service: 'Botox', slot: `${tomorrow} 11:00` });
  assert.equal(r.ok, false); assert.equal(r.handoff, true); assert.equal(r.data.reason, 'unknown_service');
  assert.equal(calls.length, 0);
});
await test('book: two services fit -> ask which, with tap options', async () => {
  const r = await TOOLS.book.run(ctx(), { service: 'hair', slot: `${tomorrow} 11:00` });
  assert.equal(r.ok, false); assert.ok(!r.handoff); assert.deepEqual(r.data.options, ['Hair cut', 'Hair colouring']); assert.match(r.reply, /Which one/);
  const ar = await TOOLS.book.run(ctx({ lang: 'ar' }), { service: 'hair', slot: `${tomorrow} 11:00` });
  assert.match(ar.reply, /أي خدمة/);
});
await test('book: malformed time gets brain.js\'s question, not a booking', async () => {
  const r = await TOOLS.book.run(ctx(), { service: 'Hair cut', slot: 'tomorrow 3pm' });
  assert.equal(r.ok, false); assert.equal(r.reply, 'Sorry, I could not complete that booking. Which service and time would you like?');
});
await test('book: happy path saves, confirms with the ref and notifies the owner', async () => {
  calls.length = 0; notes.length = 0;
  oneAnswer = sql => /INSERT INTO bookings/.test(sql) ? { id: 42 } : /SELECT phone, contact_phone/.test(sql) ? { phone: '+96170111222', contact_phone: null, email: null, reminder_channel: null } : undefined;
  const r = await TOOLS.book.run(ctx({ decision: { reply: 'Booked!' } }), { service: 'manicure', slot: `${tomorrow} 11:00` });
  oneAnswer = () => undefined;
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.data.ref, 'RB-0042'); assert.match(r.reply, /Your booking is confirmed/); assert.match(r.reply, /RB-0042/);
  assert.ok(notes.some(n => n[0] === 'notify' && n[2] === 'booking' && /Rana booked by chat/.test(n[3])));
  assert.ok(!JSON.stringify(r).includes(OTHER.name) && !JSON.stringify(r).includes(OTHER.phone));
});
await test('check_availability: free times for a service, nobody else\'s details', async () => {
  const r = await TOOLS.check_availability.run(ctx(), { service: 'Hair cut', day: tomorrow, part: 'afternoon' });
  assert.equal(r.ok, true); assert.equal(r.data.free.length, 3);
  for (const s of r.data.free) { assert.ok(s.slot.startsWith(tomorrow)); const h = +s.slot.slice(11, 13); assert.ok(h >= 12 && h < 17, s.slot); }
  const all = await TOOLS.check_availability.run(ctx(), {});
  assert.equal(all.ok, true); assert.ok(all.data.days.length && all.data.next_open_days.length);
  for (const x of [r, all]) { const s = JSON.stringify(x); assert.ok(!s.includes(OTHER.name) && !s.includes(OTHER.phone) && !s.includes('"customer_id"')); }
});
await test('check_availability: unknown service hands over', async () => {
  const r = await TOOLS.check_availability.run(ctx(), { service: 'Tattoo' });
  assert.equal(r.handoff, true);
});
await test('join_waitlist: day only, service optional, unknown service hands over', async () => {
  notes.length = 0;
  assert.equal((await TOOLS.join_waitlist.run(ctx(), { day: `${tomorrow} 10:00` })).ok, true);
  assert.deepEqual(notes.find(n => n[0] === 'waitlist').slice(1), [1, 5, null, tomorrow]);
  assert.equal((await TOOLS.join_waitlist.run(ctx(), { day: tomorrow, service: 'Tattoo' })).handoff, true);
});
await test('cancel_booking: no upcoming booking -> says so, changes nothing', async () => {
  calls.length = 0;
  const r = await TOOLS.cancel_booking.run(ctx(), {});
  assert.equal(r.ok, false); assert.equal(r.data.none, true); assert.match(r.reply, /can't find an upcoming booking/);
  assert.ok(!calls.some(s => /UPDATE|INSERT/.test(s)));
});
await test('order_status: no store connector -> hands over and says so, in the customer\'s language', async () => {
  const r = await TOOLS.order_status.run(ctx(), { order: '1043' });
  assert.equal(r.ok, false); assert.equal(r.handoff, true); assert.match(r.reply, /can't look up orders/);
  assert.match((await TOOLS.order_status.run(ctx({ lang: 'ar' }), {})).reply, /الطلبات/);
});
await test('a customer tool with bad arguments and no fixed message hands over', async () => {
  const r = await TOOLS.save_profile.run(ctx(), { email: 'nope', password: 'x' });
  assert.equal(r.ok, false); assert.equal(r.handoff, true); assert.equal(r.data.errors.length, 2);
});
await test('a customer tool without a customer in the turn hands over', async () => {
  const r = await TOOLS.check_availability.run({ biz }, {});
  assert.equal(r.handoff, true);
});

console.log('owner tools');
await test('propose_*: only proposals, never a write; ids must belong to the business', async () => {
  calls.length = 0;
  oneAnswer = (sql, p) => /FROM customers/.test(sql) ? (p[0] === 3 ? { name: 'Rana' } : undefined) : /FROM (bookings|services|learning)/.test(sql) ? (p[0] === 12 ? { '?column?': 1 } : undefined) : undefined;
  const msg = await TOOLS.propose_send_message.run(ctx(), { customer_id: 3, text: 'Hi Rana!' });
  assert.deepEqual(msg, { ok: true, data: { proposal: { type: 'send_message', customer_id: 3, text: 'Hi Rana!', client: 'Rana' }, pending: true } });
  assert.equal((await TOOLS.propose_send_message.run(ctx(), { customer_id: 4, text: 'Hi' })).ok, false);
  const mv = await TOOLS.propose_move_booking.run(ctx(), { booking_id: 12, start: '2026-11-09 14:00' });
  assert.equal(mv.data.proposal.type, 'move_booking'); assert.equal(mv.data.proposal.start, '2026-11-09T14:00');
  assert.equal((await TOOLS.propose_move_booking.run(ctx(), { booking_id: 13, start: '2026-11-09 14:00' })).ok, false);
  assert.equal((await TOOLS.propose_block_time.run(ctx(), { start: '2026-11-09T15:00', end: '2026-11-09T13:00' })).ok, false);
  assert.equal((await TOOLS.propose_add_rule.run(ctx(), { text: 'Always greet by name' })).data.proposal.type, 'add_rule');
  assert.equal((await TOOLS.propose_open_page.run(ctx(), { page: 'calendar', tab: 1 })).data.pending, false);
  oneAnswer = () => undefined;
  assert.ok(!calls.some(s => /\b(INSERT|UPDATE|DELETE)\b/i.test(s)), 'a proposal wrote to the database');
});
await test('fenced SQL: reads allowed, writes and system functions refused', () => {
  assert.ok(fenceSql('SELECT count(*) FROM bookings').sql);
  assert.ok(fenceSql('DELETE FROM bookings').error);
  assert.ok(fenceSql('SELECT pg_read_file(1)').error);
  assert.ok(fenceSql("SELECT table_to_xml('users', true, true, '')").error);
  assert.ok(fenceSql('SELECT 1; DROP TABLE x').error);
});

console.log('prompt list');
await test('toolList shows only the allowed tools with their arguments', () => {
  const txt = toolList(new Set(['book', 'handoff', 'nope']));
  assert.equal(txt.split('\n').length, 2);
  assert.match(txt, /^- book \{service: "exact service name", slot: "YYYY-MM-DD HH:MM", name\?: text/);
  assert.match(txt, /- handoff \{reason\?: text, unknown_question\?: true\|false\}/);
  assert.equal(paramText(TOOLS.today.params), '{}');
  assert.equal(toolList([]), '');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
