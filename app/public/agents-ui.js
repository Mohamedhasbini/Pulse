// Agents page: every agent shows who it found, why, and the message it wrote. The owner ticks who to send to,
// can edit each message, and presses Send. People the app can't reach right now get a WhatsApp link instead.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const sec=document.createElement("section");sec.className="wrap";sec.id="agents";sec.hidden=true;
sec.innerHTML=`<div class="top"><div><h1>Your <b>team</b></h1><p class="sub">Four AI specialists watch your business live: each one checks the real data, flags what needs you and proposes the fix. Nothing is sent or changed until you approve it.</p></div>
  <button class="btn ghost" type="button" id="agRefresh">Check again</button></div>
  <div class="desk" id="tmDesk" aria-live="polite"></div>
  <h3 class="lab-h">Waiting for your OK</h3>
  <div id="agList" class="ag-list"></div>
  <div class="card glass"><div class="ch"><h2>What your agents did</h2><small>last 30 sends</small></div><div id="agLog"></div></div>`;
document.querySelector("main").append(sec);
const nb=document.createElement("button");nb.dataset.view="agents";nb.title="Team";nb.setAttribute("aria-label","Team");
nb.innerHTML=`<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M15.5 14.6c2.6.1 4.6 1.8 5.3 4.9"/></svg><span>Team</span>`;
document.querySelector('nav button[data-view="calendar"]')?.after(nb);
nb.addEventListener("click",()=>{$$("nav button[data-view]").forEach(x=>x.setAttribute("aria-current",x===nb));$$("main > section.wrap").forEach(s=>s.hidden=s!==sec);
  document.body.dataset.page="agents";load();loadTeam()});
$$("nav button[data-view]").forEach(b=>{if(b!==nb)b.addEventListener("click",()=>{sec.hidden=true})});

let data=null;const pick={};
async function load(){$("#agList").innerHTML=`<p class="sub">Checking your data…</p>`;
  try{data=await req("/api/agents")}catch(e){$("#agList").innerHTML=`<p class="sub">${esc(e.message)}</p>`;return}draw();
  try{const log=await req("/api/agents/log");$("#agLog").innerHTML=log.length?`<div class="tw"><table><thead><tr><th>When</th><th>Agent</th><th>Client</th><th>Result</th></tr></thead><tbody>${log.map(l=>`<tr><td>${esc(l.at)}</td><td>${esc(data.agents.find(a=>a.id===l.agent)?.name||l.agent)}</td><td>${esc(l.name||"")}</td><td>${esc(l.status)}</td></tr>`).join("")}</tbody></table></div>`:`<p class="sub">Nothing sent yet.</p>`}catch{}}
function draw(){$("#agList").innerHTML=data.agents.map(a=>{const n=a.found.length;pick[a.id]??=new Set(a.found.filter(f=>f.reach).map(f=>f.id));
  return `<div class="card glass ag" data-a="${a.id}"><div class="ag-head"><span class="ag-dot ${n?"on":""}"></span><div class="t"><b>${esc(a.name)}</b><small>${esc(a.does)}</small></div>
    <span class="ag-n">${a.blocked?"off":n?`${n} found`:"all clear"}</span></div>
    ${a.blocked?`<div class="ag-set"><input id="agReview" placeholder="https://g.page/r/your-review-link" value="${esc(data.review_url)}" aria-label="Google review link"><button class="btn" type="button" id="agReviewSave">Save link</button></div><p class="sub">${esc(a.blocked)}</p>`:""}
    ${n?`<details class="ag-body"><summary>Review ${n} message${n>1?"s":""}</summary>
      ${a.found.map(f=>`<div class="ag-row"><label class="ag-pick"><input type="checkbox" data-pick="${f.id}" ${pick[a.id].has(f.id)?"checked":""} ${f.reach?"":"disabled"}><span><b>${esc(f.name)}</b><small>${esc(f.why)} · ${f.reach?`via ${f.reach==="whatsapp"?"WhatsApp":"Telegram"}`:"can't be reached by the app now"}</small></span></label>
        <textarea data-msg="${f.id}" rows="2" aria-label="Message to ${esc(f.name)}">${esc(f.message)}</textarea>
        ${f.wa?`<a class="btn ghost ag-wa" href="${esc(f.wa)}" target="_blank" rel="noopener" data-wa="${f.id}">Send from my WhatsApp</a>`:""}</div>`).join("")}
      <div class="ag-acts"><button class="btn" type="button" data-send="${a.id}">Send to <span>${pick[a.id].size}</span></button>${a.promo?`<small>Offers go only to clients who agreed to receive them, with a way to stop.</small>`:""}</div></details>`:""}
    ${a.sent30?`<p class="ag-foot">${a.sent30} sent in the last 30 days</p>`:""}</div>`}).join("")}
document.addEventListener("change",e=>{const c=e.target.closest("[data-pick]");if(!c)return;const a=c.closest("[data-a]").dataset.a,id=+c.dataset.pick;c.checked?pick[a].add(id):pick[a].delete(id);c.closest("[data-a]").querySelector("[data-send] span").textContent=pick[a].size});
document.addEventListener("click",async e=>{
  if(e.target.closest("#agRefresh")){Object.keys(pick).forEach(k=>delete pick[k]);load();return}
  if(e.target.closest("#agReviewSave")){try{await req("/api/agents/settings","PUT",{review_url:$("#agReview").value});toast("Saved.");load()}catch(err){toast(err.message)}return}
  const w=e.target.closest("[data-wa]");if(w){const a=w.closest("[data-a]").dataset.a;req(`/api/agents/${a}/send`,"POST",{ids:[+w.dataset.wa],manual:true,messages:{[w.dataset.wa]:w.closest(".ag-row").querySelector("textarea").value}}).then(()=>setTimeout(load,1500)).catch(()=>{});return}
  const s=e.target.closest("[data-send]");if(!s)return;const a=s.dataset.send,ids=[...pick[a]];if(!ids.length){toast("Tick at least one client.");return}
  const card=s.closest("[data-a]"),messages={};ids.forEach(id=>messages[id]=card.querySelector(`[data-msg="${id}"]`).value);
  if(!confirm(`Send ${ids.length} message${ids.length>1?"s":""} now?`))return;
  s.disabled=true;try{const r=await req(`/api/agents/${a}/send`,"POST",{ids,messages});toast(`${r.sent} sent${r.skipped?`, ${r.skipped} couldn't be reached`:""}.`);delete pick[a];load()}catch(err){toast(err.message)}finally{s.disabled=false}});

// ---------- the team: live analysts, not chatbots ----------
// Each specialist shows what they found in the data right now (/api/team/status): a one-line read of their area,
// progress on it this week, and the flags that need you, each a link to where you fix it. "Ask" opens Pulse AI with
// their question, so every conversation happens in one place.
const TONE={need:"Needs you",bad:"Problem",good:"Good"};
async function loadTeam(){const box=$("#tmDesk");if(!box.innerHTML)box.innerHTML=`<p class="sub">Reading your data…</p>`;
  let t;try{t=(await req("/api/team/status")).team}catch(e){box.innerHTML=`<p class="sub">${esc(e.message)}</p>`;return}
  box.innerHTML=t.map(e=>{const flags=(e.items||[]).filter(i=>i.tone),more=(e.items||[]).filter(i=>!i.tone);
    return `<article class="desk-c${e.open?" busy":""}"><header><span class="av av-${e.id}">${esc(e.name[0])}</span><div><b>${esc(e.name)}</b><small>${esc(e.role)}</small></div>
      <span class="desk-st ${e.open?"on":""}">${e.open?`${e.open} open`:"All clear"}</span></header>
      <p class="desk-read">${esc(e.advice)}</p>
      ${e.progress==null?"":`<div class="desk-pg"><i><u style="width:${e.progress}%"></u></i><small><b>${e.progress}%</b> ${esc(e.of)}</small></div>`}
      ${flags.length?`<ul class="desk-flags">${flags.map(i=>`<li><button type="button" class="tp-link ${i.tone}" data-go='${esc(JSON.stringify(i.go||{}))}'><span class="desk-tag ${i.tone}">${TONE[i.tone]||"Flag"}</span>${esc(i.text)}<em>→</em></button></li>`).join("")}</ul>`:""}
      <footer>${more.map(i=>`<button type="button" class="tp-link desk-lk" data-go='${esc(JSON.stringify(i.go||{}))}'>${esc(i.text)}</button>`).join("")}
        <button type="button" class="desk-ask" data-ask="${esc(e.ask||"")}">Ask ${esc(e.name)}</button></footer></article>`}).join("")}
document.addEventListener("click",e=>{const a=e.target.closest(".desk-ask");if(a)window.PulseCommand?.open(a.dataset.ask||undefined)});
setInterval(()=>{if(!sec.hidden&&!document.hidden)loadTeam()},60000);
})();
