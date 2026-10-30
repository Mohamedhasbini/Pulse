// One network layer for the dashboard: identical GET /api calls made at the same moment share one request, and an
// answer is reused for 1.5 s (a page opens with several panels asking for the same data). Any change (POST/PUT/DELETE)
// forgets everything, so a save is always followed by fresh numbers. Streams (/api/events, /api/team) are never touched.
(() => {
  const raw = window.fetch.bind(window), live = new Map(), TTL = 1500;
  const SKIP = /^\/api\/(events|team\/|pulse\/ask|public\/)/;
  const keyOf = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url; if (!url || !/^\/api\//.test(url) || SKIP.test(url)) return null;
    const m = (init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
    return m === 'GET' ? url : m === 'HEAD' ? null : 'write';
  };
  window.fetch = (input, init) => {
    const k = keyOf(input, init);
    if (k === 'write') { live.clear(); return raw(input, init); }
    if (!k || init?.signal || init?.cache === 'no-store') return raw(input, init);
    const hit = live.get(k);
    if (hit && (hit.pending || Date.now() - hit.at < TTL)) return hit.p.then(r => r.clone());
    const e = { pending: true, at: 0 };
    e.p = raw(input, init).then(r => { e.pending = false; e.at = Date.now(); if (!r.ok) live.delete(k); return r; }, err => { live.delete(k); throw err; });
    live.set(k, e);
    return e.p.then(r => r.clone());
  };
  // animations pause while the tab is hidden (no battery or CPU spent on a page nobody sees)
  const vis = () => document.documentElement.classList.toggle('tab-hidden', document.hidden);
  document.addEventListener('visibilitychange', vis); vis();
  window.fetch.raw = raw;
  window.fetch.forget = () => live.clear();
})();
