// Live dashboard: one Server-Sent Events stream from /api/events. When anything changes for this business
// (message, booking, queue, rating) the page that is open refreshes itself, no reload needed.
// The 5-second polling in index.html stays as a safety net if the stream drops.
(function(){
const visible=()=>document.querySelector("main > section:not([hidden])")?.id;
const paneOn=k=>{const p=document.querySelector(`#overview .spane[data-pane="${k}"]`);return p&&!p.hidden&&!$("#overview").hidden};
const call=f=>{try{const r=f();r?.catch?.(()=>{})}catch{}};
let busy=false,again=false;
async function refreshVisible(kinds){
  if(busy){again=true;return}busy=true;
  try{
    const v=visible();
    call(()=>typeof loadNotifs==="function"&&loadNotifs());
    if(v==="today")call(()=>window.homeLoad?.());
    else if(v==="overview"){call(refresh);call(loadLive);call(loadApprovals);if(paneOn("queue"))call(loadQueue);if(paneOn("reviews"))call(loadReviews)}
    else if(v==="calendar")call(loadCal);
    else if(v==="people")call(loadPeople);
    else if(v==="analytics")call(loadInsights);
    else if(v==="demo")call(pollTestChat);
    if(typeof openId!=="undefined"&&openId&&!$("#modal").hidden)call(async()=>renderConvMsgs(await req(`/api/conversations/${openId}/messages`)));
    if(kinds.includes("queue"))call(queueBadge);
  }finally{busy=false;if(again){again=false;setTimeout(()=>refreshVisible([]),300)}}
}
let es=null;
function connect(){
  if(window.LAB||es)return;
  es=new EventSource("/api/events");
  es.addEventListener("change",e=>{let d={kinds:[]};try{d=JSON.parse(e.data)}catch{}if(!document.hidden)refreshVisible(d.kinds||[])});
  es.onopen=()=>document.documentElement.classList.add("live-on");
  es.onerror=()=>document.documentElement.classList.remove("live-on"); // EventSource reconnects by itself
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshVisible([])});
setTimeout(connect,1500);

const ago=s=>s<60?s+"s":s<3600?Math.round(s/60)+" min":Math.round(s/3600)+" h";
const CH={whatsapp:"WhatsApp",telegram:"Telegram",webook:"WeBook",test:"Test chat"};
const tile=(l,v,sub="")=>`<div class="qk"><span class="k-l">${l}</span><b class="num">${v}</b>${sub?`<small>${sub}</small>`:""}</div>`;

// ---------- Queue tab ----------
let qStatus="waiting";
async function queueBadge(){try{const s=await req("/api/ai-queue"),b=$("#tb_overview_queue");if(b){b.textContent=s.waiting;b.hidden=!s.waiting}}catch{}}
async function loadQueue(){
  const [s,list,done]=await Promise.all([req("/api/ai-queue"),req("/api/ai-queue/list?status="+qStatus),req("/api/ai-queue/list?status=answered")]);
  const waits=done.map(x=>x.wait_s).sort((a,b)=>a-b),med=waits.length?waits[Math.floor(waits.length/2)]:null;
  $("#qKpis").innerHTML=tile("Waiting now",s.waiting,s.oldest_s?"oldest "+ago(s.oldest_s):"")+tile("Answered from queue",done.length,"last 7 days")
    +tile("Typical wait",med==null?"—":ago(med),"until the full answer")+tile("Needs you",s.failed,s.failed?"AI could not answer":"none");
  const st={waiting:"Waiting",working:"Answering…",answered:"Answered",failed:"Needs you"};
  $("#qList").innerHTML=list.map(x=>`<tr data-c="${x.conversation_id}" style="cursor:pointer"><td>${new Date(x.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</td><td>${esc(x.customer)}</td><td>${esc(CH[x.channel]||x.channel)}</td>
    <td title="${esc(x.reply||x.error||"")}">${esc(String(x.text).slice(0,80))}</td><td>${ago(x.wait_s)}${x.attempts>1?` · ${x.attempts} tries`:""}</td><td><span class="tag ${x.status==="answered"?"t-book":x.status==="failed"?"t-attn":"t-faq"}">${st[x.status]||x.status}</span></td></tr>`).join("")
    ||`<tr><td colspan="6" class="sub" style="padding:14px">${qStatus==="waiting"?"Nothing waiting. Every customer has been answered.":"Nothing here yet."}</td></tr>`;
  queueBadge();
}
document.addEventListener("click",e=>{
  const b=e.target.closest("#qTabs button");if(b){qStatus=b.dataset.s;$("#qTabs").querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b));loadQueue();return}
  const r=e.target.closest("#qList tr[data-c],#rvList tr[data-c]");if(r&&typeof openConv==="function")call(()=>openConv(+r.dataset.c));
});

// ---------- Reviews tab ----------
async function loadReviews(){
  const d=await req("/api/ratings?days=30");
  $("#rvKpis").innerHTML=tile("Satisfaction",d.satisfaction==null?"—":d.satisfaction+"%","rated 4 or 5")+tile("Average",d.avg==null?"—":d.avg.toFixed(1)+" ★",d.rated+" ratings")
    +tile("Answered the rating",d.response_rate==null?"—":d.response_rate+"%",d.asked+" asked")+tile("Unhappy",d.unhappy,d.comments+" comments");
  const max=Math.max(1,...d.dist.map(x=>x.n)),by=Object.fromEntries(d.dist.map(x=>[x.rating,x.n]));
  $("#rvDist").innerHTML=[5,4,3,2,1].map(r=>`<div class="rv-bar"><span>${r} ★</span><i style="--w:${Math.round(100*(by[r]||0)/max)}%"></i><b>${by[r]||0}</b></div>`).join("");
  const res={booked:"Booked",answered:"Answered",handoff:"Handed to staff"};
  $("#rvList").innerHTML=d.list.map(x=>`<tr data-c="${x.id}" style="cursor:pointer"><td>${new Date(x.rated_at).toLocaleString([],{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</td><td>${esc(x.customer)}</td><td>${esc(CH[x.channel]||x.channel)}</td>
    <td><span class="tag ${x.rating>=4?"t-book":x.rating<=2?"t-attn":"t-faq"}">${"★".repeat(x.rating)}${"☆".repeat(5-x.rating)}</span></td><td>${esc(res[x.outcome]||x.outcome||"")}</td><td>${esc(x.rating_comment||"")}</td></tr>`).join("")
    ||`<tr><td colspan="6" class="sub" style="padding:14px">No ratings yet. Customers are asked when a chat ends.</td></tr>`;
}
window.addEventListener("tabshown",e=>{if(e.detail.view!=="overview")return;if(e.detail.tab==="queue")call(loadQueue);if(e.detail.tab==="reviews")call(loadReviews)});
setTimeout(queueBadge,2500);
window.loadQueue=loadQueue;window.loadReviews=loadReviews;
})();
