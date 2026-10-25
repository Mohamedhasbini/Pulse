// Sidebar: every page with its tabs listed under it, so any view is one click from anywhere.
// The children are read from each page's own tab row, so a new tab shows up here by itself.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
// "Live now" becomes the Dashboard entry; the other shortcuts are now children of their page
const dash=$('nav button[data-view="overview"][data-sub="live"]');
if(dash){dash.dataset.sub="flow";dash.title=dash.ariaLabel="Dashboard";dash.querySelector("span").textContent="Dashboard";
  dash.querySelector("svg").innerHTML='<path d="M3 12h4l3-7 4 14 3-7h4"/>'}
$$('nav button[data-sub]').forEach(b=>{if(b!==dash)b.classList.add('nav-gone')}); // a class, because the permission check resets [hidden]
const homeBtn=$('nav button[data-view="overview"]:not([data-sub])');
// where each page keeps its tabs
const kidsOf=v=>{const sec=$("#"+v);if(!sec)return[];
  if(v==="setup")return [...sec.querySelectorAll(".setnav [data-k]")];
  if(v==="admin")return [...sec.querySelectorAll(".setnav button")];
  if(v==="training")return [...sec.querySelectorAll("#tchMode button")];
  return [...sec.querySelectorAll(".ptabs button[data-tab]")].filter(b=>!b.hidden&&!/edit layout/i.test(b.textContent))};
const label=b=>(b.childNodes[0]?.nodeType===3?b.childNodes[0].textContent:b.textContent).replace(/\d+$/,"").trim();
const current=()=>{const s=$("main > section:not([hidden])");return s?s.id:""};
const navOf=v=>v==="overview"?dash:$(`nav button[data-view="${v}"]:not([data-sub])`);
function open(v,kid){const b=navOf(v);const here=current()===v||(v==="overview"&&current()==="overview");
  if(!here)b?.click();setTimeout(()=>{kid?.click();draw()},here?0:80)}
function draw(){const cur=current(),page=cur==="today"?"today":cur;
  $$("nav .nsub").forEach(x=>x.remove());
  $$("nav button[data-view]").forEach(b=>{if(b.hidden||b.classList.contains("nav-gone"))return;const v=b===homeBtn?"today":b.dataset.view;
    const on=v===page;b.setAttribute("aria-current",String(on));if(!on||v==="today")return;
    const kids=kidsOf(v);if(kids.length<2)return;
    const box=document.createElement("div");box.className="nsub";
    box.innerHTML=kids.map((k,i)=>`<button type="button" data-i="${i}" aria-current="${k.getAttribute("aria-pressed")==="true"||k.getAttribute("aria-current")==="true"}">${label(k)}</button>`).join("");
    box.addEventListener("click",e=>{const c=e.target.closest("[data-i]");if(c)open(v,kids[+c.dataset.i])});
    b.after(box)})}
// redraw whenever a page or tab changes
document.addEventListener("click",e=>{if(e.target.closest("nav button[data-view],.ptabs button,#tchMode button,.setnav button,[data-go],.kp-it"))setTimeout(draw,120)},true); // capture: Home stops its own click from bubbling
addEventListener("tabshown",()=>setTimeout(draw,30));
setTimeout(draw,600);
window.openDashboard=()=>dash?.click();
})();
