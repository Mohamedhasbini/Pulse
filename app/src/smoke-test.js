// Quick end-to-end check of uploads, admin platform pages, export/close and restaurant table counts.
// docker compose exec app node src/smoke-test.js   (creates one temporary business and removes it)
import { q, one, pool } from './db.js';
import { createBusiness, signSession } from './accounts.js';
import { isFree } from './slots.js';
import { loadBusiness } from './brain.js';
const BASE = 'http://localhost:3100', ok = [], say = (n, c, d = '') => { ok.push(c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); };
const r = await createBusiness({ name: 'Smoke test restaurant', vertical: 'restaurant', owner_email: `smoke-${Date.now()}@example.test`, timezone: 'Asia/Beirut', currency: 'USD' });
const owner = await one('SELECT id, session_version FROM users WHERE business_id=$1', [r.id]), admin = await one(`SELECT id, session_version FROM users WHERE role='admin' LIMIT 1`);
const as = u => ({ cookie: `rb_session=${signSession(u.id, u.session_version)}`, origin: BASE });
try {
  // upload a 1x1 PNG as the logo
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  let x = await fetch(BASE + '/api/business/upload/logo', { method: 'POST', headers: { ...as(owner), 'Content-Type': 'image/png' }, body: png }).then(r => r.json());
  say('Owner can upload a logo', !!x.url, x.url || x.error);
  const m = await fetch(BASE + x.url); say('Logo is served publicly', m.status === 200 && m.headers.get('content-type').includes('png'));
  x = await fetch(BASE + '/api/business/upload/logo', { method: 'POST', headers: { ...as(owner), 'Content-Type': 'text/html' }, body: '<script>' });
  say('Non-image upload refused', x.status === 400);
  // admin platform pages
  const h = await fetch(BASE + '/api/admin/health', { headers: as(admin) }).then(r => r.json());
  say('Health check answers', Array.isArray(h) && h.length >= 5, h.map(c => `${c.name}:${c.ok ? 'ok' : 'check'}`).join(', '));
  const u = await fetch(BASE + '/api/admin/usage', { headers: as(admin) }).then(r => r.json());
  say('Usage per client answers', u.some(b => b.id === r.id));
  const ex = await fetch(BASE + `/api/admin/businesses/${r.id}/export`, { headers: as(admin) }).then(r => r.json());
  say('Export has the business and no secrets', ex.business?.id === r.id && !('telegram_token' in ex.business) && Array.isArray(ex.services));
  // restaurant: 2 tables of the first type
  const svc = await one('SELECT id FROM services WHERE business_id=$1 ORDER BY id LIMIT 1', [r.id]);
  await q('UPDATE services SET capacity=2 WHERE id=$1', [svc.id]); await q('UPDATE businesses SET capacity=1 WHERE id=$1', [r.id]);
  const biz = await loadBusiness(r.id), d = new Date(); d.setDate(d.getDate() + 1); d.setHours(19, 0, 0, 0);
  const end = new Date(d.getTime() + 90 * 60000), bk = n => Array.from({ length: n }, () => ({ status: 'confirmed', service_id: svc.id, starts_at: d, ends_at: end }));
  biz.hours = { ...biz.hours, [d.getDay()]: [['12:00', '23:00']] };
  say('Restaurant: 2nd table of a type still free', isFree(biz, bk(1), [], d, end, 0, svc.id));
  say('Restaurant: 3rd table of that type is full', !isFree(biz, bk(2), [], d, end, 0, svc.id));
  // the admin with no business opened is in the Lab: platform pages only
  const me0 = await fetch(BASE + '/api/me', { headers: as(admin) }).then(r => r.json());
  say('Admin signs in to the Lab, not a business', me0.lab === true && !me0.business);
  say('Lab blocks business data until a business is opened', (await fetch(BASE + '/api/business', { headers: as(admin) })).status === 409);
  const inside = { ...as(admin), cookie: as(admin).cookie + `; rb_biz=${r.id}` };
  const me1 = await fetch(BASE + '/api/me', { headers: inside }).then(r => r.json());
  say('Opening a business puts the admin inside it', me1.lab === false && me1.business?.id === r.id);
  const lab = await fetch(BASE + '/api/admin/lab', { method: 'POST', headers: { ...inside, 'Content-Type': 'application/json' } });
  say('Back to Lab clears the opened business', lab.status === 200 && /rb_biz=;/.test(lab.headers.get('set-cookie') || ''));
  // wrong confirmation name refuses to close
  x = await fetch(BASE + `/api/admin/businesses/${r.id}`, { method: 'DELETE', headers: { ...as(admin), 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'wrong' }) });
  say('Close needs the exact business name', x.status === 400);
  x = await fetch(BASE + `/api/admin/businesses/${r.id}`, { method: 'DELETE', headers: { ...as(admin), 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'Smoke test restaurant' }) });
  const gone = !(await one('SELECT 1 FROM businesses WHERE id=$1', [r.id])) && !(await one('SELECT 1 FROM users WHERE business_id=$1', [r.id]));
  say('Close deletes the business and its logins', x.status === 200 && gone);
  await new Promise(s => setTimeout(s, 300));
  say('Closing removes its photos', (await fetch(BASE + `/media/${r.id}/` + String(ex.business.logo_url).split('/').pop())).status === 404);
} finally {
  await q('DELETE FROM businesses WHERE id=$1', [r.id]).catch(() => {});
  console.log(`\n${ok.filter(Boolean).length} passed, ${ok.filter(c => !c).length} failed`); await pool.end(); process.exit(ok.every(Boolean) ? 0 : 1);
}
