// Pulse AI: one tab for everything the AI does. The sidebar shows a single "Pulse AI" entry (sidebar.js ORDER);
// a switcher at the top of the open part reaches Approvals, Teach, the AI team, Test lab, Support, Performance and Insights.
// Parts are opened through their sidebar entries (window.pulsePages), so each section keeps its own loading logic.
// Approvals is Pulse AI's own page: everything the AI prepared that waits for the owner (/api/pulse/waiting).
(() => {
  const PARTS = [['approvals', 'Approvals'], ['training', 'Teach'], ['agents', 'AI team'], ['demo', 'Test lab'], ['support', 'Support'], ['performance', 'Performance'], ['analytics', 'Insights']];
  const $$ = s => [...document.querySelectorAll(s)];
  const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clear = () => $$('.pa-switch').forEach(x => x.remove());
  let page = null, count = null, jump = false; // jump: a part opened from the switcher, not the sidebar

  function show(id) {
    clear();
    const sec = document.querySelector('main > section:not([hidden])'); if (!sec) return;
    const bar = document.createElement('div'); bar.className = 'pa-switch'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Pulse AI');
    bar.innerHTML = PARTS.filter(([k]) => k === 'approvals' || window.pulsePages?.[k]).map(([k, l]) =>
      `<button type="button" data-go="${k}" aria-pressed="${k === id}">${l}${k === 'approvals' && count ? ` <b class="pa-n">${count}</b>` : ''}</button>`).join('');
    sec.prepend(bar);
    // keep "Pulse AI" lit in the sidebar while inside any of its parts
    $$('nav button[aria-current="true"]').forEach(x => x.setAttribute('aria-current', 'false'));
    window.pulsePages?.training?.setAttribute('aria-current', 'true');
  }

  // ---------- Approvals ----------
  const KIND = { request: 'Customer request', lesson: 'Suggested rule', question: 'Unanswered question', agent: 'Ready to send' };
  const ACT = {
    request: x => `<button type="button" class="btn" data-a="approve" data-id="${x.id}">Approve</button><button type="button" class="btn ghost" data-a="reject" data-id="${x.id}">Reject</button>`,
    lesson: () => `<button type="button" class="btn" data-a="rule">Add rule</button><button type="button" class="btn ghost" data-a="dismiss">Dismiss</button>`,
    question: () => `<button type="button" class="btn" data-a="teach">Answer</button>`,
    agent: () => `<button type="button" class="btn" data-a="agents">Review and send</button>`,
  };
  function section() {
    if (page) return page;
    page = document.createElement('section'); page.className = 'wrap'; page.id = 'pulse-approvals'; page.hidden = true;
    page.innerHTML = `<div class="top"><div><h1>Approvals</h1><p class="sub">Everything Pulse AI prepared that waits for you. Nothing happens until you press a button.</p></div></div><div class="card glass pa-list" id="paList"></div>`;
    document.querySelector('main').append(page);
    page.addEventListener('click', act);
    return page;
  }
  async function load() {
    const box = page.querySelector('#paList'); let d;
    try { d = await req('/api/pulse/waiting'); } catch { box.innerHTML = `<p class="empty">Couldn't load approvals. <button type="button" class="btn ghost" data-a="retry">Retry</button></p>`; return; }
    count = d.count; page._items = d.items;
    box.innerHTML = d.items.length ? d.items.map((x, i) => `<div class="pa-item" data-i="${i}"><span class="pa-k pa-${x.kind}">${KIND[x.kind]}</span>
      <div class="pa-t"><b>${e(x.title)}</b><small>${e(x.why || '')}</small></div><div class="pa-a">${ACT[x.kind](x)}</div></div>`).join('')
      : `<p class="empty">Nothing waiting. Pulse AI is handling everything.</p>`;
    const n = document.querySelector('.pa-switch [data-go="approvals"]'); if (n) n.innerHTML = 'Approvals' + (count ? ` <b class="pa-n">${count}</b>` : '');
  }
  async function act(ev) {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, x = page._items?.[+b.closest('.pa-item')?.dataset.i];
    if (a === 'retry') return load();
    if (a === 'teach') return open('training');
    if (a === 'agents') return open('agents');
    b.disabled = true;
    try {
      if (a === 'approve' || a === 'reject') await req(`/api/requests/${x.id}/${a}`, 'POST', {});
      if (a === 'rule' || a === 'dismiss') { const r = await req('/api/lessons', 'POST', { title: x.title, body: x.body, kind: 'rule', action: a === 'dismiss' ? 'dismiss' : 'approve' }); if (r?.note) window.toast?.(r.note); }
    } catch (err) { window.toast?.(err.message || 'That did not work. Try again.'); }
    load();
  }
  function openApprovals() {
    $$('main > section.wrap').forEach(s => s.hidden = true);
    section().hidden = false; show('approvals'); load();
  }

  function open(id) {
    if (id === 'approvals') return openApprovals();
    if (page) page.hidden = true;
    jump = true; window.pulsePages?.[id]?.click(); jump = false; setTimeout(() => show(id), 180);
  }
  window.openPulse = open;
  document.addEventListener('click', ev => {
    const s = ev.target.closest('.pa-switch button'); if (s) { open(s.dataset.go); return }
    const n = ev.target.closest('nav button[data-view]'); if (!n || n.closest('.pa-switch')) return;
    if (!ev.isTrusted && n !== window.pulsePages?.training) return; // the sidebar's own clicks while opening a part
    if (page) page.hidden = true;
    // Pulse AI opens on Approvals when something waits, otherwise on Teach
    if (n === window.pulsePages?.training && !jump) setTimeout(() => count ? openApprovals() : show('training'), 180); else if (n !== window.pulsePages?.training) clear();
  });
  // the count for the first open of Pulse AI
  addEventListener('load', () => setTimeout(() => req('/api/pulse/waiting').then(d => { count = d.count }).catch(() => {}), 1500));
})();
