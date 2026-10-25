// Telegram channel: every business can connect its own Telegram bot; customers message it and the AI answers.
// Uses long polling, so it works from a home PC without a public address. The token is saved per business
// from the dashboard (TELEGRAM_BOT_TOKEN in .env is only used once, to connect TELEGRAM_BUSINESS_ID).
import { seal, unseal, fingerprint } from './ops.js';
import { q, one } from './db.js';
import { handleMessage } from './brain.js';
import { unify } from './customers.js';

const API = (token, m) => `https://api.telegram.org/bot${token}/${m}`;
const call = async (token, m, body) => (await fetch(API(token, m), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
// One running bot per business: { token, running, bot, error, last, stop }
const bots = new Map();
export const telegramStatus = bizId => { const b = bots.get(+bizId); return b ? { running: b.running, bot: b.bot, error: b.error, last: b.last } : { running: false }; };

// Our confirmations use *bold*; Telegram's MarkdownV2 is strict, so send plain text with the stars removed.
const plain = t => String(t || '').replace(/\*([^*\n]+)\*/g, '$1');

export async function sendTelegram(chatId, text, bizId) {
  const token = bots.get(+bizId)?.token;
  if (!token || !chatId) return { ok: false, reason: 'Telegram not connected' };
  try {
    const j = await call(token, 'sendMessage', { chat_id: chatId, text: plain(text) });
    return j.ok ? { ok: true } : { ok: false, reason: 'Telegram: ' + (j.description || 'error') };
  } catch (e) { return { ok: false, reason: 'Telegram: ' + e.message }; }
}

async function onMessage(bizId, m) {
  const chatId = String(m.chat.id);
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || null;
  let text = m.text || (m.contact ? `My phone number is ${m.contact.phone_number}` : null);
  if (!text) return sendTelegram(chatId, 'Sorry, I can only read text messages for now.', bizId);
  // The owner links this chat for instant alerts with "/owner CODE" (code shown in the dashboard); it never reaches the AI.
  const own = /^\/owner\s+([A-Za-z0-9]{6,12})$/.exec(text.trim());
  if (own) {
    const { linkOwnerChat } = await import('./notify.js');
    return sendTelegram(chatId, await linkOwnerChat(bizId, own[1], chatId)
      ? 'Owner alerts are on. New bookings, cancellations and anything that needs you will arrive here instantly.'
      : 'That code is not valid. Get a new one in your dashboard: bell icon, Alert settings.', bizId);
  }
  if (text === '/start') text = 'Hello';
  // Each Telegram chat is one customer of this business; phone is asked for (or shared) during the chat.
  // A Telegram chat already matched to a client (by the phone they shared) keeps using that client.
  const known = await one(`SELECT phone FROM customers WHERE business_id=$1 AND telegram_chat_id=$2 ORDER BY (phone LIKE 'tg-%'), id LIMIT 1`, [bizId, chatId]);
  const phoneKey = known?.phone || 'tg-' + chatId;
  await q(`INSERT INTO customers (business_id, phone, name, telegram_chat_id) VALUES ($1,$2,$3,$4)
      ON CONFLICT (business_id, phone) DO UPDATE SET telegram_chat_id=EXCLUDED.telegram_chat_id, name=COALESCE(customers.name, EXCLUDED.name)`, [bizId, phoneKey, name, chatId]);
  if (m.contact?.phone_number) {
    const c = await one(`UPDATE customers SET contact_phone=$1 WHERE business_id=$2 AND phone=$3 RETURNING id`, [m.contact.phone_number.replace(/[^\d+]/g, ''), bizId, phoneKey]);
    if (c) await unify(bizId, c.id);
  }
  call(bots.get(bizId).token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  const r = await handleMessage({ businessId: bizId, phone: phoneKey, name, text, channel: 'telegram' });
  if (r.reply) await sendTelegram(chatId, r.reply, bizId);
}

export function stopBot(bizId) { const b = bots.get(bizId); if (b) b.stopped = true; bots.delete(bizId); }

async function runBot(bizId, token) {
  stopBot(bizId);
  const s = { token, running: false, bot: null, error: null, last: null, stopped: false };
  bots.set(bizId, s);
  try {
    const me = await call(token, 'getMe');
    if (!me.ok) { s.error = 'Telegram refused this bot token. Copy it again from @BotFather.'; return s; }
    s.bot = me.result.username;
    await call(token, 'deleteWebhook'); // polling and webhooks can't run together
  } catch (e) { s.error = e.message; return s; }
  s.running = true;
  console.log(`Telegram bot @${s.bot} is listening for business ${bizId}`);
  (async () => {
    let offset = 0;
    while (!s.stopped) {
      try {
        const r = await (await fetch(API(token, `getUpdates?timeout=30&offset=${offset}&allowed_updates=["message"]`), { signal: AbortSignal.timeout(40000) })).json();
        if (!r.ok && r.error_code === 409) throw new Error('This bot is being used by another program. Give each business its own bot.');
        for (const u of r.result || []) {
          offset = u.update_id + 1;
          if (u.message && !s.stopped) onMessage(bizId, u.message).catch(e => console.error('Telegram message failed:', e.message));
        }
        s.last = new Date(); s.error = null;
      } catch (e) { s.error = e.message; await new Promise(z => setTimeout(z, 5000)); }
    }
  })();
  return s;
}

// Connect (or disconnect, with an empty token) a business's bot. The bot takes the business's name and description.
export async function connectTelegram(bizId, token) {
  token = String(token || '').trim();
  if (!token) { stopBot(bizId); await q('UPDATE businesses SET telegram_token=NULL, telegram_token_hash=NULL WHERE id=$1', [bizId]); return { ok: true }; }
  if (!/^\d+:[\w-]{30,}$/.test(token)) return { ok: false, error: 'That does not look like a bot token. It looks like 123456789:AAH...' };
  const other = await one('SELECT name FROM businesses WHERE telegram_token_hash=$1 AND id<>$2', [fingerprint(token), bizId]);
  if (other) return { ok: false, error: `This bot is already connected to ${other.name}. Create a new bot for this business.` };
  const me = await call(token, 'getMe').catch(() => null);
  if (!me?.ok) return { ok: false, error: 'Telegram refused this bot token. Copy it again from @BotFather.' };
  await q('UPDATE businesses SET telegram_token=$1, telegram_token_hash=$2 WHERE id=$3', [seal(token), fingerprint(token), bizId]);
  const biz = await one('SELECT name, description, address FROM businesses WHERE id=$1', [bizId]);
  await call(token, 'setMyName', { name: biz.name.slice(0, 64) }).catch(() => {});
  await call(token, 'setMyShortDescription', { short_description: `Book at ${biz.name} in seconds`.slice(0, 120) }).catch(() => {});
  await call(token, 'setMyDescription', { description: [biz.description, biz.address, 'Say hi to book an appointment 😊'].filter(Boolean).join('\n\n').slice(0, 512) }).catch(() => {});
  const s = await runBot(bizId, token);
  return { ok: s.running, bot: s.bot, error: s.error };
}

export async function startTelegram() {
  // One-time move of the old .env token onto its business, so it shows in that business's dashboard.
  const envToken = process.env.TELEGRAM_BOT_TOKEN, envBiz = +process.env.TELEGRAM_BUSINESS_ID || 1;
  if (envToken) await q(`UPDATE businesses SET telegram_token=$1, telegram_token_hash=$3 WHERE id=$2 AND telegram_token IS NULL
      AND NOT EXISTS (SELECT 1 FROM businesses WHERE telegram_token_hash=$3)`, [seal(envToken), envBiz, fingerprint(envToken)]);
  for (const b of await q('SELECT id, telegram_token FROM businesses WHERE telegram_token IS NOT NULL')) {
    try { runBot(b.id, unseal(b.telegram_token)); } catch (e) { console.error(`Telegram token for business ${b.id} could not be read:`, e.message); }
  }
}
