import pg from 'pg';
import fs from 'node:fs';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// Dates in SQL (daily chart, busy hours) use the business time zone, like the rest of the app.
// search_path is pinned too: pooled cloud connections (Neon) can carry an empty one left by a pg_dump restore.
pool.on('connect', c => c.query(`SET TIME ZONE '${(process.env.TZ || 'UTC').replace(/'/g, '')}'; SET search_path TO public`));
export const q = (text, params) => pool.query(text, params).then(r => r.rows);
export const one = async (text, params) => (await q(text, params))[0];

export async function migrate() {
  await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const existing = await one('SELECT id FROM businesses LIMIT 1');
  if (existing) return;
  const b = await one(
    `INSERT INTO businesses (name, address, open_hour, close_hour, closed_days, faq, hours)
     VALUES ($1,$2,10,20,'{0}',$3,$4) RETURNING id`,
    ['Layla Beauty Salon', '14 Hamra Street, Beirut',
     'Free parking behind the building. We accept cash, card and Apple Pay. Please cancel at least 4 hours ahead.',
     JSON.stringify({ 0: [], 1: [['10:00', '20:00']], 2: [['10:00', '20:00']], 3: [['10:00', '20:00']], 4: [['10:00', '20:00']], 5: [['10:00', '20:00']], 6: [['10:00', '18:00']] })]);
  for (const [name, price, minutes] of [['Haircut & blow-dry', 35, 45], ['Hair colour', 90, 120], ['Manicure', 20, 30], ['Facial', 55, 60]]) {
    await q('INSERT INTO services (business_id, name, price, minutes) VALUES ($1,$2,$3,$4)', [b.id, name, price, minutes]);
  }
  console.log('Seeded example business', b.id);
}

// Runs fn while holding a lock for this business, so booking checks and inserts never interleave.
const locks = new Map();
export function withBusinessLock(bizId, fn) {
  const prev = locks.get(bizId) || Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(bizId, run.catch(() => {}));
  return run;
}
