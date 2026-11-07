// MXAi v2 tests: the growth engine's safety rules and the doors of the app. Run inside the container:
//   cd v2 && docker compose exec -T app npm test
import { pool, one } from './db.js';
import * as t from './engine/text.js';

const BASE = 'http://localhost:3200', results = [];
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
