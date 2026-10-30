// Studio: build your own views from the widget library. Every widget = a data source + a design + a size.
// Widgets can live on the Studio board or on any page (Today, Inbox, Calendar, Customers, Insights, Marketing).
// Saved per user and business through /api/studio.
(() => {
  const $ = (s, r = document) => r.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const DAY = 864e5, day0 = () => new Date(new Date().toDateString());
  const sum = l => l.reduce((a, b) => a + (+b.price || 0), 0);
  const inRange = (l, a, b) => l.filter(x => { const t = new Date(x.start); return t >= a && t < b; });
  const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // ---------- data sources from the live dashboard data ----------
  function sources(d) {
    const { past, raw, conv, cust, stats, live, mk } = d, t0 = day0();
    const daily = (n, f, off = 0) => Array.from({ length: n }, (_, i) => f(inRange(past, new Date(+t0 - (n - 1 - i + off) * DAY), new Date(+t0 - (n - 2 - i + off) * DAY))));
    const rev = daily(30, sum), revPrev = daily(30, sum, 30), bk = daily(30, l => l.length), bkPrev = daily(30, l => l.length, 30);
    const by = (l, k, v = () => 1) => { const o = {}; l.forEach(x => { const kk = k(x); if (kk != null) o[kk] = (o[kk] || 0) + v(x); }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
    const p90 = past.filter(b => new Date(b.start) > Date.now() - 90 * DAY);
    const svc = by(p90, b => b.service, b => +b.price || 0);
    const wk = [1, 2, 3, 4, 5, 6, 0].map(i => [DN[i], p90.filter(b => new Date(b.start).getDay() === i).length]);
    const hrs = Array.from({ length: 24 }, (_, h) => [h + ':00', past.filter(b => new Date(b.start).getHours() === h).length]);
    const slots = [9, 11, 13, 15, 17, 19], mat = [1, 2, 3, 4, 5, 6, 0].map(dw => slots.map(s => p90.filter(b => { const t = new Date(b.start); return t.getDay() === dw && t.getHours() >= s && t.getHours() < s + 2; }).length));
    const o = stats.outcomes || {}, marked = (o.completed || 0) + (o.no_show || 0);
    const todayL = inRange(raw.filter(b => b.status !== 'cancelled'), t0, new Date(+t0 + DAY)), mins = todayL.reduce((a, b) => a + (new Date(b.end) - new Date(b.start)) / 6e4, 0);
    const hours = window.biz?.hours?.[new Date().getDay()] || [['09:00', '20:00']], open = Math.max(60, (parseInt(hours[hours.length - 1]?.[1] || '20') - parseInt(hours[0]?.[0] || '9')) * 60);
    const weeks = Array.from({ length: 12 }, (_, i) => sum(inRange(past, new Date(+t0 - (12 - i) * 7 * DAY), new Date(+t0 - (11 - i) * 7 * DAY))));
    const n = weeks.length, xm = (n - 1) / 2, ym = weeks.reduce((a, b) => a + b, 0) / n, slope = weeks.reduce((a, y, x) => a + (x - xm) * (y - ym), 0) / Math.max(1, weeks.reduce((a, _, x) => a + (x - xm) ** 2, 0));
    const fc = Array.from({ length: 4 }, (_, i) => Math.max(0, ym + slope * (n + i - xm)));
    const f = live.flow || [], chName = c => ({ test: 'Test chat', whatsapp: 'WhatsApp', telegram: 'Telegram', webook: 'WeBook' })[c] || c;
    const top = [...cust].filter(c => c.spent).sort((a, b) => b.spent - a.spent).slice(0, 8).map(c => [c.name || c.phone, c.spent]);
    const fun = mk.funnel || {};
    return {
      revenue: { n: 'Revenue', unit: '$', series: { s: rev, cmp: revPrev, unit: '$' }, value: { v: rev.reduce((a, b) => a + b, 0), prev: revPrev.reduce((a, b) => a + b, 0), unit: '$', target: (p => p > 0 ? p * 1.1 : Math.max(1, rev.reduce((a, b) => a + b, 0) * 1.25))(revPrev.reduce((a, b) => a + b, 0)) } },
      bookings: { n: 'Bookings', unit: '', series: { s: bk, cmp: bkPrev }, value: { v: bk.reduce((a, b) => a + b, 0), prev: bkPrev.reduce((a, b) => a + b, 0), target: (p => p > 0 ? Math.round(p * 1.1) : Math.max(1, Math.round(bk.reduce((a, b) => a + b, 0) * 1.25)))(bkPrev.reduce((a, b) => a + b, 0)) } },
      chats: { n: 'Conversations', unit: '', series: { s: (live.d14 || []).map(x => +x.n || 0) }, value: { v: stats.conv || conv.length, label: 'conversations' } },
      answered: { n: 'Answered by MXAi', unit: '%', value: { v: stats.conv ? (stats.answered || 0) / stats.conv * 100 : 0, unit: '%', target: 100, label: 'answered alone' } },
      utilisation: { n: 'Chair time today', unit: '%', value: { v: Math.min(100, mins / open * 100), unit: '%', target: 100, label: 'booked today' } },
      noshow: { n: 'No-show rate', unit: '%', value: { v: marked ? (o.no_show || 0) / marked * 100 : 0, unit: '%', target: 20, down: true, label: 'no-shows' } },
      services: { n: 'Revenue by service', unit: '$', cats: { c: svc.length ? svc : [['No bookings yet', 0]], unit: '$' } },
      weekdays: { n: 'Bookings by weekday', unit: '', cats: { c: wk } },
      hours: { n: 'Bookings by hour', unit: '', cats: { c: hrs }, matrix: { m: mat, rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], cols: slots.map(s => s + 'h') } },
      channels: { n: 'Chats by channel', unit: '', cats: { c: (stats.channels || []).map(x => [chName(x.channel), x.n]) } },
      outcomes: { n: 'How chats end', unit: '', flow: { f: f.map(x => [chName(x.channel), (x.outcome || 'open').replace(/_/g, ' '), x.n]) }, cats: { c: by(f, x => (x.outcome || 'open').replace(/_/g, ' '), x => x.n) } },
      clients: { n: 'Top clients', unit: '$', cats: { c: top.length ? top : [['No paying clients yet', 0]], unit: '$' } },
      funnel: { n: 'Chat to booking funnel', unit: '', cats: { c: [['Chats', fun.chats || stats.conv || 0], ['Engaged', fun.talked || 0], ['Booked', fun.booked || 0], ['Came back', fun.returned || 0]] } },
      forecast: { n: 'Revenue forecast', unit: '$', series: { s: weeks, fc, unit: '$' } },
      activity: { n: 'Daily bookings, 12 weeks', unit: '', series: { s: daily(84, l => l.length) } },
    };
  }
  const SHAPES = ['value', 'series', 'cats', 'matrix', 'flow'];
  const ONLY = { clock: ['hours'], weekstrip: ['weekdays'], pyramid: ['funnel'], slope: ['services', 'channels'], sankey: ['outcomes'] }; // designs that only make sense for some data
  const fits = src => window.WL.list().filter(w => src[w.shape] && (!ONLY[w.key] || ONLY[w.key].includes(src.k)));
  const SIZES = { s1: 'Small', s2: 'Wide', s3: 'Large', s4: 'Full width' };
  const PAGES = [['studio', 'Studio board'], ['today', 'Today'], ['inbox', 'Inbox'], ['calendar', 'Calendar'], ['customers', 'Customers'], ['insights', 'Insights'], ['marketing', 'Marketing']];
  const DEFAULT = { studio: [['revenue', 'hero', 's1'], ['answered', 'gauge', 's1'], ['utilisation', 'dotscore', 's1'], ['noshow', 'segments', 's1'], ['revenue', 'area', 's3'], ['services', 'donut', 's3'], ['weekdays', 'weekstrip', 's2'], ['hours', 'dotmatrix', 's2'], ['outcomes', 'sankey', 's2'], ['clients', 'ranked', 's2'], ['forecast', 'forecast', 's3'], ['activity', 'calendar', 's3']] };

  let boards = null, D = null, S = null, saveT = 0, uid = 0;
  async function load() {
    if (!boards) { const r = await fetch('/api/studio').then(x => x.ok ? x.json() : null).catch(() => null); boards = r?.boards || JSON.parse(JSON.stringify(DEFAULT)); }
    D = await window.PVData(); S = sources(D); Object.entries(S).forEach(([k, v]) => v.k = k); return S;
  }
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fetch('/api/studio', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ boards }) }).catch(() => {}), 400); };
  function card([src, view, size], i, page) {
    const s = S[src], w = window.WL.L[view]; if (!s || !w || !s[w.shape]) return '';
    let body = ''; try { body = w.render({ ...s[w.shape], id: 'w' + (++uid) }); } catch (e) { body = '<p class="wl-note">This view could not be drawn.</p>'; }
    return `<div class="st-w ${size}" style="--i:${i}"><header><div><b>${esc(s.n)}</b><small>${esc(w.name)}</small></div><div class="st-ctl"><button type="button" data-ed="${page}|${i}" aria-label="Edit widget">✎</button><button type="button" data-rm="${page}|${i}" aria-label="Remove widget">✕</button></div></header><div class="st-body">${body}</div></div>`;
  }
  function grid(page) { const l = boards[page] || []; return `<div class="st-grid" data-page="${page}">${l.map((w, i) => card(w, i, page)).join('')}<button type="button" class="st-add" data-add="${page}"><b>＋</b>Add widget</button></div>`; }

  // ---------- Studio board ----------
  async function mountBoard(sec) {
    const root = sec.querySelector('#stRoot'); root.innerHTML = '<p class="wl-note">Loading your widgets…</p>'; await load();
    root.innerHTML = `<div class="st-head"><p>Your own board. Pick any data, show it in any of ${window.WL.list().length} designs, and place it here or on any page.</p><div><button type="button" class="btn ghost" data-lib>Browse the library</button><button type="button" class="btn ghost" data-reset>Reset board</button><button type="button" class="btn" data-add="studio">＋ Add widget</button></div></div>${grid('studio')}`;
  }
  // ---------- Library ----------
  async function mountLib(sec) {
    const root = sec.querySelector('#stRoot'); root.innerHTML = '<p class="wl-note">Loading the library…</p>'; await load();
    const groups = {}; window.WL.list().forEach(w => (groups[w.group] = groups[w.group] || []).push(w));
    const sample = (w, i = 0) => { const ok = Object.entries(S).filter(([, s]) => fits(s).includes(w) && (w.shape !== 'cats' || s.cats.c.length > 2)); return ok[i % (ok.length || 1)] || Object.entries(S).find(([, s]) => fits(s).includes(w)); };
    const nSrc = Object.keys(S).length;
    root.innerHTML = `<div class="st-head lib"><div><b>${window.WL.list().length}</b><span>designs</span></div><div><b>${nSrc}</b><span>live data sources</span></div><div><b>${Object.keys(groups).length}</b><span>families</span></div><p>Every design is drawn from your own numbers. Pick one, choose the data and the size, place it on any page.</p></div>`
      + `<div class="st-jump" role="navigation" aria-label="Design families">${Object.entries(groups).map(([g, ws]) => `<a href="#stg-${esc(g)}">${esc(g)} <small>${ws.length}</small></a>`).join('')}</div>` + Object.entries(groups).map(([g, ws]) => `<h3 class="st-g" id="stg-${esc(g)}">${esc(g)} <small>${ws.length}</small></h3><div class="st-grid lib">${ws.map((w, i) => { const sm = sample(w, i); if (!sm) return ''; let body = ''; try { body = w.render({ ...sm[1][w.shape], id: 'l' + (++uid) }); } catch { }
      return `<div class="st-w s1 lib" style="--i:${i}"><header><div><b>${esc(w.name)}</b><small>${esc(sm[1].n)}</small></div></header><div class="st-body">${body}</div><button type="button" class="st-use" data-use="${w.key}" data-src="${sm[0]}">Use this design</button></div>`; }).join('')}</div>`).join('');
  }
  // ---------- widgets on any page ----------
  // the built-in chart each number stands for, so "edit" opens the closest Studio widget
  const BUILTIN = { 1: ['revenue', 'area'], 2: ['services', 'table'], 3: ['utilisation', 'gauge'], 4: ['hours', 'dotmatrix'], 5: ['services', 'donut'], 6: ['clients', 'ranked'], 7: ['funnel', 'pyramid'], 8: ['revenue', 'compare'], 9: ['bookings', 'ghost'], 10: ['weekdays', 'weekstrip'], 11: ['revenue', 'barcode'], 12: ['outcomes', 'table'], 13: ['revenue', 'capsule'], 14: ['clients', 'table'], 15: ['answered', 'ring'], 16: ['chats', 'line'], 17: ['outcomes', 'proportion'], 18: ['outcomes', 'treemap'], 19: ['answered', 'dotscore'], 20: ['services', 'sparktable'], 21: ['hours', 'clock'], 22: ['channels', 'capsules'], 23: ['clients', 'bubbles'], 24: ['clients', 'ranked'], 25: ['outcomes', 'sankey'], 26: ['chats', 'barcode'], 27: ['outcomes', 'table'], 28: ['outcomes', 'capsules'], 29: ['chats', 'lollipop'], 30: ['hours', 'clock'], 31: ['weekdays', 'weekstrip'], 32: ['bookings', 'hero'], 33: ['funnel', 'pyramid'], 34: ['revenue', 'hatched'], 35: ['outcomes', 'table'], 36: ['services', 'table'], 37: ['clients', 'capsules'], 38: ['outcomes', 'kpigrid'], 39: ['answered', 'gauge'], 40: ['answered', 'ring'], 41: ['services', 'capsules'], 42: ['weekdays', 'weekstrip'], 43: ['channels', 'capsules'], 44: ['noshow', 'segments'], 45: ['forecast', 'forecast'] };
  const keyOf = (id, sub) => sub ? `${id}/${sub}` : id;
  const hiddenOf = k => boards['_hide/' + k] || [];
  let lastPage = null;
  async function page(id, after, sub = '') {
    if (!after || id === 'studio') return; await load();
    const k = keyOf(id, sub); lastPage = { id, sub, k };
    const sec = after.parentElement; sec.querySelectorAll(':scope > .st-mine').forEach(x => x.remove());
    const box = document.createElement('div'); box.className = 'st-mine'; box.dataset.key = k;
    const mine = boards[k] || [], hid = hiddenOf(k);
    box.innerHTML = `<div class="st-bar"><span><b>My view</b>${mine.length ? ` · ${mine.length} widget${mine.length === 1 ? '' : 's'}` : ''}${hid.length ? ` · ${hid.length} hidden` : ''}</span>
      <span class="st-acts"><button type="button" data-custom>${document.body.classList.contains('st-custom') ? 'Done' : 'Customise this page'}</button>${hid.length ? `<button type="button" data-restore="${esc(k)}">Show hidden charts</button>` : ''}${mine.length || hid.length ? `<button type="button" data-clear="${esc(k)}">Reset page</button>` : ''}<button type="button" class="pri" data-add="${esc(k)}">＋ Add widget</button></span></div>${mine.length ? grid(k) : ''}`;
    after.after(box);
  }
  // edit and hide controls on the built-in charts of a page; hidden ones stay hidden
  function decorate(board, id, sub = '') {
    if (!board || !boards) return; const k = keyOf(id, sub), hid = hiddenOf(k);
    board.querySelectorAll(':scope > .pv-c').forEach(c => {
      const n = +c.dataset.n; c.hidden = hid.includes(n);
      if (!c.querySelector('.st-ctl')) c.insertAdjacentHTML('beforeend', `<div class="st-ctl pv"><button type="button" data-bed="${esc(k)}|${n}" aria-label="Change this chart" title="Change design or data">✎</button><button type="button" data-bhide="${esc(k)}|${n}" aria-label="Hide this chart" title="Hide">✕</button></div>`);
    });
  }
  function redraw() { const P = window.P10; if (P) P.go(P.current(), P.sub?.() || 0); }
  function refresh() { if (document.querySelector('.st-grid[data-page="studio"]') && !document.querySelector('.st-mine')) { const g = document.querySelector('.st-grid[data-page="studio"]'); g.outerHTML = grid('studio'); return; } redraw(); }

  // ---------- builder drawer ----------
  let draft = null, target = 'studio', editI = null;
  function drawer() {
    let d = $('#stDr'); if (d) return d;
    d = document.createElement('div'); d.id = 'stDr'; d.className = 'st-dr'; d.innerHTML = `<div class="st-sh" data-x></div><div class="st-pn" role="dialog" aria-label="Widget builder"><header><h2 id="stT">Add a widget</h2><button type="button" data-x aria-label="Close">✕</button></header>
      <section><h4>1 · Data</h4><div class="st-opts" id="stSrc"></div></section><section><h4>2 · Design</h4><div class="st-views" id="stViews"></div></section>
      <section><h4>3 · Size and place</h4><div class="st-opts" id="stSize"></div><div class="st-opts" id="stPage" style="margin-top:8px"></div></section>
      <section><h4>Preview</h4><div class="st-prev" id="stPrev"></div></section><footer><button type="button" class="btn ghost" data-x>Cancel</button><button type="button" class="btn" id="stSave">Add widget</button></footer></div>`;
    document.body.append(d); return d;
  }
  let replaceN = null;
  async function open(pageId, i = null, preset = null, replace = null) {
    await load(); target = pageId || 'studio'; editI = i; replaceN = replace;
    draft = i != null ? [...boards[target][i]] : preset || ['revenue', 'area', 's2'];
    const d = drawer(); d.classList.add('on'); $('#stT').textContent = replace != null ? 'Change this chart' : i != null ? 'Edit widget' : 'Add a widget'; $('#stSave').textContent = i != null || replace != null ? 'Save' : 'Add widget'; paint();
  }
  function paint() {
    const [src, view, size] = draft, s = S[src], ok = fits(s); if (!ok.find(w => w.key === view)) draft[1] = ok[0].key;
    $('#stSrc').innerHTML = Object.entries(S).map(([k, x]) => `<button type="button" data-s="${k}" class="${k === src ? 'on' : ''}"><b>${esc(x.n)}</b><small>${fits(x).length} designs</small></button>`).join('');
    $('#stViews').innerHTML = fits(s).map(w => { let b = ''; try { b = w.render({ ...s[w.shape], id: 'p' + (++uid) }); } catch { } return `<button type="button" data-v="${w.key}" class="${w.key === draft[1] ? 'on' : ''}"><span>${esc(w.name)}</span><div class="st-th">${b}</div></button>`; }).join('');
    $('#stSize').innerHTML = Object.entries(SIZES).map(([k, n]) => `<button type="button" data-z="${k}" class="${k === draft[2] ? 'on' : ''}"><b>${n}</b></button>`).join('');
    const here = target.includes('/') || (target !== 'studio' && !PAGES.find(p => p[0] === target)) ? [[target, 'This page', target.replace('/', ' › ')]] : [];
    $('#stPage').innerHTML = editI != null || replaceN != null ? '' : [...here, ...PAGES.filter(([k]) => k !== target).map(([k, n]) => [k, n, 'place here'])].map(([k, n, sm]) => `<button type="button" data-p="${esc(k)}" class="${k === target ? 'on' : ''}"><b>${esc(n)}</b><small>${esc(sm)}</small></button>`).join('');
    const w = window.WL.L[draft[1]]; let b = ''; try { b = w.render({ ...s[w.shape], id: 'v' + (++uid) }); } catch { }
    $('#stPrev').className = 'st-prev ' + draft[2]; $('#stPrev').innerHTML = `<header><b>${esc(s.n)}</b><small>${esc(w.name)}</small></header><div class="st-body">${b}</div>`;
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-add],[data-ed],[data-rm],[data-x],[data-s],[data-v],[data-z],[data-p],#stSave,[data-use],[data-lib],[data-reset],[data-bed],[data-bhide],[data-custom],[data-restore],[data-clear]'); if (!t) return;
    if (t.dataset.bed) { const [k, n] = t.dataset.bed.split('|'); const m = BUILTIN[n] || ['revenue', 'area']; return open(k, null, [m[0], m[1], 's2'], +n); }
    if (t.dataset.bhide) { const [k, n] = t.dataset.bhide.split('|'); const h = boards['_hide/' + k] = hiddenOf(k); if (!h.includes(+n)) h.push(+n); save(); window.toast?.('Chart hidden on this page. Use "Show hidden charts" to bring it back.'); return redraw(); }
    if (t.dataset.custom != null) { document.body.classList.toggle('st-custom'); return redraw(); }
    if (t.dataset.restore) { delete boards['_hide/' + t.dataset.restore]; save(); return redraw(); }
    if (t.dataset.clear) { delete boards[t.dataset.clear]; delete boards['_hide/' + t.dataset.clear]; save(); window.toast?.('Page reset to the original view.'); return redraw(); }
    if (t.dataset.add) return open(t.dataset.add);
    if (t.dataset.ed) { const [p, i] = t.dataset.ed.split('|'); return open(p, +i); }
    if (t.dataset.rm) { const [p, i] = t.dataset.rm.split('|'); boards[p].splice(+i, 1); save(); return refresh(); }
    if (t.dataset.x != null) return drawer().classList.remove('on');
    if (t.dataset.s) { draft[0] = t.dataset.s; return paint(); } if (t.dataset.v) { draft[1] = t.dataset.v; return paint(); }
    if (t.dataset.z) { draft[2] = t.dataset.z; return paint(); } if (t.dataset.p) { target = t.dataset.p; return paint(); }
    if (t.dataset.use) return open('studio', null, [t.dataset.src, t.dataset.use, 's2']);
    if (t.dataset.lib != null) return window.P10?.go('studio', 1);
    if (t.dataset.reset != null) { boards.studio = JSON.parse(JSON.stringify(DEFAULT.studio)); save(); return refresh(); }
    if (t.id === 'stSave') { const l = boards[target] = boards[target] || []; if (editI != null) l[editI] = draft; else if (replaceN != null) { l.unshift(draft); const h = boards['_hide/' + target] = hiddenOf(target); if (!h.includes(replaceN)) h.push(replaceN); } else l.push(draft); save(); drawer().classList.remove('on');
      window.toast?.(replaceN != null ? 'Chart changed on this page.' : editI != null ? 'Widget updated.' : 'Widget added.');
      const [pid, sub] = target.split('/'), P = window.P10; if (target === 'studio') return refresh();
      if (P?.current() === pid) return redraw();
      const idx = sub ? (P.pages.find(x => x[0] === pid)?.[3] || []).findIndex(x => x[0] === sub) : 0; P?.go(pid, Math.max(0, idx)); }
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') $('#stDr')?.classList.remove('on'); });
  window.MXStudio = { mountBoard, mountLib, page, decorate };
  (window.__stPending || []).splice(0).forEach(f => { try { f(); } catch (e) { console.warn('studio', e); } });
  // Today is drawn once and redrawn by its own live refresh: keep the owner's view and the chart controls on it
  let todayT = 0;
  const keepToday = () => { clearTimeout(todayT); todayT = setTimeout(async () => {
    const sec = document.querySelector('main > section.today'), h = sec?.querySelector(':scope > .td-hero.pv-stage'); if (!h) return;
    if (!sec.querySelector(':scope > .st-mine')) await page('today', h, '');
    decorate(sec.querySelector(':scope > .pv-board'), 'today', ''); }, 250); };
  const watch = () => { const sec = document.querySelector('main > section.today'); if (!sec) return setTimeout(watch, 500); new MutationObserver(keepToday).observe(sec, { childList: true }); keepToday(); };
  watch();
})();
