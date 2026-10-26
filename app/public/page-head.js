// One heading style for every page: the page's sidebar name and one line saying what it is for.
// The sections' own headings stay in the page (other code still writes into them) but are hidden.
(function(){
const $=s=>document.querySelector(s);
const HEAD={
  today:["Today","What needs you today. Everything updates live."],
  inbox:["Inbox","Every conversation, with the ones that need you first."],
  support:["Support","How well your AI solves what customers need, and what to teach it next."],
  calendar:["Calendar","Your week of appointments. Click a slot to book, a booking to change it."],
  agents:["Team","Your AI employees and the work waiting for your OK."],
  performance:["Performance","How chats turn into bookings, live."],
  analytics:["Insights","Revenue, timing and services over the period you choose."],
  people:["Customers","Who your clients are, who to bring back, and offers."],
  training:["Teach AI","Review replies, answer what it didn't know, and set its rules."],
  demo:["Test lab","Test the receptionist like a real customer before it talks to real ones."],
  website:["Website","Your booking website: texts, photos and publishing."],
  settings:["Settings","Your business details, channels, booking page and payments."],
  account:["Account","Your login, devices and how Pulse looks."],
  admin:["Businesses","Every client business, login and plan. Only you see this."],
};
function where(){const p=$('nav .navpills > button[data-page][aria-current="true"]')?.dataset.page;if(p)return p;
  const s=$("main > section.wrap:not([hidden])")?.id;return s==="overview"?"performance":s==="setup"?"settings":s}
function head(){const id=where(),sec=$("main > section.wrap:not([hidden])"),h=HEAD[id];if(!sec||!h||sec.id==="today")return;
  const top=sec.querySelector(":scope > .top");if(!top)return;
  let box=top.querySelector(":scope > .pg-head");if(!box){box=document.createElement("div");box.className="pg-head";top.prepend(box)}
  if(box.dataset.id!==id){box.dataset.id=id;box.innerHTML=`<h1>${h[0]}</h1><p>${h[1]}</p>`}}
let t=null;const soon=()=>{clearTimeout(t);t=setTimeout(head,60)};
document.addEventListener("click",e=>{if(e.target.closest("nav button,.pg-tabs button,[data-go],[data-team],.tp-link"))soon()});
addEventListener("pageshown",soon);addEventListener("load",()=>setTimeout(head,900));
new MutationObserver(soon).observe(document.querySelector("main"),{attributes:true,subtree:false,childList:false,attributeFilter:["hidden"]});
document.querySelectorAll("main > section.wrap").forEach(s=>new MutationObserver(soon).observe(s,{attributes:true,attributeFilter:["hidden"]}));
})();
