// Quick end-to-end check of uploads, admin platform pages, export/close and restaurant table counts.
// docker compose exec app node src/smoke-test.js   (creates one temporary business and removes it)
import { q, one, pool } from './db.js';
import { createBusiness, signSession, signTicket, newTotpSecret } from './accounts.js';
import { isFree, freeSlots, parseLocal, availability } from './slots.js';
import { inZone } from './clock.js';
import { receive, work, resume } from './inbound.js';
import { loadBusiness, asksToCancel, langOf, findService } from './brain.js';
import { unify } from './customers.js';
const BASE = 'http://localhost:3100', ok = [], say = (n, c, d = '') => { ok.push(c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); };
const r = await createBusiness({ name: 'Smoke test restaurant', vertical: 'restaurant', owner_email: `smoke-${Date.now()}@example.test`, timezone: 'Asia/Beirut', currency: 'USD' });
const owner = await one('SELECT id, session_version FROM users WHERE business_id=$1', [r.id]), admin = await one(`SELECT id, session_version FROM users WHERE role='admin' LIMIT 1`);
const as = u => ({ cookie: `rb_session=${signSession(u.id, u.session_version)}`, origin: BASE });
try {
  const hz = await fetch(BASE + '/health'); const hj = await hz.json();
  say('Health check confirms the database answers', hz.status === 200 && hj.db === true);
  // Today › since you last checked: counts this business only, and a reload within 30 minutes keeps the same window
  const ch1 = await fetch(BASE + '/api/changes', { headers: as(owner) }).then(r => r.json()), ch2 = await fetch(BASE + '/api/changes', { headers: as(owner) }).then(r => r.json());
  say('Since-you-last-checked answers and survives a reload', typeof ch1.bookings === 'number' && ch1.since && ch1.since === ch2.since, `${ch1.since} / ${ch2.since}`);
  // a write with Origin: null (sandboxed frames) is refused cleanly, not a server error
  let o = await fetch(BASE + '/api/business', { method: 'PUT', headers: { ...as(owner), origin: 'null', 'Content-Type': 'application/json' }, body: '{}' });
  say('Origin "null" write gets 403, not 500', o.status === 403, String(o.status));
  // a client named "Test ..." stays out of the list unless test customers are asked for
  await q(`INSERT INTO customers (business_id, phone, name) VALUES ($1, '+10000000999', 'Test Deposit')`, [r.id]);
  const cl0 = await fetch(BASE + '/api/customers?test=0', { headers: as(owner) }).then(r => r.json()), cl1 = await fetch(BASE + '/api/customers?test=1', { headers: as(owner) }).then(r => r.json());
  const has = l => (Array.isArray(l) ? l : l.rows || []).some(c => c.name === 'Test Deposit');
  say('Test clients hidden by default, shown on request', !has(cl0) && has(cl1));
  // the same rule holds in Insights: a client named "Test ..." with a booking never shows as a top or at-risk customer
  const svc0 = await one('SELECT id FROM services WHERE business_id=$1 ORDER BY id LIMIT 1', [r.id]);
  const tc = await one(`SELECT id FROM customers WHERE business_id=$1 AND name='Test Deposit'`, [r.id]);
  await q(`INSERT INTO bookings (business_id, customer_id, service_id, starts_at, ends_at, status, price) VALUES ($1,$2,$3, now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'completed', 500)`, [r.id, tc.id, svc0.id]);
  const ins = await fetch(BASE + '/api/insights?days=30', { headers: as(owner) }).then(r => r.json());
  say('Insights top and at-risk lists leave test clients out', ![...(ins.customers?.top || []), ...(ins.customers?.atRisk || [])].some(c => /^test /i.test(c.name || '')));
  // merging a Test lab rehearsal into a real, unnamed client keeps the test name off the real client
  const realC = await one(`INSERT INTO customers (business_id, phone) VALUES ($1, '+34600111222') RETURNING id`, [r.id]);
  await q(`INSERT INTO customers (business_id, phone, name, contact_phone) VALUES ($1, 'test-lab-9-x', 'Test lab', '+34600111222')`, [r.id]);
  const merged = await unify(r.id, realC.id);
  say('Merge never names a real client "Test lab"', merged && merged.name == null, String(merged?.name));
  // Identity: typing another client's email in a chat must not join their record (it would show and cancel their bookings)
  const victim = await one(`INSERT INTO customers (business_id, phone, name, email) VALUES ($1, '+34600333444', 'Victim', 'victim@example.test') RETURNING id`, [r.id]);
  const intruder = await one(`INSERT INTO customers (business_id, phone, email) VALUES ($1, '+34600999888', 'victim@example.test') RETURNING id`, [r.id]);
  const autoU = await unify(r.id, intruder.id);
  say('A typed email never merges two clients automatically', autoU?.id === intruder.id && !!(await one('SELECT 1 FROM customers WHERE id=$1', [victim.id])));
  const tgI = await one(`INSERT INTO customers (business_id, phone, contact_phone) VALUES ($1, 'tg-555', '+34600333444') RETURNING id`, [r.id]);
  say('A typed phone (Telegram, WeBook) never merges automatically', (await unify(r.id, tgI.id))?.id === tgI.id);
  // The owner's merge button still joins them, and nothing linked to the merged record is lost (memberships, payments, waitlist)
  const ms = await one(`INSERT INTO memberships (business_id, customer_id, plan, price) VALUES ($1,$2,'Monthly',30) RETURNING id`, [r.id, intruder.id]);
  await q(`INSERT INTO membership_payments (membership_id, business_id, amount) VALUES ($1,$2,30)`, [ms.id, r.id]);
  await q(`INSERT INTO waitlist (business_id, customer_id) VALUES ($1,$2)`, [r.id, intruder.id]);
  const manU = await unify(r.id, intruder.id, { manual: true });
  const kept = await one(`SELECT (SELECT count(*)::int FROM memberships WHERE customer_id=$1) AS m, (SELECT count(*)::int FROM membership_payments WHERE membership_id=$2) AS p,
      (SELECT count(*)::int FROM waitlist WHERE customer_id=$1) AS w`, [manU?.id, ms.id]);
  say('Owner merge joins by email and keeps memberships, payments and waitlist', manU?.id === victim.id && kept.m === 1 && kept.p === 1 && kept.w === 1, JSON.stringify(kept));
  // WeBook: a phone number typed into the app opens a new record, never the existing client's bookings or chat
  const wb = await fetch(BASE + '/api/webook/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business_id: r.id, name: 'Someone', phone: '+34600333444' }) }).then(r => r.json());
  const wbMine = await fetch(BASE + '/api/webook/my-bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokens: [wb.token] }) }).then(r => r.json());
  await q(`INSERT INTO bookings (business_id, customer_id, service_id, starts_at, ends_at) SELECT $1, $2, id, now() + interval '2 days', now() + interval '2 days 1 hour' FROM services WHERE business_id=$1 LIMIT 1`, [r.id, victim.id]);
  const wbAfter = await fetch(BASE + '/api/webook/my-bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokens: [wb.token] }) }).then(r => r.json());
  say('WeBook: typing a client\'s phone shows none of their bookings', !!wb.token && wb.name === 'Someone' && Array.isArray(wbMine) && wbAfter.length === 0, `${wbAfter.length} shown`);
  // upload a 1x1 PNG as the logo
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  let x = await fetch(BASE + '/api/business/upload/logo', { method: 'POST', headers: { ...as(owner), 'Content-Type': 'image/png' }, body: png }).then(r => r.json());
  say('Owner can upload a logo', !!x.url, x.url || x.error);
  const m = await fetch(BASE + x.url); say('Logo is served publicly', m.status === 200 && m.headers.get('content-type').includes('png'));
  x = await fetch(BASE + '/api/business/upload/logo', { method: 'POST', headers: { ...as(owner), 'Content-Type': 'text/html' }, body: '<script>' });
  say('Non-image upload refused', x.status === 400);
  // Staff are denied by default: a calendar-only login can't make API keys, read the AI team or run platform jobs
  const st = await one(`INSERT INTO users (email, name, password_hash, business_id, role, permissions) VALUES ($1,'Staff','x',$2,'staff','["calendar"]') RETURNING id, session_version`, [`staff-${Date.now()}@example.test`, r.id]);
  const sCal = await fetch(BASE + '/api/calendar', { headers: as(st) }), sMe = await fetch(BASE + '/api/me', { headers: as(st) });
  const sKey = await fetch(BASE + '/api/integration-keys', { method: 'POST', headers: { ...as(st), 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
  const sTeam = await fetch(BASE + '/api/team', { headers: as(st) }), sCust = await fetch(BASE + '/api/customers', { headers: as(st) });
  say('Staff see their own section and nothing unlisted', sCal.status !== 403 && sMe.status === 200 && sKey.status === 403 && sTeam.status === 403 && sCust.status === 403,
    [sCal, sMe, sKey, sTeam, sCust].map(x => x.status).join(','));
  const oRun = await fetch(BASE + '/api/reminders/run', { method: 'POST', headers: as(owner) }), oDemo = await fetch(BASE + '/api/webook-demo/remove', { method: 'POST', headers: as(owner) });
  say('Owners can\'t run platform-wide jobs (reminders for all, remove demo businesses)', oRun.status === 403 && oDemo.status === 403, `${oRun.status},${oDemo.status}`);
  // Settings: the assistant name is never markup; an owner can't point the business at another WhatsApp number
  const bz = await fetch(BASE + '/api/business', { headers: as(owner) }).then(r => r.json());
  const put = await fetch(BASE + '/api/business', { method: 'PUT', headers: { ...as(owner), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...bz, assistant_name: 'Nour<img src=x onerror=alert(1)>', wa_phone_number_id: '999000111' }) });
  const bz2 = await one('SELECT assistant_name, wa_phone_number_id FROM businesses WHERE id=$1', [r.id]);
  say('Assistant name saved without markup; owner can\'t set the WhatsApp number id', put.status === 200 && !/[<>]/.test(bz2.assistant_name) && bz2.wa_phone_number_id !== '999000111', `${put.status} ${bz2.assistant_name} ${bz2.wa_phone_number_id}`);
  // Instagram: an account id already connected to another business is refused
  const other = await one(`SELECT id FROM businesses WHERE id<>$1 ORDER BY id LIMIT 1`, [r.id]);
  await q(`INSERT INTO integrations (business_id, provider, config, status) VALUES ($1,'instagram','{"ig_user_id":"17841400000001"}','saved') ON CONFLICT DO NOTHING`, [other.id]);
  const igPut = await fetch(BASE + '/api/integrations/instagram', { method: 'PUT', headers: { ...as(owner), 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: 'tok', ig_user_id: '17841400000001', app_secret: 'sec' }) });
  await q(`DELETE FROM integrations WHERE business_id=$1 AND provider='instagram' AND config->>'ig_user_id'='17841400000001'`, [other.id]);
  say('An Instagram account connected to another business is refused', igPut.status === 409, String(igPut.status));
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
  // Time zones: each business books on its own clock, not the server's (the server runs on Beirut time)
  const week = h => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, [h]]));
  const zoneBiz = tz => ({ timezone: tz, hours: week(['10:00', '20:00']), slot_step: 30, capacity: 1, services: [] });
  const first = (tz, now) => freeSlots(zoneBiz(tz), [], [], 60, 1, new Date(now))[0]?.id;
  say('Madrid salon opening at 10:00 offers 10:00 Madrid time first', first('Europe/Madrid', '2026-12-01T05:00:00Z') === '2026-12-01T09:00:00.000Z', first('Europe/Madrid', '2026-12-01T05:00:00Z'));
  say('Beirut salon opening at 10:00 offers 10:00 Beirut time first', first('Asia/Beirut', '2026-12-01T05:00:00Z') === '2026-12-01T08:00:00.000Z', first('Asia/Beirut', '2026-12-01T05:00:00Z'));
  say('On the night Spain changes its clocks, 10:00 is still 10:00', first('Europe/Madrid', '2027-03-28T00:30:00Z') === '2027-03-28T08:00:00.000Z', first('Europe/Madrid', '2027-03-28T00:30:00Z'));
  say('A typed 10:30 means 10:30 in the business\'s zone', parseLocal('2026-12-01 10:30', 'Europe/Madrid').toISOString() === '2026-12-01T09:30:00.000Z'
    && inZone('Europe/Madrid', () => parseLocal('2026-12-01T10:30')).toISOString() === '2026-12-01T09:30:00.000Z');
  const av = availability(zoneBiz('Europe/Madrid'), [], [], 1, new Date('2026-12-01T22:30:00Z')); // 23:30 in Madrid, 00:30 next day in Beirut
  say('Availability lists the business\'s own date', av[0]?.date === '2026-12-01', av[0]?.date);
  // SQL on a business's clock: dates come out in that business's zone
  const sqlDay = await inZone('Europe/Madrid', () => one(`SELECT to_char('2026-12-01T23:30:00Z'::timestamptz, 'YYYY-MM-DD HH24:MI') AS t`));
  say('Database dates follow the business\'s zone', sqlDay.t === '2026-12-02 00:30', sqlDay.t);
  // Receptionist: only real cancel words start a cancellation (Arabic words that merely contain the letters don't)
  const notCancel = ['بدي احجز بعد الغداء', 'هل عندكم خدمة للبالغ', "don't cancel it please", 'no quiero cancelar'], isCancel = ['بدي ألغي موعدي', 'الغي الحجز', 'Please cancel my booking', 'quiero cancelar mi cita', 'إلغاء'];
  const wrongC = [...notCancel.filter(asksToCancel), ...isCancel.filter(t => !asksToCancel(t))];
  say('Cancel intent only from real cancel words (Arabic, English, Spanish)', !wrongC.length, wrongC.join(' | '));
  say('Client language: Spanish, French, Arabic, English', langOf('Hola, quiero una cita mañana') === 'es' && langOf('Bonjour, je voudrais un rendez-vous') === 'fr' && langOf('مرحبا') === 'ar' && langOf('hi there') === 'en');
  const svcs = { services: [{ id: 1, name: 'Hair Cut' }, { id: 2, name: 'Hair Colouring' }] };
  say('Service names never match on the first word alone', findService(svcs, 'hair coloring') === null && findService(svcs, 'hair') === null && findService(svcs, 'colouring')?.id === 2 && findService(svcs, 'hair cut')?.id === 1);
  // GDPR: a client's data can be downloaded and erased on request; erasure keeps the business's accounts
  const gc = await one(`INSERT INTO customers (business_id, phone, name, email, staff_notes) VALUES ($1,'+34600777888','Gdpr Client','g@example.test','vip') RETURNING id`, [r.id]);
  const gconv = await one(`INSERT INTO conversations (business_id, customer_id, channel) VALUES ($1,$2,'whatsapp') RETURNING id`, [r.id, gc.id]);
  await q(`INSERT INTO messages (conversation_id, role, text) VALUES ($1,'customer','Hola, quiero una cita')`, [gconv.id]);
  const gb = await one(`INSERT INTO bookings (business_id, customer_id, service_id, conversation_id, starts_at, ends_at, price, status)
      SELECT $1, $2, id, $3, now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 40, 'completed' FROM services WHERE business_id=$1 LIMIT 1 RETURNING id`, [r.id, gc.id, gconv.id]);
  const gex = await fetch(BASE + `/api/customers/${gc.id}/export`, { headers: as(owner) }).then(r => r.json());
  say('A client\'s data downloads with their chats and bookings', gex.client?.email === 'g@example.test' && gex.conversations?.[0]?.messages?.[0]?.text === 'Hola, quiero una cita' && gex.bookings?.length === 1);
  const noWord = await fetch(BASE + `/api/customers/${gc.id}/erase`, { method: 'POST', headers: { ...as(owner), 'Content-Type': 'application/json' }, body: '{}' });
  const er = await fetch(BASE + `/api/customers/${gc.id}/erase`, { method: 'POST', headers: { ...as(owner), 'Content-Type': 'application/json' }, body: '{"confirm":"ERASE"}' });
  const erased = await one(`SELECT name, email, staff_notes, (SELECT count(*)::int FROM conversations WHERE customer_id=$1) AS convs,
      (SELECT customer_id FROM bookings WHERE id=$2) AS booking_owner FROM customers WHERE id=$1`, [gc.id, gb.id]);
  say('Erasing a client needs the typed word, deletes their details and chats, keeps the booking', noWord.status === 400 && er.status === 200
    && erased.name === 'Erased client' && !erased.email && !erased.staff_notes && erased.convs === 0 && erased.booking_owner === gc.id, JSON.stringify({ s: [noWord.status, er.status], ...erased }));
  // 2FA: wrong codes lock the login after 6 tries even when each try claims a different address
  const tfa = await one(`INSERT INTO users (email, name, password_hash, business_id, role, totp_enabled, totp_secret) VALUES ($1,'2FA','x',$2,'owner',true,$3) RETURNING id`, [`tfa-${Date.now()}@example.test`, r.id, newTotpSecret()]);
  const tk = signTicket(tfa.id); let last = 0;
  for (let i = 0; i < 7; i++) last = (await fetch(BASE + '/api/login/code', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: BASE, 'cf-connecting-ip': `203.0.113.${i + 1}` }, body: JSON.stringify({ ticket: tk, code: '000000' }) })).status;
  say('2FA guesses from changing addresses are locked out after 6', last === 429, String(last));
  // Dashboard library: a business's template decides its Today; the public gallery lists the same layout
  await q(`UPDATE businesses SET template='gym' WHERE id=$1`, [r.id]);
  const gymBiz = await fetch(BASE + '/api/business', { headers: as(owner) }).then(r => r.json());
  const pubT = await fetch(BASE + '/api/public/templates').then(r => r.json());
  await q(`UPDATE businesses SET template=NULL WHERE id=$1`, [r.id]);
  const plain = await fetch(BASE + '/api/business', { headers: as(owner) }).then(r => r.json());
  say('A gym business gets the gym Today; others the standard one; the gallery shows the same layout',
    Array.isArray(gymBiz.today) && gymBiz.today.includes('renewals') && plain.today === null && pubT.templates?.find(t => t.id === 'gym')?.today?.includes('members'));
  // Incoming messages are written down before WhatsApp is told "received": a restart mid-answer loses nothing
  const msg = { phoneNumberId: 'smoke-none', from: '+34600000001', text: 'Hola', id: 'wamid.smoke' + Date.now() };
  const [inId] = await receive('whatsapp', [msg]);
  await q(`UPDATE inbound SET status='working' WHERE id=$1`, [inId]); // the app stopped while answering it
  const seen = [];
  await resume({ whatsapp: async p => { if (p.id === msg.id) seen.push(p); } });
  const after = await one('SELECT status FROM inbound WHERE id=$1', [inId]);
  say('A message interrupted by a restart is answered on start-up', seen.length === 1 && after.status === 'done', `${seen.length} ${after.status}`);
  const [failId] = await receive('whatsapp', [{ ...msg, id: msg.id + 'b' }]);
  await work(failId, async () => { throw new Error('AI down'); });
  const failed = await one('SELECT status, attempts, error FROM inbound WHERE id=$1', [failId]);
  say('A message whose answer failed is kept for another try', failed.status === 'new' && failed.attempts === 1 && /AI down/.test(failed.error), JSON.stringify(failed));
  await q(`DELETE FROM inbound WHERE id = ANY($1)`, [[inId, failId]]);
  // tap-to-answer choices: 1-3 short ones become WhatsApp buttons, up to 10 a list, otherwise plain text
  const { waBody } = await import('./whatsapp.js'), { cleanOptions } = await import('./brain.js');
  say('3 short choices become WhatsApp buttons', waBody('Pick a time', ['Tomorrow 10:00', 'Tomorrow 12:30', 'Another day']).interactive?.type === 'button');
  say('Up to 10 choices become a WhatsApp list', waBody('Our services', ['Haircut & blow-dry', 'Full colour', 'Balayage', 'Gel manicure', 'Pedicure']).interactive?.type === 'list');
  say('No choices: plain text', waBody('Hello', []).type === 'text');
  say('Choices are cleaned (empty, too long, duplicates removed)', JSON.stringify(cleanOptions(['Yes', ' yes ', '', 'x'.repeat(30), 'No'])) === '["Yes","No"]');
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
} catch (e) {
  say("Smoke test crashed", false, e.message); // a crash is a failure, never a silent pass
} finally {
  await q('DELETE FROM businesses WHERE id=$1', [r.id]).catch(() => {});
  console.log(`\n${ok.filter(Boolean).length} passed, ${ok.filter(c => !c).length} failed`); await pool.end(); process.exit(ok.every(Boolean) ? 0 : 1);
}
