// Live dashboard: open dashboards keep one Server-Sent Events stream; anything that changes a business's
// data (new message, booking, queue, rating) calls emit() and those dashboards refresh at once, no reload.
// emit() goes through Postgres NOTIFY, so changes made by any process (the server, the AI queue, a script)
// reach every dashboard.
import pg from 'pg';
import { q } from './db.js';

const clients = new Map(); // businessId -> Set of responses
const CHANNEL = 'pulse_live';

export function mountLive(app, BIZ) {
  app.get('/api/events', (req, res) => {
    const biz = BIZ();
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    if (!clients.has(biz)) clients.set(biz, new Set());
    clients.get(biz).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000); // keeps proxies (Cloudflare) from closing it
    req.on('close', () => { clearInterval(ping); clients.get(biz)?.delete(res); });
  });
  listen();
}

// One dedicated connection listens for changes and fans them out; bursts collapse into one event per
// business every 700 ms (100 customers a minute must not mean 100 refreshes a minute).
const pending = new Map();
function push(businessId, kind) {
  if (!clients.get(businessId)?.size) return;
  const kinds = pending.get(businessId);
  if (kinds) { kinds.add(kind); return; }
  pending.set(businessId, new Set([kind]));
  setTimeout(() => {
    const data = JSON.stringify({ kinds: [...pending.get(businessId)], at: Date.now() });
    pending.delete(businessId);
    for (const res of clients.get(businessId) || []) res.write(`event: change\ndata: ${data}\n\n`);
  }, 700);
}
async function listen() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  c.on('error', () => {});
  c.on('end', () => setTimeout(listen, 3000)); // database restarted: listen again
  try {
    await c.connect();
    await c.query(`LISTEN ${CHANNEL}`);
    c.on('notification', n => { const [b, k] = String(n.payload).split(':'); push(+b, k); });
  } catch { c.end().catch(() => {}); }
}

export function emit(businessId, kind) {
  q(`SELECT pg_notify('${CHANNEL}', $1)`, [`${businessId}:${kind}`]).catch(() => {});
}
