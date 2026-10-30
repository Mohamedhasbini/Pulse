// Things that look clickable must do something. Names and customer quotes in Insights open the search with that text
// (it finds the client and the chats where it was said); the overview strip's frame itself is not a button.
(() => {
  const target = e => e.target.closest('[data-findable]');
  document.addEventListener('click', e => {
    const t = target(e); if (!t || e.target.closest('a,button,input')) return;
    const text = (t.dataset.find || t.querySelector('b')?.textContent || t.textContent).replace(/[“”"]/g, '').trim().slice(0, 80);
    if (text && window.openPalette) window.openPalette({ q: text });
  });
  // quotes drawn inside chart cards (“…”) become findable
  const mark = () => document.querySelectorAll('main > section:not([hidden]) :is(.pv-c span, .pv-c li, .item)').forEach(el => {
    if (el.dataset.findable || el.closest('button,a,[data-cust],[data-c],[data-go]')) return;
    const q = /^“[^”]{3,}”$/.test(el.textContent.trim()) || el.matches('.item');
    if (!q) return;
    el.dataset.findable = '1'; if (!el.matches('.item')) el.dataset.find = el.textContent.trim();
    el.title = 'Find this in your clients and chats'; el.style.cursor = 'pointer';
  });
  new MutationObserver(() => { clearTimeout(mark.t); mark.t = setTimeout(mark, 300); }).observe(document.body, { childList: true, subtree: true });
})();
