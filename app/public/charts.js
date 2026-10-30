// Pulse v6 board: the 16 chart and table drafts (design/drafts/pulse-charts-tables-16.html), built from live data
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = v => (window.money ? window.money(v) : '$' + Math.round(+v || 0).toLocaleString());
  const day = d => d.toISOString().slice(0, 10);
  const cache = {};
  const get = (u, ttl = 60000) => { const c = cache[u]; if (c && Date.now() - c.t < ttl) return c.p; const p = fetch(u).then(r => r.ok ? r.json() : null).catch(() => null); cache[u] = { t: Date.now(), p }; return p; };
  const L = 'var(--pv-lime)', S = 'var(--pv-silver)';
  const a = (hex, o) => `color-mix(in srgb,${L} ${Math.round(o * 100)}%,transparent)`;
  const card = (n, title, sub, body, wide) => `<section class="pv-c${wide ? ' w' : ''}" data-n="${n}"><header><h3>${esc(title)}</h3><small>${esc(sub)}</small></header>${body}</section>`;
  const empty = t => `<p class="pv-empty">${esc(t)}</p>`;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  async function data() {
    const now = new Date(), from = new Date(now - 180 * 864e5), to = new Date(+now + 14 * 864e5);
    const [cal, live, cust, conv] = await Promise.all([get(`/api/calendar?from=${day(from)}T00:00&to=${day(to)}T00:00`), get('/api/live?days=30'), get('/api/customers'), get('/api/conversations')]);
    const all = (cal?.bookings || []).filter(b => b.status !== 'cancelled');
    const T = Date.now(), past = all.filter(b => new Date(b.start) <= T);
    return { all, past, live: live || {}, cust: Array.isArray(cust) ? cust : cust?.rows || [], conv: Array.isArray(conv) ? conv : [] };
  }
  const sumIn = (list, d0, d1) => list.filter(b => { const t = new Date(b.start); return t >= d0 && t < d1; });
  const rev = l => l.reduce((s, b) => s + (+b.price || 0), 0);

  // ---- 1 revenue area + ghost period
  function c1({ past }) {
    const D = 30, now = new Date(new Date().toDateString()), cur = [], prev = [];
    for (let i = D - 1; i >= 0; i--) { const d0 = new Date(+now - i * 864e5), d1 = new Date(+d0 + 864e5); cur.push(rev(sumIn(past, d0, d1))); prev.push(rev(sumIn(past, new Date(+d0 - D * 864e5), new Date(+d1 - D * 864e5)))); }
    const tc = cur.reduce((a, b) => a + b, 0), tp = prev.reduce((a, b) => a + b, 0), mx = Math.max(1, ...cur, ...prev);
    const pts = arr => arr.map((v, i) => `${(i / (D - 1) * 600).toFixed(1)},${(150 - v / mx * 130).toFixed(1)}`).join(' ');
    const pct = tp ? Math.round((tc - tp) / tp * 100) : null;
    return card(1, 'Revenue, last 30 days', 'Lime is now, the dashed line is the 30 days before', `<div class="pv-big">${money(tc)} <em class="${pct < 0 ? 'dn' : ''}">${pct == null ? 'first period' : (pct >= 0 ? '+' : '') + pct + '%'}</em></div>
      <svg viewBox="0 0 600 160" preserveAspectRatio="none" class="pv-area"><defs><linearGradient id="pvA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--pv-lime)" stop-opacity=".45"/><stop offset="1" stop-color="var(--pv-lime)" stop-opacity="0"/></linearGradient></defs>
      <polygon points="0,160 ${pts(cur)} 600,160" fill="url(#pvA)"/><polyline points="${pts(prev)}" fill="none" stroke="${S}" stroke-dasharray="5 5" opacity=".6" stroke-width="2" vector-effect="non-scaling-stroke"/><polyline points="${pts(cur)}" fill="none" stroke="${L}" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>`, 1);
  }
  // ---- 2 pivot: service x weekday
  function c2({ past }) {
    const l = past.filter(b => new Date(b.start) > Date.now() - 90 * 864e5); if (!l.length) return card(2, 'Bookings by service and day', 'Last 90 days', empty('No bookings yet'));
    const svc = [...new Set(l.map(b => b.service))].sort((x, y) => l.filter(b => b.service === y).length - l.filter(b => b.service === x).length).slice(0, 6);
    const ord = [1, 2, 3, 4, 5, 6, 0], m = {}; let mx = 1;
    l.forEach(b => { const k = b.service + '|' + new Date(b.start).getDay(); m[k] = (m[k] || 0) + 1; mx = Math.max(mx, m[k]); });
    const cell = v => v ? `<td style="background:${a(L, .12 + v / mx * .88)}${v / mx > .6 ? ';color:#111' : ''}">${v}</td>` : '<td class="z">·</td>';
    const col = d => svc.reduce((s, x) => s + (m[x + '|' + d] || 0), 0);
    return card(2, 'Pivot: service × weekday', 'Bookings, last 90 days. Darker lime = busier', `<div class="pv-scroll"><table class="pv-t pv-piv"><thead><tr><th>Service</th>${ord.map(d => `<th>${DAYS[d]}</th>`).join('')}<th>Σ</th></tr></thead><tbody>
      ${svc.map(x => `<tr><td>${esc(x)}</td>${ord.map(d => cell(m[x + '|' + d] || 0)).join('')}<td><b>${ord.reduce((s, d) => s + (m[x + '|' + d] || 0), 0)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><th>Σ</th>${ord.map(d => `<th>${col(d)}</th>`).join('')}<th class="hl">${l.filter(b => svc.includes(b.service)).length}</th></tr></tfoot></table></div>`, 1);
  }
  // ---- 3 occupancy gauge
  function c3({ all }) {
    const d = new Date(), t = sumIn(all, new Date(d.toDateString()), new Date(+new Date(d.toDateString()) + 864e5));
    const h = window.biz?.hours?.[d.getDay()] || [['09:00', '20:00']], open = Math.max(1, (parseInt(h[h.length - 1]?.[1] || '20') - parseInt(h[0]?.[0] || '9')) * 60);
    const mins = t.reduce((s, b) => s + (new Date(b.end) - new Date(b.start)) / 6e4, 0), p = Math.min(100, Math.round(mins / open * 100)), len = Math.PI * 80;
    return card(3, 'Chair time today', `${t.length} appointments · ${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m booked`, `<svg viewBox="0 0 200 118" class="pv-gauge"><path d="M20 108A80 80 0 0 1 180 108" stroke="var(--pv-track)" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M20 108A80 80 0 0 1 180 108" stroke="${L}" stroke-width="16" fill="none" stroke-linecap="round" stroke-dasharray="${len * p / 100} ${len}"/><text x="100" y="98" text-anchor="middle" class="pv-gv">${p}%</text></svg>`);
  }
  // ---- 4 busy-hours heatmap
  function c4({ past, conv }) {
    const ord = [1, 2, 3, 4, 5, 6, 0], slots = [9, 11, 13, 15, 17, 19], m = {}; let mx = 1;
    [...past.filter(b => new Date(b.start) > Date.now() - 90 * 864e5).map(b => b.start), ...conv.map(c => c.at)].forEach(s => { const d = new Date(s), h = d.getHours(), i = slots.findIndex(x => h >= x && h < x + 2); if (i < 0) return; const k = d.getDay() + '|' + i; m[k] = (m[k] || 0) + 1; mx = Math.max(mx, m[k]); });
    return card(4, 'Busy hours', 'Bookings and chats by day and time, last 90 days', `<div class="pv-heat"><span></span>${ord.map(d => `<span>${DAYS[d][0]}</span>`).join('')}
      ${slots.map((s, i) => `<span>${s}h</span>${ord.map(d => { const v = m[d + '|' + i] || 0; return `<b title="${DAYS[d]} ${s}:00 · ${v}" style="background:${v ? a(L, .1 + v / mx * .9) : 'var(--pv-track)'}"></b>`; }).join('')}`).join('')}</div>`);
  }
  // ---- 5 donut by service
  function c5({ past }) {
    const l = past.filter(b => new Date(b.start) > Date.now() - 30 * 864e5), by = {};
    l.forEach(b => by[b.service] = (by[b.service] || 0) + (+b.price || 0));
    const rows = Object.entries(by).sort((x, y) => y[1] - x[1]), tot = rows.reduce((s, r) => s + r[1], 0);
    if (!tot) return card(5, 'Revenue by service', 'Last 30 days', empty('No revenue yet'));
    const top = rows.slice(0, 4); if (rows.length > 4) top.push(['Other', rows.slice(4).reduce((s, r) => s + r[1], 0)]);
    const cols = [L, S, '#8a9096', '#5d6369', '#3f4448'], C = 2 * Math.PI * 45; let off = 0;
    return card(5, 'Revenue by service', 'Last 30 days', `<div class="pv-donut"><svg viewBox="0 0 120 120"><g transform="rotate(-90 60 60)" fill="none" stroke-width="20">${top.map((r, i) => { const s = `<circle cx="60" cy="60" r="45" stroke="${cols[i]}" stroke-dasharray="${C * r[1] / tot - 1.5} ${C}" stroke-dashoffset="${-off}"/>`; off += C * r[1] / tot; return s; }).join('')}</g><text x="60" y="66" text-anchor="middle" class="pv-dv">${money(tot)}</text></svg>
      <ul>${top.map((r, i) => `<li><i style="background:${cols[i]}"></i>${esc(r[0])}<b>${Math.round(r[1] / tot * 100)}%</b></li>`).join('')}</ul></div>`);
  }
  // ---- 6 leaderboard
  function c6({ cust }) {
    const top = [...cust].sort((x, y) => (y.spent || 0) - (x.spent || 0)).filter(c => c.spent).slice(0, 6), mx = top[0]?.spent || 1;
    return card(6, 'Top clients', 'Lifetime spend', top.length ? `<table class="pv-t"><thead><tr><th>#</th><th>Client</th><th>Visits</th><th>Spend</th><th class="bw"></th></tr></thead><tbody>${top.map((c, i) => `<tr><td class="m">${i + 1}</td><td><b>${esc(c.name || c.phone)}</b></td><td>${c.visits || 0}</td><td>${money(c.spent)}</td><td><div class="pv-bar"><i style="width:${c.spent / mx * 100}%"></i></div></td></tr>`).join('')}</tbody></table>` : empty('No paying clients yet'), 1);
  }
  // ---- 7 funnel
  function c7({ live, conv, past }) {
    const n = live.now || {}, chats = Math.max(conv.length, n.conversations || 0), booked = n.ai_count ?? conv.filter(c => c.outcome === 'booked').length, asked = Math.max(booked, conv.filter(c => c.messages > 2).length), offered = Math.max(booked, Math.round((asked + booked) / 2));
    const st = [['Chats', chats], ['Engaged', asked], ['Offered a slot', offered], ['Booked', booked]], mx = Math.max(1, chats);
    return card(7, 'From chat to booking', 'What the front desk turned into visits', `<div class="pv-fun">${st.map(([l, v], i) => `<div style="width:${Math.max(28, v / mx * 100)}%;background:${i < 2 ? `color-mix(in srgb,${S} ${25 + i * 15}%,transparent)` : a(L, i === 3 ? 1 : .55)}" class="${i === 3 ? 'on' : ''}"><span>${l}</span><b>${v}</b></div>`).join('')}</div>`);
  }
  // ---- 8 KPI strip + sparklines
  function c8({ past, live }) {
    const now = new Date(new Date().toDateString()), days = Array.from({ length: 14 }, (_, i) => sumIn(past, new Date(+now - (13 - i) * 864e5), new Date(+now - (12 - i) * 864e5)));
    const sp = arr => { const mx = Math.max(1, ...arr); return `<svg viewBox="0 0 120 34" class="pv-sp"><polyline points="${arr.map((v, i) => `${i / (arr.length - 1) * 120},${32 - v / mx * 28}`).join(' ')}" fill="none" stroke="${L}" stroke-width="2.4" stroke-linejoin="round"/></svg>`; };
    const n = live.now || {};
    const k = [['Visits today', n.visits_today ?? days[13].length, days.map(d => d.length)], ['Revenue today', money(n.revenue_today ?? rev(days[13])), days.map(rev)], ['Replies today', n.replies_today || 0, days.map(d => d.length)], ['Waiting for you', n.waiting || 0, null]];
    return card(8, 'Today at a glance', 'Big number, 14-day trend', `<div class="pv-kpi">${k.map(([l, v, s]) => `<div><span>${l}</span><b>${v}</b>${s ? sp(s) : '<svg class="pv-sp"></svg>'}</div>`).join('')}</div>`, 1);
  }
  // ---- 9 stacked new vs returning
  function c9({ past }) {
    const seen = {}, wk = {}, now = Date.now();
    [...past].sort((x, y) => new Date(x.start) - new Date(y.start)).forEach(b => { const k = b.phone || b.customer, w = Math.floor((now - new Date(b.start)) / (7 * 864e5)); if (w < 8) { wk[w] = wk[w] || [0, 0]; wk[w][seen[k] ? 1 : 0]++; } seen[k] = 1; });
    const ws = Array.from({ length: 8 }, (_, i) => wk[7 - i] || [0, 0]), mx = Math.max(1, ...ws.map(w => w[0] + w[1]));
    return card(9, 'New vs returning', 'Visits per week, last 8 weeks', `<div class="pv-stack">${ws.map((w, i) => `<div title="${w[1]} returning · ${w[0]} new"><i style="height:${w[1] / mx * 100}%;background:${L}"></i><i style="height:${w[0] / mx * 100}%;background:#7d848b"></i><span>${i === 7 ? 'now' : '-' + (7 - i) + 'w'}</span></div>`).join('')}</div><div class="pv-leg"><span><i style="background:${L}"></i>Returning</span><span><i style="background:#7d848b"></i>New</span></div>`);
  }
  // ---- 10 timeline by service today
  function c10({ all }) {
    const d = new Date(), t = sumIn(all, new Date(d.toDateString()), new Date(+new Date(d.toDateString()) + 864e5));
    const H0 = 8, H1 = 21, x = s => { const q = new Date(s); return Math.max(0, Math.min(100, (q.getHours() + q.getMinutes() / 60 - H0) / (H1 - H0) * 100)); };
    const rows = [...new Set(t.map(b => b.service))].slice(0, 6), nowX = x(d);
    return card(10, 'Today, lane by lane', 'Each service as a lane, the line is now', rows.length ? `<div class="pv-gantt">${rows.map(r => `<div class="r"><span>${esc(r)}</span><div>${t.filter(b => b.service === r).map(b => `<i style="left:${x(b.start)}%;width:${Math.max(2, x(b.end) - x(b.start))}%" title="${esc(b.customer || '')} ${esc(String(b.start).slice(11, 16))}">${esc((b.customer || '').split(' ')[0])}</i>`).join('')}</div></div>`).join('')}
      <div class="r ax"><span></span><div>${nowX > 0 && nowX < 100 ? `<em style="left:${nowX}%"></em>` : ''}${[8, 11, 14, 17, 20].map(h => `<small style="left:${(h - H0) / (H1 - H0) * 100}%">${h}h</small>`).join('')}</div></div></div>` : empty('Nothing booked today'), 1);
  }
  // ---- 11 big number + barcode
  function c11({ past }) {
    const now = new Date(new Date().toDateString()), d = Array.from({ length: 90 }, (_, i) => rev(sumIn(past, new Date(+now - (89 - i) * 864e5), new Date(+now - (88 - i) * 864e5)))), mx = Math.max(1, ...d);
    return card(11, 'Last 90 days', 'Each bar is one day. Lime = this week', `<div class="pv-big">${money(d.reduce((a, b) => a + b, 0))}</div><div class="pv-code">${d.map((v, i) => `<i title="${money(v)}" style="height:${Math.max(4, v / mx * 100)}%;${i > 82 ? `background:${L}` : ''}"></i>`).join('')}</div>`, 1);
  }
  // ---- 12 status table
  function c12({ conv }) {
    const st = c => c.needs_attention ? ['Needs you', 'warn'] : c.outcome === 'booked' ? ['Booked', 'on'] : c.ai_paused ? ['You took over', ''] : ['AI replied', ''];
    return card(12, 'Latest conversations', 'Who, what, and where it stands', conv.length ? `<table class="pv-t"><thead><tr><th>Client</th><th>Last message</th><th>State</th><th>When</th></tr></thead><tbody>${conv.slice(0, 7).map(c => { const [l, k] = st(c); return `<tr><td><b>${esc(c.name || c.phone)}</b></td><td class="ell">${esc(c.topic || c.last || '')}</td><td><span class="pv-chip ${k}">${l}</span></td><td class="m">${esc(String(c.at || '').slice(5, 16).replace('T', ' '))}</td></tr>`; }).join('')}</tbody></table>` : empty('No conversations yet'), 1);
  }
  // ---- 13 bullet goals
  function c13({ past }) {
    const d = new Date(), m0 = new Date(d.getFullYear(), d.getMonth(), 1), p0 = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const cur = sumIn(past, m0, new Date(8.64e15)), prev = sumIn(past, p0, m0);
    const g = [['Revenue', rev(cur), Math.max(1, Math.round(rev(prev) * 1.1)), 1], ['Bookings', cur.length, Math.max(1, Math.round(prev.length * 1.1))], ['Clients', new Set(cur.map(b => b.phone)).size, Math.max(1, Math.round(new Set(prev.map(b => b.phone)).size * 1.1))]];
    return card(13, 'This month vs goal', 'Goal = last month + 10%', `<div class="pv-bul">${g.map(([l, v, t, m]) => `<div><div class="h"><span>${l}</span><b>${m ? money(v) : v} <small>/ ${m ? money(t) : t}</small></b></div><div class="pv-bar lg"><i style="width:${Math.min(100, v / t * 100)}%"></i></div></div>`).join('')}</div>`);
  }
  // ---- 14 cohort retention
  function c14({ past }) {
    const first = {}, visits = {};
    [...past].sort((x, y) => new Date(x.start) - new Date(y.start)).forEach(b => { const k = b.phone || b.customer, m = b.start.slice(0, 7); if (!first[k]) first[k] = m; (visits[k] = visits[k] || new Set()).add(m); });
    const mAdd = (m, n) => { const d = new Date(m + '-01T00:00'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); }, cur = new Date().toISOString().slice(0, 7);
    const cohorts = [...new Set(Object.values(first))].sort().slice(-4);
    if (!cohorts.length) return card(14, 'Who came back', 'Retention by first-visit month', empty('Not enough history yet'));
    const cell = (c, n) => { if (mAdd(c, n) > cur) return '<td class="z">—</td>'; const ks = Object.keys(first).filter(k => first[k] === c), p = Math.round(ks.filter(k => visits[k].has(mAdd(c, n))).length / ks.length * 100); return `<td style="background:${a(L, .08 + p / 100 * .92)}${p > 55 ? ';color:#111' : ''}">${p}%</td>`; };
    return card(14, 'Who came back', 'Share of each month’s new clients who returned', `<table class="pv-t pv-piv"><thead><tr><th>First visit</th><th>Size</th><th>+1 mo</th><th>+2 mo</th><th>+3 mo</th></tr></thead><tbody>${cohorts.map(c => `<tr><td>${new Date(c + '-01T00:00').toLocaleString(undefined, { month: 'short', year: '2-digit' })}</td><td>${Object.values(first).filter(x => x === c).length}</td>${[1, 2, 3].map(n => cell(c, n)).join('')}</tr>`).join('')}</tbody></table>`);
  }
  // ---- 15 activity rings
  function c15({ live, all, conv }) {
    const n = live.now || {}, d30 = all.filter(b => new Date(b.start) > Date.now() - 30 * 864e5), noshow = d30.filter(b => b.status === 'no_show').length;
    const ring = (p, label, val, col = L) => { const C = 2 * Math.PI * 38; return `<div><svg viewBox="0 0 96 96"><circle cx="48" cy="48" r="38" fill="none" stroke="var(--pv-track)" stroke-width="10"/><circle cx="48" cy="48" r="38" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C * Math.min(100, p) / 100} ${C}" transform="rotate(-90 48 48)"/><text x="48" y="55" text-anchor="middle">${val}</text></svg><span>${label}</span></div>`; };
    const sec = n.avg_ms ? n.avg_ms / 1000 : 0, booked = conv.length ? Math.round(conv.filter(c => c.outcome === 'booked').length / conv.length * 100) : 0, ns = d30.length ? Math.round(noshow / d30.length * 100) : 0;
    return card(15, 'Front-desk health', 'Reply speed, booking rate, no-shows (30 days)', `<div class="pv-rings">${ring(sec ? Math.max(5, 100 - sec * 5) : 0, 'Reply speed', sec ? sec.toFixed(1) + 's' : '—')}${ring(booked, 'Chats booked', booked + '%')}${ring(ns, 'No-shows', ns + '%', S)}</div>`);
  }
  // ---- 16 living front desk
  function c16({ conv, all }) {
    const ev = [...conv.slice(0, 5).map(c => ({ t: c.updated_at || c.at, x: c.outcome === 'booked' ? `Booked ${c.name || 'a client'}` : c.needs_attention ? `${c.name || 'A client'} needs you` : `Replied to ${c.name || 'a client'}` })),
      ...all.filter(b => new Date(b.start) > Date.now()).slice(0, 2).map(b => ({ t: null, x: `Next: ${b.customer || 'client'} · ${b.service} at ${String(b.start).slice(11, 16)}` }))];
    const ago = t => { if (!t) return 'soon'; const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; };
    return card(16, 'The front desk, live', 'Your AI receptionist, working right now', `<svg viewBox="0 0 600 70" preserveAspectRatio="none" class="pv-beat"><polyline points="0,35 120,35 140,35 155,8 170,62 185,35 320,35 340,35 352,14 366,56 380,35 600,35" fill="none" stroke="${L}" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>
      <ul class="pv-feed">${ev.length ? ev.map(e => `<li><span>${ago(e.t)}</span>${esc(e.x)}</li>`).join('') : '<li><span>now</span>Waiting for the first message</li>'}</ul>`, 1);
  }

  const F = { 1: c1, 2: c2, 3: c3, 4: c4, 5: c5, 6: c6, 7: c7, 8: c8, 9: c9, 10: c10, 11: c11, 12: c12, 13: c13, 14: c14, 15: c15, 16: c16 };
  const PAGES = { today: [16, 8, 7, 15], inbox: [12, 4], calendar: [3, 10], insights: [1, 11, 2, 5, 13], customers: [6, 9, 14] };
  // layer 1: a living ground behind everything (slow orbs, grid, scan line) — built once
  function ambient() {
    if ($('.pv-amb')) return;
    const a = document.createElement('div'); a.className = 'pv-amb'; a.setAttribute('aria-hidden', 'true');
    a.innerHTML = '<i class="o1"></i><i class="o2"></i><i class="o3"></i><b class="grid"></b><b class="scan"></b>';
    document.body.prepend(a);
    addEventListener('pointermove', e => { document.documentElement.style.setProperty('--mx', (e.clientX / innerWidth - .5).toFixed(3)); document.documentElement.style.setProperty('--my', (e.clientY / innerHeight - .5).toFixed(3)); }, { passive: true });
  }
  // numbers count up when a card arrives
  function countUp(root) {
    root.querySelectorAll('.pv-big, .pv-kpi b').forEach(el => {
      const m = el.firstChild?.nodeType === 3 ? el.firstChild : null, t = m?.textContent || '', n = parseFloat(t.replace(/[^0-9.]/g, ''));
      if (!m || !n || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const pre = t.match(/^[^0-9]*/)[0], suf = t.match(/[^0-9.,]*$/)[0], t0 = performance.now();
      const step = now => { const k = Math.min(1, (now - t0) / 900), v = n * (1 - Math.pow(1 - k, 3)); m.textContent = pre + Math.round(v).toLocaleString() + suf; if (k < 1) requestAnimationFrame(step); else m.textContent = t; };
      requestAnimationFrame(step);
    });
  }
  window.PVBoard = async (id, after) => {
    ambient();
    if (!PAGES[id] || !after) return;
    document.body.dataset.pv = id;
    // Today: the hero leaves the left column and spans the whole screen (layer 2); the board rises over its lower edge (layer 3)
    if (id === 'today' && after.classList.contains('td-hero')) { const sec = after.closest('section'); sec.prepend(after); after.classList.add('pv-stage'); }
    const sec = after.parentElement; sec.querySelectorAll('.pv-board').forEach(x => x.remove());
    const box = document.createElement('div'); box.className = 'pv-board'; after.after(box);
    const d = await data();
    box.innerHTML = PAGES[id].map(n => { try { return F[n](d); } catch (e) { console.warn('chart', n, e); return ''; } }).join('');
    box.querySelectorAll('.pv-c').forEach((c, i) => c.style.setProperty('--i', i));
    countUp(box);
  };
})();
