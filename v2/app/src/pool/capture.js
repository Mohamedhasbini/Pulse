// Lead capture: every source (forms, Meta and Google lead ads, WhatsApp, chat, imports) goes through ingest().
// One transaction: find the same person by email or phone (or create them), add identities, keep only allowed
// attributes, record the interest, sign each consent, log the event, and recompute the lead score.
import crypto from 'node:crypto';
import { tx, q, one } from '../db.js';
import { normEmail, normPhone, idHash, certify, textHash, attributeAllowed, valueAllowed } from './core.js';
import { ruleFor } from './rules.js';

const TIMING_POINTS = { now: 30, 'this week': 30, '1-3 months': 20, '3-6 months': 10, later: 4 };

export async function ingest(lead) {
  const email = normEmail(lead.email);
  const phone = lead.phone ? normPhone(lead.phone, lead.country) : null;
  if (!email && !phone) throw Object.assign(new Error('An email or a valid phone number is needed.'), { status: 400 });
  const country = (lead.country || phone?.country || '').toUpperCase().slice(0, 2) || null;
  const at = lead.at ? new Date(lead.at) : new Date();
  const ids = [email && { kind: 'email', value: email }, phone && { kind: 'phone', value: phone.value }].filter(Boolean).map(x => ({ ...x, hash: idHash(x.kind, x.value) }));
  const rule = await ruleFor(country);

  return tx(async ({ q, one }) => {
    // 1. the same person, found by any identity
    const found = await one(`SELECT p.* FROM lp_identities i JOIN lp_persons p ON p.id=i.person_id WHERE i.value_hash = ANY($1) ORDER BY p.id LIMIT 1`, [ids.map(i => i.hash)]);
    const person = found
      ? await one(`UPDATE lp_persons SET full_name=COALESCE(full_name,$2), country=COALESCE(country,$3), city=COALESCE($4,city), language=COALESCE(language,$5),
          last_seen_at=$6, updated_at=now() WHERE id=$1 RETURNING *`, [found.id, clean(lead.name, 120), country, clean(lead.city, 80), clean(lead.language, 10), at])
      : await one(`INSERT INTO lp_persons (owner_client_id, full_name, country, city, language, created_at, last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
          [lead.clientId || null, clean(lead.name, 120), country, clean(lead.city, 80), clean(lead.language, 10), at]);
    for (const i of ids)
      await q(`INSERT INTO lp_identities (person_id, kind, value, value_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (kind, value_hash) DO NOTHING`, [person.id, i.kind, i.value, i.hash]);

    // 2. attributes: only allowed keys, values without health or other special details
    const rejected = [];
    for (const [key, raw] of Object.entries(lead.attributes || {})) {
      const value = clean(raw, 300);
      if (!value) continue;
      const okKey = attributeAllowed(key, { source: lead.source });
      if (!okKey.ok || !valueAllowed(value)) { rejected.push(`${key}: ${okKey.ok ? 'value mentions a sensitive detail' : okKey.why}`); continue; }
      await q(`INSERT INTO lp_attributes (person_id, key, value, source, confidence, observed_at) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (person_id, key, source) DO UPDATE SET value=EXCLUDED.value, observed_at=EXCLUDED.observed_at`, [person.id, key.toLowerCase(), value, lead.source, lead.confidence ?? 1, at]);
    }

    // 3. what they want
    if (lead.interest?.vertical)
      await q(`INSERT INTO lp_interests (person_id, vertical, intent, budget, timing, score, source, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, $8::timestamptz + interval '180 days')`,
        [person.id, clean(lead.interest.vertical, 60).toLowerCase(), valueAllowed(lead.interest.intent) ? clean(lead.interest.intent, 300) : null, clean(lead.interest.budget, 60),
          clean(lead.interest.timing, 30), 50 + (TIMING_POINTS[String(lead.interest.timing || '').toLowerCase()] || 0), lead.source, at]);

    // 4. consents, each with its signed certificate
    const consentIds = [];
    const given = (lead.consents || []).filter(c => c && c.channel && c.text);
    for (const c of given) {
      const th = textHash(c.text);
      const t = await one(`INSERT INTO lp_consent_texts (text, text_hash) VALUES ($1,$2) ON CONFLICT (text_hash) DO UPDATE SET text_hash=EXCLUDED.text_hash RETURNING id`, [c.text, th]);
      const rec = { person_id: person.id, channel: c.channel, purpose: c.purpose || 'marketing', buyers: (c.buyers || [lead.clientId]).filter(Boolean).map(Number),
        text_hash: th, method: c.method || 'checkbox', jurisdiction: country, source: lead.source, page_url: lead.page_url || null, ip: lead.ip || null,
        user_agent: clean(lead.user_agent, 400), evidence: lead.evidence || {}, captured_at: at.toISOString() };
      const months = rule.consentMonths;
      const needsConfirm = rule.doubleOptIn && c.channel === 'email' && rec.method !== 'double_opt_in';
      const row = await one(`INSERT INTO lp_consents (person_id, channel, purpose, buyers, text_id, method, jurisdiction, source, page_url, ip, user_agent, evidence, certificate,
          confirm_token, captured_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, CASE WHEN $16::int IS NULL THEN NULL ELSE $15::timestamptz + make_interval(months => $16::int) END) RETURNING id`,
        [rec.person_id, rec.channel, rec.purpose, rec.buyers, t.id, rec.method, rec.jurisdiction, rec.source, rec.page_url, rec.ip, rec.user_agent, JSON.stringify(rec.evidence),
          certify(rec), needsConfirm ? crypto.randomBytes(18).toString('base64url') : null, rec.captured_at, months]);
      consentIds.push(row.id);
    }
    // fresh, explicit marketing consent lifts an earlier opt-out for the businesses it names
    if (given.some(c => (c.purpose || 'marketing') === 'marketing'))
      await q(`DELETE FROM lp_suppressions WHERE value_hash = ANY($1) AND (scope='global' OR scope = ANY($2))`, [ids.map(i => i.hash), given.flatMap(c => (c.buyers || [lead.clientId]).map(b => `client:${b}`))]);

    await q(`INSERT INTO lp_events (person_id, type, source, payload, at) VALUES ($1,$2,$3,$4,$5)`,
      [person.id, lead.event || 'captured', lead.source, JSON.stringify({ ...(lead.evidence || {}), rejected: rejected.length ? rejected : undefined }), at]);
    await rescore(person.id, { q, one });
    return { personId: person.id, created: !found, consentIds, rejected };
  });
}

// Lead score 0-100: how complete (40) + how ready to buy (30) + how fresh (20) + reachable with consent (10)
export async function rescore(personId, db = { q, one }) {
  const p = await db.one(`SELECT p.*,
      (SELECT count(*) FROM lp_identities i WHERE i.person_id=p.id AND i.kind='email')::int AS emails,
      (SELECT count(*) FROM lp_identities i WHERE i.person_id=p.id AND i.kind='phone')::int AS phones,
      (SELECT count(DISTINCT key) FROM lp_attributes a WHERE a.person_id=p.id)::int AS attrs,
      (SELECT max(score) FROM lp_interests t WHERE t.person_id=p.id AND (t.expires_at IS NULL OR t.expires_at > now()))::int AS intent,
      (SELECT count(*) FROM lp_consents c WHERE c.person_id=p.id AND c.purpose='marketing' AND c.withdrawn_at IS NULL)::int AS consents
    FROM lp_persons p WHERE p.id=$1`, [personId]);
  if (!p) return 0;
  const complete = Math.min(40, (p.full_name ? 8 : 0) + (p.emails ? 8 : 0) + (p.phones ? 8 : 0) + (p.city ? 4 : 0) + Math.min(12, p.attrs * 3));
  const intent = Math.max(0, Math.min(30, (p.intent || 0) - 50));
  const days = (Date.now() - new Date(p.last_seen_at)) / 864e5;
  const fresh = Math.round(20 * Math.max(0, 1 - days / 90));
  const score = complete + intent + fresh + (p.consents ? 10 : 0);
  await db.q('UPDATE lp_persons SET score=$2 WHERE id=$1', [personId, score]);
  return score;
}

// Opt-out: withdraw marketing consent (all channels or one) and suppress every identity of the person.
export async function withdraw(personId, { how = 'request', channel = null, clientId = null } = {}) {
  return tx(async ({ q }) => {
    const done = await q(`UPDATE lp_consents SET withdrawn_at=now(), withdrawn_how=$3 WHERE person_id=$1 AND purpose='marketing' AND withdrawn_at IS NULL
      AND ($2::text IS NULL OR channel=$2) AND ($4::int IS NULL OR $4 = ANY(buyers)) RETURNING id`, [personId, channel, how, clientId]);
    const scope = channel ? `channel:${channel}` : clientId ? `client:${clientId}` : 'global';
    await q(`INSERT INTO lp_suppressions (value_hash, scope, reason) SELECT value_hash, $2, $3 FROM lp_identities WHERE person_id=$1 ON CONFLICT DO NOTHING`, [personId, scope, how]);
    await q(`INSERT INTO lp_events (person_id, type, source, payload) VALUES ($1,'opt_out',$2,$3)`, [personId, how, JSON.stringify({ channel, clientId, consents: done.length })]);
    return { withdrawn: done.length, scope };
  });
}

function clean(v, max) { const s = v == null ? '' : String(v).replace(/[\u0000-\u001f]/g, ' ').trim(); return s ? s.slice(0, max) : null; }
