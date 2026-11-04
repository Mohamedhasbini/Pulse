// MXAi navigation: 10 pages, each with at most 3 tabs and never a tab inside a tab (design/pulse-ia-prompt.md v3).
// The sections, panes and loaders built before stay as they are; a tab opens one through the old entries
// (window.pulsePages from sidebar.js, or the 'openpage' event), then shows only the panes that tab owns and
// hides the old tab rows. MXAi Assistant's own pages (Approvals, Ask MXAi, Brief) are drawn here.
(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const P = () => window.pulsePages || {}; // set by sidebar.js once it has drawn
  const ICON = {
    today: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.6c1.8.8 3 2.6 3.5 5.4"/>',
    marketing: '<path d="M4 12h3l8-6v12l-8-6"/><path d="M18 9a4 4 0 0 1 0 6"/>',
    pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    train: '<path d="M12 3 2 8l10 5 10-5-10-5zM6 10.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.5"/>',
    lab: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>',
    insights: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    growth: '<path d="M4 17l6-6 4 4 7-7"/><path d="M15 8h6v6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  };
  // a tab: { page, tab } opens a sidebar.js page; { entry } clicks an old entry; panes = the panes of that section to show;
  // only = the direct children of the section to keep (for sections without panes); cls = a class on the section
  const PAGES = [
    ['today', 'Today', 'What is happening and what needs you now', [['Today', { entry: 'home' }]]],
    ['inbox', 'Inbox', 'Talk to your customers', [
      ['Conversations', { own: 'inbox', folder: 'all' }],
      ['Needs you', { own: 'inbox', folder: 'needs', hidden: true }], // the inbox has its own Needs you folder; kept so links to it still work
      ['Delivery queue', { page: 'inbox', tab: 'queue' , adv: true }],
      ['AI control', { own: 'aictl' , adv: true }]]],
    ['calendar', 'Calendar', 'Run your schedule', [
      ['Schedule', { own: 'calendar' }],
      ['Requests', { page: 'inbox', tab: 'conversations', panes: ['approvals'], bare: true }],
      ['Booking page', { page: 'settings', tab: 'booking', bare: true, cards: ['Online booking page'] }]]],
    ['customers', 'Customers', 'Know every client', [
      ['Clients', { page: 'people', tab: 'clients' }],
      ['Win back', { own: 'growth', hidden: true }], // moved to Growth; kept so the index stays put
      ['Board', { page: 'people', tab: 'board', panes: ['board'], adv: true }],
      ['Reviews', { page: 'support', tab: 'reviews', bare: true }],
      ['Memberships', { own: 'members', tpl: ['gym'] }]]], // only for businesses that sell memberships
    ['growth', 'Growth', 'Bring new clients in and old ones back', [
      ['Overview', { own: 'growthhome' }],
      ['Win back', { page: 'people', tab: 'winback' }],
      ['Offers', { own: 'growth' }],
      ['Sent offers', { page: 'people', tab: 'offers', adv: true }],
      ['Discount codes', { page: 'people', tab: 'offers', panes: ['codes'], adv: true }],
      ['Automations', { entry: 'agents' }],
      ['Website', { entry: 'website', ws: 0, adv: true }],
      ['Website photos', { entry: 'website', ws: 1, adv: true }],
      ['Website design', { entry: 'website', ws: 2, adv: true }],
      ['Website address', { entry: 'website', ws: 3, adv: true }]]],
    ['insights', 'Insights', 'How the business is doing', [
      ['Report', { own: 'report' }],
      ['Business', { own: 'report', hidden: true, parent: 0 }],
      ['Services', { own: 'report', hidden: true, parent: 0 }],
      ['AI performance', { page: 'support', tab: 'live', panes: ['live'], lean: true , adv: true }],
      ['Timing', { own: 'report', hidden: true, parent: 0 }],
      ['Channels', { own: 'report', hidden: true, parent: 0 }],
      ['Topics', { page: 'support', tab: 'trends', panes: ['trends'], lean: true , adv: true }],
      ['Live flow', { page: 'support', tab: 'live', panes: ['flow'], lean: true, draw: 'loadFlow' , adv: true }],
      ['My board', { own: 'studio', adv: true }],
      ['Chart library', { own: 'studiolib', adv: true }],
      ['Finance', { own: 'finance' }]]],
    ['pulse', 'AI Control', 'Review, teach and test Nora', [
      ['To review', { own: 'approvals' }],
      ['Ask', { own: 'ask', hidden: true }],
      ['Brief', { own: 'brief', hidden: true }],
      ['Teach', { entry: 'training', mode: 'coach', only: ['top', 'tchCoach', 'tchRules', 'tchQuestions'] }],
      ['Rules', { entry: 'training', mode: 'coach', only: ['top', 'tchRules'], hidden: true, parent: 3 }],
      ['Answers', { entry: 'training', mode: 'questions', only: ['top', 'tchQuestions'], hidden: true, parent: 3 }],
      ['Review replies', { entry: 'training', mode: 'review', only: ['top', 'tchStats', 'tchReview'], adv: true }],
      ['Test', { entry: 'demo', only: ['top', 'lab-h', 'demo'] }],
      ['Scenarios', { entry: 'demo', only: ['top', 'labSum', 'lab'], adv: true }],
      ['Versions', { entry: 'training', only: ['top', 'learn'], adv: true }],
      ['Performance', { own: 'aiperf' }]]],
    ['settings', 'Settings', 'Set it up once', [
      ['All settings', { page: 'settings', tab: 'details', panes: ['details', 'channels', 'booking', 'codes', 's2fa', 'sdev', 'look', 'dash'], cls: 'set-one' }],
      ['Profile', { page: 'settings', tab: 'details', form: [0, 1, 2, 3, 4, 5, 6, 24], hidden: true, parent: 0 }],
      ['Assistant', { page: 'settings', tab: 'details', form: [7, 8, 9, 17, 18], keep: ['Business type'], hidden: true, parent: 0 }],
      ['Hours & team', { page: 'settings', tab: 'details', form: [10, 11, 12, 13], hidden: true, parent: 0 }],
      ['Services', { page: 'settings', tab: 'details', form: [14], hidden: true, parent: 0 }],
      ['FAQs', { page: 'settings', tab: 'details', form: [16], hidden: true, parent: 0 }],
      ['Policies & payments', { page: 'settings', tab: 'details', form: [15, 19, 20, 21, 22, 23], hidden: true, parent: 0 }],
      ['Tools', { page: 'settings', tab: 'booking', cards: ['Tools'], hidden: true, parent: 0 }],
      ['Channels', { page: 'settings', tab: 'channels', cards: ['Channels'], hidden: true, parent: 0 }],
      ['Reminders', { page: 'settings', tab: 'channels', cards: ['Reminders'], hidden: true, parent: 0 }],
      ['Security & devices', { page: 'account', tab: 's2fa', panes: ['s2fa', 'sdev'], hidden: true, parent: 0 }],
      ['Look & layout', { page: 'account', tab: 'look', panes: ['look', 'dash'], hidden: true, parent: 0 }],
      ['Integrations', { own: 'integrations', hidden: true, parent: 0 }],
      ['Website', { entry: 'website', ws: 0, hidden: true, parent: 0 }],
      ['Website photos', { entry: 'website', ws: 1, hidden: true, parent: 0 }],
      ['Website design', { entry: 'website', ws: 2, hidden: true, parent: 0 }],
      ['Website address', { entry: 'website', ws: 3, hidden: true, parent: 0 }]]],
  ];
  const BADGE = { inbox: 'apprN', pulse: 'paN' };
  // pages that were merged: [new page, tab index] for each old tab
  const MOVED = { studio: i => ['insights', 8 + i], train: i => ['pulse', 3 + i], lab: i => ['pulse', [8, 7, 9][i] ?? 7],
    marketing: i => i >= 4 ? ['growth', 6 + i - 4] : ['growth', i + 2],
    customers: i => i === 1 ? ['growth', 1] : i >= 5 ? ['growth', i - 2] : ['customers', i] }; // 4 = Memberships
  // the menu in four groups, each heading drawn before its first page
  const GROUP = {};
  const SET_IX = [['Business', 'details'], ['Channels & reminders', 'channels'], ['Booking & payments', 'booking'], ['Costs', 'costs'], ['Account & security', 's2fa'], ['Look', 'look'], ['Integrations', 12]];
  // tabs marked adv show once the owner asks for more detail on that page (remembered), or while one is open
  const detailOn = id => { try { return localStorage.getItem('mx-detail-' + id) === '1' } catch { return false } };
  const shown = (id, tabs) => tabs.map((t, k) => [t, k]).filter(([t, k]) => t[1].hidden ? false : !t[1].adv || detailOn(id) || (current?.[0] === id && tabs[current[1]]?.[1].adv && k >= 0));
  // the receptionist's name as the owner set it (Settings › Assistant), Nora by default
  const nora = () => (typeof biz !== 'undefined' && biz?.assistant_name) || 'Nora';
  const named = t => t.replace(/Nora/g, nora());
  let current = null, nav = null, count = 0;

  // ---------- sidebar ----------
  function draw() {
    const pills = $('nav .navpills'); if (!pills || pills.dataset.p10) return !!pills;
    if (!P().training || !P().inbox) return false; // sidebar.js not ready yet
    if (typeof me === 'undefined' || !me) return false; // who is signed in decides the menu
    if (window.LAB) return true; // the admin's Lab shows only the Command center
    // the business's template decides which pages show and what clients are called (members, patients…)
    if (window.MXBIZ === undefined) { window.MXBIZ = null; fetch('/api/business').then(r => r.ok ? r.json() : {}).then(b => { window.MXBIZ = b || {}; }).catch(() => { window.MXBIZ = {}; }); return false; }
    if (window.MXBIZ === null) return false;
    pills.dataset.p10 = '1';
    // live demo from the website: say so, and offer the way out and the way in
    if (me.user?.role === 'demo' && !document.getElementById('demoBar')) { const d = document.createElement('div'); d.id = 'demoBar'; d.className = 'demo-bar';
      d.innerHTML = '<span><b>Live demo</b> · sample data, look around freely. Changes are switched off.</span><a href="/demo/exit">Back to templates</a><a class="go" href="/pricing#start">Start your own</a>'; document.body.prepend(d); document.body.classList.add('has-demo'); }
    const keep = window.MXBIZ.nav, cust = window.MXBIZ.terms?.customers;
    if (cust) { const row = PAGES.find(p => p[0] === 'customers'); if (row) row[1] = cust[0].toUpperCase() + cust.slice(1); }
    $$('nav .navpills > button, nav .navpills > .ns').forEach(x => { if (x.id !== 'adminNav') x.classList.add('nav-gone') });
    nav = {};
    for (const [id, label] of PAGES) {
      if (keep && !keep.includes(id)) continue;
      if (GROUP[id]) { const g = document.createElement('div'); g.className = 'p10-grp'; g.textContent = GROUP[id]; pills.insertBefore(g, $('#adminNav')); }
      const b = document.createElement('button'); b.type = 'button'; b.className = 'p10'; b.dataset.p10 = id; b.title = label; b.setAttribute('aria-label', label);
      b.innerHTML = `<svg viewBox="0 0 24 24">${ICON[id] || ICON.insights}</svg><span>${label}</span>${BADGE[id] ? `<b class="badge-n p10-n" data-for="${id}" hidden></b>` : ''}`;
      b.addEventListener('click', ev => { ev.stopImmediatePropagation(); go(id, 0) });
      pills.insertBefore(b, $('#adminNav')); nav[id] = b;
      const tabs = PAGES.find(p => p[0] === id)[3];
      if (tabs.length > 1) {
        const sub = document.createElement('div'); sub.className = 'p10-sub'; sub.dataset.for = id; sub.hidden = true;
        sub.innerHTML = tabs.map(([l, o], k) => o?.tpl && !o.tpl.includes(window.MXBIZ?.template) ? '' : `<button type="button" data-k="${k}">${e(l)}</button>`).join('');
        sub.addEventListener('click', ev => { const t = ev.target.closest('[data-k]'); if (t) { ev.stopImmediatePropagation(); go(id, +t.dataset.k) } });
        pills.insertBefore(sub, $('#adminNav'));
      }
    }
    const gear = document.createElement('button'); gear.type = 'button'; gear.id = 'setBtn'; gear.title = 'Settings'; gear.setAttribute('aria-label', 'Settings');
    gear.innerHTML = `<svg viewBox="0 0 24 24">${ICON.settings}</svg>`; gear.addEventListener('click', () => go('settings', 0));
    $('nav .navfoot')?.prepend(gear);
    return true;
  }
  function mark(id) {
    Object.entries(nav || {}).forEach(([k, b]) => { b.setAttribute('aria-current', String(k === id)); b.querySelector('span').textContent = named(PAGES.find(p => p[0] === k)[1]) });
    // only the open page shows its tabs in the sidebar
    $$('.p10-sub').forEach(x => { x.hidden = x.dataset.for !== id; const ok = new Set(shown(x.dataset.for, PAGES.find(p => p[0] === x.dataset.for)[3]).map(([, k]) => k)); x.querySelectorAll('[data-k]').forEach(t => t.hidden = !ok.has(+t.dataset.k)); x.querySelectorAll('[data-k]').forEach(t => t.setAttribute('aria-current', String(x.dataset.for === id && +t.dataset.k === current?.[1]))) });
  }

  // ---------- opening a page and tab ----------
  async function go(id, i) {
    if (MOVED[id]) [id, i] = MOVED[id](+i || 0);
    const page = PAGES.find(p => p[0] === id); if (!page) return;
    const [, , purpose, tabs] = page, t = tabs[i] || tabs[0], spec = t[1];
    current = [id, i]; hideOwn();
    $$('[data-p10hide]').forEach(c => delete c.dataset.p10hide); // the last tab's hiding never leaks into this one
    if (spec.own) { showOwn(spec.own, spec); }
    else {
      if (spec.page) dispatchEvent(new CustomEvent('openpage', { detail: { page: spec.page, tab: spec.tab } }));
      else P()[spec.entry]?.click();
      await wait(spec.page ? 260 : 120);
      if (current[0] !== id || current[1] !== i) return; // the owner clicked elsewhere meanwhile
      const sec = $('main > section:not([hidden])'); if (!sec) return;
      // the heading names the page the owner opened, not the old section it borrows
      const h = sec.querySelector(':scope > .top h1'); if (h) h.textContent = page[1];
      sec.classList.remove('pn-conv', 'pn-needs', 'p10-bare'); if (spec.cls) sec.classList.add(spec.cls); if (spec.bare) sec.classList.add('p10-bare');
      if (spec.panes) { adopt(sec, spec.panes); sec.querySelectorAll(':scope > .spane').forEach(p => p.hidden = !spec.panes.includes(p.dataset.pane)); }
      // cards hidden by another tab (drop, cards, form) come back first, so each tab starts from its full panel
      sec.querySelectorAll(':scope > .spane > *').forEach(c => { delete c.dataset.p10hide });
      // several panels in one tab sit side by side (2 or 3 columns) so the tab fits the screen without scrolling
      const n = spec.panes ? sec.querySelectorAll(':scope > .spane:not([hidden])').length : 0;
      sec.classList.toggle('p10-multi', n > 1); if (n > 1) sec.style.setProperty('--p10n', n === 4 ? 2 : Math.min(n, 3));
      if (spec.mode) $(`#tchMode button[data-m="${spec.mode}"]`)?.click();
      if (spec.draw) window[spec.draw]?.(); // panes whose content is drawn when they open
      // the website editor's own tabs become sidebar tabs
      if (spec.ws != null) $$('#wsTabs button')[spec.ws]?.click();
      // a long form shows only the fields of this tab (Save stays); the other cards of its panel wait for their own tab
      const form = $('#setupForm');
      if (spec.form && form) {
        const f = [...form.children], last = f.length - 1;
        f.forEach((c, k) => { c.dataset.p10hide = spec.form.includes(k) || k === last ? '' : '1' });
        sec.querySelectorAll(':scope > .spane:not([hidden]) > *').forEach(c => { if (!c.contains(form) && !(spec.keep || []).some(t => c.querySelector('h2,h3')?.textContent.includes(t))) c.dataset.p10hide = '1' });
      }
      // cards: inside the shown panel, keep only the cards whose heading starts with one of these
      if (spec.cards) sec.querySelectorAll(':scope > .spane:not([hidden]) > *').forEach(c => {
        const h = c.querySelector('h2,h3')?.textContent.trim() || '';
        c.dataset.p10hide = spec.cards.some(t => h.startsWith(t)) ? '' : '1';
      });
      // drop: hide the cards with these headings (they have their own tab)
      if (spec.drop) sec.querySelectorAll(':scope > .spane:not([hidden]) > *').forEach(c => { if (spec.drop.some(t => c.querySelector('h2')?.textContent.trim().startsWith(t))) c.dataset.p10hide = '1' });
      // only: keep just these children; bare: a tab that borrows one panel keeps the heading and its panes, not the
      // section's own toolbar (period chips, search, quick actions)
      [...sec.children].forEach(c => {
        if (c.classList.contains('p10-bar')) return;
        if (spec.only) c.dataset.p10hide = spec.only.some(k => c.id === k || c.classList.contains(k)) ? '' : '1';
        // lean: like bare, but the heading row keeps its period picker (Insights needs it)
        else if (spec.bare || spec.lean) c.dataset.p10hide = c.classList.contains('top') || c.classList.contains('spane') ? '' : '1';
        else delete c.dataset.p10hide;
      });
      if (spec.mode) spec.only.forEach(k => { const x = $('#' + k); if (x) x.hidden = false });
    }
    bar(id, i, purpose, tabs);
    mark(id);
    fitTab(); setTimeout(fitTab, 400); setTimeout(fitTab, 1300); setTimeout(fitTab, 2600); // again once the tab's data has loaded
  }
  // a tab never scrolls: if its content is taller than the screen, it is scaled down to fit (not below 85%, so text stays readable)
  function fitTab() {
    const sec = $('main > section:not([hidden])'); if (!sec || window.LAB) return;
    sec.style.zoom = '';
    return; // v6: tabs scroll; shrinking the page squashed cards and made text spill out of them
    // scaling reflows the content (cards get wider and shorter), so step down until it fits
    for (let z = 1, k = 0; k < 12 && sec.scrollHeight > sec.clientHeight + 2 && z > 0.85; k++) {
      z = Math.max(0.85, z * Math.min(0.97, sec.clientHeight / sec.scrollHeight)); sec.style.zoom = z.toFixed(3);
    }
  }
  addEventListener('resize', () => { clearTimeout(fitTab.t); fitTab.t = setTimeout(fitTab, 150); });
  // panes that live in another section (Discount codes, Channels) move once into the section that shows them
  function adopt(sec, panes) {
    for (const k of panes) if (!sec.querySelector(`:scope > .spane[data-pane="${k}"]`)) {
      const p = $$(`main .spane[data-pane="${k}"]`).find(x => !x.dataset.folded); if (p) { p.dataset.home = 'p10'; sec.append(p); }
    }
  }
  // the one tab row: page purpose on the left, tabs (if more than one) on the right
  // Settings shows one part at a time, chosen from its row of tabs; the choice is kept for the visit
  let setPartNow = 'details';
  function setPart(k) {
    setPartNow = k; const st = $('#setup'); if (st) st.dataset.part = k;
    // the section list sits inside the page as a side menu, like a settings window
    const ix = $('.p10-bar .set-ix'); if (st && ix) { $$('#setup > .set-ix').forEach(x => x.remove()); st.prepend(ix); }
    // the menu left the tab row, so it answers its own clicks
    if (st && !st.dataset.ixOn) { st.dataset.ixOn = 1; st.addEventListener('click', ev => { const j = ev.target.closest('.set-ix [data-jump]'); if (j) return setPart(j.dataset.jump); const t = ev.target.closest('.set-ix [data-t]'); if (t) go('settings', +t.dataset.t); }); }
    if (st && !st.querySelector('.spane[data-pane="costs"]')) { const c = document.createElement('div'); c.className = 'spane'; c.dataset.pane = 'costs'; c.innerHTML = '<h2>Costs</h2><div id="cstRoot"></div>'; st.append(c); }
    if (k === 'costs') window.PVCosts?.($('#cstRoot'));
    const PARTS = { details: ['details'], channels: ['channels', 'reminders'], booking: ['booking', 'codes'], s2fa: ['s2fa', 'spw', 'sdev'], look: ['look', 'dash'] };
    (PARTS[k] || []).forEach(t => { try { dispatchEvent(new CustomEvent('tabshown', { detail: { view: 'setup', tab: t } })); } catch {} });
    if (k === 's2fa') { try { if (typeof me !== 'undefined' && me && typeof loadSecurity === 'function') loadSecurity(); } catch {} }
    $$('.set-ix [data-jump]').forEach(x => x.setAttribute('aria-current', x.dataset.jump === k));
    $('main')?.scrollTo?.(0, 0);
  }
  window.P10setPart = k => setPart(k);
  function bar(id, i, purpose, tabs) {
    $$('.p10-bar').forEach(x => x.remove());
    const sec = $('main > section:not([hidden])'); if (!sec) return;
    const b = document.createElement('div'); b.className = 'p10-bar';
    const title = named(PAGES.find(p => p[0] === id)[1]), tab = tabs.length > 1 ? tabs[i][0] : '';
    // tabs marked adv stay out of the way until the owner asks for detail (or is already on one)
    const sel = tabs[i][1].hidden ? (tabs[i][1].parent ?? 0) : i, hasAdv = tabs.some(t => t[1].adv), detail = hasAdv && (tabs[i][1].adv || detailOn(id));
    b.innerHTML = `<p class="p10-purpose"><b>${e(title)}${tab ? ` <i>›</i> ${e(tab)}` : ''}</b> ${e(named(purpose))}</p><div class="p10-need" id="p10Need"></div>` + (tabs.filter(t => !t[1].hidden).length > 1 ? `<div class="pa-switch" role="tablist" aria-label="${e(id)}">${tabs.map(([l, o], k) => o.hidden || (o.adv && !detail) ? '' :
      `<button type="button" role="tab" data-t="${k}" aria-selected="${k === sel}" aria-pressed="${k === sel}">${e(l)}${id === 'pulse' && k === 0 && count ? ` <b class="pa-n">${count}</b>` : ''}</button>`).join('')}${false ? `<button type="button" class="pa-more" data-detail="${detail ? 0 : 1}">${id === 'insights' ? (detail ? 'Back to the report' : 'Explore all charts') : detail ? 'Fewer tools' : 'More tools'}</button>` : ''}</div>` : '');
    // Settings is one page: a row of chips jumps to each part; Website and Integrations open their own screens
    if (id === 'settings' && (i === 0 || i === 12)) { b.insertAdjacentHTML('beforeend', `<div class="set-ix" role="navigation" aria-label="Settings sections">${SET_IX.map(([l, k]) =>
      `<button type="button" ${typeof k === 'number' ? `data-t="${k}"` : `data-jump="${k}"`}>${e(l)}</button>`).join('')}</div>`); setTimeout(() => { if (i === 0) return setPart(setPartNow);
      const host = $('#p10-integrations'), ix = $('.p10-bar .set-ix'); if (!host || !ix) return; $$('#p10-integrations > .set-ix').forEach(x => x.remove()); host.prepend(ix); host.classList.add('set-host');
      ix.querySelectorAll('button').forEach(x => x.setAttribute('aria-current', String(x.dataset.t === '12')));
      if (!host.dataset.ixOn) { host.dataset.ixOn = 1; host.addEventListener('click', ev => { const j = ev.target.closest('.set-ix [data-jump]'); if (j) { go('settings', 0); setTimeout(() => setPart(j.dataset.jump), 120); } }); } }); }
    b.addEventListener('click', ev => {
      const jmp = ev.target.closest('[data-jump]'); if (jmp) return setPart(jmp.dataset.jump);
      const d = ev.target.closest('[data-detail]');
      if (d) { try { localStorage.setItem('mx-detail-' + id, d.dataset.detail) } catch {} return go(id, tabs[i][1].adv && d.dataset.detail === '0' ? 0 : i) }
      const t = ev.target.closest('[data-t]'); if (t) go(id, +t.dataset.t) });
    sec.prepend(b); sec.classList.add('p10-on');
    need(id);
  }
  // what needs the owner on this page, first: at most 3 items, each one click from done
  let waitingNow = null;
  function need(id) {
    const box = $('#p10Need'); if (!box || !waitingNow) return;
    const it = waitingNow.items || [], n = k => it.filter(x => x.kind === k).length, chats = waitingNow.chats || 0;
    const L = {
      today: [[chats, `${chats} chat${chats === 1 ? '' : 's'} waiting for you`, ['inbox', 1]], [it.length, `${it.length} thing${it.length === 1 ? '' : 's'} to approve`, ['pulse', 0]]],
      inbox: [[chats, `${chats} chat${chats === 1 ? '' : 's'} need${chats === 1 ? 's' : ''} you`, ['inbox', 1]]],
      calendar: [[n('request'), `${n('request')} cancel/move request${n('request') === 1 ? '' : 's'}`, ['calendar', 1]]],
      growth: [[n('agent'), `${n('agent')} agent${n('agent') === 1 ? ' has' : 's have'} messages ready`, ['marketing', 3]]],
      pulse: [[it.length, `${it.length} waiting for your OK`, ['pulse', 0]],
       [n('question'), `${n('question')} question${n('question') === 1 ? '' : 's'} ${nora()} couldn't answer`, ['train', 1]], [n('lesson'), `${n('lesson')} suggested rule${n('lesson') === 1 ? '' : 's'}`, ['pulse', 0]]],
    }[id] || [];
    const todo = L.filter(x => x[0] > 0).slice(0, 3);
    box.innerHTML = todo.map(([, t, to], k) => `<button type="button" class="need" data-to="${to}">${e(t)} →</button>`).join('');
    box.onclick = ev => { const t = ev.target.closest('[data-to]'); if (t) { const [p, k] = t.dataset.to.split(','); go(p, +k) } };
  }

  // ---------- MXAi Assistant's own pages ----------
  const own = {};
  function page(key, title, sub, body) {
    if (own[key]) return own[key];
    const s = document.createElement('section'); s.className = 'wrap p10-own'; s.id = 'p10-' + key; s.hidden = true;
    s.innerHTML = `<div class="top"><div><h1>${title}</h1><p class="sub">${sub}</p></div></div>${body}`;
    $('main').append(s); return own[key] = s;
  }
  function hideOwn() { Object.values(own).forEach(s => s.hidden = true) }
  function showOwn(key, spec = {}) {
    $$('main > section.wrap').forEach(s => s.hidden = true);
    if (key === 'calendar') { const s = page('calendar', 'Calendar', '', '<div id="gcRoot"></div>'); s.hidden = false; window.PulseCal?.mount(s); }
    if (key === 'inbox') { const s = page('inbox', 'Inbox', '', '<div id="ibRoot"></div>'); s.hidden = false; window.PulseInbox?.mount(s, spec.folder); }
    if (key === 'approvals') { const s = page('approvals', 'Approvals', 'Everything MXAi Assistant prepared that waits for you. Nothing happens until you press a button.', '<div class="card glass pa-list" id="paList"></div>'); s.hidden = false; if (!s.dataset.on) { s.dataset.on = 1; s.addEventListener('click', act) } loadApprovals(); }
    if (key === 'studio' || key === 'studiolib') { const s = page(key, key === 'studio' ? 'Studio' : 'Widget library', key === 'studio' ? 'Your own board: any data, any design, placed anywhere.' : 'Every chart and table design, drawn from your live data.', '<div id="stRoot"></div>'); s.hidden = false; key === 'studio' ? window.MXStudio?.mountBoard(s) : window.MXStudio?.mountLib(s); }
    if (key === 'aictl') { const s = page('aictl', 'AI control', 'Decide who answers your clients: MXAi or your team.', '<div id="aiRoot"></div>'); s.hidden = false; window.MXAiMode?.mount(s); }
    if (key === 'integrations') { const s = page('integrations', 'Integrations', '', '<div id="igRoot"></div>'); s.hidden = false; window.PulseIntegrations?.mount(s); }
    if (key === 'report') { const s = page('report', 'Insights', '', '<div id="rpRoot" class="rp"></div>'); s.hidden = false; window.PVReport?.(s.querySelector('#rpRoot')); }
    if (key === 'members') { const s = page('members', 'Customers', '', '<div id="mbRoot" class="rp"></div>'); s.hidden = false; window.PVMembers?.(s.querySelector('#mbRoot')); }
    if (key === 'finance') { const s = page('finance', 'Insights', '', '<div id="fnRoot" class="rp"></div>'); s.hidden = false; window.PVFinance?.(s.querySelector('#fnRoot')); }
    if (key === 'aiperf') { const s = page('aiperf', 'AI Control', '', '<div id="apRoot" class="rp"></div>'); s.hidden = false; window.PVAIPerf?.(s.querySelector('#apRoot')); }
    if (key === 'growthhome') { const s = page('growthhome', 'Growth', '', '<div id="grRoot" class="rp"></div>'); s.hidden = false; window.PVGrowth?.(s.querySelector('#grRoot')); }
    if (key === 'growth') { const s = page('growth', 'Marketing', '', '<div id="mkRoot"></div>'); s.hidden = false; window.PulseMarketing?.mount(s); }
    if (key === 'brief') { const s = page('brief', 'Weekly brief', 'This week against last week, and the agents\' results. Worked out from your own numbers.', '<div id="paBrief"></div>'); s.hidden = false; loadBrief(); }
    if (key === 'ask') { const s = page('ask', 'Ask MXAi', 'Ask anything about your business. MXAi looks it up in your real data and answers with exact numbers.', ASK); s.hidden = false; askInit(s); window.PulseCommand?.open(); }
  }

  // Approvals
  const KIND = { request: 'Customer request', lesson: 'Suggested rule', question: 'Unanswered question', agent: 'Ready to send' };
  const ACT = {
    request: x => `<button type="button" class="btn" data-a="approve" data-id="${x.id}">Approve</button><button type="button" class="btn ghost" data-a="reject" data-id="${x.id}">Reject</button>`,
    lesson: () => `<button type="button" class="btn" data-a="rule">Add rule</button><button type="button" class="btn ghost" data-a="dismiss">Dismiss</button>`,
    question: () => `<button type="button" class="btn" data-a="teach">Answer</button>`,
    agent: () => `<button type="button" class="btn" data-a="agents">Review and send</button>`,
  };
  async function loadApprovals() {
    const s = own.approvals, box = s.querySelector('#paList'); let d;
    try { d = await req('/api/pulse/waiting'); } catch { box.innerHTML = `<p class="empty">Couldn't load approvals. <button type="button" class="btn ghost" data-a="retry">Retry</button></p>`; return; }
    count = d.count; s._items = d.items; badges();
    box.innerHTML = d.items.length ? d.items.map((x, i) => `<div class="pa-item" data-i="${i}"><span class="pa-k pa-${x.kind}">${KIND[x.kind]}</span>
      <div class="pa-t"><b>${e(x.title)}</b><small>${e(x.why || '')}</small></div><div class="pa-a">${ACT[x.kind](x)}</div></div>`).join('')
      : `<p class="empty">Nothing waiting. MXAi Assistant is handling everything.</p>`;
    const n = $('.p10-bar [data-t="0"]'); if (current?.[0] === 'pulse' && n) n.innerHTML = 'To review' + (count ? ` <b class="pa-n">${count}</b>` : '');
  }
  async function act(ev) {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, x = own.approvals._items?.[+b.closest('.pa-item')?.dataset.i];
    if (a === 'retry') return loadApprovals();
    if (a === 'teach') return go('train', 1);
    if (a === 'agents') return go('marketing', 3);
    b.disabled = true;
    try {
      if (a === 'approve' || a === 'reject') await req(`/api/requests/${x.id}/${a}`, 'POST', {});
      if (a === 'rule' || a === 'dismiss') { const r = await req('/api/lessons', 'POST', { title: x.title, body: x.body, kind: 'rule', action: a === 'dismiss' ? 'dismiss' : 'approve' }); if (r?.note) window.toast?.(r.note); }
    } catch (err) { window.toast?.(err.message || 'That did not work. Try again.'); }
    loadApprovals();
  }

  // Brief
  async function loadBrief() {
    const box = own.brief.querySelector('#paBrief'); let d;
    try { d = await req('/api/pulse/brief'); } catch { box.innerHTML = '<p class="empty">Couldn\'t load the brief.</p>'; return; }
    const col = (t, cls, list, none) => `<div class="card glass pa-col ${cls}"><h3>${t}</h3>${list.length ? `<ul>${list.map(x => `<li>${e(x)}</li>`).join('')}</ul>` : `<p class="empty">${none}</p>`}</div>`;
    const money = n => '$' + Math.round(n || 0).toLocaleString();
    box.innerHTML = `<div class="pa-cols">${col('Wins', 'win', d.wins, 'No clear wins yet this week.')}${col('Risks', 'risk', d.risks, 'Nothing worrying this week.')}${col('Next steps', 'next', d.next, 'Nothing to do. MXAi Assistant has it.')}</div>`
      + `<h2 class="pa-h">Agents, last 30 days</h2><div class="card glass pa-score">${d.agents.length ? `<table><thead><tr><th>Agent</th><th>Sent</th><th>Booked after</th><th>Value</th></tr></thead><tbody>${d.agents.map(a => `<tr><td>${e(a.name)}</td><td>${a.sent}</td><td>${a.booked}${a.sent ? ` <small>(${Math.round(a.booked / a.sent * 100)}%)</small>` : ''}</td><td>${money(a.value)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No agent messages sent yet. When you send one, its results show here.</p>'}</div>`;
  }

  // Ask MXAi: one chat. The server picks the skill (Front desk, Support, Growth, Analyst) for each question.
  // Ask MXAi lives in one place, the assistant panel; this page is a doorway to it with the same composer and suggestions
  const ASK = `<div class="ask-door"><button type="button" class="ask-open" data-q=""><span>Ask anything, or tell me what to do…</span><b aria-hidden="true">↑</b></button>
    <div class="ask-cards">${[['How did this week go?', 'This week'], ["Who could fill tomorrow's free slots?", 'Fill gaps'], ["Which regulars haven't been back?", 'Win back'], ["Add a shortcut to this week's revenue", 'Shortcut']]
      .map(([q, k]) => `<button type="button" data-q="${q.replace(/"/g, '&quot;')}"><b>${k}</b>${q}</button>`).join('')}</div></div>`;
  const SUGG = ['How did this week go?', 'Who could fill tomorrow\'s free slots?', 'Add a shortcut to this week\'s revenue', 'Which regulars haven\'t been back?'];
  let convo = [], team = {}, asking = false;
  async function askInit(s) {
    if (s.dataset.on) return; s.dataset.on = 1;
    s.querySelector('.ask-door').addEventListener('click', ev => { const t = ev.target.closest('[data-q]'); if (t) window.PulseCommand?.open(t.dataset.q || undefined); });
    return;
    s.querySelector('#askSkills').innerHTML = 'MXAi Assistant can: ' + ['Answer anything with your real numbers', 'Book, message and follow up', 'Teach Nora rules and answers', 'Run growth agents', 'Add shortcuts to Home', 'Find any page for you'].map(t => `<span>${e(t)}</span>`).join('');
    s.querySelector('#askSugg').innerHTML = SUGG.map(q => `<button type="button" class="chip">${e(q)}</button>`).join('');
    s.querySelector('#askSugg').addEventListener('click', ev => { const c = ev.target.closest('.chip'); if (c) ask(c.textContent) });
    s.querySelector('#askForm').addEventListener('submit', ev => { ev.preventDefault(); const i = s.querySelector('#askIn'); if (i.value.trim()) { ask(i.value.trim()); i.value = '' } });
    s.querySelector('#askLog').addEventListener('click', doAct);
  }
  function say(who, html, cls = '') { const l = $('#askLog'); l.insertAdjacentHTML('beforeend', `<div class="ask-m ${who} ${cls}">${html}</div>`); l.scrollTop = l.scrollHeight; return l.lastElementChild; }
  async function ask(text) {
    if (asking) return; asking = true; $('#askSugg').hidden = true;
    convo.push({ role: 'owner', text }); say('me', e(text));
    const wait = say('ai', 'Looking it up…', 'busy');
    try {
      const r = await req('/api/team/ask', 'POST', { messages: convo, page: 'ask' });
      convo.push({ role: 'employee', text: r.answer });
      const skill = 'MXAi Assistant';
      wait.classList.remove('busy');
      wait.innerHTML = `${skill ? `<small class="ask-skill">${e(skill)}</small>` : ''}<p>${e(r.answer).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</p>`
        + (r.actions?.length ? `<div class="ask-acts">${r.actions.map((a, k) => `<button type="button" class="btn ghost" data-k="${k}">${e(a.type === 'add_shortcut' ? `Add to Home: ${a.label}` : a.label || a.type.replace(/_/g, ' '))}${a.client ? ` · ${e(a.client)}` : ''}</button>`).join('')}</div>` : '')
        + (r.sources?.length ? `<small class="ask-src">From: ${r.sources.map(x => e(x.label)).join(', ')}</small>` : '');
      wait._acts = r.actions || [];
    } catch (err) { wait.classList.remove('busy'); wait.innerHTML = `<p>${e(err.message || 'MXAi is not reachable right now. Try again in a minute.')}</p>`; convo.pop(); }
    asking = false;
  }
  async function doAct(ev) {
    const b = ev.target.closest('[data-k]'); if (!b) return;
    const a = b.closest('.ask-m')._acts?.[+b.dataset.k]; if (!a) return;
    b.disabled = true;
    try { const r = await req('/api/team/act', 'POST', a); b.textContent = r.done || 'Done.'; if (r.link) window.open(r.link, '_blank', 'noopener'); if (r.shortcuts) loadShortcuts(); }
    catch (err) { b.disabled = false; window.toast?.(err.message || 'That did not work.'); }
  }

  // ---------- Home shortcuts: the owner's own buttons on Today (MXAi Assistant can add them too) ----------
  let sc = { shortcuts: [], pages: {}, max: 8 };
  const pageLabel = id => named(PAGES.find(p => p[0] === id)?.[1] || id);
  async function loadShortcuts() { try { sc = await req('/api/shortcuts'); } catch {} drawShortcuts(); }
  function drawShortcuts() {
    const slot = $('#tdScSlot'), kp = slot || $('#tdKpis') || $('.today .td-hero'); if (!kp) return;
    let box = $('#tdSc');
    if (!box) {
      kp.insertAdjacentHTML(slot ? 'beforeend' : 'afterend', '<div class="td-card td-sc" id="tdSc" aria-label="Your shortcuts"></div>');
      box = $('#tdSc'); box.addEventListener('click', scClick);
    }
    const list = sc.shortcuts || [];
    const sv = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`, SPARK = '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>';
    box.innerHTML = `<div class="sc-row">${list.map((x, k) => `<span class="sc${x.ask ? ' ask' : ''}"><button type="button" class="sc-go" data-i="${k}" title="${e(x.ask ? 'Asks MXAi Assistant: ' + x.ask : 'Opens ' + pageLabel(x.page) + ' › ' + (sc.pages[x.page]?.[x.tab] || ''))}"><span class="sc-ic">${sv(x.ask ? SPARK : ICON[x.page] || SPARK)}</span>${e(x.label)}</button><button type="button" class="sc-x" data-x="${k}" aria-label="Remove ${e(x.label)}">${sv('<path d="M6 6l12 12M18 6 6 18"/>')}</button></span>`).join('')}
      ${list.length < sc.max ? `<button type="button" class="sc-add" data-add="1">${sv('<path d="M12 5v14M5 12h14"/>')}Add shortcut<kbd>Ctrl K</kbd></button>` : ''}
      ${list.length ? '' : '<small class="sc-tip">Pin the pages and questions you use most.</small>'}</div>`;
  }
  async function scClick(ev) {
    const t = ev.target;
    if (t.closest('[data-add]')) return window.openPalette?.({ pin: true });
    const x = t.closest('[data-x]'); if (x) { const list = sc.shortcuts.filter((_, k) => k !== +x.dataset.x); try { sc.shortcuts = (await req('/api/shortcuts', 'PUT', { shortcuts: list })).shortcuts } catch {} return drawShortcuts(); }
    const g = t.closest('[data-i]'); if (g) { const s2 = sc.shortcuts[+g.dataset.i]; if (s2.ask) window.P10.ask(s2.ask); else go(s2.page, s2.tab); }
  }


  // ---------- badges: Inbox = chats waiting, MXAi Assistant = approvals, Train AI = open questions ----------
  function badges() {
    const set = (id, n) => { const b = $(`.p10-n[data-for="${id}"]`); if (b) { b.hidden = !n; b.textContent = n || '' } };
    set('pulse', count);
    // the Inbox badge comes only from /api/pulse/waiting (real chats waiting, never test chats)
  }
  const poll = () => !document.hidden && (current?.[0] === 'inbox' && window.PulseInbox?.refresh(), req('/api/pulse/waiting')).then(d => {
    count = d.count; waitingNow = d; badges(); if (current) need(current[0]); set2('inbox', d.chats || 0);
    set2('train', d.items.filter(x => x.kind === 'question').length);
  }).catch(() => {});
  const set2 = (id, n) => { const b = $(`.p10-n[data-for="${id}"]`); if (b) { b.hidden = !n; b.textContent = n || '' } };

  // ---------- old links land on the new pages ----------
  window.openPulse = k => go('pulse', ['approvals', 'ask', 'brief'].indexOf(k) < 0 ? 0 : ['approvals', 'ask', 'brief'].indexOf(k));
  window.openP10 = go;
  // for the search box (palette.js)
  window.P10 = { pages: PAGES, icon: ICON, named, group: GROUP, shown, ask: x => window.PulseCommand ? window.PulseCommand.open(x) : ask(x), go: (id, t) => go(id, t), current: () => current?.[0], sub: () => current?.[1], shortcuts: () => sc.shortcuts || [], reloadShortcuts: () => loadShortcuts() };
  // any other way of opening a section (Today's buttons, notifications) drops our tab row so the page isn't mislabelled
  document.addEventListener('click', ev => {
    const n = ev.target.closest('nav button[data-view]'); if (!n || n.classList.contains('p10')) return;
    if (ev.isTrusted) { $$('.p10-bar').forEach(x => x.remove()); hideOwn(); current = null; mark(null); }
  }, true);

  addEventListener('load', () => {
    const t = setInterval(() => { if (draw()) { clearInterval(t); if (window.LAB) return; go('today', 0); poll(); setInterval(() => { if (!document.documentElement.classList.contains('live-on')) poll(); }, 60000); setInterval(poll, 300000); setTimeout(loadShortcuts, 600); } }, 200);
    // a change pushed by the server: fresh numbers on the page that is open, no timer involved
    let bump = 0; addEventListener('mxai:change', () => { clearTimeout(bump); bump = setTimeout(() => { if (document.hidden || !current) return; window.PVInvalidate?.(); poll(); go(current[0], current[1]); }, 400); });
  });
})();
