// Long explanations stay folded: each one becomes a small "More details" link that opens it in place.
// Warnings (sample data, locked features) are left visible. Cards drawn later are folded as they appear.
(function(){
const KEEP=/made up|sample data|locked|premium|not included|doesn't include/i;
function fold(root){root.querySelectorAll("p.sub, p.full").forEach(p=>{
  if(p.dataset.fold||p.closest(".td-note,.feed-item,.urow,table,.lockCard,.adminNote,[class*='banner'],[id*='anner'],.chat,.msgs"))return;
  const t=p.textContent.trim();if(t.length<70||KEEP.test(t))return;
  p.dataset.fold="1";p.hidden=true;
  const b=document.createElement("button");b.type="button";b.className="more-link";b.textContent="More details";b.setAttribute("aria-expanded","false");
  b.addEventListener("click",()=>{p.hidden=!p.hidden;b.setAttribute("aria-expanded",String(!p.hidden));b.textContent=p.hidden?"More details":"Less"});
  p.before(b)})}
let t=null;const run=()=>{clearTimeout(t);t=setTimeout(()=>fold(document.querySelector("main")||document.body),150)};
new MutationObserver(run).observe(document.body,{childList:true,subtree:true});run();
})();
