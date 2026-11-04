// The catalog behind "MXAi connects everything": every channel and business tool a dashboard can draw from,
// with an honest status. 'live' = works today through a provider in integrations.js; 'soon' = planned.
// Dashboard templates say which connectors they need, so a business's dashboard is assembled, not hand-built.
// Owner quotes for the website live here too (testimonials): only real ones, entered by us, shown when published.
import { q } from './db.js';

const C = (id, name, kind, does, status = 'soon', provider = null) => ({ id, name, kind, does, status, provider });
export const KINDS = { channel: 'Channels', commerce: 'Online stores', crm: 'CRM and sales', automation: 'Automation', team: 'Team', support: 'Support', site: 'Websites', ads: 'Ads and analytics', payments: 'Payments' };
export const CONNECTORS = [
  C('whatsapp', 'WhatsApp', 'channel', 'Clients chat and book on your WhatsApp number.', 'live', 'whatsapp'),
  C('telegram', 'Telegram', 'channel', 'A Telegram bot answers and books.', 'live', 'telegram'),
  C('email', 'Email', 'channel', 'Confirmations and reminders from your domain.', 'live', 'resend'),
  C('instagram', 'Instagram', 'channel', 'Direct messages answered and booked.'),
  C('messenger', 'Messenger', 'channel', 'Facebook page messages in the same inbox.'),
  C('tiktok', 'TikTok', 'channel', 'Messages and leads from TikTok.'),
  C('line', 'LINE', 'channel', 'LINE official account chats.'),
  C('viber', 'Viber', 'channel', 'Viber business chats.'),
  C('phone', 'Phone calls', 'channel', 'An AI voice that answers calls and books.'),
  C('sms', 'SMS', 'channel', 'Text reminders and replies.'),
  C('stripe', 'Stripe', 'payments', 'Deposits and online payments.', 'live', 'stripe'),
  C('webhook', 'Webhooks', 'automation', 'Every booking and handoff sent to your own system.', 'live', 'webhook'),
  C('zapier', 'Zapier', 'automation', 'Connect 7,000 apps through your webhook.', 'live', 'webhook'),
  C('make', 'Make', 'automation', 'Scenarios triggered by your webhook.', 'live', 'webhook'),
  C('shopify', 'Shopify', 'commerce', 'Orders, products and customer questions.'),
  C('woocommerce', 'WooCommerce', 'commerce', 'Orders and products from your WordPress shop.'),
  C('magento', 'Magento', 'commerce', 'Orders and catalog from Adobe Commerce.'),
  C('hubspot', 'HubSpot', 'crm', 'Contacts and deals kept in sync.'),
  C('salesforce', 'Salesforce', 'crm', 'Leads and accounts kept in sync.'),
  C('pipedrive', 'Pipedrive', 'crm', 'New leads as deals in your pipeline.'),
  C('slack', 'Slack', 'team', 'Handoffs and approvals posted to your team.'),
  C('zendesk', 'Zendesk', 'support', 'Hard questions become tickets.'),
  C('squarespace', 'Squarespace', 'site', 'Booking chat on your Squarespace site.'),
  C('meta_ads', 'Meta Ads', 'ads', 'Ad spend and leads next to bookings.'),
  C('google_ads', 'Google Ads', 'ads', 'Spend and clicks next to revenue.'),
  C('ga4', 'Google Analytics', 'ads', 'Site visits and where they came from.'),
];

// A template = which pages a dashboard shows and which connectors feed it.
const T = (id, name, does, pages, needs, status = 'live') => ({ id, name, does, pages, needs, status });
export const TEMPLATES = [
  T('salon', 'Salon and spa command center', 'AI front desk, calendar, clients, win-back offers, insights and finance.', ['Today', 'Inbox', 'Calendar', 'Customers', 'Growth', 'Insights', 'Finance', 'AI Control'], ['whatsapp', 'email', 'stripe']),
  T('receptionist', 'AI receptionist only', 'Just the front desk: chats answered and booked, with a simple inbox.', ['Today', 'Inbox', 'Calendar', 'AI Control'], ['whatsapp']),
  T('clinic', 'Clinic and medspa', 'Appointments, reminders and follow-ups with the same AI front desk.', ['Today', 'Inbox', 'Calendar', 'Customers', 'Insights', 'AI Control'], ['whatsapp', 'email']),
  T('store', 'Online store', 'Orders, products and customer questions from your shop in one view.', ['Today', 'Inbox', 'Orders', 'Customers', 'Finance'], ['shopify', 'instagram', 'stripe'], 'soon'),
  T('social', 'Social media and ads', 'Messages, leads and ad results from every channel together.', ['Today', 'Inbox', 'Leads', 'Ads', 'Insights'], ['instagram', 'messenger', 'tiktok', 'meta_ads'], 'soon'),
  T('restaurant', 'Restaurants', 'Table bookings, questions and reminders, handled by chat.', ['Today', 'Inbox', 'Calendar', 'Customers'], ['whatsapp', 'instagram'], 'soon'),
];

export function mountConnectors(app, BIZ) {
  // per business: each connector with whether its provider is set up here
  app.get('/api/connectors', async (_req, res, next) => {
    try {
      const on = new Set((await q("SELECT provider FROM integrations WHERE business_id=$1 AND status='connected'", [BIZ()])).map(r => r.provider));
      res.json({ kinds: KINDS, connectors: CONNECTORS.map(c => ({ ...c, connected: !!(c.provider && on.has(c.provider)) })) });
    } catch (e) { next(e); }
  });
}

export function mountPublicCatalog(app) {
  // public: the website reads templates and published owner quotes from here
  app.get('/api/public/templates', (_req, res) => res.json({ templates: TEMPLATES.map(t => ({ ...t, needs: t.needs.map(id => CONNECTORS.find(c => c.id === id)?.name || id) })) }));
  app.get('/api/public/testimonials', async (_req, res) => {
    try { res.set('Cache-Control', 'public, max-age=300'); res.json({ items: await q('SELECT quote, name, role, business, city FROM testimonials WHERE published ORDER BY id DESC LIMIT 6') }); }
    catch { res.json({ items: [] }); }
  });
}
