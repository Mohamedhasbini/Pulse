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
      ['Conversations', { page: 'inbox', tab: 'conversations', cls: 'pn-conv' }],
      ['Needs you', { page: 'inbox', tab: 'conversations', cls: 'pn-needs' }],
      ['Delivery queue', { page: 'inbox', tab: 'queue' }]]],
    ['calendar', 'Calendar', 'Run your schedule', [
      ['Week', { entry: 'calendar' }],
      ['Requests', { page: 'inbox', tab: 'conversations', panes: ['approvals'], bare: true }],
      ['Booking page', { page: 'settings', tab: 'booking', bare: true }]]],
    ['customers', 'Customers', 'Know every client', [
      ['Clients', { page: 'people', tab: 'clients', panes: ['board', 'clients'] }],
      ['Win back', { page: 'people', tab: 'winback' }],
      ['Reviews', { page: 'support', tab: 'reviews', bare: true }]]],
    ['marketing', 'Marketing', 'Bring customers in', [
      ['Offers & codes', { page: 'people', tab: 'offers', panes: ['offers', 'codes'] }],
      ['Agents', { entry: 'agents' }],
      ['Website', { entry: 'website' }]]],
    ['pulse', 'Pulse AI', 'Your AI assistant', [['Approvals', { own: 'approvals' }], ['Ask Pulse', { own: 'ask' }], ['Brief', { own: 'brief' }]]],
    ['train', 'Train AI', 'Make the receptionist smarter', [
      ['Rules & coach', { entry: 'training', mode: 'coach', only: ['top', 'tchCoach', 'tchRules'] }],
      ['Answers', { entry: 'training', mode: 'questions', only: ['top', 'tchQuestions'] }],
      ['Review replies', { entry: 'training', mode: 'review', only: ['top', 'tchStats', 'tchReview'] }]]],
    ['lab', 'Test lab', 'Prove it works before customers see it', [
      ['Scenarios', { entry: 'demo' }],
      ['Versions', { entry: 'training', only: ['top', 'learn'] }]]],
    ['insights', 'Insights', 'Numbers only: how the AI and the business are doing', [
      ['AI performance', { page: 'support', tab: 'live', panes: ['live', 'flow', 'trends'] }],
      ['Business', { page: 'analytics', tab: 'overview', panes: ['highlights', 'overview', 'next'] }],
      ['Timing & channels', { page: 'analytics', tab: 'timing', panes: ['timing', 'channels'] }]]],
    ['settings', 'Settings', 'Set it up once', [
      ['Business & payments', { page: 'settings', tab: 'details' }],
      ['Channels & reminders', { page: 'settings', tab: 'channels' }],
      ['Account', { page: 'account', tab: 's2fa', panes: ['s2fa', 'sdev', 'look', 'dash'] }]]],
  ];
  const BADGE = { inbox: 'apprN', pulse: 'paN', train: 'trN' };
  let current = null, nav = null, count = 0;

  // ---------- sidebar ----------
  function draw() {
    const pills = $('nav .navpills'); if (!pills || pills.dataset.p10) return !!pills;
    if (!P().training || !P().inbox) return false; // sidebar.js not ready yet
    pills.dataset.p10 = '1';
    $$('nav .navpills > button, nav .navpills > .ns').forEach(x => { if (x.id !== 'adminNav') x.classList.add('nav-gone') });
    nav = {};
    for (const [id, label] of PAGES) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'p10'; b.dataset.p10 = id; b.title = label; b.setAttribute('aria-label', label);
      b.innerHTML = `<svg viewBox="0 0 24 24">${ICON[id]}</svg><span>${label}</span>${BADGE[id] ? `<b class="badge-n p10-n" data-for="${id}" hidden></b>` : ''}`;
      b.addEventListener('click', ev => { ev.stopImmediatePropagation(); go(id, 0) });
      pills.insertBefore(b, $('#adminNav')); nav[id] = b;
    }
    return true;
  }
  function mark(id) { Object.entries(nav || {}).forEach(([k, b]) => b.setAttribute('aria-current', String(k === id))) }

  // ---------- opening a page and tab ----------
  async function go(id, i) {
    const page = PAGES.find(p => p[0] === id); if (!page) return;
    const [, , purpose, tabs] = page, t = tabs[i] || tabs[0], spec = t[1];
    current = [id, i]; hideOwn();
    $$('[data-p10hide]').forEach(c => delete c.dataset.p10hide); // the last tab's hiding never leaks into this one
    if (spec.own) { showOwn(spec.own); }
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
      if (spec.mode) $(`#tchMode button[data-m="${spec.mode}"]`)?.click();
      // only: keep just these children; bare: a tab that borrows one panel keeps the heading and its panes, not the
      // section's own toolbar (period chips, search, quick actions)
      [...sec.children].forEach(c => {
        if (c.classList.contains('p10-bar')) return;
        if (spec.only) c.dataset.p10hide = spec.only.some(k => c.id === k || c.classList.contains(k)) ? '' : '1';
        else if (spec.bare) c.dataset.p10hide = c.classList.contains('top') || c.classList.contains('spane') ? '' : '1';
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
    b.innerHTML = `<p class="p10-purpose">${e(purpose)}</p>` + (tabs.length > 1 ? `<div class="pa-switch" role="tablist" aria-label="${e(id)}">${tabs.map(([l], k) =>
      `<button type="button" role="tab" data-t="${k}" aria-selected="${k === i}" aria-pressed="${k === i}">${e(l)}${id === 'pulse' && k === 0 && count ? ` <b class="pa-n">${count}</b>` : ''}</button>`).join('')}</div>` : '');
    b.addEventListener('click', ev => { const t = ev.target.closest('[data-t]'); if (t) go(id, +t.dataset.t) });
    sec.prepend(b); sec.classList.add('p10-on');
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
  function showOwn(key) {
    $$('main > section.wrap').forEach(s => s.hidden = true);
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
  const SUGG = ['How did this week go?', 'Who could fill tomorrow\'s free slots?', 'Which questions did the AI miss?', 'Which regulars haven\'t been back?'];
  let convo = [], team = {}, asking = false;
  async function askInit(s) {
    if (s.dataset.on) return; s.dataset.on = 1;
    try { (await req('/api/team')).team.forEach(t => team[t.id] = t); } catch {}
    s.querySelector('#askSkills').innerHTML = 'Skills: ' + Object.values(team).map(t => `<span>${e(t.role)}</span>`).join('');
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
      const skill = team[r.employee]?.role || '';
      wait.classList.remove('busy');
      wait.innerHTML = `${skill ? `<small class="ask-skill">${e(skill)}</small>` : ''}<p>${e(r.answer).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</p>`
        + (r.actions?.length ? `<div class="ask-acts">${r.actions.map((a, k) => `<button type="button" class="btn ghost" data-k="${k}">${e(a.label || a.type.replace(/_/g, ' '))}${a.client ? ` · ${e(a.client)}` : ''}</button>`).join('')}</div>` : '')
        + (r.sources?.length ? `<small class="ask-src">From: ${r.sources.map(x => e(x.label)).join(', ')}</small>` : '');
      wait._acts = r.actions || [];
    } catch (err) { wait.classList.remove('busy'); wait.innerHTML = `<p>${e(err.message || 'Pulse is not reachable right now. Try again in a minute.')}</p>`; convo.pop(); }
    asking = false;
  }
  async function doAct(ev) {
    const b = ev.target.closest('[data-k]'); if (!b) return;
    const a = b.closest('.ask-m')._acts?.[+b.dataset.k]; if (!a) return;
    b.disabled = true;
    try { const r = await req('/api/team/act', 'POST', a); b.textContent = r.done || 'Done.'; if (r.link) window.open(r.link, '_blank', 'noopener'); }
    catch (err) { b.disabled = false; window.toast?.(err.message || 'That did not work.'); }
  }

  // ---------- badges: Inbox = chats waiting, Pulse AI = approvals, Train AI = open questions ----------
  function badges() {
    const set = (id, n) => { const b = $(`.p10-n[data-for="${id}"]`); if (b) { b.hidden = !n; b.textContent = n || '' } };
    set('pulse', count);
    const w = +($('#apprN')?.textContent || 0); set('inbox', $('#attnN') && !$('#attnN').hidden ? +$('#attnN').textContent : 0);
    void w;
  }
  const poll = () => !document.hidden && req('/api/pulse/waiting').then(d => {
    count = d.count; badges();
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
    const t = setInterval(() => { if (draw()) { clearInterval(t); go('today', 0); poll(); setInterval(poll, 60000); } }, 200);
  });
})();
