// Chart tooltips: hover any chart part with a <title> or title="" and a small label follows the cursor.
// No page watchers and no animation: labels are read lazily on hover.
(function(){
const tip=document.createElement("div");tip.className="g-tip";document.body.append(tip);
const pick=el=>{for(let e=el;e&&e!==document.body;e=e.parentElement){
  if(e.dataset&&e.dataset.tip)return e;
  const t=e.querySelector&&e.querySelector(":scope > title");if(t){e.dataset.tip=t.textContent;t.remove();return e}
  if(e.closest&&e.closest("svg,.capsules,.dlegend,.hgrid,.heat")&&e.getAttribute&&e.getAttribute("title")){e.dataset.tip=e.getAttribute("title");e.removeAttribute("title");return e}}return null};
document.addEventListener("mousemove",e=>{const t=pick(e.target);if(!t){tip.classList.remove("on");return}
  tip.textContent=t.dataset.tip;tip.classList.add("on");const w=tip.offsetWidth,h=tip.offsetHeight;
  tip.style.left=Math.min(innerWidth-w-8,e.clientX+14)+"px";tip.style.top=Math.max(8,e.clientY-h-12)+"px"},{passive:true});
document.addEventListener("mouseleave",()=>tip.classList.remove("on"));
})();
