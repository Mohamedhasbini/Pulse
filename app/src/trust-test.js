// Trust check: the numbers that raise alarms must match the database and must never count Test lab chats.
// Run: node src/trust-test.js  (inside the app container). Exits 1 on any mismatch, so it can gate a deploy.
import { q, pool } from './db.js';
import { waiting, briefing } from './pulse.js';

let bad = 0;
const check = (name, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got}${ok ? '' : ` (expected ${want})`}`); };
for (const { id, name } of await q('SELECT id, name FROM businesses ORDER BY id')) {
  console.log(`-- ${name} (#${id})`);
  const [real] = await q(`SELECT count(*)::int AS n FROM conversations WHERE business_id=$1 AND needs_attention AND channel<>'test'`, [id]);
  const w = await waiting(id), b = await briefing(id);
  check('chats waiting (badge)', w.chats, real.n);
  check('chats waiting (briefing)', b.items.find(i => i.kind === 'chats') ? +b.items.find(i => i.kind === 'chats').text.match(/\d+/)[0] : 0, real.n);
  const [tq] = await q(`SELECT count(*)::int AS n FROM learning l JOIN conversations c ON c.id=l.conversation_id WHERE l.business_id=$1 AND l.status='open' AND c.channel='test'`, [id]);
  const shown = w.items.filter(i => i.kind === 'question').length;
  const [rq] = await q(`SELECT count(DISTINCT lower(l.question))::int AS n FROM learning l LEFT JOIN conversations c ON c.id=l.conversation_id WHERE l.business_id=$1 AND l.status='open' AND c.channel IS DISTINCT FROM 'test'`, [id]);
  check(`questions to teach (badge, ${tq.n} test ignored)`, shown, Math.min(rq.n, 10));
  const [tn] = await q(`SELECT count(*)::int AS n FROM notifications n JOIN conversations c ON c.id=n.conversation_id WHERE n.business_id=$1 AND c.channel='test' AND n.read_at IS NULL AND n.created_at > now() - interval '1 day'`, [id]);
  check('unread alerts from test chats (24 h)', tn.n, 0);
}
await pool.end();
console.log(bad ? `${bad} mismatch(es)` : 'All alarms match the data.');
process.exit(bad ? 1 : 0);
