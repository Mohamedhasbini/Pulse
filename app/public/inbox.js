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
  const ai = () => e((typeof biz !== 'undefined' && biz?.assistant_name) || 'Nora'); // escaped: it lands in innerHTML and an attribute
  const who = r => r.name || (r.phone && !/^test-|^e2e-/.test(r.phone) ? r.phone : 'Test customer');
  const initials = n => n.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
  // each person keeps one soft colour, so a name is recognised at a glance down the list
  const hue = n => [...String(n)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const FI = { needs: '<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>', all: '<path d="M4 6h16M4 12h16M4 18h10"/>', bookings: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    questions: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/>', changes: '<path d="M4 7h12l-3-3M20 17H8l3 3"/>',
    complaints: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M12 8v4M12 15h.01"/>', test: '<path d="M9 3h6M10 3v6L5 19a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-10V3"/>' };
  const CHC = { whatsapp: '#25d366', telegram: '#2aabee', instagram: '#e1306c', messenger: '#0084ff', web: '#8b8b8b', test: '#a1a1a1' };

  function frame() {
    root.innerHTML = `<div class="ib-ins" id="ibIns"></div><div class="ib">
      <aside class="ib-folders">${FOLDERS.map(([k, l]) => `<button type="button" data-f="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${FI[k] || ''}</svg><span>${l}</span><b data-n="${k}"></b></button>`).join('')}</aside>
      <section class="ib-list"><div class="ib-bar"><input type="search" id="ibQ" placeholder="Search name, number or message" aria-label="Search chats"><span class="ib-range" id="ibRange"></span>
        <button type="button" class="ib-nav" data-p="-1" aria-label="Newer">‹</button><button type="button" class="ib-nav" data-p="1" aria-label="Older">›</button></div><div id="ibRows" class="ib-rows"></div></section>
      <section class="ib-read" id="ibRead"><div class="ib-empty">Pick a conversation to read it here.</div></section></div>`;
    root.addEventListener('click', click);
    root.querySelector('#ibQ').addEventListener('input', ev => { clearTimeout(st.t); st.t = setTimeout(() => { st.q = ev.target.value; st.offset = 0; load(); }, 250); });
  }
  // as many lines as the list has room for, so nothing scrolls
  function fit() { if (innerWidth < 768) { st.limit = 25; return; } const box = root.querySelector('#ibRows'); const h = box?.clientHeight || 500; st.limit = Math.max(6, Math.floor(h / 68)); }
  // the insight strip: what is waiting, what the assistant handled, how fast, and what chats turned into
  async function insights() {
    const box = root.querySelector('#ibIns'); if (!box) return;
    const l = await req('/api/live?days=7').catch(() => null), n = l?.now || {};
    const tile = (label, value, sub, tone = '') => `<div class="ib-in ${tone}"><span>${e(label)}</span><b>${e(value)}</b><small>${e(sub)}</small></div>`;
    box.innerHTML = tile('Waiting for you', String(n.waiting || 0), n.waiting ? 'reply to keep them' : 'nothing waiting', n.waiting ? 'warn' : 'ok')
      + tile(`${ai()} answered today`, String(n.replies_today || 0), `${n.active_now || 0} chat${n.active_now === 1 ? '' : 's'} happening now`)
      + tile('Average reply', n.avg_ms ? `${(n.avg_ms / 1000).toFixed(1)}s` : '–', 'from message to answer')
      + tile('Booked from chats', String(n.ai_count || 0), `${n.booked_today || 0} today · last 7 days`, 'ok');
  }  // a phone scrolls the list instead

  async function load() {
    fit(); insights();
    let d; try { d = await req(`/api/inbox?folder=${st.folder}&offset=${st.offset}&limit=${st.limit}&q=${encodeURIComponent(st.q)}`); }
    catch (err) { root.querySelector('#ibRows').innerHTML = `<p class="ib-none">Couldn't load your chats. <button type="button" class="ib-retry">Retry</button></p>`; return; }
    Object.assign(st, { rows: d.rows, counts: d.counts, total: d.total });
    root.querySelectorAll('[data-f]').forEach(b => b.setAttribute('aria-current', String(b.dataset.f === st.folder)));
    root.querySelectorAll('[data-n]').forEach(b => { const n = d.counts[b.dataset.n] || 0; b.textContent = n || ''; });
    root.querySelector('#ibRange').textContent = d.total ? `${d.offset + 1}–${Math.min(d.offset + d.rows.length, d.total)} of ${d.total}` : '';
    root.querySelector('[data-p="-1"]').disabled = d.offset === 0; root.querySelector('[data-p="1"]').disabled = d.offset + d.rows.length >= d.total;
    root.querySelector('#ibRows').innerHTML = d.rows.length ? d.rows.map(r => `<button type="button" class="ib-row${r.unread ? ' unread' : ''}${r.id === st.open ? ' on' : ''}${r.needs_attention ? ' need' : ''}" data-c="${r.id}" style="--h:${hue(who(r))};--ch:${CHC[r.channel] || '#a1a1a1'}">
        <span class="ib-av">${e(initials(who(r)))}</span>
        <span class="ib-who">${e(who(r))}</span>
        <span class="ib-what">${r.needs_attention ? '<i class="chip need">Needs you</i>' : KIND[r.kind] ? `<i class="chip k-${r.kind}">${KIND[r.kind]}</i>` : ''}<span class="ib-snip">${r.last ? (r.last.role === 'customer' ? '' : r.last.role === 'staff' ? 'You: ' : ai() + ': ') + e(r.last.text) : ''}</span></span>
        <span class="ib-ch">${e(CH[r.channel] || r.channel)}</span><span class="ib-at">${e(when(r.at))}</span></button>`).join('')
      : `<p class="ib-none">${st.q ? 'No chats match your search.' : st.folder === 'needs' ? `Nothing needs you. ${ai()} is handling every chat.` : 'No chats here yet.'}</p>`;
    // wide screens: open the first chat so the reading pane is never an empty half of the page
    if (!st.open && d.rows.length && innerWidth > 1100) open(d.rows[0].id);
  }

  // the decision trail of one AI reply, in the owner's words
  const PROV = { anthropic: 'Claude', 'gemini-flash-lite': 'Gemini', 'gemini-flash': 'Gemini', 'gemini-3.1-lite': 'Gemini', n8n: 'Gemini (main)', groq: 'Groq', cerebras: 'Cerebras', openrouter: 'OpenRouter', quick: 'Instant answer from your setup (no AI)', fallback: 'Safety message (AI unavailable)' };
  const ACT = { none: 'Answered', book: 'Booked', cancel: 'Cancelled a booking', reschedule: 'Moved a booking', handoff: 'Handed to you', waitlist: 'Added to the waitlist' };
  function why(m) {
    const t = m.trail; if (!t && m.source !== 'ai') return '';
    const rows = t ? [['Answered by', PROV[t.provider] || t.provider], ['Decision', (t.booked ? 'Booked' : ACT[t.action] || t.action) + (t.unknown ? ' · did not know the answer' : '')],
      ['Confidence', m.confidence === 'low' ? 'Unsure: worth a look' : m.confidence === 'high' ? 'Sure' : '—'], t.why && ['Reason', t.why], ['Time', (t.ms / 1000).toFixed(1) + ' s']].filter(Boolean)
      : [['Answered by', 'AI (sent before decision trails were recorded)']];
    const taught = m.review === 'corrected';
    return `<details class="ib-why"><summary>Why this answer${m.confidence === 'low' ? ' <i>unsure</i>' : ''}</summary><dl>${rows.map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join('')}</dl>
      ${taught ? '<p class="ib-taught">You already taught a better answer.</p>' : `<button type="button" class="btn ghost" data-teach="1">Teach a better answer</button>
      <div class="ib-teach" hidden><textarea rows="3" placeholder="What should ${e(ai())} have said?"></textarea><button type="button" class="btn" data-teach-save="${m.id}">Save and teach</button></div>`}</details>`;
  }
  async function open(id) {
    st.open = id; root.querySelectorAll('.ib-row').forEach(r => r.classList.toggle('on', +r.dataset.c === id));
    const row = st.rows.find(r => r.id === id) || {}, read = root.querySelector('#ibRead');
    read.innerHTML = '<div class="ib-empty">Loading…</div>';
    root.querySelector('.ib').classList.add('reading'); // on a phone the chat takes the whole screen
    const [msgs, cu] = await Promise.all([req(`/api/conversations/${id}/messages`), req(`/api/inbox/${id}/customer`).catch(() => ({}))]);
    req(`/api/inbox/${id}/seen`, 'POST', {}).then(() => { const r = root.querySelector(`.ib-row[data-c="${id}"]`); r?.classList.remove('unread'); }).catch(() => {});
    read.innerHTML = `<header class="ib-head"><button type="button" class="ib-back" data-back="1" aria-label="Back to chats"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><div><h2>${e(who(row))}</h2><small>${e(CH[row.channel] || row.channel || '')}${row.phone && !/^test-/.test(row.phone) ? ' · ' + e(row.phone) : ''}${row.attention_reason ? ' · ' + e(row.attention_reason) : ''}</small></div>
        <div class="ib-acts">${row.needs_attention ? '<button type="button" class="btn" data-a="done">Mark done</button>' : ''}
        <button type="button" class="btn ghost" data-a="ai">${row.ai_paused ? 'Let ' + ai() + ' answer' : 'Take over'}</button></div></header>
      <div class="ib-cust">${cu.id ? `<span><b>${cu.visits || 0}</b> visits</span><span><b>$${Math.round(cu.spent || 0)}</b> spent</span><span>${cu.next ? 'Next: <b>' + e(cu.next.replace('T', ' ')) + '</b>' : 'No upcoming visit'}</span>` : ''}</div>
      <div class="ib-msgs" id="ibMsgs">${msgs.map(m => `<div class="ib-m ${m.role}"><p>${e(m.text)}</p><small>${m.role === 'customer' ? '' : m.role === 'staff' ? 'You · ' : ai() + ' · '}${e(when(m.at))}</small>${m.role === 'assistant' ? why(m) : ''}</div>`).join('')}</div>
      <form class="ib-reply" id="ibReply"><input name="t" placeholder="${row.ai_paused ? 'Reply to ' + e(who(row)) : 'Reply (' + ai() + ' pauses while you handle it)'}" autocomplete="off" aria-label="Reply"><button class="btn" type="submit">Send</button></form>`;
    const m = read.querySelector('#ibMsgs'); m.scrollTop = m.scrollHeight;
    // Teach: the owner writes the better answer; it is saved as a correction and as an FAQ, so the AI uses it from now on
    m.addEventListener('click', async ev => {
      const t = ev.target.closest('[data-teach]'); if (t) { const f = t.closest('.ib-why').querySelector('.ib-teach'); f.hidden = !f.hidden; f.querySelector('textarea').focus(); return; }
      const sv = ev.target.closest('[data-teach-save]'); if (!sv) return;
      const f = sv.closest('.ib-teach'), better = f.querySelector('textarea').value.trim(); if (!better) return f.querySelector('textarea').focus();
      sv.disabled = true;
      try { await req(`/api/review/${sv.dataset.teachSave}`, 'POST', { verdict: 'corrected', better, save_faq: true }); f.closest('.ib-why').querySelector('[data-teach]')?.remove(); f.outerHTML = '<p class="ib-taught">Taught. ' + e(ai()) + ' will use this answer from now on.</p>'; }
      catch (err) { sv.disabled = false; window.toast?.(err.message || 'Not saved.'); }
    });
    read.querySelector('#ibReply').addEventListener('submit', async ev => {
      ev.preventDefault(); const t = ev.target.t.value.trim(); if (!t) return;
      try { await req(`/api/conversations/${id}/reply`, 'POST', { text: t }); ev.target.t.value = ''; await load(); open(id); } catch (err) { window.toast?.(err.message || 'Not sent.'); }
    });
  }

  async function click(ev) {
    const t = ev.target;
    if (t.closest('[data-back]')) { root.querySelector('.ib').classList.remove('reading'); st.open = null; return; }
    const f = t.closest('[data-f]'); if (f) { st.folder = f.dataset.f; st.offset = 0; st.open = null; root.querySelector('.ib').classList.remove('reading'); root.querySelector('#ibRead').innerHTML = '<div class="ib-empty">Pick a conversation to read it here.</div>'; return load(); }
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
