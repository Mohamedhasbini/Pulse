// Growth engine: scoring. An AI judge rates each company against the client's ideal customer using only the stored
// facts, and pgvector measures how close the company's description is in meaning to the ideal customer.
// score = 75% judge + 15% meaning match + up to 10 for how reachable the company is.
import { z } from 'zod';
import { q, one } from '../db.js';
import { ask, embedText, toVector } from './ai.js';

const Judge = z.object({
  fit: z.number().int().min(0).max(100).describe('How well this company matches the ideal customer, 0-100.'),
  reasons: z.array(z.string()).min(1).max(3).describe('Short, specific reasons based only on the company facts given.'),
  disqualify: z.string().nullable().describe('If this is clearly NOT a lead (a competitor, outside the target countries, not a business, a huge enterprise, a directory), say why in a few words; otherwise null.'),
});

const REACH = { valid: 10, catch_all: 5, unknown: 3, unchecked: 2 };

export async function ensureEmbedding(company) {
  if (company.has_embedding) return;
  const text = [company.name, company.sector, company.description, company.city].filter(Boolean).join('. ');
  if (text.length < 20) return;
  const v = await embedText(text);
  await q('UPDATE eng_companies SET embedding=$2 WHERE id=$1', [company.id, toVector(v)]);
}

export async function scoreCompany(company, profile, clientVector, contact) {
  const facts = await q('SELECT field, value FROM eng_facts WHERE company_id=$1', [company.id]);
  const sim = clientVector
    ? +(await one('SELECT 1 - (embedding <=> $2::vector) AS s FROM eng_companies WHERE id=$1 AND embedding IS NOT NULL', [company.id, clientVector]))?.s || 0
    : 0;
  const ic = profile.ideal_customer || {};
  const j = await ask({
    kind: 'judge', schema: Judge,
    system: 'You qualify B2B leads for a business. Judge only from the facts given; do not assume facts that are not listed. '
      + 'Be strict: a fit above 70 means the owner would want to contact this company this week.',
    prompt: `THE BUSINESS: ${profile.name}: ${profile.offer}\nIDEAL CUSTOMER: ${ic.summary}\nSectors: ${(ic.sectors || []).join(', ')}\nSize: ${ic.company_size}\n`
      + `Cities: ${(ic.cities || []).join(', ')}\nBuyer roles: ${(ic.roles || []).join(', ')}\nNot a fit: ${(ic.exclude || []).join(', ')}\n\n`
      + `THE COMPANY: ${company.name} (${company.domain})\n${facts.map(f => `- ${f.field}: ${f.value}`).join('\n')}\n`
      + `- software on its website: ${(company.tech || []).join(', ') || 'none detected'}\n- best contact: ${contact ? `${contact.name || 'general address'}${contact.role ? `, ${contact.role}` : ''} (${contact.email_status})` : 'none found'}`,
  });
  const fit = j.disqualify ? Math.min(j.fit, 20) : j.fit;
  const score = fit * 0.75 + Math.max(0, sim) * 100 * 0.15 + (contact?.email ? REACH[contact.email_status] ?? 0 : 0);
  return { fit, similarity: sim, score: +score.toFixed(1), reasons: j.disqualify ? [`Not a fit: ${j.disqualify}`, ...j.reasons] : j.reasons };
}
