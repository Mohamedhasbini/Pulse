// Data kept only as long as needed (GDPR storage limitation). Runs at start-up and every 6 hours:
// - each business may set how many months chats are kept (Lab › client › "Keep chats for"); older messages go,
//   bookings and clients stay (they are the business's records)
// - sign-in and audit records keep their IP address for 12 months, then the address is removed
// - incoming messages that could not be handled are removed after 7 days (they hold phone numbers and text)
import fs from 'node:fs';
import path from 'node:path';
import { q } from './db.js';

export async function purge() {
  const out = {};
  out.messages = (await q(`DELETE FROM messages m USING conversations c, businesses b
    WHERE m.conversation_id=c.id AND c.business_id=b.id AND b.retention_months IS NOT NULL
      AND m.created_at < now() - make_interval(months => b.retention_months) RETURNING m.id`)).length;
  out.audit_ips = (await q(`UPDATE audit_log SET ip=NULL WHERE ip IS NOT NULL AND at < now() - interval '12 months' RETURNING id`)).length;
  out.inbound = (await q(`DELETE FROM inbound WHERE status <> 'done' AND created_at < now() - interval '7 days' RETURNING id`)).length;
  out.revoked = (await q(`DELETE FROM revoked_sessions WHERE until < now() RETURNING sig`)).length;
  // copies of closed clients are kept 30 days
  try { const dir = (process.env.BACKUPS_DIR || '/backups') + '/closed';
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) { const p = path.join(dir, f); if (Date.now() - fs.statSync(p).mtimeMs > 30 * 86400e3) { fs.unlinkSync(p); out.closed = (out.closed || 0) + 1; } } } catch {}
  if (out.messages || out.audit_ips || out.inbound) console.log('Privacy clean-up:', JSON.stringify(out));
  return out;
}
export function startPrivacy() {
  const run = () => purge().catch(e => console.error('Privacy clean-up failed:', e.message));
  setTimeout(run, 60000); setInterval(run, 6 * 3600e3);
}
