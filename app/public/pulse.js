// Pulse navigation: 10 pages, each with at most 3 tabs and never a tab inside a tab (design/pulse-ia-prompt.md v3).
// The sections, panes and loaders built before stay as they are; a tab opens one through the old entries
// (window.pulsePages from sidebar.js, or the 'openpage' event), then shows only the panes that tab owns and
// hides the old tab rows. Pulse AI's own pages (Approvals, Ask Pulse, Brief) are drawn here.
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
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  };
  // a tab: { page, tab } opens a sidebar.js page; { entry } clicks an old entry; panes = the panes of that section to show;
  // only = the direct children of the section to keep (for sections without panes); cls = a class on the section
  const PAGES = [
    ['today', 'Today', 'What is happening and what needs you now', [['Today', { entry: 'home' }]]],
    ['inbox', 'Inbox', 'Talk to your customers', [
      ['Conversations', { own: 'inbox', folder: 'all' }],
      ['Needs you', { own: 'inbox', folder: 'needs' }],
      ['Delivery queue', { page: 'inbox', tab: 'queue' }]]],
    ['calendar', 'Calendar', 'Run your schedule', [
      ['Week', { entry: 'calendar' }],
      ['Requests', { page: 'inbox', tab: 'conversations', panes: ['approvals'], bare: true }],
      ['Booking page', { page: 'settings', tab: 'booking', bare: true, cards: ['Online booking page'] }]]],
    ['customers', 'Customers', 'Know every client', [
      ['Clients', { page: 'people', tab: 'clients' }],
      ['Board', { page: 'people', tab: 'board', panes: ['board'] }],
      ['Win back', { page: 'people', tab: 'winback' }],
      ['Reviews', { page: 'support', tab: 'reviews', bare: true }]]],
    ['marketing', 'Marketing', 'Bring customers in', [
      ['Offers', { page: 'people', tab: 'offers' }],
      ['Discount codes', { page: 'people', tab: 'offers', panes: ['codes'] }],
      ['Agents', { entry: 'agents' }],
      ['Website', { entry: 'website' }]]],
    ['pulse', 'Pulse AI', 'Your AI assistant', [['Approvals', { own: 'approvals' }], ['Ask Pulse', { own: 'ask' }], ['Brief', { own: 'brief' }]]],
    ['train', 'Train Nora', 'Make Nora smarter', [
      ['Rules & coach', { entry: 'training', mode: 'coach', only: ['top', 'tchCoach', 'tchRules'] }],
      ['Answers', { entry: 'training', mode: 'questions', only: ['top', 'tchQuestions'] }],
      ['Review replies', { entry: 'training', mode: 'review', only: ['top', 'tchStats', 'tchReview'] }]]],
    ['lab', 'Test lab', 'Try Nora before your customers do', [
      ['Scenarios', { entry: 'demo', only: ['top', 'lab'] }],
      ['Test chat', { entry: 'demo', only: ['top', 'lab-h', 'demo'] }],
      ['Versions', { entry: 'training', only: ['top', 'learn'] }]]],
    ['insights', 'Insights', 'Numbers only: how the AI and the business are doing', [
      ['AI performance', { page: 'support', tab: 'live', panes: ['live'], lean: true }],
      ['Live flow', { page: 'support', tab: 'live', panes: ['flow'], lean: true }],
      ['Topics', { page: 'support', tab: 'trends', panes: ['trends'], lean: true }],
      ['Business', { page: 'analytics', tab: 'overview', panes: ['highlights', 'overview', 'next'] }],
      ['Timing', { page: 'analytics', tab: 'timing', panes: ['timing'] }],
      ['Channels', { page: 'analytics', tab: 'timing', panes: ['channels'] }]]],
    ['settings', 'Settings', 'Set it up once', [
      ['Profile', { page: 'settings', tab: 'details', form: [0, 1, 2, 3, 4, 5, 6, 24] }],
      ['Assistant', { page: 'settings', tab: 'details', form: [7, 8, 9, 17, 18], keep: ['Business type'] }],
      ['Hours & team', { page: 'settings', tab: 'details', form: [10, 11, 12, 13] }],
      ['Services', { page: 'settings', tab: 'details', form: [14] }],
      ['FAQs', { page: 'settings', tab: 'details', form: [16] }],
      ['Policies & payments', { page: 'settings', tab: 'details', form: [15, 19, 20, 21, 22, 23] }],
      ['Tools', { page: 'settings', tab: 'booking', cards: ['Tools'] }],
      ['Channels', { page: 'settings', tab: 'channels', cards: ['Channels'] }],
      ['Reminders', { page: 'settings', tab: 'channels', cards: ['Reminders'] }],
      ['Security & devices', { page: 'account', tab: 's2fa', panes: ['s2fa', 'sdev'] }],
      ['Look & layout', { page: 'account', tab: 'look', panes: ['look', 'dash'] }]]],
  ];
  const BADGE = { inbox: 'apprN', pulse: 'paN', train: 'trN' };
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
    pills.dataset.p10 = '1';
    $$('nav .navpills > button, nav .navpills > .ns').forEach(x => { if (x.id !== 'adminNav') x.classList.add('nav-gone') });
    nav = {};
    for (const [id, label] of PAGES) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'p10'; b.dataset.p10 = id; b.title = label; b.setAttribute('aria-label', label);
      b.innerHTML = `<svg viewBox="0 0 24 24">${ICON[id]}</svg><span>${label}</span>${BADGE[id] ? `<b class="badge-n p10-n" data-for="${id}" hidden></b>` : ''}`;
      b.addEventListener('click', ev => { ev.stopImmediatePropagation(); go(id, 0) });
      pills.insertBefore(b, $('#adminNav')); nav[id] = b;
      const tabs = PAGES.find(p => p[0] === id)[3];
      if (tabs.length > 1) {
        const sub = document.createElement('div'); sub.className = 'p10-sub'; sub.dataset.for = id; sub.hidden = true;
        sub.innerHTML = tabs.map(([l], k) => `<button type="button" data-k="${k}">${e(l)}</button>`).join('');
        sub.addEventListener('click', ev => { const t = ev.target.closest('[data-k]'); if (t) { ev.stopImmediatePropagation(); go(id, +t.dataset.k) } });
        pills.insertBefore(sub, $('#adminNav'));
      }
    }
    return true;
  }
  function mark(id) {
    Object.entries(nav || {}).forEach(([k, b]) => { b.setAttribute('aria-current', String(k === id)); b.querySelector('span').textContent = named(PAGES.find(p => p[0] === k)[1]) });
    // only the open page shows its tabs in the sidebar
    $$('.p10-sub').forEach(x => { x.hidden = x.dataset.for !== id; x.querySelectorAll('[data-k]').forEach(t => t.setAttribute('aria-current', String(x.dataset.for === id && +t.dataset.k === current?.[1]))) });
  }

  // ---------- opening a page and tab ----------
  async function go(id, i) {
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
      // several panels in one tab sit side by side (2 or 3 columns) so the tab fits the screen without scrolling
      const n = spec.panes ? sec.querySelectorAll(':scope > .spane:not([hidden])').length : 0;
      sec.classList.toggle('p10-multi', n > 1); if (n > 1) sec.style.setProperty('--p10n', n === 4 ? 2 : Math.min(n, 3));
      if (spec.mode) $(`#tchMode button[data-m="${spec.mode}"]`)?.click();
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
  }
  // panes that live in another section (Discount codes, Channels) move once into the section that shows them
  function adopt(sec, panes) {
    for (const k of panes) if (!sec.querySelector(`:scope > .spane[data-pane="${k}"]`)) {
      const p = $$(`main .spane[data-pane="${k}"]`).find(x => !x.dataset.folded); if (p) { p.dataset.home = 'p10'; sec.append(p); }
    }
  }
  // the one tab row: page purpose on the left, tabs (if more than one) on the right
  function bar(id, i, purpose, tabs) {
    $$('.p10-bar').forEach(x => x.remove());
    const sec = $('main > section:not([hidden])'); if (!sec) return;
    const b = document.createElement('div'); b.className = 'p10-bar';
    const title = named(PAGES.find(p => p[0] === id)[1]), tab = tabs.length > 1 ? tabs[i][0] : '';
    b.innerHTML = `<p class="p10-purpose"><b>${e(title)}${tab ? ` <i>›</i> ${e(tab)}` : ''}</b> ${e(named(purpose))}</p><div class="p10-need" id="p10Need"></div>` + (tabs.length > 1 ? `<div class="pa-switch" role="tablist" aria-label="${e(id)}">${tabs.map(([l], k) =>
      `<button type="button" role="tab" data-t="${k}" aria-selected="${k === i}" aria-pressed="${k === i}">${e(l)}${id === 'pulse' && k === 0 && count ? ` <b class="pa-n">${count}</b>` : ''}</button>`).join('')}</div>` : '');
    b.addEventListener('click', ev => { const t = ev.target.closest('[data-t]'); if (t) go(id, +t.dataset.t) });
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
      marketing: [[n('agent'), `${n('agent')} agent${n('agent') === 1 ? ' has' : 's have'} messages ready`, ['marketing', 2]]],
      pulse: [[it.length, `${it.length} waiting for your OK`, ['pulse', 0]]],
      train: [[n('question'), `${n('question')} question${n('question') === 1 ? '' : 's'} ${nora()} couldn't answer`, ['train', 1]], [n('lesson'), `${n('lesson')} suggested rule${n('lesson') === 1 ? '' : 's'}`, ['pulse', 0]]],
    }[id] || [];
    const todo = L.filter(x => x[0] > 0).slice(0, 3);
    box.innerHTML = todo.map(([, t, to], k) => `<button type="button" class="need" data-to="${to}">${e(t)} →</button>`).join('');
    box.onclick = ev => { const t = ev.target.closest('[data-to]'); if (t) { const [p, k] = t.dataset.to.split(','); go(p, +k) } };
  }

  // ---------- Pulse AI's own pages ----------
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
    if (key === 'inbox') { const s = page('inbox', 'Inbox', '', '<div id="ibRoot"></div>'); s.hidden = false; window.PulseInbox?.mount(s, spec.folder); }
    if (key === 'approvals') { const s = page('approvals', 'Approvals', 'Everything Pulse AI prepared that waits for you. Nothing happens until you press a button.', '<div class="card glass pa-list" id="paList"></div>'); s.hidden = false; if (!s.dataset.on) { s.dataset.on = 1; s.addEventListener('click', act) } loadApprovals(); }
    if (key === 'brief') { const s = page('brief', 'Weekly brief', 'This week against last week, and the agents\' results. Worked out from your own numbers.', '<div id="paBrief"></div>'); s.hidden = false; loadBrief(); }
    if (key === 'ask') { const s = page('ask', 'Ask Pulse', 'Ask anything about your business. Pulse looks it up in your real data and answers with exact numbers.', ASK); s.hidden = false; askInit(s); }
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
      : `<p class="empty">Nothing waiting. Pulse AI is handling everything.</p>`;
    const n = $('.p10-bar [data-t="0"]'); if (current?.[0] === 'pulse' && n) n.innerHTML = 'Approvals' + (count ? ` <b class="pa-n">${count}</b>` : '');
  }
  async function act(ev) {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, x = own.approvals._items?.[+b.closest('.pa-item')?.dataset.i];
    if (a === 'retry') return loadApprovals();
    if (a === 'teach') return go('train', 1);
    if (a === 'agents') return go('marketing', 1);
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
    box.innerHTML = `<div class="pa-cols">${col('Wins', 'win', d.wins, 'No clear wins yet this week.')}${col('Risks', 'risk', d.risks, 'Nothing worrying this week.')}${col('Next steps', 'next', d.next, 'Nothing to do. Pulse AI has it.')}</div>`
      + `<h2 class="pa-h">Agents, last 30 days</h2><div class="card glass pa-score">${d.agents.length ? `<table><thead><tr><th>Agent</th><th>Sent</th><th>Booked after</th><th>Value</th></tr></thead><tbody>${d.agents.map(a => `<tr><td>${e(a.name)}</td><td>${a.sent}</td><td>${a.booked}${a.sent ? ` <small>(${Math.round(a.booked / a.sent * 100)}%)</small>` : ''}</td><td>${money(a.value)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No agent messages sent yet. When you send one, its results show here.</p>'}</div>`;
  }

  // Ask Pulse: one chat. The server picks the skill (Front desk, Support, Growth, Analyst) for each question.
  const ASK = `<div class="card glass ask"><div class="ask-skills" id="askSkills"></div><div class="ask-log" id="askLog" aria-live="polite"></div>
    <div class="ask-sugg" id="askSugg"></div><form class="ask-form" id="askForm"><input id="askIn" autocomplete="off" placeholder="Ask anything: who hasn't been back in 2 months? how was last week?" aria-label="Ask Pulse"><button class="btn" type="submit">Ask</button></form></div>`;
  const SUGG = ['How did this week go?', 'Who could fill tomorrow\'s free slots?', 'Add a shortcut to this week\'s revenue', 'Which regulars haven\'t been back?'];
  let convo = [], team = {}, asking = false;
  async function askInit(s) {
    if (s.dataset.on) return; s.dataset.on = 1;
    try { (await req('/api/team')).team.forEach(t => team[t.id] = t); } catch {}
    s.querySelector('#askSkills').innerHTML = 'Pulse AI can: ' + ['Answer anything with your real numbers', 'Book, message and follow up', 'Teach Nora rules and answers', 'Run growth agents', 'Add shortcuts to Home', 'Find any page for you'].map(t => `<span>${e(t)}</span>`).join('');
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
      const skill = 'Pulse AI';
      wait.classList.remove('busy');
      wait.innerHTML = `${skill ? `<small class="ask-skill">${e(skill)}</small>` : ''}<p>${e(r.answer).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</p>`
        + (r.actions?.length ? `<div class="ask-acts">${r.actions.map((a, k) => `<button type="button" class="btn ghost" data-k="${k}">${e(a.type === 'add_shortcut' ? `Add to Home: ${a.label}` : a.label || a.type.replace(/_/g, ' '))}${a.client ? ` · ${e(a.client)}` : ''}</button>`).join('')}</div>` : '')
        + (r.sources?.length ? `<small class="ask-src">From: ${r.sources.map(x => e(x.label)).join(', ')}</small>` : '');
      wait._acts = r.actions || [];
    } catch (err) { wait.classList.remove('busy'); wait.innerHTML = `<p>${e(err.message || 'Pulse is not reachable right now. Try again in a minute.')}</p>`; convo.pop(); }
    asking = false;
  }
  async function doAct(ev) {
    const b = ev.target.closest('[data-k]'); if (!b) return;
    const a = b.closest('.ask-m')._acts?.[+b.dataset.k]; if (!a) return;
    b.disabled = true;
    try { const r = await req('/api/team/act', 'POST', a); b.textContent = r.done || 'Done.'; if (r.link) window.open(r.link, '_blank', 'noopener'); if (r.shortcuts) loadShortcuts(); }
    catch (err) { b.disabled = false; window.toast?.(err.message || 'That did not work.'); }
  }

  // ---------- Home shortcuts: the owner's own buttons on Today (Pulse AI can add them too) ----------
  let sc = { shortcuts: [], pages: {}, max: 8 };
  const pageLabel = id => named(PAGES.find(p => p[0] === id)?.[1] || id);
  async function loadShortcuts() { try { sc = await req('/api/shortcuts'); } catch {} drawShortcuts(); }
  function drawShortcuts() {
    const kp = $('#tdKpis') || $('.today .td-hero'); if (!kp) return;
    let box = $('#tdSc');
    if (!box) {
      kp.insertAdjacentHTML('afterend', '<div class="td-card td-sc" id="tdSc" aria-label="Your shortcuts"></div>');
      box = $('#tdSc'); box.addEventListener('click', scClick); box.addEventListener('submit', scAdd);
    }
    const list = sc.shortcuts || [];
    box.innerHTML = `<div class="sc-row">${list.map((x, k) => `<span class="sc"><button type="button" class="sc-go" data-i="${k}" title="${e(x.ask ? 'Ask Pulse: ' + x.ask : pageLabel(x.page) + ' › ' + (sc.pages[x.page]?.[x.tab] || ''))}">${x.ask ? '<i>✦</i>' : ''}${e(x.label)}</button><button type="button" class="sc-x" data-x="${k}" aria-label="Remove ${e(x.label)}">×</button></span>`).join('')}
      ${list.length < sc.max ? '<button type="button" class="sc-add" data-add="1">+ Shortcut</button>' : ''}
      <small class="sc-tip">${list.length ? '' : 'Pin what you use most. '}Or tell Pulse AI: “add a shortcut to this week's revenue”.</small></div>`;
  }
  function scForm() {
    const opts = Object.entries(sc.pages).map(([p, tabs]) => `<optgroup label="${e(pageLabel(p))}">${tabs.map((t, k) => `<option value="${p}:${k}">${e(pageLabel(p))} › ${e(t)}</option>`).join('')}</optgroup>`).join('');
    return `<form class="sc-form"><select name="to" aria-label="Opens"><option value="ask">Ask Pulse AI a question…</option>${opts}</select>
      <input name="ask" placeholder="Question, e.g. How did this week go?" aria-label="Question"><input name="label" maxlength="32" placeholder="Button name" aria-label="Button name" required>
      <button class="btn" type="submit">Add</button><button class="btn ghost" type="button" data-cancel="1">Cancel</button></form>`;
  }
  async function scClick(ev) {
    const t = ev.target;
    if (t.closest('[data-add]')) { $('#tdSc .sc-row').insertAdjacentHTML('afterend', scForm()); t.closest('[data-add]').hidden = true;
      const f = $('#tdSc .sc-form'); f.to.onchange = () => { f.ask.hidden = f.to.value !== 'ask'; if (f.to.value !== 'ask' && !f.label.value) f.label.value = f.to.selectedOptions[0].textContent.split(' › ').pop(); }; f.ask.focus(); return; }
    if (t.closest('[data-cancel]')) return drawShortcuts();
    const x = t.closest('[data-x]'); if (x) { const list = sc.shortcuts.filter((_, k) => k !== +x.dataset.x); try { sc.shortcuts = (await req('/api/shortcuts', 'PUT', { shortcuts: list })).shortcuts } catch {} return drawShortcuts(); }
    const g = t.closest('[data-i]'); if (g) { const s2 = sc.shortcuts[+g.dataset.i]; if (s2.ask) { await go('pulse', 1); setTimeout(() => ask(s2.ask), 300); } else go(s2.page, s2.tab); }
  }
  async function scAdd(ev) {
    ev.preventDefault(); const f = ev.target, to = f.to.value, body = { label: f.label.value };
    if (to === 'ask') body.ask = f.ask.value; else { const [p, k] = to.split(':'); body.page = p; body.tab = +k; }
    try { sc.shortcuts = (await req('/api/shortcuts', 'POST', body)).shortcuts; drawShortcuts(); } catch (err) { window.toast?.(err.message || 'Could not add it.'); }
  }

  // ---------- badges: Inbox = chats waiting, Pulse AI = approvals, Train AI = open questions ----------
  function badges() {
    const set = (id, n) => { const b = $(`.p10-n[data-for="${id}"]`); if (b) { b.hidden = !n; b.textContent = n || '' } };
    set('pulse', count);
    const w = +($('#apprN')?.textContent || 0); set('inbox', $('#attnN') && !$('#attnN').hidden ? +$('#attnN').textContent : 0);
    void w;
  }
  const poll = () => !document.hidden && (current?.[0] === 'inbox' && window.PulseInbox?.refresh(), req('/api/pulse/waiting')).then(d => {
    count = d.count; waitingNow = d; badges(); if (current) need(current[0]); set2('inbox', d.chats || 0);
    set2('train', d.items.filter(x => x.kind === 'question').length);
  }).catch(() => {});
  const set2 = (id, n) => { const b = $(`.p10-n[data-for="${id}"]`); if (b) { b.hidden = !n; b.textContent = n || '' } };

  // ---------- old links land on the new pages ----------
  window.openPulse = k => go('pulse', ['approvals', 'ask', 'brief'].indexOf(k) < 0 ? 0 : ['approvals', 'ask', 'brief'].indexOf(k));
  window.openP10 = go;
  // any other way of opening a section (Today's buttons, notifications) drops our tab row so the page isn't mislabelled
  document.addEventListener('click', ev => {
    const n = ev.target.closest('nav button[data-view]'); if (!n || n.classList.contains('p10')) return;
    if (ev.isTrusted) { $$('.p10-bar').forEach(x => x.remove()); hideOwn(); current = null; mark(null); }
  }, true);

  addEventListener('load', () => {
    const t = setInterval(() => { if (draw()) { clearInterval(t); if (window.LAB) return; go('today', 0); poll(); setInterval(poll, 60000); setTimeout(loadShortcuts, 600); } }, 200);
  });
})();
