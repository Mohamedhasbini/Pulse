// Layer 01: the model. The ONLY way MXAi talks to an AI.
//   - Free providers through ai-router.js complete(): Gemini first, then Groq / Cerebras / OpenRouter, each skipped
//     while it rests after a limit and whenever the Lab switches it off (ai-router already checks both).
//   - Claude only for the owner's own assistant (role 'mxai', never a customer), only where aibudget.claudeFor() hands
//     out a key (AI Assistant Pro on, Lab switch on, inside the monthly budget), and every call's cost is written down.
//   - Never n8n: the prompt is built here, so every provider gets exactly the same instructions.
// Dependencies are loaded lazily (and can be swapped in tests), so this file can be tested with plain `node`
// without a database or any network.

// ---- dependencies --------------------------------------------------------------------------------------------
const deps = {};
const loaders = {
  complete: async () => (await import('../ai-router.js')).complete,
  claudeFor: async () => (await import('../aibudget.js')).claudeFor,
  recordSpend: async () => (await import('../aibudget.js')).recordSpend,
  credentials: async () => (await import('../integrations.js')).credentials,
  // the database counter brain.js/team.js already use, so all AI work together stays under the plan's per-minute limit
  globalSlot: async () => {
    const { one } = await import('../db.js');
    const rpm = Math.max(1, +process.env.AI_RPM || 10);
    return async () => !!(await one(`WITH l AS (SELECT pg_advisory_xact_lock(424242)),
        c AS (SELECT count(*) AS n FROM ai_calls, l WHERE at > now() - interval '60 seconds')
      INSERT INTO ai_calls (at) SELECT now() FROM c WHERE c.n < $1 RETURNING 1`, [rpm]));
  },
  anthropic: async () => (await import('@anthropic-ai/sdk')).default,
};
const dep = async name => deps[name] || (deps[name] = await loaders[name]());

// for tests: replace the free-provider call (and, with _setDeps, anything else) so no real AI is ever called
export const _setComplete = fn => { deps.complete = fn; };
export const _setDeps = (over = {}) => Object.assign(deps, over);
export const _reset = () => { for (const k of Object.keys(deps)) delete deps[k]; perBiz.clear(); };

// ---- fair share per business ------------------------------------------------------------------------------
// The free plans allow only so many calls a minute for the whole platform. One busy business (a campaign reply
// storm, a stuck loop) must not take every one of them, so each business gets its own per-minute cap on top of
// the shared counter. Counted in memory: one app process runs all businesses today.
const perBiz = new Map(); // bizId -> [timestamps of calls in the last minute]
const bizRpm = () => Math.max(2, +process.env.MXAI_BIZ_RPM || Math.ceil(Math.max(1, +process.env.AI_RPM || 10) * 0.6));
export function takeBizSlot(bizId, now = Date.now()) {
  const k = String(bizId ?? 'none');
  const list = (perBiz.get(k) || []).filter(t => t > now - 60e3);
  if (list.length >= bizRpm()) { perBiz.set(k, list); return false; }
  list.push(now); perBiz.set(k, list);
  return true;
}

// ---- prompt shape ---------------------------------------------------------------------------------------------
// ai-router sends one text to the free providers (structured prompts are flattened anyway), so the system prompt
// and the conversation are joined here, with a clear label per speaker.
const WHO = { customer: 'Customer', owner: 'Owner', staff: 'Staff', admin: 'Admin' };
export function buildPrompt({ system = '', messages = [], audience = 'customer', json = true }) {
  const them = WHO[audience] || 'User';
  const lines = (messages || []).filter(m => m && m.content != null && String(m.content).trim())
    .map(m => `${m.role === 'assistant' ? 'You' : them}: ${String(m.content).trim()}`);
  return [system.trim(),
    lines.length ? `CONVERSATION (oldest first):\n${lines.join('\n')}` : '',
    `Answer the last message from the ${them}.` + (json ? ' Answer with one JSON object only, no other text and no code fences.' : ''),
  ].filter(Boolean).join('\n\n');
}

// Which free route to try first. ai-router's own order already starts with the lite Gemini model (right for
// 'small'); for 'large' we ask for the bigger Gemini first. `prefer` is a hint: ai-router ignores options it does
// not know, so this is safe before the integrator teaches complete() to honour it.
export const preferFor = (size, sharedFull) =>
  sharedFull ? ['groq', 'cerebras', 'openrouter'] // shared Gemini allowance used up this minute: lean on the others
    : size === 'large' ? ['gemini-flash', 'groq', 'gemini-flash-lite'] : ['gemini-flash-lite', 'gemini-3.1-lite', 'groq'];

// provider id (from ai-router) -> model name, for the trace; same defaults and env names as ai-router.js
const MODEL_OF = id => ({
  'gemini-flash-lite': process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  'gemini-flash': process.env.GEMINI_MODEL_2 || 'gemini-3.5-flash',
  'gemini-3.1-lite': process.env.GEMINI_MODEL_3 || 'gemini-3.1-flash-lite',
  groq: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  cerebras: process.env.CEREBRAS_MODEL || 'llama-3.3-70b',
  openrouter: process.env.OPENROUTER_MODEL || 'openrouter/free',
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
})[id] || id;

// ---- JSON repair ----------------------------------------------------------------------------------------------
// Models are asked for JSON but don't always give it cleanly: fences, a sentence before it, a trailing comma, a tool
// call missing its "args" key. Repair what can be repaired (same rules as team.js readReply and brain.js parseJson).
// Results: the parsed object; { reply, answer, plain: true } when the model just wrote prose (brain used it as the
// reply); { broken: true } when it tried JSON and failed (the caller should ask again rather than show it).
export function repairJson(raw) {
  raw = String(raw ?? '').trim();
  if (!raw) return { broken: true };
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const m = unfenced.match(/\{[\s\S]*\}/), body = m ? m[0] : unfenced;
  try { return JSON.parse(body); } catch {}
  const fixed = body
    .replace(/,\s*\{\s*\}/g, ',"args":{}')                 // "name":"x", {}  -> "name":"x","args":{}
    .replace(/("name"\s*:\s*"\w+")\s*,\s*\{/g, '$1,"args":{') // "name":"x", {...} -> "name":"x","args":{...}
    .replace(/,\s*([}\]])/g, '$1')                          // trailing commas
    .replace(/[“”]/g, '"');                        // curly quotes some models emit
  try { return JSON.parse(fixed); } catch {}
  // cut off mid-answer: close what is open and try once more
  try { return JSON.parse(closeOpen(fixed)); } catch {}
  const names = [...body.matchAll(/"name"\s*:\s*"(\w+)"/g)].map(x => x[1]);
  if (/"tools"/.test(body) && names.length) return { tools: names.map(name => ({ name, args: {} })) };
  for (const field of ['reply', 'answer']) {
    const f = body.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    if (f) { let v; try { v = JSON.parse(`"${f[1]}"`); } catch { v = f[1]; } return { [field]: v, salvaged: true }; }
  }
  if (/^\{|^```/.test(raw)) return { broken: true };
  return { reply: raw, answer: raw, plain: true };
}
// close unbalanced strings, braces and brackets of a truncated JSON text
function closeOpen(s) {
  const stack = []; let inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']'); else if (ch === '}' || ch === ']') stack.pop();
  }
  return (inStr ? s + '"' : s).replace(/,\s*$/, '') + stack.reverse().join('');
}

// ---- Claude (owner's assistant only) -----------------------------------------------------------------------
const clients = new Map(); // one SDK client per API key
async function askClaude({ use, businessId, system, messages, json }) {
  const Anthropic = await dep('anthropic');
  if (!clients.has(use.key)) clients.set(use.key, new Anthropic({ apiKey: use.key }));
  // the API wants turns that alternate and start with the user: merge repeats, drop a leading assistant turn
  const turns = [];
  for (const m of messages || []) {
    const role = m.role === 'assistant' ? 'assistant' : 'user', content = String(m.content ?? '').trim();
    if (!content) continue;
    if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].content += '\n\n' + content;
    else if (turns.length || role === 'user') turns.push({ role, content });
  }
  if (!turns.length) turns.push({ role: 'user', content: '(no message)' });
  if (json) turns[turns.length - 1].content += '\n\nAnswer with one JSON object only.';
  const model = use.model || process.env.PULSE_MODEL || 'claude-opus-5-5';
  // same call shape as team.js (proven in production): a safety decline is retried on a suitable model in the same call
  const r = await clients.get(use.key).beta.messages.create({
    model, max_tokens: 16000, system,
    output_config: { effort: process.env.PULSE_EFFORT || 'medium' },
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    messages: turns,
  });
  const used = r.model || model;
  await (await dep('recordSpend'))(businessId, used, r.usage, use.own);
  const text = r.stop_reason === 'refusal'
    ? JSON.stringify({ answer: "I can't help with that one. Ask me about your business.", reply: "I can't help with that one. Ask me about your business." })
    : (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return { text, provider: 'anthropic', model: used };
}

// ---- the entry point -----------------------------------------------------------------------------------------
// think({ businessId, role, audience, system, messages, json, size, trace }) -> { text, json, provider, model, ms }
// Throws an Error with .busy = true when no AI can answer right now (the caller queues the message or apologises).
export async function think({ businessId, role, audience = 'customer', system = '', messages = [], json = true, size = 'auto', trace } = {}) {
  const t0 = Date.now();
  const sz = size === 'small' || size === 'large' ? size : (role === 'mxai' ? 'large' : 'small');
  const busy = (msg, cause) => Object.assign(new Error(msg), { busy: true, cause });
  const done = (r, extra = {}) => {
    const out = { text: r.text, json: json ? repairJson(r.text) : null, provider: r.provider, model: r.model || MODEL_OF(r.provider), ms: Date.now() - t0 };
    try { trace?.step('model', { provider: out.provider, model: out.model, size: sz, ms: out.ms, ...extra, ...(out.json?.broken ? { broken_json: true } : {}) }); } catch {}
    return out;
  };

  // 1) Claude, only for the owner's assistant inside its budget. Customers never reach a paid model.
  if (role === 'mxai' && audience !== 'customer' && businessId) {
    let use = null;
    try {
      const own = await (await dep('credentials'))(businessId, 'anthropic').catch(() => null);
      use = await (await dep('claudeFor'))(businessId, own);
    } catch (e) { console.warn('MXAi: Claude check failed, using the free AI:', e.message); }
    if (use) {
      try { return done(await askClaude({ use, businessId, system, messages, json }), { paid: !use.own }); }
      catch (e) {
        console.warn('MXAi: Claude call failed, falling back to the free AI:', e.status || '', e.message);
        try { trace?.flag('model_fallback', `claude: ${String(e.message).slice(0, 120)}`); } catch {}
      }
    }
  }

  // 2) fair share: this business's own per-minute cap
  if (!takeBizSlot(businessId)) {
    try { trace?.flag('busy', 'business per-minute AI cap reached'); } catch {}
    throw busy('This business reached its AI limit for this minute');
  }
  // 3) the shared counter: when it's full we still answer, but steer away from the shared Gemini allowance
  let sharedFull = false;
  try { sharedFull = !(await (await dep('globalSlot'))()); } catch (e) { console.warn('MXAi: AI counter unavailable:', e.message); }

  const prompt = buildPrompt({ system, messages, audience, json });
  try {
    const r = await (await dep('complete'))(prompt, { json, business: businessId, prefer: preferFor(sz, sharedFull), size: sz });
    if (!r?.text) throw new Error('empty answer');
    return done(r, sharedFull ? { shared_full: true } : {});
  } catch (e) {
    try { trace?.flag('busy', String(e.message).slice(0, 200)); } catch {}
    throw busy('Every AI is busy or out of quota right now', e);
  }
}
