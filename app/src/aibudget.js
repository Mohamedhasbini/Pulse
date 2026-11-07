// Claude for MXAi Assistant, one business at a time. It answers only where the admin has switched on "AI Assistant Pro"
// for that business (add-on, plan or the admin's own switch), on MXAi's own Anthropic key, inside a monthly budget per
// business. Every Claude answer is written down with its real token counts and cost. When a business's month reaches its
// budget it goes back to the free AI until the 1st, and the admin is told once that month. There is no paid fallback:
// a business without the feature never touches a paid model.
import { q, one } from './db.js';
import { hasFeature } from './features.js';
import { alertAdmin } from './ops.js';
import { allowedFor } from './switches.js';

// US dollars per million tokens: input, output, cache read. An unknown model counts at Opus prices, so a budget is
// never under-counted.
const PRICES = { 'claude-opus-5-5': [4, 20, 0.2], 'claude-sonnet-5-5': [2, 10, 0.2], 'claude-haiku-5-5': [0.1, 0.5, 0.01] };
export function costOf(model, u = {}) {
  const [i, o, c] = PRICES[model] || PRICES['claude-opus-5-5'];
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * c
    + (u.cache_creation_input_tokens || 0) * i * 1.25) / 1e6;
}

// what this business has spent on MXAi's key this calendar month (its own key, if the admin allowed one, is its own bill)
export const monthSpend = async biz => +(await one(`SELECT COALESCE(sum(cost_usd),0)::float AS s FROM ai_spend
  WHERE business_id=$1 AND NOT own_key AND at >= date_trunc('month', now())`, [biz])).s;

// Which Claude this business may use right now: { key, model, own } or null (then the free AI answers).
export async function claudeFor(biz, own) {
  if (!biz || !(await hasFeature(biz, 'assistant_pro')) || !(await allowedFor(biz, 'ai:anthropic'))) return null;
  if (own?.api_key) return { key: own.api_key, model: own.model || null, own: true };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const budget = +((await one('SELECT ai_budget FROM businesses WHERE id=$1', [biz]))?.ai_budget ?? 5);
  if ((await monthSpend(biz)) >= budget) { await budgetReached(biz, budget); return null; }
  return { key, model: null, own: false };
}

export async function recordSpend(biz, model, usage, own) {
  await q(`INSERT INTO ai_spend (business_id, provider, model, input_tokens, output_tokens, cost_usd, own_key) VALUES ($1,'anthropic',$2,$3,$4,$5,$6)`,
    [biz, model, usage?.input_tokens || 0, usage?.output_tokens || 0, costOf(model, usage), !!own]).catch(e => console.error('ai_spend:', e.message));
}

// once a month per business: the admin hears about it, and the Lab shows it
async function budgetReached(biz, budget) {
  const b = await one(`UPDATE businesses SET ai_budget_warned=to_char(now(),'YYYY-MM') WHERE id=$1
    AND ai_budget_warned IS DISTINCT FROM to_char(now(),'YYYY-MM') RETURNING name`, [biz]);
  if (b && !/^(smoke|e2e|test)/i.test(b.name)) await alertAdmin(`${b.name} used its $${budget} Claude budget for this month. Its MXAi Assistant is back on the free AI until the 1st. Raise the budget in the Lab if you want it to continue.`);
}

// for the Lab: this month's Claude spend and budget per business
export const spendByBusiness = () => q(`SELECT b.id AS business_id, COALESCE(b.ai_budget,5)::float AS budget,
    COALESCE(sum(s.cost_usd) FILTER (WHERE NOT s.own_key),0)::float AS spent, count(s.id)::int AS calls
  FROM businesses b LEFT JOIN ai_spend s ON s.business_id=b.id AND s.at >= date_trunc('month', now()) GROUP BY b.id`);
