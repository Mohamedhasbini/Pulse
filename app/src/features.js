// What each business may use (plans + add-ons + per-business overrides) and what each login may open (permissions).
// Everything here is checked on the server for every request; the dashboard only hides what the server would refuse anyway.
import { q, one } from './db.js';

// Dashboard sections a login can be given access to.
export const MODULES = {
  overview: 'Overview and chats', calendar: 'Calendar, bookings and approvals', customers: 'Customers',
  insights: 'Insights', teach: 'Teach AI', testchat: 'Test chat', setup: 'Business setup', channels: 'Channels', website: 'Website',
};

// Things a plan or add-on can switch on.
export const FEATURES = {
  booking_page: 'Online booking page', webook_listing: 'Listed in the WeBook app', reminders: 'Appointment reminders',
  teach: 'Teach AI (review, corrections, strict rules)', insights: 'Insights and reports', coupons: 'Discount codes',
  telegram: 'Own Telegram bot', staff_logins: 'Staff logins', marketing: 'Marketing campaigns to opted-in clients',
  remove_branding: 'Remove "Powered by Pulse" from confirmations and the booking page',
  website: 'Own website (one page, own domain or subdomain)',
};

// A section that needs a feature: without it the section shows an upgrade message instead.
export const MODULE_FEATURE = { insights: 'insights', teach: 'teach', website: 'website' };

export const DEFAULT_PLANS = [
  { key: 'starter', name: 'Starter', price: 29, features: ['booking_page', 'webook_listing', 'reminders'] },
  { key: 'pro', name: 'Pro', price: 59, features: ['booking_page', 'webook_listing', 'reminders', 'teach', 'telegram', 'coupons'] },
  { key: 'business', name: 'Business', price: 99, features: Object.keys(FEATURES) },
];
export const DEFAULT_ADDONS = [
  { key: 'insights_addon', name: 'Insights pack', price: 15, features: ['insights'] },
  { key: 'teach_addon', name: 'Teach AI', price: 15, features: ['teach'] },
  { key: 'staff_addon', name: 'Staff logins', price: 10, features: ['staff_logins'] },
  { key: 'marketing_addon', name: 'Marketing', price: 19, features: ['marketing'] },
  { key: 'whitelabel_addon', name: 'Remove Pulse branding', price: 9, features: ['remove_branding'] },
  { key: 'website_addon', name: 'Own website', price: 15, features: ['website'] },
];

export async function seedPlans() {
  for (const [i, p] of DEFAULT_PLANS.entries())
    await q(`INSERT INTO plans (key, name, price, features, sort) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING`, [p.key, p.name, p.price, JSON.stringify(p.features), i]);
  for (const [i, a] of DEFAULT_ADDONS.entries())
    await q(`INSERT INTO addons (key, name, price, features, sort) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING`, [a.key, a.name, a.price, JSON.stringify(a.features), i]);
  // Features added after a plan was first created reach the top plan once.
  await q(`UPDATE plans SET features = features || '["marketing"]'::jsonb WHERE key='business' AND NOT features ? 'marketing'`);
  await q(`UPDATE plans SET features = features || '["remove_branding"]'::jsonb WHERE key='business' AND NOT features ? 'remove_branding'`);
  await q(`UPDATE plans SET features = features || '["website"]'::jsonb WHERE key='business' AND NOT features ? 'website'`);
}

// Plan features, plus add-on features, then the admin's per-business switches (on or off) win.
export async function featuresOf(bizId) {
  const b = await one(`SELECT b.addons, b.feature_overrides, p.features FROM businesses b LEFT JOIN plans p ON p.key=b.plan_key WHERE b.id=$1`, [bizId]);
  if (!b) return new Set();
  const set = new Set(b.features || []);
  if ((b.addons || []).length) for (const a of await q('SELECT features FROM addons WHERE key = ANY($1)', [b.addons])) for (const f of a.features || []) set.add(f);
  for (const [k, on] of Object.entries(b.feature_overrides || {})) on ? set.add(k) : set.delete(k);
  return set;
}
export const hasFeature = async (bizId, key) => (await featuresOf(bizId)).has(key);

// Owners and the admin get every section; staff get only the ones ticked for them.
export const canOpen = (user, module) => user.role !== 'staff' || (user.permissions || []).includes(module);

// Which section an API path belongs to (null = available to every signed-in login).
const ROUTES = [
  [/^\/api\/(stats|conversations|live)/, 'overview'],
  [/^\/api\/(calendar|bookings|time-off|requests)/, 'calendar'],
  [/^\/api\/(customers|marketing)/, 'customers'],
  [/^\/api\/tools/, 'setup'],
  [/^\/api\/insights/, 'insights'],
  [/^\/api\/(learning|review|ai-rules)/, 'teach'],
  [/^\/api\/(test-chat|test-data)/, 'testchat'],
  [/^\/api\/site/, 'website'],
  [/^\/api\/(business|reminders|coupons)/, 'setup'],
  [/^\/api\/(channels|webook-demo)/, 'channels'],
];
export function moduleOf(method, path) {
  if (method === 'GET' && path === '/api/business') return null; // every page needs the business name and wording
  return ROUTES.find(([re]) => re.test(path))?.[1] || null;
}
