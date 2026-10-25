// Showcase client for sales demos: a complete beauty salon with a published website.
// Safe to run again: it updates the same business (found by its subdomain) instead of adding another.
//   docker compose exec app node src/demo-salon.js
import { q, one, pool } from './db.js';
import { createBusiness } from './accounts.js';

const SUB = 'layla-demo', NAME = 'Layla Beauty Studio';
let b = await one('SELECT id FROM businesses WHERE subdomain=$1', [SUB]);
let created = null;
if (!b) {
  created = await createBusiness({ name: NAME, vertical: 'salon', owner_email: `owner@${SUB}.example`, owner_name: 'Layla', country: 'Lebanon', city: 'Beirut',
    currency: 'USD', timezone: 'Asia/Beirut', plan_key: 'pro' });
  b = { id: created.id };
}
const hours = { 0: [], 1: [['10:00', '19:00']], 2: [['10:00', '20:00']], 3: [['10:00', '20:00']], 4: [['10:00', '21:00']], 5: [['10:00', '21:00']], 6: [['09:00', '18:00']] };
await q(`UPDATE businesses SET name=$2, subdomain=$3, is_demo=true, listed=true, phone='+961 70 123 456', address='14 Hamra Street', city='Beirut',
    description='Family-run beauty salon in Hamra since 2012: natural colour, bridal hair, nails and skin care.', instagram='@laylabeautystudio',
    hours=$4, capacity=3, slot_step=30, cancel_hours=12, payment_methods='Cash, card or Whish', languages='English, Arabic, French', tone='warm', assistant_name='Nora',
    team=$5, faqs=$6, policies='Please cancel at least 12 hours before. More than 15 minutes late may need to be rescheduled.',
    addons='["website_addon"]', site=$7 WHERE id=$1`,
  [b.id, NAME, SUB, JSON.stringify(hours), 'Layla – colour specialist\nRami – cuts and beard\nSara – nails and facials\nNour – bridal hair and make-up',
   JSON.stringify([
     { q: 'Do you take walk-ins?', a: 'Yes, when a chair is free. Booking guarantees your time.' },
     { q: 'Which products do you use?', a: 'Kérastase and Olaplex for hair, OPI for nails.' },
     { q: 'Do you do bridal packages?', a: 'Yes. Hair and make-up with a trial session. Message us with your date.' },
     { q: 'Is there parking?', a: 'Free parking behind the building for our clients.' }]),
   JSON.stringify({ style: 'elegant', published: true, sections: ['hero', 'about', 'services', 'booking', 'team', 'reviews', 'hours', 'faq', 'contact'],
     text: { en: { tagline: 'Beauty salon · Hamra, Beirut', hero_title: 'Hair, nails and glow, done beautifully.',
       hero_sub: 'Colour specialists since 2012. Book online in seconds, or message us any time and our assistant books you in.',
       about_title: 'A salon that feels like home',
       about: 'Family-run since 2012, we specialise in natural colour, bridal hair and nail care.\n\nEvery visit starts with a short consultation, so you leave with exactly the look you wanted, and products that suit your hair.' } } })]);
const services = [['Haircut & blow-dry', 35, 45, 'Wash, cut and blow-dry'], ['Full colour', 90, 120, 'Includes toner and gloss'], ['Balayage', 160, 180, 'Hand-painted, natural blend'],
  ['Keratin treatment', 140, 150, 'Smooth, frizz-free for up to 4 months'], ['Gel manicure', 25, 40, 'Shape, cuticles and gel colour'], ['Pedicure', 30, 50, ''],
  ['Hydrating facial', 55, 60, 'Deep cleanse, mask and massage'], ['Bridal hair & make-up', 250, 180, 'Trial session included']];
await q('UPDATE services SET active=false WHERE business_id=$1', [b.id]);
for (const [name, price, minutes, description] of services) {
  const s = await one('SELECT id FROM services WHERE business_id=$1 AND name=$2', [b.id, name]);
  if (s) await q('UPDATE services SET price=$2, minutes=$3, description=$4, active=true WHERE id=$1', [s.id, price, minutes, description]);
  else await q('INSERT INTO services (business_id, name, price, minutes, description) VALUES ($1,$2,$3,$4,$5)', [b.id, name, price, minutes, description]);
}
if (!(await one('SELECT 1 FROM reviews WHERE business_id=$1', [b.id])))
  await q(`INSERT INTO reviews (business_id, stars, text, author, created_at) VALUES
    ($1,5,'Best colour I have ever had. Layla is an artist and really listens.','Rana K.', now() - interval '3 days'),
    ($1,5,'Messaged at midnight on WhatsApp and was booked in seconds. So easy.','Maya H.', now() - interval '9 days'),
    ($1,5,'Did my bridal hair and make-up. Perfect from the trial to the big day.','Lea S.', now() - interval '20 days'),
    ($1,4,'Beautiful, very clean salon and a friendly team.','Nour A.', now() - interval '31 days')`, [b.id]);
console.log(`${created ? 'Created' : 'Updated'} showcase "${NAME}" (business ${b.id}) · website: /s/${b.id} · subdomain: ${SUB}`);
if (created) console.log(`Owner login: ${created.email} (temporary password printed once): ${created.password}`);
await pool.end();
