// Focus + list for the data tabs: in each sub-tab one block is shown at a comfortable size and every other block
// becomes a quiet row beside it. Blocks are only moved, never rebuilt, so live.js keeps filling them by id.
// Also folds sub-tabs into fewer groups; the old keys keep working for Home, the sidebar and links.
(function(){
const $=s=>document.querySelector(s);
const GROUPS={
  overview:[["flow","Now",["flow","live"]],["conversations","Conversations",["conversations","approvals","queue"]],
    ["summary","Performance",["summary","trends"]],["channels","Channels & services",["channels","services"]],["reviews","Reviews",["reviews"]]],
  analytics:[["highlights","Highlights",["highlights"]],["overview","Money",["overview","services"]],["timing","Timing",["timing"]],
    ["clients","Clients & AI",["clients","ai","questions"]],["next","Next steps",["next"]]],
};
const NEED=/need|attention|approv|queue|waiting|to do|unanswered|no-show|haven/i,AI=/\bAI\b|repl|assistant|confident|teach/i;

// the blocks of a pane: cards (and loose number rows) found by opening up the layout grids around them
function blocks(el){const out=[];for(const c of [...el.children]){
  if(c.matches(".fx-list,script,style"))continue;
  // a grid of small figure tiles stays together as one block
  const cards=[...c.querySelectorAll(".card")],tiles=cards.length&&cards.every(x=>x.classList.contains("micro"));
  if(c.matches(".card,.kpis,.kp-row")||tiles||!cards.length)out.push(c);else out.push(...blocks(c))}return out}
// a heading's own words: line breaks become spaces, counters inside it are left out
const words=h=>[...h.childNodes].map(n=>n.nodeType===3?n.data:n.nodeName==="BR"?" ":"").join("").replace(/\s+/g," ").trim();
const title=b=>{const h=b.querySelector(".ch h2,h2,h3"),s=b.querySelector(":scope > span");
  return (h&&words(h))||(s&&s.textContent.trim())||(b.matches(".kpis,.kp-row")?"Key numbers":b.querySelector(".micro")?"Today's figures":"Details")};
// the row's figure: a tile's big number, else the block's own counter or period label when it is short
// period labels like "today" are not figures; a short text with a digit in it is
const num=(t,n=16)=>/^[-+−~$€£]?\s?\d/.test(t)&&t.length<n;
function figure(b){const tile=b.querySelector(":scope > b");if(tile)return tile.textContent.trim();
  const head=[...b.querySelectorAll(".ch .badge-n:not([hidden]),.ch small,.ch .plabel")].map(e=>e.textContent.trim()).find(t=>num(t,24));if(head)return head;
  // a headline number in the block itself; a value from inside a table or list row would mislead
  const big=[...b.querySelectorAll("b,strong,.big,.num,.v")].filter(e=>!e.closest("table,.tw,.urow,.feed-item,.item")).map(e=>e.textContent.trim()).find(t=>num(t));return big||""}

const state={};
function focusPane(view,pane){const bs=blocks(pane).filter(b=>!b.closest(".fx-list"));if(bs.length<2)return;
  let fx=pane.querySelector(":scope > .fx");
  if(!fx){fx=document.createElement("div");fx.className="fx";fx.innerHTML=`<div class="fx-main"></div><div class="fx-list" role="tablist"></div>`;
    const main=fx.firstChild;bs.forEach(b=>main.append(b));
    [...pane.children].forEach(c=>{if(c!==fx&&!c.querySelector(".card,.kpis,.kp-row")&&!c.matches(".card"))c.remove()});
    pane.prepend(fx);
    fx.lastChild.addEventListener("click",e=>{const r=e.target.closest(".fx-li");if(!r)return;state[view+pane.dataset.pane]=+r.dataset.i;paint(view,pane);dispatchEvent(new Event("resize"))})}
  paint(view,pane)}
function paint(view,pane){const fx=pane.querySelector(":scope > .fx");if(!fx)return;const bs=[...fx.firstChild.children],on=state[view+pane.dataset.pane]||0;
  bs.forEach((b,i)=>b.classList.toggle("fx-off",i!==on));
  fx.lastChild.innerHTML=bs.map((b,i)=>{const t=title(b),c=NEED.test(t)?"need":AI.test(t)?"ai":"";
    return `<button type="button" class="fx-li ${c}" data-i="${i}" aria-current="${i===on}"><span class="t">${esc(t)}</span><span class="v">${esc(figure(b))}</span></button>`}).join("")}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);

function group(view){const sec=$("#"+view),bar=sec?.querySelector(".ptabs"),G=GROUPS[view];if(!bar||!G||bar.dataset.grouped)return;bar.dataset.grouped="1";
  const pane=k=>sec.querySelector(`:scope > .spane[data-pane="${k}"]`),btn=k=>bar.querySelector(`button[data-tab="${k}"]`),alias={};
  for(const [main,label,keys] of G){const p=pane(main),b=btn(main);if(!p||!b)continue;
    const tx=[...b.childNodes].find(n=>n.nodeType===3);if(tx)tx.data=label;else b.prepend(label);bar.append(b);
    for(const k of keys){if(k===main)continue;const q=pane(k);if(q){[...q.children].forEach(c=>p.append(c));q.remove()}btn(k)?.setAttribute("hidden","");alias[k]=main}}
  const prev=window.tabsOf&&tabsOf[view];if(prev)tabsOf[view]=k=>prev(alias[k]||k);
  // one route for every tab button: tabsOf knows both the built-in panes and the ones signature.js adds
  bar.addEventListener("click",e=>{const b=e.target.closest("button[data-tab]");if(!b||!tabsOf[view])return;e.stopPropagation();tabsOf[view](b.dataset.tab)},true);
  if(view==="overview"&&window.showPane){const sp=window.showPane;window.showPane=k=>sp(alias[k]||k)}
  // the pane that was open before grouping may have been folded away
  const open=sec.querySelector(":scope > .spane:not([hidden])");if(!open&&tabsOf[view])tabsOf[view](G[0][0])}

function run(view){group(view);const sec=$("#"+view);sec&&sec.querySelectorAll(":scope > .spane").forEach(p=>focusPane(view,p))}
function boot(){Object.keys(GROUPS).forEach(run)}
// signature.js adds its tabs on load; wait for it
if(document.readyState==="complete")setTimeout(boot,0);else addEventListener("load",()=>setTimeout(boot,0));
addEventListener("tabshown",e=>{const v=e.detail?.view,sec=v&&$("#"+v);if(sec&&GROUPS[v])sec.querySelectorAll(":scope > .spane:not([hidden])").forEach(p=>paint(v,p))});
// row figures follow the live numbers
setInterval(()=>{if(document.hidden)return;Object.keys(GROUPS).forEach(v=>{const s=$("#"+v);if(s&&!s.hidden)s.querySelectorAll(":scope > .spane:not([hidden])").forEach(p=>{const fx=p.querySelector(":scope > .fx");
  if(fx)[...fx.firstChild.children].forEach((b,i)=>{const r=fx.lastChild.children[i];if(r)r.lastChild.textContent=figure(b)})})})},5000);
window.focusList=run;
})();
