// Home page shortcuts: buttons the owner pins to Today, either to open a page and tab or to ask Pulse AI a question
// in one click. The owner adds them on Today, or asks Pulse AI to ("add a shortcut to this week's revenue").
import { q, one } from './db.js';
import { PAGE_TABS } from './team.js';

const MAX = 8;
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// → { ok, shortcut } or { ok: false, error }
export function check(x) {
  const label = clean(x?.label, 32);
  if (!label) return { ok: false, error: 'A shortcut needs a short name.' };
  if (x.ask) { const ask = clean(x.ask, 200); return ask ? { ok: true, shortcut: { label, ask } } : { ok: false, error: 'Write the question to ask.' }; }
  const tabs = PAGE_TABS[x.page], tab = Math.max(0, Math.floor(+x.tab || 0));
  if (!tabs) return { ok: false, error: 'That page does not exist.' };
  if (tab >= tabs.length) return { ok: false, error: 'That tab does not exist.' };
  return { ok: true, shortcut: { label, page: x.page, tab } };
}
export const getShortcuts = async B => (await one('SELECT shortcuts FROM businesses WHERE id=$1', [B]))?.shortcuts || [];
async function save(B, list) { await q('UPDATE businesses SET shortcuts=$1 WHERE id=$2', [JSON.stringify(list), B]); return list; }

export async function addShortcut(B, x) {
  const c = check(x); if (!c.ok) return c;
  const list = await getShortcuts(B);
  if (list.length >= MAX) return { ok: false, error: `Home holds ${MAX} shortcuts. Remove one first.` };
  if (list.some(s => s.label.toLowerCase() === c.shortcut.label.toLowerCase())) return { ok: false, error: `“${c.shortcut.label}” is already on Home.` };
  await save(B, [...list, c.shortcut]);
  return c;
}

export function mountShortcuts(app, BIZ) {
  app.get('/api/shortcuts', wrap(async (_req, res) => res.json({ shortcuts: await getShortcuts(BIZ()), pages: PAGE_TABS, max: MAX })));
  app.post('/api/shortcuts', wrap(async (req, res) => { const r = await addShortcut(BIZ(), req.body); r.ok ? res.json({ shortcuts: await getShortcuts(BIZ()) }) : res.status(400).json({ error: r.error }); }));
  // the whole list, in the owner's order (remove and reorder)
  app.put('/api/shortcuts', wrap(async (req, res) => {
    const list = (Array.isArray(req.body.shortcuts) ? req.body.shortcuts : []).slice(0, MAX).map(check).filter(c => c.ok).map(c => c.shortcut);
    res.json({ shortcuts: await save(BIZ(), list) });
  }));
}
