// Pulse AI: one tab for everything the AI does. The sidebar shows a single "Pulse AI" entry (sidebar.js ORDER);
// a switcher at the top of the open part reaches Teach, the AI team, Test lab, Support, Performance and Insights.
// Parts are opened through their sidebar entries (window.pulsePages), so each section keeps its own loading logic.
(() => {
  const PARTS = [['training', 'Teach'], ['agents', 'AI team'], ['demo', 'Test lab'], ['support', 'Support'], ['performance', 'Performance'], ['analytics', 'Insights']];
  const $$ = s => [...document.querySelectorAll(s)];
  const clear = () => $$('.pa-switch').forEach(x => x.remove());
  function show(id) {
    clear();
    const sec = document.querySelector('main > section:not([hidden])'); if (!sec) return;
    const bar = document.createElement('div'); bar.className = 'pa-switch'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Pulse AI');
    bar.innerHTML = PARTS.filter(([k]) => window.pulsePages?.[k]).map(([k, l]) => `<button type="button" data-go="${k}" aria-pressed="${k === id}">${l}</button>`).join('');
    sec.prepend(bar);
    // keep "Pulse AI" lit in the sidebar while inside any of its parts
    $$('nav button[aria-current="true"]').forEach(x => x.setAttribute('aria-current', 'false'));
    window.pulsePages?.training?.setAttribute('aria-current', 'true');
  }
  function open(id) { window.pulsePages?.[id]?.click(); setTimeout(() => show(id), 180) }
  document.addEventListener('click', e => {
    const s = e.target.closest('.pa-switch button'); if (s) { open(s.dataset.go); return }
    const n = e.target.closest('nav button[data-view]'); if (!n || n.closest('.pa-switch')) return;
    if (!e.isTrusted && n !== window.pulsePages?.training) return; // the sidebar's own clicks while opening a part
    if (n === window.pulsePages?.training) setTimeout(() => show('training'), 180); else clear();
  });
})();
