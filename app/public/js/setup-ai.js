// Reminders, booking page, AI training, business type, channels, Teach AI. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- reminders + booking page settings ----------
function fillAddons(){$("#rmOn").checked=biz.reminders_enabled!==false;$("#rmHours").value=String(biz.reminder_hours||24);$("#rmText").value=biz.reminder_text||"";previewReminder();
  $("#bkOn").checked=biz.booking_enabled!==false;$("#bkTitle").value=biz.booking_title||"";$("#bkIntro").value=biz.booking_intro||"";$("#bkColor").value=biz.booking_color||"#10a35a";
  $("#bkNotice").value=String(biz.booking_min_notice_hours??2);$("#bkAhead").value=String(biz.booking_days_ahead||30);$("#bkPrices").checked=biz.booking_show_prices!==false;
  $("#bkForm").hidden=$("#bkLink").hidden=!$("#bkOn").checked}
let pvT;function previewReminder(){clearTimeout(pvT);pvT=setTimeout(async()=>{try{$("#rmPreview").textContent=(await req("/api/reminders/preview","POST",{text:$("#rmText").value})).text}catch{}},250)}
$("#rmText").oninput=previewReminder;
async function saveAddons(msg){const body={...biz,services:biz.services,reminders_enabled:$("#rmOn").checked,reminder_hours:$("#rmHours").value,reminder_text:$("#rmText").value,
    booking_enabled:$("#bkOn").checked,booking_title:$("#bkTitle").value,booking_intro:$("#bkIntro").value,booking_color:$("#bkColor").value,
    booking_min_notice_hours:$("#bkNotice").value,booking_days_ahead:$("#bkAhead").value,booking_show_prices:$("#bkPrices").checked};
  try{biz=await req("/api/business","PUT",body);fillAddons();toast(msg)}catch(err){toast(err.message)}}
$("#rmForm").onsubmit=e=>{e.preventDefault();saveAddons("Reminder settings saved.")};
$("#rmOn").onchange=()=>saveAddons($("#rmOn").checked?"Reminders turned on.":"Reminders turned off.");
$("#bkForm").onsubmit=e=>{e.preventDefault();saveAddons("Booking page saved.")};
$("#bkOn").onchange=()=>saveAddons($("#bkOn").checked?"Online booking page turned on.":"Online booking page turned off. Existing booking links still work.");
$("#rmRun").onclick=async()=>{const r=await req("/api/reminders/run","POST");toast(r.checked?`Sent ${r.checked} reminder${r.checked>1?"s":""}.`:"No reminders due right now.")};

// ---------- AI training ----------
let trStatus="open";const WHY={unknown:"AI didn't know",ai_failed:"AI didn't respond"};
async function loadTraining(){const [list,b]=await Promise.all([req("/api/learning?status="+trStatus),req("/api/business")]);biz={...biz,...b};
  $("#trKnows").innerHTML=`<div><b>${b.services.length}</b>Services</div><div><b>${b.services.filter(x=>x.description).length}</b>With descriptions</div><div><b>${(b.faqs||[]).length}</b>FAQs</div><div><b>${[b.description,b.policies,b.team,b.payment_methods,b.address].filter(Boolean).length}/5</b>Profile sections filled</div>`;
  $("#trList").innerHTML=list.length?list.map(l=>`<div class="card glass" data-l="${l.id}"><div class="ch"><h2 style="white-space:normal">“${esc(l.question)}”</h2><span class="tag ${l.reason==="ai_failed"?"t-attn":"t-hand"}">${WHY[l.reason]||l.reason}</span></div>
      <p class="sub" style="margin:0 0 10px;font-size:13px">${esc(l.name||(l.phone&&!/^test-/.test(l.phone)?l.phone:"Test customer"))} · ${ago(l.at)}${l.times>1?` · asked ${l.times} times`:""}${l.conversation_id?` · <a href="#" data-open="${l.conversation_id}">open chat</a>`:""}</p>
      ${l.status==="open"?`<div class="form" style="grid-template-columns:1fr">
        <label>Your answer<textarea class="trA" rows="3" placeholder="Write the answer as you'd like the AI to give it"></textarea></label>
        <label>Save it for the AI as this question<input class="trQ" value="${esc(l.question)}"></label>
        <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="switch"><input type="checkbox" class="trSend" ${l.conversation_id?"checked":"disabled"}> Send to this customer now</label><label class="switch"><input type="checkbox" class="trFaq" checked> Teach the AI (save as FAQ)</label></div>
        <div style="display:flex;gap:8px"><button class="btn trGo" type="button">Answer</button><button class="btn ghost trSkip" type="button">Dismiss</button></div></div>`
      :`<div class="ins"><span class="dot" style="--c:var(--good)"></span><div><b>Answer</b>${esc(l.answer||"(dismissed)")}</div></div>`}</div>`).join("")
    :`<div class="card glass"><div class="empty">${trStatus==="open"?"Nothing to answer. When the AI can't answer something, it appears here.":"Nothing here yet."}</div></div>`;
  const n=trStatus==="open"?list.length:null;if(n!==null){$("#trN").dataset.q=n;$("#trN").hidden=!n;$("#trN").textContent=n}}
document.getElementById("trTabs").onclick=e=>{const b=e.target.closest("button");if(!b)return;document.querySelectorAll("#trTabs button").forEach(x=>x.setAttribute("aria-pressed",x===b));trStatus=b.dataset.s;loadTraining()};
document.getElementById("trList").addEventListener("click",async e=>{const card=e.target.closest("[data-l]");if(!card)return;const id=card.dataset.l;
  if(e.target.closest("[data-open]")){e.preventDefault();return}
  if(e.target.closest(".trSkip")){await req(`/api/learning/${id}/dismiss`,"POST");toast("Dismissed.");return loadTraining()}
  if(e.target.closest(".trGo")){const answer=card.querySelector(".trA").value.trim();if(!answer)return toast("Write the answer first.");
    try{const r=await req(`/api/learning/${id}/answer`,"POST",{answer,faq_question:card.querySelector(".trQ").value,send:card.querySelector(".trSend").checked,save_faq:card.querySelector(".trFaq").checked});
      toast(r.warning||[card.querySelector(".trSend").checked&&"Sent to the customer",card.querySelector(".trFaq").checked&&"the AI will know it next time"].filter(Boolean).join(", ")+".");loadTraining();refresh()}catch(err){toast(err.message)}}});

// ---------- business type ----------
let verticals=[];const cap1=w=>w?w[0].toUpperCase()+w.slice(1):w;
function applyTerms(){const t=biz?.terms;if(!t)return;const map={Booking:cap1(t.booking),Customer:cap1(t.customer),Customers:cap1(t.customers),Services:cap1(t.services)};
  document.querySelectorAll("[data-term]").forEach(el=>{if(map[el.dataset.term])el.textContent=map[el.dataset.term]})}
async function loadVerticals(){verticals=await req("/api/verticals");
  $("#vtSel").innerHTML=verticals.map(v=>`<option value="${v.key}" ${v.comingSoon?"disabled":""}>${v.emoji} ${esc(v.label)}</option>`).join("");$("#vtSel").value=biz.vertical||"salon";vtNote()}
function vtNote(){const v=verticals.find(x=>x.key===$("#vtSel").value);if(!v)return;$("#vtNote").textContent=`Words used: ${v.terms.customers}, ${v.terms.bookings}, ${v.terms.services}.`+(v.note?" "+v.note:"")}
$("#vtSel").onchange=vtNote;
$("#vtApply").onclick=async()=>{const key=$("#vtSel").value,tpl=$("#vtTpl").checked;
  if(tpl&&!$("#vtApply").dataset.sure){$("#vtApply").dataset.sure=1;$("#vtApply").textContent="Yes, replace my services";$("#vtNote").textContent="This replaces your services, FAQs and policies with the starter template. Click again to confirm.";return}
  delete $("#vtApply").dataset.sure;$("#vtApply").textContent="Apply";
  try{biz=await req("/api/business/vertical","POST",{key,template:tpl});fillSetup();applyTerms();toast(tpl?"Business type and starter template applied.":"Business type changed.");refresh()}catch(err){toast(err.message)}};

// ---------- channels ----------
async function loadChannels(){const [c,d]=await Promise.all([req("/api/channels"),req("/api/webook-demo")]);const base=PUB(),tg=c.telegram;
  const row=(icon,name,state,ok,body)=>`<div class="item" style="align-items:flex-start"><div class="grow"><b>${icon} ${name} <span class="tag ${ok?"t-book":"t-faq"}" style="display:inline">${state}</span></b><span style="white-space:normal">${body}</span></div></div>`;
  $("#chList").innerHTML=row("📱","WeBook app","Live",true,`Customers open <b>${base}/webook</b>, find this business, chat with the AI and book. Works on any phone and can be added to the home screen. Use your public address once the tunnel route is added.`)
    +row("✈️","Telegram",tg.running?"Connected @"+tg.bot:tg.configured?"Not connecting":"Not set up",tg.running,(tg.running?`Customers chat with <b><a href="https://t.me/${esc(tg.bot)}" target="_blank" rel="noopener">t.me/${esc(tg.bot)}</a></b> and the AI answers. Staff replies and reminders go there too. The bot uses your business name; set its photo in @BotFather with /setuserpic. <button class="mini" id="tgOff" type="button">Disconnect</button>`
      :(tg.error?`<span style="color:var(--bad)">${esc(tg.error)}</span><br>`:"")+`Give this business its own bot: 1) In Telegram, open <b>@BotFather</b>, send /newbot and pick a name and username. 2) Paste the token it gives you here:<br><input id="tgToken" placeholder="123456789:AAH..." style="width:100%;max-width:420px;margin:8px 0" autocomplete="off"> <button class="mini" id="tgOn" type="button">Connect bot</button>`))
    +row("🟢","WhatsApp",c.whatsapp.configured?"Configured":"Not set up",c.whatsapp.configured,"Needs a Meta WhatsApp Business account. A later step.")
    +row("🧪","Demo businesses in WeBook",d.n?d.n+" shown":"None",!!d.n,d.n?`Sample places so the marketplace is not empty. <button class="mini" id="demoOff" type="button">Remove demo businesses</button>`:`<button class="mini" id="demoOn" type="button">Add demo businesses</button>`);
  if($("#tgOn"))$("#tgOn").onclick=async()=>{try{const r=await req("/api/channels/telegram","PUT",{token:$("#tgToken").value});toast("Connected @"+r.bot+".");loadChannels()}catch(err){toast(err.message)}};
  if($("#tgOff"))$("#tgOff").onclick=async()=>{await req("/api/channels/telegram","PUT",{token:""});toast("Telegram bot disconnected.");loadChannels()};
  if($("#demoOff"))$("#demoOff").onclick=async()=>{await req("/api/webook-demo/remove","POST");toast("Demo businesses removed from WeBook.");loadChannels()};
  if($("#demoOn"))$("#demoOn").onclick=async()=>{await req("/api/webook-demo/add","POST");toast("Demo businesses added.");loadChannels()}}

// ---------- teach AI: review, correct, rules ----------
let rvFilter="todo";
async function loadTeach(){const [st,list,rules]=await Promise.all([req("/api/review/stats"),req("/api/review?filter="+rvFilter),req("/api/ai-rules")]);
  $("#tchStats").innerHTML=`<div><b>${st.accuracy===null?"–":st.accuracy+"%"}</b>Replies you rated good</div><div><b>${st.todo}</b>Replies to review</div><div><b style="color:${st.low?"var(--bad)":"inherit"}">${st.low}</b>The AI wasn't sure</div><div><b>${st.corrected}</b>Answers you taught</div><div><b>${rules.length}</b>Strict rules</div>`;
  const trOpen=+($("#trN").dataset.q||0),n=st.low+trOpen;$("#trN").hidden=!n;$("#trN").textContent=n;
  $("#rvList").innerHTML=list.length?list.map(m=>`<div class="card glass" data-m="${m.id}">
    <div class="ch"><small>${esc(m.name||(m.phone&&!/^(test|e2e|walk-in|tg-)/.test(m.phone)?m.phone:"Customer"))} · ${ago(m.at)} · ${esc(CH[m.channel]||m.channel)}</small>${m.confidence==="low"?'<span class="tag t-attn">AI not sure</span>':""}</div>
    <div class="ins"><span class="dot" style="--c:var(--muted)"></span><div><b>Customer asked</b>${esc(m.question||"(start of chat)")}</div></div>
    <div class="ins"><span class="dot" style="--c:${m.review==="wrong"?"var(--bad)":m.review==="corrected"?"var(--muted)":"var(--accent)"}"></span><div><b>AI replied</b><span style="white-space:pre-wrap">${esc(m.answer)}</span></div></div>
    ${m.review==="corrected"?`<div class="ins"><span class="dot" style="--c:var(--good)"></span><div><b>Your answer (taught)</b><span style="white-space:pre-wrap">${esc(m.corrected_text)}</span></div></div>`:""}
    ${m.review?`<div style="display:flex;gap:8px;margin-top:10px"><button class="mini rvUndo" type="button">Undo</button>${m.conversation_id?`<a href="#" class="mini" data-open="${m.conversation_id}">Open chat</a>`:""}</div>`
    :`<div class="rvFix" hidden><div class="form" style="grid-template-columns:1fr;margin-top:10px">
        <label>The right answer<textarea class="rvBetter" rows="3">${esc(m.answer)}</textarea></label>
        <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="switch"><input type="checkbox" class="rvSend"> Send this to the customer now</label><label class="switch"><input type="checkbox" class="rvFaq" checked> Also save as an FAQ</label></div>
        <div style="display:flex;gap:8px"><button class="btn rvSave" type="button">Teach this answer</button><button class="btn ghost rvCancel" type="button">Cancel</button></div></div></div>
      <div class="rvActs" style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn rvGood" type="button">Good reply</button><button class="btn ghost rvEdit" type="button">Fix the answer</button><button class="btn ghost rvWrong" type="button">Wrong</button>${m.conversation_id?`<a href="#" class="mini" data-open="${m.conversation_id}" style="align-self:center">Open chat</a>`:""}</div>`}
  </div>`).join(""):`<div class="card glass"><div class="empty">${rvFilter==="todo"?"All caught up. New AI replies show up here for you to check.":"Nothing here yet."}</div></div>`;
  const send=async(id,body)=>{try{const r=await req("/api/review/"+id,"POST",body);if(r.warning)toast(r.warning);loadTeach()}catch(err){toast(err.message)}};
  $("#rvList").querySelectorAll("[data-m]").forEach(c=>{const id=c.dataset.m,f=c.querySelector(".rvFix"),a=c.querySelector(".rvActs");
    c.querySelector(".rvGood")?.addEventListener("click",()=>{send(id,{verdict:"approved"});toast("Marked good. The AI will answer like this again.")});
    c.querySelector(".rvWrong")?.addEventListener("click",()=>{f.hidden=false;a.hidden=true;c.dataset.wrong=1;toast("Write the right answer to teach it, or Cancel.")});
    c.querySelector(".rvEdit")?.addEventListener("click",()=>{f.hidden=false;a.hidden=true});
    c.querySelector(".rvCancel")?.addEventListener("click",()=>{if(c.dataset.wrong){send(id,{verdict:"wrong"});return}f.hidden=true;a.hidden=false});
    c.querySelector(".rvSave")?.addEventListener("click",()=>{send(id,{verdict:"corrected",better:c.querySelector(".rvBetter").value,send:c.querySelector(".rvSend").checked,save_faq:c.querySelector(".rvFaq").checked});toast("Taught. The AI will use your answer from now on.")});
    c.querySelector(".rvUndo")?.addEventListener("click",()=>send(id,{verdict:"undo"}))});
  renderRules(rules)}
let rules=[];
function renderRules(r){rules=r;$("#ruList").innerHTML=r.length?r.map((x,i)=>`<div class="item"><div class="grow"><b style="font-weight:500;white-space:normal">${i+1}. ${esc(x.text)}</b></div><div class="acts"><button class="mini" data-ed="${i}">Edit</button><button class="mini" data-del="${i}">Remove</button></div></div>`).join(""):`<div class="empty">No rules yet. The AI follows your Setup and its built-in safety rules.</div>`;
  $("#ruList").querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>saveRules(rules.filter((_,i)=>i!==+b.dataset.del)));
  $("#ruList").querySelectorAll("[data-ed]").forEach(b=>b.onclick=()=>{const t=prompt("Edit rule",rules[+b.dataset.ed].text);if(t!==null)saveRules(rules.map((x,i)=>i===+b.dataset.ed?{text:t}:x))})}
async function saveRules(r){try{renderRules(await req("/api/ai-rules","PUT",{rules:r}));toast("Rules saved. The AI follows them from the next message.");loadTeach()}catch(err){toast(err.message)}}
$("#ruForm").onsubmit=e=>{e.preventDefault();const t=$("#ruIn").value.trim();if(!t)return;$("#ruIn").value="";saveRules([...rules,{text:t}])};
document.querySelectorAll("#tchMode button").forEach(b=>b.onclick=()=>{document.querySelectorAll("#tchMode button").forEach(x=>x.setAttribute("aria-pressed",x===b));
  $("#tchReview").hidden=b.dataset.m!=="review";$("#tchQuestions").hidden=b.dataset.m!=="questions";$("#tchRules").hidden=b.dataset.m!=="rules"});
document.querySelectorAll("#rvTabs button").forEach(b=>b.onclick=()=>{document.querySelectorAll("#rvTabs button").forEach(x=>x.setAttribute("aria-pressed",x===b));rvFilter=b.dataset.f;loadTeach()});

