// Motion and interaction for the glass dashboard: cards rise in, numbers count up,
// charts draw themselves once, and every chart part shows a glass tooltip on hover.
(function(){
// the living colour field behind the glass
if(!document.querySelector(".g-field")){const f=document.createElement("div");f.className="g-field";f.setAttribute("aria-hidden","true");document.body.prepend(f)}
const reduce=()=>matchMedia("(prefers-reduced-motion: reduce)").matches||document.documentElement.classList.contains("nomotion");
const CARDS=".card,.kpi,.td-card,.td-stat,.cm-card,.cm-detail,.cm-list";
const CHARTS="#area,#inTrend,#ldGauge,#ldDonut,#ldFlow,#mMsgC,#mBkC,#mValC,#mMsC,.spark,.donut,.gauge,.flow,#ldHeat,#heat,#inHeat,.capsules,.hgrid";

// ---- cards rise in, one after another, when a page or tab appears ----
function enter(root){if(reduce()||!root||root.hidden)return;
  const cards=[...root.querySelectorAll(CARDS)].filter(c=>c.offsetParent&&!c.closest(".modal,.wx-modal"));
  cards.slice(0,24).forEach((c,i)=>{c.style.setProperty("--i",i);c.classList.remove("fx-enter");void c.offsetWidth;c.classList.add("fx-enter");setTimeout(()=>c.classList.remove("fx-enter"),900+i*55)});
  drawCharts(root)}
// ---- charts draw the first time they're seen (live refreshes don't replay it) ----
function drawCharts(root){if(reduce())return;
  root.querySelectorAll(CHARTS).forEach(svg=>{if(!svg.offsetParent||svg.dataset.drawn)return;if(!svg.querySelector("rect,path,polyline,circle,i"))return;
    svg.dataset.drawn=1;svg.querySelectorAll("polyline,path[fill='none'],line").forEach(p=>p.setAttribute("pathLength","1"));
    svg.querySelectorAll("rect,i").forEach((r,j)=>r.style.setProperty("--j",j));
    svg.classList.add("fx-chart");setTimeout(()=>svg.classList.remove("fx-chart"),1600)})}
const watch=new MutationObserver(ms=>{for(const m of ms){const el=m.target;if(m.attributeName==="hidden"&&!el.hidden&&el.matches("main > section,.spane,.ccmain > div,[data-p],#tchCoach"))enter(el)}});
watch.observe(document.querySelector("main"),{subtree:true,attributes:true,attributeFilter:["hidden"]});
addEventListener("tabshown",()=>setTimeout(()=>{const v=document.querySelector("main > section:not([hidden]) .spane:not([hidden])");v&&drawCharts(v)},30));
setTimeout(()=>{const s=document.querySelector("main > section:not([hidden])");s&&enter(s)},700);
// charts that fill in after data arrives
let lateQ=0;const late=new MutationObserver(()=>{if(lateQ)return;lateQ=requestAnimationFrame(()=>{lateQ=0;const s=document.querySelector("main > section:not([hidden])");s&&drawCharts(s);tag()})});
late.observe(document.querySelector("main"),{subtree:true,childList:true});

// ---- numbers count up to their new value ----
const NUMS=".kpi .v,.td-stat b,.micro b,.cm-stats b,.statrow b,.lstats b,.mny b,#tchStats b";
const last=new WeakMap(),running=new WeakSet();
function count(el){const t=el.textContent.trim(),m=t.match(/^([^\d-]*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);if(!m){last.set(el,t);return}
  const to=parseFloat(m[2].replace(/,/g,"")),prev=last.get(el),pm=prev&&prev.match(/(-?\d[\d,]*(?:\.\d+)?)/),from=pm?parseFloat(pm[1].replace(/,/g,"")):0;
  last.set(el,t);if(reduce()||from===to||!isFinite(to))return;running.add(el);
  const dec=(m[2].split(".")[1]||"").length,comma=m[2].includes(","),t0=performance.now(),dur=700;
  const fmt=v=>{let s=v.toFixed(dec);if(comma)s=Number(s).toLocaleString("en",{minimumFractionDigits:dec,maximumFractionDigits:dec});return m[1]+s+m[3]};
  const step=now=>{const k=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-k,3);el.textContent=fmt(from+(to-from)*e);if(k<1)requestAnimationFrame(step);else{el.textContent=t;last.set(el,t);setTimeout(()=>running.delete(el),0)}};
  requestAnimationFrame(step)}
const numWatch=new MutationObserver(ms=>{const seen=new Set();for(const m of ms){const el=(m.target.nodeType===3?m.target.parentElement:m.target)?.closest?.(NUMS);if(el&&!running.has(el)&&!seen.has(el)&&el.textContent!==last.get(el)){seen.add(el);count(el)}}});
numWatch.observe(document.querySelector("main"),{subtree:true,childList:true,characterData:true});

// ---- interactive charts: glass tooltip, hovered part highlighted ----
const tip=document.createElement("div");tip.className="g-tip";document.body.append(tip);
function tag(){document.querySelectorAll(CHARTS).forEach(svg=>{if(svg.tagName==="svg")svg.setAttribute("data-fx","");
  svg.querySelectorAll("title").forEach(t=>{const p=t.parentElement;if(p&&!p.dataset.tip){p.dataset.tip=t.textContent;t.remove()}});
  svg.querySelectorAll("[title]").forEach(e=>{e.dataset.tip=e.getAttribute("title");e.removeAttribute("title")})});
  document.querySelectorAll(".capsules [title],.dlegend [title]").forEach(e=>{e.dataset.tip=e.getAttribute("title");e.removeAttribute("title")})}
tag();
document.addEventListener("mousemove",e=>{const t=e.target.closest?.("[data-tip]");if(!t){tip.classList.remove("on");return}
  tip.textContent=t.dataset.tip;tip.classList.add("on");const w=tip.offsetWidth,h=tip.offsetHeight;
  tip.style.left=Math.min(innerWidth-w-8,e.clientX+14)+"px";tip.style.top=Math.max(8,e.clientY-h-12)+"px"});
document.addEventListener("mouseleave",()=>tip.classList.remove("on"));
})();
