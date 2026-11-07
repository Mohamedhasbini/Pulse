// Lab › Controls: everything MXAi can reach (channels, outside connectors, AI providers, MCP servers) in one list.
// Left: the switch for the whole platform (off = off for every business at once). Right: one business at a time,
// Default / Allow / Block. Connectors are blocked by default until you allow them; channels and AI are allowed.
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const send = (url, body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error || 'Failed'))));
  let D = null, biz = null;

  async function load() {
    const box = $('#ccCtl'); if (!box) return;
    if (!D) box.innerHTML = '<p class="hq-loading">Loading controls…</p>';
    const r = await fetch('/api/admin/controls'); D = r.ok ? await r.json() : null;
    if (!D) { box.innerHTML = '<p class="hq-loading">Could not load the controls. Try again in a moment.</p>'; return; }
    if (biz == null || !D.businesses.some(b => b.id === biz)) biz = D.businesses.find(b => !b.is_demo)?.id ?? D.businesses[0]?.id ?? null;
    draw();
  }

  function draw() {
    const box = $('#ccCtl'), B = D.businesses.find(b => b.id === biz), kinds = [...new Set(D.items.map(i => i.kind))];
    const offN = D.items.filter(i => D.platform[i.key] === false).length;
    const row = i => {
      const on = D.platform[i.key] !== false, v = B?.allow?.[i.key], eff = on && (v ?? i.default_on);
      return `<tr><td><b>${esc(i.name)}</b><small>${esc(i.does || '')}</small></td>
        <td><button type="button" class="hq-sw" role="switch" aria-checked="${on}" data-plat="${esc(i.key)}" aria-label="${esc(i.name)} for every business">${on ? 'On' : 'Off'}</button></td>
        <td>${B ? `<select data-biz="${esc(i.key)}" aria-label="${esc(i.name)} for ${esc(B.name)}">
          <option value="" ${v === undefined ? 'selected' : ''}>Default (${i.default_on ? 'allowed' : 'blocked'})</option>
          <option value="1" ${v === true ? 'selected' : ''}>Allow</option><option value="0" ${v === false ? 'selected' : ''}>Block</option></select>` : ''}</td>
        <td><span class="hq-st ${eff ? 'ok' : 'bad'}">${eff ? 'In use' : on ? 'Blocked' : 'Off everywhere'}</span></td></tr>`;
    };
    box.innerHTML = `<div class="hq-head"><div><h2>Controls</h2><p>Everything MXAi can reach. Off for every business in one tap, or allow and block it for one business. Every change is in the audit log.</p></div></div>
      <div class="ctl-bar"><label>Business <select id="ctlBiz">${D.businesses.map(b => `<option value="${b.id}" ${b.id === biz ? 'selected' : ''}>${esc(b.name)}${b.is_demo ? ' (test)' : ''}</option>`).join('')}</select></label>
        <span class="hq-note">${offN ? `${offN} switched off for everyone` : 'Nothing is switched off for everyone'}</span></div>
      ${kinds.map(k => `<section class="hq-c ctl-c"><header><h3>${esc(k)}</h3><small>${k === 'Connectors' ? 'blocked for every business until you allow it' : 'allowed by default'}</small></header>
        <div class="hq-tw"><table class="hq-t ctl-t"><thead><tr><th>Item</th><th>Every business</th><th>${esc(B?.name || 'Business')}</th><th>Now</th></tr></thead>
        <tbody>${D.items.filter(i => i.kind === k).map(row).join('')}</tbody></table></div></section>`).join('')}
      <section class="hq-c ctl-c"><header><h3>MCP servers</h3><small>tools the MXAi Assistant may use</small></header>
        <p class="hq-note">${D.mcp.length ? '' : 'None connected yet. When one is added it appears here with the same switches, off until you allow it.'}</p></section>`;
  }

  document.addEventListener('change', async e => {
    if (e.target.id === 'ctlBiz') { biz = +e.target.value; return draw(); }
    const s = e.target.closest('#ccCtl [data-biz]'); if (!s) return;
    const value = s.value === '' ? null : s.value === '1';
    try { await send(`/api/admin/controls/business/${biz}`, { key: s.dataset.biz, value }); window.toast?.('Saved. It applies within 15 seconds.'); } catch (err) { window.toast?.(err.message); }
    load();
  });
  document.addEventListener('click', async e => {
    const t = e.target.closest('#ccCtl [data-plat]'); if (!t) return;
    const i = D.items.find(x => x.key === t.dataset.plat), on = t.getAttribute('aria-checked') !== 'true';
    if (!on && !confirm(`Switch ${i.name} off for EVERY business? It stops within 15 seconds until you switch it back on.`)) return;
    try { await send('/api/admin/controls/platform', { key: i.key, on }); window.toast?.(`${i.name} ${on ? 'on' : 'off'} for every business.`); } catch (err) { window.toast?.(err.message); }
    load();
  });

  // a "Controls" entry under HQ in the Lab's menu
  function mount() {
    const nav = document.querySelector('nav.setnav'), main = document.querySelector('.ccmain'), hq = nav?.querySelector('[data-k="hq"]');
    if (!nav || !main || !hq) return false;
    if (!$('#ccCtl')) {
      const pane = document.createElement('div'); pane.id = 'ccCtl'; pane.className = 'hq'; pane.hidden = true; main.append(pane);
      hq.insertAdjacentHTML('afterend', '<button type="button" data-k="ctl"><i></i>Controls</button>');
      nav.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; const on = b.dataset.k === 'ctl';
        pane.hidden = !on; main.classList.toggle('ctl-on', on); if (on) { nav.querySelectorAll('[data-k]').forEach(x => x.setAttribute('aria-current', x === b)); load(); } }, true);
    }
    return true;
  }
  const t = setInterval(() => { if (window.LAB && mount()) clearInterval(t); }, 400);
  setTimeout(() => clearInterval(t), 20000);
  window.MXControls = { load };
})();
