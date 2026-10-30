// HQ business calculator: a projection of MXAi as a company, from your own plan prices. Every input is editable and
// every output shows how it was computed. Costs per AI reply come from a measured receptionist turn (about 4,000 tokens
// in, 250 out) and Anthropic's published prices; WhatsApp and card fees vary by country and provider, so they are
// inputs with typical values, not facts. Nothing here is real revenue.
(() => {
  const money = (v, d = 0) => (v < 0 ? '−$' : '$') + Math.abs(+v || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = v => (isFinite(v) ? Math.round(v) : 0) + '%';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // AI cost per reply: tokens in × input price + tokens out × output price; caching bills the stable part at the cache-read price
  const MODELS = {
    free: { name: 'Free tiers (what you use today)', inP: 0, outP: 0, cacheP: 0 },
    haiku: { name: 'Claude Haiku 5.5', inP: 0.10, outP: 0.50, cacheP: 0.01 },
    gemini: { name: 'Gemini paid tier (estimate)', inP: 0.10, outP: 0.40, cacheP: 0.025 },
    sonnet: { name: 'Claude Sonnet 5.5', inP: 2, outP: 10, cacheP: 0.20 },
    opus: { name: 'Claude Opus 5.5', inP: 4, outP: 20, cacheP: 0.20 },
  };
  const PRESETS = {
    today: { label: 'Today', clients: 1, newPerMonth: 1, churn: 5, biz: 0, pro: 100, addons: 0, convs: 60, rpc: 4, wa: 40, waPrice: 0.02, model: 'free', cacheShare: 0, hosting: 0, tools: 0, team: 0, marketing: 0, cardPct: 0, cardFixed: 0, months: 24 },
    launch: { label: 'Lebanon launch', clients: 10, newPerMonth: 5, churn: 4, biz: 10, pro: 50, addons: 0.5, convs: 150, rpc: 4, wa: 120, waPrice: 0.02, model: 'haiku', cacheShare: 50, hosting: 25, tools: 20, team: 0, marketing: 150, cardPct: 2.9, cardFixed: 0.30, months: 24 },
    scale: { label: 'Spain scale', clients: 60, newPerMonth: 15, churn: 3, biz: 25, pro: 55, addons: 1, convs: 300, rpc: 4, wa: 250, waPrice: 0.05, model: 'haiku', cacheShare: 50, hosting: 120, tools: 80, team: 3000, marketing: 1500, cardPct: 2.9, cardFixed: 0.30, months: 24 },
    premium: { label: 'Premium on Sonnet', clients: 40, newPerMonth: 8, churn: 3, biz: 40, pro: 50, addons: 1.5, convs: 300, rpc: 4, wa: 250, waPrice: 0.03, model: 'sonnet', cacheShare: 50, hosting: 120, tools: 80, team: 2000, marketing: 800, cardPct: 2.9, cardFixed: 0.30, months: 24 },
  };
  const TOK_IN = 4000, TOK_OUT = 250, STABLE = 2000; // tokens per reply; STABLE = rules + business (cacheable)
  Object.values(PRESETS).forEach(p => { p.tax ??= 0; });
  let S = { ...PRESETS.launch }, D = null, root = null;

  const field = (k, label, min, max, step, unit, hint) => `<label class="cs-f"><span>${label}${hint ? `<i title="${esc(hint)}">?</i>` : ''}</span>
    <div><input type="range" min="${min}" max="${max}" step="${step}" value="${S[k]}" data-k="${k}"><input type="number" min="${min}" step="${step}" value="${S[k]}" data-k="${k}" aria-label="${esc(label)}"><em>${unit}</em></div></label>`;

  function calc() {
    const price = k => D.plans.find(p => p.key === k)?.price || 0, addAvg = D.addons.length ? D.addons.reduce((s, a) => s + a.price, 0) / D.addons.length : 0;
    const biz = S.biz / 100, pro = Math.min(S.pro / 100, 1 - biz), starter = Math.max(0, 1 - biz - pro);
    const arpa = biz * price('business') + pro * price('pro') + starter * price('starter') + S.addons * addAvg;
    const m = MODELS[S.model], share = S.cacheShare / 100;
    const perReply = ((TOK_IN - STABLE * share) * m.inP + STABLE * share * m.cacheP + TOK_OUT * m.outP) / 1e6;
    const replies = S.convs * S.rpc;
    const aiPer = replies * perReply, waPer = S.wa * S.waPrice, cardPer = arpa * S.cardPct / 100 + (arpa ? S.cardFixed : 0);
    const varPer = aiPer + waPer + cardPer, contribution = arpa - varPer, fixed = S.hosting + S.tools + S.team + S.marketing;
    // month by month: new clients arrive, a share leaves
    const rows = []; let c = S.clients, cum = 0, payback = null;
    for (let i = 1; i <= S.months; i++) {
      c = Math.max(0, c * (1 - S.churn / 100) + S.newPerMonth);
      const mrr = c * arpa, cost = c * varPer + fixed, profit = mrr - cost; cum += profit;
      if (payback == null && cum >= 0 && i > 1) payback = i;
      rows.push({ i, c, mrr, cost, profit, cum });
    }
    const now = { c: S.clients, mrr: S.clients * arpa, cost: S.clients * varPer + fixed }; now.profit = now.mrr - now.cost;
    const ltv = S.churn > 0 ? contribution / (S.churn / 100) : null, cac = S.newPerMonth ? S.marketing / S.newPerMonth : 0;
    return { arpa, perReply, replies, aiPer, waPer, cardPer, varPer, contribution, fixed, rows, now, ltv, cac,
      margin: arpa ? contribution / arpa * 100 : 0, breakEven: contribution > 0 ? Math.ceil(fixed / contribution) : null,
      steady: S.churn > 0 ? S.newPerMonth / (S.churn / 100) : null, to10k: arpa ? Math.ceil(10000 / arpa) : null, payback, mix: { biz, pro, starter } };
  }

  function chart(rows) {
    const W = 720, H = 200, P = 34, mx = Math.max(1, ...rows.map(r => Math.max(r.mrr, r.cost))), mn = Math.min(0, ...rows.map(r => r.profit));
    const x = i => P + (i - 1) / Math.max(1, rows.length - 1) * (W - P - 8), y = v => 10 + (mx - v) / ((mx - mn) || 1) * (H - 34);
    const line = (k, col, w, dash = '') => `<path d="${rows.map((r, i) => (i ? 'L' : 'M') + x(r.i).toFixed(1) + ' ' + y(r[k]).toFixed(1)).join(' ')}" fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} vector-effect="non-scaling-stroke"/>`;
    const last = rows[rows.length - 1], ticks = [0, .5, 1].map(t => mn + (mx - mn) * t);
    return `<svg class="cs-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Revenue, cost and profit by month">
      ${ticks.map(v => `<line x1="${P}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="var(--pv-line)"/><text x="${P - 6}" y="${y(v) + 4}" text-anchor="end" class="wl-ax">${Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'k' : Math.round(v)}</text>`).join('')}
      ${mn < 0 ? `<line x1="${P}" x2="${W - 8}" y1="${y(0)}" y2="${y(0)}" stroke="var(--pv-meta)" stroke-dasharray="2 4"/>` : ''}
      <path d="${rows.map((r, i) => (i ? 'L' : 'M') + x(r.i) + ' ' + y(r.mrr)).join(' ')} L${x(last.i)} ${y(0)} L${x(1)} ${y(0)}Z" fill="color-mix(in srgb,var(--pv-ink) 7%,transparent)"/>
      ${line('mrr', 'var(--pv-ink)', 2.2)}${line('cost', 'var(--pv-meta)', 1.6, '4 4')}${line('profit', 'var(--pv-ink)', 1.4, '1 3')}
      <circle cx="${x(last.i)}" cy="${y(last.mrr)}" r="4.5" fill="var(--pv-lime)" stroke="var(--pv-ink)"/>
      ${[1, Math.ceil(rows.length / 2), rows.length].map(i => `<text x="${x(i)}" y="${H - 4}" text-anchor="middle" class="wl-ax">month ${i}</text>`).join('')}</svg>
      <div class="wl-leg"><span><i style="background:var(--pv-ink)"></i>Revenue (MRR)</span><span><i style="background:var(--pv-meta)"></i>All costs</span><span><i style="background:var(--pv-ink);opacity:.5"></i>Profit</span></div>`;
  }

  function draw() {
    if (!root || !D) return;
    const r = calc(), end = r.rows[r.rows.length - 1], sum = r.mix;
    const tile = (l, v, s, on) => `<div class="${on ? 'on' : ''}"><small>${l}</small><b>${v}</b>${s ? `<span>${s}</span>` : ''}</div>`;
    const bar = [['AI replies', r.aiPer], ['WhatsApp messages', r.waPer], ['Card fees', r.cardPer], ['Your margin', Math.max(0, r.contribution)]];
    const n0 = S.clients, nE = end.c, M = S.months, totC = r.rows.reduce((a, x) => a + x.c, 0), tax = (S.tax || 0) / 100;
    const col = (n, months) => { const rev = n * r.arpa * (months || 1), ai = n * r.aiPer * (months || 1), wa = n * r.waPer * (months || 1), card = n * r.cardPer * (months || 1);
      const varc = ai + wa + card, gross = rev - varc, fx = r.fixed * (months || 1), op = gross - fx, tx = op > 0 ? op * tax : 0;
      return { rev, ai, wa, card, varc, gross, fx, hosting: S.hosting * (months || 1), tools: S.tools * (months || 1), team: S.team * (months || 1), marketing: S.marketing * (months || 1), op, tx, net: op - tx }; };
    // per customer: variable costs are exact; fixed costs are shared among today's clients
    const per = col(1), shareFx = n0 ? r.fixed / n0 : 0;
    Object.assign(per, { fx: shareFx, hosting: n0 ? S.hosting / n0 : 0, tools: n0 ? S.tools / n0 : 0, team: n0 ? S.team / n0 : 0, marketing: n0 ? S.marketing / n0 : 0 });
    per.op = per.gross - shareFx; per.tx = per.op > 0 ? per.op * tax : 0; per.net = per.op - per.tx;
    const now = col(n0), last = col(nE), total = (() => { const t = col(totC); t.fx = r.fixed * M; t.hosting = S.hosting * M; t.tools = S.tools * M; t.team = S.team * M; t.marketing = S.marketing * M;
      t.op = t.gross - t.fx; t.tx = t.op > 0 ? t.op * tax : 0; t.net = t.op - t.tx; return t; })();
    const C = [per, now, last, total];
    const row = (label, k, cls = '', sign = 1) => `<tr class="${cls}"><th>${label}</th>${C.map(c => `<td>${money(sign * c[k], Math.abs(c[k]) < 10 && c[k] !== 0 ? 2 : 0)}</td>`).join('')}</tr>`;
    const pctRow = (label, a, b) => `<tr class="pl-pct"><th>${label}</th>${C.map(c => `<td>${c.rev ? pct(c[a] / c[b] * 100) : '—'}</td>`).join('')}</tr>`;
    const pl = `<section class="cs-pl"><h4>Profit and loss</h4><div class="pl-tw"><table class="pl-t"><thead><tr><th></th><th>Per customer<small>a month</small></th><th>This month<small>${Math.round(n0)} clients</small></th><th>Month ${M}<small>${Math.round(nE)} clients</small></th><th>All ${M} months<small>total</small></th></tr></thead><tbody>
      ${row('Revenue', 'rev', 'pl-strong')}
      <tr class="pl-sec"><th colspan="5">Cost of serving clients (grows with every client)</th></tr>
      ${row('AI replies', 'ai', '', -1)}${row('WhatsApp messages', 'wa', '', -1)}${row('Card fees', 'card', '', -1)}${row('Total variable costs', 'varc', 'pl-sub', -1)}
      ${row('Gross profit', 'gross', 'pl-strong')}${pctRow('Gross margin', 'gross', 'rev')}
      <tr class="pl-sec"><th colspan="5">Fixed costs (the same whatever the number of clients)</th></tr>
      ${row('Hosting', 'hosting', '', -1)}${row('Tools and domains', 'tools', '', -1)}${row('Team and salaries', 'team', '', -1)}${row('Marketing', 'marketing', '', -1)}${row('Total fixed costs', 'fx', 'pl-sub', -1)}
      ${row('Operating profit', 'op', 'pl-strong')}${row(`Tax (${S.tax || 0}%)`, 'tx', '', -1)}
      ${row('Net profit', 'net', 'pl-net')}${pctRow('Net margin', 'net', 'rev')}
      </tbody></table></div><p class="cs-how">Per customer: the variable costs are what one client really costs you; fixed costs are shared among today's ${Math.round(n0)} clients, so they shrink per client as you grow. Tax is applied only when there is a profit.</p></section>`;
    root.querySelector('#csOut').innerHTML = pl + `
      <div class="cs-tiles">${[
        tile('MRR now', money(r.now.mrr), `${S.clients} clients × ${money(r.arpa)}`, true),
        tile(`MRR in ${S.months} months`, money(end.mrr), `${Math.round(end.c)} clients`),
        tile('Profit per month now', money(r.now.profit), r.now.profit < 0 ? 'fixed costs not covered yet' : 'after every cost'),
        tile(`Profit in ${S.months} months`, money(end.profit), `${money(end.cum)} earned over the period`),
        tile('Gross margin', pct(r.margin), 'after AI, WhatsApp and card fees'),
        tile('Break-even', r.breakEven == null ? 'never' : r.breakEven + ' clients', r.breakEven == null ? 'each client costs more than it pays' : `to cover ${money(r.fixed)} fixed a month`),
        tile('Client lifetime value', r.ltv == null ? '—' : money(r.ltv), S.churn ? `${(100 / S.churn).toFixed(0)} months on average` : 'set churn above 0'),
        tile('Cost to win a client', money(r.cac), r.ltv && r.cac ? `LTV is ${(r.ltv / r.cac).toFixed(1)}× this` : 'marketing ÷ new clients'),
      ].join('')}</div>
      <div class="cs-two">
        <section><h4>Month by month</h4>${chart(r.rows)}</section>
        <section><h4>Where one client's ${money(r.arpa)} goes</h4>
          <div class="cs-stack">${bar.map(([l, v], i) => `<i style="flex:${Math.max(v, 0.0001)};${i === 3 ? 'background:var(--pv-lime);box-shadow:inset 0 0 0 1px var(--pv-ink)' : `background:color-mix(in srgb,var(--pv-ink) ${70 - i * 20}%,transparent)`}" title="${l}: ${money(v, 2)}"></i>`).join('')}</div>
          <dl class="cs-dl">${bar.map(([l, v]) => `<dt>${l}</dt><dd>${money(v, 2)}</dd>`).join('')}<dt>Fixed costs, shared</dt><dd>${S.clients ? money(r.fixed / S.clients, 2) : '—'}</dd></dl>
          <p class="cs-how">One AI reply ≈ ${TOK_IN.toLocaleString()} tokens in and ${TOK_OUT} out = <b>${money(r.perReply, 5)}</b> on ${esc(MODELS[S.model].name)}${S.cacheShare ? `, with ${S.cacheShare}% of the stable part cached` : ''}. ${r.replies.toLocaleString()} replies a client a month = ${money(r.aiPer, 2)}.</p></section>
      </div>
      <p class="cs-how">Plan mix: ${pct(sum.biz * 100)} Business, ${pct(sum.pro * 100)} Pro, ${pct(sum.starter * 100)} Starter (the rest). Steady state: with ${S.newPerMonth} new and ${S.churn}% leaving a month, you level off near <b>${r.steady == null ? '—' : Math.round(r.steady).toLocaleString()} clients</b> (${r.steady == null ? '' : money(r.steady * r.arpa)} MRR). ${r.to10k ? `$10k MRR needs ${r.to10k} clients at today's mix.` : ''}${r.payback ? ` Fixed costs are paid back by month ${r.payback}.` : ''}</p>`;
  }

  function render(el, data) {
    root = el; D = data;
    el.innerHTML = `<div class="cs-presets" role="group" aria-label="Start from">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}">${p.label}</button>`).join('')}</div>
      <div class="cs-groups">
        <fieldset><legend>Clients</legend>${field('clients', 'Clients today', 0, 1000, 1, '')}${field('newPerMonth', 'New clients a month', 0, 200, 1, '')}${field('churn', 'Clients who leave a month', 0, 20, 0.5, '%', 'Monthly churn. 2 to 5% is common for small-business software.')}${field('months', 'Months to project', 6, 60, 6, 'mo')}</fieldset>
        <fieldset><legend>What they buy</legend>${field('biz', 'On Business', 0, 100, 5, '%')}${field('pro', 'On Pro', 0, 100, 5, '%', 'The rest are on Starter.')}${field('addons', 'Add-ons per client', 0, 4, 0.5, '', 'Average number of paid add-ons each client takes.')}</fieldset>
        <fieldset><legend>Usage per client a month</legend>${field('convs', 'Conversations', 0, 2000, 10, '')}${field('rpc', 'AI replies per conversation', 1, 12, 1, '')}${field('wa', 'WhatsApp templates sent', 0, 2000, 10, '', 'Reminders and offers sent outside a 24-hour chat window. Replies inside the window are not charged this way.')}${field('waPrice', 'Price per template', 0, 0.2, 0.005, '$', 'Set by Meta and your provider; it differs by country. Check your Kapso dashboard.')}</fieldset>
        <fieldset><legend>AI</legend><label class="cs-f"><span>Model</span><select data-k="model">${Object.entries(MODELS).map(([k, m]) => `<option value="${k}" ${k === S.model ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>${field('cacheShare', 'Rules and business cached', 0, 100, 10, '%', 'Prompt caching bills the part that never changes (rules and salon details) at a much lower price.')}</fieldset>
        <fieldset><legend>Fixed costs a month</legend>${field('hosting', 'Hosting', 0, 2000, 5, '$')}${field('tools', 'Tools and domains', 0, 1000, 5, '$')}${field('team', 'Team and salaries', 0, 30000, 100, '$')}${field('marketing', 'Marketing', 0, 20000, 50, '$')}</fieldset>
        <fieldset><legend>Getting paid</legend>${field('cardPct', 'Card fee', 0, 6, 0.1, '%', 'Typical card processing is around 3% plus a fixed fee; check your provider.')}${field('cardFixed', 'Fixed fee per payment', 0, 1, 0.05, '$')}${field('tax', 'Tax on profit', 0, 40, 1, '%', 'Corporate or income tax on profit. Set your country rate; 0 shows profit before tax.')}</fieldset>
      </div><div id="csOut"></div>`;
    draw();
  }

  document.addEventListener('input', e => {
    const k = e.target.dataset?.k; if (!k || !e.target.closest('.cs-wrap')) return;
    S[k] = e.target.tagName === 'SELECT' ? e.target.value : +e.target.value;
    e.target.closest('label')?.querySelectorAll(`[data-k="${k}"]`).forEach(x => { if (x !== e.target) x.value = S[k]; });
    draw();
  });
  document.addEventListener('change', e => { if (e.target.matches('.cs-wrap select[data-k]')) { S[e.target.dataset.k] = e.target.value; draw(); } });
  document.addEventListener('click', e => { const b = e.target.closest('.cs-wrap [data-preset]'); if (!b || !root) return; S = { ...PRESETS[b.dataset.preset] }; render(root, D);
    root.querySelectorAll('[data-preset]').forEach(x => x.setAttribute('aria-pressed', x === root.querySelector(`[data-preset="${b.dataset.preset}"]`))); });
  window.HQSim = { render, calc: () => calc(), set: v => { Object.assign(S, v); draw(); } };
})();
