// The one search box (Ctrl K / Cmd K), in the spirit of Linear, Raycast and Magic UI's command menu.
// Search: jump to any page or tab, ask Pulse AI, find a client or a conversation, run an action.
// Pin mode (openPalette({ pin: true }) from "Add shortcut" on Today): pick what the button opens, name it, save.
// Any page result can also be pinned straight from search with Tab.
(() => {
  const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', chat: '<path d="M4 5h16v11H8l-4 4z"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', pin: '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v8"/>', check: '<path d="m5 12 5 5 9-10"/>',
  };
  const box = document.createElement('div');
  box.className = 'cp'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Search');
  box.innerHTML = `<div class="cp-panel">
    <div class="cp-in">${svg(I.search)}<span class="cp-chip" id="cpChip" hidden>${svg(I.pin)}New shortcut</span>
      <input id="cpQ" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="cpRes"><kbd>Esc</kbd></div>
    <div class="cp-res" id="cpRes" role="listbox"></div>
    <form class="cp-name" id="cpName" hidden>
      <p class="cp-step">Name your shortcut</p>
      <div class="cp-prev"><span class="cp-ic" id="cpPrevIc"></span><div><input id="cpLabel" maxlength="32" aria-label="Button name" required><small id="cpPrevTo"></small></div></div>
      <div class="cp-acts"><button type="button" class="cp-btn ghost" data-back="1">Back</button><button class="cp-btn" type="submit">Add to Today</button></div></form>
    <div class="cp-foot" id="cpFoot"></div></div>`;
  document.body.append(box);
  const q = box.querySelector('#cpQ'), res = box.querySelector('#cpRes'), nameF = box.querySelector('#cpName'), label = box.querySelector('#cpLabel');
  let mode = 'search', items = [], sel = 0, seq = 0, t = 0, picked = null;

  const P10 = () => window.P10 || { pages: [], icon: {}, named: x => x };
  const pinned = () => (window.P10?.shortcuts?.() || []);
  // words owners search with that are not in the tab's name
  const ALSO = {
    'today:0': 'home dashboard overview kpi', 'inbox:0': 'messages chats whatsapp', 'inbox:1': 'handover urgent attention', 'calendar:0': 'bookings appointments schedule agenda',
    'calendar:1': 'pending approve', 'calendar:2': 'online booking link', 'customers:0': 'clients people contacts', 'customers:2': 'regulars lost inactive',
    'customers:3': 'google rating stars feedback', 'marketing:0': 'promotions deals campaign', 'marketing:1': 'coupon promo', 'pulse:1': 'question chat assistant ai',
    'pulse:2': 'report summary week', 'train:0': 'tone personality teach', 'train:1': 'instructions always never', 'train:2': 'faq knowledge unknown',
    'insights:3': 'revenue money sales income kpi bookings ticket capacity', 'insights:4': 'services best sellers revenue', 'insights:5': 'busy hours days heatmap',
    'insights:6': 'whatsapp telegram instagram web', 'settings:0': 'business name address logo', 'settings:3': 'prices menu duration', 'settings:2': 'opening hours staff team',
    'settings:9': 'password two-factor 2fa login', 'settings:10': 'theme dark light colours',
  };
  // every page and tab of the sidebar
  function pages() {
    const { pages, icon, named } = P10(), out = [];
    pages.forEach(([id, title, , tabs]) => tabs.forEach(([tab], k) => out.push({
      g: 'Go to', page: id, tab: k, t: tabs.length > 1 ? named(tab) : named(title), s: tabs.length > 1 ? named(title) : 'Page', ic: icon[id] || I.bolt,
      words: `${named(title)} ${named(tab)} ${ALSO[id + ':' + k] || ''}`, run: () => window.openP10(id, k) })));
    return out;
  }
  function actions() {
    const click = s => () => document.querySelector(s)?.click();
    return [['New booking', click('[data-go="newbooking"]')], ['Switch light or dark', click('#themeBtn')], ['Notifications', click('#bellBtn')], ['Account security', click('#pwBtn')]]
      .map(([t, run]) => ({ g: 'Actions', t, s: 'Action', ic: I.bolt, words: t, run }));
  }
  // match quality: start of title > start of a word > anywhere > every letter in order
  function score(it, w) {
    if (!w) return 1; const s = it.words.toLowerCase(), ti = it.t.toLowerCase();
    if (ti.startsWith(w)) return 4; if (s.split(/\s+/).some(x => x.startsWith(w))) return 3; if (s.includes(w)) return 2;
    if (w.length < 4) return 0; let i = 0; for (const c of ti) if (c === w[i]) i++; return i === w.length ? 1 : 0;
  }
  const mark = (txt, w) => { if (!w) return e(txt); const i = txt.toLowerCase().indexOf(w); return i < 0 ? e(txt) : e(txt.slice(0, i)) + '<mark>' + e(txt.slice(i, i + w.length)) + '</mark>' + e(txt.slice(i + w.length)); };

  function draw(w) {
    const pin = pinned();
    let g = '', html = '';
    items.forEach((it, i) => {
      if (it.g !== g) { g = it.g; html += `<div class="cp-g" role="presentation">${e(g)}</div>`; }
      const on = it.page && pin.some(p => p.page === it.page && p.tab === it.tab);
      html += `<button type="button" role="option" class="cp-it" id="cp${i}" data-i="${i}" aria-selected="${i === sel}" tabindex="-1">
        <span class="cp-ic">${svg(it.ic)}</span><span class="cp-tx"><b>${mark(it.t, w)}</b>${it.s ? `<small>${e(it.s)}</small>` : ''}</span>
        ${on ? `<span class="cp-tag">${svg(I.check)}Pinned</span>` : ''}<span class="cp-ret">${mode === 'pin' ? 'Pick' : it.ask ? 'Ask' : it.page ? 'Open' : 'Run'} ↵</span></button>`;
    });
    res.innerHTML = html || `<p class="cp-none">Nothing found for “${e(q.value)}”.</p>`;
    q.setAttribute('aria-activedescendant', items.length ? 'cp' + sel : '');
    res.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  async function search() {
    const raw = q.value.trim(), w = raw.toLowerCase(), my = ++seq;
    const ask = raw.length > 2 ? [{ g: 'Ask Pulse AI', t: /[?.!]$/.test(raw) ? raw : raw + '?', s: mode === 'pin' ? 'A button that asks this' : 'Answered with your real numbers', ic: I.spark, ask: raw, words: raw }] : [];
    let found = [...pages(), ...(mode === 'pin' ? [] : actions())].map(it => ({ it, sc: score(it, w) })).filter(x => x.sc).sort((a, b) => b.sc - a.sc).map(x => x.it);
    found = w ? found.slice(0, 8) : found.filter(x => x.tab === 0 || mode === 'pin' || x.page == null).slice(0, mode === 'pin' ? 60 : 14);
    // pages first when the words name a page; otherwise the question first
    items = !w || (found.length && score(found[0], w) >= 3) ? [...found, ...ask] : [...ask, ...found];
    sel = 0; draw(w);
    if (mode === 'pin' || w.length < 2) return;
    const [cs, cv] = await Promise.all([req(`/api/customers?q=${encodeURIComponent(w)}&test=1`).catch(() => []), req(`/api/inbox?folder=all&limit=5&offset=0&q=${encodeURIComponent(w)}`).catch(() => ({}))]);
    if (my !== seq) return;
    const people = (Array.isArray(cs) ? cs : []).slice(0, 4).map(c => ({ g: 'Clients', t: c.name || 'No name', s: [c.phone, c.visits != null ? c.visits + ' visits' : ''].filter(Boolean).join(' · '), ic: I.person, words: c.name || '', run: () => window.openCustomer?.(c.id) }));
    const chats = (cv.rows || []).slice(0, 4).map(c => ({ g: 'Conversations', t: c.name || c.phone || 'Customer', s: c.last?.text || '', ic: I.chat, words: c.name || '', run: async () => { await window.openP10('inbox', 0); setTimeout(() => window.PulseInbox?.openChat(c.id), 400); } }));
    items = [...items, ...people, ...chats]; draw(w);
  }
  function foot() {
    box.querySelector('#cpFoot').innerHTML = mode === 'name' ? '<span><kbd>↵</kbd> add</span><span><kbd>Esc</kbd> back</span>'
      : `<span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> ${mode === 'pin' ? 'pick' : 'open'}</span>${mode === 'search' ? '<span><kbd>Tab</kbd> pin to Today</span>' : ''}<span><kbd>Esc</kbd> close</span>`;
  }
  function setMode(m) {
    mode = m; box.classList.toggle('pin', m !== 'search');
    box.querySelector('#cpChip').hidden = m === 'search';
    q.placeholder = m === 'search' ? 'Search pages, clients, chats, or ask Pulse AI…' : 'Type a page, or a question for Pulse AI…';
    nameF.hidden = m !== 'name'; res.hidden = m === 'name'; q.closest('.cp-in').hidden = m === 'name';
    foot();
  }
  function open(o = {}) {
    clearTimeout(close.t); setMode(o.pin ? 'pin' : 'search'); q.value = o.q || ''; box.hidden = false; box.classList.remove('out');
    search(); requestAnimationFrame(() => q.focus());
  }
  function close() { box.classList.add('out'); close.t = setTimeout(() => { box.hidden = true; }, 120); }
  // step 2 of pinning: name the button, with a live preview of it
  function nameIt(it) {
    if (pinned().length >= 8) { window.toast?.('Today holds up to 8 shortcuts. Remove one first.'); return; }
    picked = it; setMode('name');
    box.querySelector('#cpPrevIc').innerHTML = svg(it.ic);
    box.querySelector('#cpPrevTo').textContent = it.ask ? 'Asks Pulse AI: ' + it.ask : 'Opens ' + (it.s && it.s !== 'Page' ? it.s + ' › ' : '') + it.t;
    // the words the owner searched with make the best name ("revenue" found Business: call it Revenue)
    const typed = q.value.trim(), own = typed && !it.ask && !it.t.toLowerCase().includes(typed.toLowerCase()) ? typed[0].toUpperCase() + typed.slice(1) : '';
    label.value = (own || (it.ask ? it.ask.replace(/\?$/, '') : it.t)).slice(0, 32); requestAnimationFrame(() => { label.focus(); label.select(); });
  }
  async function save(ev) {
    ev.preventDefault(); const it = picked, body = { label: label.value.trim() }; if (!body.label) return;
    if (it.ask) body.ask = it.ask; else { body.page = it.page; body.tab = it.tab; }
    try { await req('/api/shortcuts', 'POST', body); window.P10?.reloadShortcuts?.(); window.toast?.(`“${body.label}” added to Today.`); close(); }
    catch (err) { window.toast?.(err.message || 'Could not add it.'); }
  }
  function pick(i, pinIt) {
    const it = items[i]; if (!it) return;
    if (mode === 'pin' || pinIt) { if (it.page != null || it.ask) nameIt(it); return; }
    close(); if (it.ask) window.openP10('pulse', 1).then(() => setTimeout(() => window.P10?.ask?.(it.ask), 300)); else it.run();
  }

  document.addEventListener('keydown', ev => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); ev.stopImmediatePropagation(); box.hidden ? open() : close(); }
  }, true);
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 90); });
  q.addEventListener('keydown', ev => {
    const k = ev.key;
    if (k === 'Escape') { ev.preventDefault(); close(); }
    else if (k === 'ArrowDown' || k === 'ArrowUp') { ev.preventDefault(); if (items.length) { sel = (sel + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length; draw(q.value.trim().toLowerCase()); } }
    else if (k === 'Enter') { ev.preventDefault(); pick(sel); }
    else if (k === 'Tab' && mode === 'search') { ev.preventDefault(); pick(sel, true); }
  });
  label.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); setMode('pin'); search(); q.focus(); } });
  nameF.addEventListener('submit', save);
  nameF.addEventListener('click', ev => { if (ev.target.closest('[data-back]')) { setMode('pin'); search(); q.focus(); } });
  res.addEventListener('mousemove', ev => { const b = ev.target.closest('.cp-it'); if (b && +b.dataset.i !== sel) { sel = +b.dataset.i; res.querySelectorAll('.cp-it').forEach(x => x.setAttribute('aria-selected', String(+x.dataset.i === sel))); } });
  res.addEventListener('click', ev => { const b = ev.target.closest('.cp-it'); if (b) pick(+b.dataset.i); });
  box.addEventListener('mousedown', ev => { if (ev.target === box) close(); });
  // the search field at the top of the dashboard opens it too
  document.querySelector('#cmdQ')?.addEventListener('focus', ev => { ev.target.blur(); open(); });
  window.openPalette = open;
})();
