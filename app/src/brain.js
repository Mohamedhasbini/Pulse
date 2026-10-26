// Handles one incoming customer message: stores it, asks the n8n receptionist
// workflow what to say, carries out any booking/handoff, and returns the reply.
import { q, one, withBusinessLock } from './db.js';
import { VERTICALS } from './verticals.js';
import { quickAnswer, smallTalk } from './quick.js';
import { emailEnabled, sendEmail } from './email.js';
import { notify } from './notify.js';
import { emit } from './live.js';
import { unify } from './customers.js';
import { hasFeature } from './features.js';
import { availability, isFree, freeSlots, bufferOf, label, hoursText, localDate, parseLocal } from './slots.js';

const FALLBACK = 'Thanks for your message! A team member will get back to you shortly.';
const SLOW = "Sorry, I'm a bit slow right now. Could you send that again in a moment? 🙏";

// Last result of talking to the AI, shown on the dashboard.
export const aiHealth = { ok: null, at: null, ms: null, error: null };

// AI pacing: the AI plan allows only so many replies a minute (Gemini free tier: 15). Pulse stays under it
// instead of being refused; what doesn't fit waits in ai_queue and is answered as soon as there is room.
// Counted in the database (ai_calls), so every process together stays under the one plan limit.
const AI_RPM = Math.max(1, +process.env.AI_RPM || 10); // below 15: Jarvis and the coach share the same key
export async function takeAiSlot() {
  return !!(await one(`WITH l AS (SELECT pg_advisory_xact_lock(424242)),
      c AS (SELECT count(*) AS n FROM ai_calls, l WHERE at > now() - interval '60 seconds')
    INSERT INTO ai_calls (at) SELECT now() FROM c WHERE c.n < $1 RETURNING 1`, [AI_RPM]));
}
async function aiRoom() {
  const r = await one(`SELECT count(*)::int AS n FROM ai_calls WHERE at > now() - interval '60 seconds'`);
  return r.n < AI_RPM;
}
const HOLD = "Thanks for your message! I'm checking and will reply here in a moment. 🙏";
const HOLD_AR = 'شكراً لرسالتك! أتحقق الآن وسأرد عليك هنا خلال لحظات. 🙏';

export async function loadBusiness(id) {
  const biz = await one('SELECT * FROM businesses WHERE id=$1', [id]);
  if (biz) biz.services = await q('SELECT * FROM services WHERE business_id=$1 AND active ORDER BY id', [id]);
  if (biz) biz.show_branding = !(await hasFeature(id, 'remove_branding'));
  return biz;
}

async function openConversation(bizId, customerId, channel) {
  const recent = await one(
    `SELECT * FROM conversations WHERE business_id=$1 AND customer_id=$2 AND channel=$3 AND updated_at > now() - interval '24 hours'
     ORDER BY updated_at DESC LIMIT 1`, [bizId, customerId, channel]);
  if (recent) return recent;
  return one('INSERT INTO conversations (business_id, customer_id, channel) VALUES ($1,$2,$3) RETURNING *', [bizId, customerId, channel]);
}

// queued: a second pass from the AI queue; the customer's message is already saved and acknowledged.
export async function handleMessage({ businessId, phone, name, text, channel = 'whatsapp', waId = null, queued = false }) {
  const biz = await loadBusiness(businessId);
  const customer = await one(
    `INSERT INTO customers (business_id, phone, name) VALUES ($1,$2,$3)
     ON CONFLICT (business_id, phone) DO UPDATE SET name = COALESCE(customers.name, EXCLUDED.name) RETURNING *`,
    [businessId, phone, name || null]);
  // Same phone or email as an existing client: one client, every channel's history together.
  Object.assign(customer, await unify(businessId, customer.id) || {});
  const conv = await openConversation(businessId, customer.id, channel);
  if (!queued) {
    if (waId && await one('SELECT 1 FROM messages WHERE wa_id=$1', [waId])) return { duplicate: true };
    await q('INSERT INTO messages (conversation_id, role, text, wa_id) VALUES ($1,$2,$3,$4)', [conv.id, 'customer', text, waId]);
  }

  // Staff took over this chat: the AI stays quiet and the owner is alerted.
  if (conv.ai_paused) {
    await q(`UPDATE conversations SET updated_at=now(), needs_attention=true, attention_reason='Customer replied, waiting for you (you took over this chat)' WHERE id=$1`, [conv.id]);
    await notify(businessId, 'handoff', `${customer.name || 'A customer'} replied in a chat you took over`, text.slice(0, 200), { conversationId: conv.id });
    return { reply: null, paused: true, outcome: conv.outcome, conversationId: conv.id };
  }

  // Satisfaction: the chat asked "how did I do? 1-5"; a bare number or stars is the answer, not a new question.
  if (!queued && conv.rating_asked_at && conv.rating == null) {
    const t = text.trim(), stars = [...t].filter(c => c === '⭐').length;
    const n = /^[1-5](\s*(\/\s*5|stars?|نجوم|⭐)*)?[.!]?$/i.test(t) ? +t[0] : stars && stars === [...t.replace(/\s|️/g, '')].length ? Math.min(stars, 5) : null;
    if (n) {
      const ar = AR.test(t) || /نجوم/.test(t);
      const reply = n >= 4 ? (ar ? 'شكراً جزيلاً! سعداء بخدمتك 😊' : 'Thank you so much! Happy we could help 😊')
        : (ar ? 'نعتذر عن ذلك. ما الذي كان بإمكاننا فعله بشكل أفضل؟' : "Sorry it wasn't better. What could we have done better?");
      await q('UPDATE conversations SET rating=$1, rated_at=now(), updated_at=now() WHERE id=$2', [n, conv.id]);
      await q("INSERT INTO messages (conversation_id, role, text, source) VALUES ($1,'assistant',$2,'quick')", [conv.id, reply]);
      if (n <= 2) await notify(businessId, 'handoff', `${customer.name || 'A customer'} rated their chat ${n}/5`, text.slice(0, 200), { conversationId: conv.id });
      emit(businessId, 'rating');
      return { reply, outcome: conv.outcome, conversationId: conv.id, rated: n };
    }
  }
  // After a low rating the next plain message (not a question) is their comment.
  if (!queued && conv.rating != null && conv.rating <= 3 && !conv.rating_comment && conv.rated_at && Date.now() - new Date(conv.rated_at) < 86400e3 && !/\?|؟/.test(text)) {
    await q('UPDATE conversations SET rating_comment=$1, updated_at=now() WHERE id=$2', [text.slice(0, 1000), conv.id]);
    const reply = AR.test(text) ? 'شكراً على ملاحظتك، سنشاركها مع الفريق 🙏' : "Thank you for telling us. We'll share it with the team 🙏";
    await q("INSERT INTO messages (conversation_id, role, text, source) VALUES ($1,'assistant',$2,'quick')", [conv.id, reply]);
    emit(businessId, 'rating');
    return { reply, outcome: conv.outcome, conversationId: conv.id };
  }

  const kw = text.trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(stop|unsubscribe|stop offers|no more offers|ستوب|الغاء العروض|إلغاء العروض)$/.test(kw) || /^(offers|yes offers|subscribe|العروض|اشترك)$/.test(kw)) {
    const on = !/^(stop|unsubscribe|stop offers|no more offers|ستوب|الغاء العروض|إلغاء العروض)$/.test(kw), ar = AR.test(text);
    await q('UPDATE customers SET marketing_ok=$1, marketing_at=now() WHERE id=$2', [on, customer.id]);
    const reply = on ? (ar ? 'تم! سنرسل لك عروضنا الخاصة. أرسل STOP في أي وقت لإيقافها.' : "Done! You'll get our special offers. Send STOP anytime to stop them.")
      : (ar ? 'تم إيقاف العروض. لن نرسل لك رسائل تسويقية بعد الآن. ستبقى تذكيرات مواعيدك كما هي.' : "You won't get offers from us anymore. Appointment reminders still arrive as usual.");
    await q("INSERT INTO messages (conversation_id, role, text, source) VALUES ($1,'assistant',$2,'quick')", [conv.id, reply]);
    await q('UPDATE conversations SET updated_at=now() WHERE id=$1', [conv.id]);
    return { reply, outcome: conv.outcome, conversationId: conv.id };
  }

  const history = await q('SELECT role, text FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 20', [conv.id]);
  const bookings = await q(`SELECT * FROM bookings WHERE business_id=$1 AND ends_at > now() AND status <> 'cancelled'`, [businessId]);
  const timeOff = await q('SELECT * FROM time_off WHERE business_id=$1 AND ends_at > now()', [businessId]);
  const theirs = await q(`SELECT b.id, b.starts_at, s.name service FROM bookings b JOIN services s ON s.id=b.service_id
      WHERE b.customer_id=$1 AND b.starts_at > now() AND b.status='confirmed' ORDER BY b.starts_at`, [customer.id]);

  // What we already know about this person, so the AI treats regulars like regulars and never re-asks.
  const [hist] = await q(`SELECT count(*) FILTER (WHERE b.status IN ('completed','confirmed') AND b.starts_at < now())::int AS visits,
      to_char(max(b.starts_at) FILTER (WHERE b.status IN ('completed','confirmed') AND b.starts_at < now()), 'YYYY-MM-DD') AS last_visit,
      (SELECT s.name FROM bookings b2 JOIN services s ON s.id=b2.service_id WHERE b2.customer_id=$1 AND b2.status <> 'cancelled'
         GROUP BY s.name ORDER BY count(*) DESC, max(b2.starts_at) DESC LIMIT 1) AS favourite_service,
      count(*) FILTER (WHERE b.status='no_show')::int AS no_shows
      FROM bookings b WHERE b.customer_id=$1`, [customer.id]);
  const phoneKnown = !/^(test|e2e|walk-in|tg-)/.test(customer.phone) || !!customer.contact_phone;
  const options = reminderOptions(channel);
  const needEmail = customer.reminder_channel === 'email' && !customer.email;

  const context = {
    business: { name: biz.name, description: biz.description, address: biz.address, maps_url: biz.maps_url, website: biz.website, instagram: biz.instagram,
      phone: biz.phone, currency: biz.currency, opening_hours: hoursText(biz), team: biz.team, policies: biz.policies,
      faq: [biz.faq, ...(biz.faqs || []).filter(f => f.q && f.a).map(f => `Q: ${f.q}\nA: ${f.a}`)].filter(Boolean).join('\n\n'),
      payment_methods: biz.payment_methods, booking_note: biz.booking_note, languages: biz.languages, tone: biz.tone,
      payment_options: paymentText(biz),
      assistant_name: biz.assistant_name || 'Nora',
      special_instructions: [FAST_FLOW, biz.vertical === 'restaurant' && 'For every reservation ask how many guests, pick the table type that fits that number, and put the number in booking.guests (a whole number). Put any occasion or allergy in booking.notes.', `Your name is ${biz.assistant_name || 'Nora'}, the assistant of ${biz.name}. Use this name when you greet someone or are asked who you are; never call yourself by any other name.`, ownerRules(biz.ai_rules), biz.ai_instructions, await taughtAnswers(businessId), sendingRules(options), CONFIDENCE].filter(Boolean).join('\n\n'), cancellation_policy: policyText(biz),
      type: (VERTICALS[biz.vertical] || VERTICALS.salon).label, persona: (VERTICALS[biz.vertical] || VERTICALS.salon).persona,
      terms: (VERTICALS[biz.vertical] || VERTICALS.salon).terms },
    services: biz.services.map(s => ({ name: s.name, price: Number(s.price), minutes: s.minutes, description: s.description || undefined })),
    availability: availability(biz, bookings, timeOff, 14),
    quick_slots: quickSlots(biz, bookings, timeOff),
    next_open_days: openDays(biz, bookings, timeOff),
    customer: {
      // One person across WhatsApp, Telegram, WeBook and the booking page: their history below covers all of them.
      channels_used: (await q('SELECT DISTINCT channel FROM conversations WHERE customer_id=$1', [customer.id])).map(r => r.channel),
      returning: hist.visits > 0, visits: hist.visits, last_visit: hist.last_visit, favourite_service: hist.favourite_service,
      name: customer.name, phone_known: phoneKnown, email: customer.email, reminder_channel_set: !!customer.reminder_channel && hist.visits + theirs.length > 0,
      reminder_channel: customer.reminder_channel, staff_notes: customer.staff_notes || undefined,
      reminder_options: options,
      missing_for_booking: [!customer.name && 'name', !phoneKnown && 'phone',
        needEmail ? 'email (REQUIRED: they chose email reminders; ask for it now)' : biz.ask_email && emailEnabled() && !customer.email && 'email (optional, they may skip)',
        !(hist.visits + theirs.length) && options.length > 1 && `reminder preference (${options.map(o => CHANNEL[o][0]).join(' or ')})`].filter(Boolean),
      upcoming_bookings: theirs.map(b => ({ ref: ref(b.id), when: label(new Date(b.starts_at)), service: b.service,
        can_change_by_chat: hoursUntil(b.starts_at) >= (biz.cancel_hours ?? 24) })) },
    now: `${label(new Date())} (today is ${localDate(new Date())})`,
    conversation: history.reverse(),
  };

  let decision, failed = false;
  const t0 = Date.now();
  try {
    const chit = !queued && smallTalk(text);
    if (chit) decision = { reply: chit, action: 'none', quick: true };
    else if (!(await takeAiSlot())) throw Object.assign(new Error('AI limit reached for this minute'), { busy: true });
    else try { decision = await askN8n(context, +process.env.AI_TIMEOUT_MS || 15000); }
    catch (first) {
      if (!/timeout|abort/i.test(first.message) || !(await takeAiSlot())) throw first;
      console.warn('AI slow or failed, retrying once:', first.message); decision = await askN8n(context, 15000);
    }
    if (!chit) {
      Object.assign(aiHealth, { ok: true, at: new Date(), ms: Date.now() - t0, error: null });
      // answered live: an older queued copy of this chat would only repeat it
      await q(`UPDATE ai_queue SET status='answered', answered_at=now(), reply='(answered live by a newer message)' WHERE conversation_id=$1 AND status='waiting'`, [conv.id]);
    }
  } catch (e) {
    // circuit breaker: the AI refused or failed, so give it a full minute of rest (fills this minute's allowance)
    if (!e.busy) await q('INSERT INTO ai_calls (at) SELECT now() FROM generate_series(1, $1)', [AI_RPM]).catch(() => {});
    if (queued) throw e; // the queue worker retries later
    if (!e.busy) {
      console.error('n8n call failed:', e.message);
      Object.assign(aiHealth, { ok: false, at: new Date(), ms: Date.now() - t0, error: e.message });
    }
    failed = true;
    // Safety net: answer basic questions straight from the setup; anything else is queued for the AI.
    const quick = quickAnswer(biz, text);
    if (quick) decision = { reply: quick, action: 'none', quick: true };
    else {
      const added = await one(`INSERT INTO ai_queue (conversation_id, business_id, channel, phone, name, text)
          SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM ai_queue WHERE conversation_id=$1 AND status IN ('waiting','working')) RETURNING id`,
        [conv.id, businessId, channel, phone, name || null, text]);
      // already waiting in the queue: that answer will cover this message too, so no second "in a moment"
      if (!added) { await q('UPDATE conversations SET updated_at=now() WHERE id=$1', [conv.id]); return { reply: null, queued: true, outcome: conv.outcome, conversationId: conv.id }; }
      decision = { reply: AR.test(text) ? HOLD_AR : HOLD, action: 'none', quick: true };
      failed = false;
      emit(businessId, 'queue');
    }
  }
  const ms = Date.now() - t0;

  let reply = decision.reply || FALLBACK;
  let outcome = conv.outcome === 'booked' ? 'booked' : 'answered';
  let attention = null, bookedNow = false;

  // Save whatever profile details the customer gave in this message (before booking, so the booking uses them).
  await saveProfile(customer, decision, text, channel);
  Object.assign(customer, await unify(biz.id, customer.id) || {});

  // Email reminders need an email address: never book (or promise one) without it.
  if (decision.action === 'book' && customer.reminder_channel === 'email' && !customer.email) {
    decision = { ...decision, action: 'none' };
    reply = AR.test(text) ? 'ما هو بريدك الإلكتروني لنرسل لك التذكير؟' : "What's your email address, so we can send you the reminder?";
  }
  if (decision.action === 'book' && decision.booking) {
    const result = await withBusinessLock(biz.id, async () => createBooking(biz, customer, conv, decision.booking,
      await q(`SELECT * FROM bookings WHERE business_id=$1 AND ends_at > now() AND status <> 'cancelled'`, [biz.id]), timeOff));
    if (result.ok) {
      outcome = 'booked'; bookedNow = true;
      // The confirmation is built from the saved booking, so every detail is exactly what was stored.
      result.booking.contact = { ...await one('SELECT phone, contact_phone, email, reminder_channel FROM customers WHERE id=$1', [customer.id]), channel };
      reply = confirmation(biz, result.booking, decision.reply);
      if (result.booking.contact.email && emailEnabled()) {
        const sent = await sendEmail(result.booking.contact.email, `Booking confirmed: ${biz.name}`, reply, biz.name);
        if (!sent.ok) console.warn('Confirmation email not sent:', sent.reason);
      }
      if (result.booking.notes) await q(`INSERT INTO requests (business_id, booking_id, conversation_id, type, details) VALUES ($1,$2,$3,'extra',$4)`,
        [biz.id, result.booking.id, conv.id, result.booking.notes]);
    }
    else reply = result.message;
  } else if ((decision.action === 'cancel' || decision.action === 'reschedule') && theirs.length) {
    const r = await withBusinessLock(biz.id, () => changeBooking(biz, customer, conv, theirs, decision, timeOff));
    reply = r.message;
    if (r.booking) { outcome = 'booked'; bookedNow = true; }
  } else if (/cancel|الغ|إلغاء|بلغي/i.test(text) && theirs.length
      && theirs.every(b => hoursUntil(b.starts_at) < (biz.cancel_hours ?? 24)) && decision.action !== 'book') {
    // Policy is enforced by the app, not left to the AI: a late cancellation always becomes an approval request.
    const r = await changeBooking(biz, customer, conv, theirs, { ...decision, action: 'cancel' }, timeOff);
    reply = r.message;
  } else if (decision.action === 'handoff') {
    if (outcome !== 'booked') outcome = 'handoff';
    attention = failed ? 'The AI did not respond; please reply' : decision.unknown_question ? "The AI didn't know the answer; please reply" : 'Customer needs a person';
    // Questions the AI couldn't answer go to AI Training, so staff can teach it once.
    if (failed || decision.unknown_question) {
      const exists = await one(`SELECT id FROM learning WHERE conversation_id=$1 AND status='open' AND question=$2`, [conv.id, text]);
      if (!exists) await q(`INSERT INTO learning (business_id, conversation_id, question, reason) VALUES ($1,$2,$3,$4)`,
        [biz.id, conv.id, text.slice(0, 1000), failed ? 'ai_failed' : 'unknown']);
    }
  }
  const who = customer.name || 'A customer';
  if (bookedNow && decision.action === 'book') await notify(biz.id, 'booking', `${who} booked by chat`, reply.split('\n').filter(l => /Date|Time|Service|التاريخ|الوقت|الخدمة/.test(l)).join(' ').replace(/[•*]/g, '').trim(), { conversationId: conv.id });
  else if (bookedNow) await notify(biz.id, 'booking', `${who} moved a booking`, null, { conversationId: conv.id });
  if (/cancelled|تم إلغاء/.test(reply) && !bookedNow) await notify(biz.id, 'cancel', `${who} cancelled a booking`, null, { conversationId: conv.id });
  if (/sent for approval|already with the manager|للموافقة/.test(reply) || /waiting for manager approval|بانتظار موافقة/.test(reply)) await notify(biz.id, 'approval', `${who} needs your approval`, null, { conversationId: conv.id });
  if (attention) await notify(biz.id, 'handoff', `${who}: ${attention.toLowerCase()}`, text.slice(0, 200), { conversationId: conv.id });
  else if (!failed && !decision.quick && String(decision.confidence).toLowerCase() === 'low') await notify(biz.id, 'unsure', `The AI wasn't sure how to answer ${who}`, text.slice(0, 200), { conversationId: conv.id });
  if (decision.customer_name && !customer.name) {
    await q('UPDATE customers SET name=$1 WHERE id=$2', [decision.customer_name, customer.id]);
  }

  // The chat just ended (booked, or thanks/bye): ask once how it went.
  let asked = false;
  if (!conv.rating_asked_at && ((bookedNow && decision.action === 'book') || (smallTalk(text) && await one(`SELECT 1 FROM messages WHERE conversation_id=$1 AND role='assistant' LIMIT 1`, [conv.id])))) {
    reply += AR.test(text) || AR.test(reply) ? '\n\nسؤال سريع: كيف كانت المحادثة معي؟ أرسل رقماً من 1 إلى 5 ⭐' : '\n\nOne quick thing: how was this chat? Reply with a number from 1 to 5 ⭐';
    asked = true;
  }
  const source = failed ? (decision.quick ? 'quick' : 'fallback') : decision.quick ? 'quick' : 'ai';
  let choices = bookedNow || failed ? [] : cleanOptions(decision.options);
  // The AI sometimes forgets the tap choices: menus and offered times always get them.
  const svcNames = biz.services.map(x => x.name.toLowerCase());
  if (choices.length && choices.every(c => svcNames.includes(c.toLowerCase()))) choices = cleanOptions(biz.services.map(x => x.name)); // a menu always lists every service
  if (!choices.length && !bookedNow && !failed && reply) {
    const names = biz.services.map(x => x.name).filter(n => n.length <= 24 && reply.toLowerCase().includes(n.toLowerCase()));
    const times = Object.values(context.quick_slots || {}).flat().map(x => x.label).filter((l, i, a) => a.indexOf(l) === i && reply.includes(l.replace(/^(Today|Tomorrow) /, '')) && reply.includes(l.split(' ')[0]));
    if (names.length >= 3) choices = cleanOptions(biz.services.map(x => x.name));
    else if (times.length) choices = cleanOptions([...times.slice(0, 3), 'Another day']);
  }
  await q('INSERT INTO messages (conversation_id, role, text, latency_ms, failed, source, confidence, options) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [conv.id, 'assistant', reply, ms, failed, source, source === 'ai' ? (String(decision.confidence).toLowerCase() === 'low' || decision.unknown_question || decision.action === 'handoff' ? 'low' : 'high') : null, choices.length ? JSON.stringify(choices) : null]);
  await q(`UPDATE conversations SET outcome=$1, updated_at=now(),
      needs_attention = needs_attention OR $2, attention_reason = COALESCE($3, attention_reason)${asked ? ', rating_asked_at=now()' : ''} WHERE id=$4`,
    [outcome, !!attention, attention, conv.id]);
  // what the conversation is about (Inbox types, Support topics). A booking stays a booking unless the customer later
  // complains, cancels or changes it; a booking made now always counts as one. A complaint and an unhappy mood stick,
  // so Support still sees them after the chat moves on
  if (source === 'ai') {
    const KINDS = ['booking', 'question', 'change', 'complaint', 'cancel', 'other'], MOODS = ['positive', 'neutral', 'negative'];
    let kind = KINDS.includes(String(decision.kind).toLowerCase()) ? String(decision.kind).toLowerCase() : null;
    if (bookedNow) kind = 'booking';
    const topic = typeof decision.topic === 'string' ? decision.topic.trim().slice(0, 40) || null : null;
    const mood = MOODS.includes(String(decision.mood).toLowerCase()) ? String(decision.mood).toLowerCase() : null;
    if (kind || topic || mood) await q(`UPDATE conversations SET
        kind = CASE WHEN $1::text IS NULL THEN kind WHEN kind='complaint' THEN kind WHEN kind='booking' AND $1 NOT IN ('complaint','cancel','change') THEN kind ELSE $1 END,
        topic = CASE WHEN kind='complaint' AND $1 IS DISTINCT FROM 'complaint' THEN topic ELSE COALESCE($2, topic) END,
        mood = CASE WHEN mood='negative' THEN mood ELSE COALESCE($3, mood) END WHERE id=$4`, [kind, topic, mood, conv.id]);
  }
  emit(biz.id, bookedNow ? 'booking' : 'message');
  return { reply, options: choices, outcome, bookedNow, conversationId: conv.id, failed };
}

async function askN8n(context, timeout) {
  const res = await fetch(process.env.N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: JSON.stringify(context, null, 1), model: process.env.AI_MODEL || undefined }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`n8n responded ${res.status}`);
  const body = await res.json();
  const raw = typeof body === 'string' ? body : body.output ?? body.text ?? body;
  return typeof raw === 'string' ? parseJson(raw) : raw;
}

// The model is asked for JSON; accept it with or without ```json fences.
function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : text); } catch { return { reply: text.trim(), action: 'none' }; }
}

function findService(biz, name) {
  const n = String(name || '').toLowerCase().trim();
  return biz.services.find(s => s.name.toLowerCase() === n)
    || biz.services.find(s => n && (s.name.toLowerCase().includes(n) || n.includes(s.name.toLowerCase().split(/[ &]/)[0])));
}

async function createBooking(biz, customer, conv, req, bookings, timeOff) {
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
  const c = await one('SELECT * FROM coupons WHERE business_id=$1 AND upper(code)=upper($2)', [bizId, code]);
  if (!c || !c.active) return { ok: false, reason: `Sorry, the code ${code} isn't valid.` };
  if (c.expires_on && new Date(c.expires_on) < new Date(localDate(new Date()))) return { ok: false, reason: `Sorry, the code ${code} has expired.` };
  if (c.max_uses && c.uses >= c.max_uses) return { ok: false, reason: `Sorry, the code ${code} has already been fully used.` };
  return { ok: true, coupon: c };
}

const AR = /[\u0600-\u06FF]/;
const ref = id => 'RB-' + String(id).padStart(4, '0');
const hoursUntil = t => (new Date(t) - Date.now()) / 3600000;
function policyText(biz) {
  const h = biz.cancel_hours ?? 24;
  return `Customers can cancel or reschedule in this chat up to ${h} hours before the appointment. Within ${h} hours a cancellation or time change is sent to the manager for approval (use the same cancel/reschedule action; the system handles it). Discount codes go in booking.coupon and are checked by the system.`;
}

// Cancel or move one of the customer's own upcoming bookings, following the business's policy.
async function changeBooking(biz, customer, conv, theirs, decision, timeOff) {
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
  await q('UPDATE bookings SET starts_at=$1, ends_at=$2 WHERE id=$3', [start, end, full.id]);
  const booking = { id: full.id, start, end, service: svc, price: Number(full.price), name: customer.name, notes: full.notes };
  return { booking, message: confirmation(biz, booking, decision.reply, true) };
}

const CHANNEL = { whatsapp: ['WhatsApp', 'واتساب'], sms: ['SMS', 'رسالة SMS'], email: ['Email', 'البريد الإلكتروني'], chat: ['In this chat', 'في هذه المحادثة'], telegram: ['Telegram', 'تيليجرام'] };

// Only options the owner switched on; online payment is not connected yet, so "now" and "deposit" never apply until it is.
function paymentText(biz) {
  const opts = [biz.pay_later && 'pay at the appointment'];
  const live = !!process.env.PAYMENTS_LIVE;
  if (live && biz.pay_now) opts.push('pay online now when booking');
  if (live && biz.pay_deposit && +biz.deposit_amount > 0) opts.push(`a reservation fee of ${+biz.deposit_amount} ${biz.currency || 'USD'} to hold the booking`);
  return opts.filter(Boolean).length ? `Offer only these payment options: ${opts.filter(Boolean).join('; ')}. Never ask for card details in chat.` : 'Do not discuss online payment; never ask for card details.';
}

// The owner's strict rules come first in every request and override everything except safety.
function ownerRules(rules) {
  const list = (Array.isArray(rules) ? rules : []).map(r => String(r.text || r).trim()).filter(Boolean);
  return list.length ? `OWNER'S STRICT RULES (always follow these exactly; they override any other instruction except SAFETY):\n${list.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : '';
}

// Answers the owner corrected or approved in Teach AI: the AI answers similar questions the same way.
async function taughtAnswers(bizId) {
  const rows = await q(`SELECT (SELECT c.text FROM messages c WHERE c.conversation_id=m.conversation_id AND c.role='customer' AND c.id < m.id ORDER BY c.id DESC LIMIT 1) AS asked,
      COALESCE(m.corrected_text, m.text) AS answer FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
      WHERE cv.business_id=$1 AND m.review IN ('corrected','approved') ORDER BY (m.review='corrected') DESC, m.reviewed_at DESC LIMIT 25`, [bizId]);
  const ok = rows.filter(r => r.asked && r.answer && r.answer.length < 700);
  return ok.length ? `ANSWERS THE OWNER TAUGHT YOU (when a customer asks something similar, answer the same way, adapted to the conversation):\n${
    ok.map(r => `- Customer: "${r.asked.slice(0, 200)}" → You: "${r.answer}"`).join('\n')}` : '';
}

// How every conversation should feel: forward in every message, few choices, no repeated questions.
// It overrides the one-question-at-a-time guidance in the base prompt.
const FAST_FLOW = `FAST BOOKING FLOW (overrides any earlier guidance about pacing; the customer must never feel slowed down):
- Move the booking forward in EVERY message. Answer the question AND give the next step in the same message.
- Once the customer names a service or shows interest, do not ask "would you like to book?". Go straight to times.
- When a service is chosen, reply in ONE short message: service, minutes and price, then offer exactly the 3 times listed for it in CONTEXT.quick_slots (use their labels, and always write them in the message text too), and say they can name another day or time.
- The 3 quick_slots are on different days and times of day. Always add "Another day" as the last option.
- "Another day" (or "other day", "next week"): ask which day suits them, with options = CONTEXT.next_open_days (tap a day).
- When they ask for a part of the day (morning, afternoon after 12:00, evening after 17:00, or the Arabic words for these), offer ONLY free times inside that part; if there are none, say so and offer the closest ones.
- When they pick or name a day: offer 3 free times on THAT day from CONTEXT.availability, one morning, one afternoon, one evening when possible (options = those 3 times + "Another day").
- Never list more than 3 times. If they name a time that is taken, offer the 3 closest free times.
- When they ask what you offer, list the services in one short message (name and price only) and ask which one; the options are ALL service names (up to 10).
- Never ask for something you already know (customer.name, phone, earlier answers). Ask any missing booking details together in ONE message, only after the time is chosen.
- As soon as service, time and the required details are known, book right away (action "book"). Do not ask "shall I confirm?".
- Returning customers: suggest their favourite_service with its first quick slot ("Same as last time? Next free: ...").
- Keep messages short: at most 3 short lines, WhatsApp style.
TAP-TO-ANSWER OPTIONS: also add "options" to your JSON: an array of the choices the customer can tap to answer your message, in the order you wrote them. Examples: the 3 times exactly as you wrote them plus "Another day"; service names; "Yes" / "Change time". Each option at most 20 characters. Up to 10 options (3 or fewer is best). Use [] when the customer must type something (a name, an email) or after a booking is confirmed.`;
const CONFIDENCE = 'CONFIDENCE: also add "confidence": "high" or "low" to your JSON. Use "low" when you are not sure your reply is correct, complete or allowed; the owner will review it.'
  + '\nCONVERSATION TAGS: also add "kind" (one of: booking, question, change, complaint, cancel, other: what this customer wants in this conversation so far),'
  + ' "topic" (1 or 2 words in English; use one of: Prices, Opening hours, Booking, Reschedule, Cancellation, Location, Parking, Services, Payment, Waiting time, Staff, Gift cards; only if none fits, a new 1 or 2 word topic)'
  + ' and "mood" (positive, neutral or negative).';

// Reminder channels that can really be sent right now (SMS is not connected).
// WhatsApp customers always get WhatsApp, Telegram customers Telegram; other chats only if WhatsApp sending is set up.
function reminderOptions(convChannel) {
  return [convChannel === 'telegram' && 'telegram', (convChannel === 'whatsapp' || process.env.WA_ACCESS_TOKEN) && 'whatsapp', emailEnabled() && 'email'].filter(Boolean);
}

// Told to the AI every time, so it never promises something the app can't send.
function sendingRules(options) {
  return `WHAT YOU CAN SEND: you can only send messages in this chat. ${emailEnabled()
    ? 'Booking confirmations are emailed automatically if the customer gave an email.'
    : 'Email is NOT available: never offer or promise to email anything, and do not ask for an email address.'} SMS is NOT available.`
    + ` Reminder options right now: ${options.length ? options.join(', ') : 'none besides this chat (reminders appear in this chat; do not ask for a preference)'}.`
    + (emailEnabled() ? ' If the customer chooses email reminders and customer.email is empty, ask for their email address before booking, and put it in customer.email.' : '')
    + ' Never say you have sent or will send something unless the system does it.';
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
async function saveProfile(customer, decision, text, conversationChannel) {
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
  set('language', AR.test(text) ? 'ar' : 'en');
  vals.push(customer.id);
  await q(`UPDATE customers SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
  Object.assign(customer, await one('SELECT * FROM customers WHERE id=$1', [customer.id]));
}

const SITE = (process.env.PUBLIC_URL || 'https://app.nexfoyz.dev').replace(/\/$/, '');
function confirmation(biz, b, aiReply, moved = false) {
  const ar = AR.test(aiReply || '');
  const lang = ar ? 'ar' : 'en-GB';
  const date = b.start.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const t = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const cur = biz.currency || 'USD';
  const money = b.coupon && b.listPrice !== b.price
    ? `${b.price} ${cur} (${ar ? 'بدلاً من' : 'was'} ${b.listPrice}, ${ar ? 'كود' : 'code'} ${b.coupon})` : `${b.price} ${cur}`;
  const ref = 'RB-' + String(b.id).padStart(4, '0');
  const L = ar
    ? [moved ? '🔄 تم تغيير موعدك' : '✅ تم تأكيد حجزك', 'التاريخ', 'الوقت', 'الاسم', 'الخدمة', 'المدة', 'السعر', 'الدفع', 'العنوان', 'رقم الحجز', 'طلب إضافي', 'بانتظار موافقة المدير', 'دقيقة']
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
    ...contactLines(biz, b.contact, ar),
    '', ar ? `يمكنك الإلغاء أو التغيير هنا حتى ${biz.cancel_hours ?? 24} ساعة قبل الموعد. بعد ذلك يحتاج أي تغيير إلى موافقة الإدارة.`
      : `You can cancel or change this booking here up to ${biz.cancel_hours ?? 24} hours before. After that, changes need the manager's approval.`,
    biz.booking_note,
    biz.show_branding !== false && '', biz.show_branding !== false && `_Powered by Pulse_ · ${SITE}/go?b=${biz.id}&s=confirm`,
  ].filter(x => x !== null && x !== undefined && x !== false);
  return lines.join('\n');
}

// 3 good times for each service on 3 different days, at different times of day (morning, afternoon, evening),
// so the customer sees real choice instead of three slots on the same day.
function quickSlots(biz, bookings, timeOff) {
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
      pick.push(list.reduce((best, t) => Math.abs(t.getHours() * 60 + t.getMinutes() - want) < Math.abs(best.getHours() * 60 + best.getMinutes() - want) ? t : best, list[0]));
    });
    // fewer than 3 open days ahead: fill with other times on those days
    for (const list of days) for (const t of list) { if (pick.length >= 3) break; if (pick.every(p => Math.abs(t - p) >= 120 * 60000)) pick.push(t); }
    pick.sort((a, b) => a - b);
    out[s.name] = pick.map(t => ({ label: slotLabel(t), slot: `${localDate(t)} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` }));
  }
  return out;
}
// The next open days, for "Another day": short labels the customer can tap.
function openDays(biz, bookings, timeOff) {
  const days = [];
  for (const a of availability(biz, bookings, timeOff, 21)) { if (a.free && !/closed|fully booked/.test(a.free) && days.length < 10) days.push(dayLabel(new Date(a.date + 'T12:00'))); }
  return days;
}
function dayLabel(t) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const d = new Date(t); d.setHours(0, 0, 0, 0);
  const n = Math.round((d - d0) / 864e5);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${t.toLocaleDateString('en-GB', { weekday: 'short' })} ${t.getDate()} ${t.toLocaleDateString('en-GB', { month: 'short' })}`;
}
// "Today 14:00", "Tomorrow 10:30", "Mon 26 Oct 17:00": short enough for a WhatsApp button.
function slotLabel(t) {
  const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const d = new Date(t); d.setHours(0, 0, 0, 0);
  const days = Math.round((d - d0) / 864e5);
  if (days === 0) return `Today ${hm}`;
  if (days === 1) return `Tomorrow ${hm}`;
  return `${t.toLocaleDateString('en-GB', { weekday: 'short' })} ${t.getDate()} ${t.toLocaleDateString('en-GB', { month: 'short' })} ${hm}`;
}
// Choices the customer can tap: short, unique, at most 10; none once a booking is confirmed.
export function cleanOptions(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.map(o => String(o ?? '').replace(/\s+/g, ' ').trim()).filter(o => o && o.length <= 24 && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase())).slice(0, 10);
}

// ---------- AI queue: answers what could not be answered on the spot ----------
// Oldest first, only while the AI pace allows, never two at once for the same chat. A reply is delivered on
// the customer's channel by `deliver` (WhatsApp/Telegram); test chat and WeBook read it from the chat itself.
export function startAiQueue(deliver) {
  q(`UPDATE ai_queue SET status='waiting' WHERE status='working'`).catch(() => {});
  let busy = false;
  setInterval(async () => {
    if (busy) return; busy = true;
    try {
      await q(`DELETE FROM ai_calls WHERE at < now() - interval '5 minutes'`);
      for (;;) {
        if (!(await aiRoom())) break;
        const job = await one(`UPDATE ai_queue SET status='working', attempts=attempts+1 WHERE id = (
            SELECT id FROM ai_queue WHERE status='waiting' AND next_at <= now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`);
        if (!job) break;
        try {
          const r = await handleMessage({ businessId: job.business_id, phone: job.phone, name: job.name, text: job.text, channel: job.channel, queued: true });
          await q(`UPDATE ai_queue SET status='answered', answered_at=now(), reply=$2 WHERE id=$1`, [job.id, r.reply || null]);
          emit(job.business_id, 'queue');
          if (r.reply) await deliver({ channel: job.channel, businessId: job.business_id, phone: job.phone, reply: r.reply, options: r.options }).catch(e => console.error('Queue delivery:', e.message));
        } catch (e) {
          // no AI room this minute: not a real try, back to the front of the line
          if (e.busy) { await q(`UPDATE ai_queue SET status='waiting', attempts=attempts-1 WHERE id=$1`, [job.id]); break; }
          if (job.attempts >= 6) {
            await q(`UPDATE ai_queue SET status='failed', error=$2 WHERE id=$1`, [job.id, e.message.slice(0, 300)]);
            await q(`UPDATE conversations SET needs_attention=true, attention_reason='The AI could not answer this customer. Please reply yourself.' WHERE id=$1`, [job.conversation_id]);
            await notify(job.business_id, 'handoff', 'A customer is waiting for a reply', job.text.slice(0, 200), { conversationId: job.conversation_id }).catch(() => {});
            emit(job.business_id, 'queue');
          } else {
            // not answered: wait 20 s, 40 s, 80 s... (rate limits clear within a minute)
            await q(`UPDATE ai_queue SET status='waiting', error=$2, next_at=now() + make_interval(secs => 20 * power(2, attempts - 1)) WHERE id=$1`, [job.id, e.message.slice(0, 300)]);
          }
        }
      }
    } catch (e) { console.error('AI queue:', e.message); } finally { busy = false; }
  }, 3000);
}
// Queue tab: recent jobs with how long each waited and what was sent.
export async function aiQueueList(businessId, status) {
  const f = { waiting: `status IN ('waiting','working')`, answered: `status='answered'`, failed: `status='failed'` }[status] || 'true';
  return q(`SELECT a.id, a.conversation_id, a.channel, a.status, a.attempts, a.text, a.reply, a.error, a.created_at, a.answered_at, a.next_at,
      COALESCE(c.name, a.name, a.phone) AS customer,
      extract(epoch FROM COALESCE(a.answered_at, now()) - a.created_at)::int AS wait_s
    FROM ai_queue a LEFT JOIN customers c ON c.business_id=a.business_id AND c.phone=a.phone
    WHERE a.business_id=$1 AND a.created_at > now() - interval '7 days' AND ${f} ORDER BY a.id DESC LIMIT 200`, [businessId]);
}
export async function aiQueueStatus(businessId) {
  return one(`SELECT count(*) FILTER (WHERE status IN ('waiting','working'))::int AS waiting, count(*) FILTER (WHERE status='failed')::int AS failed,
      extract(epoch FROM now() - min(created_at) FILTER (WHERE status IN ('waiting','working')))::int AS oldest_s FROM ai_queue WHERE business_id=$1`, [businessId]);
}
