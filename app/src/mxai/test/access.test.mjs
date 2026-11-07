// Pure tests for layer 05 (no database): run with `node app/src/mxai/test/access.test.mjs`
import assert from 'node:assert/strict';
import { audienceOf, canSee, allowedTools } from '../access.js';

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('ok', name); };

await test('audienceOf: every customer channel is a customer, whoever is signed in', () => {
  for (const channel of ['whatsapp', 'telegram', 'instagram', 'webook', 'web', 'test', 'WhatsApp'])
    assert.equal(audienceOf({ channel, user: { role: 'admin' } }), 'customer');
  assert.equal(audienceOf({}), 'customer');
  assert.equal(audienceOf(), 'customer');
});

await test('audienceOf: signed-in users by role, unknown roles get least access', () => {
  assert.equal(audienceOf({ channel: 'dashboard', user: { role: 'owner' } }), 'owner');
  assert.equal(audienceOf({ user: { role: 'staff' } }), 'staff');
  assert.equal(audienceOf({ channel: 'lab', user: { role: 'admin' } }), 'admin');
  assert.equal(audienceOf({ channel: 'dashboard', user: { role: 'superuser' } }), 'customer');
  assert.equal(audienceOf({ channel: 'dashboard', user: 'owner' }), 'customer');
  assert.equal(audienceOf({ channel: 'dashboard' }), 'customer');
});

await test('canSee', () => {
  for (const a of ['customer', 'owner', 'staff', 'admin']) { assert.ok(canSee(a, 'public')); assert.ok(canSee(a, 'own_customer')); }
  assert.equal(canSee('customer', 'owner'), false);
  assert.ok(canSee('owner', 'owner'));
  assert.ok(canSee('admin', 'owner'));
  assert.equal(canSee('staff', 'owner', { role: 'staff', permissions: ['calendar'] }), false);
  assert.ok(canSee('staff', 'owner', { role: 'staff', permissions: ['insights'] }));
  assert.equal(canSee('nobody', 'public'), false);
  assert.equal(canSee('owner', 'something_else'), false);
});

const tools = {
  book: { audiences: ['customer'], roles: ['receptionist'] },
  handoff: { audiences: ['customer'], roles: ['receptionist', 'support', 'sales'] },
  join_waitlist: { audiences: ['customer'], roles: ['receptionist'], feature: 'waitlist' },
  telegram_only: { audiences: ['customer'], roles: ['receptionist'], switchKey: 'channel:telegram' },
  metrics_today: { audiences: ['owner', 'admin', 'staff'], roles: ['mxai'], module: 'overview' },
  revenue: { audiences: ['owner', 'admin', 'staff'], roles: ['mxai'], module: 'insights', feature: 'insights' },
  propose_campaign: { audiences: ['owner', 'admin', 'staff'], roles: ['mxai'] },
};
const deps = { tools, hasFeature: async (_, f) => f === 'insights', allowedFor: async (_, k) => k !== 'channel:telegram' };
const biz = { id: 1 };
const names = s => [...s].sort();

await test('allowedTools: customer role filters, feature and switch gates', async () => {
  assert.deepEqual(names(await allowedTools(biz, 'customer', 'receptionist', null, deps)), ['book', 'handoff']);
  assert.deepEqual(names(await allowedTools(biz, 'customer', 'support', null, deps)), ['handoff']);
});

await test('allowedTools: customers never get mxai tools, internal audiences never customer roles', async () => {
  assert.equal((await allowedTools(biz, 'customer', 'mxai', null, deps)).size, 0);
  assert.equal((await allowedTools(biz, 'owner', 'receptionist', { role: 'owner' }, deps)).size, 0);
  assert.equal((await allowedTools(biz, 'stranger', 'mxai', null, deps)).size, 0);
});

await test('allowedTools: owner gets all mxai tools allowed by plan; staff only their sections', async () => {
  assert.deepEqual(names(await allowedTools(biz, 'owner', 'mxai', { role: 'owner' }, deps)), ['metrics_today', 'propose_campaign', 'revenue']);
  assert.deepEqual(names(await allowedTools(biz, 'staff', 'mxai', { role: 'staff', permissions: ['overview'] }, deps)), ['metrics_today']);
  assert.deepEqual(names(await allowedTools(biz, 'staff', 'mxai', { role: 'staff', permissions: [] }, deps)), []);
  const noInsights = { ...deps, hasFeature: async () => false };
  assert.deepEqual(names(await allowedTools(biz, 'owner', 'mxai', { role: 'owner' }, noInsights)), ['metrics_today', 'propose_campaign']);
});

await test('allowedTools: a failing check denies instead of allowing', async () => {
  const broken = { ...deps, hasFeature: async () => { throw new Error('db down'); }, allowedFor: async () => { throw new Error('db down'); } };
  assert.deepEqual(names(await allowedTools(biz, 'customer', 'receptionist', null, broken)), ['book', 'handoff']);
});

console.log(`${n} access tests passed`);
