// Marketing › Overview: what every offer, code and agent message brought in, who you can still reach, and the next
// campaigns ranked by value. Data: /api/marketing/overview (attribution: a booking within 14 days of a message).
window.PulseMarketing = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cur = () => (window.biz?.currency || 'USD');
  const money = v => `${cur() === 'USD' ? '$' : cur() + ' '}${Math.round(v || 0).toLocaleString()}`;
  const SEG = { vip: ['VIP', 'Top 10% by spend'], regular: ['Regulars', '3+ visits, recent'], active: ['Booked ahead', 'Have an upcoming visit'], new: ['New', 'First visit in 30 days'],
    occasional: ['Occasional', '1–2 visits'], lapsed: ['Lapsed', '45–120 days away'], lost: ['Lost', '4+ months away'], never: ['Never booked', 'Chatted, no visit'] };
  const ORDER = ['vip', 'regular', 'active', 'new', 'occasional', 'lapsed', 'lost', 'never'];
  const RES = { success: ['Worked', 'good'], some: ['Some bookings', 'mid'], 'no bookings': ['No bookings', 'bad'], 'too early': ['Too early', ''], 'not sent': ['Reached nobody', 'bad'] };
  let root = null, days = 90, data = null, studioData = null;

  function kpis(k) {
    const tile = (l, v, s, cls = '') => `<div class="mk-k ${cls}"><span>${l}</span><b>${v}</b><small>${s}</small></div>`;
    return `<div class="mk-kpis">${tile('Revenue from marketing', money(k.revenue), `${k.won} booking${k.won === 1 ? '' : 's'} won`, 'mk-hero')}
      ${tile('Messages sent', k.sent.toLocaleString(), `${k.reached} client${k.reached === 1 ? '' : 's'} reached`)}
      ${tile('Conversion', k.reached ? k.conversion + '%' : '—', 'reached → booked within 14 days')}
      ${tile('Return on discounts', k.roi ? k.roi + '×' : '—', k.discounts ? `${money(k.revenue)} for ${money(k.discounts)} off` : 'no discounts given')}
      ${tile('Audience', `${k.opted_in}<i>/${k.customers}</i>`, `${k.optin_rate}% agreed to offers`, k.optin_rate < 40 ? 'warn' : '')}</div>`;
  }
  // weekly: bars = messages sent, line = bookings won, both on their own scale
  function weekly(w) {
    const W = Math.max(480, Math.round((root?.clientWidth || 900) - 40)), H = 220, l = 34, r = 34, t = 14, b = 26, n = w.length;
    if (!n) return '';
    const mS = Math.max(4, ...w.map(x => x.sent)), mB = Math.max(2, ...w.map(x => x.booked)), X = i => l + (n < 2 ? 0 : i * (W - l - r) / (n - 1));
    const bw = Math.min(26, (W - l - r) / n * 0.55), YS = v => H - b - v / mS * (H - b - t), YB = v => H - b - v / mB * (H - b - t);
    let g = '';
    for (let i = 0; i <= 3; i++) { const y = t + i * (H - b - t) / 3; g += `<line x1="${l}" x2="${W - r}" y1="${y}" y2="${y}" class="mk-grid"/><text x="${l - 6}" y="${y + 4}" text-anchor="end">${Math.round(mS * (3 - i) / 3)}</text><text x="${W - r + 6}" y="${y + 4}">${Math.round(mB * (3 - i) / 3)}</text>`; }
    w.forEach((x, i) => { if (x.sent) g += `<rect x="${X(i) - bw / 2}" y="${YS(x.sent)}" width="${bw}" height="${H - b - YS(x.sent)}" rx="3" class="mk-bar"><title>Week of ${x.week}: ${x.sent} sent</title></rect>`; });
    g += `<polyline points="${w.map((x, i) => `${X(i)},${YB(x.booked)}`).join(' ')}" class="mk-line"/>` + w.map((x, i) => x.booked ? `<circle cx="${X(i)}" cy="${YB(x.booked)}" r="3.5" class="mk-dot"><title>${x.booked} booked · ${money(x.revenue)}</title></circle>` : '').join('');
    [0, Math.floor((n - 1) / 2), n - 1].forEach(i => { g += `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${w[i].week.slice(5)}</text>`; });
    const any = w.some(x => x.sent || x.booked);
    return `<div class="mk-card mk-wide"><div class="mk-h"><h3>Messages and the bookings they brought</h3><div class="mk-leg"><span class="s">Sent</span><span class="b">Booked</span></div></div>
      <svg viewBox="0 0 ${W} ${H}" class="mk-svg" role="img" aria-label="Messages sent and bookings won per week">${g}</svg>${any ? '' : '<p class="mk-empty">No messages sent in this period yet. Send an offer or run an agent and its results appear here.</p>'}</div>`;
  }
  // audience: one stacked bar of every client, then each segment with how many you can reach
  function audience(s) {
    const rows = ORDER.filter(k => s[k]), total = rows.reduce((a, k) => a + s[k].n, 0) || 1;
    return `<div class="mk-card"><div class="mk-h"><h3>Your audience</h3><small>${total} clients</small></div>
      <div class="mk-stack">${rows.map(k => `<i class="sg-${k}" style="flex:${s[k].n}" title="${SEG[k][0]}: ${s[k].n}"></i>`).join('')}</div>
      <table class="mk-t"><thead><tr><th>Segment</th><th class="n">Clients</th><th class="n">Reachable</th><th class="n">Spent</th></tr></thead><tbody>
      ${rows.map(k => `<tr><td><span class="mk-sw sg-${k}"></span><b>${SEG[k][0]}</b><small>${SEG[k][1]}</small></td><td class="n">${s[k].n}</td><td class="n ${s[k].reachable ? '' : 'mk-zero'}">${s[k].reachable}</td><td class="n">${money(s[k].spent)}</td></tr>`).join('')}</tbody></table>
      <p class="mk-note">Reachable = agreed to receive offers. Only they can get promotions.</p></div>`;
  }
  function funnel(f) {
    const steps = [['Talked to the AI', f.talked], ['Booked', f.booked], ['Came back (2+ visits)', f.returned]], m = Math.max(1, ...steps.map(x => x[1]));
    return `<div class="mk-card"><div class="mk-h"><h3>Client journey</h3><small>last ${days} days</small></div><div class="mk-fun">${steps.map(([l, v], i) => `<div><span>${l}</span>
      <div class="mk-fb"><i style="width:${Math.max(2, v / m * 100)}%"></i></div><b>${v}</b>${i && steps[i - 1][1] && v <= steps[i - 1][1] ? `<small>${Math.round(v / steps[i - 1][1] * 100)}%</small>` : '<small></small>'}</div>`).join('')}</div>
      <p class="mk-note">Bookings include clients who booked without chatting (booking page, staff).</p></div>`;
  }
  // Campaign studio: compact cards (segment, audience, reachable, value, status, consent bar); a click opens the
  // editor under the grid: message, code, %, estimate, Launch. Launch creates the code and sends via the Offers sender.
  let openD = -1;
  function studio(st) {
    if (!st) return '';
    const a = st.audience;
    const status = d => d.ran ? ['Sent', ''] : d.reachable ? ['Ready', 'good'] : d.size ? ['Needs consent', 'mid'] : ['No audience', ''];
    const card = (d, i) => { const [stt, cls] = status(d), w = d.size ? Math.round(d.matched / d.size * 100) : 0;
      return `<button type="button" class="mk-sc ${openD === i ? 'open' : ''}" data-mko="${i}">
        <div class="mk-sc-h"><b>${esc(d.name)}</b><span class="mk-pill ${cls}">${stt}</span></div>
        <small>${esc(d.audience)}</small>
        <div class="mk-sc-n"><div><i>Audience</i><b>${d.size}</b></div><div><i>Reachable</i><b>${d.reachable}</b></div><div><i>${d.reachable ? 'Net' : 'Potential'}</i><b>${money(d.reachable ? d.estimate.net : d.potential)}</b></div></div>
        <div class="mk-mini" title="${d.matched} of ${d.size} agreed to offers"><i style="width:${w}%"></i></div>
        <div class="mk-sc-f"><span>${d.code ? `<span class="mk-code">${esc(d.code)}</span> ${d.pct}%` : 'Perk'}</span><span>${w}% opted in</span></div></button>`; };
    const d = st.drafts[openD];
    return `<div class="mk-card mk-wide"><div class="mk-h"><h3>Campaign studio</h3><small>${a.opted} of ${a.clients} clients opted in · ticket ${money(st.ticket)}</small></div>
      <div class="mk-sg">${st.drafts.map(card).join('')}</div>${d ? brief(d) : ''}</div>`;
  }
  function brief(d) {
    return `<article class="mk-d mk-brief" data-d="${openD}">
      <div class="mk-row mk-ed"><label class="mk-lbl" style="flex:1">Message<textarea rows="3" data-f="message">${esc(d.message)}</textarea></label>
        ${d.code ? `<label class="mk-lbl">Code<input data-f="code" value="${esc(d.code)}"></label><label class="mk-lbl">% off<input data-f="pct" type="number" min="1" max="60" value="${d.pct}"></label>` : ''}</div>
      <dl class="mk-est"><div><dt>Bookings</dt><dd>${d.estimate.bookings}</dd></div><div><dt>Revenue</dt><dd>${money(d.estimate.revenue)}</dd></div><div><dt>Discount</dt><dd>${money(d.estimate.discount_cost)}</dd></div><div><dt>Net</dt><dd>${money(d.estimate.net)}</dd></div><div><dt>Reply rate</dt><dd>~${d.estimate.reply_rate}%</dd></div></dl>
      ${d.warning ? `<p class="mk-wn">${esc(d.warning)}</p>` : ''}
      <footer><button type="button" class="mk-launch" ${d.reachable && !d.ran ? '' : 'disabled'}>${d.ran ? 'Sent this week' : d.reachable ? `Launch to ${d.reachable}` : 'Waiting for consent'}</button><button type="button" class="mk-ai">Improve with AI</button><button type="button" class="mk-copy">Copy</button></footer>
      <p class="mk-res" aria-live="polite"></p></article>`;
  }
  function ideas(list) {
    if (!list.length) return '';
    return `<div class="mk-card mk-wide"><div class="mk-h"><h3>Next campaigns, ranked by value</h3><small>value = reachable × expected reply rate × your average ticket</small></div>
      <div class="mk-ideas">${list.map((x, i) => `<article class="${i ? '' : 'top'}"><header><b>${esc(x.title)}</b><span>${x.reachable ? money(x.value) : money(x.potential)}<small>${x.reachable ? 'expected' : 'if they agree'}</small></span></header>
        <p>${esc(x.why)}</p><footer><small>${x.reachable} of ${x.total} reachable · ~${x.rate}% reply</small><button type="button" class="mk-go" data-go="${x.go.join(',')}">${x.reachable ? 'Create campaign' : 'See how to reach them'}</button></footer></article>`).join('')}</div></div>`;
  }
  function tables(d) {
    const pill = r => { const [t, c] = RES[r] || [r, '']; return `<span class="mk-pill ${c}">${t}</span>`; };
    const camp = d.campaigns.length ? `<table class="mk-t"><thead><tr><th>Offer</th><th>Sent on</th><th class="n">Reached</th><th class="n">Booked</th><th class="n">Rate</th><th class="n">Revenue</th><th>Result</th></tr></thead><tbody>
      ${d.campaigns.map(c => `<tr><td><b>${esc(c.name.trim() || 'Untitled')}</b><small>${esc(c.message).slice(0, 60)}</small></td><td>${c.date}</td><td class="n">${c.sent}${c.skipped ? `<small>${c.skipped} skipped</small>` : ''}</td><td class="n">${c.booked}</td><td class="n">${c.sent ? c.rate + '%' : '—'}</td><td class="n">${money(c.revenue)}</td><td>${pill(c.result)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="mk-empty">No offers in this period.</p>';
    const codes = d.coupons.length ? `<table class="mk-t"><thead><tr><th>Code</th><th>Deal</th><th class="n">Bookings</th><th class="n">Revenue</th><th class="n">Discount given</th><th class="n">Return</th><th>Status</th></tr></thead><tbody>
      ${d.coupons.map(c => `<tr><td><b class="mk-code">${esc(c.code)}</b></td><td>${c.kind === 'percent' ? c.value + '% off' : money(c.value) + ' off'}${c.expires ? `<small>until ${c.expires}</small>` : ''}</td><td class="n">${c.bookings}${c.max_uses ? `<small>of ${c.max_uses}</small>` : ''}</td><td class="n">${money(c.revenue)}</td><td class="n">${money(c.discount)}</td><td class="n">${c.discount ? (c.revenue / c.discount).toFixed(1) + '×' : '—'}</td><td><span class="mk-pill ${c.status === 'live' ? 'good' : ''}">${c.status}</span></td></tr>`).join('')}</tbody></table>`
      : '<p class="mk-empty">No discount codes yet.</p>';
    const ag = d.agents.length ? `<table class="mk-t"><thead><tr><th>Agent</th><th class="n">Sent</th><th class="n">Booked</th><th class="n">Rate</th><th class="n">Revenue</th></tr></thead><tbody>
      ${d.agents.map(a => `<tr><td><b>${esc(a.agent)}</b></td><td class="n">${a.sent}</td><td class="n">${a.booked}</td><td class="n">${a.rate}%</td><td class="n">${money(a.revenue)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="mk-empty">Agents haven\'t sent anything in this period.</p>';
    return `<div class="mk-card mk-wide"><div class="mk-h"><h3>Offers</h3><small>${esc(d.rule)}</small></div>${camp}</div>
      <div class="mk-card"><div class="mk-h"><h3>Discount codes</h3></div>${codes}</div><div class="mk-card"><div class="mk-h"><h3>Agents</h3></div>${ag}</div>`;
  }
  function draw() {
    const d = data;
    root.innerHTML = `<div class="mk-bar-top"><div class="mk-per">${[30, 90, 365].map(n => `<button type="button" data-days="${n}" aria-pressed="${n === days}">${n === 365 ? '12 months' : n + ' days'}</button>`).join('')}</div>
      <button type="button" class="mk-ask" data-ask="Review my marketing for the last ${days} days: what worked, what failed, and the next campaign I should run.">Ask Pulse AI for a review</button></div>
      ${kpis(d.kpis)}${d.lessons.length ? `<div class="mk-lessons">${d.lessons.map(t => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
      <div class="mk-grid2">${studio(studioData)}${weekly(d.weekly)}${ideas(d.ideas)}${audience(d.segments)}${funnel(d.funnel)}${tables(d)}</div>`;
  }
  async function load() {
    root.innerHTML = '<p class="mk-empty">Reading your marketing results…</p>';
    try { [data, studioData] = await Promise.all([req(`/api/marketing/overview?days=${days}`), req('/api/marketing/studio').catch(() => null)]); draw(); } catch (e) { root.innerHTML = `<p class="mk-empty">${esc(e.message)}</p>`; }
  }
  document.addEventListener('click', e => {
    if (!root || !root.contains(e.target)) return;
    const p = e.target.closest('[data-days]'); if (p) { days = +p.dataset.days; return load(); }
    const sr = e.target.closest('[data-mko]'); if (sr) { openD = openD === +sr.dataset.mko ? -1 : +sr.dataset.mko; return draw(); }
    const card = e.target.closest('.mk-d');
    if (card) {
      const d = studioData.drafts[+card.dataset.d], val = f => card.querySelector(`[data-f="${f}"]`)?.value?.trim(), msg = val('message'), out = card.querySelector('.mk-res');
      if (e.target.closest('.mk-copy')) { navigator.clipboard?.writeText(msg); out.textContent = 'Copied.'; return; }
      if (e.target.closest('.mk-ai')) return window.PulseCommand?.open(`Improve this offer for my business and tell me if the discount is profitable. Audience: ${d.audience} (${d.matched} agreed). Draft: "${msg}"`);
      if (e.target.closest('.mk-launch')) {
        if (!confirm(`Send "${d.name}" to ${d.reachable} client${d.reachable === 1 ? '' : 's'} now?`)) return;
        const b = e.target.closest('.mk-launch'); b.disabled = true; out.textContent = 'Sending…';
        (async () => {
          const code = val('code'), pct = +val('pct');
          if (code && pct > 0) await req('/api/coupons', 'POST', { code, kind: 'percent', value: pct, expires_on: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) }).catch(err => { if (!/exist|already|duplicate/i.test(err.message)) throw err; });
          const r = await req('/api/marketing/send', 'POST', { name: d.name, message: msg, segment: d.segment });
          out.textContent = `Sent to ${r.sent}${r.skipped ? `, ${r.skipped} skipped` : ''}. Results appear in Offers below within 14 days.`; setTimeout(load, 2500);
        })().catch(err => { out.textContent = err.message; b.disabled = false; });
        return;
      }
    }
    const g = e.target.closest('[data-go]'); if (g) { const [pg, t] = g.dataset.go.split(','); return window.P10?.go(pg, +t); }
    const a = e.target.closest('[data-ask]'); if (a) window.PulseCommand?.open(a.dataset.ask);
  });
  return { mount(s) { root = s.querySelector('#mkRoot'); load(); } };
})();
