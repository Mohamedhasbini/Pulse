// Navigation, the shared period and theme. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- nav, tabs, theme ----------
document.querySelectorAll("nav button[data-view]").forEach(b=>b.onclick=()=>{document.querySelectorAll("nav button[data-view]").forEach(x=>x.setAttribute("aria-current",x===b));
  ["overview","calendar","people","analytics","training","demo","setup","admin","security","website"].forEach(v=>{const el=$("#"+v);if(el)el.hidden=v!==b.dataset.view});if(lockedCard(b.dataset.view))return;if(b.dataset.view==="admin")loadAdmin();scrollTo(0,0);if(b.dataset.view==="analytics")loadInsights();if(b.dataset.view==="people")loadPeople();if(b.dataset.view==="training"){loadTraining();loadTeach()}
  if(b.dataset.view==="calendar")loadCal();if(b.dataset.view==="demo")$("#msgIn").focus()});
// One period for the whole app: Home, Live, Performance, Insights and every table follow it.
const PLABEL=d=>d===1?"today":d===365?"last 12 months":`last ${d} days`;
function setPeriod(d){days=d;inDays=d;try{localStorage.setItem("rb-days",d)}catch{}
  document.querySelectorAll("button[data-d]").forEach(x=>x.setAttribute("aria-pressed",+x.dataset.d===d));
  document.querySelectorAll(".plabel").forEach(x=>x.textContent=PLABEL(d));
  lastStats=null;refresh();if(typeof loadLive==="function")loadLive();if(!$("#analytics").hidden)loadInsights()}
document.querySelectorAll("button[data-d]").forEach(b=>b.onclick=()=>setPeriod(+b.dataset.d));
$("#themeBtn").onclick=()=>{const r=document.documentElement,c=r.dataset.theme==="dark"?"light":"dark";r.dataset.theme=c;try{localStorage.setItem("rb-theme",c)}catch{}};
$("#logoutBtn").onclick=async()=>{await fetch("/api/logout",{method:"POST"});location.href="/login"};

