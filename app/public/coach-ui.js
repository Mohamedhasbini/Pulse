// Teach AI → Coach: the owner chats with their assistant about HOW to talk to customers.
// Each message comes back as change cards (rule, tone, name, remove rule) applied only on "Apply".
(function(){
const $=s=>document.querySelector(s),tr=$("#training"),modes=$("#tchMode");if(!tr||!modes)return;
const KEY="rb-coach-log";
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY))||[]}catch{return[]}},keep=l=>{try{localStorage.setItem(KEY,JSON.stringify(l.slice(-60)))}catch{}};
let log=load(),info=null;

// tab + pane
modes.insertAdjacentHTML("afterbegin",`<button type="button" data-m="coach" aria-pressed="false">Coach</button>`);
const pane=document.createElement("div");pane.id="tchCoach";pane.hidden=true;pane.className="coach";
pane.innerHTML=`<div class="co-chat card glass"><div class="ch"><h2>Coach your assistant</h2><small id="coWho"></small></div>
    <div class="co-msgs" id="coMsgs" aria-live="polite"></div>
    <div class="co-ideas" id="coIdeas">${["Be more formal with clients","Never offer discounts","Always mention free parking","Replies are too long","No emojis","Show my rules"].map(t=>`<button type="button">${t}</button>`).join("")}</div>
    <form class="co-send" id="coForm"><textarea id="coIn" rows="1" placeholder='Tell it how to talk, e.g. "be warmer and always offer the next free time"' aria-label="Message to your assistant"></textarea><button class="btn" aria-label="Send">Send</button></form></div>
  <aside class="co-side card glass"><div class="ch"><h2>How it talks now</h2></div><div id="coNow"></div>
    <p class="sub" style="font-size:12px;margin:10px 0 0">Changes apply to the next customer message. Try them in <a href="#" id="coTry">Test chat</a>.</p></aside>`;
$("#tchReview").before(pane);
document.head.insertAdjacentHTML("beforeend",`<style>
.coach{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:12px;min-height:0;flex:1}
.co-chat{display:flex;flex-direction:column;min-height:420px}.co-msgs{flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:4px 2px;min-height:0}
.co-m:has(.co-cards){width:min(620px,92%);max-width:none}
.co-m{max-width:82%;padding:8px 11px;border-radius:12px;font-size:13px;line-height:1.45;white-space:pre-wrap}
.co-m.me{align-self:flex-end;background:var(--accent);color:var(--accent-ink)}.co-m.ai{align-self:flex-start;background:color-mix(in srgb,var(--ink) 7%,transparent)}
.co-cards{display:flex;flex-direction:column;gap:6px;margin-top:8px}.co-card{display:flex;gap:8px;align-items:flex-start;padding:7px 9px;border:1px solid var(--line2);border-radius:9px;background:var(--s1,transparent)}
.co-card .k{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);flex:none;width:58px;padding-top:2px}.co-card .t{flex:1}
.co-card input{width:100%;font-size:12.5px;padding:4px 7px}.co-acts{display:flex;gap:6px;margin-top:8px}.co-done{font-size:12px;color:var(--good);margin-top:6px}
.co-ideas{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.co-ideas button{all:unset;cursor:pointer;font-size:12px;padding:4px 10px;border:1px solid var(--line2);border-radius:99px;color:var(--ink2)}.co-ideas button:hover{color:var(--ink);border-color:var(--ink2)}
.co-send{display:flex;gap:8px;align-items:flex-end}.co-send textarea{flex:1;resize:none;max-height:120px}
#coNow .row2{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:12.5px}#coNow .row2 span{color:var(--muted)}
#coNow ol{margin:8px 0 0;padding-inline-start:18px;font-size:12.5px;display:flex;flex-direction:column;gap:4px}#coNow ol button{all:unset;cursor:pointer;color:var(--muted);margin-inline-start:6px}#coNow ol button:hover{color:var(--bad)}
@media (max-width:1000px){.coach{grid-template-columns:1fr}}
</style>`);

// switching tabs: Coach shows its pane and hides the others (the existing handler hides Coach when another tab is chosen)
modes.addEventListener("click",e=>{const b=e.target.closest("[data-m]");if(!b)return;pane.hidden=b.dataset.m!=="coach";
  if(b.dataset.m==="coach"){modes.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b));["#tchReview","#tchQuestions","#tchRules"].forEach(s=>$(s)&&($(s).hidden=true));refresh();setTimeout(()=>$("#coIn").focus(),50)}});
$("#coTry").onclick=e=>{e.preventDefault();document.querySelector('nav button[data-view="demo"]')?.click()};

const say=(role,text,extra="")=>{const d=document.createElement("div");d.className="co-m "+role;d.textContent=text;if(extra)d.insertAdjacentHTML("beforeend",extra);$("#coMsgs").append(d);$("#coMsgs").scrollTop=1e9;return d};
const LABEL={rule:"Rule",tone:"Tone",name:"Name",remove_rule:"Remove"};
function cards(changes){return `<div class="co-cards">${changes.map((c,i)=>`<div class="co-card" data-i="${i}"><span class="k">${LABEL[c.type]}</span><span class="t">${c.type==="rule"?`<input value="${esc(c.text)}" aria-label="Rule text">`:esc(c.type==="name"?`Call yourself “${c.value}”`:c.type==="tone"?c.text:`“${c.text}”`)}</span></div>`).join("")}</div>
  <div class="co-acts"><button class="btn" type="button" data-apply>Apply</button><button class="btn ghost" type="button" data-cancel>Cancel</button></div>`}
function drawLog(){$("#coMsgs").innerHTML="";if(!log.length)say("ai",`Hi! I'm ${info?.assistant_name||"your assistant"}. Tell me how to talk to your customers: tone, what to always or never say, what to fix. I'll show you each change before it's saved.`);
  log.forEach(m=>{const d=say(m.role,m.text);if(m.done)d.insertAdjacentHTML("beforeend",`<div class="co-done">✓ ${m.done.map(esc).join("<br>✓ ")}</div>`);if(m.cancelled)d.insertAdjacentHTML("beforeend",`<div class="co-done" style="color:var(--muted)">Cancelled</div>`)})}
async function refresh(){try{info=await req("/api/coach")}catch{return}
  $("#coWho").textContent=info.ai?"AI-assisted":"";
  $("#coNow").innerHTML=`<div class="row2"><span>Name</span><b>${esc(info.assistant_name)}</b></div><div class="row2"><span>Tone</span><b>${esc(info.tones[info.tone]||info.tone||"Warm and friendly")}</b></div>
    <div class="row2" style="border:0"><span>Rules</span><b>${info.rules.length}</b></div>${info.rules.length?`<ol>${info.rules.map((r,i)=>`<li>${esc(r.text||r)}<button type="button" data-rm="${i}" title="Remove" aria-label="Remove rule ${i+1}">✕</button></li>`).join("")}</ol>`:`<p class="sub" style="font-size:12px;margin:6px 0 0">No rules yet.</p>`}`;
  if(!$("#coMsgs").children.length)drawLog()}
$("#coNow").addEventListener("click",e=>{const b=e.target.closest("[data-rm]");if(b)send(`remove rule ${+b.dataset.rm+1}`)});

async function send(text){text=text.trim();if(!text)return;log.push({role:"me",text});keep(log);say("me",text);
  const wait=say("ai","…");
  try{const r=await req("/api/coach/understand","POST",{text});wait.textContent=r.reply;
    if(!r.changes.length){log.push({role:"ai",text:r.reply});keep(log);return}
    wait.insertAdjacentHTML("beforeend",cards(r.changes));
    wait.querySelector("[data-cancel]").onclick=()=>{wait.querySelector(".co-acts").remove();wait.querySelectorAll("input").forEach(i=>i.disabled=true);wait.insertAdjacentHTML("beforeend",`<div class="co-done" style="color:var(--muted)">Cancelled</div>`);log.push({role:"ai",text:r.reply,cancelled:true});keep(log)};
    wait.querySelector("[data-apply]").onclick=async()=>{const changes=r.changes.map((c,i)=>c.type==="rule"?{...c,text:wait.querySelector(`.co-card[data-i="${i}"] input`).value}:c);
      try{const a=await req("/api/coach/apply","POST",{changes});wait.querySelector(".co-acts").remove();wait.querySelectorAll("input").forEach(i=>i.disabled=true);
        const done=a.done.length?a.done:["Nothing new to change."];wait.insertAdjacentHTML("beforeend",`<div class="co-done">✓ ${done.map(esc).join("<br>✓ ")}</div>`);
        log.push({role:"ai",text:r.reply,done});keep(log);toast("Your assistant has been updated.");refresh();try{loadTeach()}catch{}}catch(err){toast(err.message)}}}
  catch(err){wait.textContent=err.message}}
$("#coForm").onsubmit=e=>{e.preventDefault();const v=$("#coIn").value;$("#coIn").value="";$("#coIn").style.height="";send(v)};
$("#coIn").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#coForm").requestSubmit()}});
$("#coIn").addEventListener("input",e=>{e.target.style.height="";e.target.style.height=Math.min(120,e.target.scrollHeight)+"px"});
$("#coIdeas").addEventListener("click",e=>{const b=e.target.closest("button");if(b)send(b.textContent)});
})();
