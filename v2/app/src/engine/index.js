// Growth engine: background jobs (pg-boss, inside Postgres) and the admin API of the lead quality lab.
// Jobs: eng.client (build a client's business brain from its website), eng.batch (find, check and score leads).
// Every route is admin-only (Lab). The grading page is public/eng-lab.html.
import { PgBoss } from 'pg-boss';
import { q, one } from '../db.js';
import { engineReady } from './services.js';
import { buildProfile, Profile } from './brain.js';
import { runBatch } from './pipeline.js';

let boss = null;
const HOURS = 3600;

export async function startEngine() {
  if (!engineReady()) { console.log('Growth engine: services not configured (docker-compose.override.yml), lab off'); return; }
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', e => console.error('Growth engine queue:', e.message));
  await boss.start();
  await boss.createQueue('eng.client', { retryLimit: 1, expireInSeconds: 15 * 60 });
  await boss.createQueue('eng.batch', { retryLimit: 0, expireInSeconds: 3 * HOURS });
  await boss.work('eng.client', async ([job]) => buildClient(job.data.id));
  await boss.work('eng.batch', async ([job]) => runBatch(job.data.id));
  // a batch that was running when the app stopped is started again
  for (const b of await q(`SELECT id FROM eng_batches WHERE status='running' AND created_at > now() - interval '1 day'`))
    await boss.send('eng.batch', { id: b.id });
  console.log('Growth engine: lead quality lab ready');
}

async function buildClient(id) {
  const c = await one('SELECT * FROM eng_clients WHERE id=$1', [id]);
  if (!c) return;
  try {
    const profile = await buildProfile({ website: c.website, name: c.name, notes: c.profile?.notes || '' });
    await q(`UPDATE eng_clients SET profile=$2, status='ready', error=NULL, updated_at=now() WHERE id=$1`, [id, JSON.stringify({ ...profile, notes: c.profile?.notes || '' })]);
  } catch (e) {
    await q(`UPDATE eng_clients SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [id, String(e.message).slice(0, 400)]);
  }
}

const gradeStats = clientId => one(`SELECT count(g.*)::int AS graded,
    count(*) FILTER (WHERE g.grade='contact')::int AS contact, count(*) FILTER (WHERE g.grade='maybe')::int AS maybe, count(*) FILTER (WHERE g.grade='no')::int AS no
  FROM eng_leads l JOIN eng_batches b ON b.id=l.batch_id LEFT JOIN eng_grades g ON g.lead_id=l.id WHERE ($1::int IS NULL OR b.client_id=$1)`, [clientId ?? null]);

export function mountEngine(app, { adminOnly, wrap }) {
  const need = (req, res, next) => (boss ? next() : res.status(503).json({ error: 'The growth engine is not running on this computer.' }));

  app.get('/api/eng/clients', adminOnly, wrap(async (_req, res) => res.json(await q(`SELECT c.id, c.name, c.website, c.status, c.error, c.updated_at,
      c.profile->>'offer' AS offer, (SELECT count(*)::int FROM eng_batches b WHERE b.client_id=c.id) AS batches FROM eng_clients c ORDER BY c.id DESC`))));

  app.post('/api/eng/clients', adminOnly, need, wrap(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 120), website = String(req.body.website || '').trim().slice(0, 300), notes = String(req.body.notes || '').trim().slice(0, 2000);
    if (!name || !website) return res.status(400).json({ error: 'Name and website are needed.' });
    const c = await one(`INSERT INTO eng_clients (name, website, profile) VALUES ($1,$2,$3) RETURNING id`, [name, website, JSON.stringify({ notes })]);
    await boss.send('eng.client', { id: c.id });
    res.json({ id: c.id });
  }));

  app.get('/api/eng/clients/:id', adminOnly, wrap(async (req, res) => {
    const c = await one('SELECT * FROM eng_clients WHERE id=$1', [+req.params.id]);
    if (!c) return res.sendStatus(404);
    const batches = await q(`SELECT id, size, status, step, stats, error, created_at, finished_at FROM eng_batches WHERE client_id=$1 ORDER BY id DESC`, [c.id]);
    res.json({ ...c, batches, grades: await gradeStats(c.id) });
  }));

  // the owner corrects the profile; only known fields are kept, checked against the same shape the AI fills
  app.put('/api/eng/clients/:id/profile', adminOnly, wrap(async (req, res) => {
    const c = await one('SELECT profile FROM eng_clients WHERE id=$1', [+req.params.id]);
    if (!c) return res.sendStatus(404);
    const parsed = Profile.partial().safeParse(req.body.profile || {});
    if (!parsed.success) return res.status(400).json({ error: 'That profile has fields in the wrong format.' });
    await q(`UPDATE eng_clients SET profile=$2, updated_at=now() WHERE id=$1`, [+req.params.id, JSON.stringify({ ...c.profile, ...parsed.data })]);
    res.json({ ok: true });
  }));

  app.post('/api/eng/clients/:id/rebuild', adminOnly, need, wrap(async (req, res) => {
    const notes = req.body.notes != null ? String(req.body.notes).slice(0, 2000) : null;
    if (notes != null) await q(`UPDATE eng_clients SET profile = profile || jsonb_build_object('notes', $2::text) WHERE id=$1`, [+req.params.id, notes]);
    await q(`UPDATE eng_clients SET status='new' WHERE id=$1`, [+req.params.id]);
    await boss.send('eng.client', { id: +req.params.id });
    res.json({ ok: true });
  }));

  app.post('/api/eng/clients/:id/batches', adminOnly, need, wrap(async (req, res) => {
    const c = await one(`SELECT id, status FROM eng_clients WHERE id=$1`, [+req.params.id]);
    if (!c) return res.sendStatus(404);
    if (c.status !== 'ready') return res.status(400).json({ error: 'The business profile is not ready yet.' });
    if (await one(`SELECT 1 FROM eng_batches WHERE client_id=$1 AND status IN ('queued','running')`, [c.id])) return res.status(409).json({ error: 'A batch is already running for this business.' });
    const size = Math.min(Math.max(+req.body.size || 50, 5), 100);
    const b = await one(`INSERT INTO eng_batches (client_id, size) VALUES ($1,$2) RETURNING id`, [c.id, size]);
    await boss.send('eng.batch', { id: b.id });
    res.json({ id: b.id });
  }));

  app.get('/api/eng/batches/:id', adminOnly, wrap(async (req, res) => {
    const b = await one('SELECT * FROM eng_batches WHERE id=$1', [+req.params.id]);
    if (!b) return res.sendStatus(404);
    const leads = await q(`SELECT l.id, l.rank, l.fit, l.similarity, l.score, l.reasons, co.id AS company_id, co.name, co.domain, co.website, co.city, co.sector,
        co.size_hint, co.description, co.tech, co.found_via, ct.name AS contact_name, ct.role AS contact_role, ct.email, ct.email_status, ct.email_kind,
        ct.source_url AS contact_source, ct.quote AS contact_quote, g.grade, g.reason AS grade_reason
      FROM eng_leads l JOIN eng_companies co ON co.id=l.company_id LEFT JOIN eng_contacts ct ON ct.id=l.contact_id LEFT JOIN eng_grades g ON g.lead_id=l.id
      WHERE l.batch_id=$1 ORDER BY l.rank`, [b.id]);
    res.json({ ...b, leads });
  }));

  app.post('/api/eng/leads/:id/grade', adminOnly, wrap(async (req, res) => {
    const grade = ['contact', 'maybe', 'no'].includes(req.body.grade) ? req.body.grade : null;
    if (!grade) return res.status(400).json({ error: 'Grade must be contact, maybe or no.' });
    if (!(await one('SELECT 1 FROM eng_leads WHERE id=$1', [+req.params.id]))) return res.sendStatus(404);
    await q(`INSERT INTO eng_grades (lead_id, grade, reason) VALUES ($1,$2,$3) ON CONFLICT (lead_id) DO UPDATE SET grade=$2, reason=$3, graded_at=now()`,
      [+req.params.id, grade, req.body.reason ? String(req.body.reason).slice(0, 300) : null]);
    res.json({ ok: true });
  }));

  // the quality bar: share of graded leads the owner would contact (target 70%)
  app.get('/api/eng/quality', adminOnly, wrap(async (_req, res) => res.json(await gradeStats(null))));
}
