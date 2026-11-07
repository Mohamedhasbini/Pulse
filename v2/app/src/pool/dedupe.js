// Duplicate people. Capture already merges anyone who comes back with the same email or phone. This finds the rest:
//   sure   the same mailbox written differently (gmail dots, +tags, googlemail.com): merged automatically
//   maybe  a very similar name in the same country plus a shared clue (same city, same last 7 phone digits,
//          same email name at another domain): listed for a person to decide (Merge / Not the same)
// Runs inside Postgres with pg_trgm (name similarity), so it needs no extra service. For very large imports the
// Splink worker in mxai-stack/lab can be used instead (docs/repos.md).
import { q, one, tx } from '../db.js';
import { rescore } from './capture.js';

export async function findDuplicates({ autoMerge = true } = {}) {
  let merged = 0;
  if (autoMerge) {
    const sure = await q(`SELECT DISTINCT LEAST(a.person_id, b.person_id) AS keep, GREATEST(a.person_id, b.person_id) AS drop
      FROM lp_identities a JOIN lp_identities b ON a.match_key = b.match_key AND a.kind='email' AND b.kind='email' AND a.person_id <> b.person_id
      WHERE a.match_key IS NOT NULL ORDER BY 1, 2 LIMIT 500`);
    const gone = new Set();
    for (const s of sure) if (!gone.has(s.drop) && !gone.has(s.keep)) { await mergePeople(s.keep, s.drop, 'same mailbox'); gone.add(s.drop); merged++; }
  }
  const maybe = await q(`
    WITH pairs AS (
      SELECT a.id AS a, b.id AS b, similarity(lower(a.full_name), lower(b.full_name)) AS sim, a.city IS NOT NULL AND lower(a.city) = lower(b.city) AS same_city,
        EXISTS (SELECT 1 FROM lp_identities x JOIN lp_identities y ON x.kind='phone' AND y.kind='phone' AND right(x.value, 7) = right(y.value, 7) WHERE x.person_id=a.id AND y.person_id=b.id) AS phone7,
        EXISTS (SELECT 1 FROM lp_identities x JOIN lp_identities y ON x.kind='email' AND y.kind='email' AND split_part(x.match_key,'@',1) = split_part(y.match_key,'@',1) AND length(split_part(x.match_key,'@',1)) >= 5
          WHERE x.person_id=a.id AND y.person_id=b.id) AS email_name
      FROM lp_persons a JOIN lp_persons b ON a.id < b.id AND a.country IS NOT DISTINCT FROM b.country AND lower(a.full_name) % lower(b.full_name)
      WHERE a.full_name IS NOT NULL AND b.full_name IS NOT NULL)
    INSERT INTO lp_merge_candidates (a, b, score, reasons)
    SELECT a, b, round((sim * 0.6 + (same_city::int * 0.15) + (phone7::int * 0.3) + (email_name::int * 0.25))::numeric, 2),
      array_remove(ARRAY['similar name (' || round(sim::numeric * 100) || '%)', CASE WHEN same_city THEN 'same city' END, CASE WHEN phone7 THEN 'phone ends the same' END, CASE WHEN email_name THEN 'same email name' END], NULL)
    FROM pairs WHERE sim >= 0.55 AND (same_city OR phone7 OR email_name)
    ON CONFLICT (a, b) DO UPDATE SET score=EXCLUDED.score, reasons=EXCLUDED.reasons WHERE lp_merge_candidates.status='open'
    RETURNING id`);
  return { merged, candidates: maybe.length };
}

// move everything from `drop` to `keep`, then delete `drop`. Consent rows move with their certificates intact:
// signed_person_id keeps the id they were signed for, and the merge event records what moved.
export async function mergePeople(keep, drop, why = 'admin') {
  if (!keep || !drop || keep === drop) throw Object.assign(new Error('Pick two different people.'), { status: 400 });
  const out = await tx(async ({ q, one }) => {
    const [k, d] = [await one('SELECT * FROM lp_persons WHERE id=$1 FOR UPDATE', [keep]), await one('SELECT * FROM lp_persons WHERE id=$1 FOR UPDATE', [drop])];
    if (!k || !d) throw Object.assign(new Error('One of these people no longer exists.'), { status: 404 });
    const consents = await q('SELECT id, person_id, certificate FROM lp_consents WHERE person_id=$1', [drop]);
    await q(`UPDATE lp_persons SET full_name=COALESCE(full_name,$2), country=COALESCE(country,$3), city=COALESCE(city,$4), language=COALESCE(language,$5),
      created_at=LEAST(created_at,$6), last_seen_at=GREATEST(last_seen_at,$7), updated_at=now() WHERE id=$1`, [keep, d.full_name, d.country, d.city, d.language, d.created_at, d.last_seen_at]);
    await q('UPDATE lp_identities SET person_id=$1 WHERE person_id=$2', [keep, drop]);
    await q(`INSERT INTO lp_attributes (person_id, key, value, source, confidence, consent_id, observed_at, expires_at)
      SELECT $1, key, value, source, confidence, consent_id, observed_at, expires_at FROM lp_attributes WHERE person_id=$2 ON CONFLICT (person_id, key, source) DO NOTHING`, [keep, drop]);
    await q('UPDATE lp_consents SET signed_person_id=COALESCE(signed_person_id, person_id), person_id=$1 WHERE person_id=$2', [keep, drop]);
    for (const t of ['lp_interests', 'lp_events', 'lp_rule_log', 'lp_deliveries', 'lp_codes']) await q(`UPDATE ${t} SET person_id=$1 WHERE person_id=$2`, [keep, drop]);
    await q(`UPDATE lp_merge_candidates SET status='merged', decided_at=now() WHERE (a=$1 AND b=$2) OR (a=$2 AND b=$1)`, [keep, drop]);
    await q(`INSERT INTO lp_events (person_id, type, source, payload) VALUES ($1,'merged',$2,$3)`,
      [keep, why, JSON.stringify({ from_person: drop, from_name: d.full_name, consents_moved: consents.map(c => ({ id: c.id, signed_for_person: c.person_id, certificate: c.certificate })) })]);
    await q('DELETE FROM lp_persons WHERE id=$1', [drop]);
    return { keep, dropped: drop, consentsMoved: consents.length };
  });
  await rescore(keep);
  return out;
}

export const listCandidates = (status = 'open') => q(`SELECT m.*, json_build_object('id', a.id, 'name', a.full_name, 'country', a.country, 'city', a.city, 'created_at', a.created_at,
    'email', (SELECT value FROM lp_identities WHERE person_id=a.id AND kind='email' LIMIT 1), 'phone', (SELECT value FROM lp_identities WHERE person_id=a.id AND kind='phone' LIMIT 1)) AS pa,
  json_build_object('id', b.id, 'name', b.full_name, 'country', b.country, 'city', b.city, 'created_at', b.created_at,
    'email', (SELECT value FROM lp_identities WHERE person_id=b.id AND kind='email' LIMIT 1), 'phone', (SELECT value FROM lp_identities WHERE person_id=b.id AND kind='phone' LIMIT 1)) AS pb
  FROM lp_merge_candidates m JOIN lp_persons a ON a.id=m.a JOIN lp_persons b ON b.id=m.b WHERE m.status=$1 ORDER BY m.score DESC, m.id LIMIT 200`, [status]);

export const markDifferent = id => one(`UPDATE lp_merge_candidates SET status='different', decided_at=now() WHERE id=$1 RETURNING id`, [id]);
