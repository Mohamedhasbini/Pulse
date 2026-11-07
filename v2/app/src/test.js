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
} catch (e) { check('Tests ran', false, e.message); } finally {
  console.log(`\n${results.filter(Boolean).length} passed, ${results.filter(x => !x).length} failed`);
  await pool.end(); process.exit(results.every(Boolean) ? 0 : 1);
}
