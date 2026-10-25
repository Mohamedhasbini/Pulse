// The Pulse heartbeat: a wave of energy crosses the open page, every 8 seconds on Home and every 15 seconds
// elsewhere. It starts at a random point, so each beat hits the cards, tables and charts in a different order.
// Off with Settings → Pulse heartbeat, with Animations off, or when the system asks for reduced motion.
(function(){
const SPEED=900; // pixels per second the wave travels
const off=()=>{let p={};try{p=JSON.parse(localStorage.getItem("rb-prefs")||"{}")}catch{}
  return p.pulse===false||p.motion===false||document.documentElement.classList.contains("nomotion")||matchMedia("(prefers-reduced-motion: reduce)").matches};
const page=()=>document.querySelector("main > section:not([hidden])");
// typing is never interrupted: no beat while a field has focus or a key was pressed in the last 4 seconds
let typed=0;document.addEventListener("keydown",()=>typed=Date.now(),true);
const busy=()=>Date.now()-typed<4000||document.activeElement?.matches("input,textarea,select,[contenteditable],[contenteditable] *");
function beat(){const sec=page();if(!sec||document.hidden||off()||busy())return;
  const box=sec.getBoundingClientRect(),x=Math.random()*box.width,y=Math.random()*box.height;
  const w=document.createElement("div");w.className="p-wave";w.style.left=x+"px";w.style.top=(y+sec.scrollTop)+"px";sec.append(w);setTimeout(()=>w.remove(),2700);
  const reach=Math.hypot(Math.max(x,box.width-x),Math.max(y,box.height-y));
  sec.querySelectorAll(".card,.kpi,.td-card,.td-stat,.sg-tile,.sg-ring,.tw,.cm-list,.cm-detail").forEach(el=>{
    if(!el.offsetParent||el.closest(".modal")||el.querySelector("input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable]"))return;const r=el.getBoundingClientRect();
    const cx=Math.min(Math.max(x+box.left,r.left),r.right),cy=Math.min(Math.max(y+box.top,r.top),r.bottom);
    const d=Math.hypot(cx-(x+box.left),cy-(y+box.top));if(d>reach)return;
    el.style.setProperty("--hd",(d/SPEED).toFixed(2)+"s");el.classList.remove("p-hitme");void el.offsetWidth;el.classList.add("p-hitme");
    setTimeout(()=>el.classList.remove("p-hitme"),(d/SPEED)*1000+1000)})}
let t=null;
function next(){clearTimeout(t);const home=page()?.id==="today";t=setTimeout(()=>{beat();next()},home?8000:15000)}
// a page change restarts the count, so a fresh page gets its full rhythm
document.addEventListener("click",e=>{if(e.target.closest("nav button[data-view],[data-go]"))setTimeout(next,50)});
next();
})();
