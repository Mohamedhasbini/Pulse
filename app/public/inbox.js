// Inbox, Gmail style. Left: folders with counts. Middle: one line per conversation (who · first words · when),
// as many as fit the screen, with "1–14 of 120 ‹ ›". Right: the open chat, the customer, and Reply / Take over / Done.
// Data: /api/inbox (src/inbox.js) and the existing /api/conversations routes.
window.PulseInbox = (() => {
  const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const FOLDERS = [['needs', 'Needs you'], ['all', 'All chats'], ['bookings', 'Bookings'], ['questions', 'Questions'], ['changes', 'Changes'], ['complaints', 'Complaints'], ['test', 'Test chats']];
  const CH = { whatsapp: 'WhatsApp', telegram: 'Telegram', web: 'Web', test: 'Test', instagram: 'Instagram', messenger: 'Messenger' };
  const KIND = { booking: 'Booking', question: 'Question', change: 'Change', cancel: 'Cancel', complaint: 'Complaint', other: '' };
  let root = null, st = { folder: 'all', offset: 0, q: '', open: null, rows: [], counts: {}, total: 0, limit: 14 };

  // "14:05" today, "Mon" this week, "12 Oct" before
  function when(s) {
    if (!s) return ''; const d = new Date(s.replace('T', ' ')), now = new Date();
    if (d.toDateString() === now.toDateString()) return s.slice(11, 16);
    if (now - d < 6 * 864e5) return d.toLocaleDateString('en-GB', { weekday: 'short' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  // the receptionist's name as this business set it (Settings › Assistant), Nora by default
  const ai = () => (typeof biz !== 'undefined' && biz?.assistant_name) || 'Nora';
  const who = r => r.name || (r.phone && !/^test-|^e2e-/.test(r.phone) ? r.phone : 'Test customer');
  const initials = n => n.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();

  function frame() {
    root.innerHTML = `<div class="ib">
      <aside class="ib-folders">${FOLDERS.map(([k, l]) => `<button type="button" data-f="${k}"><span>${l}</span><b data-n="${k}"></b></button>`).join('')}</aside>
      <section class="ib-list"><div class="ib-bar"><input type="search" id="ibQ" placeholder="Search name, number or message" aria-label="Search chats"><span class="ib-range" id="ibRange"></span>
        <button type="button" class="ib-nav" data-p="-1" aria-label="Newer">‹</button><button type="button" class="ib-nav" data-p="1" aria-label="Older">›</button></div><div id="ibRows" class="ib-rows"></div></section>
      <section class="ib-read" id="ibRead"><div class="ib-empty">Pick a conversation to read it here.</div></section></div>`;
    root.addEventListener('click', click);
    root.querySelector('#ibQ').addEventListener('input', ev => { clearTimeout(st.t); st.t = setTimeout(() => { st.q = ev.target.value; st.offset = 0; load(); }, 250); });
  }
  // as many lines as the list has room for, so nothing scrolls
  function fit() { const box = root.querySelector('#ibRows'); const h = box?.clientHeight || 500; st.limit = Math.max(5, Math.floor(h / 52)); }

  async function load() {
    fit();
    let d; try { d = await req(`/api/inbox?folder=${st.folder}&offset=${st.offset}&limit=${st.limit}&q=${encodeURIComponent(st.q)}`); }
    catch (err) { root.querySelector('#ibRows').innerHTML = `<p class="ib-none">Couldn't load your chats. <button type="button" class="ib-retry">Retry</button></p>`; return; }
    Object.assign(st, { rows: d.rows, counts: d.counts, total: d.total });
    root.querySelectorAll('[data-f]').forEach(b => b.setAttribute('aria-current', String(b.dataset.f === st.folder)));
    root.querySelectorAll('[data-n]').forEach(b => { const n = d.counts[b.dataset.n] || 0; b.textContent = n || ''; });
    root.querySelector('#ibRange').textContent = d.total ? `${d.offset + 1}–${Math.min(d.offset + d.rows.length, d.total)} of ${d.total}` : '';
    root.querySelector('[data-p="-1"]').disabled = d.offset === 0; root.querySelector('[data-p="1"]').disabled = d.offset + d.rows.length >= d.total;
    root.querySelector('#ibRows').innerHTML = d.rows.length ? d.rows.map(r => `<button type="button" class="ib-row${r.unread ? ' unread' : ''}${r.id === st.open ? ' on' : ''}" data-c="${r.id}">
        <span class="ib-av">${e(initials(who(r)))}</span>
        <span class="ib-who">${e(who(r))}</span>
        <span class="ib-what">${r.needs_attention ? '<i class="chip need">Needs you</i>' : KIND[r.kind] ? `<i class="chip k-${r.kind}">${KIND[r.kind]}</i>` : ''}<span class="ib-snip">${r.last ? (r.last.role === 'customer' ? '' : r.last.role === 'staff' ? 'You: ' : ai() + ': ') + e(r.last.text) : ''}</span></span>
        <span class="ib-ch">${e(CH[r.channel] || r.channel)}</span><span class="ib-at">${e(when(r.at))}</span></button>`).join('')
      : `<p class="ib-none">${st.q ? 'No chats match your search.' : st.folder === 'needs' ? `Nothing needs you. ${ai()} is handling every chat.` : 'No chats here yet.'}</p>`;
  }

  async function open(id) {
    st.open = id; root.querySelectorAll('.ib-row').forEach(r => r.classList.toggle('on', +r.dataset.c === id));
    const row = st.rows.find(r => r.id === id) || {}, read = root.querySelector('#ibRead');
    read.innerHTML = '<div class="ib-empty">Loading…</div>';
    const [msgs, cu] = await Promise.all([req(`/api/conversations/${id}/messages`), req(`/api/inbox/${id}/customer`).catch(() => ({}))]);
    req(`/api/inbox/${id}/seen`, 'POST', {}).then(() => { const r = root.querySelector(`.ib-row[data-c="${id}"]`); r?.classList.remove('unread'); }).catch(() => {});
    read.innerHTML = `<header class="ib-head"><div><h2>${e(who(row))}</h2><small>${e(CH[row.channel] || row.channel || '')}${row.phone && !/^test-/.test(row.phone) ? ' · ' + e(row.phone) : ''}${row.attention_reason ? ' · ' + e(row.attention_reason) : ''}</small></div>
        <div class="ib-acts">${row.needs_attention ? '<button type="button" class="btn" data-a="done">Mark done</button>' : ''}
        <button type="button" class="btn ghost" data-a="ai">${row.ai_paused ? 'Let ' + ai() + ' answer' : 'Take over'}</button></div></header>
      <div class="ib-cust">${cu.id ? `<span><b>${cu.visits || 0}</b> visits</span><span><b>$${Math.round(cu.spent || 0)}</b> spent</span><span>${cu.next ? 'Next: <b>' + e(cu.next.replace('T', ' ')) + '</b>' : 'No upcoming visit'}</span>` : ''}</div>
      <div class="ib-msgs" id="ibMsgs">${msgs.map(m => `<div class="ib-m ${m.role}"><p>${e(m.text)}</p><small>${m.role === 'customer' ? '' : m.role === 'staff' ? 'You · ' : ai() + ' · '}${e(when(m.at))}</small></div>`).join('')}</div>
      <form class="ib-reply" id="ibReply"><input name="t" placeholder="${row.ai_paused ? 'Reply to ' + e(who(row)) : 'Reply (' + ai() + ' pauses while you handle it)'}" autocomplete="off" aria-label="Reply"><button class="btn" type="submit">Send</button></form>`;
    const m = read.querySelector('#ibMsgs'); m.scrollTop = m.scrollHeight;
    read.querySelector('#ibReply').addEventListener('submit', async ev => {
      ev.preventDefault(); const t = ev.target.t.value.trim(); if (!t) return;
      try { await req(`/api/conversations/${id}/reply`, 'POST', { text: t }); ev.target.t.value = ''; await load(); open(id); } catch (err) { window.toast?.(err.message || 'Not sent.'); }
    });
  }

  async function click(ev) {
    const t = ev.target;
    const f = t.closest('[data-f]'); if (f) { st.folder = f.dataset.f; st.offset = 0; st.open = null; root.querySelector('#ibRead').innerHTML = '<div class="ib-empty">Pick a conversation to read it here.</div>'; return load(); }
    const p = t.closest('[data-p]'); if (p) { st.offset = Math.max(0, st.offset + +p.dataset.p * st.limit); return load(); }
    const c = t.closest('[data-c]'); if (c) return open(+c.dataset.c);
    if (t.closest('.ib-retry')) return load();
    const a = t.closest('[data-a]'); if (!a || !st.open) return;
    const row = st.rows.find(r => r.id === st.open) || {};
    if (a.dataset.a === 'done') await req(`/api/conversations/${st.open}/resolve`, 'POST', {});
    if (a.dataset.a === 'ai') await req(`/api/conversations/${st.open}/ai`, 'POST', { paused: !row.ai_paused });
    await load(); open(st.open);
  }

  return {
    // folder: 'all' or 'needs'
    mount(section, folder) {
      root = section.querySelector('#ibRoot');
      if (!root.dataset.on) { root.dataset.on = 1; frame(); }
      if (folder && folder !== st.folder) { st.folder = folder; st.offset = 0; st.open = null; }
      requestAnimationFrame(load);
    },
    refresh: () => root && load(),
    openChat: id => root && open(+id),
  };
})();
