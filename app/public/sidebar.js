// Sidebar: more pages, fewer sub-tabs. Every entry opens one of the existing sections and shows only its own
// sub-tabs (four at most); there are no tab lists under the entries and no second row of tabs.
// Sections stay where they are, so live.js keeps refreshing them; panes are only folded together inside a section.
// A few panes move to another section (Win back, AI performance, Questions); those are drawn by loadInsights.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const ICON={
  inbox:'<path d="M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z"/>',
  support:'<path d="M12 3a7 7 0 0 0-7 7v3a2 2 0 0 0 2 2h1v-5H6M12 3a7 7 0 0 1 7 7v3a2 2 0 0 1-2 2h-1v-5h2M16 15v1a3 3 0 0 1-3 3h-2"/>',
  performance:'<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  account:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
};
// [entry, label, view, [[host pane, sub-tab label, panes folded into it, from another section?], …]]
const PAGES=[
  ["inbox","Inbox","overview",[["conversations","Conversations",["conversations"]],["approvals","Approvals",["approvals"]],["queue","AI queue",["queue"]]]],
  ["support","Support","overview",[["live","Overview",[],"analytics:ai"],["trends","Topics",[],"analytics:questions"],["reviews","Satisfaction",["reviews"]],["gaps","Knowledge gaps",[],"new"]]],
  ["performance","Performance","overview",[["flow","Live flow",["flow","live"]],["summary","Trends",["summary","trends"]],["channels","Channels",["channels"]],["services","Services",["services"]]]],
  ["analytics","Insights","analytics",[["highlights","Highlights",[]],["overview","Money",["overview","services"]],["timing","Timing",["timing"]],["next","Next steps",["next"]]]],
  ["people","Customers","people",[["board","Board",[]],["clients","All clients",["clients"]],["winback","Win back",[],"analytics:clients"],["offers","Offers",["offers"]]]],
  ["settings","Settings","setup",[["details","Business",["start","details"]],["channels","Channels & reminders",["channels","reminders"]],["booking","Booking & payments",["tools","booking"]],["codes","Discount codes",["codes"]]]],
  ["account","Account","setup",[["s2fa","Security",["s2fa","spw"]],["sdev","Devices",["sdev"]],["look","Look & feel",["look"]],["dash","Dashboard layout",["dash"]]]],
];
const ORDER=[["Main",["home","inbox","support","calendar"]],["Business",["performance","analytics","people"]],["AI receptionist",["training","demo"]],["Setup",["website","settings","account","admin"]]];
const homeBtn=$('nav button[data-view="overview"]:not([data-sub])');
// the button that opens a section; the Dashboard section opens through its own entry, since the plain one is Home
const orig=v=>v==="overview"?$('nav button[data-view="overview"][data-sub]:not([data-page])'):$(`nav button[data-view="${v}"]:not([data-sub]):not([data-page])`);
const pane=(v,k)=>$(`#${v} > .spane[data-pane="${k}"]`);
let active=null; // the open entry, when its section is shared
const page=id=>PAGES.find(p=>p[0]===id);

// fold panes together once, and give cross-section panes a home in their new section
// two passes: every fold first, so a pane emptied by a fold can then take a pane from another section
function build(){for(const [id,,v,tabs] of PAGES)for(const [host,,fold] of tabs){const h=pane(v,host);if(!h)continue;
    for(const k of fold){if(k===host)continue;const q=pane(v,k);if(q){[...q.children].forEach(c=>h.append(c));q.dataset.folded="1"}}h.dataset.home=id}
  for(const [id,,v,tabs] of PAGES){const sec=$("#"+v);if(!sec)continue;
    for(const [host,,,from] of tabs){if(!from)continue;let h=pane(v,host);
      if(!h){h=document.createElement("div");h.className="spane";h.dataset.pane=host;h.hidden=true;(sec.querySelector(":scope > .spane:last-of-type")||sec.querySelector(".ptabs")).after(h)}
      if(from!=="new"){const [fv,fk]=from.split(":"),src=pane(fv,fk);if(src){[...src.children].forEach(c=>h.append(c));src.dataset.folded="1"}}h.dataset.home=id}}
  $("#setup")?.classList.remove("setlay")}

// show one sub-tab: the section's own tab logic runs first (side effects, saved tab), then only our pane stays visible
function showTab(id,host){const p=page(id),v=p[2],sec=$("#"+v);if(!sec)return;
  const raw=RAW[v]||window.tabsOf?.[v];if(raw&&pane(v,host)&&!p[3].find(t=>t[0]===host)[3])raw(host);
  sec.querySelectorAll(":scope > .spane").forEach(s=>s.hidden=s.dataset.pane!==host);
  drawTabs(id,host);try{localStorage.setItem("rb-page-"+id,host)}catch{}
  if(/^analytics:/.test(p[3].find(t=>t[0]===host)[3]||"")&&typeof loadInsights==="function")setTimeout(()=>{try{loadInsights()}catch{}},30);
  dispatchEvent(new Event("resize"));dispatchEvent(new CustomEvent("pageshown",{detail:{page:id,tab:host}}))}
// the section's tab row shows only this entry's sub-tabs, renamed
function drawTabs(id,host){const p=page(id),sec=$("#"+p[2]),bar=sec?.querySelector(".ptabs");if(!bar)return;
  let mine=bar.querySelector(".pg-tabs");if(!mine){mine=document.createElement("div");mine.className="pg-tabs";bar.prepend(mine)}
  bar.classList.add("pg-on");
  mine.innerHTML=p[3].filter(t=>pane(p[2],t[0])).map(([k,l])=>`<button type="button" data-pg="${k}" aria-pressed="${k===host}">${l}</button>`).join("");
  mine.onclick=e=>{const b=e.target.closest("[data-pg]");if(b)showTab(id,b.dataset.pg)}}
let opening=0;
// each page carries its own name in the section's heading; the small line above it says which section it belongs to
const LEDE={inbox:"Every conversation, sorted by what needs you",support:"How well your AI solves what customers need",performance:"How chats turn into bookings, live",
  analytics:"The bigger picture over time",people:"Who your customers are and who to bring back",settings:"Your business and how the AI works for it",account:"Your login, devices and how Pulse looks"};
function title(id){const p=page(id),top=$("#"+p[2]+" .top");if(!top)return;const h=top.querySelector("h1"),sub=top.querySelector("p.sub,p");
  if(h){h.dataset.orig??=h.innerHTML;h.textContent=p[1]}if(sub){sub.dataset.orig??=sub.innerHTML;sub.textContent=LEDE[id]||""}
  top.querySelector(".eyebrow,small:first-child")?.setAttribute("hidden","")}
function openPage(id){const p=page(id);active=id;opening=Date.now();const v=p[2],b=orig(v);title(id);
  const here=!$("#"+v)?.hidden;if(!here)b?.click();
  let saved=null;try{saved=localStorage.getItem("rb-page-"+id)}catch{}
  const host=p[3].find(t=>t[0]===saved&&pane(v,t[0]))?.[0]||p[3].find(t=>pane(v,t[0]))?.[0];
  setTimeout(()=>{showTab(id,host);mark()},here?0:60)}

// the sidebar itself
function draw(){const nav=$("nav .navpills");if(!nav||nav.dataset.pg)return;nav.dataset.pg="1";
  $$("nav .navpills > .ns").forEach(x=>x.remove());
  $$("nav .navpills > button[data-view]").forEach(b=>{if(b!==homeBtn&&b.dataset.view!=="calendar"&&b.dataset.view!=="training"&&b.dataset.view!=="demo"&&b.dataset.view!=="website"&&b.id!=="adminNav")b.classList.add("nav-gone")});
  const entry={home:homeBtn,calendar:orig("calendar"),training:orig("training"),demo:orig("demo"),website:orig("website"),admin:$("#adminNav")};
  for(const [id,label,v] of PAGES){const b=document.createElement("button");b.type="button";b.dataset.view=v;b.dataset.page=id;b.title=label;b.setAttribute("aria-label",label);
    const icon=ICON[id]||orig(v)?.querySelector("svg")?.innerHTML||"";b.innerHTML=`<svg viewBox="0 0 24 24">${icon}</svg><span>${label}</span>`;
    b.addEventListener("click",e=>{e.stopImmediatePropagation();openPage(id)});entry[id]=b}
  const dm=entry.demo?.querySelector("span");if(dm)dm.textContent="Test lab";
  for(const [g,ids] of ORDER){const h=document.createElement("p");h.className="ns";h.textContent=g;nav.append(h);ids.forEach(i=>entry[i]&&nav.append(entry[i]))}
  // a page from a shared section mirrors that section's permission
  new MutationObserver(()=>PAGES.forEach(([id,,v])=>{const o=orig(v),b=entry[id];if(o&&b)b.hidden=o.hidden})).observe(nav,{subtree:true,attributes:true,attributeFilter:["hidden"]});
  PAGES.forEach(([id,,v])=>{const o=orig(v);if(o)entry[id].hidden=o.hidden})}
function mark(){const s=$("main > section:not([hidden])")?.id;
  $$("nav .navpills > button[data-view]").forEach(b=>{const on=b.dataset.page?(b.dataset.page===active&&s===b.dataset.view):(b===homeBtn?s==="today":s===b.dataset.view&&!PAGES.some(p=>p[2]===s));b.setAttribute("aria-current",String(on))});
  // leaving a shared section through another route: drop our tab row
  if(!PAGES.some(p=>p[0]===active&&p[2]===s)){$$(".ptabs.pg-on").forEach(b=>{b.classList.remove("pg-on");b.querySelector(".pg-tabs")?.remove()})}}
// a real click on another sidebar entry leaves the page; the clicks this file makes itself are not real
document.addEventListener("click",e=>{const b=e.target.closest("nav button[data-view]");if(b&&!b.dataset.page&&e.isTrusted)active=null;setTimeout(mark,80)},true);
addEventListener("tabshown",()=>setTimeout(mark,30));

// links elsewhere (Home buttons, notifications) still name the old tabs: send them to the right page
const OLD={live:"performance",flow:"performance",summary:"performance",trends:"performance",channels:"performance",services:"performance",conversations:"inbox",approvals:"inbox",queue:"inbox",reviews:"support"};
const RAW={};
function hookLinks(){["overview","analytics","people","setup"].forEach(v=>{if(window.tabsOf?.[v]&&!RAW[v])RAW[v]=tabsOf[v]});
  const t=RAW.overview;if(!t||tabsOf.overview.pg)return;
  // while a page is opening, the section's own opener asks for its default tab: let it, the page then shows its own
  const f=k=>{const id=OLD[k];if(!id||Date.now()-opening<400)return t(k);const p=page(id),host=p[3].find(x=>x[0]===k||x[2].includes(k))?.[0]||p[3][0][0];active=id;if($("#overview").hidden)orig("overview")?.click();setTimeout(()=>{showTab(id,host);mark()},60)};
  f.pg=1;tabsOf.overview=f}
function boot(){build();draw();hookLinks();mark()}
if(document.readyState==="complete")setTimeout(boot,0);else addEventListener("load",()=>setTimeout(boot,0));
window.openDashboard=()=>openPage("performance");
// other screens can open a page and sub-tab, e.g. Teach AI → Support / Knowledge gaps
addEventListener("openpage",e=>{const{page:id,tab}=e.detail||{};if(!page(id))return;openPage(id);if(tab)setTimeout(()=>showTab(id,tab),120)});
})();
