// Growth engine: one lead batch, start to finish. discover → enrich (read each site) → reach (find and check the
// best contact) → score → keep the best N. Progress and numbers are written to eng_batches as it goes, so a batch
// can be watched live and a restart picks up where it stopped (sites read in the last 30 days are reused).
import { q, one } from '../db.js';
import { discover } from './discover.js';
import { enrich } from './enrich.js';
import { reach } from './verify.js';
import { scoreCompany, ensureEmbedding } from './score.js';
import { embedText, toVector, usage } from './ai.js';

const COLS = `id, domain, name, website, city, country, sector, size_hint, description, tech, is_company, found_via, embedding IS NOT NULL AS has_embedding`;

async function pool(items, size, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k).catch(e => ({ error: e.message })); }
  }));
  return out;
}

export async function runBatch(batchId) {
  const b = await one('SELECT b.*, c.profile, c.name AS client_name FROM eng_batches b JOIN eng_clients c ON c.id=b.client_id WHERE b.id=$1', [batchId]);
  if (!b) return;
  const profile = b.profile || {};
  const stats = { started: new Date().toISOString(), log: [] };
  const calls0 = usage.calls;
  const save = async (step, extra = {}) => {
    Object.assign(stats, extra, { ai_calls: usage.calls - calls0 });
    stats.log = stats.log.slice(-40);
    await q('UPDATE eng_batches SET status=$2, step=$3, stats=$4 WHERE id=$1', [batchId, 'running', step, JSON.stringify(stats)]);
  };
  const log = m => stats.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
  try {
    if (!profile.ideal_customer) throw new Error('This client has no profile yet.');
    // companies this client already received in earlier batches are not repeated
    const done = new Set((await q(`SELECT DISTINCT co.domain FROM eng_leads l JOIN eng_batches bb ON bb.id=l.batch_id JOIN eng_companies co ON co.id=l.company_id
      WHERE bb.client_id=$1 AND bb.id<>$2`, [b.client_id, batchId])).map(r => r.domain));

    await save('finding companies');
    const want = Math.max(b.size * 2, 40);
    const candidates = (await discover(profile, { want: want + 20, exclude: done, log })).slice(0, want);
    await save('reading websites', { candidates: candidates.length });

    let read = 0;
    const companies = (await pool(candidates, 3, async c => { const row = await enrich(c, { log }); read++; if (read % 5 === 0) await save('reading websites', { read }); return row; }))
      .filter(c => c && !c.error && c.is_company);
    await save('finding contacts', { read, companies: companies.length });

    const roles = profile.ideal_customer.roles || [];
    const contacts = await pool(companies, 2, c => reach(c, { roles, log }));
    await save('scoring', { with_contact: contacts.filter(c => c?.email).length });

    const clientVector = toVector(await embedText(`${profile.ideal_customer.summary} Sectors: ${(profile.ideal_customer.sectors || []).join(', ')}`));
    const scored = await pool(companies, 2, async (c, k) => {
      const row = await one(`SELECT ${COLS} FROM eng_companies WHERE id=$1`, [c.id]);
      await ensureEmbedding(row);
      const contact = contacts[k] && !contacts[k].error ? contacts[k] : null;
      return { company: row, contact, ...(await scoreCompany(row, profile, clientVector, contact)) };
    });

    const best = scored.filter(s => s && !s.error).sort((a, b) => b.score - a.score).slice(0, b.size);
    await q('DELETE FROM eng_leads WHERE batch_id=$1', [batchId]);
    let rank = 0;
    for (const s of best)
      await q(`INSERT INTO eng_leads (batch_id, company_id, contact_id, fit, similarity, score, reasons, rank) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [batchId, s.company.id, s.contact?.id || null, s.fit, s.similarity, s.score, JSON.stringify(s.reasons), ++rank]);

    const st = best.map(s => s.contact?.email_status || 'none');
    Object.assign(stats, {
      leads: best.length, fit_70: best.filter(s => s.fit >= 70).length, avg_fit: best.length ? Math.round(best.reduce((x, s) => x + s.fit, 0) / best.length) : 0,
      email_valid: st.filter(x => x === 'valid').length, email_catch_all: st.filter(x => x === 'catch_all').length, no_email: st.filter(x => x === 'none').length,
      errors: scored.filter(s => s?.error).length, finished: new Date().toISOString(), ai_calls: usage.calls - calls0,
    });
    log(`done: ${best.length} leads`);
    await q(`UPDATE eng_batches SET status='done', step=NULL, stats=$2, finished_at=now() WHERE id=$1`, [batchId, JSON.stringify(stats)]);
  } catch (e) {
    log(`failed: ${e.message}`);
    await q(`UPDATE eng_batches SET status='failed', error=$2, stats=$3, finished_at=now() WHERE id=$1`, [batchId, String(e.message).slice(0, 500), JSON.stringify(stats)]);
    throw e;
  }
}
