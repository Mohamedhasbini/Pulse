// Instant dashboard: one call builds a working business from a template. The vertical (verticals.js) gives the words,
// the AI's persona, starter services and FAQs; the template (connectors.js) picks the pages and connectors; the
// sample pack below gives realistic, clearly-demo data so every chart has something to show on day one.
// Safe to run again: the same subdomain is reused and its demo data replaced.
//   docker compose exec app node src/instant.js gym "Pulse Fitness Club" Beirut
import { q, one } from './db.js';
import { createBusiness } from './accounts.js';
import { TEMPLATES } from './connectors.js';

// what each template needs beyond its vertical: services, team, hours, costs, and the kinds of messages clients send
const PACKS = {
  gym: {
    vertical: 'gym', assistant: 'Max', capacity: 12, tone: 'energetic',
    hours: { 0: [['08:00', '14:00']], 1: [['06:00', '23:00']], 2: [['06:00', '23:00']], 3: [['06:00', '23:00']], 4: [['06:00', '23:00']], 5: [['06:00', '22:00']], 6: [['08:00', '20:00']] },
    team: 'Karim – strength and personal training\nMaya – yoga and mobility\nJad – HIIT and spin\nLea – nutrition coaching',
    services: [['HIIT class', 12, 45, 'High-intensity group class, up to 12 people', 30], ['Spin class', 12, 45, 'Indoor cycling with music', 20], ['Yoga flow', 12, 60, 'All levels', 18],
      ['Personal training', 40, 60, 'One-to-one with a coach', 18], ['Monthly membership', 60, 30, 'Unlimited gym floor, sign-up visit', 7], ['Nutrition consult', 35, 45, 'Plan and check-ins', 5], ['Free trial session', 0, 45, 'First visit on us', 9]],
    faqs: [['Do I need to book classes?', 'Yes, classes have 12 spots. Book here and we hold your place.'], ['What are your prices?', 'Membership is $60 a month. Classes are $12, or included with a membership.'],
      ['Is there parking?', 'Yes, free parking for members under the building.'], ['Can I freeze my membership?', 'Yes, up to 30 days a year. Message us the dates.']],
    costs: [['Rent', 'Premises', 'month', 1400], ['Coach salaries', 'Team', 'month', 2600], ['Equipment lease', 'Equipment', 'month', 350], ['Utilities', 'Premises', 'month', 250],
      ['Card fees', 'Payments', 'percent', 2.5], ['Towels and cleaning', 'Supplies', 'booking', 0.6], ['Instagram ads', 'Marketing', 'month', 200]],
    asks: ['Is there a spin class tonight?', 'How much is the monthly membership?', 'Can I book a free trial?', 'I want personal training 3 times a week', 'Do you have yoga on Sunday?', 'Can I freeze my membership for 2 weeks?'],
    peak: [7, 8, 18, 19, 20],
  },
};
const FIRST = ['Ali', 'Sara', 'Omar', 'Lina', 'Hadi', 'Nour', 'Rami', 'Yara', 'Karim', 'Dana', 'Fadi', 'Rita', 'Tarek', 'Maya', 'Ziad', 'Jana', 'Elie', 'Hiba', 'Samir', 'Lea', 'Rawan', 'Bilal', 'Mira', 'Joe'];
const LAST = ['Haddad', 'Khoury', 'Saad', 'Nassar', 'Awad', 'Fares', 'Daher', 'Rizk', 'Salem', 'Hajj', 'Aoun', 'Mansour'];
const pick = (a, r) => a[Math.floor(r() * a.length)];
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647; // repeatable "random"

export async function instantDashboard({ template, name, city = 'Beirut', country = 'Lebanon' }) {
  const t = TEMPLATES.find(x => x.id === template), p = PACKS[template];
  if (!t || !p) throw new Error(`No instant pack for "${template}" yet. Ready: ${Object.keys(PACKS).join(', ')}`);
  const sub = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-demo';
  let b = await one('SELECT id FROM businesses WHERE subdomain=$1', [sub]);
  if (!b) b = { id: (await createBusiness({ name, vertical: p.vertical, owner_email: `owner@${sub}.example`, owner_name: 'Owner', country, city, currency: 'USD', timezone: 'Asia/Beirut', plan_key: 'pro' })).id };
  await q(`UPDATE businesses SET name=$2, subdomain=$3, template=$4, is_demo=true, hours=$5, capacity=$6, tone=$7, assistant_name=$8, team=$9, faqs=$10, costs=$11, city=$12 WHERE id=$1`,
    [b.id, name, sub, template, JSON.stringify(p.hours), p.capacity, p.tone, p.assistant, p.team, JSON.stringify(p.faqs.map(([q, a]) => ({ q, a }))),
      JSON.stringify(p.costs.map(([n, category, basis, amount]) => ({ name: n, category, basis, amount, kind: basis === 'month' ? 'fixed' : 'variable', channel: '' }))), city]);
  // services: the pack's list replaces the starter ones
  await q('UPDATE services SET active=false WHERE business_id=$1', [b.id]);
  const svc = [];
  for (const [n, price, minutes, description, weight] of p.services) {
    const s = await one('SELECT id FROM services WHERE business_id=$1 AND name=$2', [b.id, n]);
    const id = s ? (await q('UPDATE services SET price=$2, minutes=$3, description=$4, active=true WHERE id=$1', [s.id, price, minutes, description]), s.id)
      : (await one('INSERT INTO services (business_id, name, price, minutes, description) VALUES ($1,$2,$3,$4,$5) RETURNING id', [b.id, n, price, minutes, description])).id;
    svc.push({ id, price, minutes, weight });
  }
  // replace earlier demo activity, then add members, chats and bookings for the last 60 days and the next 7
  await q("DELETE FROM bookings WHERE business_id=$1", [b.id]);
  await q("DELETE FROM conversations WHERE business_id=$1", [b.id]);
  await q("DELETE FROM customers WHERE business_id=$1 AND phone LIKE 'demo-%'", [b.id]);
  const r = rng(b.id * 7919 + 1), members = [];
  for (let i = 0; i < 64; i++) {
    const c = await one(`INSERT INTO customers (business_id, phone, name, created_at) VALUES ($1,$2,$3, now() - make_interval(days => $4)) RETURNING id`,
      [b.id, `demo-${b.id}-${i}`, `${pick(FIRST, r)} ${pick(LAST, r)}`, Math.floor(r() * 120)]);
    members.push({ id: c.id, loyal: r() < 0.45 });
  }
  const total = svc.reduce((s, x) => s + x.weight, 0), choose = () => { let k = r() * total; for (const s of svc) if ((k -= s.weight) < 0) return s; return svc[0]; };
  const channels = ['whatsapp', 'whatsapp', 'whatsapp', 'instagram', 'instagram', 'telegram'];
  let n = 0;
  for (let d = -60; d <= 7; d++) {
    const perDay = Math.round((d > 0 ? 9 : 14) * (0.7 + r() * 0.6) * (new Date(Date.now() + d * 864e5).getDay() === 0 ? 0.5 : 1));
    for (let k = 0; k < perDay; k++) {
      const m = r() < 0.6 ? members.filter(x => x.loyal)[Math.floor(r() * members.filter(x => x.loyal).length)] : pick(members, r), s = choose();
      const at = new Date(Date.now() + d * 864e5); at.setHours(r() < 0.65 ? pick(p.peak, r) : 9 + Math.floor(r() * 9), r() < 0.5 ? 0 : 30, 0, 0);
      const status = d > 0 ? 'confirmed' : r() < 0.06 ? 'no_show' : r() < 0.08 ? 'cancelled' : 'completed';
      let conv = null;
      if (r() < 0.55) { // most bookings start as a chat the AI handled
        const ch = pick(channels, r), when = new Date(at - (1 + r() * 48) * 3600e3);
        conv = (await one(`INSERT INTO conversations (business_id, customer_id, channel, outcome, value, created_at, updated_at) VALUES ($1,$2,$3,'booked',$4,$5,$5) RETURNING id`, [b.id, m.id, ch, s.price, when])).id;
        await q(`INSERT INTO messages (conversation_id, role, text, created_at) VALUES ($1,'customer',$2,$3), ($1,'assistant',$4,$3)`,
          [conv, pick(p.asks, r), when, `Done! You're booked. See you then 💪`]);
      }
      await q(`INSERT INTO bookings (business_id, customer_id, service_id, conversation_id, starts_at, ends_at, price, status, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [b.id, m.id, s.id, conv, at, new Date(+at + s.minutes * 6e4), s.price, status, conv ? 'ai' : 'manual']);
      n++;
    }
    // chats that ended without a booking: questions answered, and a few handed to the team
    for (let k = 0; k < 3 + Math.floor(r() * 4) && d <= 0; k++) {
      const when = new Date(Date.now() + d * 864e5 - r() * 864e5), out = r() < 0.8 ? 'answered' : 'handoff';
      const c = (await one(`INSERT INTO conversations (business_id, customer_id, channel, outcome, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`, [b.id, pick(members, r).id, pick(channels, r), out, when])).id;
      await q(`INSERT INTO messages (conversation_id, role, text, created_at) VALUES ($1,'customer',$2,$3)`, [c, pick(p.asks, r), when]);
    }
  }
  return { id: b.id, subdomain: sub, template: t.name, pages: t.pages, bookings: n, members: members.length };
}

if (process.argv[1]?.endsWith('instant.js')) {
  const [template = 'gym', name = 'Pulse Fitness Club', city] = process.argv.slice(2);
  instantDashboard({ template, name, city }).then(x => { console.log(x); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });
}
