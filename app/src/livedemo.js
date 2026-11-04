// Live demos: anyone on the website can open a real dashboard (built by instant.js) for a template, read-only.
// /demo/<template> signs the visitor in as that demo business's 'demo' login for 2 hours; every change is refused
// by demoGuard. A real session already in the browser is kept aside and comes back with /demo/exit.
import { one } from './db.js';
import { signSession, readSession } from './accounts.js';

// template → demo business (subdomain made by instant.js) and the name it was built with
export const DEMOS = {
  salon: ['glow-hair-beauty-demo', 'Glow Hair & Beauty'], gym: ['pulse-fitness-club-demo', 'Pulse Fitness Club'],
  receptionist: ['front-desk-salon-demo', 'Front Desk Salon'], clinic: ['skin-clinic-beirut-demo', 'Skin Clinic Beirut'],
};
const cookie = (name, value, age, req) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${req.secure ? '; Secure' : ''}`;

export function mountLiveDemo(app) {
  app.get('/demo/exit', (req, res) => {
    const keep = /(?:^|;\s*)rb_session_keep=([^;]+)/.exec(req.get('cookie') || '')?.[1];
    res.set('Set-Cookie', [cookie('rb_session', keep || '', keep ? 12 * 3600 : 0, req), cookie('rb_session_keep', '', 0, req)]);
    res.redirect(keep ? '/' : '/templates');
  });
  app.get('/demo/:template', async (req, res, next) => {
    try {
      const d = DEMOS[req.params.template]; if (!d) return res.redirect('/templates');
      const b = await one('SELECT id FROM businesses WHERE subdomain=$1', [d[0]]);
      if (!b) return res.redirect('/templates#soon');
      const email = `demo+${req.params.template}@demo.mxai`;
      const u = await one(`INSERT INTO users (email, name, password_hash, business_id, role) VALUES ($1,'Demo visitor','!demo-no-password',$2,'demo')
        ON CONFLICT (email) DO UPDATE SET business_id=EXCLUDED.business_id, role='demo', disabled=false RETURNING id, session_version`, [email, b.id]);
      const cur = readSession(req.get('cookie')), mine = cur && !(await one("SELECT 1 FROM users WHERE id=$1 AND role='demo'", [cur.uid]));
      const raw = /(?:^|;\s*)rb_session=([^;]+)/.exec(req.get('cookie') || '')?.[1];
      res.set('Set-Cookie', [cookie('rb_session', signSession(u.id, u.session_version, 2), 2 * 3600, req), ...(mine && raw ? [cookie('rb_session_keep', raw, 12 * 3600, req)] : [])]);
      res.redirect('/');
    } catch (e) { next(e); }
  });
}

// a demo login can look at everything and change nothing
export function demoGuard(req, res) {
  if (req.user?.role !== 'demo' || req.method === 'GET' || req.method === 'HEAD') return false;
  if (req.path === '/api/reminders/preview') return false; // a POST that only reads
  res.status(403).json({ error: 'This is a live demo, so changes are switched off. Start your own dashboard to try everything.', demo: true });
  return true;
}
