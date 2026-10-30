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
    const id = window.P10?.current?.() || '';
    if (id === 'today') { bar.classList.add('hx-skip'); return today(); }
    const title = (window.P10?.pages || []).find(p => p[0] === id)?.[1] || $('.p10-purpose b', bar)?.textContent.split('›')[0].trim() || '';
    const hero = document.createElement('div'); hero.className = 'hx'; hero.innerHTML = `<div class="hx-in"><div class="hx-greet"><h1>${esc(title)}<em>${esc(LINES[id] || '')}</em></h1><div class="hx-stats"></div></div><div class="hx-folders"></div></div>`;
    bar.before(hero); hero.append(bar);
    const c = await content(id);
    if (c.line) hero.querySelector('em').textContent = c.line;
    hero.querySelector('.hx-stats').innerHTML = c.stats || '';
    hero.querySelector('.hx-folders').innerHTML = c.folders || '';
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
