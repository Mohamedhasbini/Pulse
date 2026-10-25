// Free appointment slots from weekly hours, capacity, time off and existing bookings.
// Times use the container's TZ (set from TIMEZONE in .env).
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dayRanges(biz, date) {
  return (biz.hours?.[date.getDay()] || []).map(([a, b]) => [toMin(a), toMin(b)]);
}

// Buffer (minutes kept free around a booking for cleaning, setup or travel): the service's own, else the business default.
export function bufferOf(biz, serviceId) {
  const svc = (biz.services || []).find(x => x.id === serviceId);
  return Math.max(0, svc?.buffer_minutes ?? biz.buffer_minutes ?? 0);
}

// newBuffer: buffer of the service being booked (defaults to the business buffer).
// serviceId: when that service has its own capacity (restaurant tables of one size), only its own bookings count.
export function isFree(biz, bookings, timeOff, start, end, newBuffer = biz.buffer_minutes || 0, serviceId = null) {
  const day = new Date(start); day.setHours(0, 0, 0, 0);
  const s = (start - day) / 60000, e = (end - day) / 60000;
  if (!dayRanges(biz, start).some(([a, b]) => s >= a && e <= b)) return false;
  if (timeOff.some(t => new Date(t.starts_at) < end && new Date(t.ends_at) > start)) return false;
  // Two bookings need the larger of their two buffers between them.
  const overlapping = bookings.filter(b => {
    if (b.status === 'cancelled') return false;
    const gap = Math.max(bufferOf(biz, b.service_id), newBuffer) * 60000;
    return new Date(b.starts_at) - gap < end && new Date(b.ends_at).getTime() + gap > start;
  });
  const own = serviceId && biz.services?.find(s => s.id === +serviceId)?.capacity;
  if (own) return overlapping.filter(b => b.service_id === +serviceId).length < own;
  return overlapping.length < (biz.capacity || 1);
}

export function freeSlots(biz, bookings, timeOff, minutes = 60, count = 8, now = new Date(), buffer = biz.buffer_minutes || 0, serviceId = null) {
  const out = [], step = biz.slot_step || 30;
  const earliest = new Date(now.getTime() + 60 * 60 * 1000);
  for (let d = 0; d < 21 && out.length < count; d++) {
    const day = new Date(now); day.setDate(day.getDate() + d); day.setHours(0, 0, 0, 0);
    for (const [a, b] of dayRanges(biz, day)) {
      for (let m = a; m + minutes <= b && out.length < count; m += step) {
        const start = new Date(day.getTime() + m * 60000);
        if (start < earliest) continue;
        const end = new Date(start.getTime() + minutes * 60000);
        if (isFree(biz, bookings, timeOff, start, end, buffer, serviceId)) out.push({ id: start.toISOString(), label: label(start) });
      }
    }
  }
  return out;
}

export function hoursText(biz) {
  return [1, 2, 3, 4, 5, 6, 0].map(d => {
    const r = biz.hours?.[d] || [];
    return `${DAYS[d]}: ${r.length ? r.map(([a, b]) => `${a}-${b}`).join(', ') : 'closed'}`;
  }).join('; ');
}

export function label(d) {
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Free time per day for the next `days` days, as compact ranges the AI can read,
// e.g. { date: "2026-10-26", day: "Mon 26 Oct", free: "10:00-12:30, 14:00-19:30" }.
// A range lists start times; a service fits if it also ends inside opening hours.
export function availability(biz, bookings, timeOff, days = 14, now = new Date()) {
  const out = [], step = biz.slot_step || 30, counted = (biz.services || []).filter(s => s.capacity).map(s => s.id);
  const earliest = new Date(now.getTime() + 30 * 60000);
  for (let d = 0; d < days; d++) {
    const day = new Date(now); day.setDate(day.getDate() + d); day.setHours(0, 0, 0, 0);
    const starts = [];
    for (const [a, b] of dayRanges(biz, day)) {
      for (let m = a; m + step <= b; m += step) {
        const start = new Date(day.getTime() + m * 60000);
        const end = new Date(start.getTime() + step * 60000);
        if (start >= earliest && (counted.length ? counted.some(id => isFree(biz, bookings, timeOff, start, end, undefined, id)) : isFree(biz, bookings, timeOff, start, end))) starts.push(m);
      }
    }
    const ranges = [];
    for (const m of starts) {
      const r = ranges[ranges.length - 1];
      if (r && m === r[1] + step) r[1] = m; else ranges.push([m, m]);
    }
    const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    out.push({ date: localDate(day), day: day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      free: dayRanges(biz, day).length ? (ranges.map(([a, b]) => a === b ? hm(a) : `${hm(a)}-${hm(b)}`).join(', ') || 'fully booked') : 'closed' });
  }
  return out;
}

export const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const localStamp = d => d && `${localDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// "2026-10-26 10:30" or "2026-10-26T10:30" in the business time zone -> Date
export function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(String(s || '').trim());
  if (!m) return new Date(NaN);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}
