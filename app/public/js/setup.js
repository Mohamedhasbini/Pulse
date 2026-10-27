// Settings: services, hours, FAQs. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- setup ----------
function svcRow(s={}){const d=document.createElement("div");d.className="svc";d.dataset.id=s.id||"";d.style.gridTemplateColumns="1fr 84px 84px 96px 30px";
  d.innerHTML=`<input value="${esc(s.name||"")}" placeholder="Service" aria-label="Service name"><input type="number" min="0" value="${s.price??""}" placeholder="Price" aria-label="Price"><input type="number" min="5" step="5" value="${s.minutes??30}" aria-label="Minutes"><input class="svcCap" type="number" min="0" value="${s.capacity??""}" placeholder="At once" title="Optional. How many of this can be booked at the same time, e.g. 6 tables for 2. Empty = use the business limit." aria-label="How many at the same time"><button type="button" aria-label="Remove service">✕</button><input class="svcDesc" value="${esc(s.description||"")}" placeholder="What's included, who it's for (helps the AI answer)" aria-label="Service description" style="grid-column:1/-1">`;
  d.querySelector("button").onclick=()=>d.remove();$("#svcList").appendChild(d)}
function hoursRows(){$("#fHours").innerHTML=[1,2,3,4,5,6,0].map(d=>{const r=biz.hours?.[d]||[];
  return`<div class="hr-row" data-d="${d}"><label class="hr-open"><input type="checkbox" ${r.length?"checked":""}> ${DAYS[d]}</label><input class="hr-ranges" value="${r.map(x=>x.join("-")).join(", ")}" placeholder="Closed" aria-label="${DAYS[d]} hours"></div>`}).join("");
  $("#fHours").querySelectorAll(".hr-row").forEach(row=>{const cb=row.querySelector("input[type=checkbox]"),inp=row.querySelector(".hr-ranges");
    const sync=()=>{inp.disabled=!cb.checked;if(cb.checked&&!inp.value)inp.value="10:00-20:00"};cb.onchange=sync;sync()})}
function readHours(){const out={};let bad=null;$("#fHours").querySelectorAll(".hr-row").forEach(row=>{const d=row.dataset.d,on=row.querySelector("input[type=checkbox]").checked,txt=row.querySelector(".hr-ranges").value;
  out[d]=!on?[]:txt.split(",").map(s=>s.trim()).filter(Boolean).map(s=>{const m=s.match(/^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/);if(!m||+m[1]>24||+m[3]>24){bad=DAYS[d];return null}return[`${pad(m[1])}:${m[2]||"00"}`,`${pad(m[3])}:${m[4]||"00"}`]}).filter(Boolean)});
  return bad?{error:`Check the hours for ${bad}. Write them like 10:00-14:00, 15:00-20:00.`}:{hours:out}}
function faqRow(x={}){const d=document.createElement("div");d.className="faq";d.style.cssText="display:grid;grid-template-columns:1fr 1.6fr 30px;gap:8px";
  d.innerHTML=`<input value="${esc(x.q||"")}" placeholder="Question, e.g. Do you do bridal packages?" aria-label="Question"><input value="${esc(x.a||"")}" placeholder="Answer" aria-label="Answer"><button type="button" class="mini" aria-label="Remove question">✕</button>`;
  d.querySelector("button").onclick=()=>d.remove();$("#faqList").appendChild(d)}
$("#addFaq").onclick=()=>faqRow();
function fillSetup(){setTimeout(fillAddons);$("#fDesc").value=biz.description||"";$("#fMaps").value=biz.maps_url||"";$("#fInsta").value=biz.instagram||"";$("#fWeb").value=biz.website||"";
  $("#fLang").value=biz.languages||"";$("#fTone").value=biz.tone||"warm";drawUploads();$("#fAsst").value=biz.assistant_name||"Nora";$("#fAskEmail").checked=biz.ask_email!==false;$("#fTeam").value=biz.team||"";$("#fPol").value=biz.policies||"";$("#fAi").value=biz.ai_instructions||"";
  $("#faqList").innerHTML="";(biz.faqs||[]).forEach(faqRow);$("#fName").value=biz.name;$("#fAddr").value=biz.address||"";$("#fCap").value=biz.capacity||1;$("#fStep").value=biz.slot_step||30;$("#fFaq").value=biz.faq||"";$("#fPay").value=biz.payment_methods||"";$("#fPhone").value=biz.phone||"";$("#fCancel").value=String(biz.cancel_hours??24);$("#fNote").value=biz.booking_note||"";$("#fWa").value=biz.wa_phone_number_id||"";
  hoursRows();$("#svcList").innerHTML="";biz.services.forEach(svcRow);$("#phName").textContent=biz.name}
$("#addSvc").onclick=()=>svcRow();
$("#setupForm").onsubmit=async e=>{e.preventDefault();const hr=readHours();if(hr.error)return toast(hr.error);
  const services=[...$("#svcList").children].map(r=>{const i=r.querySelectorAll("input");return{id:+r.dataset.id||null,name:i[0].value.trim(),price:i[1].value||0,minutes:i[2].value||30,capacity:r.querySelector(".svcCap").value,description:r.querySelector(".svcDesc").value.trim()}});
  if(!services.some(s=>s.name))return toast("Add at least one service.");
  const faqs=[...$("#faqList").children].map(r=>{const i=r.querySelectorAll("input");return{q:i[0].value.trim(),a:i[1].value.trim()}}).filter(x=>x.q&&x.a);
  try{biz=await req("/api/business","PUT",{...biz,description:$("#fDesc").value,maps_url:$("#fMaps").value,instagram:$("#fInsta").value,website:$("#fWeb").value,languages:$("#fLang").value,
    tone:$("#fTone").value,assistant_name:$("#fAsst").value.trim()||"Nora",ask_email:$("#fAskEmail").checked,team:$("#fTeam").value,policies:$("#fPol").value,ai_instructions:$("#fAi").value,faqs,name:$("#fName").value,address:$("#fAddr").value,hours:hr.hours,capacity:$("#fCap").value,slot_step:$("#fStep").value,faq:$("#fFaq").value,payment_methods:$("#fPay").value.trim(),phone:$("#fPhone").value.trim(),cancel_hours:$("#fCancel").value,booking_note:$("#fNote").value.trim(),wa_phone_number_id:$("#fWa").value.trim(),services});
    fillSetup();toast("Saved. The assistant uses this from the next message.");refresh();drawCal()}catch(err){toast(err.message)}};
$("#clearBtn").onclick=()=>{$("#clearAsk").hidden=false};$("#clearNo").onclick=()=>{$("#clearAsk").hidden=true};
$("#clearYes").onclick=async()=>{await req("/api/test-data/clear","POST");$("#clearAsk").hidden=true;lastStats=null;toast("Test data deleted.");refresh();if(weekStart)loadCal()};

