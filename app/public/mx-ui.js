// MXAi components: small functions that return one card's HTML in the shared anatomy
// (title, primary number, context, trend, explanation, optional action) and one of six states.
// Pages compose these on the 12-column grid in mx-ui.css instead of drawing their own cards.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATE = { healthy: 'Healthy', improving: 'Improving', neutral: '', warning: 'Needs a look', critical: 'Act today', empty: '' };
  // size: compact | standard | wide (min heights); span: grid columns
  const card = ({ title, meta = '', link = '', state = 'neutral', size = 'standard', span = 4, cls = '', body = '', label = '' }) =>
    `<section class="mx-card ${size} mx-c${span} ${cls}" data-state="${state}" aria-label="${esc(label || title)}">
      <header class="mx-hd"><h3>${esc(title)}</h3>${STATE[state] ? `<span class="mx-state">${STATE[state]}</span>` : ''}${meta ? `<span class="mx-meta">${meta}</span>` : ''}${link}</header>${body}</section>`;
  const trend = (pct, { lowerIsBetter = false, suffix = '%', vs = '' } = {}) => {
    if (pct == null || !isFinite(pct)) return '';
    const good = lowerIsBetter ? pct < 0 : pct > 0, cls = pct === 0 ? 'flat' : good ? 'up' : 'down';
    return `<span class="mx-trend ${cls}">${pct > 0 ? '▲' : pct < 0 ? '▼' : '='} ${Math.abs(Math.round(pct))}${suffix}${vs ? ` ${esc(vs)}` : ''}</span>`;
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
      card({ title, state, size: 'compact', span, body: `<div class="mx-num">${esc(value)}</div><div class="mx-ctx">${esc(ctx)} ${trend(change, { lowerIsBetter, vs })}</div>${why ? `<p class="mx-why">${esc(why)}</p>` : ''}${action ? `<div class="mx-foot">${action}</div>` : ''}` }),
    // meter: a share with its explanation, e.g. "74% of your available time is booked"
    meter: ({ title, pct, ctx, why = '', state = 'neutral', span = 3, action = '' }) =>
      card({ title, state, size: 'compact', span, body: `<div class="mx-num">${Math.round(pct)}%</div><div class="mx-meter"><u style="width:${Math.max(0, Math.min(100, pct))}%"></u></div><div class="mx-ctx">${esc(ctx)}</div>${why ? `<p class="mx-why">${esc(why)}</p>` : ''}${action ? `<div class="mx-foot">${action}</div>` : ''}` }),
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
  window.MXUI = MXUI;
})();
