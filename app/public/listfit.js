// Long lists work like Gmail: a list shows the rows that fit the screen and a "1–14 of 100 ‹ ›" control above it,
// so the page never scrolls (clients, reviews, activity, the board…). Applies to any list of 6+ alike rows
// that runs past the bottom of the screen; chats and the Inbox (which does this itself) are left alone.
(() => {
  const SKIP = '.ib,.ask-log,#msgs,#mMsgs,.lab-chat,.cal-grid,nav,.p10-sub,select,form,#svcList,#setupForm';
  const state = new WeakMap(); // list → { at }
  let timer = 0, busy = false;
  const seen = el => el.offsetParent !== null || el.dataset.lfHide === '1';
  const rows = el => [...el.children].filter(c => !c.classList.contains('lf-bar') && (c.offsetParent !== null || c.dataset.lfHide === '1'));
  const key = c => c.tagName + '.' + (c.className || '').toString().split(' ')[0];

  function lists(sec) {
    const out = [];
    sec.querySelectorAll('tbody, ul, ol, div').forEach(el => {
      if (el.closest(SKIP) || !seen(el) || el.closest('[data-lf-host]') && !el.dataset.lfHost) return;
      const k = rows(el); if (k.length < 6) return;
      const t = key(k[0]); if (k.filter(c => key(c) === t).length / k.length < .8) return;
      // a list is table rows, or 8+ short rows; never tiles, cards or form fields
      if (el.tagName !== 'TBODY') {
        if (k.length < 8) return;
        const h = k.reduce((n, c) => n + c.getBoundingClientRect().height, 0) / k.length;
        if (h > 130 || k.some(c => c.querySelector('input,textarea,select'))) return;
      }
      out.push(el);
    });
    // innermost lists only
    return out.filter(el => !out.some(o => o !== el && el.contains(o)));
  }
  function reset(el) { rows(el).forEach(r => { if (r.dataset.lfHide) { r.hidden = false; delete r.dataset.lfHide } }); }
  function barFor(el) {
    const host = el.tagName === 'TBODY' ? el.closest('table') : el;
    let b = host.previousElementSibling; if (b?.classList.contains('lf-bar')) return b;
    b = document.createElement('div'); b.className = 'lf-bar';
    b.innerHTML = '<span></span><button type="button" data-d="-1" aria-label="Previous">‹</button><button type="button" data-d="1" aria-label="Next">›</button>';
    host.before(b); return b;
  }
  function fit(el) {
    reset(el);
    const all = rows(el); if (!all.length) return;
    const bottom = innerHeight - 14, top = all[0].getBoundingClientRect().top;
    if (all[all.length - 1].getBoundingClientRect().bottom <= bottom) { const h = el.tagName === 'TBODY' ? el.closest('table') : el; if (h.previousElementSibling?.classList.contains('lf-bar')) h.previousElementSibling.remove(); return; }
    const rowH = Math.max(18, (all[all.length - 1].getBoundingClientRect().bottom - top) / all.length);
    const bar = barFor(el), per = Math.max(3, Math.floor((bottom - top - 34) / rowH));
    const st = state.get(el) || { at: 0 }; state.set(el, st);
    st.at = Math.min(st.at, Math.floor((all.length - 1) / per) * per);
    const show = () => {
      all.forEach((r, i) => { const off = i < st.at || i >= st.at + per; r.hidden = off; if (off) r.dataset.lfHide = '1'; else delete r.dataset.lfHide; });
      bar.querySelector('span').textContent = `${st.at + 1}–${Math.min(st.at + per, all.length)} of ${all.length}`;
      bar.querySelector('[data-d="-1"]').disabled = st.at === 0; bar.querySelector('[data-d="1"]').disabled = st.at + per >= all.length;
    };
    bar.onclick = ev => { const b = ev.target.closest('[data-d]'); if (!b) return; st.at = Math.max(0, st.at + +b.dataset.d * per); busy = true; show(); busy = false; };
    show();
  }
  function run() {
    if (busy) return; busy = true;
    try { const sec = document.querySelector('main > section:not([hidden])'); if (sec) lists(sec).forEach(fit); }
    finally { busy = false; }
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(run, 400); };
  window.fitLists = soon;
  addEventListener('resize', soon);
  document.addEventListener('click', ev => { if (!ev.target.closest('.lf-bar')) soon(); }, true);
  new MutationObserver(ms => { if (!busy && ms.some(m => m.type === 'childList' && !m.target.closest?.('.lf-bar'))) soon(); })
    .observe(document.querySelector('main') || document.body, { childList: true, subtree: true });
})();
