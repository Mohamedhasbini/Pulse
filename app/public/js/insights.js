// Insights. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- insights ----------
const plural=(n,w)=>`${n} ${w}${n===1?"":"s"}`;
let inDays=30,inData=null,inSampleOn=false;
const DAYNAME=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const pct=(a,b)=>b?Math.round(a/b*100)+"%":"—";
const barRow=(label,v,max,right,style="")=>`<div><div class="lbl"><span>${label}</span><b class="num">${right}</b></div><div class="bar"><i style="width:${max?Math.min(100,v/max*100):0}%;${style}"></i></div></div>`;
const delta=(now,prev,invert)=>{if(!prev&&!now)return"";if(!prev)return`<span class="delta">new</span>`;const c=(now-prev)/prev;if(Math.abs(c)<0.005)return`<span class="k-sub">same as before</span>`;
  const good=invert?c<0:c>0;return`<span class="delta ${good?"":"neg"}">${c>0?"↑":"↓"} ${Math.abs(Math.round(c*100))}% vs previous ${inDays===365?"year":inDays+" days"}</span>`};
async function loadInsights(){if(inSampleOn)return renderInsights(sampleInsights());try{inData=await req("/api/insights?days="+inDays);renderInsights(inData)}catch(e){toast(e.message)}}
function renderInsights(d){window.inD=d;const t=d.totals,p=d.prev,past=t.completed+t.no_show,ppast=p.completed+p.no_show,ret=d.customers.returning,nw=d.customers.new,empty=!t.bookings&&!d.conversations;
  $("#inBanner").hidden=!inSampleOn;$("#inSample").hidden=inSampleOn||t.bookings>=3;
  $("#inSub").textContent=empty?"No bookings or chats in this period yet. Everything below fills in automatically.":`Last ${d.days===365?"12 months":d.days+" days"}: ${plural(t.bookings,"booking")}, ${plural(d.conversations,"conversation")}, ${plural(t.customers,"customer")}.`;
  const k=(l,v,sub,hero)=>`<div class="kpi glass${hero?" hero":""}"><span class="k-l">${l}</span><span class="v num">${v}</span>${sub}</div>`;
  const cap=d.capacity.past;
  $("#inKpis").innerHTML=k("Revenue",fmt(t.revenue),delta(t.revenue,p.revenue)||`<span class="delta">${t.bookings} bookings</span>`,1)
    +k("Bookings",t.bookings,delta(t.bookings,p.bookings)||`<span class="k-sub">—</span>`)
    +k("Average ticket",t.bookings?fmt(t.avg_ticket):"—",delta(t.avg_ticket,p.avg_ticket)||`<span class="k-sub">per booking</span>`)
    +k("Capacity used",cap===null?"—":Math.round(cap*100)+"%",`<span class="k-sub">${cap===null?"set opening hours in Setup":"of your open hours were booked"}</span>`)
    +k("No-show rate",past?pct(t.no_show,past):"—",past?delta(t.no_show/past,ppast?p.no_show/ppast:0,true)||`<span class="k-sub">${t.no_show} of ${past}</span>`:`<span class="k-sub">mark bookings Came / No-show</span>`)
    +k("Returning customers",ret+nw?pct(ret,ret+nw):"—",`<span class="k-sub">${ret} returning · ${nw} new</span>`);
  // trend: revenue bars + bookings line + chats dots
  const svg=$("#inTrend"),W=Math.max(320,Math.round(svg.clientWidth/(svg.clientHeight||240)*220)),H=220,l=40,r=30,top=12,bt=24,n=d.trend.length;
  // Round axis tops to 1, 2 or 5 x 10^n so the labels read as real amounts.
  const niceTop=v=>{const e=10**Math.floor(Math.log10(v)),m=v/e;return (m<=1?1:m<=2?2:m<=5?5:10)*e};
  const rawR=Math.max(0,...d.trend.map(x=>x.revenue)),maxR=rawR?niceTop(rawR):1,maxB=niceTop(Math.max(4,...d.trend.map(x=>Math.max(x.bookings,x.chats))));
  const X=i=>l+(n<2?0:i*(W-l-r)/(n-1)),bw=Math.max(2,Math.min(18,(W-l-r)/Math.max(n,1)*.6)),YR=v=>H-bt-v/maxR*(H-bt-top),YB=v=>H-bt-v/maxB*(H-bt-top);
  let g="";for(let i=0;i<=4;i++){const v=maxR*i/4;g+=`<line x1="${l}" x2="${W-r}" y1="${YR(v)}" y2="${YR(v)}" stroke="var(--grid)"/><text x="${l-6}" y="${YR(v)+4}" text-anchor="end">${rawR?fmt(v):""}</text><text x="${W-r+6}" y="${YB(maxB*i/4)+4}">${Math.round(maxB*i/4)}</text>`}
  d.trend.forEach((x,i)=>{if(x.revenue)g+=`<rect x="${X(i)-bw/2}" y="${YR(x.revenue)}" width="${bw}" height="${H-bt-YR(x.revenue)}" rx="3" fill="url(#revFill)"><title>${x.d}: ${fmt(x.revenue)}</title></rect>`});
  if(n>1)g+=`<polyline points="${d.trend.map((x,i)=>X(i)+","+YB(x.bookings)).join(" ")}" fill="none" stroke="#3ee0ff" stroke-width="2.25" stroke-linejoin="round"/><polyline points="${d.trend.map((x,i)=>X(i)+","+YB(x.chats)).join(" ")}" fill="none" stroke="#e0a400" stroke-width="1.75" stroke-dasharray="3 4"/>`;
  const ticks=n<=8?d.trend.map((_,i)=>i):[0,Math.round((n-1)/3),Math.round(2*(n-1)/3),n-1];
  ticks.forEach(i=>g+=`<text x="${X(i)}" y="${H-6}" text-anchor="${i===0?"start":i===n-1?"end":"middle"}">${nice(L(d.trend[i].d),{day:"numeric",month:"short"})}</text>`);
  svg.setAttribute("viewBox",`0 0 ${W} ${H}`);svg.innerHTML=`<defs><linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d65cff"/><stop offset="1" stop-color="#5b8cff"/></linearGradient></defs>`+g+(rawR?"":`<text x="${l}" y="${top+12}" fill="var(--muted)">No paid revenue in this period yet</text>`);$("#inTrendNote").textContent=d.unit==="week"?"per week":"per day";
  const c7=d.capacity.next7;
  $("#inAhead").innerHTML=`<div class="statrow" style="grid-template-columns:1fr 1fr;margin:0"><div><b style="color:var(--good)">${fmt(d.upcoming.next7.revenue)}</b>next 7 days · ${d.upcoming.next7.n} bookings</div><div><b style="color:var(--good)">${fmt(d.upcoming.next30.revenue)}</b>next 30 days · ${d.upcoming.next30.n} bookings</div></div>
    <div class="fun" style="margin-top:16px">${barRow("Next 7 days booked",c7||0,1,c7===null?"closed":`${Math.round((c7||0)*100)}% · ${d.capacity.bookedHoursNext7} of ${d.capacity.openHoursNext7} h`)}</div>
    <p class="sub" style="font-size:13px;margin:12px 0 0">${c7===null?"No opening hours next week.":c7<.3?"Plenty of free time next week. A good moment for an offer.":c7>.85?"Almost full. Consider extra hours.":"Healthy. Keep an eye on quiet days."}</p>`;
  const lv={good:"var(--good)",bad:"var(--bad)",info:"var(--blue)"};
  $("#inRecs").innerHTML=d.recommendations.map(r=>`<div class="ins"><span class="dot" style="--c:${lv[r.level]}"></span><div><b>${esc(r.title)}</b>${esc(r.text)}</div></div>`).join("");
  // heatmap of booked hours
  let a=24,b=0;for(let x=0;x<7;x++)(d.hoursOpen?.[x]||[]).forEach(([s1,e1])=>{a=Math.min(a,+s1.slice(0,2));b=Math.max(b,+e1.slice(0,2))});d.heat.forEach(h=>{a=Math.min(a,h.hour);b=Math.max(b,h.hour+1)});if(a>=b){a=9;b=20}
  const hrs=[];for(let x=a;x<b;x++)hrs.push(x);const hm2={},hmx=Math.max(1,...d.heat.map(h=>h.n));d.heat.forEach(h=>hm2[h.dow+"-"+h.hour]=h.n);
  let hh=`<span></span>`+hrs.map(x=>`<span style="justify-content:center">${x}</span>`).join("");
  [1,2,3,4,5,6,0].forEach(dw=>{hh+=`<span>${DAYNAME[dw].slice(0,3)}</span>`;hrs.forEach(x=>{const v=hm2[dw+"-"+x]||0,open=(d.hoursOpen?.[dw]||[]).some(([s1,e1])=>x>=+s1.slice(0,2)&&x<+e1.slice(0,2));
    hh+=`<i title="${DAYNAME[dw]} ${x}:00 · ${v} booked${open?"":" · closed"}" style="opacity:${v?(.3+.7*v/hmx).toFixed(2):open?.08:.02}"></i>`})});
  $("#inHeat").style.gridTemplateColumns=`34px repeat(${hrs.length},1fr)`;$("#inHeat").innerHTML=hh;
  const wd=[1,2,3,4,5,6,0].map(dw=>d.weekday.find(x=>x.dow===dw)||{dow:dw,n:0,revenue:0,no_show:0}),mx=Math.max(1,...wd.map(x=>x.revenue)),best=Math.max(...wd.map(x=>x.revenue));
  $("#inDays").innerHTML=`<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;align-items:end;height:210px">${wd.map(x=>`<div style="display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end" title="${DAYNAME[x.dow]}: ${x.n} bookings, ${fmt(x.revenue)}">
      <small class="num" style="color:var(--muted);font-size:11px">${x.revenue?fmt(x.revenue):""}</small><div style="width:100%;max-width:46px;border-radius:10px 10px 4px 4px;height:${Math.max(4,x.revenue/mx*140)}px;background:${x.revenue&&x.revenue===best?"var(--good)":x.revenue?"var(--blue)":"var(--grid)"}"></div>
      <small style="font-size:12px">${DAYNAME[x.dow].slice(0,3)}</small><small class="num" style="color:var(--muted);font-size:11px">${x.n} bk</small></div>`).join("")}</div>`;
  const tot=d.services.reduce((s1,x)=>s1+x.revenue,0),askedOf=nm=>(d.asked.find(x=>x.name===nm)||{n:0}).n;
  $("#inSvc").innerHTML=d.services.map(x=>{const all=x.n+x.cancelled,ak=askedOf(x.name);return`<tr><td><b>${esc(x.name)}</b></td><td class="num">${x.n}</td><td class="num" style="color:var(--good)">${fmt(x.revenue)}</td>
    <td><div class="bar" style="width:90px;display:inline-block;vertical-align:middle;margin-right:6px"><i style="width:${tot?x.revenue/tot*100:0}%"></i></div><span class="num">${pct(x.revenue,tot)}</span></td><td class="num">${x.n?fmt(x.revenue/x.n):"—"}</td>
    <td class="num">${x.cancelled?`<span style="color:var(--bad)">${x.cancelled} (${pct(x.cancelled,all)})</span>`:"0"}</td><td class="num">${x.no_show||0}</td><td class="num">${ak}${ak>=3&&ak>2*x.n?' <span class="tag t-hand">asked more than booked</span>':""}</td></tr>`}).join("")||`<tr><td colspan="8" class="empty">Add services in Setup.</td></tr>`;
  const A=d.ai,amx=Math.max(1,A.chats);
  $("#inAi").innerHTML=A.chats?[["Conversations",A.chats],["Answered by the AI",A.answered],["Wanted to book or asked prices",A.intent],["Booked in the chat",A.booked]].map(([nm,v])=>barRow(nm,v,amx,v)).join(""):`<div class="empty">No conversations in this period.</div>`;
  $("#inAiStats").innerHTML=`<div><b>${A.chats?pct(A.booked,A.chats):"—"}</b>Chat → booking</div><div><b>${A.avg_ms?(A.avg_ms/1000).toFixed(1)+"s":"—"}</b>Avg reply</div><div><b>${A.handoff}</b>Sent to staff</div><div><b style="${A.failed?"color:var(--bad)":""}">${A.failed}</b>Failed replies</div>`;
  $("#inLost").innerHTML=d.lost.length?d.lost.map(m=>`<div class="item click" ${m.conversation_id?`data-open="${m.conversation_id}"`:""} style="cursor:pointer"><div class="grow"><b>“${esc(m.text)}”</b><span>${ago(m.at)} · no booking yet</span></div><span class="mini">Read</span></div>`).join(""):`<div class="empty">${A.chats?"Everyone who asked about booking ended up booking. 🎉":"No conversations yet."}</div>`;
  const flagT={complaint:"t-attn",cancel:"t-hand",discount:"t-hand"};
  $("#inTopics").innerHTML=d.topics.length?d.topics.map(g2=>`<div class="item" style="align-items:flex-start"><div class="grow">
      <b>${esc(g2.label)} <span class="tag ${flagT[g2.topic]||"t-faq"}" style="display:inline">${g2.n} message${g2.n>1?"s":""} · ${g2.convs} chat${g2.convs>1?"s":""}</span>${g2.flagged?` <span class="tag t-attn" style="display:inline">${g2.flagged} needed a person</span>`:""}</b>
      ${g2.examples.map(e=>`<span style="white-space:normal;cursor:pointer" ${e.conversation_id?`data-open="${e.conversation_id}"`:""}>“${esc(e.text)}”</span>`).join("")}</div></div>`).join(""):`<div class="empty">No customer messages in this period.</div>`;
  const lmx=Math.max(1,...d.lead.map(x=>x.n)),order=["Same day","1–2 days ahead","3–7 days ahead","More than a week ahead"];
  $("#inLead").innerHTML=d.lead.length?order.map(o=>{const x=d.lead.find(z=>z.bucket===o)||{n:0};return barRow(o,x.n,lmx,x.n)}).join(""):`<div class="empty">No bookings yet.</div>`;
  const CHN={ai:"Chat / WhatsApp (AI)",web:"Online booking page",manual:"Added by staff"},cmx=Math.max(1,...d.channels.map(c=>c.n));
  $("#inChan").innerHTML=d.channels.length?[...d.channels].sort((x,y)=>y.n-x.n).map(c=>barRow(CHN[c.source]||c.source,c.n,cmx,`${c.n} · ${fmt(c.revenue)}`)).join(""):`<div class="empty">No bookings yet.</div>`;
  const v=d.value;
  $("#inCust").innerHTML=`<div class="statrow" style="grid-template-columns:1fr 1fr;margin:0"><div><b>${v.avg_spend?fmt(v.avg_spend):"—"}</b>Avg spent per customer</div><div><b>${v.avg_visits?v.avg_visits.toFixed(1):"—"}</b>Avg visits</div>
    <div><b>${v.days_between?v.days_between+" d":"—"}</b>Between visits</div><div><b>${ret+nw?pct(ret,ret+nw):"—"}</b>Returning</div></div>
    <p class="sub" style="font-size:13px;margin:12px 0 0">Reminders sent: ${d.reminders.sent}${d.reminders.failed?` · <span style="color:var(--bad)">${d.reminders.failed} not sent</span>`:""} · Approval requests: ${d.requests.late_cancel_requests+d.requests.late_move_requests+d.requests.extra_requests}</p>`;
  const who=c=>esc(c.name||c.phone);
  $("#inTop").innerHTML=d.customers.top.map(c=>`<div class="item"><div class="grow"><b>${who(c)}</b><span>${c.visits} visit${c.visits>1?"s":""} · last ${c.last}</span></div><b class="num" style="color:var(--good)">${fmt(c.spent)}</b></div>`).join("")||`<div class="empty">No customers yet.</div>`;
  $("#inRisk").innerHTML=d.customers.atRisk.map(c=>`<div class="item"><div class="grow"><b>${who(c)}</b><span>${c.visits} visits · last ${c.last}</span></div></div>`).join("")||`<div class="empty">Nobody yet. Good sign.</div>`;
  $("#inNoShow").innerHTML=d.customers.repeatNoShow.map(c=>`<div class="item"><div class="grow"><b>${who(c)}</b><span>${c.n} no-shows</span></div></div>`).join("")||`<div class="empty">Nobody missed twice.</div>`}

$("#inSample").onclick=()=>{inSampleOn=true;loadInsights();scrollTo(0,0)};$("#inReal").onclick=()=>{inSampleOn=false;loadInsights()};
addEventListener("resize",()=>{if(!$("#analytics").hidden&&(inData||inSampleOn))renderInsights(inSampleOn?sampleInsights():inData)});

// Made-up numbers for the "Preview with sample data" button. Clearly labelled on screen; never stored.
function sampleInsights(){const n=inDays>90?52:inDays,unit=inDays>90?"week":"day",svcs=(biz?.services||[]).slice(0,6);let seed=7;const rnd=()=>(seed=(seed*9301+49297)%233280)/233280;
  const trend=[...Array(n)].map((_,i)=>{const dt=new Date(bizNow().getTime()-(n-1-i)*(unit==="week"?7:1)*864e5),dow=dt.getDay(),base=dow===0?0:dow===6?1.6:dow===5?1.3:1;const bk=Math.round((unit==="week"?28:4)*base*(0.7+rnd()*0.6));
    return{d:stamp(dt).slice(0,10),bookings:bk,revenue:bk*(38+rnd()*14),chats:Math.round(bk*1.6+rnd()*3)}});
  const tb=trend.reduce((a,x)=>a+x.bookings,0),tr=trend.reduce((a,x)=>a+x.revenue,0),share=[.38,.27,.15,.12,.05,.03];
  return{days:inDays,unit,trend,totals:{bookings:tb,revenue:tr,avg_ticket:tr/tb,cancelled:Math.round(tb*.06),no_show:Math.round(tb*.05),completed:Math.round(tb*.8),customers:Math.round(tb*.55),discounts:tr*.03},
    prev:{bookings:Math.round(tb*.88),revenue:tr*.85,avg_ticket:tr/tb*.97,no_show:Math.round(tb*.08),completed:Math.round(tb*.75),conversations:Math.round(tb*1.4)},
    services:svcs.map((x,i)=>({name:x.name,n:Math.round(tb*(share[i]||.02)),revenue:tr*(share[i]||.02),cancelled:Math.round(tb*(share[i]||.02)*.07),no_show:Math.round(tb*(share[i]||.02)*.05)})),
    weekday:[1,2,3,4,5,6].map(dw=>({dow:dw,n:Math.round(tb/6*(dw===6?1.5:dw===5?1.25:dw===1?.7:1)),revenue:tr/6*(dw===6?1.5:dw===5?1.25:dw===1?.7:1),no_show:1})),
    heat:[1,2,3,4,5,6].flatMap(dw=>[10,11,12,13,14,15,16,17,18,19].map(h=>({dow:dw,hour:h,n:Math.round((h>=16?3:h>=12?2:1.2)*(dw===6?1.6:dw===5?1.3:1)*(1+rnd()))}))),
    capacity:{past:.64,next7:.52,bookedHoursNext7:58,openHoursNext7:112},upcoming:{next7:{n:Math.round(tb/n*7*.6),revenue:tr/n*7*.6},next30:{n:Math.round(tb/n*30*.35),revenue:tr/n*30*.35}},
    ai:{chats:Math.round(tb*1.5),answered:Math.round(tb*1.45),intent:Math.round(tb*1.1),booked:Math.round(tb*.62),handoff:Math.round(tb*.09),failed:1,avg_ms:1900},
    lost:[{text:"How much is a colour for long hair?",conversation_id:0,at:stamp(new Date(bizNow()-3*36e5))},{text:"Do you have anything Saturday morning?",conversation_id:0,at:stamp(new Date(bizNow()-26*36e5))},{text:"بقديش المانيكور والباديكور سوا؟",conversation_id:0,at:stamp(new Date(bizNow()-50*36e5))}],
    value:{avg_spend:132,avg_visits:2.9,days_between:34},lead:[{bucket:"Same day",n:Math.round(tb*.22)},{bucket:"1–2 days ahead",n:Math.round(tb*.38)},{bucket:"3–7 days ahead",n:Math.round(tb*.3)},{bucket:"More than a week ahead",n:Math.round(tb*.1)}],channels:[{source:"ai",n:Math.round(tb*.62),revenue:tr*.6},{source:"web",n:Math.round(tb*.26),revenue:tr*.27},{source:"manual",n:Math.round(tb*.12),revenue:tr*.13}],requests:{late_cancel_requests:4,late_move_requests:6,extra_requests:3},hoursOpen:biz?.hours,
    customers:{new:Math.round(tb*.22),returning:Math.round(tb*.33),top:[["Rana K.",14,812],["Maya S.",11,640],["Nour A.",9,505],["Lina F.",8,470]].map(([name,visits,spent])=>({name,visits,spent,last:stamp(new Date(bizNow()-5*864e5)).slice(0,10)})),
      atRisk:[{name:"Hala M.",visits:5,last:"2026-08-30"},{name:"Dana J.",visits:3,last:"2026-09-04"}],repeatNoShow:[{name:"Omar H.",n:3}]},
    topics:[["booking","Booking & availability",Math.round(tb*.9),"Can I book Saturday at 11?"],["price","Prices",Math.round(tb*.5),"How much is a keratin treatment?"],["location","Location & parking",Math.round(tb*.12),"Where can I park?"],
      ["cancel","Cancel or change a booking",Math.round(tb*.1),"Can I move my booking to Friday?"],["discount","Discounts & offers",Math.round(tb*.07),"Any student discount?"],["complaint","Complaints & bad experiences",2,"I waited 25 minutes last time"]]
      .map(([topic,label,n2,ex])=>({topic,label,n:n2,convs:Math.round(n2*.8),flagged:topic==="complaint"?2:topic==="cancel"?3:0,examples:[{text:ex,conversation_id:0,at:""}]})),
    asked:svcs.map((x,i)=>({name:x.name,n:Math.round(tb*(share[i]||.02)*(i===1?2.6:1.1))})),handoff:Math.round(tb*.09),conversations:Math.round(tb*1.5),reminders:{sent:Math.round(tb*.8),failed:0},currency:biz?.currency||"USD",
    recommendations:[{level:"good",title:"Revenue up 15% vs the previous period",text:"Saturday and Friday drove most of the growth."},{level:"good",title:"Saturday is your best day",text:"Make sure you have enough staff that day."},
      {level:"info",title:"Monday is quiet",text:"Try a Monday-only discount code to fill it (Setup → Discount codes)."},{level:"info",title:`${svcs[1]?.name||"A service"} is asked about far more than it is booked`,text:"Customers may find the price high. Try a bundle or show results on Instagram."},
      {level:"info",title:"3 customers asked but didn't book",text:"Follow up personally: these are warm leads."},{level:"bad",title:"1 customer missed 3 appointments",text:"Ask them to confirm or pay a deposit before booking again."}]}}

