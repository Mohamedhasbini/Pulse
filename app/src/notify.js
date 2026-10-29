// Notification center: every event the business should know about is stored (the dashboard bell reads it),
// and the kinds the owner switched on are also pushed instantly to the owner's own Telegram chat.
import crypto from 'node:crypto';
import { q, one } from './db.js';
import { sendTelegram } from './telegram.js';

export const KINDS = {
  booking: 'New booking', cancel: 'Cancellation', approval: 'Needs your approval', handoff: 'A customer needs you',
  unsure: 'The AI was not sure', review: 'New review', marketing: 'Campaign sent',
};

export async function notify(bizId, kind, title, body = null, refs = {}) {
  try {
    // Test lab chats are rehearsals: they never ring the bell or the owner's phone
    if (refs.conversationId && (await one(`SELECT channel FROM conversations WHERE id=$1`, [refs.conversationId]))?.channel === 'test') return null;
    const n = await one(`INSERT INTO notifications (business_id, kind, title, body, conversation_id, booking_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [bizId, kind, String(title).slice(0, 200), body ? String(body).slice(0, 600) : null, refs.conversationId || null, refs.bookingId || null]);
    const b = await one('SELECT alert_kinds, owner_telegram_chat FROM businesses WHERE id=$1', [bizId]);
    if (b?.owner_telegram_chat && (b.alert_kinds || []).includes(kind))
      await sendTelegram(b.owner_telegram_chat, `🔔 ${title}${body ? '\n' + body : ''}`, bizId);
    return n.id;
  } catch (e) { console.error('notify:', e.message); }
}

// The owner links their own Telegram by sending "/owner CODE" to the business's bot.
export async function ownerLinkCode(bizId) {
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  await q('UPDATE businesses SET owner_link_code=$1 WHERE id=$2', [code, bizId]);
  return code;
}
export async function linkOwnerChat(bizId, code, chatId) {
  const b = await one('SELECT owner_link_code FROM businesses WHERE id=$1', [bizId]);
  if (!b?.owner_link_code || b.owner_link_code !== String(code).trim().toUpperCase()) return false;
  await q('UPDATE businesses SET owner_telegram_chat=$1, owner_link_code=NULL WHERE id=$2', [String(chatId), bizId]);
  return true;
}
