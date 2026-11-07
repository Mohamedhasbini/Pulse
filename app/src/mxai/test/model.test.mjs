// Model (layer 01): JSON repair, prompt shape, provider choice, busy errors. Every AI is mocked: nothing leaves the PC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { think, repairJson, buildPrompt, preferFor, takeBizSlot, _setComplete, _setDeps, _reset } from '../model.js';

const fakeTrace = () => { const steps = [], flags = []; return { steps, flags, step: (l, d) => steps.push({ l, ...d }), flag: (n, d) => flags.push({ n, d }) }; };
function setup({ complete, claude = null, sharedOk = true } = {}) {
  _reset();
  const calls = { complete: [], claudeFor: 0, spend: [], anthropic: [] };
  class FakeAnthropic {
    constructor() {
      this.beta = { messages: { create: async a => { calls.anthropic.push(a); return { model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answer":"from claude"}' }] }; } } };
    }
  }
  _setDeps({
    globalSlot: async () => sharedOk,
    credentials: async () => null,
    claudeFor: async () => { calls.claudeFor++; return claude; },
    recordSpend: async (...a) => { calls.spend.push(a); },
    anthropic: FakeAnthropic,
  });
  _setComplete(complete || (async (prompt, opts) => { calls.complete.push({ prompt, opts }); return { text: '```json\n{"reply":"ok","tool":null}\n```', provider: 'gemini-flash-lite' }; }));
  return calls;
}

test('repairJson: fences, prose around it, trailing commas, missing args, truncation', () => {
  assert.deepEqual(repairJson('```json\n{"reply":"hi"}\n```'), { reply: 'hi' });
  assert.deepEqual(repairJson('Sure! {"reply":"hi", "tool": null,} hope that helps'), { reply: 'hi', tool: null });
  assert.deepEqual(repairJson('{"tools":[{"name":"metrics", {}}]}'), { tools: [{ name: 'metrics', args: {} }] });
  assert.deepEqual(repairJson('{"tools":[{"name":"metrics", {"days":7}}]}'), { tools: [{ name: 'metrics', args: { days: 7 } }] });
  assert.deepEqual(repairJson('{"reply":"See you Friday","tool":"book","args":{"service":"Haircut"'), { reply: 'See you Friday', tool: 'book', args: { service: 'Haircut' } });
  assert.equal(repairJson('{"reply": "half \\"quoted\\" text", oops oops}').reply, 'half "quoted" text');
  assert.deepEqual(repairJson('{totally broken'), { broken: true });
  assert.deepEqual(repairJson(''), { broken: true });
  const plain = repairJson('Hello, we are open until 7.');
  assert.equal(plain.reply, 'Hello, we are open until 7.'); assert.equal(plain.plain, true);
});

test('buildPrompt joins system and labelled turns', () => {
  const p = buildPrompt({ system: 'RULES', audience: 'customer', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'price?' }] });
  assert.match(p, /^RULES\n\nCONVERSATION \(oldest first\):\nCustomer: hi\nYou: Hello\nCustomer: price\?/);
  assert.match(p, /JSON object only/);
  assert.doesNotMatch(buildPrompt({ system: 'R', messages: [], json: false, audience: 'owner' }), /JSON/);
});

test('think: free AI, parsed JSON, size hint, trace step', async () => {
  const calls = setup(), trace = fakeTrace();
  const r = await think({ businessId: 1, role: 'receptionist', audience: 'customer', system: 'S', messages: [{ role: 'user', content: 'hi' }], size: 'small', trace });
  assert.deepEqual(r.json, { reply: 'ok', tool: null });
  assert.equal(r.provider, 'gemini-flash-lite');
  assert.equal(typeof r.model, 'string'); assert.equal(typeof r.ms, 'number');
  assert.equal(calls.claudeFor, 0, 'customers never even ask for Claude');
  assert.equal(calls.complete[0].opts.business, 1);
  assert.deepEqual(calls.complete[0].opts.prefer, preferFor('small'));
  assert.equal(trace.steps[0].l, 'model');
  await think({ businessId: 1, role: 'receptionist', system: 'S', messages: [{ role: 'user', content: 'move my booking' }], size: 'large' });
  assert.equal(calls.complete[1].opts.prefer[0], 'gemini-flash');
});

test('think: shared allowance full steers away from Gemini', async () => {
  const calls = setup({ sharedOk: false });
  await think({ businessId: 3, role: 'receptionist', system: 'S', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(calls.complete[0].opts.prefer[0], 'groq');
});

test('think: Claude only for the owner assistant with a budget, spend recorded', async () => {
  let calls = setup({ claude: { key: 'k', model: null, own: false } });
  const r = await think({ businessId: 1, role: 'mxai', audience: 'owner', system: 'S', messages: [{ role: 'assistant', content: 'earlier' }, { role: 'user', content: 'revenue?' }] });
  assert.equal(r.provider, 'anthropic'); assert.deepEqual(r.json, { answer: 'from claude' });
  assert.equal(calls.spend.length, 1); assert.equal(calls.spend[0][0], 1);
  assert.equal(calls.anthropic[0].messages[0].role, 'user', 'conversation sent to Claude starts with the user');
  assert.equal(calls.complete.length, 0);
  // a customer chat with a Claude-enabled business still uses the free AI
  calls = setup({ claude: { key: 'k' } });
  const c = await think({ businessId: 1, role: 'mxai', audience: 'customer', system: 'S', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(c.provider, 'gemini-flash-lite'); assert.equal(calls.claudeFor, 0);
  // no budget: free AI
  calls = setup({ claude: null });
  assert.equal((await think({ businessId: 1, role: 'mxai', audience: 'owner', system: 'S', messages: [{ role: 'user', content: 'x' }] })).provider, 'gemini-flash-lite');
  assert.equal(calls.claudeFor, 1);
});

test('think: everything failing throws .busy', async () => {
  setup({ complete: async () => { throw new Error('All backup AIs failed'); } });
  const trace = fakeTrace();
  await assert.rejects(think({ businessId: 1, role: 'receptionist', system: 'S', messages: [{ role: 'user', content: 'x' }], trace }), e => e.busy === true);
  assert.equal(trace.flags[0].n, 'busy');
  setup({ complete: async () => ({ text: '', provider: 'groq' }) });
  await assert.rejects(think({ businessId: 1, system: 'S', messages: [] }), e => e.busy === true);
});

test('one busy business cannot use every call', async () => {
  setup();
  let ok = 0, busy = 0;
  for (let i = 0; i < 30; i++) {
    try { await think({ businessId: 7, role: 'receptionist', system: 'S', messages: [{ role: 'user', content: 'x' }] }); ok++; }
    catch (e) { assert.equal(e.busy, true); busy++; }
  }
  assert.ok(ok >= 2 && busy > 0, `ok=${ok} busy=${busy}`);
  // another business still gets its share
  assert.equal(takeBizSlot(8), true);
  // and the window slides: a minute later business 7 can talk again
  assert.equal(takeBizSlot(7, Date.now() + 61e3), true);
});
