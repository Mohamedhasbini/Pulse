// "Today": the owner's home page, action-led. Seven blocks on the 12-column grid, read in this order:
// what needs you, today's appointments with the gaps between them, the one recommended action, how full today is,
// what the AI did, the conversations that matter, and a small business-health strip. Analytics live in Insights.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const homeBtn=document.querySelector('nav button[data-view="overview"]:not([data-sub])');if(!homeBtn)return;
const U=window.MXUI,e=U.esc;
const DOW=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
let timer=null;

const sec=document.createElement("section");sec.className="wrap today";sec.id="today";sec.hidden=true;
sec.innerHTML=`<div class="mx-page">
 <header class="tdh"><div class="tdh-id"><div class="tdh-logo" id="tdLogo" role="button" tabindex="0" data-go="settings" title="Change your logo in Settings"></div>
   <div style="min-width:0"><p class="tdh-date" id="tdDate"></p><h1 id="tdHello"></h1><p class="tdh-sub" id="tdSub"></p></div></div>
  <div class="tdh-acts"><button class="mx-btn" type="button" data-go="ask">Ask MXAi</button><button class="mx-btn pri" type="button" data-go="newbooking">+ New booking</button></div></header>
 <div class="mx-grid" id="tdLive"></div>
 <div class="mx-grid" id="tdA">${U.card({title:"Needs your attention",span:5,body:U.loading(3)})}${U.card({title:"Today's appointments",span:4,body:U.loading(4)})}${U.card({title:"Recommended action",span:3,body:U.loading(2)})}</div>
 <div class="mx-grid" id="tdB"></div>
 <div class="mx-grid" id="tdC"></div>
</div>`;
document.querySelector("main").append(sec);
document.head.insertAdjacentHTML("beforeend",`<style>
main>section.today:not([hidden]){overflow:auto}
.tdh{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.tdh-id{display:flex;gap:16px;align-items:center;min-width:0}
.tdh-logo{width:52px;height:52px;flex:none;border-radius:14px;background:#fff center/cover no-repeat;display:grid;place-items:center;font-weight:700;font-size:22px;color:#1f2a24;cursor:pointer;border:1px solid var(--mx-line)}
.tdh-date{margin:0;font-size:13px;color:var(--mx-mute)}
.today .tdh h1{margin:2px 0 2px;font-size:28px!important;font-weight:600;letter-spacing:-.025em;line-height:1.15;color:var(--mx-ink)}
.today .tdh h1 em{font-style:normal;color:var(--mx-ink2);font-weight:500}
.tdh-sub{margin:0;font-size:14px;color:var(--mx-ink2)}
.tdh-acts{display:flex;gap:8px;flex-wrap:wrap}
@media (max-width:767px){.tdh-acts{width:100%}.tdh-acts .mx-btn{flex:1}.today .tdh h1{font-size:22px!important}}
.td-steps{display:flex;gap:8px;flex-wrap:wrap}
</style>`);

const money=v=>{try{return fmt(v)}catch{return "$"+Math.round(v||0).toLocaleString()}};
const hm=s=>String(s||"").slice(11,16);
const mins=t=>{const[h,m]=t.split(":");return +h*60+ +m},clock=m=>`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const day=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const nora=()=>window.P10?.named?.("Nora")||"Nora";

// Home opens Today; every other page hides it
homeBtn.addEventListener("click",ev=>{ev.stopImmediatePropagation();show()},true);
$$("nav button[data-view]").forEach(b=>{if(b!==homeBtn)b.addEventListener("click",()=>{sec.hidden=true;clearInterval(timer)})});
function show(){if(window.LAB)return;$$("nav button[data-view]").forEach(x=>x.setAttribute("aria-current",x===homeBtn));$$("main > section.wrap").forEach(s=>s.hidden=s!==sec);
  document.body.dataset.page="today";scrollTo(0,0);load();clearInterval(timer);timer=setInterval(()=>{if(!document.hidden&&!sec.hidden&&!document.documentElement.classList.contains("live-on"))load()},30000)}
window.homeLoad=()=>{if(!sec.hidden)load()}; // live.js calls this the moment data changes

async function load(){
  const t=day(new Date()),get=u=>req(u).catch(()=>null);
  const [biz,live,ch,wait,brief,cal,kpis]=await Promise.all([get("/api/business"),get("/api/live?days=30"),get("/api/channels"),get("/api/pulse/waiting"),get("/api/briefing"),get(`/api/calendar?from=${t}T00:00&to=${t}T23:59`),get("/api/kpis?days=30")]);
  if(!biz||!live){$("#tdA").innerHTML=U.card({title:"Today",span:12,state:"critical",body:U.error("today's numbers","reload")});return}
  draw({biz,live,ch,wait:wait||{items:[]},brief:brief||{items:[]},cal:cal||{bookings:[],timeOff:[]},kpis:Array.isArray(kpis)?kpis:[]})}

function openNow(biz){const d=new Date(),m=d.getHours()*60+d.getMinutes(),r=(biz.hours?.[d.getDay()]||[]).map(([a,z])=>[mins(a),mins(z)]);
  const cur=r.find(([a,z])=>m>=a&&m<z);if(cur)return `Open now · until ${clock(cur[1])}`;const nx=r.find(([a])=>a>m);return nx?`Opens today at ${clock(nx[0])}`:"Closed today"}

// free stretches of at least 30 minutes inside today's opening hours, between the day's bookings and blocked time
function gaps(biz,cal){const d=new Date(),open=(biz.hours?.[d.getDay()]||[]).map(([a,z])=>[mins(a),mins(z)]);
  const busy=[...(cal.bookings||[]).filter(b=>!/cancel|no_show/.test(b.status||"")),...(cal.timeOff||[])].map(b=>[mins(hm(b.start)),mins(hm(b.end))]).sort((a,b)=>a[0]-b[0]);
  const now=d.getHours()*60+d.getMinutes(),out=[];
  for(const [a,z] of open){let c=Math.max(a,now);for(const [s,f] of busy){if(f<=c||s>=z)continue;if(s-c>=30)out.push([c,s]);c=Math.max(c,f)}if(z-c>=30)out.push([c,z])}
  const openMin=open.reduce((n,[a,z])=>n+z-a,0),booked=busy.reduce((n,[s,f])=>n+Math.max(0,Math.min(f,1440)-s),0);
  const closed=open.length>0&&now>=Math.max(...open.map(o=>o[1]));
  return {list:out,openMin,booked,closed}}

function draw({biz,live,ch,wait,brief,cal,kpis}){
  const now=live.now||{},d=new Date(),h=d.getHours(),ai=live.ai||{};
  // header
  const logo=$("#tdLogo");logo.style.backgroundImage=biz.logo_url?`url("${biz.logo_url}")`:"";logo.textContent=biz.logo_url?"":([...biz.name][0]||"").toUpperCase();
  $("#tdDate").textContent=`${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} · ${openNow(biz)}`;
  $("#tdHello").innerHTML=`${h<12?"Good morning":h<18?"Good afternoon":"Good evening"}, <em>${e(biz.name)}</em>`;

  // 1 · needs your attention: one queue, most urgent first
  const need=[],n=k=>(wait.items||[]).filter(x=>x.kind===k).length;
  if(now.waiting)need.push(["critical",`${now.waiting} chat${now.waiting>1?"s":""} waiting for a person`,`${nora()} handed them to you`,"Reply","p:inbox:1"]);
  if(ai.ok===false)need.push(["critical",`${nora()} is not answering`,"Clients get a fallback message","Check","p:pulse:0"]);
  const failed=(live.h24||[]).reduce((a,x)=>a+(x.failed||0),0);if(failed)need.push(["critical",`${failed} repl${failed>1?"ies":"y"} failed to send today`,"Clients may not have seen the answer","Check","p:inbox:0"]);
  if(n("request"))need.push(["warning",`${n("request")} request${n("request")>1?"s":""} to move or cancel`,"Waiting for your OK","Review","p:calendar:1"]);
  if(n("question")||now.unsure){const q=n("question")||now.unsure;need.push(["warning",`${q} question${q>1?"s":""} ${nora()} couldn't answer`,"Answer once and it remembers","Teach","p:pulse:0"])}
  if(n("agent"))need.push(["warning",`${n("agent")} offer${n("agent")>1?"s":""} ready to send`,"Prepared by your growth automations","Review","p:growth:4"]);
  if(n("lesson"))need.push(["neutral",`${n("lesson")} suggested rule${n("lesson")>1?"s":""}`,`${nora()} learned something from a chat`,"Review","p:pulse:0"]);
  const wa=ch?.whatsapp?.configured&&biz.wa_phone_number_id;if(!wa)need.push(["warning","WhatsApp is not connected","Clients can't reach you there yet","Connect","p:settings:0"]);
  const pending=(live.setup||[]).filter(s=>!s.done);
  const worst=need.some(x=>x[0]==="critical")?"critical":need.some(x=>x[0]==="warning")?"warning":"healthy";
  const needCard=U.list({title:"Needs your attention",span:5,state:need.length?worst:"healthy",meta:need.length?`${need.length} open`:"",
    rows:need.slice(0,5).map(([s,t,sub,btn,go])=>U.row({dot:s,title:t,sub,action:U.button(btn,go)})),more:need.length>5?`${need.length-5} more in AI Control and Inbox`:"",
    emptyTitle:"Nothing needs you right now",emptySub:`${nora()} is handling every chat.`});

  // 2 · today's appointments, with the free time between them
  const g=gaps(biz,cal),todays=(cal.bookings||[]).filter(b=>!/cancel/.test(b.status||""));
  const slots=[...todays.map(b=>({at:mins(hm(b.start)),r:U.row({time:hm(b.start),title:b.service,sub:`${b.customer||"Client"} · ${mins(hm(b.end))-mins(hm(b.start))} min`,value:money(b.price),go:"p:calendar:0"})})),
    ...g.list.slice(0,3).map(([a,z])=>({at:a,r:U.row({time:clock(a),cls:"gap",title:`Free until ${clock(z)}`,sub:`${z-a} min open to book`,go:"p:calendar:0"})}))].sort((a,b)=>a.at-b.at).map(x=>x.r);
  const value=todays.reduce((a,b)=>a+(b.price||0),0);
  const apptCard=U.list({title:"Today's appointments",span:4,meta:todays.length?`${todays.length} · ${money(value)}`:"",go:"p:calendar:0",rows:slots,
    emptyTitle:g.openMin?"No appointments yet today":"Closed today",emptySub:g.openMin?"Free time shows here so you can fill it.":"Enjoy the day off."});

  // 3 · one recommended action: the briefing's most valuable item, else the emptiest day ahead, else teaching
  let rec=null;const b0=(brief.items||[])[0];
  const OPEN={inbox:"p:inbox:1",requests:"p:calendar:1"};
  if(b0)rec={text:b0.text,why:b0.why+(b0.value?` · ${money(b0.value)} ${b0.money||""}`:""),label:/^(mark|teach)$/.test(b0.fix)?"Fix it":"Open",go:b0.fix.startsWith("open:")?(OPEN[b0.fix.slice(5)]||"p:inbox:0"):b0.fix==="teach"?"p:pulse:3":b0.fix.startsWith("agent:")?"p:growth:4":"p:calendar:0"};
  if(!rec){const ahead=(live.week||[]).filter(w=>!w.today&&w.pct!=null&&new Date(w.d+"T12:00")>d).sort((a,b)=>a.pct-b.pct)[0];
    if(ahead&&ahead.pct<50)rec={text:`${DOW[new Date(ahead.d+"T12:00").getDay()]} ${ahead.pct?`is only ${ahead.pct}% booked`:"has no bookings yet"}. Invite clients who haven't been in for a while.`,why:"An empty hour can't be sold later.",label:"Open Win back",go:"p:growth:0"}}
  if(!rec&&pending.length)rec={text:`Finish setup: ${pending[0].label}.`,why:`${pending.length} step${pending.length>1?"s":""} left before ${nora()} works at full strength.`,label:"Open Settings",go:"p:settings:0"};
  if(!rec)rec={text:"All clear. Nothing needs changing today.",why:`${nora()} is answering and the calendar is in order.`,label:"",go:""};
  $("#tdA").innerHTML=needCard+apptCard+U.rec({...rec,span:3});

  // 4 · how full today is · 5 · what the AI did · 6 · conversations that matter
  const pct=g.openMin?g.booked/g.openMin*100:0;
  const fill=g.openMin?U.meter({title:"Time booked today",pct,ctx:`of your open time is booked`,why:g.closed?"Closed for the rest of today":g.list.length?`${g.list.length} gap${g.list.length>1?"s":""} left, the next at ${clock(g.list[0][0])}`:"No gaps left today",state:g.closed?"neutral":pct>=70?"healthy":pct>=35?"neutral":"warning",span:3})
    :U.card({title:"Time booked today",size:"compact",span:3,body:U.empty("Closed today","Opening hours are set in Settings.")});
  const aiCard=U.kpi({title:`${nora()} today`,value:String(now.replies_today||0),ctx:`replies · ${now.booked_today||0} booking${now.booked_today===1?"":"s"} made`,why:now.active_now?`${now.active_now} conversation${now.active_now>1?"s":""} happening now`:now.avg_ms?`Average reply ${(now.avg_ms/1000).toFixed(1)}s`:"Quiet so far today",span:3,action:U.button("Open AI Control","p:pulse:0")});
  const conv=(live.active||[]).slice().sort((a,b)=>(b.needs_attention-a.needs_attention)||(b.value||0)-(a.value||0)).slice(0,3);
  const convCard=U.list({title:"Important conversations",span:6,go:"p:inbox:0",rows:conv.map(c=>U.row({dot:c.needs_attention?"warning":"healthy",title:c.name||c.phone||"Client",sub:c.last||"",value:c.needs_attention?"needs you":c.outcome==="booked"?"booked":"",go:`c:${c.id}`})),
    emptyTitle:"No conversations right now",emptySub:"New chats from clients appear here as they arrive."});
  $("#tdB").innerHTML=fill+aiCard+convCard;

  // 7 · business health, last 30 days
  const sum=f=>kpis.reduce((a,x)=>a+(f(x)||0),0),chats=sum(x=>x.chats),handled=sum(x=>x.handled),ms=kpis.filter(x=>x.reply_ms!=null),avg=ms.length?ms.reduce((a,x)=>a+x.reply_ms,0)/ms.length:null;
  const aiV=now.ai_value||0,aiP=now.ai_value_prev,ch30=aiP?(aiV-aiP)/aiP*100:null;
  $("#tdC").innerHTML=U.strip({title:"Business health · last 30 days",go:"p:insights:0",items:[
    ["Booked by MXAi",money(aiV),U.trend(ch30,{vs:"vs 30 days before"})||`<span class="mx-ctx">${now.ai_count||0} appointments</span>`],
    ["Chats answered alone",chats?`${Math.round(handled/chats*100)}%`:"–",`<span class="mx-ctx">${chats} chats</span>`],
    ["Average reply",avg==null?"–":`${(avg/1000).toFixed(1)}s`,`<span class="mx-ctx">day and night</span>`],
    ["Booked ahead",money(now.upcoming_value||0),`<span class="mx-ctx">${now.upcoming_count||0} upcoming</span>`]]});

  // go-live steps lead the page until setup is done
  $("#tdLive").innerHTML=pending.length?U.card({title:"Go live",span:12,state:"warning",size:"compact",meta:`${(live.setup||[]).length-pending.length} of ${(live.setup||[]).length} done`,
    body:`<p class="mx-ctx">Finish these so clients can reach ${e(nora())}.</p><div class="td-steps">${pending.map(s=>U.button(s.label,"p:settings:0")).join("")}</div>`}):"";
  const tasks=need.filter(x=>x[0]!=="neutral").length;
  $("#tdSub").textContent=`${todays.length} appointment${todays.length===1?"":"s"} today · ${tasks?`${tasks} thing${tasks>1?"s":""} need${tasks===1?"s":""} you`:"nothing waiting for you"}.`}

// every button goes to the right place: p:page:tab, c:conversation, or a named action
function go(where){
  if(where.startsWith("p:")){const [,id,i]=where.split(":");return window.P10?.go(id,+i)}
  if(where.startsWith("c:")){window.P10?.go("inbox",0);setTimeout(()=>window.PulseInbox?.openChat(where.slice(2)),500);return}
  if(where==="ask")return window.P10?window.P10.go("pulse",1):document.getElementById("hxAsk")?.click();
  if(where==="settings")return window.P10?.go("settings",0);
  if(where==="reload")return load();
  if(where==="newbooking"){window.P10?.go("calendar",0);setTimeout(()=>$("#calNew")?.click(),450)}}
sec.addEventListener("click",ev=>{const b=ev.target.closest("[data-go]");if(b){ev.stopPropagation();go(b.dataset.go)}});
sec.addEventListener("keydown",ev=>{if((ev.key==="Enter"||ev.key===" ")&&ev.target.matches(".mx-row[data-go]")){ev.preventDefault();go(ev.target.dataset.go)}});

// open Today on start (unless another page was asked for), once the login is known
const start=setInterval(()=>{if(window.LAB){clearInterval(start);return}if(typeof me!=="undefined"&&me&&me.business){clearInterval(start);if(!$("#overview").hidden||document.body.dataset.page==="overview"||!document.body.dataset.page)show()}},150);
setTimeout(()=>clearInterval(start),10000);
})();
