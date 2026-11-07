// Lab › Controls: one list of everything MXAi can reach (channels, outside connectors, AI providers, MCP servers),
// with an on/off for the whole platform and an allow/block per business. Admin only; every change is audited.
import { q } from './db.js';
import { PROVIDERS } from './integrations.js';
import { platformMap, setPlatform, setBusiness, defaultFor, keyOfProvider } from './switches.js';

const CHANNELS = {
  whatsapp: ['WhatsApp', 'Customers write and get answers on WhatsApp (MXAi\'s number or the business\'s own).'],
  telegram: ['Telegram', 'The business\'s Telegram bot answers customers; owner alerts also go out here.'],
  instagram: ['Instagram DMs', 'The business\'s Instagram account answers and books in DMs.'],
  webook: ['WeBook and website chat', 'Chat in the WeBook app and on the business\'s website.'],
};
const AI = {
  gemini: ['Gemini (Google)', 'Main free AI and two backup models.'], groq: ['Groq', 'Free backup AI.'],
  openrouter: ['OpenRouter', 'Free backup models.'], cerebras: ['Cerebras', 'Free backup AI.'],
  anthropic: ['Claude (Anthropic)', 'Only for businesses with AI Assistant Pro, inside their budget.'],
};

export function registry() {
  const items = [
    ...Object.entries(CHANNELS).map(([id, [name, does]]) => ({ key: 'channel:' + id, kind: 'Channels', name, does })),
    ...Object.entries(PROVIDERS).filter(([id]) => keyOfProvider(id).startsWith('integration:'))
      .map(([id, p]) => ({ key: 'integration:' + id, kind: 'Connectors', name: p.name, does: p.does, group: p.group })),
    ...Object.entries(AI).map(([id, [name, does]]) => ({ key: 'ai:' + id, kind: 'AI providers', name, does })),
  ];
  return items.map(i => ({ ...i, default_on: defaultFor(i.key) }));
}
export const KNOWN = () => new Set(registry().map(i => i.key));

export function mountControls(app, { adminOnly, wrap, audit }) {
  app.get('/api/admin/controls', adminOnly, wrap(async (_req, res) => {
    res.json({
      items: registry(), platform: await platformMap(),
      mcp: [], // no MCP server is connected yet; when one is, it is listed and switched here like the rest
      businesses: await q('SELECT id, name, is_demo, COALESCE(connector_allow,\'{}\'::jsonb) AS allow FROM businesses ORDER BY is_demo, name'),
    });
  }));
  app.put('/api/admin/controls/platform', adminOnly, wrap(async (req, res) => {
    const key = String(req.body.key || ''); if (!KNOWN().has(key)) return res.status(404).json({ error: 'Unknown item.' });
    await setPlatform(key, req.body.on === true, req.user.email);
    await audit(req, 'platform_switch', `${key} ${req.body.on === true ? 'on' : 'OFF'} for every business`);
    res.json({ ok: true });
  }));
  app.put('/api/admin/controls/business/:id', adminOnly, wrap(async (req, res) => {
    const key = String(req.body.key || ''), v = req.body.value; if (!KNOWN().has(key)) return res.status(404).json({ error: 'Unknown item.' });
    if (![true, false, null].includes(v)) return res.status(400).json({ error: 'Choose allow, block or default.' });
    await setBusiness(+req.params.id, key, v);
    await audit(req, 'business_switch', `${key} ${v === null ? 'back to default' : v ? 'allowed' : 'blocked'}`, +req.params.id);
    res.json({ ok: true });
  }));
}
