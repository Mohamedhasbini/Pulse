// Upgrades go through the admin. An owner who opens a locked feature presses Request; the request waits in the Lab;
// the admin approves (the matching add-on is added, or the feature is switched on for that business) or declines.
// Every step is in the audit log, and the admin's phone is told about each new request.
import { q, one } from './db.js';
import { FEATURES, hasFeature } from './features.js';
import { alertAdmin } from './ops.js';
import { registry, KNOWN } from './controls.js';
import { setBusiness } from './switches.js';
const isConn = f => f.startsWith('integration:') && KNOWN().has(f);
const nameOf = f => FEATURES[f] || registry().find(i => i.key === f)?.name || f;
import { notify } from './notify.js';

export const pendingFor = async biz => (await q(`SELECT feature FROM upgrade_requests WHERE business_id=$1 AND status='pending'`, [biz])).map(r => r.feature);

export function mountUpgrades(app, { adminOnly, wrap, audit, BIZ }) {
  app.post('/api/upgrade-requests', wrap(async (req, res) => {
    const f = String(req.body.feature || '');
    if (!FEATURES[f] && !isConn(f)) return res.status(400).json({ error: 'Unknown feature.' });
    if (req.user.role === 'admin') return res.status(400).json({ error: 'You are the admin: switch it on in the Lab.' });
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only the account owner can ask for an upgrade.' });
    const r = await one(`INSERT INTO upgrade_requests (business_id, feature, note, requested_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT (business_id, feature) WHERE status='pending' DO NOTHING RETURNING id`, [BIZ(), f, String(req.body.note || '').slice(0, 300) || null, req.user.id]);
    if (r) {
      const b = await one('SELECT name FROM businesses WHERE id=$1', [BIZ()]);
      await audit(req, 'upgrade_requested', nameOf(f), BIZ());
      if (!/^(smoke|e2e|test)/i.test(b.name)) alertAdmin(`${b.name} asks for: ${nameOf(f)}. Approve or decline it in the Lab.`).catch(() => {});
    }
    res.json({ ok: true, requested: f });
  }));

  app.get('/api/admin/upgrade-requests', adminOnly, wrap(async (_req, res) => {
    const rows = await q(`SELECT r.id, r.business_id, b.name AS business, b.is_demo, r.feature, r.note, r.status, r.decided_by,
        to_char(r.at,'YYYY-MM-DD HH24:MI') AS at, to_char(r.decided_at,'YYYY-MM-DD HH24:MI') AS decided_at,
        (SELECT a.name FROM addons a WHERE a.features ? r.feature ORDER BY a.price LIMIT 1) AS addon,
        (SELECT a.price::float FROM addons a WHERE a.features ? r.feature ORDER BY a.price LIMIT 1) AS addon_price
      FROM upgrade_requests r JOIN businesses b ON b.id=r.business_id
      ORDER BY (r.status='pending') DESC, r.at DESC LIMIT 40`);
    res.json(rows.map(r => ({ ...r, feature_name: nameOf(r.feature) })));
  }));

  app.post('/api/admin/upgrade-requests/:id', adminOnly, wrap(async (req, res) => {
    const approve = req.body.approve === true;
    const r = await one(`UPDATE upgrade_requests SET status=$2, decided_at=now(), decided_by=$3 WHERE id=$1 AND status='pending' RETURNING *`, [+req.params.id, approve ? 'approved' : 'declined', req.user.email]);
    if (!r) return res.status(404).json({ error: 'That request was already answered.' });
    if (approve && isConn(r.feature)) {
      await setBusiness(r.business_id, r.feature, true);
      await notify(r.business_id, 'upgrade', `${nameOf(r.feature)} is now available`, 'You can connect it in Settings › Integrations.');
    } else if (approve && await hasFeature(r.business_id, r.feature)) {
      await notify(r.business_id, 'upgrade', `${nameOf(r.feature)} is already on`, 'It was already in your plan. Nothing changes on your bill.');
    } else if (approve) {
      // the cheapest add-on that includes it keeps billing right; without one, the feature is switched on for them only
      const addon = await one(`SELECT key FROM addons WHERE features ? $1 ORDER BY price LIMIT 1`, [r.feature]);
      if (addon) await q(`UPDATE businesses SET addons = COALESCE(addons,'[]'::jsonb) || to_jsonb($2::text) WHERE id=$1 AND NOT COALESCE(addons,'[]'::jsonb) ? $2`, [r.business_id, addon.key]);
      else await q(`UPDATE businesses SET feature_overrides = COALESCE(feature_overrides,'{}'::jsonb) || jsonb_build_object($2::text, true) WHERE id=$1`, [r.business_id, r.feature]);
      await notify(r.business_id, 'upgrade', `${FEATURES[r.feature]} is now on`, 'Your upgrade was approved. It works from your next click.');
    }
    await audit(req, approve ? 'upgrade_approved' : 'upgrade_declined', nameOf(r.feature), r.business_id);
    res.json({ ok: true });
  }));
}
