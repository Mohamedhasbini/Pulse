// Agents page: every agent shows who it found, why, and the message it wrote. The owner ticks who to send to,
// can edit each message, and presses Send. People the app can't reach right now get a WhatsApp link instead.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const sec=document.createElement("section");sec.className="wrap";sec.id="agents";sec.hidden=true;
sec.innerHTML=`<div class="top"><div><h1>Your <b>team</b></h1><p class="sub">Four AI employees who know your business from the inside. Ask them anything; they check your real data before answering, and nothing changes or is sent until you approve it.</p></div>
  <button class="btn ghost" type="button" id="agRefresh">Check again</button></div>
  <div class="tm"><div class="tm-people" id="tmPeople"></div>
    <div class="card glass tm-chat"><div class="ch"><h2 id="tmWith">Ask your team</h2><small id="tmLeft"></small></div>
      <div class="tm-log" id="tmLog" aria-live="polite"></div>
      <div class="tm-sugg" id="tmSugg"></div>
      <form class="tm-ask" id="tmForm"><input id="tmIn" placeholder="Ask anything: who's coming tomorrow, how was this month, what should I fix…" autocomplete="off" aria-label="Your question"><button class="btn" type="submit">Ask</button></form></div></div>
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

// ---------- the team: employees and the chat ----------
let team=[],who="",convo=[];
const SUGG={"":["Who's coming tomorrow?","How was this month compared to last?","What should I fix first?"],maya:["Who's coming tomorrow?","Next free time for a facial?","Tell me about my client Lina"],
  omar:["What did customers complain about this week?","Which questions couldn't the AI answer?","Which chats are waiting for me?"],
  lina:["Who should I win back?","Which days this week are quiet?","Who are my best clients?"],sam:["How was this month compared to last?","Which service earns the most?","When are my busiest hours?"]};
async function loadTeam(){try{const d=await req("/api/team");team=d.team;$("#tmLeft").textContent=`${d.calls_left} of ${d.cap} questions left today`;drawPeople()}catch(e){$("#tmLeft").textContent=e.message}}
function drawPeople(){$("#tmPeople").innerHTML=`<button type="button" class="tm-p" data-who="" aria-pressed="${!who}"><span class="av">✦</span><span><b>Anyone</b><small>The right person answers</small></span></button>`
  +team.map(p=>`<button type="button" class="tm-p" data-who="${p.id}" aria-pressed="${who===p.id}"><span class="av av-${p.id}">${p.avatar}</span><span><b>${esc(p.name)}</b><small>${esc(p.role)}</small></span></button>`).join("");
  const p=team.find(x=>x.id===who);$("#tmWith").textContent=p?`Ask ${p.name}`:"Ask your team";
  $("#tmIn").placeholder=p?`Ask ${p.name} about ${p.skills.split(",").slice(0,3).join(",")}…`:"Ask anything: who's coming tomorrow, how was this month, what should I fix…";
  $("#tmSugg").innerHTML=(SUGG[who]||SUGG[""]).map(t=>`<button type="button" class="tm-s">${esc(t)}</button>`).join("")}
const nameOf=id=>team.find(p=>p.id===id)?.name||"Team";
// answers keep their line breaks and **bold**; everything else is escaped
const fmtA=t=>esc(t).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/\n/g,"<br>");
const BRACKET=/\[[^\]]+\]/;
const actTitle=a=>a.type==="send_message"?`Message to ${esc(a.client||"client")}`:a.type==="teach_answer"?"Teach the receptionist this answer":a.type==="add_rule"?"New rule for the receptionist":"Let the agent send its messages";
function drawLog(){$("#tmLog").innerHTML=convo.map((m,i)=>m.role==="owner"?`<div class="tm-m tm-me">${esc(m.text)}</div>`
  :`<div class="tm-m tm-them"><span class="av av-${m.who}">${esc(nameOf(m.who)[0])}</span><div><b>${esc(nameOf(m.who))}</b>${m.wait?`<span class="tm-wait">checking your data… (up to 30 seconds)</span>`:`<div>${fmtA(m.text||"")}</div>`}
    ${m.tools?.length?`<small class="tm-src">Checked: ${m.tools.map(esc).join(", ")}</small>`:""}
    ${(m.actions||[]).map((a,j)=>`<div class="tm-act" data-m="${i}" data-a="${j}"><b>${actTitle(a)}</b>
      ${a.type==="run_agent"?"":`<textarea rows="2">${esc(a.text||a.answer||"")}</textarea>`}${BRACKET.test(a.text||a.answer||"")?`<small class="tm-fill">Fill in the parts in [brackets] first.</small>`:""}
      <div class="tm-actb"><button class="mini" type="button" data-do>${a.done?"Done":"Approve"}</button><button class="mini ghost" type="button" data-skip>Skip</button></div>${a.result?`<small>${esc(a.result)}</small>`:""}</div>`).join("")}</div></div>`).join("");
  $("#tmLog").scrollTop=1e6}
async function askTeam(text){if(!text.trim())return;convo.push({role:"owner",text});const w={role:"ai",who:who||"",wait:true};convo.push(w);drawLog();
  try{const r=await req("/api/team/ask","POST",{employee:who||undefined,messages:convo.filter(m=>!m.wait&&m.text).map(m=>({role:m.role==="owner"?"owner":"assistant",text:m.text}))});
    Object.assign(w,{wait:false,who:r.employee,text:r.answer,tools:r.tools,actions:r.actions})}catch(e){Object.assign(w,{wait:false,who:w.who||"maya",text:e.message})}
  drawLog();loadTeam()}
// Today's team strip opens the page here, with someone chosen and maybe a question asked

$("#tmForm").addEventListener("submit",e=>{e.preventDefault();const t=$("#tmIn").value;$("#tmIn").value="";askTeam(t)});
document.addEventListener("click",async e=>{const p=e.target.closest(".tm-p");if(p){window.openTeam?.(p.dataset.who||"maya");return}
  const s=e.target.closest(".tm-s");if(s){askTeam(s.textContent);return}
  const box=e.target.closest(".tm-act");if(!box)return;const m=convo[+box.dataset.m],a=m.actions[+box.dataset.a];
  if(e.target.closest("[data-skip]")){m.actions.splice(+box.dataset.a,1);drawLog();return}
  if(!e.target.closest("[data-do]")||a.done)return;const t=box.querySelector("textarea")?.value;
  if(t&&BRACKET.test(t)){toast("Fill in the parts in [brackets] first.");return}
  if(a.type==="run_agent"){$("#agList").scrollIntoView({behavior:"smooth"});return}
  try{const r=await req("/api/team/act","POST",{...a,text:t,answer:t});a.done=r.ok!==false;a.result=r.done;if(r.link){window.open(r.link,"_blank","noopener");a.result+=" Opened in your WhatsApp."}toast(r.done)}catch(err){a.result=err.message}drawLog()});
})();

