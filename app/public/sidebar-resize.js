// Adjustable sidebar (desktop only, over 1000px). Drag the handle on its right edge between a 72px icon rail and
// 340px; under ~140px it snaps to the icon rail so labels are never cut. Double-click the handle to switch between
// the rail and the last full width; with the handle focused, the arrow keys resize it and Enter toggles. The width
// is remembered on this device. The page always starts beside the bar (sidebar.css uses --sb-w), so nothing overlaps.
(function () {
  const MIN = 72, FULL_MIN = 184, MAX = 340, DEF = 228, KEY = 'mx-sb-w', root = document.documentElement;
  const wide = matchMedia('(min-width:1001px)');
  const read = () => { try { return +localStorage.getItem(KEY) || DEF } catch { return DEF } };
  const save = w => { try { localStorage.setItem(KEY, String(w)) } catch {} };
  let last = Math.max(FULL_MIN, read());
  const snap = w => (w < 140 ? MIN : Math.min(MAX, Math.max(FULL_MIN, Math.round(w))));
  function set(w, keep = true) {
    w = snap(w);
    root.style.setProperty('--sb-w', w + 'px');
    root.classList.toggle('sb-rail', w === MIN);
    if (w !== MIN) last = w;
    if (keep) save(w);
    h.setAttribute('aria-valuenow', String(w));
    h.setAttribute('aria-valuetext', w === MIN ? 'Icons only' : w + ' pixels wide');
  }
  const h = document.createElement('div');
  h.className = 'sb-resize'; h.tabIndex = 0;
  h.setAttribute('role', 'separator'); h.setAttribute('aria-orientation', 'vertical');
  h.setAttribute('aria-label', 'Resize the sidebar'); h.setAttribute('aria-valuemin', String(MIN)); h.setAttribute('aria-valuemax', String(MAX));
  h.title = 'Drag to resize · double-click for icons only';
  document.body.append(h);

  h.addEventListener('pointerdown', e => {
    if (!wide.matches || e.button !== 0) return;
    e.preventDefault(); h.setPointerCapture(e.pointerId); root.classList.add('sb-dragging');
    const move = ev => set(ev.clientX, false);
    const up = ev => { h.releasePointerCapture(ev.pointerId); root.classList.remove('sb-dragging'); set(ev.clientX); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
  });
  const toggle = () => set(root.classList.contains('sb-rail') ? last : MIN);
  h.addEventListener('dblclick', toggle);
  h.addEventListener('keydown', e => {
    const cur = root.classList.contains('sb-rail') ? MIN : parseInt(getComputedStyle(root).getPropertyValue('--sb-w')) || DEF;
    if (e.key === 'ArrowLeft') { e.preventDefault(); set(cur === FULL_MIN ? MIN : cur - 16) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); set(cur === MIN ? FULL_MIN : cur + 16) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() }
  });
  set(read(), false);
})();
