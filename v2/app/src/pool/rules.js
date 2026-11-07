// Country rules layer: may MXAi send this message to this person, now, on this channel, for this business?
// Checks in order: suppression → consent (channel, purpose, named business, not withdrawn/expired, confirmed where
// double opt-in is required) or the country's cold-outreach switch → quiet hours in the person's local time →
// frequency cap. Every decision is logged in lp_rule_log with the reason. Replies to someone who wrote first are
// service messages and are always allowed unless the person opted out of everything.
import { q, one } from '../db.js';
import { COUNTRIES, STRICT, CHANNELS } from './countries.js';

export async function seedRules() {
  for (const [code, r] of Object.entries(COUNTRIES))
    await q(`INSERT INTO lp_country_rules (country, name, rules, reviewed_at) VALUES ($1,$2,$3,'2026-11-07') ON CONFLICT (country) DO NOTHING`, [code, r.name, JSON.stringify(r)]);
}
export async function ruleFor(country) {
  const r = country ? await one('SELECT * FROM lp_country_rules WHERE country=$1', [String(country).toUpperCase()]) : null;
  return r ? { ...r.rules, cold_allowed: r.cold_allowed, country: r.country } : { ...STRICT, cold_allowed: false, country: country || null };
}

const localHour = (tz, at) => { try { return +new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(at); } catch { return at.getUTCHours(); } };
const localDay = (tz, at) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(at); } catch { return ''; } };

// decide({ personId, channel, purpose: 'marketing'|'service', clientId, at, log }) → { allowed, reason, consentId, requirements, rule }
export async function decide({ personId, channel, purpose = 'marketing', clientId, at = new Date(), log = true }) {
  const result = await evaluate({ personId, channel, purpose, clientId, at });
  // logged at the decision's own time, so the daily and weekly limits count the right messages
  if (log) await q(`INSERT INTO lp_rule_log (person_id, channel, purpose, client_id, allowed, reason, consent_id, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [personId, channel, purpose, clientId || null, result.allowed, result.reason, result.consentId || null, at]);
  return result;
}

async function evaluate({ personId, channel, purpose, clientId, at }) {
  if (!CHANNELS.includes(channel)) return { allowed: false, reason: `unknown channel ${channel}` };
  const p = await one('SELECT id, country FROM lp_persons WHERE id=$1', [personId]);
  if (!p) return { allowed: false, reason: 'no such person' };
  const rule = await ruleFor(p.country);
  const requirements = [...(rule.labels || []), 'ai_disclosure', 'sender_identity'].filter((v, i, a) => a.indexOf(v) === i);

  // 1. suppression: global, this business, this channel
  const sup = await one(`SELECT s.reason, s.scope FROM lp_suppressions s JOIN lp_identities i ON i.value_hash=s.value_hash
    WHERE i.person_id=$1 AND s.scope = ANY($2) LIMIT 1`, [personId, ['global', `client:${clientId}`, `channel:${channel}`]]);
  if (sup && !(purpose === 'service' && sup.scope !== 'global')) return { allowed: false, reason: `suppressed (${sup.scope}${sup.reason ? ': ' + sup.reason : ''})`, rule: rule.country };

  // 2. service replies (the person wrote first): allowed
  if (purpose === 'service') return { allowed: true, reason: 'reply to a person who contacted the business', requirements, rule: rule.country };

  const code = rule.channels?.[channel] || 'CONSENT';
  if (code === 'BANNED') return { allowed: false, reason: `${channel} marketing is banned in ${rule.name}`, rule: rule.country };

  // 3. consent for this channel, purpose and business
  const consent = await one(`SELECT id, captured_at, confirmed_at, expires_at FROM lp_consents
      WHERE person_id=$1 AND channel=$2 AND purpose='marketing' AND $3 = ANY(buyers) AND withdrawn_at IS NULL
        AND (expires_at IS NULL OR expires_at > $4) ORDER BY captured_at DESC LIMIT 1`, [personId, channel, clientId || 0, at]);
  let consentId = null;
  if (consent) {
    if (rule.consentMonths && new Date(consent.captured_at).getTime() + rule.consentMonths * 30.44 * 864e5 < at.getTime())
      return { allowed: false, reason: `consent older than ${rule.consentMonths} months (${rule.name})`, rule: rule.country };
    if (rule.doubleOptIn && channel === 'email' && !consent.confirmed_at) return { allowed: false, reason: `waiting for the double opt-in click (${rule.name})`, rule: rule.country };
    consentId = consent.id;
  } else if (!((code === 'OPT_OUT' || code === 'OK') && rule.cold_allowed && channel === 'email')) {
    return { allowed: false, reason: `no ${channel} consent for this business (${rule.name}: ${code.toLowerCase().replace('_', '-')})`, rule: rule.country };
  }

  // 4. quiet hours in the person's local time (messages and calls; email is read when the person chooses)
  if (channel !== 'email') {
    const h = localHour(rule.tz, at), [from, to] = rule.quiet || [9, 20];
    if (h < from || h >= to) return { allowed: false, reason: `outside allowed hours ${from}:00-${to}:00 ${rule.tz} (now ${h}:00)`, deferrable: true, rule: rule.country };
    if (rule.country === 'CO' && localDay(rule.tz, at) === 'Sun') return { allowed: false, reason: 'no contact on Sundays in Colombia', deferrable: true, rule: rule.country };
  }

  // 5. frequency cap across all businesses and channels
  const sent = await one(`SELECT count(*) FILTER (WHERE at > $2::timestamptz - interval '1 day')::int AS day, count(*)::int AS week
    FROM lp_rule_log WHERE person_id=$1 AND purpose='marketing' AND allowed AND at > $2::timestamptz - interval '7 days'`, [personId, at]);
  const cap = rule.cap || { day: 1, week: 3 };
  if (sent.day >= cap.day) return { allowed: false, reason: `daily limit reached (${cap.day} a day in ${rule.name})`, deferrable: true, rule: rule.country };
  if (sent.week >= cap.week) return { allowed: false, reason: `weekly limit reached (${cap.week} a week in ${rule.name})`, deferrable: true, rule: rule.country };

  return { allowed: true, reason: consentId ? `consent #${consentId}` : `cold email allowed by switch (${rule.name})`, consentId, requirements, rule: rule.country };
}
