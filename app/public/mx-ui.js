// MXAi components: small functions that return one card's HTML in the shared anatomy
// (title, primary number, context, trend, explanation, optional action) and one of six states.
// Pages compose these on the 12-column grid in mx-ui.css instead of drawing their own cards.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // line icons (24px grid, 1.6 stroke): every card gets one, picked from its title, so cards scan like a toolbar
  const P = {
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="4"/><path d="M12 4v4M9 13h.01M15 13h.01"/>',
    money: '<path d="M12 2v20M17 6.5C17 4.6 14.8 4 12 4S7 5 7 7.5 9.5 10.5 12 11s5 1.5 5 4-2.2 3.5-5 3.5-5-.9-5-3"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>',
    book: '<path d="M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2Z"/><path d="M8 7h8"/>',
    rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-1 6-1 6-1s0 3-1 6l-7 7-5-5Z"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>' };
  const PICK = [[/attention|teach|question/i, 'alert'], [/appointment|booked ahead|calendar/i, 'cal'], [/recommend/i, 'spark'], [/conversation|chat/i, 'chat'],
    [/time booked|reply|hours/i, 'clock'], [/goal|month/i, 'target'], [/offer|sent|campaign/i, 'send'], [/revenue|value|won|discount|\$/i, 'money'],
    [/client|customer|came back|agreed/i, 'users'], [/booking/i, 'book'], [/go live|setup/i, 'rocket'], [/health/i, 'heart'], [/today|nora|ai|oracle/i, 'bot']];
  const icon = (title, name) => { const k = name || (PICK.find(([re]) => re.test(title)) || [, 'chart'])[1];
    return `<span class="mx-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${P[k]}</svg></span>`; };
  const STATE = { healthy: 'Healthy', improving: 'Improving', neutral: '', warning: 'Needs a look', critical: 'Act today', empty: '' };
  // size: compact | standard | wide (min heights); span: grid columns
  const card = ({ title, meta = '', link = '', state = 'neutral', size = 'standard', span = 4, cls = '', body = '', label = '' }) =>
    `<section class="mx-card ${size} mx-c${span} ${cls}" data-state="${state}" aria-label="${esc(label || title)}">
      <header class="mx-hd">${title.trim() ? icon(title) : ''}<h3>${esc(title)}</h3>${STATE[state] ? `<span class="mx-state">${STATE[state]}</span>` : ''}${meta ? `<span class="mx-meta">${meta}</span>` : ''}${link}</header>${body}</section>`;
  const trend = (pct, { lowerIsBetter = false, suffix = '%', vs = '' } = {}) => {
    if (pct == null || !isFinite(pct)) return '';
    const good = lowerIsBetter ? pct < 0 : pct > 0, cls = pct === 0 ? 'flat' : good ? 'up' : 'down';
    return `<span class="mx-trend ${cls}"${vs ? ` title="${esc(vs)}"` : ''}>${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(Math.round(pct))}${suffix}</span>`;
  };
  const button = (label, go, kind = '') => `<button type="button" class="mx-btn ${kind}" data-go="${esc(go)}">${esc(label)}</button>`;
  const link = (label, go) => `<button type="button" class="mx-link" data-go="${esc(go)}">${esc(label)} →</button>`;
  // a row: dot state, title, sub line, and a value or button on the right
  const row = ({ dot = '', time = '', title, sub = '', value = '', action = '', go = '', cls = '' }) =>
    `<div class="mx-row ${cls}"${go && !action ? ` role="button" tabindex="0" data-go="${esc(go)}" style="cursor:pointer"` : ''}>${dot ? `<i class="mx-dot ${dot}"></i>` : ''}${time ? `<span class="mx-time">${esc(time)}</span>` : ''}
      <span class="mx-tx"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${value ? `<span class="mx-val">${esc(value)}</span>` : ''}${action}</div>`;
  const empty = (title, sub = '', action = '') => `<div class="mx-empty"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}${action}</div>`;
  const loading = (lines = 3) => `<div class="mx-list" aria-busy="true">${Array.from({ length: lines }, () => '<div class="mx-skel" style="height:18px;margin:8px 0"></div>').join('')}</div>`;
  const error = (what, retry = '') => `<div class="mx-err" role="alert"><span>Couldn't load ${esc(what)}.</span>${retry ? button('Retry', retry) : ''}</div>`;

  const MXUI = {
    esc, card, trend, button, link, row, empty, loading, error,
    // KPI: one figure with what it is out of, its trend and why it moved
    kpi: ({ title, value, ctx = '', change = null, lowerIsBetter = false, vs = 'vs last period', why = '', state = 'neutral', span = 3, action = '' }) =>
      card({ title, state, size: 'compact', span, body: `<div class="mx-numrow"><span class="mx-num">${esc(value)}</span>${trend(change, { lowerIsBetter, vs })}</div><div class="mx-ctx">${esc(ctx)}${change != null && isFinite(change) && vs ? ` · ${esc(vs)}` : ''}</div>${why ? `<p class="mx-why">${esc(why)}</p>` : ''}${action ? `<div class="mx-foot">${action}</div>` : ''}` }),
    // meter: a share with its explanation, e.g. "74% of your available time is booked"
    meter: ({ title, pct, ctx, why = '', state = 'neutral', span = 3, action = '' }) =>
      card({ title, state, size: 'compact', span, body: `<div class="mx-numrow"><span class="mx-num">${Math.round(pct)}%</span></div><div class="mx-meter"><u style="width:${Math.max(0, Math.min(100, pct))}%"></u></div><div class="mx-ctx">${esc(ctx)}</div>${why ? `<p class="mx-why">${esc(why)}</p>` : ''}${action ? `<div class="mx-foot">${action}</div>` : ''}` }),
    // list: rows with an optional "See all" link; the empty text says what will appear
    list: ({ title, rows, meta = '', more = '', go = '', state = 'neutral', span = 6, size = 'standard', emptyTitle = 'Nothing here yet', emptySub = '' }) =>
      card({ title, meta, state, size, span, link: go ? link('See all', go) : '', body: `<div class="mx-list">${rows.length ? rows.join('') : empty(emptyTitle, emptySub)}</div>${more ? `<p class="mx-more">${esc(more)}</p>` : ''}` }),
    // the one recommended action: what to do, why, and the button that does it
    rec: ({ text, why = '', label = 'Do it', go = '', span = 3 }) =>
      card({ title: 'Recommended action', size: 'standard', span, cls: 'mx-rec', body: `<p class="mx-rec-t">${esc(text)}</p>${why ? `<p class="mx-why">${esc(why)}</p>` : ''}${go ? `<div class="mx-foot">${button(label, go, 'sig')}</div>` : ''}` }),
    // strip: four figures in one full-width row
    strip: ({ title, items, meta = '', go = '' }) =>
      card({ title, meta, size: 'compact', span: 12, link: go ? link('Insights', go) : '', body: `<div class="mx-strip">${items.map(([l, v, t]) => `<div><span>${esc(l)}</span><b>${esc(v)}</b>${t || ''}</div>`).join('')}</div>` }),
  };
  // ── library additions (Nov 2026): the patterns calm admin dashboards use, drawn in our own tokens
  const tone = pct => pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'healthy';
  Object.assign(MXUI, {
    // segmented control: a fused row of choices, e.g. Day / Week / Month; the chosen one is a raised tile
    segmented: (items, active, name = '') => `<div class="mx-seg" role="tablist"${name ? ` aria-label="${esc(name)}"` : ''}>${items.map(([v, l]) =>
      `<button type="button" role="tab" aria-selected="${v === active}" data-seg="${esc(v)}">${esc(l)}</button>`).join('')}</div>`,
    // chip: a small status word; the tone carries meaning and the word says it, so colour is never the only signal
    chip: (label, kind = 'neutral') => `<span class="mx-chip ${kind}">${esc(label)}</span>`,
    // usage meter toned as it fills: calm under 75%, amber to 90%, red beyond
    usage: ({ label, value, max, unit = '' }) => { const pct = max ? Math.min(100, value / max * 100) : 0;
      return `<div class="mx-use ${tone(pct)}"><div class="mx-use-hd"><span>${esc(label)}</span><b>${Math.round(pct)}%</b></div><div class="mx-meter"><u style="width:${pct}%"></u></div><small>${esc(value)}${unit} of ${esc(max)}${unit}</small></div>`; },
    // bar list: ranked rows with a bar behind the label, the value on the right
    barList: (rows, fmt = v => v) => { const top = Math.max(1, ...rows.map(r => r.value));
      return `<div class="mx-bars">${rows.map(r => `<div class="mx-bar"><i style="width:${Math.max(4, r.value / top * 100)}%"></i><span>${esc(r.label)}</span><b>${esc(fmt(r.value))}</b></div>`).join('')}</div>`; },
    // funnel: each step's share of the first, with the drop between steps written out
    funnel: steps => { const first = Math.max(1, steps[0]?.value || 1);
      return `<div class="mx-fun">${steps.map((st, i) => { const pct = st.value / first * 100, prev = steps[i - 1];
        return `<div class="mx-fun-s"><div class="mx-fun-col"><i style="height:${Math.max(6, pct)}%"></i></div><b>${esc(st.value)}</b><span>${esc(st.label)}</span>${prev && prev.value ? `<small>${Math.round(st.value / prev.value * 100)}% of previous</small>` : '<small>start</small>'}</div>`; }).join('')}</div>`; },
    // radial gauge: one share as a ring, the figure in the middle
    radial: ({ pct, label = '', size = 120 }) => { const r = 52, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct));
      return `<div class="mx-rad" style="width:${size}px;height:${size}px" role="img" aria-label="${Math.round(v)}% ${esc(label)}"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" class="tr"/><circle cx="60" cy="60" r="${r}" class="fg" stroke-dasharray="${c * v / 100} ${c}"/></svg><span><b>${Math.round(v)}%</b>${label ? `<small>${esc(label)}</small>` : ''}</span></div>`; },
    // spark bars: a small row of bars for a trend inside a card, the last bar is today
    sparkBars: (vals, h = 40) => { const top = Math.max(1, ...vals);
      return `<div class="mx-spark" style="height:${h}px" aria-hidden="true">${vals.map((v, i) => `<i class="${i === vals.length - 1 ? 'now' : ''}" style="height:${Math.max(6, v / top * 100)}%"></i>`).join('')}</div>`; },
    // stage bars: one bar split into stages, with a legend that names each stage and its count
    stages: parts => { const tot = Math.max(1, parts.reduce((s, p) => s + p.value, 0));
      return `<div class="mx-stg"><div class="mx-stg-bar">${parts.map((p, i) => `<i class="s${i}" style="flex:${p.value || 0.0001}"></i>`).join('')}</div><div class="mx-stg-key">${parts.map((p, i) => `<span><i class="s${i}"></i>${esc(p.label)} <b>${esc(p.value)}</b> <small>${Math.round(p.value / tot * 100)}%</small></span>`).join('')}</div></div>`; },
    // toast: a short message at the bottom corner that leaves by itself
    toast: (text, kind = 'neutral') => { const t = document.createElement('div'); t.className = `mx-toast ${kind}`; t.setAttribute('role', 'status'); t.textContent = text;
      document.body.appendChild(t); requestAnimationFrame(() => t.classList.add('on')); setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 250); }, 3200); },
    // thinking: three dots for an answer on its way
    thinking: (label = 'Thinking') => `<span class="mx-think" role="status"><i></i><i></i><i></i><span>${esc(label)}</span></span>`,
  });
  // ── charts for summary pages: columns with a value axis, a soft area line, a dot heatmap and a plain table
  const nice = v => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
  const short = v => v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(Math.round(v));
  const axis = (top, pre) => [1, .5, 0].map(f => `<span>${pre}${short(top * f)}</span>`).join('');
  Object.assign(MXUI, {
    // columns: each bar is its value against a rounded top; the track behind shows the room left; the last bar is "now"
    columns: (pts, { pre = '', h = 200 } = {}) => { const top = nice(Math.max(1, ...pts.map(p => p.v)));
      return `<div class="mx-cols" style="--h:${h}px"><div class="mx-axis">${axis(top, pre)}</div><div class="mx-cols-in">${pts.map((p, i) =>
        `<div class="mx-col${i === pts.length - 1 ? ' now' : ''}" title="${esc(p.l)}: ${esc(pre + Math.round(p.v).toLocaleString())}"><div class="mx-col-t"><i style="height:${Math.max(p.v ? 3 : 0, p.v / top * 100)}%"></i></div><span>${esc(p.l)}</span></div>`).join('')}</div></div>`; },
    // area: one line with a soft fill under it, value axis on the left, a few date labels under it
    area: (vals, labels = [], { pre = '', h = 200 } = {}) => { const top = nice(Math.max(1, ...vals)), n = Math.max(1, vals.length - 1);
      const pt = vals.map((v, i) => `${(i / n * 100).toFixed(2)},${(100 - v / top * 100).toFixed(2)}`).join(' ');
      const tick = labels.length ? labels.filter((_, i) => i % Math.ceil(labels.length / 6) === 0 || i === labels.length - 1) : [];
      return `<div class="mx-area" style="--h:${h}px"><div class="mx-axis">${axis(top, pre)}</div><div class="mx-area-in"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="0,100 ${pt} 100,100" class="f"/><polyline points="${pt}" class="l" vector-effect="non-scaling-stroke"/></svg>
        <div class="mx-xl">${tick.map(t => `<span>${esc(t)}</span>`).join('')}</div></div></div>`; },
    // heat: rows × columns of dots, darker = busier; rows and columns are labelled
    heat: (grid, rows, cols) => { const top = Math.max(1, ...grid.flat());
      return `<div class="mx-heat" style="--c:${cols.length}"><span></span>${cols.map(c => `<b>${esc(c)}</b>`).join('')}${grid.map((r, i) => `<b>${esc(rows[i])}</b>${r.map(v =>
        `<i style="--a:${v ? .18 + .82 * v / top : 0}" title="${v}"></i>`).join('')}`).join('')}</div>`; },
    // table: header, rows of cells; a cell may be HTML (chips) when marked {html}
    table: (head, rows, empty = 'Nothing here yet') => rows.length ? `<div class="mx-tbl"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r =>
      `<tr${r.go ? ` data-go="${esc(r.go)}" tabindex="0"` : ''}>${r.cells.map(c => `<td>${c && c.html != null ? c.html : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : MXUI.empty(empty),
  });
  // rings: concentric arcs, one per item (largest first), each its share of the total, with a legend beside
  const SER = ['var(--mx-s1)', 'var(--mx-s2)', 'var(--mx-s3)', 'var(--mx-s4)', 'var(--mx-s5)'];
  MXUI.rings = (items, fmt = v => v) => { const tot = Math.max(1, items.reduce((s, x) => s + x.value, 0)), list = items.slice(0, 5);
    return `<div class="mx-rings"><svg viewBox="0 0 170 170" aria-hidden="true">${list.map((x, i) => { const r = 78 - i * 14, c = 2 * Math.PI * r;
      return `<circle cx="85" cy="85" r="${r}" class="tr"/><circle cx="85" cy="85" r="${r}" stroke="${SER[i]}" stroke-dasharray="${Math.max(2, c * x.value / tot)} ${c}"/>`; }).join('')}</svg>
      <div class="mx-key">${list.map((x, i) => `<span><i style="background:${SER[i]}"></i>${esc(x.label)} <small>${Math.round(x.value / tot * 100)}%</small><b>${esc(fmt(x.value))}</b></span>`).join('')}</div></div>`; };
  // the area fill gradient is defined once per page
  if (typeof document !== 'undefined' && document.body && !document.getElementById('mxDefs')) document.body.insertAdjacentHTML('beforeend', '<svg id="mxDefs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="mxAreaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--mx-s1)" stop-opacity=".35"/><stop offset="1" stop-color="var(--mx-s1)" stop-opacity="0"/></linearGradient></defs></svg>');
  // ── finance charts (after the BoardUI finance and marketing templates)
  // sankey labels: each centred on its band, then moved apart (34px apart at least) and kept inside the chart
function spread(nodes, h, lh = 34) {
  const out = nodes.map(n => [n, Math.min(Math.max(0, n.y + n.hgt / 2 - lh / 2), h - lh)]);
  for (let i = 1; i < out.length; i++) out[i][1] = Math.max(out[i][1], out[i - 1][1] + lh);
  for (let i = out.length - 1; i >= 0; i--) { const max = i === out.length - 1 ? h - lh : out[i + 1][1] - lh; out[i][1] = Math.max(0, Math.min(out[i][1], max)); }
  return out;
}
const SERIES = ['var(--mx-s1)', 'var(--mx-s2)', 'var(--mx-s3)', 'var(--mx-s4)', 'var(--mx-s5)'];
  const cash = v => '$' + Math.round(v || 0).toLocaleString();
  Object.assign(MXUI, {
    // sankey: sources on the left, destinations on the right, each link as wide as its money
    sankey: ({ ins, outs, links }, { h = 320, fmt = cash } = {}) => {
      const W = 1000, pad = 10, tin = ins.reduce((s, x) => s + x.value, 0) || 1, tout = outs.reduce((s, x) => s + x.value, 0) || 1;
      const scaleIn = (h - pad * (ins.length - 1)) / tin, scaleOut = (h - pad * (outs.length - 1)) / tout;
      let y = 0; const L = ins.map((n, i) => { const o = { ...n, y, hgt: Math.max(2, n.value * scaleIn), c: SERIES[i % 5], off: 0 }; y += o.hgt + pad; return o; });
      y = 0; const R = outs.map(n => { const o = { ...n, y, hgt: Math.max(2, n.value * scaleOut), off: 0 }; y += o.hgt + pad; return o; });
      const paths = links.filter(l => l.value > 0).map(l => { const a = L.find(n => n.label === l.from), b = R.find(n => n.label === l.to); if (!a || !b) return '';
        const ha = l.value * scaleIn, hb = l.value * scaleOut, y0 = a.y + a.off + ha / 2, y1 = b.y + b.off + hb / 2; a.off += ha; b.off += hb;
        return `<path d="M 160 ${y0} C 500 ${y0}, 500 ${y1}, 840 ${y1}" stroke="${a.c}" stroke-width="${Math.max(1, (ha + hb) / 2)}" fill="none" opacity=".32"><title>${esc(l.from)} → ${esc(l.to)}: ${fmt(l.value)}</title></path>`; }).join('');
      return `<div class="mx-sankey"><svg viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" role="img" aria-label="Where the money goes">${paths}
        ${L.map(n => `<rect x="152" y="${n.y}" width="8" height="${n.hgt}" rx="3" fill="${n.c}"/>`).join('')}${R.map(n => `<rect x="840" y="${n.y}" width="8" height="${n.hgt}" rx="3" fill="${n.label === 'Profit' ? 'var(--mx-s1)' : 'var(--mx-mute)'}"/>`).join('')}</svg>
        <div class="mx-sk-l">${spread(L, h).map(([n, t]) => `<span class="sk-lab" style="top:${t / h * 100}%;height:${34 / h * 100}%"><b>${esc(n.label)}</b><small>${fmt(n.value)}</small></span>`).join('')}</div>
        <div class="mx-sk-r">${spread(R, h).map(([n, t]) => `<span class="sk-lab" style="top:${t / h * 100}%;height:${34 / h * 100}%"><b>${esc(n.label)}</b><small>${Math.round(n.value / tout * 100)}%</small></span>`).join('')}</div>
        <div class="mx-sk-ax"><span>Income</span><span>Spending</span></div></div>`; },
    // gauge: a half ring split into segments, the lead share in the middle, a legend with amounts under it
    gauge: (items, { fmt = cash, center = '' } = {}) => {
      const tot = items.reduce((s, x) => s + x.value, 0) || 1, R = 80, C = Math.PI * R, gap = 6; let off = 0;
      const arcs = items.slice(0, 5).map((x, i) => { const len = Math.max(0, x.value / tot * C - gap); const d = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${SERIES[i]}" stroke-width="22" stroke-linecap="round" stroke-dasharray="${len} ${2 * Math.PI * R}" stroke-dashoffset="${-off}" transform="rotate(180 100 100)"/>`; off += x.value / tot * C; return d; }).join('');
      const lead = items[0];
      return `<div class="mx-gauge"><svg viewBox="0 0 200 112" aria-hidden="true"><circle cx="100" cy="100" r="${R}" fill="none" class="tr" stroke-width="22" stroke-dasharray="${C} ${2 * C}" transform="rotate(180 100 100)"/>${arcs}</svg>
        <div class="mx-gauge-c"><b>${lead ? Math.round(lead.value / tot * 100) : 0}%</b><small>${esc(center || lead?.label || '')}</small></div>
        <div class="mx-gauge-k">${items.slice(0, 5).map((x, i) => `<span><i style="background:${SERIES[i]}"></i>${esc(x.label)} <b>${fmt(x.value)}</b></span>`).join('')}</div></div>`; },
    // flow funnel: each step a band as tall as its count, joined to the next, with its share of the first
    flowFunnel: steps => {
      const top = Math.max(1, steps[0]?.value || 1), W = 100 / steps.length;
      const bands = steps.map((s, i) => { const h = Math.max(4, s.value / top * 100), n = steps[i + 1], h2 = n ? Math.max(4, n.value / top * 100) : h;
        const x0 = i * W, x1 = x0 + W * .55, x2 = (i + 1) * W;
        return `<path d="M${x0} ${50 - h / 2} L${x1} ${50 - h / 2} C${x1 + W * .25} ${50 - h / 2} ${x1 + W * .2} ${50 - h2 / 2} ${x2} ${50 - h2 / 2} L${x2} ${50 + h2 / 2} C${x1 + W * .2} ${50 + h2 / 2} ${x1 + W * .25} ${50 + h / 2} ${x1} ${50 + h / 2} L${x0} ${50 + h / 2} Z" fill="${SERIES[i % 5]}"/>`; }).join('');
      return `<div class="mx-ffun"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${bands}</svg>
        <div class="mx-ffun-p">${steps.map(s => `<span><em>${Math.round(s.value / top * 100)}%</em></span>`).join('')}</div>
        <div class="mx-ffun-k">${steps.map((s, i) => `<div><span><i style="background:${SERIES[i % 5]}"></i>${esc(s.label)}</span><b>${Number(s.value).toLocaleString()}</b></div>`).join('')}</div></div>`; },
  });
  window.MXUI = MXUI;
})();
