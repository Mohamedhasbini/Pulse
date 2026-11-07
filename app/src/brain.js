// Handles one incoming customer message: stores it, asks the n8n receptionist
// workflow what to say, carries out any booking/handoff, and returns the reply.
import fs from 'node:fs';
import { q, one, withBusinessLock } from './db.js';
import { complete, hasBackup, primaryReady } from './ai-router.js';
import { joinWaitlist, offerWaitlist } from './autopilot.js';
import { VERTICALS } from './verticals.js';
import { quickAnswer, smallTalk } from './quick.js';
import { emailEnabled, sendEmail } from './email.js';
import { notify } from './notify.js';
import { emit } from './live.js';
import { unify } from './customers.js';
import { hasFeature } from './features.js';
import { customerTurn } from './mxai/index.js';
import { reminderOptions } from './mxai/booking.js';
import { accessOf, stopped } from './billing.js';
import { availability, isFree, freeSlots, bufferOf, label, hoursText, localDate, parseLocal } from './slots.js';
import { inZone, wall, daysBetween, fmtDate, fmtTime } from './clock.js';

const looksLikeQuestion = t => /[?؟]/.test(t) || /^\s*(how|what|when|where|which|who|why|do|does|did|is|are|can|could|will|would|should|have|has|shu|sho|kif|wen|ade|qué|cómo|cuándo|dónde|cuánto|tienen|hay|هل|كم|شو|كيف|وين|متى|ماذا|ما)(?=\s|$)/iu.test(t);
const FALLBACK = 'Thanks for your message! A team member will get back to you shortly.';
const SLOW = "Sorry, I'm a bit slow right now. Could you send that again in a moment? 🙏";

// Last result of talking to the AI, shown on the dashboard.
export const aiHealth = { ok: null, at: null, ms: null, error: null };

// AI pacing: the AI plan allows only so many replies a minute (Gemini free tier: 15). MXAi stays under it
// instead of being refused; what doesn't fit waits in ai_queue and is answered as soon as there is room.
// Counted in the database (ai_calls), so every process together stays under the one plan limit.
const AI_RPM = Math.max(1, +process.env.AI_RPM || 10); // below 15: Jarvis and the coach share the same key
export async function takeAiSlot() {
  return !!(await one(`WITH l AS (SELECT pg_advisory_xact_lock(424242)),
      c AS (SELECT count(*) AS n FROM ai_calls, l WHERE at > now() - interval '60 seconds')
    INSERT INTO ai_calls (at) SELECT now() FROM c WHERE c.n < $1 RETURNING 1`, [AI_RPM]));
}
export async function aiRoom() {
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
// Every message is handled on its business's clock (clock.js): days, hours and labels in that business's time zone.
export async function handleMessage(args) {
  const z = await one('SELECT timezone, name, assistant_name FROM businesses WHERE id=$1', [args.businessId]);
  const r = await inZone(z?.timezone, () => handle(args));
  if (r?.reply && !r.duplicate && r.conversationId && args.channel !== 'test') r.reply = await disclose(r.conversationId, r.reply, z);
  return r;
}
// People must be told they are talking to an AI (EU AI Act, art. 50). The first reply of each chat starts with one
// short line in the customer's language, unless the reply already says it. The stored copy matches what was sent.
const AI_LINE = {
  en: (n, b) => `I'm ${n}, the AI assistant of ${b}.`,
  ar: (n, b) => `أنا ${n}، المساعد الذكي (ذكاء اصطناعي) لـ ${b}.`,
  es: (n, b) => `Soy ${n}, el asistente de IA de ${b}.`,
  fr: (n, b) => `Je suis ${n}, l'assistant IA de ${b}.`,
};
async function disclose(conversationId, reply, biz) {
  if (/\b(AI|IA)\b|ذكاء اصطناعي|virtual assistant|asistente virtual|assistant virtuel/i.test(reply)) return reply;
  const n = await one(`SELECT count(*)::int AS n, max(id) AS last FROM messages WHERE conversation_id=$1 AND role='assistant'`, [conversationId]);
  if (!n || n.n !== 1) return reply; // not the first reply of this chat
  const line = (AI_LINE[langOf(reply)] || AI_LINE.en)(biz?.assistant_name || 'Nora', biz?.name || 'this business');
  const out = `${line}\n${reply}`;
  await q('UPDATE messages SET text=$2 WHERE id=$1', [n.last, out]);
  return out;
}
async function handle({ businessId, phone, name, text, channel = 'whatsapp', waId = null, queued = false }) {
  const biz = await loadBusiness(businessId);
  const customer = await one(
    `INSERT INTO customers (business_id, phone, name) VALUES ($1,$2,$3)
     ON CONFLICT (business_id, phone) DO UPDATE SET name = COALESCE(customers.name, EXCLUDED.name) RETURNING *`,
    [businessId, phone, name || null]);
  // Same phone or email as an existing client: one client, every channel's history together.
  Object.assign(customer, await unify(businessId, customer.id) || {});
  const conv = await openConversation(businessId, customer.id, channel);
  if (!queued) {
    const prev = waId && await one('SELECT id, conversation_id FROM messages WHERE wa_id=$1', [waId]);
    if (prev) {
      const answered = await one(`SELECT 1 FROM messages WHERE conversation_id=$1 AND id>$2 AND role IN ('assistant','staff')`, [prev.conversation_id, prev.id]);
      if (answered) return { duplicate: true }; // a true repeat from the channel
      // saved before a restart but never answered: carry on and answer it now
    } else await q('INSERT INTO messages (conversation_id, role, text, wa_id) VALUES ($1,$2,$3,$4)', [conv.id, 'customer', text, waId]);
  }

  // Staff took over this chat: the AI stays quiet and the owner is alerted.
  if (conv.ai_paused) {
    await q(`UPDATE conversations SET updated_at=now(), needs_attention=true, attention_reason='Customer replied, waiting for you (you took over this chat)' WHERE id=$1`, [conv.id]);
    await notify(businessId, 'handoff', `${customer.name || 'A customer'} replied in a chat you took over`, text.slice(0, 200), { conversationId: conv.id });
    return { reply: null, paused: true, outcome: conv.outcome, conversationId: conv.id };
  }

  // AI switched off for the whole business: nothing is sent automatically, every chat waits for a person.
  if (biz.ai_mode === 'off') {
    await q(`UPDATE conversations SET updated_at=now(), needs_attention=true, attention_reason='AI is off: answer from your Inbox' WHERE id=$1`, [conv.id]);
    await notify(businessId, 'handoff', `${customer.name || 'A customer'} is waiting for a reply (AI is off)`, text.slice(0, 200), { conversationId: conv.id });
    return { reply: null, paused: true, aiOff: true, outcome: conv.outcome, conversationId: conv.id };
  }

  // MXAi plan ended or paused (billing.js): the AI stops, every chat waits for the owner, nothing is lost
  if (stopped(await accessOf(businessId))) {
    await q(`UPDATE conversations SET updated_at=now(), needs_attention=true, attention_reason='Your MXAi plan has ended: answer from your Inbox' WHERE id=$1`, [conv.id]);
    return { reply: null, paused: true, aiOff: true, billing: 'ended', outcome: conv.outcome, conversationId: conv.id };
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
  const lastBot = (await q("SELECT text FROM messages WHERE conversation_id=$1 AND role='assistant' ORDER BY id DESC LIMIT 1", [conv.id]))[0]?.text || '';
  const yesToOffers = /Reply OFFERS|"العروض"/.test(lastBot) && /^(yes|yes please|yeah|sure|ok|okay|sí|si|claro|oui|نعم|اي|إي|أكيد|ايه)[.! ]*$/.test(kw);
  if (yesToOffers || STOP_WORDS.test(kw) || /^(offers|yes offers|subscribe|ofertas|offres|العروض|اشترك)$/.test(kw)) {
    const on = !STOP_WORDS.test(kw), ar = AR.test(text);
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
  // Test lab customers play WhatsApp customers, whose number is always known (test-lab-…); other test chats play web visitors
  const phoneKnown = !/^(test(?!-lab-)|e2e|walk-in|tg-)/.test(customer.phone) || !!customer.contact_phone;
  // Test lab customers play WhatsApp customers, so they get WhatsApp reminders too
  const options = reminderOptions(String(customer.phone).startsWith('test-lab-') ? 'whatsapp' : channel);
  // Asked for an email once and the client answered without one: that's a skip. Reminders go in this chat instead,
  // so the booking never stalls in an email loop (simulation: Karim, Maya, Sara never got booked).
  const emailAsked = history.some(m => m.role === 'assistant' && /e-?mail|بريد|correo/i.test(m.text));
  const emailSkipped = emailAsked && !customer.email && !/@/.test(text);
  if (customer.reminder_channel === 'email' && emailSkipped) {
    await q("UPDATE customers SET reminder_channel='chat' WHERE id=$1", [customer.id]); customer.reminder_channel = 'chat';
  }
  const needEmail = customer.reminder_channel === 'email' && !customer.email;

  // The thinking happens in the MXAi orchestrator (mxai/index.js): it picks the role the owner switched on, gives it
  // only public facts and this customer's own records, asks the AI, checks the answer (guardrails) and runs at most one
  // tool (book, move, cancel, waitlist, hand over). This file keeps the chat housekeeping around it.
  const missing = [!customer.name && 'name', !phoneKnown && 'phone',
    needEmail ? 'email (REQUIRED: they chose email reminders; ask for it now)' : biz.ask_email && emailEnabled() && !customer.email && !emailAsked && 'email (optional, they may skip)',
    !(hist.visits + theirs.length) && options.length > 1 && `reminder preference (${options.map(o => CHANNEL[o][0]).join(' or ')})`].filter(Boolean);
  // the chat so far, oldest first, without the message being answered (it is passed on its own)
  const chat = [...history].reverse(); if (chat.length && chat[chat.length - 1].role === 'customer') chat.pop();
  let decision, failed = false, turn = null;
  const t0 = Date.now();
  try {
    const chit = !queued && smallTalk(text);
    if (chit) decision = { reply: chit, action: 'none', quick: true };
    else {
      if (!(await takeAiSlot())) throw Object.assign(new Error('AI limit reached for this minute'), { busy: true });
      turn = await customerTurn({ biz, customer, conv, channel, text, queued, history: chat, bookings, timeOff, theirs, emailSkipped, missing, options });
      decision = turn.decision;
      Object.assign(aiHealth, { ok: true, at: new Date(), ms: Date.now() - t0, error: null });
      // answered live: an older queued copy of this chat would only repeat it
      await q(`UPDATE ai_queue SET status='answered', answered_at=now(), reply='(answered live by a newer message)' WHERE conversation_id=$1 AND status='waiting'`, [conv.id]);
    }
  } catch (e) {
    // circuit breaker: the AI refused or failed, so give it a full minute of rest (fills this minute's allowance)
    if (!e.busy) await q('INSERT INTO ai_calls (at) SELECT now() FROM generate_series(1, $1)', [AI_RPM]).catch(() => {});
    if (queued) throw e; // the queue worker retries later
    if (!e.busy) {
      console.error('MXAi call failed:', e.message);
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
  let reply = (turn ? turn.reply : decision.reply) || FALLBACK;
  const bookedNow = !!turn?.bookedNow, attention = turn?.attention || null;
  let outcome = conv.outcome === 'booked' || bookedNow ? 'booked' : attention ? 'handoff' : 'answered';
  const quickSlotsNow = quickSlots(biz, bookings, timeOff);
  const who = customer.name || 'A customer';
  // bookings, moves, cancellations, approvals and hand-overs notify the owner from the tools themselves (mxai/booking.js)
  if (!attention && !failed && !decision.quick && String(decision.confidence).toLowerCase() === 'low') await notify(biz.id, 'unsure', `The AI wasn't sure how to answer ${who}`, text.slice(0, 200), { conversationId: conv.id });

  // The chat just ended (booked, or thanks/bye): ask once how it went.
  let asked = false;
  if (!conv.rating_asked_at && !bookedNow && ((smallTalk(text) && await one(`SELECT 1 FROM messages WHERE conversation_id=$1 AND role='assistant' LIMIT 1`, [conv.id])))) {
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
    const times = Object.values(quickSlotsNow || {}).flat().map(x => x.label).filter((l, i, a) => a.indexOf(l) === i && reply.includes(l.replace(/^(Today|Tomorrow) /, '')) && reply.includes(l.split(' ')[0]));
    if (names.length >= 3) choices = cleanOptions(biz.services.map(x => x.name));
    else if (times.length) choices = cleanOptions([...times.slice(0, 3), 'Another day']);
  }
  const confidence = source === 'ai' ? (String(decision.confidence).toLowerCase() === 'low' || decision.unknown_question || decision.action === 'handoff' ? 'low' : 'high') : null;
  // the decision trail: what answered, what it decided and why, so the owner can audit any reply and teach a better one
  const trail = { provider: source === 'ai' ? decision.provider || 'ai' : source, role: turn?.role || null, action: decision.action || 'none', why: decision.why ? String(decision.why).slice(0, 300) : null,
    booked: bookedNow, handed_over: !!attention, unknown: !!decision.unknown_question, rules: (biz.ai_rules || []).length, ms };
  await q('INSERT INTO messages (conversation_id, role, text, latency_ms, failed, source, confidence, options, trail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [conv.id, 'assistant', reply, ms, failed, source, confidence, choices.length ? JSON.stringify(choices) : null, JSON.stringify(trail)]);
  await q(`UPDATE conversations SET outcome=$1, updated_at=now(),
      needs_attention = CASE WHEN $2 THEN true WHEN $5 THEN false ELSE needs_attention END, attention_reason = COALESCE($3, attention_reason)${asked ? ', rating_asked_at=now()' : ''} WHERE id=$4`,
    // a booking made or moved this turn settles the chat: an earlier "needs you" flag is cleared, not left as a false alarm
    [outcome, !!attention, attention, conv.id, bookedNow && !attention]);
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




export function findService(biz, name) {
  const n = String(name || '').toLowerCase().trim();
  // exact name, else the one service whose name contains (or is contained in) what was asked; two candidates =
  // ask which (never book "hair colouring" as "Hair cut" because both start with "hair")
  const exact = biz.services.find(s => s.name.toLowerCase() === n);
  if (exact || !n) return exact || null;
  const near = biz.services.filter(s => { const m = s.name.toLowerCase(); return m.includes(n) || n.includes(m); });
  return near.length === 1 ? near[0] : null;
}


export async function checkCoupon(bizId, code) {
  const c = await one('SELECT *, (expires_on IS NOT NULL AND expires_on < $3::date) AS expired FROM coupons WHERE business_id=$1 AND upper(code)=upper($2)', [bizId, code, localDate(new Date())]);
  if (!c || !c.active) return { ok: false, reason: `Sorry, the code ${code} isn't valid.` };
  if (c.expired) return { ok: false, reason: `Sorry, the code ${code} has expired.` };
  if (c.max_uses && c.uses >= c.max_uses) return { ok: false, reason: `Sorry, the code ${code} has already been fully used.` };
  return { ok: true, coupon: c };
}

const AR = /[\u0600-\u06FF]/;
// Opt-out words for offers, in every language a client may write (Spain: baja; France: désabonner)
const STOP_WORDS = /^(stop|unsubscribe|stop offers|no more offers|baja|darme de baja|parar|no más ofertas|désabonner|desabonner|arrêter|ستوب|الغاء العروض|إلغاء العروض)$/;
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
const ref = id => 'RB-' + String(id).padStart(4, '0');
const hoursUntil = t => (new Date(t) - Date.now()) / 3600000;


const CHANNEL = { whatsapp: ['WhatsApp', 'واتساب'], sms: ['SMS', 'رسالة SMS'], email: ['Email', 'البريد الإلكتروني'], chat: ['In this chat', 'في هذه المحادثة'], telegram: ['Telegram', 'تيليجرام'] };





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


const SITE = (process.env.PUBLIC_URL || 'https://app.nexfoyz.dev').replace(/\/$/, '');
function confirmation(biz, b, aiReply, moved = false) {
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
      pick.push(list.reduce((best, t) => Math.abs(wall(t).min - want) < Math.abs(wall(best).min - want) ? t : best, list[0]));
    });
    // fewer than 3 open days ahead: fill with other times on those days
    for (const list of days) for (const t of list) { if (pick.length >= 3) break; if (pick.every(p => Math.abs(t - p) >= 120 * 60000)) pick.push(t); }
    pick.sort((a, b) => a - b);
    out[s.name] = pick.map(t => ({ label: slotLabel(t), slot: `${localDate(t)} ${wall(t).hm}` }));
  }
  return out;
}
// "Today", "Tomorrow", "Mon 26 Oct" on the business's calendar
function dayLabel(t) {
  const n = daysBetween(new Date(), t);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${fmtDate(t, { weekday: 'short' })} ${wall(t).d} ${fmtDate(t, { month: 'short' })}`;
}
// "Today 14:00", "Tomorrow 10:30", "Mon 26 Oct 17:00": short enough for a WhatsApp button.
function slotLabel(t) {
  return `${dayLabel(t)} ${wall(t).hm}`;
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
        // a person already answered this chat after the message was queued: it's handled, don't answer it again
        if (await one(`SELECT 1 FROM messages WHERE conversation_id=$1 AND role='staff' AND created_at > $2`, [job.conversation_id, job.created_at])) {
          await q(`UPDATE ai_queue SET status='answered', answered_at=now(), reply='(handled by staff)' WHERE id=$1`, [job.id]); continue; }
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
            // the client was told "one moment": tell them a person will answer, in their language, instead of silence
            const wait = { ar: 'شكراً لصبرك. سيرد عليك أحد أعضاء فريقنا قريباً.', es: 'Gracias por tu paciencia. Una persona del equipo te responderá en breve.',
              fr: 'Merci de votre patience. Un membre de l\'équipe vous répondra très bientôt.' }[langOf(job.text)] || 'Thank you for waiting. A member of our team will reply to you shortly.';
            await q(`INSERT INTO messages (conversation_id, role, text, source) VALUES ($1,'assistant',$2,'quick')`, [job.conversation_id, wait]).catch(() => {});
            await deliver({ channel: job.channel, businessId: job.business_id, phone: job.phone, reply: wait, options: [] }).catch(e => console.error('Queue delivery:', e.message));
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
