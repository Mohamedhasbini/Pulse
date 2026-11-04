// Incoming messages are written down before the channel is told "received". WhatsApp (Meta, Kapso) does not resend
// a message it got a 200 for, so a message that was mid-reply when the app restarted used to be lost for good.
// Now: store -> answer 200 -> work from the stored copy -> mark done. On start-up anything still 'new' or
// 'working' from the last day is picked up again; the receptionist itself ignores a message it already saved.
import { q, one } from './db.js';

let busy = 0; // messages being worked on right now (a clean stop waits for them)
export const inFlight = () => busy;

// Write each parsed message down; returns their ids. Throws if the database is down (the caller then answers 500,
// so the channel retries later instead of the message being dropped).
export async function receive(source, messages) {
  const ids = [];
  for (const m of messages) ids.push((await one(`INSERT INTO inbound (source, payload) VALUES ($1,$2) RETURNING id`, [source, m])).id);
  return ids;
}

// Work one stored message with handle(payload). A failure is retried twice (next start-up), then left as 'failed'.
export async function work(id, handle) {
  const job = await one(`UPDATE inbound SET status='working', attempts=attempts+1 WHERE id=$1 AND status='new' RETURNING *`, [id]);
  if (!job) return false;
  busy++;
  try {
    await handle(job.payload, job.source);
    await q(`UPDATE inbound SET status='done', done_at=now(), error=NULL WHERE id=$1`, [id]);
    return true;
  } catch (e) {
    console.error(`Incoming ${job.source} message ${id} failed:`, e.message);
    await q(`UPDATE inbound SET status=CASE WHEN attempts >= 3 THEN 'failed' ELSE 'new' END, error=$2 WHERE id=$1`, [id, String(e.message || e).slice(0, 500)]).catch(() => {});
    return false;
  } finally { busy--; }
}

// On start-up: messages interrupted by a restart (or stored while the AI was down) are worked again, oldest first.
// Older than a day is too late to answer; finished ones are kept 30 days for checking, then removed.
export async function resume(handlers) {
  await q(`UPDATE inbound SET status='new' WHERE status='working'`);
  await q(`DELETE FROM inbound WHERE status='done' AND created_at < now() - interval '30 days'`);
  const left = await q(`SELECT id, source FROM inbound WHERE status='new' AND created_at > now() - interval '1 day' ORDER BY id`);
  if (left.length) console.log(`Answering ${left.length} message(s) that arrived before the restart`);
  for (const r of left) if (handlers[r.source]) await work(r.id, handlers[r.source]);
  return left.length;
}
