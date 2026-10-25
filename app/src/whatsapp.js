import crypto from 'node:crypto';

const GRAPH = 'https://graph.facebook.com/v21.0';
// Kapso (kapso.ai) mirrors Meta's Cloud API: same message body, different base URL and key. Used when KAPSO_API_KEY is set.
const KAPSO = 'https://api.kapso.ai/meta/whatsapp/v24.0';
export const whatsappReady = () => !!(process.env.KAPSO_API_KEY || process.env.WA_ACCESS_TOKEN);

// The message body for a reply: tap buttons for 1-3 short choices, a list for up to 10, otherwise plain text.
export function waBody(text, options = []) {
  const opts = (options || []).filter(Boolean);
  const body = String(text).slice(0, 1024);
  if (opts.length && opts.length <= 3 && opts.every(o => o.length <= 20))
    return { type: 'interactive', interactive: { type: 'button', body: { text: body }, action: { buttons: opts.map((o, i) => ({ type: 'reply', reply: { id: 'opt' + i, title: o } })) } } };
  if (opts.length && opts.length <= 10 && opts.every(o => o.length <= 24))
    return { type: 'interactive', interactive: { type: 'list', body: { text: body }, action: { button: 'Choose', sections: [{ title: 'Options', rows: opts.map((o, i) => ({ id: 'opt' + i, title: o })) }] } } };
  return { type: 'text', text: { body: String(text) } };
}

export async function sendWhatsApp(phoneNumberId, to, text, options = []) {
  const kapso = process.env.KAPSO_API_KEY, token = process.env.WA_ACCESS_TOKEN;
  if ((!kapso && !token) || !phoneNumberId) { console.warn('WhatsApp not configured; message not sent'); return { ok: false, reason: 'WhatsApp not connected' }; }
  const post = msg => fetch(`${kapso ? KAPSO : GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { ...(kapso ? { 'X-API-Key': kapso } : { Authorization: `Bearer ${token}` }), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, ...msg }),
  }).catch(e => ({ ok: false, status: 0, text: async () => e.message }));
  const msg = waBody(text, options);
  let res = await post(msg);
  // Buttons refused (old app, test number limits): the same words as plain text, so the customer is never left without a reply.
  if (!res.ok && msg.type === 'interactive') { console.warn('WhatsApp buttons refused, sending text:', res.status, await res.text()); res = await post({ type: 'text', text: { body: String(text) + '\n\n' + options.map(o => '• ' + o).join('\n') } }); }
  if (!res.ok) { const t = await res.text(); console.error('WhatsApp send failed', res.status, t); return { ok: false, reason: `WhatsApp error ${res.status}` }; }
  return { ok: true };
}

// Kapso signs each webhook: hex HMAC-SHA256 of the raw body in X-Webhook-Signature.
export function validKapsoSignature(rawBody, header) {
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  if (!secret || !header || !rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

// Kapso "whatsapp.message.received" events, single or batched, in the same shape as parseIncoming().
export function parseKapso(body) {
  const events = body?.batch || Array.isArray(body?.data) ? body.data || [] : [body];
  return events.filter(e => e?.message).map(({ message: m, conversation: c = {}, phone_number_id }) => ({
    id: m.id, phoneNumberId: phone_number_id || c.phone_number_id, from: String(m.from || c.phone_number || '').replace(/[^\d]/g, ''),
    name: c.contact_name, type: m.type,
    text: m.type === 'text' ? m.text?.body : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title) : m.text?.body || null,
  }));
}

// Meta signs each webhook with the app secret; reject anything else.
export function validSignature(rawBody, header) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret) return true; // allowed only until the secret is set
  if (!header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

// Pull text messages out of a WhatsApp webhook payload.
export function parseIncoming(body) {
  const out = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        const text = m.type === 'text' ? m.text.body
          : m.type === 'interactive' ? (m.interactive.button_reply?.title || m.interactive.list_reply?.title)
          : null;
        out.push({ id: m.id, phoneNumberId: v.metadata?.phone_number_id, from: m.from, name: names[m.from], text, type: m.type });
      }
    }
  }
  return out;
}
