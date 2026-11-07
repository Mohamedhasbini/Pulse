// MXAi light stream: acid-lime strands flowing in an arc, drawn on a 2D canvas with additive light (no WebGL).
//   MXStream.mount(host, { strength: 0..1, animate: true|false, origin: [x,y], tip: [x,y] })
// The canvas fills its host (host needs position:relative). Animation pauses when off-screen or the tab is hidden,
// and is replaced by one still frame when the visitor prefers reduced motion or animate is false.
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  function mount(host, opt = {}) {
    if (!host || host.querySelector(':scope > canvas.mx-stream')) return;
    const o = Object.assign({ strength: 1, animate: true, origin: [-0.08, 0.95], tip: [1.08, 0.18], strands: 46, color: [200, 247, 81] }, opt);
    const cv = document.createElement('canvas'); cv.className = 'mx-stream'; cv.setAttribute('aria-hidden', 'true');
    host.prepend(cv);
    const ctx = cv.getContext('2d');
    let w = 0, h = 0, raf = 0, t0 = performance.now(), visible = true;
    // each strand: its own offset across the bundle, thickness, brightness and speed, fixed per page load
    const S = Array.from({ length: o.strands }, (_, i) => ({ k: i / (o.strands - 1), off: (Math.random() - 0.5) * 0.9, a: 0.25 + Math.random() * 0.75, sp: 0.6 + Math.random() * 0.8, ph: Math.random() * 6.28 }));
    function size() {
      const r = host.getBoundingClientRect(), dpr = Math.min(1.5, devicePixelRatio || 1);
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function draw(time) {
      const t = (time - t0) / 1000, [r, g, b] = o.color, s = o.strength;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      const x0 = o.origin[0] * w, y0 = o.origin[1] * h, x3 = o.tip[0] * w, y3 = o.tip[1] * h;
      for (const st of S) {
        // the bundle fans out in the middle and pinches at both ends, and breathes slowly over time
        const wave = Math.sin(t * 0.35 * st.sp + st.ph) * 0.06, spread = (st.off + wave) * h * 0.55;
        const x1 = w * 0.32, y1 = h * 0.62 + spread, x2 = w * 0.62, y2 = h * 0.22 - spread * 0.8;
        const grad = ctx.createLinearGradient(x0, y0, x3, y3);
        grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
        grad.addColorStop(0.45, `rgba(${r},${g},${b},${0.10 * st.a * s})`);
        grad.addColorStop(0.75, `rgba(${r},${g},${b},${0.28 * st.a * s})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.strokeStyle = grad; ctx.lineWidth = 0.6 + st.a * 0.9;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3); ctx.stroke();
      }
      // the bright core where the strands gather
      const cx = w * 0.7, cy = h * 0.3, core = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.35);
      core.addColorStop(0, `rgba(${r},${g},${b},${0.16 * s})`); core.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = core; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    const moving = () => o.animate && !reduce.matches;
    function loop(time) { draw(time); if (moving() && visible && !document.hidden) raf = requestAnimationFrame(loop); else raf = 0; }
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    size(); draw(performance.now());
    if (moving()) kick();
    new ResizeObserver(() => { size(); draw(performance.now()); }).observe(host);
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); if (visible && moving()) kick(); }).observe(host);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && moving()) kick(); });
    reduce.addEventListener?.('change', () => { if (moving()) kick(); else draw(performance.now()); });
  }
  window.MXStream = { mount };
  // dashboard background: <script src="/stream.js" data-bg> adds one still, faint stream behind the page (dark mode
  // only, see banner.css). Still on purpose: the dashboard is for work, it should not move behind the numbers.
  const me = document.currentScript;
  if (me && me.hasAttribute('data-bg')) {
    const go = () => { const d = document.createElement('div'); d.className = 'mx-bgstream'; d.setAttribute('aria-hidden', 'true'); document.body.prepend(d);
      mount(d, { strength: 0.42, animate: false, strands: 38, origin: [-0.05, 1.02], tip: [1.05, 0.12] }); };
    document.body ? go() : addEventListener('DOMContentLoaded', go);
  }
})();
