// Today's briefing: the day's to-do ranked by money, from /api/briefing. Each line has a Fix button that does the
// work in place (mark visits, teach answers) or opens the prepared messages / the right page. Refreshes every minute.
(() => {
  const $ = s => document.querySelector(s);
  const money = v => `${(window.biz?.currency || 'USD') === 'USD' ? '$' : (window.biz?.currency || '') + ' '}${Math.round(v).toLocaleString()}`;
  const OPEN = { inbox: ['inbox', 1], requests: ['calendar', 1] };
  let box = null;

  function mount() {
    const hero = $('.today .td-hero') || $('#tdKpis'); if (!hero || $('#bfCard')) return !!$('#bfCard');
    hero.insertAdjacentHTML('afterend', `<div class="td-card bf" id="bfCard" aria-live="polite"><div class="bf-h"><div><h2>Today's briefing</h2><p id="bfSay">Reading your business…</p></div>
      <div class="bf-money" id="bfMoney"></div></div><ol class="bf-list" id="bfList"></ol></div>`);
    box = $('#bfCard'); return true;
  }
  async function load() {
    if (!mount() || document.hidden || box.querySelector('.bf-fix:not([hidden])')) return;
    let d; try { d = await req('/api/briefing'); } catch { return; }
    const n = d.items.length;
    $('#bfSay').textContent = n ? `${n} thing${n > 1 ? 's' : ''} to do today, most valuable first.` : 'Nothing needs you today. Your receptionist and agents have it covered.';
    $('#bfMoney').innerHTML = (d.at_risk ? `<span class="bad"><b>${money(d.at_risk)}</b> at risk</span>` : '') + (d.to_win ? `<span class="good"><b>${money(d.to_win)}</b> to win</span>` : '');
    $('#bfList').innerHTML = d.items.map((x, i) => `<li data-fix="${x.fix}"><span class="bf-n">${i + 1}</span><div class="bf-t"><b>${esc(x.text)}</b><small>${esc(x.why)}${x.value ? ` · <em class="${x.money === 'at risk' ? 'bad' : 'good'}">${money(x.value)} ${x.money}</em>` : ''}</small>
      <div class="bf-fix" hidden></div></div><button type="button" class="bf-go">${/^(mark|teach)$/.test(x.fix) ? 'Fix' : /^agent:/.test(x.fix) ? 'Review' : 'Open'}</button></li>`).join('')
      || '<li class="bf-done">All clear ✓</li>';
  }
  document.addEventListener('click', async ev => {
    const t = ev.target, li = t.closest('#bfList > li'); if (!li) return;
    const f = li.dataset.fix, fix = li.querySelector('.bf-fix'), D = window.DeskFix;
    if (t.closest('.bf-go')) {
      if (f.startsWith('open:')) { const o = OPEN[f.slice(5)]; return window.P10?.go(o[0], o[1]); }
      if (f.startsWith('agent:')) return D?.agent(f.slice(6));
      if (!fix.hidden) { fix.hidden = true; return; }
      fix.hidden = false; fix.innerHTML = '<p class="desk-fh">Loading…</p>';
      try { await (f === 'mark' ? D.mark(fix) : D.teach(fix)); } catch (err) { fix.innerHTML = `<p class="desk-fh">${esc(err.message)}</p>`; }
      return;
    }
    const mk = t.closest('[data-mark]');
    if (mk) { const row = mk.closest('[data-b]'); row.querySelectorAll('button').forEach(b => b.disabled = true);
      try { await req(`/api/bookings/${row.dataset.b}`, 'PATCH', { status: mk.dataset.mark }); row.innerHTML = `<span><b>${mk.dataset.mark === 'completed' ? 'Marked as came' : 'Marked as no-show'}</b></span>`;
        if (!fix.querySelector('[data-mark]')) setTimeout(() => { fix.hidden = true; load(); }, 900); } catch (err) { toast(err.message); row.querySelectorAll('button').forEach(b => b.disabled = false); }
      return; }
    const tc = t.closest('[data-teach]');
    if (tc) { const q = tc.closest('[data-l]'), ans = q.querySelector('textarea').value.trim(); if (!ans) return toast('Write the answer first.');
      tc.disabled = true;
      try { const r = await req('/api/team/act', 'POST', { type: 'teach_answer', learning_id: +q.dataset.l, answer: ans }); q.innerHTML = `<b>${esc(r.done || 'Saved.')}</b>`;
        if (!fix.querySelector('[data-teach]')) setTimeout(() => { fix.hidden = true; load(); }, 1200); } catch (err) { toast(err.message); tc.disabled = false; } }
  });
  const tick = setInterval(() => { if (mount()) { clearInterval(tick); load(); } }, 500);
  setTimeout(() => clearInterval(tick), 15000);
  setInterval(load, 60000);
  window.addEventListener('pulse:changed', load);
})();
