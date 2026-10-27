// Calendar: week grid, bookings and time off. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- calendar ----------
let HOUR_PX=52;
// the week fits its card without scrolling: hour rows shrink (down to 22px) to the room there is
// each draw takes off what the last one overflowed by, so the second draw fits exactly
function fitHour(hours){const c=document.querySelector('#calendar > .card');if(!c||!c.clientHeight)return HOUR_PX;const over=c.scrollHeight-c.clientHeight;return Math.max(22,Math.min(52,over>2?HOUR_PX-Math.ceil(over/hours):HOUR_PX))}
let weekStart=null,cal={bookings:[],timeOff:[]};
function startOfWeek(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x}
const toMin=t=>{const[a,b]=t.split(":").map(Number);return a*60+(b||0)};
function gridHours(){let a=24*60,b=0;for(let d=0;d<7;d++)(biz.hours?.[d]||[]).forEach(([s,e])=>{a=Math.min(a,toMin(s));b=Math.max(b,toMin(e))});if(a>=b){a=9*60;b=18*60}return[Math.floor(a/60),Math.ceil(b/60)]}
async function loadCal(){if(!weekStart)weekStart=startOfWeek(bizNow());const to=new Date(weekStart);to.setDate(to.getDate()+7);
  cal=await req(`/api/calendar?from=${stamp(weekStart)}&to=${stamp(to)}`);syncNow(cal.now);drawCal()}
function drawCal(){if(!biz||!weekStart)return;const[h0,h1]=gridHours();HOUR_PX=fitHour(h1-h0);const H=(h1-h0)*HOUR_PX,now=bizNow(),todayK=dayKey(now);
  const end=new Date(weekStart);end.setDate(end.getDate()+6);
  $("#calRange").textContent=`${nice(weekStart,{day:"numeric",month:"short"})} – ${nice(end,{day:"numeric",month:"short",year:"numeric"})}`;
  let head=`<div></div>`,cols=`<div class="cal-times" style="height:${H}px">`;for(let h=h0;h<h1;h++)cols+=`<span style="top:${(h-h0)*HOUR_PX}px">${pad(h)}:00</span>`;cols+="</div>";
  for(let i=0;i<7;i++){const day=new Date(weekStart);day.setDate(day.getDate()+i);const dk=dayKey(day);
    const dayB=cal.bookings.filter(b=>b.start.startsWith(dk)&&b.status!=="cancelled");
    head+=`<div class="cal-dh ${dk===todayK?"today":""}"><b>${nice(day,{weekday:"short"})} ${day.getDate()}</b><small>${dayB.length?dayB.length+" · "+fmt(dayB.reduce((a,b)=>a+b.price,0)):(biz.hours?.[day.getDay()]||[]).length?"":"Closed"}</small></div>`;
    let c=`<div class="cal-col" data-date="${dk}" style="height:${H}px">`;
    (biz.hours?.[day.getDay()]||[]).forEach(([s,e])=>c+=`<div class="cal-open" style="top:${(toMin(s)-h0*60)/60*HOUR_PX}px;height:${(toMin(e)-toMin(s))/60*HOUR_PX}px"></div>`);
    for(let h=h0;h<h1;h++)c+=`<div class="cal-line" style="top:${(h-h0)*HOUR_PX}px"></div>`;
    const dayStart=new Date(day),dayEnd=new Date(day);dayEnd.setDate(dayEnd.getDate()+1);
    if(dayEnd<=now)c+=`<div class="past" style="height:${H}px;border-radius:8px"></div>`;
    else if(dk===todayK){const m=now.getHours()*60+now.getMinutes();const y=Math.min(H,Math.max(0,(m-h0*60)/60*HOUR_PX));c+=`<div class="past" style="height:${y}px"></div>`;if(y>0&&y<H)c+=`<div class="cal-now" style="top:${y}px"></div>`}
    const place=(s,e)=>{s=new Date(Math.max(s,dayStart));e=new Date(Math.min(e,dayEnd));const top=((s-dayStart)/60000-h0*60)/60*HOUR_PX,ht=(e-s)/3600000*HOUR_PX;return`top:${Math.max(0,top)}px;height:${Math.max(20,ht)}px`};
    cal.timeOff.filter(t=>L(t.start)<dayEnd&&L(t.end)>dayStart).forEach(t=>c+=`<button type="button" class="cal-off" data-off="${t.id}" style="${place(L(t.start),L(t.end))}">Blocked${t.reason?" · "+esc(t.reason):""}</button>`);
    const vis=cal.bookings.filter(b=>L(b.start)<dayEnd&&L(b.end)>dayStart);
    vis.forEach(b=>{const s=L(b.start),e=L(b.end);const lane=vis.filter(o=>o!==b&&o.status!=="cancelled"&&L(o.start)<e&&L(o.end)>s),idx=lane.filter(o=>o.id<b.id).length,n=lane.length+1;
      // name first, then time and service; a booking shorter than 40 minutes keeps to one line. The dot marks who booked it
      const w=100/n,short=(e-s)<40*60000,src=b.source==="ai"?"ai":b.source==="web"?"web":"";
      c+=`<button type="button" class="cal-b st-${b.status}${short?" short":""}" data-b="${b.id}" title="${esc(b.customer||"")} · ${esc(b.service)} · ${hm(s)}–${hm(e)}${src==="ai"?" · booked by the AI":src==="web"?" · booked online":""}" style="${place(s,e)};left:calc(${idx*w}% + 2px);right:auto;width:calc(${w}% - 4px)"><b>${src?`<i class="src ${src}"></i>`:""}${esc(b.customer||"Customer")}</b><span><em>${hm(s)}</em><u> · ${esc(b.service)}</u></span></button>`});
    cols+=c+"</div>"}
  $("#calHead").innerHTML=head;$("#calGrid").innerHTML=cols;
  const live=cal.bookings.filter(b=>b.status!=="cancelled"),cap=biz.capacity||1;
  $("#calSum").textContent=`${live.length} booking${live.length===1?"":"s"} · ${fmt(live.reduce((a,b)=>a+b.price,0))} this week · ${cap} customer${cap>1?"s":""} at a time`;
  $("#calTz").textContent=`Times are the business's time (${lastStats?.tz||"local"}).`}
$("#calGrid").onclick=e=>{const b=e.target.closest("[data-b]"),o=e.target.closest("[data-off]"),col=e.target.closest(".cal-col");
  if(b)return openBooking(cal.bookings.find(x=>x.id===+b.dataset.b));if(o)return openOff(cal.timeOff.find(x=>x.id===+o.dataset.off));
  if(col){const[h0]=gridHours(),y=e.clientY-col.getBoundingClientRect().top,step=biz.slot_step||30,m=Math.floor((h0*60+y/HOUR_PX*60)/step)*step;
    const when=L(`${col.dataset.date}T${pad(Math.floor(m/60))}:${pad(m%60)}`);if(when<bizNow())return toast("That time has passed. Pick a later time.");
    openBooking(null,col.dataset.date,hm(when))}};
$("#calPrev").onclick=()=>{weekStart.setDate(weekStart.getDate()-7);loadCal()};$("#calNext").onclick=()=>{weekStart.setDate(weekStart.getDate()+7);loadCal()};
$("#calToday").onclick=()=>{weekStart=startOfWeek(bizNow());loadCal()};
$("#calNew").onclick=()=>{const n=bizNow();n.setMinutes(Math.ceil(n.getMinutes()/30)*30,0,0);openBooking(null,dayKey(n),hm(n))};$("#calBlock").onclick=()=>openOff(null);

let editing=null;
function openBooking(b,date,time){editing=b;$("#bErr").hidden=true;$("#bForce").hidden=true;
  $("#bTitle").textContent=b?"Booking":"New booking";
  $("#bService").innerHTML=biz.services.map(s=>`<option value="${s.id}">${esc(s.name)} · ${fmt(s.price)} · ${s.minutes} min</option>`).join("");
  $("#bName").value=b?.customer||"";$("#bPhone").value=b&&!/^(test|walk-in)/.test(b.phone)?b.phone:"";$("#bName").disabled=$("#bPhone").disabled=!!b;
  if(b){const s=L(b.start);$("#bDate").value=dayKey(s);$("#bTime").value=hm(s);$("#bService").value=b.service_id;$("#bStatus").value=b.status;
    $("#bInfo").textContent=`${b.source==="ai"?"Booked by the AI in chat":b.source==="web"?"Booked online by the customer":"Added by staff"} · ${hm(s)}–${hm(L(b.end))} · ${fmt(b.price)}${b.coupon_code?` · Code ${b.coupon_code} applied`:""}${b.notes?` · Extra request: ${b.notes}`:""}${b.reminder_status?` · Reminder: ${b.reminder_status==="sent"?"sent":b.reminder_status==="skipped"?"not needed (booked last minute)":b.reminder_status.replace("not_sent: ","not sent, ")}`:""}`}
  else{$("#bDate").value=date;$("#bTime").value=time;$("#bStatus").value="confirmed";$("#bInfo").textContent=""}
  $("#bChat").hidden=!(b&&b.conversation_id);$("#bStatusWrap").hidden=!b;$("#bCancel").hidden=!b||b.status==="cancelled";$("#bModal").hidden=false;if(!b)$("#bName").focus()}
async function saveBooking(force){const start=`${$("#bDate").value}T${$("#bTime").value}`;
  try{if(editing){const moved=start!==editing.start||+$("#bService").value!==editing.service_id;
      await req(`/api/bookings/${editing.id}`,"PATCH",{...(moved?{start,service_id:+$("#bService").value}:{}),status:$("#bStatus").value,force})}
    else await req("/api/bookings","POST",{name:$("#bName").value.trim(),phone:$("#bPhone").value.trim(),service_id:+$("#bService").value,start,force});
    $("#bModal").hidden=true;toast(editing?"Booking updated.":"Booking added.");loadCal();refresh()}
  catch(err){$("#bErr").textContent=err.message;$("#bErr").hidden=false;$("#bForce").hidden=err.status!==409}}
$("#bForm").onsubmit=e=>{e.preventDefault();saveBooking(false)};$("#bForce").onclick=()=>saveBooking(true);
$("#bCancel").onclick=async()=>{await req(`/api/bookings/${editing.id}`,"PATCH",{status:"cancelled"});$("#bModal").hidden=true;toast("Booking cancelled. The time is free again.");loadCal();refresh()};
$("#bChat").onclick=()=>{$("#bModal").hidden=true;openConv(editing.conversation_id)};
$("#bClose").onclick=()=>$("#bModal").hidden=true;

let editingOff=null;
function openOff(t){editingOff=t;$("#oErr").hidden=true;const n=bizNow();n.setMinutes(0,0,0);n.setHours(n.getHours()+1);const s=t?L(t.start):n,e=t?L(t.end):new Date(n.getTime()+3600000);
  $("#oStart").value=stamp(s);$("#oEnd").value=stamp(e);$("#oReason").value=t?.reason||"";
  $("#oStart").disabled=$("#oEnd").disabled=$("#oReason").disabled=!!t;$("#oSave").hidden=!!t;$("#oDelete").hidden=!t;$("#oTitle").textContent=t?"Blocked time":"Block time";$("#oModal").hidden=false}
$("#oForm").onsubmit=async e=>{e.preventDefault();try{await req("/api/time-off","POST",{start:$("#oStart").value,end:$("#oEnd").value,reason:$("#oReason").value.trim()});
  $("#oModal").hidden=true;toast("Time blocked. The AI won't offer it.");loadCal()}catch(err){$("#oErr").textContent=err.message;$("#oErr").hidden=false}};
$("#oDelete").onclick=async()=>{await req(`/api/time-off/${editingOff.id}`,"DELETE");$("#oModal").hidden=true;toast("Block removed.");loadCal()};
$("#oClose").onclick=()=>$("#oModal").hidden=true;


// draw twice when the first draw still overflowed the card (fitHour measures it)
{const _draw=drawCal;drawCal=function(){_draw();const c=document.querySelector('#calendar > .card');if(c&&c.scrollHeight>c.clientHeight+2&&HOUR_PX>22)_draw()}}
