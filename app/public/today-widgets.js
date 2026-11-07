// The dashboard library's widgets: each one turns live data into one Today card, built from the shared kit (mx-ui).
// A business type's template (connectors.js TODAY) lists which widgets its Today shows, in order. Add a widget here
// once and every template can use it. d = { biz, live, hist: { all, past }, mem: /api/memberships }
(() => {
  const U = () => window.MXUI;
  const e = s => U().esc(s);
  const money = v => { try { return fmt(v); } catch { return '$' + Math.round(v || 0).toLocaleString(); } };
  const DAY = 864e5, days = t => Math.round((Date.now() - new Date(t)) / DAY);
  const hm = s => String(s || '').slice(11, 16);
  const shortDate = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const due = t => { const n = Math.max(0, -days(t)); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`; };
  const members = d => (d.mem?.items || []).filter(m => m.status === 'active');

  // members per plan and what each plan brings in a month: which plans carry the business
  const byPlan = act => { const by = {}; act.forEach(m => { const k = m.plan || 'Plan'; by[k] = by[k] || { n: 0, v: 0 }; by[k].n++; by[k].v += m.price * 30 / (m.every_days || 30); });
    const list = Object.entries(by).sort((a, b) => b[1].v - a[1].v); if (!list.length) return '';
    return `<div class="er-mix"><small>By plan</small>${U().table(['Plan', 'Members', 'A month'], list.slice(0, 5).map(([k, x]) => ({ cells: [k, String(x.n), money(x.v)] })))}</div>`; };
  const W = {
    // gym: how many people pay you every month, and how that moved
    members(d) {
      const s = d.mem?.summary || {}, act = members(d), new30 = act.filter(m => days(m.started_at) <= 30).length;
      return U().card({ title: 'Members', span: 5, size: 'wide', state: s.cancelled_30 > new30 ? 'warning' : 'healthy', link: U().link('Memberships', 'p:customers:Memberships'),
        body: d.mem ? `<div class="mx-big"><b>${(s.active || 0).toLocaleString()}</b><span class="mx-ctx">active members · ${money(s.monthly)} a month</span></div>
          <div class="er-k" style="grid-template-columns:repeat(4,1fr)"><div><small>New, 30 days</small><b>${new30}</b></div><div><small>Cancelled, 30 days</small><b>${s.cancelled_30 || 0}</b></div>
          <div><small>Paused</small><b>${s.paused || 0}</b></div><div><small>Paid, 30 days</small><b>${money(s.paid_30)}</b></div></div>
          ${byPlan(act)}<p class="mx-ctx" style="margin:12px 0 0">${new30 >= (s.cancelled_30 || 0) ? `Growing: ${new30} joined and ${s.cancelled_30 || 0} left this month.` : `Shrinking: ${s.cancelled_30} left and only ${new30} joined this month. Look at members at risk.`}</p>`
          : U().loading(4) });
    },
    // gym: who pays next, and who is late (the money that is easiest to lose)
    renewals(d) {
      const now = Date.now(), soon = now + 7 * DAY;
      const list = members(d).filter(m => m.renews_at && new Date(m.renews_at) < soon).sort((a, b) => new Date(a.renews_at) - new Date(b.renews_at));
      const late = list.filter(m => new Date(m.renews_at) < now);
      return U().card({ title: 'Renewals this week', span: 7, size: 'wide', state: late.length ? 'warning' : 'neutral', meta: list.length ? `${list.length} · ${money(list.reduce((a, m) => a + m.price, 0))}` : '',
        link: U().link('Memberships', 'p:customers:Memberships'),
        body: !d.mem ? U().loading(4) : list.length ? U().table(['Member', 'Plan', 'Renews', 'Price', ''], list.slice(0, 8).map(m => {
          const overdue = new Date(m.renews_at) < now;
          return { go: 'p:customers:Memberships', cells: [m.name || m.phone || 'Member', m.plan, shortDate(m.renews_at), money(m.price),
            { html: overdue ? U().chip(`${days(m.renews_at)} day${days(m.renews_at) === 1 ? '' : 's'} late`, 'warning') : U().chip(due(m.renews_at)) }] };
        }), 'No renewals this week') + (list.length > 8 ? `<p class="mx-more">${list.length - 8} more in Memberships</p>` : '')
          : U().empty('No renewals in the next 7 days', 'Members whose plan renews this week show up here, late ones first.') });
    },
    // gym: active members who stopped coming; at renewal time they are the ones who cancel
    at_risk(d) {
      const list = members(d).filter(m => !m.last_visit || days(m.last_visit) > 14).sort((a, b) => b.price - a.price);
      return U().card({ title: 'Members at risk', span: 6, state: list.length ? 'warning' : 'healthy', meta: list.length ? `${list.length}` : 'none',
        link: list.length ? U().link('Win them back', 'p:growth:Win back') : '',
        body: !d.mem ? U().loading(3) : list.length ? `<p class="mx-ctx" style="margin:0 0 8px">Paying members who haven't come in 14 days. A personal message before their renewal keeps most of them.</p>
          <div class="mx-list">${list.slice(0, 5).map(m => U().row({ dot: 'warning', title: m.name || m.phone || 'Member',
            sub: `${m.last_visit ? `last visit ${days(m.last_visit)} days ago` : 'no visit yet'} · ${m.plan}`, value: money(m.price), go: 'p:customers:Memberships' })).join('')}</div>`
          : U().empty('Every member came in the last 2 weeks', 'Members who stop coming show up here before they cancel.') });
    },
    // gym: today's classes and how full each one is (capacity from the service, else the business)
    classes_today(d) {
      const t0 = new Date(new Date().toDateString()), t1 = new Date(+t0 + DAY), cap = name => (d.biz.services || []).find(s => s.name === name)?.capacity || d.biz.capacity || 1;
      const by = new Map();
      for (const b of d.hist.all || []) { const t = new Date(b.start); if (t < t0 || t >= t1 || /cancel/.test(b.status || '')) continue;
        const k = `${hm(b.start)}|${b.service || 'Class'}`; by.set(k, (by.get(k) || 0) + 1); }
      const rows = [...by].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, n]) => { const [time, cls] = k.split('|'), c = cap(cls); return { time, cls, n, c, pct: Math.min(100, Math.round(n / c * 100)) }; });
      return U().card({ title: 'Classes today', span: 6, meta: rows.length ? `${rows.length} · ${rows.reduce((a, r) => a + r.n, 0)} booked` : '', link: U().link('Calendar', 'p:calendar:Schedule'),
        body: rows.length ? `<div class="gw-cls">${rows.map(r => `<div class="gw-c"><span class="gw-t">${e(r.time)}</span><span class="gw-n"><b>${e(r.cls)}</b><small>${r.n} of ${r.c} booked${r.pct >= 100 ? ' · full' : r.pct < 40 ? ' · room to fill' : ''}</small></span>
            <span class="gw-bar" role="img" aria-label="${r.pct}% full"><i style="width:${r.pct}%"${r.pct >= 100 ? ' class="full"' : ''}></i></span></div>`).join('')}</div>`
          : U().empty('No classes booked today', 'Today\'s classes and how full they are show up here.') });
    },
  };
  // what the header line says for a template, when its widgets know better than the standard line
  const SUB = {
    gym(d, tasks) {
      const s = d.mem?.summary || {}, t0 = new Date().toDateString(), classes = new Set((d.hist.all || []).filter(b => new Date(b.start).toDateString() === t0 && !/cancel/.test(b.status || '')).map(b => hm(b.start) + b.service)).size;
      return `${classes} class${classes === 1 ? '' : 'es'} today · ${s.renewing_7 || 0} renewal${s.renewing_7 === 1 ? '' : 's'} this week · ${tasks ? `${tasks} thing${tasks > 1 ? 's' : ''} need${tasks === 1 ? 's' : ''} you` : 'nothing waiting for you'}.`;
    },
  };
  document.head.insertAdjacentHTML('beforeend', `<style>
    .gw-cls{display:flex;flex-direction:column;gap:2px}
    .gw-c{display:grid;grid-template-columns:52px 1fr 120px;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid var(--mx-line)}
    .gw-c:last-child{border-bottom:0}
    .gw-t{font-variant-numeric:tabular-nums;font-weight:600;color:var(--mx-ink)}
    .gw-n{display:flex;flex-direction:column;min-width:0}.gw-n b{font-weight:600;color:var(--mx-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gw-n small{color:var(--mx-mute);font-size:12px}
    .gw-bar{height:8px;border-radius:4px;background:var(--mx-raise);overflow:hidden}.gw-bar i{display:block;height:100%;border-radius:4px;background:var(--mx-ink2)}.gw-bar i.full{background:var(--mx-ink)}
  </style>`);
  window.MXTodayW = { W, SUB };
})();
