// "Today": the owner's home page and a summary of everything, in four bands on the 12-column grid:
// what needs you (the one recommended action first) beside what was earned; bookings over 30 days beside the AI
// front desk and the busy hours; four headline figures; then the appointments ahead as a table.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const homeBtn=document.querySelector('nav button[data-view="overview"]:not([data-sub])');if(!homeBtn)return;
const U=window.MXUI,e=U.esc;
const DOW=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
let timer=null,last=null,earnBy="w",tblBy="today",bkDays=30,svDays=30;

const sec=document.createElement("section");sec.className="wrap today";sec.id="today";sec.hidden=true;
sec.innerHTML=`<div class="mx-page">
 <header class="tdh"><div class="tdh-id"><div class="tdh-logo" id="tdLogo" role="button" tabindex="0" data-go="settings" title="Change your logo in Settings"></div>
   <div style="min-width:0"><p class="tdh-date" id="tdDate"></p><h1 id="tdHello"></h1><p class="tdh-sub" id="tdSub"></p><p class="tdh-since" id="tdSince" aria-live="polite"></p></div></div>
  <div class="tdh-acts"><button class="mx-btn" type="button" data-go="ask">Ask MXAi</button><button class="mx-btn pri" type="button" data-go="newbooking">+ New booking</button></div></header>
 <div class="mx-grid" id="tdLive"></div>
 <div class="mx-grid" id="tdA">${U.card({title:"Needs your attention",span:5,body:U.loading(3)})}${U.card({title:"Earned",span:7,size:"wide",body:U.loading(5)})}</div>
 <div class="mx-grid" id="tdB"></div>
 <div class="mx-grid" id="tdC"></div>
 <div class="mx-grid" id="tdD"></div>
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
.tdh-since{margin:4px 0 0;font-size:13px;color:var(--mx-mute)}.tdh-since:empty{display:none}.tdh-since b{font-weight:600;color:var(--mx-ink2)}
.tdh-chg{all:unset;cursor:pointer;color:var(--mx-ink2);text-decoration:underline;text-decoration-color:var(--mx-line);text-underline-offset:3px}.tdh-chg:hover{color:var(--mx-ink);text-decoration-color:currentColor}
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
window.homeLoad=()=>{if(!sec.hidden)load(true)}; // live.js calls this the moment data changes
// one load at a time: a second ask while one runs joins it (start-up opens Today twice); a real data change (force)
// queues exactly one fresh load after the running one, so nothing is missed
// and a plain ask right after a load finished (start-up shows Today twice in a row) reuses that load
let running=null,again=false,doneAt=0;
function load(force){if(running){if(force)again=true;return running}
  if(!force&&Date.now()-doneAt<2000)return Promise.resolve();
  running=loadNow().catch(err=>console.error("Today:",err)).finally(()=>{running=null;doneAt=Date.now();if(again){again=false;load(true)}});return running}

async function loadNow(){
  const t=day(new Date()),get=u=>req(u).catch(()=>null);
  const [team,hist,biz,live,ch,wait,brief,cal,kpis,month]=await Promise.all([window.PVTeam?window.PVTeam().catch(()=>null):null,window.PVData?window.PVData().catch(()=>null):null,get("/api/business"),get("/api/live?days=30"),get("/api/channels"),get("/api/pulse/waiting"),get("/api/briefing"),get(`/api/calendar?from=${t}T00:00&to=${t}T23:59`),get("/api/kpis?days=30"),get(`/api/calendar?from=${day(new Date(new Date().getFullYear(),new Date().getMonth()-1,1))}T00:00&to=${t}T23:59`)]);
  if(!biz||!live){$("#tdA").innerHTML=U.card({title:"Today",span:12,state:"critical",body:U.error("today's numbers","reload")});return}
  draw({biz,live,ch,wait:wait||{items:[]},brief:brief||{items:[]},cal:cal||{bookings:[],timeOff:[]},kpis:Array.isArray(kpis)?kpis:[],month:month?.bookings||[],hist:hist||{all:[],past:[],cust:[]},team:team||[]})}

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

const strip=xs=>`<div class="er-k" style="grid-template-columns:repeat(${xs.length},1fr)">${xs.map(([l,v,n])=>`<div><small>${e(l)}</small><b>${v}</b>${n?`<span>${e(n)}</span>`:""}</div>`).join("")}</div>`;
const sumP=l=>l.reduce((a,b)=>a+(+b.price||0),0),pctCh=(a,b)=>b?(a-b)/b*100:null;
// what was earned, by day (14), week (12) or month (6), from bookings that happened and were not cancelled
function earned(past,by){const d0=new Date(new Date().toDateString()),out=[],inR=(a,z)=>sumP(past.filter(b=>{const t=new Date(b.start);return t>=a&&t<z}));
  if(by==="d")for(let i=13;i>=0;i--){const a=new Date(+d0-i*864e5);out.push({l:i?String(a.getDate()):"Today",v:inR(a,new Date(+a+864e5))})}
  if(by==="w"){const mon=new Date(+d0-((d0.getDay()+6)%7)*864e5);for(let i=11;i>=0;i--){const a=new Date(+mon-i*7*864e5);out.push({l:i?`${a.getDate()} ${MON[a.getMonth()]}`:"This wk",v:inR(a,new Date(+a+7*864e5))})}}
  if(by==="m")for(let i=5;i>=0;i--){const a=new Date(d0.getFullYear(),d0.getMonth()-i,1);out.push({l:MON[a.getMonth()],v:inR(a,new Date(d0.getFullYear(),d0.getMonth()-i+1,1))})}
  return out}
// the headline is the whole span; the change compares the last full period with the one before (a period that has
// only just started would always look like a drop)
function earnCard(past){const pts=earned(past,earnBy),full=pts.at(-2)?.v||0,prev=pts.at(-3)?.v,ch=pctCh(full,prev),tot=pts.reduce((a,p)=>a+p.v,0);
  const per={d:"yesterday",w:"last full week",m:"last full month"}[earnBy],span={d:"last 14 days",w:"last 12 weeks",m:"last 6 months"}[earnBy];
  return U.card({title:"Earned",span:7,size:"wide",link:U.segmented([["d","Days"],["w","Weeks"],["m","Months"]],earnBy,"Period"),
    body:`<div class="mx-big"><b>${money(tot)}</b><span class="mx-ctx">${span} · ${per} ${money(full)}</span>${U.trend(ch,{vs:"vs the one before"})}</div>${U.columns(pts,{pre:"$",h:250})}${earnMore(past,pts)}`})}
// under the chart: the figures an owner asks next, then which services the money came from
function earnMore(past,pts){const done=pts.slice(0,-1),best=done.reduce((m,p)=>p.v>m.v?p:m,{v:0,l:"–"}),avg=done.length?done.reduce((a,p)=>a+p.v,0)/done.length:0;
  const unit={d:"day",w:"week",m:"month"}[earnBy],cur=pts.at(-1)?.v||0,el=earnBy==="d"?1:earnBy==="w"?(((new Date().getDay()+6)%7)+1)/7:new Date().getDate()/new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();
  const n=past.length,perVisit=n?sumP(past)/n:0,proj=el>0?cur/el:0;
  const by={};past.forEach(b=>{const k=b.service||"Other";by[k]=(by[k]||0)+(+b.price||0)});const tot=Object.values(by).reduce((a,v)=>a+v,0)||1;
  const top=Object.entries(by).sort((a,b)=>b[1]-a[1]),list=top.slice(0,4).concat(top.length>4?[["Other",top.slice(4).reduce((a,[,v])=>a+v,0)]]:[]);
  const col=i=>`var(--mx-s${i%5+1})`;
  return `<div class="er-k"><div><small>Best ${unit}</small><b>${money(best.v)}</b><span>${e(best.l)}</span></div><div><small>Average ${unit}</small><b>${money(avg)}</b><span>${done.length} ${unit}s</span></div>
    <div><small>Per visit</small><b>${money(perVisit)}</b><span>${n} visits</span></div><div><small>This ${unit} on pace for</small><b>${money(proj)}</b><span>${proj>=avg?"above":"below"} average</span></div></div>
    <div class="er-mix"><small>Where it came from</small><div class="er-bar">${list.map(([k,v],i)=>`<span style="width:${v/tot*100}%;background:${col(i)}" title="${e(k)}: ${money(v)}"></span>`).join("")}</div>
    <div class="er-leg">${list.map(([k,v],i)=>`<span><i style="background:${col(i)}"></i>${e(k)} <b>${Math.round(v/tot*100)}%</b></span>`).join("")}</div></div>`+weekdays(past)}
// revenue by weekday: which days earn the most, for staffing and offers
function weekdays(past){const w=[0,0,0,0,0,0,0];past.forEach(b=>{w[new Date(b.start).getDay()]+=(+b.price||0)});const o=[1,2,3,4,5,6,0],mx=Math.max(1,...w),top=w.indexOf(Math.max(...w));
  return `<div class="er-mix"><small>Revenue by weekday · best ${DOW[top]}</small><div class="er-wd">${o.map(d=>`<div><i style="height:${Math.max(4,w[d]/mx*100)}%"${d===top?' class="best"':""}></i><span>${DOW[d].slice(0,2)}</span></div>`).join("")}</div></div>`}
// the appointments ahead, as a table: today, or the next 7 days
function apptTable(all){const now=new Date(),d0=new Date(now.toDateString()),end=new Date(+d0+(tblBy==="today"?1:7)*864e5);
  const rows=all.filter(b=>{const t=new Date(b.start);return t>=d0&&t<end}).sort((a,b)=>new Date(a.start)-new Date(b.start));
  const st=b=>new Date(b.end||b.start)<now?U.chip("Done","healthy"):/pending|request/.test(b.status||"")?U.chip("Waiting","warning"):U.chip("Confirmed");
  const init=n=>String(n||"C").split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase();
  const when=b=>{const t=new Date(b.start);return `${tblBy==="today"?"":DOW[t.getDay()].slice(0,3)+" "}${hm(b.start)}`};
  return U.card({title:"Appointments ahead",span:7,size:"wide",meta:`${rows.length} · ${money(sumP(rows))}`,link:U.segmented([["today","Today"],["week","Next 7 days"]],tblBy,"Range"),
    body:U.table(["Client","Service","When","Status","Price"],rows.slice(0,10).map(b=>({go:"p:calendar:0",cells:[{html:`<span class="who"><i>${e(init(b.customer))}</i>${e(b.customer||"Client")}</span>`},b.service||"",when(b),{html:st(b)},money(b.price)]})),
      tblBy==="today"?"No appointments today":"Nothing booked in the next 7 days")+(rows.length>10?`<p class="mx-more">${rows.length-10} more in Calendar</p>`:"")})}
// revenue by service over the chosen days, as rings with their shares
function svcCard(past){const from=Date.now()-svDays*864e5,by={};past.filter(b=>+new Date(b.start)>=from).forEach(b=>{const k=b.service||"Other";by[k]=(by[k]||0)+(+b.price||0)});
  const items=Object.entries(by).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);
  return U.card({title:"Revenue by service",span:5,size:"wide",cls:"td-sv",link:U.segmented([["7","7 days"],["30","30 days"],["90","90 days"]],String(svDays),"Period"),body:items.length?U.rings(items,money)+svcTable(past,from,items):U.empty(`No visits in the last ${svDays} days`)})}
function svcTable(past,from,items){const tot=items.reduce((a,x)=>a+x.value,0)||1,n={};past.filter(b=>+new Date(b.start)>=from).forEach(b=>{const k=b.service||"Other";n[k]=(n[k]||0)+1});
  return `<div class="er-tb">${U.table(["Service","Visits","Avg","Share"],items.slice(0,6).map(x=>({cells:[x.label,String(n[x.label]||0),money(x.value/(n[x.label]||1)),`${Math.round(x.value/tot*100)}%`]})))}</div>`}
// bookings per day over the chosen days, against the same length of time before
function bookingsCard(hist){const d0=new Date(new Date().toDateString()),n=bkDays,per=[],lab=[],inD=(a,z)=>(hist.all||[]).filter(b=>{const t=new Date(b.start);return t>=a&&t<z}).length;
  for(let i=n-1;i>=0;i--){const a=new Date(+d0-i*864e5);per.push(inD(a,new Date(+a+864e5)));lab.push(`${a.getDate()} ${MON[a.getMonth()]}`)}
  const prev=inD(new Date(+d0-(2*n-1)*864e5),new Date(+d0-(n-1)*864e5)),tot=per.reduce((a,b)=>a+b,0);
  return U.card({title:"Bookings",span:6,size:"wide",cls:"td-bk",link:U.segmented([["7","7 days"],["30","30 days"],["90","90 days"]],String(n),"Period"),
    body:`<div class="mx-big"><b>${tot}</b>${U.trend(pctCh(tot,prev),{vs:`vs the ${n} days before`})}<span class="mx-ctx">visits, last ${n} days</span></div>${U.area(per,lab,{h:180})}${bkStrip(hist,per,lab,n)}`})}
function bkStrip(hist,per,lab,n){const mx=Math.max(...per),wd=[0,0,0,0,0,0,0],d0=Date.now()-n*864e5;(hist.all||[]).forEach(b=>{const t=new Date(b.start);if(+t>=d0&&+t<=Date.now())wd[t.getDay()]++});
  const top=wd.indexOf(Math.max(...wd));return strip([["Busiest day",String(mx),lab[per.indexOf(mx)]],["Average per day",(per.reduce((a,b)=>a+b,0)/n).toFixed(1),`over ${n} days`],["Busiest weekday",DOW[top].slice(0,3),`${wd[top]} visits`]])}
// busy hours: weekdays × opening hours, counted from the last 180 days of visits
function busy(past){const H=[10,11,12,13,14,15,16,17,18,19],D=[1,2,3,4,5,6,0],g=D.map(()=>H.map(()=>0));
  past.forEach(b=>{const t=new Date(b.start),r=D.indexOf(t.getDay()),c=H.indexOf(t.getHours());if(r>=0&&c>=0)g[r][c]++});
  return U.heat(g,D.map(x=>DOW[x].slice(0,3)),H.map(h=>h%2?"":String(h)))}

function draw(x){last=x;const {biz,live,ch,wait,brief,cal,kpis,month,hist,team}=x;
  const now=live.now||{},d=new Date(),h=d.getHours(),ai=live.ai||{};
  // header
  const logo=$("#tdLogo");logo.style.backgroundImage=biz.logo_url?`url("${biz.logo_url}")`:"";logo.textContent=biz.logo_url?"":([...biz.name][0]||"").toUpperCase();
  $("#tdDate").textContent=`${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} · ${openNow(biz)}`;
  $("#tdHello").innerHTML=`${h<12?"Good morning":h<18?"Good afternoon":"Good evening"}, <em>${e(biz.name)}</em>`;

  // band 1 · needs your attention (with the recommended action on top) beside what was earned
  const need=[],n=k=>(wait.items||[]).filter(x=>x.kind===k).length;
  if(now.waiting)need.push(["critical",`${now.waiting} chat${now.waiting>1?"s":""} waiting for a person`,`${nora()} handed them to you`,"Reply","p:inbox:1"]);
  if(ai.ok===false)need.push(["critical",`${nora()} is not answering`,"Clients get a fallback message","Check","p:pulse:0"]);
  const failed=(live.h24||[]).reduce((a,x)=>a+(x.failed||0),0);if(failed)need.push(["critical",`${failed} repl${failed>1?"ies":"y"} failed to send today`,"Clients may not have seen the answer","Check","p:inbox:0"]);
  if(n("request"))need.push(["warning",`${n("request")} request${n("request")>1?"s":""} to move or cancel`,"Waiting for your OK","Review","p:calendar:1"]);
  if(n("question")||now.unsure){const q=n("question")||now.unsure;need.push(["warning",`${q} question${q>1?"s":""} ${nora()} couldn't answer`,"Answer once and it remembers","Teach","p:pulse:0"])}
  if(n("agent"))need.push(["warning",`${n("agent")} offer${n("agent")>1?"s":""} ready to send`,"Prepared by your growth automations","Review","p:growth:5"]);
  if(n("lesson"))need.push(["neutral",`${n("lesson")} suggested rule${n("lesson")>1?"s":""}`,`${nora()} learned something from a chat`,"Review","p:pulse:0"]);
  const wa=ch?.whatsapp?.configured&&biz.wa_phone_number_id;if(!wa)need.push(["warning","WhatsApp is not connected","Clients can't reach you there yet","Connect","p:settings:0"]);
  const pending=(live.setup||[]).filter(s=>!s.done);
  const worst=need.some(x=>x[0]==="critical")?"critical":need.some(x=>x[0]==="warning")?"warning":"healthy";
  let rec=null;const b0=(brief.items||[])[0];
  const OPEN={inbox:"p:inbox:1",requests:"p:calendar:1"};
  if(b0)rec={text:b0.text,why:b0.why+(b0.value?` · ${money(b0.value)} ${b0.money||""}`:""),label:/^(mark|teach)$/.test(b0.fix)?"Fix it":"Open",go:b0.fix.startsWith("open:")?(OPEN[b0.fix.slice(5)]||"p:inbox:0"):b0.fix==="teach"?"p:pulse:3":b0.fix.startsWith("agent:")?"p:growth:5":"p:calendar:0"};
  if(!rec){const ahead=(live.week||[]).filter(w=>!w.today&&w.pct!=null&&new Date(w.d+"T12:00")>d).sort((a,b)=>a.pct-b.pct)[0];
    if(ahead&&ahead.pct<50)rec={text:`${DOW[new Date(ahead.d+"T12:00").getDay()]} ${ahead.pct?`is only ${ahead.pct}% booked`:"has no bookings yet"}. Invite clients who haven't been in for a while.`,why:"An empty hour can't be sold later.",label:"Open Win back",go:"p:growth:1"}}
  if(!rec&&pending.length)rec={text:`Finish setup: ${pending[0].label}.`,why:`${pending.length} step${pending.length>1?"s":""} left before ${nora()} works at full strength.`,label:"Open Settings",go:"p:settings:0"};
  if(rec&&need[0]?.[0]==="critical"&&rec.go===need[0][4])rec=null; // the top of the list already says it
  const recRow=rec?`<div class="mx-rec-row"><p>${e(rec.text)}<small>${e(rec.why)}</small></p>${rec.go?U.button(rec.label,rec.go):""}</div>`:"";
  // your team today: each agent's read of their area and their next task; a tile opens that task. Problems no
  // agent owns (the AI down, failed sends, WhatsApp not connected) sit above the team as one line each
  const sys=need.filter(([s,t])=>s==="critical"&&!/chat/.test(t)||/WhatsApp/.test(t)).slice(0,2);
  const open=(team||[]).reduce((a,m)=>a+(m.open||0),0);
  const tiles=(team||[]).map((m,k)=>{const t=m.tasks[0],tn=window.PVTeam?.tone?.[t?.tone];
    return `<button type="button" class="tm-tile" data-tm="${k}"><span class="tm-who"><i class="tm-av" style="background:${m.color}">${e(m.name[0])}</i><span><b>${e(m.name)}</b><small>${e(m.role)}</small></span>${m.open?U.chip(`${m.open} open`,tn?.[1]||"warning"):U.chip("All clear","healthy")}</span>
      <p class="tm-say">${e(m.advice||"")}</p>${t?`<span class="tm-next">Next: ${e(t.title)}</span>`:""}</button>`}).join("");
  const needCard=U.card({title:"Your team today",span:5,size:"wide",state:open?worst:"healthy",meta:open?`${open} open`:"all clear",link:U.link("Board","p:growth:5"),
    body:sys.map(([,t,sub,btn,go])=>`<div class="tm-alert"><b>${e(t)}</b>${U.button(btn,go)}</div>`).join("")+(tiles?`<div class="tm-grid">${tiles}</div>`:`<div class="mx-list">${need.slice(0,5).map(([s,t,sub,btn,go])=>U.row({dot:s,title:t,sub,action:U.button(btn,go)})).join("")}</div>`)});
  const nowT=Date.now(),next=(hist.all||[]).filter(b=>+new Date(b.start)>nowT&&!/cancel/.test(b.status||"")).sort((a,b)=>new Date(a.start)-new Date(b.start)).slice(0,3);
  const upNext=next.length?`<div class="tm-next-up"><small>Coming up next</small>${next.map(b=>`<div><b>${hm(b.start)}</b><span>${e(b.customer||"Client")}</span><em>${e(b.service||"")}</em></div>`).join("")}</div>`:"";
  $("#tdA").innerHTML=needCard.replace(/<\/section>\s*$/,upNext+"</section>")+earnCard(hist.past||[]);

  // band 2 · bookings over 30 days beside the AI front desk and the busy hours
  const d0=new Date(d.toDateString());
  const bookCard=bookingsCard(hist);
  const sum=f=>kpis.reduce((a,x)=>a+(f(x)||0),0),chats=sum(x=>x.chats),handled=sum(x=>x.handled),ms=kpis.filter(x=>x.reply_ms!=null),avg=ms.length?ms.reduce((a,x)=>a+x.reply_ms,0)/ms.length:null;
  const aiCard=U.card({title:`${nora()}, your front desk`,span:6,size:"wide",link:U.link("AI Control","p:pulse:0"),
    body:`<div class="mx-tiles"><div><b>${chats?Math.round(handled/chats*100)+"%":"–"}</b><span>answered alone</span></div><div><b>${avg?(avg/1000).toFixed(1)+"s":"–"}</b><span>average reply</span></div><div><b>${money(now.ai_value||0)}</b><span>booked by ${e(nora())}</span></div><div><b>${now.replies_today||0}</b><span>replies today</span></div></div>
      <p class="mx-ctx" style="margin:6px 0 0">Busiest hours, last 6 months</p>${busy(hist.past||[])}`});
  $("#tdB").innerHTML=bookCard+aiCard;

  // band 3 · four headline figures, each with its change
  const m0=new Date(d.getFullYear(),d.getMonth(),1),paid=month.filter(b=>b.status!=="cancelled"&&new Date(b.start)<=d); // same rule as the Insights goal
  const lastM=paid.filter(b=>new Date(b.start)<m0).reduce((a,b)=>a+(+b.price||0),0),thisM=paid.filter(b=>new Date(b.start)>=m0).reduce((a,b)=>a+(+b.price||0),0);
  const target=Math.round(lastM*1.1),dim=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(),pace=Math.round(thisM/Math.max(1,d.getDate())*dim);
  const past=hist.past||[],t30=+d0-29*864e5,t60=+d0-59*864e5,c30=past.filter(b=>+new Date(b.start)>=t30),p30=past.filter(b=>{const t=+new Date(b.start);return t>=t60&&t<t30});
  const v1=c30.length?sumP(c30)/c30.length:0,v0=p30.length?sumP(p30)/p30.length:0;
  const firstSeen={};past.forEach(b=>{const k=b.customer||b.phone;if(k){const t=+new Date(b.start);firstSeen[k]=Math.min(firstSeen[k]??t,t)}});
  const newC=Object.values(firstSeen).filter(t=>t>=t30).length;
  $("#tdC").innerHTML=[
    U.kpi({title:"Clients",value:String((hist.cust||[]).length),ctx:`${newC} new in the last 30 days`,state:"neutral"}),
    U.kpi({title:"Booked ahead",value:money(now.upcoming_value||0),ctx:`${now.upcoming_count||0} upcoming visits`,state:"neutral"}),
    U.kpi({title:"Average visit value",value:money(v1),ctx:"last 30 days",change:pctCh(v1,v0),vs:"vs 30 days before",state:"neutral"}),
    U.kpi({title:"Monthly goal",value:target?`${Math.round(thisM/target*100)}%`:"–",ctx:target?`${money(thisM)} of ${money(target)}`:"set after your first full month",
      why:!target?"":d.getDate()<7?"Too early to judge the pace":pace>=target?`On pace for ${money(pace)}`:`${money(target-pace)} behind pace`,state:!target||d.getDate()<7?"neutral":pace>=target?"healthy":"warning"})].join("");

  // band 4 · the appointments ahead
  $("#tdD").innerHTML=svcCard(hist.past||[])+apptTable(hist.all||[]);

  // no Go live card: unfinished setup still shows as the recommended action in Needs your attention
  $("#tdLive").innerHTML=false?U.card({title:"Go live",span:12,state:"warning",size:"compact",meta:`${(live.setup||[]).length-pending.length} of ${(live.setup||[]).length} done`,
    body:`<p class="mx-ctx">Finish these so clients can reach ${e(nora())}.</p><div class="td-steps">${pending.map(s=>U.button(s.label,"p:settings:0")).join("")}</div>`}):"";
  const todays=(cal.bookings||[]).filter(b=>!/cancel/.test(b.status||"")),tasks=need.filter(x=>x[0]!=="neutral").length;
  $("#tdSub").textContent=`${todays.length} appointment${todays.length===1?"":"s"} today · ${tasks?`${tasks} thing${tasks>1?"s":""} need${tasks===1?"s":""} you`:"nothing waiting for you"}.`;
  since()}
// since you last checked: one calm line, each part opens where it is handled; nothing new says so
async function since(){const el=$("#tdSince");if(!el)return;let c;try{c=await req("/api/changes")}catch{c=null}if(!c||!c.since){el.textContent="";return}
  const pl=(n,w)=>`${n} ${w}${n===1?"":"s"}`,when=new Date(c.since),ago=Date.now()-when,hrs=Math.round(ago/36e5);
  const label=ago<36e5*20?`Since ${String(when.getHours()).padStart(2,"0")}:${String(when.getMinutes()).padStart(2,"0")}`:hrs<48?"Since yesterday":`Since ${when.getDate()}/${when.getMonth()+1}`;
  const parts=[c.bookings&&[`${pl(c.bookings,"new booking")}${c.by_ai?` (${c.by_ai} by ${e(nora())})`:""}`,"p:calendar:0"],c.messages&&[pl(c.messages,"client message"),"p:inbox:0"],
    c.clients&&[pl(c.clients,"new client"),"p:customers:0"],c.reviews&&[pl(c.reviews,"new review"),"p:customers:3"]].filter(Boolean);
  el.innerHTML=`<b>${label}:</b> `+(parts.length?parts.map(([t,g])=>`<button type="button" class="tdh-chg" data-go="${g}">${t}</button>`).join(" · "):"nothing new.")}

// every button goes to the right place: p:page:tab, c:conversation, or a named action
function go(where){
  if(where.startsWith("p:")){const [,id,i]=where.split(":");return window.P10?.go(id,+i)}
  if(where.startsWith("c:")){window.P10?.go("inbox",0);setTimeout(()=>window.PulseInbox?.openChat(where.slice(2)),500);return}
  if(where==="ask")return window.P10?window.P10.go("pulse",1):document.getElementById("hxAsk")?.click();
  if(where==="settings")return window.P10?.go("settings",0);
  if(where==="reload")return load(true);
  if(where==="newbooking"){window.P10?.go("calendar",0);setTimeout(()=>$("#calNew")?.click(),450)}}
sec.addEventListener("click",ev=>{const tm=ev.target.closest("[data-tm]");if(tm&&last){const m=last.team[+tm.dataset.tm],t=m?.tasks[0];if(t)window.P10?.go(...t.go);else window.PulseCommand?.open(m?.ask);return}
  const sg=ev.target.closest("[data-seg]");if(sg&&last){const v=sg.dataset.seg;if(sg.closest(".td-bk")){bkDays=+v;sg.closest(".mx-card").outerHTML=bookingsCard(last.hist);return}if(sg.closest(".td-sv")){svDays=+v;sg.closest(".mx-card").outerHTML=svcCard(last.hist.past||[]);return}
  if(["d","w","m"].includes(v)){earnBy=v;$("#tdA").lastElementChild.outerHTML=earnCard(last.hist.past||[])}else{tblBy=v;$("#tdD").lastElementChild.outerHTML=apptTable(last.hist.all||[])}return}
  const b=ev.target.closest("[data-go]");if(b){ev.stopPropagation();go(b.dataset.go)}});
sec.addEventListener("keydown",ev=>{if((ev.key==="Enter"||ev.key===" ")&&ev.target.matches(".mx-row[data-go],tr[data-go]")){ev.preventDefault();go(ev.target.dataset.go)}});

// open Today on start (unless another page was asked for), once the login is known
const start=setInterval(()=>{if(window.LAB){clearInterval(start);return}if(typeof me!=="undefined"&&me&&me.business){clearInterval(start);if(!$("#overview").hidden||document.body.dataset.page==="overview"||!document.body.dataset.page)show()}},150);
setTimeout(()=>clearInterval(start),10000);
})();
