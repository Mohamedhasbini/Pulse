// Shared helpers: $, formatting, business time, req() for API calls. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=n=>"$"+Math.round(n||0).toLocaleString();
const DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const pad=n=>String(n).padStart(2,"0");
// All dates from the server are the business's local time, "YYYY-MM-DDTHH:MM". Parse them as plain
// local values so the dashboard shows business time whatever the viewer's time zone is.
const L=s=>{const[d,t="00:00"]=s.split("T"),[y,m,dd]=d.split("-").map(Number),[h,mi]=t.split(":").map(Number);return new Date(y,m-1,dd,h,mi)};
const stamp=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey=d=>stamp(d).slice(0,10),hm=d=>stamp(d).slice(11);
const nice=(d,o)=>d.toLocaleString("en-GB",o);
let bizOffset=0;const bizNow=()=>new Date(Date.now()+bizOffset);
function syncNow(s){if(s)bizOffset=L(s)-Date.now()+new Date().getSeconds()*1000}

async function req(p,method="GET",body){if(window.LAB&&/^\/api\/(?!me(\/|$)|admin\/|logout$|verticals$)/.test(p))return new Promise(()=>{});const r=await fetch(p,{method,headers:{"Content-Type":"application/json"},body:body&&JSON.stringify(body)});
  if(r.status===401){location.href="/login";throw new Error("Signed out")}
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(j.error||"Something went wrong."),{status:r.status});return j}
let tm;function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(tm);tm=setTimeout(()=>e.classList.remove("on"),2800)}
function tween(el,to,f=v=>Math.round(v).toLocaleString()){const from=+el.dataset.v||0;el.dataset.v=to;const t0=performance.now();
  const st=t=>{const k=Math.min(1,(t-t0)/600),e=1-Math.pow(1-k,3);el.textContent=f(from+(to-from)*e);if(k<1)requestAnimationFrame(st)};requestAnimationFrame(st)}
const ago=s=>{const m=Math.round((bizNow()-L(s))/60000);return m<1?"just now":m<60?m+" min ago":m<1440?Math.round(m/60)+" h ago":nice(L(s),{day:"numeric",month:"short"})};

let biz=null,days=30,lastStats=null,convs=[];
const testQ=()=>$("#incTest").checked?"":"&test=0";

