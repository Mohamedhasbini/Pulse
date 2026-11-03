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
  window.MXUI = MXUI;
})();
