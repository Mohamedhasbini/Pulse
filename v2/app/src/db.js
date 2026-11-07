// MXAi v2 database: its own Postgres (with pgvector). Migrations are additive (CREATE … IF NOT EXISTS) and never
// destroy data, the same rule as v1.
import pg from 'pg';
import fs from 'node:fs';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
export const q = async (text, params) => (await pool.query(text, params)).rows;
export const one = async (text, params) => (await q(text, params))[0];

export async function migrate() {
  for (let i = 0; ; i++) {
    try { await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')); return; }
    catch (e) { if (i >= 10) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
}
