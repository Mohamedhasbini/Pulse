// Test lab (on the test page) and the learning loop (in Teach AI).
// Test lab: scripted customers run through the real receptionist and are checked with plain rules; each run is kept,
// so a mistake made once is checked again after every change. Teach AI: lessons the AI suggests from its own chats,
// and the versions they created with their test score.
(function(){
const $=s=>document.querySelector(s);
const GOAL={book:"Books it",answer:"Answers it",calm:"Calms them",handoff:"Hands over",honest:"Doesn't guess"};
let data=null,last=null,busy=false;

// ---------- Test lab ----------
const demo=$("#demo");
if(demo){$("#demo .top h1").innerHTML="Test <b>lab</b>";
  const lab=document.createElement("div");lab.className="lab";lab.innerHTML=`
   <div class="card glass lab-sc"><div class="ch"><h2>Scenarios</h2><small id="labN"></small></div>
     <div id="labList"></div>
     <div class="lab-acts"><button class="btn" type="button" id="labAll">Run all</button><button class="btn ghost" type="button" id="labNewBtn">+ New test</button></div>
     <form id="labNew" hidden class="lab-new"><input name="name" placeholder="Name, e.g. Asks for parking" required>
       <select name="goal">${Object.entries(GOAL).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select>
       <select name="mood"><option value="neutral">Calm customer</option><option value="negative">Upset customer</option></select>
       <textarea name="lines" rows="3" placeholder="What the customer writes, one message per line" required></textarea>
       <button class="btn" type="submit">Save test</button></form></div>
   <div class="card glass lab-res"><div class="ch"><h2 id="labResT">Result</h2><small id="labResS"></small></div><div id="labRes"><p class="sub">Run a scenario to see the conversation and its checks.</p></div></div>
   <div class="card glass lab-runs"><div class="ch"><h2>Runs</h2><small>every change is checked again</small></div><div id="labRuns"></div></div>`;
  demo.querySelector(".top").after(lab);
  const manual=demo.querySelector(".demo");if(manual){const h=document.createElement("h3");h.className="lab-h";h.textContent="Try it yourself";manual.before(h)}}
async function loadLab(){try{data=await req("/api/tests")}catch{return}drawLab()}
function drawLab(){if(!data)return;$("#labN").textContent=`${data.scenarios.length} tests`;
  $("#labList").innerHTML=data.scenarios.map(s=>`<div class="lab-row" data-id="${s.id}"><span class="dot ${s.score==null?"":s.score===100?"ok":"bad"}"></span>
    <span class="t"><b>${esc(s.name)}</b><small>${GOAL[s.goal]||s.goal}${s.mood==="negative"?" · upset":""} · ${esc(s.language||"")}</small></span>
    <span class="v">${s.score==null?"—":s.score+"%"}</span><button class="mini" type="button" data-run="${s.id}">Run</button></div>`).join("");
  $("#labRuns").innerHTML=data.runs.length?`<div class="tw"><table><thead><tr><th>When</th><th>Tests</th><th>Passed</th><th>Score</th></tr></thead><tbody>${data.runs.map(r=>`<tr><td>${esc(r.at)}</td><td class="num">${r.n}</td><td class="num">${r.passed}</td><td class="num">${r.score}%</td></tr>`).join("")}</tbody></table></div>`:`<p class="sub">No runs yet.</p>`;
  if(!last){const s=data.scenarios.find(x=>x.transcript);if(s)show({name:s.name,turns:s.transcript,checks:s.checks,score:s.score,ran:s.ran})}}
function show(r){last=r;$("#labResT").textContent=r.name;$("#labResS").textContent=r.ran||"just now";
  $("#labRes").innerHTML=`<div class="lab-chat">${(r.turns||[]).map(t=>`<div class="lab-msg ${t.role==="ai"?"ai":"c"}">${esc(t.text||"(no reply)")}${t.role==="ai"?`<small>${t.queued?"held: the AI was busy":t.source==="ai"?`AI · ${(t.ms/1000).toFixed(1)}s`:t.source||""}${t.booked?" · booked":""}${t.handoff?" · handed to you":""}</small>`:""}</div>`).join("")}</div>
    <div class="lab-checks">${(r.checks||[]).map(c=>`<div><span class="dot ${c.ok?"ok":"bad"}"></span>${esc(c.label)}<b>${c.ok?"✓":"✗"}</b></div>`).join("")}</div><div class="lab-score">${r.score}%</div>`}
async function runTests(id){if(busy)return;busy=true;const b=id?document.querySelector(`[data-run="${id}"]`):$("#labAll");const t=b?.textContent;if(b){b.textContent="Running…";b.disabled=true}
  try{const out=await req("/api/tests/run","POST",id?{id}:{});if(out.length)show(out[out.length-1]);
    if(!id){const ok=out.filter(x=>x.score===100).length;toast(`${ok} of ${out.length} tests passed.`)}}catch(e){toast(e.message||"The run failed.")}
  finally{busy=false;if(b){b.textContent=t;b.disabled=false}loadLab()}}
document.addEventListener("click",e=>{const r=e.target.closest("[data-run]");if(r){runTests(+r.dataset.run);return}
  if(e.target.closest("#labAll"))runTests(0);
  if(e.target.closest("#labNewBtn"))$("#labNew").hidden=!$("#labNew").hidden;
  const row=e.target.closest(".lab-row");if(row&&!e.target.closest("button")){const s=data?.scenarios.find(x=>x.id===+row.dataset.id);if(s?.transcript)show({name:s.name,turns:s.transcript,checks:s.checks,score:s.score,ran:s.ran})}});
$("#labNew")?.addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.target);
  try{await req("/api/tests","POST",Object.fromEntries(f));e.target.reset();e.target.hidden=true;toast("Test saved.");loadLab()}catch(err){toast(err.message)}});
document.querySelector('nav button[data-view="demo"]')?.addEventListener("click",()=>setTimeout(loadLab,100));

// ---------- Teach AI: lessons and versions ----------
const tr=$("#training");
if(tr){const box=document.createElement("div");box.className="learn";box.innerHTML=`
   <div class="card glass"><div class="ch"><h2>Lessons it suggests</h2><small>from its own chats</small></div><div id="lsList"></div></div>
   <div class="card glass"><div class="ch"><h2>Versions</h2><small>score from Test lab</small></div><div id="vsList"></div></div>`;
  (tr.querySelector("#tchMode")||tr.querySelector(".top")).before(box)}
async function loadLearn(){let ls=[],vs=[];try{[ls,vs]=await Promise.all([req("/api/lessons"),req("/api/versions")])}catch{return}
  $("#lsList").innerHTML=ls.length?ls.map((l,i)=>`<div class="ls-row" data-i="${i}"><span class="dot ai"></span><span class="t"><b>${esc(l.title)}</b><small>${esc(l.evidence)}</small></span>
    ${l.kind==="answer"?`<button class="mini" type="button" data-ls="answer">Answer</button>`:`<button class="mini" type="button" data-ls="approve">Approve</button>`}<button class="mini ghost" type="button" data-ls="dismiss" aria-label="Dismiss">✕</button></div>`).join("")
    :`<p class="sub">Nothing to learn right now. Suggestions appear when the AI hands over, is asked the same question twice, or a topic gets low ratings.</p>`;
  $("#lsList").dataset.ls=JSON.stringify(ls);
  $("#vsList").innerHTML=vs.length?vs.map((v,i)=>`<div class="ls-row"><span class="dot ${i?"":"ai"}"></span><span class="t"><b>v${v.id}${i?"":" · now"}</b><small>${esc(v.note||"")} · ${esc(v.at)}</small></span><span class="v">${v.score==null?"run tests":v.score+"%"}</span></div>`).join("")
    :`<p class="sub">A version is saved each time you approve a lesson. Run Test lab after each one to see the score move.</p>`}
document.addEventListener("click",async e=>{const b=e.target.closest("[data-ls]");if(!b)return;const ls=JSON.parse($("#lsList").dataset.ls||"[]")[+b.closest(".ls-row").dataset.i];if(!ls)return;
  if(b.dataset.ls==="answer"){window.dispatchEvent(new CustomEvent("openpage",{detail:{page:"support",tab:"gaps"}}));return}
  try{await req("/api/lessons","POST",{...ls,action:b.dataset.ls==="dismiss"?"dismiss":"approve"});toast(b.dataset.ls==="dismiss"?"Dismissed.":"Approved. It's now one of the AI's rules.");loadLearn()}catch(err){toast(err.message)}});
document.querySelector('nav button[data-view="training"]')?.addEventListener("click",()=>setTimeout(loadLearn,100));
})();
