// "Today": the owner's home page. How the business is doing today, what needs doing, the team, health and alerts.
// It has its own softer bento look on purpose, so it never feels like the data tabs.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const homeBtn=document.querySelector('nav button[data-view="overview"]:not([data-sub])');if(!homeBtn)return;
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
let biz=null,live=null,notes=[],ch=null,nFilter="all",timer=null;

const sec=document.createElement("section");sec.className="wrap today";sec.id="today";sec.hidden=true;
// Focus + list: the hero and one block at a comfortable size on the left; every block as a quiet row on the right.
// Clicking a row shows that block in the focus area. Nothing is dropped, only one block is open at a time.
sec.innerHTML=`<div class="td-grid">
 <div class="td-left">
  <div class="td-card td-hero"><div class="td-hero-in"><div class="td-logo" id="tdLogo" role="button" tabindex="0" data-go="team" title="Change your logo in Settings"></div><div style="min-width:0"><p class="td-eyebrow" id="tdDate"></p><h1 id="tdHello">Good morning</h1><p class="td-sub" id="tdSub"></p></div></div>
    <div class="td-val"><b id="tdVal"></b><span id="tdValL"></span><i id="tdValChg"></i></div>
    <div class="td-hero-acts"><button class="td-btn" type="button" data-go="newbooking">+ New booking</button><button class="td-btn ghost" type="button" data-go="dash">Full dashboard</button></div></div>
  <div class="td-card td-ai" id="tdAi"><div class="td-h"><h2>Your AI team</h2><button class="td-link" type="button" data-team="">Open team →</button></div>
    <div class="td-ai-list" id="tdAiList"></div>
    <form class="td-ai-ask" id="tdAiAsk"><input id="tdAiIn" placeholder="Give your team a task or ask anything…" autocomplete="off" aria-label="Ask your AI team"><button class="td-go" type="submit">Ask</button></form></div>
  <div class="td-focus" id="tdFocus">
   <div class="td-card td-start" data-k="start"><div class="td-h"><h2>Get started</h2></div><h3>Your receptionist is ready</h3>
    <p class="td-say">Nothing to show yet. The first conversations usually arrive within a day of connecting WhatsApp. While you wait:</p>
    <div class="td-steps"><button type="button" data-go="setup"><b>1 · Connect WhatsApp</b><small>So customers can reach the AI.</small></button><button type="button" data-go="setup"><b>2 · Check your services</b><small>Prices and durations the AI offers.</small></button><button type="button" data-go="demo"><b>3 · Try the test chat</b><small>Book as if you were a customer.</small></button></div></div>
   <div class="td-card" data-k="todo"><div class="td-h"><h2>Needs you</h2><span class="td-pill" id="tdTodoN"></span></div><p class="td-say" id="tdTodoSay"></p><div id="tdTodo"></div></div>
   <div class="td-card" data-k="notes"><div class="td-h"><h2>Notifications</h2><span class="td-pill" id="tdUnread"></span></div>
    <div class="td-tabs" id="tdNTabs"><button type="button" data-f="all" aria-pressed="true">Overview</button><button type="button" data-f="booking" aria-pressed="false">Bookings</button><button type="button" data-f="people" aria-pressed="false">Messages</button></div><div id="tdNotes"></div></div>
   <div class="td-card" data-k="next"><div class="td-h"><h2>Next up</h2><span class="td-pill" id="tdNextN"></span></div><div id="tdNext"></div></div>
   <div class="td-card" data-k="week"><div class="td-h"><h2 id="tdMonth"></h2><button class="td-link" type="button" data-go="calendar">Calendar →</button></div><div class="td-days" id="tdDays"></div></div>
   <div class="td-card" data-k="stats"><div class="td-h"><h2>Today in numbers</h2></div><div class="td-stats" id="tdStats"></div></div>
   <div class="td-card" data-k="team"><div class="td-h"><h2>Your team</h2><button class="td-link" type="button" data-go="team">Edit</button></div><div id="tdTeam"></div></div>
   <div class="td-card" data-k="health"><div class="td-h"><h2>Health</h2><span class="td-pill" id="tdHealthState"></span></div><div id="tdHealth"></div></div>
  </div>
 </div>
 <div class="td-card td-list" id="tdList"></div>
</div>`;
document.querySelector("main").append(sec);
document.head.insertAdjacentHTML("beforeend",`<style>
.today{--td-card:var(--gp-card,#fff);--td-ink:var(--gp-text,#151a17);--td-ink2:var(--gp-2,#56605a);--td-mute:var(--gp-meta,#8a948e);--td-line:var(--gl-grid,rgba(0,0,0,.08));--td-soft:var(--gp-nest,rgba(0,0,0,.04));--td-acc:var(--p-green,#1f8f55);--td-need:var(--need,#c45f2a);--td-r:20px}
main>section.today:not([hidden]){overflow:auto}
.td-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(260px,1fr);gap:14px;align-items:start;color:var(--td-ink);padding-bottom:10px}
.td-left{display:flex;flex-direction:column;gap:14px;min-width:0}
.td-card{background:var(--td-card);border-radius:var(--td-r);padding:18px 20px;border:1px solid var(--td-line);min-width:0;position:relative;overflow:hidden}
.td-h{display:flex;align-items:center;gap:8px;margin-bottom:12px}.td-h h2{margin:0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--td-mute)}
.td-link{all:unset;cursor:pointer;margin-inline-start:auto;font-size:12.5px;color:var(--td-ink2)}.td-link:hover{color:var(--td-ink)}
.td-pill:empty{display:none}.td-pill{margin-inline-start:auto;font-size:11.5px;font-weight:500;padding:3px 9px;border-radius:99px;background:var(--td-soft);color:var(--td-ink2)}
.td-say{margin:-4px 0 10px;font-size:14px;color:var(--td-ink2)}.td-say:empty{display:none}
/* hero: the one strong card. Its colour comes from pulse.css */
.td-hero{padding:24px;display:flex;flex-direction:column;gap:16px}
.td-hero-in{display:flex;gap:16px;align-items:center}
.td-logo{width:60px;height:60px;flex:none;border-radius:18px;background:#fff center/cover no-repeat;display:grid;place-items:center;font-weight:700;font-size:26px;line-height:1;color:#1f4d37;cursor:pointer;border:2px solid rgba(255,255,255,.6)}
.td-eyebrow{margin:0;font-size:12.5px;color:var(--muted,var(--td-mute))}
.td-hero h1{margin:2px 0 4px;font-size:24px!important;letter-spacing:-.02em;line-height:1.15;color:inherit}
.td-sub{margin:0;font-size:13.5px;color:var(--ink2,var(--td-ink2))}
.td-val{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.td-val:has(b:empty){display:none}
.td-val b{font-size:44px;font-weight:300;letter-spacing:-.03em;line-height:1}.td-val span{font-size:14px;color:var(--ink2,var(--td-ink2))}
.td-val i{font-style:normal;font-size:11px;font-family:'Geist Mono',monospace;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,.14)}.td-val i:empty{display:none}
.td-hero-acts{display:flex;gap:8px;flex-wrap:wrap}
.td-btn{all:unset;cursor:pointer;padding:9px 15px;border-radius:99px;background:#fff;color:#14201a;font-size:13px;font-weight:500}.td-btn.ghost{background:rgba(255,255,255,.14);color:#fff}.td-btn:hover{filter:brightness(1.08)}
/* focus area: one block open at a time */
.td-focus>.td-card{display:none;min-height:260px}.td-focus>.td-card.on{display:block}
/* the list of blocks */
.td-list{padding:6px 0}
.td-li{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:12px;width:100%;padding:14px 20px;border-bottom:1px solid var(--td-line);font-size:13.5px;color:var(--td-ink2)}
.td-li:last-child{border-bottom:0}.td-li:hover{background:var(--td-soft);color:var(--td-ink)}
.td-li::before{content:"";width:6px;height:6px;border-radius:50%;flex:none;background:var(--td-mute)}
.td-li.need::before{background:var(--td-need)}.td-li.good::before{background:var(--td-acc)}.td-li.bad::before{background:var(--bad,#e11d48)}
.td-li .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.td-li .v{font-family:'Geist Mono',monospace;font-size:12px;color:var(--td-mute);white-space:nowrap}
.td-li[aria-current="true"]{background:var(--td-soft);color:var(--td-ink);box-shadow:inset 3px 0 0 var(--td-acc)}.td-li.need[aria-current="true"]{box-shadow:inset 3px 0 0 var(--td-need)}
.td-li[aria-current="true"] .v{color:var(--td-ink)}
/* week strip */
.td-days{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.td-day{all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 0;border-radius:14px;font-size:11px;color:var(--td-mute)}
.td-day b{font-size:17px;font-weight:400;color:var(--td-ink)}.td-day:hover{background:var(--td-soft)}
.td-day.now{background:var(--td-ink);color:var(--td-card)}.td-day.now b{color:var(--td-card)}
.td-day i{width:26px;height:4px;border-radius:9px;background:var(--td-line);overflow:hidden;display:block}.td-day i u{display:block;height:100%;background:var(--td-acc)}
.td-day.off{opacity:.45}
/* today in numbers */
.td-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
.td-stat{padding:4px 16px;border-left:1px solid var(--td-line);display:flex;flex-direction:column;gap:4px;min-width:0}.td-stat:first-child{border-left:0;padding-left:0}
.td-stat span{font-size:11.5px;color:var(--td-mute)}.td-stat b{font-size:26px;font-weight:300;letter-spacing:-.02em;color:var(--td-ink);line-height:1.1}
.td-stat small{font-size:12px;color:var(--td-ink2)}.td-stat small .up{color:var(--td-acc)}.td-stat small .down{color:var(--td-need)}
/* rows */
.td-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--td-line)}.td-row:first-child{border-top:0;padding-top:2px}
.td-row .tx{min-width:0;flex:1;display:flex;flex-direction:column}.td-row .tx b{font-size:13.5px;font-weight:500;color:var(--td-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.td-row .tx small{font-size:12px;color:var(--td-mute)}
.td-ic{width:8px;height:8px;flex:none;border-radius:50%;font-size:0;background:var(--td-mute)}
.td-ic.red{background:var(--bad,#e11d48)}.td-ic.amber{background:var(--td-need)}.td-ic.blue{background:var(--aic,#6457d4)}.td-ic.green{background:var(--td-acc)}
.td-go{all:unset;cursor:pointer;font-size:12px;font-weight:500;padding:5px 12px;border-radius:99px;border:1px solid var(--td-line);color:var(--td-ink)}.td-go:hover{background:var(--td-soft)}
.td-av{width:38px;height:38px;flex:none;border-radius:50%;display:grid;place-items:center;font-weight:600;font-size:14px;color:#fff}
[data-k="team"] .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}
.td-mem{display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center;padding:12px 4px;border-radius:16px;border:1px solid var(--td-line)}.td-mem .td-av{width:44px;height:44px;font-size:16px}
.td-mem b{font-size:12.5px;font-weight:500;color:var(--td-ink)}.td-mem small{font-size:11px;color:var(--td-mute);line-height:1.25}
.td-time{width:52px;flex:none;display:flex;flex-direction:column;align-items:flex-start}.td-time b{font-size:14px;font-weight:500;font-family:'Geist Mono',monospace;color:var(--td-ink)}.td-time small{font-size:11px;color:var(--td-mute)}
.td-price{font-family:'Geist Mono',monospace;font-size:12.5px;color:var(--td-ink)}
.td-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--td-acc)}.td-dot.bad{background:var(--bad,#e11d48)}.td-dot.warn{background:var(--td-need)}
.td-tabs{display:flex;gap:16px;border-bottom:1px solid var(--td-line);margin-bottom:4px}.td-tabs button{all:unset;cursor:pointer;font-size:12.5px;padding:0 0 9px;color:var(--td-mute)}.td-tabs button[aria-pressed=true]{color:var(--td-ink);box-shadow:inset 0 -2px 0 var(--td-ink)}
.td-note{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--td-line);cursor:pointer}.td-note:last-child{border-bottom:0}.td-note:hover .tx b{color:var(--td-acc)}
.td-note .tx b{white-space:normal}.td-note.unread .tx b::after{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--td-acc);margin-inline-start:6px;vertical-align:middle}
.td-start h3{margin:0 0 6px;font-size:22px;font-weight:400;letter-spacing:-.01em}
.td-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:6px}
.td-steps button{all:unset;cursor:pointer;display:flex;flex-direction:column;gap:4px;padding:14px;border-radius:14px;border:1px solid var(--td-line)}.td-steps button:hover{background:var(--td-soft)}
.td-steps b{font-size:13.5px;font-weight:500;color:var(--td-ink)}.td-steps small{font-size:12px;color:var(--td-mute)}
@media (max-width:900px){.td-steps{grid-template-columns:1fr}}
/* AI team strip */
.td-ai-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.td-ai-p{box-sizing:border-box;display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:14px;border:1px solid var(--td-line)}
.td-ai-p .av{all:unset;cursor:pointer}.td-ai-n{all:unset;cursor:pointer;font-weight:500}.td-ai-n:hover{text-decoration:underline}
.td-ai-p .av{width:30px;height:30px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:600;font-size:12.5px;color:#fff;background:var(--td-mute)}
.td-ai-p .av-maya{background:#2a6b4a}.td-ai-p .av-omar{background:var(--need,#c45f2a)}.td-ai-p .av-lina{background:#a0527a}.td-ai-p .av-sam{background:var(--aic,#6457d4)}
.td-ai-p .tx{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}
.td-ai-p b{font-size:13px;font-weight:500;color:var(--td-ink);display:flex;align-items:center;gap:6px}.td-ai-p b small{font-weight:400;color:var(--td-mute);font-size:11.5px}
.td-ai-p em{margin-left:auto;font-style:normal;font-size:11px;font-family:'Geist Mono',monospace;color:var(--td-need)}.td-ai-p em.ok{color:var(--td-acc)}
.td-ai-p .tx>small{font-size:12px;color:var(--td-ink2);line-height:1.4}.td-ai-p small.pc{font-size:10.5px;color:var(--td-mute)}
.td-ai-bar{display:block;height:4px;border-radius:99px;background:var(--td-line);overflow:hidden;margin-top:3px}.td-ai-bar u{display:block;height:100%;background:var(--td-acc);border-radius:99px}
.td-ai-ask{display:flex;gap:6px;margin-top:10px}.td-ai-ask input{flex:1;min-width:0}
@media (max-width:900px){.td-ai-list{grid-template-columns:1fr}}
.td-empty{font-size:13px;color:var(--td-mute);padding:8px 0}
@media (max-width:900px){.td-grid{grid-template-columns:1fr}.td-stats{grid-template-columns:1fr 1fr;gap:14px 0}.td-stat:nth-child(3){border-left:0;padding-left:0}.td-val b{font-size:36px}.td-hero h1{font-size:21px!important}.td-logo{width:50px;height:50px}}
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
  biz=b;live=l;notes=n.items||[];ch=c;draw(n.unread||0);drawTeam()}
// the AI team: what each one advises now, their open tasks and how much is done. No AI call; the data does it
async function drawTeam(){let t;try{t=(await req("/api/team/status")).team}catch{return}
  // each employee: open their panel from the name, follow a finding to its page
  $("#tdAiList").innerHTML=t.map(e=>`<div class="td-ai-p"><button type="button" class="av av-${e.id}" data-team="${e.id}" title="Talk to ${e.name}">${e.name[0]}</button>
    <span class="tx"><b><button type="button" class="td-ai-n" data-team="${e.id}">${e.name}</button> <small>${e.role}</small>${e.open?`<em>${e.open} task${e.open>1?"s":""}</em>`:`<em class="ok">clear</em>`}</b>
    <small>${esc(e.advice)}</small>${e.progress==null?"":`<i class="td-ai-bar" title="${e.progress}% ${esc(e.of)}"><u style="width:${e.progress}%"></u></i><small class="pc">${e.progress}% ${esc(e.of)}</small>`}
    <span class="tp-links">${(e.items||[]).filter(i=>i.tone).map(i=>`<button type="button" class="tp-link need" data-go='${esc(JSON.stringify(i.go))}'>${esc(i.text)} →</button>`).join("")}</span></span></div>`).join("")}
$("#tdAiAsk").addEventListener("submit",e=>{e.preventDefault();const t=$("#tdAiIn").value.trim();if(!t)return;$("#tdAiIn").value="";window.openTeam?.("",t)});
sec.addEventListener("click",e=>{const b=e.target.closest("[data-team]");if(!b)return;e.stopPropagation();window.openTeam?.(b.dataset.team||"maya","")},true);
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
  // the value line: what the AI booked on its own. Older servers have no ai_value; then count bookings that came through a chat channel this week
  const chat=(live.channels||[]).filter(c=>!["manual","direct","web","other"].includes(c.channel));
  const aiV=now.ai_value!=null?now.ai_value:chat.reduce((a,c)=>a+c.value,0),aiN=now.ai_count!=null?now.ai_count:chat.reduce((a,c)=>a+c.n,0);
  const aiP=now.ai_value_prev,aiC=aiP?Math.round((aiV-aiP)/aiP*100):null;
  $("#tdVal").textContent=aiN?money(aiV):"";
  $("#tdValL").textContent=`booked by the AI · ${aiN} appointment${aiN===1?"":"s"} ${now.ai_value!=null?"in 30 days":"this week"}`;
  $("#tdValChg").textContent=aiC===null?"":`${aiC>=0?"+":"−"}${Math.abs(aiC)}%`;
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
  $("#tdUnread").textContent=unread?`${unread} new`:"";drawNotes();
  // the list: every block as one row with its headline figure. Orange = needs you, green = good, red = broken
  $("#tdTodoSay").textContent=todo.length?`${todo.length} thing${todo.length>1?"s are":" is"} waiting for you.`:"";
  const onShift=open?team.length:0,today=live.week.find(w=>w.today);
  const rows=[["todo","Needs you",todo.length?`${todo.length} open`:"All done",todo.length?"need":"good"],
    ["notes","Notifications",unread?`${unread} new`:"Read",unread?"need":""],
    ["next","Next up",up[0]?hm(up[0].start):"—",""],
    ["week",$("#tdMonth").textContent||"This week",today&&today.pct!=null?`${today.pct}% today`:"Week",""],
    ["stats","Today in numbers",money(now.revenue_today||0),""],
    ["team","Your team",team.length?`${onShift} on shift`:"Add",""],
    ["health","Health",$("#tdHealthState").textContent,bad?"bad":warn?"need":"good"]];
  // a brand-new business: no chats, bookings or alerts yet. Open on the first steps instead of empty boxes
  const fresh=!notes.length&&!up.length&&!(live.d14||[]).some(x=>x.v)&&!(live.channels||[]).length&&!now.msgs_today;
  if(fresh){rows.unshift(["start","Get started","3 steps","good"]);if(!started){focus="start";started=true}}
  if(!rows.some(r=>r[0]===focus))focus="todo";
  $("#tdList").innerHTML=rows.map(([k,t,v,c])=>`<button type="button" class="td-li ${c}" data-k="${k}" aria-current="${k===focus}"><span class="t">${esc(t)}</span><span class="v">${esc(v)}</span></button>`).join("");
  $$("#tdFocus > .td-card").forEach(c=>c.classList.toggle("on",c.dataset.k===focus))}
let focus="todo",started=false;
$("#tdList").addEventListener("click",e=>{const b=e.target.closest(".td-li");if(!b)return;focus=b.dataset.k;
  $$("#tdList .td-li").forEach(x=>x.setAttribute("aria-current",x===b));$$("#tdFocus > .td-card").forEach(c=>c.classList.toggle("on",c.dataset.k===focus))});
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
