// "Today": the owner's home page. How the business is doing today, what needs doing, the team, health and alerts.
// It has its own softer bento look on purpose, so it never feels like the data tabs.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const homeBtn=document.querySelector('nav button[data-view="overview"]:not([data-sub])');if(!homeBtn)return;
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
let biz=null,live=null,notes=[],ch=null,nFilter="all",timer=null;

const sec=document.createElement("section");sec.className="wrap today";sec.id="today";sec.hidden=true;
sec.innerHTML=`<div class="td-grid">
  <div class="td-card td-hero"><div class="td-hero-in"><div class="td-logo" id="tdLogo" role="button" tabindex="0" data-go="team" title="Change your logo in Settings"></div><div style="min-width:0"><p class="td-eyebrow" id="tdDate"></p><h1 id="tdHello">Good morning</h1><p class="td-sub" id="tdSub"></p></div></div>
    <div class="td-hero-acts"><button class="td-btn" type="button" data-go="newbooking">+ New booking</button><button class="td-btn ghost" type="button" data-go="dash">Full dashboard</button></div><span class="td-blob" aria-hidden="true"></span></div>
  <div class="td-card td-cal"><div class="td-h"><h2 id="tdMonth"></h2><button class="td-link" type="button" data-go="calendar">Calendar →</button></div><div class="td-days" id="tdDays"></div></div>
  <div class="td-stats" id="tdStats"></div>
  <div class="td-card td-notes"><div class="td-h"><h2>Notifications</h2><span class="td-pill" id="tdUnread"></span></div>
    <div class="td-tabs" id="tdNTabs"><button type="button" data-f="all" aria-pressed="true">Overview</button><button type="button" data-f="booking" aria-pressed="false">Bookings</button><button type="button" data-f="people" aria-pressed="false">Messages</button></div><div id="tdNotes"></div></div>
  <div class="td-card td-todo"><div class="td-h"><h2>To do</h2><span class="td-pill" id="tdTodoN"></span></div><div id="tdTodo"></div></div>
  <div class="td-card td-team"><div class="td-h"><h2>Your team</h2><button class="td-link" type="button" data-go="team">Edit</button></div><div id="tdTeam"></div></div>
  <div class="td-card td-next"><div class="td-h"><h2>Next up</h2><span class="td-pill" id="tdNextN"></span></div><div id="tdNext"></div></div>
  <div class="td-card td-health"><div class="td-h"><h2>Health</h2><span class="td-pill" id="tdHealthState"></span></div><div id="tdHealth"></div></div>
</div>`;
document.querySelector("main").append(sec);
document.head.insertAdjacentHTML("beforeend",`<style>
.today{--td-bg:#f3f1f8;--td-card:#ffffff;--td-ink:#17151f;--td-ink2:#5f5a6e;--td-mute:#9a94a8;--td-line:rgba(23,21,31,.07);--td-soft:#f1eef8;--td-acc:var(--accent);--td-a1:#cdbdf5;--td-a2:#f6c9dc;--td-a3:#c8e6f7;--td-r:22px}
:root[data-theme="dark"] .today,:root:not([data-theme]) .today{--td-card:#17161d;--td-ink:#f4f2f8;--td-ink2:#b7b2c4;--td-mute:#7f7a8c;--td-line:rgba(255,255,255,.07);--td-soft:#211f29;--td-a1:#4b3d78;--td-a2:#6b3550;--td-a3:#25465a}
main>section.today:not([hidden]){overflow:auto}
.td-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:minmax(0,auto);gap:14px;color:var(--td-ink);padding-bottom:10px}
.td-card{background:var(--td-card);border-radius:var(--td-r);padding:18px;border:1px solid var(--td-line);box-shadow:0 1px 2px rgba(0,0,0,.03),0 16px 36px -26px rgba(40,20,80,.35);min-width:0;position:relative;overflow:hidden}
.td-h{display:flex;align-items:center;gap:8px;margin-bottom:12px}.td-h h2{margin:0;font-size:15px;font-weight:650;letter-spacing:-.01em;color:var(--td-ink)}
.td-link{all:unset;cursor:pointer;margin-inline-start:auto;font-size:12.5px;color:var(--td-ink2)}.td-link:hover{color:var(--td-ink)}
.td-pill:empty{display:none}.td-pill{margin-inline-start:auto;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:99px;background:var(--td-soft);color:var(--td-ink2)}
.td-hero{grid-column:span 8;background:linear-gradient(120deg,var(--td-a1),var(--td-a2) 70%,var(--td-a3));border:0;padding:24px;display:flex;flex-direction:column;justify-content:space-between;gap:18px;min-height:190px}
.td-hero-in{display:flex;gap:16px;align-items:center;position:relative;z-index:1}
.td-logo{width:72px;height:72px;flex:none;border-radius:22px;background:#fff center/cover no-repeat;display:grid;place-items:center;font-weight:800;font-size:30px;line-height:1;color:#5b45a8;cursor:pointer;box-shadow:0 10px 24px -12px rgba(40,20,80,.5);border:3px solid rgba(255,255,255,.75)}
.td-eyebrow{margin:0;font-size:12.5px;font-weight:600;color:color-mix(in srgb,var(--td-ink) 70%,transparent)}
.td-hero h1{margin:2px 0 4px;font-size:28px!important;letter-spacing:-.025em;line-height:1.1;color:var(--td-ink)}
.td-sub{margin:0;font-size:13.5px;color:color-mix(in srgb,var(--td-ink) 75%,transparent)}
.td-hero-acts{display:flex;gap:8px;flex-wrap:wrap;position:relative;z-index:1}
.td-btn{all:unset;cursor:pointer;padding:9px 15px;border-radius:99px;background:#17151f;color:#fff;font-size:13px;font-weight:600}.td-btn.ghost{background:rgba(255,255,255,.6);color:#17151f}.td-btn:hover{filter:brightness(1.1)}
.td-blob{position:absolute;right:-60px;top:-70px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle at 35% 35%,rgba(255,255,255,.75),rgba(255,255,255,0) 62%);pointer-events:none}
.td-cal{grid-column:span 4}
.td-days{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.td-day{all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;padding:9px 0;border-radius:14px;font-size:11px;color:var(--td-mute)}
.td-day b{font-size:16px;color:var(--td-ink)}.td-day:hover{background:var(--td-soft)}
.td-day.now{background:#17151f;color:#cfc9dc}.td-day.now b{color:#fff}:root[data-theme="dark"] .td-day.now{background:#f4f2f8;color:#5f5a6e}:root[data-theme="dark"] .td-day.now b{color:#17151f}
.td-day i{width:22px;height:4px;border-radius:9px;background:var(--td-line);overflow:hidden;display:block}.td-day i u{display:block;height:100%;background:var(--td-acc)}
.td-day.off{opacity:.45}
.td-stats{grid-column:span 8;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.td-stat{background:var(--td-card);border:1px solid var(--td-line);border-radius:var(--td-r);padding:16px;display:flex;flex-direction:column;gap:4px;min-width:0}
.td-stat span{font-size:12px;color:var(--td-mute);font-weight:500}.td-stat b{font-size:28px;letter-spacing:-.03em;color:var(--td-ink);line-height:1.1}
.td-stat small{font-size:12px;color:var(--td-ink2)}.td-stat small.up{color:#16a34a}.td-stat small.down{color:#e11d48}
.td-stat:first-child{background:linear-gradient(160deg,var(--td-a1),var(--td-card) 75%)}
.td-notes{grid-column:span 4;grid-row:span 3;align-self:stretch}
.td-todo,.td-team{grid-column:span 4}.td-next,.td-health{grid-column:span 4}
.td-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--td-line)}.td-row:first-child{border-top:0;padding-top:2px}
.td-row .tx{min-width:0;flex:1;display:flex;flex-direction:column}.td-row .tx b{font-size:13px;font-weight:600;color:var(--td-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.td-row .tx small{font-size:11.5px;color:var(--td-mute)}
.td-ic{width:34px;height:34px;flex:none;border-radius:11px;display:grid;place-items:center;font-size:15px;background:var(--td-soft)}
.td-ic.red{background:color-mix(in srgb,#e11d48 14%,transparent)}.td-ic.amber{background:color-mix(in srgb,#f59e0b 16%,transparent)}.td-ic.blue{background:color-mix(in srgb,#3b82f6 14%,transparent)}.td-ic.green{background:color-mix(in srgb,#16a34a 14%,transparent)}
.td-go{all:unset;cursor:pointer;font-size:12px;font-weight:600;padding:5px 10px;border-radius:99px;background:var(--td-soft);color:var(--td-ink)}.td-go:hover{background:var(--td-line)}
.td-av{width:38px;height:38px;flex:none;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:14px;color:#fff}
.td-team .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:10px}
.td-mem{display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center;padding:10px 4px;border-radius:16px;background:var(--td-soft)}.td-mem .td-av{width:46px;height:46px;font-size:16px}
.td-mem b{font-size:12.5px;color:var(--td-ink)}.td-mem small{font-size:11px;color:var(--td-mute);line-height:1.25}
.td-time{width:52px;flex:none;display:flex;flex-direction:column;align-items:center;padding:6px 0;border-radius:12px;background:var(--td-soft)}.td-time b{font-size:13.5px;color:var(--td-ink)}.td-time small{font-size:10.5px;color:var(--td-mute)}
.td-price{font-weight:650;font-size:13px;color:var(--td-ink)}
.td-dot{width:9px;height:9px;border-radius:50%;flex:none;background:#16a34a;box-shadow:0 0 0 4px color-mix(in srgb,#16a34a 18%,transparent)}.td-dot.bad{background:#e11d48;box-shadow:0 0 0 4px color-mix(in srgb,#e11d48 18%,transparent)}.td-dot.warn{background:#f59e0b;box-shadow:0 0 0 4px color-mix(in srgb,#f59e0b 18%,transparent)}
.td-tabs{display:flex;gap:14px;border-bottom:1px solid var(--td-line);margin-bottom:6px}.td-tabs button{all:unset;cursor:pointer;font-size:12.5px;padding:0 0 8px;color:var(--td-mute)}.td-tabs button[aria-pressed=true]{color:var(--td-ink);font-weight:600;box-shadow:inset 0 -2px 0 var(--td-ink)}
.td-note{display:flex;gap:10px;padding:10px;border-radius:14px;margin-top:6px;background:var(--td-soft);cursor:pointer}.td-note:hover{filter:brightness(.98)}
.td-note .tx b{white-space:normal}.td-note.unread .tx b::after{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--td-acc);margin-inline-start:6px;vertical-align:middle}
.td-empty{font-size:12.5px;color:var(--td-mute);padding:8px 0}
@media (max-width:1200px){.td-hero,.td-stats{grid-column:span 12}.td-cal,.td-todo,.td-team,.td-next,.td-health{grid-column:span 6}.td-notes{grid-column:span 12;grid-row:auto}}
@media (max-width:760px){.td-cal,.td-todo,.td-team,.td-next,.td-health{grid-column:span 12}.td-stats{grid-template-columns:1fr 1fr}.td-hero h1{font-size:23px!important}.td-logo{width:58px;height:58px;border-radius:18px}}
</style>`);

// Home opens Today; the data dashboard stays on Live now and the other tabs
homeBtn.addEventListener("click",e=>{e.stopImmediatePropagation();show()},true);
$$("nav button[data-view]").forEach(b=>{if(b!==homeBtn)b.addEventListener("click",()=>{sec.hidden=true;clearInterval(timer)})});
function show(){if(window.LAB)return;$$("nav button[data-view]").forEach(x=>x.setAttribute("aria-current",x===homeBtn));$$("main > section.wrap").forEach(s=>s.hidden=s!==sec);
  document.body.dataset.page="today";scrollTo(0,0);load();clearInterval(timer);timer=setInterval(()=>{if(!document.hidden&&!sec.hidden)load()},30000)}
window.homeLoad=()=>{if(!sec.hidden)load()}; // live.js calls this the moment data changes

const money=v=>{try{return fmt(v)}catch{return "$"+Math.round(v||0)}};
const colorOf=s=>{let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))%360;return `hsl(${h} 55% 55%)`};
const hm=s=>String(s||"").slice(11,16);
async function load(){
  const [b,l,n,c]=await Promise.all([req("/api/business").catch(()=>null),req("/api/live?days=7").catch(()=>null),req("/api/notifications").catch(()=>({items:[],unread:0})),req("/api/channels").catch(()=>null)]);
  biz=b;live=l;notes=n.items||[];ch=c;draw(n.unread||0)}
function openNow(){const d=new Date(),m=d.getHours()*60+d.getMinutes(),r=(biz?.hours?.[d.getDay()]||[]).map(([a,z])=>[a,z].map(t=>{const[h,mm]=t.split(":");return +h*60+ +mm}));
  const cur=r.find(([a,z])=>m>=a&&m<z);if(cur)return `Open now · until ${String(Math.floor(cur[1]/60)).padStart(2,"0")}:${String(cur[1]%60).padStart(2,"0")}`;
  const next=r.find(([a])=>a>m);return next?`Opens today at ${String(Math.floor(next[0]/60)).padStart(2,"0")}:${String(next[0]%60).padStart(2,"0")}`:"Closed today"}
function draw(unread){if(!biz||!live)return;const now=live.now,d=new Date(),h=d.getHours();
  // hero
  $("#tdLogo").style.backgroundImage=biz.logo_url?`url("${biz.logo_url}")`:"";$("#tdLogo").textContent=biz.logo_url?"":([...biz.name][0]||"").toUpperCase();
  $("#tdDate").textContent=`${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} · ${openNow()}`;
  $("#tdHello").textContent=`${h<12?"Good morning":h<18?"Good afternoon":"Good evening"}, ${biz.name}`;
  const tasks=(now.waiting||0)+(now.approvals||0)+(now.unsure||0);
  $("#tdSub").textContent=`${now.visits_today||0} appointment${now.visits_today===1?"":"s"} today${tasks?` · ${tasks} thing${tasks===1?"":"s"} need${tasks===1?"s":""} you`:" · nothing waiting for you"}.`;
  // week strip
  const mon=new Date(live.week[0].d+"T12:00");$("#tdMonth").textContent=`${MON[mon.getMonth()]}, ${mon.getFullYear()}`;
  $("#tdDays").innerHTML=live.week.map(w=>{const x=new Date(w.d+"T12:00");return `<button type="button" class="td-day${w.today?" now":""}${w.pct===null?" off":""}" data-go="calendar" title="${w.pct===null?"Closed":w.pct+"% booked"}">${DOW[x.getDay()]}<b>${x.getDate()}</b><i><u style="width:${w.pct||0}%"></u></i></button>`}).join("");
  // numbers
  const d14=live.d14||[],half=Math.floor(d14.length/2),wk=d14.slice(half).reduce((a,x)=>a+x.v,0),pw=d14.slice(0,half).reduce((a,x)=>a+x.v,0),pc=pw?Math.round((wk-pw)/pw*100):null;
  $("#tdStats").innerHTML=[["Appointments today",now.visits_today||0,`${now.booked_today||0} new booking${now.booked_today===1?"":"s"} today`],
    ["Revenue today",money(now.revenue_today||0),"from today's appointments"],
    ["Booked this week",money(wk),pc===null?"vs last week: —":`<span class="${pc>=0?"up":"down"}">${pc>=0?"↑":"↓"} ${Math.abs(pc)}%</span> vs last week`],
    ["AI replies today",now.replies_today||0,`${now.msgs_today||0} messages${now.avg_ms?` · ${(now.avg_ms/1000).toFixed(1)}s avg`:""}`]]
    .map(([l,v,s])=>`<div class="td-stat"><span>${l}</span><b>${v}</b><small>${s}</small></div>`).join("");
  // to do
  const todo=[];
  if(now.waiting)todo.push(["red","💬",`${now.waiting} chat${now.waiting>1?"s":""} waiting for you`,"The AI handed them over","conversations"]);
  if(now.approvals)todo.push(["amber","✓",`${now.approvals} request${now.approvals>1?"s":""} to approve`,"Changes, cancellations, special requests","approvals"]);
  if(now.unsure)todo.push(["amber","?",`Check ${now.unsure} unsure repl${now.unsure>1?"ies":"y"}`,"Teach the right answer","training"]);
  const failed=(live.h24||[]).reduce((a,x)=>a+(x.failed||0),0);if(failed)todo.push(["red","!",`${failed} AI repl${failed>1?"ies":"y"} failed today`,"Clients got a fallback message","health"]);
  const left=(live.setup||[]).filter(s=>!s.done);if(left.length)todo.push(["blue","⚙",`${left.length} setup step${left.length>1?"s":""} left`,left[0].label,"setup"]);
  $("#tdTodoN").textContent=todo.length?`${todo.length} open`:"All done";
  $("#tdTodo").innerHTML=todo.length?todo.map(([c,i,t,s,go])=>`<div class="td-row"><span class="td-ic ${c}">${i}</span><span class="tx"><b>${esc(t)}</b><small>${esc(s)}</small></span><button class="td-go" type="button" data-go="${go}">Open</button></div>`).join(""):`<div class="td-row"><span class="td-ic green">✓</span><span class="tx"><b>You're all caught up</b><small>Your assistant is handling everything.</small></span></div>`;
  // team
  const team=String(biz.team||"").split("\n").map(x=>x.trim()).filter(Boolean).map(x=>{const[n,...r]=x.split(/\s+[–—-]\s+/);return{n,r:r.join(" – ")}});
  const open=/^Open now/.test(openNow());
  $("#tdTeam").innerHTML=team.length?`<div class="grid">${team.map(m=>`<div class="td-mem"><span class="td-av" style="background:${colorOf(m.n)}">${esc([...m.n][0]||"")}</span><b>${esc(m.n)}</b><small>${esc(m.r||"Team")}</small><small style="color:${open?"#16a34a":"var(--td-mute)"}">${open?"● On shift":"○ Off now"}</small></div>`).join("")}</div>`
    :`<div class="td-empty">Add your team in Settings → Business details, one per line, like "Layla – colour specialist".</div>`;
  // next up
  const up=(live.upcoming||[]).slice(0,4);$("#tdNextN").textContent=now.upcoming_count?`${now.upcoming_count} ahead · ${money(now.upcoming_value||0)}`:"";
  $("#tdNext").innerHTML=up.length?up.map(u=>{const x=new Date(u.start.replace(" ","T"));return `<div class="td-row"><span class="td-time"><b>${hm(u.start)}</b><small>${DOW[x.getDay()]} ${x.getDate()}</small></span><span class="tx"><b>${esc(u.name||"Customer")}</b><small>${esc(u.service)} · ${u.minutes} min</small></span><span class="td-price">${money(u.price)}</span></div>`}).join("")
    :`<div class="td-empty">Nothing booked ahead yet.</div>`;
  // health
  const ai=live.ai||{},wa=ch?.whatsapp?.configured&&biz.wa_phone_number_id,tg=ch?.telegram?.configured,checks=[
    [ai.ok===false?"bad":"","AI assistant",ai.ok===false?"Not answering: customers get a fallback message":ai.ok?`Answering · last reply ${(ai.ms/1000).toFixed(1)}s`:"Ready · no messages yet"],
    [wa?"":"warn","WhatsApp",wa?"Connected":"Not connected for this business"],
    [tg?"":"warn","Telegram",tg?(ch.telegram.running?"Connected and running":"Connected"):"Not connected"],
    [failed?"bad":"","Replies in the last 24 h",failed?`${failed} failed`:"No failures"]];
  const bad=checks.filter(c=>c[0]==="bad").length,warn=checks.filter(c=>c[0]==="warn").length;
  $("#tdHealthState").textContent=bad?"Needs attention":warn?"Mostly good":"All good";
  $("#tdHealth").innerHTML=checks.map(([s,t,d])=>`<div class="td-row"><span class="td-dot ${s}"></span><span class="tx"><b>${t}</b><small>${esc(d)}</small></span></div>`).join("")+`<div class="td-row"><span class="tx"><small>Setup ${(live.setup||[]).filter(s=>s.done).length} of ${(live.setup||[]).length} done</small></span><button class="td-go" type="button" data-go="setup">Settings</button></div>`;
  // notifications
  $("#tdUnread").textContent=unread?`${unread} new`:"";drawNotes()}
const ICON={booking:["green","📅"],cancel:["red","✕"],approval:["amber","✓"],handoff:["red","💬"],unsure:["amber","?"],review:["blue","★"],marketing:["blue","📣"]};
function drawNotes(){const list=notes.filter(n=>nFilter==="all"||(nFilter==="booking"?["booking","cancel","approval"].includes(n.kind):["handoff","unsure","review"].includes(n.kind))).slice(0,7);
  $("#tdNotes").innerHTML=list.length?list.map(n=>{const[c,i]=ICON[n.kind]||["blue","•"];return `<div class="td-note${n.read?"":" unread"}" data-c="${n.conversation_id||""}"><span class="td-ic ${c}">${i}</span><span class="tx"><b>${esc(n.title)}</b><small>${esc((n.body||"").split("\n")[0]).slice(0,90)}${n.body?" · ":""}${esc(String(n.at||"").slice(5,16).replace("T"," "))}</small></span></div>`}).join("")
    :`<div class="td-empty">No notifications here yet.</div>`}
$("#tdNTabs").addEventListener("click",e=>{const b=e.target.closest("[data-f]");if(!b)return;nFilter=b.dataset.f;$$("#tdNTabs button").forEach(x=>x.setAttribute("aria-pressed",x===b));drawNotes()});
$("#tdNotes").addEventListener("click",e=>{const n=e.target.closest(".td-note");if(!n)return;go(n.dataset.c?"conversations":"dash");if(n.dataset.c)setTimeout(()=>{try{openConv(+n.dataset.c)}catch{}},300)});

// every button on this page goes to the right place
function go(where){const nav=v=>document.querySelector(`nav button[data-view="${v}"]:not([data-sub])`);
  const pane=(v,p)=>{const b=document.querySelector(`nav button[data-view="${v}"][data-sub="${p}"]`);if(b)b.click();else{nav(v)?.click();setTimeout(()=>window.tabsOf?.[v]?.(p),30)}};
  if(where==="newbooking"){nav("calendar")?.click();setTimeout(()=>$("#calNew")?.click(),350)}
  else if(where==="dash"){window.openDashboard?window.openDashboard():pane("overview","summary")}
  else if(where==="conversations"||where==="approvals"||where==="health")pane("overview",where==="health"?"live":where);
  else if(where==="team"){nav("setup")?.click();setTimeout(()=>window.tabsOf?.setup?.("details"),30)}
  else nav(where)?.click()}
sec.addEventListener("click",e=>{const b=e.target.closest("[data-go]");if(b){e.stopPropagation();go(b.dataset.go)}});

// open Today on start (unless another page was asked for), once the login is known
const start=setInterval(()=>{if(window.LAB){clearInterval(start);return}if(typeof me!=="undefined"&&me&&me.business){clearInterval(start);if(!$("#overview").hidden||document.body.dataset.page==="overview"||!document.body.dataset.page)show()}},150);
setTimeout(()=>clearInterval(start),10000);
})();
