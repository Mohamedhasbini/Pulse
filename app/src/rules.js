// The receptionist's strict rules have one writer. Teach AI (coach), lessons from the Lab and the AI team all add
// rules through addRule, so every path skips a rule it already has (in any wording), never pushes out an older
// rule when the list is full, and records a new version for the quality score in the Test lab.
import { q, one } from './db.js';
import { sameRule } from './coach.js';

export const MAX_RULES = 40;
const tidy = t => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 400);

export const getRules = async B => (await one('SELECT ai_rules FROM businesses WHERE id=$1', [B])).ai_rules || [];
export const version = (B, note) => q('INSERT INTO ai_versions (business_id, note) VALUES ($1,$2)', [B, String(note).slice(0, 200)]);

// → { added: true } or { added: false, reason: 'known' | 'full' | 'empty' }
export async function addRule(B, text, note) {
  const t = tidy(text); if (!t) return { added: false, reason: 'empty' };
  const rules = await getRules(B);
  if (rules.some(r => sameRule(r.text || r, t))) return { added: false, reason: 'known' };
  if (rules.length >= MAX_RULES) return { added: false, reason: 'full' };
  await q('UPDATE businesses SET ai_rules=$1 WHERE id=$2', [JSON.stringify([...rules, { text: t }]), B]);
  await version(B, note || `Rule: ${t.slice(0, 80)}`);
  return { added: true };
}
