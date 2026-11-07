// Support access: how the admin opens a client's dashboard. It replaces the old "Open business" (full control, a
// 365-day cookie, the client never told).
// - Read-only on the server until the admin presses Allow changes and gives a reason.
// - Ends by itself after 60 minutes (Extend adds 30); End returns to the Lab.
// - The owner is notified and sees every visit in Settings › Security. Test businesses (is_demo) are the admin's own
//   playgrounds: they open with changes allowed and nobody is notified.
// - Everything is in the audit log. The business comes from the support session row, never from a bare id.
import crypto from 'node:crypto';
import { q, one } from './db.js';
import { notify } from './notify.js';

const KEY = crypto.createHmac('sha256', process.env.ADMIN_PASSWORD || 'ringback').update('mxai-support-access').digest();
const sig = s => crypto.createHmac('sha256', KEY).update(String(s)).digest('hex').slice(0, 40);
export const MINUTES = 60, EXTEND = 30, MAX_HOURS = 4;
export const signSupport = id => `${id}.${sig(id)}`;
function idOf(cookie) {
  const v = /(?:^|;\s*)rb_support=([^;]+)/.exec(cookie || '')?.[1], [id, s] = String(v || '').split('.');
  if (!id || !s || s.length !== 40) return null;
  return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sig(id))) ? +id : null;
}
// the admin's open support session for this request, or null (expired, ended, someone else's, forged)
export function activeSupport(adminId, cookie) {
  const id = idOf(cookie); if (!id) return null;
  return one(`SELECT s.id, s.business_id, s.can_edit, s.reason, s.edit_reason, b.name AS business, b.is_demo,
      GREATEST(0, extract(epoch FROM s.expires_at - now()))::int AS seconds_left
    FROM support_sessions s JOIN businesses b ON b.id=s.business_id
    WHERE s.id=$1 AND s.admin_id=$2 AND s.ended_at IS NULL AND s.expires_at > now()`, [id, adminId]);
}
// requests that still work while support access is read-only: reading, leaving, and the admin's own Lab routes
export const READ_ONLY_OK = /^\/api\/(admin\/|me(\/|$)|logout$|reminders\/preview$)/;

export function mountSupport(app, { adminOnly, wrap, audit, secureCookie }) {
  const cookie = (req, id, seconds) => `rb_support=${id ? signSupport(id) : ''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${id ? seconds : 0}${secureCookie(req)}`;
  const clear = req => [cookie(req, null), `rb_viewas=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie(req)}`, `rb_biz=; Path=/; Max-Age=0`];
  const endOpen = (adminId, by) => q(`UPDATE support_sessions SET ended_at=now(), ended_by=$2 WHERE admin_id=$1 AND ended_at IS NULL RETURNING business_id`, [adminId, by]);

  // Open a business with support access (the Lab's "Open" buttons call this)
  app.post('/api/admin/switch', adminOnly, wrap(async (req, res) => {
    const b = await one('SELECT id, name, is_demo FROM businesses WHERE id=$1', [+req.body.id]);
    if (!b) return res.status(404).json({ error: 'Business not found.' });
    await endOpen(req.user.id, 'opened another');
    const reason = String(req.body.reason || '').trim().slice(0, 200) || (b.is_demo ? 'Test business' : 'Support check');
    const s = await one(`INSERT INTO support_sessions (admin_id, business_id, reason, can_edit, expires_at)
      VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5)) RETURNING id`, [req.user.id, b.id, reason, !!b.is_demo, MINUTES]);
    await audit(req, 'support_started', `${b.name}: ${b.is_demo ? 'test business, changes allowed' : 'read-only'} · ${reason}`, b.id);
    if (!b.is_demo) await notify(b.id, 'support', 'MXAi support opened your dashboard (read-only)', `Reason: ${reason}. It ends by itself within an hour. You can see every visit in Settings › Security.`);
    res.set('Set-Cookie', [cookie(req, s.id, MINUTES * 60), ...clear(req).slice(1)]).json({ ...b, support: { read_only: !b.is_demo, minutes: MINUTES } });
  }));
  app.post('/api/admin/support/extend', adminOnly, wrap(async (req, res) => {
    const s = await activeSupport(req.user.id, req.get('cookie')); if (!s) return res.status(409).json({ error: 'Support access has ended.', lab: true });
    const r = await one(`UPDATE support_sessions SET expires_at = LEAST(expires_at + make_interval(mins => $2), started_at + make_interval(hours => $3))
      WHERE id=$1 RETURNING GREATEST(0, extract(epoch FROM expires_at - now()))::int AS left`, [s.id, EXTEND, MAX_HOURS]);
    await audit(req, 'support_extended', `${s.business}: ${Math.round(r.left / 60)} min left`, s.business_id);
    res.set('Set-Cookie', cookie(req, s.id, r.left)).json({ ok: true, seconds_left: r.left });
  }));
  app.post('/api/admin/support/edit', adminOnly, wrap(async (req, res) => {
    const s = await activeSupport(req.user.id, req.get('cookie')); if (!s) return res.status(409).json({ error: 'Support access has ended.', lab: true });
    const why = String(req.body.reason || '').trim().slice(0, 300);
    if (why.length < 5) return res.status(400).json({ error: 'Write why you need to change something (at least 5 characters).' });
    await q('UPDATE support_sessions SET can_edit=true, edit_reason=$2, edit_at=now() WHERE id=$1', [s.id, why]);
    await audit(req, 'support_edit_allowed', `${s.business}: ${why}`, s.business_id);
    if (!s.is_demo) await notify(s.business_id, 'support', 'MXAi support can now make changes', `Reason: ${why}. Every change is recorded.`);
    res.json({ ok: true });
  }));
  const end = wrap(async (req, res) => {
    const ended = await endOpen(req.user.id, 'admin');
    for (const e of ended) await audit(req, 'support_ended', null, e.business_id);
    res.set('Set-Cookie', clear(req)).json({ ok: true });
  });
  app.post('/api/admin/support/end', adminOnly, end);
  app.post('/api/admin/lab', adminOnly, end); // "Back to Lab" ends support access too

  // the owner's view: every time MXAi support opened this dashboard
  app.get('/api/me/support-log', wrap(async (req, res) => {
    if (req.user.role === 'staff') return res.status(403).json({ error: 'Only the account owner can see this.' });
    const biz = req.user.role === 'admin' ? (await activeSupport(req.user.id, req.get('cookie')))?.business_id : req.user.business_id;
    if (!biz) return res.json([]);
    res.json(await q(`SELECT to_char(started_at,'YYYY-MM-DD HH24:MI') AS at, reason, can_edit AS edited, edit_reason,
        ceil(extract(epoch FROM COALESCE(ended_at, LEAST(expires_at, now())) - started_at) / 60)::int AS minutes, ended_at IS NULL AND expires_at > now() AS open
      FROM support_sessions WHERE business_id=$1 ORDER BY started_at DESC LIMIT 50`, [biz]));
  }));
}
