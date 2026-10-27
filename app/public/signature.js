// Signature components, one per page, after the owner's reference dashboards:
// Home: big figures and pill progress (Crextio) · Dashboard: message flow (Phoenix) · Clients: list + card (Salesforce)
// Teach AI: progress rings (Orion) · Insights: revenue strip and rounded bars (Salesforce, DAO1) · Calendar: blocks with initials (Crextio).
(function(){
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const money=v=>typeof fmt==="function"?fmt(v):"$"+Math.round(v||0).toLocaleString();
const get=async p=>{const r=await fetch(p);if(!r.ok)throw new Error(r.status);return r.json()};
const per=()=>typeof days!=="undefined"?days:30;
const pct=(a,b)=>b?Math.round(a/b*100):0;
const ini=n=>String(n||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
const HUES=["#25d366","#ff7a2e","#8b7bff","#1f9e52","#c45a1f","#6a55c9"]; // the three product colours, each in a full and a deep tone
const ARROW=`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 17 17 7M9 7h8v8"/></svg>`;

// A tab of our own inside a page's tab bar. It hides whenever one of the page's own panes shows.
function addTab(view,key,label,pane,{first=false,onShow}={}){
  const sec=$("#"+view),bar=sec&&sec.querySelector(".ptabs");if(!bar)return null;
  const btn=document.createElement("button");btn.type="button";btn.setAttribute("role","tab");btn.dataset.tab=key;btn.textContent=label;btn.setAttribute("aria-pressed","false");
  first?bar.prepend(btn):bar.append(btn);
  pane.classList.add("spane","sg-pane");pane.dataset.pane=key;pane.hidden=true;
  const panes=[...sec.querySelectorAll(":scope > .spane")];(panes[panes.length-1]||bar).after(pane);
  const on=()=>{sec.querySelectorAll(":scope > .spane").forEach(p=>p.hidden=p!==pane);bar.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",String(b===btn)));
    try{localStorage.setItem("rb-tab-"+view,key)}catch{}onShow&&onShow()};
  btn.addEventListener("click",on);
  new MutationObserver(ms=>{if(ms.some(m=>m.target!==pane&&m.target.parentElement===sec&&m.target.classList.contains("spane")&&!m.target.hidden)){pane.hidden=true;btn.setAttribute("aria-pressed","false")}})
    .observe(sec,{subtree:true,attributes:true,attributeFilter:["hidden"]});
  const orig=window.tabsOf&&tabsOf[view];if(orig)tabsOf[view]=k=>k===key?on():orig(k);
  let stored=null;try{stored=localStorage.getItem("rb-tab-"+view)}catch{}
  let seen=null;try{seen=localStorage.getItem("rb-sg-seen-"+view);localStorage.setItem("rb-sg-seen-"+view,"1")}catch{}
  if(stored===key||(first&&(!stored||!seen)))setTimeout(on,0);
  return {on,pane,btn}}

// ---------------- Dashboard: message flow ----------------
const flow=document.createElement("div");flow.className="sg-flow";
flow.innerHTML=`<div class="card sg-flowcard"><div class="sg-h"><div><h2 class="sg-big">Message<br>flow</h2><p class="sub" id="sgFlowSub"></p></div><span class="sg-go" role="button" tabindex="0" data-sub-go="conversations" title="Open conversations">${ARROW}</span></div><svg id="sgFlow" viewBox="0 0 1000 330" preserveAspectRatio="xMidYMid meet"></svg></div>
<div class="sg-side"><div class="card sg-tile"><span>Booked by the AI</span><b id="sgBooked">0</b><small id="sgBookedV"></small></div><div class="card sg-tile"><span>Average reply</span><b id="sgReply">–</b><small>seconds per answer</small></div><div class="card sg-tile"><span>Needs you</span><b id="sgNeed">0</b><small>conversations handed over</small></div></div>`;
const CH={whatsapp:"WhatsApp",telegram:"Telegram",web:"Website",test:"Test chat",instagram:"Instagram"};
async function loadFlow(){let s;try{s=await get(`/api/stats?days=${per()}`)}catch{return}
  const conv=s.conv||0,booked=s.booked_conv||0,hand=s.handoff||0,ans=Math.max(0,(s.answered||0)-booked-hand),silent=Math.max(0,conv-booked-hand-ans);
  const chans=(s.channels||[]).filter(c=>c.n).sort((a,b)=>b.n-a.n).slice(0,4);if(!chans.length)chans.push({channel:"whatsapp",n:0},{channel:"telegram",n:0},{channel:"web",n:0});
  const outs=[["Booked",booked,1],["Answered",ans,0],["Handed to you",hand,0],["No reply",silent,0]];
  const W=t=>conv?Math.max(3,Math.round(t/conv*46)):3,cx=500,cy=165;
  let g=`<defs><pattern id="sgHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="7" fill="rgba(255,255,255,.06)"/></pattern></defs><rect x="0" y="0" width="1000" height="330" fill="url(#sgHatch)" rx="18" opacity=".6"/>`;
  chans.forEach((c,i)=>{const y=60+i*(210/Math.max(1,chans.length-1||1));
    g+=`<path d="M190 ${y} C 330 ${y}, 360 ${cy}, ${cx-60} ${cy}" fill="none" stroke="var(--pg)" stroke-opacity="${.35+.5*(c.n/(conv||1))}" stroke-width="${W(c.n)}" stroke-linecap="round" data-tip="${esc(CH[c.channel]||c.channel)}: ${c.n} conversations"/>`;
    g+=`<g data-tip="${esc(CH[c.channel]||c.channel)}: ${c.n}"><rect x="20" y="${y-22}" width="170" height="44" rx="22" fill="var(--gp-nest)"/><text x="44" y="${y+5}" class="sg-t">${esc(CH[c.channel]||c.channel)}</text><text x="172" y="${y+5}" class="sg-n" text-anchor="end">${c.n}</text></g>`});
  outs.forEach(([l,n,hot],i)=>{const y=45+i*80;
    g+=`<path d="M${cx+60} ${cy} C ${cx+180} ${cy}, ${cx+200} ${y}, 760 ${y}" fill="none" stroke="${hot?"var(--pg)":"rgba(255,255,255,.28)"}" stroke-width="${W(n)}" stroke-linecap="round" data-tip="${l}: ${n} of ${conv}"/>`;
    g+=`<g data-tip="${l}: ${n} (${pct(n,conv)}%)"><rect x="760" y="${y-24}" width="220" height="48" rx="24" fill="${hot?"var(--pg)":"var(--gp-nest)"}"/><text x="784" y="${y+5}" class="sg-t" ${hot?'fill="#111"':""}>${l}</text><text x="958" y="${y+5}" class="sg-n" text-anchor="end" ${hot?'fill="#111"':""}>${n}</text></g>`});
  g+=`<g data-tip="${conv} conversations in the period"><rect x="${cx-70}" y="${cy-44}" width="140" height="88" rx="26" fill="var(--pg)"/><text x="${cx}" y="${cy-6}" text-anchor="middle" class="sg-n" fill="#111" style="font-size:30px;font-weight:300">${conv}</text><text x="${cx}" y="${cy+22}" text-anchor="middle" class="sg-t" fill="#111">Pulse AI</text></g>`;
  $("#sgFlow").innerHTML=g;
  $("#sgFlowSub").textContent=conv?`${pct(booked,conv)}% of ${conv} conversations became bookings`:"Conversations will flow here as customers write in";
  $("#sgBooked").textContent=s.ai_bookings||0;$("#sgBookedV").textContent=money(s.ai_value)+" booked";
  $("#sgReply").textContent=s.ai&&s.ai.avg_ms?(s.ai.avg_ms/1000).toFixed(1):"–";$("#sgNeed").textContent=hand}
flow.addEventListener("click",e=>{const g=e.target.closest("[data-sub-go]");if(g)tabsOf.overview&&tabsOf.overview(g.dataset.subGo)});
const tFlow=addTab("overview","flow","Flow",flow,{first:true,onShow:loadFlow});
window.loadFlow=loadFlow; // Insights › Live flow (pulse.js) opens this pane without the old tab

// ---------------- Home: big figures and pill progress inside the greeting ----------------
async function homeBand(){const hero=$(".td-hero");if(!hero)return;let s;try{s=await get("/api/stats?days=7")}catch{return}
  let band=hero.querySelector(".sg-band");if(!band){band=document.createElement("div");band.className="sg-band";hero.append(band);hero.classList.add("sg-hero")}
  const conv=s.conv||0;
  band.innerHTML=`<div class="sg-figs"><div><b>${conv}</b><span>Conversations</span></div><div><b>${s.ai_bookings||0}</b><span>AI bookings</span></div><div><b>${s.customers||0}</b><span>Customers</span></div></div>
   <div class="sg-pills">${[["Answered",pct(s.answered,conv),"ink"],["Booked",pct(s.booked_conv,conv),"pg"],["Handed off",pct(s.handoff,conv),"hatch"]].map(([l,p,k])=>`<div class="sg-pill"><small>${l}</small><div class="sg-track"><i class="${k}" style="width:${Math.max(p,24)}%">${p}%</i></div></div>`).join("")}</div><small class="sg-note">Last 7 days</small>`}
const todaySec=$("#today");if(todaySec){new MutationObserver(()=>{if(!todaySec.hidden)homeBand()}).observe(todaySec,{attributes:true,attributeFilter:["hidden"]});if(!todaySec.hidden)homeBand()}

// ---------------- Clients: list and client card ----------------
const board=document.createElement("div");board.className="sg-board";
board.innerHTML=`<div class="sg-strip" id="sgStrip"></div><div class="sg-two"><div class="card sg-list"><div class="sg-h"><h2>All clients</h2><input id="sgQ" placeholder="Search" aria-label="Search clients"></div><div class="sg-rows" id="sgRows"></div></div><div class="card sg-detail" id="sgDetail"><p class="sub">Your clients appear here as people chat or book. Pick one to see their card.</p></div></div>`;
let people=[],pick=null;
async function loadBoard(){try{people=await get("/api/customers?test=1")}catch{people=[]}drawBoard();if(!pick&&people[0])openCard(people[0].id)}
function drawBoard(){const q=($("#sgQ").value||"").toLowerCase(),list=people.filter(c=>`${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q));
  $("#sgRows").innerHTML=list.length?list.slice(0,80).map((c,i)=>`<button type="button" class="sg-row" data-id="${c.id}" aria-current="${c.id===pick}"><span class="sg-av" style="--h:${HUES[c.id%HUES.length]}">${esc(ini(c.name))}</span><span class="sg-nm"><b>${esc(c.name||"No name")}</b><small>${esc(c.phone||c.email||"")}</small></span><span class="sg-amt">${money(c.spent)}</span><span class="sg-chip">${c.upcoming?"Booked":c.visits?c.visits+" visits":"New"}</span></button>`).join(""):`<p class="sub" style="padding:12px">No clients yet. They appear as people chat or book.</p>`;
  const top=[...people].sort((a,b)=>b.spent-a.spent),tot=top.reduce((t,c)=>t+c.spent,0),five=top.slice(0,5),rest=tot-five.reduce((t,c)=>t+c.spent,0);
  $("#sgStrip").innerHTML=`<div class="sg-sum">${five.map((c,i)=>`<div><b>${money(c.spent)}</b><small>${esc(c.name||"Client")}</small></div>`).join("")}${rest>0?`<div><b>${money(rest)}</b><small>Everyone else</small></div>`:""}</div>
   <div class="sg-bar">${tot?five.map((c,i)=>`<i style="flex:${c.spent||0};background:${HUES[i]}" data-tip="${esc(c.name)}: ${money(c.spent)}"></i>`).join("")+(rest>0?`<i style="flex:${rest};background:#5b5c60" data-tip="Everyone else: ${money(rest)}"></i>`:""):`<i style="flex:1" class="hatch"></i>`}</div>`}
async function openCard(id){pick=id;drawBoard();let c;try{c=await get("/api/customers/"+id)}catch{return}
  const spent=c.bookings.filter(b=>["completed","confirmed"].includes(b.status)).reduce((t,b)=>t+(b.price||0),0);
  $("#sgDetail").innerHTML=`<div class="sg-dh"><span class="sg-av big" style="--h:${HUES[c.id%HUES.length]}">${esc(ini(c.name))}</span><div><h3>${esc(c.name||"No name")}</h3><small>${esc(c.phone||"")}${c.email?" · "+esc(c.email):""}</small></div><button class="btn" type="button" data-cust="${c.id}">Full profile</button></div>
   <div class="sg-chips"><div><small>Visits</small><b>${c.bookings.filter(b=>b.status==="completed").length}</b></div><div><small>Upcoming</small><b>${c.bookings.filter(b=>b.status==="confirmed"&&new Date(b.start)>new Date()).length}</b></div><div><small>No-shows</small><b>${c.bookings.filter(b=>b.status==="no_show").length}</b></div></div>
   <div class="sg-lines">${c.bookings.slice(0,5).map((b,i)=>`<div><span class="sg-num">${i+1}</span><span>${esc(b.service)}<small>${esc(String(b.start).slice(0,16).replace("T"," "))}</small></span><span class="sg-st st-${esc(b.status)}">${esc(b.status.replace("_"," "))}</span><b>${money(b.price)}</b></div>`).join("")||`<p class="sub">No bookings yet.</p>`}</div>
   <div class="sg-tot"><div><small>Bookings</small><b>${c.bookings.length}</b></div><div><small>Conversations</small><b>${c.conversations.length}</b></div><div class="hot"><small>Lifetime value</small><b>${money(spent)}</b></div></div>`}
board.addEventListener("click",e=>{const r=e.target.closest(".sg-row");if(r)openCard(+r.dataset.id)});
board.addEventListener("input",e=>{if(e.target.id==="sgQ")drawBoard()});
addTab("people","board","Board",board,{first:true,onShow:loadBoard});

// ---------------- Teach AI: progress rings ----------------
const ring=(p,label,sub)=>{const r=44,c=2*Math.PI*r,o=c*(1-Math.min(100,p)/100);
  return `<div class="card sg-ring"><svg viewBox="0 0 110 110"><circle cx="55" cy="55" r="${r}" fill="none" stroke="var(--gp-nest2)" stroke-width="9" stroke-dasharray="3 5"/><circle cx="55" cy="55" r="${r}" fill="none" stroke="var(--pg)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${o}" transform="rotate(-90 55 55)"/><text x="55" y="60" text-anchor="middle">${p}<tspan>%</tspan></text></svg><div><b>${label}</b><small>${sub}</small></div></div>`};
async function rings(){const st=$("#tchStats");if(!st)return;let r;try{r=await get("/api/review/stats")}catch{return}
  let box=$("#sgRings");if(!box){box=document.createElement("div");box.id="sgRings";box.className="sg-rings";st.before(box);st.hidden=true}
  const rated=(r.approved||0)+(r.corrected||0)+(r.wrong||0),all=rated+(r.todo||0);
  box.innerHTML=ring(pct(r.approved,rated),"Good replies",`${r.approved||0} of ${rated} you rated`)+ring(pct(rated,all),"Reviewed",`${r.todo||0} replies still to check`)+ring(all?100-pct(r.low,all):100,"Confident",`${r.low||0} replies the AI was unsure of`)}
const tr=$("#training");if(tr){new MutationObserver(()=>{if(!tr.hidden)rings()}).observe(tr,{attributes:true,attributeFilter:["hidden"]});if(!tr.hidden)rings()}

// ---------------- Insights: revenue strip and rounded bars ----------------
const hi=document.createElement("div");hi.className="sg-hi";
hi.innerHTML=`<div class="card"><div class="sg-h"><h2>Revenue by service</h2><small class="sub" id="sgHiP"></small></div><div class="sg-sum" id="sgHiSum"></div><div class="sg-bar tall" id="sgHiBar"></div></div><div class="card"><div class="sg-h"><h2>Conversations and bookings</h2><small class="sub">booked share inside each bar</small></div><div class="sg-cols" id="sgCols"></div></div>`;
async function loadHi(){if(typeof me!=="undefined"&&me&&Array.isArray(me.features)&&!me.features.includes("insights")&&me.user?.role!=="admin"){hi.hidden=true;tabsOf.analytics&&tabsOf.analytics("overview");return}let s;try{s=await get(`/api/stats?days=${Math.max(per(),28)}`)}catch{$("#sgHiSum").innerHTML=`<p class="sub">Insights are not part of this plan yet.</p>`;return}
  const sv=(s.services||[]).filter(x=>x.value>0).sort((a,b)=>b.value-a.value),tot=sv.reduce((t,x)=>t+x.value,0);
  $("#sgHiP").textContent=`last ${Math.max(per(),28)} days`;
  $("#sgHiSum").innerHTML=sv.length?sv.slice(0,5).map((x,i)=>`<div><b>${money(x.value)}</b><small><i style="background:${HUES[i]}"></i>${esc(x.name)} · ${x.n}</small></div>`).join(""):`<p class="sub">No paid bookings in this period yet.</p>`;
  $("#sgHiBar").innerHTML=tot?sv.slice(0,6).map((x,i)=>`<i style="flex:${x.value};background:${HUES[i]}" data-tip="${esc(x.name)}: ${money(x.value)} (${pct(x.value,tot)}%)"></i>`).join(""):`<i class="hatch" style="flex:1"></i>`;
  const d=s.daily||[],wk=[];for(let i=0;i<d.length;i+=7){const part=d.slice(i,i+7);wk.push({l:part[0].day.slice(5),c:part.reduce((t,x)=>t+x.conv,0),b:part.reduce((t,x)=>t+x.booked,0)})}
  const last=wk.slice(-8),mx=Math.max(1,...last.map(w=>w.c));
  $("#sgCols").innerHTML=last.map((w,i)=>`<div class="sg-col" data-tip="Week of ${w.l}: ${w.c} conversations, ${w.b} bookings"><div class="sg-tube"><i class="${i===last.length-1?"now":""}" style="height:${Math.max(8,w.c/mx*100)}%"><em>${pct(w.b,w.c)}%</em></i></div><small>${w.l}</small></div>`).join("")}
const tHi=addTab("analytics","highlights","Highlights",hi,{first:true,onShow:loadHi});
// the plan decides: no Insights in the plan, no Highlights tab
const hideHi=()=>{if(tHi&&typeof me!=="undefined"&&me&&Array.isArray(me.features))tHi.btn.hidden=!me.features.includes("insights")&&me.user?.role!=="admin"};setTimeout(hideHi,1500);document.querySelector('nav button[data-view="analytics"]')?.addEventListener("click",()=>setTimeout(hideHi,50));

// ---------------- Calendar: initials on every booking block ----------------
const grid=$("#calGrid");
if(grid)new MutationObserver(()=>grid.querySelectorAll(".cal-b:not([data-ini])").forEach(b=>{const name=(b.textContent||"").trim().split("\n")[0];b.dataset.ini=1;
  const m=b.querySelector("b,strong")?.textContent||name;const s=document.createElement("span");s.className="sg-mini";s.textContent=ini(m);b.prepend(s)})).observe(grid,{childList:true,subtree:true});

// keep the live pieces fresh with the dashboard's period buttons
document.addEventListener("click",e=>{if(e.target.closest("button[data-d]"))setTimeout(()=>{if(!flow.hidden)loadFlow();if(!hi.hidden)loadHi()},300)});
})();
