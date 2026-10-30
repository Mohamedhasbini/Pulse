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

  // hero band: revenue won with its weekly trend, four supporting numbers, and the opt-in ring
  const ring = (pct, size = 92) => { const r = size / 2 - 7, c = 2 * Math.PI * r;
    return `<svg class="mk-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${pct}% agreed to offers">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="mk-ring-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="mk-ring-fg" stroke-dasharray="${c * pct / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="50%" dy=".35em" text-anchor="middle">${pct}%</text></svg>`; };
  const spark = (vals, W = 260, H = 56) => { const n = vals.length; if (n < 2) return ''; const m = Math.max(1, ...vals), X = i => i * W / (n - 1), Y = v => H - 4 - v / m * (H - 10);
    const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    return `<svg class="mk-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="mkSpG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      <polygon points="0,${H} ${pts} ${W},${H}" fill="url(#mkSpG)"/><polyline points="${pts}" class="mk-spark-l"/></svg>`; };
  function kpis(k, w) {
    const tile = (l, v, s) => `<div class="mk-k"><span>${l}</span><b>${v}</b><small>${s}</small></div>`;
    return `<div class="mk-band mk-hero-band">
      <div class="mk-lead"><span class="mk-eyebrow">Revenue from marketing · last ${days} days</span><b class="mk-big">${money(k.revenue)}</b>
        <div class="mk-lead-meta"><span class="mk-chip ${k.won ? 'good' : ''}">${k.won} booking${k.won === 1 ? '' : 's'} won</span><span class="mk-chip">${k.reached ? k.conversion + '% conversion' : 'no sends yet'}</span></div>
        ${spark(w.map(x => x.revenue || 0))}</div>
      <div class="mk-kgrid">${tile('Messages sent', k.sent.toLocaleString(), `${k.reached} reached`)}${tile('Conversion', k.reached ? k.conversion + '%' : '—', 'booked within 14 days')}
        ${tile('Return on discounts', k.roi ? k.roi + '×' : '—', k.discounts ? `${money(k.discounts)} given` : 'no discounts yet')}${tile('Clients', k.customers.toLocaleString(), `${k.opted_in} can get offers`)}</div>
      <div class="mk-aud"><span class="mk-eyebrow">Agreed to offers</span>${ring(k.optin_rate || 0)}<small>${k.opted_in} of ${k.customers}</small></div></div>`;
  }
  // weekly: bars = messages sent, line = bookings won, both on their own scale
  function weekly(w) {
    const W = Math.max(480, Math.round((root?.clientWidth || 900) * 0.62)), H = 240, l = 30, r = 30, t = 16, b = 26, n = w.length;
    if (!n) return '';
    const mS = Math.max(4, ...w.map(x => x.sent)), mB = Math.max(2, ...w.map(x => x.booked)), X = i => l + (n < 2 ? 0 : i * (W - l - r) / (n - 1));
    const bw = Math.min(22, (W - l - r) / n * 0.5), YS = v => H - b - v / mS * (H - b - t), YB = v => H - b - v / mB * (H - b - t);
    let g = `<defs><linearGradient id="mkBarG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".55"/><stop offset="1" stop-color="var(--accent)" stop-opacity=".08"/></linearGradient>
      <linearGradient id="mkAreaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--good)" stop-opacity=".28"/><stop offset="1" stop-color="var(--good)" stop-opacity="0"/></linearGradient>
      <pattern id="mkHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--accent)" stroke-opacity=".25" stroke-width="1"/></pattern></defs>`;
    for (let i = 0; i <= 3; i++) { const y = t + i * (H - b - t) / 3; g += `<line x1="${l}" x2="${W - r}" y1="${y}" y2="${y}" class="mk-grid"/><text x="${l - 6}" y="${y + 4}" text-anchor="end">${Math.round(mS * (3 - i) / 3)}</text><text x="${W - r + 6}" y="${y + 4}">${Math.round(mB * (3 - i) / 3)}</text>`; }
    w.forEach((x, i) => { const y = x.sent ? YS(x.sent) : H - b - 2, h = H - b - y;
      g += `<rect x="${X(i) - bw / 2}" y="${y}" width="${bw}" height="${h}" rx="4" class="mk-gbar ${x.sent ? '' : 'empty'}"><title>Week of ${x.week}: ${x.sent} sent</title></rect>${x.sent ? `<rect x="${X(i) - bw / 2}" y="${y}" width="${bw}" height="${h}" rx="4" fill="url(#mkHatch)"/>` : ''}`; });
    const pts = w.map((x, i) => `${X(i)},${YB(x.booked)}`).join(' ');
    g += `<polygon points="${X(0)},${H - b} ${pts} ${X(n - 1)},${H - b}" fill="url(#mkAreaG)"/><polyline points="${pts}" class="mk-line"/>` + w.map((x, i) => x.booked ? `<circle cx="${X(i)}" cy="${YB(x.booked)}" r="4" class="mk-dot"><title>${x.booked} booked · ${money(x.revenue)}</title></circle>` : '').join('');
    [0, Math.floor((n - 1) / 2), n - 1].forEach(i => { g += `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${w[i].week.slice(5)}</text>`; });
    const any = w.some(x => x.sent || x.booked), tot = w.reduce((a, x) => ({ s: a.s + x.sent, b: a.b + x.booked }), { s: 0, b: 0 });
    return `<div class="mk-card mk-chart"><div class="mk-h"><div><h3>Messages → bookings</h3><small>${tot.s} sent · ${tot.b} booked · weekly</small></div><div class="mk-leg"><span class="s">Sent</span><span class="b">Booked</span></div></div>
      <svg viewBox="0 0 ${W} ${H}" class="mk-svg" role="img" aria-label="Messages sent and bookings won per week">${g}</svg>${any ? '' : '<p class="mk-empty">Nothing sent yet in this period.</p>'}</div>`;
  }
  // audience: one stacked bar of every client, then each segment with how many you can reach
  const COL = { vip: '#a78bfa', regular: '#34d399', active: '#38d3f5', new: '#5b8cff', occasional: '#94a3b8', lapsed: '#fbbf24', lost: '#f87171', never: '#475569' };
  function audience(s) {
    const rows = ORDER.filter(k => s[k]), total = rows.reduce((a, k) => a + s[k].n, 0) || 1, R = 46, C = 2 * Math.PI * R;
    let off = 0; const arcs = rows.map(k => { const len = s[k].n / total * C, a = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${COL[k]}" stroke-width="14" stroke-dasharray="${Math.max(0, len - 2)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"><title>${SEG[k][0]}: ${s[k].n}</title></circle>`; off += len; return a; }).join('');
    return `<div class="mk-card"><div class="mk-h"><div><h3>Audience</h3><small>${total} clients by segment</small></div></div>
      <div class="mk-donut-row"><svg viewBox="0 0 120 120" class="mk-donut" role="img" aria-label="Clients by segment"><circle cx="60" cy="60" r="${R}" fill="none" class="mk-ring-bg" stroke-width="14"/>${arcs}
        <text x="60" y="56" text-anchor="middle" class="mk-donut-n">${total}</text><text x="60" y="72" text-anchor="middle" class="mk-donut-l">clients</text></svg>
      <table class="mk-t mk-seg"><tbody>${rows.map(k => `<tr><td><span class="mk-sw" style="background:${COL[k]}"></span>${SEG[k][0]}</td><td class="n">${s[k].n}</td><td class="n ${s[k].reachable ? 'mk-ok' : 'mk-zero'}">${s[k].reachable} reach</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  function funnel(f) {
    const steps = [['Chatted', f.talked], ['Booked', f.booked], ['Returned', f.returned]], m = Math.max(1, ...steps.map(x => x[1]));
    return `<div class="mk-card"><div class="mk-h"><div><h3>Client journey</h3><small>last ${days} days</small></div></div>
      <div class="mk-vbars">${steps.map(([l, v], i) => `<div class="mk-vb"><small class="mk-vr">${i && steps[i - 1][1] ? Math.round(v / steps[i - 1][1] * 100) + '%' : ''}</small>
        <div class="mk-vt"><i style="height:${Math.max(3, v / m * 100)}%"><b>${v}</b></i></div><span>${l}</span></div>`).join('')}</div></div>`;
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
    const d = data, short = t => esc(t.split(/(?<=\.)\s/)[0]);
    root.innerHTML = `<div class="mk-bar-top"><div class="mk-per">${[30, 90, 365].map(n => `<button type="button" data-days="${n}" aria-pressed="${n === days}">${n === 365 ? '12 months' : n + ' days'}</button>`).join('')}</div>
      <button type="button" class="mk-ask" data-ask="Review my marketing for the last ${days} days: what worked, what failed, and the next campaign I should run.">✦ Ask MXAi Assistant for a review</button></div>
      ${kpis(d.kpis, d.weekly)}
      ${d.lessons.length ? `<div class="mk-insights">${d.lessons.slice(0, 3).map((t, i) => `<div class="mk-ins"><i>${['◆', '▲', '●'][i]}</i><span>${short(t)}</span></div>`).join('')}</div>` : ''}
      <div class="mk-row2">${weekly(d.weekly)}${funnel(d.funnel)}</div>
      ${studio(studioData)}
      <div class="mk-row2b">${audience(d.segments)}${ideas(d.ideas)}</div>
      <div class="mk-grid2">${tables(d)}</div>`;
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
