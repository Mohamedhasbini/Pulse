// Inbox, Gmail style: one line per conversation (who, first words of the last message, when), folders with counts,
// unread until the owner opens it. Reading, replying and taking over use the existing /api/conversations routes.
import { q, one } from './db.js';

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
// folder → the conversations it holds (test chats only in their own folder)
const FOLDERS = {
  needs: `c.needs_attention AND c.channel<>'test'`,
  all: `c.channel<>'test'`,
  bookings: `c.channel<>'test' AND (c.kind='booking' OR c.outcome='booked')`,
  questions: `c.channel<>'test' AND c.kind='question'`,
  changes: `c.channel<>'test' AND c.kind IN ('change','cancel')`,
  complaints: `c.channel<>'test' AND (c.kind='complaint' OR c.mood='negative')`,
  test: `c.channel='test'`,
};
const UNREAD = `EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.role='customer' AND m.created_at > COALESCE(c.owner_seen_at, 'epoch'))`;

export function mountInbox(app, BIZ, LOCAL) {
  app.get('/api/inbox', wrap(async (req, res) => {
    const B = BIZ(), folder = FOLDERS[req.query.folder] ? req.query.folder : 'all';
    const limit = Math.min(Math.max(+req.query.limit || 20, 5), 60), offset = Math.max(+req.query.offset || 0, 0);
    const term = String(req.query.q || '').trim().slice(0, 80);
    const search = term ? `AND (cu.name ILIKE $2 OR cu.phone ILIKE $2 OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.text ILIKE $2))` : '';
    const args = term ? [B, `%${term}%`] : [B];
    const where = `c.business_id=$1 AND ${FOLDERS[folder]} ${search}`;
    const [rows, [{ total }], [counts]] = await Promise.all([
      q(`SELECT c.id, c.channel, c.kind, c.mood, c.outcome, c.topic, c.needs_attention, c.ai_paused, c.attention_reason, ${LOCAL('c.updated_at')} AS at,
          cu.id AS customer_id, cu.name, cu.phone, ${UNREAD} AS unread,
          (SELECT json_build_object('role', m.role, 'text', left(m.text, 140)) FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last
        FROM conversations c JOIN customers cu ON cu.id=c.customer_id WHERE ${where}
        ORDER BY c.needs_attention DESC, c.updated_at DESC LIMIT ${limit} OFFSET ${offset}`, args),
      q(`SELECT count(*)::int AS total FROM conversations c JOIN customers cu ON cu.id=c.customer_id WHERE ${where}`, args),
      q(`SELECT ${Object.entries(FOLDERS).map(([k, w]) => `count(*) FILTER (WHERE ${w}${k === 'all' || k === 'test' ? ` AND ${UNREAD}` : ''})::int AS ${k}`).join(', ')}
        FROM conversations c WHERE c.business_id=$1`, [B])]);
    res.json({ folder, total, offset, limit, rows, counts });
  }));
  // opening a conversation marks it read
  app.post('/api/inbox/:id/seen', wrap(async (req, res) => {
    await q('UPDATE conversations SET owner_seen_at=now() WHERE id=$1 AND business_id=$2', [req.params.id, BIZ()]);
    res.json({ ok: true });
  }));
  // the customer beside the chat: visits, spend, next appointment
  app.get('/api/inbox/:id/customer', wrap(async (req, res) => {
    res.json(await one(`SELECT cu.id, cu.name, cu.phone, cu.marketing_ok,
        (SELECT count(*) FROM bookings b WHERE b.customer_id=cu.id AND b.status IN ('completed','confirmed') AND b.starts_at < now())::int AS visits,
        (SELECT COALESCE(sum(price),0) FROM bookings b WHERE b.customer_id=cu.id AND b.status IN ('completed','confirmed') AND b.starts_at < now())::float AS spent,
        (SELECT ${LOCAL('b.starts_at')} || ' · ' || s.name FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.customer_id=cu.id AND b.status='confirmed' AND b.starts_at > now() ORDER BY b.starts_at LIMIT 1) AS next
      FROM conversations c JOIN customers cu ON cu.id=c.customer_id WHERE c.id=$1 AND c.business_id=$2`, [req.params.id, BIZ()]) || {});
  }));
}
