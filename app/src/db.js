import pg from 'pg';
import fs from 'node:fs';
import { currentTz, DEFAULT_TZ } from './clock.js';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
// A dropped idle connection (database restart, network blip) must not crash the app: log it; the pool reconnects on the next query
pool.on('error', e => console.error('Database connection lost (will reconnect):', e.message));
// Dates in SQL (daily chart, busy hours) use the business time zone, like the rest of the app.
// search_path is pinned too: pooled cloud connections (Neon) can carry an empty one left by a pg_dump restore.
pool.on('connect', c => c.query(`SET TIME ZONE '${DEFAULT_TZ.replace(/'/g, '')}'; SET search_path TO public`));
// On a business's clock (clock.js inZone) dates in SQL (to_char, date_trunc, ::date, extract) use that business's zone.
// Businesses in the server's own zone (all of Lebanon today) take the plain path; others pay two tiny extra round trips.
export const q = async (text, params) => {
  const tz = currentTz();
  if (tz === DEFAULT_TZ) return (await pool.query(text, params)).rows;
  const c = await pool.connect();
  try { await c.query(`SET TIME ZONE '${tz}'`); return (await c.query(text, params)).rows; }
  finally { await c.query(`SET TIME ZONE '${DEFAULT_TZ}'`).catch(() => {}); c.release(); }
};
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
// The lock is a Postgres advisory lock held on its own connection: it covers every app process (a second container,
// the AI queue, a script), not just this one. Waiting callers queue in order; the lock is released whatever fn does.
const locks = new Map(); // in-process queue: one connection per business at a time, so the pool is never flooded
export function withBusinessLock(bizId, fn) {
  const key = `biz-lock:${bizId}`;
  const job = async () => {
    const c = await pool.connect();
    try { await c.query('SELECT pg_advisory_lock(hashtext($1))', [key]); return await fn(); }
    finally { await c.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {}); c.release(); }
  };
  const prev = locks.get(bizId) || Promise.resolve();
  const run = prev.then(job, job);
  locks.set(bizId, run.catch(() => {}));
  return run;
}
