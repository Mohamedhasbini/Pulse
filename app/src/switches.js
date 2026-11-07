// The Lab's switches: nothing outside MXAi is used unless the Lab allows it.
//   1. Platform switch (one per channel, connector or AI provider): off = off for every business, at once.
//   2. Business switch: the admin allows or blocks one item for one business. Channels and AI providers are allowed
//      by default; outside connectors (the business's own Stripe, HubSpot, webhook, AI key...) are blocked until the
//      admin allows them.
// Keys: channel:<id>, integration:<id>, ai:<id>. Checked on the server where each thing is actually used.
import { q, one } from './db.js';

let P = null, pAt = 0;
const B = new Map(); // business id -> { allow, at }
const FRESH = 15000;

export const defaultFor = key => !key.startsWith('integration:');
// an integration provider id -> its switch key (a business's own WhatsApp, Telegram or Instagram account is a channel)
export const keyOfProvider = p => (['whatsapp', 'telegram', 'instagram'].includes(p) ? 'channel:' : 'integration:') + p;

async function platform() {
  if (!P || Date.now() - pAt > FRESH) { P = Object.fromEntries((await q('SELECT key, enabled FROM platform_switches')).map(r => [r.key, r.enabled])); pAt = Date.now(); }
  return P;
}
async function allowOf(biz) {
  const c = B.get(biz); if (c && Date.now() - c.at < FRESH) return c.allow;
  const allow = (await one('SELECT connector_allow FROM businesses WHERE id=$1', [biz]))?.connector_allow || {};
  B.set(biz, { allow, at: Date.now() }); return allow;
}
export const platformOn = async key => (await platform())[key] !== false;
// on for this business right now: the platform switch, then the business's own switch (or the default)
export async function allowedFor(biz, key) {
  if (!(await platformOn(key))) return false;
  if (!biz) return true;
  const a = await allowOf(+biz);
  return a[key] ?? defaultFor(key);
}
export const platformMap = platform;
// drop what this process remembers (tests, and any second process that changed a switch)
export function forget() { P = null; B.clear(); }
export async function setPlatform(key, on, who) {
  await q(`INSERT INTO platform_switches (key, enabled, updated_at, updated_by) VALUES ($1,$2,now(),$3)
    ON CONFLICT (key) DO UPDATE SET enabled=EXCLUDED.enabled, updated_at=now(), updated_by=EXCLUDED.updated_by`, [key, !!on, who || null]);
  P = null;
}
// value: true (allow), false (block) or null (back to the default)
export async function setBusiness(biz, key, value) {
  if (value === null) await q(`UPDATE businesses SET connector_allow = COALESCE(connector_allow,'{}'::jsonb) - $2::text WHERE id=$1`, [biz, key]);
  else await q(`UPDATE businesses SET connector_allow = COALESCE(connector_allow,'{}'::jsonb) || jsonb_build_object($2::text, $3::boolean) WHERE id=$1`, [biz, key, !!value]);
  B.delete(+biz);
}
