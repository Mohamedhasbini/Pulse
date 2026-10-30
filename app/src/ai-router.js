// AI router: when the main AI (the n8n Gemini workflows) is out of quota, slow or down, the same prompt goes to the
// next free provider. Each provider has its own free allowance, so together they carry far more than one.
// A provider that answers "limit reached" or errors is skipped for a while (cooldown), then tried again.
// Keys: platform-wide from the environment, or a business's own from Settings › Integrations (tried first).
//   GEMINI_API_KEY      Google AI Studio (each model below has its own daily quota)
//   GROQ_API_KEY        console.groq.com
//   OPENROUTER_API_KEY  openrouter.ai (":free" models)
//   CEREBRAS_API_KEY    cloud.cerebras.ai
import { credentials } from './integrations.js';

const T = 20000;
const openai = (url, model) => async (key, prompt, json) => {
  const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(T),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': process.env.PUBLIC_URL || 'http://localhost', 'X-Title': 'Pulse' },
    body: JSON.stringify({ model, temperature: 0.3, messages: [{ role: 'user', content: prompt }], ...(json ? { response_format: { type: 'json_object' } } : {}) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `HTTP ${r.status}`), { status: r.status });
  return j.choices?.[0]?.message?.content || '';
};
const gemini = model => async (key, prompt, json) => {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', signal: AbortSignal.timeout(T), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, ...(json ? { responseMimeType: 'application/json' } : {}) } }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `HTTP ${r.status}`), { status: r.status });
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
};

// order = best quality per free request first; models can be changed with <PROVIDER>_MODEL
const ROUTES = [
  { id: 'gemini-flash-lite', key: 'GEMINI_API_KEY', biz: 'gemini', call: gemini(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite') },
  { id: 'groq', key: 'GROQ_API_KEY', biz: 'groq', call: openai('https://api.groq.com/openai/v1/chat/completions', process.env.GROQ_MODEL || 'openai/gpt-oss-120b') },
  { id: 'gemini-flash', key: 'GEMINI_API_KEY', biz: 'gemini', call: gemini(process.env.GEMINI_MODEL_2 || 'gemini-3.5-flash') },
  { id: 'gemini-3.1-lite', key: 'GEMINI_API_KEY', biz: 'gemini', call: gemini(process.env.GEMINI_MODEL_3 || 'gemini-3.1-flash-lite') },
  { id: 'cerebras', key: 'CEREBRAS_API_KEY', biz: 'cerebras', call: openai('https://api.cerebras.ai/v1/chat/completions', process.env.CEREBRAS_MODEL || 'llama-3.3-70b') },
  { id: 'openrouter', key: 'OPENROUTER_API_KEY', biz: 'openrouter', call: (k, p) => openai('https://openrouter.ai/api/v1/chat/completions', process.env.OPENROUTER_MODEL || 'openrouter/free')(k, p, false) } // openrouter/free picks whichever free model is up,
];
const cool = new Map(), stats = new Map(); // id → skip-until ms; id → { ok, fail, last }
const note = (id, ok, err) => { const s = stats.get(id) || { ok: 0, fail: 0 }; ok ? s.ok++ : s.fail++; s.last = ok ? 'ok' : String(err).slice(0, 120); s.at = new Date().toISOString(); stats.set(id, s); };

// true when at least one backup provider has a key (platform or this business)
export async function hasBackup(B) {
  if (ROUTES.some(r => process.env[r.key])) return true;
  for (const b of new Set(ROUTES.map(r => r.biz))) if ((await credentials(B, b).catch(() => null))?.api_key) return true;
  return false;
}

// prompt in, text out. Throws only when every provider failed.
export async function complete(prompt, { json = true, business } = {}) {
  const errors = [];
  for (const r of ROUTES) {
    if ((cool.get(r.id) || 0) > Date.now()) continue;
    const key = (business && (await credentials(business, r.biz).catch(() => null))?.api_key) || process.env[r.key];
    if (!key) continue;
    try { const text = await r.call(key, prompt, json); if (!text) throw new Error('empty answer'); note(r.id, true); return { text, provider: r.id }; }
    catch (e) {
      note(r.id, false, e.message); errors.push(`${r.id}: ${e.message}`);
      // limit reached: rest 10 minutes (daily quotas recover slowly); other errors: 1 minute
      cool.set(r.id, Date.now() + (e.status === 429 || /quota|rate|limit/i.test(e.message) ? 600e3 : 60e3));
    }
  }
  throw new Error(errors.length ? `All backup AIs failed: ${errors.join(' | ')}` : 'No backup AI key is set');
}

// one live call per provider, for setup checks
export async function testAll(prompt = 'Reply with JSON {"ok":true}') {
  const out = [];
  for (const r of ROUTES) { const key = process.env[r.key]; if (!key) { out.push({ id: r.id, ok: false, error: 'no key' }); continue; }
    const t0 = Date.now(); try { const text = await r.call(key, prompt, true); out.push({ id: r.id, ok: true, ms: Date.now() - t0, text: text.slice(0, 60) }); } catch (e) { out.push({ id: r.id, ok: false, error: e.message.slice(0, 120) }); } }
  return out;
}
export function routerStatus() {
  return ROUTES.map(r => ({ id: r.id, configured: !!process.env[r.key], resting_until: (cool.get(r.id) || 0) > Date.now() ? new Date(cool.get(r.id)).toISOString() : null, ...stats.get(r.id) }));
}
