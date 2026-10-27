// Phone navigation, the way iPhone apps do it: a bottom bar with the four pages used most and More.
// More opens a sheet with every page and its tabs, search, notifications, theme and sign out.
// Desktop is untouched: all of this switches on only under 768px wide.
(() => {
  const mq = matchMedia('(max-width: 767px)');
  const MAIN = ['today', 'inbox', 'calendar', 'pulse'];
  const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  let sheet, more;

  function build() {
    const pills = document.querySelector('nav[aria-label="Main"] .navpills');
    if (!pills || !window.P10 || more) return !!more;
    more = document.createElement('button');
    more.type = 'button'; more.className = 'p10 ph-more'; more.setAttribute('aria-label', 'More'); more.setAttribute('aria-haspopup', 'dialog');
    more.innerHTML = `${svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>')}<span>More</span><b class="ph-n" hidden></b>`;
    pills.append(more);
    more.addEventListener('click', open);

    sheet = document.createElement('div');
    sheet.className = 'ph-sheet'; sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'All pages');
    document.body.append(sheet);
    sheet.addEventListener('click', click);
    addEventListener('keydown', ev => { if (ev.key === 'Escape' && !sheet.hidden) close(); });
    setInterval(badge, 3000); badge();
    return true;
  }
  // the count on More: what is waiting on the pages it holds
  function badge() {
    if (!more) return; let n = 0;
    document.querySelectorAll('nav[aria-label="Main"] .p10[data-p10]').forEach(b => { if (!MAIN.includes(b.dataset.p10)) n += +(b.querySelector('b,.badge,.n')?.textContent || 0) || 0; });
    const el = more.querySelector('.ph-n'); el.hidden = !n; el.textContent = n;
  }
  function draw() {
    const { pages, icon, named } = window.P10, cur = document.querySelector('nav[aria-label="Main"] .p10[aria-current="true"]')?.dataset.p10;
    const n = id => +(document.querySelector(`nav .p10[data-p10="${id}"] b`)?.textContent || 0) || 0;
    const lab = document.getElementById('labBtn');
    sheet.innerHTML = `<div class="ph-panel">
      <div class="ph-grab" aria-hidden="true"></div>
      <div class="ph-head"><b>All pages</b><button type="button" class="ph-x" data-close="1" aria-label="Close">${svg('<path d="M6 6l12 12M18 6 6 18"/>')}</button></div>
      <button type="button" class="ph-search" data-search="1">${svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}Search pages, clients, chats…</button>
      <div class="ph-pages">${pages.map(([id, title, , tabs]) => `<section class="ph-pg${id === cur ? ' on' : ''}">
        <button type="button" class="ph-pt" data-go="${id}" data-k="0"><span class="ph-ic">${svg(icon[id] || '')}</span><span>${e(named(title))}</span>${n(id) ? `<b class="ph-c">${n(id)}</b>` : ''}</button>
        ${tabs.length > 1 ? `<div class="ph-tabs">${tabs.map(([t], k) => `<button type="button" data-go="${id}" data-k="${k}">${e(named(t))}</button>`).join('')}</div>` : ''}</section>`).join('')}</div>
      <div class="ph-acts">
        <button type="button" data-click="bellBtn">${svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>')}Notifications</button>
        <button type="button" data-click="themeBtn">${svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>')}Light / dark</button>
        ${lab && getComputedStyle(lab).display !== 'none' && !lab.hidden ? `<button type="button" data-click="labBtn">${svg('<path d="M15 6l-6 6 6 6"/>')}Back to Lab</button>` : ''}
        <button type="button" data-click="logoutBtn" class="ph-out">${svg('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>')}Sign out</button>
      </div></div>`;
  }
  function open() { draw(); sheet.hidden = false; sheet.classList.remove('out'); document.documentElement.classList.add('ph-lock'); requestAnimationFrame(() => sheet.querySelector('.ph-x')?.focus()); }
  function close() { sheet.classList.add('out'); setTimeout(() => { sheet.hidden = true; document.documentElement.classList.remove('ph-lock'); }, 180); more?.focus(); }
  function click(ev) {
    const t = ev.target;
    if (t === sheet || t.closest('[data-close]')) return close();
    const g = t.closest('[data-go]'); if (g) { close(); return window.openP10(g.dataset.go, +g.dataset.k); }
    if (t.closest('[data-search]')) { close(); return setTimeout(() => window.openPalette?.(), 200); }
    const c = t.closest('[data-click]'); if (c) { close(); setTimeout(() => document.getElementById(c.dataset.click)?.click(), 200); }
  }
  function apply() { document.documentElement.classList.toggle('ph', mq.matches); }
  mq.addEventListener?.('change', apply); apply();
  const t = setInterval(() => build() && clearInterval(t), 300);
})();
