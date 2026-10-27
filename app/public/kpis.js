// Today's four number tiles: bookings, revenue, AI-handled share and reply time over the last 14 days, each with
// its sparkline and the change against the 7 days before. Numbers come from /api/kpis (src/metrics.js).
(() => {
  const DAYS = 14;
  const sum = a => a.reduce((x, y) => x + (y || 0), 0);
  const avg = a => { const v = a.filter(x => x != null); return v.length ? sum(v) / v.length : null; };
  const money = n => '$' + Math.round(n || 0).toLocaleString();
  // a, b: this week's and last week's value; lower: true when less is better (reply time)
  const change = (a, b, lower) => {
    if (a == null || b == null || !b) return '';
    const p = Math.round((a - b) / b * 100), good = lower ? p <= 0 : p >= 0;
    return `<i class="kp-chg ${p === 0 ? '' : good ? 'up' : 'down'}">${p > 0 ? '+' : ''}${p}%</i>`;
  };
  function spark(vals) {
    const v = vals.map(x => x || 0), max = Math.max(1, ...v), W = 120, H = 34, step = W / (v.length - 1 || 1);
    const pts = v.map((x, i) => `${(i * step).toFixed(1)},${(H - 3 - x / max * (H - 6)).toFixed(1)}`);
    return `<svg class="kp-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="0,${H} ${pts.join(' ')} ${W},${H}" class="kp-area"/><polyline points="${pts.join(' ')}" class="kp-line"/></svg>`;
  }
  function tiles(rows) {
    const wk = rows.slice(-7), pw = rows.slice(-14, -7), pick = k => rows.map(r => r[k]);
    const share = (set) => { const c = sum(set.map(r => r.chats)); return c ? Math.round(sum(set.map(r => r.handled)) / c * 100) : null; };
    const T = [
      ['Bookings', sum(wk.map(r => r.bookings)), sum(pw.map(r => r.bookings)), pick('bookings'), String, false, 'new this week', 'calendar'],
      ['Revenue', sum(wk.map(r => r.revenue)), sum(pw.map(r => r.revenue)), pick('revenue'), money, false, 'appointments this week', 'analytics'],
      ['AI handled', share(wk), share(pw), rows.map(r => r.chats ? r.handled / r.chats : 0), v => v == null ? '–' : v + '%', false, 'chats with no person needed', 'performance'],
      ['Reply time', avg(wk.map(r => r.reply_ms)), avg(pw.map(r => r.reply_ms)), pick('reply_ms'), v => v == null ? '–' : (v / 1000).toFixed(1) + 's', true, 'average AI reply', 'performance']];
    return T.map(([label, v, p, series, f, lower, sub, go]) => `<button type="button" class="kp" data-kp="${go}">
      <span class="kp-l">${label}</span><span class="kp-v"><b>${f(v)}</b>${change(v, p, lower)}</span>${spark(series)}<small>${sub}</small></button>`).join('');
  }
  async function load() {
    const box = document.getElementById('tdKpis'); if (!box) return;
    try { box.innerHTML = tiles(await req(`/api/kpis?days=${DAYS}`)); }
    catch { box.innerHTML = `<p class="kp-err">Couldn't load your numbers. <button type="button" class="td-link" data-kp="retry">Retry</button></p>`; }
  }
  function mount() {
    const hero = document.querySelector('.today .td-hero'); if (!hero || document.getElementById('tdKpis')) return !!hero;
    hero.insertAdjacentHTML('afterend', '<div class="td-card td-kpis" id="tdKpis" aria-label="This week in numbers"></div>');
    document.getElementById('tdKpis').addEventListener('click', e => {
      const k = e.target.closest('[data-kp]')?.dataset.kp; if (!k) return;
      if (k === 'retry') return load();
      window.openP10?.(k === 'calendar' ? 'calendar' : 'insights', k === 'analytics' ? 1 : 0);
    });
    load(); setInterval(() => !document.hidden && load(), 5 * 60e3);
    return true;
  }
  addEventListener('load', () => { const t = setInterval(() => mount() && clearInterval(t), 300); });
})();
