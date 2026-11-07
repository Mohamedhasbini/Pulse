// MXAi assistant settings panel (Layer 02): which assistant roles answer customers, the owner's guidelines for each,
// competitors never to mention and phrases never to say. Self-contained: the integrator places
// <div id="mxaiSettings"></div> in Settings (or calls MXAiSettings.mount(el)). Reads and saves /api/ai-config
// with the dashboard's req(); uses the existing .card / .form / .switch / .btn styles, no new CSS.
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const call = (p, m, b) => (typeof req === 'function' ? req(p, m, b) : fetch(p, { method: m || 'GET', headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong.'), { status: r.status }); return j; }));
  const lines = v => v.split('\n').map(s => s.trim()).filter(Boolean);
  const HINT = {
    receptionist: 'For example: "Ask new clients if they have allergies." or "Only book colour appointments before 4pm."',
    support: 'For example: "Returns are accepted within 14 days with the receipt." or "Always ask for the order number first."',
    sales: 'For example: "Suggest the hair mask with every colour." Only offers you add here or in your price list are mentioned.',
  };
  let seq = 0;

  async function mount(root) {
    if (!root || root.dataset.mxaiMounted) return;
    root.dataset.mxaiMounted = '1';
    const id = 'mxs' + (++seq);
    root.innerHTML = `<div class="card glass"><p class="sub" role="status">Loading assistant settings…</p></div>`;
    let d;
    try { d = await call('/api/ai-config'); }
    catch (e) {
      root.innerHTML = `<div class="card glass"><p class="sub">${e.status === 403 ? 'Only the account owner can change how the assistant works.' : 'Couldn’t load the assistant settings.'}</p></div>`;
      delete root.dataset.mxaiMounted; return;
    }
    const name = esc(window.P10?.named?.(d.assistant_name || 'Nora') || d.assistant_name || 'Nora');
    const c = d.config, L = d.limits;
    root.innerHTML = `<div class="card glass">
      <h2 style="margin:0 0 4px">What ${name} does for your customers</h2>
      <p class="sub" style="margin:0 0 14px">Switch on the jobs you want ${name} to do. ${name} only uses your own prices, hours and policies, and passes anything it doesn’t know to you.</p>
      <div class="form">
        ${['receptionist', 'support', 'sales'].map(r => `
        <fieldset class="full" style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0">
          <legend style="padding:0 6px;font-weight:600">${esc(d.roles[r].title)}</legend>
          <label class="switch"><input type="checkbox" id="${id}-${r}-on" ${c.roles[r].on ? 'checked' : ''} aria-describedby="${id}-${r}-does"> On</label>
          <p class="sub" id="${id}-${r}-does" style="margin:6px 0 10px;font-size:13px">${esc(d.roles[r].does)}</p>
          <label>Your instructions for this job (optional)
            <textarea id="${id}-${r}-g" rows="3" maxlength="${L.guidelines}" aria-describedby="${id}-${r}-hint ${id}-${r}-n">${esc(c.roles[r].guidelines)}</textarea></label>
          <p class="sub" id="${id}-${r}-hint" style="margin:4px 0 0;font-size:12px">${esc(HINT[r])} <span id="${id}-${r}-n" aria-live="polite"></span></p>
        </fieldset>`).join('')}
        <label class="full">Competitors ${name} must never mention (one per line, up to ${L.competitors})
          <textarea id="${id}-comp" rows="3" aria-describedby="${id}-comp-h">${esc(c.competitors.join('\n'))}</textarea></label>
        <p class="full sub" id="${id}-comp-h" style="margin:-6px 0 0;font-size:12px">${name} never names or recommends any other business anyway; add names here to be extra sure.</p>
        <label class="full">Words or phrases ${name} must never use (one per line, up to ${L.never_say})
          <textarea id="${id}-never" rows="3">${esc(c.never_say.join('\n'))}</textarea></label>
        <p class="full sub" id="${id}-err" role="alert" style="margin:0;color:var(--bad)"></p>
        <div class="full" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn" id="${id}-save">Save assistant settings</button>
          <span class="sub" id="${id}-ok" role="status" aria-live="polite"></span>
        </div>
      </div></div>`;
    const $ = s => root.querySelector('#' + id + '-' + s);
    const count = r => { const n = $(r + '-g').value.length; $(r + '-n').textContent = n > L.guidelines * 0.8 ? `${n} of ${L.guidelines} characters.` : ''; };
    for (const r of ['receptionist', 'support', 'sales']) { $(r + '-g').addEventListener('input', () => count(r)); count(r); }
    $('save').addEventListener('click', async () => {
      const err = $('err'), ok = $('ok'), btn = $('save');
      err.textContent = ''; ok.textContent = '';
      const body = { roles: {}, competitors: lines($('comp').value), never_say: lines($('never').value) };
      for (const r of ['receptionist', 'support', 'sales']) body.roles[r] = { on: $(r + '-on').checked, guidelines: $(r + '-g').value };
      if (!Object.values(body.roles).some(x => x.on)) { err.textContent = `Keep at least one job switched on, or ${name} can’t answer your customers.`; $('receptionist-on').focus(); return; }
      if (body.competitors.length > L.competitors) { err.textContent = `Please list at most ${L.competitors} competitors.`; $('comp').focus(); return; }
      if (body.never_say.length > L.never_say) { err.textContent = `Please list at most ${L.never_say} phrases.`; $('never').focus(); return; }
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      try { await call('/api/ai-config', 'PUT', body); ok.textContent = `Saved. ${name} follows these settings from the next message.`; window.toast?.('Assistant settings saved'); }
      catch (e) { err.textContent = e.message || 'Couldn’t save. Please try again.'; }
      finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
    });
  }

  window.MXAiSettings = { mount };
  const auto = () => document.querySelectorAll('#mxaiSettings,[data-mxai-settings]').forEach(mount);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', auto) : auto();
})();
