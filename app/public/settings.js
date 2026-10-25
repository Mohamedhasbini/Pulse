// Settings layout: a calm index of every section (grouped Setup / Security / Customize) beside compact forms,
// each section introduced by one line saying what it controls.
(function(){
const st=document.getElementById("setup"),bar=st&&st.querySelector(".ptabs"),G=window.SETTINGS_GROUPS;
if(!st||!bar||!G||!window.tabsOf?.setup)return;
const ABOUT={
  start:["Getting started","The checklist to finish setting up, and the business type that sets the AI's wording and starter templates."],
  details:["Business details","Everything the assistant and your booking page know: name, hours, services and prices, team, policies, questions, photos and contact."],
  tools:["Tools and payments","What the AI may use when it books: time between bookings and the payment options it can offer."],
  reminders:["Reminders","Automatic reminders before each appointment: when they're sent and what they say."],
  channels:["Channels","Where customers can reach your assistant: WhatsApp, Telegram and the web."],
  booking:["Booking page","Your online booking page: on or off, how it looks, notice and how far ahead people can book."],
  codes:["Discount codes","Codes the AI applies automatically, and clearing test data."],
  s2fa:["Two-factor sign-in","A 6-digit code from your phone at sign-in, so a leaked password isn't enough."],
  spw:["Password","Change your password. Your other devices are signed out."],
  sdev:["Devices and activity","Sign out everywhere, and see recent sign-ins and changes on your login."],
  look:["Look and feel","Theme, highlight colour, text size and spacing on this device."],
  dash:["Dashboard","Start page, saved card layouts and how card details work."],
};
const GN={setup:"Setup",security:"Security",customize:"Customize"};
const nav=document.createElement("nav");nav.className="setnav";nav.setAttribute("aria-label","Settings sections");
nav.innerHTML=Object.entries(G).map(([g,keys])=>`<h3>${GN[g]||g}</h3>`+keys.filter(k=>bar.querySelector(`[data-tab="${k}"]`)).map(k=>`<button type="button" data-k="${k}"><i></i>${(ABOUT[k]||[bar.querySelector(`[data-tab="${k}"]`).firstChild.textContent])[0]}</button>`).join("")).join("");
st.classList.add("setlay");st.querySelector(".top").after(nav);
nav.addEventListener("click",e=>{const b=e.target.closest("[data-k]");if(b)tabsOf.setup(b.dataset.k)});
// one-line introduction at the top of each section
st.querySelectorAll(".spane").forEach(p=>{const a=ABOUT[p.dataset.pane];if(!a)return;const h=document.createElement("div");h.className="sethead";h.innerHTML=`<b>${a[0]}</b><span>${a[1]}</span>`;p.prepend(h)});
const mark=k=>nav.querySelectorAll("[data-k]").forEach(b=>b.setAttribute("aria-current",b.dataset.k===k));
addEventListener("tabshown",e=>{if(e.detail.view==="setup")mark(e.detail.tab)});
let cur="start";try{cur=localStorage.getItem("rb-tab-setup")||cur}catch{}mark(cur);
})();
