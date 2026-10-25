// Writes a sample site for every style x language to a folder, for visual checks on phone and computer.
//   docker compose exec app node src/site-samples.js            -> /tmp/sites
//   docker compose cp app:/tmp/sites ./site-samples             (then open them in a browser)
// Uses fixed sample content, so nothing in the database is read or changed.
import fs from 'node:fs';
import { renderSite, siteOf, STYLES, LANGS, SECTIONS } from './sitegen.js';

const hours = { 0: [], 1: [['10:00', '20:00']], 2: [['10:00', '20:00']], 3: [['10:00', '20:00']], 4: [['10:00', '21:00']], 5: [['10:00', '21:00']], 6: [['09:00', '18:00']] };
const biz = {
  id: 0, name: 'Layla Beauty', vertical: 'salon', currency: 'USD', timezone: 'Asia/Beirut', phone: '+961 70 123 456', address: '14 Hamra Street', city: 'Beirut',
  instagram: '@laylabeauty', maps_url: '', hours, show_branding: true, description: 'Family-run beauty salon since 2012.',
  team: 'Layla – colour specialist\nRami – cuts and beard\nSara – nails and facials',
  faqs: [{ q: 'Do you take walk-ins?', a: 'Yes, when a chair is free. Booking guarantees your time.' }, { q: 'Which products do you use?', a: 'Kérastase and Olaplex for colour and care.' }],
  services: [{ name: 'Haircut & blow-dry', price: 35, minutes: 45, description: 'Wash, cut and blow-dry' }, { name: 'Full colour', price: 90, minutes: 120, description: 'Includes toner and gloss' },
    { name: 'Balayage', price: 160, minutes: 180, description: 'Hand-painted, natural blend' }, { name: 'Gel manicure', price: 25, minutes: 40, description: '' },
    { name: 'Hydrating facial', price: 55, minutes: 60, description: 'Deep cleanse and mask' }, { name: 'Bridal hair', price: 0, minutes: 90, description: 'Trial included, price on consultation' }],
};
const site = siteOf({ ...biz, site: {
  langs: Object.keys(LANGS), default_lang: 'en', published: true, sections: SECTIONS.filter(s => s !== 'gallery'),
  text: {
    en: { tagline: 'Beauty salon · Hamra, Beirut', hero_title: 'Hair, nails and glow, done beautifully.', hero_sub: 'Colour specialists since 2012. Book online in seconds, or message us any time and our assistant books you in.',
      about_title: 'A salon that feels like home', about: 'Family-run since 2012, we specialise in natural colour, bridal hair and nail care.\n\nEvery visit starts with a consultation, so you leave with exactly the look you wanted.' },
    ar: { tagline: 'صالون تجميل · الحمرا، بيروت', hero_title: 'شعر وأظافر وإشراقة، بأجمل طريقة.', hero_sub: 'خبراء الصبغة منذ 2012. احجزي أونلاين بثوانٍ، أو راسلينا بأي وقت ومساعدنا يحجز لكِ.',
      about_title: 'صالون يشعرك وكأنك في البيت', about: 'صالون عائلي منذ 2012، متخصص في الألوان الطبيعية وتسريحات العرائس والعناية بالأظافر.' },
    es: { tagline: 'Salón de belleza · Hamra, Beirut', hero_title: 'Pelo, uñas y brillo, con todo el cuidado.', hero_sub: 'Especialistas en color desde 2012. Reserva online en segundos o escríbenos cuando quieras.',
      about_title: 'Un salón que se siente como en casa', about: 'Negocio familiar desde 2012, especializado en color natural, peinados de novia y uñas.' },
  } } });
const data = { biz, site, rating: { avg: 4.8, n: 126 }, reviews: [
  { stars: 5, text: 'Best colour I have ever had. Layla is an artist.', author: 'Rana K.' },
  { stars: 5, text: 'Booked on WhatsApp at midnight and got a reply instantly. Love it.', author: 'Maya' },
  { stars: 4, text: 'Beautiful salon, very clean and a friendly team.', author: 'Nour' }] };

const out = process.argv[2] || '/tmp/sites';
fs.mkdirSync(out, { recursive: true });
const links = [];
for (const style of Object.keys(STYLES)) for (const lang of Object.keys(LANGS)) {
  const f = `${style}-${lang}.html`;
  fs.writeFileSync(`${out}/${f}`, renderSite({ ...data, site: { ...site, style } }, lang));
  links.push(`<li><a href="${f}">${STYLES[style].label} · ${LANGS[lang]}</a></li>`);
}
fs.writeFileSync(`${out}/index.html`, `<!doctype html><meta charset="utf-8"><title>Site samples</title><ul style="font:18px/2 system-ui">${links.join('')}</ul>`);
console.log(`Wrote ${links.length} samples to ${out}`);
