// Pulse AI command center: a full-screen chat over the whole dashboard, like Claude.
// Every number comes from the real data (the tools in team.js); you see each step live, the rows behind the answer
// as tables you can download (CSV) or turn into a printable report, and anything that changes something waits for
// your Approve. Opens with Ctrl/⌘+J, from the Pulse AI page, or window.PulseCommand.open("question").
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'pulseThreads.v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(threads.slice(0, 30))) } catch {} };
  let threads = load(), cur = null, busy = false, root = null;

  const SUGG = [
    ['Today', 'What needs me today?'],
    ['Forecast', 'Forecast my revenue for the next 4 weeks'],
    ['Advice', 'What is the one thing I should change to grow revenue this month?'],
    ['Revenue', 'How did this week go compared to last week?'],
    ['Fill gaps', "Who could fill tomorrow's free slots?"],
    ['Export', 'Export all bookings for the next 7 days'],
    ['Win back', "Which regulars haven't been back in 60 days?"],
    ['Support', 'What did customers complain about this month?'],
  ];
  // actions that run through the dashboard's own endpoints (same checks as doing it by hand)
  const ROUTE = {
    book: a => ['/api/bookings', 'POST', { name: a.name, phone: a.phone, service_id: a.service_id, start: a.start }, 'Booked.'],
    move_booking: a => [`/api/bookings/${+a.booking_id}`, 'PATCH', { start: a.start }, 'Moved.'],
    set_booking_status: a => [`/api/bookings/${+a.booking_id}`, 'PATCH', { status: a.status }, { cancelled: 'Cancelled.', completed: 'Marked as came.', no_show: 'Marked as no-show.', confirmed: 'Confirmed.' }[a.status] || 'Done.'],
    block_time: a => ['/api/time-off', 'POST', { start: a.start, end: a.end, reason: a.reason || '' }, 'Time blocked.'],
  };
  const LABEL = a => a.label || ({ send_message: `Message ${a.client || 'client'}`, teach_answer: 'Teach this answer', add_rule: 'Add rule', run_agent: 'Run agent', add_shortcut: `Add to Home: ${a.label || ''}`, book: 'Book', move_booking: 'Move booking', set_booking_status: `Set booking: ${a.status}`, block_time: 'Block time' }[a.type] || a.type);

  function md(t) {
    const lines = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
    let out = '', list = false;
    for (const l of lines) {
      const m = l.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)/);
      if (m) { if (!list) { out += '<ul>'; list = true } out += `<li>${m[1]}</li>`; continue; }
      if (list) { out += '</ul>'; list = false }
      out += l.trim() ? `<p>${l}</p>` : '';
    }
    return out + (list ? '</ul>' : '');
  }
  const head = s => String(s).replace(/_/g, ' ');
  const cell = v => v == null ? '' : typeof v === 'number' ? v.toLocaleString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  function tableHtml(t, k) {
    const cols = Object.keys(t.rows[0]).filter(c => !/^(client_id|customer_id|conversation_id)$/.test(c)), max = 8;
    return `<div class="pc-table" data-t="${k}"><div class="pc-th"><b>${esc(t.title)}</b><span>${t.rows.length} row${t.rows.length === 1 ? '' : 's'}</span>
      <button type="button" data-csv="${k}">CSV</button></div><div class="pc-scroll"><table><thead><tr>${cols.map(c => `<th>${esc(head(c))}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.slice(0, max).map(r => `<tr>${cols.map(c => `<td>${esc(cell(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${t.rows.length > max ? `<button type="button" class="pc-more" data-more="${k}">Show all ${t.rows.length}</button>` : ''}</div>`;
  }
  function csv(t) {
    const cols = Object.keys(t.rows[0]), q = v => { const s = cell(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s };
    const blob = new Blob(['﻿' + [cols.join(','), ...t.rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${t.title.replace(/[^\w]+/g, '-').replace(/-+$/, '')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function report(m) {
    const w = window.open('', '_blank'); if (!w) return window.toast?.('Allow pop-ups to open the report.');
    const q = cur.msgs[cur.msgs.indexOf(m) - 1]?.text || '';
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Pulse report</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#111}
      h1{font-size:20px;margin:0}small{color:#666}table{border-collapse:collapse;width:100%;margin:12px 0 24px;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left}th{background:#f5f5f5}h2{font-size:14px;margin-top:24px}</style>
      <h1>${esc(q)}</h1><small>Pulse AI · ${new Date().toLocaleString()} · from your live data</small>${md(m.text)}
      ${(m.tables || []).map(t => { const cols = Object.keys(t.rows[0]); return `<h2>${esc(t.title)}</h2><table><tr>${cols.map(c => `<th>${esc(head(c))}</th>`).join('')}</tr>${t.rows.map(r => `<tr>${cols.map(c => `<td>${esc(cell(r[c]))}</td>`).join('')}</tr>`).join('')}</table>` }).join('')}
      <script>onload=()=>print()<\/script>`);
    w.document.close();
  }

  function msgHtml(m, i) {
    if (m.role === 'owner') return `<div class="pc-m me"><div class="pc-b">${esc(m.text)}</div></div>`;
    if (m.pending) return `<div class="pc-m ai"><div class="pc-steps">${(m.steps || ['Thinking']).map((s, k, a) => `<span class="${k === a.length - 1 ? 'on' : 'ok'}">${esc(s)}…</span>`).join('')}</div></div>`;
    const acts = (m.actions || []).map((a, k) => a.type === 'open_page'
      ? `<button type="button" class="pc-go" data-go="${k}">${esc(a.label || 'Open')} →</button>`
      : `<div class="pc-act ${a.state || ''}"><div><small>${a.state === 'done' ? 'Done' : a.state === 'no' ? 'Dismissed' : 'Needs your approval'}</small><b>${esc(LABEL(a))}</b>${a.text || a.answer ? `<q>${esc(a.text || a.answer)}</q>` : ''}${a.result ? `<em>${esc(a.result)}</em>` : ''}</div>
          ${a.state ? '' : `<span><button type="button" class="pc-yes" data-yes="${k}">Approve</button><button type="button" class="pc-no" data-no="${k}">Dismiss</button></span>`}</div>`).join('');
    return `<div class="pc-m ai${m.error ? ' err' : ''}" data-i="${i}"><div class="pc-a">${md(m.text)}</div>
      ${m.learned?.length ? `<div class="pc-learned">Remembered: ${m.learned.map(esc).join(' · ')}</div>` : ''}${(m.tables || []).map(tableHtml).join('')}${acts ? `<div class="pc-acts">${acts}</div>` : ''}
      ${m.error ? '' : `<div class="pc-foot">${m.sources?.length ? `<span>From ${m.sources.map(s => esc(s.label)).join(', ')}</span>` : '<span>From your live data</span>'}
        <button type="button" data-copy>Copy</button>${m.tables?.length ? '<button type="button" data-report>Report (PDF)</button>' : ''}</div>`}</div>`;
  }

  function draw() {
    if (!root) return;
    $('.pc-list', root).innerHTML = threads.length ? threads.map(t => `<button type="button" data-th="${t.id}" class="${t === cur ? 'on' : ''}">${esc(t.title)}</button>`).join('') : '<p>No chats yet</p>';
    const log = $('.pc-log', root), empty = !cur || !cur.msgs.length;
    root.classList.toggle('pc-empty', empty);
    log.innerHTML = empty ? `<div class="pc-hello"><h2>What should we work on?</h2><p>Ask about bookings, customers, revenue or chats. I read your live data, show my working, and nothing changes until you approve it.</p>
      <div class="pc-sugg">${SUGG.map(([k, q]) => `<button type="button" data-q="${esc(q)}"><b>${esc(k)}</b>${esc(q)}</button>`).join('')}</div></div>` : cur.msgs.map(msgHtml).join('');
    log.scrollTop = log.scrollHeight;
  }

  async function ask(text) {
    if (busy || !text.trim()) return; busy = true;
    if (!cur) { cur = { id: Date.now(), title: text.slice(0, 48), msgs: [] }; threads.unshift(cur); }
    cur.msgs.push({ role: 'owner', text });
    const m = { role: 'ai', pending: true, steps: ['Thinking'] }; cur.msgs.push(m); draw();
    const convo = cur.msgs.filter(x => !x.pending && !x.error).slice(-10).map(x => ({ role: x.role === 'owner' ? 'owner' : 'employee', text: x.text }));
    try {
      const r = await fetch('/api/team/ask?stream=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: convo, employee: 'pulse', page: window.P10?.current?.() || 'pulse' }) });
      let done = null;
      if ((r.headers.get('content-type') || '').includes('text/event-stream')) {
        const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
        for (;;) {
          const { value, done: end } = await rd.read(); if (end) break;
          buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf('\n\n')) >= 0) {
            const ev = JSON.parse(buf.slice(0, i).replace(/^data: /, '')); buf = buf.slice(i + 2);
            if (ev.step) { m.steps.push(ev.step); draw(); } if (ev.done) done = ev.done;
          }
        }
      } else { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Pulse AI is not reachable right now.'); done = j; }
      if (!done) throw new Error('The answer was cut off. Ask again.');
      if (done.learned?.length) loadMemory();
      Object.assign(m, { pending: false, learned: done.learned || [], text: done.answer, actions: done.actions || [], tables: done.tables || [], sources: done.sources || [] });
    } catch (err) { Object.assign(m, { pending: false, error: true, text: err.message || 'Pulse AI is not reachable right now. Try again in a minute.' }); }
    busy = false; save(); draw();
  }

  async function act(m, k, yes) {
    const a = m.actions[k]; if (!a || a.state) return;
    if (!yes) { a.state = 'no'; save(); return draw(); }
    try {
      if (ROUTE[a.type]) {
        const [url, method, body, ok] = ROUTE[a.type](a);
        const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'That did not work.');
        a.result = ok; window.dispatchEvent(new CustomEvent('pulse:changed', { detail: a.type }));
      } else {
        const r = await req('/api/team/act', 'POST', a); a.result = r.done || 'Done.';
        if (r.link) window.open(r.link, '_blank', 'noopener'); if (r.shortcuts) window.P10?.reloadShortcuts?.();
        if (r.ok === false) { a.state = 'no'; save(); return draw(); }
      }
      a.state = 'done';
    } catch (err) { a.result = err.message; }
    save(); draw();
  }

  function build() {
    root = document.createElement('div'); root.className = 'pc'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Pulse AI');
    root.innerHTML = `<aside class="pc-side"><button type="button" class="pc-new">+ New chat</button><div class="pc-list"></div><details class="pc-mem"><summary>Memory</summary><div></div></details><small>Ctrl/⌘ J to open · Esc to close</small></aside>
      <main class="pc-main"><header><b>Pulse AI</b><span>Live data · actions need your approval</span><button type="button" class="pc-x" aria-label="Close">✕</button></header>
      <div class="pc-log" aria-live="polite"></div>
      <form class="pc-in"><textarea rows="1" placeholder="Ask anything, or tell me what to do…" aria-label="Message Pulse AI"></textarea><button type="submit" aria-label="Send">↑</button></form></main>`;
    document.body.appendChild(root);
    const ta = $('textarea', root);
    $('form', root).addEventListener('submit', ev => { ev.preventDefault(); const v = ta.value; ta.value = ''; ta.style.height = ''; ask(v); });
    ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('form', root).requestSubmit(); } });
    ta.addEventListener('input', () => { ta.style.height = ''; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
    root.addEventListener('click', ev => {
      const t = ev.target, m = cur?.msgs[+t.closest('[data-i]')?.dataset.i];
      if (t.closest('.pc-x')) return close();
      if (t.dataset.forget) return req(`/api/team/memory/${+t.dataset.forget}`, 'DELETE').then(loadMemory);
      if (t.closest('.pc-new')) { cur = null; draw(); return ta.focus(); }
      const th = t.closest('[data-th]'); if (th) { cur = threads.find(x => x.id === +th.dataset.th); return draw(); }
      const q = t.closest('[data-q]'); if (q) return ask(q.dataset.q);
      if (!m) return;
      if (t.dataset.csv) return csv(m.tables[+t.dataset.csv]);
      if (t.dataset.more) return showAll(m, +t.dataset.more);
      if (t.dataset.yes) return act(m, +t.dataset.yes, true);
      if (t.dataset.no) return act(m, +t.dataset.no, false);
      if (t.dataset.go) { const a = m.actions[+t.dataset.go]; close(); return window.P10?.go?.(a.page, +a.tab || 0); }
      if (t.hasAttribute('data-copy')) { navigator.clipboard?.writeText(m.text); t.textContent = 'Copied'; return; }
      if (t.hasAttribute('data-report')) return report(m);
    });
  }
  function showAll(m, k) {
    const box = $(`.pc-m[data-i="${cur.msgs.indexOf(m)}"] .pc-table[data-t="${k}"] tbody`, root), t = m.tables[k];
    const cols = Object.keys(t.rows[0]).filter(c => !/^(client_id|customer_id|conversation_id)$/.test(c));
    if (box) box.innerHTML = t.rows.map(r => `<tr>${cols.map(c => `<td>${esc(cell(r[c]))}</td>`).join('')}</tr>`).join('');
    $(`.pc-m[data-i="${cur.msgs.indexOf(m)}"] [data-more="${k}"]`, root)?.remove();
  }
  // what Pulse AI remembers about this owner: visible and deletable, nothing hidden
  async function loadMemory() {
    const box = root && $('.pc-mem div', root); if (!box) return;
    let list = []; try { list = await req('/api/team/memory') } catch {}
    $('.pc-mem summary', root).textContent = `Memory (${list.length})`;
    box.innerHTML = list.length ? list.map(f => `<p>${esc(f.fact)}<button type="button" data-forget="${f.id}" aria-label="Forget">✕</button></p>`).join('') : '<p>Tell me your goals and preferences and I’ll remember them.</p>';
  }
  function open(q) { if (!root) build(); root.hidden = false; document.body.classList.add('pc-on'); draw(); loadMemory(); $('textarea', root).focus(); if (q) ask(q); }
  function close() { if (root) root.hidden = true; document.body.classList.remove('pc-on'); }
  document.addEventListener('keydown', ev => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'j') { ev.preventDefault(); root && !root.hidden ? close() : open(); }
    else if (ev.key === 'Escape' && root && !root.hidden) close();
  });
  // a launcher at the top of the sidebar, so the chat is one click from every page
  const launch = setInterval(() => {
    const nav = document.querySelector('nav .navpills'); if (!nav || window.LAB) return;
    clearInterval(launch);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pc-launch';
    b.innerHTML = '<span>Ask Pulse AI</span><kbd>Ctrl J</kbd>'; b.addEventListener('click', () => open());
    nav.prepend(b);
  }, 400);
  setTimeout(() => clearInterval(launch), 20000);
  window.PulseCommand = { open, close, ask: q => open(q) };
})();
