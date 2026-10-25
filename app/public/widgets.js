// Ringback widgets: every card can be expanded into a full detail view with its data,
// home and insights tabs can be rearranged and resized (like phone home-screen widgets),
// and Settings > Customize holds the look-and-feel and dashboard preferences.
(function(){
const $=s=>document.querySelector(s),esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
const money=v=>{try{return fmt(v)}catch{return v}};
const DN=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],CH=c=>{try{return CHN[c]||c}catch{return c}},OUT=o=>{try{return OUTN[o]||o}catch{return o}};
const share=(n,t)=>t?Math.round(n/t*1000)/10+"%":"—";

/* ---------- styles ---------- */
document.head.insertAdjacentHTML("beforeend",`<style>
.wx-btn{margin-left:auto;flex:none;width:28px;height:28px;border-radius:8px;border:1px solid var(--line);background:var(--s1);color:var(--ink2);display:grid;place-items:center;cursor:pointer;opacity:.55;transition:opacity .15s,background .15s}
.wx-btn:hover,.wx-btn:focus-visible{opacity:1;background:var(--s3);color:var(--ink)}
.wx-btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.card:hover>.ch>.wx-btn,.card:hover>.mh>.wx-btn,.kpi:hover>.wx-btn{opacity:1}
.kpi{position:relative}.kpi>.wx-btn{position:absolute;top:10px;right:10px;margin:0}
.wx-click{cursor:zoom-in}
.wx-modal{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);display:grid;place-items:center;padding:16px}
.wx-modal[hidden]{display:none}
.wx-box{width:min(1180px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--solid);border:1px solid var(--line2);border-radius:20px;padding:22px;box-shadow:0 40px 80px -30px rgba(0,0,0,.8)}
.wx-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.wx-head h2{margin:0;font-size:1.35rem}.wx-head .sp{flex:1}
.wx-view{border:1px solid var(--line);border-radius:14px;padding:16px;background:var(--s1);margin-bottom:16px}
.wx-view svg:not(.wx-btn svg){max-height:420px;width:100%}
.wx-view .tw{max-height:none}
.wx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
.wx-stats div{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--s1)}.wx-stats span{display:block;font-size:12px;color:var(--muted)}.wx-stats b{font-size:1.2rem;font-variant-numeric:tabular-nums}
.wx-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.wx-tools input{flex:1;min-width:200px}
.wx-table{width:100%;border-collapse:collapse;font-size:14px}.wx-table th{text-align:left;cursor:pointer;user-select:none;white-space:nowrap;padding:8px 10px;border-bottom:1px solid var(--line2);color:var(--ink2);font-weight:500}
.wx-table th:hover{color:var(--ink)}.wx-table th[aria-sort]::after{content:" ▾";color:var(--accent)}.wx-table th[aria-sort=ascending]::after{content:" ▴"}
.wx-table td{padding:8px 10px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}.wx-table tr.wx-go{cursor:pointer}.wx-table tr.wx-go:hover td{background:var(--s2)}
.wx-bar{display:inline-block;height:6px;border-radius:3px;background:var(--accent);vertical-align:middle;margin-left:8px;opacity:.7}
.wx-empty{padding:20px;text-align:center;color:var(--muted)}
/* layout editing */
.wgrid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:118px;grid-auto-flow:row dense;gap:16px;flex:none!important}
.wgrid>.wcell{min-width:0;min-height:0;position:relative;display:flex}
.wgrid>.wcell>*{flex:1;min-width:0;min-height:0;overflow:auto;margin:0!important;height:auto!important}
.wgrid>.wcell>.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.wedit .wgrid>.wcell{animation:wjig .32s ease-in-out infinite alternate;cursor:grab}
.wedit .wgrid>.wcell:nth-child(2n){animation-delay:-.16s}
.wedit .wgrid>.wcell>*{pointer-events:none;outline:2px dashed var(--accent-line);outline-offset:-2px}
.wedit .wgrid>.wcell.wdrag{opacity:.35}
@keyframes wjig{from{transform:rotate(-.35deg)}to{transform:rotate(.35deg)}}
@media (prefers-reduced-motion:reduce){.wedit .wgrid>.wcell{animation:none}}
.wctl{display:none;position:absolute;z-index:3;bottom:8px;left:8px;gap:4px;background:var(--solid);border:1px solid var(--line2);border-radius:10px;padding:4px;box-shadow:0 8px 20px -8px rgba(0,0,0,.5)}
.wedit .wcell:hover .wctl,.wedit .wcell:focus-within .wctl{display:flex}.wctl button{border:0;background:var(--s2);color:var(--ink);border-radius:7px;min-width:28px;height:28px;cursor:pointer;font:600 12px/1 inherit}.wctl button:hover{background:var(--accent);color:var(--accent-ink)}
.wctl small{align-self:center;padding:0 4px;color:var(--muted);font-size:11px;white-space:nowrap}
.wrsz{display:none;position:absolute;z-index:3;right:2px;bottom:2px;width:22px;height:22px;cursor:nwse-resize;border-right:3px solid var(--accent);border-bottom:3px solid var(--accent);border-radius:0 0 10px 0}
.wedit .wrsz{display:block}
.wbar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:40;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;background:var(--solid);border:1px solid var(--line2);border-radius:16px;padding:10px 12px;box-shadow:0 20px 50px -20px rgba(0,0,0,.8);max-width:calc(100vw - 32px)}
.wbar[hidden]{display:none}.wbar .sub{margin:0 6px;font-size:13px}
.wedit-btn{margin-left:auto}
.wgone{display:flex;gap:6px;flex-wrap:wrap}.wgone button{font-size:12px}
@media (max-width:820px){.wgrid{grid-auto-rows:auto}.wgrid>.wcell{grid-column:span 12!important;grid-row:auto!important;min-height:160px}}
/* settings groups */
.sgroups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px;flex:none}
.sgroups button{text-align:left;border:1px solid var(--line);background:var(--s1);color:var(--ink);border-radius:14px;padding:12px 14px;cursor:pointer;display:flex;flex-direction:column;gap:2px}
.sgroups button small{color:var(--muted);font-size:12px}.sgroups button[aria-pressed=true]{border-color:var(--accent-line);background:var(--accent-soft)}
.sgroups button:hover{background:var(--s2)}
@media (max-width:640px){.sgroups{grid-template-columns:1fr}}
.cu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
.cu-row{display:flex;flex-direction:column;gap:8px}.cu-row>b{font-weight:600}.cu-row>small{color:var(--muted);font-size:13px}
.cu-seg{display:flex;gap:6px;flex-wrap:wrap}.cu-seg button{border:1px solid var(--line2);background:var(--s1);color:var(--ink);border-radius:10px;padding:8px 12px;cursor:pointer}
.cu-seg button[aria-pressed=true]{background:var(--accent);color:var(--accent-ink);border-color:transparent}
.cu-sw{width:30px;height:30px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}.cu-sw[aria-pressed=true]{border-color:var(--ink);box-shadow:0 0 0 2px var(--solid) inset}
html.compact .card{padding:12px 14px!important}html.compact .spane,html.compact .g12,html.compact .wgrid,html.compact .fit2,html.compact .fit3,html.compact .sumgrid{gap:10px!important}
html.nomotion *{animation:none!important;transition:none!important}
</style>`);

/* ---------- expand: a big view of any card, plus its data ---------- */
const ICON=`<svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
const modal=document.createElement("div");modal.className="wx-modal";modal.hidden=true;modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
modal.innerHTML=`<div class="wx-box"><div class="wx-head"><h2 id="wxT"></h2><small class="sub" id="wxS"></small><span class="sp"></span><button class="btn ghost" type="button" id="wxCsv">Download CSV</button><button class="btn" type="button" id="wxX">Close</button></div>
<div class="wx-view" id="wxV"></div><div id="wxStats" class="wx-stats"></div><div id="wxD"></div></div>`;
document.body.append(modal);
const close=()=>{modal.hidden=true;$("#wxV").innerHTML=""};
$("#wxX").onclick=close;modal.addEventListener("click",e=>{if(e.target===modal)close()});
addEventListener("keydown",e=>{if(e.key==="Escape"&&!modal.hidden)close()});

// Data behind each chart, from the last live / insights load. Each returns {cols, rows, go?}.
const P={
  ldDonut:()=>{const c=liveD.channels,t=c.reduce((a,x)=>a+x.n,0);return{cols:["Channel","Bookings","Share","Value booked","Average value"],rows:c.map(x=>[CH(x.channel),x.n,share(x.n,t),money(x.value),x.n?money(x.value/x.n):"—"])}},
  ldFlow:()=>{const f=liveD.flow,t=f.reduce((a,x)=>a+x.n,0);return{cols:["Channel","Result","Conversations","Share of all"],rows:f.map(x=>[CH(x.channel),OUT(x.outcome),x.n,share(x.n,t)])}},
  ldHeat:()=>{const h=liveD.heat,t=h.reduce((a,x)=>a+x.n,0);return{cols:["Day","Hour","Messages","Share"],rows:h.slice().sort((a,b)=>b.n-a.n).map(x=>[DN[x.dow-1]||x.dow,String(x.h).padStart(2,"0")+":00",x.n,share(x.n,t)])}},
  ldWeek:()=>({cols:["Day","Booked","Booked hours","Open hours","Free hours"],rows:liveD.week.map((w,i)=>[DN[i]+(w.today?" (today)":""),w.pct===null?"Closed":w.pct+"%",w.booked!=null?Math.round(w.booked/6)/10:"—",w.open!=null?Math.round(w.open/6)/10:"—",w.open!=null?Math.round((w.open-(w.booked||0))/6)/10:"—"])}),
  ldGauge:()=>P.ldWeek(),
  mMsgC:()=>({cols:["Hour","Messages","Failed","Avg AI reply (s)"],rows:liveD.h24.map((h,i)=>[h.h??h.hour??(i-23)+"h",h.msgs,h.failed,h.ms?(h.ms/1000).toFixed(1):"—"])}),
  mMsC:()=>P.mMsgC(),
  mBkC:()=>{const d=liveD.d14,half=Math.floor(d.length/2);return{cols:["Date","Bookings","Value booked"],rows:d.slice(half).map(x=>[x.d??x.day??"",x.n,money(x.v)])}},
  mValC:()=>P.mBkC(),
  ldStats:()=>({cols:["Measure","Value"],rows:Object.entries(liveD.now).map(([k,v])=>[k.replace(/_/g," "),typeof v==="number"&&/value/.test(k)?money(v):v])}),
  ldActive:()=>({cols:["Client","Channel","Messages","Result","Needs you","Last message","When"],rows:liveD.active.map(c=>[c.name||c.phone||"Customer",CH(c.channel),c.msgs,OUT(c.outcome||"live"),c.needs_attention?"Yes":"",c.last||"",c.at]),go:liveD.active.map(c=>c.id)}),
  ldUp:()=>({cols:["Start","Client","Service","Minutes","Price"],rows:liveD.upcoming.map(u=>[u.start,u.name||"Customer",u.service,u.minutes,money(u.price)])}),
  ldFeed:()=>({cols:["Time","Kind","Who","Channel","Text"],rows:liveD.feed.map(f=>[f.at,f.kind,f.name||f.role||"",CH(f.channel||""),f.text]),go:liveD.feed.map(f=>f.conv||null)}),
  inTrend:()=>({cols:["Date","Revenue","Bookings","Conversations","Revenue per booking"],rows:inD.trend.map(x=>[x.d,money(x.revenue),x.bookings,x.chats,x.bookings?money(x.revenue/x.bookings):"—"])}),
};
const NUM=v=>{if(typeof v==="number")return v;const s=String(v).replace(/[^\d.,\-]/g,"").replace(/,/g,"");return s&&!isNaN(+s)?+s:null};

// Fallback: read whatever the card shows (tables, chart tooltips, list items)
function scrape(card){
  const t=card.querySelector("table");
  if(t){const cols=[...t.querySelectorAll("thead th")].map(th=>th.textContent.trim()),trs=[...t.querySelectorAll("tbody tr")].filter(r=>r.children.length>1);
    return{cols,rows:trs.map(r=>[...r.children].map(td=>td.innerText.replace(/\s*\n\s*/g," · ").trim())),go:trs.map(r=>r.dataset.open||r.querySelector("[data-open]")?.dataset.open||null),rowEls:trs}}
  const tips=[...card.querySelectorAll("[title],title")].map(x=>x.tagName==="title"?x.textContent:x.getAttribute("title")).filter(x=>x&&/\d/.test(x));
  if(tips.length>1)return{cols:["Point","Value"],rows:tips.map(x=>{const m=x.split(/:\s|·\s/);return m.length>1?[m[0].trim(),m.slice(1).join(" · ").trim()]:[x,""]})};
  const items=[...card.querySelectorAll(".item,.up,.feed-item,.fun>*,.statrow>*,.dlegend>div,.lstats>div,.mny>*")].filter(x=>x.innerText.trim());
  if(items.length)return{cols:["Detail"],rows:items.map(x=>[x.innerText.replace(/\s*\n\s*/g," · ").trim()]),go:items.map(x=>x.dataset.open||x.querySelector("[data-open]")?.dataset.open||null)};
  return null}

let cur=null,sortI=-1,sortDir=1,q="";
function dataFor(card){for(const id of Object.keys(P))if(card.querySelector("#"+id)){try{const r=P[id]();if(r&&r.rows)return r}catch{}}return scrape(card)}
function drawData(){const box=$("#wxD"),st=$("#wxStats");
  if(!cur||!cur.rows.length){box.innerHTML=`<div class="wx-empty">No detailed data for this card yet. It fills in as conversations and bookings come in.</div>`;st.innerHTML="";$("#wxCsv").hidden=true;return}
  $("#wxCsv").hidden=false;
  let idx=cur.rows.map((_,i)=>i);if(q){const ql=q.toLowerCase();idx=idx.filter(i=>cur.rows[i].join(" ").toLowerCase().includes(ql))}
  if(sortI>=0)idx.sort((a,b)=>{const x=cur.rows[a][sortI],y=cur.rows[b][sortI],nx=NUM(x),ny=NUM(y);return(nx!==null&&ny!==null?nx-ny:String(x).localeCompare(String(y)))*sortDir});
  // summary of the numeric columns
  const numCols=cur.cols.map((_,c)=>cur.rows.filter(r=>NUM(r[c])!==null).length>=Math.max(1,cur.rows.length*.6)?c:-1).filter(c=>c>=0&&!/hour|date|time|when|start|day/i.test(cur.cols[c]));
  const maxOf={};numCols.forEach(c=>maxOf[c]=Math.max(...idx.map(i=>NUM(cur.rows[i][c])||0)));
  st.innerHTML=`<div><span>Rows</span><b>${idx.length}${idx.length!==cur.rows.length?" of "+cur.rows.length:""}</b></div>`+numCols.slice(0,3).map(c=>{const v=idx.map(i=>NUM(cur.rows[i][c])).filter(x=>x!==null),s=v.reduce((a,b)=>a+b,0),pctCol=cur.rows.some(r=>String(r[c]).includes("%"));
    return pctCol?`<div><span>${esc(cur.cols[c])}: highest</span><b>${Math.max(...v)}%</b></div>`:`<div><span>${esc(cur.cols[c])}: total</span><b>${Math.round(s*100)/100}</b></div><div><span>${esc(cur.cols[c])}: average</span><b>${v.length?Math.round(s/v.length*10)/10:"—"}</b></div>`}).join("");
  const bar=numCols[0];
  box.innerHTML=`<div class="wx-tools"><input id="wxQ" placeholder="Filter these rows" value="${esc(q)}" aria-label="Filter rows"><small class="sub">Click a column to sort${cur.go&&cur.go.some(Boolean)?" · click a row to open the conversation":""}</small></div>
  <div class="tw"><table class="wx-table"><thead><tr>${cur.cols.map((c,i)=>`<th data-i="${i}"${i===sortI?` aria-sort="${sortDir>0?"ascending":"descending"}"`:""}>${esc(c)}</th>`).join("")}</tr></thead>
  <tbody>${idx.map(i=>`<tr${cur.go&&cur.go[i]?` class="wx-go" data-go="${esc(cur.go[i])}"`:""}>${cur.rows[i].map((v,c)=>`<td>${esc(v)}${c===bar&&maxOf[c]?`<span class="wx-bar" style="width:${Math.round((NUM(v)||0)/maxOf[c]*80)}px"></span>`:""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const qi=$("#wxQ");qi.oninput=()=>{q=qi.value;const p=qi.selectionStart;drawData();const n=$("#wxQ");n.focus();n.setSelectionRange(p,p)};
  box.querySelectorAll("th").forEach(th=>th.onclick=()=>{const i=+th.dataset.i;sortDir=sortI===i?-sortDir:-1;sortI=i;drawData()})}
$("#wxD").addEventListener("click",e=>{const r=e.target.closest("tr.wx-go");if(!r)return;close();try{showPane&&showPane("conversations")}catch{}setTimeout(()=>{try{openConv(+r.dataset.go)}catch{}},150)});
$("#wxV").addEventListener("click",e=>{const o=e.target.closest("[data-open]");if(o){close();setTimeout(()=>{try{openConv(+o.dataset.open)}catch{}},150)}});
$("#wxCsv").onclick=()=>{if(!cur)return;const c=v=>`"${String(v??"").replace(/"/g,'""')}"`,csv=[cur.cols,...cur.rows].map(r=>r.map(c).join(",")).join("\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv"}));a.download=($("#wxT").textContent||"data").replace(/[^\w]+/g,"-").toLowerCase()+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};

function titleOf(card){return(card.querySelector("h2")?.textContent||card.querySelector(".mh span,.k-l")?.textContent||"Details").replace(/\s+\d+$/,"").trim()}
function expand(card){
  $("#wxT").textContent=titleOf(card);$("#wxS").textContent=card.querySelector(".ch small, .plabel")?.textContent||"";
  const v=card.cloneNode(true);v.querySelectorAll(".wx-btn,.wctl,.wrsz,.ch,.mh h2").forEach(x=>x.remove());v.querySelectorAll("[id]").forEach(x=>{x.dataset.wxid=x.id;x.removeAttribute("id")});
  $("#wxV").innerHTML="";$("#wxV").append(...v.childNodes);
  $("#wxV").hidden=!!card.querySelector("table")&&!card.querySelector("svg:not(.wx-btn svg)");// tables are shown once, below, with sorting
  cur=dataFor(card);sortI=-1;sortDir=1;q="";drawData();modal.hidden=false;$("#wxX").focus()}
window.expandCard=expand;

const SCOPE="#overview,#analytics,#people";
function addButtons(){document.querySelectorAll(SCOPE).forEach(sec=>sec.querySelectorAll(".card,.kpi").forEach(card=>{
  if(card.dataset.wx||card.closest(".modal,.wx-modal,form")||card.querySelector("form"))return;
  const head=card.querySelector(":scope>.ch,:scope>.mh");if(!head&&!card.classList.contains("kpi"))return;
  card.dataset.wx=1;const b=document.createElement("button");b.type="button";b.className="wx-btn";b.title="Expand: see all the details";b.setAttribute("aria-label","Expand "+titleOf(card));b.innerHTML=ICON;
  b.onclick=e=>{e.stopPropagation();expand(card)};(head||card).append(b);
  // charts open the detail view when clicked
  card.querySelectorAll(":scope svg:not(.wx-btn svg),.hgrid,.heat,.capsules,.donutwrap,.fun,.k-l,.v").forEach(el=>{if(el.closest(".wx-btn"))return;el.classList.add("wx-click");el.addEventListener("click",e=>{if(document.documentElement.classList.contains("wediting")||e.target.closest("[data-open],button,a"))return;expand(card)})})}))}
addButtons();setTimeout(addButtons,1500);

/* ---------- layout editing: move and resize cards like phone widgets ---------- */
const EDITABLE=["overview","analytics"],LKEY=(v,k)=>`rb-layout-${v}-${k}`;
const keyOf=el=>{const i=el.querySelector("[id]")?.id||el.id;return i?"#"+i:"h:"+(el.querySelector("h2")?.textContent.trim()||"")};
function widgetsOf(pane){const out=[];[...pane.children].forEach(ch=>{if(ch.classList.contains("wgrid"))out.push(...[...ch.children].map(c=>c.firstElementChild));
  else if(ch.matches(".sumgrid,.fit2,.fit3,.fit-side,.row,.g12:not(:has(>.micro))"))out.push(...[...ch.children].filter(c=>c.matches(".card,aside")));
  else if(ch.matches(".card,.kpis,.g12,aside"))out.push(ch)});return out.filter(Boolean)}
function cell(w,size){const c=document.createElement("div");c.className="wcell";c.dataset.k=keyOf(w);c.append(w);
  c.insertAdjacentHTML("beforeend",`<div class="wctl"><button type="button" data-a="w-" title="Narrower">↔ −</button><button type="button" data-a="w+" title="Wider">↔ +</button><button type="button" data-a="h-" title="Shorter">↕ −</button><button type="button" data-a="h+" title="Taller">↕ +</button><small></small><button type="button" data-a="x" title="Hide this card">✕</button></div><div class="wrsz" title="Drag to resize"></div>`);
  setSize(c,size.w,size.h);return c}
function setSize(c,w,h){w=Math.max(2,Math.min(12,w));h=Math.max(1,Math.min(8,h));c.dataset.w=w;c.dataset.h=h;c.style.gridColumn=`span ${w}`;c.style.gridRow=`span ${h}`;const s=c.querySelector(".wctl small");if(s)s.textContent=`${w}×${h}`}
function build(view,pane,saved){const ws=widgetsOf(pane);if(!ws.length)return null;
  const pw=pane.clientWidth||1200,sizes=new Map(ws.map(w=>{const r=w.getBoundingClientRect();return[keyOf(w),{w:Math.round(Math.max(3,Math.min(12,r.width/pw*12)))||12,h:Math.max(2,Math.min(6,Math.round((r.height||240)/134)))||2}]}));
  const g=document.createElement("div");g.className="wgrid";const byK=new Map(ws.map(w=>[keyOf(w),w]));
  const order=saved?saved.items.map(i=>i.k).filter(k=>byK.has(k)).concat([...byK.keys()].filter(k=>!saved.items.some(i=>i.k===k))):[...byK.keys()];
  order.forEach(k=>{const s=saved?.items.find(i=>i.k===k)||sizes.get(k),c=cell(byK.get(k),s);if(saved?.hidden?.includes(k))c.hidden=true;g.append(c)});
  [...pane.children].forEach(ch=>{if(!ch.querySelector(".card,.kpi")||ch.classList.contains("wgrid"))return;if(!ch.matches(".card,.kpis,aside"))ch.remove()});
  pane.prepend(g);return g}
function save(view,pane){const g=pane.querySelector(".wgrid");if(!g)return;store.set(LKEY(view,pane.dataset.pane),{items:[...g.children].map(c=>({k:c.dataset.k,w:+c.dataset.w,h:+c.dataset.h})),hidden:[...g.children].filter(c=>c.hidden).map(c=>c.dataset.k)})}
// Apply saved layouts at start
EDITABLE.forEach(v=>document.querySelectorAll(`#${v} .spane`).forEach(p=>{const s=store.get(LKEY(v,p.dataset.pane));if(s)build(v,p,s)}));

const wbar=document.createElement("div");wbar.className="wbar";wbar.hidden=true;
wbar.innerHTML=`<span class="sub"><b>Editing layout.</b> Drag cards to move them. Use the buttons or the corner handle to resize.</span><span class="wgone" id="wGone"></span><button class="btn ghost" type="button" id="wReset">Reset this tab</button><button class="btn" type="button" id="wDone">Done</button>`;
document.body.append(wbar);
let editing=null;
function hiddenList(){const g=editing.pane.querySelector(".wgrid"),h=[...g.children].filter(c=>c.hidden);
  $("#wGone").innerHTML=h.map(c=>`<button class="mini" type="button" data-k="${esc(c.dataset.k)}">+ ${esc(titleOf(c.firstElementChild))}</button>`).join("")}
function startEdit(view){const pane=[...document.querySelectorAll(`#${view} .spane`)].find(p=>!p.hidden);if(!pane)return;
  const g=pane.querySelector(".wgrid")||build(view,pane,null);if(!g)return;editing={view,pane};
  document.documentElement.classList.add("wediting");pane.classList.add("wedit");[...g.children].forEach(c=>c.draggable=true);wbar.hidden=false;hiddenList()}
function stopEdit(){if(!editing)return;const{view,pane}=editing;save(view,pane);pane.classList.remove("wedit");pane.querySelectorAll(".wcell").forEach(c=>c.draggable=false);
  document.documentElement.classList.remove("wediting");wbar.hidden=true;editing=null;window.dispatchEvent(new Event("resize"))}
$("#wDone").onclick=stopEdit;
$("#wReset").onclick=()=>{if(!editing)return;try{localStorage.removeItem(LKEY(editing.view,editing.pane.dataset.pane))}catch{}location.reload()};
$("#wGone").onclick=e=>{const b=e.target.closest("button[data-k]");if(!b)return;const c=[...editing.pane.querySelectorAll(".wcell")].find(x=>x.dataset.k===b.dataset.k);if(c)c.hidden=false;save(editing.view,editing.pane);hiddenList()};
document.addEventListener("click",e=>{const b=e.target.closest(".wctl button");if(!b||!editing)return;const c=b.closest(".wcell"),w=+c.dataset.w,h=+c.dataset.h,a=b.dataset.a;
  if(a==="x")c.hidden=true;else setSize(c,w+(a==="w+"?1:a==="w-"?-1:0),h+(a==="h+"?1:a==="h-"?-1:0));save(editing.view,editing.pane);hiddenList()});
// drag to reorder
let dragC=null;
document.addEventListener("dragstart",e=>{const c=e.target.closest?.(".wedit .wcell");if(!c)return;dragC=c;c.classList.add("wdrag");e.dataTransfer.effectAllowed="move";try{e.dataTransfer.setData("text/plain","")}catch{}});
document.addEventListener("dragover",e=>{if(!dragC)return;const t=e.target.closest?.(".wcell");e.preventDefault();if(!t||t===dragC||t.parentNode!==dragC.parentNode)return;
  const r=t.getBoundingClientRect(),after=(e.clientX-r.left)/r.width+(e.clientY-r.top)/r.height>1;t.parentNode.insertBefore(dragC,after?t.nextSibling:t)});
document.addEventListener("dragend",()=>{if(!dragC)return;dragC.classList.remove("wdrag");dragC=null;editing&&save(editing.view,editing.pane)});
// corner handle resize, snapping to the grid
document.addEventListener("pointerdown",e=>{const h=e.target.closest(".wrsz");if(!h||!editing)return;e.preventDefault();const c=h.closest(".wcell"),g=c.parentNode,cs=getComputedStyle(g),gap=parseFloat(cs.columnGap)||16,
  colW=(g.clientWidth-gap*11)/12,rowH=parseFloat(cs.gridAutoRows)||118,r=c.getBoundingClientRect();c.draggable=false;
  const mv=ev=>setSize(c,Math.round((ev.clientX-r.left+gap)/(colW+gap)),Math.round((ev.clientY-r.top+gap)/(rowH+gap)));
  const up=()=>{removeEventListener("pointermove",mv);removeEventListener("pointerup",up);c.draggable=true;save(editing.view,editing.pane)};
  addEventListener("pointermove",mv);addEventListener("pointerup",up)});
// "Edit layout" button in the tab bar of editable pages
EDITABLE.forEach(v=>{const bar=document.querySelector(`#${v} .ptabs`);if(!bar)return;const b=document.createElement("button");b.type="button";b.className="wedit-btn";b.title="Move and resize the cards on this tab";
  b.innerHTML=`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>Edit layout`;
  b.onclick=e=>{e.stopPropagation();editing?stopEdit():startEdit(v)};bar.append(b)});
addEventListener("tabshown",()=>{if(editing)stopEdit()});
document.querySelectorAll("nav button[data-view]").forEach(b=>b.addEventListener("click",()=>editing&&stopEdit()));

/* ---------- Settings > Customize ---------- */
const PREF="rb-prefs",pref=Object.assign({accent:"",density:"comfy",size:"m",motion:true,pulse:true,start:"overview"},store.get(PREF,{}));
const ACC=[["","Orange (default)","#ff6a1f"],["#3d8bff","Blue","#3d8bff"],["#2fd27b","Green","#2fd27b"],["#d65cff","Purple","#d65cff"],["#ff4fa0","Pink","#ff4fa0"],["#2fe0c4","Teal","#2fe0c4"]];
function apply(){const r=document.documentElement;
  if(pref.accent){r.style.setProperty("--accent",pref.accent);r.style.setProperty("--accent-text",pref.accent);r.style.setProperty("--accent-soft",pref.accent+"24");r.style.setProperty("--accent-line",pref.accent+"73")}
  else["--accent","--accent-text","--accent-soft","--accent-line"].forEach(p=>r.style.removeProperty(p));
  r.classList.toggle("compact",pref.density==="compact");r.classList.toggle("nomotion",!pref.motion);
  const m=document.querySelector("main");if(m)m.style.zoom={s:.92,m:1,l:1.1}[pref.size]||1}
apply();
const seg=(k,opts)=>`<div class="cu-seg" data-k="${k}">${opts.map(([v,l])=>`<button type="button" data-v="${v}" aria-pressed="${String(pref[k])===String(v)}">${l}</button>`).join("")}</div>`;
function drawCustom(){const look=$("#cuLook .cu-body"),dash=$("#cuDash .cu-body");if(!look||!dash)return;const th=document.documentElement.dataset.theme;
  look.innerHTML=`<div class="cu-grid">
   <div class="cu-row"><b>Theme</b><small>Dark is easier on the eyes at night.</small><div class="cu-seg" data-theme-seg><button type="button" data-v="dark" aria-pressed="${th==="dark"}">Dark</button><button type="button" data-v="light" aria-pressed="${th==="light"}">Light</button></div></div>
   <div class="cu-row"><b>Highlight colour</b><small>Buttons, active tabs and highlights.</small><div class="cu-seg">${ACC.map(([v,l,c])=>`<button type="button" class="cu-sw" data-acc="${v}" title="${l}" aria-label="${l}" aria-pressed="${pref.accent===v}" style="background:${c}"></button>`).join("")}</div></div>
   <div class="cu-row"><b>Text size</b><small>Makes everything bigger or smaller.</small>${seg("size",[["s","Small"],["m","Normal"],["l","Large"]])}</div>
   <div class="cu-row"><b>Spacing</b><small>Compact fits more on the screen.</small>${seg("density",[["comfy","Roomy"],["compact","Compact"]])}</div>
   <div class="cu-row"><b>Animations</b><small>Turn off if motion is distracting.</small>${seg("motion",[["true","On"],["false","Off"]])}</div>
   <div class="cu-row"><b>Pulse heartbeat</b><small>A wave of energy across the page: every 8 seconds on Home, every 15 seconds elsewhere.</small>${seg("pulse",[["true","On"],["false","Off"]])}</div></div>`;
  const pages=[["overview","Home"],["calendar","Calendar"],["people","Customers"],["analytics","Insights"],["training","Teach AI"]];
  const saved=[];EDITABLE.forEach(v=>document.querySelectorAll(`#${v} .spane`).forEach(p=>{if(store.get(LKEY(v,p.dataset.pane)))saved.push([v,p.dataset.pane,(document.querySelector(`#${v} .ptabs button[data-tab="${p.dataset.pane}"]`)?.firstChild?.textContent||p.dataset.pane)])}));
  dash.innerHTML=`<div class="cu-grid">
   <div class="cu-row"><b>Open the dashboard on</b><small>The page you see first after signing in.</small>${seg("start",pages)}</div>
   <div class="cu-row"><b>Arrange your cards</b><small>On Home and Insights, press <b>Edit layout</b> in the tab bar. Drag cards to move them, drag the corner to make them bigger or smaller, or hide the ones you don't need.</small>
     <div class="cu-seg"><button type="button" id="cuEditHome">Edit Home layout</button><button type="button" id="cuEditIn">Edit Insights layout</button></div></div>
   <div class="cu-row"><b>Saved layouts</b><small>${saved.length?"You've customised these tabs:":"All tabs use the standard layout."}</small>
     <div class="cu-seg">${saved.map(([v,k,l])=>`<button type="button" data-reset="${v}|${k}">Reset ${v==="overview"?"Home":"Insights"} · ${esc(l)}</button>`).join("")}${saved.length>1?`<button type="button" data-reset="all">Reset all</button>`:""}</div></div>
   <div class="cu-row"><b>Details on every card</b><small>Click any chart, or the <span style="display:inline-grid;vertical-align:-4px">${ICON.replace("<svg","<svg width='14' height='14' fill='none' stroke='currentColor' stroke-width='2'")}</span> button on a card, to open it full size with every number behind it. Sort, filter, and download it as a spreadsheet.</small></div></div>`}
document.addEventListener("click",e=>{const b=e.target.closest("#cuLook button,#cuDash button");if(!b)return;
  const s=b.closest(".cu-seg");
  if(s&&s.hasAttribute("data-theme-seg")){const r=document.documentElement;r.dataset.theme=b.dataset.v;try{localStorage.setItem("rb-theme",b.dataset.v)}catch{}}
  else if(b.dataset.acc!==undefined)pref.accent=b.dataset.acc;
  else if(b.dataset.reset){const ks=b.dataset.reset==="all"?Object.keys(localStorage).filter(k=>k.startsWith("rb-layout-")):[LKEY(...b.dataset.reset.split("|"))];ks.forEach(k=>{try{localStorage.removeItem(k)}catch{}});location.reload();return}
  else if(b.id==="cuEditHome"||b.id==="cuEditIn"){const v=b.id==="cuEditHome"?"overview":"analytics";document.querySelector(`nav button[data-view="${v}"]:not([data-sub])`).click();setTimeout(()=>startEdit(v),120);return}
  else if(s?.dataset.k){const k=s.dataset.k;pref[k]=k==="motion"||k==="pulse"?b.dataset.v==="true":b.dataset.v}
  store.set(PREF,pref);apply();drawCustom();try{toast("Saved on this device.")}catch{}});
$("#themeBtn")?.addEventListener("click",()=>setTimeout(drawCustom,0));
addEventListener("tabshown",e=>{if(e.detail.view==="setup"&&(e.detail.tab==="look"||e.detail.tab==="dash"))drawCustom()});drawCustom();
// start page
if(pref.start&&pref.start!=="overview")setTimeout(()=>document.querySelector(`nav button[data-view="${pref.start}"]:not([data-sub]):not([hidden])`)?.click(),400);
})();
