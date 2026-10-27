// Live desk: realtime numbers and small charts. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- glossy UI: page colour and 3D depth ----------
document.body.dataset.page="overview";
// Phones: keep the current section visible in the scrolling bottom bar.
const navCenter=()=>{if(innerWidth<=820)document.querySelector('nav button[aria-current="true"]')?.scrollIntoView({inline:"center",block:"nearest"})};
document.querySelectorAll("nav button[data-view]").forEach(x=>x.addEventListener("click",()=>setTimeout(navCenter,50)));addEventListener("load",()=>setTimeout(navCenter,300));

document.querySelectorAll("nav button[data-view]").forEach(b=>b.addEventListener("click",()=>{document.body.dataset.page=b.dataset.view}));
$("#pwBtn").addEventListener("click",()=>{document.body.dataset.page="security"});

// ---------- live desk ----------
const CHN={whatsapp:"WhatsApp",telegram:"Telegram",webook:"WeBook",web:"Booking page",manual:"Added by staff",test:"Test chat",other:"Other",ai:"Chat"};
const CHC={whatsapp:"#2fd27b",telegram:"#3d8bff",webook:"#ff4fa0",web:"#ffc93c",manual:"#a6a6b0",test:"#74747e",other:"#74747e"};
const OUTN={booked:"Booked",answered:"Answered",handoff:"Sent to you"},OUTC={booked:"#2fd27b",answered:"#3d8bff",handoff:"#ff6a1f"};
let liveSeen=new Set(),liveFirst=true,liveTimer=null,crystalKick=0;
const hhmm=s=>String(s||"").slice(11,16);
function tick(id,v){const el=$("#"+id);if(!el)return;const t=String(v);if(el.textContent!==t){el.textContent=t;el.classList.remove("tick");void el.offsetWidth;el.classList.add("tick")}}
const pctTxt=(a,b)=>b?Math.round((a-b)/b*100):null;
function microDelta(id,a,b){const p=pctTxt(a,b),el=$("#"+id);if(!el)return;el.className=p===null?"":p>=0?"up":"down";el.textContent=p===null?"":`${p>=0?"↑":"↓"} ${Math.abs(p)}%`}
// Micro histogram: thin bars, failures stacked in coral (OpsPulse style)
function microBars(id,vals,fails=[],color="#3d8bff"){const n=vals.length,max=Math.max(1,...vals.map((v,i)=>v+(fails[i]||0))),w=240/n;let g="";
  vals.forEach((v,i)=>{const h=v/max*50,f=(fails[i]||0)/max*50,x=i*w+w*.3,bw=Math.max(1.5,w*.4);
    g+=`<rect x="${x}" y="${54-h}" width="${bw}" height="${Math.max(h,1)}" rx="1" fill="${v?color:"var(--line2)"}"/>`;if(f)g+=`<rect x="${x}" y="${54-h-f}" width="${bw}" height="${f}" rx="1" fill="#ff3b5c"/>`});$("#"+id).innerHTML=g}
function microWave(id,vals,color="#ff6a1f"){const n=vals.length,max=Math.max(1,...vals),pts=vals.map((v,i)=>[i*(240/(n-1)),50-v/max*44]);
  let d=`M${pts[0][0]},${pts[0][1]}`;for(let i=1;i<n;i++){const [x0,y0]=pts[i-1],[x1,y1]=pts[i],cx=(x0+x1)/2;d+=` C${cx},${y0} ${cx},${y1} ${x1},${y1}`}
  $("#"+id).innerHTML=`<defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L240,54 L0,54Z" fill="url(#${id}g)"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`}
function gauge(pct){const r=80,cx=100,cy=104,seg=(a0,a1,c,w=14)=>{const p=a=>[cx+r*Math.cos(Math.PI*(1-a)),cy-r*Math.sin(Math.PI*(1-a))],[x0,y0]=p(a0),[x1,y1]=p(a1);return `<path d="M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`};
  const v=pct===null?0:pct/100;let g=seg(0,1,"var(--line2)");if(v>0)g+=seg(0,Math.max(.02,v),v>.85?"#ff3b5c":v>.5?"#ff6a1f":"#2fe0c4");
  for(let i=0;i<=10;i++){const a=Math.PI*(1-i/10),x0=cx+(r+11)*Math.cos(a),y0=cy-(r+11)*Math.sin(a),x1=cx+(r+16)*Math.cos(a),y1=cy-(r+16)*Math.sin(a);g+=`<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="var(--muted)" stroke-width="1.2"/>`}
  g+=`<text x="100" y="102" text-anchor="middle" class="gv">${pct===null?"Closed":pct+"%"}</text>`;$("#ldGauge").innerHTML=g}
function donut(chs){const tot=chs.reduce((a,c)=>a+c.n,0),R=46,C=2*Math.PI*R;let off=0,g=`<circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--line2)" stroke-width="14"/>`;
  chs.forEach(c=>{const len=c.n/tot*C;g+=`<circle cx="60" cy="60" r="${R}" fill="none" stroke="${CHC[c.channel]||"#ffc93c"}" stroke-width="14" stroke-dasharray="${Math.max(0,len-2)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)" stroke-linecap="butt"/>`;off+=len});
  g+=`<text x="60" y="58" text-anchor="middle" class="dv">${tot}</text><text x="60" y="74" text-anchor="middle" class="dl">bookings</text>`;$("#ldDonut").innerHTML=g;
  $("#ldLegend").innerHTML=tot?chs.map(c=>`<div><i style="background:${CHC[c.channel]||"#ffc93c"}"></i><span>${esc(CHN[c.channel]||c.channel)}</span><b>${Math.round(c.n/tot*100)}%</b><small>${c.n} · ${fmt(c.value)}</small></div>`).join(""):`<p class="sub" style="margin:0">No bookings yet. Each channel shows here as they arrive.</p>`}
function flowChart(rows){const svg=$("#ldFlow");if(!rows.length){svg.innerHTML=`<text x="160" y="85" text-anchor="middle" class="dl">No conversations in the last 30 days yet</text>`;return}
  const tot=rows.reduce((a,r)=>a+r.n,0),H=150,top=10,gap=6;const L=[...new Set(rows.map(r=>r.channel))],R=["booked","answered","handoff"].filter(o=>rows.some(r=>r.outcome===o));
  const sum=(k,v)=>rows.filter(r=>r[k]===v).reduce((a,r)=>a+r.n,0),scale=(H-gap*(Math.max(L.length,R.length)-1))/tot;
  let y=top;const lp={},rp={};L.forEach(c=>{lp[c]={y,h:sum("channel",c)*scale,used:0};y+=lp[c].h+gap});y=top;R.forEach(o=>{rp[o]={y,h:sum("outcome",o)*scale,used:0};y+=rp[o].h+gap});
  let g="";rows.sort((a,b)=>R.indexOf(a.outcome)-R.indexOf(b.outcome)).forEach(r=>{const h=r.n*scale,a=lp[r.channel],b=rp[r.outcome],y0=a.y+a.used,y1=b.y+b.used;a.used+=h;b.used+=h;
    g+=`<path d="M78,${y0} C160,${y0} 160,${y1} 242,${y1} L242,${y1+h} C160,${y1+h} 160,${y0+h} 78,${y0+h}Z" fill="${OUTC[r.outcome]}" opacity=".28"><title>${CHN[r.channel]||r.channel} → ${OUTN[r.outcome]}: ${r.n}</title></path>`});
  L.forEach(c=>g+=`<rect x="70" y="${lp[c].y}" width="8" height="${Math.max(2,lp[c].h)}" rx="2" fill="${CHC[c]||"#ffc93c"}"/><text x="64" y="${lp[c].y+lp[c].h/2+4}" text-anchor="end" class="fl">${esc(CHN[c]||c)}</text>`);
  R.forEach(o=>g+=`<rect x="242" y="${rp[o].y}" width="8" height="${Math.max(2,rp[o].h)}" rx="2" fill="${OUTC[o]}"/><text x="256" y="${rp[o].y+rp[o].h/2+4}" class="fl">${OUTN[o]} ${sum("outcome",o)}</text>`);
  svg.innerHTML=g}
function heatGrid(cells){const m={},max=Math.max(1,...cells.map(c=>c.n));cells.forEach(c=>m[c.dow+"-"+c.h]=c.n);const hrs=[8,10,12,14,16,18,20,22];
  let g=`<span></span>`+hrs.map(h=>`<span class="hx">${h}</span>`).join("");
  ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].forEach((d,i)=>{g+=`<span class="hy">${d}</span>`;hrs.forEach(h=>{const n=(m[(i+1)+"-"+h]||0)+(m[(i+1)+"-"+(h+1)]||0),a=n/max;
    g+=`<i title="${d} ${h}:00–${h+2}:00 · ${n} messages" style="background:${n?`color-mix(in srgb,#ff6a1f ${Math.round(18+a*82)}%,var(--s2))`:"var(--s2)"}"></i>`})});$("#ldHeat").innerHTML=g}
function canSee(m){try{return !me||me.modules.includes(m)}catch{return true}}
// A login without access to a section never asks for its data (staff with limited access).
window.addEventListener("unhandledrejection",e=>{if(/don.t have access|not in your plan|Load failed|access control checks|aborted|Failed to fetch|NetworkError/i.test(e.reason?.message||""))e.preventDefault()});
async function loadLive(){if(!canSee("overview"))return;let d;try{d=await req("/api/live?days="+days)}catch{return}
  {const sig=JSON.stringify([{...d,server_time:0},days]);if(sig===loadLive.sig){$("#ldClock").textContent="updated "+hhmm(d.server_time);return}loadLive.sig=sig}
  const n=d.now;
  $("#ldTitle").textContent=d.ai.ok===false?"Your receptionist can't reach the AI":n.active_now?`Talking with ${n.active_now} ${n.active_now===1?"person":"people"} right now`:"Your receptionist is live";
  $("#ldSub").textContent=d.ai.ok===false?"Customers still get instant answers from your FAQs and a note that you'll reply.":`${n.msgs_today} message${n.msgs_today===1?"":"s"} today${n.waiting?` · ${n.waiting} waiting for you`:""}${n.avg_ms?` · ${(n.avg_ms/1000).toFixed(1)}s average reply`:""}`;
  $("#ldDot").classList.toggle("down",d.ai.ok===false);$("#hud").dataset.state=d.ai.ok===false?"down":n.waiting?"wait":"ok";
  if(!$("#ldStats").children.length)$("#ldStats").innerHTML=[["lsM","Messages today"],["lsR","Replies sent"],["lsA","Active now"],["lsW","Waiting for you"],["lsB","Booked today"],["lsV","Value today"]].map(([id,l])=>`<div><b id="${id}">0</b><span>${l}</span></div>`).join("");
  tick("lsM",n.msgs_today);tick("lsR",n.replies_today);tick("lsA",n.active_now);tick("lsW",n.waiting);tick("lsB",n.booked_today);tick("lsV",fmt(n.value_today));
  const today=d.week.find(w=>w.today);gauge(today?.pct??null);$("#ldGaugeSub").textContent=today&&today.open?`${Math.round(today.booked/60*10)/10} of ${Math.round(today.open/60)} open hours booked`:"No opening hours today";
  donut(d.channels);
  // micro cards
  const m24=d.h24.map(h=>h.msgs),f24=d.h24.map(h=>h.failed);tick("mMsg",m24.reduce((a,b)=>a+b,0));microBars("mMsgC",m24,f24,"#3d8bff");
  const fails=f24.reduce((a,b)=>a+b,0);$("#mMsgD").className=fails?"down":"";$("#mMsgD").textContent=fails?`${fails} failed`:"";
  const half=Math.floor(d.d14.length/2),cur=d.d14.slice(half),prev=d.d14.slice(0,half),bk=cur.map(x=>x.n),vv=cur.map(x=>x.v),sum=a=>a.reduce((x,y)=>x+y,0);tick("mBk",sum(bk));microBars("mBkC",bk.length>60?bk.slice(-60):bk,[],"#ff6a1f");microDelta("mBkD",sum(bk),sum(prev.map(x=>x.n)));
  tick("mVal",fmt(sum(vv)));microWave("mValC",vv.length>2?vv:[0,...vv,0],"#ffc93c");microDelta("mValD",sum(vv),sum(prev.map(x=>x.v)));
  const ms=d.h24.map(h=>h.ms||0),msOk=ms.filter(Boolean);tick("mMs",msOk.length?(msOk.reduce((a,b)=>a+b,0)/msOk.length/1000).toFixed(1)+"s":"—");microBars("mMsC",ms.map(v=>v/1000),[],"#ff4fa0");$("#mMsD").textContent=msOk.length?"per hour":"";
  // week capsules
  const DN=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  $("#ldWeek").innerHTML=d.week.map((w,i)=>`<div class="cap${w.today?" today":""}${w.pct===null?" off":""}" title="${DN[i]}: ${w.pct===null?"closed":w.pct+"% booked"}"><em>${w.pct===null?"–":w.pct+"%"}</em><span class="tube"><i style="height:${w.pct||0}%"></i></span><small>${DN[i]}</small></div>`).join("");
  flowChart(d.flow);heatGrid(d.heat);
  // setup checklist
  const done=d.setup.filter(s=>s.done).length;$("#ldSetup").hidden=done===d.setup.length;
  if(done<d.setup.length)$("#ldSetup").innerHTML=`<div class="su-head"><div><h2>Get the most from your receptionist</h2><p class="sub" style="margin:2px 0 0">${done} of ${d.setup.length} done</p></div><span class="su-bar"><i style="width:${done/d.setup.length*100}%"></i></span></div>
    <div class="su-list">${d.setup.map(s=>`<button type="button" class="su${s.done?" done":""}" data-go="${s.view}"><i aria-hidden="true">${s.done?"✓":""}</i>${esc(s.label)}</button>`).join("")}</div>`;
  // tables
  const ST=c=>c.needs_attention?`<span class="tag t-attn">Needs you</span>`:c.ai_paused?`<span class="tag t-hand">You're replying</span>`:c.outcome==="booked"?`<span class="tag t-book">Booked</span>`:c.outcome==="handoff"?`<span class="tag t-hand">Sent to you</span>`:`<span class="tag t-live">Live</span>`;
  $("#ldActive").innerHTML=d.active.length?d.active.map(c=>`<tr class="click" data-open="${c.id}"><td><b style="font-weight:500">${esc(c.name||c.phone||"Customer")}</b><br><small>${ago(c.at)} · ${c.msgs} msgs</small></td><td><span class="chip"><i style="background:${CHC[c.channel]||"#8c877b"}"></i>${esc(CHN[c.channel]||c.channel)}</span></td><td>${ST(c)}</td><td style="color:var(--ink2)">${esc(c.last||"")}</td></tr>`).join("")
    :`<tr><td colspan="4" class="sub">No conversations this week yet.</td></tr>`;
  $("#ldUp").innerHTML=d.upcoming.length?d.upcoming.map(u=>`<div class="up"><time><b>${hhmm(u.start)}</b><small>${nice(L(u.start),{weekday:"short",day:"numeric"})}</small></time><div><b>${esc(u.name||"Customer")}</b><small>${esc(u.service)} · ${u.minutes} min</small></div><span>${fmt(u.price)}</span></div>`).join("")
    :`<p class="sub" style="margin:0">Nothing booked ahead yet.</p>`;
  let fresh=0;
  $("#ldFeed").innerHTML=d.feed.map(f=>{const key=f.kind+f.id,isNew=!liveFirst&&!liveSeen.has(key);if(isNew)fresh++;liveSeen.add(key);
    const who=f.kind==="booking"?"New booking":f.role==="customer"?(f.name||"Customer"):f.role==="staff"?"You":"Your AI";
    const dot=f.kind==="booking"?"#2fd27b":f.role==="customer"?(CHC[f.channel]||"#3d8bff"):f.role==="staff"?"#ffc93c":"var(--muted)";
    return `<div class="feed-item${f.kind==="booking"?" book":""}${isNew?" new":""}" data-open="${f.conv||""}"><i style="background:${dot}"></i><div><div class="who"><b>${esc(who)}${f.kind==="booking"&&f.name?" · "+esc(f.name):""}</b><span>${esc(CHN[f.channel]||f.channel||"")} · ${hhmm(f.at)}</span></div><p>${esc(f.text)}</p></div></div>`}).join("")||`<p class="sub" style="padding:10px">Messages and bookings appear here the moment they happen.</p>`;
  if(fresh)crystalKick=1;
  window.liveD=d;liveFirst=false;$("#ldClock").textContent="updated "+hhmm(d.server_time);renderSummary(d)}
