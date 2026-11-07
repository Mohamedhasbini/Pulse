// Website language switch: English, Spanish, Arabic (right to left). The page is written in English; this swaps the
// texts a visitor reads first (menu, hero, home section headings, buttons, sign-up form). Chosen by ?lang=, then the
// visitor's last choice, then the browser's language. The English text is kept so switching back is exact.
(() => {
  const T = {
    es: {
      nav: { '/pulse': 'Inicio', '/product': 'Producto', '/templates': 'Plantillas', '/how-it-works': 'Cómo funciona', '/pricing': 'Precios', '/login': 'Entrar' },
      signup: 'Empieza gratis', demo: 'Reserva una demo de 30 min',
      pill: 'Tu recepcionista con IA en WhatsApp',
      h1: 'No pierdas nunca una cita por un <em>mensaje</em> sin responder.',
      lead: 'MXAi responde tu WhatsApp en segundos, de día y de noche, en árabe, inglés o español. Reserva a tus clientes en tu agenda y les recuerda la cita para que vengan.',
      small: 'Listo en un día · Desde 29 $ al mes · Cancela cuando quieras',
      example: 'Ejemplo',
      sec: {
        problem: ['El problema', 'Cada mensaje sin responder es una cita perdida.', 'Los clientes reservan con quien responde primero. Si nadie contesta, no esperan: escriben al siguiente salón.'],
        see: ['Míralo en acción', '23:14. Has cerrado. MXAi reserva al cliente.', 'Una conversación de ejemplo, como la tienen tus clientes: en el WhatsApp que ya usan.'],
        does: ['Qué hace', 'Cuatro tareas, hechas cada día sin ti.', 'Tu recepcionista con IA trabaja con tus propios servicios, precios, horarios y reglas.'],
        tools: ['Todo incluido', 'Un panel. Todas las herramientas de tu negocio.', 'Cada plantilla se construye con las mismas piezas. Aquí están, tal como se ven.'],
        industries: ['Para quién es', 'Hecho para negocios que viven de las citas.', 'Tus servicios, precios, horarios y equipo, listos en un día. La IA habla con tus clientes como lo harías tú.'],
        pricing: ['Precios', 'Planes mensuales sencillos.', 'Cuestan menos que una cita recuperada a la semana. Tus clientes nunca pagan nada.'],
        faq: ['Preguntas', 'Bueno saberlo'],
        start: ['Empieza', 'Pon en marcha tu centro de mando.', 'Déjanos unos datos. Nuestro equipo configura contigo tu panel y tu recepcionista con IA, normalmente en un día laborable.'],
      },
      form: { name: 'Tu nombre', business: 'Nombre del negocio', business_type: 'Tipo de negocio', country: 'País', phone: 'Número de WhatsApp', email: 'Correo electrónico', message: '¿Algo que debamos saber? (opcional)' },
    },
    ar: {
      nav: { '/pulse': 'الرئيسية', '/product': 'المنتج', '/templates': 'القوالب', '/how-it-works': 'كيف يعمل', '/pricing': 'الأسعار', '/login': 'تسجيل الدخول' },
      signup: 'ابدأ مجاناً', demo: 'احجز عرضاً لمدة 30 دقيقة',
      pill: 'موظف استقبال ذكي على واتساب',
      h1: 'لا تخسر أي حجز بسبب <em>رسالة</em> لم يُرد عليها.',
      lead: 'يرد MXAi على واتساب خلال ثوانٍ، ليلاً ونهاراً، بالعربية أو الإنجليزية أو الإسبانية. يحجز لعملائك في جدولك ويذكّرهم بالموعد كي يحضروا.',
      small: 'جاهز خلال يوم · من 29$ شهرياً · ألغِ متى شئت',
      example: 'مثال',
      sec: {
        problem: ['المشكلة', 'كل رسالة بلا رد هي حجز ضائع.', 'يحجز العملاء مع من يرد أولاً. إذا لم يرد أحد، لا ينتظرون، بل يراسلون الصالون التالي.'],
        see: ['شاهده يعمل', '23:14. أغلقت محلك. MXAi يحجز للعميل.', 'محادثة مثال، كما يجريها عملاؤك: على واتساب الذي يستخدمونه أصلاً.'],
        does: ['ماذا يفعل', 'أربع مهام تُنجز كل يوم من دونك.', 'يعمل موظف الاستقبال الذكي بخدماتك وأسعارك ومواعيدك وقواعدك.'],
        tools: ['كل ما بداخله', 'لوحة واحدة. كل أدوات عملك.', 'كل قالب مبني من الأجزاء نفسها. ها هي كما تبدو تماماً.'],
        industries: ['لمن هو', 'مصمم للأعمال القائمة على الحجوزات.', 'خدماتك وأسعارك ومواعيدك وفريقك، جاهزة خلال يوم. يتحدث الذكاء الاصطناعي مع عملائك كما تفعل أنت.'],
        pricing: ['الأسعار', 'خطط شهرية بسيطة.', 'سعرها أقل من قيمة حجز واحد مستعاد في الأسبوع. عملاؤك لا يدفعون شيئاً.'],
        faq: ['أسئلة', 'معلومات مفيدة'],
        start: ['ابدأ', 'شغّل مركز التحكم الخاص بك.', 'شاركنا بعض التفاصيل. يجهّز فريقنا معك لوحة التحكم وموظف الاستقبال الذكي، عادة خلال يوم عمل واحد.'],
      },
      form: { name: 'اسمك', business: 'اسم النشاط', business_type: 'نوع النشاط', country: 'البلد', phone: 'رقم واتساب', email: 'البريد الإلكتروني', message: 'هل هناك ما يجب أن نعرفه؟ (اختياري)' },
    },
  };
  const LANGS = ['en', 'es', 'ar'], orig = new Map();
  const keep = (el, html) => { if (!orig.has(el)) orig.set(el, el.innerHTML); el.innerHTML = html; };
  const labelText = el => [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
  const keepLabel = (el, text) => { const n = labelText(el); if (!n) return; if (!orig.has(n)) orig.set(n, n.textContent); n.textContent = text; };
  function apply(lang) {
    for (const [el, v] of orig) el.nodeType === 3 ? (el.textContent = v) : (el.innerHTML = v); // back to English first
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    const t = T[lang]; if (!t) return;
    document.querySelectorAll('header nav a, .mn-sheet a, header a.signin').forEach(a => { const k = new URL(a.href, location.href).pathname; if (t.nav[k]) keep(a, t.nav[k]); });
    document.querySelectorAll('[data-kind="signup"],.seg [data-k="signup"]').forEach(a => keep(a, t.signup));
    document.querySelectorAll('[data-kind="demo"],.seg [data-k="demo"]').forEach(a => keep(a, (a.querySelector('.pl') ? '<span class="pl"></span>' : '') + t.demo));
    const h = document.querySelector('.hero');
    if (h) { const p = h.querySelector('.pill'); if (p) keep(p, `<b>24/7</b>${t.pill}`); const h1 = h.querySelector('h1'); if (h1) keep(h1, t.h1);
      const l = h.querySelector('.lead'); if (l) keep(l, t.lead); const s = h.querySelector('.wrap > small'); if (s) keep(s, t.small); }
    document.querySelectorAll('.ex-tag').forEach(x => keep(x, t.example));
    for (const [id, [k, h2, p]] of Object.entries(t.sec)) {
      const sh = document.querySelector(`#${id} .sh`); if (!sh) continue;
      const a = sh.querySelector('.k'), b = sh.querySelector('h2'), c = sh.querySelector('p');
      if (a) keep(a, k); if (b) keep(b, h2); if (c && p) keep(c, p);
    }
    for (const [name, text] of Object.entries(t.form)) { const f = document.querySelector(`#lead [name="${name}"]`); const l = f?.closest('label'); if (l) keepLabel(l, text); }
  }
  function pick() {
    const q = new URLSearchParams(location.search).get('lang');
    let saved = null; try { saved = localStorage.getItem('mx-lang'); } catch {}
    const nav = (navigator.language || 'en').slice(0, 2);
    return LANGS.includes(q) ? q : LANGS.includes(saved) ? saved : LANGS.includes(nav) ? nav : 'en';
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (!b) return;
    try { localStorage.setItem('mx-lang', b.dataset.lang); } catch {} apply(b.dataset.lang); });
  // the phone number hint follows the chosen country
  document.addEventListener('change', e => { if (e.target.name !== 'country') return; const ph = document.querySelector('#lead [name="phone"]');
    if (ph) ph.placeholder = e.target.value === 'Spain' ? '+34 …' : e.target.value === 'Lebanon' ? '+961 …' : '+…'; });
  const go = () => apply(pick());
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', go) : go();
})();
