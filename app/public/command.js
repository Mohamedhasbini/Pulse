// Pulse AI command center: a full-screen chat over the whole dashboard.
// Every number comes from the real data (the tools in team.js). You see its reasoning and each lookup live, the rows
// behind the answer as tables and charts you can download (CSV) or print (PDF), and anything that changes something
// waits for your Approve. Opens with Ctrl/⌘+J, from the sidebar, or window.PulseCommand.open("question").
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'pulseThreads.v1', CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(threads.slice(0, 40))) } catch {} };
  let threads = load(), cur = null, busy = false, root = null, filter = '';

  const SUGG = [
    ['What needs me today?', 'Today'],
    ['Forecast my revenue for the next 4 weeks', 'Forecast'],
    ['What is the one thing I should change to grow revenue this month?', 'Strategy'],
    ["Who could fill tomorrow's free slots?", 'Fill gaps'],
    ['Export all bookings for the next 7 days', 'Export'],
    ["Which regulars haven't been back in 60 days?", 'Win back'],
  ];
  const READ = { today: 'today', bookings: 'bookings', free_slots: 'free times', find_customer: 'customers', customer: 'the customer profile', services: 'services', support: 'support results',
    conversations: 'conversations', conversation: 'the conversation', unanswered: 'unanswered questions', reviews: 'reviews', rules: 'receptionist rules', opportunities: 'growth opportunities',
    top_customers: 'top customers', quiet_days: 'calendar capacity', overview: 'period totals', revenue: 'weekly revenue', by_service: 'revenue by service', by_channel: 'channels',
    busy_times: 'busy times', query: 'a custom query', business_info: 'business settings', forecast: 'the forecast model' };
  const stepText = s => { const m = String(s).match(/^Reading (.+)$/); return m ? `Read ${READ[m[1].replace(/ /g, '_')] || m[1]}` : s; };
  // actions that run through the dashboard's own endpoints (same checks as doing it by hand)
  const ROUTE = {
    book: a => ['/api/bookings', 'POST', { name: a.name, phone: a.phone, service_id: a.service_id, start: a.start }, 'Booked.'],
    move_booking: a => [`/api/bookings/${+a.booking_id}`, 'PATCH', { start: a.start }, 'Moved.'],
    set_booking_status: a => [`/api/bookings/${+a.booking_id}`, 'PATCH', { status: a.status }, { cancelled: 'Cancelled.', completed: 'Marked as came.', no_show: 'Marked as no-show.', confirmed: 'Confirmed.' }[a.status] || 'Done.'],
    block_time: a => ['/api/time-off', 'POST', { start: a.start, end: a.end, reason: a.reason || '' }, 'Time blocked.'],
  };
  const LABEL = a => a.label || ({ send_message: `Message ${a.client || 'client'}`, teach_answer: 'Teach this answer', add_rule: 'Add a rule', run_agent: 'Run agent', add_shortcut: 'Add a shortcut', book: 'Book', move_booking: 'Move booking', set_booking_status: `Set booking: ${a.status}`, block_time: 'Block time' }[a.type] || a.type);
  const KIND = a => ({ send_message: 'Message', teach_answer: 'Teach', add_rule: 'Rule', run_agent: 'Agent', add_shortcut: 'Shortcut', book: 'Booking', move_booking: 'Booking', set_booking_status: 'Booking', block_time: 'Calendar' }[a.type] || 'Action');

  // ---------- Markdown: headings, lists, tables, bold/italic/code, rules ----------
  function inline(t) { return esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>'); }
  function md(src) {
    const L = String(src || '').replace(/\r/g, '').split('\n'); let out = '', i = 0;
    while (i < L.length) {
      const l = L[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = l.match(/^(#{1,4})\s+(.*)/))) { out += `<h${Math.min(m[1].length + 2, 5)}>${inline(m[2])}</h${Math.min(m[1].length + 2, 5)}>`; i++; continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(l)) { out += '<hr>'; i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(L[i + 1] || '')) {
        const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const h = row(l); i += 2; const body = [];
        while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) body.push(row(L[i++]));
        out += `<div class="pc-mdt"><table><thead><tr>${h.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; continue;
      }
      if (/^\s*([-•*]|\d+[.)])\s+/.test(l)) {
        const ordered = /^\s*\d+[.)]/.test(l); let items = '';
        while (i < L.length && (/^\s*([-•*]|\d+[.)])\s+/.test(L[i]) || (/^\s{2,}\S/.test(L[i]) && items))) {
          const it = L[i].match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)/);
          if (it) items += `<li>${inline(it[1])}</li>`; else items = items.replace(/<\/li>$/, ` ${inline(L[i].trim())}</li>`);
          i++;
        }
        out += ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`; continue;
      }
      let para = l.trim(); i++;
      while (i < L.length && L[i].trim() && !/^(#{1,4}\s|\s*\||\s*([-•*]|\d+[.)])\s)/.test(L[i])) para += ' ' + L[i++].trim();
      out += `<p>${inline(para)}</p>`;
    }
    return out;
  }

  // ---------- data: tables, charts, files ----------
  const head = s => String(s).replace(/_/g, ' ');
  const cell = v => v == null ? '—' : typeof v === 'number' ? v.toLocaleString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const hidden = c => /^(client_id|customer_id|conversation_id|service_id)$/.test(c);
  const isNum = (rows, c) => rows.every(r => r[c] == null || typeof r[c] === 'number');
  function chart(t) {
    const cols = Object.keys(t.rows[0]), x = cols.find(c => /week|day|date|month|^at$/.test(c));
    const y = ['forecast_revenue', 'revenue', 'bookings', 'booked_hours'].find(c => cols.includes(c) && isNum(t.rows, c));
    if (!x || !y || t.rows.length < 3 || t.rows.length > 24) return '';
    const vals = t.rows.map(r => +r[y] || 0), max = Math.max(...vals, 1), W = 100 / vals.length;
    return `<figure class="pc-chart" aria-label="${esc(head(y))} by ${esc(head(x))}"><figcaption>${esc(head(y))}</figcaption><div class="pc-bars">${t.rows.map((r, k) =>
      `<div class="pc-bar" style="width:${W}%" title="${esc(cell(r[x]))}: ${esc(cell(r[y]))}"><i style="height:${Math.max(2, vals[k] / max * 100)}%"></i><span>${esc(String(cell(r[x])).replace(/^\d{4}-/, ''))}</span></div>`).join('')}</div></figure>`;
  }
  function tableHtml(t, k, all) {
    const cols = Object.keys(t.rows[0]).filter(c => !hidden(c)), rows = all ? t.rows : t.rows.slice(0, 6);
    return `<div class="pc-data" data-t="${k}"><div class="pc-dh"><span class="pc-dico">▦</span><div><b>${esc(head(t.title))}</b><small>${t.rows.length} row${t.rows.length === 1 ? '' : 's'} · live data</small></div>
      <button type="button" data-csv="${k}">Download CSV</button></div>${chart(t)}<div class="pc-scroll"><table><thead><tr>${cols.map(c => `<th class="${isNum(t.rows, c) ? 'n' : ''}">${esc(head(c))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map(c => `<td class="${typeof r[c] === 'number' ? 'n' : ''}">${esc(cell(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${!all && t.rows.length > 6 ? `<button type="button" class="pc-more" data-more="${k}">Show all ${t.rows.length} rows</button>` : ''}</div>`;
  }
  function csv(t) {
    const cols = Object.keys(t.rows[0]), q = v => { const s = v == null ? '' : cell(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s };
    const blob = new Blob(['﻿' + [cols.join(','), ...t.rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${t.title.replace(/[^\w]+/g, '-').replace(/-+$/, '')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function report(m) {
    const w = window.open('', '_blank'); if (!w) return window.toast?.('Allow pop-ups to open the report.');
    const q = cur.msgs[cur.msgs.indexOf(m) - 1]?.text || '';
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Pulse report</title><style>body{font:15px/1.6 Georgia,serif;max-width:760px;margin:48px auto;padding:0 24px;color:#1a1a1a}
      h1{font:600 24px/1.3 system-ui,sans-serif;margin:0 0 4px}.meta{font:12px system-ui,sans-serif;color:#777;margin-bottom:28px}h3,h4,h5{font-family:system-ui,sans-serif}
      table{border-collapse:collapse;width:100%;margin:12px 0 28px;font:12px system-ui,sans-serif}th,td{border-bottom:1px solid #e5e5e5;padding:6px 8px;text-align:left}th{color:#666;font-weight:600}h2{font:600 15px system-ui,sans-serif;margin-top:32px;text-transform:capitalize}</style>
      <h1>${esc(q)}</h1><div class="meta">Pulse AI · ${new Date().toLocaleString()} · from your live data</div>${md(m.text)}
      ${(m.tables || []).map(t => { const cols = Object.keys(t.rows[0]).filter(c => !hidden(c)); return `<h2>${esc(head(t.title))}</h2><table><tr>${cols.map(c => `<th>${esc(head(c))}</th>`).join('')}</tr>${t.rows.map(r => `<tr>${cols.map(c => `<td>${esc(cell(r[c]))}</td>`).join('')}</tr>`).join('')}</table>` }).join('')}
      <script>onload=()=>print()<\/script>`);
    w.document.close();
  }

  // ---------- messages ----------
  function trail(m) {
    const items = m.trail || [], live = m.pending;
    if (!items.length && !live) return '';
    const n = items.filter(x => x.k === 'step').length;
    const list = items.map((x, k) => `<li class="${x.k}${live && k === items.length - 1 ? ' now' : ''}">${esc(x.k === 'step' ? stepText(x.t) : x.t)}</li>`).join('');
    return `<details class="pc-trail"${live ? ' open' : ''}><summary>${live ? `<span class="pc-spin"></span>${esc(items.length ? (items[items.length - 1].k === 'step' ? stepText(items[items.length - 1].t) : 'Thinking') : 'Thinking')}…` : `Worked through ${n || 1} step${n === 1 ? '' : 's'}`}</summary>${list ? `<ol>${list}</ol>` : ''}</details>`;
  }
  function msgHtml(m, i) {
    if (m.role === 'owner') return `<div class="pc-m me"><div class="pc-b">${esc(m.text)}</div></div>`;
    const shown = m.reveal != null ? m.text.slice(0, m.reveal) : m.text;
    const acts = m.pending || m.reveal != null ? '' : (m.actions || []).map((a, k) => a.type === 'open_page'
      ? `<button type="button" class="pc-go" data-go="${k}"><span>↗</span>${esc(a.label || 'Open page')}</button>`
      : `<div class="pc-act ${a.state || ''}"><div class="pc-ak">${esc(KIND(a))}</div><div class="pc-ab"><b>${esc(LABEL(a))}</b>${a.text || a.answer ? `<q>${esc(a.text || a.answer)}</q>` : ''}${a.result ? `<em>${esc(a.result)}</em>` : ''}</div>
          ${a.state ? `<span class="pc-ast">${a.state === 'done' ? '✓ Done' : 'Dismissed'}</span>` : `<span class="pc-abtn"><button type="button" class="pc-no" data-no="${k}">Dismiss</button><button type="button" class="pc-yes" data-yes="${k}">Approve</button></span>`}</div>`).join('');
    const done = !m.pending && m.reveal == null;
    return `<div class="pc-m ai${m.error ? ' err' : ''}" data-i="${i}"><div class="pc-mark" aria-hidden="true"></div><div class="pc-body">${trail(m)}
      ${m.pending ? '' : `<div class="pc-a">${md(shown)}${m.reveal != null ? '<span class="pc-caret"></span>' : ''}</div>`}
      ${done && m.learned?.length ? `<div class="pc-learned"><span>◆</span> Saved to memory: ${m.learned.map(esc).join(' · ')}</div>` : ''}
      ${done ? (m.tables || []).map((t, k) => tableHtml(t, k, m.all?.[k])).join('') : ''}${acts ? `<div class="pc-acts">${acts}</div>` : ''}
      ${done && !m.error ? `<div class="pc-tools"><button type="button" data-copy title="Copy">Copy</button><button type="button" data-retry title="Ask again">Retry</button>${m.tables?.length ? '<button type="button" data-report>Report (PDF)</button>' : ''}<span>${m.sources?.length ? `Sources: ${m.sources.map(s => esc(s.label)).join(', ')}` : 'From your live data'}</span></div>` : ''}
      ${m.error ? '<div class="pc-tools"><button type="button" data-retry>Try again</button></div>' : ''}</div></div>`;
  }

  const group = t => { const d = (Date.now() - t.id) / 864e5; return d < 1 ? 'Today' : d < 7 ? 'Previous 7 days' : 'Older'; };
  function drawSide() {
    const list = threads.filter(t => !filter || t.title.toLowerCase().includes(filter));
    let html = '', last = '';
    for (const t of list) { const g = group(t); if (g !== last) { html += `<h6>${g}</h6>`; last = g; } html += `<div class="pc-th${t === cur ? ' on' : ''}"><button type="button" data-th="${t.id}">${esc(t.title)}</button><button type="button" class="pc-del" data-del="${t.id}" aria-label="Delete chat">✕</button></div>`; }
    $('.pc-list', root).innerHTML = html || `<p class="pc-none">${filter ? 'No matching chats' : 'Your chats will appear here'}</p>`;
  }
  function greet() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
  function draw(keepScroll) {
    if (!root) return;
    drawSide();
    const log = $('.pc-log', root), empty = !cur || !cur.msgs.length, stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    root.classList.toggle('pc-empty', empty);
    $('.pc-title', root).textContent = empty ? '' : cur.title;
    log.innerHTML = empty ? `<div class="pc-hello"><div class="pc-logo" aria-hidden="true"></div><h1>${greet()}${window.me?.user?.name ? `, ${esc(String(window.me.user.name).split(' ')[0])}` : ''}</h1>
      <p>I'm your business partner. I read your live numbers, explain what they mean, and act for you when you approve.</p></div>`
      : `<div class="pc-col">${cur.msgs.map(msgHtml).join('')}</div>`;
    $('.pc-sugg', root).hidden = !empty;
    if (!keepScroll || stick) log.scrollTop = log.scrollHeight;
  }
  function reveal(m) {
    if (CALM || m.error) return draw();
    m.reveal = 0;
    const tick = () => { m.reveal = Math.min(m.text.length, m.reveal + Math.max(6, Math.round(m.text.length / 70))); if (m.reveal >= m.text.length) { delete m.reveal; return draw(true); } draw(true); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  async function ask(text) {
    if (busy || !text.trim()) return; busy = true; $('.pc-send', root).disabled = true;
    if (!cur) { cur = { id: Date.now(), title: text.slice(0, 60), msgs: [] }; threads.unshift(cur); }
    cur.msgs.push({ role: 'owner', text });
    const m = { role: 'ai', pending: true, trail: [] }; cur.msgs.push(m); draw();
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
            if (ev.thought) { m.trail.push({ k: 'thought', t: ev.thought }); draw(true); }
            if (ev.step) { m.trail.push({ k: 'step', t: ev.step }); draw(true); }
            if (ev.done) done = ev.done;
          }
        }
      } else { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Pulse AI is not reachable right now.'); done = j; }
      if (!done) throw new Error('The answer was cut off. Try again.');
      if (done.learned?.length) loadMemory();
      Object.assign(m, { pending: false, learned: done.learned || [], text: done.answer, actions: done.actions || [], tables: done.tables || [], sources: done.sources || [] });
      reveal(m);
    } catch (err) { Object.assign(m, { pending: false, error: true, text: err.message || 'Pulse AI is not reachable right now. Try again in a minute.' }); draw(); }
    busy = false; $('.pc-send', root).disabled = false; save();
  }

  async function act(m, k, yes) {
    const a = m.actions[k]; if (!a || a.state) return;
    if (!yes) { a.state = 'no'; save(); return draw(true); }
    try {
      if (ROUTE[a.type]) {
        const [url, method, body, ok] = ROUTE[a.type](a);
        const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'That did not work.');
        a.result = ok; window.dispatchEvent(new CustomEvent('pulse:changed', { detail: a.type }));
      } else {
        const r = await req('/api/team/act', 'POST', a); a.result = r.done || 'Done.';
        if (r.link) window.open(r.link, '_blank', 'noopener'); if (r.shortcuts) window.P10?.reloadShortcuts?.();
        if (r.ok === false) { a.state = 'no'; save(); return draw(true); }
      }
      a.state = 'done';
    } catch (err) { a.result = err.message; }
    save(); draw(true);
  }

  function build() {
    root = document.createElement('div'); root.className = 'pc'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Pulse AI');
    root.innerHTML = `<aside class="pc-side"><div class="pc-brand"><span class="pc-logo sm" aria-hidden="true"></span>Pulse AI</div>
        <button type="button" class="pc-new"><span>＋</span>New chat</button>
        <input class="pc-search" type="search" placeholder="Search chats" aria-label="Search chats">
        <div class="pc-list"></div>
        <details class="pc-mem"><summary>Memory</summary><div></div></details></aside>
      <main class="pc-main"><header><button type="button" class="pc-menu" aria-label="Chats">☰</button><span class="pc-title"></span><kbd>Esc</kbd><button type="button" class="pc-x" aria-label="Close">✕</button></header>
        <div class="pc-log" aria-live="polite"></div>
        <div class="pc-dock"><form class="pc-in"><textarea rows="1" placeholder="Ask anything, or tell me what to do…" aria-label="Message Pulse AI"></textarea>
          <div class="pc-inbar"><span class="pc-chip"><i></i>Live data</span><span class="pc-chip">Approves before acting</span><button type="submit" class="pc-send" aria-label="Send">↑</button></div></form>
          <div class="pc-sugg">${SUGG.map(([q, k]) => `<button type="button" data-q="${esc(q)}"><b>${esc(k)}</b>${esc(q)}</button>`).join('')}</div>
          <small class="pc-note">Pulse AI works from your live data. Check important figures before acting on them.</small></div></main>`;
    document.body.appendChild(root);
    const ta = $('textarea', root);
    $('form', root).addEventListener('submit', ev => { ev.preventDefault(); const v = ta.value; ta.value = ''; ta.style.height = ''; ask(v); });
    ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('form', root).requestSubmit(); } });
    ta.addEventListener('input', () => { ta.style.height = ''; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; });
    $('.pc-search', root).addEventListener('input', ev => { filter = ev.target.value.trim().toLowerCase(); drawSide(); });
    root.addEventListener('click', ev => {
      const t = ev.target.closest('button,[data-q]') || ev.target, mi = t.closest('[data-i]'), m = mi && cur?.msgs[+mi.dataset.i];
      if (t.closest('.pc-x')) return close();
      if (t.closest('.pc-menu')) return root.classList.toggle('pc-sideopen');
      if (t.closest('.pc-new')) { cur = null; root.classList.remove('pc-sideopen'); draw(); return ta.focus(); }
      if (t.dataset.del) { threads = threads.filter(x => x.id !== +t.dataset.del); if (cur && cur.id === +t.dataset.del) cur = null; save(); return draw(); }
      if (t.dataset.th) { cur = threads.find(x => x.id === +t.dataset.th); root.classList.remove('pc-sideopen'); return draw(); }
      if (t.dataset.q) return ask(t.dataset.q);
      if (t.dataset.forget) return req(`/api/team/memory/${+t.dataset.forget}`, 'DELETE').then(loadMemory);
      if (!m) return;
      if (t.dataset.csv) return csv(m.tables[+t.dataset.csv]);
      if (t.dataset.more) { (m.all ||= {})[+t.dataset.more] = true; return draw(true); }
      if (t.dataset.yes) return act(m, +t.dataset.yes, true);
      if (t.dataset.no) return act(m, +t.dataset.no, false);
      if (t.dataset.go) { const a = m.actions[+t.dataset.go]; close(); return window.P10?.go?.(a.page, +a.tab || 0); }
      if (t.hasAttribute('data-copy')) { navigator.clipboard?.writeText(m.text); t.textContent = 'Copied'; return setTimeout(() => t.textContent = 'Copy', 1500); }
      if (t.hasAttribute('data-retry')) { const k = cur.msgs.indexOf(m), q = cur.msgs[k - 1]?.text; cur.msgs.splice(k - 1, 2); return ask(q); }
      if (t.hasAttribute('data-report')) return report(m);
    });
  }
  // what Pulse AI remembers about this owner: visible and deletable, nothing hidden
  async function loadMemory() {
    const box = root && $('.pc-mem div', root); if (!box) return;
    let list = []; try { list = await req('/api/team/memory') } catch {}
    $('.pc-mem summary', root).textContent = `Memory · ${list.length}`;
    box.innerHTML = list.length ? list.map(f => `<p>${esc(f.fact)}<button type="button" data-forget="${f.id}" aria-label="Forget this">✕</button></p>`).join('') : '<p class="pc-none">Tell me your goals and preferences and I’ll remember them.</p>';
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
    b.innerHTML = '<span class="pc-logo sm" aria-hidden="true"></span><span>Ask Pulse AI</span><kbd>Ctrl J</kbd>'; b.addEventListener('click', () => open());
    nav.prepend(b);
  }, 400);
  setTimeout(() => clearInterval(launch), 20000);
  window.PulseCommand = { open, close, ask: q => open(q) };
  // the old side-panel team chat is retired: every "talk to the team" link opens this chat instead
  window.openTeam = (_id, text) => open(text || undefined);
})();
