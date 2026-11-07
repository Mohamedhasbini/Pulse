// Instagram DMs through Meta's Instagram Messaging API (Graph API). One business = one Instagram professional
// account, connected in Settings › Integrations with: a token, the Instagram account ID and the Meta app secret.
// Meta calls /webhook/instagram for each DM; we find the business by the account ID, check Meta's signature with
// that business's app secret, then answer through the same AI as WhatsApp. Clients are stored as phone 'ig-<id>'.
import crypto from 'node:crypto';
import { q } from './db.js';
import { credentials } from './integrations.js';
import { receive, work, markUndelivered } from './inbound.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
export const igKey = id => 'ig-' + id;
export const igId = phone => String(phone || '').startsWith('ig-') ? String(phone).slice(3) : null;

// Instagram quick replies: up to 13 choices of 20 characters; longer lists fall back to plain text
export function igBody(recipient, text, options = []) {
  const opts = (options || []).filter(Boolean), message = { text: String(text).slice(0, 1000) };
  if (opts.length && opts.length <= 13 && opts.every(o => o.length <= 20))
    message.quick_replies = opts.map(o => ({ content_type: 'text', title: o, payload: o }));
  return { recipient: { id: recipient }, messaging_type: 'RESPONSE', message };
}

export async function sendInstagram(businessId, phoneOrId, text, options = []) {
  const to = igId(phoneOrId) || phoneOrId;
  const c = await credentials(businessId, 'instagram');
  if (!c?.access_token || !c?.ig_user_id) return { ok: false, reason: 'Instagram is not connected' };
  try {
    const r = await fetch(`${GRAPH}/${encodeURIComponent(c.ig_user_id)}/messages`, { signal: AbortSignal.timeout(10000),
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.access_token}` }, body: JSON.stringify(igBody(to, text, options)) });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    return { ok: false, reason: j.error?.message || `Instagram answered ${r.status}` };
  } catch (e) { return { ok: false, reason: e.message }; }
}

// The client's name or @username for the inbox (Meta allows this once they've written to you); null when not available
async function igProfile(c, id) {
  try {
    const r = await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=username,name`, { headers: { Authorization: `Bearer ${c.access_token}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null; const j = await r.json(); return j.name || (j.username ? '@' + j.username : null);
  } catch { return null; }
}

// Which business owns this Instagram account (entry.id), with its credentials
async function businessFor(igUserId) {
  for (const r of await q("SELECT business_id FROM integrations WHERE provider='instagram' AND status<>'off'")) {
    const c = await credentials(r.business_id, 'instagram');
    if (c && String(c.ig_user_id) === String(igUserId)) return { id: r.business_id, c };
  }
  return null;
}

const validSig = (raw, header, secret) => {
  if (!secret || !header || !raw) return false;
  const want = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')), got = Buffer.from(String(header));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

// Text DMs from clients (not our own echoes); anything else is described so the AI can hand it over
export function parseInstagram(body) {
  const out = [];
  if (body?.object !== 'instagram') return out;
  for (const e of body.entry || []) for (const m of e.messaging || []) {
    if (!m.message || m.message.is_echo || m.message.is_deleted) continue;
    const text = m.message.quick_reply?.payload || m.message.text || (m.message.attachments?.length ? `(The client sent a ${m.message.attachments[0].type || 'file'} that cannot be read.)` : '');
    if (text) out.push({ account: e.id, from: m.sender?.id, id: m.message.mid, text });
  }
  return out;
}

export function mountInstagram(app, handleMessage) {
  handle = handleMessage;
  // Meta checks the address once with a verify token: IG_VERIFY_TOKEN, or the WhatsApp one when unset
  app.get('/webhook/instagram', (req, res) => {
    const token = process.env.IG_VERIFY_TOKEN || process.env.WA_VERIFY_TOKEN;
    const ok = token && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token;
    ok ? res.send(req.query['hub.challenge']) : res.sendStatus(403);
  });
  app.post('/webhook/instagram', async (req, res) => {
    const msgs = parseInstagram(req.body);
    const owners = new Map();
    for (const a of new Set(msgs.map(m => m.account))) owners.set(a, await businessFor(a));
    // every account in the payload must be ours and signed with its own app secret
    if (msgs.length && ![...owners.values()].every(o => o && validSig(req.rawBody, req.get('x-hub-signature-256'), o.c.app_secret))) return res.sendStatus(401);
    let ids;
    try { ids = await receive('instagram', msgs); } // written down first (inbound.js), like WhatsApp
    catch (e) { console.error('Could not store incoming Instagram messages:', e.message); return res.sendStatus(500); } // Meta retries
    res.sendStatus(200); // answer Meta fast, then work
    for (const id of ids) await work(id, answerInstagram);
  });
}
let handle = null; // set by mountInstagram (the receptionist)
// One stored Instagram DM: also used after a restart (server.js resume)
export async function answerInstagram(m) {
  if (!handle) throw new Error('Instagram is not ready yet');
  const o = await businessFor(m.account); if (!o) return;
  const r = await handle({ businessId: o.id, phone: igKey(m.from), name: (await igProfile(o.c, m.from)) || 'Instagram client', text: m.text, channel: 'instagram', waId: m.id });
  if (!r.duplicate && r.reply) { const s = await sendInstagram(o.id, m.from, r.reply, r.options); if (!s.ok) await markUndelivered(r.conversationId, s.reason); }
}
