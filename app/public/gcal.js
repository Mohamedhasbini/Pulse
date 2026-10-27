// Calendar, Google style: Day · Week · Month, a mini month on the left, Today and ‹ › to move.
// Appointments are clean blocks (who and what, coloured by service); a click opens the existing booking form,
// a click on an empty slot starts a new booking there. Pending cancel/move requests show as a badge on their day.
// Data: /api/calendar and /api/requests; the forms are calendar.js's openBooking / openOff.
window.PulseCal = (() => {
  const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const COLORS = ['#2f8f5b', '#5d50cc', '#c45f2a', '#1f7fa8', '#b0477a', '#8a7a1c', '#3b6fd8', '#6b8f2f'];
  const DAYN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let root = null, st = { view: 'week', at: null, data: { bookings: [], timeOff: [] }, requests: [] };

  const p2 = n => String(n).padStart(2, '0');
  const key = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const parse = s => new Date(String(s).replace('T', ' ').replace(/-/g, '/'));
  const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return add(x, -((x.getDay() + 6) % 7)); };
  const now = () => (typeof bizNow === 'function' ? bizNow() : new Date());
  // colour by service name, so a service listed twice still looks the same everywhere
  const svcColor = name => { const names = [...new Set(((typeof biz !== 'undefined' && biz?.services) || []).map(s => s.name))]; const i = names.indexOf(name); return COLORS[(i < 0 ? [...String(name)].reduce((n, c) => n + c.charCodeAt(0), 0) : i) % COLORS.length]; };
  const hm = d => `${p2(d.getHours())}:${p2(d.getMinutes())}`;

  function range() {
    const a = st.at;
    if (st.view === 'day') { const s = new Date(a); s.setHours(0, 0, 0, 0); return [s, add(s, 1)]; }
    if (st.view === 'week') { const s = monday(a); return [s, add(s, 7)]; }
    const s = monday(new Date(a.getFullYear(), a.getMonth(), 1)); return [s, add(s, 42)];
  }
  function title() {
    const [s, t] = range(), o = { day: 'numeric', month: 'short' };
    if (st.view === 'day') return s.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (st.view === 'week') return `${s.toLocaleDateString('en-GB', o)} – ${add(t, -1).toLocaleDateString('en-GB', o)} ${add(t, -1).getFullYear()}`;
    return st.at.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  function frame() {
    root.innerHTML = `<div class="gc">
      <aside class="gc-side"><button type="button" class="btn gc-new" data-new="1">+ New booking</button>
        <div class="gc-mini" id="gcMini"></div>
        <button type="button" class="btn ghost gc-off" data-off="1">Block time</button>
        <div class="gc-legend" id="gcLegend"></div><div class="gc-req" id="gcReq"></div></aside>
      <section class="gc-main"><header class="gc-head"><button type="button" class="btn ghost" data-today="1">Today</button>
        <button type="button" class="gc-arrow" data-move="-1" aria-label="Previous">‹</button><button type="button" class="gc-arrow" data-move="1" aria-label="Next">›</button>
        <h2 id="gcTitle"></h2><div class="gc-views" role="tablist">${['day', 'week', 'month'].map(v => `<button type="button" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></header>
        <div class="gc-body" id="gcBody"></div></section></div>`;
    root.addEventListener('click', click);
  }

  async function load() {
    const [s, t] = range();
    try {
      const [cal, rq] = await Promise.all([req(`/api/calendar?from=${key(s)}T00:00&to=${key(t)}T00:00`), req('/api/requests?status=pending').catch(() => [])]);
      st.data = cal; st.requests = rq;
    } catch { root.querySelector('#gcBody').innerHTML = '<p class="gc-none">Couldn\'t load the calendar. <button type="button" class="btn ghost" data-retry="1">Retry</button></p>'; return; }
    draw();
  }

  const live = () => (st.data.bookings || []).filter(b => b.status !== 'cancelled');
  function hours() {
    let a = 24, b = 0;
    const h = (typeof biz !== 'undefined' && biz?.hours) || {};
    for (let d = 0; d < 7; d++) (h[d] || []).forEach(([s, e2]) => { a = Math.min(a, +s.slice(0, 2)); b = Math.max(b, Math.ceil(+e2.slice(0, 2) + (+e2.slice(3) > 0 ? 1 : 0))); });
    live().forEach(x => { a = Math.min(a, parse(x.start).getHours()); b = Math.max(b, parse(x.end).getHours() + 1); });
    return a < b ? [a, Math.min(24, b)] : [9, 19];
  }

  function draw() {
    root.querySelector('#gcTitle').textContent = title();
    root.querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.view)));
    mini(); legend(); requests();
    st.view === 'month' ? month() : grid(st.view === 'day' ? 1 : 7);
  }

  function grid(days) {
    const body = root.querySelector('#gcBody'), [h0, h1] = hours(), [s] = range(), today = key(now());
    const head = 40, rowH = Math.max(22, Math.floor((body.clientHeight - head - 6) / (h1 - h0)));
    const reqDays = new Set(st.requests.map(r => (r.start || '').slice(0, 10)));
    let html = `<div class="gc-grid" style="--days:${days};--row:${rowH}px;--hours:${h1 - h0}"><div class="gc-corner"></div>`;
    for (let i = 0; i < days; i++) { const d = add(s, i), k = key(d);
      html += `<div class="gc-dh${k === today ? ' today' : ''}" data-day="${k}"><span>${DAYN[(d.getDay() + 6) % 7]}</span><b>${d.getDate()}</b>${reqDays.has(k) ? '<i class="gc-badge" title="A customer asked to cancel or move">request</i>' : ''}</div>`; }
    html += `<div class="gc-times">${Array.from({ length: h1 - h0 }, (_, i) => `<span style="top:${i * rowH}px">${p2(h0 + i)}:00</span>`).join('')}</div>`;
    for (let i = 0; i < days; i++) {
      const d = add(s, i), k = key(d);
      const blocks = live().filter(b => b.start.slice(0, 10) === k).map(b => {
        const a = parse(b.start), z = parse(b.end), top = (a.getHours() - h0 + a.getMinutes() / 60) * rowH, h = Math.max(18, (z - a) / 36e5 * rowH - 2);
        return `<button type="button" class="gc-b${b.status === 'no_show' ? ' faded' : ''}" data-b="${b.id}" style="top:${top}px;height:${h}px;--c:${svcColor(b.service)}">
          <b>${e(b.customer)}</b>${h > 30 ? `<span>${e(b.service)}</span>` : ''}${h > 46 ? `<small>${hm(a)}–${hm(z)}</small>` : ''}</button>`;
      }).join('');
      const off = (st.data.timeOff || []).filter(t => t.start.slice(0, 10) <= k && t.end.slice(0, 10) >= k).map(t => {
        const a = parse(t.start), z = parse(t.end), from = t.start.slice(0, 10) < k ? h0 : a.getHours() + a.getMinutes() / 60, to = t.end.slice(0, 10) > k ? h1 : z.getHours() + z.getMinutes() / 60;
        return `<button type="button" class="gc-off-b" data-t="${t.id}" style="top:${(Math.max(from, h0) - h0) * rowH}px;height:${Math.max(14, (Math.min(to, h1) - Math.max(from, h0)) * rowH)}px">${e(t.reason || 'Blocked')}</button>`;
      }).join('');
      const nowLine = k === today ? (() => { const n = now(), y = (n.getHours() - h0 + n.getMinutes() / 60) * rowH; return y >= 0 && y <= (h1 - h0) * rowH ? `<i class="gc-now" style="top:${y}px"></i>` : ''; })() : '';
      html += `<div class="gc-col${k === today ? ' today' : ''}" data-col="${k}" data-h0="${h0}">${off}${blocks}${nowLine}</div>`;
    }
    body.innerHTML = html + '</div>';
  }

  function month() {
    const body = root.querySelector('#gcBody'), [s] = range(), m = st.at.getMonth(), today = key(now());
    const by = {}; live().forEach(b => (by[b.start.slice(0, 10)] ||= []).push(b));
    const rowH = Math.floor((body.clientHeight - 30) / 6), fit = Math.max(1, Math.floor((rowH - 26) / 20));
    body.innerHTML = `<div class="gc-month" style="--rowh:${rowH}px">${DAYN.map(d => `<div class="gc-mh">${d}</div>`).join('')}${Array.from({ length: 42 }, (_, i) => {
      const d = add(s, i), k = key(d), list = (by[k] || []);
      return `<div class="gc-md${d.getMonth() !== m ? ' out' : ''}${k === today ? ' today' : ''}" data-goday="${k}"><b>${d.getDate()}</b>
        ${list.slice(0, fit).map(b => `<button type="button" class="gc-chip" data-b="${b.id}" style="--c:${svcColor(b.service)}">${b.start.slice(11, 16)} ${e(b.customer)}</button>`).join('')}
        ${list.length > fit ? `<small>+${list.length - fit} more</small>` : ''}</div>`; }).join('')}</div>`;
  }

  function mini() {
    const a = st.at, first = new Date(a.getFullYear(), a.getMonth(), 1), s = monday(first), today = key(now());
    const busy = new Set(live().map(b => b.start.slice(0, 10))), [r0, r1] = range();
    root.querySelector('#gcMini').innerHTML = `<div class="gc-mini-h"><button type="button" data-mm="-1" aria-label="Previous month">‹</button><b>${a.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b><button type="button" data-mm="1" aria-label="Next month">›</button></div>
      <div class="gc-mini-g">${DAYN.map(d => `<span>${d[0]}</span>`).join('')}${Array.from({ length: 42 }, (_, i) => { const d = add(s, i), k = key(d);
        return `<button type="button" data-goday="${k}" class="${d.getMonth() !== a.getMonth() ? 'out' : ''}${k === today ? ' today' : ''}${d >= r0 && d < r1 && st.view !== 'month' ? ' inrange' : ''}${busy.has(k) ? ' busy' : ''}">${d.getDate()}</button>`; }).join('')}</div>`;
  }
  function legend() {
    const used = [...new Set(live().map(b => b.service))].slice(0, 8);
    root.querySelector('#gcLegend').innerHTML = used.map(n => `<span><i style="background:${svcColor(n)}"></i>${e(n)}</span>`).join('');
  }
  function requests() {
    const n = st.requests.length;
    root.querySelector('#gcReq').innerHTML = n ? `<button type="button" class="need" data-req="1">${n} cancel/move request${n === 1 ? '' : 's'} →</button>` : '';
  }

  function click(ev) {
    const t = ev.target;
    if (t.closest('[data-retry]')) return load();
    const v = t.closest('[data-v]'); if (v) { st.view = v.dataset.v; return load(); }
    const mv = t.closest('[data-move]'); if (mv) { const n = +mv.dataset.move; st.at = st.view === 'day' ? add(st.at, n) : st.view === 'week' ? add(st.at, 7 * n) : new Date(st.at.getFullYear(), st.at.getMonth() + n, 1); return load(); }
    const mm = t.closest('[data-mm]'); if (mm) { st.at = new Date(st.at.getFullYear(), st.at.getMonth() + +mm.dataset.mm, 1); return load(); }
    if (t.closest('[data-today]')) { st.at = now(); return load(); }
    if (t.closest('[data-new]')) return document.getElementById('calNew')?.click();
    if (t.closest('[data-off]')) return typeof openOff === 'function' && openOff(null);
    if (t.closest('[data-req]')) return window.openP10?.('calendar', 1);
    const b = t.closest('[data-b]'); if (b) { const x = (st.data.bookings || []).find(y => y.id === +b.dataset.b); if (x && typeof openBooking === 'function') openBooking(x); return; }
    const off = t.closest('[data-t]'); if (off) { const x = (st.data.timeOff || []).find(y => y.id === +off.dataset.t); if (x && typeof openOff === 'function') openOff(x); return; }
    const gd = t.closest('[data-goday]'); if (gd) { st.at = parse(gd.dataset.goday + 'T12:00'); if (gd.closest('.gc-month')) st.view = 'day'; return load(); }
    // an empty slot: a new booking at that time (half-hour steps)
    const col = t.closest('[data-col]'); if (col && typeof openBooking === 'function') {
      const rowH = parseFloat(getComputedStyle(col.closest('.gc-grid')).getPropertyValue('--row')), y = ev.clientY - col.getBoundingClientRect().top;
      const mins = Math.floor(y / rowH * 2) * 30, h = +col.dataset.h0 + Math.floor(mins / 60);
      openBooking(null, col.dataset.col, `${p2(h)}:${p2(mins % 60)}`);
    }
  }

  // after a booking or time off is saved through the old forms, redraw
  if (typeof loadCal === 'function') { const old = loadCal; loadCal = async function () { try { await old(); } catch {} if (root && !root.closest('[hidden]')) load(); }; }

  return {
    mount(section) {
      root = section.querySelector('#gcRoot');
      if (!root.dataset.on) { root.dataset.on = 1; st.at = now(); frame(); }
      requestAnimationFrame(load);
    },
    refresh: () => root && load(),
  };
})();
