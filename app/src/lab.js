// The AI that learns: lessons it suggests from its own chats, versions with a quality score, and the Test lab.
// Lessons come from the business's own data (no AI calls): questions it couldn't answer more than once,
// topics customers rate low, and why it handed chats over. Nothing changes until the owner approves.
// Test lab scenarios are scripted customers; a run sends their lines through the real receptionist on the
// test channel and checks the replies with plain rules, so a run costs one AI call per line and only when asked.
import { q, one } from './db.js';
import { handleMessage } from './brain.js';
import { addRule } from './rules.js';

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const STARTERS = [
  { name: 'Book an appointment', goal: 'book', mood: 'neutral', language: 'English', lines: ['Hi, I would like to book an appointment', 'The first one is fine', 'Tomorrow', 'The first time is fine', 'Yes please'] },
  { name: 'Ask the price', goal: 'answer', mood: 'neutral', language: 'English', lines: ['How much is your most popular service?'] },
  { name: 'Upset about waiting', goal: 'calm', mood: 'negative', language: 'English', lines: ['I waited 20 minutes last time, this is not okay.'] },
  { name: 'Wants a person', goal: 'handoff', mood: 'neutral', language: 'English', lines: ['Can I talk to a real person please?'] },
  { name: 'Question in Arabic', goal: 'answer', mood: 'neutral', language: 'Arabic', lines: ['شو ساعات الدوام عندكم؟'] },
  { name: 'Not in your info', goal: 'honest', mood: 'neutral', language: 'English', lines: ['Do you offer gift cards for a wedding party of 12?'] },
];
const APOLOGY = /sorry|apolog|عذر|آسف|نعتذر|pardon/i, PERSON = /team|staff|person|colleague|owner|someone will|reply soon|get back|فريق|حدا|زميل/i;
const UNSURE = /not sure|don't know|do not know|let me check|i'll ask|will ask|check with|ما بعرف|رح اسأل/i;

// rule checks per goal; each is [label, passed]
function judge(goal, mood, turns) {
  const ai = turns.filter(t => t.role === 'ai'), last = ai[ai.length - 1] || {}, all = ai.map(t => t.text).join('\n');
  const checks = [['Replied every time', ai.length && ai.every(t => t.text && t.source !== 'fallback' && !t.queued)],
    ['Replied in under 8 seconds', ai.length && ai.every(t => t.ms < 8000)]];
  if (goal === 'book') checks.push(['Booked the appointment', turns.some(t => t.booked)]);
  if (goal === 'answer') checks.push(['Answered without handing over', !turns.some(t => t.handoff)]);
  if (goal === 'calm' || mood === 'negative') checks.push(['Apologised', APOLOGY.test(all)]);
  if (goal === 'calm') checks.push(['Offered a next step', /\?|book|offer|discount|time|slot|موعد/i.test(last.text || '')]);
  if (goal === 'handoff') checks.push(['Passed it to you', turns.some(t => t.handoff) || PERSON.test(all)]);
  if (goal === 'honest') checks.push(['Didn’t make something up', turns.some(t => t.handoff) || UNSURE.test(all) || PERSON.test(all)]);
  return checks.map(([label, ok]) => ({ label, ok: !!ok }));
}
async function run(biz, s) {
  const phone = `test-lab-${s.id}-${Date.now().toString(36)}`, turns = [];
  for (const line of s.lines) {
    turns.push({ role: 'customer', text: line });
    const t0 = Date.now(), r = await handleMessage({ businessId: biz, phone, name: 'Test lab', text: line, channel: 'test' });
    const m = r.conversationId && await one(`SELECT source FROM messages WHERE conversation_id=$1 AND role='assistant' ORDER BY id DESC LIMIT 1`, [r.conversationId]);
    const c = r.conversationId && await one('SELECT outcome, needs_attention FROM conversations WHERE id=$1', [r.conversationId]);
    turns.push({ role: 'ai', text: r.reply || '', ms: Date.now() - t0, source: m?.source, booked: c?.outcome === 'booked', handoff: !!c?.needs_attention,
      // a holding message (the AI was busy and queued it) is not a real answer
      queued: !!r.queued || r.reply == null || !!(r.conversationId && await one(`SELECT 1 FROM ai_queue WHERE conversation_id=$1 AND status='waiting'`, [r.conversationId])) });
    if (r.queued) break;
  }
  const checks = judge(s.goal, s.mood, turns), score = Math.round(checks.filter(c => c.ok).length / checks.length * 100);
  // the test conversation is only a test: keep it out of Needs you
  await q(`UPDATE conversations SET needs_attention=false WHERE business_id=$1 AND customer_id IN (SELECT id FROM customers WHERE business_id=$1 AND phone=$2)`, [biz, phone]);
  const ver = await one('SELECT id FROM ai_versions WHERE business_id=$1 ORDER BY id DESC LIMIT 1', [biz]);
  const r = await one('INSERT INTO test_runs (business_id, scenario_id, version_id, transcript, checks, score) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at',
    [biz, s.id, ver?.id || null, JSON.stringify(turns), JSON.stringify(checks), score]);
  return { id: r.id, scenario: s.id, name: s.name, turns, checks, score };
}
const scenarioRow = r => ({ ...r, lines: JSON.parse(r.opening || '[]') });

// lessons worked out from the business's own chats, minus the ones already approved or dismissed
export async function lessonSuggestions(B) {
    const [gaps, low, reasons, decided] = await Promise.all([
    q(`SELECT lower(question) AS k, min(question) AS question, count(*)::int AS n FROM learning WHERE business_id=$1 AND status='open' GROUP BY 1 HAVING count(*) >= 2 ORDER BY 3 DESC LIMIT 5`, [B]),
    q(`SELECT initcap(topic) AS topic, round(avg(rating),1)::float AS r, count(*)::int AS n FROM conversations WHERE business_id=$1 AND rating IS NOT NULL AND topic IS NOT NULL
        AND created_at > now() - interval '60 days' GROUP BY 1 HAVING avg(rating) < 4 AND count(*) >= 2 ORDER BY 2 LIMIT 3`, [B]),
    q(`SELECT attention_reason AS reason, count(*)::int AS n FROM conversations WHERE business_id=$1 AND attention_reason IS NOT NULL AND created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 3`, [B]),
    q(`SELECT title FROM ai_lessons WHERE business_id=$1 AND status IN ('approved','dismissed')`, [B])]);
  const done = new Set(decided.map(d => d.title)), out = [];
  gaps.forEach(g => out.push({ kind: 'answer', title: `Answer “${g.question}”`, body: g.question, evidence: `asked ${g.n} times, the AI couldn't answer` }));
  low.forEach(t => out.push({ kind: 'rule', title: `Handle “${t.topic}” with more care`, body: `When a customer writes about ${t.topic.toLowerCase()}, apologise first if something went wrong, explain clearly, and offer a concrete next step.`, evidence: `rated ${t.r} over ${t.n} chats` }));
  reasons.filter(r => /know|answer/i.test(r.reason)).forEach(r => out.push({ kind: 'rule', title: 'Say when you need to check', body: 'If you are not sure of an answer, say you will check with the team instead of guessing, and hand the chat over.', evidence: `${r.n} handovers in 30 days` }));
  return out.filter(l => !done.has(l.title));
}

export function mountLab(app, BIZ) {
  // lessons worked out from the business's own chats
  app.get('/api/lessons', wrap(async (_req, res) => res.json(await lessonSuggestions(BIZ()))));
  // approve a rule lesson: it becomes a strict rule and a new version is saved. Answer lessons go through Knowledge gaps
  app.post('/api/lessons', wrap(async (req, res) => {
    const B = BIZ(), title = String(req.body.title || '').slice(0, 200), body = String(req.body.body || '').slice(0, 400), approve = req.body.action !== 'dismiss';
    if (!title) return res.status(400).json({ error: 'Missing lesson.' });
    await q('INSERT INTO ai_lessons (business_id, title, body, source, status, decided_at) VALUES ($1,$2,$3,$4,$5,now())', [B, title, body, req.body.kind || 'rule', approve ? 'approved' : 'dismissed']);
    const r = approve && req.body.kind === 'rule' ? await addRule(B, body, title) : null;
    res.json({ ok: true, ...(r && !r.added && { note: r.reason === 'full' ? 'Rules are full (40). Remove one in Teach AI to add this.' : 'The receptionist already follows this rule.' }) });
  }));
  // versions, each with the average score of the test runs made on it
  app.get('/api/versions', wrap(async (_req, res) => {
    res.json(await q(`SELECT v.id, v.note, ${"to_char(v.created_at,'Mon DD')"} AS at, (SELECT round(avg(score))::int FROM test_runs t WHERE t.version_id=v.id) AS score
        FROM ai_versions v WHERE v.business_id=$1 ORDER BY v.id DESC LIMIT 12`, [BIZ()]));
  }));

  // Test lab
  app.get('/api/tests', wrap(async (_req, res) => {
    const B = BIZ();
    if (!(await one('SELECT 1 FROM test_scenarios WHERE business_id=$1 LIMIT 1', [B])))
      for (const s of STARTERS) await q('INSERT INTO test_scenarios (business_id, name, goal, mood, language, opening) VALUES ($1,$2,$3,$4,$5,$6)', [B, s.name, s.goal, s.mood, s.language, JSON.stringify(s.lines)]);
    const rows = await q(`SELECT s.*, r.score, r.checks, r.transcript, ${"to_char(r.created_at,'Mon DD HH24:MI')"} AS ran FROM test_scenarios s
        LEFT JOIN LATERAL (SELECT * FROM test_runs t WHERE t.scenario_id=s.id ORDER BY id DESC LIMIT 1) r ON true WHERE s.business_id=$1 ORDER BY s.id`, [B]);
    const runs = await q(`SELECT ${"to_char(min(created_at),'Mon DD HH24:MI')"} AS at, version_id, count(*)::int AS n, count(*) FILTER (WHERE score=100)::int AS passed, round(avg(score))::int AS score
        FROM test_runs WHERE business_id=$1 GROUP BY date_trunc('minute', created_at), version_id ORDER BY min(created_at) DESC LIMIT 8`, [B]);
    res.json({ scenarios: rows.map(scenarioRow), runs });
  }));
  app.post('/api/tests', wrap(async (req, res) => {
    const lines = (Array.isArray(req.body.lines) ? req.body.lines : String(req.body.lines || '').split('\n')).map(l => String(l).trim()).filter(Boolean).slice(0, 6);
    if (!req.body.name || !lines.length) return res.status(400).json({ error: 'Give the test a name and at least one customer message.' });
    const goal = ['book', 'answer', 'calm', 'handoff', 'honest'].includes(req.body.goal) ? req.body.goal : 'answer';
    res.json(await one('INSERT INTO test_scenarios (business_id, name, goal, mood, language, opening) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [BIZ(), String(req.body.name).slice(0, 80), goal, req.body.mood === 'negative' ? 'negative' : 'neutral', String(req.body.language || 'English').slice(0, 20), JSON.stringify(lines)]));
  }));
  // a real chat becomes a test, so a mistake the AI made once is checked from now on
  app.post('/api/tests/from-conversation/:id', wrap(async (req, res) => {
    const c = await one('SELECT id, kind FROM conversations WHERE id=$1 AND business_id=$2', [req.params.id, BIZ()]);
    if (!c) return res.sendStatus(404);
    const lines = (await q(`SELECT text FROM messages WHERE conversation_id=$1 AND role='customer' ORDER BY id LIMIT 6`, [c.id])).map(m => m.text);
    const goal = { booking: 'book', complaint: 'calm', question: 'answer' }[c.kind] || 'answer';
    res.json(await one('INSERT INTO test_scenarios (business_id, name, goal, mood, opening) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [BIZ(), `From chat #${c.id}`, goal, c.kind === 'complaint' ? 'negative' : 'neutral', JSON.stringify(lines)]));
  }));
  app.delete('/api/tests/:id', wrap(async (req, res) => { await q('DELETE FROM test_scenarios WHERE id=$1 AND business_id=$2', [req.params.id, BIZ()]); res.json({ ok: true }); }));
  // run one scenario, or all of them one after another
  app.post('/api/tests/run', wrap(async (req, res) => {
    const B = BIZ(), all = (await q('SELECT * FROM test_scenarios WHERE business_id=$1 ORDER BY id', [B])).map(scenarioRow);
    const list = req.body.id ? all.filter(s => s.id === +req.body.id) : all.slice(0, 12);
    const results = [];
    for (const s of list) results.push(await run(B, s));
    res.json(results);
  }));
}
