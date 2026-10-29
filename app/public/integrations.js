// Settings › Integrations: connect the business's own accounts (AI, WhatsApp, Telegram, email, Stripe, webhook),
// test each one live, and create API keys for the business's own systems. Data: /api/integrations.
window.PulseIntegrations = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ST = { connected: ['Connected', 'good'], error: ['Problem', 'bad'], saved: ['Saved, not tested', ''], off: ['Not connected', ''] };
  const ago = t => { if (!t) return ''; const m = Math.round((Date.now() - new Date(t)) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  let root = null, data = null, open = null;

  function card(p) {
    const [st, cls] = ST[p.status] || ST.off, isOpen = open === p.id;
    return `<article class="ig-c ${p.connected ? 'on' : ''}" data-p="${p.id}"><header><div><b>${esc(p.name)}</b><small>${esc(p.does)}</small></div><span class="ig-st ${cls}">${st}</span></header>
      ${p.error ? `<p class="ig-err">${esc(p.error)}</p>` : p.checked_at ? `<p class="ig-ok">Checked ${ago(p.checked_at)}</p>` : ''}
      ${isOpen ? `<form class="ig-f">${p.fields.map(f => `<label>${esc(f.label)}<input name="${f.k}" ${f.secret ? 'type="password" autocomplete="new-password"' : 'autocomplete="off"'} value="${esc(p.values[f.k] || '')}" placeholder="${esc(f.hint || '')}"></label>`).join('')}
        <div class="ig-b"><button type="submit" class="ig-save">Save and test</button>${p.connected ? '<button type="button" class="ig-del">Disconnect</button>' : ''}<button type="button" class="ig-x">Cancel</button></div><p class="ig-msg" aria-live="polite"></p></form>`
      : `<footer>${p.connected ? '<button type="button" class="ig-test">Test</button>' : ''}<button type="button" class="ig-edit">${p.connected ? 'Edit' : 'Connect'}</button></footer>`}</article>`;
  }
  function draw() {
    const groups = [...new Set(data.providers.map(p => p.group))], n = data.providers.filter(p => p.status === 'connected').length;
    root.innerHTML = `<p class="ig-intro"><b>${n} of ${data.providers.length}</b> connected. Keys are encrypted and never shown again in full. Each connection is checked live when you save it.</p>
      ${groups.map(g => `<h3 class="ig-g">${esc(g)}</h3><div class="ig-grid">${data.providers.filter(p => p.group === g).map(card).join('')}</div>`).join('')}
      <h3 class="ig-g">Your API</h3><div class="ig-c ig-api"><p>Let your own systems read your bookings, customers and totals. Send the key as <code>Authorization: Bearer pk_…</code></p>
        <div class="ig-ends"><code>GET ${location.origin}/api/v1/summary</code><code>GET ${location.origin}/api/v1/bookings?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</code><code>GET ${location.origin}/api/v1/customers?limit=100</code></div>
        <table class="ig-keys"><thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>
        ${data.keys.map(k => `<tr><td>${esc(k.name)}</td><td><code>${esc(k.prefix)}…</code></td><td>${esc(String(k.created_at).slice(0, 10))}</td><td>${k.last_used_at ? ago(k.last_used_at) : 'never'}</td><td><button type="button" class="ig-rev" data-k="${k.id}">Revoke</button></td></tr>`).join('') || '<tr><td colspan="5" class="ig-none">No keys yet.</td></tr>'}</tbody></table>
        <div class="ig-b"><input id="igKeyName" placeholder="Key name, e.g. My CRM"><button type="button" class="ig-new">Create key</button></div><p class="ig-msg" id="igKeyMsg"></p></div>
      <p class="ig-intro">Webhook events: <code>booking.created</code> <code>booking.cancelled</code> <code>approval.needed</code> <code>chat.handoff</code> <code>ai.unsure</code> <code>review.received</code>. Each is a JSON POST signed with <code>X-Pulse-Signature: sha256=HMAC(secret, body)</code>.</p>`;
  }
  async function load() { try { data = await req('/api/integrations'); draw(); } catch (e) { root.innerHTML = `<p class="ig-intro">${esc(e.message)}</p>`; } }
  async function test(id, msgEl) {
    if (msgEl) msgEl.textContent = 'Testing…';
    const r = await req(`/api/integrations/${id}/test`, 'POST'); window.toast?.(r.message); return r;
  }
  document.addEventListener('click', async e => {
    if (!root || !root.contains(e.target)) return;
    const c = e.target.closest('[data-p]'), id = c?.dataset.p;
    if (e.target.closest('.ig-edit')) { open = id; draw(); return root.querySelector(`[data-p="${id}"] input`)?.focus(); }
    if (e.target.closest('.ig-x')) { open = null; return draw(); }
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
  return { mount(s) { root = s.querySelector('#igRoot'); load(); } };
})();
