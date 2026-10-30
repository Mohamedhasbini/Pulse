// MXAi HQ: the founder's command center, first screen of the Lab. One page answers "how is the company doing":
// what clients pay (MRR, ARR, pipeline), what MXAi earns them (value created, return per client), what it costs to run,
// where growth comes from, how the AI is behaving and whether the platform is healthy. Every client can be opened,
// paused or switched from here. Numbers are real; the simulator at the end is a projection and says so.
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (v, d = 0) => '$' + (+v || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const ago = t => { if (!t) return 'never'; const s = (Date.now() - new Date(t)) / 1000; return s < 3600 ? Math.max(1, Math.round(s / 60)) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
  const W = (key, data) => { try { return window.WL?.L[key]?.render({ id: key + Math.random().toString(36).slice(2, 6), ...data }) || ''; } catch (e) { console.warn('hq widget', key, e); return ''; } };
  const card = (title, sub, body, cls = '') => `<section class="hq-c ${cls}"><header><h3>${esc(title)}</h3>${sub ? `<small>${esc(sub)}</small>` : ''}</header>${body}</section>`;
  const STATUS = { active: ['Paying', 'ok'], trial: ['Trial', 'mid'], paused: ['Paused', 'bad'] };
  const PROV = { anthropic: 'Claude', n8n: 'Gemini (main)', 'gemini-flash-lite': 'Gemini Flash-Lite', 'gemini-flash': 'Gemini Flash', 'gemini-3.1-lite': 'Gemini 3.1 Lite', groq: 'Groq', cerebras: 'Cerebras', openrouter: 'OpenRouter', quick: 'Instant (no AI)', fallback: 'Safety message', staff: 'Your team' };
  let D = null, days = 30, sortBy = 'mrr', metric = 'chats', q = '';

  async function load() {
    const box = $('#ccHQ'); if (!box) return;
    if (!D) box.innerHTML = '<p class="hq-loading">Loading your company…</p>';
    const r = await fetch(`/api/admin/hq?days=${days}`); D = r.ok ? await r.json() : null;
    if (!D) { box.innerHTML = '<p class="hq-loading">Could not load HQ. Try again in a moment.</p>'; return; }
    draw();
  }

  function draw() {
    const m = D.money, real = D.clients.filter(c => !c.demo), box = $('#ccHQ');
    const roiAll = real.reduce((s, c) => s + c.price * D.days / 30, 0), roi = roiAll ? Math.round(m.value_created / roiAll * 10) / 10 : null;
    const kpi = (l, v, s, on) => `<div class="hq-k${on ? ' on' : ''}"><small>${l}</small><b>${v}</b><span>${s}</span></div>`;
    const kpis = `<div class="hq-kpis">${[
      kpi('MRR', money(m.mrr), m.paying ? `${m.paying} paying · ${money(m.arpa)} each` : 'no paying client yet', true),
      kpi('ARR', money(m.arr), 'MRR × 12'),
      kpi('Pipeline', money(m.pipeline_mrr), `${m.trials} on trial${m.paused ? ` · ${m.paused} paused` : ''}`),
      kpi('Value created', money(m.value_created), `booked by MXAi for clients · ${D.days} days`),
      kpi('Client return', roi == null ? '—' : roi + '×', 'value created ÷ what they pay'),
      kpi('Running cost', '$0', `free AI tiers today · at paid Gemini prices it would be about ${money(m.cost_monthly, 2)} / month`),
      kpi('Gross margin', m.gross_margin == null ? '—' : m.gross_margin + '%', m.mrr ? `${money(m.mrr - m.cost_monthly)} a month after costs` : 'starts with the first paying client'),
      kpi('AI replies', (D.ai.ai_real || 0).toLocaleString(), `to real clients · ${(D.ai.ai - D.ai.ai_real).toLocaleString()} more were your own tests`),
    ].join('')}</div>`;

    // activity across the platform, one measure at a time
    const MET = { chats: ['Chats', ''], ai_replies: ['AI replies', ''], bookings: ['Bookings', ''], ai_value: ['Value booked by MXAi', '$'] };
    const series = D.daily.map(x => x[metric]), half = Math.floor(series.length / 2);
    const trend = card('Platform activity', `${MET[metric][0]} per day, every client together`, `<div class="hq-seg" role="group" aria-label="Measure">${Object.entries(MET).map(([k, [l]]) => `<button type="button" data-metric="${k}" aria-pressed="${k === metric}">${l}</button>`).join('')}</div>`
      + W('area', { s: series.slice(half), cmp: series.slice(0, half), unit: MET[metric][1] }), 'w8');
    const mixC = Object.entries(m.mix).map(([k, v]) => [k, v]);
    const mix = card('Revenue by plan', 'what paying clients are on', mixC.length ? W('gapdonut', { c: mixC, unit: '$' })
      : `<div class="hq-empty"><b>No paying client yet</b><p>${m.trials ? `${m.trials} on trial worth ${money(m.pipeline_mrr)} a month when they convert.` : 'Create a client and start a trial.'}</p><button type="button" class="hq-btn" data-nav="new">+ New business</button></div>`, 'w4');

    // the portfolio: every client, what they pay, what MXAi earns them, and the controls
    const rows = real.filter(c => !q || (c.name + ' ' + c.plan + ' ' + (c.country || '') + ' ' + c.vertical).toLowerCase().includes(q))
      .sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name) : (b[sortBy] ?? -1) - (a[sortBy] ?? -1));
    const th = (k, l, r) => `<th class="${r ? 'r' : ''}"><button type="button" data-sort="${k}" aria-pressed="${sortBy === k}">${l}${sortBy === k ? ' ↓' : ''}</button></th>`;
    const table = card('Clients', `${real.length} ${real.length === 1 ? 'business' : 'businesses'} · sorted by ${({ mrr: 'monthly revenue', ai_value: 'value created', roi: 'return', ai_replies: 'AI replies', cost: 'cost', name: 'name', price: 'price' })[sortBy]}`,
      `<div class="hq-tools"><input type="search" id="hqQ" placeholder="Find a client, plan or country" value="${esc(q)}" aria-label="Find a client"><button type="button" class="hq-btn" data-nav="new">+ New business</button></div>
      <div class="hq-tw"><table class="hq-t"><thead><tr>${th('name', 'Client')}<th>Plan</th><th>Status</th>${th('price', 'Price', 1)}${th('mrr', 'MRR', 1)}${th('ai_value', 'Value created', 1)}${th('roi', 'Return', 1)}${th('ai_replies', 'AI replies', 1)}${th('cost', 'Cost', 1)}<th>Last active</th><th>AI</th><th></th></tr></thead>
      <tbody>${rows.map(c => { const [sl, sc] = STATUS[c.status] || [c.status, 'mid']; return `<tr>
        <td><b>${esc(c.name)}</b><small>${esc([c.vertical, c.country].filter(Boolean).join(' · '))}</small></td>
        <td>${esc(c.plan)}${c.addons.length ? `<small>+ ${esc(c.addons.join(', '))}</small>` : ''}</td>
        <td><span class="hq-st ${sc}">${sl}${c.status === 'trial' ? ` · ${c.trial_days_left} d` : ''}</span></td>
        <td class="r">${money(c.price)}</td><td class="r"><b>${money(c.mrr)}</b></td><td class="r">${money(c.ai_value)}<small>${c.ai_bookings} bookings</small></td>
        <td class="r">${c.roi == null ? '—' : `<span class="hq-roi${c.roi >= 3 ? ' hi' : ''}">${c.roi}×</span>`}</td><td class="r">${c.ai_replies.toLocaleString()}</td><td class="r">${money(c.cost, 2)}</td>
        <td>${ago(c.last_activity)}</td>
        <td><button type="button" class="hq-sw" role="switch" aria-checked="${c.ai_mode !== 'off'}" data-ai="${c.id}" title="Switch the AI for this client">${c.ai_mode !== 'off' ? 'On' : 'Off'}</button></td>
        <td class="r"><button type="button" class="hq-btn sm" data-open="${c.id}">Open</button></td></tr>`; }).join('') || `<tr><td colspan="12" class="hq-none">No client matches “${esc(q)}”.</td></tr>`}</tbody></table></div>`, 'w12');

    // growth: where clients come from
    const L = D.growth.leads, leadN = L.reduce((s, x) => s + x.n, 0), clicks = D.growth.clicks.reduce((s, x) => s + x.n, 0);
    const signups = Math.max(leadN, m.trials + m.paying), visits = Math.max(clicks, signups);
    const funnel = card('Growth funnel', `last ${D.days} days`, W('pyramid', { c: [['Visits from clients’ pages', visits], ['Sign-ups and leads', signups], ['Trials', m.trials + m.paying], ['Paying', m.paying]] }), 'w4');
    const src = D.growth.clicks.map(x => [({ webook: 'WeBook', confirm: 'Booking confirmations', book: 'Booking page', chat: 'Chat footer', site: 'Client websites', direct: 'Direct' })[x.source] || x.source, x.n]);
    const sources = card('Where visitors come from', '“Powered by MXAi” links in clients’ pages', src.length ? W('capsules', { c: src }) : '<p class="hq-note">No visits yet. Each client page links back to MXAi.</p>', 'w4');
    const months = card('New clients per month', `${D.growth.new_per_month.reduce((s, x) => s + x.n, 0)} in the last 12 months`, W('hatched', { s: D.growth.new_per_month.map(x => x.n) }) + `<div class="hq-axis"><span>${D.growth.new_per_month[0]?.month}</span><span>${D.growth.new_per_month.at(-1)?.month}</span></div>`, 'w4');

    // AI operations and control
    const prov = D.ai.providers.map(p => [PROV[p.provider] || p.provider || 'Team and system messages', p.n]);
    const aiOps = card('AI operations', `primary: ${D.ai.primary} · last ${D.days} days`, `<div class="hq-mini">${[['Replies', D.ai.ai || 0], ['Failed', D.ai.failed || 0], ['Unsure', D.ai.unsure || 0], ['Instant', D.ai.quick || 0], ['Queue', D.ai.queue.waiting || 0]].map(([l, v]) => `<div><small>${l}</small><b>${v.toLocaleString()}</b></div>`).join('')}</div>`
      + (prov.length ? W('capsules', { c: prov }) : '') + `<div class="hq-router">${D.ai.router.map(r => `<span class="${r.configured ? (r.resting_until ? 'mid' : 'ok') : 'off'}" title="${esc(r.last || '')}">${esc(r.id)}${r.resting_until ? ' · resting' : r.configured ? '' : ' · no key'}</span>`).join('')}</div>`, 'w6');
    const anyOn = real.some(c => c.ai_mode !== 'off');
    const control = card('Control', 'actions across every client', `<div class="hq-ctl">
      <button type="button" class="hq-big ${anyOn ? 'danger' : ''}" data-all="${anyOn ? 'off' : 'on'}"><b>${anyOn ? 'Pause the AI for every client' : 'Resume the AI for every client'}</b><small>${anyOn ? 'Emergency stop: every chat waits for a person until you resume.' : 'Clients get instant answers again; chats waiting only for the AI are released.'}</small></button>
      <div class="hq-links">${[['new', '+ New business', 'set up a client in a minute'], ['leads', 'Leads', `${leadN} from the website`], ['plans', 'Plans and add-ons', 'prices and features'], ['users', 'Logins', 'owners and staff'], ['platform', 'Usage and cost', 'per client'], ['audit', 'Audit log', 'who changed what']].map(([k, l, s]) => `<button type="button" data-nav="${k}"><b>${l}</b><small>${s}</small></button>`).join('')}</div></div>`, 'w6');

    // platform health
    const P = D.platform, b = P.backup;
    const healthC = card('Platform health', `up ${P.uptime_h} h · database ${P.db_mb} MB · ${P.node}`, `<ul class="hq-checks">${P.checks.map(c => `<li class="${c.ok ? 'ok' : 'bad'}"><i></i><b>${esc(c.name)}</b><span>${esc(c.detail || (c.ok ? 'OK' : 'Needs attention'))}</span></li>`).join('')}</ul>`, 'w6');

    // unit economics: a projection from your own prices, clearly labelled
    const sim = card('Business calculator', 'a projection, not real revenue: your plan prices, measured AI cost per reply, and costs you set', '<div class="cs-wrap" id="hqCalc"></div>', 'w12');

    box.innerHTML = `<div class="hq-head"><div><h2>HQ</h2><p>Your company at a glance: revenue, the value MXAi creates for clients, costs, growth, AI and health.</p></div>
      <div class="hq-seg" role="group" aria-label="Period">${[7, 30, 90, 365].map(d => `<button type="button" data-days="${d}" aria-pressed="${d === days}">${d === 365 ? '12 months' : d + ' days'}</button>`).join('')}<button type="button" data-refresh title="Refresh">↻</button></div></div>
      ${kpis}<div class="hq-grid">${trend}${mix}${table}${funnel}${sources}${months}${aiOps}${control}${healthC}${sim}</div>
      <p class="hq-foot">Updated ${new Date(D.generated).toLocaleTimeString()} · the paid-price cost estimate in the numbers above uses COST_PER_AI_REPLY and COST_PER_WA_TEMPLATE from .env; the calculator uses its own inputs.</p>`;
    window.HQSim?.render($('#hqCalc'), D);
  }

  function simulate() {
    const el = $('#hqSim'); if (!el) return; const v = k => el.querySelector(`[data-s="${k}"]`).value;
    const n = +v('n'), biz = +v('biz') / 100, pro = Math.min(+v('pro') / 100, 1 - biz), add = +v('add') / 100, rep = +v('rep'), cpr = +v('cpr');
    const price = k => D.plans.find(p => p.key === k)?.price || 0, addAvg = D.addons.length ? D.addons.reduce((s, a) => s + a.price, 0) / D.addons.length : 0;
    const arpa = biz * price('business') + pro * price('pro') + (1 - biz - pro) * price('starter') + add * addAvg;
    const mrr = n * arpa, cost = n * rep * cpr + (D.money.infra_monthly || 0), margin = mrr ? (mrr - cost) / mrr * 100 : 0;
    el.querySelectorAll('input[type=range]').forEach(i => { const o = i.nextElementSibling; o.textContent = ['biz', 'pro', 'add'].includes(i.dataset.s) ? i.value + '%' : (+i.value).toLocaleString(); });
    $('#hqSimOut').innerHTML = [['MRR', money(mrr)], ['ARR', money(mrr * 12)], ['Average per client', money(arpa)], ['AI and infra cost', money(cost) + ' / month'], ['Gross margin', Math.round(margin) + '%'], ['Clients to reach $10k MRR', arpa ? Math.ceil(10000 / arpa).toLocaleString() : '—']]
      .map(([l, x], i) => `<div class="${i === 0 ? 'on' : ''}"><small>${l}</small><b>${x}</b></div>`).join('');
  }

  document.addEventListener('input', e => { if (e.target.closest('#hqSim')) simulate(); if (e.target.id === 'hqQ') { q = e.target.value.trim().toLowerCase(); clearTimeout(simulate.t); simulate.t = setTimeout(() => { const pos = e.target.selectionStart; draw(); const i = $('#hqQ'); i.focus(); i.setSelectionRange(pos, pos); }, 200); } });
  document.addEventListener('change', e => { if (e.target.closest('#hqSim')) simulate(); });
  document.addEventListener('click', async e => {
    const t = e.target.closest('#ccHQ [data-metric],#ccHQ [data-days],#ccHQ [data-sort],#ccHQ [data-open],#ccHQ [data-ai],#ccHQ [data-all],#ccHQ [data-nav],#ccHQ [data-refresh]'); if (!t) return;
    if (t.dataset.metric) { metric = t.dataset.metric; return draw(); }
    if (t.dataset.days) { days = +t.dataset.days; return load(); }
    if (t.dataset.refresh != null) return load();
    if (t.dataset.sort) { sortBy = t.dataset.sort; return draw(); }
    if (t.dataset.nav) return document.querySelector(`nav.setnav [data-k="${t.dataset.nav}"]`)?.click();
    if (t.dataset.open) { await fetch('/api/admin/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: +t.dataset.open }) }); location.href = '/'; return; }
    if (t.dataset.ai) {
      const c = D.clients.find(x => x.id === +t.dataset.ai), mode = c.ai_mode === 'off' ? 'on' : 'off';
      if (mode === 'off' && !confirm(`Switch the AI off for ${c.name}? Every new chat will wait for a person until you switch it back on.`)) return;
      await fetch('/api/admin/ai-mode', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business_id: c.id, mode }) });
      window.toast?.(`AI ${mode === 'on' ? 'on' : 'off'} for ${c.name}.`); return load();
    }
    if (t.dataset.all) {
      const mode = t.dataset.all;
      if (!confirm(mode === 'off' ? 'Pause the AI for EVERY client? All new chats will wait for a person until you resume.' : 'Resume the AI for every client?')) return;
      const r = await fetch('/api/admin/ai-mode', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) }).then(x => x.json());
      window.toast?.(`AI ${mode === 'on' ? 'resumed' : 'paused'} for ${r.changed} client${r.changed === 1 ? '' : 's'}.`); return load();
    }
  });

  // place HQ first in the Lab's index and open it when the Lab opens
  function mount() {
    const nav = document.querySelector('nav.setnav'), main = document.querySelector('.ccmain'); if (!nav || !main) return false;
    if (!$('#ccHQ')) {
      const pane = document.createElement('div'); pane.id = 'ccHQ'; pane.className = 'hq'; main.prepend(pane);
      nav.insertAdjacentHTML('afterbegin', '<h3>Command</h3><button type="button" data-k="hq"><i></i>HQ overview</button>');
      nav.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; const on = b.dataset.k === 'hq';
        pane.hidden = !on; main.classList.toggle('hq-on', on); nav.querySelectorAll('[data-k]').forEach(x => x.setAttribute('aria-current', x === b));
        if (on) load(); }, true);
    }
    return true;
  }
  const open = () => { if (!mount()) return; document.querySelector('nav.setnav [data-k="hq"]')?.click(); };
  const t = setInterval(() => { if (window.LAB && mount()) { clearInterval(t); open(); } }, 300);
  setTimeout(() => clearInterval(t), 20000);
  window.MXHQ = { open, load };
})();
