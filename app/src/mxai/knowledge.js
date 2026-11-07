// Layer 03: knowledge. The line between what a customer may hear and what only the owner may see.
//   publicFacts      what anyone may be told about the business (catalog, hours, policies, FAQs, taught answers)
//   customerFacts    one customer's own profile and bookings, nothing about anyone else, never staff_notes
//   availabilityFacts free times, built from slots.js exactly as the old receptionist context was
//   ownerFacts       summary numbers from metrics.js, for the internal `mxai` role only
//   retrieve         the FAQs and taught answers most relevant to a message (word overlap, no AI, no database)
// The database and metrics modules are imported lazily, so the pure parts (publicFactsFrom, retrieve,
// availabilityFacts) load and test without Postgres or node_modules.
import { availability, freeSlots, bufferOf, label, hoursText, localDate, parseLocal } from '../slots.js';
import { wall, daysBetween, fmtDate } from '../clock.js';

const db = () => import('../db.js');
const metricsMod = () => import('../metrics.js');

const ref = id => 'RB-' + String(id).padStart(4, '0');
const hoursUntil = t => (new Date(t) - Date.now()) / 3600000;
const clean = v => (v == null ? '' : String(v).trim());
// A question a customer typed can carry their own phone number or email: never pass it on to other customers.
const scrub = s => clean(s).replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]').replace(/\S+@\S+\.\S+/g, '[email]');

// "Layla Haddad - Color specialist" lines -> first names and roles only (no surnames, no staff details).
export function teamOf(team) {
  const lines = Array.isArray(team) ? team : clean(team).split(/\r?\n|;/);
  return lines.map(l => (typeof l === 'object' && l ? `${l.name || ''} - ${l.role || ''}` : String(l)))
    .map(l => /^\s*([^-–—:|,]+?)\s*(?:[-–—:|,]\s*(.+))?$/.exec(l)).filter(Boolean)
    .map(m => ({ name: firstName(m[1]), role: clean(m[2]) || undefined })).filter(t => t.name);
}
// Titles stay with the first name: "Dr. Rami Saad" -> "Dr. Rami", "الدكتورة مايا" -> "الدكتورة مايا"
export const TITLE = /^(dr|dra|doctor|doctora|docteur|mr|mrs|ms|miss|mme|mlle|m|sr|sra|srta|prof|profesor|profesora|chef|coach|د|دكتور|الدكتور|دكتورة|الدكتورة|السيد|السيدة|الاستاذ|الأستاذ|الاستاذة|الأستاذة)\.?$/i;
function firstName(full) {
  const w = String(full).trim().split(/\s+/);
  return TITLE.test(w[0]) && w[1] ? `${w[0]} ${w[1]}` : w[0];
}

// Same rules as brain.js paymentText: only options the owner switched on, online payment only once it is live.
export function paymentOptions(biz, live = !!process.env.PAYMENTS_LIVE) {
  const cur = biz.currency || 'USD', dep = +biz.deposit_amount > 0 ? +biz.deposit_amount : 0, opts = [];
  if (biz.pay_later) opts.push('pay at the appointment');
  if (biz.pay_deposit && biz.payment_link && dep) opts.push(`a reservation fee of ${dep} ${cur}${biz.deposit_for === 'all' ? '' : ' for clients who missed before'}, paid through the link in the confirmation`);
  if (live && biz.pay_now) opts.push('pay online now when booking');
  if (live && !biz.payment_link && biz.pay_deposit && dep) opts.push(`a reservation fee of ${dep} ${cur} to hold the booking`);
  return opts;
}
const paymentText = opts => opts.length
  ? `Offer only these payment options: ${opts.join('; ')}. Never ask for card details in chat.`
  : 'Do not discuss online payment; never ask for card details.';

// The owner's strict rules (businesses.ai_rules): plain strings, in order.
const rulesOf = rules => (Array.isArray(rules) ? rules : []).map(r => clean(r?.text ?? r)).filter(Boolean);

// FAQs from the structured list and the old free-text faq field ("Q: ... A: ..." blocks or one paragraph).
function faqsOf(biz) {
  const out = (Array.isArray(biz.faqs) ? biz.faqs : []).filter(f => f && clean(f.q) && clean(f.a)).map(f => ({ q: clean(f.q), a: clean(f.a) }));
  const text = clean(biz.faq);
  if (text) {
    const blocks = [...text.matchAll(/Q:\s*([\s\S]+?)\s*A:\s*([\s\S]+?)(?=\n\s*Q:|$)/gi)];
    if (blocks.length) for (const [, q, a] of blocks) out.push({ q: clean(q), a: clean(a) });
    else out.push({ q: '', a: text });
  }
  return out;
}

// Pure: the customer-safe facts from a business row and its owner-approved taught answers.
// An allowlist on purpose: a new column on businesses never reaches a customer until it is added here.
export function publicFactsFrom(biz, taught = []) {
  const pay = paymentOptions(biz);
  return {
    name: biz.name, description: biz.description || undefined, address: biz.address || undefined, maps_url: biz.maps_url || undefined,
    website: biz.website || undefined, instagram: biz.instagram || undefined, phone: biz.phone || undefined,
    currency: biz.currency || 'USD', opening_hours: hoursText(biz),
    team: teamOf(biz.team),
    services: (biz.services || []).filter(s => s.active !== false).map(s => ({ name: s.name, price: Number(s.price), minutes: s.minutes, description: s.description || undefined })),
    policies: biz.policies || undefined,
    cancellation_hours: biz.cancel_hours ?? 24,
    payment_methods: biz.payment_methods || undefined,
    payment_options: pay, payment_text: paymentText(pay),
    booking_note: biz.booking_note || undefined,
    faqs: faqsOf(biz),
    taught: (taught || []).filter(t => clean(t.q) && clean(t.a)).map(t => ({ q: scrub(t.q).slice(0, 300), a: clean(t.a).slice(0, 1500) })),
    rules: rulesOf(biz.ai_rules),
  };
}

// Answers the owner gave in Teach AI (learning rows marked answered), newest first, one per question.
async function taughtFor(bizId) {
  const { q } = await db();
  return q(`SELECT DISTINCT ON (lower(question)) question AS q, answer AS a FROM learning
    WHERE business_id=$1 AND status='answered' AND answer IS NOT NULL AND length(answer) < 1500
    ORDER BY lower(question), answered_at DESC NULLS LAST LIMIT 60`, [bizId]);
}

export async function publicFacts(biz) {
  return publicFactsFrom(biz, await taughtFor(biz.id).catch(() => []));
}

// One customer's own records. Always scoped by business id too, so a wrong id can never read another business's client.
export async function customerFacts(biz, customerId) {
  const { q, one } = await db();
  const c = await one('SELECT id, name, phone, contact_phone, email, reminder_channel FROM customers WHERE id=$1 AND business_id=$2', [customerId, biz.id]);
  if (!c) return null;
  const [hist] = await q(`SELECT count(*) FILTER (WHERE b.status IN ('completed','confirmed') AND b.starts_at < now())::int AS visits,
      to_char(max(b.starts_at) FILTER (WHERE b.status IN ('completed','confirmed') AND b.starts_at < now()), 'YYYY-MM-DD') AS last_visit,
      (SELECT s.name FROM bookings b2 JOIN services s ON s.id=b2.service_id WHERE b2.customer_id=$1 AND b2.business_id=$2 AND b2.status <> 'cancelled'
         GROUP BY s.name ORDER BY count(*) DESC, max(b2.starts_at) DESC LIMIT 1) AS favourite_service
      FROM bookings b WHERE b.customer_id=$1 AND b.business_id=$2`, [c.id, biz.id]);
  const theirs = await q(`SELECT b.id, b.starts_at, s.name service FROM bookings b JOIN services s ON s.id=b.service_id
      WHERE b.customer_id=$1 AND b.business_id=$2 AND b.starts_at > now() AND b.status='confirmed' ORDER BY b.starts_at`, [c.id, biz.id]);
  const visits = hist?.visits || 0;
  return {
    name: c.name || null, returning: visits > 0, visits, last_visit: hist?.last_visit || null, favourite_service: hist?.favourite_service || null,
    reminder_channel: c.reminder_channel || null, email_known: !!c.email,
    // same rule as brain.js: test-lab customers play WhatsApp customers (number known); other test/web ids have no phone
    phone_known: !/^(test(?!-lab-)|e2e|walk-in|tg-)/.test(String(c.phone || '')) || !!c.contact_phone,
    upcoming_bookings: theirs.map(b => ({ ref: ref(b.id), when: label(new Date(b.starts_at)), service: b.service,
      can_change_by_chat: hoursUntil(b.starts_at) >= (biz.cancel_hours ?? 24) })),
  };
}

// ---------- availability (same output as the old brain.js context) ----------
function dayLabel(t) {
  const n = daysBetween(new Date(), t);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${fmtDate(t, { weekday: 'short' })} ${wall(t).d} ${fmtDate(t, { month: 'short' })}`;
}
const slotLabel = t => `${dayLabel(t)} ${wall(t).hm}`;
// 3 good times per service on 3 different days, morning / afternoon / evening (copy of brain.js quickSlots).
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
    for (const list of days) for (const t of list) { if (pick.length >= 3) break; if (pick.every(p => Math.abs(t - p) >= 120 * 60000)) pick.push(t); }
    pick.sort((a, b) => a - b);
    out[s.name] = pick.map(t => ({ label: slotLabel(t), slot: `${localDate(t)} ${wall(t).hm}` }));
  }
  return out;
}
function openDays(biz, bookings, timeOff) {
  const days = [];
  for (const a of availability(biz, bookings, timeOff, 21)) if (a.free && !/closed|fully booked/.test(a.free) && days.length < 10) days.push(dayLabel(parseLocal(a.date + 'T12:00')));
  return days;
}
// Run on the business's clock (clock.js inZone), like everything else in a customer turn.
export function availabilityFacts(biz, bookings = [], timeOff = []) {
  const two = availability(biz, bookings, timeOff, 2);
  return {
    availability: availability(biz, bookings, timeOff, 14),
    today_and_tomorrow: { today: two[0] && `${two[0].day}: ${two[0].free}`, tomorrow: two[1] && `${two[1].day}: ${two[1].free}` },
    quick_slots: quickSlots(biz, bookings, timeOff),
    next_open_days: openDays(biz, bookings, timeOff),
    now: `${label(new Date())} (today is ${localDate(new Date())})`,
  };
}

// ---------- owner-only summary (internal audiences only; access.canSee(audience, 'owner')) ----------
export async function ownerFacts(biz) {
  const [{ one }, metrics] = await Promise.all([db(), metricsMod()]);
  const [t, ai7, week, waiting] = await Promise.all([
    metrics.today(biz.id), metrics.aiBookings(biz.id, 7), metrics.daily(biz.id, 7),
    one(`SELECT (SELECT count(*) FROM conversations WHERE business_id=$1 AND needs_attention AND channel<>'test')::int AS chats_waiting,
        (SELECT count(*) FROM requests WHERE business_id=$1 AND status='pending')::int AS approvals_waiting,
        (SELECT count(*) FROM learning WHERE business_id=$1 AND status='open')::int AS unanswered_questions`, [biz.id]),
  ]);
  const sum = k => week.reduce((x, d) => x + (+d[k] || 0), 0);
  const chats = sum('chats'), handled = sum('handled'), ms = week.filter(d => d.reply_ms != null);
  return {
    currency: biz.currency || 'USD',
    today: { appointments: t.visits_today, revenue: t.revenue_today, new_bookings: t.booked_today, new_bookings_value: t.value_today },
    // named for what they count: bookings MADE that day (by anyone, for any date) and the value of visits that day
    last_7_days: { new_bookings_made: sum('bookings'), revenue_from_visits: sum('revenue'), chats,
      by_day: week.map(d => ({ day: d.day, new_bookings_made: d.bookings, revenue_from_visits: d.revenue, chats: d.chats })) },
    waiting: waiting || {},
    ai: {
      bookings_7d: ai7.ai_count, value_7d: ai7.ai_value, value_prev_7d: ai7.ai_value_prev,
      handled_alone_share: chats ? Math.round((handled / chats) * 100) / 100 : null,
      avg_reply_ms: ms.length ? Math.round(ms.reduce((x, d) => x + d.reply_ms, 0) / ms.length) : null,
    },
    note: 'numbers from metrics.js, the same as the dashboard; test chats excluded',
  };
}

// ---------- retrieval ----------
const STOP = new Set(`a an the and or but of to in on at for from with by is are was were be been am do does did have has had
i you he she it we they me my your our their this that these those there here what which who whom how when where why can could
would should will shall may might must please hi hello hey thanks thank ok okay yes no not any some
el la los las un una unos unas y o de del al en con por para es son ser esta estan está están hay que qué como cómo cuando cuándo
donde dónde cual cuál yo tu tú mi mis su sus nos me te se lo le les muy mas más hola gracias si sí
le la les un une des et ou de du au aux en dans avec pour par est sont être que qui quoi comment quand où ou je tu il elle nous vous
ils elles mon ma mes ton ta tes son sa ses ce cet cette ces bonjour merci oui non pas ne quel quelle quels quelles combien pourquoi
cuales cuanto cuanta cuantos cuantas porque
في من على الى إلى عن مع هل ما ماذا كيف متى اين أين اي أي هذا هذه ذلك تلك هو هي انا أنا انت أنت نحن هم و او أو ثم لا نعم
شو كيف وين ليش قديش بدي عندكم عندك في فيه فيها يا مرحبا شكرا`.split(/\s+/).map(w => norm(w)).filter(Boolean));

// lowercase, accents and Arabic marks removed, Arabic letter variants unified, tatweel dropped
export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
}
// light stemming so "precios"/"precio", "prices"/"price", "الأسعار"/"أسعار" meet
function stem(w) {
  if (/^[\u0600-\u06FF]+$/.test(w)) {
    if (w.length > 4 && /^(وال|بال|كال|فال|لل)/.test(w)) w = w.slice(w.startsWith('لل') ? 2 : 3);
    else if (w.length > 3 && w.startsWith('ال')) w = w.slice(2);
    if (w.length > 4 && /(ات|ين|ون)$/.test(w)) w = w.slice(0, -2);
    return w;
  }
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}
export function tokens(s) {
  return [...new Set((norm(s).match(/[\p{L}\p{N}]+/gu) || []).filter(w => !STOP.has(w) && (w.length > 1 || /\d/.test(w))).map(stem))];
}
const near = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

// Pure. Scores each FAQ and taught answer by how many of the message's words it shares (question words count
// fully, answer-only words half), divided by the message's word count. Taught answers win ties: the owner wrote them.
export function retrieve(facts, text, k = 5) {
  const want = tokens(text);
  if (!want.length) return [];
  const pool = [...(facts?.taught || []).map(x => ({ ...x, source: 'taught' })), ...(facts?.faqs || []).map(x => ({ ...x, source: 'faq' }))];
  return pool.map((x, i) => {
    const qt = tokens(x.q), at = tokens(x.a);
    let hit = 0;
    for (const w of want) hit += qt.some(t => near(w, t)) ? 1 : at.some(t => near(w, t)) ? 0.5 : 0;
    return { q: x.q, a: x.a, source: x.source, score: Math.round((hit / want.length) * 1000) / 1000, i };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, k).map(({ i, ...x }) => x);
}
