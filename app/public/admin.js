// Command center, organised like Settings: an index on the left, and a client manager
// (searchable list + full client profile) instead of one long list of expanding rows.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const ad=$("#admin"),tabs=$("#ccTabs");if(!ad||!tabs)return;

// ---------- index ----------
const SECTIONS=[["Clients",[["biz","All businesses","Every client: plan, add-ons, features, logins and usage. Click one to manage it."],["new","New business","Create a client: tick the plan, add-ons and website first, then the owner gets a login."]]],
  ["People",[["users","Logins","Owner and staff logins for every business: reset passwords, switch off, permissions."]]],
  ["Growth",[["leads","Leads","Sign-ups and demo requests from your website, and which clients send you visitors."]]],
  ["Catalog",[["plans","Plans and add-ons","What you sell: prices and which features each plan and add-on switches on."]]],
  ["Platform",[["platform","Health and usage","System checks, and usage, cost and margin per client. Export or close a client."],["audit","Audit log","Every sign-in and important change, by whom and when."]]]];
const PANE={biz:"#ccBiz",new:"#ccNew",users:"#ccUsers",leads:"#ccLeads",plans:"#ccPlans",platform:"#ccPlatform",audit:"#ccAudit"};
const nav=document.createElement("nav");nav.className="setnav";nav.setAttribute("aria-label","Command center sections");
nav.innerHTML=SECTIONS.map(([g,items])=>`<h3>${g}</h3>`+items.map(([k,l])=>`<button type="button" data-k="${k}"><i></i>${l}</button>`).join("")).join("");
const main=document.createElement("div");main.className="ccmain";
ad.classList.add("cclay");tabs.after(nav);nav.after(main);
// move every section (and the "done" notice) into the main column, each with a one-line introduction
const done=$("#ccDone");if(done)main.append(done);
const intro={};SECTIONS.forEach(([,items])=>items.forEach(([k,l,d])=>intro[k]=[l,d]));
function placePanes(){Object.entries(PANE).forEach(([k,sel])=>{const p=$(sel);if(!p||p.parentNode===main)return;main.append(p);
  if(!p.querySelector(":scope>.sethead")){const h=document.createElement("div");h.className="sethead";h.innerHTML=`<b>${intro[k][0]}</b><span>${intro[k][1]}</span>`;p.prepend(h)}})}
placePanes();
const show=k=>{placePanes();const b=tabs.querySelector(`[data-c="${k}"]`);if(b)b.click();nav.querySelectorAll("[data-k]").forEach(x=>x.setAttribute("aria-current",x.dataset.k===k));if(k==="biz")drawManager()};
nav.addEventListener("click",e=>{const b=e.target.closest("[data-k]");if(b)show(b.dataset.k)});
tabs.addEventListener("click",e=>{const b=e.target.closest("[data-c]");if(b)nav.querySelectorAll("[data-k]").forEach(x=>x.setAttribute("aria-current",x.dataset.k===b.dataset.c))});
nav.querySelector('[data-k="biz"]').setAttribute("aria-current","true");

// ---------- client manager ----------
const biz=$("#ccBiz");
const mgr=document.createElement("div");mgr.className="cm";
mgr.innerHTML=`<div class="cm-list"><div class="cm-tools"><input id="cmQ" placeholder="Search clients" aria-label="Search clients"><select id="cmF" aria-label="Filter"><option value="">All</option><option value="active">Active</option><option value="trial">On trial</option><option value="ended">Trial ended</option><option value="paused">Paused</option><option value="demo">Demo</option></select></div>
  <div class="cm-rows" id="cmRows"></div><button class="btn ghost" type="button" id="cmNew" style="margin-top:8px">+ New business</button></div>
  <div class="cm-detail" id="cmDetail"><div class="empty">Choose a client on the left.</div></div>`;
biz.append(mgr);
let list=[],users=[],usage=[],sel=null;
const status=b=>b.plan_status==="active"?["t-book","Active","active"]:b.plan_status==="paused"?["t-hand","Paused","paused"]:b.trial_days_left>0?["t-faq",`Trial · ${b.trial_days_left}d left`,"trial"]:["t-hand","Trial ended","ended"];
const planOf=k=>(cat?.plans||[]).find(p=>p.key===k);
const money=(v,c="USD")=>`${(+v||0).toLocaleString()} ${c}`;

// replaces the old long list; the rest of the page still calls loadBizList()
window.loadBizList=async function(){
  if(!cat)cat=await req("/api/admin/catalog");
  [list,users,usage]=await Promise.all([req("/api/admin/businesses"),req("/api/admin/users").catch(()=>[]),req("/api/admin/usage?days=30").catch(()=>[])]);
  $("#abCount")&&($("#abCount").textContent=list.length+" total");
  $("#nuBiz").innerHTML=list.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join("");
  drawManager()};
function drawManager(){if(!list.length)return;
  const q=($("#cmQ").value||"").toLowerCase(),f=$("#cmF").value;
  const rows=list.filter(b=>(!q||[b.name,b.city,b.country,b.vertical,b.owners].join(" ").toLowerCase().includes(q))&&(!f||(f==="demo"?b.is_demo:!b.is_demo&&status(b)[2]===f)));
  $("#cmRows").innerHTML=rows.map(b=>{const s=status(b);return `<button type="button" class="cm-row" data-id="${b.id}" aria-current="${b.id===sel}">
    <span class="cm-av">${esc([...b.name][0]||"?")}</span><span class="cm-txt"><b>${esc(b.name)}</b><small>${esc([b.vertical,b.city].filter(Boolean).join(" · "))}</small></span>
    <span class="cm-meta"><span class="tag ${s[0]}">${b.is_demo?"Demo":s[1]}</span><small>${esc(planOf(b.plan_key)?.name||"No plan")}</small></span></button>`}).join("")||`<div class="empty">No clients match.</div>`;
  if(sel&&!list.some(b=>b.id===sel))sel=null;
  if(!sel&&rows[0])sel=rows[0].id;
  $$("#cmRows .cm-row").forEach(r=>r.setAttribute("aria-current",+r.dataset.id===sel));
  drawDetail()}
$("#cmQ").addEventListener("input",drawManager);$("#cmF").addEventListener("change",drawManager);
$("#cmRows").addEventListener("click",e=>{const r=e.target.closest(".cm-row");if(!r)return;sel=+r.dataset.id;$$("#cmRows .cm-row").forEach(x=>x.setAttribute("aria-current",x===r));drawDetail()});
$("#cmNew").onclick=()=>show("new");

function drawDetail(){const b=list.find(x=>x.id===sel),box=$("#cmDetail");if(!b){box.innerHTML=`<div class="empty">Choose a client on the left.</div>`;return}
  const s=status(b),plan=planOf(b.plan_key),u=usage.find(x=>x.id===b.id)||{},ov=b.feature_overrides||{},logins=users.filter(x=>x.business_id===b.id);
  const addons=(cat?.addons||[]),on=new Set(b.addons||[]),cur=plan?.currency||"USD";
  const total=(+plan?.price||0)+addons.filter(a=>on.has(a.key)).reduce((t,a)=>t+(+a.price||0),0);
  box.innerHTML=`<div class="cm-head"><span class="cm-av big">${esc([...b.name][0]||"?")}</span><div style="min-width:0;flex:1"><h2>${esc(b.name)}</h2><small>${esc([b.vertical,b.city,b.country,b.currency,b.timezone].filter(Boolean).join(" · "))}</small></div>
      <span class="tag ${s[0]}">${b.is_demo?"Demo":s[1]}</span></div>
    <div class="cm-acts"><button class="btn" type="button" data-act="open">Open their dashboard</button><a class="btn ghost" href="/s/${b.id}" target="_blank" rel="noopener">Website</a><a class="btn ghost" href="/book?b=${b.id}" target="_blank" rel="noopener">Booking page</a><a class="btn ghost" href="/api/admin/businesses/${b.id}/export" download>Export data</a></div>
    <div class="cm-stats">${[["Bookings",b.bookings],["Chats",b.chats],["Customer messages",b.questions],["AI replies, 30 days",u.ai_replies??"—"],["Est. cost, 30 days",u.est_cost!=null?"$"+u.est_cost.toFixed(2):"—"],["Last sign-in",b.last_login||"never"]].map(([l,v])=>`<div><span>${l}</span><b>${esc(String(v))}</b></div>`).join("")}</div>

    <section class="cm-sec"><h3>Plan and billing</h3>
      <div class="cm-grid2"><label>Plan<select class="bPlan">${(cat?.plans||[]).map(p=>`<option value="${p.key}" ${p.key===b.plan_key?"selected":""}>${esc(p.name)} · ${+p.price} ${esc(p.currency)}/mo</option>`).join("")}</select></label>
        <label>Status<select class="bStatus">${[["trial","Trial"],["active","Active (paying)"],["paused","Paused"]].map(([v,l])=>`<option value="${v}" ${v===b.plan_status?"selected":""}>${l}</option>`).join("")}</select></label></div>
      <div class="cm-note">${b.plan_status==="trial"?`Trial ends ${esc(b.trial_ends||"")} · `:""}Monthly total with add-ons: <b id="cmTotal">${money(total,cur)}</b></div></section>

    <section class="cm-sec"><h3>Add-ons</h3><div class="cm-cards">${addons.map(a=>`<label class="cm-card"><input type="checkbox" class="bAdd" value="${a.key}" ${on.has(a.key)?"checked":""}><span><b>${esc(a.name)}</b><small>+${+a.price} ${esc(a.currency)}/mo</small></span></label>`).join("")||'<span class="sub">No add-ons yet. Create them in Plans and add-ons.</span>'}</div></section>

    <section class="cm-sec"><h3>Features <small>Default follows the plan and add-ons. Override for this client only.</small></h3>
      <div class="cm-feats">${Object.entries(cat?.features||{}).map(([k,n])=>`<div class="cm-feat"><span>${esc(n)}</span><div class="seg3" data-k="${k}">${[["","Default"],["on","On"],["off","Off"]].map(([v,l])=>`<button type="button" data-v="${v}" aria-pressed="${(ov[k]===undefined?"":ov[k]?"on":"off")===v}">${l}</button>`).join("")}</div></div>`).join("")}</div></section>

    <div class="cm-save"><button class="btn" type="button" data-act="save">Save changes</button>${b.plan_status==="trial"?`<button class="btn ghost" type="button" data-act="extend">+14 trial days</button>`:""}<span class="sub" id="cmDirty"></span></div>

    <section class="cm-sec"><h3>Logins <small>${logins.length}</small></h3>
      <div class="list">${logins.map(x=>`<div class="item"><div class="grow"><b>${esc(x.email)}</b><small>${esc(x.role)}${x.name?" · "+esc(x.name):""} · ${x.last_login?"last in "+esc(x.last_login):"never signed in"}${x.disabled?" · switched off":""}</small></div><span class="tag ${x.totp_enabled?"t-book":"t-faq"}">${x.totp_enabled?"2FA on":"2FA off"}</span></div>`).join("")||'<div class="empty">No logins.</div>'}</div>
      <button class="btn ghost" type="button" data-act="login" style="margin-top:8px">Add a login</button></section>

    <section class="cm-sec danger"><h3>Danger zone</h3><div class="item"><div class="grow"><b>Close this client</b><small>Deletes customers, chats, bookings, logins and photos. Export first.</small></div><button class="btn ghost" type="button" data-act="close">Close…</button></div></section>`;
  const body=()=>({plan_key:box.querySelector(".bPlan").value,status:box.querySelector(".bStatus").value,addons:[...box.querySelectorAll(".bAdd:checked")].map(x=>x.value),
    feature_overrides:Object.fromEntries([...box.querySelectorAll(".seg3")].map(g=>[g.dataset.k,g.querySelector("[aria-pressed=true]")?.dataset.v||""]).filter(([,v])=>v).map(([k,v])=>[k,v==="on"]))});
  const recalc=()=>{const p=planOf(box.querySelector(".bPlan").value),t=(+p?.price||0)+[...box.querySelectorAll(".bAdd:checked")].reduce((s,x)=>s+(+(addons.find(a=>a.key===x.value)?.price)||0),0);
    $("#cmTotal").textContent=money(t,p?.currency||cur);$("#cmDirty").textContent="Unsaved changes"};
  box.querySelectorAll(".bPlan,.bStatus,.bAdd").forEach(x=>x.addEventListener("change",recalc));
  box.querySelectorAll(".seg3").forEach(g=>g.addEventListener("click",e=>{const v=e.target.closest("[data-v]");if(!v)return;g.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===v));$("#cmDirty").textContent="Unsaved changes"}));
  box.onclick=async e=>{const a=e.target.closest("[data-act]");if(!a)return;const act=a.dataset.act;
    try{
      if(act==="save"){await req(`/api/admin/businesses/${b.id}/plan`,"POST",body());toast("Saved. It applies on their next click.");await loadBizList();loadMe()}
      if(act==="extend"){await req(`/api/admin/businesses/${b.id}/plan`,"POST",{...body(),extend_days:14});toast("Trial extended by 14 days.");await loadBizList()}
      if(act==="open"){await req("/api/admin/switch","POST",{id:b.id});location.href="/"}
      if(act==="login"){show("users");setTimeout(()=>{$("#nuBiz").value=b.id;$("#nuEmail")?.focus()},300)}
      if(act==="close"){const typed=prompt(`Close "${b.name}" and permanently delete ALL its data?\n\nExport it first if you may need it. Type the business name exactly to confirm:`);
        if(typed===null)return;await req(`/api/admin/businesses/${b.id}`,"DELETE",{confirm:typed});toast("Client closed and its data deleted.");sel=null;await loadBizList()}
    }catch(err){toast(err.message)}}}

// hide the old list card; everything it did lives in the manager now
const oldCard=$("#abList")?.closest(".card");if(oldCard)oldCard.hidden=true;
})();

// "Back to Lab": always one click from any screen to the Command center (admin only)
(function(){
const nav=document.querySelector("nav"),brand=nav&&nav.querySelector(".brand"),admin=document.getElementById("adminNav");if(!brand||!admin)return;
const b=document.createElement("button");b.type="button";b.id="labBtn";b.hidden=true;b.title="Back to your Lab (Command center)";
b.innerHTML=`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg><span>Back to Lab</span>`;
brand.after(b);b.onclick=async()=>{await req("/api/admin/lab","POST");location.href="/"};
// shown by loadMe(): only for the admin, only while inside a client
})();
