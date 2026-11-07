// Layer 04 (part 2): every action the AI can take, as one registry.
//
//   TOOLS[name] = { name, kind, audiences, roles, feature?, switchKey?, permission?, describe, params, run(ctx, args) }
//   ctx = { biz, customer, conversation, user, trace, text?, lang?, decision?, emailSkipped?, failed? }
//   run -> { ok, reply?, data?, handoff? }
//
// kind: 'customer' (customer-facing roles act for ONE customer), 'read' (the mxai role reads this business's data),
//       'action' (the mxai role PROPOSES a change; the owner approves it; nothing is sent or changed here).
// access.js decides which tools a turn may use (audience, role, plan feature, Lab switch, staff permission); each
// run() still validates its own arguments strictly, so a model that invents a service or a malformed time gets
// { ok:false } instead of a guess. A result with handoff:true means: hand this chat to a person (the orchestrator
// runs the `handoff` tool and answers with the guardrails' HANDOFF_TEXT unless a reply is given).
//
// The owner tools are ported from team.js (same SQL, same numbers); the customer tools wrap mxai/booking.js.
// Database modules are loaded on first use (see booking.js for why), so this file imports cleanly in pure tests.
import { inZone, tzOf, wall } from '../clock.js';
import { availability, freeSlots, bufferOf, hoursText, localDate, parseLocal } from '../slots.js';
import * as booking from './booking.js';

let M = null;
async function mods() {
  if (M) return M;
  const [db, metrics, agents, marketing] = await Promise.all([import('../db.js'), import('../metrics.js'), import('../agents.js'), import('../marketing.js')]);
  M = { q: db.q, one: db.one, pool: db.pool, metrics, agentFindings: agents.agentFindings, marketingOverview: marketing.overview };
  return M;
}
// tests swap in fakes; null goes back to the real modules
export function _setMods(m) { M = m; }

// ---------- arguments: a small JSON-schema subset, checked strictly ----------
// Supported: type string|integer|number|boolean, enum (strings, case-insensitive), pattern, minLength, maxLength,
// minimum, maximum, required. Unknown arguments are refused. An empty string or null counts as "not given".
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const SLOT = '^\\d{4}-\\d{2}-\\d{2}[T ]\\d{1,2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d\\d:?\\d\\d)?$';
const STAMP = '^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}$';
const REF = '^RB-?\\s?\\d{1,8}$';
export function validate(params, args) {
  const errors = [], out = {};
  if (args == null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, errors: ['arguments must be an object'] };
  const props = params?.properties || {}, required = params?.required || [];
  for (const k of Object.keys(args)) if (!Object.hasOwn(props, k)) errors.push(`unknown argument "${k}"`);
  for (const [k, p] of Object.entries(props)) {
    let v = args[k];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === null || v === undefined) { if (required.includes(k)) errors.push(`"${k}" is required`); continue; }
    if (p.type === 'string') {
      if (typeof v !== 'string') { errors.push(`"${k}" must be text`); continue; }
      if (p.minLength && v.length < p.minLength) { errors.push(`"${k}" is too short`); continue; }
      if (p.maxLength && v.length > p.maxLength) { errors.push(`"${k}" is too long (max ${p.maxLength})`); continue; }
      if (p.enum) { const e = p.enum.find(x => x.toLowerCase() === v.toLowerCase()); if (!e) { errors.push(`"${k}" must be one of ${p.enum.join(', ')}`); continue; } v = e; }
      if (p.pattern && !new RegExp(p.pattern, 'i').test(v)) { errors.push(`"${k}" has the wrong format${p.hint ? ` (use ${p.hint})` : ''}`); continue; }
    } else if (p.type === 'integer' || p.type === 'number') {
      if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) v = Number(v);
      if (typeof v !== 'number' || !Number.isFinite(v) || (p.type === 'integer' && !Number.isInteger(v))) { errors.push(`"${k}" must be ${p.type === 'integer' ? 'a whole number' : 'a number'}`); continue; }
      if (p.minimum != null && v < p.minimum) { errors.push(`"${k}" must be at least ${p.minimum}`); continue; }
      if (p.maximum != null && v > p.maximum) { errors.push(`"${k}" must be at most ${p.maximum}`); continue; }
    } else if (p.type === 'boolean') {
      if (typeof v !== 'boolean') { errors.push(`"${k}" must be true or false`); continue; }
    }
    out[k] = v;
  }
  return errors.length ? { ok: false, errors } : { ok: true, args: out };
}
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
const str = (maxLength, extra = {}) => ({ type: 'string', maxLength, ...extra });
const int = (minimum, maximum, extra = {}) => ({ type: 'integer', ...(minimum != null && { minimum }), ...(maximum != null && { maximum }), ...extra });

// ---------- language of a customer-facing line ----------
// confirmation() and changeBooking() pick their language from the AI's reply text, as in brain.js. When the
// orchestrator gives only a language code, a word in that language stands in for the reply.
const SAMPLE = { ar: 'مرحبا', es: 'hola', fr: 'bonjour', en: '' };
const replyText = ctx => ctx.decision?.reply ?? ctx.reply ?? SAMPLE[ctx.lang] ?? ctx.text ?? '';
const langFor = ctx => ctx.lang && SAMPLE[ctx.lang] !== undefined ? ctx.lang : booking.langOf(ctx.decision?.reply || ctx.text || '');
const say = (ctx, t) => t[langFor(ctx)] || t.en;

// A service the business doesn't have: never guess, hand over. Two that fit: ask which, with tap options.
const unknownService = asked => ({ ok: false, handoff: true, data: { reason: 'unknown_service', asked } });
const whichService = (ctx, list) => ({ ok: false, data: { reason: 'ambiguous_service', options: list.map(s => s.name) },
  reply: say(ctx, { en: `Which one do you mean: ${list.map(s => s.name).join(' or ')}?`, ar: `أي خدمة تقصد: ${list.map(s => s.name).join(' أو ')}؟`,
    es: `¿Cuál quieres: ${list.map(s => s.name).join(' o ')}?`, fr: `Laquelle voulez-vous : ${list.map(s => s.name).join(' ou ')} ?` }) });
const pickService = (ctx, name) => { const m = booking.matchService(ctx.biz, name); return m.service ? { service: m.service } : { fail: m.candidates ? whichService(ctx, m.candidates) : unknownService(name) }; };
const normRef = r => r ? booking.ref(+String(r).replace(/\D/g, '')) : null; // "rb 12" -> "RB-0012"

// Every run() goes through here: strict arguments, the business's clock, a trace step, and no exception escapes.
function define(name, def) {
  const exec = def.run, customerSide = def.audiences.includes('customer');
  return { name, ...def, run: async (ctx = {}, args) => {
    const v = validate(def.params, args);
    if (!v.ok) {
      const r = def.onInvalid ? { ok: false, reply: def.onInvalid(ctx), data: { errors: v.errors } } : { ok: false, handoff: customerSide, data: { errors: v.errors } };
      ctx.trace?.step?.('tools', { tool: name, ok: false, invalid: v.errors });
      return r;
    }
    if (!ctx.biz) return { ok: false, data: { error: 'No business in this turn.' } };
    if (customerSide && (!ctx.customer || !ctx.conversation)) return { ok: false, handoff: true, data: { error: 'No customer in this turn.' } };
    const t0 = Date.now();
    try {
      const r = await inZone(ctx.biz.timezone, () => exec(ctx, v.args));
      ctx.trace?.step?.('tools', { tool: name, ok: !!r.ok, handoff: !!r.handoff, ms: Date.now() - t0 });
      return r;
    } catch (e) {
      console.error(`Tool ${name}:`, e.message);
      ctx.trace?.step?.('tools', { tool: name, ok: false, error: e.message, ms: Date.now() - t0 });
      return customerSide ? { ok: false, handoff: true, data: { error: 'The action failed.' } } : { ok: false, data: { error: e.message } };
    }
  } };
}

const CUSTOMER = ['customer'];
const BOOKING_ROLES = ['receptionist', 'sales'];
const FACING = ['receptionist', 'support', 'sales'];
const INTERNAL = ['owner', 'staff', 'admin'];

// ---------- customer tools: act for this one customer only ----------
// They read the business's calendar (to work out free times) and the customer's OWN bookings and profile; they
// return times, labels and that customer's own booking refs, never anyone else's name, phone, booking or a number.
const customerTools = {
  check_availability: {
    describe: 'free times: for a service (3 by default) on a day and part of the day, or the open days and free ranges when no service is named',
    params: obj({ service: str(80, { hint: 'service name' }), day: str(10, { pattern: DATE, hint: 'YYYY-MM-DD' }),
      part: str(10, { enum: ['morning', 'afternoon', 'evening'] }), count: int(1, 10) }),
    run: async (ctx, a) => {
      const { biz } = ctx;
      let svc = null;
      if (a.service) { const p = pickService(ctx, a.service); if (p.fail) return p.fail; svc = p.service; }
      const { bookings, timeOff } = await booking.liveCalendar(biz.id);
      if (!svc) {
        const days = availability(biz, bookings, timeOff, 14);
        return { ok: true, data: { days: a.day ? days.filter(d => d.date === a.day) : days, next_open_days: booking.openDays(biz, bookings, timeOff),
          quick_slots: booking.quickSlots(biz, bookings, timeOff) } };
      }
      const now = new Date(), from = a.day ? parseLocal(`${a.day} 00:00`) : now;
      // morning before 12:00, afternoon 12:00-17:00, evening from 17:00 (the FAST_FLOW definition)
      const inPart = m => !a.part || (a.part === 'morning' ? m < 720 : a.part === 'afternoon' ? m >= 720 && m < 1020 : m >= 1020);
      const free = freeSlots(biz, bookings, timeOff, svc.minutes, 400, from > now ? from : now, bufferOf(biz, svc.id), svc.id)
        .map(s => new Date(s.id)).filter(t => (!a.day || localDate(t) === a.day) && inPart(wall(t).min)).slice(0, a.count || 3)
        .map(t => ({ label: booking.slotLabel(t), slot: `${localDate(t)} ${wall(t).hm}` }));
      return { ok: true, data: { service: { name: svc.name, minutes: svc.minutes, price: Number(svc.price) }, day: a.day || null, part: a.part || null, free,
        ...(!free.length && { next_open_days: booking.openDays(biz, bookings, timeOff) }) } };
    } },
  book: {
    describe: 'book a service at a time the customer chose (the system checks the time, the discount code and the policy, and writes the confirmation)',
    params: obj({ service: str(80, { hint: 'exact service name' }), slot: str(40, { pattern: SLOT, hint: 'YYYY-MM-DD HH:MM' }), name: str(60, { minLength: 2 }),
      notes: str(500), coupon: str(40), guests: int(1, 500) }, ['service', 'slot']),
    onInvalid: () => 'Sorry, I could not complete that booking. Which service and time would you like?',
    run: async (ctx, a) => {
      const p = pickService(ctx, a.service); if (p.fail) return p.fail;
      const r = await booking.bookTurn({ biz: ctx.biz, customer: ctx.customer, conv: ctx.conversation, channel: ctx.conversation.channel || ctx.channel,
        text: ctx.text || '', replyText: replyText(ctx), emailSkipped: !!ctx.emailSkipped }, { ...a, service: p.service.name });
      if (!r.ok) return { ok: false, reply: r.message, data: { already: !!r.already, need_email: !!r.needEmail } };
      const b = r.booking;
      return { ok: true, reply: r.message, data: { booked: true, ref: booking.ref(b.id), service: b.service.name, slot: `${localDate(b.start)} ${wall(b.start).hm}`, price: b.price } };
    } },
  change_booking: {
    describe: "move one of the customer's own upcoming bookings to a new time (inside the cancellation window it becomes a request to the manager)",
    params: obj({ ref: str(14, { pattern: REF, hint: 'RB-0012' }), slot: str(40, { pattern: SLOT, hint: 'YYYY-MM-DD HH:MM' }) }, ['slot']),
    onInvalid: ctx => say(ctx, { en: 'Which day and time would you like instead?', ar: 'إلى أي يوم ووقت تريد نقل الحجز؟' }),
    run: async (ctx, a) => {
      const r = await booking.changeTurn({ biz: ctx.biz, customer: ctx.customer, conv: ctx.conversation, replyText: replyText(ctx) }, 'reschedule', { ref: normRef(a.ref), slot: a.slot });
      return { ok: r.ok, reply: r.message, data: { moved: !!r.booking, request: !!r.request, none: !!r.none } };
    } },
  cancel_booking: {
    describe: "cancel one of the customer's own upcoming bookings (inside the cancellation window it becomes a request to the manager)",
    params: obj({ ref: str(14, { pattern: REF, hint: 'RB-0012' }) }),
    run: async (ctx, a) => {
      const r = await booking.changeTurn({ biz: ctx.biz, customer: ctx.customer, conv: ctx.conversation, replyText: replyText(ctx) }, 'cancel', { ref: normRef(a.ref) });
      return { ok: r.ok, reply: r.message, data: { cancelled: r.ok && !r.request, request: !!r.request, none: !!r.none } };
    } },
  join_waitlist: {
    describe: 'put the customer on the waitlist for a fully booked day; we message them if a time opens',
    params: obj({ service: str(80, { hint: 'service name' }), day: str(40, { pattern: '^\\d{4}-\\d{2}-\\d{2}([T ]\\d{1,2}:\\d{2})?$', hint: 'YYYY-MM-DD' }) }, ['day']),
    run: async (ctx, a) => {
      let svc = null;
      if (a.service) { const p = pickService(ctx, a.service); if (p.fail) return p.fail; svc = p.service; }
      await booking.waitlistTurn({ biz: ctx.biz, customer: ctx.customer }, { serviceId: svc?.id || null, day: a.day.slice(0, 10) });
      return { ok: true, data: { waitlist: a.day.slice(0, 10), service: svc?.name || null } };
    } },
  save_profile: {
    describe: 'save details the customer gave: name, email, phone (web chats only), reminder channel',
    params: obj({ name: str(60, { minLength: 2 }), email: str(120, { pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', hint: 'name@example.com' }),
      phone: str(25, { pattern: '^\\+?[\\d\\s().-]{6,24}$', hint: '+961 70 123456' }), reminder_channel: str(10, { enum: ['whatsapp', 'email', 'telegram', 'sms', 'chat'] }) }),
    run: async (ctx, a) => {
      // a skipped email stays skipped: the AI may not switch the reminders back to email in the same breath
      if (ctx.emailSkipped && a.reminder_channel === 'email') delete a.reminder_channel;
      await booking.saveProfile(ctx.customer, { customer: a }, ctx.text || '', ctx.conversation.channel || ctx.channel);
      return { ok: true, data: { saved: Object.keys(a) } };
    } },
  handoff: {
    describe: "hand this chat to a person: the customer asks for one, a complaint or problem you can't fix, or a question you can't answer from the facts",
    params: obj({ reason: str(300), unknown_question: { type: 'boolean' } }),
    run: async (ctx, a) => {
      const r = await booking.handoffTurn({ biz: ctx.biz, customer: ctx.customer, conv: ctx.conversation, text: ctx.text || '' }, { unknown: !!a.unknown_question, failed: !!ctx.failed });
      return { ok: true, handoff: true, data: { attention: r.attention, reason: a.reason || null } };
    } },
  // No store is connected yet, so an order can't be looked up: say so and hand over. When a store connector exists
  // (Lab › Controls), this gets switchKey 'integration:<store>' and reads the order from it.
  order_status: {
    roles: ['support'],
    describe: 'look up the status of an order (no store is connected yet: this hands the chat to the team)',
    params: obj({ order: str(40, { hint: 'order number' }) }),
    run: async ctx => ({ ok: false, handoff: true, data: { reason: 'no_store_connector' }, reply: say(ctx, {
      en: "I can't look up orders here yet, so I've passed your question to the team. They'll get back to you here soon.",
      ar: 'لا أستطيع الاطلاع على الطلبات من هنا بعد، لذلك حوّلت سؤالك إلى الفريق. سيردّون عليك هنا قريباً.',
      es: 'Todavía no puedo consultar pedidos desde aquí, así que he pasado tu pregunta al equipo. Te responderán aquí pronto.',
      fr: "Je ne peux pas encore consulter les commandes ici, j'ai donc transmis votre question à l'équipe. Elle vous répondra ici bientôt." }) }) },
};
const CUSTOMER_ROLES = { check_availability: BOOKING_ROLES, book: BOOKING_ROLES, change_booking: BOOKING_ROLES, cancel_booking: BOOKING_ROLES,
  join_waitlist: BOOKING_ROLES, save_profile: FACING, handoff: FACING };

// ---------- owner tools (mxai role): ported from team.js, same SQL ----------
// B is team.js's business scope: id, name, vertical, currency, tz.
const scope = biz => ({ id: biz.id, name: biz.name, vertical: biz.vertical, currency: biz.currency, tz: tzOf(biz) });
const TZ = `COALESCE(bz.timezone,'Asia/Beirut')`;
const day = d => `to_char(${d} AT TIME ZONE ${TZ},'Dy DD Mon HH24:MI')`;
// real clients: no test phones, and not people whose latest chat is a test chat
const REAL = `cu.phone !~ '^(test|e2e|walk-in|tg-)' AND COALESCE((SELECT c.channel FROM conversations c WHERE c.customer_id=cu.id ORDER BY c.updated_at DESC LIMIT 1),'') <> 'test'`;
const DAYS = (d = 'days') => obj({ [d]: int(1) });

// read(fn): the team.js run(B, a) body; an { error } result becomes ok:false so the model knows it failed
const read = fn => async (ctx, a) => { const data = await fn(scope(ctx.biz), a, ctx); return { ok: !(data && !Array.isArray(data) && data.error), data }; };

const readTools = {
  today: { permission: 'overview', describe: 'today: appointments, revenue, chats waiting for the owner, approvals, AI replies', params: obj(),
    run: read(async B => { const { q, metrics } = await mods();
      return { ...await metrics.today(B.id).then(m => ({ appointments_today: m.visits_today, revenue_today: m.revenue_today })), ...(await q(`SELECT
      (SELECT count(*) FROM bookings WHERE business_id=$1 AND status<>'cancelled' AND created_at > now() - interval '24 hours')::int AS booked_last_24h,
      (SELECT count(*) FROM conversations WHERE business_id=$1 AND needs_attention AND channel<>'test')::int AS chats_waiting_for_owner,
      (SELECT count(*) FROM requests WHERE business_id=$1 AND status='pending')::int AS approvals_waiting,
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 AND m.role='assistant' AND m.created_at > now() - interval '24 hours')::int AS ai_replies_24h,
      to_char(now() AT TIME ZONE $2,'Dy DD Mon YYYY HH24:MI') AS now`, [B.id, B.tz]))[0] }; }) },
  bookings: { permission: 'calendar', describe: 'bookings in a date range (default: next 7 days), with time, client, service, price, status and who booked it',
    params: obj({ from: str(10, { pattern: DATE, hint: 'YYYY-MM-DD' }), to: str(10, { pattern: DATE, hint: 'YYYY-MM-DD' }), status: str(10, { enum: ['confirmed', 'completed', 'no_show', 'cancelled', 'any'] }) }),
    run: read(async (B, a) => { const { q } = await mods();
      const list = await q(`SELECT b.id AS booking_id, ${day('b.starts_at')} AS at, cu.name AS client, cu.id AS client_id, s.name AS service, b.price::float, b.status, b.source AS booked_by
      FROM bookings b JOIN customers cu ON cu.id=b.customer_id JOIN services s ON s.id=b.service_id JOIN businesses bz ON bz.id=b.business_id
      WHERE b.business_id=$1 AND (b.starts_at AT TIME ZONE $2)::date BETWEEN COALESCE($3::date,(now() AT TIME ZONE $2)::date) AND COALESCE($4::date,(now() AT TIME ZONE $2)::date + 7)
      AND ($5='any' OR b.status=$5) ORDER BY b.starts_at LIMIT 60`, [B.id, B.tz, a.from || null, a.to || null, a.status || (a.from && new Date(a.from) < new Date() ? 'any' : 'confirmed')]);
      return { count: list.length, total_value: list.reduce((x, b) => x + (b.status === 'cancelled' ? 0 : b.price), 0), bookings: list }; }) },
  free_slots: { permission: 'calendar', describe: 'free times for a service (default: the first service) from a date, exactly as the receptionist offers them',
    params: obj({ service: str(80), from: str(10, { pattern: DATE, hint: 'YYYY-MM-DD' }), count: int(1, 20) }),
    run: read(async (B, a, ctx) => {
      const biz = ctx.biz, svc = biz.services.find(s => a.service && s.name.toLowerCase().includes(String(a.service).toLowerCase())) || biz.services[0];
      if (!svc) return { error: 'No services set up.' };
      const { bookings: bk, timeOff: off } = await booking.liveCalendar(B.id);
      const from = a.from ? new Date(a.from + 'T00:00') : new Date();
      return { service: svc.name, minutes: svc.minutes, opening_hours: hoursText(biz), free: freeSlots(biz, bk, off, svc.minutes, Math.min(+a.count || 8, 20), from > new Date() ? from : new Date(), bufferOf(biz, svc.id), svc.id).map(s => s.label) };
    }) },
  services: { permission: 'calendar', describe: 'the services with price and length', params: obj(),
    run: read(async B => (await mods()).q(`SELECT id AS service_id, name, price::float, minutes FROM services WHERE business_id=$1 ORDER BY name`, [B.id])) },
  find_customer: { permission: 'customers', describe: 'search clients by name or phone', params: obj({ query: str(80) }, ['query']),
    run: read(async (B, a) => (await mods()).q(`SELECT cu.id, cu.name, cu.phone, cu.marketing_ok AS agreed_to_offers,
      (SELECT count(*) FROM bookings b WHERE b.customer_id=cu.id AND b.status IN ('completed','confirmed') AND b.starts_at<now())::int AS visits
      FROM customers cu WHERE cu.business_id=$1 AND ${REAL} AND (cu.name ILIKE $2 OR cu.phone ILIKE $2) ORDER BY visits DESC LIMIT 10`, [B.id, `%${String(a.query || '').trim()}%`])) },
  customer: { permission: 'customers', describe: 'one client in full: visits, spend, no-shows, upcoming and last bookings, last chat', params: obj({ id: int(1) }, ['id']),
    run: read(async (B, a) => { const { q, one } = await mods();
      const c = await one(`SELECT cu.id, cu.name, cu.phone, cu.marketing_ok AS agreed_to_offers, to_char(cu.created_at,'DD Mon YYYY') AS client_since FROM customers cu WHERE cu.id=$1 AND cu.business_id=$2`, [+a.id, B.id]);
      if (!c) return { error: 'No such client.' };
      const [stats] = await q(`SELECT count(*) FILTER (WHERE status IN ('completed','confirmed') AND starts_at<now())::int AS visits, COALESCE(sum(price) FILTER (WHERE status IN ('completed','confirmed') AND starts_at<now()),0)::float AS spent,
          count(*) FILTER (WHERE status='no_show')::int AS no_shows, count(*) FILTER (WHERE status='cancelled')::int AS cancellations FROM bookings WHERE customer_id=$1`, [c.id]);
      const list = await q(`SELECT ${day('b.starts_at')} AS at, s.name AS service, b.status, b.price::float FROM bookings b JOIN services s ON s.id=b.service_id JOIN businesses bz ON bz.id=b.business_id WHERE b.customer_id=$1 ORDER BY b.starts_at DESC LIMIT 8`, [c.id]);
      const chat = await one(`SELECT c.kind, c.topic, c.mood, c.rating, (SELECT text FROM messages m WHERE m.conversation_id=c.id AND m.role='customer' ORDER BY id DESC LIMIT 1) AS last_message FROM conversations c WHERE c.customer_id=$1 ORDER BY c.updated_at DESC LIMIT 1`, [c.id]);
      return { ...c, ...stats, bookings: list, last_chat: chat }; }) },
  support: { permission: 'overview', describe: 'support results for N days: chats, share solved by the AI alone, handovers and why, ratings, open cases, kinds and top topics', params: DAYS(),
    run: read(async (B, a) => { const { q } = await mods();
      const d = Math.min(Math.max(+a.days || 30, 1), 365), P = [B.id, d];
      const [s] = await q(`SELECT count(*)::int AS chats, count(*) FILTER (WHERE attention_reason IS NULL AND COALESCE(outcome,'') IN ('booked','answered'))::int AS solved_by_ai,
          count(*) FILTER (WHERE attention_reason IS NOT NULL)::int AS handed_to_owner, round(avg(rating),2)::float AS avg_rating, count(rating)::int AS ratings,
          count(*) FILTER (WHERE kind='complaint')::int AS complaints, count(*) FILTER (WHERE mood='negative')::int AS unhappy
          FROM conversations WHERE business_id=$1 AND channel<>'test' AND created_at > now() - make_interval(days => $2)`, P);
      const reasons = await q(`SELECT attention_reason AS reason, count(*)::int AS n FROM conversations WHERE business_id=$1 AND channel<>'test' AND attention_reason IS NOT NULL AND created_at > now() - make_interval(days => $2) GROUP BY 1 ORDER BY 2 DESC LIMIT 5`, P);
      const topics = await q(`SELECT initcap(topic) AS topic, count(*)::int AS n FROM conversations WHERE business_id=$1 AND channel<>'test' AND topic IS NOT NULL AND created_at > now() - make_interval(days => $2) GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, P);
      const [open] = await q(`SELECT count(*)::int AS open_cases FROM conversations WHERE business_id=$1 AND needs_attention AND channel<>'test'`, [B.id]);
      return { period: `last ${d} days`, ...s, ...open, handover_reasons: reasons, top_topics: topics, note: 'test chats are excluded' }; }) },
  conversations: { permission: 'overview', describe: 'recent conversations, optionally only those waiting for the owner, or of one kind (booking, question, change, complaint, cancel)',
    params: obj({ waiting: { type: 'boolean' }, kind: str(10, { enum: ['booking', 'question', 'change', 'complaint', 'cancel', 'other'] }), days: int(1) }),
    run: read(async (B, a) => (await mods()).q(`SELECT c.id AS chat_id, cu.name AS client, cu.id AS client_id, c.channel, c.kind, c.topic, c.mood, c.outcome, c.needs_attention AS waiting_for_owner, c.attention_reason AS why,
      ${day('c.updated_at')} AS updated, (SELECT left(text,160) FROM messages m WHERE m.conversation_id=c.id AND m.role='customer' ORDER BY id DESC LIMIT 1) AS last_customer_message
      FROM conversations c JOIN customers cu ON cu.id=c.customer_id JOIN businesses bz ON bz.id=c.business_id
      WHERE c.business_id=$1 AND c.channel<>'test' AND c.updated_at > now() - make_interval(days => $2) AND (NOT $3 OR c.needs_attention) AND ($4='' OR c.kind=$4)
      ORDER BY c.needs_attention DESC, c.updated_at DESC LIMIT 25`, [B.id, Math.min(+a.days || 14, 90), !!a.waiting, String(a.kind || '')])) },
  conversation: { permission: 'overview', describe: 'the messages of one conversation', params: obj({ id: int(1) }, ['id']),
    run: read(async (B, a) => { const { q, one } = await mods();
      const c = await one('SELECT id FROM conversations WHERE id=$1 AND business_id=$2', [+a.id, B.id]); if (!c) return { error: 'No such conversation.' };
      return q(`SELECT role, left(text,400) AS text, ${"to_char(created_at,'DD Mon HH24:MI')"} AS at FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 20`, [c.id]); }) },
  unanswered: { permission: 'teach', describe: 'questions the AI could not answer, most asked first, with their id for teaching', params: obj(),
    run: read(async B => (await mods()).q(`SELECT min(id) AS id, min(question) AS question, count(*)::int AS times FROM learning WHERE business_id=$1 AND status='open' GROUP BY lower(question) ORDER BY 3 DESC LIMIT 15`, [B.id])) },
  reviews: { permission: 'overview', describe: 'latest ratings and comments from clients', params: DAYS(),
    run: read(async (B, a) => (await mods()).q(`SELECT c.id AS chat_id, cu.name AS client, cu.id AS client_id, c.rating, c.rating_comment AS comment, c.topic, ${day('c.rated_at')} AS at FROM conversations c JOIN customers cu ON cu.id=c.customer_id JOIN businesses bz ON bz.id=c.business_id
      WHERE c.business_id=$1 AND c.rating IS NOT NULL AND c.channel<>'test' AND c.rated_at > now() - make_interval(days => $2) ORDER BY c.rated_at DESC LIMIT 20`, [B.id, Math.min(+a.days || 30, 365)])) },
  rules: { permission: 'teach', describe: 'the strict rules the AI receptionist follows', params: obj(),
    run: read(async B => (await (await mods()).one('SELECT ai_rules FROM businesses WHERE id=$1', [B.id])).ai_rules || []) },
  opportunities: { permission: 'customers', describe: 'what the growth agents found now: clients to win back, warm leads, quiet days, risky bookings, review requests (with counts and names)', params: obj(),
    run: read(async B => (await (await mods()).agentFindings(B.id)).out.map(a => ({ agent: a.id, name: a.name, blocked: a.blocked, found: a.list.length, examples: a.list.slice(0, 5).map(f => `${f.name || f.phone}: ${f.why}`) }))) },
  top_customers: { permission: 'customers', describe: 'best clients by spend, with visits and last visit', params: obj({ limit: int(1) }),
    run: read(async (B, a) => (await mods()).q(`SELECT cu.id, cu.name, count(*)::int AS visits, sum(b.price)::float AS spent, to_char(max(b.starts_at),'DD Mon YYYY') AS last_visit
      FROM bookings b JOIN customers cu ON cu.id=b.customer_id WHERE b.business_id=$1 AND ${REAL} AND b.status IN ('completed','confirmed') AND b.starts_at<now()
      GROUP BY cu.id ORDER BY spent DESC LIMIT $2`, [B.id, Math.min(+a.limit || 10, 30)])) },
  quiet_days: { permission: 'calendar', describe: 'how full each of the next 7 days is', params: obj(),
    run: read(async B => (await mods()).q(`WITH d AS (SELECT generate_series((now() AT TIME ZONE $2)::date + 1, (now() AT TIME ZONE $2)::date + 7, '1 day')::date AS day)
      SELECT to_char(d.day,'Dy DD Mon') AS day, (SELECT count(*) FROM bookings b WHERE b.business_id=$1 AND b.status='confirmed' AND (b.starts_at AT TIME ZONE $2)::date=d.day)::int AS bookings,
      (SELECT COALESCE(sum(extract(epoch FROM b.ends_at-b.starts_at)/3600),0)::float FROM bookings b WHERE b.business_id=$1 AND b.status='confirmed' AND (b.starts_at AT TIME ZONE $2)::date=d.day) AS booked_hours FROM d`, [B.id, B.tz])) },
  overview: { permission: 'insights', describe: 'totals for a period and the period before: revenue, bookings, average ticket, no-shows, cancellations, new clients', params: DAYS(),
    run: read(async (B, a) => { const { one } = await mods(); const d = Math.min(Math.max(+a.days || 30, 1), 365);
      // same definition as the Insights page: bookings not cancelled whose start falls in the period (the current one runs on into booked future dates)
      const row = (f, t) => one(`SELECT COALESCE(sum(price) FILTER (WHERE status<>'cancelled'),0)::float AS revenue, count(*) FILTER (WHERE status<>'cancelled')::int AS bookings,
          round(avg(price) FILTER (WHERE status<>'cancelled'),2)::float AS avg_ticket, count(*) FILTER (WHERE status='no_show')::int AS no_shows, count(*) FILTER (WHERE status='cancelled')::int AS cancellations,
          COALESCE(sum(price) FILTER (WHERE status<>'cancelled' AND starts_at > now()),0)::float AS of_which_still_ahead
          FROM bookings WHERE business_id=$1 AND starts_at > now() - make_interval(days => $2) AND ($3 = 0 OR starts_at <= now() - make_interval(days => $3))`, [B.id, f, t]);
      const [cur, prev, nc] = await Promise.all([row(d, 0), row(d * 2, d), one(`SELECT count(*)::int AS n FROM customers cu WHERE business_id=$1 AND ${REAL} AND created_at > now() - make_interval(days => $2)`, [B.id, d])]);
      return { period: `last ${d} days`, compared_with: `the ${d} days before`, this_period: cur, previous_period: prev, new_clients: nc.n, note: 'same numbers as the Insights page: bookings not cancelled starting in the period; test chats excluded from new clients' }; }) },
  revenue: { permission: 'insights', describe: 'revenue and bookings per week for the last N weeks', params: DAYS('weeks'),
    run: read(async (B, a) => (await mods()).q(`SELECT to_char(date_trunc('week', starts_at AT TIME ZONE $2),'DD Mon') AS week, count(*)::int AS bookings, sum(price)::float AS revenue FROM bookings
      WHERE business_id=$1 AND status IN ('completed','confirmed') AND starts_at <= now() AND starts_at > now() - make_interval(weeks => $3) GROUP BY 1, date_trunc('week', starts_at AT TIME ZONE $2) ORDER BY date_trunc('week', starts_at AT TIME ZONE $2)`, [B.id, B.tz, Math.min(+a.weeks || 8, 52)])) },
  by_service: { permission: 'insights', describe: 'bookings, revenue, cancellations and no-shows per service for N days', params: DAYS(),
    run: read(async (B, a) => ({ period: `last ${Math.min(+a.days || 30, 365)} days`, services: await (await mods()).q(`SELECT s.name AS service, count(*) FILTER (WHERE b.status IN ('completed','confirmed'))::int AS bookings, COALESCE(sum(b.price) FILTER (WHERE b.status IN ('completed','confirmed')),0)::float AS revenue,
      count(*) FILTER (WHERE b.status='cancelled')::int AS cancelled, count(*) FILTER (WHERE b.status='no_show')::int AS no_shows
      FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.business_id=$1 AND b.starts_at > now() - make_interval(days => $2) GROUP BY s.name ORDER BY revenue DESC`, [B.id, Math.min(+a.days || 30, 365)]) })) },
  by_channel: { permission: 'insights', describe: 'where bookings came from for N days (AI chat per channel, online page, manual)', params: DAYS(),
    run: read(async (B, a) => (await mods()).q(`SELECT COALESCE(CASE WHEN b.source='ai' THEN c.channel ELSE b.source END,'other') AS channel, count(*)::int AS bookings, sum(b.price)::float AS value
      FROM bookings b LEFT JOIN conversations c ON c.id=b.conversation_id WHERE b.business_id=$1 AND b.status<>'cancelled' AND b.created_at > now() - make_interval(days => $2) GROUP BY 1 ORDER BY 2 DESC`, [B.id, Math.min(+a.days || 30, 365)])) },
  busy_times: { permission: 'insights', describe: 'booked appointments by weekday and hour for N days', params: DAYS(),
    run: read(async (B, a) => (await mods()).q(`SELECT to_char(starts_at AT TIME ZONE $2,'Dy') AS weekday, extract(hour FROM starts_at AT TIME ZONE $2)::int AS hour, count(*)::int AS bookings FROM bookings
      WHERE business_id=$1 AND status<>'cancelled' AND starts_at > now() - make_interval(days => $3) GROUP BY 1,2 ORDER BY 3 DESC LIMIT 15`, [B.id, B.tz, Math.min(+a.days || 60, 365)])) },
};

// ---------- any question about the data: a read-only query, fenced in (moved from team.js) ----------
// The model writes one SELECT against these views only; each one is this business's rows and nothing else.
// Any other real table name, any write, and any system function are refused before the query runs; it runs in a
// read-only transaction with a 3 second limit and returns at most 200 rows.
export const VIEWS = {
  bookings: `SELECT id, customer_id, service_id, conversation_id, starts_at, ends_at, price::float AS price, status, source, created_at FROM public.bookings WHERE business_id=$1`,
  customers: `SELECT id, name, phone, email, marketing_ok, created_at FROM public.customers WHERE business_id=$1`,
  services: `SELECT id, name, price::float AS price, minutes FROM public.services WHERE business_id=$1`,
  conversations: `SELECT id, customer_id, channel, outcome, kind, topic, mood, rating, rating_comment, needs_attention, attention_reason, created_at, updated_at FROM public.conversations WHERE business_id=$1`,
  messages: `SELECT m.id, m.conversation_id, m.role, m.text, m.source, m.created_at FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id WHERE c.business_id=$1`,
  requests: `SELECT id, booking_id, conversation_id, type, details, status, created_at FROM public.requests WHERE business_id=$1`,
  questions: `SELECT id, question, status, answer, created_at FROM public.learning WHERE business_id=$1`,
  campaigns: `SELECT id, name, message, sent, skipped, created_at FROM public.campaigns WHERE business_id=$1`,
  time_off: `SELECT id, starts_at, ends_at, reason FROM public.time_off WHERE business_id=$1`,
};
// Allowlist, not blocklist: Postgres has thousands of functions (schema_to_xml, table_to_xml, ...) and a list of
// forbidden ones always misses one that reads other businesses' tables. Anything called like a function must be one
// of these, and a ::cast may only name a plain type (a 'users'::regclass cast would reach a table by its name).
const CALLS = new Set(('count sum avg min max round floor ceil ceiling abs coalesce nullif greatest least date_trunc date_part extract '
  + 'to_char to_date to_timestamp now age make_interval lower upper initcap length trim btrim ltrim rtrim left right substring substr '
  + 'position strpos replace concat concat_ws split_part string_agg array_agg bool_and bool_or every percentile_cont percentile_disc '
  + 'mode stddev variance row_number rank dense_rank ntile lag lead first_value last_value generate_series '
  // SQL words that are followed by a bracket without being a call
  + 'select from where and or not in exists any all some as on join using over filter values within group by partition '
  + 'when then else case is between like ilike lateral union intersect except distinct having order limit offset with interval').split(' '));
const TYPES = new Set('int int4 int8 integer bigint smallint numeric decimal float float4 float8 real double precision text varchar char date time timestamp timestamptz interval boolean bool'.split(' '));
export function fenceSql(sql) {
  sql = String(sql || '').trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(sql)) return { error: 'Only one SELECT query is allowed.' };
  if (/;|--|\/\*|\$|\\|"/.test(sql)) return { error: 'One statement only: no comments, quoted names or $ strings.' };
  // what is outside quotes is the code: string contents can't call anything
  const code = sql.replace(/'(?:[^']|'')*'/g, "''");
  if (/'/.test(code.replace(/''/g, ''))) return { error: 'A quote is not closed.' };
  if (/\b(insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|vacuum|analyze|set|reset|listen|notify|lock|prepare|refresh|security|into|table|current_user|session_user|current_role|current_schema|current_catalog|current_database|user)\b/i.test(code)) return { error: 'Read-only: that keyword is not allowed.' };
  if (/\bpg_\w+|\binformation_schema\b|\w\s*\.\s*\w+\s*\(|\bpublic\s*\./i.test(code)) return { error: 'System functions and schema names are not allowed.' };
  for (const [, fn] of code.toLowerCase().matchAll(/([a-z_][a-z0-9_]*)\s*\(/g)) if (!CALLS.has(fn)) return { error: `The function ${fn}() is not allowed here.` };
  for (const [, ty] of code.toLowerCase().matchAll(/::\s*([a-z_][a-z0-9_]*)/g)) if (!TYPES.has(ty)) return { error: `Casting to ${ty} is not allowed here.` };
  if (/::\s*[^a-z\s]/i.test(code)) return { error: 'Only simple casts like ::int or ::date.' };
  if (/\bcast\s*\(/i.test(code)) return { error: 'Use ::type instead of CAST.' };
  return { sql, words: new Set(code.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || []) };
}
let REAL_TABLES = null;
export async function safeQuery(B, raw) {
  const f = fenceSql(raw);
  if (f.error) return { error: f.error };
  const { q, pool } = await mods();
  const { sql, words } = f;
  REAL_TABLES ||= new Set((await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).map(r => r.table_name));
  const bad = [...words].filter(w => REAL_TABLES.has(w) && !VIEWS[w]);
  if (bad.length) return { error: `Only these tables can be used: ${Object.keys(VIEWS).join(', ')}.` };
  const used = Object.keys(VIEWS).filter(v => words.has(v));
  const full = `WITH ${used.map(v => `${v} AS (${VIEWS[v]})`).join(', ') || 'nothing AS (SELECT 1)'} SELECT * FROM (${sql}) AS answer LIMIT 200`;
  const c = await pool.connect();
  try {
    await c.query('BEGIN READ ONLY'); await c.query(`SET LOCAL statement_timeout = 3000`); await c.query(`SET LOCAL TIME ZONE '${B.tz.replace(/'/g, '')}'`);
    const r = await c.query(full, [B.id]);
    // dates leave as the business's local time ("2026-10-27 18:00"), never as UTC the model could misread
    const local = d => d.toLocaleString('sv-SE', { timeZone: B.tz }).slice(0, 16);
    const rows = r.rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? local(v) : v])));
    return { rows, count: rows.length, times: `local time (${B.tz})`, note: rows.length === 200 ? 'only the first 200 rows' : undefined };
  } catch (e) { return { error: `Query failed: ${e.message}` }; }
  finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
}
// The fenced query sees every client's phone and email: owner and admin only, never staff.
readTools.query = { audiences: ['owner', 'admin'], describe: 'ANY other question about this business’s data: write one PostgreSQL SELECT using only these tables (already limited to this business; times in its time zone): '
  + 'bookings(id, customer_id, service_id, conversation_id, starts_at, ends_at, price, status confirmed|completed|no_show|cancelled, source ai|web|manual, created_at), customers(id, name, phone, email, marketing_ok, created_at), '
  + 'services(id, name, price, minutes), conversations(id, customer_id, channel, outcome booked|answered|handoff, kind, topic, mood, rating 1-5, rating_comment, needs_attention, attention_reason, created_at, updated_at), '
  + 'messages(id, conversation_id, role customer|assistant|owner|staff, text, source, created_at), requests(id, booking_id, conversation_id, type, details, status, created_at), questions(id, question, status, answer, created_at), '
  + 'campaigns(id, name, message, sent, skipped, created_at), time_off(id, starts_at, ends_at, reason). Use it whenever the other tools don’t fit.',
  params: obj({ sql: str(4000, { hint: 'SELECT ...' }) }, ['sql']), run: read((B, a) => safeQuery(B, a.sql)) };
// Forecast from the business's own history: a straight-line trend over the last 12 weeks, never below what is
// already booked, with a low-high range from how much past weeks swung around the trend. No AI guessing.
readTools.forecast = { permission: 'insights', describe: 'forecast revenue and bookings for the next N weeks (default 4) from the last 12 weeks trend plus what is already booked, with a low-high range and the method',
  params: obj({ weeks: int(1) }),
  run: read(async (B, a) => { const { q, agentFindings } = await mods();
    const n = Math.min(Math.max(+a.weeks || 4, 1), 12);
    const past = await q(`SELECT w.wk, COALESCE(sum(b.price),0)::float AS revenue, count(b.id)::int AS bookings
        FROM generate_series(date_trunc('week', now() AT TIME ZONE $2) - interval '12 weeks', date_trunc('week', now() AT TIME ZONE $2) - interval '1 week', interval '1 week') AS w(wk)
        LEFT JOIN bookings b ON b.business_id=$1 AND b.status IN ('completed','confirmed') AND date_trunc('week', b.starts_at AT TIME ZONE $2)=w.wk GROUP BY 1 ORDER BY 1`, [B.id, B.tz]);
    const booked = await q(`SELECT w.wk, COALESCE(sum(b.price),0)::float AS revenue, count(b.id)::int AS bookings
        FROM generate_series(date_trunc('week', now() AT TIME ZONE $2), date_trunc('week', now() AT TIME ZONE $2) + make_interval(weeks => $3 - 1), interval '1 week') AS w(wk)
        LEFT JOIN bookings b ON b.business_id=$1 AND b.status='confirmed' AND date_trunc('week', b.starts_at AT TIME ZONE $2)=w.wk GROUP BY 1 ORDER BY 1`, [B.id, B.tz, n]);
    const fit = k => { const y = past.map(r => r[k]), m = y.length, xm = (m - 1) / 2, ym = y.reduce((a, b) => a + b, 0) / m;
      const slope = y.reduce((a, v, i) => a + (i - xm) * (v - ym), 0) / (y.reduce((a, _, i) => a + (i - xm) ** 2, 0) || 1);
      const sd = Math.sqrt(y.reduce((a, v, i) => a + (v - (ym + slope * (i - xm))) ** 2, 0) / Math.max(m - 2, 1));
      return { at: i => Math.max(0, ym + slope * (m - xm + i)), slope, sd, avg: ym }; };
    const active = past.filter(r => r.bookings), young = active.length < 6, d = x => x.toISOString().slice(0, 10), r0 = x => Math.round(x);
    // Short history: a straight line through mostly empty weeks says "zero", which is wrong. Use the run-rate of the
    // weeks that had bookings instead (the business as it runs now), with a wider ±35% range.
    // fewer than 3 full weeks with bookings: revenue per week since the very first booking (this week included)
    const [st] = await q(`SELECT min(starts_at) AS first, COALESCE(sum(price) FILTER (WHERE starts_at < now()),0)::float AS revenue, count(*) FILTER (WHERE starts_at < now())::int AS bookings
        FROM bookings WHERE business_id=$1 AND status IN ('completed','confirmed')`, [B.id]);
    const span = st.first ? Math.max(1, (Date.now() - new Date(st.first)) / 6048e5) : 1;
    const runRate = k => active.length >= 3 ? active.reduce((a, r) => a + r[k], 0) / active.length : (st[k] || 0) / span;
    const R = young ? { at: () => runRate('revenue'), slope: 0, sd: runRate('revenue') * 0.35, avg: runRate('revenue') } : fit('revenue');
    const K = young ? { at: () => runRate('bookings') } : fit('bookings');
    const weeks = booked.map((w, i) => { const rev = Math.max(R.at(i), w.revenue), bk = Math.max(K.at(i), w.bookings);
      return { week_of: d(w.wk), already_booked_revenue: w.revenue, already_booked: w.bookings, forecast_revenue: r0(rev), low: r0(Math.max(w.revenue, rev - R.sd)), high: r0(rev + R.sd), forecast_bookings: r0(bk) }; });
    // The growth path: what the clients the agents found are worth if contacted now, at typical reply rates, spread
    // over the forecast weeks. Each action names its count, rate and value so the owner sees how the path is built.
    const [tk] = await q(`SELECT COALESCE(avg(price),0)::float AS t FROM bookings WHERE business_id=$1 AND status IN ('completed','confirmed') AND starts_at > now() - interval '90 days'`, [B.id]);
    const ag = await agentFindings(B.id).catch(() => ({ out: [] })), found = id => ag.out.find(a => a.id === id && !a.blocked)?.list.length || 0;
    const actions = [['winback', 'Win back lapsed regulars', 0.15], ['leads', 'Follow up warm leads', 0.25], ['fill', 'Invite regulars to quiet days', 0.2], ['noshow', 'Confirm risky bookings', 0.5]]
      .map(([id, label, rate]) => ({ id, label, clients: found(id), reply_rate: `${rate * 100}%`, value: r0(found(id) * rate * tk.t) })).filter(a => a.clients);
    const lift = actions.reduce((a, x) => a + x.value, 0);
    const path = weeks.map(w => ({ week_of: w.week_of, revenue: r0(w.forecast_revenue + lift / weeks.length) }));
    const total = weeks.reduce((a, w) => a + w.forecast_revenue, 0);
    return { method: young ? `run-rate: ${active.length >= 3 ? `average of the ${active.length} recent weeks with bookings` : `revenue per week since your first booking (${span.toFixed(1)} weeks)`}, never below what is already booked; low/high = ±35%`
        : 'linear trend over the last 12 full weeks, never below what is already booked; low/high = ±1 typical weekly swing', currency: B.currency || 'USD',
      last_12_weeks_avg_revenue: r0(R.avg), trend_per_week: r0(R.slope), total_forecast_revenue: total, total_low: weeks.reduce((a, w) => a + w.low, 0), total_high: weeks.reduce((a, w) => a + w.high, 0),
      growth_path: { total: total + lift, extra: lift, actions, weeks: path, note: lift ? 'If you send the prepared messages now, at typical reply rates.' : 'No prepared campaigns right now, so the growth path equals the current pace.' },
      confidence: young ? `low: ${span < 6 ? `${span.toFixed(1)} weeks of history` : `only ${active.length} full weeks with bookings`}, treat as a rough guide` : 'normal', weeks, history: past.map(r => ({ week_of: d(r.wk), revenue: r.revenue, bookings: r.bookings })) };
  }) };
readTools.marketing = { permission: 'customers', describe: 'marketing results for N days (default 30): messages sent, clients reached, bookings and revenue won by each offer, discount code and agent (a booking within 14 days of a message), audience segments and how many agreed to offers, and lessons. Use this for ANY question about offers, campaigns, codes or agents results.',
  params: DAYS(),
  run: read(async (B, a) => { const d = await (await mods()).marketingOverview(B.id, Math.min(Math.max(+a.days || 30, 7), 365));
    return { period: `last ${d.days} days`, rule: d.rule, totals: d.kpis, offers: d.campaigns.map(({ message, segment, ...c }) => c), codes: d.coupons, agents: d.agents, segments: d.segments, lessons: d.lessons }; }) };
readTools.business_info = { describe: 'the business itself: name, address, opening hours, services with prices, policies, FAQ answers, team, payment methods, languages', params: obj(),
  run: read(async (B, a, ctx) => { const b = ctx.biz;
    return { name: b.name, type: b.vertical, address: b.address, phone: b.phone, opening_hours: hoursText(b), services: b.services.map(s => ({ name: s.name, price: Number(s.price), minutes: s.minutes })),
      policies: b.policies, faq: [b.faq, ...(b.faqs || []).map(f => `Q: ${f.q} A: ${f.a}`)].filter(Boolean).join('\n').slice(0, 3000), team: b.team, payment_methods: b.payment_methods, languages: b.languages, booking_note: b.booking_note,
      cancellation_notice_hours: b.cancel_hours ?? 24, reminder_hours_before: b.reminder_hours, minimum_booking_notice_hours: b.booking_min_notice_hours }; }) };

// ---------- owner actions (mxai role): proposals only ----------
// Each propose_* checks its arguments and that every id belongs to this business (read-only), then returns
// data.proposal in exactly the shape team.js's ACTIONS use. The dashboard shows it with an Approve button and runs
// it through the same path as today (public/command.js ROUTE -> /api/bookings, /api/time-off; else /api/team/act),
// so the owner's click is the only thing that sends a message or changes data. Nothing here writes.
// The dashboard's pages and tabs (same as team.js PAGE_TABS, which follows public/pulse.js).
export const PAGE_TABS = {
  today: ['Today'], inbox: ['Conversations', 'Needs you', 'Delivery queue'], calendar: ['Schedule', 'Requests', 'Booking page'],
  customers: ['Clients', 'Board', 'Win back', 'Reviews'], marketing: ['Offers', 'Discount codes', 'Agents', 'Website texts', 'Website photos', 'Website design', 'Website address'],
  pulse: ['Approvals', 'Ask MXAi', 'Brief'], train: ['Coach', 'Rules', 'Answers', 'Review replies'], lab: ['Scenarios', 'Test chat', 'Versions'],
  insights: ['AI performance', 'Live flow', 'Topics', 'Business', 'Services', 'Timing', 'Channels'],
  settings: ['Profile', 'Assistant', 'Hours & team', 'Services', 'FAQs', 'Policies & payments', 'Tools', 'Channels', 'Reminders', 'Security & devices', 'Look & layout'],
};
const pages = Object.entries(PAGE_TABS).map(([p, t]) => `${p} [${t.map((x, i) => `${i} ${x}`).join(', ')}]`).join('; ');
const proposed = proposal => ({ ok: true, data: { proposal, pending: true } });
const missing = what => ({ ok: false, data: { error: `No such ${what} in this business.` } });
const owns = async (table, id, bizId) => !!(await (await mods()).one(`SELECT 1 FROM ${table} WHERE id=$1 AND business_id=$2`, [id, bizId]));
const LABEL = str(80);

const actionTools = {
  propose_send_message: { permission: 'customers', describe: 'propose a message to one client (sent only when the owner approves)',
    params: obj({ customer_id: int(1), text: str(900) }, ['customer_id', 'text']),
    run: async (ctx, a) => { const c = await (await mods()).one('SELECT name FROM customers WHERE id=$1 AND business_id=$2', [a.customer_id, ctx.biz.id]);
      return c ? proposed({ type: 'send_message', customer_id: a.customer_id, text: a.text, client: c.name || null }) : missing('client'); } },
  propose_teach_answer: { permission: 'teach', describe: 'propose the answer to an unanswered question (id from unanswered)',
    params: obj({ learning_id: int(1), answer: str(1500) }, ['learning_id', 'answer']),
    run: async (ctx, a) => (await owns('learning', a.learning_id, ctx.biz.id)) ? proposed({ type: 'teach_answer', ...a }) : missing('question') },
  propose_add_rule: { permission: 'teach', describe: 'propose a strict rule for the AI receptionist', params: obj({ text: str(400) }, ['text']),
    run: async (_ctx, a) => proposed({ type: 'add_rule', text: a.text }) },
  propose_run_agent: { permission: 'customers', describe: "propose letting a growth agent send its prepared messages (the owner reviews them in Agents)",
    params: obj({ agent: str(10, { enum: ['winback', 'leads', 'fill', 'noshow', 'reviews'] }) }, ['agent']),
    run: async (_ctx, a) => proposed({ type: 'run_agent', agent: a.agent }) },
  propose_add_shortcut: { describe: `propose a shortcut button on the owner's Home page: a page and tab to open, or a question to ask you. Pages and tabs (tab = 0-based index): ${pages}`,
    params: obj({ label: str(40), page: str(20, { enum: Object.keys(PAGE_TABS) }), tab: int(0, 20), ask: str(300) }, ['label']),
    run: async (_ctx, a) => (a.page || a.ask) ? proposed({ type: 'add_shortcut', ...a }) : { ok: false, data: { error: 'A shortcut needs a page or a question.' } } },
  propose_book: { permission: 'calendar', describe: 'propose booking an appointment (check free_slots first)',
    params: obj({ name: str(60, { minLength: 2 }), phone: str(25, { pattern: '^\\+?[\\d\\s().-]{6,24}$' }), service_id: int(1), start: str(16, { pattern: STAMP, hint: 'YYYY-MM-DDTHH:MM' }), label: LABEL }, ['name', 'phone', 'service_id', 'start']),
    run: async (ctx, a) => (await owns('services', a.service_id, ctx.biz.id)) ? proposed({ type: 'book', ...a, start: a.start.replace(' ', 'T') }) : missing('service') },
  propose_move_booking: { permission: 'calendar', describe: 'propose moving a booking (booking_id from bookings; check free_slots first)',
    params: obj({ booking_id: int(1), start: str(16, { pattern: STAMP, hint: 'YYYY-MM-DDTHH:MM' }), label: LABEL }, ['booking_id', 'start']),
    run: async (ctx, a) => (await owns('bookings', a.booking_id, ctx.biz.id)) ? proposed({ type: 'move_booking', ...a, start: a.start.replace(' ', 'T') }) : missing('booking') },
  propose_set_booking_status: { permission: 'calendar', describe: 'propose cancelling a booking or marking it came / no-show / confirmed',
    params: obj({ booking_id: int(1), status: str(10, { enum: ['cancelled', 'completed', 'no_show', 'confirmed'] }), label: LABEL }, ['booking_id', 'status']),
    run: async (ctx, a) => (await owns('bookings', a.booking_id, ctx.biz.id)) ? proposed({ type: 'set_booking_status', ...a }) : missing('booking') },
  propose_block_time: { permission: 'calendar', describe: 'propose blocking time in the calendar so nobody can book it',
    params: obj({ start: str(16, { pattern: STAMP, hint: 'YYYY-MM-DDTHH:MM' }), end: str(16, { pattern: STAMP, hint: 'YYYY-MM-DDTHH:MM' }), reason: str(200), label: LABEL }, ['start', 'end']),
    run: async (_ctx, a) => a.end.replace(' ', 'T') > a.start.replace(' ', 'T') ? proposed({ type: 'block_time', ...a, start: a.start.replace(' ', 'T'), end: a.end.replace(' ', 'T') })
      : { ok: false, data: { error: 'The end must be after the start.' } } },
  // Opening a page changes nothing, so the dashboard runs it without asking (team.js did the same).
  propose_open_page: { describe: `take the owner to a dashboard page (runs without approval: it changes nothing). Pages: ${pages}`,
    params: obj({ page: str(20, { enum: Object.keys(PAGE_TABS) }), tab: int(0, 20), label: LABEL }, ['page']),
    run: async (_ctx, a) => ({ ok: true, data: { proposal: { type: 'open_page', ...a }, pending: false } }) },
};

// ---------- the registry ----------
export const TOOLS = Object.freeze(Object.fromEntries([
  ...Object.entries(customerTools).map(([n, d]) => [n, define(n, { kind: 'customer', audiences: CUSTOMER, roles: d.roles || CUSTOMER_ROLES[n], ...d })]),
  ...Object.entries(readTools).map(([n, d]) => [n, define(n, { kind: 'read', audiences: INTERNAL, roles: ['mxai'], ...d })]),
  // proposals: owner and admin; staff only with the section's permission (access.js checks `permission`)
  ...Object.entries(actionTools).map(([n, d]) => [n, define(n, { kind: 'action', audiences: INTERNAL, roles: ['mxai'], ...d })]),
]));

// MCP servers: none is connected yet (Lab › Controls lists `mcp: []`). When the admin connects one and allows it,
// each of its tools is added here under the Lab switch 'mcp:<server>', with the server's own description and input
// schema, and run() calls the server. They are owner-side and read-only until reviewed, e.g.:
//   { name: 'mcp_sheets_read', kind: 'read', audiences: ['owner', 'admin'], roles: ['mxai'], switchKey: 'mcp:sheets',
//     describe: '<from the server>', params: <its inputSchema>, run: (ctx, args) => client('sheets').callTool(...) }
// A tool that changes something on the server is added as propose_mcp_<name> and only proposes, like the others.
export function mcpTools(_biz) {
  return [];
}
// Every tool this business can have: the built-in registry plus its approved MCP tools.
export function registryFor(biz) {
  const extra = mcpTools(biz);
  return extra.length ? { ...TOOLS, ...Object.fromEntries(extra.map(t => [t.name, t])) } : TOOLS;
}

// What the prompt shows the model: one line per allowed tool, its arguments (? = optional) and what it does.
export function paramText(params) {
  const props = Object.entries(params?.properties || {}), req = params?.required || [];
  if (!props.length) return '{}';
  return `{${props.map(([k, p]) => `${k}${req.includes(k) ? '' : '?'}: ${p.enum ? p.enum.join('|') : p.hint ? `"${p.hint}"` : p.type === 'integer' ? 'int' : p.type === 'boolean' ? 'true|false' : 'text'}`).join(', ')}}`;
}
export function toolList(allowed, tools = TOOLS) {
  const names = allowed == null ? Object.keys(tools) : [...allowed];
  return names.filter(n => tools[n]).map(n => `- ${n} ${paramText(tools[n].params)}: ${tools[n].describe}`).join('\n');
}
