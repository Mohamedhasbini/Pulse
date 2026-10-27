// Command center (admin). Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- command center ----------
let cat=null,ccTab="biz";
const showSecret=(title,r,extra="")=>{$("#ccDone").hidden=false;$("#ccDone").innerHTML=`<div class="ch"><h2>${title}</h2><button class="mini" type="button" onclick="this.closest('#ccDone').hidden=true">Close</button></div>
  <div style="font-size:14px;line-height:1.9">Login page: <b>${esc(PUB())}/login</b><br>Email: <b>${esc(r.email)}</b>${r.password?`<br>Password: <b style="font-family:var(--mono)">${esc(r.password)}</b>`:""}${extra}</div>
  <p class="sub" style="margin:8px 0 0;font-size:13px">Copy this now and send it privately. The password is shown only once; they should change it and turn on two-factor.</p>`;scrollTo({top:0,behavior:"smooth"})};
async function loadAdmin(){
  if(!cat){cat=await req("/api/admin/catalog");
    const v=await req("/api/verticals");$("#nbType").innerHTML=v.filter(x=>!x.comingSoon).map(x=>`<option value="${x.key}">${esc(x.label)}</option>`).join("");
    try{$("#nbTzs").innerHTML=Intl.supportedValuesOf("timeZone").map(z=>`<option>${z}</option>`).join("")}catch{}
    $("#nbTz").value=Intl.DateTimeFormat().resolvedOptions().timeZone;$("#nbCur").value="USD";
    $("#nuPerms").innerHTML=`<span class="sub" style="width:100%;font-size:13px">Staff can open:</span>`+Object.entries(cat.modules).map(([k,n])=>`<label class="switch"><input type="checkbox" value="${k}" ${["overview","calendar","customers"].includes(k)?"checked":""}> ${esc(n)}</label>`).join("")}
  else cat=await req("/api/admin/catalog");
  $("#nbAddons").innerHTML=cat.addons.map(a=>`<label class="switch"><input type="checkbox" value="${esc(a.key)}"> ${esc(a.name)} <small style="color:var(--muted)">+${+a.price} ${esc(a.currency)}</small></label>`).join("")||'<span class="sub">No add-ons yet.</span>';
  $("#nbPlan").innerHTML=cat.plans.map(p=>`<option value="${p.key}" ${p.key==="pro"?"selected":""}>${esc(p.name)} (${+p.price} ${esc(p.currency)}/mo)</option>`).join("");
  ({biz:loadBizList,users:loadUsers,plans:loadPlans,audit:loadAudit})[ccTab]()}
document.querySelectorAll("#ccTabs button").forEach(b=>b.onclick=()=>{document.querySelectorAll("#ccTabs button").forEach(x=>x.setAttribute("aria-pressed",x===b));$("#ccLeads").hidden=b.dataset.c!=="leads";if(b.dataset.c==="leads"){["Biz","Users","Plans","Audit"].forEach(k=>$("#cc"+k).hidden=true);if($("#ccNew"))$("#ccNew").hidden=true;loadLeads();return}if(b.dataset.c==="new"){["Biz","Users","Plans","Audit"].forEach(k=>$("#cc"+k).hidden=true);$("#ccNew").hidden=false;return}if($("#ccNew"))$("#ccNew").hidden=true;ccTab=b.dataset.c;
  ["biz","users","plans","audit"].forEach(k=>$("#cc"+k[0].toUpperCase()+k.slice(1)).hidden=k!==ccTab);loadAdmin()});

async function loadBizList(){const list=await req("/api/admin/businesses");$("#abCount").textContent=list.length+" total";
  $("#nuBiz").innerHTML=list.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join("");
  $("#abList").innerHTML=list.map(b=>{const st=b.plan_status==="active"?["t-book","Active"]:b.plan_status==="paused"?["t-hand","Paused"]:b.trial_days_left>0?["t-faq",`Trial, ${b.trial_days_left}d left`]:["t-hand","Trial ended"];
    const ov=b.feature_overrides||{};
    return `<details class="item" style="display:block" data-b="${b.id}"><summary style="display:flex;gap:10px;align-items:center;cursor:pointer;list-style:none"><div class="grow"><b>${esc(b.name)} ${b.is_demo?'<span class="tag t-faq" style="display:inline">Demo</span>':""} <span class="tag ${st[0]}" style="display:inline">${st[1]}</span> <span class="tag t-test" style="display:inline">${esc((cat.plans.find(p=>p.key===b.plan_key)||{}).name||"No plan")}${(b.addons||[]).length?" + "+b.addons.length+" add-on":""}</span></b>
      <span>${esc([b.vertical,b.city,b.country,b.currency,b.timezone].filter(Boolean).join(" · "))} · ${b.logins} login${b.logins===1?"":"s"}${b.last_login?" · last in "+esc(b.last_login):""}</span>
      <span>${b.chats} chats · ${b.questions} customer messages · ${b.bookings} bookings</span></div><button class="mini" data-open="${b.id}" type="button">Open</button></summary>
      <div class="form" style="margin-top:12px">
        <label>Plan<select class="bPlan">${cat.plans.map(p=>`<option value="${p.key}" ${p.key===b.plan_key?"selected":""}>${esc(p.name)}</option>`).join("")}</select></label>
        <label>Status<select class="bStatus">${["trial","active","paused"].map(s=>`<option ${s===b.plan_status?"selected":""}>${s}</option>`).join("")}</select></label>
        <div class="full"><span class="sub" style="font-size:13px">Add-ons</span><div style="display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:6px">${cat.addons.map(a=>`<label class="switch"><input type="checkbox" class="bAdd" value="${a.key}" ${(b.addons||[]).includes(a.key)?"checked":""}> ${esc(a.name)}</label>`).join("")||'<span class="sub">No add-ons yet</span>'}</div></div>
        <div class="full"><span class="sub" style="font-size:13px">Feature switches for this business only (default follows plan and add-ons)</span><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:6px;margin-top:6px">${Object.entries(cat.features).map(([k,n])=>`<label style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:13px">${esc(n)}<select class="bOv" data-k="${k}" style="width:auto"><option value="" ${ov[k]===undefined?"selected":""}>Default</option><option value="on" ${ov[k]===true?"selected":""}>On</option><option value="off" ${ov[k]===false?"selected":""}>Off</option></select></label>`).join("")}</div></div>
        <div class="full" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn bSave" type="button">Save changes</button><button class="btn ghost bExt" type="button">+14 trial days</button><button class="btn ghost bLogin" type="button">Add a login</button></div></div></details>`}).join("");
  $("#abList").querySelectorAll("[data-b]").forEach(d=>{const id=+d.dataset.b,body=()=>({plan_key:d.querySelector(".bPlan").value,status:d.querySelector(".bStatus").value,
      addons:[...d.querySelectorAll(".bAdd:checked")].map(x=>x.value),feature_overrides:Object.fromEntries([...d.querySelectorAll(".bOv")].filter(x=>x.value).map(x=>[x.dataset.k,x.value==="on"]))});
    d.querySelector(".bSave").onclick=async()=>{await req(`/api/admin/businesses/${id}/plan`,"POST",body());toast("Saved. It applies on their next click.");loadBizList();loadMe()};
    d.querySelector(".bExt").onclick=async()=>{await req(`/api/admin/businesses/${id}/plan`,"POST",{...body(),extend_days:14});toast("Trial extended by 14 days.");loadBizList();loadMe()};
    d.querySelector(".bLogin").onclick=()=>{$("#ccTabs button[data-c=users]").click();setTimeout(()=>{$("#nuBiz").value=id;$("#nuEmail").focus()},300)};
    d.querySelector("[data-open]").onclick=async e=>{e.preventDefault();e.stopPropagation();await req("/api/admin/switch","POST",{id});location.href="/"}})}
$("#nbForm").onsubmit=async e=>{e.preventDefault();$("#nbErr").textContent="";$("#nbGo").disabled=true;
  try{const r=await req("/api/admin/businesses","POST",{name:$("#nbName").value,vertical:$("#nbType").value,country:$("#nbCountry").value,city:$("#nbCity").value,currency:$("#nbCur").value,timezone:$("#nbTz").value,plan_key:$("#nbPlan").value,owner_name:$("#nbOwner").value,owner_email:$("#nbEmail").value,
    addons:[...document.querySelectorAll("#nbAddons input:checked")].map(x=>x.value),site_style:$("#nbStyle").value,subdomain:$("#nbSub").value.trim()});
    showSecret("Business created",r,`<br>Booking page: <b>${esc(PUB())}/book?b=${r.id}</b>`);$("#nbForm").reset();$("#nbTz").value=Intl.DateTimeFormat().resolvedOptions().timeZone;$("#nbCur").value="USD";loadAdmin()}
  catch(err){$("#nbErr").textContent=err.message}finally{$("#nbGo").disabled=false}};

async function loadUsers(){if(!$("#nuBiz").options.length)await loadBizList();const list=await req("/api/admin/users");$("#auCount").textContent=list.length+" logins";
  $("#auList").innerHTML=list.map(u=>`<details class="item" style="display:block" data-u="${u.id}"><summary style="display:flex;gap:10px;align-items:center;cursor:pointer;list-style:none"><div class="grow">
      <b>${esc(u.email)} <span class="tag ${u.role==="admin"?"t-attn":u.role==="owner"?"t-book":"t-test"}" style="display:inline">${u.role}</span>${u.disabled?' <span class="tag t-hand" style="display:inline">Off</span>':""}${u.locked?' <span class="tag t-hand" style="display:inline">Locked</span>':""} <span class="tag ${u.totp_enabled?"t-book":"t-faq"}" style="display:inline">${u.totp_enabled?"2FA on":"No 2FA"}</span></b>
      <span>${esc(u.business||"All businesses")}${u.name?" · "+esc(u.name):""} · ${u.last_login?"last in "+esc(u.last_login):"never signed in"}</span>
      ${u.role==="staff"?`<span>Can open: ${(u.permissions||[]).map(m=>esc(cat.modules[m]||m)).join(", ")||"nothing"}</span>`:""}</div></summary>
    ${u.role==="admin"?`<div style="margin-top:10px;display:flex;gap:8px"><span class="sub">This is you. Manage it in Account security.</span></div>`:`<div style="margin-top:12px">
      ${u.role==="staff"?`<div style="display:flex;flex-wrap:wrap;gap:8px 16px">${Object.entries(cat.modules).map(([k,n])=>`<label class="switch"><input type="checkbox" class="uP" value="${k}" ${(u.permissions||[]).includes(k)?"checked":""}> ${esc(n)}</label>`).join("")}</div>`:""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${u.role==="staff"?`<button class="btn uSave" type="button">Save access</button>`:""}
        <button class="btn ghost uToggle" type="button">${u.disabled?"Switch on":"Switch off"}</button><button class="btn ghost uOut" type="button">Sign out now</button>
        <button class="btn ghost uPw" type="button">New password</button>${u.totp_enabled?`<button class="btn ghost u2fa" type="button">Reset 2FA</button>`:""}<button class="btn ghost uDel" type="button" style="color:var(--bad)">Delete</button></div></div>`}</details>`).join("");
  $("#auList").querySelectorAll("[data-u]").forEach(d=>{const id=+d.dataset.u,P=(b)=>req(`/api/admin/users/${id}`,"PATCH",b).then(()=>{toast("Done. It applies on their next click.");loadUsers()}).catch(err=>toast(err.message));
    d.querySelector(".uSave")&&(d.querySelector(".uSave").onclick=()=>P({permissions:[...d.querySelectorAll(".uP:checked")].map(x=>x.value)}));
    d.querySelector(".uToggle")&&(d.querySelector(".uToggle").onclick=()=>P({disabled:d.querySelector(".uToggle").textContent==="Switch off"}));
    d.querySelector(".uOut")&&(d.querySelector(".uOut").onclick=()=>P({signout:true}));
    d.querySelector(".uPw")&&(d.querySelector(".uPw").onclick=async()=>{if(!confirm("Give this login a new password? The old one stops working and they are signed out."))return;showSecret("New password",await req(`/api/admin/users/${id}/reset`,"POST",{what:"password"}));loadUsers()});
    d.querySelector(".u2fa")&&(d.querySelector(".u2fa").onclick=async()=>{if(!confirm("Turn off two-factor for this login? Only do this if they lost their phone and you checked who they are."))return;await req(`/api/admin/users/${id}/reset`,"POST",{what:"2fa"});toast("Two-factor reset. They can set it up again.");loadUsers()});
    d.querySelector(".uDel")&&(d.querySelector(".uDel").onclick=async()=>{if(!confirm("Delete this login for good?"))return;await req(`/api/admin/users/${id}`,"DELETE");toast("Login deleted.");loadUsers()})})}
$("#nuRole").onchange=()=>{$("#nuPerms").style.display=$("#nuRole").value==="staff"?"flex":"none"};
$("#nuForm").onsubmit=async e=>{e.preventDefault();$("#nuErr").textContent="";
  try{const r=await req("/api/admin/users","POST",{business_id:+$("#nuBiz").value,role:$("#nuRole").value,name:$("#nuName").value,email:$("#nuEmail").value,permissions:[...$("#nuPerms").querySelectorAll("input:checked")].map(x=>x.value)});
    showSecret("Login created",r);$("#nuEmail").value="";$("#nuName").value="";loadUsers()}catch(err){$("#nuErr").textContent=err.message}};

function loadPlans(){const card=(p,kind)=>`<div class="card glass" data-k="${esc(p.key)}" data-kind="${kind}" style="margin:0"><div class="ch"><h2>${kind==="addon"?"Add-on":"Plan"}</h2><small>${esc(p.key)}</small></div>
    <div class="form"><label>Name<input class="pN" value="${esc(p.name)}"></label><label>Price per month<input class="pP" type="number" min="0" step="1" value="${+p.price}"></label><label>Currency<input class="pC" value="${esc(p.currency||"USD")}" maxlength="3"></label></div>
    <div style="display:flex;flex-direction:column;gap:6px;margin:12px 0">${Object.entries(cat.features).map(([k,n])=>`<label class="switch"><input type="checkbox" class="pF" value="${k}" ${(p.features||[]).includes(k)?"checked":""}> ${esc(n)}</label>`).join("")}</div>
    <div style="display:flex;gap:8px"><button class="btn pSave" type="button">Save</button><button class="btn ghost pDel" type="button">Delete</button></div></div>`;
  $("#plList").innerHTML=cat.plans.map(p=>card(p,"plan")).join("")+cat.addons.map(a=>card(a,"addon")).join("");
  $("#plList").querySelectorAll("[data-k]").forEach(c=>{const kind=c.dataset.kind==="addon"?"?kind=addon":"";
    c.querySelector(".pSave").onclick=async()=>{try{await req(`/api/admin/plans/${encodeURIComponent(c.dataset.k)}${kind}`,"PUT",{name:c.querySelector(".pN").value,price:+c.querySelector(".pP").value,currency:c.querySelector(".pC").value.toUpperCase(),features:[...c.querySelectorAll(".pF:checked")].map(x=>x.value)});toast("Saved. Every business on it updates instantly.");loadMe()}catch(err){toast(err.message)}};
    c.querySelector(".pDel").onclick=async()=>{if(!confirm("Delete this?"))return;try{await req(`/api/admin/plans/${encodeURIComponent(c.dataset.k)}${kind}`,"DELETE");loadAdmin()}catch(err){toast(err.message)}}})}
const newPlan=kind=>async()=>{const name=prompt(kind==="addon"?"Add-on name":"Plan name");if(!name)return;const key=name.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
  try{await req(`/api/admin/plans/${key}${kind==="addon"?"?kind=addon":""}`,"PUT",{name,price:0,currency:"USD",features:[]});loadAdmin()}catch(err){toast(err.message)}};
$("#plNew").onclick=newPlan("plan");$("#adNew").onclick=newPlan("addon");

let adT;async function loadAudit(){const list=await req("/api/admin/audit?q="+encodeURIComponent($("#adQ").value||""));
  $("#adList").innerHTML=list.length?list.map(a=>`<div class="item"><div class="grow"><b style="font-weight:500">${esc(a.action)}${a.detail?' <span style="color:var(--muted);font-weight:400">'+esc(a.detail)+"</span>":""}</b><span>${esc(a.at)} · ${esc(a.user_email||"unknown")}${a.business?" · "+esc(a.business):""} · ${esc(a.ip||"")}</span></div></div>`).join(""):`<div class="empty">Nothing logged yet.</div>`}
$("#adQ").oninput=()=>{clearTimeout(adT);adT=setTimeout(loadAudit,300)};

