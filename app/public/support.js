// Support: the receptionist as a support agent. Fills the Support page (Overview, Topics, Satisfaction, Knowledge gaps)
// from /api/support and /api/learning, and adds type chips above the Inbox conversations table.
// Refreshes when its page is shown and every 20 seconds while it stays open.
(function(){
const $=s=>document.querySelector(s);
const pane=k=>$(`#overview > .spane[data-pane="${k}"]`);
const pct=v=>v==null?"—":v+"%";
const chg=(a,b,unit="pts")=>a==null||b==null?"":`<span class="sp-chg ${a>=b?"up":"dn"}">${a>=b?"+":"−"}${Math.abs(a-b)} ${unit}</span>`;
const bar=(label,val,f,col)=>`<div class="sp-bar"><span>${esc(label)}</span><b>${val}</b><i><u style="width:${Math.max(2,Math.min(100,f||0))}%;${col?`background:${col}`:""}"></u></i></div>`;
const card=(id,title,right,body,why)=>`<div class="card glass sp-card" id="${id}"><div class="ch"><h2>${title}</h2><small>${right||""}</small></div>${why?`<p class="sub">${why}</p>`:""}${body}</div>`;
// a card is inserted once at the top of its pane and then refreshed in place
function put(k,id,html){const p=pane(k);if(!p)return;let c=document.getElementById(id);const t=document.createElement("div");t.innerHTML=html;
  if(c)c.replaceWith(t.firstElementChild);else{const mine=p.querySelectorAll(":scope > .sp-card"),ref=mine[mine.length-1];ref?ref.after(t.firstElementChild):p.prepend(t.firstElementChild)}}
const CH={whatsapp:"WhatsApp",telegram:"Telegram",test:"Test chat",webook:"WeBook",web:"Website",missed_call:"Missed call"};
const KINDS={booking:"Bookings",question:"Questions",change:"Changes",complaint:"Complaints",cancel:"Cancellations",other:"Other",untagged:"Not tagged yet"};

async function load(){let s;try{s=await req(`/api/support?days=30${$("#incTest")&&!$("#incTest").checked?"&test=0":""}`)}catch{return}
  // Overview
  put("live","spKpis",`<div class="card glass sp-card sp-kpis" id="spKpis">${[
    ["Resolved by AI",pct(s.resolved),chg(s.resolved,s.resolved_prev),"No handover and no reply from you"],
    ["Automation",pct(s.automation),chg(s.automation,s.automation_prev),"Chats you never had to touch"],
    ["First reply",s.first_reply_ms?(s.first_reply_ms/1000).toFixed(1)+"s":"—","","Average AI reply time"],
    ["Open cases",String(s.open),"","Waiting for you now"],
    ["Satisfaction",s.csat??"—",s.csat!=null&&s.csat_prev!=null?chg(s.csat,s.csat_prev,""):"",`${s.rated} ratings`]
  ].map(([t,v,c,h])=>`<div title="${h}"><small>${t}</small><b>${v}</b>${c}</div>`).join("")}</div>`);
  put("live","spChannels",card("spChannels","Resolved by channel","30 days",s.channels.length?s.channels.map(c=>bar(CH[c.channel]||c.channel,`${pct(c.resolved)} · ${c.n}`,c.resolved)).join(""):`<p class="sub">No chats yet.</p>`));
  put("live","spReasons",card("spReasons","Why the AI handed over","30 days",s.reasons.length?s.reasons.map(r=>bar(r.reason.replace(/[.;].*$/,""),r.n,r.n/s.reasons[0].n*100,"var(--need)")).join(""):`<p class="sub">No handovers. The AI solved everything.</p>`));
  // Topics
  const top=s.topics,rising=[...top].filter(t=>t.n>t.prev).sort((a,b)=>(b.n-b.prev)-(a.n-a.prev)).slice(0,3);
  put("trends","spTopics",card("spTopics","What customers contact you about","30 days",top.length?`<div class="tw"><table><thead><tr><th>Topic</th><th>Chats</th><th>Trend</th><th>Solved by AI</th><th>Rating</th></tr></thead><tbody>${top.map(t=>`<tr><td>${esc(t.topic)}</td><td class="num">${t.n}</td><td class="num ${t.n>t.prev?"up":t.n<t.prev?"dn":""}">${t.prev?(t.n>=t.prev?"↑ ":"↓ ")+Math.abs(Math.round((t.n-t.prev)/t.prev*100))+"%":"new"}</td><td class="num">${pct(t.resolved)}</td><td class="num">${t.csat??"—"}</td></tr>`).join("")}</tbody></table></div>`
    :`<p class="sub">Topics appear here as new chats come in: the AI names the subject of every conversation.</p>`));
  put("trends","spKinds",card("spKinds","What they want","30 days",s.kinds.map(k=>bar(KINDS[k.kind]||k.kind,k.n,k.n/Math.max(1,s.n)*100,k.kind==="complaint"?"var(--need)":k.kind==="untagged"?"var(--gp-meta)":"")).join("")
    +(rising.length?`<p class="sp-note">Rising: ${rising.map(t=>`<b>${esc(t.topic)}</b>`).join(", ")}</p>`:"")));
  // Satisfaction
  put("reviews","spCsat",card("spCsat","AI vs you","30 days",`<div class="sp-kpis sp-in"><div><small>AI chats</small><b>${s.csat_ai??"—"}</b></div><div><small>Your chats</small><b>${s.csat_you??"—"}</b></div><div><small>Rated</small><b>${s.rated}</b></div></div>`,
    "Rated separately, so you can see where the AI does well and where people still need you."));
  // Knowledge gaps
  let gaps=[];try{gaps=await req("/api/learning?status=open")}catch{}
  const seen=new Set(),uniq=gaps.filter(g=>{const k=g.question.toLowerCase();if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>b.times-a.times);
  put("gaps","spGaps",card("spGaps","Questions the AI couldn't answer",`${uniq.length} open`,uniq.length?`<div class="sp-gaps">${uniq.slice(0,12).map(g=>`<div class="sp-gap" data-id="${g.id}"><div class="q"><b>${esc(g.question)}</b><small>${g.times>1?`asked ${g.times} times · `:""}${esc(g.at||"").slice(5,16).replace("T"," ")}</small></div>
      <div class="a"><input placeholder="Write the answer once; the AI uses it from now on" aria-label="Answer"><button type="button" class="btn" data-act="teach">Teach</button><button type="button" class="btn ghost" data-act="skip">Dismiss</button></div></div>`).join("")}</div>`
    :`<p class="sub">Nothing open. Every question was answered.</p>`,"Answer once and it's saved to your business info, so the AI uses it in every language. The customer who asked gets your answer too."))}
// teaching from Knowledge gaps: same endpoint Teach AI uses
document.addEventListener("click",async e=>{const b=e.target.closest(".sp-gap [data-act]");if(!b)return;const row=b.closest(".sp-gap"),id=row.dataset.id;
  try{if(b.dataset.act==="skip")await req(`/api/learning/${id}/dismiss`,"POST");
    else{const a=row.querySelector("input").value.trim();if(!a){row.querySelector("input").focus();return}await req(`/api/learning/${id}/answer`,"POST",{answer:a});toast("Saved. The AI will use this answer from now on.")}
    row.remove()}catch(err){toast(err.message||"Couldn't save that.")}});

// Inbox: type chips above the conversations table
function chips(){const t=$("#feed")?.closest(".card");if(!t||t.querySelector(".sp-chips"))return;const d=document.createElement("div");d.className="tabs sp-chips";
  d.innerHTML=[["","All"],["booking","Bookings"],["question","Questions"],["change","Changes"],["complaint","Complaints"],["cancel","Cancellations"]].map(([k,l])=>`<button type="button" data-k="${k}" aria-pressed="${!k}">${l}</button>`).join("");
  d.onclick=e=>{const b=e.target.closest("[data-k]");if(!b)return;window.convKind=b.dataset.k;d.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b));try{feed()}catch{}};
  (t.querySelector(".tw")||t.lastElementChild).before(d)}

let timer=null;
addEventListener("pageshown",e=>{clearInterval(timer);if(e.detail.page==="support"){load();timer=setInterval(()=>{if(!document.hidden&&!$("#overview").hidden)load()},20000)}if(e.detail.page==="inbox")chips()});
addEventListener("load",()=>setTimeout(chips,800));
})();
