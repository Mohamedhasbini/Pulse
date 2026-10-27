// Customers. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- customers ----------
let pplT,pplOpen=null;const RMD={whatsapp:"WhatsApp",sms:"SMS",email:"Email"};
async function loadPeople(){const list=await req(`/api/customers?q=${encodeURIComponent($("#pplQ").value.trim())}&test=${$("#pplTest").checked?1:0}`);
  const reg=list.filter(c=>c.visits>=2).length,spent=list.reduce((a,c)=>a+c.spent,0),withEmail=list.filter(c=>c.email).length;
  $("#pplKpis").innerHTML=[["Customers",list.length,"with a profile"],["Regulars",reg,"2 or more visits"],["Total spent",fmt(spent),"by these customers"],["Have an email",withEmail,list.length?Math.round(withEmail/list.length*100)+"% of customers":"—"]]
    .map(([l,v,sub],i)=>`<div class="kpi glass${i===2?" hero":""}"><span class="k-l">${l}</span><span class="v num">${v}</span><span class="${i===2?"delta":"k-sub"}">${sub}</span></div>`).join("");
  $("#pplRows").innerHTML=list.length?list.map(c=>`<tr class="click" data-cust="${c.id}"><td><b>${esc(c.name||"No name yet")}</b>${c.visits>=2?' <span class="tag t-book">Regular</span>':c.visits===0&&!c.upcoming?' <span class="tag t-faq">New</span>':""}${c.staff_notes?' <span class="tag t-hand" title="Has staff notes">Notes</span>':""}</td>
    <td class="num">${esc(c.phone||"—")}</td><td>${esc(c.email||"—")}</td><td class="num">${c.visits}</td><td class="num">${c.upcoming||"—"}</td><td class="num" style="color:var(--good)">${c.spent?fmt(c.spent):"—"}</td>
    <td class="num">${c.no_shows?`<span style="color:var(--bad)">${c.no_shows}</span>`:"0"}</td><td>${c.last_booking||"—"}</td><td>${RMD[c.reminder_channel]||"WhatsApp"}</td>
    <td><label class="switch" title="Client agreed to receive offers"><input type="checkbox" class="mkOk" data-id="${c.id}" ${c.marketing_ok?"checked":""}> ${c.marketing_ok?"Yes":"No"}</label></td></tr>`).join("")
    :`<tr><td colspan="9" class="empty">No customers yet. Profiles are created automatically when people chat or book.</td></tr>`}
$("#pplQ").oninput=()=>{clearTimeout(pplT);pplT=setTimeout(loadPeople,250)};$("#pplTest").onchange=loadPeople;
async function openCustomer(id){const c=await req("/api/customers/"+id);pplOpen=c;$("#pErr").hidden=true;
  const shown=/^(test|e2e|walk-in)/.test(c.phone)?(c.contact_phone||"—"):c.phone;
  $("#pTitle").textContent=c.name||"Customer";$("#pName").value=c.name||"";$("#pPhone").value=shown;$("#pEmail").value=c.email||"";$("#pRemind").value=c.reminder_channel||"whatsapp";$("#pNotes").value=c.staff_notes||"";
  const live=c.bookings.filter(b=>b.status!=="cancelled"),past=live.filter(b=>L(b.start)<bizNow());
  $("#pStats").innerHTML=`<div><b>${past.filter(b=>b.status!=="no_show").length}</b>Visits</div><div><b>${fmt(live.reduce((a,b)=>a+b.price,0))}</b>Spent</div><div><b>${c.bookings.filter(b=>b.status==="no_show").length}</b>No-shows</div><div><b>${live.filter(b=>L(b.start)>=bizNow()).length}</b>Upcoming</div>`;
  const ST={confirmed:["t-faq","Confirmed"],completed:["t-book","Came"],no_show:["t-attn","No-show"],cancelled:["t-test","Cancelled"]};
  $("#pBook").innerHTML=c.bookings.map(b=>`<div class="item"><span class="time">${nice(L(b.start),{day:"numeric",month:"short"})}</span><div class="grow"><b>${esc(b.service)} · ${hm(L(b.start))}</b><span>${fmt(b.price)}${b.coupon_code?" · code "+esc(b.coupon_code):""} · ${b.source==="web"?"online":b.source==="ai"?"by chat":"by staff"}</span></div><span class="tag ${(ST[b.status]||ST.confirmed)[0]}">${(ST[b.status]||ST.confirmed)[1]}</span></div>`).join("")||`<div class="empty">No bookings yet.</div>`;
  $("#pConv").innerHTML=c.conversations.map(v=>`<div class="item click" data-open="${v.id}" style="cursor:pointer"><div class="grow"><b>${CH[v.channel]||v.channel} · ${ago(v.at)}</b><span>${esc(v.last||"")}</span></div><span class="mini">Read</span></div>`).join("")||`<div class="empty">No conversations.</div>`;
  $("#pModal").hidden=false}
document.addEventListener("click",e=>{const r=e.target.closest("[data-cust]");if(r)openCustomer(r.dataset.cust)});
$("#pClose").onclick=()=>$("#pModal").hidden=true;
$("#pForm").onsubmit=async e=>{e.preventDefault();try{await req("/api/customers/"+pplOpen.id,"PUT",{name:$("#pName").value,email:$("#pEmail").value,reminder_channel:$("#pRemind").value,staff_notes:$("#pNotes").value});
  toast("Profile saved. The AI will use it from the next message.");$("#pModal").hidden=true;loadPeople()}catch(err){$("#pErr").textContent=err.message;$("#pErr").hidden=false}};

