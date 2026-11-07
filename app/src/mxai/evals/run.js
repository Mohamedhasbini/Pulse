// Runs the golden cases (evals/cases.js) through the MXAi orchestrator and prints a pass/fail table.
//
//   docker compose exec app node src/mxai/evals/run.js <businessId> [options]
//     --allow-real        also run against a business that is not a demo (is_demo = false). Off by default.
//     --layer=<name>      only the cases of one layer (persona, knowledge, tools, access, guardrails, router)
//     --only=<text>       only cases whose name contains this text
//     --audience=<a>      only customer or only owner cases
//     --threshold=<0..1>  minimum pass rate (default 0.85); below it the process exits with 1
//     --dry               list the cases without running anything (no database, no AI)
//     --verbose           print every reply
//
// Safety (why each rule exists):
// - Customers are always channel 'test' with phones starting "test-eval-", so dashboards and metrics (which exclude
//   test chats) never count them, no real client is ever messaged, and they are easy to find and remove later.
// - A business that is not a demo is refused unless --allow-real is given: evals create test chats and bookings.
// - Cases run one at a time, so free AI providers are not flooded.
import { cases as ALL } from './cases.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const has = k => args.includes(`--${k}`);
const businessId = Number(args.find(a => /^\d+$/.test(a)));
const threshold = Number(opt('threshold', '0.85'));
const CASE_TIMEOUT = 90_000;

const selected = ALL.filter(c => (!opt('layer') || c.layer === opt('layer'))
  && (!opt('only') || c.name.toLowerCase().includes(opt('only').toLowerCase()))
  && (!opt('audience') || (opt('audience') === 'customer' ? c.audience === 'customer' : c.audience !== 'customer')));

if (has('dry')) {
  for (const c of selected) console.log(`${c.layer.padEnd(11)} ${c.audience.padEnd(9)} ${c.name}`);
  console.log(`\n${selected.length} cases`);
  process.exit(0);
}
if (!Number.isInteger(businessId) || businessId <= 0) {
  console.error('Usage: node src/mxai/evals/run.js <businessId> [--allow-real] [--layer=..] [--only=..] [--threshold=0.85] [--dry] [--verbose]');
  process.exit(2);
}

const { one, pool } = await import('../../db.js');
let exitCode = 0;
try {
  exitCode = await main();
} catch (e) {
  console.error('Eval run crashed:', e?.stack || e);
  exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
process.exit(exitCode);

async function main() {
  const biz = await one('SELECT id, name, is_demo FROM businesses WHERE id=$1', [businessId]);
  if (!biz) { console.error(`No business with id ${businessId}.`); return 2; }
  if (!biz.is_demo && !has('allow-real')) {
    console.error(`Refusing to run: "${biz.name}" (id ${biz.id}) is not a demo business. Evals create test chats there.\n`
      + 'Use a demo business, or pass --allow-real if you are sure.');
    return 2;
  }

  let orch;
  try { orch = await import('../index.js'); } catch (e) {
    console.error('Could not load the orchestrator (app/src/mxai/index.js):', e.message); return 1;
  }
  if (typeof orch.handleCustomer !== 'function' || typeof orch.askMxai !== 'function') {
    console.error('index.js must export handleCustomer and askMxai.'); return 1;
  }

  // Owner facts, so cases can check that numbers in MXAi's answers are the dashboard's numbers (read only).
  let ownerFacts = null;
  try {
    const [{ ownerFacts: of }, { loadBusiness }] = await Promise.all([import('../knowledge.js'), import('../../brain.js')]);
    ownerFacts = await of(await loadBusiness(businessId));
  } catch (e) { console.warn('Owner facts not available; number checks will be skipped:', e.message); }

  // The real owner account of this business, read only, so access rules see a proper owner.
  const owner = await one(`SELECT id, email, name, role, business_id FROM users WHERE business_id=$1 AND role='owner' ORDER BY id LIMIT 1`, [businessId]).catch(() => null)
    || { id: null, role: 'owner', business_id: businessId, name: 'Eval owner', eval: true };

  console.log(`MXAi evals on "${biz.name}" (id ${biz.id}${biz.is_demo ? ', demo' : ', REAL'}): ${selected.length} cases\n`);
  const run = Date.now().toString(36);
  const rows = [];
  for (const [i, c] of selected.entries()) {
    const t0 = Date.now();
    let row;
    try {
      const r = await withTimeout(runCase(orch, c, i, run, owner), CASE_TIMEOUT);
      row = { c, ...grade(c, normalise(r), { facts: ownerFacts }), ms: Date.now() - t0, reply: normalise(r).reply };
    } catch (e) {
      row = { c, ok: false, why: 'crashed: ' + (e?.message || e), ms: Date.now() - t0, reply: '' };
    }
    rows.push(row);
    console.log(`${row.ok ? 'PASS' : row.skipped ? 'SKIP' : 'FAIL'}  ${c.layer.padEnd(10)} ${c.name.padEnd(46).slice(0, 46)} ${String(row.ms).padStart(6)} ms  ${row.ok ? '' : row.why}`);
    if (has('verbose') || !row.ok) console.log('      reply: ' + String(row.reply || '').replace(/\s+/g, ' ').slice(0, 220));
  }

  const graded = rows.filter(r => !r.skipped), passed = graded.filter(r => r.ok).length;
  const rate = graded.length ? passed / graded.length : 0;
  console.log('\nBy layer:');
  for (const layer of [...new Set(graded.map(r => r.c.layer))]) {
    const g = graded.filter(r => r.c.layer === layer);
    console.log(`  ${layer.padEnd(11)} ${g.filter(r => r.ok).length}/${g.length}`);
  }
  console.log(`\nPass rate: ${passed}/${graded.length} = ${(rate * 100).toFixed(1)}% (threshold ${(threshold * 100).toFixed(0)}%)`
    + (rows.length - graded.length ? `, ${rows.length - graded.length} skipped` : ''));
  console.log(`Test chats were created with phones "test-eval-${run}-*" (channel test).`);
  return rate >= threshold ? 0 : 1;
}

// One case: earlier messages first (same phone, so the same chat), then the message under test.
async function runCase(orch, c, i, run, owner) {
  const history = (c.history || []).map(h => typeof h === 'string' ? { role: 'user', content: h } : h);
  if (c.audience === 'customer') {
    const phone = `test-eval-${run}-${i}`;   // always a test phone: never a real client's number
    const base = { businessId, phone, name: 'Eval Tester', channel: 'test', ...(c.role ? { role: c.role } : {}), ...(c.bizPatch ? { bizPatch: c.bizPatch } : {}) };
    for (const h of history) if (h.role === 'user' || h.role === 'customer') await orch.handleCustomer({ ...base, text: h.content });
    return orch.handleCustomer({ ...base, text: c.text });
  }
  // owner / staff / admin: MXAi inside the dashboard
  const user = c.audience === 'owner' ? owner : { ...owner, role: c.audience };
  return orch.askMxai({ businessId, user, text: c.text, ...(history.length ? { history } : {}) });
}

// Whatever the orchestrator returns, pull out reply, tool, handoff and language.
function normalise(r) {
  if (typeof r === 'string') r = { reply: r };
  r = r || {};
  const d = r.decision || {};
  const reply = String(r.reply ?? r.text ?? d.reply ?? '');
  const tool = r.tool !== undefined ? r.tool : d.tool !== undefined ? d.tool : (r.action && r.action !== 'none' ? r.action : null);
  const handoff = r.handoff === true || r.outcome === 'handoff' || tool === 'handoff' || r.guard?.action === 'handoff' || !!d.unknown && r.handoff !== false;
  return { reply, tool: tool ?? null, handoff, lang: r.lang || d.lang || langOf(reply) };
}

function grade(c, r, ctx) {
  const e = c.expect || {}, why = [];
  let skipped = false;
  const match = (m) => {
    if (typeof m === 'function') { const v = m(ctx); if (v == null || (v instanceof RegExp && /NaN/.test(v.source))) { skipped = true; return null; } m = v; }
    if (m instanceof RegExp) return m.test(r.reply);
    return r.reply.toLowerCase().includes(String(m).toLowerCase());
  };
  if ('tool' in e) {
    const allowed = Array.isArray(e.tool) ? e.tool : [e.tool];
    const okTool = allowed.some(t => t instanceof RegExp ? t.test(r.tool || '') : (t ?? null) === (r.tool ?? null));
    if (!okTool) why.push(`tool ${r.tool} not in [${allowed.join(', ')}]`);
  }
  if (e.handoff === true && !r.handoff) why.push('expected a handoff');
  if (e.handoff === false && r.handoff) why.push('unexpected handoff');
  for (const m of e.contains || []) { const v = match(m); if (v === false) why.push(`missing ${String(typeof m === 'function' ? m(ctx) : m)}`); }
  for (const m of e.notContains || []) { const v = match(m); if (v === true) why.push(`contains ${String(m)}`); }
  if (e.lang && r.lang !== e.lang) why.push(`lang ${r.lang}, expected ${e.lang}`);
  if (!r.reply.trim()) why.push('empty reply');
  // a check that needed owner facts we could not load: skip only when nothing else failed
  if (skipped && !why.length) return { ok: false, skipped: true, why: 'owner facts unavailable' };
  return { ok: !why.length, why: why.join('; ') };
}

function langOf(text) {
  const t = String(text || '');
  if (/[؀-ۿ]/.test(t)) return 'ar';
  if (/[ñ¿¡]|\b(hola|gracias|cita|quiero|mañana|reservar|cuánto|cuesta|tienes|puedes|horario|disponible|claro|perfecto)\b/i.test(t)) return 'es';
  if (/\b(bonjour|merci|rendez-vous|je|vous|demain|réserver|combien|nous)\b|[çœ]/i.test(t)) return 'fr';
  return 'en';
}

function withTimeout(p, ms) {
  let timer;
  return Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${ms / 1000} s`)), ms); })])
    .finally(() => clearTimeout(timer));
}
