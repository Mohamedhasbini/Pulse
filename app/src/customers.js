// One person = one client per business.
// Automatic merges (a message arrives, a booking is made) only trust a phone number the channel itself proved: the
// WhatsApp sender, or a Telegram contact card the sender shared of themselves. Details someone typed (an email, a phone
// number in a chat or on a form) never join two records on their own: otherwise anyone could type another client's
// email and read or cancel that client's bookings. The owner can still merge any two records by hand (manual: true).
import { pool, q, one } from './db.js';

const PLACEHOLDER = /^(test|e2e|walk-in|tg-|ig-|wb-)/;
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

// Only the record's own phone column, and only when it is a real number (not a tg-/ig-/wb-/test placeholder).
const verifiedPhones = c => [c.phone].filter(p => p && !PLACEHOLDER.test(p));

// Every table that points at a client, read from the database itself so a table added later is never forgotten
// (a missed one with ON DELETE CASCADE would silently lose that client's memberships, payments, waitlist places...).
let refs = null;
const clientRefs = async () => refs ||= await q(`SELECT c.conrelid::regclass::text AS t, a.attname AS col FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype='f' AND c.confrelid='customers'::regclass`);

// Merge every other record of the same person into the oldest one; returns the surviving client.
//   manual: the owner asked for it: phone, contact phone and email all count.
//   phones: extra numbers the channel proved belong to this person (a Telegram contact card of the sender).
export async function unify(bizId, customerId, { manual = false, phones: proven = [] } = {}) {
  let keep = await one('SELECT * FROM customers WHERE id=$1 AND business_id=$2', [customerId, bizId]);
  if (!keep) return null;
  const mine = manual ? keysOf(keep) : { phones: [...verifiedPhones(keep), ...proven.filter(Boolean)], email: null };
  const { phones, email } = mine;
  if (!phones.length && !email) return keep;
  const theirs = o => manual ? keysOf(o).phones : verifiedPhones(o);
  const others = (await q('SELECT * FROM customers WHERE business_id=$1 AND id<>$2', [bizId, keep.id]))
    .filter(o => (email && (o.email || '').toLowerCase() === email) || theirs(o).some(p => phones.some(k => samePhone(p, k))));
  if (!others.length) return keep;
  // The oldest record survives, but a real phone number beats a placeholder so WhatsApp replies keep working.
  const all = [keep, ...others].sort((a, b) => (PLACEHOLDER.test(a.phone) - PLACEHOLDER.test(b.phone)) || (new Date(a.created_at) - new Date(b.created_at)) || a.id - b.id);
  const [main, ...dups] = all;
  const tables = await clientRefs();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const d of dups) await mergeInto(c, tables, main, d);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return one('SELECT * FROM customers WHERE id=$1', [main.id]);
}

// One duplicate into the surviving record, on the caller's transaction: every linked row moves, then the duplicate goes.
async function mergeInto(c, tables, main, d) {
    for (const { t, col } of tables) await c.query(`UPDATE ${t} SET ${col}=$1 WHERE ${col}=$2`, [main.id, d.id]);
    // a rehearsal's "Test lab" name never becomes a real client's name
    await c.query(`UPDATE customers SET
        name = COALESCE(name, $2::text), email = COALESCE(email, $3::text), contact_phone = COALESCE(contact_phone, $4::text),
        telegram_chat_id = COALESCE(telegram_chat_id, $5::text), reminder_channel = COALESCE(reminder_channel, $6::text),
        staff_notes = NULLIF(concat_ws(E'\\n', staff_notes, $7::text), ''), marketing_ok = marketing_ok OR $8::boolean,
        language = COALESCE(language, $9::text) WHERE id=$1`,
      [main.id, PLACEHOLDER.test(d.phone) && /^test\b/i.test(d.name || '') ? null : d.name, d.email, PLACEHOLDER.test(d.phone) ? d.contact_phone : d.contact_phone || d.phone, d.telegram_chat_id, d.reminder_channel,
       d.staff_notes, !!d.marketing_ok, d.language]);
    await c.query('DELETE FROM customers WHERE id=$1', [d.id]);
    console.log(`Merged client ${d.id} into ${main.id} (same phone or email)`);
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
