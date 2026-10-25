// Sends a reminder message before each confirmed appointment (default 24 hours before).
// Runs every 5 minutes. Each booking gets at most one reminder.
import { q, one } from './db.js';
import { sendWhatsApp } from './whatsapp.js';
import { sendTelegram } from './telegram.js';
import { sendEmail } from './email.js';

const REF = id => 'RB-' + String(id).padStart(4, '0');

export function fill(template, b) {
  const s = new Date(b.starts_at);
  const day = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const diff = Math.round((day(s) - day(new Date())) / 864e5);
  const vals = {
    when: diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : 'on ' + s.toLocaleDateString('en-GB', { weekday: 'long' }),
    name: (b.customer || '').split(' ')[0] || 'there', service: b.service, business: b.business,
    date: s.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
    time: s.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), ref: REF(b.id),
  };
  return template.replace(/\{(\w+)\}/g, (m, k) => vals[k] ?? m);
}

export async function runReminders() {
  const due = await q(`SELECT b.*, s.name service, cu.name customer, cu.phone, cu.reminder_channel, cu.email, cu.telegram_chat_id, bz.name business, bz.reminder_text, bz.reminder_hours, bz.wa_phone_number_id
      FROM bookings b JOIN services s ON s.id=b.service_id JOIN customers cu ON cu.id=b.customer_id JOIN businesses bz ON bz.id=b.business_id
      WHERE b.status='confirmed' AND b.reminder_sent_at IS NULL AND b.reminder_status IS NULL AND bz.reminders_enabled
        AND b.starts_at > now() + interval '1 hour'
        AND b.starts_at <= now() + make_interval(hours => bz.reminder_hours)`);
  for (const b of due) {
    try {
      // Booked inside the reminder window (e.g. this morning for this afternoon): they just got a confirmation, no reminder needed.
      if (new Date(b.starts_at) - new Date(b.created_at) < b.reminder_hours * 3600e3 * 0.75) {
        await q(`UPDATE bookings SET reminder_status='skipped' WHERE id=$1`, [b.id]);
        continue;
      }
      const text = fill(b.reminder_text, b);
      // Use the customer's latest conversation (so a reply continues it), or start one.
      let conv = await one(`SELECT * FROM conversations WHERE customer_id=$1 ORDER BY updated_at DESC LIMIT 1`, [b.customer_id]);
      const isTest = /^(test|e2e|walk-in|tg-)/.test(b.phone);
      if (!conv) conv = await one(`INSERT INTO conversations (business_id, customer_id, channel, outcome) VALUES ($1,$2,$3,'answered') RETURNING *`,
        [b.business_id, b.customer_id, isTest ? 'test' : 'whatsapp']);
      let status = 'sent';
      const channel = b.reminder_channel || 'whatsapp';
      if (channel === 'email' && b.email) {
        const r = await sendEmail(b.email, `Reminder: ${b.service} at ${b.business}`, text, b.business);
        if (!r.ok) status = 'not_sent: ' + r.reason;
      } else if (conv.channel === 'telegram') {
        const r = await sendTelegram(b.telegram_chat_id, text, b.business_id);
        if (!r.ok) status = 'not_sent: ' + r.reason;
      } else if (!['test', 'webook'].includes(conv.channel) && !isTest) {
        if (channel === 'whatsapp') {
          const r = await sendWhatsApp(b.wa_phone_number_id, b.phone, text);
          if (!r?.ok) status = 'not_sent: ' + (r?.reason || 'unknown');
        } else status = `not_sent: ${channel === 'sms' ? 'SMS' : 'email'} sending is not connected yet`;
      }
      await q(`INSERT INTO messages (conversation_id, role, text) VALUES ($1,'assistant',$2)`, [conv.id, text]);
      await q(`UPDATE conversations SET updated_at=now() WHERE id=$1`, [conv.id]);
      await q(`UPDATE bookings SET reminder_status=$1, reminder_sent_at=CASE WHEN $1='sent' THEN now() END WHERE id=$2`, [status, b.id]);
      console.log(`Reminder ${status} for ${REF(b.id)}`);
    } catch (e) { console.error('Reminder failed for booking', b.id, e.message); }
  }
  return due.length;
}

export function startReminders() {
  setTimeout(() => runReminders().catch(e => console.error('Reminders:', e.message)), 20000);
  setInterval(() => runReminders().catch(e => console.error('Reminders:', e.message)), 5 * 60000);
}
