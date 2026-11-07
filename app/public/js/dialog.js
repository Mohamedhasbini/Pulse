// Every pop-up window (.modal: booking, block time, client, conversation) behaves as a real dialog, whichever
// screen opens it: announced as a dialog with its title, focus moves inside, Tab stays inside, Escape or Close
// returns focus to the button that opened it. Screens keep opening them the way they do (removing `hidden`).
(() => {
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const openers = new WeakMap();
  const top = () => [...document.querySelectorAll('.modal:not([hidden])')].pop();

  function prepare(m) {
    if (m.dataset.dlg) return; m.dataset.dlg = '1';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    const h = m.querySelector('h2[id], h3[id]'); if (h) m.setAttribute('aria-labelledby', h.id);
    new MutationObserver(() => m.hidden ? closed(m) : opened(m)).observe(m, { attributes: true, attributeFilter: ['hidden'] });
  }
  // the last thing focused outside any pop-up: some screens move focus into their pop-up before it is shown,
  // so "what was focused when it opened" is already inside it
  let lastOutside = null;
  document.addEventListener('focusin', ev => { if (!ev.target.closest?.('.modal')) lastOutside = ev.target; });
  function opened(m) {
    const from = m.contains(document.activeElement) ? lastOutside : document.activeElement;
    if (from && !m.contains(from) && from !== document.body) openers.set(m, from);
    // the screen may focus its own field a moment later (a reply box); otherwise the first control gets focus
    setTimeout(() => { if (!m.hidden && !m.contains(document.activeElement)) [...m.querySelectorAll(FOCUSABLE)].find(visible)?.focus(); }, 80);
  }
  function closed(m) {
    const back = openers.get(m); openers.delete(m);
    if (back && document.contains(back) && !top()) back.focus?.({ preventScroll: true });
  }
  document.addEventListener('keydown', ev => {
    const m = top(); if (!m || ev.key !== 'Tab') return;
    const list = [...m.querySelectorAll(FOCUSABLE)].filter(visible); if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    if (!m.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
    else if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  });
  const scan = () => document.querySelectorAll('.modal').forEach(prepare);
  scan(); document.addEventListener('DOMContentLoaded', scan);
})();
