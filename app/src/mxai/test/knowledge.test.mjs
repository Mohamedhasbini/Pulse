// Pure tests for layer 03 (no database): run with `node app/src/mxai/test/knowledge.test.mjs`
import assert from 'node:assert/strict';
import { publicFactsFrom, retrieve, norm, tokens, teamOf, availabilityFacts } from '../knowledge.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };

const facts = {
  faqs: [
    { q: 'Do you do bridal hair and makeup?', a: 'Yes, we do bridal packages. Send us your date.' },
    { q: 'Is there parking nearby?', a: 'Free parking behind the building.' },
    { q: '¿Cuáles son los precios del corte?', a: 'El corte cuesta 20 euros.' },
    { q: 'هل يوجد موقف سيارات؟', a: 'نعم، يوجد موقف مجاني خلف المبنى.' },
    { q: 'ما هي الأسعار؟', a: 'الأسعار في قائمة الخدمات.' },
  ],
  taught: [{ q: 'Do you sell gift cards?', a: 'Yes, gift cards from 25 USD at the front desk.' }],
};

test('normalise: accents, Arabic letter variants, marks', () => {
  assert.equal(norm('Cómo ÉSTÁ'), 'como esta');
  assert.equal(norm('أإآ'), 'ااا');
  assert.equal(norm('مدرسة'), 'مدرسه');
  assert.equal(norm('على'), 'علي');
  assert.equal(norm('مَرْحَبًا'), 'مرحبا');
});

test('tokens drop stop words in en/es/fr/ar', () => {
  assert.deepEqual(tokens('What is the price?'), ['price']);
  assert.deepEqual(tokens('¿Cuál es el precio?'), ['precio']);
  assert.deepEqual(tokens('Quel est le prix ?'), ['prix']);
  assert.deepEqual(tokens('ما هو السعر؟'), ['سعر']);
});

test('retrieve: English match ranks the right FAQ first', () => {
  const r = retrieve(facts, 'is parking available near you?');
  assert.equal(r[0].q, 'Is there parking nearby?');
  assert.ok(r[0].score > 0);
});

test('retrieve: Spanish without accents and plural/singular', () => {
  const r = retrieve(facts, 'cual es el precio de un corte');
  assert.equal(r[0].q, '¿Cuáles son los precios del corte?');
  assert.equal(r[0].score, 1);
});

test('retrieve: Arabic with hamza / ta marbuta / al- variants', () => {
  const r = retrieve(facts, 'في موقف للسيارات');
  assert.equal(r[0].q, 'هل يوجد موقف سيارات؟');
  const p = retrieve(facts, 'اسعار');
  assert.equal(p[0].q, 'ما هي الأسعار؟');
});

test('retrieve: taught answers included, k respected, zero scores dropped', () => {
  assert.equal(retrieve(facts, 'gift card please')[0].source, 'taught');
  assert.equal(retrieve(facts, 'parking bridal gift precio', 2).length, 2);
  assert.deepEqual(retrieve(facts, 'zzz qqq'), []);
  assert.deepEqual(retrieve(facts, 'the and of'), []);
  assert.deepEqual(retrieve({}, 'parking'), []);
});

test('retrieve: ranking prefers question words over answer-only words', () => {
  const r = retrieve({ faqs: [{ q: 'Opening times', a: 'We have parking too' }, { q: 'Parking', a: 'Behind the shop' }] }, 'parking');
  assert.equal(r[0].q, 'Parking');
  assert.equal(r[0].score, 1);
  assert.equal(r[1].score, 0.5);
});

test('team: first names and roles only', () => {
  assert.deepEqual(teamOf('Layla Haddad - Color specialist\nCarla - Manicure'), [{ name: 'Layla', role: 'Color specialist' }, { name: 'Carla', role: 'Manicure' }]);
  assert.deepEqual(teamOf(null), []);
});

// A business row with every kind of internal field filled in: none of it may reach the public facts.
const SECRET = 'S3CRET-VALUE';
const biz = {
  id: 7, name: 'Beauty Test', description: 'Hair and nails', address: 'Main St 1', maps_url: 'https://maps.example/x', website: 'https://beauty.example',
  instagram: '@beauty', phone: '+961 1 234 567', currency: 'USD', timezone: 'Asia/Beirut',
  hours: { 1: [['09:00', '18:00']], 2: [['09:00', '18:00']], 3: [['09:00', '18:00']], 4: [['09:00', '18:00']], 5: [['09:00', '18:00']], 6: [['10:00', '16:00']] },
  team: 'Layla Haddad - Color specialist', policies: 'Arrive 5 minutes early.', cancel_hours: 12, payment_methods: 'Cash or card',
  booking_note: 'See you soon', faq: 'Q: Do you open on Sunday?\nA: No, we are closed on Sunday.',
  faqs: [{ q: 'Parking?', a: 'Behind the building.' }], ai_rules: [{ text: 'Never offer discounts.' }],
  pay_later: true, pay_deposit: false,
  services: [{ id: 1, name: 'Haircut', price: '20.00', minutes: 45, description: 'Wash and cut', active: true, cost: 7, buffer_minutes: 5 }],
  // internal: must never appear
  plan_price: 991199, plan_key: 'business-' + SECRET, plan_status: 'active-' + SECRET, addons: [SECRET], feature_overrides: { [SECRET]: true },
  telegram_token: SECRET, telegram_token_hash: SECRET, wa_phone_number_id: SECRET, owner_link_code: SECRET, owner_telegram_chat: SECRET,
  costs: { rent: 991199 }, revenue_goal: 991199, ai_budget: 991199, ai_budget_warned: SECRET, connector_allow: { [SECRET]: true },
  ai_instructions: 'internal ' + SECRET, autopilot: { x: SECRET }, alert_kinds: [SECRET], custom_domain: SECRET, subdomain: SECRET,
  paid_until: SECRET, retention_months: 991199, ai_mode: 'on-' + SECRET, ai_mode_by: SECRET, trial_ends_at: SECRET, site: { x: SECRET },
  staff_notes: SECRET, revenue_today: 991199, bookings_count: 991199, customers: [{ name: 'Other Client', phone: '+34 600 111 222' }],
};

test('publicFacts: contains the public catalogue', () => {
  const f = publicFactsFrom(biz, [{ q: 'Gift cards? call +961 70 123 456', a: 'Yes, from 25 USD.' }]);
  assert.equal(f.name, 'Beauty Test');
  assert.deepEqual(f.services, [{ name: 'Haircut', price: 20, minutes: 45, description: 'Wash and cut' }]);
  assert.match(f.opening_hours, /Mon: 09:00-18:00/);
  assert.equal(f.cancellation_hours, 12);
  assert.deepEqual(f.team, [{ name: 'Layla', role: 'Color specialist' }]);
  assert.deepEqual(f.rules, ['Never offer discounts.']);
  assert.equal(f.faqs.length, 2);
  assert.equal(f.taught[0].q, 'Gift cards? call [number]');
  assert.deepEqual(f.payment_options, ['pay at the appointment']);
});

test('publicFacts: no internal field, value or other customer leaks', () => {
  const f = publicFactsFrom(biz, []);
  const json = JSON.stringify(f);
  for (const bad of [SECRET, '991199', 'Other Client', '600 111 222', 'Haddad', '"cost"', 'buffer_minutes'])
    assert.ok(!json.includes(bad), `leaked: ${bad}`);
  for (const key of ['plan_price', 'plan_key', 'telegram_token', 'wa_phone_number_id', 'owner_link_code', 'costs', 'revenue_goal', 'ai_budget',
    'connector_allow', 'feature_overrides', 'addons', 'ai_instructions', 'staff_notes', 'customers', 'revenue_today', 'bookings_count', 'id', 'timezone', 'ai_mode'])
    assert.ok(!(key in f), `internal key present: ${key}`);
});

test('availabilityFacts: same shape as the old context', () => {
  const a = availabilityFacts(biz, [], []);
  assert.equal(a.availability.length, 14);
  assert.ok('today' in a.today_and_tomorrow && 'tomorrow' in a.today_and_tomorrow);
  assert.ok(Array.isArray(a.quick_slots.Haircut) && a.quick_slots.Haircut.length <= 3);
  assert.ok(a.quick_slots.Haircut.every(s => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s.slot)));
  assert.ok(Array.isArray(a.next_open_days) && a.next_open_days.length > 0);
});

console.log(`${n} knowledge tests passed`);
