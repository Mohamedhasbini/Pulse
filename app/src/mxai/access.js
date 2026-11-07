// Layer 05: access. Who is asking, and what that audience and role may see and do.
// Internal access comes only from a signed-in session (user + role) on a non-customer channel, never from what a
// message says: "I'm the owner" typed on WhatsApp is still a customer.
// tools.js, features.js and switches.js are imported lazily (they reach the database), so this file loads and tests
// without Postgres; tests pass their own registry and checks through `deps`.

export const CUSTOMER_CHANNELS = new Set(['whatsapp', 'telegram', 'instagram', 'webook', 'web', 'test']);
const INTERNAL = new Set(['owner', 'staff', 'admin']);
export const AUDIENCES = ['customer', 'owner', 'staff', 'admin'];

// A customer channel always means a customer, even when the owner is signed in (the test chat plays a customer).
// Otherwise a signed-in user with a known role is that role; anything unknown falls back to the least access.
export function audienceOf({ channel, user } = {}) {
  if (channel && CUSTOMER_CHANNELS.has(String(channel).toLowerCase())) return 'customer';
  const role = user && typeof user === 'object' ? user.role : null;
  return INTERNAL.has(role) ? role : 'customer';
}

// Staff see the owner's numbers only when the dashboard would show them those sections anyway.
const staffSeesNumbers = user => ['overview', 'insights'].some(m => (user?.permissions || []).includes(m));

// kinds: public (business facts) | own_customer (that customer's own records) | owner (internal numbers and other clients)
export function canSee(audience, kind, user = null) {
  if (kind === 'public' || kind === 'own_customer') return AUDIENCES.includes(audience);
  if (kind === 'owner') return audience === 'owner' || audience === 'admin' || (audience === 'staff' && staffSeesNumbers(user));
  return false;
}

const has = (list, v) => Array.isArray(list) ? list.includes(v) : list instanceof Set ? list.has(v) : list === v;

// The tool names this audience + role may use for this business right now. Each tool declares
// { audiences, roles, feature?, switchKey?, module? }. Checks, all must pass:
//   audience and role listed; the plan feature on (features.js); the Lab switch on (switches.js);
//   for staff, the dashboard section (`module`) ticked for them; a tool with no module counts as owner-only.
// A customer audience never gets the internal `mxai` role's tools, whatever the caller passes.
export async function allowedTools(biz, audience, role, user = null, deps = {}) {
  const out = new Set();
  if (!AUDIENCES.includes(audience)) return out;
  if (audience === 'customer' && role === 'mxai') return out;
  if (audience !== 'customer' && role !== 'mxai') return out; // internal audiences speak to MXAi, not a customer role
  const tools = deps.tools || (await import('./tools.js')).TOOLS || {};
  const hasFeature = deps.hasFeature || (await import('../features.js')).hasFeature;
  const allowedFor = deps.allowedFor || (await import('../switches.js')).allowedFor;
  const canOpen = deps.canOpen || ((u, m) => u?.role !== 'staff' || (u?.permissions || []).includes(m));
  const feats = new Map();
  for (const [name, t] of Object.entries(tools)) {
    if (!t || !has(t.audiences, audience) || !has(t.roles, role)) continue;
    if (t.feature) {
      if (!feats.has(t.feature)) feats.set(t.feature, !!(await hasFeature(biz?.id, t.feature).catch(() => false)));
      if (!feats.get(t.feature)) continue;
    }
    if (t.switchKey && !(await allowedFor(biz?.id, t.switchKey).catch(() => false))) continue;
    if (audience === 'staff' && !canOpen(user || { role: 'staff' }, t.permission || t.module || 'owner')) continue;
    out.add(name);
  }
  return out;
}
