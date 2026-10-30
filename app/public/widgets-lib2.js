// MXAi widget library, volume 2: 24 more designs in the same quiet language (hairlines, thin strokes, one lime point).
// Same data shapes as volume 1, so every design works on every source of that shape:
//   value {v, prev, target, unit}   series {s, cmp, unit}   cats {c:[[label, value]], unit}   matrix {m, rows, cols}   flow {f}
(() => {
  if (!window.WL) return;
  const { L, fmt } = window.WL;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const A = 'var(--pv-lime)', INK = 'var(--pv-ink)', MUTE = 'var(--pv-meta)', LINE = 'var(--pv-line)', TRK = 'var(--pv-track)';
  const tint = p => `color-mix(in srgb,var(--pv-ink) ${Math.round(p)}%,transparent)`;
  const mm = a => [Math.min(...a), Math.max(...a)];
  const sum = a => a.reduce((x, y) => x + y, 0);
  const P = (a, W, H, lo, hi, pad = 8) => a.map((v, i) => [pad + i / Math.max(1, a.length - 1) * (W - pad * 2), H - pad - (v - lo) / ((hi - lo) || 1) * (H - pad * 2)]);
  const smooth = pts => pts.reduce((d, p, i, a) => { if (!i) return `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`; const q = a[i - 1], cx = (q[0] + p[0]) / 2; return d + ` C${cx.toFixed(1)} ${q[1].toFixed(1)} ${cx.toFixed(1)} ${p[1].toFixed(1)} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`; }, '');
  const svg = (W, H, inner, keep = true) => `<svg class="wl-svg${keep ? ' keep' : ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="${keep ? 'xMidYMid meet' : 'none'}">${inner}</svg>`;
  const NS = 'vector-effect="non-scaling-stroke"';
  const head = (v, u, sub) => `<div class="wl-hero sm"><b>${fmt(v, u)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  const short = (t, n = 12) => { t = String(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const share = d => Math.max(0, Math.min(1, d.unit === '%' ? d.v / 100 : d.v / (d.target || 100)));
  const def = (key, name, group, shape, fn) => { L[key] = { key, name, group, shape, render: fn, v2: true }; };

  // ---------- Value ----------
  def('bullet', 'Bullet vs target', 'Value', 'value', d => { const t = d.target || Math.max(d.v, d.prev || 0) * 1.25 || 100, W = 300, x = v => 4 + Math.min(1, v / (t * 1.2)) * (W - 8);
    return head(d.v, d.unit, `target ${fmt(t, d.unit)}`) + svg(W, 46, `<rect x="4" y="12" width="${W - 8}" height="22" rx="11" fill="${TRK}"/><rect x="4" y="12" width="${x(t * .6) - 4}" height="22" rx="11" fill="${tint(6)}"/>
      <rect x="4" y="19" width="${Math.max(6, x(d.v) - 4)}" height="8" rx="4" fill="${INK}"/>${d.prev != null ? `<line x1="${x(d.prev)}" x2="${x(d.prev)}" y1="14" y2="32" stroke="${MUTE}" stroke-width="2" stroke-dasharray="2 2"/>` : ''}
      <line x1="${x(t)}" x2="${x(t)}" y1="8" y2="38" stroke="${INK}" stroke-width="2.5"/><circle cx="${x(t)}" cy="8" r="3.5" fill="${A}" stroke="${INK}"/>`); });
  def('halfdots', 'Dotted arc', 'Value', 'value', d => { const p = share(d), R = [84, 70, 56], out = [];
    R.forEach((r, k) => { const n = Math.round(r / 3.2); for (let i = 0; i < n; i++) { const t = i / (n - 1), a = Math.PI * (1 - t); out.push(`<circle cx="${110 + r * Math.cos(a)}" cy="${104 - r * Math.sin(a)}" r="${2.4 - k * .3}" fill="${t <= p ? (k === 0 && Math.abs(t - p) < 1 / n ? A : INK) : TRK}"${k === 0 && Math.abs(t - p) < 1 / n ? ` stroke="${INK}"` : ''}/>`); } });
    return svg(220, 112, out.join('') + `<text x="110" y="98" text-anchor="middle" class="wl-big">${fmt(d.v, d.unit)}</text>`); });
  def('versus', 'Now vs before', 'Value', 'value', d => { const p = d.prev ?? d.v, mx = Math.max(d.v, p) || 1, ch = p ? (d.v - p) / Math.abs(p) * 100 : 0;
    return `<div class="wl-vs"><div><small>Now</small><b>${fmt(d.v, d.unit)}</b><i style="width:${d.v / mx * 100}%" class="on"></i></div><div><small>Before</small><b>${fmt(p, d.unit)}</b><i style="width:${p / mx * 100}%"></i></div>
      <span class="wl-d ${ch >= 0 !== !!d.down ? 'up' : 'dn'}">${ch >= 0 ? '↑' : '↓'} ${Math.abs(ch).toFixed(1)}%</span></div>`; });
  def('iconarray', 'Hundred dots', 'Value', 'value', d => { const p = Math.round(share(d) * 100);
    return head(d.v, d.unit, `${p} of every 100`) + svg(300, 64, Array.from({ length: 100 }, (_, i) => { const c = i % 25, r = Math.floor(i / 25); return `<circle cx="${8 + c * 11.8}" cy="${8 + r * 15}" r="4" fill="${i < p ? (i === p - 1 ? A : INK) : TRK}"${i === p - 1 ? ` stroke="${INK}"` : ''}/>`; }).join('')); });

  // ---------- Trend ----------
  def('avgbars', 'Columns + average', 'Trend', 'series', d => { const s = d.s.slice(-21), mx = Math.max(...s) || 1, av = sum(s) / s.length, W = 300, H = 120, bw = (W - 16) / s.length, y = v => H - 14 - v / mx * (H - 30);
    return svg(W, H, s.map((v, i) => `<rect x="${8 + i * bw + bw * .3}" y="${y(v)}" width="${bw * .4}" height="${H - 14 - y(v)}" rx="${bw * .2}" fill="${v >= av ? INK : tint(30)}"/>`).join('')
      + `<line x1="6" x2="${W - 6}" y1="${y(av)}" y2="${y(av)}" stroke="${A}" stroke-width="2"/><line x1="6" x2="${W - 6}" y1="${y(av)}" y2="${y(av)}" stroke="${INK}" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"/>
      <text x="${W - 6}" y="${y(av) - 6}" text-anchor="end" class="wl-ax ink">avg ${fmt(av, d.unit)}</text>`, false); });
  def('diffbars', 'Change vs last period', 'Trend', 'series', d => { const s = d.s.slice(-14), c = (d.cmp || []).slice(-14), df = s.map((v, i) => v - (c[i] ?? s[i - 1] ?? v)), mx = Math.max(1, ...df.map(Math.abs)), W = 300, H = 120, mid = H / 2, bw = (W - 16) / df.length;
    return svg(W, H, `<line x1="6" x2="${W - 6}" y1="${mid}" y2="${mid}" stroke="${LINE}"/>` + df.map((v, i) => { const h = Math.abs(v) / mx * (mid - 12); return `<rect x="${8 + i * bw + bw * .28}" y="${v >= 0 ? mid - h : mid}" width="${bw * .44}" height="${Math.max(1.5, h)}" rx="${bw * .22}" fill="${v >= 0 ? INK : tint(28)}"/>`; }).join('')
      + `<text x="8" y="12" class="wl-ax">more</text><text x="8" y="${H - 3}" class="wl-ax">less</text>`, false); });
  def('cumulative', 'Running total', 'Trend', 'series', d => { let t = 0; const run = d.s.map(v => (t += v)); let u = 0; const runC = (d.cmp || []).map(v => (u += v)), [lo, hi] = mm([0, ...run, ...runC]), W = 300, H = 120, p = P(run, W, H, lo, hi), q = runC.length ? P(runC, W, H, lo, hi) : null, e = p[p.length - 1];
    return head(t, d.unit, runC.length ? `vs ${fmt(u, d.unit)} last period` : 'so far') + svg(W, H, `${q ? `<path d="${smooth(q)}" fill="none" stroke="${MUTE}" stroke-width="1.5" stroke-dasharray="3 5" ${NS}/>` : ''}<path d="${smooth(p)} L${e[0]} ${H} L${p[0][0]} ${H}Z" fill="${tint(7)}"/><path d="${smooth(p)}" fill="none" stroke="${INK}" stroke-width="2.2" ${NS}/><circle cx="${e[0]}" cy="${e[1]}" r="4.5" fill="${A}" stroke="${INK}"/>`, false); });
  def('heatstrip', 'Heat strip', 'Trend', 'series', d => { const s = d.s.slice(-30), mx = Math.max(...s) || 1, n = s.length, W = 300, cw = (W - 4) / n;
    return head(s[n - 1], d.unit, `last day · ${n}-day strip`) + svg(W, 44, s.map((v, i) => `<rect x="${2 + i * cw + .8}" y="4" width="${cw - 1.6}" height="28" rx="3" fill="${i === n - 1 ? A : tint(6 + v / mx * 80)}"${i === n - 1 ? ` stroke="${INK}"` : ''}/>`).join('') + `<text x="2" y="43" class="wl-ax">${n} days ago</text><text x="${W - 2}" y="43" text-anchor="end" class="wl-ax">today</text>`); });
  def('histogram', 'Distribution', 'Trend', 'series', d => { const s = d.s, [lo, hi] = mm(s), B = 8, w = (hi - lo) / B || 1, bins = Array(B).fill(0); s.forEach(v => bins[Math.min(B - 1, Math.floor((v - lo) / w))]++); const mx = Math.max(...bins), W = 300, H = 120, bw = (W - 16) / B, top = bins.indexOf(mx);
    return svg(W, H, bins.map((n, i) => `<rect x="${8 + i * bw + 3}" y="${H - 18 - n / mx * (H - 34)}" width="${bw - 6}" height="${n / mx * (H - 34)}" rx="6" fill="${i === top ? INK : tint(24)}"/>${i === top ? `<circle cx="${8 + i * bw + bw / 2}" cy="${H - 26 - n / mx * (H - 34)}" r="3.5" fill="${A}" stroke="${INK}"/>` : ''}`).join('')
      + `<text x="8" y="${H - 3}" class="wl-ax">${fmt(lo, d.unit)}</text><text x="${W - 8}" y="${H - 3}" text-anchor="end" class="wl-ax">${fmt(hi, d.unit)}</text><text x="${W / 2}" y="${H - 3}" text-anchor="middle" class="wl-ax">days by value</text>`); });
  def('dotline', 'Dot plot', 'Trend', 'series', d => { const s = d.s.slice(-30), [lo, hi] = mm(s), W = 300, H = 110, p = P(s, W, H, lo, hi, 10), av = sum(s) / s.length, ay = P([av], W, H, lo, hi, 10)[0][1];
    return svg(W, H, `<line x1="6" x2="${W - 6}" y1="${ay}" y2="${ay}" stroke="${LINE}" stroke-dasharray="2 4"/>` + p.map(([x, y], i) => `<line x1="${x}" x2="${x}" y1="${ay}" y2="${y}" stroke="${tint(18)}"/><circle cx="${x}" cy="${y}" r="${i === p.length - 1 ? 4.5 : 3}" fill="${i === p.length - 1 ? A : s[i] >= av ? INK : 'transparent'}" stroke="${INK}" stroke-width="1.3"/>`).join(''), false); });
  def('weekrange', 'Weekly high and low', 'Trend', 'series', d => { const s = d.s, wk = []; for (let i = Math.max(0, s.length - 56); i < s.length; i += 7) { const w = s.slice(i, i + 7); if (w.length) wk.push([Math.min(...w), Math.max(...w), sum(w) / w.length]); }
    const [lo, hi] = mm(wk.flat()), W = 300, H = 120, y = v => H - 16 - (v - lo) / ((hi - lo) || 1) * (H - 28), bw = (W - 16) / wk.length;
    return svg(W, H, wk.map(([a, b, m], i) => { const x = 8 + i * bw + bw / 2; return `<line x1="${x}" x2="${x}" y1="${y(b)}" y2="${y(a)}" stroke="${tint(30)}" stroke-width="10" stroke-linecap="round"/><circle cx="${x}" cy="${y(m)}" r="4" fill="${i === wk.length - 1 ? A : INK}" stroke="${INK}"/><text x="${x}" y="${H - 2}" text-anchor="middle" class="wl-ax">W${i + 1}</text>`; }).join('')); });
  def('streak', 'Above or below average', 'Trend', 'series', d => { const s = d.s.slice(-28), av = sum(s) / s.length, up = s.filter(v => v >= av).length;
    return head(up, '', `of ${s.length} days above average`) + `<div class="wl-streak">${s.map((v, i) => `<i class="${v >= av ? 'on' : ''}${i === s.length - 1 ? ' last' : ''}" title="${fmt(v, d.unit)}"></i>`).join('')}</div>`; });
  def('bandline', 'Line in its usual range', 'Trend', 'series', d => { const s = d.s, k = 5, lo2 = [], hi2 = []; s.forEach((_, i) => { const w = s.slice(Math.max(0, i - k), i + 1), m = sum(w) / w.length, sd = Math.sqrt(sum(w.map(v => (v - m) ** 2)) / w.length); lo2.push(m - sd); hi2.push(m + sd); });
    const [lo, hi] = mm([...s, ...lo2, ...hi2]), W = 300, H = 120, p = P(s, W, H, lo, hi), a = P(hi2, W, H, lo, hi), b = P(lo2, W, H, lo, hi), e = p[p.length - 1];
    return svg(W, H, `<path d="${smooth(a)} L${b.slice().reverse().map(q => q.join(' ')).join(' L')}Z" fill="${tint(8)}"/><path d="${smooth(p)}" fill="none" stroke="${INK}" stroke-width="2" ${NS}/><circle cx="${e[0]}" cy="${e[1]}" r="4" fill="${A}" stroke="${INK}"/>`, false)
      + `<div class="wl-leg"><span><i style="background:${INK}"></i>Daily</span><span><i style="background:${tint(20)}"></i>Usual range</span></div>`; });

  // ---------- Mix ----------
  def('radar', 'Radar', 'Mix', 'cats', d => { const c = d.c.slice(0, 7); if (c.length < 3) return L.capsules.render(d); const n = c.length, mx = Math.max(...c.map(x => x[1])) || 1, cx = 130, cy = 104, R = 78, pt = (i, r) => [cx + r * Math.sin(i / n * 2 * Math.PI), cy - r * Math.cos(i / n * 2 * Math.PI)];
    const rings = [.33, .66, 1].map(k => `<polygon points="${c.map((_, i) => pt(i, R * k).join(',')).join(' ')}" fill="none" stroke="${LINE}"/>`).join(''), shape = c.map(([, v], i) => pt(i, R * v / mx));
    return svg(260, 210, rings + c.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, R)[0]}" y2="${pt(i, R)[1]}" stroke="${LINE}"/>`).join('') + `<polygon points="${shape.map(p => p.join(',')).join(' ')}" fill="${tint(12)}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`
      + shape.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i ? 3 : 4.5}" fill="${i ? INK : A}" stroke="${INK}"/>`).join('') + c.map(([l], i) => { const [x, y] = pt(i, R + 16); return `<text x="${x}" y="${y + 4}" text-anchor="${x < cx - 5 ? 'end' : x > cx + 5 ? 'start' : 'middle'}" class="wl-ax">${esc(short(l, 11))}</text>`; }).join('')); });
  def('rose', 'Rose', 'Mix', 'cats', d => { const c = d.c.slice(0, 8), n = c.length, mx = Math.max(...c.map(x => x[1])) || 1, cx = 110, cy = 100, R = 86;
    const arc = (i, r) => { const a0 = i / n * 2 * Math.PI + .04, a1 = (i + 1) / n * 2 * Math.PI - .04, p = a => [cx + r * Math.sin(a), cy - r * Math.cos(a)], [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}Z`; };
    return `<div class="wl-split">${svg(220, 200, `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${LINE}"/>` + c.map(([, v], i) => `<path d="${arc(i, 14 + (R - 14) * Math.sqrt(v / mx))}" fill="${i ? tint(70 - i * 7) : A}" stroke="${i ? 'none' : INK}"/>`).join(''))}
      <div class="wl-caps">${c.slice(0, 5).map(([l, v]) => `<div><span>${esc(l)}</span><b>${fmt(v, d.unit)}</b></div>`).join('')}</div></div>`; });
  def('pareto', 'Pareto: what drives most', 'Mix', 'cats', d => { const c = [...d.c].sort((a, b) => b[1] - a[1]).slice(0, 8), t = sum(c.map(x => x[1])) || 1, mx = c[0]?.[1] || 1, W = 300, H = 140, bw = (W - 16) / c.length; let run = 0; const cum = c.map(x => (run += x[1]) / t);
    const k80 = cum.findIndex(v => v >= .8), line = cum.map((v, i) => [8 + i * bw + bw / 2, 14 + (1 - v) * (H - 44)]);
    return svg(W, H, c.map(([l, v], i) => `<rect x="${8 + i * bw + bw * .22}" y="${H - 30 - v / mx * (H - 48)}" width="${bw * .56}" height="${v / mx * (H - 48)}" rx="${bw * .14}" fill="${i <= k80 ? INK : tint(24)}"/><text x="${8 + i * bw + bw / 2}" y="${H - 16}" text-anchor="middle" class="wl-ax">${esc(short(l, 6))}</text>`).join('')
      + `<path d="${line.map((p, i) => (i ? 'L' : 'M') + p.join(' ')).join(' ')}" fill="none" stroke="${MUTE}" stroke-width="1.6"/>${line.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === k80 ? 4.5 : 2.5}" fill="${i === k80 ? A : 'var(--pv-card,#fff)'}" stroke="${INK}"/>`).join('')}
      <text x="${W - 8}" y="${H - 2}" text-anchor="end" class="wl-ax ink">${k80 + 1} of ${c.length} make 80%</text>`); });
  def('leader', 'Leaderboard', 'Mix', 'cats', d => { const c = [...d.c].sort((a, b) => b[1] - a[1]).slice(0, 6), t = sum(d.c.map(x => x[1])) || 1, mx = c[0]?.[1] || 1;
    return `<div class="wl-lead">${c.map(([l, v], i) => `<div class="${i ? '' : 'top'}"><span class="n">${i + 1}</span><span class="l">${esc(l)}</span><span class="bar"><i style="width:${v / mx * 100}%"></i></span><b>${fmt(v, d.unit)}</b><small>${Math.round(v / t * 100)}%</small></div>`).join('')}</div>`; });
  def('gapdonut', 'Segmented ring', 'Mix', 'cats', d => { const c = d.c.slice(0, 6), t = sum(c.map(x => x[1])) || 1, R = 70, C = 2 * Math.PI * R, gap = 6; let off = 0;
    const segs = c.map(([, v], i) => { const len = Math.max(0, v / t * C - gap), s = `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${i ? tint(72 - i * 11) : A}" stroke-width="${i ? 10 : 14}" stroke-linecap="round" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"/>`; off += v / t * C; return s; }).join('');
    return `<div class="wl-split">${svg(180, 180, segs + `<text x="90" y="88" text-anchor="middle" class="wl-big">${fmt(t, d.unit)}</text><text x="90" y="108" text-anchor="middle" class="wl-ax">total</text>`)}
      <div class="wl-caps">${c.slice(0, 5).map(([l, v], i) => `<div><span><i class="wl-sw" style="background:${i ? tint(72 - i * 11) : A}"></i>${esc(l)}</span><b>${Math.round(v / t * 100)}%</b></div>`).join('')}</div></div>`; });
  def('hlolli', 'Horizontal lollipops', 'Mix', 'cats', d => { const c = d.c.slice(0, 7), mx = Math.max(...c.map(x => x[1])) || 1, W = 300, rh = 26, H = c.length * rh + 6, x0 = 104;
    return svg(W, H, c.map(([l, v], i) => { const y = 14 + i * rh, x = x0 + v / mx * (W - x0 - 46); return `<text x="0" y="${y + 4}" class="wl-ax">${esc(short(l, 15))}</text><line x1="${x0}" x2="${x}" y1="${y}" y2="${y}" stroke="${tint(30)}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="${i ? 5 : 6}" fill="${i ? INK : A}" stroke="${INK}"/><text x="${x + 10}" y="${y + 4}" class="wl-ax ink">${fmt(v, d.unit)}</text>`; }).join('')); });
  def('stackcol', 'One stacked column', 'Mix', 'cats', d => { const c = d.c.slice(0, 6), t = sum(c.map(x => x[1])) || 1; let y = 6;
    return `<div class="wl-split">${svg(90, 200, c.map(([, v], i) => { const h = v / t * 188, r = `<rect x="22" y="${y + 1}" width="46" height="${Math.max(0, h - 2)}" rx="8" fill="${i ? tint(70 - i * 11) : A}" stroke="${i ? 'none' : INK}"/>`; y += h; return r; }).join(''))}
      <div class="wl-caps">${c.map(([l, v], i) => `<div><span><i class="wl-sw" style="background:${i ? tint(70 - i * 11) : A}"></i>${esc(l)}</span><b>${fmt(v, d.unit)}</b></div>`).join('')}</div></div>`; });

  // ---------- Time ----------
  def('punchcard', 'Punch card', 'Time', 'matrix', d => { const m = d.m, rows = d.rows || [], cols = d.cols || [], mx = Math.max(1, ...m.flat()), cw = 252 / Math.max(1, m[0]?.length || 1), rh = 22, W = 300, H = m.length * rh + 22; let peak = [0, 0]; m.forEach((r, i) => r.forEach((v, j) => { if (v > m[peak[0]][peak[1]]) peak = [i, j]; }));
    return svg(W, H, m.map((r, i) => `<text x="0" y="${14 + i * rh}" class="wl-ax">${esc(short(rows[i] ?? '', 4))}</text>` + r.map((v, j) => { const pk = i === peak[0] && j === peak[1]; return `<circle cx="${44 + j * cw + cw / 2}" cy="${10 + i * rh}" r="${v ? 1.5 + Math.sqrt(v / mx) * Math.min(cw, rh) * .42 : 1}" fill="${pk ? A : v ? INK : TRK}"${pk ? ` stroke="${INK}"` : ''} opacity="${pk ? 1 : .35 + .65 * v / mx}"/>`; }).join('')).join('')
      + cols.map((c, j) => j % Math.ceil(cols.length / 8) ? '' : `<text x="${44 + j * cw + cw / 2}" y="${H - 2}" text-anchor="middle" class="wl-ax">${esc(c)}</text>`).join('')); });
  def('heattable', 'Heat table', 'Time', 'matrix', d => { const m = d.m, rows = d.rows || [], cols = d.cols || [], mx = Math.max(1, ...m.flat()), step = Math.ceil((m[0]?.length || 1) / 8), pick = (m[0] || []).map((_, j) => j).filter(j => j % step === 0);
    return `<table class="wl-t wl-ht"><thead><tr><th></th>${pick.map(j => `<th>${esc(cols[j] ?? j)}</th>`).join('')}</tr></thead><tbody>${m.map((r, i) => `<tr><td class="m">${esc(rows[i] ?? '')}</td>${pick.map(j => { const v = sum(r.slice(j, j + step)); return `<td style="--h:${Math.round(v / (mx * step) * 100)}%">${v || ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`; });
  def('peakrows', 'Busiest hour per day', 'Time', 'matrix', d => { const m = d.m, rows = d.rows || [], cols = d.cols || [], tot = m.map(r => sum(r)), mx = Math.max(1, ...tot);
    return `<div class="wl-lead">${m.map((r, i) => { const j = r.indexOf(Math.max(...r)); return `<div class="${tot[i] === mx ? 'top' : ''}"><span class="l">${esc(rows[i] ?? '')}</span><span class="bar"><i style="width:${tot[i] / mx * 100}%"></i></span><b>${tot[i]}</b><small>peak ${esc(cols[j] ?? '—')}</small></div>`; }).join('')}</div>`; });

  // ---------- Flow ----------
  def('flowtable', 'Route table', 'Flow', 'flow', d => { const f = [...d.f].sort((a, b) => b[2] - a[2]).slice(0, 7), t = sum(d.f.map(x => x[2])) || 1, mx = f[0]?.[2] || 1;
    return `<table class="wl-t"><tbody>${f.map(([a, b, n], i) => `<tr><td>${esc(a)}</td><td class="m">→</td><td>${esc(b)}</td><td class="r"><b>${n}</b></td><td class="w"><div class="wl-cap thin"><i style="width:${n / mx * 100}%;${i ? '' : 'background:' + A + ';box-shadow:inset 0 0 0 1px ' + INK}"></i></div></td><td class="r m">${Math.round(n / t * 100)}%</td></tr>`).join('')}</tbody></table>`; });
  def('outcomebars', 'Outcome by source', 'Flow', 'flow', d => { const from = [...new Set(d.f.map(x => x[0]))].slice(0, 5), to = [...new Set(d.f.map(x => x[1]))].slice(0, 4), col = i => i ? tint(66 - i * 16) : A;
    return `<div class="wl-ob">${from.map(a => { const r = to.map(b => d.f.filter(x => x[0] === a && x[1] === b).reduce((s, x) => s + x[2], 0)), t = sum(r) || 1; return `<div><span>${esc(a)}</span><div class="wl-strip">${r.map((v, i) => `<i style="flex:${v};background:${col(i)}" title="${esc(to[i])}: ${v}"></i>`).join('')}</div><b>${t}</b></div>`; }).join('')}</div>`
      + `<div class="wl-leg">${to.map((b, i) => `<span><i style="background:${col(i)}"></i>${esc(b)}</span>`).join('')}</div>`; });

  // ---------- Table ----------
  def('deltatable', 'Table with change', 'Table', 'cats', d => { const c = d.c.slice(0, 7), t = sum(c.map(x => x[1])) || 1, av = t / (c.length || 1);
    return `<table class="wl-t"><thead><tr><th>Name</th><th class="r">Value</th><th class="r">Share</th><th class="r">vs average</th></tr></thead><tbody>${c.map(([l, v]) => { const dv = (v - av) / (av || 1) * 100; return `<tr><td>${esc(l)}</td><td class="r"><b>${fmt(v, d.unit)}</b></td><td class="r">${Math.round(v / t * 100)}%</td><td class="r"><span class="wl-d ${dv >= 0 ? 'up' : 'dn'}">${dv >= 0 ? '↑' : '↓'} ${Math.abs(dv).toFixed(0)}%</span></td></tr>`; }).join('')}</tbody></table>`; });
  def('statrow', 'Statistics row', 'Table', 'series', d => { const s = d.s, srt = [...s].sort((a, b) => a - b), med = srt[Math.floor(srt.length / 2)], av = sum(s) / (s.length || 1), best = Math.max(...s), last = s[s.length - 1];
    return `<div class="wl-kg wl-kg5">${[['Latest', last, 1], ['Average', av], ['Median', med], ['Best day', best], ['Total', sum(s)]].map(([l, v, on]) => `<div><small>${l}</small><b>${fmt(v, d.unit)}</b>${on ? `<em style="background:${A}"></em>` : ''}</div>`).join('')}</div>`; });
})();
