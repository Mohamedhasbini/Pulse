// Round 4 layout: every page opens with a graphite silk hero (page name, an italic serif line, three live numbers,
// and two stacked "folder" cards), Today adds an hour-by-hour timeline of the day, KPI cards open in place, and the
// top bar's Ask pill opens the Ctrl+K palette. Data: /api/live, /api/calendar, /api/marketing/overview (cached 60 s).
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => { const c = window.biz?.currency || 'USD'; return `${c === 'USD' ? '$' : c + ' '}${Math.round(v || 0).toLocaleString()}`; };
  const day = d => d.toISOString().slice(0, 10), hm = s => String(s).slice(11, 16);
  const cache = {};
  const get = async (url, ttl = 60000) => { const c = cache[url]; if (c && Date.now() - c.t < ttl) return c.v; const v = await req(url).catch(() => null); cache[url] = { t: Date.now(), v }; return v; };

  // ---------- top bar: the Ask pill ----------
  function askPill() {
    const nav = $('nav[aria-label="Main"]'); if (!nav || $('#hxAsk')) return;
    // the top bar is graphite in both modes; set inline so no older theme rule can repaint it
    if (matchMedia('(min-width:1001px)').matches) nav.style.setProperty('background', '#0f1011', 'important');
    const b = document.createElement('button'); b.type = 'button'; b.id = 'hxAsk';
    b.innerHTML = '<i></i><span>Ask Nora or jump to…</span><kbd>Ctrl K</kbd>';
    b.addEventListener('click', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })));
    $('.navfoot', nav)?.before(b);
  }

  // ---------- hero content per page ----------
  const fd = (cls, tab, title, sub, chips = []) => `<div class="hx-fd ${cls}" data-tab="${esc(tab)}"><b>${esc(title)}</b><small>${esc(sub)}</small>${chips.length ? `<div class="hx-row">${chips.map((c, i) => `<span class="${i ? '' : 'k'}">${esc(c)}</span>`).join('')}</div>` : ''}</div>`;
  const stat = (l, v, rev) => `<div><span>${esc(l)}</span><b class="${rev ? 'rev' : ''}">${v}</b></div>`;
  async function content(id) {
    const live = await get('/api/live?days=30'), n = live?.now || {}, up = live?.upcoming || [];
    const today = day(new Date()), todays = up.filter(b => b.start?.startsWith(today)), next = todays.find(b => b.start.slice(11) >= new Date().toTimeString().slice(0, 5)) || up[0];
    const nextCard = next ? fd('a', 'Next up', `${next.name || 'Client'} · ${next.service}`, `${next.start.startsWith(today) ? 'Today' : next.start.slice(5, 10)} ${hm(next.start)} · ${next.minutes} min · ${money(next.price)}`) : fd('a', 'Next up', 'Nothing booked next', 'Your AI keeps the calendar open');
    if (id === 'today') return { folders: nextCard + fd('b', 'Today', "Today's schedule", `${n.visits_today || 0} visits · ${money(n.revenue_today)} today · ${n.upcoming_count || 0} coming up`, [`${n.waiting || 0} waiting`, `${n.replies_today || 0} replies today`]) };
    if (id === 'inbox') return { line: `${n.replies_today || 0} replies today`, stats: stat('Waiting for you', n.waiting || 0) + stat('Active now', n.active_now || 0) + stat('Avg reply', n.avg_ms ? (n.avg_ms / 1000).toFixed(1) + 's' : '—'),
      folders: fd('a', 'Unsure', `${n.unsure || 0} replies to check`, 'Teach the right answer once') + fd('b', 'To learn', `${n.to_learn || 0} questions`, 'Answers the AI did not know', ['Open Train'] ) };
    if (id === 'calendar') return { line: `${money(n.upcoming_value)} coming up`, stats: stat('Upcoming', n.upcoming_count || 0) + stat('Booked value', money(n.upcoming_value), 1) + stat('Approvals', n.approvals || 0),
      folders: nextCard + fd('b', 'Today', `${todays.length} on the calendar today`, todays.slice(0, 3).map(b => hm(b.start)).join(' · ') || 'Free day', [`${n.approvals || 0} to approve`]) };
    if (id === 'marketing' || id === 'customers') {
      const m = await get('/api/marketing/overview?days=30'), k = m?.kpis || {}, s = m?.segments || {};
      if (id === 'marketing') return { line: `${money(k.revenue)} back`, stats: stat('Revenue won', money(k.revenue), 1) + stat('Conversion', k.reached ? k.conversion + '%' : '—') + stat('Agreed to offers', (k.optin_rate || 0) + '%'),
        folders: fd('a', 'Last campaign', m?.campaigns?.[0]?.name || 'No campaign yet', m?.campaigns?.[0] ? `${m.campaigns[0].sent} sent · ${m.campaigns[0].booked} booked` : 'Open the studio to start') + fd('b', 'Audience', `${k.opted_in || 0} of ${k.customers || 0} can get offers`, 'Every booking confirmation asks once', ['Campaign studio']) };
      return { line: 'your business', stats: stat('Clients', (k.customers || 0).toLocaleString()) + stat('Regulars', s.regular?.n || 0) + stat('VIP spend', money(s.vip?.spent), 1),
        folders: fd('a', 'At risk', `${(s.lapsed?.n || 0) + (s.lost?.n || 0)} lapsed clients`, `${money((s.lapsed?.spent || 0) + (s.lost?.spent || 0))} spent with you before`) + fd('b', 'New', `${s.new?.n || 0} new this month`, 'A second visit makes them regulars', ['Win back']) };
    }
    if (id === 'insights') return { line: `${money(n.earned)} earned`, stats: stat('Earned', money(n.earned), 1) + stat('Before', money(n.earned_prev)) + stat('AI bookings', n.ai_count || 0) };
    return {};
  }
  const LINES = { inbox: 'every conversation', calendar: 'your week', marketing: 'what came back', customers: 'your regulars', insights: 'the numbers', pulse: 'your partner', train: 'what Nora knows', lab: 'try it safely', settings: 'set it up once' };

  async function decorate(bar) {
    if (bar.dataset.hx) return; bar.dataset.hx = '1';
    // pulse.js rebuilds the tab row on every visit: drop heroes whose row is gone so a page never shows two
    $$('.hx').forEach(h => { if (!h.querySelector('.p10-bar') || h.querySelector('.p10-bar') !== bar) h.remove(); });
    const id = window.P10?.current?.() || '';
    if (id === 'today') { bar.classList.add('hx-skip'); return today(); }
    const title = (window.P10?.pages || []).find(p => p[0] === id)?.[1] || $('.p10-purpose b', bar)?.textContent.split('›')[0].trim() || '';
    const hero = document.createElement('div'); hero.className = 'hx'; hero.innerHTML = `<div class="hx-in"><div class="hx-greet"><h1>${esc(title)}<em>${esc(LINES[id] || '')}</em></h1><div class="hx-stats"></div></div><div class="hx-folders"></div></div>`;
    bar.before(hero); hero.append(bar);
    const c = await content(id);
    if (c.line) hero.querySelector('em').textContent = c.line;
    hero.querySelector('.hx-stats').innerHTML = c.stats || '';
    hero.querySelector('.hx-folders').innerHTML = c.folders || '';
    await extras(id, hero);
  }

  // ---------- round 5: one idea per tab ----------
  const ring = (p, sz = 84) => { const r = sz / 2 - 8, C = 2 * Math.PI * r; return `<svg class="hx-ring" viewBox="0 0 ${sz} ${sz}" width="${sz}" height="${sz}"><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="var(--h-rim)" stroke-width="6"/><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="var(--rev)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C * p / 100} ${C}" transform="rotate(-90 ${sz / 2} ${sz / 2})"/><text x="50%" y="50%" dy=".35em" text-anchor="middle">${p}%</text></svg>`; };
  async function extras(id, hero) {
    const greet = $('.hx-greet', hero), sec = hero.parentElement;
    $$('.hx-x', sec).forEach(x => x.remove());
    if (id === 'inbox') {
      // Rectio: natural-language search in the hero, wired to the inbox search box
      greet.insertAdjacentHTML('beforeend', `<form class="hx-smart"><input placeholder="Find a chat: a name, a number or words like “bridal” or “refund”" aria-label="Search chats"><button aria-label="Search">↵</button></form>
        <div class="hx-sugg">${['refund', 'price', 'cancel', 'gift'].map(w => `<button type="button" data-w="${w}">${w}</button>`).join('')}</div>`);
      const run = w => { const q = $('#ibQ'); if (!q) return; q.value = w; q.dispatchEvent(new Event('input', { bubbles: true })); q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
      $('.hx-smart', greet).addEventListener('submit', ev => { ev.preventDefault(); run(ev.target.querySelector('input').value.trim()); });
      $('.hx-sugg', greet).addEventListener('click', ev => { const b = ev.target.closest('[data-w]'); if (b) { $('.hx-smart input', greet).value = b.dataset.w; run(b.dataset.w); } });
    }
    if (id === 'insights') {
      // Ledgerix: the one big number, with the Ask bar under it
      const l = await get('/api/live?days=90'), n = l?.now || {};
      greet.insertAdjacentHTML('beforeend', `<div class="hx-ask"><i>✦</i><input placeholder="Ask anything about your numbers…" aria-label="Ask Pulse AI">${['Why did revenue change?', 'Best service to promote', 'Forecast next month'].map(q => `<button type="button" data-q="${q}">${q}</button>`).join('')}</div>`);
      hero.querySelector('.hx-folders').innerHTML = `<div class="hx-bignum"><span>Earned, last 90 days</span><b>${money(n.earned)}</b><small>${n.earned_prev ? `${n.earned >= n.earned_prev ? '+' : ''}${Math.round((n.earned - n.earned_prev) / n.earned_prev * 100)}% vs the 90 days before` : 'first period'}</small></div>`;
      const ask = q => window.PulseCommand?.open ? window.PulseCommand.open(q) : window.P10?.ask?.(q);
      $('.hx-ask', greet).addEventListener('click', ev => { const b = ev.target.closest('[data-q]'); if (b) ask(b.dataset.q); });
      $('.hx-ask input', greet).addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.value.trim()) ask(ev.target.value.trim()); });
    }
    if (id === 'calendar') {
      // Orion chips: Day / Week / Month drive the calendar; Holo: chair time today
      const bar = $('.p10-bar', hero);
      bar?.insertAdjacentHTML('beforeend', `<div class="hx-chips">${['day', 'week', 'month'].map(v => `<button type="button" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>`);
      bar?.querySelector('.hx-chips')?.addEventListener('click', ev => { const b = ev.target.closest('[data-v]'); if (b) $(`.gc-views [data-v="${b.dataset.v}"]`)?.click(); });
      const d = new Date(), cal = await get(`/api/calendar?from=${day(d)}T00:00&to=${day(new Date(d.getTime() + 864e5))}T00:00`, 30000);
      const list = (Array.isArray(cal) ? cal : cal?.bookings || []).filter(b => b.status !== 'cancelled'), mins = list.reduce((a, b) => a + (b.minutes || 60), 0);
      const by = Array.from({ length: 6 }, (_, i) => list.filter(b => { const h = +String(b.start || b.starts_at).slice(11, 13); return h >= 9 + i * 2 && h < 11 + i * 2; }).reduce((a, b) => a + (b.minutes || 60), 0)), mx = Math.max(60, ...by);
      hero.insertAdjacentHTML('afterend', `<div class="hx-x hx-strip"><div class="card hx-chair"><div><span>Chair time today</span><b>${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}<small> h booked</small></b><small>${list.length} appointment${list.length === 1 ? '' : 's'} · ${money(list.reduce((a, b) => a + (+b.price || 0), 0))}</small></div>
        <div class="hx-tbars">${by.map((v, i) => `<div><i class="${v === mx && v ? 'on' : ''}" style="height:${Math.max(6, v / mx * 100)}%"></i><span>${9 + i * 2}h</span></div>`).join('')}</div></div></div>`);
    }
    if (id === 'customers') {
      // Orion match cards: the top three clients with a loyalty ring
      const all = await get('/api/customers'), list = (Array.isArray(all) ? all : all?.rows || []).filter(c => !/^(test|sim-|e2e)/.test(c.phone || '') || c.visits);
      const top = [...list].sort((a, b) => (b.spent || 0) - (a.spent || 0)).slice(0, 3);
      if (!top.length) return;
      const loyal = c => { const days = c.last_booking ? (Date.now() - new Date(c.last_booking)) / 864e5 : 999; return Math.max(5, Math.min(99, Math.round((c.visits || 0) * 11 + (days < 30 ? 30 : days < 60 ? 15 : 0)))); };
      hero.insertAdjacentHTML('afterend', `<div class="hx-x hx-cards">${top.map(c => `<button type="button" class="card hx-cc" data-cust="${c.id}"><div><h4>${esc(c.name || c.phone)}</h4><small>${c.visits || 0} visit${c.visits === 1 ? '' : 's'} · last ${c.last_booking ? esc(String(c.last_booking).slice(0, 10)) : 'never'}</small>
        <div class="hx-pills">${c.marketing_ok ? '<span>Offers on</span>' : ''}${c.upcoming ? `<span>${c.upcoming} upcoming</span>` : ''}${c.no_shows ? `<span>${c.no_shows} no-show</span>` : ''}</div></div>
        <div class="hx-cr">${ring(loyal(c))}<small>loyalty</small></div><div class="hx-cf"><span>Lifetime</span><b>${money(c.spent)}</b></div></button>`).join('')}</div>`);
      $$('.hx-cc', sec).forEach(b => b.addEventListener('click', () => document.querySelector(`#pplRows [data-cust="${b.dataset.cust}"]`)?.click()));
    }
  }

  // ---------- Today: folders + hour-by-hour timeline inside the existing hero ----------
  async function today() {
    const h = $('.td-hero'); if (!h || h.dataset.hx) return; h.dataset.hx = '1';
    const c = await content('today'), d = new Date(), from = day(d), to = day(new Date(d.getTime() + 864e5));
    const cal = await get(`/api/calendar?from=${from}T00:00&to=${to}T00:00`, 30000), list = (Array.isArray(cal) ? cal : cal?.bookings || []).filter(b => b.status !== 'cancelled');
    const hours = window.biz?.hours?.[d.getDay()] || [['09:00', '20:00']], H0 = parseInt(hours[0]?.[0] || '9'), H1 = Math.max(H0 + 4, parseInt(hours[hours.length - 1]?.[1] || '20'));
    const pct = t => Math.max(0, Math.min(100, (t - H0) / (H1 - H0) * 100)), t = s => { const m = String(s).match(/(\d\d):(\d\d)/); return m ? +m[1] + +m[2] / 60 : 0; };
    const now = d.getHours() + d.getMinutes() / 60, booked = list.reduce((a, b) => a + (b.minutes || 60) / 60, 0), full = Math.min(100, Math.round(booked / (H1 - H0) * 100));
    const slots = list.map(b => { const s = t(b.start || b.starts_at), e = s + (b.minutes || 60) / 60; return `<div class="hx-slot" style="left:${pct(s)}%;width:calc(${pct(e) - pct(s)}% - 3px)" title="${esc(hm(b.start || b.starts_at))} ${esc(b.name || '')} · ${esc(b.service || '')}">${esc((b.name || b.service || '').split(' ')[0])}</div>`; }).join('');
    h.insertAdjacentHTML('beforeend', `<div class="hx-folders hx-today">${c.folders}</div>
      <div class="hx-tl"><div class="hx-tl-l">Today<b>${full}% full</b></div><div class="hx-track">${slots || '<span class="hx-empty">No bookings yet today</span>'}${now > H0 && now < H1 ? `<i class="hx-now" style="left:${pct(now)}%"></i>` : ''}
        <div class="hx-hours">${Array.from({ length: Math.floor((H1 - H0) / 2) + 1 }, (_, i) => `<span>${String(H0 + i * 2).padStart(2, '0')}:00</span>`).join('')}</div></div></div>`);
  }

  // ---------- sub-tabs: a glass dropdown under each top-bar tab ----------
  let dd = null, ddFor = null, ddT = 0;
  function dropdown(btn) {
    const id = btn.dataset.p10, page = (window.P10?.pages || []).find(p => p[0] === id), tabs = page?.[3] || [];
    if (tabs.length < 2 || !matchMedia('(min-width:1001px)').matches) return hideDD();
    if (!dd) { dd = document.createElement('div'); dd.id = 'hxDD'; document.body.append(dd);
      dd.addEventListener('mouseenter', () => clearTimeout(ddT)); dd.addEventListener('mouseleave', () => { ddT = setTimeout(hideDD, 180); });
      dd.addEventListener('click', ev => { const t = ev.target.closest('[data-k]'); if (t) { hideDD(); window.P10.go(t.dataset.id, +t.dataset.k); } }); }
    const r = btn.getBoundingClientRect(), cur = window.P10.current?.() === id;
    dd.innerHTML = `<b>${esc(page[1])}</b>` + tabs.map(([l], k) => `<button type="button" data-id="${id}" data-k="${k}">${esc(l)}</button>`).join('');
    dd.style.left = Math.max(8, r.left) + 'px'; dd.style.top = r.bottom + 8 + 'px'; dd.hidden = false; dd.classList.add('on'); ddFor = id;
  }
  function hideDD() { if (dd) { dd.classList.remove('on'); dd.hidden = true; ddFor = null; } }
  document.addEventListener('mouseover', ev => { const b = ev.target.closest('nav[aria-label="Main"] button.p10'); if (!b) return; clearTimeout(ddT); if (ddFor !== b.dataset.p10) dropdown(b); });
  document.addEventListener('mouseout', ev => { if (ev.target.closest('nav[aria-label="Main"] button.p10') && !ev.relatedTarget?.closest?.('#hxDD,nav button.p10')) ddT = setTimeout(hideDD, 220); });
  addEventListener('scroll', hideDD, { passive: true });

  // ---------- KPI cards open in place ----------
  document.addEventListener('click', ev => {
    const k = ev.target.closest('#tdKpis > *, .mk-kgrid .mk-k'); if (!k || ev.target.closest('a,button,input')) return;
    k.classList.toggle('hx-open');
  });

  new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches?.('.p10-bar')) decorate(n); if (n.matches?.('.td-hero') || n.querySelector?.('.td-hero')) today(); } })
    .observe(document.body, { childList: true, subtree: true });
  const boot = setInterval(() => { if ($('nav[aria-label="Main"]')) { askPill(); $$('.p10-bar').forEach(decorate); today(); clearInterval(boot); } }, 400);
  addEventListener('pulse:changed', () => { for (const k in cache) delete cache[k]; });
})();
