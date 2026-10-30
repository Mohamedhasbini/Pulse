// AI control: switch the whole business between "the AI answers clients" and "the team answers every client".
// Lives in three places: the AI control tab (Inbox), a toggle in the top bar, and a banner while the AI is off.
// Shortcut: Ctrl/⌘ + Shift + A.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let state = { mode: 'on', waiting: 0, paused: 0, today: 0, since: null }, root = null;
  const api = (m = 'GET', body) => fetch('/api/ai-mode', { method: m, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(r => r.ok ? r.json() : null).catch(() => null);

  async function load() { const r = await api(); if (r) state = r; paint(); }
  async function set(mode) {
    if (mode === state.mode) return;
    const r = await api('PUT', { mode }); if (!r) return window.toast?.('Could not switch the AI. Try again.');
    window.toast?.(mode === 'off' ? 'AI is off. Every client now waits for your reply in the Inbox.' : 'AI is on. It answers clients again.');
    await load();
  }
  const toggle = () => set(state.mode === 'on' ? 'off' : 'on');

  // top-bar toggle, next to the notifications bell
  function chip() {
    let b = $('#aiChip');
    if (!b) {
      const bell = [...document.querySelectorAll('header button, .topbar button, nav button')].find(x => /notif|bell/i.test(x.getAttribute('aria-label') || x.title || x.className));
      b = document.createElement('button'); b.type = 'button'; b.id = 'aiChip'; b.className = 'ai-chip';
      b.title = 'Turn the AI on or off (Ctrl+Shift+A)'; b.addEventListener('click', toggle);
      (bell?.parentElement || document.body).insertBefore(b, bell || null);
      if (!bell) b.classList.add('float');
    }
    b.dataset.mode = state.mode;
    b.innerHTML = `<i></i><span>${state.mode === 'on' ? 'AI on' : 'AI off'}</span>`;
    b.setAttribute('aria-pressed', state.mode === 'on');
  }

  // banner while the AI is off
  function banner() {
    let n = $('#aiBanner');
    if (state.mode === 'on') { n?.remove(); document.body.classList.remove('ai-off'); return; }
    document.body.classList.add('ai-off');
    if (!n) { n = document.createElement('div'); n.id = 'aiBanner'; n.className = 'ai-banner'; n.setAttribute('role', 'status'); document.body.prepend(n); }
    n.innerHTML = `<b>AI is off.</b> You answer every client from the Inbox${state.waiting ? ` · <strong>${state.waiting} waiting</strong>` : ''}.
      <span><button type="button" data-go="needs">Open waiting chats</button><button type="button" data-on>Turn AI on</button></span>`;
    n.querySelector('[data-on]').onclick = () => set('on');
    n.querySelector('[data-go]').onclick = () => window.P10?.go('inbox', 1);
  }

  // the AI control tab
  function panel() {
    if (!root) return;
    const off = state.mode === 'off', since = state.since ? String(state.since).replace('T', ' ') : '';
    root.innerHTML = `<div class="aic">
      <div class="aic-main card glass">
        <span class="aic-k">Who answers your clients</span>
        <div class="aic-sw" role="radiogroup" aria-label="Who answers your clients">
          <button type="button" role="radio" aria-checked="${!off}" data-m="on"><b>MXAi answers</b><small>The AI replies, books and supports clients 24/7. You step in when it hands a chat to you.</small></button>
          <button type="button" role="radio" aria-checked="${off}" data-m="off"><b>My team answers</b><small>The AI stays silent. Every message waits for a reply from you in the Inbox.</small></button>
        </div>
        <p class="aic-note">${off ? `AI off${since ? ` since ${esc(since)}` : ''}. Clients still reach you on every channel; nothing is sent automatically.` : `AI on${since ? ` since ${esc(since)}` : ''}. You can still take over any single chat from the Inbox.`}
          <span class="aic-kb">Shortcut <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>A</kbd></span></p>
      </div>
      <div class="aic-stats">
        <div class="card glass"><span>Waiting for a reply</span><b>${state.waiting}</b><button type="button" data-go="needs">Open</button></div>
        <div class="card glass"><span>Chats you took over</span><b>${state.paused}</b><small>AI stays quiet in these</small></div>
        <div class="card glass"><span>Conversations, last 24h</span><b>${state.today}</b><button type="button" data-go="all">Inbox</button></div>
      </div>
      <div class="aic-how card glass"><h3>What changes when the AI is off</h3><ul>
        <li>New messages are saved and marked <b>Needs you</b>, and you get an alert.</li>
        <li>You reply from the Inbox; clients see your messages on the channel they used.</li>
        <li>Reminders and bookings you confirm still work. Marketing agents keep waiting for your approval.</li>
        <li>Turning the AI back on hands those chats back to it, except chats you took over yourself.</li></ul></div>
    </div>`;
    root.querySelectorAll('[data-m]').forEach(b => b.onclick = () => set(b.dataset.m));
    root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => window.P10?.go('inbox', b.dataset.go === 'needs' ? 1 : 0));
  }

  function paint() { chip(); banner(); panel(); }
  window.MXAiMode = { mount(sec) { root = sec.querySelector('#aiRoot'); load(); }, toggle, get: () => state.mode };
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); toggle(); } });
  const boot = () => { if (document.querySelector('nav')) { load(); setInterval(load, 60000); } else setTimeout(boot, 400); };
  boot();
})();
