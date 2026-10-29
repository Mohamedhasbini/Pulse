// Notifications, tools, offers, plan, account and security. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- notification center ----------
let notifLast=0,notifPerm=false;
const KIND_ICON={booking:"var(--good)",cancel:"var(--bad)",approval:"var(--warn)",handoff:"var(--accent)",unsure:"#ff8a3d",review:"var(--good)",marketing:"#d65cff"};
async function loadNotifs(first){let r;try{r=await req("/api/notifications"+(first?"":"?after="+notifLast))}catch{return}
  $("#bellN").hidden=!r.unread;$("#bellN").textContent=r.unread>99?"99+":r.unread;
  const fresh=first?[]:r.items.filter(n=>n.id>notifLast);if(r.items.length)notifLast=Math.max(notifLast,...r.items.map(n=>n.id));
  fresh.reverse().forEach(n=>{toast(n.title);if(notifPerm&&document.hidden)try{new Notification(n.title,{body:n.body||"",tag:"rb"+n.id})}catch{}});
  if(first||!$("#bellPanel").hidden)renderNotifs(first?r.items:null)}
async function renderNotifs(items){items=items||(await req("/api/notifications")).items;
  $("#bellList").innerHTML=items.length?items.map(n=>`<button type="button" class="bp-item${n.read?"":" unread"}" data-n="${n.id}" data-c="${n.conversation_id||""}"><i style="background:${KIND_ICON[n.kind]||"var(--muted)"}"></i><span><b>${esc(n.title)}</b>${n.body?`<small>${esc(n.body)}</small>`:""}<em>${ago(n.at)}</em></span></button>`).join("")
    :`<div class="empty" style="padding:28px 10px">You're all caught up. New bookings, cancellations and anything that needs you will appear here.</div>`;
  $("#bellList").querySelectorAll("[data-n]").forEach(x=>x.onclick=async()=>{await req("/api/notifications/read","POST",{ids:[+x.dataset.n]});x.classList.remove("unread");
    if(x.dataset.c){$("#bellPanel").hidden=true;document.querySelector('nav button[data-view="overview"]').click();setTimeout(()=>openConv(+x.dataset.c),250)}loadNotifs()})}
$("#bellBtn").onclick=async()=>{const p=$("#bellPanel"),open=p.hidden;p.hidden=!open;$("#bellBtn").setAttribute("aria-expanded",open);if(open){renderNotifs();
  if("Notification" in window&&Notification.permission==="default")Notification.requestPermission().then(x=>notifPerm=x==="granted");}};
if("Notification" in window)notifPerm=Notification.permission==="granted";
$("#bellAll").onclick=async()=>{await req("/api/notifications/read","POST",{all:true});loadNotifs();renderNotifs()};
document.addEventListener("click",e=>{if(!$("#bellPanel").hidden&&!e.target.closest("#bellPanel,#bellBtn"))$("#bellPanel").hidden=true});
document.addEventListener("keydown",e=>{if(e.key==="Escape")$("#bellPanel").hidden=true});
$("#bellCfg").onclick=async()=>{const box=$("#bellSettings");box.hidden=!box.hidden;if(box.hidden)return;const s=await req("/api/notifications/settings");
  box.innerHTML=`<p class="sub" style="margin:0 0 8px;font-size:13px">Send these to my phone instantly${s.telegram_linked?" (Telegram linked)":""}:</p>
    <div style="display:flex;flex-direction:column;gap:6px">${Object.entries(s.kinds).map(([k,l])=>`<label class="switch"><input type="checkbox" value="${k}" ${s.on.includes(k)?"checked":""}> ${esc(l)}</label>`).join("")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="mini" type="button" id="bsSave">Save</button>${s.telegram_linked?`<button class="mini" type="button" id="bsUnlink">Unlink Telegram</button>`:`<button class="mini" type="button" id="bsLink">Link my Telegram</button>`}</div><p class="sub" id="bsCode" style="margin:8px 0 0;font-size:13px"></p>`;
  const on=()=>[...box.querySelectorAll("input:checked")].map(x=>x.value);
  $("#bsSave").onclick=async()=>{await req("/api/notifications/settings","PUT",{on:on()});toast("Alert settings saved.")};
  $("#bsUnlink")&&($("#bsUnlink").onclick=async()=>{await req("/api/notifications/settings","PUT",{on:on(),unlink:true});box.hidden=true;toast("Telegram alerts unlinked.")});
  $("#bsLink")&&($("#bsLink").onclick=async()=>{try{const r=await req("/api/notifications/link-telegram","POST");$("#bsCode").innerHTML=`In Telegram, open <a href="https://t.me/${esc(r.bot)}" target="_blank" rel="noopener">@${esc(r.bot)}</a> and send: <b style="user-select:all">/owner ${esc(r.code)}</b>`}catch(err){$("#bsCode").textContent=err.message}})};
loadNotifs(true);setInterval(()=>loadNotifs(),15000);

// ---------- tools: buffer and payment options ----------
async function loadTools(){let t;try{t=await req("/api/tools")}catch{$("#toolsCard").hidden=true;return}
  $("#tlBuf").value=String(t.buffer_minutes);if(!$("#tlBuf").value){$("#tlBuf").insertAdjacentHTML("beforeend",`<option value="${t.buffer_minutes}">${t.buffer_minutes} minutes</option>`);$("#tlBuf").value=String(t.buffer_minutes)}
  $("#tlSvc").innerHTML=t.services.map(s=>`<label style="font-size:13px">${esc(s.name)} <span style="color:var(--muted)">(${s.minutes} min)</span><select data-s="${s.id}"><option value="">Business default</option>${[0,5,10,15,20,30,45,60].map(m=>`<option value="${m}" ${s.buffer_minutes===m?"selected":""}>${m?m+" min after":"No buffer"}</option>`).join("")}</select></label>`).join("");
  $("#tlLater").checked=t.pay_later;$("#tlNow").checked=t.pay_now;$("#tlDep").checked=t.pay_deposit;$("#tlDepAmt").value=t.deposit_amount||"";$("#tlPayLink").value=t.payment_link||"";$("#tlDepFor").value=t.deposit_for||"risky";
  $("#tlNow").disabled=!t.payments_live;
  $("#tlPayNote").textContent=t.payments_live?`All off by default. Only the options you tick are offered by the AI. Amounts in ${t.currency}.`
    :"All off by default. Reservation fees work with your own payment link below; card payments in the chat unlock when payments are connected. The AI never asks for card details."}
$("#tlSave").onclick=async()=>{try{await req("/api/tools","PUT",{buffer_minutes:+$("#tlBuf").value,pay_later:$("#tlLater").checked,pay_now:$("#tlNow").checked,pay_deposit:$("#tlDep").checked,deposit_amount:+$("#tlDepAmt").value||0,payment_link:$("#tlPayLink").value.trim(),deposit_for:$("#tlDepFor").value,
  services:[...$("#tlSvc").querySelectorAll("select")].map(x=>({id:+x.dataset.s,buffer_minutes:x.value===""?null:+x.value}))});toast("Tools saved. The AI uses them from the next message.");loadTools()}catch(err){toast(err.message)}};
document.querySelector('nav button[data-view="setup"]').addEventListener("click",loadTools);

// ---------- marketing ----------
function mkSeg(){return{type:$("#mkType").value,days:+$("#mkDays").value,service_id:+$("#mkSvc").value||0,min:+$("#mkMin").value}}
$("#mkType").onchange=()=>{const t=$("#mkType").value;$("#mkDaysL").hidden=!["inactive","new"].includes(t);$("#mkSvcL").hidden=t!=="service";$("#mkMinL").hidden=t!=="regulars";$("#mkInfo").textContent=""};
$("#mkPrev").onclick=async()=>{try{const r=await req("/api/marketing/preview","POST",{segment:mkSeg()});
  $("#mkInfo").innerHTML=`<b>${r.reachable}</b> of ${r.matched} matching clients can receive it now (${Object.entries(r.by_channel).map(([k,v])=>`${esc(k)}: ${v}`).join(", ")||"none"}). ${r.opted_in} of your ${r.clients} clients agreed to offers. WhatsApp offers reach only clients who wrote in the last 24 hours.`}catch(err){$("#mkInfo").textContent=err.message}};
$("#mkSend").onclick=async()=>{if(!$("#mkMsg").value.trim()){$("#mkInfo").textContent="Write the offer first.";return}
  if(!confirm("Send this offer now? Every message ends with \"Reply STOP to stop offers.\""))return;
  try{const r=await req("/api/marketing/send","POST",{name:$("#mkName").value,message:$("#mkMsg").value,segment:mkSeg()});toast(`Offer sent to ${r.sent}. ${r.skipped} skipped.`);$("#mkMsg").value="";loadCampaigns()}catch(err){$("#mkInfo").textContent=err.message}};
async function loadCampaigns(){let list;try{list=await req("/api/marketing/campaigns")}catch(err){const f=$("#mkCard").querySelector(".form");f.hidden=true;let n=$("#mkLocked");if(!n){n=document.createElement("p");n.id="mkLocked";n.className="sub";n.style.margin="0";f.after(n)}n.textContent=err.message;return}
  $("#mkCard").querySelector(".form").hidden=false;$("#mkLocked")?.remove();
  try{const b=await req("/api/business");$("#mkSvc").innerHTML=b.services.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join("")}catch{}
  $("#mkPast").innerHTML=list.map(c=>`<div class="item"><div class="grow"><b style="font-weight:500">${esc(c.name||"Offer")}</b><span>${ago(c.at)} · sent to ${c.sent}, skipped ${c.skipped} · ${esc(c.message)}</span></div></div>`).join("")}
document.addEventListener("change",async e=>{const x=e.target.closest(".mkOk");if(!x)return;e.stopPropagation();
  try{await req(`/api/customers/${x.dataset.id}/offers`,"POST",{on:x.checked});x.parentElement.lastChild.textContent=x.checked?" Yes":" No";toast(x.checked?"Marked as agreed to offers.":"Offers turned off for this client.")}catch(err){toast(err.message);x.checked=!x.checked}});
document.addEventListener("click",e=>{if(e.target.closest(".mkOk")||e.target.closest("label.switch")&&e.target.closest("#pplRows"))e.stopPropagation()},true);
document.querySelector('nav button[data-view="people"]').addEventListener("click",()=>{$("#mkType")?.onchange?.();loadCampaigns()});

// ---------- sidebar plan card ----------
function sidebarState(){document.querySelectorAll("nav .ns").forEach(l=>{let n=l.nextElementSibling,any=false;while(n&&n.tagName==="BUTTON"){if(!n.hidden)any=true;n=n.nextElementSibling}l.hidden=!any})}

// ---------- account, plan, permissions ----------
let me=null;
const VIEW_MODULE={overview:"overview",calendar:"calendar",people:"customers",analytics:"insights",training:"teach",demo:"testchat",setup:"setup",website:"website"};
window.PUB=()=>(typeof me!=="undefined"&&me&&me.public_url)||location.origin;
// the two-factor reminder can be hidden for good with its ×
document.addEventListener("click",e=>{if(!e.target.closest("#tfNudgeX"))return;try{localStorage.setItem("rb-2fa-nudge","off")}catch{}$("#tfNudge")?.remove();$("#tfNudgeX")?.remove();if(!$("#planText").textContent.trim())$("#planBar").hidden=true});
const nudgeOff=()=>{try{return localStorage.getItem("rb-2fa-nudge")==="off"}catch{return false}};
async function loadMe(){me=await req("/api/me");if(me.lab)return enterLab();const b=me.business,admin=me.user.role==="admin";
  $("#adminNav").hidden=true;$("#labBtn")&&($("#labBtn").hidden=!admin);$("#planBar").hidden=false;
  // Sections this login can't open disappear; sections the plan doesn't include show a lock.
  document.querySelectorAll("nav button[data-view]").forEach(x=>{const m=VIEW_MODULE[x.dataset.view];if(!m)return;
    x.hidden=!me.modules.includes(m);const f=me.module_feature[m];x.classList.toggle("locked",!admin&&!!f&&!me.features.includes(f));
    // Product edition: clients only see what they have; no locks, no upgrade prompts
    if(me.edition==="product"&&!admin&&f&&!me.features.includes(f))x.hidden=true});
  if(me.edition==="product"&&!admin){$("#planCard").hidden=true;document.body.classList.add("product")}
  sidebarState();
  {const days=b.trial_days_left,active=b.plan_status==="active";$("#pcTitle").textContent=(b.plan_name||"Plan")+(active?" · active":b.plan_status==="paused"?" · paused":" trial");
   $("#pcSub").textContent=active?"Thank you for being with us":days>0?`${days} day${days===1?"":"s"} left in your free trial`:"Your trial has ended";$("#pcBar").style.width=active?"100%":Math.max(4,Math.min(100,(14-days)/14*100))+"%"}
  if(!me.modules.includes("overview")){const first=document.querySelector("nav button[data-view]:not([hidden])");first&&first.click()}
  const plan=b.plan_status==="active"?"Subscription active":b.plan_status==="paused"?"Paused":b.trial_days_left>0?`Free trial: ${b.trial_days_left} day${b.trial_days_left===1?"":"s"} left`:"Trial ended";
  if(me.edition==="product"&&!admin){$("#planText").innerHTML=me.user.totp_enabled||me.user.email_2fa||me.user.role==="staff"||nudgeOff()?"":`<a href="#" id="tfNudge" class="tag t-attn" style="text-decoration:none">Turn on two-factor sign-in</a><button type="button" class="nudge-x" id="tfNudgeX" aria-label="Hide this reminder" title="Hide this reminder">×</button>`;$("#planBar").hidden=true;$("#tfNudge")&&($("#tfNudge").onclick=e=>{e.preventDefault();$("#pwBtn").click()});return}
  $("#planBar").classList.toggle("adminview",admin);
  $("#planText").innerHTML=(admin?`<span class="tag t-attn">Admin view</span> You're inside <b>${esc(b.name)}</b>'s dashboard. Their logins only ever see their own business, never Businesses or other clients. <a href="#" id="backCC" class="tag" style="text-decoration:none">← Back to Lab</a> · `:"")+`<span class="tag ${b.plan_status==="active"?"t-book":b.trial_days_left>0?"t-faq":"t-hand"}">${esc(b.plan_name||"No plan")} · ${plan}</span> <span style="color:var(--muted)">${esc([b.country,b.currency,b.timezone].filter(Boolean).join(" · "))}</span>`
    +(me.user.totp_enabled||me.user.email_2fa||me.user.role==="staff"||nudgeOff()?"":` <a href="#" id="tfNudge" class="tag t-attn" style="text-decoration:none">Turn on two-factor</a><button type="button" class="nudge-x" id="tfNudgeX" aria-label="Hide this reminder" title="Hide this reminder">×</button>`);
  $("#tfNudge")&&($("#tfNudge").onclick=e=>{e.preventDefault();$("#pwBtn").click()});$("#backCC")&&($("#backCC").onclick=async e=>{e.preventDefault();await req("/api/admin/lab","POST");location.href="/"})
  // the banner stays hidden: Back to Lab and the plan are in the sidebar, two-factor is in Settings > Security
  $("#planBar").hidden=true}
// A section the plan doesn't include shows what it is and how to get it, instead of an error.
function lockedCard(view){const m=VIEW_MODULE[view],f=me&&me.module_feature[m],sec=$("#"+view);
  sec.querySelectorAll(".lockCard,.adminNote").forEach(x=>x.remove());[...sec.children].forEach(x=>x.style.display="");
  if(!f||me.features.includes(f))return false;
  // Admin sees everything, with a note that this business's plan doesn't include it.
  if(me.user.role==="admin"){const n=document.createElement("div");n.className="item adminNote";n.style.marginBottom="12px";n.innerHTML=`<span>Admin view: <b>${esc(me.business.name)}</b>'s plan doesn't include this, so its owner sees it locked. Add it in Command center to unlock it for them.</span>`;sec.prepend(n);return false}
  const c=document.createElement("div");c.className="card glass lockCard";sec.prepend(c);
  c.innerHTML=`<div class="empty" style="padding:40px 10px"><div style="font-size:34px">🔒</div><h2 style="margin:8px 0">This is a premium feature</h2><p class="sub">It isn't in your current plan. Ask us to upgrade your plan or add it as an add-on, and it unlocks instantly.</p></div>`;
  [...sec.children].forEach(x=>{if(x!==c)x.style.display="none"});return true}
$("#pwBtn").onclick=()=>{document.querySelector('nav button[data-view="setup"]').click();setTimeout(()=>tabsOf.setup("s2fa"),20)};

// ---------- security page ----------
// Two-factor by email: a code is mailed at every sign-in.
function loadEmail2fa(){const box=$("#efBody");if(!box)return;const on=me.user.email_2fa;
  if(on){box.innerHTML=`<p class="sub" style="margin:0 0 10px">On. Every sign-in asks for a 6-digit code we email to <b>${esc(me.user.email)}</b>.</p>
    <form class="form" id="efOff" style="grid-template-columns:1fr"><label>Password to switch it off<input type="password" id="efPw" required></label><p class="sub" id="efErr" style="color:var(--bad);margin:0" hidden></p><button class="btn ghost">Turn email codes off</button></form>`;
    $("#efOff").onsubmit=async e=>{e.preventDefault();try{await req("/api/me/2fa/email/disable","POST",{password:$("#efPw").value});toast("Email codes are off.");await loadMe();loadSecurity()}catch(err){$("#efErr").textContent=err.message;$("#efErr").hidden=false}};return}
  if(!me.email_ready){box.innerHTML=`<p class="sub" style="margin:0">Get a 6-digit code by email each time you sign in. Email sending isn't connected on this platform yet, so this can't be switched on.</p>`;return}
  box.innerHTML=`<p class="sub" style="margin:0 0 10px">Get a 6-digit code by email at <b>${esc(me.user.email)}</b> each time you sign in. No app needed.</p><button class="btn" type="button" id="efStart">Send me a code to switch it on</button>`;
  $("#efStart").onclick=async()=>{try{const r=await req("/api/me/2fa/email/start","POST");
    box.innerHTML=`<p class="sub" style="margin:0 0 10px">We sent a code to <b>${esc(r.email)}</b>. It works for 10 minutes.</p><form class="form" id="efOn" style="grid-template-columns:1fr"><label>Code from the email<input id="efCode" inputmode="numeric" maxlength="7" autocomplete="one-time-code" required></label><p class="sub" id="efErr" style="color:var(--bad);margin:0" hidden></p><button class="btn">Turn on email codes</button><button class="btn ghost" type="button" id="efAgain">Send a new code</button></form>`;
    $("#efAgain").onclick=()=>{loadEmail2fa();$("#efStart")?.click()};
    $("#efOn").onsubmit=async e=>{e.preventDefault();try{await req("/api/me/2fa/email/enable","POST",{code:$("#efCode").value});toast("Email codes are on.");await loadMe();loadSecurity()}catch(err){$("#efErr").textContent=err.message;$("#efErr").hidden=false}}}
  catch(err){toast(err.message)}}}
async function loadSecurity(){const on=me.user.totp_enabled,any=on||me.user.email_2fa;$("#tfState").className="tag "+(any?"t-book":"t-attn");$("#tfState").textContent=any?"On":"Off";loadEmail2fa();
  $("#tfBody").innerHTML=on?`<p class="sub" style="margin:0 0 10px">Signing in needs your password and a 6-digit code from your authenticator app.</p>
      <form class="form" id="tfOff"><label>Password<input type="password" id="tfPw" required></label><label>Current code<input id="tfOffCode" inputmode="numeric" maxlength="7" required></label><button class="btn ghost full">Turn two-factor off</button></form>`
    :`<p class="sub" style="margin:0 0 10px">Protect this dashboard even if your password leaks. You'll need an authenticator app (Google Authenticator, Microsoft Authenticator or 1Password).</p><button class="btn" type="button" id="tfStart">Set up two-factor</button>`;
  const tfSetup=async fresh=>{const r=await req("/api/me/2fa/setup","POST",{fresh:!!fresh});
    $("#tfBody").innerHTML=`<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center"><div id="tfQr" style="background:#fff;padding:10px;border-radius:12px"></div>
      <div style="flex:1;min-width:240px"><p class="sub" style="margin:0 0 8px">1. Scan this with your authenticator app.<br>Can't scan? Enter this key: <b style="font-variant-numeric:tabular-nums;letter-spacing:.06em;word-break:break-word;user-select:all" id="tfKey">${esc(r.secret.match(/.{1,4}/g).join(" "))}</b></p>
      <form class="form" id="tfOn" style="grid-template-columns:1fr"><label>2. Type the 6-digit code it shows<input id="tfCode" inputmode="numeric" maxlength="7" autocomplete="one-time-code" required></label><p class="sub" id="tfErr" style="color:var(--bad);margin:0" hidden></p><button class="btn">Turn on</button><button class="btn ghost" type="button" id="tfFresh">Start over with a new key</button></form></div></div>`;
    try{new QRCode($("#tfQr"),{text:r.url,width:180,height:180})}catch{$("#tfQr").textContent="QR unavailable: use the key."}
    $("#tfFresh").onclick=()=>tfSetup(true);
    $("#tfOn").onsubmit=async e=>{e.preventDefault();$("#tfErr").hidden=true;try{await req("/api/me/2fa/enable","POST",{code:$("#tfCode").value});toast("Two-factor is on.");await loadMe();loadSecurity()}catch(err){$("#tfErr").textContent=err.message;$("#tfErr").hidden=false}}};
  $("#tfStart")&&($("#tfStart").onclick=()=>tfSetup(false));
  $("#tfOff")&&($("#tfOff").onsubmit=async e=>{e.preventDefault();try{await req("/api/me/2fa/disable","POST",{password:$("#tfPw").value,code:$("#tfOffCode").value});toast("Two-factor is off.");await loadMe();loadSecurity()}catch(err){toast(err.message)}});
  const act=await req("/api/me/activity");const NAME={login:"Signed in",login_failed:"Wrong password",login_locked:"Locked after wrong passwords",code_failed:"Wrong two-factor code",password_changed:"Password changed",signout_everywhere:"Signed out everywhere","2fa_on":"Two-factor on","2fa_off":"Two-factor off",denied:"Blocked from a section"};
  $("#myAct").innerHTML=act.length?act.map(a=>`<div class="item"><div class="grow"><b style="font-weight:500">${esc(NAME[a.action]||a.action)}</b><span>${esc(a.at)} · ${esc(a.ip||"")}${a.detail?" · "+esc(a.detail):""}</span></div></div>`).join(""):`<div class="empty">No activity yet.</div>`}
$("#pwForm").onsubmit=async e=>{e.preventDefault();$("#pwErr").textContent="";try{await req("/api/me/password","POST",{current:$("#pwCur").value,next:$("#pwNew").value});$("#pwForm").reset();toast("Password changed. Other devices are signed out.")}catch(err){$("#pwErr").textContent=err.message}};
$("#soAll").onclick=async()=>{if(!confirm("Sign out on every device, including this one?"))return;await req("/api/me/signout-everywhere","POST");location.href="/login"};

