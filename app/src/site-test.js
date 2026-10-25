// Client website checks: every style x language renders cleanly, only published sites are public,
// domains route to the right business, owners can't change the design, and uploads show up.
//   docker compose exec app node src/site-test.js   (creates temporary businesses and removes them)
import http from 'node:http';
import { q, one, pool } from './db.js';
import { createBusiness, signSession } from './accounts.js';
import { closeBusiness } from './ops.js';
import { siteData, renderSite, STYLES, LANGS, SECTIONS } from './sitegen.js';

const BASE = 'http://localhost:3100', stamp = Date.now(), results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const get = (path, { host, cookie } = {}) => new Promise((resolve, reject) => {
  const r = http.request(BASE + path, { headers: { ...(host ? { host } : {}), ...(cookie ? { cookie } : {}) } }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, text: b, type: res.headers['content-type'] || '' })); });
  r.on('error', reject); r.end();
});
const send = (path, method, body, cookie, type = 'application/json') => fetch(BASE + path, { method, headers: { cookie, origin: BASE, 'Content-Type': type }, body: type === 'application/json' ? JSON.stringify(body) : body })
  .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const login = async bizId => { const u = await one('SELECT id, session_version FROM users WHERE business_id=$1 AND role=$2', [bizId, 'owner']); return `rb_session=${signSession(u.id, u.session_version)}`; };
const admin = await one(`SELECT id, session_version FROM users WHERE role='admin' LIMIT 1`), ADMIN = `rb_session=${signSession(admin.id, admin.session_version)}`;
const made = [];

try {
  const A = await createBusiness({ name: `Site test salon ${stamp}`, vertical: 'salon', owner_email: `site-a-${stamp}@example.test`, timezone: 'Asia/Beirut', currency: 'USD' });
  const B = await createBusiness({ name: `Site test other ${stamp}`, vertical: 'clinic', owner_email: `site-b-${stamp}@example.test`, timezone: 'Europe/Madrid', currency: 'EUR' });
  made.push(A.id, B.id);
  await q(`UPDATE businesses SET phone='+961 70 123 456', address='Bliss Street 14', city='Beirut', description='Hair, nails and beauty since 2012.\n\nWomen and men welcome.',
    team='Layla – colour specialist\nRami – cuts and beard', faqs=$2, maps_url='https://maps.app.goo.gl/x', instagram='@sitetest', feature_overrides='{"website":true}' WHERE id=$1`,
    [A.id, JSON.stringify([{ q: 'Do you take walk-ins?', a: 'Yes, when a chair is free.' }])]);
  await q(`INSERT INTO reviews (business_id, stars, text, author) VALUES ($1,5,'Best colour I ever had, so friendly!','Rana'),($1,4,'Lovely place and very clean.','Maya')`, [A.id]);
  const OWNER_A = await login(A.id), OWNER_B = await login(B.id);

  // 1. Every style x language renders cleanly
  const site = { style: 'elegant', langs: Object.keys(LANGS), default_lang: 'en', sections: SECTIONS, published: true, gallery: [],
    text: { en: { tagline: 'Beauty salon', hero_title: 'Look good, <script>alert(1)</script>', hero_sub: 'Book in seconds', about: 'We love <b>hair</b> & "colour".' },
            ar: { hero_title: 'صالون التجميل', hero_sub: 'احجزي بثوانٍ' }, es: { hero_title: 'Salón de belleza' } } };
  for (const style of Object.keys(STYLES)) for (const lang of Object.keys(LANGS)) {
    await q('UPDATE businesses SET site=$1 WHERE id=$2', [JSON.stringify({ ...site, style }), A.id]);
    const html = renderSite(await siteData(A.id), lang);
    const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
    const anchors = [...html.matchAll(/href="#([\w-]+)"/g)].map(m => m[1]).filter(id => !html.includes(`id="${id}"`));
    const ld = (() => { try { JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]); return true; } catch { return false; } })();
    const problems = [
      !html.includes(`<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">`) && 'lang/dir',
      /\b(undefined|NaN)\b|>null</.test(body) && 'undefined/NaN/null shown',
      html.includes('<script>alert(1)') && 'unescaped script',
      anchors.length && 'menu links without a section: ' + anchors.join(','),
      !ld && 'structured data',
      !html.includes(`/book?b=${A.id}`) && 'booking link',
      !html.includes('wa.me/96170123456') && 'WhatsApp link',
    ].filter(Boolean);
    check(`Renders: ${STYLES[style].label} · ${LANGS[lang]}`, !problems.length, problems.join('; '));
  }
  // 2. Publishing and preview rights
  await q('UPDATE businesses SET site=$1 WHERE id=$2', [JSON.stringify({ ...site, published: false }), A.id]);
  check('Unpublished: hidden from the public', (await get(`/s/${A.id}`)).status === 404);
  check('Unpublished: owner can preview', (await get(`/s/${A.id}`, { cookie: OWNER_A })).status === 200);
  check('Unpublished: another client cannot preview', (await get(`/s/${A.id}`, { cookie: OWNER_B })).status === 404);
  await q('UPDATE businesses SET site=$1 WHERE id=$2', [JSON.stringify(site), A.id]);
  check('Published: public preview works', (await get(`/s/${A.id}`)).status === 200);
  check('Arabic chosen by ?lang', (await get(`/s/${A.id}?lang=ar`)).text.includes('dir="rtl"'));
  // 3. Own domain routing
  const dom = `site-test-${stamp}.example`;
  await q('UPDATE businesses SET custom_domain=$1 WHERE id=$2', [dom, A.id]);
  let r = await get('/', { host: dom });
  check('Own domain shows that business', r.status === 200 && r.text.includes(`Site test salon ${stamp}`));
  check('www. on own domain works', (await get('/', { host: 'www.' + dom })).status === 200);
  r = await get('/robots.txt', { host: dom }); check('robots.txt per domain', r.status === 200 && r.text.includes('Sitemap:'));
  r = await get('/sitemap.xml', { host: dom }); check('sitemap.xml lists each language', r.status === 200 && (r.text.match(/<loc>/g) || []).length === 3);
  check('Booking page still works on own domain', (await get(`/book?b=${A.id}`, { host: dom })).status === 200);
  check('Unknown domain falls through to Pulse', !(await get('/', { host: 'nobody-' + stamp + '.example' })).text.includes('Site test salon'));
  await q(`UPDATE businesses SET feature_overrides='{"website":false}' WHERE id=$1`, [A.id]);
  check('Website switched off in plan: site goes offline', (await get('/', { host: dom })).status === 404);
  await q(`UPDATE businesses SET feature_overrides='{"website":true}' WHERE id=$1`, [A.id]);
  // 4. Settings API: owner edits text only; admin controls design
  r = await send('/api/site', 'PUT', { style: 'bold', sections: ['hero'], published: false, text: { en: { hero_title: 'Owner title' } } }, OWNER_A);
  let s = (await one('SELECT site FROM businesses WHERE id=$1', [A.id])).site;
  check('Owner can change texts', r.status === 200 && s.text.en.hero_title === 'Owner title');
  check('Owner cannot change style, sections or publishing', s.style === 'elegant' && s.sections.length === SECTIONS.length && s.published === true);
  r = await send('/api/site', 'PUT', { subdomain: 'hacked' }, OWNER_A);
  check('Owner cannot set the address', !(await one('SELECT subdomain FROM businesses WHERE id=$1', [A.id])).subdomain);
  const ADMIN_A = ADMIN + `; rb_biz=${A.id}`;
  r = await send('/api/site', 'PUT', { style: 'bold', subdomain: `test${stamp % 100000}` }, ADMIN_A);
  s = (await one('SELECT site, subdomain FROM businesses WHERE id=$1', [A.id]));
  check('Admin can change style and subdomain', r.status === 200 && s.site.style === 'bold' && s.subdomain === `test${stamp % 100000}`);
  check('Reserved subdomain refused', (await send('/api/site', 'PUT', { subdomain: 'admin' }, ADMIN_A)).status === 400);
  check('Domain of another business refused', (await send('/api/site', 'PUT', { custom_domain: dom }, ADMIN + `; rb_biz=${B.id}`)).status === 409);
  check("Owner B cannot read A's website settings", !JSON.stringify((await send('/api/site', 'GET', undefined, OWNER_B).catch(() => ({ json: {} }))).json).includes('Owner title'));
  // 5. Gallery upload appears on the site, removing it deletes the file
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  r = await send('/api/business/upload/gallery', 'POST', png, OWNER_A, 'image/png');
  const url = r.json.url;
  check('Owner uploads a gallery photo', !!url && (await get(`/s/${A.id}`)).text.includes(url));
  r = await send('/api/site', 'PUT', { gallery: [] }, OWNER_A);
  await new Promise(x => setTimeout(x, 300));
  check('Removing a photo deletes the file', (await get(url)).status === 404);
} catch (e) {
  check('Test ran without errors', false, e.stack);
} finally {
  for (const id of made) await closeBusiness(id).catch(() => {});
  const bad = results.filter(x => !x).length;
  console.log(`\n${results.length - bad} passed, ${bad} failed`);
  await pool.end(); process.exit(bad ? 1 : 0);
}
