// Overview and Inbox: stats, charts, conversation list and chat view. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- overview ----------
async function refresh(){if(typeof canSee==="function"&&!canSee("overview"))return;
  try{const [s,c]=await Promise.all([req(`/api/stats?days=${days}${testQ()}`),req(`/api/conversations?x=1${testQ()}`)]);
    syncNow(s.now);
    if(lastStats&&s.ai_bookings>lastStats.ai_bookings)toast("New booking from the AI");
    if(lastStats&&s.attention.length>lastStats.attention.length)toast("A customer needs you");
    const sig=JSON.stringify([{...s,now:0},c,days]);if(sig===refresh.sig)return;refresh.sig=sig;lastStats=s;convs=c;render(s)}
  catch(e){if(e.message!=="Signed out")setPill("bad","Dashboard offline",e.message)}}
function setPill(k,t,title=""){const p=$("#aiPill");p.className="pill glass "+k;p.querySelector("span").textContent=t;p.title=title}
function render(s){
  const h=bizNow().getHours();$("#greet").textContent=h<12?"Good morning":h<18?"Good afternoon":"Good evening";
  $("#bizName").textContent=s.business.name;
  const per=days===1?"in the last 24 hours":`in the last ${days} days`;
  $("#subline").textContent=s.conv?`${s.conv} conversation${s.conv>1?"s":""} with ${s.customers} customer${s.customers>1?"s":""} ${per}.`:`No conversations ${per} yet.`;
  const last=s.ai.last;
  if(last&&last.ok===false)setPill("bad",`AI not responding`,`Last error: ${last.error}`);
  else if(s.ai.replies)setPill(s.ai.failures?"bad":"ok",s.ai.failures?`AI · ${s.ai.failures} failed`:`AI online · ${(s.ai.avg_ms/1000).toFixed(1)}s`,"Average reply time this period");
  else setPill("idle","AI: no messages yet");
  tween($("#kVal"),s.ai_value,fmt);
  const plan=s.business.plan_price||79;
  $("#kValSub").textContent=s.ai_bookings?`${s.chat_bookings} by chat · ${s.web_bookings} online · ${(s.ai_value/plan).toFixed(1)}× the ${fmt(plan)} plan`:"No chat or online bookings yet";
  if(s.booking_url&&$("#blUrl")&&!$("#blUrl").dataset.set){$("#blUrl").dataset.set=1;setBookingLink(s.booking_url)}
  tween($("#kConv"),s.conv);$("#kConvSub").textContent=s.conv?`${s.answered} answered · ${s.handoff} sent to staff`:"—";
  $("#kRate").textContent=s.conv?Math.round(s.booked_conv/s.conv*100)+"%":"—";$("#kRateSub").textContent=s.conv?`${s.booked_conv} of ${s.conv} chats ended in a booking`:"No chats yet";
  $("#kMs").textContent=s.ai.avg_ms?(s.ai.avg_ms/1000).toFixed(1)+"s":"—";
  $("#kMsSub").innerHTML=s.ai.replies?(s.ai.failures?`<span style="color:var(--bad)">${s.ai.failures} of ${s.ai.replies} replies failed</span>`:`${s.ai.replies} replies, none failed`):"No replies yet";
  $("#apprN").hidden=!s.approvals;$("#apprN").textContent=s.approvals;
  if(lastStats&&s.to_learn>lastStats.to_learn)toast("The AI couldn't answer a question. See Training.");
  area(s.daily);heat(s.heat);svcBars(s.services);funnel(s);attention(s.attention);today(s.today,s.upcoming);insights(s);feed();
}
function area(d){const el=$("#area"),W=Math.max(320,Math.round(el.clientWidth/(el.clientHeight||240)*200));el.setAttribute("viewBox",`0 0 ${W} 200`);const conv=d.map(x=>x.conv),book=d.map(x=>x.booked),n=d.length,H=200,l=26,b=22,t=10;
  const max=Math.max(4,...conv),step=Math.ceil(max/4),top=step*4,X=i=>n<2?W/2:l+i*(W-l-8)/(n-1),Y=v=>H-b-v/top*(H-b-t);
  const line=a=>a.map((v,i)=>(i?"L":"M")+X(i)+","+Y(v)).join("");
  let s=`<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--blue)" stop-opacity=".3"/><stop offset="1" stop-color="var(--blue)" stop-opacity="0"/></linearGradient></defs>`;
  for(let v=0;v<=top;v+=step)s+=`<line x1="${l}" x2="${W-8}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${l-6}" y="${Y(v)+4}" text-anchor="end">${v}</text>`;
  const ticks=n<=7?d.map((_,i)=>i):[0,Math.round((n-1)/3),Math.round(2*(n-1)/3),n-1];
  ticks.forEach(i=>s+=`<text x="${X(i)}" y="${H-5}" text-anchor="${i===0&&n>1?"start":i===n-1&&n>1?"end":"middle"}">${nice(L(d[i].day),{day:"numeric",month:"short"})}</text>`);
  if(n>1)s+=`<path d="${line(conv)}L${X(n-1)},${Y(0)}L${X(0)},${Y(0)}Z" fill="url(#ga)"/><path d="${line(conv)}" fill="none" stroke="var(--blue)" stroke-width="2"/>`;
  const bw=Math.max(3,Math.min(14,(W-l-8)/n*.45));book.forEach((v,i)=>{if(v)s+=`<rect x="${X(i)-bw/2}" y="${Y(v)}" width="${bw}" height="${H-b-Y(v)}" rx="2" fill="var(--good)"><title>${d[i].day}: ${v} AI bookings</title></rect>`});
  conv.forEach((v,i)=>{if(v)s+=`<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="var(--blue)"><title>${d[i].day}: ${v} conversations</title></circle>`});
  $("#area").innerHTML=s;$("#areaNote").textContent=n===1?"today":`last ${n} days`;
  const sp=conv.slice(-14),mx=Math.max(1,...sp);$("#sp1").innerHTML=`<polyline points="${sp.map((v,i)=>`${i*100/Math.max(1,sp.length-1)},${26-v/mx*24}`).join(" ")}" fill="none" stroke="var(--blue)" stroke-width="2" vector-effect="non-scaling-stroke"/>`}
function heat(rows){let a=24,b=0;for(let d=0;d<7;d++)(biz?.hours?.[d]||[]).forEach(([s,e])=>{a=Math.min(a,+s.slice(0,2));b=Math.max(b,+e.slice(0,2))});
  rows.forEach(r=>{a=Math.min(a,r.hour);b=Math.max(b,r.hour+1)});if(a>=b){a=9;b=21}
  const hrs=[];for(let x=a;x<b;x++)hrs.push(x);const m={},mx=Math.max(1,...rows.map(r=>r.n));rows.forEach(r=>m[r.dow+"-"+r.hour]=r.n);
  let s=`<span></span>`+hrs.map(x=>`<span style="justify-content:center">${x}</span>`).join("");
  [1,2,3,4,5,6,0].forEach(d=>{s+=`<span>${DAYS[d]}</span>`;hrs.forEach(x=>{const v=m[d+"-"+x]||0;s+=`<i title="${DAYS[d]} ${x}:00 · ${v} message${v===1?"":"s"}" style="opacity:${v?(.3+.7*v/mx).toFixed(2):.06}"></i>`})});
  $("#heat").style.gridTemplateColumns=`34px repeat(${hrs.length},1fr)`;$("#heat").innerHTML=s;
  const tot=rows.reduce((a,r)=>a+r.n,0);$("#heatNote").textContent=tot?`${tot} customer messages`:"no messages yet"}
function svcBars(sv){const mx=Math.max(1,...sv.map(x=>x.n));$("#svcBars").innerHTML=sv.map(x=>`<div><div class="lbl"><span>${esc(x.name)}</span><b class="num">${x.n} · ${fmt(x.value)}</b></div><div class="bar"><i style="width:${x.n/mx*100}%"></i></div></div>`).join("")||`<div class="empty">Add services in Business setup.</div>`}
function funnel(s){const f=[["Started a chat",s.conv],["Got an AI answer",s.answered],["Booked",s.booked_conv]],mx=Math.max(1,f[0][1]);
  $("#fun").innerHTML=f.map(([n,v])=>`<div><div class="lbl"><span>${n}</span><b class="num">${v}</b></div><div class="bar"><i style="width:${v/mx*100}%"></i></div></div>`).join("");
  const o=s.outcomes;$("#outcomes").innerHTML=`<div><b>${o.completed}</b>Came</div><div><b>${o.no_show}</b>No-show</div><div><b>${o.cancelled}</b>Cancelled</div><div title="Past bookings not yet marked as came or no-show"><b>${o.unmarked}</b>Not marked</div>`}
function attention(a){$("#attnN").hidden=!a.length;$("#attnN").textContent=a.length;
  $("#attention").innerHTML=a.length?a.map(x=>`<div class="item"><div class="grow"><b>${esc(x.name||x.phone)} <span class="tag t-attn" style="display:inline">${esc(x.attention_reason||"Needs a person")}</span></b><span>"${esc(x.last)}" · ${ago(x.at)}</span></div>
    <div class="acts"><button class="mini" data-open="${x.id}">Open &amp; reply</button><button class="mini" data-resolve="${x.id}">Handled</button></div></div>`).join(""):`<div class="empty">Nothing waiting. The AI is handling everything.</div>`}
function today(t,u){const now=bizNow();$("#todayTitle").textContent="Today · "+nice(now,{weekday:"long",day:"numeric",month:"short"});
  const val=t.reduce((a,b)=>a+b.price,0);$("#todaySub").textContent=t.length?`${t.length} booking${t.length>1?"s":""} · ${fmt(val)}`:"";
  $("#today").innerHTML=t.length?t.map(b=>{const st=L(b.start),past=st<now;return`<div class="item"><span class="time">${hm(st)}</span><div class="grow"><b>${esc(b.customer||"Customer")}</b><span>${esc(b.service)} · ${fmt(b.price)}${b.source==="ai"?" · booked by AI":b.source==="web"?" · booked online":""}</span></div>
    <div class="acts">${b.status==="confirmed"?(past?`<button class="mini" data-mark="${b.id}" data-st="completed">Came</button><button class="mini" data-mark="${b.id}" data-st="no_show">No-show</button>`:`<span class="tag t-faq">Upcoming</span>`):`<span class="tag ${b.status==="completed"?"t-book":"t-attn"}">${b.status==="completed"?"Came":"No-show"}</span>`}</div></div>`}).join(""):`<div class="empty">No bookings today.</div>`;
  const later=u.filter(b=>dayKey(L(b.start))!==dayKey(now));
  $("#upcoming").innerHTML=later.length?later.map(b=>`<div class="item"><span class="time">${nice(L(b.start),{weekday:"short"})}</span><div class="grow"><b>${nice(L(b.start),{day:"numeric",month:"short"})} ${hm(L(b.start))} · ${esc(b.customer||"Customer")}</b><span>${esc(b.service)}${b.source==="ai"?" · booked by AI":b.source==="web"?" · booked online":""}</span></div></div>`).join(""):`<div class="empty">No bookings after today.</div>`}
function insights(s){const out=[];
  if(!s.conv)out.push(["var(--blue)","No conversations yet","Send a message from Test chat or WhatsApp. Everything here updates live."]);
  else{if(s.ai.failures)out.push(["var(--bad)",`${s.ai.failures} AI replies failed`,"Customers got the fallback message. Check that n8n and the AI model are working."]);
    else if(s.ai.avg_ms>8000)out.push(["var(--warn)",`Replies take ${(s.ai.avg_ms/1000).toFixed(0)}s on average`,"That's slow for WhatsApp. A faster or paid AI model would help."]);
    if(s.handoff)out.push(["var(--accent)",`${s.handoff} chat${s.handoff>1?"s":""} needed a person`,"Read them to see what the AI couldn't answer, then add it in Business setup."]);
    const top=s.services.find(x=>x.n);if(top)out.push(["var(--good)",`${top.name} is booked most`,`${top.n} booking${top.n>1?"s":""} worth ${fmt(top.value)}.`]);
    const busy=[...s.heat].sort((a,b)=>b.n-a.n)[0];if(busy)out.push(["var(--blue)",`Busiest: ${DAYS[busy.dow]} around ${busy.hour}:00`,`${busy.n} message${busy.n>1?"s":""} in that hour.`]);
    if(s.outcomes.unmarked)out.push(["var(--warn)",`${s.outcomes.unmarked} past booking${s.outcomes.unmarked>1?"s":""} not marked`,"Mark them Came or No-show so your no-show numbers are right."])}
  $("#insights").innerHTML=out.slice(0,4).map(([c,t,d])=>`<div class="ins"><span class="dot" style="--c:${c}"></span><div><b>${esc(t)}</b>${esc(d)}</div></div>`).join("")}
const OUT={booked:["t-book","Booked"],answered:["t-faq","Answered"],handoff:["t-hand","Sent to staff"]},CH={whatsapp:"WhatsApp",missed_call:"Missed call",test:"Test chat",webook:"WeBook",telegram:"Telegram"};
// what each chat is about, tagged by the AI; the chips above the table (support.js) set convKind
const KIND={booking:["t-book","Booking"],question:["t-faq","Question"],change:["t-faq","Change"],complaint:["t-attn","Complaint"],cancel:["t-hand","Cancel"],other:["t-faq","Other"]};
function feed(){const q=$("#search").value.trim().toLowerCase(),k=window.convKind||"";const rows=convs.filter(r=>(!q||[r.name,r.phone,r.last,r.topic].some(v=>String(v||"").toLowerCase().includes(q)))&&(!k||r.kind===k));
  $("#feed").innerHTML=rows.length?rows.map(r=>{const o=OUT[r.outcome]||["t-faq","Open"];return`<tr class="click" data-open="${r.id}"><td>${ago(r.at)}</td><td>${esc(r.name||(/^test-/.test(r.phone)?"Test customer":r.phone))}</td><td><span class="tag ${r.channel==="test"?"t-test":"t-faq"}">${CH[r.channel]||r.channel}</span></td><td>${r.kind&&KIND[r.kind]?`<span class="tag ${KIND[r.kind][0]}">${KIND[r.kind][1]}</span>`:""}${r.topic?` <small style="color:var(--muted)">${esc(r.topic)}</small>`:""}${r.mood==="negative"?' <span title="Unhappy">☹</span>':""}</td><td><span class="tag ${o[0]}">${o[1]}</span>${r.needs_attention?' <span class="tag t-attn">Needs you</span>':""}</td><td class="num">${r.value?fmt(r.value):"—"}</td><td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(r.last)}</td></tr>`}).join(""):`<tr><td colspan="7" class="empty">${q?"No conversations match.":"No conversations yet. Open Test chat and send the first message."}</td></tr>`}
$("#search").oninput=feed;$("#incTest").onchange=()=>{lastStats=null;refresh()};

let openId=null,openPaused=false;
const ROLE={customer:"me",assistant:"ai",staff:"ai staff"};
function renderConvMsgs(m){$("#mMsgs").innerHTML=m.map(x=>`<div class="m ${ROLE[x.role]||"ai"}${x.failed?" fail":""}">${x.role==="staff"?'<b style="display:block;font-size:11px;color:var(--good)">You (staff)</b>':""}${esc(x.text)}<span class="meta">${hm(L(x.at))}${x.role==="assistant"&&x.latency_ms!=null?` · ${x.failed?"AI failed after":"AI replied in"} ${(x.latency_ms/1000).toFixed(1)}s`:x.role==="assistant"?" · AI":""}${x.role==="staff"&&x.failed?" · not delivered":""}</span></div>`).join("");$("#mMsgs").scrollTop=1e9}
function setAiState(p){openPaused=p;$("#mAiState").textContent=p?"You're handling this chat · AI paused":"AI is answering this chat";$("#mAiState").className="tag "+(p?"t-hand":"t-book");
  $("#mAiToggle").textContent=p?"Hand back to AI":"Take over (pause AI)"}
$("#mAiToggle").onclick=async()=>{await req(`/api/conversations/${openId}/ai`,"POST",{paused:!openPaused});setAiState(!openPaused);toast(openPaused?"You took over. The AI won't reply in this chat.":"Handed back to the AI.");refresh()};
$("#mReply").onsubmit=async e=>{e.preventDefault();const text=$("#mText").value.trim();if(!text)return;$("#mSend").disabled=true;
  try{const r=await req(`/api/conversations/${openId}/reply`,"POST",{text});$("#mText").value="";setAiState(true);
    renderConvMsgs(await req(`/api/conversations/${openId}/messages`));toast(r.warning||"Reply sent.");refresh()}catch(err){toast(err.message)}$("#mSend").disabled=false};
setInterval(async()=>{if($("#modal").hidden||!openId)return;try{renderConvMsgs(await req(`/api/conversations/${openId}/messages`))}catch{}},5000);
async function openConv(id){openId=id;const r=convs.find(x=>x.id===+id),m=await req(`/api/conversations/${id}/messages`);
  $("#mTitle").textContent=r?(r.name||r.phone):"Conversation";$("#mResolve").hidden=!(r&&r.needs_attention||lastStats?.attention.some(a=>a.id===+id));
  renderConvMsgs(m);setAiState(!!(r&&r.ai_paused));$("#mText").value="";$("#modal").hidden=false;setTimeout(()=>$("#mText").focus(),50)}
document.addEventListener("click",async e=>{const o=e.target.closest("[data-open]"),r=e.target.closest("[data-resolve]"),mk=e.target.closest("[data-mark]");
  if(r){await req(`/api/conversations/${r.dataset.resolve}/resolve`,"POST");toast("Marked as handled.");return refresh()}
  if(mk){await req(`/api/bookings/${mk.dataset.mark}`,"PATCH",{status:mk.dataset.st});toast(mk.dataset.st==="completed"?"Marked as came.":"Marked as no-show.");return refresh()}
  if(o)openConv(o.dataset.open)});
$("#mResolve").onclick=async()=>{await req(`/api/conversations/${openId}/resolve`,"POST");$("#modal").hidden=true;toast("Marked as handled.");refresh()};
$("#mClose").onclick=()=>$("#modal").hidden=true;
document.addEventListener("keydown",e=>{if(e.key==="Escape")document.querySelectorAll(".modal").forEach(m=>m.hidden=true)});

