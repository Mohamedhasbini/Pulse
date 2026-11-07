// The page header every page shares with Today: date line, title, one live sentence that says what matters on this
// page, the page's main actions on the right, and quiet tabs underneath. pulse.js draws it; this file knows, per page,
// what the sentence says and which actions lead.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => { try { return fmt(v); } catch { return '$' + Math.round(v || 0).toLocaleString(); } };
  const get = url => (typeof req === 'function' ? req(url) : fetch(url).then(r => r.json())).catch(() => null);
  const n = (v, one, many) => `<b>${Number(v || 0).toLocaleString()}</b> ${Number(v) === 1 ? one : many}`;
  const join = parts => parts.filter(Boolean).join('<span class="mxh-dot" aria-hidden="true"> · </span>');
  const ai = () => window.P10 ? window.P10.named('Nora') : 'Your assistant';

  // main actions per page: [label, what it does, primary?]
  const ACTS = {
    inbox: [['Ask MXAi', 'ask']],
    calendar: [['Block time', 'block'], ['+ New booking', 'newbooking', 1]],
    customers: [['Win back', 'go:growth|Win back'], ['Send an offer', 'go:growth|Offers', 1]],
    growth: [['See automations', 'go:growth|Automations'], ['Create an offer', 'go:growth|Offers', 1]],
    insights: [['Ask about my numbers', 'ask', 1]],
    pulse: [['Teach a rule', 'go:pulse|Teach'], ['Test ' + '{ai}', 'go:pulse|Test', 1]],
    settings: [],
  };
  // the one sentence: what matters on this page right now, from live numbers (never a static slogan)
  const SAY = {
    async inbox() {
      const [w, l] = await Promise.all([get('/api/pulse/waiting'), get('/api/live?days=7')]), now = l?.now || {};
      const waiting = w?.chats ?? now.waiting ?? 0;
      return join([waiting ? `${n(waiting, 'chat waits', 'chats wait')} for you` : 'Nobody is waiting for you',
        `${ai()} answered ${n(now.replies_today, 'message', 'messages')} today`, now.active_now ? `${n(now.active_now, 'chat', 'chats')} happening now` : '']);
    },
    async calendar() {
      const l = await get('/api/live?days=7'), now = l?.now || {}, up = l?.upcoming || [];
      const today = new Date().toISOString().slice(0, 10), next = up.find(b => b.start && b.start >= new Date(Date.now() - 6e4).toISOString().slice(0, 16)) || up[0];
      return join([`${n(now.visits_today, 'visit', 'visits')} today`, next ? `next: <b>${esc(next.name || 'a client')}</b> at ${esc(String(next.start).slice(11, 16))}${String(next.start).startsWith(today) ? '' : ' on ' + esc(String(next.start).slice(5, 10))}` : 'nothing booked ahead',
        now.approvals ? `${n(now.approvals, 'request waits', 'requests wait')} for your OK` : '']);
    },
    async customers() {
      const rows = await get('/api/customers') || [], c = window.MXClients?.segments?.(rows) || {};
      return join([n(rows.length, 'client', 'clients'), c.regular != null ? n(c.regular, 'regular', 'regulars') : '',
        c.drifting ? `<span class="mxh-warn">${n(c.drifting, 'regular drifting away', 'regulars drifting away')}</span>` : 'no regulars drifting away']);
    },
    async growth() {
      const m = await get('/api/marketing/overview?days=90'), k = m?.kpis || {};
      return join([`${money(k.revenue)} won back in 90 days`, k.reached ? `${k.conversion || 0}% of reached clients booked` : 'no offers sent yet',
        `${n(m?.segments?.lapsed?.n, 'client', 'clients')} to win back`]);
    },
    async insights() {
      // the very numbers the Report cards show (same endpoint), so the sentence and the page never disagree
      const [r, l] = await Promise.all([get('/api/insights?days=30'), get('/api/live?days=30')]), t = r?.totals || {}, p = r?.prev || {};
      const d = p.revenue ? Math.round((t.revenue - p.revenue) / p.revenue * 100) : null;
      return join([`${money(t.revenue)} earned in 30 days`, d == null ? '' : `<span class="${d >= 0 ? 'mxh-up' : 'mxh-warn'}">${d >= 0 ? '+' : '−'}${Math.abs(d)}%</span> on the 30 days before`,
        `${n(l?.now?.ai_count, 'booking', 'bookings')} made by ${ai()} in 30 days`]);
    },
    async pulse() {
      const w = await get('/api/pulse/waiting'), it = w?.items || [], q = it.filter(x => x.kind === 'question').length;
      return join([it.length ? `${n(it.length, 'thing waits', 'things wait')} for your OK` : 'Nothing waits for you',
        q ? `${n(q, 'question', 'questions')} ${ai()} couldn't answer` : `${ai()} answered everything it was asked`]);
    },
    async settings() { return 'Your business details, channels, booking rules and account. Changes apply from the next message.'; },
  };

  function actions(id) {
    return (ACTS[id] || []).map(([label, act, pri]) => `<button type="button" class="mx-btn${pri ? ' pri' : ''}" data-mxh="${esc(act)}">${esc(label.replace('{ai}', ai()))}</button>`).join('');
  }
  async function sentence(id, el) {
    if (!SAY[id] || !el) return;
    try { const html = await SAY[id](); if (el.isConnected) el.innerHTML = html; } catch { el.textContent = ''; }
  }
  // what an action button does
  function run(act) {
    if (act === 'ask') return window.PulseCommand?.open();
    if (act.startsWith('go:')) { const [p, t] = act.slice(3).split('|'); return window.P10?.go(p, t); }
    // the calendar's own buttons do the work (they are hidden: the header shows them once, at the top)
    if (act === 'newbooking' || act === 'block') {
      const go = () => document.querySelector(act === 'block' ? 'main [data-off="1"]' : 'main [data-new="1"]')?.click();
      if (window.P10?.current?.() === 'calendar' && window.P10?.sub?.() === 0) return go();
      window.P10?.go('calendar', 'Schedule'); setTimeout(go, 500);
    }
  }
  document.addEventListener('click', ev => { const b = ev.target.closest('.mxh [data-mxh]'); if (b) run(b.dataset.mxh); });
  window.MXHead = { actions, sentence };
})();
