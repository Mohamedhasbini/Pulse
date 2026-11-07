// MXAi v2 tests: the growth engine's safety rules and the doors of the app. Run inside the container:
//   cd v2 && docker compose exec -T app npm test
import { pool, one } from './db.js';
import * as t from './engine/text.js';

const BASE = 'http://localhost:3200', results = [];
process.env.NODE_ENV = 'test'; // test mode codes are returned to this process only (the running app never returns them)
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
try {
  check('A name not on the page is never kept', t.onPage('Rami Saad', 'Our team: Rami Saad, Operations Director') && !t.onPage('Omar Haddad', 'Our team: Rami Saad'));
  check('Directories, news and government sites are never leads', ['linkedin.com', 'ae.linkedin.com', 'bayut.com', 'dubai.gov.ae', 'gulfnews.com', 'fresha.com'].every(t.isDirectory) && !t.isDirectory('northwind-fitout.ae'));
  check('"Al Noor Trading L.L.C." and "Noor Trading LLC" are one company', t.nameKey('Al Noor Trading L.L.C.') === t.nameKey('Noor Trading LLC'));
  check('careers@ and noreply@ are never used; info@ is generic', t.emailKind('careers@x.ae') === 'never' && t.emailKind('noreply@x.ae') === 'never' && t.emailKind('info@x.ae') === 'generic' && t.emailKind('rami.saad@x.ae') === 'personal');
  check('Only Latin names get guessed addresses', t.emailGuesses('Dr. Rami Saad', 'x.ae')[0] === 'rami.saad@x.ae' && t.emailGuesses('رامي سعد', 'x.ae').length === 0);
  check('Emails in pages are found, image names are not', JSON.stringify(t.emailsIn('Write to Sales@Northwind.ae. logo@2x.png')) === '["sales@northwind.ae"]');
  check('Website software is detected', t.detectTech('<script src="https://cdn.shopify.com/s.js"></script><a href="https://wa.me/971">').join() === 'Shopify,WhatsApp chat');
  check('pgvector works in the v2 database', +(await one(`SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector AS d`)).d === 1);
  for (const [path, method] of [['/api/eng/clients', 'GET'], ['/api/eng/quality', 'GET'], ['/api/eng/clients', 'POST']]) {
    const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    check(`${method} ${path} refuses anyone not signed in`, r.status === 401, String(r.status));
  }
  check('A wrong admin key is refused', (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"token":"wrong"}' })).status === 401);
  check('The lab page sends visitors who are not signed in to the sign-in page', (await fetch(BASE + '/eng-lab.html', { redirect: 'manual' })).status === 302);
  check('Changes from another site are refused', (await fetch(BASE + '/api/eng/clients', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })).status === 403);
  // ---------------- lead pool ----------------
  const { ingest, withdraw } = await import('./pool/capture.js');
  const { decide } = await import('./pool/rules.js');
  const core = await import('./pool/core.js');
  const { q } = await import('./db.js');
  const stamp = Date.now(), made = [];
  const client = await one(`INSERT INTO eng_clients (name, website, status) VALUES ($1,'https://example.com','ready') RETURNING id`, [`Pool test clinic ${stamp}`]);
  const at = h => new Date(`2026-11-09T${String(h).padStart(2, '0')}:00:00+04:00`); // a Monday in Dubai time
  try {
    const consent = (channel, buyers = [client.id]) => ({ channel, purpose: 'marketing', buyers, text: `I agree that Pool test clinic may contact me by ${channel} about offers.`, method: 'checkbox' });
    const a = await ingest({ clientId: client.id, source: 'form:test', name: 'Layla Test', email: `layla.${stamp}@example.com`, phone: '+971501234567', city: 'Dubai',
      attributes: { age_range: '25-34', gender: 'female', health_condition: 'diabetes', q_skin_goal: 'my diabetes makes my skin dry', budget: 'AED 1,000' },
      interest: { vertical: 'aesthetics', intent: 'Laser hair removal', timing: 'now' }, consents: [consent('whatsapp'), consent('email')], ip: '203.0.113.7', user_agent: 'test', at: new Date(), evidence: { utm: { utm_source: 'test' } } });
    made.push(a.personId);
    check('A new lead is created with its consents', a.created && a.consentIds.length === 2);
    check('The country comes from the phone number', (await one('SELECT country FROM lp_persons WHERE id=$1', [a.personId])).country === 'AE');
    check('Health details are refused, by key and by value', a.rejected.some(r => r.startsWith('health_condition')) && a.rejected.some(r => r.startsWith('q_skin_goal')), a.rejected.join(' | '));
    check('Stated age range and gender are kept with their source', (await q(`SELECT key FROM lp_attributes WHERE person_id=$1 AND source='form:test' AND key IN ('age_range','gender')`, [a.personId])).length === 2);
    const b = await ingest({ clientId: client.id, source: 'meta_lead', name: 'Layla T', phone: '050 123 4567', country: 'AE', consents: [], at: new Date() });
    check('The same person found again by phone is merged, not duplicated', !b.created && b.personId === a.personId);
    const guessed = await ingest({ clientId: client.id, source: 'enrichment', email: `layla.${stamp}@example.com`, attributes: { gender: 'female' } });
    check('Gender is never stored from a guess (only when the person states it)', guessed.rejected.some(r => r.startsWith('gender')));
    const c = await one(`SELECT c.*, t.text_hash FROM lp_consents c JOIN lp_consent_texts t ON t.id=c.text_id WHERE c.id=$1`, [a.consentIds[0]]);
    check('The consent certificate is valid', core.verifyCert(c));
    check('A changed consent record fails its certificate (who it was given to)', !core.verifyCert({ ...c, buyers: [999] }));
    check('A changed consent record fails its certificate (when)', !core.verifyCert({ ...c, captured_at: new Date(Date.now() - 864e5) }));

    const d1 = await decide({ personId: a.personId, channel: 'whatsapp', clientId: client.id, at: at(12) });
    check('UAE: WhatsApp with consent at noon is allowed', d1.allowed, d1.reason);
    const d2 = await decide({ personId: a.personId, channel: 'whatsapp', clientId: client.id, at: at(12) });
    check('UAE: a second marketing message the same day is blocked (1 a day)', !d2.allowed && /daily limit/.test(d2.reason), d2.reason);
    const d3 = await decide({ personId: a.personId, channel: 'whatsapp', clientId: client.id, at: at(22), log: false });
    check('UAE: messages after 18:00 local time are blocked', !d3.allowed && /hours/.test(d3.reason), d3.reason);
    const d4 = await decide({ personId: a.personId, channel: 'sms', clientId: client.id, at: at(12), log: false });
    check('No SMS without SMS consent', !d4.allowed && /no sms consent/.test(d4.reason), d4.reason);
    const d5 = await decide({ personId: a.personId, channel: 'whatsapp', clientId: client.id + 99999, at: at(12), log: false });
    check('Consent for one business does not cover another', !d5.allowed, d5.reason);
    const d6 = await decide({ personId: a.personId, channel: 'whatsapp', purpose: 'service', clientId: client.id, at: at(23), log: false });
    check('A reply to someone who wrote first is always allowed', d6.allowed, d6.reason);

    const us = await ingest({ clientId: client.id, source: 'import', name: 'Sam US', email: `sam.${stamp}@example.com`, country: 'US', consents: [], at: new Date() });
    made.push(us.personId);
    check('USA: no cold email by default', !(await decide({ personId: us.personId, channel: 'email', clientId: client.id, log: false })).allowed);
    await q(`UPDATE lp_country_rules SET cold_allowed=true WHERE country='US'`);
    const coldOn = await decide({ personId: us.personId, channel: 'email', clientId: client.id, log: false });
    await q(`UPDATE lp_country_rules SET cold_allowed=false WHERE country='US'`);
    check('USA: cold email allowed only when the switch is on (opt-out country)', coldOn.allowed && coldOn.requirements.includes('postal_address'), coldOn.reason);
    const ae = await decide({ personId: a.personId, channel: 'email', clientId: client.id + 99999, log: false });
    check('UAE: no cold email even with the switch logic (consent country)', !ae.allowed);

    const de = await ingest({ clientId: client.id, source: 'form:test', name: 'Jonas DE', email: `jonas.${stamp}@example.com`, country: 'DE', consents: [consent('email')], at: new Date() });
    made.push(de.personId);
    check('Germany: email consent waits for the double opt-in click', /double opt-in/.test((await decide({ personId: de.personId, channel: 'email', clientId: client.id, log: false })).reason));
    const tok = (await one('SELECT confirm_token FROM lp_consents WHERE person_id=$1', [de.personId])).confirm_token;
    check('The confirmation link confirms the consent', (await fetch(`${BASE}/c/${tok}`)).ok && (await decide({ personId: de.personId, channel: 'email', clientId: client.id, log: false })).allowed);

    check('Opt-out words are understood (STOP, Arabic, Spanish, French)', ['STOP', 'إلغاء الاشتراك', 'Baja', "Merci de ne plus me contacter", "please don't email me again"].every(core.isOptOut) && !core.isOptOut('stop by the clinic tomorrow?'));
    const routes = await import('./pool/routes.js');
    const u = await fetch(`${BASE}/u/${routes.unsubToken(a.personId)}`, { method: 'POST' });
    const after = await decide({ personId: a.personId, channel: 'whatsapp', clientId: client.id, at: at(12), log: false });
    check('The unsubscribe link withdraws consent and suppresses the person', u.ok && !after.allowed && /suppressed/.test(after.reason), after.reason);
    check('A forged unsubscribe link is refused', (await fetch(`${BASE}/u/${a.personId}.forged`, { method: 'POST' })).status === 400);

    // public form + bot filter
    const login = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: process.env.V2_ADMIN_TOKEN }) });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const H = { 'Content-Type': 'application/json', cookie };
    const form = await (await fetch(`${BASE}/api/pool/forms`, { method: 'POST', headers: H, body: JSON.stringify({ client_id: client.id, title: 'Test consultation', vertical: 'aesthetics', country: 'AE', purpose: 'offers and appointments', channels: ['email', 'whatsapp'] }) })).json();
    check('An admin can create a capture form', !!form.slug, JSON.stringify(form).slice(0, 120));
    const page = await fetch(`${BASE}/f/${form.slug}`);
    const html = await page.text();
    check('The form page names the business in each consent box', page.ok && html.includes('I agree that Pool test clinic') && html.includes('consent_whatsapp'));
    check('The form can be placed inside other websites', !page.headers.get('x-frame-options'));
    const sub = body => fetch(`${BASE}/f/${form.slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const base = { name: 'Nour Form', email: `nour.${stamp}@example.com`, agree_terms: '1', consent_whatsapp: '1', timing: 'now' };
    check('A form without the robot check is refused', (await sub(base)).status === 400);
    const { solveChallenge } = await import('altcha-lib');
    const { deriveKey } = await import('altcha-lib/algorithms/pbkdf2');
    const ch = await (await fetch(`${BASE}/api/altcha`)).json();
    const solution = await solveChallenge({ challenge: ch, deriveKey });
    const ok = await sub({ ...base, phone: '+971509876543', altcha: Buffer.from(JSON.stringify({ challenge: ch, solution })).toString('base64') });
    const nour = await one(`SELECT person_id FROM lp_identities WHERE value=$1`, [`nour.${stamp}@example.com`]);
    if (nour) made.push(nour.person_id);
    check('A real form submission creates the lead with its consent', ok.ok && !!nour, String(ok.status));
    check('A bot filling the hidden field is silently ignored', (await sub({ ...base, email: `bot.${stamp}@example.com`, website: 'spam' })).ok && !(await one(`SELECT 1 FROM lp_identities WHERE value=$1`, [`bot.${stamp}@example.com`])));

    // admin API
    check('The people list refuses anyone not signed in', (await fetch(`${BASE}/api/pool/people`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);
    const list = await (await fetch(`${BASE}/api/pool/people`, { method: 'POST', headers: H, body: JSON.stringify({ filters: { q: `nour.${stamp}` } }) })).json();
    check('The people list finds a lead by search', list.total === 1 && list.rows[0].consent_channels?.includes('whatsapp'), JSON.stringify(list).slice(0, 160));
    const one1 = await (await fetch(`${BASE}/api/pool/people/${nour?.person_id}`, { headers: H })).json();
    check('The person view shows proof and what may be sent now', one1.consents?.every(x => x.certificate_valid) && one1.allowed_now?.whatsapp && one1.rule?.country === 'AE');
    check('The 33 country rules are loaded', (await (await fetch(`${BASE}/api/pool/rules`, { headers: H })).json()).length >= 33);
    check('Meta webhooks without a valid signature are refused', (await fetch(`${BASE}/hooks/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"entry":[]}' })).status === 403);
    check('Google lead webhooks with a wrong key are refused', (await fetch(`${BASE}/hooks/google/${form.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"google_key":"x"}' })).status === 403);
    // ---------------- phase B: real leads, checks, duplicates, upkeep ----------------
    const codes = await import('./pool/codes.js'), checks = await import('./pool/checks.js'), dedupe = await import('./pool/dedupe.js'), jobs = await import('./pool/jobs.js');
    check('Line types are read from the number (mobile, landline, toll-free)', checks.phoneLine('+971501234567') === 'mobile' && checks.phoneLine('+97143334444') === 'fixed_line' && checks.phoneLine('+18005551234') === 'toll_free');
    check('Gmail dots, +tags and googlemail.com are the same mailbox', checks.matchKey('email', 'R.ania.K+promo@googlemail.com') === 'raniak@gmail.com' && checks.matchKey('email', 'r.k+x@outlook.com') === 'r.k@outlook.com');
    const land = await ingest({ clientId: client.id, source: 'form:test', name: 'Landline Test', phone: '+97143334444', consents: [consent('whatsapp')], at: new Date() });
    made.push(land.personId);
    const dl = await decide({ personId: land.personId, channel: 'whatsapp', clientId: client.id, at: at(12), log: false });
    check('WhatsApp to a landline is blocked even with consent', !dl.allowed && /fixed line/.test(dl.reason), dl.reason);
    let landCode = null; try { await codes.sendCode(land.personId, 'whatsapp'); } catch (e) { landCode = e.message; }
    check('No code is sent to a landline', /not a mobile/.test(landCode || ''), landCode);

    const v = await ingest({ clientId: client.id, source: 'form:test', name: 'Verify Test', phone: '+971507771234', consents: [consent('whatsapp')], at: new Date() });
    made.push(v.personId);
    const s1 = await codes.sendCode(v.personId, 'whatsapp');
    check('A code is sent (test mode when no provider is set up)', s1.sent && s1.provider === 'dev' && /^\d{6}$/.test(s1.code), JSON.stringify(s1));
    const wrong = await codes.checkCode(v.personId, s1.code === '000000' ? '111111' : '000000');
    check('A wrong code is refused', !wrong.ok);
    const right = await codes.checkCode(v.personId, s1.code);
    const vid = await one(`SELECT verified_at, verified_via FROM lp_identities WHERE person_id=$1 AND kind='phone'`, [v.personId]);
    check('The right code confirms the number', right.ok && !!vid.verified_at && vid.verified_via === 'whatsapp');
    check('A used code cannot be used again', !(await codes.checkCode(v.personId, s1.code)).ok);
    const v2 = await ingest({ clientId: client.id, source: 'form:test', name: 'Limit Test', phone: '+971507775678', at: new Date() });
    made.push(v2.personId);
    for (let i = 0; i < 3; i++) await codes.sendCode(v2.personId, 'sms');
    let lim = null; try { await codes.sendCode(v2.personId, 'sms'); } catch (e) { lim = e.status; }
    check('At most 3 codes an hour per number', lim === 429);
    const last = (await codes.sendCode(v2.personId, 'sms').catch(() => null));
    check('Codes are stored only as a hash', !(await one(`SELECT 1 FROM lp_codes WHERE person_id=$1 AND code_hash ~ '^[0-9]{6}$'`, [v2.personId])) && last === null);
    let tries = 0; await q(`UPDATE lp_codes SET attempts=5 WHERE person_id=$1`, [v2.personId]);
    const locked = await codes.checkCode(v2.personId, '123456'); tries = locked.error;
    check('After 5 wrong tries the code is locked', !locked.ok && /Too many/.test(tries), tries);

    // the public form asks for the code right after sending
    const ch2 = await (await fetch(`${BASE}/api/altcha`)).json();
    const sol2 = await solveChallenge({ challenge: ch2, deriveKey });
    const fv = await (await sub({ ...base, name: 'Omar Verify', email: `omar.${stamp}@example.com`, phone: '+971508881234', altcha: Buffer.from(JSON.stringify({ challenge: ch2, solution: sol2 })).toString('base64') })).json();
    const omar = await one(`SELECT person_id FROM lp_identities WHERE value=$1`, [`omar.${stamp}@example.com`]);
    if (omar) made.push(omar.person_id);
    check('After the form, the person is offered a code for their mobile', !!fv.verify?.token && fv.verify.ending === '234', JSON.stringify(fv).slice(0, 160));
    const vs = await fetch(`${BASE}/v/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: fv.verify?.token, channel: 'whatsapp' }) });
    const vsj = await vs.json();
    check('The form page can send the code, and the code is never sent back to the browser', vs.ok && !('code' in vsj), JSON.stringify(vsj));
    check('A wrong code from the form page is refused', (await fetch(`${BASE}/v/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: fv.verify?.token, code: '000001' }) })).status === 400);
    check('A forged code token is refused', (await fetch(`${BASE}/v/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: `${omar?.person_id}.${Date.now()}.forged` }) })).status === 400);

    // duplicates
    const r1 = await ingest({ clientId: client.id, source: 'form:test', name: 'Rania Khoury', email: `rania.khoury.${stamp}@gmail.com`, country: 'AE', city: 'Dubai', consents: [consent('email')], at: new Date() });
    const r2 = await ingest({ clientId: client.id, source: 'meta_lead', name: 'Rania K', email: `ra.nia.khoury.${stamp}+promo@googlemail.com`, country: 'AE', attributes: { budget: 'AED 5,000' }, at: new Date() });
    made.push(r1.personId, r2.personId);
    check('Two spellings of the same mailbox start as two people', r1.personId !== r2.personId);
    const k1 = await ingest({ clientId: client.id, source: 'form:test', name: 'Karim Nasser', phone: '+971501112233', country: 'AE', city: 'Dubai', at: new Date() });
    const k2 = await ingest({ clientId: client.id, source: 'chat', name: 'Kareem Nasser', phone: '+971551112233', country: 'AE', city: 'Dubai', at: new Date() });
    made.push(k1.personId, k2.personId);
    const up = await jobs.upkeep({ emails: false });
    const rLeft = await one(`SELECT count(*)::int AS n FROM lp_persons WHERE id = ANY($1)`, [[r1.personId, r2.personId]]);
    check('Daily upkeep merges the same mailbox automatically', rLeft.n === 1 && up.merged >= 1, JSON.stringify(up));
    const moved = await q(`SELECT c.*, t.text_hash FROM lp_consents c JOIN lp_consent_texts t ON t.id=c.text_id WHERE c.person_id=$1`, [r1.personId]);
    check('Consent certificates stay valid after a merge', moved.length >= 1 && moved.every(core.verifyCert));
    check('Details from both records are kept after a merge', !!(await one(`SELECT 1 FROM lp_attributes WHERE person_id=$1 AND key='budget'`, [r1.personId])));
    const cand = await one(`SELECT * FROM lp_merge_candidates WHERE ((a=$1 AND b=$2) OR (a=$2 AND b=$1)) AND status='open'`, [k1.personId, k2.personId]);
    check('Similar names with the same phone ending are listed for review, not merged', !!cand && cand.reasons.includes('phone ends the same'), JSON.stringify(cand?.reasons));
    const dm = await fetch(`${BASE}/api/pool/duplicates/${cand?.id}/merge`, { method: 'POST', headers: H, body: JSON.stringify({ keep: k1.personId }) });
    check('An admin can merge a listed pair', dm.ok && !(await one('SELECT 1 FROM lp_persons WHERE id=$1', [k2.personId])) && (await q(`SELECT 1 FROM lp_identities WHERE person_id=$1 AND kind='phone'`, [k1.personId])).length === 2);

    // consent expiry
    await q(`UPDATE lp_consents SET expires_at = now() - interval '1 day' WHERE person_id=$1 AND purpose='marketing'`, [v.personId]);
    const up2 = await jobs.upkeep({ emails: false });
    const expired = await one(`SELECT withdrawn_how FROM lp_consents WHERE person_id=$1 AND purpose='marketing' LIMIT 1`, [v.personId]);
    check('Daily upkeep ends consents past their end date', expired.withdrawn_how === 'expired' && up2.consents_expired >= 1, JSON.stringify(up2));
    check('Each upkeep run is recorded', !!(await one(`SELECT 1 FROM lp_job_runs WHERE finished_at IS NOT NULL AND error IS NULL ORDER BY id DESC LIMIT 1`)));
    check('The upkeep screen API refuses anyone not signed in', (await fetch(`${BASE}/api/pool/upkeep/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);

    await q('DELETE FROM lp_forms WHERE id=$1', [form.id]);
  } finally {
    await q('DELETE FROM lp_suppressions WHERE value_hash IN (SELECT value_hash FROM lp_identities WHERE person_id = ANY($1))', [made]).catch(() => {});
    await q('DELETE FROM lp_persons WHERE id = ANY($1)', [made]).catch(() => {});
    await q('DELETE FROM eng_clients WHERE id=$1', [client.id]).catch(() => {});
  }
} catch (e) { check('Tests ran', false, e.message); } finally {
  console.log(`\n${results.filter(Boolean).length} passed, ${results.filter(x => !x).length} failed`);
  await pool.end(); process.exit(results.every(Boolean) ? 0 : 1);
}
