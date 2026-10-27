// Page tabs, Home wiring, live loop and quick actions. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- Fit-to-screen: every page is split into tabs so nothing needs page scrolling ----------
window.tabsOf={};
// groups: [[key, label, () => [elements]], ...]. Elements move into one pane per tab; the last opened tab is remembered.
function pageTabs(viewId,groups,{after,cls=""}={}){
  const sec=$("#"+viewId),anchor=after||sec.querySelector(".top");
  const bar=document.createElement("div");bar.className="tabs glass ptabs";bar.setAttribute("role","tablist");
  bar.innerHTML=groups.map(([k,l],i)=>`<button type="button" role="tab" data-tab="${k}" aria-pressed="${i===0}">${l}<b class="badge-n" id="tb_${viewId}_${k}" hidden></b></button>`).join("");
  anchor.after(bar);
  const panes={};let prev=bar;
  groups.forEach(([k,,get])=>{const p=document.createElement("div");p.className="spane "+cls;p.dataset.pane=k;p.hidden=true;
    for(const el of get().filter(Boolean))p.append(el);prev.after(p);prev=p;panes[k]=p});
  const show=k=>{if(!panes[k])k=groups[0][0];bar.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.tab===k));
    Object.entries(panes).forEach(([n,p])=>p.hidden=n!==k);try{localStorage.setItem("rb-tab-"+viewId,k)}catch{}
    if(!$("#"+viewId).hidden){const bs=[...document.querySelectorAll(`nav button[data-view="${viewId}"]`)],hit=bs.find(x=>x.dataset.sub===k);
      bs.forEach(x=>x.setAttribute("aria-current",String(hit?x===hit:!x.dataset.sub)))}
    window.dispatchEvent(new CustomEvent("tabshown",{detail:{view:viewId,tab:k}}))};
  bar.addEventListener("click",e=>{const b=e.target.closest("button[data-tab]");if(b)show(b.dataset.tab)});
  let start=groups[0][0];try{start=localStorage.getItem("rb-tab-"+viewId)||start}catch{}show(start);
  tabsOf[viewId]=show;return show}
const tabBadge=(view,k,n)=>{const b=$(`#tb_${view}_${k}`);if(b){b.hidden=!n;b.textContent=n}};
const grid=(cls,...cards)=>{const g=document.createElement("div");g.className=cls;g.append(...cards.filter(Boolean));return g};

// Home
(function buildHome(){
  const ov=$("#overview"),top=ov.querySelector(".top"),desk=ov.querySelector(".desk2"),cmd=desk.querySelector(".cmdrow");
  const grids=[...desk.querySelectorAll(":scope > .g12")];
  const ai=grids[0].children[0],gaugeCard=grids[0].children[1],donutCard=grids[0].children[2],microGrid=grids[1];
  const kpis=ov.querySelector(".kpis"),appr=$("#apprCard"),r1=ov.querySelector(".row.r1"),r2=ov.querySelector(".row.r2"),r3=ov.querySelector(".row.r3");
  const convCard=$("#feed").closest(".card"),setupCard=$("#ldSetup");
  const activeCard=$("#ldActive").closest(".card"),upCard=$("#ldUp").closest(".card"),feedCard=$("#ldFeed").closest(".card");
  const weekCard=$("#ldWeek").closest(".card"),flowCard=$("#ldFlow").closest(".card"),heatCard=$("#ldHeat").closest(".card");
  const needsCard=r1.children[0],todayCard=r1.children[1];
  top.after(cmd);
  const urgent=document.createElement("div");urgent.className="card glass gx urgent";urgent.innerHTML=`<div class="ch"><h2>Needs attention</h2><small id="urgN"></small></div><div class="ulist" id="urgList"></div>`;
  // Queue and Reviews tabs (filled by live.js)
  const queueCard=document.createElement("div");queueCard.className="card glass gx";queueCard.id="queueCard";
  queueCard.innerHTML=`<div class="ch"><h2>AI queue</h2><div class="tabs" role="group" aria-label="Queue status" id="qTabs"><button aria-pressed="true" data-s="waiting">Waiting</button><button aria-pressed="false" data-s="answered">Answered</button><button aria-pressed="false" data-s="failed">Needs you</button></div></div>
    <p class="sub" style="margin:0 0 10px">When many customers write at once, the AI answers what it can straight away and queues the rest. Queued chats get "I'm checking, back in a moment" and the full answer follows automatically.</p>
    <div class="kp-row" id="qKpis"></div><div class="tw"><table><thead><tr><th>Received</th><th>Customer</th><th>Channel</th><th>Message</th><th>Waited</th><th>Status</th></tr></thead><tbody id="qList"></tbody></table></div>`;
  const reviewsCard=document.createElement("div");reviewsCard.className="card glass gx";reviewsCard.id="reviewsCard";
  reviewsCard.innerHTML=`<div class="ch"><h2>Customer reviews</h2><small class="plabel" id="rvPeriod">last 30 days</small></div>
    <p class="sub" style="margin:0 0 10px">When a chat ends (a booking, or thanks / bye) the customer is asked to rate it from 1 to 5. Low ratings ask what to improve and alert you.</p>
    <div class="kp-row" id="rvKpis"></div><div id="rvDist" class="rv-dist"></div><div class="tw"><table><thead><tr><th>When</th><th>Customer</th><th>Channel</th><th>Rating</th><th>Result</th><th>Comment</th></tr></thead><tbody id="rvList"></tbody></table></div>`;
  const money=document.createElement("div");money.className="card glass gx money";money.innerHTML=`<div class="ch"><h2>Money</h2><small class="plabel">last 30 days</small></div><div class="mny" id="mnyBox"></div>`;
  [ai,upCard,activeCard,feedCard,gaugeCard,weekCard,todayCard,donutCard,flowCard,heatCard,needsCard,convCard].forEach(c=>c.classList.remove("gc3","gc4","gc5","gc7","gc8"));
  urgent.classList.add("a-urgent");money.classList.add("a-money");upCard.classList.add("a-up");ai.classList.add("a-ai");
  window.showPane=pageTabs("overview",[
    ["summary","Summary",()=>[grid("sumgrid",urgent,money,upCard,ai)]],
    ["live","Live now",()=>[grid("fit2 r-big",activeCard,feedCard),grid("fit3",gaugeCard,weekCard,todayCard)]],
    ["trends","Trends",()=>[kpis,microGrid,r2]],
    ["channels","Channels",()=>[grid("fit3 r-full",donutCard,flowCard,heatCard)]],
    ["services","Services",()=>[r3]],
    ["conversations","Conversations",()=>[grid("fit-side",needsCard,convCard)]],
    ["approvals","Approvals",()=>[appr]],
    ["queue","Queue",()=>[queueCard]],
    ["reviews","Reviews",()=>[reviewsCard]],
  ],{after:cmd});
  desk.remove();
  // the setup checklist now lives at the top of Setup
  $("#setup").querySelector(".top").after(setupCard);
})();
// Summary cards fed by the live data
function renderSummary(d){const n=d.now,items=[];
  if(n.waiting)items.push(["bad",`${n.waiting} conversation${n.waiting>1?"s":""} waiting for you`,"The AI handed them to you. Reply so the client isn't left waiting.","conversations"]);
  if(n.approvals)items.push(["warn",`${n.approvals} request${n.approvals>1?"s":""} to approve`,"Late cancellations, time changes or special requests.","approvals"]);
  const failed=d.h24.reduce((a,h)=>a+h.failed,0);if(failed)items.push(["bad",`${failed} AI repl${failed>1?"ies":"y"} failed in 24 hours`,"Clients got a fallback message. Check the AI connection.","training"]);
  if(n.unsure)items.push(["warn",`The AI wasn't sure ${n.unsure} time${n.unsure>1?"s":""}`,"Check those replies and teach the right answer.","training"]);
  if(n.to_learn)items.push(["warn",`${n.to_learn} question${n.to_learn>1?"s":""} the AI couldn't answer`,"Answer once and the AI learns it.","training"]);
  const todo=d.setup.filter(s=>!s.done).length;if(todo)items.push(["info",`${todo} setup step${todo>1?"s":""} left`,"Finish setup so the receptionist runs on its own.","setup"]);
  if(n.active_now)items.push(["live",`${n.active_now} live conversation${n.active_now>1?"s":""} right now`,"The AI is handling them. Watch them on Live now.","live"]);
  const urgentN=items.filter(i=>i[0]==="bad"||i[0]==="warn").length;$("#urgN").textContent=urgentN?`${urgentN} to handle`:"all clear";
  $("#urgList").innerHTML=items.length?items.map(([lv,t,s,go])=>`<button type="button" class="urow u-${lv}" data-to="${go}"><i></i><span><b>${t}</b><small>${s}</small></span><em>Open</em></button>`).join("")
    :`<div class="allclear"><b>All clear</b><span>Nothing needs you right now. The AI is handling everything.</span></div>`;
  const pct=n.earned_prev?Math.round((n.earned-n.earned_prev)/n.earned_prev*100):null,booked=d.d14.slice(Math.floor(d.d14.length/2)).reduce((a,x)=>a+x.v,0);
  $("#mnyBox").innerHTML=`<div class="mbig"><span>Earned</span><b>${fmt(n.earned)}</b>${pct===null?"":`<em class="${pct>=0?"up":"down"}">${pct>=0?"↑":"↓"} ${Math.abs(pct)}% vs previous period</em>`}<small>appointments that took place</small></div>
    <div class="mrow"><div><span>Booked</span><b>${fmt(booked)}</b><small>this period</small></div><div><span>Coming up</span><b>${fmt(n.upcoming_value)}</b><small>${n.upcoming_count} bookings</small></div><div><span>Today</span><b>${fmt(n.value_today)}</b><small>${n.booked_today} bookings</small></div></div>`;
  tabBadge("overview","conversations",n.waiting);tabBadge("overview","approvals",n.approvals)}
document.addEventListener("click",e=>{const b=e.target.closest("[data-to]");if(!b)return;const to=b.dataset.to;
  if(["conversations","approvals","live","trends","channels","services","summary"].includes(to)){showPane(to);return}
  document.querySelector(`nav button[data-view="${to}"]:not([data-sub])`)?.click()});

// Clients, Insights, Setup, Command center, Account security: tabs instead of long pages
(function buildPages(){
  const kids=(id)=>[...$("#"+id).children];
  // Clients
  const ppl=kids("people"),pplTable=$("#pplRows").closest(".card");
  pageTabs("people",[["clients","Clients",()=>[$("#pplKpis"),pplTable]],["offers","Offers",()=>[$("#mkCard")]]]);
  // Insights: one theme per tab
  const an=$("#analytics"),row=t=>[...an.querySelectorAll(":scope > .row, :scope > .card")].find(x=>x.querySelector("h2")?.textContent.includes(t));
  pageTabs("analytics",[
    ["overview","Overview",()=>[$("#inKpis"),row("Revenue and bookings over time")]],
    ["timing","Timing",()=>[row("When you're busy"),row("How far ahead they book")]],
    ["services","Services",()=>[row("Services")]],
    ["ai","AI performance",()=>[row("AI receptionist performance")]],
    ["questions","Questions",()=>[row("What customers ask about")]],
    ["clients","Clients",()=>[row("Top customers")]],
    ["next","What to do next",()=>[row("What to do next")]],
  ]);
  // Setup
  const sc=$("#security"),scards=[...sc.querySelectorAll(":scope > .card")];
  const cuCard=(id,t,s)=>{const c=document.createElement("div");c.className="card glass";c.id=id;c.innerHTML=`<div class="ch"><h2>${t}</h2><small>${s}</small></div><div class="cu-body"></div>`;return c};
  const st=$("#setup"),card=t=>[...st.querySelectorAll(":scope > .card")].find(x=>x.querySelector("h2")?.textContent.trim().startsWith(t)),form=$("#setupForm").closest(".card");
  pageTabs("setup",[
    ["start","Getting started",()=>[$("#ldSetup"),card("Business type")]],
    ["details","Business details",()=>[form]],
    ["tools","Tools and payments",()=>[$("#toolsCard")]],
    ["reminders","Reminders",()=>[card("Reminders")]],
    ["channels","Channels",()=>[card("Channels")]],
    ["booking","Booking page",()=>[$("#blCard")]],
    ["codes","Discount codes",()=>[card("Discount codes"),card("Test data")]],
    ["s2fa","Two-factor sign-in",()=>[scards[0]]],
    ["spw","Password",()=>[scards[1]]],
    ["sdev","Devices and activity",()=>[grid("fit2",scards[3],scards[2])]],
    ["look","Look and feel",()=>[cuCard("cuLook","Look and feel","applies on this device")]],
    ["dash","Dashboard",()=>[cuCard("cuDash","Dashboard","start page, layouts and details")]],
  ]);
  // Settings: three groups (Setup, Security, Customize), each with its own tabs
  const SG={setup:["start","details","tools","reminders","channels","booking","codes"],security:["s2fa","spw","sdev"],customize:["look","dash"]};window.SETTINGS_GROUPS=SG;
  const sbar=st.querySelector(".ptabs"),gbar=document.createElement("div");gbar.className="sgroups";gbar.setAttribute("role","tablist");
  gbar.innerHTML=[["setup","Setup","Business, AI, bookings"],["security","Security","Login, two-factor, devices"],["customize","Customize","Look, layout, start page"]].map(([k,l,s])=>`<button type="button" data-g="${k}"><b>${l}</b><small>${s}</small></button>`).join("");
  sbar.before(gbar);
  const syncG=k=>{const g=Object.keys(SG).find(x=>SG[x].includes(k))||"setup";gbar.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.g===g));
    sbar.querySelectorAll("button[data-tab]").forEach(b=>b.hidden=!SG[g].includes(b.dataset.tab));st.querySelector(".top h1").innerHTML=g==="security"?"Account <b>security</b>":g==="customize"?"Make it <b>yours</b>":"Business <b>setup</b>";
    st.querySelector(".top .sub").textContent=g==="security"?"Your login, two-factor protection and recent activity.":g==="customize"?"Choose how the dashboard looks and what it shows first.":"The assistant and the booking page only know what you write here.";
    if(g==="security")try{me&&loadSecurity()}catch{}};
  gbar.addEventListener("click",e=>{const b=e.target.closest("button[data-g]");if(b)tabsOf.setup(SG[b.dataset.g][0])});
  addEventListener("tabshown",e=>{if(e.detail.view==="setup")syncG(e.detail.tab)});syncG(localStorage.getItem("rb-tab-setup")||"start");
  form.classList.add("wideform");
  // Command center: the new-business form gets its own tab
  const nb=$("#nbForm").closest(".card"),cc=document.createElement("div");cc.id="ccNew";cc.hidden=true;cc.append(nb);$("#ccBiz").after(cc);
  const ccTabs=$("#ccTabs");ccTabs.insertAdjacentHTML("beforeend",`<button aria-pressed="false" data-c="new">New business</button>`);
})();
// Sidebar entries that open a page on a given tab
document.querySelectorAll("nav button[data-sub]").forEach(b=>b.addEventListener("click",()=>setTimeout(()=>tabsOf[b.dataset.view]?.(b.dataset.sub),0)));
document.querySelectorAll("nav button[data-view]:not([data-sub])").forEach(b=>b.addEventListener("click",()=>setTimeout(()=>{const v=b.dataset.view,t=localStorage.getItem("rb-tab-"+v);if(tabsOf[v])tabsOf[v](t||undefined)},0)));

function liveLoop(){clearInterval(liveTimer);loadLive();liveTimer=setInterval(()=>{if(!document.hidden&&!$("#overview").hidden)loadLive()},5000)}
liveLoop();
document.querySelector('nav button[data-view="overview"]').addEventListener("click",loadLive);
// Quick actions and setup steps jump to the right place
document.addEventListener("click",e=>{const b=e.target.closest("[data-go]");if(!b)return;const v=b.dataset.go;
  if(v==="approvals"){showPane("approvals");return}
  if(v==="bell"){$("#bellBtn").click();setTimeout(()=>$("#bellCfg").click(),150);return}
  if(v==="newbooking"){document.querySelector('nav button[data-view="calendar"]').click();setTimeout(()=>$("#calNew").click(),350);return}
  document.querySelector(`nav button[data-view="${v}"]`)?.click()});
// Command bar: Ctrl/Cmd+K, search clients and conversations
let cmdT;
// Ctrl K: see the command palette in ui.js
$("#cmdQ").addEventListener("input",()=>{clearTimeout(cmdT);cmdT=setTimeout(async()=>{const q=$("#cmdQ").value.trim(),box=$("#cmdRes");if(q.length<2){box.hidden=true;return}
  const [cs,cv]=await Promise.all([req(`/api/customers?q=${encodeURIComponent(q)}&test=1`).catch(()=>[]),req("/api/conversations").catch(()=>[])]);
  const ql=q.toLowerCase(),convs=(Array.isArray(cv)?cv:[]).filter(c=>`${c.name||""} ${c.phone||""} ${c.last||""}`.toLowerCase().includes(ql)).slice(0,5);
  box.innerHTML=(cs.slice(0,5).map(c=>`<button type="button" data-cust="${c.id}"><b>${esc(c.name||"No name")}</b><small>Client · ${esc(c.phone||c.email||"")} · ${c.visits} visits</small></button>`).join("")
    +convs.map(c=>`<button type="button" data-open="${c.id}"><b>${esc(c.name||"Customer")}</b><small>Conversation · ${esc(c.last||"")}</small></button>`).join(""))||`<p class="sub" style="margin:8px 10px">Nothing found for “${esc(q)}”.</p>`;box.hidden=false},200)});
document.addEventListener("click",e=>{if(!e.target.closest(".cmd"))$("#cmdRes").hidden=true});
$("#cmdQ").addEventListener("keydown",e=>{if(e.key==="Escape"){$("#cmdRes").hidden=true;$("#cmdQ").blur()}});
// HUD: concentric rings turn constantly; a live waveform in the middle; it flares when something new happens.
(function hud(){const el=$("#hud"),w=$("#hudWave");if(!el||!w)return;const N=36;let t=0,boost=0;
  w.innerHTML=[...Array(N)].map((_,i)=>{const a=i/N*Math.PI*2;return `<line x1="${100+28*Math.cos(a)}" y1="${100+28*Math.sin(a)}" x2="${100+30*Math.cos(a)}" y2="${100+30*Math.sin(a)}"/>`}).join("");
  const lines=[...w.children],still=matchMedia("(prefers-reduced-motion: reduce)").matches;
  lines.forEach((l,i)=>{const a=i/N*Math.PI*2,amp=4+4*Math.abs(Math.sin(i*.55));l.setAttribute("x2",100+(30+amp)*Math.cos(a));l.setAttribute("y2",100+(30+amp)*Math.sin(a))})})();

