// "Today": the owner's home page. How the business is doing today, what needs doing, the team, health and alerts.
// It has its own softer bento look on purpose, so it never feels like the data tabs.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const homeBtn=document.querySelector('nav button[data-view="overview"]:not([data-sub])');if(!homeBtn)return;
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
let biz=null,live=null,notes=[],ch=null,nFilter="all",timer=null;

const sec=document.createElement("section");sec.className="wrap today";sec.id="today";sec.hidden=true;
// One page, read top to bottom: who and when, what MXAi did for you, what needs you and what is coming up,
// then the quiet checks (health, notifications, team). Every block is visible; nothing hides behind a list.
sec.innerHTML=`<div class="tdx">
 <header class="tdx-head">
  <div class="tdx-id"><div class="td-logo" id="tdLogo" role="button" tabindex="0" data-go="team" title="Change your logo in Settings"></div>
   <div style="min-width:0"><p class="td-eyebrow" id="tdDate"></p><h1 id="tdHello"></h1><p class="tdx-sub" id="tdSub"></p></div></div>
  <div class="tdx-acts"><button class="tdx-btn pri" type="button" data-go="newbooking">+ New booking</button><button class="tdx-btn" type="button" data-go="ask">Ask MXAi</button></div>
 </header>
 <section class="tdx-value" aria-label="What MXAi did for you in the last 30 days">
  <div class="tdx-lead"><span>MXAi booked for you · last 30 days</span><b id="tdVal">–</b><small id="tdValL"></small></div>
  <div class="tdx-figs" id="tdFigs"></div>
 </section>
 <div class="td-card tdx-start" id="tdStart" hidden><div class="td-h"><h2>Go live</h2><span class="td-pill" id="tdStartN"></span></div>
  <p class="tdx-say">Your receptionist is ready. Finish these steps so customers can reach it.</p><i class="tdx-bar"><u id="tdBar"></u></i><div class="tdx-steps" id="tdSteps"></div></div>
 <div class="tdx-main">
  <div class="td-card tdx-needs"><div class="td-h"><h2>Needs you</h2><span class="td-pill" id="tdTodoN"></span></div><div id="tdTodo"></div><div id="tdBrief"></div></div>
  <div class="td-card tdx-day"><div class="td-h"><h2>Coming up</h2><span class="td-pill" id="tdNextN"></span><button class="td-link" type="button" data-go="calendar">Calendar →</button></div>
   <div class="td-days" id="tdDays"></div><div id="tdNext"></div></div>
 </div>
 <div class="tdx-foot">
  <div class="td-card"><div class="td-h"><h2>Health</h2><span class="td-pill" id="tdHealthState"></span></div><div id="tdHealth"></div></div>
  <div class="td-card"><div class="td-h"><h2>Notifications</h2><span class="td-pill" id="tdUnread"></span></div>
   <div class="td-tabs" id="tdNTabs"><button type="button" data-f="all" aria-pressed="true">All</button><button type="button" data-f="booking" aria-pressed="false">Bookings</button><button type="button" data-f="people" aria-pressed="false">Messages</button></div><div id="tdNotes"></div><button class="td-link tdx-all" type="button" data-go="bell">All notifications →</button></div>
  <div class="td-card"><div class="td-h"><h2>Your team</h2><button class="td-link" type="button" data-go="team">Edit</button></div><div id="tdTeam"></div></div>
 </div>
 <div id="tdScSlot"></div>
</div>`;
document.querySelector("main").append(sec);
document.head.insertAdjacentHTML("beforeend",`<style>
.today{--td-card:var(--gp-card,#fff);--td-ink:var(--gp-text,#151a17);--td-ink2:var(--gp-2,#56605a);--td-mute:var(--gp-meta,#8a948e);--td-line:var(--gl-grid,rgba(0,0,0,.08));--td-soft:var(--gp-nest,rgba(0,0,0,.04));--td-acc:var(--p-green,#1f8f55);--td-need:var(--need,#c45f2a);--td-r:20px;--td-lime:#c6f432}
main>section.today:not([hidden]){overflow:auto}
.tdx{display:flex;flex-direction:column;gap:16px;color:var(--td-ink);max-width:1240px;padding-bottom:16px}
.td-card{background:var(--td-card);border-radius:var(--td-r);padding:18px 20px;border:1px solid var(--td-line);min-width:0;position:relative}
.td-h{display:flex;align-items:center;gap:8px;margin-bottom:12px}.td-h h2{margin:0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--td-mute)}
.td-link{all:unset;cursor:pointer;margin-inline-start:auto;font-size:12.5px;color:var(--td-ink2)}.td-link:hover{color:var(--td-ink)}.td-pill+.td-link{margin-inline-start:8px}
.td-pill:empty{display:none}.td-pill{white-space:nowrap;margin-inline-start:auto;font-size:11.5px;font-weight:500;padding:3px 9px;border-radius:99px;background:var(--td-soft);color:var(--td-ink2)}
.td-logo{width:56px;height:56px;flex:none;border-radius:16px;background:#fff center/cover no-repeat;display:grid;place-items:center;font-weight:700;font-size:24px;line-height:1;color:#1f2a24;cursor:pointer;border:1px solid var(--td-line)}
.td-eyebrow{margin:0;font-size:12.5px;color:var(--td-mute)}
/* header */
.tdx-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:6px 2px 0}
.tdx-id{display:flex;gap:16px;align-items:center;min-width:0}
.tdx-head h1{margin:2px 0 3px;font-size:26px!important;font-weight:500;letter-spacing:-.02em;line-height:1.15;color:var(--td-ink)}
.tdx-head h1 em{font-style:normal;color:var(--td-ink2)}
.tdx-sub{margin:0;font-size:14px;color:var(--td-ink2)}
.tdx-acts{display:flex;gap:8px;flex-wrap:wrap}
.tdx-btn{all:unset;box-sizing:border-box;cursor:pointer;min-height:40px;display:inline-flex;align-items:center;padding:0 16px;border-radius:99px;font-size:13.5px;font-weight:500;background:var(--td-soft);color:var(--td-ink);border:1px solid var(--td-line)}
.tdx-btn.pri{background:var(--gp-text,#141516);color:var(--gp-ground,#fff);border-color:transparent}.tdx-btn:hover{filter:brightness(1.1)}.tdx-btn:focus-visible{outline:2px solid var(--td-ink);outline-offset:2px}
/* the value band: the one strong surface on the page */
.tdx-value{display:grid;grid-template-columns:minmax(220px,1fr) minmax(0,2fr);gap:8px;align-items:stretch;background:linear-gradient(135deg,#25272a,#151617 70%);color:#eceeef;border-radius:var(--td-r);padding:24px 26px;border:1px solid rgba(255,255,255,.09);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.tdx-lead{display:flex;flex-direction:column;gap:6px;padding-right:20px;border-right:1px solid rgba(255,255,255,.1)}
.tdx-lead span{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#9a9ea2}
.tdx-lead b{font-size:46px;font-weight:300;letter-spacing:-.03em;line-height:1;color:#fff}
.tdx-lead small{font-size:13px;color:#b9bcbf}
.tdx-figs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.tdx-fig{display:flex;flex-direction:column;gap:6px;padding:2px 20px;border-left:1px solid rgba(255,255,255,.1);min-width:0}.tdx-fig:first-child{border-left:0}
.tdx-fig span{font-size:12px;color:#9a9ea2}.tdx-fig b{font-size:28px;font-weight:300;letter-spacing:-.02em;line-height:1.1;color:#fff}.tdx-fig small{font-size:12px;color:#b9bcbf}
.tdx-fig small i{font-style:normal;color:var(--td-lime)}
/* main: Needs you is wider; it is the reason to open this page */
.tdx-main{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:16px;align-items:start}
.tdx-foot{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start}
.tdx-say{margin:-4px 0 12px;font-size:14px;color:var(--td-ink2)}
.tdx-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.tdx-steps button{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:4px;padding:14px;border-radius:14px;border:1px solid var(--td-line)}.tdx-steps button:hover{background:var(--td-soft)}
.tdx-steps b{font-size:13.5px;font-weight:500;color:var(--td-ink)}.tdx-steps small{font-size:12px;color:var(--td-mute)}.tdx-bar{display:block;height:4px;border-radius:99px;background:var(--td-line);overflow:hidden;margin:0 0 14px}.tdx-bar u{display:block;height:100%;background:var(--td-ink);border-radius:99px;transition:width .4s}
/* the money-ranked briefing lives inside Needs you, without its own heading */
#tdBrief #bfCard{background:none!important;border:0!important;padding:0!important;margin:0!important;box-shadow:none!important;border-radius:0!important}
#tdBrief .bf-h h2,#tdBrief #bfSay,#tdBrief .bf-done{display:none!important}#tdBrief .bf-h:has(.bf-money:empty){display:none}
#tdBrief:not(:has(.bf-list>li:not(.bf-done)):has(.bf-money:empty)){display:none}
#tdBrief .bf-list:has(>li:not(.bf-done)){margin-top:4px;border-top:1px solid var(--td-line)}
/* week strip */
.td-days{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px}
.td-day{all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 0;border-radius:12px;font-size:11px;color:var(--td-mute)}
.td-day b{font-size:16px;font-weight:400;color:var(--td-ink)}.td-day:hover{background:var(--td-soft)}
.td-day.now{background:#141516;color:#b9bcbf}.td-day.now b{color:#fff}
.td-day i{width:24px;height:3px;border-radius:9px;background:var(--td-line);overflow:hidden;display:block}.td-day i u{display:block;height:100%;background:var(--td-ink2)}.td-day.now i u{background:var(--td-lime)}
.td-day.off{opacity:.45}
/* rows */
.td-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--td-line)}.td-row:first-child{border-top:0;padding-top:2px}
.td-row .tx{min-width:0;flex:1;display:flex;flex-direction:column}.td-row .tx b{font-size:13.5px;font-weight:500;color:var(--td-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.td-row .tx small{font-size:12px;color:var(--td-mute)}
.td-ic{width:8px;height:8px;flex:none;border-radius:50%;font-size:0;background:var(--td-mute)}
.td-ic.red{background:var(--bad,#e11d48)}.td-ic.amber{background:var(--td-need)}.td-ic.blue{background:var(--td-ink2)}.td-ic.green{background:var(--td-acc)}
.td-go{all:unset;cursor:pointer;font-size:12.5px;font-weight:500;padding:6px 14px;border-radius:99px;border:1px solid var(--td-line);color:var(--td-ink)}.td-go:hover{background:var(--td-soft)}
.td-av{width:34px;height:34px;flex:none;border-radius:50%;display:grid;place-items:center;font-weight:600;font-size:13px;color:#fff}
.td-time{width:52px;flex:none;display:flex;flex-direction:column;align-items:flex-start}.td-time b{font-size:14px;font-weight:500;font-family:'Geist Mono',monospace;color:var(--td-ink)}.td-time small{font-size:11px;color:var(--td-mute)}
.td-price{font-family:'Geist Mono',monospace;font-size:12.5px;color:var(--td-ink)}
.td-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--td-acc)}.td-dot.bad{background:var(--bad,#e11d48)}.td-dot.warn{background:var(--td-need)}
.td-tabs{display:flex;gap:16px;border-bottom:1px solid var(--td-line);margin-bottom:4px}.td-tabs button{all:unset;cursor:pointer;font-size:12.5px;padding:0 0 9px;color:var(--td-mute)}.td-tabs button[aria-pressed=true]{color:var(--td-ink);box-shadow:inset 0 -2px 0 var(--td-ink)}
.td-note{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--td-line);cursor:pointer}.td-note:last-child{border-bottom:0}.td-note:hover .tx b{text-decoration:underline}
.td-note .tx b{white-space:normal}.td-note.unread .tx b::after{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--td-ink);margin-inline-start:6px;vertical-align:middle}
.tdx-all{display:block;margin-top:10px}
.td-empty{font-size:13px;color:var(--td-mute);padding:6px 0}
#tdScSlot:empty{display:none}
html body .today .td-h .td-link:not(#_),html body .today .td-go:not(#_){display:inline-flex;align-items:center;min-height:36px;padding:0 14px;border-radius:99px;line-height:1;box-sizing:border-box}
/* light mode: graphite capsules on silver; the value band stays graphite, so its text keeps its own colours */
[data-theme=light] .today .tdx-btn.pri{background:#141516!important;color:#fff!important;border-color:#141516!important}
[data-theme=light] .today .tdx-btn:not(.pri){background:transparent!important;color:#141516!important;border-color:rgba(20,21,22,.28)!important}
.today .tdx-value .tdx-lead small,.today .tdx-value .tdx-fig small{color:#b9bcbf!important}.today .tdx-value .tdx-lead span,.today .tdx-value .tdx-fig span{color:#9a9ea2!important}
.today .tdx-value b{color:#fff!important}.today .tdx-value .tdx-fig small i{color:#c6f432!important}
#today #tdHealth{display:block!important}#today .td-ic{font-size:0!important;width:8px!important;height:8px!important;min-width:0!important;padding:0!important}
@media (max-width:1100px){.tdx-main{grid-template-columns:1fr}.tdx-value{grid-template-columns:1fr}.tdx-lead{border-right:0;padding-right:0;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,.1)}.tdx-figs{padding-top:10px}.tdx-fig:first-child{padding-left:0}.tdx-foot{grid-template-columns:1fr 1fr}}
@media (max-width:760px){.tdx-main,.tdx-foot{grid-template-columns:1fr}.tdx-fig{padding:2px 10px}.tdx-fig b{font-size:22px}.tdx-lead b{font-size:38px}.tdx-head h1{font-size:22px!important}.td-logo{width:46px;height:46px}.tdx-acts{width:100%}.tdx-btn{flex:1;justify-content:center}}
</style>`);

// Home opens Today; the data dashboard stays on Live now and the other tabs
homeBtn.addEventListener("click",e=>{e.stopImmediatePropagation();show()},true);
$$("nav button[data-view]").forEach(b=>{if(b!==homeBtn)b.addEventListener("click",()=>{sec.hidden=true;clearInterval(timer)})});
function show(){if(window.LAB)return;$$("nav button[data-view]").forEach(x=>x.setAttribute("aria-current",x===homeBtn));$$("main > section.wrap").forEach(s=>s.hidden=s!==sec);
  document.body.dataset.page="today";scrollTo(0,0);load();clearInterval(timer);timer=setInterval(()=>{if(!document.hidden&&!sec.hidden&&!document.documentElement.classList.contains("live-on"))load()},30000)}
window.homeLoad=()=>{if(!sec.hidden)load()}; // live.js calls this the moment data changes

const money=v=>{try{return fmt(v)}catch{return "$"+Math.round(v||0)}};
const colorOf=s=>{let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))%360;return `hsl(${h} 55% 55%)`};
const hm=s=>String(s||"").slice(11,16);
async function load(){
  const [b,l,n,c,k]=await Promise.all([req("/api/business").catch(()=>null),req("/api/live?days=30").catch(()=>null),req("/api/notifications").catch(()=>({items:[],unread:0})),req("/api/channels").catch(()=>null),req("/api/kpis?days=30").catch(()=>[])]);
  biz=b;live=l;notes=n.items||[];ch=c;kpis=Array.isArray(k)?k:[];draw(n.unread||0)}
let kpis=[];
function openNow(){const d=new Date(),m=d.getHours()*60+d.getMinutes(),r=(biz?.hours?.[d.getDay()]||[]).map(([a,z])=>[a,z].map(t=>{const[h,mm]=t.split(":");return +h*60+ +mm}));
  const cur=r.find(([a,z])=>m>=a&&m<z);if(cur)return `Open now · until ${String(Math.floor(cur[1]/60)).padStart(2,"0")}:${String(cur[1]%60).padStart(2,"0")}`;
  const next=r.find(([a])=>a>m);return next?`Opens today at ${String(Math.floor(next[0]/60)).padStart(2,"0")}:${String(next[0]%60).padStart(2,"0")}`:"Closed today"}
function draw(unread){if(!biz||!live)return;const now=live.now,d=new Date(),h=d.getHours();
  // hero
  $("#tdLogo").style.backgroundImage=biz.logo_url?`url("${biz.logo_url}")`:"";$("#tdLogo").textContent=biz.logo_url?"":([...biz.name][0]||"").toUpperCase();
  $("#tdDate").textContent=`${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} · ${openNow()}`;
  $("#tdHello").innerHTML=`${h<12?"Good morning":h<18?"Good afternoon":"Good evening"}, <em>${esc(biz.name)}</em>`;
  const tasks=(now.waiting||0)+(now.approvals||0)+(now.unsure||0);
  $("#tdSub").textContent=`${now.visits_today||0} appointment${now.visits_today===1?"":"s"} today${tasks?` · ${tasks} thing${tasks===1?"":"s"} need${tasks===1?"s":""} you`:" · nothing waiting for you"}.`;
  // the value line: what the AI booked on its own. Older servers have no ai_value; then count bookings that came through a chat channel this week
  const chat=(live.channels||[]).filter(c=>!["manual","direct","web","other"].includes(c.channel));
  const aiV=now.ai_value!=null?now.ai_value:chat.reduce((a,c)=>a+c.value,0),aiN=now.ai_count!=null?now.ai_count:chat.reduce((a,c)=>a+c.n,0);
  const aiP=now.ai_value_prev,aiC=aiP?Math.round((aiV-aiP)/aiP*100):null;
  $("#tdVal").textContent=money(aiV);
  $("#tdValL").textContent=`${aiN} appointment${aiN===1?"":"s"} booked from chats${aiC===null?"":` · ${aiC>=0?"+":"−"}${Math.abs(aiC)}% vs the 30 days before`}`;
  const sum=f=>kpis.reduce((a,x)=>a+(f(x)||0),0),chats=sum(x=>x.chats),handled=sum(x=>x.handled),ms=kpis.filter(x=>x.reply_ms!=null),avgMs=ms.length?ms.reduce((a,x)=>a+x.reply_ms,0)/ms.length:null;
  $("#tdFigs").innerHTML=[["Chats answered",chats||"–",chats?`<i>${Math.round(handled/chats*100)}%</i> with no one stepping in`:"none in the last 30 days"],
    ["Average reply",avgMs==null?"–":`${(avgMs/1000).toFixed(1)}s`,"day and night, every channel"],
    ["Booked ahead",money(now.upcoming_value||0),`${now.upcoming_count||0} appointment${now.upcoming_count===1?"":"s"} in the calendar`]]
    .map(([l,v,t])=>`<div class="tdx-fig"><span>${l}</span><b>${v}</b><small>${t}</small></div>`).join("");
  // week strip
    $("#tdDays").innerHTML=live.week.map(w=>{const x=new Date(w.d+"T12:00");return `<button type="button" class="td-day${w.today?" now":""}${w.pct===null?" off":""}" data-go="calendar" title="${w.pct===null?"Closed":w.pct+"% booked"}">${DOW[x.getDay()]}<b>${x.getDate()}</b><i><u style="width:${w.pct||0}%"></u></i></button>`}).join("");
  // to do
  const todo=[];
  if(now.waiting)todo.push(["red","💬",`${now.waiting} chat${now.waiting>1?"s":""} waiting for you`,"The AI handed them over","conversations"]);
  if(now.approvals)todo.push(["amber","✓",`${now.approvals} request${now.approvals>1?"s":""} to approve`,"Changes, cancellations, special requests","approvals"]);
  if(now.unsure)todo.push(["amber","?",`Check ${now.unsure} unsure repl${now.unsure>1?"ies":"y"}`,"Teach the right answer","training"]);
  const failed=(live.h24||[]).reduce((a,x)=>a+(x.failed||0),0);if(failed)todo.push(["red","!",`${failed} AI repl${failed>1?"ies":"y"} failed today`,"Clients got a fallback message","health"]);
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
  $("#tdHealth").innerHTML=checks.map(([s,t,d])=>`<div class="td-row"><span class="td-dot ${s}"></span><span class="tx"><b>${t}</b><small>${esc(d)}</small></span></div>`).join("");
  // notifications
  $("#tdUnread").textContent=unread?`${unread} new`:"";drawNotes();
  // a business that has not gone live yet: the setup steps lead the page instead of empty boxes
  const steps=live.setup||[],pending=steps.filter(s=>!s.done);
  $("#tdStart").hidden=!pending.length;$("#tdStartN").textContent=steps.length?`${steps.length-pending.length} of ${steps.length} done`:"";
  $("#tdBar").style.width=steps.length?`${Math.round((steps.length-pending.length)/steps.length*100)}%`:"0";
  $("#tdSteps").innerHTML=pending.map(s=>`<button type="button" data-go="setup"><b>${esc(s.label)}</b><small>Open Settings →</small></button>`).join("")}

const ICON={booking:["green","📅"],cancel:["red","✕"],approval:["amber","✓"],handoff:["red","💬"],unsure:["amber","?"],review:["blue","★"],marketing:["blue","📣"]};
function drawNotes(){const list=notes.filter(n=>nFilter==="all"||(nFilter==="booking"?["booking","cancel","approval"].includes(n.kind):["handoff","unsure","review"].includes(n.kind))).slice(0,4);
  $("#tdNotes").innerHTML=list.length?list.map(n=>{const[c,i]=ICON[n.kind]||["blue","•"];return `<div class="td-note${n.read?"":" unread"}" data-c="${n.conversation_id||""}"><span class="td-ic ${c}">${i}</span><span class="tx"><b>${esc(n.title)}</b><small>${esc((n.body||"").split("\n")[0]).slice(0,90)}${n.body?" · ":""}${esc(String(n.at||"").slice(5,16).replace("T"," "))}</small></span></div>`}).join("")
    :`<div class="td-empty">No notifications here yet.</div>`}
$("#tdNTabs").addEventListener("click",e=>{const b=e.target.closest("[data-f]");if(!b)return;nFilter=b.dataset.f;$$("#tdNTabs button").forEach(x=>x.setAttribute("aria-pressed",x===b));drawNotes()});
$("#tdNotes").addEventListener("click",e=>{const n=e.target.closest(".td-note");if(!n)return;go(n.dataset.c?"conversations":"dash");if(n.dataset.c)setTimeout(()=>{try{openConv(+n.dataset.c)}catch{}},300)});

// every button on this page goes to the right place
function go(where){const nav=v=>document.querySelector(`nav button[data-view="${v}"]:not([data-sub])`);
  const pane=(v,p)=>{const b=document.querySelector(`nav button[data-view="${v}"][data-sub="${p}"]`);if(b)b.click();else{nav(v)?.click();setTimeout(()=>window.tabsOf?.[v]?.(p),30)}};
  if(where==="bell"){document.getElementById("bellBtn")?.click();return}
  if(where==="ask"){window.P10?window.P10.go("pulse",1):document.getElementById("hxAsk")?.click();return}
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
