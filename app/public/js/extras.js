// Booking link, approvals, coupons, setup media, platform health and leads. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- booking link ----------
function setBookingLink(u){$("#blUrl").value=u;$("#blOpen").href=u;
  $("#blEmbed").value=`<a href="${u}" target="_blank" style="display:inline-block;padding:12px 22px;border-radius:99px;background:#10a35a;color:#fff;font:600 15px sans-serif;text-decoration:none">Book now</a>`}
async function copy(v){try{await navigator.clipboard.writeText(v);toast("Copied.")}catch{toast("Select the text and copy it.")}}
$("#blCopy").onclick=()=>copy($("#blUrl").value);$("#blCopy2").onclick=()=>copy($("#blEmbed").value);

// ---------- approvals ----------
let apprStatus="pending",apprs=[];
const TYPE={cancel:["Late cancellation","t-attn"],reschedule:["Late time change","t-hand"],extra:["Extra request","t-faq"]};
async function loadApprovals(){apprs=await req("/api/requests?status="+apprStatus);
  $("#approvals").innerHTML=apprs.length?apprs.map(r=>{const t=TYPE[r.type]||[r.type,"t-faq"];
    return `<div class="item" style="align-items:flex-start"><div class="grow"><b>${esc(r.name||r.phone)} · RB-${String(r.booking_id).padStart(4,"0")} <span class="tag ${t[1]}" style="display:inline">${t[0]}</span></b>
      <span style="white-space:normal">${esc(r.service)} · ${nice(L(r.start),{weekday:"short",day:"numeric",month:"short"})} ${hm(L(r.start))}${r.new_start?` → <b style="display:inline">${nice(L(r.new_start),{weekday:"short",day:"numeric",month:"short"})} ${hm(L(r.new_start))}</b>`:""}${r.type==="extra"?" · "+esc(r.details):""} · ${ago(r.at)}</span>
      ${r.staff_note?`<span>Your note: ${esc(r.staff_note)}</span>`:""}</div>
      <div class="acts">${r.status==="pending"?`<button class="mini" data-appr="${r.id}" data-d="approve" style="color:var(--good);border-color:var(--good)">Approve</button><button class="mini" data-appr="${r.id}" data-d="reject">Reject</button>`:""}${r.conversation_id?`<button class="mini" data-open="${r.conversation_id}">Chat</button>`:""}</div></div>`}).join("")
    :`<div class="empty">${apprStatus==="pending"?"Nothing waiting for approval.":"None yet."}</div>`}
document.getElementById("apprTabs").onclick=e=>{const b=e.target.closest("button");if(!b)return;document.querySelectorAll("#apprTabs button").forEach(x=>x.setAttribute("aria-pressed",x===b));apprStatus=b.dataset.s;loadApprovals()};
document.addEventListener("click",async e=>{const a=e.target.closest("[data-appr]");if(!a)return;
  const card=a.closest(".item");let note=card.querySelector(".apnote");
  if(!note){note=document.createElement("div");note.className="apnote";note.style.cssText="display:flex;gap:6px;width:100%;margin-top:8px";
    note.innerHTML=`<input placeholder="Optional note to the customer" aria-label="Note to the customer"><button class="mini" data-go="${a.dataset.d}">${a.dataset.d==="approve"?"Confirm approve":"Confirm reject"}</button>`;
    card.querySelector(".grow").appendChild(note);note.querySelector("input").focus();
    note.querySelector("[data-go]").onclick=async()=>{try{await req(`/api/requests/${a.dataset.appr}/${a.dataset.d}`,"POST",{note:note.querySelector("input").value});
      toast(a.dataset.d==="approve"?"Approved. The customer has been told.":"Rejected. The customer has been told.");loadApprovals();refresh();if(weekStart)loadCal()}
      catch(err){if(err.status===409&&a.dataset.d==="approve"&&/no longer free/.test(err.message)){note.innerHTML=`<span style="color:var(--bad)">${esc(err.message)}</span>`}else toast(err.message)}};
  }else note.querySelector("[data-go]").textContent=a.dataset.d==="approve"?"Confirm approve":"Confirm reject",note.querySelector("[data-go]").dataset.go=a.dataset.d});

// ---------- coupons ----------
async function loadCoupons(){const c=await req("/api/coupons");
  $("#coupons").innerHTML=c.length?c.map(x=>`<div class="item"><div class="grow"><b>${esc(x.code)} · ${x.kind==="percent"?x.value+"% off":fmt(x.value)+" off"}</b>
    <span>Used ${x.uses}${x.max_uses?" of "+x.max_uses:""} times${x.expires_on?" · expires "+x.expires_on:""}</span></div>
    <div class="acts"><span class="tag ${x.active?"t-book":"t-faq"}">${x.active?"Active":"Off"}</span><button class="mini" data-cp="${x.id}" data-on="${x.active?0:1}">${x.active?"Turn off":"Turn on"}</button></div></div>`).join(""):`<div class="empty">No codes yet. Add one above; customers can then use it in chat.</div>`}
$("#cpForm").onsubmit=async e=>{e.preventDefault();try{await req("/api/coupons","POST",{code:$("#cpCode").value,kind:$("#cpKind").value,value:$("#cpVal").value,expires_on:$("#cpExp").value,max_uses:$("#cpMax").value});
  $("#cpForm").reset();toast("Code added.");loadCoupons()}catch(err){toast(err.message)}};
document.addEventListener("click",async e=>{const c=e.target.closest("[data-cp]");if(!c)return;await req(`/api/coupons/${c.dataset.cp}`,"PATCH",{active:c.dataset.on==="1"});loadCoupons()});

// ---------- test chat: show messages that arrive later (e.g. your approval decisions) ----------
let testConv=null,testSeen=0;
async function pollTestChat(){if(!testConv||$("#demo").hidden||busy)return;const m=await req(`/api/conversations/${testConv}/messages`);
  m.slice(testSeen).forEach(x=>{if(x.role==="staff")add(x.text,"ai","from the team · just now");else if(x.role==="assistant")add(x.text,"ai","message from the business")});testSeen=m.length}

{let d0=30;try{d0=+localStorage.getItem("rb-days")||30}catch{}if([1,7,30,90,365].includes(d0)&&d0!==30){days=d0;inDays=d0}document.querySelectorAll("button[data-d]").forEach(x=>x.setAttribute("aria-pressed",+x.dataset.d===days));document.querySelectorAll(".plabel").forEach(x=>x.textContent=PLABEL(days))}
loadMe().then(()=>{if(me.lab)return;if(canSee("teach"))loadTeach().catch(()=>{});req("/api/business").then(b=>{biz=b;fillSetup();applyTerms();loadVerticals();loadChannels();loadApprovals();loadCoupons();refresh().then(()=>{$("#fTz").textContent=`Time zone: ${lastStats?.tz||"?"}. To change it, set TIMEZONE in the .env file.`})})}).catch(()=>{});
// The Lab: the platform admin with no business opened. Only the Command center is shown.
function enterLab(){window.LAB=true;document.body.classList.add("labmode");
  document.querySelectorAll("nav button[data-view]").forEach(x=>x.hidden=x.id!=="adminNav");document.querySelectorAll("nav .ns").forEach(x=>x.hidden=true);
  $("#adminNav").hidden=false;$("#labBtn")&&($("#labBtn").hidden=true);$("#planCard").hidden=true;$("#planBar").hidden=true;$("#planBar").classList.remove("adminview");
  $("#planText").innerHTML=`<span class="tag t-book">Lab</span> You're in your Lab. Open a business from the list to work inside it.`;
  $("#adminNav").click()}
// ---------- Setup: logo, cover photo and menu ----------
function drawUploads(){document.querySelectorAll("[data-up]").forEach(box=>{const k=box.dataset.up,u=biz&&biz[k+"_url"];
  box.querySelector(".upv").innerHTML=!u?`<small class="sub">Nothing uploaded yet</small>`:/\.pdf$/i.test(u)?`<a href="${esc(u)}" target="_blank" rel="noopener">Open the PDF</a>`:`<img src="${esc(u)}" alt="" style="width:100%;height:110px;object-fit:cover;border-radius:10px">`;
  box.querySelector(".upx").hidden=!u})}
document.querySelectorAll("[data-up]").forEach(box=>{const k=box.dataset.up;
  box.querySelector("input[type=file]").onchange=async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;if(f.size>8*1024*1024)return toast("That file is over 8 MB.");
    toast("Uploading…");const r=await fetch("/api/business/upload/"+k,{method:"POST",headers:{"Content-Type":f.type},body:f}),j=await r.json().catch(()=>({}));
    if(!r.ok)return toast(j.error||"Upload failed.");biz[k+"_url"]=j.url;drawUploads();toast("Uploaded.")};
  box.querySelector(".upx").onclick=async()=>{await req("/api/business/upload/"+k,"DELETE");biz[k+"_url"]=null;drawUploads();toast("Removed.")}});

// ---------- Command center: platform health, usage and cost per client, export and close ----------
$("#ccTabs").insertAdjacentHTML("beforeend",`<button aria-pressed="false" data-c="platform">Platform</button>`);
$("#ccLeads").insertAdjacentHTML("afterend",`<div id="ccPlatform" hidden>
  <div class="card glass"><div class="ch"><h2>System health</h2><small>checked every 5 minutes · problems are sent to your Telegram</small></div><div class="list" id="plHealth"></div></div>
  <div class="card glass"><div class="ch"><h2>Usage and cost per client</h2><select id="plDays" aria-label="Period"><option value="30">Last 30 days</option><option value="7">Last 7 days</option><option value="90">Last 90 days</option></select></div>
    <p class="sub" style="margin:0 0 10px;font-size:13px">Estimated costs: AI reply ≈ $0.001, WhatsApp reminder or offer ≈ $0.02 (replies inside 24 h are free). Change them with COST_PER_AI_REPLY and COST_PER_WA_TEMPLATE in .env.</p>
    <div class="tw"><table><thead><tr><th>Business</th><th>Customer messages</th><th>AI replies</th><th>WhatsApp sent</th><th>Reminders and offers</th><th>Bookings</th><th>Est. cost</th><th>Plan</th><th>Margin</th><th></th></tr></thead><tbody id="plUse"></tbody></table></div></div>
</div>`);
$("#ccTabs button[data-c=platform]").addEventListener("click",e=>{document.querySelectorAll("#ccTabs button").forEach(x=>x.setAttribute("aria-pressed",x===e.currentTarget));
  ["Biz","Users","Plans","Audit","Leads","New"].forEach(k=>{const el=$("#cc"+k);if(el)el.hidden=true});$("#ccPlatform").hidden=false;loadPlatform()});
document.querySelectorAll("#ccTabs button:not([data-c=platform])").forEach(b=>b.addEventListener("click",()=>{$("#ccPlatform").hidden=true}));
$("#plDays").onchange=loadPlatform;
async function loadPlatform(){
  const h=await req("/api/admin/health");$("#plHealth").innerHTML=h.map(c=>`<div class="item"><span class="tag ${c.ok?"t-book":"t-attn"}">${c.ok?"OK":"Check"}</span><div class="grow"><b>${esc(c.name)}</b><small>${esc(c.detail||"")}</small></div></div>`).join("");
  const u=await req("/api/admin/usage?days="+$("#plDays").value),usd=v=>"$"+(Math.round(v*100)/100).toFixed(2);
  $("#plUse").innerHTML=u.map(b=>`<tr><td><b style="font-weight:500">${esc(b.name)}</b>${b.is_demo?' <span class="tag">Demo</span>':""}</td><td>${b.customer_messages}</td><td>${b.ai_replies}</td><td>${b.wa_replies}</td><td>${b.wa_outbound}</td><td>${b.bookings}</td><td>${usd(b.est_cost)}</td><td>${b.plan_price?usd(b.plan_price):"—"}</td><td style="color:${b.margin<0?"var(--bad)":"var(--good)"}">${usd(b.margin)}</td>
    <td style="white-space:nowrap"><a class="mini" href="/api/admin/businesses/${b.id}/export" download>Export</a> <button class="mini" type="button" data-close="${b.id}" data-name="${esc(b.name)}">Close…</button></td></tr>`).join("")}
$("#plUse").addEventListener("click",async e=>{const b=e.target.closest("[data-close]");if(!b)return;
  const typed=prompt(`Close "${b.dataset.name}" and permanently delete ALL its data (customers, chats, bookings, logins, photos)?\n\nExport it first if you may need it. Type the business name exactly to confirm:`);
  if(typed===null)return;try{await req("/api/admin/businesses/"+b.dataset.close,"DELETE",{confirm:typed});toast("Business closed and its data deleted.");loadPlatform()}catch(err){toast(err.message)}});

// ---------- Command center: leads from the Pulse website ----------
const LST={new:["New","t-attn"],contacted:["Contacted","t-live"],demo_booked:["Demo booked","t-hand"],won:["Won","t-book"],lost:["Lost",""]},SRC={confirm:"booking confirmation",book:"booking page",webook:"WeBook app",chat:"chat",direct:"direct visit"};
let leadData=null;
async function loadLeads(){leadData=await req("/api/admin/leads");const L=leadData.leads,clicks=leadData.sources.reduce((a,s)=>a+s.clicks,0),won=L.filter(l=>l.status==="won").length;
  $("#ldKpis").innerHTML=[["New leads",L.filter(l=>l.status==="new").length,1],["All leads",L.length],["Demo requests",L.filter(l=>l.kind==="demo").length],["Badge clicks",clicks],["Won",won+(L.length?` · ${Math.round(won/L.length*100)}%`:"")]].map(([l,v,h])=>`<div class="kpi glass${h?" hero":""}"><span class="k-l">${l}</span><span class="v num">${v}</span></div>`).join("");
  drawLeads();
  $("#ldRefs").innerHTML=(leadData.referrers.length?leadData.referrers.map(r=>`<div class="item"><div class="grow"><b>${esc(r.name)}</b><small>${r.clicks_30d} in the last 30 days · ${r.leads} lead${r.leads===1?"":"s"}</small></div><span class="tag t-book">${r.clicks} clicks</span></div>`).join(""):`<div class="empty">No clicks yet. Every booking confirmation and booking page now carries a "Powered by Pulse" link.</div>`)
    +(leadData.sources.length?`<p class="sub" style="margin:12px 0 0;font-size:13px">By source: ${leadData.sources.map(s=>`${esc(SRC[s.source]||s.source)} ${s.clicks}`).join(" · ")}</p>`:"")}
function drawLeads(){const f=$("#ldF").value,L=leadData.leads.filter(l=>!f||l.status===f);
  $("#ldList").innerHTML=L.length?L.map(l=>`<div class="item" style="align-items:flex-start;flex-wrap:wrap"><div class="grow" style="min-width:220px"><b>${esc(l.name)} · ${esc(l.business)}</b>
    <small>${l.kind==="demo"?"🎥 Demo request":"🚀 Sign-up"} · ${esc(l.business_type||"")} · ${esc(l.country||"")} · ${new Date(l.created_at).toLocaleString()}</small>
    <small>${l.phone?`<a href="https://wa.me/${esc(l.phone.replace(/\D/g,""))}" target="_blank" rel="noopener">${esc(l.phone)}</a>`:""}${l.phone&&l.email?" · ":""}${l.email?`<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>`:""}</small>
    ${l.ref_name?`<small>Came from <b>${esc(l.ref_name)}</b> (${esc(SRC[l.source]||l.source)})</small>`:l.source&&l.source!=="direct"?`<small>Source: ${esc(SRC[l.source]||l.source)}</small>`:""}
    ${l.message?`<small style="white-space:pre-wrap;color:var(--ink2)">“${esc(l.message)}”</small>`:""}
    <input class="ldNote" data-id="${l.id}" value="${esc(l.notes||"")}" placeholder="Your notes" style="margin-top:6px;width:100%"></div>
    <select class="ldSt" data-id="${l.id}" aria-label="Lead status">${Object.entries(LST).map(([k,[t]])=>`<option value="${k}"${l.status===k?" selected":""}>${t}</option>`).join("")}</select></div>`).join("")
    :`<div class="empty">No leads yet. Share your website: <a href="${PUB()}/pulse" target="_blank" rel="noopener">${PUB().split("//").pop()}/pulse</a></div>`}
$("#ldF").onchange=drawLeads;
$("#ldList").addEventListener("change",async e=>{const el=e.target.closest(".ldSt,.ldNote");if(!el)return;const id=+el.dataset.id,l=leadData.leads.find(x=>x.id===id);
  if(el.classList.contains("ldSt"))l.status=el.value;else l.notes=el.value;await req("/api/admin/leads/"+id,"PUT",{status:l.status,notes:l.notes});toast("Lead updated.");if(el.classList.contains("ldSt"))loadLeads()});
setInterval(()=>{if(!document.hidden){refresh();loadApprovals();pollTestChat();if(!$("#calendar").hidden)loadCal()}},5000);
