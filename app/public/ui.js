// Data tables: click a column name to sort (again to reverse). The sort survives live refreshes.
(function(){
const val=td=>{const t=(td?.innerText||"").trim(),n=t.replace(/[^\d.\-]/g,"");return /\d/.test(t)&&/^[^a-z]*\d/i.test(t)&&n&&!isNaN(+n)?+n:t.toLowerCase()};
function apply(table){const s=table._sort;if(!s)return;const tb=table.tBodies[0];if(!tb)return;
  const rows=[...tb.rows];if(rows.length<2||rows.some(r=>r.cells.length<=s.col))return;
  rows.sort((a,b)=>{const x=val(a.cells[s.col]),y=val(b.cells[s.col]);return (x>y?1:x<y?-1:0)*s.dir});
  table._busy=1;tb.append(...rows);table._busy=0}
document.querySelectorAll("table").forEach(table=>{const head=table.tHead;if(!head)return;
  [...head.rows[0].cells].forEach((th,col)=>{th.classList.add("sortable");th.tabIndex=0;th.setAttribute("aria-sort","none");
    const go=()=>{const s=table._sort,dir=s&&s.col===col?-s.dir:(col===0?1:-1);table._sort={col,dir};
      [...head.rows[0].cells].forEach(h=>h.setAttribute("aria-sort","none"));th.setAttribute("aria-sort",dir>0?"ascending":"descending");apply(table)};
    th.addEventListener("click",go);th.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go()}})});
  if(table.tBodies[0])new MutationObserver(()=>{if(!table._busy)apply(table)}).observe(table.tBodies[0],{childList:true})});
})();

// Command palette (Ctrl K / Cmd K) on every page: jump to any page or tab, run an action, or find a client or conversation.
(function(){
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const box=document.createElement("div");box.className="kp";box.hidden=true;box.setAttribute("role","dialog");box.setAttribute("aria-label","Search everything");
box.innerHTML=`<div class="kp-panel"><div class="kp-in"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="kpQ" placeholder="Search pages, clients, conversations, actions…" autocomplete="off" aria-label="Search"><kbd>Esc</kbd></div><div class="kp-res" id="kpRes" role="listbox"></div><div class="kp-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd><kbd>K</kbd> anywhere</span></div></div>`;
document.body.append(box);
const q=box.querySelector("#kpQ"),res=box.querySelector("#kpRes");let items=[],sel=0,t=0,seq=0;
// Every page in the sidebar plus every tab inside it
function pages(){const out=[];
  document.querySelectorAll("nav button[data-view]").forEach(b=>{if(b.hidden||b.dataset.sub)return;const v=b.dataset.view,label=b.textContent.trim().replace(/\d+$/,"");
    out.push({k:"Page",t:label,run:()=>b.click()});
    document.querySelectorAll(`#${v} .ptabs button[data-tab]`).forEach(tb=>{if(tb.hidden)return;
      out.push({k:label,t:tb.textContent.trim().replace(/\d+$/,""),run:()=>{b.click();setTimeout(()=>window.tabsOf?.[v]?.(tb.dataset.tab),60)}})})});
  const go=(view,sub)=>()=>document.querySelector(`nav button[data-view="${view}"]${sub?`[data-sub="${sub}"]`:":not([data-sub])"}`)?.click();
  out.push({k:"Action",t:"New booking",run:()=>{const b=document.querySelector('[data-go="newbooking"]');b?b.click():go("calendar")()}},
           {k:"Action",t:"Test the AI in a chat",run:go("demo")},{k:"Action",t:"Account security and two-factor",run:()=>document.querySelector("#pwBtn")?.click()},
           {k:"Action",t:"Switch light or dark",run:()=>document.querySelector("#themeBtn")?.click()},{k:"Action",t:"Notifications",run:()=>document.querySelector("#bellBtn")?.click()});
  return out}
const score=(s,w)=>{s=s.toLowerCase();if(!w)return 1;if(s.startsWith(w))return 3;if(s.split(/\s+/).some(x=>x.startsWith(w)))return 2;return s.includes(w)?1:0};
function draw(){res.innerHTML=items.length?items.map((it,i)=>`<button type="button" role="option" class="kp-it" aria-selected="${i===sel}" data-i="${i}"${it.cust?` data-cust="${it.cust}"`:""}${it.conv?` data-open="${it.conv}"`:""}><span class="kp-k">${esc(it.k)}</span><b>${esc(it.t)}</b>${it.s?`<small>${esc(it.s)}</small>`:""}</button>`).join("")
  :`<p class="kp-none">Nothing found for “${esc(q.value)}”.</p>`;res.querySelector('[aria-selected="true"]')?.scrollIntoView({block:"nearest"})}
async function search(){const w=q.value.trim().toLowerCase(),my=++seq;
  items=pages().map(p=>({...p,sc:Math.max(score(p.t,w),score(p.k,w)*.5)})).filter(p=>p.sc>0).sort((a,b)=>b.sc-a.sc).slice(0,w?8:14);sel=0;draw();
  if(w.length<2)return;
  const [cs,cv]=await Promise.all([fetch(`/api/customers?q=${encodeURIComponent(w)}&test=1`).then(r=>r.ok?r.json():[]).catch(()=>[]),fetch("/api/conversations").then(r=>r.ok?r.json():[]).catch(()=>[])]);
  if(my!==seq)return;
  const people=(Array.isArray(cs)?cs:[]).slice(0,5).map(c=>({k:"Client",t:c.name||"No name",s:[c.phone||c.email,c.visits!=null?c.visits+" visits":""].filter(Boolean).join(" · "),cust:c.id,run:()=>{}}));
  const chats=(Array.isArray(cv)?cv:[]).filter(c=>`${c.name||""} ${c.phone||""} ${c.last||""}`.toLowerCase().includes(w)).slice(0,5).map(c=>({k:"Conversation",t:c.name||c.phone||"Customer",s:c.last||"",conv:c.id,run:()=>{}}));
  items=[...items,...people,...chats];draw()}
function open(){box.hidden=false;q.value="";search();requestAnimationFrame(()=>q.focus())}
function close(){box.hidden=true}
function pick(i){const it=items[i];if(!it)return;close();if(it.cust||it.conv){const b=res.querySelector(`[data-i="${i}"]`);b&&document.body.append(b);b?.click();b?.remove()}else it.run()}
document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();e.stopImmediatePropagation();box.hidden?open():close()}},true);
q.addEventListener("input",()=>{clearTimeout(t);t=setTimeout(search,150)});
q.addEventListener("keydown",e=>{if(e.key==="Escape")close();else if(e.key==="ArrowDown"){e.preventDefault();sel=Math.min(items.length-1,sel+1);draw()}else if(e.key==="ArrowUp"){e.preventDefault();sel=Math.max(0,sel-1);draw()}else if(e.key==="Enter"){e.preventDefault();pick(sel)}});
res.addEventListener("click",e=>{const b=e.target.closest(".kp-it");if(b){e.stopPropagation();pick(+b.dataset.i)}});
box.addEventListener("mousedown",e=>{if(e.target===box)close()});
// the search field on the dashboard opens the same palette
document.querySelector("#cmdQ")?.addEventListener("focus",e=>{e.target.blur();open()});
window.openPalette=open;
})();
