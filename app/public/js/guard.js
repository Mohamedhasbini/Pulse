// Readability guard: after a page or sub-tab draws, every visible text is checked against what is really behind it
// (all the layers, glass and gradients included). Text that would be hard to read is switched to the graphite or the
// silver ink, whichever reads better there. Page headers whose side area is empty fold to a compact height.
// window.MXGuard.audit() lists what it would change (used by the automated design checks).
(() => {
  const RGB = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  const lum = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  // the colour of one element's own paint: its background colour, else the average of the colours in its gradient
  const paint = cs => {
    let c = RGB(cs.backgroundColor);
    const g = cs.backgroundImage && cs.backgroundImage !== 'none' ? [...cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(m => RGB(m[0])) : [];
    if (g.length) { const avg = g.reduce((s, x) => [s[0] + x[0], s[1] + x[1], s[2] + x[2], s[3] + x[3]], [0, 0, 0, 0]).map(v => v / g.length); c = c && c[3] > 0 ? over(avg, c) : avg; }
    return c && c[3] > 0.02 ? c : null;
  };
  const page = () => document.documentElement.dataset.theme === 'light' ? [196, 200, 204, 1] : [17, 19, 21, 1];
  function behind(el) {
    const stack = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const p = paint(getComputedStyle(e)); if (p) { stack.push(p); if (p[3] >= .98) break; } }
    let c = page(); for (let i = stack.length - 1; i >= 0; i--) c = over(stack[i], c); return c;
  }
  const INK = { dark: 'rgb(21, 24, 26)', light: 'rgb(238, 240, 242)' };
  function textNodesOf(root) {
    const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.textContent.trim().length > 0 ? 1 : 2 });
    for (let n; (n = w.nextNode());) { const el = n.parentElement; if (el && !out.includes(el)) out.push(el); }
    return out;
  }
  function check(root, fix) {
    const bad = [];
    for (const el of textNodesOf(root)) {
      if (el.closest('svg,script,style,[hidden],.mx-skip') || !el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0 || cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)' || cs.backgroundClip === 'text') continue;
      // some styles paint text through -webkit-text-fill-color, which wins over color: measure what is really painted
      const fg = RGB(cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color && !/currentcolor/i.test(cs.webkitTextFillColor) ? cs.webkitTextFillColor : cs.color); if (!fg) continue;
      const bg = behind(el), size = parseFloat(cs.fontSize), need = size >= 18 || (size >= 14 && +cs.fontWeight >= 600) ? 3 : 4.2;
      const fgOn = fg[3] < 1 ? over(fg, bg) : fg, r = ratio(fgOn, bg);
      if (r >= need) continue;
      const dark = RGB(INK.dark), light = RGB(INK.light), pick = ratio(dark, bg) >= ratio(light, bg) ? INK.dark : INK.light;
      bad.push({ text: el.textContent.trim().slice(0, 40), ratio: +r.toFixed(2), color: cs.color, fix: pick, where: (el.className && String(el.className).split(' ')[0]) || el.tagName });
      if (fix) { el.style.setProperty('color', pick, 'important'); el.style.setProperty('-webkit-text-fill-color', pick, 'important'); el.dataset.mxg = '1'; }
    }
    return bad;
  }
  // page headers: fold the empty right-hand area so the page's data starts higher
  function compact(root) {
    root.querySelectorAll('.hx').forEach(h => {
      const f = h.querySelector('.hx-folders'), hasSide = f && f.textContent.trim().length > 0, hasExtra = h.querySelector('.hx-ask,.hx-smart,.hx-bignum,.hx-tl');
      h.classList.toggle('hx-compact', !hasSide && !hasExtra);
    });
  }
  let t = 0;
  // throttled, not debounced: a page with a ticking clock or live feed still gets checked every half second at most
  const run = () => { if (t) return; t = setTimeout(() => { t = 0;
    const sec = document.querySelector('main > section:not([hidden])'); if (!sec) return;
    sec.querySelectorAll('[data-mxg]').forEach(e => { e.style.removeProperty('color'); e.style.removeProperty('-webkit-text-fill-color'); delete e.dataset.mxg; }); // the theme may have changed
    compact(sec); check(sec, true); check(document.querySelector('nav[aria-label="Main"]') || document.body, true);
    document.querySelectorAll('.hx-ans:not([hidden]),.pc-wrap,.st-drawer.on').forEach(x => check(x, true));
  }, 450); };
  new MutationObserver(muts => { if (muts.some(m => !(m.target instanceof Element && m.target.closest('[data-mxg]')))) run(); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-theme', 'class'] });
  new MutationObserver(run).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.MXGuard = { run, audit: (root = document.querySelector('main > section:not([hidden])')) => check(root, false) };
})();
