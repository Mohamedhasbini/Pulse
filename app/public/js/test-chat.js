// Test chat. Split out of index.html; plain scripts sharing one global scope, loaded in this order.
// ---------- test chat ----------
let testPhone="test-"+Math.random().toString(36).slice(2,8),busy=false;
function add(t,w,meta){const d=document.createElement("div");d.className="m "+w;d.textContent=t;if(meta){const s=document.createElement("span");s.className="meta";s.textContent=meta;d.appendChild(s)}$("#msgs").appendChild(d);$("#msgs").scrollTop=1e9}
$("#sendForm").onsubmit=async e=>{e.preventDefault();const t=$("#msgIn").value.trim();if(!t||busy)return;busy=true;$("#sendBtn").disabled=true;$("#msgIn").value="";add(t,"me");
  const t0=Date.now();$("#phState").textContent="typing…";const slow=setTimeout(()=>$("#phState").textContent="still thinking… the AI is slow right now",8000);
  try{const r=await req("/api/test-chat","POST",{text:t,phone:testPhone});testConv=r.conversationId;testSeen=(await req(`/api/conversations/${testConv}/messages`)).length;if(r.paused)add("The team took over this chat, so the AI stays quiet. Staff replies will appear here.","sys");
    else add(r.reply,"ai"+(r.failed&&!/team member/.test(r.reply)?"":r.failed?" fail":""),r.failed?(/team member/.test(r.reply)?"The AI didn't answer in time. The question is in Training and Needs you, so staff can reply.":"The AI was slow, so this was answered instantly from your setup."):`replied in ${((Date.now()-t0)/1000).toFixed(1)}s`);
    showChoices(r.options||[]);if(r.bookedNow)add("Booking saved. It's in the calendar now.","sys");refresh();if(weekStart)loadCal()}
  catch(err){add(err.message,"sys")}
  clearTimeout(slow);$("#phState").textContent="AI assistant";busy=false;$("#sendBtn").disabled=false;$("#msgIn").focus()};
function showChoices(list){document.querySelectorAll("#msgs .tchips").forEach(x=>x.remove());if(!list.length)return;
  const c=document.createElement("div");c.className="tchips";c.style.cssText="display:flex;gap:6px;flex-wrap:wrap;align-self:flex-start;margin:2px 0 6px";
  list.forEach(o=>{const b=document.createElement("button");b.type="button";b.className="mini";b.textContent=o;b.onclick=()=>{c.remove();$("#msgIn").value=o;$("#sendForm").requestSubmit()};c.appendChild(b)});
  $("#msgs").appendChild(c);$("#msgs").scrollTop=1e9}
$("#resetBtn").onclick=()=>{testConv=null;testSeen=0;testPhone="test-"+Math.random().toString(36).slice(2,8);$("#msgs").innerHTML="";$("#log").textContent="New customer. The AI doesn't know this person yet."};

