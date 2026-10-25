// Demo businesses so the WeBook marketplace isn't empty while you build it up.
// Clearly flagged (is_demo), fully working (own services, hours and AI), and removable in one click.
import { q, one } from './db.js';
import { VERTICALS } from './verticals.js';

const WEEK = (open, close, sat = close, sun = null) => JSON.stringify({ 0: sun ? [[open, sun]] : [], 1: [[open, close]], 2: [[open, close]], 3: [[open, close]], 4: [[open, close]], 5: [[open, close]], 6: [[open, sat]] });
const DEMOS = [
  { name: 'Barber Lab', vertical: 'barber', city: 'Beirut', address: 'Mar Mikhael, Armenia Street', hours: WEEK('10:00', '21:00', '22:00'), cover: 'linear-gradient(135deg,#1f2937,#475569)',
    description: 'Classic and modern cuts, hot-towel shaves and beard design.', capacity: 3 },
  { name: 'Smile Dental Studio', vertical: 'dental', city: 'Beirut', address: 'Achrafieh, Sassine Square', hours: WEEK('09:00', '18:00', '14:00'), cover: 'linear-gradient(135deg,#0ea5e9,#22d3ee)',
    description: 'Gentle family dentistry, whitening and check-ups.', capacity: 2 },
  { name: 'Zen Spa & Massage', vertical: 'spa', city: 'Jounieh', address: 'Kaslik main road', hours: WEEK('11:00', '22:00', '22:00', '20:00'), cover: 'linear-gradient(135deg,#0f766e,#5eead4)',
    description: 'A calm escape: massages, hammam and couples treatments.', capacity: 4 },
  { name: 'Pulse Fitness', vertical: 'gym', city: 'Beirut', address: 'Verdun, Rashid Karami Street', hours: WEEK('06:00', '23:00', '20:00', '14:00'), cover: 'linear-gradient(135deg,#f97316,#facc15)',
    description: 'Personal training and small group classes with certified coaches.', capacity: 6 },
  { name: 'Olive Table', vertical: 'restaurant', city: 'Byblos', address: 'Old Souk, Byblos', hours: WEEK('12:00', '23:30', '23:59', '23:00'), cover: 'linear-gradient(135deg,#65a30d,#a3e635)',
    description: 'Lebanese mezze and grills on a terrace by the old port.', capacity: 12 },
  { name: 'Glow Nail Bar', vertical: 'salon', city: 'Beirut', address: 'Hamra, Bliss Street', hours: WEEK('10:00', '20:00', '19:00'), cover: 'linear-gradient(135deg,#db2777,#f9a8d4)',
    description: 'Manicures, gel nails and quick beauty treatments.', capacity: 3 },
];
const REVIEWERS = ['Rana', 'Karim', 'Maya', 'Omar', 'Lina', 'Hadi', 'Sara', 'Nour', 'Ziad', 'Yara', 'Dana', 'Rami'];
const TEXTS = { 5: ['Amazing service, will be back!', 'Booked in seconds through the chat. Loved it.', 'Best in town, super friendly team.'], 4: ['Very good, a bit busy on Saturday.', 'Great experience overall.'], 3: ['Good but I waited 10 minutes.'] };

export async function seedDemo({ force = false } = {}) {
  await q(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`);
  if (!force && await one(`SELECT 1 FROM app_settings WHERE key='demo_seeded'`)) return 0;
  let n = 0;
  for (const [i, d] of DEMOS.entries()) {
    if (await one('SELECT 1 FROM businesses WHERE name=$1 AND is_demo', [d.name])) continue;
    const v = VERTICALS[d.vertical];
    const b = await one(`INSERT INTO businesses (name, vertical, city, address, description, hours, capacity, cover, is_demo, listed, faq, policies, ai_instructions, faqs, payment_methods, booking_note, reminders_enabled)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,true,'',$9,$10,$11,'Cash or card','',false) RETURNING id`,
      [d.name, d.vertical, d.city, d.address, d.description, d.hours, d.capacity, d.cover, v.policies || '', v.ai_instructions || '',
       JSON.stringify((v.faqs || []).map(([q2, a]) => ({ q: q2, a })))]);
    for (const [name, price, minutes, description] of v.services)
      await q('INSERT INTO services (business_id, name, price, minutes, description) VALUES ($1,$2,$3,$4,$5)', [b.id, name, price, minutes, description || '']);
    // A handful of demo reviews so ratings and "trending" have something to show.
    const count = 6 + (i * 5) % 9;
    for (let r = 0; r < count; r++) {
      const stars = [5, 5, 4, 5, 3, 5, 4, 5][(r + i) % 8];
      await q(`INSERT INTO reviews (business_id, stars, text, author, created_at) VALUES ($1,$2,$3,$4, now() - make_interval(days => $5))`,
        [b.id, stars, TEXTS[stars][r % TEXTS[stars].length], REVIEWERS[(r + i * 3) % REVIEWERS.length], (r * 7 + i * 3) % 60]);
    }
    n++;
  }
  await q(`INSERT INTO app_settings (key, value) VALUES ('demo_seeded','1') ON CONFLICT (key) DO UPDATE SET value='1'`);
  return n;
}

export async function removeDemo() {
  const r = await q('DELETE FROM businesses WHERE is_demo RETURNING id');
  return r.length;
}
