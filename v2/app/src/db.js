// MXAi v2 database: its own Postgres (with pgvector). Migrations are additive (CREATE … IF NOT EXISTS) and never
// destroy data, the same rule as v1.
import pg from 'pg';
import fs from 'node:fs';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
export const q = async (text, params) => (await pool.query(text, params)).rows;
export const one = async (text, params) => (await q(text, params))[0];
// all-or-nothing: fn gets { q, one } bound to one connection inside BEGIN/COMMIT
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const tq = async (t, p) => (await c.query(t, p)).rows;
    const out = await fn({ q: tq, one: async (t, p) => (await tq(t, p))[0] });
    await c.query('COMMIT');
    return out;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

export async function migrate() {
  for (let i = 0; ; i++) {
    try { await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')); return; }
    catch (e) { if (i >= 10) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
}
