// The business clock. Every business has its own time zone (Beirut, Madrid, ...); the server has one. Anything that
// turns an instant into a day, an hour or a label, or a typed "2026-11-04 10:30" into an instant, must use the
// business's zone, not the server's: otherwise a Madrid salon is offered times an hour off.
//   inZone(tz, fn)  runs fn (and everything it awaits) on that business's clock; the request middleware, the
//                   receptionist and the reminder loop set it. db.js q() also runs SQL in that zone.
//   wall(d)         the wall clock of instant d: { y, mo, d, h, mi, wd, min, date: 'YYYY-MM-DD', hm: 'HH:MM' }
//   at(y,mo,d,h,mi) the instant whose wall clock is that (months 1-12, days roll over); DST-safe
// Every helper takes an optional tz last; without it the current zone is used (the server's when none is set).
import { AsyncLocalStorage } from 'node:async_hooks';

export const DEFAULT_TZ = process.env.TZ || 'Asia/Beirut';
const store = new AsyncLocalStorage();
const known = new Map();
// a real IANA zone name (also safe to put in SQL: letters, digits, / _ + - only)
export function okTz(tz) {
  if (!tz || typeof tz !== 'string' || !/^[A-Za-z0-9_\/+-]{1,64}$/.test(tz)) return false;
  if (!known.has(tz)) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); known.set(tz, true); } catch { known.set(tz, false); } }
  return known.get(tz);
}
export const tzOf = biz => okTz(biz?.timezone) ? biz.timezone : DEFAULT_TZ;
export const currentTz = () => store.getStore() || DEFAULT_TZ;
export const inZone = (tz, fn) => store.run(okTz(tz) ? tz : DEFAULT_TZ, fn);

const pad = n => String(n).padStart(2, '0');
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const F = new Map();
const parts = tz => {
  let f = F.get(tz);
  if (!f) F.set(tz, f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }));
  return f;
};
export function wall(d, tz = currentTz()) {
  const p = {};
  for (const { type, value } of parts(tz).formatToParts(new Date(d))) p[type] = value;
  const y = +p.year, mo = +p.month, day = +p.day, h = +p.hour % 24, mi = +p.minute;
  return { y, mo, d: day, h, mi, wd: WD[p.weekday], min: h * 60 + mi, date: `${y}-${pad(mo)}-${pad(day)}`, hm: `${pad(h)}:${pad(mi)}` };
}
// In the hour a DST change skips, it lands just after the jump; in the hour repeated, on the first one.
export function at(y, mo, d, h = 0, mi = 0, tz = currentTz()) {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const w = wall(t, tz), diff = want - Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
    if (!diff) break;
    t += diff;
  }
  return new Date(t);
}
// local midnight of the day d falls on, moved n local days
export const dayStart = (d, n = 0, tz = currentTz()) => { const w = wall(d, tz); return at(w.y, w.mo, w.d + n, 0, 0, tz); };
// whole local calendar days from a to b (0 = same day, 1 = b is tomorrow)
export const daysBetween = (a, b, tz = currentTz()) => {
  const x = wall(a, tz), y = wall(b, tz);
  return Math.round((Date.UTC(y.y, y.mo - 1, y.d) - Date.UTC(x.y, x.mo - 1, x.d)) / 864e5);
};
export const fmtDate = (d, opts = {}, locale = 'en-GB', tz = currentTz()) => new Date(d).toLocaleDateString(locale, { ...opts, timeZone: tz });
export const fmtTime = (d, tz = currentTz()) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
export const fmtStamp = (d, opts = {}, locale = 'en-GB', tz = currentTz()) => new Date(d).toLocaleString(locale, { ...opts, timeZone: tz });
