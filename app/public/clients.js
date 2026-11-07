// Clients: who to act on first (regulars drifting away, new clients to turn into regulars, no-shows), then every
// client in one calm list with filters and search. A click opens the client's record (js/customers.js openCustomer).
(() => {
  const U = window.MXUI, e = U.esc, DAY = 864e5;
  const money = v => { try { return fmt(v); } catch { return '$' + Math.round(v || 0).toLocaleString(); } };
  const ago = d => d ? Math.max(0, Math.round((Date.now() - new Date(d + 'T12:00')) / DAY)) : null;
  const when = n => n == null ? '—' : n === 0 ? 'today' : n === 1 ? 'yesterday' : n < 14 ? `${n} days ago` : n < 60 ? `${Math.round(n / 7)} weeks ago` : `${Math.round(n / 30)} months ago`;
  const next = s => { if (!s) return ''; const d = new Date(s); return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + String(s).slice(11, 16); };
  const word = () => (window.MXBIZ?.terms?.customers || 'clients');

  // one rule per group, used by the cards, the chips and the page sentence
  const is = {
    regular: c => c.visits >= 3,
    drifting: c => c.visits >= 2 && !c.upcoming && ago(c.last_visit) > 45 && ago(c.last_visit) <= 365,
    fresh: c => ago(c.since) <= 30 && c.visits <= 1, // joined this month and not yet back for a second visit
    noshow: c => c.no_shows > 0,
    offers: c => !!c.marketing_ok,
  };
  const segments = rows => ({ regular: rows.filter(is.regular).length, drifting: rows.filter(is.drifting).length, fresh: rows.filter(is.fresh).length,
    noshow: rows.filter(is.noshow).length, offers: rows.filter(is.offers).length });
  const tag = c => is.drifting(c) ? '<span class="cl-tag warn">Drifting away</span>' : is.regular(c) ? '<span class="cl-tag">Regular</span>' : is.fresh(c) ? '<span class="cl-tag new">New</span>' : '';

  let root = null, rows = [], filter = 'all', query = '', limit = 50, searchT = 0;
  const FILTERS = [['all', 'All'], ['regular', 'Regulars'], ['drifting', 'Drifting away'], ['fresh', 'New'], ['offers', 'Can receive offers']];

  async function load() {
    root.innerHTML = `<div class="mx-page cl"><div class="mx-grid">${['Drifting away', 'New this month', 'No-shows'].map(t => U.card({ title: t, span: 4, body: U.loading(3) })).join('')}</div>
      <div class="mx-grid">${U.card({ title: 'All ' + word(), span: 12, size: 'wide', body: U.loading(6) })}</div></div>`;
    try { rows = await req('/api/customers' + (query ? '?q=' + encodeURIComponent(query) : '')); draw(); }
    catch { root.innerHTML = `<div class="mx-page cl">${U.error(word(), 'retry')}</div>`; }
  }

  // a person in a card: name, why they are here, and what they're worth
  const person = (c, sub) => `<button type="button" class="cl-p" data-cl="${c.id}"><span class="cl-av" aria-hidden="true">${e((c.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase())}</span>
    <span class="cl-pt"><b>${e(c.name || c.phone || 'Client')}</b><small>${sub}</small></span><span class="cl-pv">${money(c.spent)}</span></button>`;
  function cards() {
    const drifting = rows.filter(is.drifting).sort((a, b) => b.spent - a.spent), fresh = rows.filter(is.fresh).sort((a, b) => (a.upcoming ? 1 : 0) - (b.upcoming ? 1 : 0)),
      noshow = rows.filter(is.noshow).sort((a, b) => b.no_shows - a.no_shows);
    const list = (xs, sub) => `<div class="cl-list">${xs.slice(0, 4).map(c => person(c, sub(c))).join('')}</div>`;
    const more = (xs, f) => xs.length > 4 ? `<button type="button" class="mx-link" data-f="${f}">See all ${xs.length} →</button>` : '';
    return `<div class="mx-grid">
      ${U.card({ title: 'Drifting away', span: 4, state: drifting.length ? 'warning' : 'neutral', meta: drifting.length ? `${drifting.length}` : '',
        body: drifting.length ? `<p class="cl-why">Regulars who haven't been in 45 days and have nothing booked. A short message now usually brings them back.</p>${list(drifting, c => `last visit ${when(ago(c.last_visit))} · ${c.visits} visits`)}
          <div class="cl-foot">${more(drifting, 'drifting')}<button type="button" class="mx-btn pri" data-go2="growth|Win back">Win them back</button></div>`
          : U.empty('No regulars drifting away', 'Regulars who stop coming for 45 days show up here, with a one-tap way to invite them back.') })}
      ${U.card({ title: 'New this month', span: 4, meta: fresh.length ? `${fresh.length}` : '',
        body: fresh.length ? `<p class="cl-why">A second visit within 6 weeks is what turns a new client into a regular.</p>${list(fresh, c => c.upcoming ? `next visit ${next(c.next_visit)}` : `joined ${when(ago(c.since))} · nothing booked`)}
          <div class="cl-foot">${more(fresh, 'fresh')}<button type="button" class="mx-btn" data-go2="growth|Offers">Invite them back</button></div>`
          : U.empty('No new clients this month', 'Everyone who books for the first time shows up here.') })}
      ${U.card({ title: 'No-shows', span: 4, state: noshow.length ? 'warning' : 'neutral', meta: noshow.length ? `${noshow.length}` : '',
        body: noshow.length ? `<p class="cl-why">Clients who missed an appointment. Open one to see their history before they book again.</p>${list(noshow, c => `${c.no_shows} no-show${c.no_shows === 1 ? '' : 's'} · ${c.visits} visits`)}
          <div class="cl-foot">${more(noshow, 'noshow')}</div>`
          : U.empty('No no-shows', 'Appointments marked as no-show appear here, so you can spot a pattern early.') })}
    </div>`;
  }
  function table() {
    const test = filter === 'all' ? () => true : filter === 'noshow' ? is.noshow : is[filter];
    const list = rows.filter(test), seg = segments(rows);
    const count = { all: rows.length, ...seg };
    const chips = FILTERS.concat(filter === 'noshow' ? [['noshow', 'No-shows']] : []).map(([k, l]) =>
      `<button type="button" class="cl-chip" data-f="${k}" aria-pressed="${filter === k}">${l} <span>${count[k] ?? ''}</span></button>`).join('');
    const body = list.length ? `<div class="cl-scroll"><table class="cl-t"><thead><tr><th scope="col">Client</th><th scope="col">Last visit</th><th scope="col">Next visit</th>
        <th scope="col" class="num">Visits</th><th scope="col" class="num">Spent</th><th scope="col">Offers</th></tr></thead><tbody>
      ${list.slice(0, limit).map(c => `<tr data-cl="${c.id}" tabindex="0" aria-label="Open ${e(c.name || c.phone || 'client')}">
        <td><span class="cl-name"><b>${e(c.name || 'No name')}</b>${tag(c)}</span><small>${e(c.phone || c.email || '')}</small></td>
        <td>${when(ago(c.last_visit))}</td><td>${c.next_visit ? e(next(c.next_visit)) : '<span class="cl-mute">Nothing booked</span>'}</td>
        <td class="num">${c.visits}${c.no_shows ? ` <span class="cl-ns" title="${c.no_shows} no-show${c.no_shows === 1 ? '' : 's'}">· ${c.no_shows} missed</span>` : ''}</td>
        <td class="num">${money(c.spent)}</td><td>${c.marketing_ok ? '<span class="cl-yes">Yes</span>' : '<span class="cl-mute">No</span>'}</td></tr>`).join('')}
      </tbody></table></div>${list.length > limit ? `<div class="cl-more"><button type="button" class="mx-btn" data-more="1">Show ${Math.min(50, list.length - limit)} more of ${list.length - limit}</button></div>` : ''}`
      : U.empty(query ? `No ${word()} match “${query}”` : `No ${word()} in this group`, query ? 'Try part of a name or the last digits of a phone number.' : 'Pick another group above.');
    return `<div class="mx-grid">${U.card({ title: 'All ' + word(), span: 12, size: 'wide', meta: `${list.length} shown`,
      body: `<div class="cl-bar"><div class="cl-chips" role="group" aria-label="Show">${chips}</div>
        <label class="cl-search"><span class="sr-only">Search ${word()}</span><input type="search" placeholder="Search name, phone or email" value="${e(query)}" data-search="1" autocomplete="off"></label></div>${body}` })}</div>`;
  }
  function draw() {
    const keep = document.activeElement?.dataset?.search ? document.activeElement.selectionStart : null;
    root.innerHTML = `<div class="mx-page cl">${query ? '' : cards()}${table()}</div>`;
    if (keep != null) { const s = root.querySelector('[data-search]'); s.focus(); s.setSelectionRange(keep, keep); }
  }
  function wire() {
    root.addEventListener('click', ev => {
      const t = ev.target;
      const p = t.closest('[data-cl]'); if (p) return window.openCustomer?.(+p.dataset.cl);
      const f = t.closest('[data-f]'); if (f) { filter = f.dataset.f; limit = 50; draw(); root.querySelector('.cl-bar')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      const g = t.closest('[data-go2]'); if (g) { const [pg, tb] = g.dataset.go2.split('|'); return window.P10?.go(pg, tb); }
      if (t.closest('[data-more]')) { limit += 50; return draw(); }
      if (t.closest('[data-go="retry"]')) return load();
    });
    root.addEventListener('keydown', ev => { const r = ev.target.closest?.('tr[data-cl]'); if (r && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); window.openCustomer?.(+r.dataset.cl); } });
    root.addEventListener('input', ev => { if (!ev.target.dataset.search) return; clearTimeout(searchT); const v = ev.target.value.trim();
      searchT = setTimeout(() => { query = v; filter = 'all'; limit = 50; req('/api/customers' + (v ? '?q=' + encodeURIComponent(v) : '')).then(r => { rows = r; draw(); }).catch(() => {}); }, 250); });
    // a client saved, merged or erased in their record: the list follows
    addEventListener('mxai:change', () => { if (root?.isConnected && !root.closest('[hidden]')) req('/api/customers' + (query ? '?q=' + encodeURIComponent(query) : '')).then(r => { rows = r; draw(); }).catch(() => {}); });
  }
  window.MXClients = { segments, refresh() { if (root?.isConnected) load(); }, mount(el) { if (root !== el) { root = el; wire(); } query = ''; filter = 'all'; limit = 50; load(); } };
})();
