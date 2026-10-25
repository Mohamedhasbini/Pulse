// Website screen in Pulse: the client edits texts and gallery photos; the platform admin also controls
// style, colour, sections, languages, address and publishing. Live preview on phone or computer.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const SEC_LABEL={hero:"Top banner",about:"About",services:"Services and prices",booking:"Booking call-to-action",gallery:"Photo gallery",team:"Team",reviews:"Reviews",hours:"Opening hours and map",faq:"Questions",contact:"Contact"};
const FIELDS=[["tagline","Small line above the title","Beauty salon · Hamra, Beirut",120],["hero_title","Main title","Hair, nails and glow, done beautifully.",120],["hero_sub","Text under the title","Colour specialists since 2012…",300],["about_title","About: title","A salon that feels like home",120],["about","About: text (empty lines start a new paragraph)","",3000]];
let W=null,lang="en",device="phone",dirty=false;

const sec=document.createElement("section");sec.className="wrap";sec.id="website";sec.hidden=true;
sec.innerHTML=`<div class="top"><div><h1>Your <b>website</b></h1><p class="sub" id="wsSub">Loading…</p></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="tag" id="wsState"></span><a class="btn ghost" id="wsOpen" target="_blank" rel="noopener">Open website</a><button class="btn" type="button" id="wsSave">Save changes</button></div></div>
<div class="card glass" id="wsLocked" hidden><div class="empty" style="padding:30px 10px"><h2 style="margin:0 0 6px">Website isn't switched on for this business</h2><p class="sub" id="wsLockedMsg"></p></div></div>
<div class="wsgrid" id="wsMain">
  <div class="wsedit">
    <div class="tabs glass" role="tablist" id="wsTabs"><button type="button" data-t="text" aria-pressed="true">Texts</button><button type="button" data-t="photos" aria-pressed="false">Photos</button><button type="button" data-t="design" aria-pressed="false" class="wsAdm">Design</button><button type="button" data-t="address" aria-pressed="false" class="wsAdm">Address and publishing</button></div>
    <div class="card glass" data-p="text"><div class="ch"><h2>Texts</h2></div><div class="form" id="wsText" style="grid-template-columns:1fr"></div>
      <p class="sub" style="margin:8px 0 0;font-size:13px">Services, prices, opening hours, team, questions and contact details come from <a href="#" data-goset="details">Settings → Business details</a>, so they're always the same everywhere.</p></div>
    <div class="card glass" data-p="photos" hidden><div class="ch"><h2>Photos</h2><small id="wsGalN"></small></div>
      <p class="sub" style="margin:0 0 12px;font-size:13px">Up to 12 photos for the gallery (JPG, PNG or WEBP, max 8 MB). The cover photo and logo are set in <a href="#" data-goset="details">Settings → Business details</a>.</p>
      <div class="wsgal" id="wsGal"></div><label class="btn ghost" style="margin-top:12px;display:inline-flex;cursor:pointer">Add photos<input type="file" id="wsGalIn" accept="image/jpeg,image/png,image/webp" multiple hidden></label></div>
    <div class="card glass wsAdm" data-p="design" hidden>
      <div class="ch"><h2>Style</h2></div><div class="wsstyles" id="wsStyles"></div>
      <div class="form" style="margin-top:14px"><label>Highlight colour<input type="color" id="wsAccent" style="height:44px;padding:4px"></label><label class="switch" style="align-self:end"><input type="checkbox" id="wsAccentDef"> Use the style's own colour</label></div>
      <div class="ch" style="margin-top:18px"><h2>Sections</h2><small>tick to show, arrows to reorder</small></div><div class="list" id="wsSecs"></div>
</div>
    <div class="card glass wsAdm" data-p="address" hidden>
      <div class="ch"><h2>Publishing</h2></div><label class="switch"><input type="checkbox" id="wsPub"> Published: anyone can open the website</label>
      <div class="ch" style="margin-top:18px"><h2>Free address</h2></div>
      <div class="form" style="grid-template-columns:1fr"><label>Subdomain<div style="display:flex;align-items:center;gap:6px"><input id="wsSub2" placeholder="laylabeauty" style="flex:1"><span class="sub" id="wsRoot"></span></div></label></div>
      <div class="ch" style="margin-top:18px"><h2>Own domain</h2></div>
      <div class="form" style="grid-template-columns:1fr"><label>Domain<input id="wsDom" placeholder="laylabeauty.com"></label></div>
      <div class="item" style="display:block;font-size:13.5px" id="wsDns"></div></div>
  </div>
  <div class="wsprev card glass"><div class="ch"><h2>Preview</h2><div class="tabs" id="wsDev" role="group" aria-label="Device"><button type="button" data-d="phone" aria-pressed="true">Phone</button><button type="button" data-d="desktop" aria-pressed="false">Computer</button></div></div>
    <div class="wsframe" id="wsFrameBox"><iframe id="wsFrame" title="Website preview"></iframe></div><p class="sub" style="margin:8px 0 0;font-size:12.5px">The preview shows saved changes.</p></div>
</div>`;
document.querySelector("main").append(sec);
document.head.insertAdjacentHTML("beforeend",`<style>
.wsgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;align-items:start}
.wsedit{display:flex;flex-direction:column;gap:14px;min-width:0}.wsedit>.tabs{align-self:flex-start;flex-wrap:wrap}
.wsprev{position:sticky;top:16px}.wsframe{display:flex;justify-content:center;background:var(--s2,rgba(0,0,0,.05));border-radius:14px;padding:12px;overflow:hidden}
.wsframe iframe{border:0;background:#fff;border-radius:22px;box-shadow:0 20px 40px -20px rgba(0,0,0,.5);width:375px;height:min(70vh,720px);transform-origin:top center}
.wsframe.desk iframe{width:1280px;height:800px;border-radius:10px;transform:scale(var(--k,.45));margin-bottom:calc(800px * (var(--k,.45) - 1))}
.wsstyles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.wsstyles button{border:2px solid var(--line);border-radius:14px;padding:14px;text-align:start;cursor:pointer;background:var(--s1,transparent);color:inherit;display:flex;flex-direction:column;gap:8px}
.wsstyles button[aria-pressed=true]{border-color:var(--accent)}.wsstyles i{display:block;height:28px;border-radius:8px}
.wsgal{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}.wsgal figure{margin:0;position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;background:var(--s2)}
.wsgal img{width:100%;height:100%;object-fit:cover}.wsgal .acts{position:absolute;inset:auto 6px 6px 6px;display:flex;gap:4px;justify-content:flex-end}
.wsgal .acts button{border:0;border-radius:8px;background:rgba(0,0,0,.65);color:#fff;width:30px;height:30px;cursor:pointer}
#wsSecs .item{gap:10px}#wsSecs .item button{min-width:32px}
@media (max-width:1100px){.wsgrid{grid-template-columns:1fr}.wsprev{position:static}}
</style>`);

// navigation: a "Website" entry next to Insights
const nav=document.querySelector('nav button[data-view="analytics"]');
const nb=document.createElement("button");nb.dataset.view="website";nb.title="Website";nb.setAttribute("aria-label","Website");
nb.innerHTML=`<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/></svg><span>Website</span>`;
nav.after(nb);
nb.addEventListener("click",()=>{$$("nav button[data-view]").forEach(x=>x.setAttribute("aria-current",x===nb));$$("main > section.wrap").forEach(s=>s.hidden=s!==sec);
  document.body.dataset.page="website";scrollTo(0,0);load()});
// other entries hide this screen
$$("nav button[data-view]").forEach(b=>{if(b!==nb)b.addEventListener("click",()=>{sec.hidden=true})});
document.addEventListener("click",e=>{const a=e.target.closest("[data-goset]");if(!a)return;e.preventDefault();document.querySelector('nav button[data-view="setup"]').click();setTimeout(()=>window.tabsOf?.setup?.(a.dataset.goset),30)});

async function load(){
  try{W=await req("/api/site")}catch(e){$("#wsSub").textContent=e.message;return}
  const s=W.site;$$(".wsAdm").forEach(x=>x.hidden=!W.is_admin);
  $("#wsLocked").hidden=W.allowed;$("#wsMain").hidden=!W.allowed;$("#wsSave").hidden=!W.allowed;$("#wsOpen").hidden=!W.allowed;
  $("#wsLockedMsg").textContent=W.is_admin?"Tick \"Own website\" in this business's plan or add-ons (Command center → Businesses) to switch it on.":"Ask your Pulse team about adding a website to your plan.";
  if(!W.allowed){$("#wsSub").textContent="";$("#wsState").textContent="";return}
  const live=W.custom_domain?`https://${W.custom_domain}`:W.subdomain&&W.sites_domain?`https://${W.subdomain}.${W.sites_domain}`:null;
  $("#wsOpen").href=s.published&&live?live:`/s/${W.id}`;$("#wsOpen").textContent=s.published&&live?"Open website":"Open preview";
  $("#wsState").className="tag "+(s.published?"t-book":"t-faq");$("#wsState").textContent=s.published?"Published":"Not published";
  $("#wsSub").innerHTML=s.published&&live?`Live at <a href="${esc(live)}" target="_blank" rel="noopener">${esc(live.replace("https://",""))}</a>`
    :s.published?(W.is_admin?"Published. Add a subdomain or domain in Address and publishing to give it a web address.":"Published. Your web address is being connected.")
    :W.is_admin?"Set it up, then publish it from Address and publishing.":"Your Pulse team publishes the website when it's ready.";
  drawText();drawGallery();if(W.is_admin){drawDesign();drawAddress()}dirty=false;refresh()}

function drawText(){const s=W.site;
  const t=s.text[lang]||{};
  $("#wsText").innerHTML=FIELDS.map(([k,l,ph,max])=>`<label>${l}${k==="about"?`<textarea data-k="${k}" rows="6" maxlength="${max}" placeholder="${esc(ph)}"`:`<input data-k="${k}" maxlength="${max}" placeholder="${esc(ph)}"`}>${k==="about"?esc(t[k]||"")+"</textarea>":""}</label>`).join("");
  FIELDS.forEach(([k])=>{if(k!=="about")$(`#wsText [data-k="${k}"]`).value=t[k]||""})}
function keepText(){if(!W)return;const t=W.site.text[lang]={...(W.site.text[lang]||{})};$$("#wsText [data-k]").forEach(i=>t[i.dataset.k]=i.value)}
$("#wsText").addEventListener("input",()=>dirty=true);

function drawGallery(){const g=W.site.gallery;$("#wsGalN").textContent=`${g.length} of 12`;
  $("#wsGal").innerHTML=g.length?g.map((u,i)=>`<figure><img src="${esc(u)}" alt=""><div class="acts"><button type="button" data-mv="${i}" title="Move earlier" aria-label="Move earlier">‹</button><button type="button" data-rm="${i}" title="Remove" aria-label="Remove">✕</button></div></figure>`).join(""):`<p class="sub" style="grid-column:1/-1;margin:0">No photos yet.</p>`}
$("#wsGal").addEventListener("click",async e=>{const g=W.site.gallery,m=e.target.closest("[data-mv]"),r=e.target.closest("[data-rm]");
  if(m&&+m.dataset.mv>0){const i=+m.dataset.mv;[g[i-1],g[i]]=[g[i],g[i-1]]}else if(r){if(!confirm("Remove this photo from the website?"))return;g.splice(+r.dataset.rm,1)}else return;
  await save({gallery:g},"Photos updated.")});
$("#wsGalIn").onchange=async e=>{const files=[...e.target.files];e.target.value="";
  for(const f of files){if(f.size>8*1024*1024){toast(`${f.name} is over 8 MB.`);continue}
    const r=await fetch("/api/business/upload/gallery",{method:"POST",headers:{"Content-Type":f.type},body:f}),j=await r.json().catch(()=>({}));
    if(!r.ok){toast(j.error||"Upload failed.");break}}
  toast("Photos added.");load()};

function drawDesign(){const s=W.site;
  $("#wsStyles").innerHTML=Object.entries(W.styles).map(([k,v])=>`<button type="button" data-s="${k}" aria-pressed="${s.style===k}"><i style="background:${v.accent}"></i><b>${esc(v.label)}</b></button>`).join("");
  $("#wsAccentDef").checked=!s.accent;$("#wsAccent").value=s.accent||W.styles[s.style].accent;$("#wsAccent").disabled=!s.accent;
  const order=[...s.sections,...W.sections.filter(x=>!s.sections.includes(x))];
  $("#wsSecs").innerHTML=order.map((k,i)=>`<div class="item" data-sec="${k}"><label class="switch" style="flex:1"><input type="checkbox" ${s.sections.includes(k)?"checked":""} ${k==="hero"?"disabled":""}> ${SEC_LABEL[k]||k}</label><button type="button" class="mini" data-up="${i}" aria-label="Move up">↑</button><button type="button" class="mini" data-down="${i}" aria-label="Move down">↓</button></div>`).join("");
}
$("#wsStyles").addEventListener("click",e=>{const b=e.target.closest("[data-s]");if(!b)return;W.site.style=b.dataset.s;if(!W.site.accent)$("#wsAccent").value=W.styles[b.dataset.s].accent;$$("#wsStyles button").forEach(x=>x.setAttribute("aria-pressed",x===b));save({style:b.dataset.s},"Style changed.")});
$("#wsAccentDef").onchange=()=>{$("#wsAccent").disabled=$("#wsAccentDef").checked;dirty=true};$("#wsAccent").oninput=()=>dirty=true;
$("#wsSecs").addEventListener("click",e=>{const u=e.target.closest("[data-up]"),d=e.target.closest("[data-down]");if(!u&&!d)return;const rows=$$("#wsSecs .item"),i=+(u||d).dataset[u?"up":"down"],j=u?i-1:i+1;
  if(j<0||j>=rows.length)return;u?rows[j].before(rows[i]):rows[j].after(rows[i]);$$("#wsSecs .item").forEach((r,k)=>{r.querySelector("[data-up]").dataset.up=k;r.querySelector("[data-down]").dataset.down=k});dirty=true});
$("#wsSecs").addEventListener("change",()=>dirty=true);

function drawAddress(){$("#wsPub").checked=!!W.site.published;$("#wsSub2").value=W.subdomain||"";$("#wsDom").value=W.custom_domain||"";
  $("#wsRoot").textContent=W.sites_domain?"."+W.sites_domain:"(set SITES_DOMAIN in .env)";
  const d=W.custom_domain;
  $("#wsDns").innerHTML=d?`<b>Connect ${esc(d)}</b><ol style="margin:6px 0 0;padding-inline-start:18px;line-height:1.7">
    <li>In Cloudflare, add the domain as a custom hostname for the platform (or to the tunnel: <code>${esc(d)}</code> and <code>www.${esc(d)}</code> → <code>http://localhost:3100</code>).</li>
    <li>At the client's domain provider, point <code>${esc(d)}</code> and <code>www</code> to the platform with a CNAME, as Cloudflare shows.</li>
    <li>Open <a href="https://${esc(d)}" target="_blank" rel="noopener">https://${esc(d)}</a>. It shows this website once it's published.</li></ol>`
    :`<span class="sub">Add the client's domain above to see how to connect it.</span>`}
["wsPub","wsSub2","wsDom"].forEach(id=>$("#"+id).addEventListener("input",()=>dirty=true));

async function save(body,msg){try{const r=await req("/api/site","PUT",body);W.site=r.site;toast(msg||"Saved.");await load()}catch(e){toast(e.message)}}
$("#wsSave").onclick=()=>{keepText();const body={text:W.site.text};
  if(W.is_admin){body.accent=$("#wsAccentDef").checked?"":$("#wsAccent").value;
    body.sections=$$("#wsSecs .item").filter(r=>r.querySelector("input").checked||r.dataset.sec==="hero").map(r=>r.dataset.sec);
    body.published=$("#wsPub").checked;
    body.subdomain=$("#wsSub2").value.trim();body.custom_domain=$("#wsDom").value.trim()}
  save(body,"Website saved.")};

$("#wsTabs").addEventListener("click",e=>{const b=e.target.closest("[data-t]");if(!b)return;$$("#wsTabs button").forEach(x=>x.setAttribute("aria-pressed",x===b));$$("#wsMain [data-p]").forEach(p=>p.hidden=p.dataset.p!==b.dataset.t)});
$("#wsDev").addEventListener("click",e=>{const b=e.target.closest("[data-d]");if(!b)return;device=b.dataset.d;$$("#wsDev button").forEach(x=>x.setAttribute("aria-pressed",x===b));refresh()});
function refresh(){if(!W)return;const box=$("#wsFrameBox");box.classList.toggle("desk",device==="desktop");
  if(device==="desktop")box.style.setProperty("--k",Math.min(1,(box.clientWidth-24)/1280).toFixed(3));
  $("#wsFrame").src=`/s/${W.id}?lang=${lang}&t=${Date.now()}`}
addEventListener("resize",()=>{if(!sec.hidden&&device==="desktop")$("#wsFrameBox").style.setProperty("--k",Math.min(1,($("#wsFrameBox").clientWidth-24)/1280).toFixed(3))});
addEventListener("beforeunload",e=>{if(dirty&&!sec.hidden){e.preventDefault();e.returnValue=""}});
})();
