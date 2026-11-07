// Example people for looking at the lead pool screen. All belong to the business "Demo (example data)", use
// example.com emails and fictional names. Add:    docker compose exec -T app node src/pool/demo-seed.js
// Remove all:  docker compose exec -T app node src/pool/demo-seed.js --remove
import { q, one, pool } from '../db.js';
import { ingest } from './capture.js';

const NAME = 'Demo (example data)';
if (process.argv.includes('--remove')) {
  const c = await one('SELECT id FROM eng_clients WHERE name=$1', [NAME]);
  if (c) {
    await q(`DELETE FROM lp_suppressions WHERE value_hash IN (SELECT i.value_hash FROM lp_identities i JOIN lp_persons p ON p.id=i.person_id WHERE p.owner_client_id=$1)`, [c.id]);
    const r = await q('DELETE FROM lp_persons WHERE owner_client_id=$1 RETURNING id', [c.id]);
    await q('DELETE FROM eng_clients WHERE id=$1', [c.id]);
    console.log(`Removed ${r.length} example people`);
  }
  await pool.end(); process.exit(0);
}
const c = await one('SELECT id FROM eng_clients WHERE name=$1', [NAME]) || await one(`INSERT INTO eng_clients (name, website, status) VALUES ($1,'https://example.com','ready') RETURNING id`, [NAME]);
const first = ['Layla', 'Omar', 'Sara', 'James', 'Fatima', 'Lucas', 'Noor', 'Emma', 'Yousef', 'Chloe', 'Hassan', 'Mia', 'Ahmed', 'Olivia', 'Rania', 'Daniel', 'Aisha', 'Sophie', 'Karim', 'Isabella'];
const last = ['Haddad', 'Smith', 'Mansour', 'García', 'Khalil', 'Brown', 'Nasser', 'Taylor', 'Saleh', 'Martin'];
const places = [['AE', 'Dubai', '+97150'], ['AE', 'Abu Dhabi', '+97155'], ['GB', 'London', '+447700'], ['US', 'Miami', '+1305'], ['ES', 'Madrid', '+3461'], ['AU', 'Sydney', '+61412'], ['SA', 'Riyadh', '+96655']];
const wants = [['aesthetics', 'Laser hair removal package'], ['aesthetics', 'Botox consultation'], ['dental', 'Teeth whitening'], ['dental', 'Invisalign assessment'], ['real_estate', '2-bedroom apartment to rent'], ['fitness', 'Personal training, 3 times a week'], ['education', 'IELTS preparation course']];
const timings = ['now', 'now', '1-3 months', '3-6 months', 'later'], ages = ['18-24', '25-34', '25-34', '35-44', '45-54', '55-64'], genders = ['female', 'female', 'male', 'male', 'prefer not to say'];
const budgets = ['under 1,000', '1,000-3,000', '3,000-10,000', '10,000+'];
const r = (arr, i) => arr[i % arr.length];
let n = 0;
for (let i = 0; i < 40; i++) {
  const [cc, city, prefix] = r(places, i * 3 + 1), [vertical, intent] = r(wants, i * 5 + 2);
  const channels = [['email', 'whatsapp'], ['whatsapp'], ['email'], ['email', 'whatsapp', 'sms'], []][i % 5];
  const name = `${r(first, i)} ${r(last, i * 7)}`;
  const daysAgo = (i * 37) % 60;
  const attrs = { age_range: r(ages, i * 3), budget: r(budgets, i) };
  if (r(genders, i * 11) !== 'prefer not to say') attrs.gender = r(genders, i * 11);
  await ingest({ clientId: c.id, source: ['form:demo', 'meta_lead', 'google_lead', 'chat'][i % 4], name, email: `${name.toLowerCase().normalize('NFKD').replace(/[^a-z]+/g, '.')}.${i}@example.com`,
    phone: `${prefix}${String(1000000 + i * 7919).slice(-7)}`, country: cc, city, language: ['AE', 'SA'].includes(cc) && i % 2 ? 'ar' : cc === 'ES' ? 'es' : 'en',
    attributes: attrs, interest: { vertical, intent, timing: r(timings, i * 3), budget: attrs.budget }, event: 'form_submit', at: new Date(Date.now() - daysAgo * 864e5),
    consents: channels.map(ch => ({ channel: ch, purpose: 'marketing', buyers: [c.id], text: `I agree that ${NAME} may contact me by ${ch} about offers and appointments.`, method: 'checkbox' })),
    ip: '203.0.113.' + (i + 1), user_agent: 'example', evidence: { demo: true } }).catch(e => console.log('skip', e.message));
  n++;
}
await q(`UPDATE lp_persons SET status = (ARRAY['new','qualified','contacted','booked','won','new','lost'])[1 + (id % 7)] WHERE owner_client_id=$1`, [c.id]);
console.log(`Added ${n} example people to "${NAME}"`);
await pool.end();
