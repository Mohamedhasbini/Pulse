// Growth engine, layer 4: the AI gateway for the engine (Vercel AI SDK + Gemini, answers validated with Zod).
// It runs at its own pace (ENGINE_AI_RPM, default 8 calls a minute) and on its own models, so the AI receptionist's
// free quota (gemini-3.5-flash-lite in ai-router.js) is never used up by lead finding.
import { generateObject, embed } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export const MODELS = {
  read: process.env.ENGINE_MODEL_READ || 'gemini-3.1-flash-lite',   // reading pages: fast, cheap
  judge: process.env.ENGINE_MODEL_JUDGE || 'gemini-3.5-flash',      // judging fit and building profiles: careful
  embed: process.env.ENGINE_MODEL_EMBED || 'gemini-embedding-2',    // meaning search (768 numbers per text)
};
let google = null;
const provider = () => (google ||= createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY }));

// a shared minute window for every engine call
let stamps = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function slot() {
  const rpm = Math.max(1, +process.env.ENGINE_AI_RPM || 8);
  for (;;) {
    const now = Date.now();
    stamps = stamps.filter(t => now - t < 60000);
    if (stamps.length < rpm) { stamps.push(now); return; }
    await sleep(60000 - (now - stamps[0]) + 50);
  }
}
export const usage = { calls: 0, failures: 0, fallbacks: 0 };
const isQuota = e => /429|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(String(e?.message || e));

// One structured answer. On a quota error for the careful model it falls back to the fast one.
export async function ask({ kind = 'read', schema, system, prompt, retries = 2 }) {
  let model = MODELS[kind];
  for (let i = 0; ; i++) {
    await slot();
    usage.calls++;
    try {
      const r = await generateObject({ model: provider()(model), schema, system, prompt, temperature: 0.1, maxRetries: 0 });
      return r.object;
    } catch (e) {
      usage.failures++;
      if (isQuota(e) && model !== MODELS.read) { model = MODELS.read; usage.fallbacks++; continue; }
      if (i >= retries) throw e;
      await sleep(isQuota(e) ? 30000 : 3000);
    }
  }
}

export async function embedText(text) {
  await slot();
  usage.calls++;
  const { embedding } = await embed({
    model: provider().textEmbeddingModel(MODELS.embed), value: String(text).slice(0, 6000), maxRetries: 2,
    providerOptions: { google: { outputDimensionality: 768, taskType: 'SEMANTIC_SIMILARITY' } },
  });
  return embedding;
}
export const toVector = v => `[${v.map(x => +x.toFixed(6)).join(',')}]`;
