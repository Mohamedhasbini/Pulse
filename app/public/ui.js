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

// Command palette: see palette.js
