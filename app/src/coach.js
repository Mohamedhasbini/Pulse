// Coach: the owner tells the assistant, in plain words, how to talk to customers.
// Each message becomes proposed changes (strict rules, tone, name) that the owner applies with one click.
// With COACH_WEBHOOK_URL set (n8n/pulse-coach.json), an AI rewrites free-form instructions into clean rules;
// without it, or if it fails, the built-in understanding below is used.
import { q, one } from './db.js';

const MAX_RULES = 40;
const TONES = { professional: 'Professional and polite', warm: 'Warm and friendly', playful: 'Fun and playful' };
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const sentence = s => { s = clean(s).replace(/^[-•*\d.)\s]+/, ''); if (!s) return ''; s = s[0].toUpperCase() + s.slice(1); return /[.!?]$/.test(s) ? s : s + '.'; };

// Two rules mean the same thing when they share most of their key words ("Never use emojis" ~ "Do not use emojis").
const STOP = new Set('a an the to of in on for and or but with your you our we us they them their is are be do does not no never always dont don t please any every all it its this that at by from as'.split(' '));
const words = t => new Set(clean(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).map(w => w.replace(/(ies|es|s)$/, '')).filter(w => w && !STOP.has(w)));
export function sameRule(a, b) {
  const A = words(a), B = words(b); if (!A.size || !B.size) return clean(a).toLowerCase() === clean(b).toLowerCase();
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) >= 0.75;
}
const known = (rules, t) => rules.some(r => sameRule(r.text || r, t));

// Turns "please make sure you always mention parking" into "Always mention parking."
function asRule(text) {
  let s = clean(text)
    .replace(/^(ok(ay)?|hey|hi|so|also|and|please|pls|kindly)[,\s]+/i, '')
    .replace(/^(i want you to|i'd like you to|i would like you to|can you|could you|you should|you must|you need to|make sure (that )?(you )?|remember to|tell (the )?(ai|assistant|bot) to|from now on,?|going forward,?)\s*/i, '')
    .replace(/\bplease\b\s*/gi, '');
  s = s.replace(/\b(do|does|did|ca|wo|is|are|should|would|could)n'?t\b/gi, (_, v) => v + "n't").replace(/\bi\b/g, 'I');
  s = s.replace(/^stop (\w+ing)\b/i, (_, v) => 'Never ' + v.replace(/ing$/, '').replace(/(.)\1$/, '$1'));
  return sentence(s);
}

export function understand(text, current = {}) {
  const raw = clean(text);
  if (!raw) return { reply: 'Tell me how I should talk to your customers, or what to change.', changes: [] };
  const lower = raw.toLowerCase(), changes = [];
  const rules = current.rules || [];
  if (/\b(list|show|what are|see)\b.*\brules?\b/.test(lower) || /^rules\??$/.test(lower))
    return { reply: rules.length ? `Here are the rules I follow now:\n${rules.map((r, i) => `${i + 1}. ${r.text || r}`).join('\n')}\n\nSay "remove rule 2" to drop one.` : 'There are no rules yet. Tell me what to always or never do.', changes: [] };
  const rm = lower.match(/\b(remove|delete|forget|drop|cancel)\b[^\d]*rules?\s*#?\s*(\d+)/);
  if (rm) {
    const i = +rm[2] - 1;
    if (!rules[i]) return { reply: `There's no rule ${rm[2]}. Say "show rules" to see them.`, changes: [] };
    return { reply: 'I\'ll remove this rule:', changes: [{ type: 'remove_rule', index: i, text: rules[i].text || rules[i] }] };
  }
  const name = raw.match(/\b(?:call yourself|your name (?:is|will be|should be)|name yourself|rename yourself(?: to)?|introduce yourself as)\s+["“']?([\p{L}][\p{L} .'-]{0,38}?)["”']?(?=[.,!]|$|\s+(?:and|from|when)\b)/iu);
  if (name) changes.push({ type: 'name', value: clean(name[1]) });
  let tone = null;
  if (/\b(formal|professional|polite|serious|respectful)\b/.test(lower)) tone = 'professional';
  else if (/\b(playful|fun|funny|cheerful|joyful|cool)\b/.test(lower)) tone = 'playful';
  else if (/\b(friendly|warm|casual|kind|welcoming|relaxed)\b/.test(lower)) tone = 'warm';
  if (tone && /\b(be|sound|tone|style|more|less|speak|talk|write)\b/.test(lower) && tone !== current.tone) changes.push({ type: 'tone', value: tone, text: TONES[tone] });
  // Specific habits, then everything else as strict rules (one per sentence)
  const parts = raw.split(/(?<=[.!?\n])\s+|\n+/).map(clean).filter(Boolean);
  for (const p of parts) {
    const l = p.toLowerCase();
    if (name && p.includes(name[1])) continue;
    if (/\b(no|without|stop using|don'?t use|never use)\b.*\bemoj/.test(l)) { changes.push({ type: 'rule', text: 'Never use emojis.' }); continue; }
    if (/\b(use|add|more)\b.*\bemoj/.test(l)) { changes.push({ type: 'rule', text: 'Use one friendly emoji in most replies.' }); continue; }
    if (/\b(shorter|short|brief|concise|less text|too long)\b/.test(l) && !/\bnotice\b/.test(l)) { changes.push({ type: 'rule', text: 'Keep every reply short: one or two sentences.' }); continue; }
    if (/\b(longer|more detail|more details|explain more)\b/.test(l)) { changes.push({ type: 'rule', text: 'Give a little more detail when explaining services and prices.' }); continue; }
    const lang = l.match(/\b(?:speak|reply|answer|respond|write|talk)\b.*\bin (arabic|english|french|spanish|lebanese)\b/);
    if (lang && !/\b(when|if|unless|only)\b/.test(l)) { changes.push({ type: 'rule', text: `Always reply in ${lang[1][0].toUpperCase() + lang[1].slice(1)}, unless the customer clearly writes in another language.` }); continue; }
    if (tone && /\b(be|sound|tone|style|speak|talk|write)\b/.test(l) && l.split(' ').length <= 8) continue; // the tone change covers it
    const r = asRule(p);
    if (r.split(' ').length >= 3) changes.push({ type: 'rule', text: r.slice(0, 300) });
  }
  // de-duplicate, and skip rules that already exist
  const seen = new Set();
  const out = changes.filter(c => { const k = c.type + ':' + clean(c.text || c.value).toLowerCase(); if (seen.has(k) || (c.type === 'rule' && known(rules, c.text))) return false; seen.add(k); return true; });
  if (!out.length) return { reply: changes.length ? 'I already follow that. Anything else?' : 'Could you say a bit more? For example: "be more formal", "never offer discounts", "always mention free parking", or "call yourself Lina".', changes: [] };
  return { reply: out.length === 1 ? "Got it. Here's the change:" : `Got it. Here are ${out.length} changes:`, changes: out };
}

// Optional AI rewrite through n8n; must return { reply, changes } with the same change types.
async function understandWithAI(text, current) {
  const url = process.env.COACH_WEBHOOK_URL;
  if (!url) return null;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ model: process.env.AI_MODEL || undefined, message: text, current: { tone: current.tone, assistant_name: current.assistant_name, rules: (current.rules || []).map(x => x.text || x) } }) });
    if (!r.ok) return null;
    let body = await r.json(); body = typeof body === 'string' ? body : body.output ?? body.text ?? body;
    const j = typeof body === 'string' ? JSON.parse((body.match(/\{[\s\S]*\}/) || [body])[0]) : body;
    const changes = (Array.isArray(j.changes) ? j.changes : []).filter(c =>
      (c.type === 'rule' && clean(c.text)) || (c.type === 'tone' && TONES[c.value]) || (c.type === 'name' && clean(c.value)) || (c.type === 'remove_rule' && Number.isInteger(c.index) && current.rules?.[c.index]))
      .map(c => c.type === 'rule' ? { type: 'rule', text: sentence(c.text).slice(0, 300) } : c.type === 'tone' ? { ...c, text: TONES[c.value] } : c.type === 'remove_rule' ? { ...c, text: current.rules[c.index].text || current.rules[c.index] } : { type: 'name', value: clean(c.value).slice(0, 40) });
    // Drop rules the assistant already follows (in any wording) and repeats within this answer.
    for (let i = changes.length - 1; i >= 0; i--) if (changes[i].type === 'rule' && (known(current.rules || [], changes[i].text) || changes.slice(0, i).some(c => c.type === 'rule' && sameRule(c.text, changes[i].text)))) changes.splice(i, 1);
    // Our own wording when there are changes: nothing is saved until the owner presses Apply.
    const reply = changes.length ? (changes.length === 1 ? "Got it. Here's the change:" : `Got it. Here are ${changes.length} changes:`) : clean(j.reply) || 'Could you say a bit more?';
    return { reply, changes, ai: true };
  } catch { return null; }
}

export function mountCoach(app, BIZ, audit, wrap) {
  const state = async () => { const b = await one('SELECT tone, assistant_name, ai_rules FROM businesses WHERE id=$1', [BIZ()]); return { tone: b.tone, assistant_name: b.assistant_name || 'Nora', rules: b.ai_rules || [] }; };
  app.get('/api/coach', wrap(async (_req, res) => res.json({ ...(await state()), tones: TONES, ai: !!process.env.COACH_WEBHOOK_URL })));
  app.post('/api/coach/understand', wrap(async (req, res) => {
    const text = String(req.body.text || '').slice(0, 2000), cur = await state();
    const local = understand(text, cur);
    // Lists and removals are exact; only free-form instructions go to the AI
    const ai = local.changes.some(c => c.type === 'rule') ? await understandWithAI(text, cur) : null;
    res.json(ai && ai.changes.length ? ai : local);
  }));
  app.post('/api/coach/apply', wrap(async (req, res) => {
    const cur = await state(), rules = [...cur.rules], done = [];
    const changes = Array.isArray(req.body.changes) ? req.body.changes.slice(0, 20) : [];
    const removals = changes.filter(c => c.type === 'remove_rule' && Number.isInteger(c.index)).sort((a, b) => b.index - a.index);
    for (const c of removals) if (rules[c.index] && clean(rules[c.index].text || rules[c.index]) === clean(c.text)) { rules.splice(c.index, 1); done.push(`Removed: ${clean(c.text)}`); }
    for (const c of changes) {
      if (c.type === 'rule') { const t = sentence(c.text).slice(0, 300); if (t && !known(rules, t) && rules.length < MAX_RULES) { rules.push({ text: t }); done.push(`New rule: ${t}`); } }
      if (c.type === 'tone' && TONES[c.value]) { await q('UPDATE businesses SET tone=$1 WHERE id=$2', [c.value, BIZ()]); done.push(`Tone: ${TONES[c.value]}`); }
      if (c.type === 'name' && clean(c.value)) { const n = clean(c.value).slice(0, 40); await q('UPDATE businesses SET assistant_name=$1 WHERE id=$2', [n, BIZ()]); done.push(`Name: ${n}`); }
    }
    if (rules.length >= MAX_RULES && changes.some(c => c.type === 'rule')) done.push(`(Rules are full at ${MAX_RULES}. Remove one to add more.)`);
    await q('UPDATE businesses SET ai_rules=$1 WHERE id=$2', [JSON.stringify(rules), BIZ()]);
    if (done.length) await audit(req, 'coach_applied', done.join(' | ').slice(0, 500));
    res.json({ ok: true, done, ...(await state()) });
  }));
}
