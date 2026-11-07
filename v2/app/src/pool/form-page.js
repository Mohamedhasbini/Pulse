// Public capture form (GET /f/:slug) and simple message pages. Server-rendered, no framework, works inside an iframe
// on any client website. Every marketing consent is a separate, unticked box naming the businesses and the channel.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RTL = new Set(['ar', 'he', 'fa', 'ur']);

const BASE_CSS = `
:root{--bg:#eef1f3;--card:#ffffff;--ink:#0f1418;--muted:#5b6670;--line:#d6dce1;--focus:#0f1418;--btn:#11161b;--btn-fg:#f2f5f7;--accent:#c6f432;--bad:#a12f2f}
@media (prefers-color-scheme:dark){:root{--bg:#0d1013;--card:#161a1e;--ink:#e9edf0;--muted:#97a1aa;--line:#2a3137;--focus:#e9edf0;--btn:#c6f432;--btn-fg:#0d1013;--bad:#f0928a;color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--ink);font:15px/1.55 "Inter",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{min-height:100vh;display:grid;place-items:center;padding:24px max(16px,env(safe-area-inset-left)) 32px}
.card{width:min(520px,100%);background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;box-shadow:0 1px 2px rgba(15,20,24,.04),0 12px 32px -12px rgba(15,20,24,.12)}
.brand{display:flex;align-items:center;gap:10px;font-size:.8rem;color:var(--muted);letter-spacing:.02em;margin-bottom:14px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px rgba(198,244,50,.25)}
h1{font-size:1.45rem;line-height:1.2;margin:0 0 6px;font-weight:650;letter-spacing:-.01em;text-wrap:balance}
p.intro{color:var(--muted);margin:0 0 20px}`;

export function renderForm(form, clients, consentTexts) {
  const lang = form.language || 'en', dir = RTL.has(lang) ? 'rtl' : 'ltr';
  const field = f => {
    const id = `f_${f.key}`, req = f.required ? 'required' : '', label = `<label for="${id}">${esc(f.label)}${f.required ? '' : ' <span class="opt">optional</span>'}</label>`;
    if (f.type === 'select') return `<div class="fld">${label}<select id="${id}" name="${esc(f.key)}" ${req}><option value="">Choose…</option>${(f.options || []).map(o => `<option>${esc(o)}</option>`).join('')}</select></div>`;
    if (f.type === 'textarea') return `<div class="fld full">${label}<textarea id="${id}" name="${esc(f.key)}" rows="3" ${req}></textarea></div>`;
    const auto = { name: 'name', email: 'email', phone: 'tel', city: 'address-level2' }[f.key] || 'off';
    return `<div class="fld${f.key === 'name' || f.type === 'email' ? ' full' : ''}">${label}<input id="${id}" name="${esc(f.key)}" type="${esc(f.type || 'text')}" autocomplete="${auto}" ${req}></div>`;
  };
  const visible = (form.fields || []).filter(f => !String(f.key).startsWith('_'));
  return `<!doctype html><html lang="${esc(lang)}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(form.title)}</title><meta name="robots" content="noindex">
<style>${BASE_CSS}
form{display:grid;grid-template-columns:1fr 1fr;gap:14px 12px}.fld{display:grid;gap:6px;min-width:0}.full{grid-column:1/-1}
label{font-size:.8rem;font-weight:600;color:var(--ink)}.opt{font-weight:400;color:var(--muted)}
input,select,textarea{font:inherit;color:var(--ink);background:transparent;border:1px solid var(--line);border-radius:10px;padding:10px 12px;width:100%;transition:border-color .15s}
input:hover,select:hover,textarea:hover{border-color:#aeb8c0}
input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
fieldset{grid-column:1/-1;border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:2px 0 0;display:grid;gap:10px}
legend{font-size:.78rem;font-weight:600;color:var(--muted);padding:0 6px}
.chk{display:grid;grid-template-columns:20px 1fr;gap:10px;align-items:start;font-size:.86rem;color:var(--ink)}.chk input{width:18px;height:18px;margin:2px 0 0;accent-color:var(--btn)}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
button{grid-column:1/-1;font:inherit;font-weight:650;background:var(--btn);color:var(--btn-fg);border:0;border-radius:10px;padding:12px 16px;cursor:pointer;transition:transform .1s}
button:active{transform:translateY(1px)}button:disabled{opacity:.6;cursor:default}
.note{grid-column:1/-1;font-size:.76rem;color:var(--muted)}.err{grid-column:1/-1;color:var(--bad);font-size:.86rem;min-height:1em}
altcha-widget{grid-column:1/-1;--altcha-max-width:100%}
.done{display:none;text-align:center;padding:12px 0}.done h2{font-size:1.2rem;margin:0 0 6px}
.ver{display:none;gap:12px}.ver h2{font-size:1.2rem;margin:0}.ver .row{display:flex;gap:8px;flex-wrap:wrap}
.ver .ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}.ver button{grid-column:auto}
.code{font:600 1.4rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.35em;text-align:center;padding:12px}
.link{background:none;border:0;color:var(--muted);text-decoration:underline;padding:4px;font-size:.84rem;cursor:pointer}
@media (max-width:480px){form{grid-template-columns:1fr}.card{padding:22px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style><script type="module" src="/vendor/altcha.js"></script></head>
<body><main class="wrap"><section class="card">
<div class="brand"><span class="dot" aria-hidden="true"></span>${esc(clients[0]?.name || '')}</div>
<h1>${esc(form.title)}</h1>${form.intro ? `<p class="intro">${esc(form.intro)}</p>` : ''}
<form id="lf" novalidate>
${visible.map(field).join('\n')}
<input type="hidden" name="country" value="${esc(form.country || '')}">
<div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
<fieldset><legend>Stay in touch (optional)</legend>
${Object.entries(consentTexts).map(([ch, text]) => `<label class="chk"><input type="checkbox" name="consent_${esc(ch)}" value="1"><span>${esc(text)}</span></label>`).join('\n')}
</fieldset>
<label class="chk full"><input type="checkbox" name="agree_terms" value="1" required><span>I have read how my details are used: ${esc(clients[0]?.name || 'the business')} receives my request and contacts me about it. MXAi processes the data on its behalf.</span></label>
<altcha-widget challenge="/api/altcha" name="altcha"></altcha-widget>
<p class="err" id="err" role="alert"></p>
<button type="submit" id="send">Send</button>
<p class="note">You can unsubscribe at any time with the link in every message or by replying STOP.</p>
</form>
<div class="ver" id="ver" role="group" aria-labelledby="verH">
<h2 id="verH">Confirm your number</h2>
<p class="intro" id="verText" style="margin:0">We can send a 6-digit code to your number ending in <b id="verEnd"></b>. It takes a few seconds.</p>
<div class="row" id="verSend"><button type="button" data-ch="whatsapp">Send code by WhatsApp</button><button type="button" class="ghost" data-ch="sms">Send by text message</button></div>
<div id="verEnter" style="display:none;gap:10px"><label for="code">Code</label><input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}">
<button type="button" id="verCheck">Confirm</button></div>
<p class="err" id="verErr" role="alert"></p>
<button type="button" class="link" id="verSkip">Skip for now</button>
</div>
<div class="done" id="done" role="status"><h2>Thank you</h2><p class="intro" id="doneText">We received your request and will be in touch soon.</p></div>
</section></main>
<script>
(function(){
  var f=document.getElementById('lf'),err=document.getElementById('err'),btn=document.getElementById('send');
  var qs=new URLSearchParams(location.search);['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','ttclid'].forEach(function(k){if(qs.get(k)){var i=document.createElement('input');i.type='hidden';i.name=k;i.value=qs.get(k);f.appendChild(i);}});
  f.addEventListener('submit',async function(e){e.preventDefault();err.textContent='';
    var d=Object.fromEntries(new FormData(f).entries());
    if(!d.name){err.textContent='Please enter your name.';return}
    if(!d.email&&!d.phone){err.textContent='Please enter an email or a mobile number.';return}
    if(!d.agree_terms){err.textContent='Please tick the box about how your details are used.';return}
    btn.disabled=true;
    try{var r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});var j=await r.json().catch(function(){return{}});
      if(!r.ok)throw new Error(j.error||'Something went wrong.');
      f.style.display='none';
      var finish=function(t){document.getElementById('ver').style.display='none';document.getElementById('done').style.display='block';
        if(j.confirm)document.getElementById('doneText').textContent='Please check your email and click the link to confirm.';
        if(t)document.getElementById('doneText').textContent=t+(j.confirm?' Please also check your email and click the link to confirm.':'');};
      if(!j.verify){finish();return}
      var v=document.getElementById('ver'),ve=document.getElementById('verErr'),code=document.getElementById('code');
      document.getElementById('verEnd').textContent=j.verify.ending;v.style.display='grid';
      var post=async function(u,b){var r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({t:j.verify.token},b))});var o=await r.json().catch(function(){return{}});if(!r.ok)throw new Error(o.error||'Something went wrong.');return o};
      document.querySelectorAll('#verSend button').forEach(function(b){b.onclick=async function(){ve.textContent='';b.disabled=true;
        try{var o=await post('/v/send',{channel:b.dataset.ch});if(o.already){finish('Your number is already confirmed.');return}
          document.getElementById('verSend').style.display='none';document.getElementById('verEnter').style.display='grid';
          document.getElementById('verText').textContent='We sent a code by '+(o.channel==='sms'?'text message':'WhatsApp')+'. Type it below.';code.focus();
        }catch(x){ve.textContent=x.message;b.disabled=false}}});
      var check=async function(){ve.textContent='';try{await post('/v/check',{code:code.value});finish('Thank you, your number is confirmed. We will be in touch soon.')}catch(x){ve.textContent=x.message}};
      document.getElementById('verCheck').onclick=check;code.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();check()}});
      document.getElementById('verSkip').onclick=function(){finish()};
    }catch(x){err.textContent=x.message;btn.disabled=false}
  });
})();
</script></body></html>`;
}

export function renderMessage(title, text, postUrl = null) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="robots" content="noindex">
<style>${BASE_CSS}.card{text-align:center}button{font:inherit;font-weight:650;background:var(--btn);color:var(--btn-fg);border:0;border-radius:10px;padding:11px 18px;cursor:pointer;margin-top:12px}button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}</style></head>
<body><main class="wrap"><section class="card"><h1>${esc(title)}</h1><p class="intro">${esc(text)}</p>${postUrl ? `<form method="post" action="${esc(postUrl)}"><button type="submit">Unsubscribe</button></form>` : ''}</section></main></body></html>`;
}
