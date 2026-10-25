// One person = one client per business. The same phone number (any format, with or without the country code)
// or the same email always lands on the same client record, whichever channel they used.
import { q, one } from './db.js';

const PLACEHOLDER = /^(test|e2e|walk-in|tg-)/;
export const digits = p => String(p || '').replace(/\D/g, '').replace(/^00/, '');
// "70123456", "+961 70 123 456" and "0096170123456" are one number: the shorter (8+ digits) ends the longer.
export function samePhone(a, b) {
  const x = digits(a), y = digits(b);
  if (x.length < 8 || y.length < 8) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return l.endsWith(s.replace(/^0+/, ''));
}

// Every phone and email this client is known by.
const keysOf = c => ({ phones: [c.phone, c.contact_phone].filter(p => p && !PLACEHOLDER.test(p)), email: (c.email || '').trim().toLowerCase() || null });

// Merge every other record of the same person into the oldest one; returns the surviving client.
export async function unify(bizId, customerId) {
  let keep = await one('SELECT * FROM customers WHERE id=$1 AND business_id=$2', [customerId, bizId]);
  if (!keep) return null;
  const { phones, email } = keysOf(keep);
  if (!phones.length && !email) return keep;
  const others = (await q('SELECT * FROM customers WHERE business_id=$1 AND id<>$2', [bizId, keep.id]))
    .filter(o => (email && (o.email || '').toLowerCase() === email) || keysOf(o).phones.some(p => phones.some(k => samePhone(p, k))));
  if (!others.length) return keep;
  // The oldest record survives, but a real phone number beats a placeholder so WhatsApp replies keep working.
  const all = [keep, ...others].sort((a, b) => (PLACEHOLDER.test(a.phone) - PLACEHOLDER.test(b.phone)) || (new Date(a.created_at) - new Date(b.created_at)) || a.id - b.id);
  const [main, ...dups] = all;
  for (const d of dups) {
    for (const t of ['conversations', 'bookings', 'reviews']) await q(`UPDATE ${t} SET customer_id=$1 WHERE customer_id=$2`, [main.id, d.id]);
    await q('UPDATE campaign_sends SET customer_id=$1 WHERE customer_id=$2', [main.id, d.id]);
    await q(`UPDATE customers SET
        name = COALESCE(name, $2::text), email = COALESCE(email, $3::text), contact_phone = COALESCE(contact_phone, $4::text),
        telegram_chat_id = COALESCE(telegram_chat_id, $5::text), reminder_channel = COALESCE(reminder_channel, $6::text),
        staff_notes = NULLIF(concat_ws(E'\\n', staff_notes, $7::text), ''), marketing_ok = marketing_ok OR $8::boolean,
        language = COALESCE(language, $9::text) WHERE id=$1`,
      [main.id, d.name, d.email, PLACEHOLDER.test(d.phone) ? d.contact_phone : d.contact_phone || d.phone, d.telegram_chat_id, d.reminder_channel,
       d.staff_notes, !!d.marketing_ok, d.language]);
    await q('DELETE FROM customers WHERE id=$1', [d.id]);
    console.log(`Merged client ${d.id} into ${main.id} (same phone or email)`);
  }
  return one('SELECT * FROM customers WHERE id=$1', [main.id]);
}

// Existing client for a phone or email given on a form (WeBook, booking page), before creating a new one.
export async function findExisting(bizId, phone, email) {
  const e = String(email || '').trim().toLowerCase();
  const list = await q(`SELECT * FROM customers WHERE business_id=$1 ORDER BY created_at, id`, [bizId]);
  return list.find(c => (e && (c.email || '').toLowerCase() === e) || keysOf(c).phones.some(p => samePhone(p, phone))) || null;
}

// One-time clean-up of duplicates made before this existed.
export async function unifyAll() {
  let merged = 0;
  for (const c of await q('SELECT id, business_id FROM customers ORDER BY id')) {
    if (!(await one('SELECT 1 FROM customers WHERE id=$1', [c.id]))) continue;
    const before = await one('SELECT count(*)::int AS n FROM customers WHERE business_id=$1', [c.business_id]);
    await unify(c.business_id, c.id);
    const after = await one('SELECT count(*)::int AS n FROM customers WHERE business_id=$1', [c.business_id]);
    merged += before.n - after.n;
  }
  if (merged) console.log(`Merged ${merged} duplicate client records`);
  return merged;
}
