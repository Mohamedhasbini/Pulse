// Settings › Integrations: connect the business's own accounts (AI, WhatsApp, Telegram, email, Stripe, webhook),
// test each one live, and create API keys for the business's own systems. Data: /api/integrations.
window.PulseIntegrations = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ST = { connected: ['Connected', 'good'], error: ['Problem', 'bad'], saved: ['Saved, not tested', ''], off: ['Not connected', ''] };
  const ago = t => { if (!t) return ''; const m = Math.round((Date.now() - new Date(t)) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  let root = null, data = null, open = null, cat = null, kind = 'all';

  function card(p) {
    const [st, cls] = ST[p.status] || ST.off, isOpen = open === p.id;
    // not allowed for this business yet: the Lab decides; the owner can ask for it
    if (p.allowed === false) {
      const M = typeof me !== 'undefined' ? me : null, admin = M?.user?.role === 'admin' && !M?.view_as;
      return `<article class="ig-c locked" data-p="${p.id}" data-key="${esc(p.key)}"><header><div><b>${esc(p.name)}</b><small>${esc(p.does)}</small></div><span class="ig-st">Needs approval</span></header>
        <footer>${admin ? '<span class="ig-ok">Allow it for this business in Lab › Controls</span>' : `<button type="button" class="ig-req" ${p.requested ? 'disabled' : ''}>${p.requested ? 'Requested' : 'Request'}</button>`}</footer></article>`;
    }
    return `<article class="ig-c ${p.connected ? 'on' : ''}" data-p="${p.id}"><header><div><b>${esc(p.name)}</b><small>${esc(p.does)}</small></div><span class="ig-st ${cls}">${st}</span></header>
      ${p.error ? `<p class="ig-err">${esc(p.error)}</p>` : p.checked_at ? `<p class="ig-ok">Checked ${ago(p.checked_at)}</p>` : ''}
      ${isOpen ? `<form class="ig-f">${p.fields.map(f => `<label>${esc(f.label)}<input name="${f.k}" ${f.secret ? 'type="password" autocomplete="new-password"' : 'autocomplete="off"'} value="${esc(p.values[f.k] || '')}" placeholder="${esc(f.hint || '')}"></label>`).join('')}
        <div class="ig-b"><button type="submit" class="ig-save">Save and test</button>${p.connected ? '<button type="button" class="ig-del">Disconnect</button>' : ''}<button type="button" class="ig-x">Cancel</button></div><p class="ig-msg" aria-live="polite"></p></form>`
      : `<footer>${p.connected ? '<button type="button" class="ig-test">Test</button>' : ''}<button type="button" class="ig-edit">${p.connected ? 'Edit' : 'Connect'}</button></footer>`}</article>`;
  }
  // every channel and tool MXAi can draw from: live ones open their setup below, the rest are on the way
  function catalog() {
    if (!cat) return '';
    const ks = Object.entries(cat.kinds).filter(([k]) => cat.connectors.some(c => c.kind === k)), list = cat.connectors.filter(c => kind === 'all' || c.kind === kind);
    const live = cat.connectors.filter(c => c.status === 'live').length;
    return `<section class="cn"><header class="cn-h"><b>Connectors</b><small>${live} ready today, ${cat.connectors.length - live} on the way. Each one feeds the same dashboard.</small></header>
      <div class="cn-f" role="tablist">${[['all', 'All'], ...ks].map(([k, l]) => `<button type="button" role="tab" data-kind="${k}" aria-selected="${kind === k}">${esc(l)}</button>`).join('')}</div>
      <div class="cn-g">${list.map(c => `<button type="button" class="cn-c ${c.status}${c.connected ? ' on' : ''}" ${c.status === 'live' ? `data-open="${c.provider}"` : 'disabled'}>
        <i aria-hidden="true">${esc(c.name.slice(0, 1))}</i><span><b>${esc(c.name)}</b><small>${esc(c.does)}</small></span>
        <em>${c.connected ? 'Connected' : c.status === 'live' ? 'Set up' : 'Soon'}</em></button>`).join('')}</div></section>`;
  }
  function draw() {
    const groups = [...new Set(data.providers.map(p => p.group))], n = data.providers.filter(p => p.status === 'connected').length;
    root.innerHTML = catalog() + `<p class="ig-intro"><b>${n} of ${data.providers.length}</b> connected. Keys are encrypted and never shown again in full. Each connection is checked live when you save it.</p>
      ${groups.map(g => `<h3 class="ig-g">${esc(g)}</h3><div class="ig-grid">${data.providers.filter(p => p.group === g).map(card).join('')}</div>`).join('')}
      <h3 class="ig-g">Your API</h3><div class="ig-c ig-api"><p>Let your own systems read your bookings, customers and totals. Send the key as <code>Authorization: Bearer pk_…</code></p>
        <div class="ig-ends"><code>GET ${location.origin}/api/v1/summary</code><code>GET ${location.origin}/api/v1/bookings?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</code><code>GET ${location.origin}/api/v1/customers?limit=100</code></div>
        <table class="ig-keys"><thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>
        ${data.keys.map(k => `<tr><td>${esc(k.name)}</td><td><code>${esc(k.prefix)}…</code></td><td>${esc(String(k.created_at).slice(0, 10))}</td><td>${k.last_used_at ? ago(k.last_used_at) : 'never'}</td><td><button type="button" class="ig-rev" data-k="${k.id}">Revoke</button></td></tr>`).join('') || '<tr><td colspan="5" class="ig-none">No keys yet.</td></tr>'}</tbody></table>
        <div class="ig-b"><input id="igKeyName" placeholder="Key name, e.g. My CRM"><button type="button" class="ig-new">Create key</button></div><p class="ig-msg" id="igKeyMsg"></p></div>
      <p class="ig-intro">Webhook events: <code>booking.created</code> <code>booking.cancelled</code> <code>approval.needed</code> <code>chat.handoff</code> <code>ai.unsure</code> <code>review.received</code>. Each is a JSON POST signed with <code>X-MXAi-Signature: sha256=HMAC(secret, body)</code>.</p>`;
  }
  async function load() { try { [data, cat] = await Promise.all([req('/api/integrations'), req('/api/connectors').catch(() => null)]); draw(); } catch (e) { root.innerHTML = `<p class="ig-intro">${esc(e.message)}</p>`; } }
  async function test(id, msgEl) {
    if (msgEl) msgEl.textContent = 'Testing…';
    const r = await req(`/api/integrations/${id}/test`, 'POST'); window.toast?.(r.message); return r;
  }
  document.addEventListener('click', async e => {
    if (!root || !root.contains(e.target)) return;
    const c = e.target.closest('[data-p]'), id = c?.dataset.p;
    if (e.target.closest('.ig-edit')) { open = id; draw(); return root.querySelector(`[data-p="${id}"] input`)?.focus(); }
    if (e.target.closest('.ig-x')) { open = null; return draw(); }
    if (e.target.closest('.ig-req')) { if (typeof me !== 'undefined' && me?.view_as) return window.toast?.('This is what the owner sees. Their requests come to your Lab.');
      try { await req('/api/upgrade-requests', 'POST', { feature: c.dataset.key }); window.toast?.("Request sent. You'll get a notification when it's allowed."); } catch (err) { window.toast?.(err.message); } return load(); }
    if (e.target.closest('.ig-test')) { e.target.disabled = true; await test(id).catch(err => window.toast?.(err.message)); return load(); }
    if (e.target.closest('.ig-del')) { if (!confirm('Disconnect this account? Its saved key is deleted.')) return; await req(`/api/integrations/${id}`, 'DELETE'); open = null; return load(); }
    if (e.target.closest('.ig-new')) {
      try { const r = await req('/api/integration-keys', 'POST', { name: root.querySelector('#igKeyName').value }); await load();
        root.querySelector('#igKeyMsg').innerHTML = `Copy it now, it won't be shown again: <code>${esc(r.key)}</code>`; navigator.clipboard?.writeText(r.key); } catch (err) { window.toast?.(err.message); }
      return;
    }
    const rv = e.target.closest('.ig-rev'); if (rv && confirm('Revoke this key? Anything using it stops working.')) { await req(`/api/integration-keys/${rv.dataset.k}`, 'DELETE'); load(); }
  });
  document.addEventListener('submit', async e => {
    const f = e.target.closest('.ig-f'); if (!f || !root?.contains(f)) return; e.preventDefault();
    const id = f.closest('[data-p]').dataset.p, msg = f.querySelector('.ig-msg'), body = Object.fromEntries(new FormData(f));
    f.querySelector('.ig-save').disabled = true; msg.textContent = 'Saving…';
    try {
      const s = await req(`/api/integrations/${id}`, 'PUT', body), r = await test(id, msg);
      msg.textContent = (r.ok ? '✓ ' : '✕ ') + r.message + (s.secret ? ` · Signing secret: ${s.secret}` : '');
      if (r.ok && !s.secret) { open = null; setTimeout(load, 900); } else f.querySelector('.ig-save').disabled = false;
    } catch (err) { msg.textContent = err.message; f.querySelector('.ig-save').disabled = false; }
  });
  return { mount(s) { root = s.querySelector('#igRoot');
    if (!root.dataset.cn) { root.dataset.cn = 1; root.addEventListener('click', ev => {
      const k = ev.target.closest('[data-kind]'); if (k) { kind = k.dataset.kind; draw(); return; }
      const o = ev.target.closest('[data-open]'); if (o) { open = o.dataset.open; draw(); root.querySelector(`[data-p="${open}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }); }
    load(); } };
})();
