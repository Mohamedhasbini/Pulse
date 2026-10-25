// Business insights: what sells, when, who comes back, and what customers keep asking about.
import { q, one } from './db.js';
import { loadBusiness } from './brain.js';
import { dayRanges } from './slots.js';

// Groups customer messages into topics (English + Arabic + Lebanese chat spelling). First match wins.
const TOPICS = [
  ['complaint', 'Complaints & bad experiences', /rude|bad|angry|complain|refund|manager|terrible|disappoint|worst|late again|شكوى|سيء|سيئ|زعلان|مش راضي|مدير/i],
  ['cancel', 'Cancel or change a booking', /cancel|reschedul|postpone|change (my|the) (time|date|booking)|move (my|it)|الغ|إلغاء|بلغي|غير الموعد|أجل|بدي غير/i],
  ['discount', 'Discounts & offers', /discount|offer|promo|code|coupon|deal|cheaper|خصم|عرض|تخفيض/i],
  ['price', 'Prices', /price|cost|how much|rates|menu|بقديش|كم سعر|سعر|أسعار|بكم|قديش/i],
  ['hours', 'Opening hours', /open|close|hours|until when|working days|sunday|دوام|بتفتح|بتسكر|ساعات|مفتوح/i],
  ['location', 'Location & parking', /where|address|location|park|directions|map|وين|عنوان|موقع|موقف|باركينغ/i],
  ['payment', 'Payment methods', /pay|card|cash|visa|apple pay|wish|omt|دفع|كاش|بطاقة|فيزا/i],
  ['booking', 'Booking & availability', /book|appointment|available|availability|free (slot|time)|reserve|reservation|tomorrow|today|موعد|حجز|احجز|فاضي|بكرا|اليوم/i],
  ['service', 'Questions about a service', /do you (do|offer|have)|is there|how long|duration|which (product|brand)|بتعملو|في عندكن|قديش بياخد/i],
];
export const topicOf = t => (TOPICS.find(([, , re]) => re.test(t)) || ['other', 'Other'])[0];

export async function insights(BIZ, days) {
  const P = [BIZ, days], since = `now() - make_interval(days => $2::int)`;
  const live = `b.status <> 'cancelled'`;

  const [totals] = await q(`SELECT count(*) FILTER (WHERE ${live})::int AS bookings, COALESCE(sum(b.price) FILTER (WHERE ${live}),0)::float AS revenue,
      COALESCE(avg(b.price) FILTER (WHERE ${live}),0)::float AS avg_ticket,
      count(*) FILTER (WHERE b.status='cancelled')::int AS cancelled, count(*) FILTER (WHERE b.status='no_show')::int AS no_show,
      count(*) FILTER (WHERE b.status='completed')::int AS completed, count(DISTINCT b.customer_id) FILTER (WHERE ${live})::int AS customers,
      COALESCE(sum(b.list_price - b.price) FILTER (WHERE ${live} AND b.coupon_code IS NOT NULL),0)::float AS discounts
      FROM bookings b WHERE b.business_id=$1 AND b.starts_at > ${since}`, P);

  const services = await q(`SELECT s.name, count(b.id) FILTER (WHERE ${live})::int AS n, COALESCE(sum(b.price) FILTER (WHERE ${live}),0)::float AS revenue,
      count(b.id) FILTER (WHERE b.status='cancelled')::int AS cancelled, count(b.id) FILTER (WHERE b.status='no_show')::int AS no_show
      FROM services s LEFT JOIN bookings b ON b.service_id=s.id AND b.starts_at > ${since}
      WHERE s.business_id=$1 AND (s.active OR b.id IS NOT NULL) GROUP BY s.id ORDER BY revenue DESC, n DESC`, P);

  const weekday = await q(`SELECT extract(dow FROM b.starts_at)::int AS dow, count(*)::int AS n, COALESCE(sum(b.price),0)::float AS revenue,
      count(*) FILTER (WHERE b.status='no_show')::int AS no_show
      FROM bookings b WHERE b.business_id=$1 AND b.starts_at > ${since} AND ${live} GROUP BY 1`, P);
  const hours = await q(`SELECT extract(hour FROM b.starts_at)::int AS hour, count(*)::int AS n, COALESCE(sum(b.price),0)::float AS revenue
      FROM bookings b WHERE b.business_id=$1 AND b.starts_at > ${since} AND ${live} GROUP BY 1 ORDER BY 1`, P);

  const lead = await q(`SELECT CASE WHEN b.starts_at::date = b.created_at::date THEN 'Same day'
        WHEN b.starts_at - b.created_at < interval '3 days' THEN '1–2 days ahead'
        WHEN b.starts_at - b.created_at < interval '8 days' THEN '3–7 days ahead' ELSE 'More than a week ahead' END AS bucket, count(*)::int AS n
      FROM bookings b WHERE b.business_id=$1 AND b.created_at > ${since} AND ${live} GROUP BY 1`, P);

  const channels = await q(`SELECT b.source, count(*)::int AS n, COALESCE(sum(b.price),0)::float AS revenue
      FROM bookings b WHERE b.business_id=$1 AND b.created_at > ${since} AND ${live} GROUP BY 1`, P);

  // Customers: new = first ever booking in this period; returning = booked before too.
  const [cust] = await q(`WITH firsts AS (SELECT customer_id, min(created_at) AS first FROM bookings WHERE business_id=$1 AND status <> 'cancelled' GROUP BY 1)
      SELECT count(DISTINCT b.customer_id) FILTER (WHERE f.first > ${since})::int AS new,
             count(DISTINCT b.customer_id) FILTER (WHERE f.first <= ${since})::int AS returning
      FROM bookings b JOIN firsts f ON f.customer_id=b.customer_id WHERE b.business_id=$1 AND b.created_at > ${since} AND ${live}`, P);
  const top = await q(`SELECT cu.name, cu.phone, count(*)::int AS visits, sum(b.price)::float AS spent, to_char(max(b.starts_at),'YYYY-MM-DD') AS last
      FROM bookings b JOIN customers cu ON cu.id=b.customer_id WHERE b.business_id=$1 AND ${live} AND cu.phone NOT LIKE 'test-%'
      GROUP BY cu.id ORDER BY spent DESC LIMIT 6`, [BIZ]);
  const atRisk = await q(`SELECT cu.name, cu.phone, count(*)::int AS visits, to_char(max(b.starts_at),'YYYY-MM-DD') AS last
      FROM bookings b JOIN customers cu ON cu.id=b.customer_id WHERE b.business_id=$1 AND b.status IN ('completed','confirmed') AND cu.phone NOT LIKE 'test-%'
      GROUP BY cu.id HAVING count(*) >= 2 AND max(b.starts_at) < now() - interval '45 days' ORDER BY max(b.starts_at) LIMIT 6`, [BIZ]);
  const repeatNoShow = await q(`SELECT cu.name, cu.phone, count(*)::int AS n FROM bookings b JOIN customers cu ON cu.id=b.customer_id
      WHERE b.business_id=$1 AND b.status='no_show' GROUP BY cu.id HAVING count(*) >= 2 ORDER BY n DESC LIMIT 6`, [BIZ]);

  // What customers ask: every customer message in the period, grouped by topic, with recent examples.
  const msgs = await q(`SELECT m.text, m.conversation_id, c.needs_attention, to_char(m.created_at,'YYYY-MM-DD"T"HH24:MI') AS at
      FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE c.business_id=$1 AND m.role='customer' AND m.created_at > ${since} ORDER BY m.id DESC LIMIT 2000`, P);
  const byTopic = {};
  for (const m of msgs) {
    const t = topicOf(m.text);
    const g = byTopic[t] ||= { topic: t, label: (TOPICS.find(x => x[0] === t) || [, 'Other'])[1], n: 0, convs: new Set(), examples: [], flagged: 0 };
    g.n++; g.convs.add(m.conversation_id); if (m.needs_attention) g.flagged++;
    if (g.examples.length < 4 && !g.examples.some(e => e.text.toLowerCase() === m.text.toLowerCase())) g.examples.push({ text: m.text.slice(0, 160), at: m.at, conversation_id: m.conversation_id });
  }
  const topics = Object.values(byTopic).map(g => ({ ...g, convs: g.convs.size })).sort((a, b) => b.n - a.n);

  // Services customers ask about (mentioned by name), whether or not they booked.
  const svcNames = await q('SELECT name FROM services WHERE business_id=$1 AND active', [BIZ]);
  const asked = svcNames.map(s => {
    const key = s.name.toLowerCase().split(/[ &]/)[0];
    return { name: s.name, n: msgs.filter(m => m.text.toLowerCase().includes(key)).length };
  }).sort((a, b) => b.n - a.n);

  const [handoff] = await q(`SELECT count(*)::int AS n FROM conversations c WHERE c.business_id=$1 AND c.created_at > ${since} AND c.outcome='handoff'`, P);
  const [convs] = await q(`SELECT count(*)::int AS n FROM conversations c WHERE c.business_id=$1 AND c.created_at > ${since}`, P);
  const [rem] = await q(`SELECT count(*) FILTER (WHERE reminder_status='sent')::int AS sent, count(*) FILTER (WHERE reminder_status LIKE 'not_sent%')::int AS failed
      FROM bookings WHERE business_id=$1 AND starts_at > ${since}`, P);
  const biz = await loadBusiness(BIZ);

  // Same numbers for the period before, so every KPI can show ↑ / ↓.
  const [prev] = await q(`SELECT count(*) FILTER (WHERE ${live})::int AS bookings, COALESCE(sum(b.price) FILTER (WHERE ${live}),0)::float AS revenue,
      COALESCE(avg(b.price) FILTER (WHERE ${live}),0)::float AS avg_ticket, count(*) FILTER (WHERE b.status='no_show')::int AS no_show,
      count(*) FILTER (WHERE b.status='completed')::int AS completed
      FROM bookings b WHERE b.business_id=$1 AND b.starts_at > now() - make_interval(days => $2::int * 2) AND b.starts_at <= ${since}`, P);
  const [prevConv] = await q(`SELECT count(*)::int AS n FROM conversations WHERE business_id=$1 AND created_at > now() - make_interval(days => $2::int * 2) AND created_at <= ${since}`, P);

  // Trend: daily up to 90 days, weekly for longer periods.
  const unit = days > 90 ? 'week' : 'day';
  const trend = await q(`SELECT to_char(g,'YYYY-MM-DD') AS d,
      COALESCE((SELECT sum(price) FROM bookings b WHERE b.business_id=$1 AND ${live} AND date_trunc('${unit}', b.starts_at)=g),0)::float AS revenue,
      (SELECT count(*) FROM bookings b WHERE b.business_id=$1 AND ${live} AND date_trunc('${unit}', b.starts_at)=g)::int AS bookings,
      (SELECT count(*) FROM conversations c WHERE c.business_id=$1 AND date_trunc('${unit}', c.created_at)=g)::int AS chats
      FROM generate_series(date_trunc('${unit}', now() - make_interval(days => $2::int - 1)), date_trunc('${unit}', now()), '1 ${unit}') g`, P);

  // When the business is busy: bookings by weekday × hour (counts each hour the appointment covers).
  const heat = await q(`SELECT extract(dow FROM h)::int AS dow, extract(hour FROM h)::int AS hour, count(*)::int AS n
      FROM bookings b, generate_series(date_trunc('hour', b.starts_at), b.ends_at - interval '1 minute', '1 hour') h
      WHERE b.business_id=$1 AND b.starts_at > ${since} AND ${live} GROUP BY 1,2`, P);

  // Capacity used = booked minutes / (open minutes × customers at the same time), past part of the period and next 7 days.
  const openMinutes = (from, to) => {
    let m = 0; const d = new Date(from); d.setHours(0, 0, 0, 0);
    for (; d < to; d.setDate(d.getDate() + 1)) for (const [a, b] of dayRanges(biz, d)) m += b - a;
    return m * (biz.capacity || 1);
  };
  const [bookedPast] = await q(`SELECT COALESCE(sum(extract(epoch FROM ends_at - starts_at)/60),0)::float AS m FROM bookings b
      WHERE b.business_id=$1 AND b.starts_at > ${since} AND b.starts_at < now() AND ${live}`, P);
  const [bookedNext] = await q(`SELECT COALESCE(sum(extract(epoch FROM ends_at - starts_at)/60),0)::float AS m, count(*)::int AS n, COALESCE(sum(price),0)::float AS revenue
      FROM bookings b WHERE b.business_id=$1 AND b.starts_at >= now() AND b.starts_at < now() + interval '7 days' AND b.status='confirmed'`, [BIZ]);
  const [next30] = await q(`SELECT count(*)::int AS n, COALESCE(sum(price),0)::float AS revenue FROM bookings b
      WHERE b.business_id=$1 AND b.starts_at >= now() AND b.starts_at < now() + interval '30 days' AND b.status='confirmed'`, [BIZ]);
  const now = new Date(), start = new Date(Date.now() - days * 864e5), in7 = new Date(Date.now() + 7 * 864e5);
  const openPast = openMinutes(start, now), openNext = openMinutes(now, in7);
  const capacity = { past: openPast ? bookedPast.m / openPast : null, next7: openNext ? bookedNext.m / openNext : null, bookedHoursNext7: Math.round(bookedNext.m / 60), openHoursNext7: Math.round(openNext / 60) };

  // How the AI performs, and demand that didn't turn into a booking.
  const [ai] = await q(`SELECT count(*)::int AS chats,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.role='assistant' AND NOT m.failed))::int AS answered,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.conversation_id=c.id))::int AS booked,
      count(*) FILTER (WHERE c.outcome='handoff')::int AS handoff,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.failed))::int AS failed,
      (SELECT round(avg(m.latency_ms) FILTER (WHERE NOT m.failed))::int FROM messages m JOIN conversations c2 ON c2.id=m.conversation_id
         WHERE c2.business_id=$1 AND m.role='assistant' AND m.created_at > ${since}) AS avg_ms
      FROM conversations c WHERE c.business_id=$1 AND c.created_at > ${since}`, P);
  const intentConvs = new Set(msgs.filter(m => ['booking', 'price', 'service'].includes(topicOf(m.text))).map(m => m.conversation_id));
  const bookedConvs = new Set((await q(`SELECT DISTINCT conversation_id FROM bookings WHERE business_id=$1 AND conversation_id IS NOT NULL`, [BIZ])).map(r => r.conversation_id));
  const lost = msgs.filter(m => intentConvs.has(m.conversation_id) && !bookedConvs.has(m.conversation_id) && ['booking', 'price', 'service'].includes(topicOf(m.text)))
    .filter((m, i, a) => a.findIndex(x => x.conversation_id === m.conversation_id) === i).slice(0, 6);
  ai.intent = intentConvs.size;

  // Customer value
  const [value] = await q(`SELECT COALESCE(avg(t.spent),0)::float AS avg_spend, COALESCE(avg(t.visits),0)::float AS avg_visits,
      (SELECT round(avg(gap))::int FROM (SELECT extract(day FROM starts_at - lag(starts_at) OVER (PARTITION BY customer_id ORDER BY starts_at)) AS gap
        FROM bookings WHERE business_id=$1 AND status IN ('completed','confirmed') AND starts_at < now()) g WHERE gap > 0) AS days_between
      FROM (SELECT customer_id, sum(price) AS spent, count(*) AS visits FROM bookings WHERE business_id=$1 AND status IN ('completed','confirmed') GROUP BY 1) t`, [BIZ]);
  const [cancelLead] = await q(`SELECT count(*) FILTER (WHERE r.type='cancel')::int AS late_cancel_requests,
      count(*) FILTER (WHERE r.type='reschedule')::int AS late_move_requests, count(*) FILTER (WHERE r.type='extra')::int AS extra_requests
      FROM requests r WHERE r.business_id=$1 AND r.created_at > ${since}`, P);

  return { days, unit, totals, prev: { ...prev, conversations: prevConv.n }, services, weekday, hours, lead, channels, trend, heat, capacity,
    upcoming: { next7: { n: bookedNext.n, revenue: bookedNext.revenue }, next30 }, ai, lost, value, requests: cancelLead,
    customers: { ...cust, top, atRisk, repeatNoShow }, hoursOpen: biz.hours,
    topics, asked, handoff: handoff.n, conversations: convs.n, reminders: rem, currency: biz.currency || 'USD',
    recommendations: recommend({ totals, prev, services, weekday, hours, lead, topics, cust, atRisk, repeatNoShow, handoff: handoff.n, convs: convs.n, biz, capacity, ai, lost, next30 }) };
}

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function recommend({ totals, prev, services, weekday, hours, lead, topics, cust, atRisk, repeatNoShow, handoff, convs, biz, capacity, ai, lost, next30 }) {
  const out = [], t = Object.fromEntries(topics.map(x => [x.topic, x]));
  const past = totals.completed + totals.no_show;
  // Getting-started advice, so a new business never sees an empty list.
  if (!totals.bookings) {
    const start = [];
    if (!convs) start.push({ level: 'info', title: 'No conversations yet', text: 'Connect WhatsApp and share your booking link (Setup) so customers can reach the AI.' });
    else start.push({ level: 'info', title: `${convs} conversation${convs > 1 ? 's' : ''}, no booking yet`, text: 'Read them on the Overview to see where customers stopped, and check your services and opening hours in Setup.' });
    if (!(biz.faqs || []).length) start.push({ level: 'info', title: 'Add your frequent questions', text: 'Setup → FAQ. The more the AI knows, the fewer chats need a person.' });
    if (!biz.description) start.push({ level: 'info', title: 'Describe your business', text: 'Setup → About the business helps the AI answer "what do you do?" properly.' });
    if (!biz.phone) start.push({ level: 'info', title: 'Add your business phone', text: 'It appears in confirmations and late-change messages.' });
    start.push({ level: 'good', title: 'Insights will fill in automatically', text: 'Revenue, busy times, popular services and customer questions appear as soon as people book.' });
    return start.slice(0, 5);
  }
  if (prev.revenue > 0) {
    const ch = (totals.revenue - prev.revenue) / prev.revenue;
    if (Math.abs(ch) >= 0.1) out.push({ level: ch > 0 ? 'good' : 'bad', title: `Revenue ${ch > 0 ? 'up' : 'down'} ${Math.round(Math.abs(ch) * 100)}% vs the previous period`, text: ch > 0 ? 'Keep doing what works: see which services and days grew below.' : 'Check the quiet days below and consider a discount code to fill them.' });
  }
  if (capacity.next7 !== null && capacity.next7 < 0.3 && capacity.openHoursNext7 > 0) out.push({ level: 'info', title: `Only ${Math.round(capacity.next7 * 100)}% of next week is booked`, text: 'Post your free times on Instagram or WhatsApp status, or send regulars a short offer.' });
  if (capacity.next7 > 0.85) out.push({ level: 'good', title: `Next week is ${Math.round(capacity.next7 * 100)}% full`, text: 'Consider extra hours or staff, or raising prices at peak times.' });
  if (lost.length >= 2) out.push({ level: 'info', title: `${lost.length} customers asked but didn't book`, text: 'Open "Asked but didn\'t book" below and follow up personally; these are warm leads.' });
  if (past >= 5 && totals.no_show / past > 0.1)
    out.push({ level: 'bad', title: `${Math.round(totals.no_show / past * 100)}% of customers don't show up`, text: biz.reminders_enabled ? 'Reminders are on. Consider asking a small deposit for long services.' : 'Turn on reminders in Setup: they usually cut no-shows by about half.' });
  if (weekday.length >= 3) {
    const s = [...weekday].sort((a, b) => b.revenue - a.revenue), best = s[0], worst = s[s.length - 1];
    out.push({ level: 'good', title: `${DAY[best.dow]} is your best day`, text: `${best.n} bookings worth ${Math.round(best.revenue)}. Make sure you have enough staff that day.` });
    if (worst.revenue < best.revenue * 0.4) out.push({ level: 'info', title: `${DAY[worst.dow]} is quiet`, text: `Try a ${DAY[worst.dow]}-only discount code to fill it (Setup → Discount codes).` });
  }
  const topSvc = services.find(s => s.n);
  if (topSvc) out.push({ level: 'good', title: `${topSvc.name} brings the most money`, text: `${topSvc.n} bookings, ${Math.round(topSvc.revenue)} in revenue. Feature it first on Instagram and in the booking page.` });
  const unsold = services.filter(s => !s.n && s.name);
  if (topSvc && unsold.length) out.push({ level: 'info', title: `${unsold.map(s => s.name).join(', ')} had no bookings`, text: 'Check the price, or promote it with a bundle or code.' });
  if (t.price && t.price.n >= 3) out.push({ level: 'info', title: `Customers asked about prices ${t.price.n} times`, text: 'Post your price list on Instagram and Google Maps so people book faster.' });
  if (t.location && t.location.n >= 3) out.push({ level: 'info', title: `${t.location.n} questions about location or parking`, text: 'Add a Google Maps link and parking details to your Business setup and profiles.' });
  if (t.complaint) out.push({ level: 'bad', title: `${t.complaint.n} complaint message${t.complaint.n > 1 ? 's' : ''}`, text: 'Read them below and reply personally. Recurring issues are worth fixing first.' });
  if (t.discount && t.discount.n >= 3) out.push({ level: 'info', title: `${t.discount.n} customers asked for offers`, text: 'A first-visit code (e.g. WELCOME10) can turn these into bookings.' });
  if (convs >= 5 && handoff / convs > 0.2) out.push({ level: 'bad', title: `${Math.round(handoff / convs * 100)}% of chats needed a person`, text: 'Look at the flagged questions below and add the answers to Business setup so the AI can handle them.' });
  const sameDay = lead.find(l => l.bucket === 'Same day');
  const totalLead = lead.reduce((a, l) => a + l.n, 0);
  if (sameDay && totalLead >= 5 && sameDay.n / totalLead > 0.4) out.push({ level: 'info', title: 'Many customers book for the same day', text: 'Fast replies matter most for you. Keep the AI on all day, including breaks.' });
  if (atRisk.length) out.push({ level: 'info', title: `${atRisk.length} regular customer${atRisk.length > 1 ? 's' : ''} haven't come back in 45+ days`, text: 'Send them a personal "we miss you" message with a small offer.' });
  if (repeatNoShow.length) out.push({ level: 'bad', title: `${repeatNoShow.length} customer${repeatNoShow.length > 1 ? 's' : ''} missed 2+ appointments`, text: 'Consider asking them to confirm or pay a deposit before booking again.' });
  if (cust && cust.returning + cust.new >= 5) out.push({ level: 'good', title: `${Math.round(cust.returning / (cust.returning + cust.new) * 100)}% of customers are returning`, text: cust.returning >= cust.new ? 'Strong loyalty. A referral code could bring their friends.' : 'Most are new: a "book your next visit" message after each appointment helps them return.' });
  return out.slice(0, 8);
}
