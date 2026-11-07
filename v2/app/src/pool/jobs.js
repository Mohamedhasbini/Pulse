// Daily upkeep of the lead pool (pg-boss schedule, 03:30 in the server's time zone; also "Run now" on the screen).
//   1. consents past their end date or older than the country allows are closed (logged once per consent)
//   2. email double opt-ins never confirmed within 30 days are closed (they never counted)
//   3. old one-time codes are deleted (they are only needed for 10 minutes)
//   4. duplicate people: sure matches merged, likely ones listed for review
//   5. phones without a line check get one (free); new emails are checked with Reacher (up to 100 a day)
//   6. every score is recomputed, so freshness falls as leads age
// Each run is written to lp_job_runs with what it did.
import { PgBoss } from 'pg-boss';
import { q, one } from '../db.js';
import { rescore } from './capture.js';
import { findDuplicates } from './dedupe.js';
import { checkIdentity, checkEmails } from './checks.js';

let boss = null;

export async function upkeep({ emails = true } = {}) {
  const run = await one(`INSERT INTO lp_job_runs (job) VALUES ('upkeep') RETURNING id`);
  try {
    const r = {};
    // 1. consent expiry: by date, and by the country's maximum age (e.g. 24 months in Canada, 12 in France)
    const ended = await q(`UPDATE lp_consents c SET withdrawn_at=now(), withdrawn_how='expired'
      FROM lp_persons p LEFT JOIN lp_country_rules r ON r.country=p.country
      WHERE p.id=c.person_id AND c.withdrawn_at IS NULL AND c.purpose='marketing'
        AND ((c.expires_at IS NOT NULL AND c.expires_at <= now())
          OR ((r.rules->>'consentMonths') IS NOT NULL AND c.captured_at + make_interval(months => (r.rules->>'consentMonths')::int) <= now()))
      RETURNING c.id, c.person_id, c.channel`);
    for (const e of ended) await q(`INSERT INTO lp_events (person_id, type, source, payload) VALUES ($1,'consent_expired','upkeep',$2)`, [e.person_id, JSON.stringify({ consent: e.id, channel: e.channel })]);
    r.consents_expired = ended.length;
    r.expiring_30d = (await one(`SELECT count(*)::int AS n FROM lp_consents WHERE withdrawn_at IS NULL AND purpose='marketing' AND expires_at BETWEEN now() AND now() + interval '30 days'`)).n;
    // 2. double opt-in never confirmed
    const unconfirmed = await q(`UPDATE lp_consents SET withdrawn_at=now(), withdrawn_how='never_confirmed', confirm_token=NULL
      WHERE confirm_token IS NOT NULL AND confirmed_at IS NULL AND withdrawn_at IS NULL AND captured_at < now() - interval '30 days' RETURNING id`);
    r.unconfirmed_closed = unconfirmed.length;
    // 3. old codes
    r.codes_deleted = (await q(`DELETE FROM lp_codes WHERE created_at < now() - interval '1 day' RETURNING id`)).length;
    // 4. duplicates
    Object.assign(r, await findDuplicates());
    // 5. checks
    const unchecked = await q(`SELECT id, kind, value FROM lp_identities WHERE (kind='phone' AND checked_at IS NULL) OR (kind='email' AND match_key IS NULL) LIMIT 2000`);
    for (const row of unchecked) await checkIdentity(row).catch(() => {});
    r.contacts_checked = unchecked.length;
    if (emails) r.emails = await checkEmails(100);
    // 6. scores
    const ids = await q('SELECT id FROM lp_persons');
    for (const { id } of ids) await rescore(id);
    r.rescored = ids.length;
    await q(`UPDATE lp_job_runs SET finished_at=now(), result=$2 WHERE id=$1`, [run.id, JSON.stringify(r)]);
    return r;
  } catch (e) {
    await q(`UPDATE lp_job_runs SET finished_at=now(), error=$2 WHERE id=$1`, [run.id, String(e.message).slice(0, 500)]);
    throw e;
  }
}

export async function startJobs() {
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: 'pgboss_pool' });
  boss.on('error', e => console.error('Lead pool jobs:', e.message));
  await boss.start();
  await boss.createQueue('pool.upkeep', { retryLimit: 1, expireInSeconds: 3600 });
  await boss.schedule('pool.upkeep', '30 3 * * *', {}, { tz: process.env.TZ || 'UTC' });
  await boss.work('pool.upkeep', async () => upkeep());
  console.log('Lead pool: daily upkeep scheduled (03:30)');
}

export const lastRuns = () => q(`SELECT id, job, started_at, finished_at, result, error FROM lp_job_runs ORDER BY id DESC LIMIT 10`);
