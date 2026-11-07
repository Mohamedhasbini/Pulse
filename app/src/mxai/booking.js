// Layer 04 (part 1): acting on a booking decision. Moved from brain.js with the same behaviour, the same messages
// (English, Arabic, Spanish, French) and the same per-business lock. brain.js keeps its own copy until the integrator
// switches handleMessage over to mxai/index.js and deletes it there.
//
// Why the database and notification modules are loaded lazily (dep()): db.js opens a pg pool and notify.js pulls in
// telegram.js -> brain.js. Loading them on first use keeps this file importable by the pure node tests (no database,
// no node_modules on the host) and avoids an import cycle with brain.js while both copies exist.
// Everything that reads "today", formats a label or parses "YYYY-MM-DD HH:MM" uses the business clock (clock.js):
// callers must run inside inZone(biz.timezone) (tools.js does this for every tool).
import { emailEnabled, sendEmail } from '../email.js';
import { availability, isFree, freeSlots, bufferOf, label, localDate, parseLocal } from '../slots.js';
import { wall, daysBetween, fmtDate, fmtTime } from '../clock.js';

let D = null;
async function dep() {
  if (D) return D;
  const [db, ap, nt, lv] = await Promise.all([import('../db.js'), import('../autopilot.js'), import('../notify.js'), import('../live.js')]);
  D = { q: db.q, one: db.one, withBusinessLock: db.withBusinessLock, joinWaitlist: ap.joinWaitlist, offerWaitlist: ap.offerWaitlist, notify: nt.notify, emit: lv.emit };
  return D;
}
// tests swap in fakes (a recorded q/one, a lock that just runs fn); null goes back to the real modules
export function _setDeps(d) { D = d; }

const AR = /[؀-ۿ]/;
export const ref = id => 'RB-' + String(id).padStart(4, '0');
export const hoursUntil = t => (new Date(t) - Date.now()) / 3600000;

export function findService(biz, name) {
  const n = String(name || '').toLowerCase().trim();
  // exact name, else the one service whose name contains (or is contained in) what was asked; two candidates =
  // ask which (never book "hair colouring" as "Hair cut" because both start with "hair")
  const exact = biz.services.find(s => s.name.toLowerCase() === n);
  if (exact || !n) return exact || null;
  const near = biz.services.filter(s => { const m = s.name.toLowerCase(); return m.includes(n) || n.includes(m); });
  return near.length === 1 ? near[0] : null;
}
// The same match as findService, but says WHY nothing matched, so a tool can ask "which one?" for two candidates
// and hand over for a service the business doesn't have (never guess).
export function matchService(biz, name) {
  const svc = findService(biz, name);
  if (svc) return { service: svc };
  const n = String(name || '').toLowerCase().trim();
  const near = n ? biz.services.filter(s => { const m = s.name.toLowerCase(); return m.includes(n) || n.includes(m); }) : [];
  return near.length > 1 ? { candidates: near } : { none: true };
}

export async function createBooking(biz, customer, conv, req, bookings, timeOff) {
  const { q, one } = await dep();
  const svc = findService(biz, req.service);
  // The AI sends "YYYY-MM-DD HH:MM" in the business's time zone; ISO with Z also works.
  const start = /Z|[+-]\d\d:?\d\d$/.test(String(req.slot)) ? new Date(req.slot) : parseLocal(req.slot);
  if (!svc || isNaN(start)) return { ok: false, message: 'Sorry, I could not complete that booking. Which service and time would you like?' };
  // The customer already has exactly this booking (e.g. they said "ok" after the confirmation): don't book it twice.
  const same = await one(`SELECT id FROM bookings WHERE customer_id=$1 AND service_id=$2 AND starts_at=$3 AND status <> 'cancelled'`, [customer.id, svc.id, start]);
  if (same) return { ok: false, message: 'You\x27re already booked for that, no need to do anything else. See you then! 😊', already: true };
  const end = new Date(start.getTime() + svc.minutes * 60000);
  if (start < new Date() || !isFree(biz, bookings, timeOff, start, end, bufferOf(biz, svc.id), svc.id)) {
    const alt = freeSlots(biz, bookings, timeOff, svc.minutes, 3, start < new Date() ? new Date() : new Date(start.getTime() - 3 * 3600000), bufferOf(biz, svc.id), svc.id)
      .map(s => s.label).join(', ');
    return { ok: false, message: alt ? `Sorry, that time isn't available for ${svc.name}. I can offer: ${alt}. Which one suits you?`
      : `Sorry, that time isn't available for ${svc.name}. Which other day works for you?` };
  }
  // Discount codes are checked here against the owner's list; the AI never decides a discount.
  let price = Number(svc.price), coupon = null;
  const code = String(req.coupon || '').trim().toUpperCase();
  if (code) {
    const c = await checkCoupon(biz.id, code);
    if (!c.ok) return { ok: false, message: `${c.reason} Would you like me to book ${svc.name} at the normal price of ${price} ${biz.currency || 'USD'}?` };
    coupon = c.coupon;
    const off = coupon.kind === 'percent' ? price * Number(coupon.value) / 100 : Number(coupon.value);
    price = Math.max(0, Math.round((price - off) * 100) / 100);
  }
  if (req.name) await q('UPDATE customers SET name=$1 WHERE id=$2', [req.name, customer.id]);
  const notes = String(req.notes || '').trim() || null, guests = Math.min(Math.max(parseInt(req.guests ?? req.party_size, 10) || 0, 0), 500) || null;
  const saved = await one(`INSERT INTO bookings (business_id, customer_id, service_id, conversation_id, starts_at, ends_at, price, list_price, coupon_code, source, notes, party_size)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ai',$10,$11) RETURNING id`, [biz.id, customer.id, svc.id, conv.id, start, end, price, svc.price, coupon?.code || null, notes, guests]);
  if (coupon) await q('UPDATE coupons SET uses = uses + 1 WHERE id=$1', [coupon.id]);
  await q('UPDATE conversations SET value = value + $1 WHERE id=$2', [price, conv.id]);
  return { ok: true, booking: { id: saved.id, start, end, service: svc, price, listPrice: Number(svc.price), coupon: coupon?.code, name: req.name || customer.name, notes, guests } };
}

export async function checkCoupon(bizId, code) {
  const { one } = await dep();
  const c = await one('SELECT *, (expires_on IS NOT NULL AND expires_on < $3::date) AS expired FROM coupons WHERE business_id=$1 AND upper(code)=upper($2)', [bizId, code, localDate(new Date())]);
  if (!c || !c.active) return { ok: false, reason: `Sorry, the code ${code} isn't valid.` };
  if (c.expired) return { ok: false, reason: `Sorry, the code ${code} has expired.` };
  if (c.max_uses && c.uses >= c.max_uses) return { ok: false, reason: `Sorry, the code ${code} has already been fully used.` };
  return { ok: true, coupon: c };
}

// The client asks to cancel: English cancel (not "don't cancel"), or an Arabic cancel word (إلغاء، الغي، ألغيه، بلغي...).
// Arabic is matched as whole words: الغداء (lunch) or بالغ (adult) contain the same letters and are not a cancellation.
export function asksToCancel(text) {
  const t = String(text || '');
  // whole English words only: "cancelar" is Spanish and has its own check (with "no quiero cancelar")
  if (/\bcancel(l?ing|l?ed|s|lation)?\b/i.test(t) && !/\b(don'?t|do not|not|never|no need to|won'?t)\s+(to\s+)?cancel/i.test(t)) return true;
  if (/\b(anular|cancelar|annuler)\b/i.test(t) && !/\bno\s+(quiero\s+)?(anular|cancelar)|\bne\s+pas\s+annuler/i.test(t)) return true;
  return t.split(/[\s،,.!?؟]+/).some(w => /^[وف]?(ب|ل)?[اأإ]?لغ(ي|ى|يه|يها|يلي|ا|اء|و|وا)$/.test(w));
}
// The client's language from what they wrote: Arabic script, else Spanish or French by their words, else English.
export function langOf(text) {
  const t = String(text || '');
  if (AR.test(t)) return 'ar';
  if (/[ñ¿¡]|\b(hola|gracias|cita|quiero|quisiera|por favor|mañana|buenas|reservar|cuánto|cuesta|vale)\b/i.test(t)) return 'es';
  if (/\b(bonjour|bonsoir|merci|rendez-vous|je voudrais|s'il vous pla[iî]t|demain|réserver|combien)\b|[çœ]/i.test(t)) return 'fr';
  return 'en';
}
export function policyText(biz) {
  const h = biz.cancel_hours ?? 24;
  return `Customers can cancel or reschedule in this chat up to ${h} hours before the appointment. Within ${h} hours a cancellation or time change is sent to the manager for approval (use the same cancel/reschedule action; the system handles it). Discount codes go in booking.coupon and are checked by the system.`;
}

// The customer's own upcoming confirmed bookings (the only bookings a customer-facing tool may change).
export async function upcomingOf(customerId) {
  const { q } = await dep();
  return q(`SELECT b.id, b.starts_at, s.name service FROM bookings b JOIN services s ON s.id=b.service_id
      WHERE b.customer_id=$1 AND b.starts_at > now() AND b.status='confirmed' ORDER BY b.starts_at`, [customerId]);
}
// What the slot maths needs: every live booking and time off of this business (never shown to the customer).
export async function liveCalendar(bizId) {
  const { q } = await dep();
  const [bookings, timeOff] = await Promise.all([
    q(`SELECT * FROM bookings WHERE business_id=$1 AND ends_at > now() AND status <> 'cancelled'`, [bizId]),
    q('SELECT * FROM time_off WHERE business_id=$1 AND ends_at > now()', [bizId])]);
  return { bookings, timeOff };
}

// Cancel or move one of the customer's own upcoming bookings, following the business's policy.
export async function changeBooking(biz, customer, conv, theirs, decision, timeOff) {
  const { q, one, offerWaitlist } = await dep();
  const want = String(decision.booking?.ref || '').toUpperCase().replace(/\s/g, '');
  const target = theirs.find(b => ref(b.id) === want) || (theirs.length === 1 ? theirs[0] : null);
  const ar = AR.test(decision.reply || '');
  if (!target) return { message: ar ? 'أي حجز تريد تغييره؟ ' + theirs.map(b => `${ref(b.id)} (${label(new Date(b.starts_at))} ${b.service})`).join('، ')
    : 'Which booking do you mean? ' + theirs.map(b => `${ref(b.id)} (${label(new Date(b.starts_at))}, ${b.service})`).join(', ') };
  const h = biz.cancel_hours ?? 24;
  const late = hoursUntil(target.starts_at) < h;
  const full = await one('SELECT * FROM bookings WHERE id=$1', [target.id]);
  const pending = await one(`SELECT id FROM requests WHERE booking_id=$1 AND status='pending' AND type IN ('cancel','reschedule')`, [target.id]);
  if (late && pending) return { tooLate: true, message: ar
    ? `طلبك بخصوص الحجز ${ref(target.id)} قيد المراجعة لدى الإدارة. سنرسل لك الرد هنا قريباً.`
    : `Your request for booking ${ref(target.id)} is already with the manager. We'll message you here as soon as they reply.` };
  if (late && decision.action === 'cancel') {
    // Inside the cancellation window the manager decides; the booking stays until then.
    await q(`INSERT INTO requests (business_id, booking_id, conversation_id, type, details) VALUES ($1,$2,$3,'cancel',$4)`,
      [biz.id, target.id, conv.id, `Cancel ${target.service} on ${label(new Date(target.starts_at))} (less than ${h}h before)`]);
    return { tooLate: true, request: true, message: ar
      ? `*⏳ تم إرسال طلب الإلغاء للموافقة*\n\n• رقم الحجز: ${ref(target.id)}\n• الموعد: ${label(new Date(target.starts_at))}، ${target.service}\n\nلأن الموعد بعد أقل من ${h} ساعة، يحتاج الإلغاء إلى موافقة الإدارة. سنرسل لك الرد هنا. حجزك يبقى قائماً حتى ذلك الحين.`
      : `*⏳ Cancellation sent for approval*\n\n• Booking ref: ${ref(target.id)}\n• Appointment: ${label(new Date(target.starts_at))}, ${target.service}\n\nBecause it's less than ${h} hours away, the manager needs to approve this. We'll message you here with their answer. Your booking stays in place until then.` };
  }
  if (decision.action === 'cancel') {
    await q("UPDATE bookings SET status='cancelled', cancelled_by='customer' WHERE id=$1", [target.id]);
    offerWaitlist(target.id).catch(e => console.error('Waitlist:', e.message));
    await q('UPDATE conversations SET value = GREATEST(value - $1, 0) WHERE id=$2', [full.price, full.conversation_id || 0]);
    return { message: ar
      ? `*❌ تم إلغاء حجزك*\n\n• رقم الحجز: ${ref(target.id)}\n• كان: ${label(new Date(target.starts_at))}، ${target.service}\n\nنتمنى رؤيتك قريباً! إذا أردت موعداً جديداً، أخبرني فقط.`
      : `*❌ Your booking is cancelled*\n\n• Booking ref: ${ref(target.id)}\n• Was: ${label(new Date(target.starts_at))}, ${target.service}\n\nHope to see you soon! Just tell me if you'd like a new time.` };
  }
  // reschedule: same service, new time, same booking ref
  const start = parseLocal(decision.booking?.slot);
  const svc = await one('SELECT * FROM services WHERE id=$1', [full.service_id]);
  if (isNaN(start)) return { message: ar ? 'إلى أي يوم ووقت تريد نقل الحجز؟' : 'Which day and time would you like instead?' };
  const end = new Date(start.getTime() + svc.minutes * 60000);
  const others = await q(`SELECT * FROM bookings WHERE business_id=$1 AND ends_at > now() AND status <> 'cancelled' AND id <> $2`, [biz.id, full.id]);
  if (start < new Date() || !isFree(biz, others, timeOff, start, end, bufferOf(biz, svc.id), svc.id)) {
    const alt = freeSlots(biz, others, timeOff, svc.minutes, 3, new Date(Math.max(Date.now(), start.getTime() - 3 * 3600000)), bufferOf(biz, svc.id), svc.id).map(s => s.label).join(', ');
    return { message: (ar ? 'هذا الوقت غير متاح. ' : "That time isn't available. ") + (alt ? (ar ? 'المتاح: ' : 'I can offer: ') + alt : '') };
  }
  if (late) {
    await q(`INSERT INTO requests (business_id, booking_id, conversation_id, type, details, new_start) VALUES ($1,$2,$3,'reschedule',$4,$5)`,
      [biz.id, full.id, conv.id, `Move ${svc.name} from ${label(new Date(full.starts_at))} to ${label(start)} (less than ${h}h before)`, start]);
    return { tooLate: true, request: true, message: ar
      ? `*⏳ تم إرسال طلب تغيير الموعد للموافقة*\n\n• رقم الحجز: ${ref(full.id)}\n• الموعد الحالي: ${label(new Date(full.starts_at))}\n• الموعد المطلوب: ${label(start)}\n\nلأن الموعد بعد أقل من ${h} ساعة، يحتاج التغيير إلى موافقة الإدارة. سنرسل لك الرد هنا.`
      : `*⏳ Time change sent for approval*\n\n• Booking ref: ${ref(full.id)}\n• Current: ${label(new Date(full.starts_at))}\n• Requested: ${label(start)}\n\nBecause it's less than ${h} hours away, the manager needs to approve this. We'll message you here with their answer.` };
  }
  await q('UPDATE bookings SET starts_at=$1, ends_at=$2, reminder_sent_at=NULL, reminder_status=NULL WHERE id=$3', [start, end, full.id]);
  const booking = { id: full.id, start, end, service: svc, price: Number(full.price), name: customer.name, notes: full.notes };
  return { booking, message: confirmation(biz, booking, decision.reply, true) };
}

const CHANNEL = { whatsapp: ['WhatsApp', 'واتساب'], sms: ['SMS', 'رسالة SMS'], email: ['Email', 'البريد الإلكتروني'], chat: ['In this chat', 'في هذه المحادثة'], telegram: ['Telegram', 'تيليجرام'] };
export { CHANNEL };

// Reminder channels that can really be sent right now (SMS is not connected).
// WhatsApp customers always get WhatsApp, Telegram customers Telegram; other chats only if WhatsApp sending is set up.
export function reminderOptions(convChannel) {
  return [convChannel === 'telegram' && 'telegram', (convChannel === 'whatsapp' || process.env.WA_ACCESS_TOKEN) && 'whatsapp', emailEnabled() && 'email'].filter(Boolean);
}
function contactLines(biz, c, ar) {
  if (!c) return [];
  const phone = /^(test|e2e|walk-in|tg-)/.test(c.phone) ? c.contact_phone : c.phone;
  const ch = c.channel === 'telegram' && c.reminder_channel !== 'email' ? CHANNEL.telegram : CHANNEL[c.reminder_channel] || (CHANNEL[reminderOptions(c.channel)[0]] || CHANNEL.chat), h = biz.reminder_hours || 24;
  return [
    phone && `• ${ar ? 'الهاتف' : 'Phone'}: ${phone}`,
    c.email && `• ${ar ? 'البريد' : 'Email'}: ${c.email}`,
    biz.reminders_enabled !== false && `• ${ar ? 'التذكير' : 'Reminder'}: ${ar ? ch[1] : ch[0]}, ${h} ${ar ? 'ساعة قبل الموعد' : 'hours before'}`,
  ].filter(Boolean);
}

// Stores name / phone / email / reminder preference the AI picked up, after checking they look right.
export async function saveProfile(customer, decision, text, conversationChannel) {
  const { q, one } = await dep();
  const p = decision.customer || {};
  const name = String(p.name || decision.customer_name || decision.booking?.name || '').trim();
  const email = String(p.email || '').trim().toLowerCase();
  const phone = String(p.phone || '').replace(/[^\d+]/g, '');
  const wanted = String(p.reminder_channel || '').toLowerCase();
  const channel = reminderOptions(conversationChannel).includes(wanted) && wanted !== 'telegram' ? wanted : null;
  const sets = [], vals = [];
  const set = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (name.length >= 2 && name.length <= 60 && name !== customer.name) set('name', name);
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email !== customer.email) set('email', email);
  if (phone.replace(/\D/g, '').length >= 7 && /^(test|e2e|walk-in|tg-)/.test(customer.phone)) set('contact_phone', phone);
  if (channel && channel !== customer.reminder_channel) set('reminder_channel', channel);
  // a short "ok" or a number says nothing about the language: keep what we knew
  const lg = langOf(text);
  if (lg !== 'en' || /[a-z]{3,}\s+[a-z]{3,}/i.test(text)) set('language', lg);
  if (!sets.length) return; // nothing new to save (a short "Thanks!" used to crash the reply here)
  vals.push(customer.id);
  await q(`UPDATE customers SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
  Object.assign(customer, await one('SELECT * FROM customers WHERE id=$1', [customer.id]));
}

const SITE = (process.env.PUBLIC_URL || 'https://app.nexfoyz.dev').replace(/\/$/, '');
export function confirmation(biz, b, aiReply, moved = false) {
  // in the language the receptionist is answering in: Arabic, Spanish, French or English
  const lg = langOf(aiReply), ar = lg === 'ar', es = lg === 'es', fr = lg === 'fr';
  const lang = { ar: 'ar', es: 'es-ES', fr: 'fr-FR' }[lg] || 'en-GB';
  const date = fmtDate(b.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, lang);
  const t = d => fmtTime(d);
  const cur = biz.currency || 'USD';
  const money = b.coupon && b.listPrice !== b.price
    ? `${b.price} ${cur} (${ar ? 'بدلاً من' : es ? 'antes' : fr ? 'au lieu de' : 'was'} ${b.listPrice}, ${ar ? 'كود' : es ? 'código' : 'code'} ${b.coupon})` : `${b.price} ${cur}`;
  const ref = 'RB-' + String(b.id).padStart(4, '0');
  const L = ar
    ? [moved ? '🔄 تم تغيير موعدك' : '✅ تم تأكيد حجزك', 'التاريخ', 'الوقت', 'الاسم', 'الخدمة', 'المدة', 'السعر', 'الدفع', 'العنوان', 'رقم الحجز', 'طلب إضافي', 'بانتظار موافقة المدير', 'دقيقة']
    : es ? [moved ? '🔄 Tu cita ha cambiado' : '✅ Tu cita está confirmada', 'Fecha', 'Hora', 'Nombre', 'Servicio', 'Duración', 'Precio', 'Pago', 'Dirección', 'Referencia', 'Petición', 'pendiente de aprobación', 'min']
    : fr ? [moved ? '🔄 Votre rendez-vous a été déplacé' : '✅ Votre rendez-vous est confirmé', 'Date', 'Heure', 'Nom', 'Prestation', 'Durée', 'Prix', 'Paiement', 'Adresse', 'Référence', 'Demande', 'en attente de validation', 'min']
    : [moved ? '🔄 Your booking has been moved' : '✅ Your booking is confirmed', 'Date', 'Time', 'Name', 'Service', 'Duration', 'Price', 'Payment', 'Address', 'Booking ref', 'Extra request', 'waiting for manager approval', 'min'];
  const lines = [
    `*${L[0]}*`, '',
    `• ${L[1]}: ${date}`,
    `• ${L[2]}: ${t(b.start)} – ${t(b.end)}`,
    `• ${L[3]}: ${b.name || '-'}`,
    `• ${L[4]}: ${b.service.name}`,
    b.guests && `• ${ar ? 'عدد الأشخاص' : 'Guests'}: ${b.guests}`,
    `• ${L[5]}: ${b.service.minutes} ${L[12]}`,
    `• ${L[6]}: ${money}`,
    biz.payment_methods && `• ${L[7]}: ${biz.payment_methods}`,
    biz.address && `• ${L[8]}: ${biz.address}`,
    `• ${L[9]}: ${ref}`,
    b.notes && `• ${L[10]}: ${b.notes} (${L[11]})`,
    b.deposit && (ar ? `• عربون لتثبيت الحجز: ${b.deposit} ${cur} عبر ${biz.payment_link}` : `• Reservation fee: ${b.deposit} ${cur} to hold your booking, pay here: ${biz.payment_link}`),
    ...contactLines(biz, b.contact, ar),
    '', ar ? `يمكنك الإلغاء أو التغيير هنا حتى ${biz.cancel_hours ?? 24} ساعة قبل الموعد. بعد ذلك يحتاج أي تغيير إلى موافقة الإدارة.`
      : es ? `Puedes cancelar o cambiar esta cita aquí hasta ${biz.cancel_hours ?? 24} horas antes. Después, los cambios necesitan la aprobación del responsable.`
      : fr ? `Vous pouvez annuler ou modifier ce rendez-vous ici jusqu'à ${biz.cancel_hours ?? 24} heures avant. Ensuite, tout changement doit être validé par le responsable.`
      : `You can cancel or change this booking here up to ${biz.cancel_hours ?? 24} hours before. After that, changes need the manager's approval.`,
    biz.booking_note,
    b.askOffers && (ar ? 'هل تريد عروضنا الخاصة أحياناً؟ أرسل كلمة "العروض".' : es ? '¿Quieres nuestras ofertas especiales de vez en cuando? Responde OFERTAS.'
      : fr ? 'Envie de nos offres spéciales de temps en temps ? Répondez OFFRES.' : 'Want our occasional special offers? Reply OFFERS.'),
    biz.show_branding !== false && '', biz.show_branding !== false && `_Powered by MXAi_ · ${SITE}/go?b=${biz.id}&s=confirm`,
  ].filter(x => x !== null && x !== undefined && x !== false);
  return lines.join('\n');
}

// 3 good times for each service on 3 different days, at different times of day (morning, afternoon, evening),
// so the customer sees real choice instead of three slots on the same day.
export function quickSlots(biz, bookings, timeOff) {
  const out = {}, target = [10 * 60, 14 * 60 + 30, 18 * 60];
  for (const s of (biz.services || []).slice(0, 12)) {
    const byDay = new Map();
    for (const f of freeSlots(biz, bookings, timeOff, s.minutes, 400, new Date(), bufferOf(biz, s.id), s.id)) {
      const t = new Date(f.id), k = localDate(t);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(t);
    }
    const days = [...byDay.values()].slice(0, 3), pick = [];
    days.forEach((list, i) => {
      const want = target[i];
      pick.push(list.reduce((best, t) => Math.abs(wall(t).min - want) < Math.abs(wall(best).min - want) ? t : best, list[0]));
    });
    // fewer than 3 open days ahead: fill with other times on those days
    for (const list of days) for (const t of list) { if (pick.length >= 3) break; if (pick.every(p => Math.abs(t - p) >= 120 * 60000)) pick.push(t); }
    pick.sort((a, b) => a - b);
    out[s.name] = pick.map(t => ({ label: slotLabel(t), slot: `${localDate(t)} ${wall(t).hm}` }));
  }
  return out;
}
// The next open days, for "Another day": short labels the customer can tap.
export function openDays(biz, bookings, timeOff) {
  const days = [];
  for (const a of availability(biz, bookings, timeOff, 21)) { if (a.free && !/closed|fully booked/.test(a.free) && days.length < 10) days.push(dayLabel(parseLocal(a.date + 'T12:00'))); }
  return days;
}
// "Today", "Tomorrow", "Mon 26 Oct" on the business's calendar
export function dayLabel(t) {
  const n = daysBetween(new Date(), t);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${fmtDate(t, { weekday: 'short' })} ${wall(t).d} ${fmtDate(t, { month: 'short' })}`;
}
// "Today 14:00", "Tomorrow 10:30", "Mon 26 Oct 17:00": short enough for a WhatsApp button.
export function slotLabel(t) {
  return `${dayLabel(t)} ${wall(t).hm}`;
}

// ---------- the whole turn around one action, as brain.js handle() did it ----------
// These wrap the functions above with what handle() did around them (lock, deposit, offers question, contact lines,
// confirmation email, extra-request row, owner notifications), so a tool is one call.

// The owner's notifications after an action, exactly as brain.js handle() sent them (booked, moved, cancelled,
// needs approval). `bookedNow`: a booking was made or moved this turn; `action`: 'book' | 'cancel' | 'reschedule'.
export async function notifyOutcome(biz, customer, conv, reply, { bookedNow = false, action = null } = {}) {
  const { notify } = await dep();
  const who = customer.name || 'A customer';
  if (bookedNow && action === 'book') await notify(biz.id, 'booking', `${who} booked by chat`, reply.split('\n').filter(l => /Date|Time|Service|التاريخ|الوقت|الخدمة/.test(l)).join(' ').replace(/[•*]/g, '').trim(), { conversationId: conv.id });
  else if (bookedNow) await notify(biz.id, 'booking', `${who} moved a booking`, null, { conversationId: conv.id });
  if (/cancelled|تم إلغاء/.test(reply) && !bookedNow) await notify(biz.id, 'cancel', `${who} cancelled a booking`, null, { conversationId: conv.id });
  if (/sent for approval|already with the manager|للموافقة/.test(reply) || /waiting for manager approval|بانتظار موافقة/.test(reply)) await notify(biz.id, 'approval', `${who} needs your approval`, null, { conversationId: conv.id });
}

// Book: { ok, message, booking?, needEmail?, already? }. `text` is the customer's message (language of the email
// question), `replyText` the AI's reply (language of the confirmation), `emailSkipped` as computed in handle().
export async function bookTurn({ biz, customer, conv, channel, text = '', replyText = '', emailSkipped = false }, req) {
  const { q, one, withBusinessLock } = await dep();
  // Email reminders need an email address: never book (or promise one) without it.
  if (customer.reminder_channel === 'email' && !customer.email && !emailSkipped)
    return { ok: false, needEmail: true, message: AR.test(text) ? 'ما هو بريدك الإلكتروني لنرسل لك التذكير؟' : "What's your email address, so we can send you the reminder?" };
  const timeOff = await q('SELECT * FROM time_off WHERE business_id=$1 AND ends_at > now()', [biz.id]);
  const result = await withBusinessLock(biz.id, async () => createBooking(biz, customer, conv, req,
    await q(`SELECT * FROM bookings WHERE business_id=$1 AND ends_at > now() AND status <> 'cancelled'`, [biz.id]), timeOff));
  if (!result.ok) return { ok: false, message: result.message, already: !!result.already };
  // The confirmation is built from the saved booking, so every detail is exactly what was stored.
  // reservation fee through the owner's payment link: for everyone, or only for clients who missed before
  if (biz.pay_deposit && biz.payment_link && +biz.deposit_amount > 0 && (biz.deposit_for === 'all'
    || await one(`SELECT 1 FROM bookings WHERE customer_id=$1 AND status='no_show' LIMIT 1`, [customer.id]))) result.booking.deposit = +biz.deposit_amount;
  // ask once for offers consent: only clients who never said yes or no (marketing_at is set by either answer)
  result.booking.askOffers = !customer.marketing_ok && !customer.marketing_at;
  result.booking.contact = { ...await one('SELECT phone, contact_phone, email, reminder_channel FROM customers WHERE id=$1', [customer.id]), channel };
  const reply = confirmation(biz, result.booking, replyText);
  if (result.booking.contact.email && emailEnabled()) {
    const sent = await sendEmail(result.booking.contact.email, `Booking confirmed: ${biz.name}`, reply, biz.name);
    if (!sent.ok) console.warn('Confirmation email not sent:', sent.reason);
  }
  if (result.booking.notes) await q(`INSERT INTO requests (business_id, booking_id, conversation_id, type, details) VALUES ($1,$2,$3,'extra',$4)`,
    [biz.id, result.booking.id, conv.id, result.booking.notes]);
  await notifyOutcome(biz, customer, conv, reply, { bookedNow: true, action: 'book' });
  return { ok: true, booking: result.booking, message: reply };
}

// Cancel or move: { ok, message, booking?, tooLate?, request?, none? }. action: 'cancel' | 'reschedule'.
// `locked: false` reproduces handle()'s forced late-cancel path, which ran changeBooking without the lock.
export async function changeTurn({ biz, customer, conv, replyText = '' }, action, { ref: bookingRef = null, slot = null } = {}, { locked = true } = {}) {
  const { q, withBusinessLock } = await dep();
  const theirs = await upcomingOf(customer.id);
  if (!theirs.length) return { ok: false, none: true, message: AR.test(replyText)
    ? 'لا أجد حجزاً قادماً باسمك هنا. ما هو رقم الحجز أو اليوم؟'
    : "I can't find an upcoming booking for you here. What is the booking ref or the day?" };
  const timeOff = await q('SELECT * FROM time_off WHERE business_id=$1 AND ends_at > now()', [biz.id]);
  const decision = { action, booking: { ref: bookingRef, slot }, reply: replyText };
  const run = () => changeBooking(biz, customer, conv, theirs, decision, timeOff);
  const r = locked ? await withBusinessLock(biz.id, run) : await run();
  await notifyOutcome(biz, customer, conv, r.message, { bookedNow: !!r.booking, action });
  return { ok: !!(r.booking || r.request || /cancelled|تم إلغاء/.test(r.message)), ...r };
}

// Policy is enforced by the app, not left to the AI: when the customer asks to cancel and every one of their
// upcoming bookings is inside the cancellation window, it always becomes an approval request (handle() line
// "asksToCancel(text) && ..."). The orchestrator calls this when the model chose no booking tool.
export function mustRequestLateCancel(biz, text, theirs, tool) {
  return asksToCancel(text) && theirs.length > 0 && theirs.every(b => hoursUntil(b.starts_at) < (biz.cancel_hours ?? 24)) && tool !== 'book';
}

// Waitlist for one day (any time). service may be null (the whole day for any service).
export async function waitlistTurn({ biz, customer }, { serviceId = null, day }) {
  const { joinWaitlist, emit } = await dep();
  await joinWaitlist(biz.id, customer.id, serviceId, String(day).slice(0, 10));
  emit(biz.id, 'message');
  return { ok: true };
}

const looksLikeQuestion = t => /[?؟]/.test(t) || /^\s*(how|what|when|where|which|who|why|do|does|did|is|are|can|could|will|would|should|have|has|shu|sho|kif|wen|ade|qué|cómo|cuándo|dónde|cuánto|tienen|hay|هل|كم|شو|كيف|وين|متى|ماذا|ما)(?=\s|$)/iu.test(t);
// Hand the chat to a person, as handle()'s handoff branch did: the reason the owner sees, a question the AI couldn't
// answer goes to AI Training (Teach) once, and the owner is notified. The conversation is flagged here too (handle()
// did that in its final UPDATE), so the Inbox shows it as waiting even if the orchestrator stops early.
export async function handoffTurn({ biz, customer, conv, text = '' }, { unknown = false, failed = false } = {}) {
  const { q, one, notify } = await dep();
  const attention = failed ? 'The AI did not respond; please reply' : unknown ? "The AI didn't know the answer; please reply" : 'Customer needs a person';
  // When the AI simply failed, only a real question is logged ("tomorrow at 2pm" is an answer, not a question).
  if ((failed && looksLikeQuestion(text)) || unknown) {
    const exists = await one(`SELECT id FROM learning WHERE conversation_id=$1 AND status='open' AND question=$2`, [conv.id, text]);
    if (!exists) await q(`INSERT INTO learning (business_id, conversation_id, question, reason) VALUES ($1,$2,$3,$4)`,
      [biz.id, conv.id, text.slice(0, 1000), failed ? 'ai_failed' : 'unknown']);
  }
  await q(`UPDATE conversations SET needs_attention=true, attention_reason=$2, outcome = CASE WHEN outcome='booked' THEN outcome ELSE 'handoff' END, updated_at=now() WHERE id=$1`, [conv.id, attention]);
  const who = customer.name || 'A customer';
  await notify(biz.id, 'handoff', `${who}: ${attention.toLowerCase()}`, text.slice(0, 200), { conversationId: conv.id });
  return { ok: true, attention };
}
