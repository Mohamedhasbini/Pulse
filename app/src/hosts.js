// Which door a request came through. One app, separate doors:
//   lab.nexfoyz.dev  -> 'lab'  the Lab, admin only
//   app.nexfoyz.dev  -> 'app'  client dashboards: owners, staff, live demo; admin logins are refused here
//   localhost        -> 'dev'  this PC: everything works as before (the tests and local checks use it)
//   anything else    -> 'site' client websites and their own domains (same rules as 'app')
const LAB = () => (process.env.LAB_HOST || 'lab.nexfoyz.dev').toLowerCase();
const APP = () => (process.env.APP_HOST || 'app.nexfoyz.dev').toLowerCase();
const DEV = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'app' /* the docker service name */]);

export function surfaceOf(req) {
  const h = String(req.hostname || '').toLowerCase();
  if (h === LAB() || h === 'lab.localhost') return 'lab';
  if (h === APP()) return 'app';
  if (DEV.has(h)) return 'dev';
  return 'site';
}
// who may be signed in through which door
export const doorAllows = (surface, role) => surface === 'dev' || (surface === 'lab' ? role === 'admin' : role !== 'admin');
export const labUrl = () => 'https://' + LAB();
