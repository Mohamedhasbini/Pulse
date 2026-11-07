// Layer 06: guardrails. Checks every message going into the AI and every reply coming out of it.
//
// Why this exists: the AI is told the rules in the prompt, but a prompt is a request, not a guarantee. A customer can
// try to talk it out of its rules ("ignore previous instructions"), an owner's taught answer can carry an instruction,
// and models sometimes invent a price, name a rival salon or say "I'm ChatGPT". These checks run after the model and
// before anything is sent, with no AI call: plain, fast, deterministic pattern checks that the integrator can trust.
//
// checkInput  -> cleans the text and raises flags (information for the orchestrator; the text is never executed).
// checkOutput -> pass, rewrite (harmless clean-up) or handoff (send the safe line instead and let a person answer).
// No imports on purpose: this file must load in a plain `node` test without the database.

// The safe line sent instead of a risky reply. It promises nothing except that a person will look.
export const HANDOFF_TEXT = {
  en: "Thanks for your message! I'll check with the team and get back to you here shortly.",
  ar: 'شكراً لرسالتك! سأتحقق من الفريق وأعود إليك هنا قريباً.',
  es: '¡Gracias por tu mensaje! Lo consulto con el equipo y te respondo por aquí en breve.',
  fr: "Merci pour votre message ! Je vérifie avec l'équipe et je reviens vers vous ici très vite.",
};
// What the owner-facing assistant says about itself when the model claimed to be a vendor's product.
const OWNER_IDENTITY = {
  en: "I'm MXAi, your business assistant.",
  ar: 'أنا MXAi، مساعد عملك.',
  es: 'Soy MXAi, el asistente de tu negocio.',
  fr: "Je suis MXAi, l'assistant de votre entreprise.",
};

export const LIMITS = { input: 2000, customerReply: 1200, ownerReply: 4000 };

// ---------- text helpers ----------

const AR = /[؀-ۿ]/;
// Same rule as brain.js langOf (copied so this file has no database import).
export function langOf(text) {
  const t = String(text || '');
  if (AR.test(t)) return 'ar';
  if (/[ñ¿¡]|\b(hola|gracias|cita|quiero|quisiera|por favor|mañana|buenas|reservar|cuánto|cuesta|vale|tienes|puedes|precio)\b/i.test(t)) return 'es';
  if (/\b(bonjour|bonsoir|merci|rendez-vous|je voudrais|s'il vous pla[iî]t|demain|réserver|combien)\b|[çœ]/i.test(t)) return 'fr';
  return 'en';
}

// Control characters (except newline and tab) and invisible characters people use to hide instructions or split
// words so a filter misses them ("ig​nore"). Bidi overrides can make text display differently than it reads.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;

// Folded form used only for matching: lower case, no accents, Arabic letter variants unified, Arabic-Indic digits
// turned into 0-9, fullwidth letters turned into normal ones (NFKC). Never shown to anyone.
export function fold(text) {
  return String(text || '').normalize('NFKC').replace(INVISIBLE, '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')            // á -> a, ç -> c
    .replace(/[ً-ٰٟـ]/g, '')                 // Arabic short vowels and tatweel
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word match that also works for Arabic (\b does not see Arabic letters as word characters).
const wordRe = (phrase) => new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(phrase)}(?=$|[^\\p{L}\\p{N}])`, 'u');
const digits = s => String(s || '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, '');

// ---------- input ----------

// Attempts to change the assistant's rules. Written in folded form (no accents, unified Arabic letters).
const INJECTION = [
  // English
  /\b(ignore|disregard|forget|skip|override|bypass)\b.{0,30}\b(previous|prior|above|earlier|all|your|the|these|those|any)\b.{0,20}\b(instructions?|rules?|prompts?|guidelines|directions|restrictions|programming)\b/,
  /\byou are now\b|\bfrom now on,? you\b|\byou'?re now (a|an|my|the)\b|\bnew (instructions|rules|persona)\s*:/,
  /\b(act|behave|respond) as (a|an|my|if|though|the|dan)\b|\bpretend (to be|you are|you'?re)\b|\brole-?play as\b/,
  /\bsystem ?prompt\b|\bdeveloper mode\b|\bdan mode\b|\bjail ?break/,
  /\b(reveal|show|print|repeat|tell me|give me|output|display|share|leak)\b.{0,25}\b(your|the|system|hidden|initial|original|secret)\b.{0,15}\b(instructions?|prompts?|rules|configuration|guidelines)\b/,
  /\bwhat (are|were) your (instructions|rules|guidelines)\b/,
  /<\|?(im_start|system|endoftext)\|?>|\[(system|inst|admin)\]|#{2,}\s*(system|instruction)/,
  // Spanish
  /\b(ignora|ignore|olvida|olvide|omite|salta)\b.{0,30}\b(instrucciones|reglas|indicaciones|normas)\b/,
  /\b(ahora eres|a partir de ahora (eres|seras|vas a)|desde ahora eres)\b|\b(actua|actue|comportate) como\b|\bfinge (ser|que eres)\b|\bhaz de cuenta\b/,
  /\bmodo (desarrollador|dios|sin restricciones)\b|\b(prompt|instrucciones) (del|de) sistema\b/,
  /\b(revela|muestra|dime|ensename|repite|copia)\b.{0,20}\b(tus|las|el|tu)\b.{0,10}\b(instrucciones|reglas|prompt)\b/,
  // French
  /\b(ignore|ignorez|oublie|oubliez)\b.{0,30}\b(instructions|regles|consignes)\b/,
  /\b(tu es|vous etes) (maintenant|desormais)\b|\b(agis|agissez|fais comme si|faites comme si|fais semblant|faites semblant)\b/,
  /\bmode (developpeur|sans restriction)\b|\bprompt (du )?systeme\b|\b(revele|montre|donne|repete)[sz]?\b.{0,20}\b(tes|vos|les)\b.{0,10}\b(instructions|consignes|regles)\b/,
  // Arabic (folded: ا for أ/إ/آ, ي for ى, ه for ة)
  /(تجاهل|تجاهلي|انس|انسي|اهمل|اهملي|الغ)\s.{0,25}(التعليمات|تعليماتك|الاوامر|اوامرك|القواعد|قواعدك|التوجيهات)/,
  /(انت الان|انتي الان|انت هلق|من الان (انت|انتي|فصاعدا)|من هلق انت)/,
  /(تصرف|تصرفي|تظاهر|تظاهري|مثل دور|العب دور)\s?(ك|بانك|انك|مثل|دور)/,
  /(وضع المطور|موجه النظام|تعليمات النظام|برومبت|جيلبريك|كسر الحمايه)/,
  /(اكشف|اظهر|اعرض|اعطني|قلي|قل لي|اكتب)\s.{0,15}(تعليماتك|التعليمات|البرومبت|قواعدك|اوامرك)/,
];

// A customer asking for the business's private data. The AI never sees it, but the orchestrator can answer firmly.
const INTERNAL = [
  /\bhow much (money )?(did|do|does|have) (you|the (salon|shop|clinic|business|owner)|they|she|he) (earn|make|made|take|bring)/,
  /\b(your|the (salon'?s|shop'?s|clinic'?s|business'?s|owner'?s))\s+(revenue|income|earnings|turnover|profit|sales|takings|numbers|stats|figures)\b/,
  /\b(revenue|turnover|profits?|earnings)\b.{0,20}\b(this|last|per|a) (week|month|year|day)\b/,
  /\bhow many (customers|clients|bookings|appointments|people|patients|reservations|visits)\b/,
  /\b(other|another|previous|all (the|your)) (customers?|clients?|patients?|people'?s?)\b.{0,30}\b(names?|numbers?|phones?|details|list|bookings?|booked|data|info)/,
  /\b(customer|client|patient) (list|database|data|names|numbers)\b/,
  /\bwho (else|other)\b.{0,20}\b(booked|is booked|is coming|comes|has (an )?appointment|visited)\b/,
  /\bwho (booked|is coming|has (an )?appointment)\b.{0,15}\b(today|tomorrow|this week|before me|after me)\b/,
  /\b(staff|internal|private) notes?\b/,
  /\b(?!your\b|the\b|salon|shop|clinic|business|my\b|that\b|what\b|it\b|here\b|there\b|who\b|let\b|where\b)[a-z]{3,}'s (phone )?(number|phone|address|email)\b/,
  /\b(phone number|contact|mobile|whatsapp|number) of (?!the\b|your\b|this\b|you\b|people\b|sessions?\b|times?\b|days?\b|minutes\b|hours\b|guests\b)[a-z]{3,}/,
  // Spanish
  /\bcuanto (dinero )?(ganas|ganan|ganaste|ganaron|facturas|facturan|facturaste|ingresas|ingresan|sacas|sacan)\b/,
  /\b(ingresos|facturacion|ganancias|beneficios)\b/,
  /\bcuant[oa]s (clientes|clientas|reservas|citas|pacientes)\b/,
  /\botr[oa]s (clientes|clientas|pacientes)\b/,
  /\bquien mas\b.{0,20}\b(reservo|tiene cita|viene|ha reservado)\b/,
  /\b(numero|telefono|movil) de (?!la\b|el\b|tu\b|su\b|vosotros|ustedes|telefono|contacto|whatsapp|reserva|cita|personas)[a-z]{3,}/,
  /\bnotas (internas|del personal)\b/,
  // French
  /\bcombien (gagnez|gagnes|avez-vous gagne|as-tu gagne|de clients|de rendez-vous|de reservations)\b/,
  /\bchiffre d'affaires\b|\bautres clients\b|\bqui d'autre\b/,
  // Arabic (folded)
  /كم (ربحت|ربحتو|ربحتم|بتربح|بتربحو|دخلت|دخلكم|مدخولكم|بتطلعو|طلعت)/,
  /(ايرادات|ايراداتكم|ارباح|ارباحكم|مدخول|المبيعات)/,
  /كم (زبون|زبونه|زبونة|زباين|زبائن|عميل|عملاء|حجز|حجوزات|موعد|مواعيد)/,
  /(زباين|زبائن|عملاء|زبونات)\s?(تانيين|تانيه|اخرين|اخري|غيري)/,
  /(مين|من) (كمان|غيري|ايضا)\s.{0,15}(حجز|حاجز|جاي|عنده موعد)/,
  // "رقم رانيا" (Rania's number), not "رقم تلفونكم" (your number) or "رقم حجزي" (my booking number)
  /رقم (تلفون |هاتف |موبايل |واتساب )?(?!تلفون|هاتف|موبايل|واتساب|ال|حجز|موعد)[ء-ي]{3,}(?<!كم|ك|كن|كي|ي)(?=$|[\s?؟.,])/,
  /ملاحظات (الموظفين|داخليه|الستاف)/,
];

const ABUSE_WORDS = [
  'stupid', 'idiot', 'moron', 'dumb', 'fuck', 'fucking', 'shit', 'bitch', 'asshole', 'bastard', 'retard', 'whore', 'cunt',
  'idiota', 'estupido', 'estupida', 'imbecil', 'mierda', 'puta', 'gilipollas', 'cabron', 'joder', 'pendejo', 'tonto',
  'connard', 'connasse', 'putain', 'merde', 'salope', 'encule', 'debile',
  'غبي', 'غبيه', 'حمار', 'حماره', 'حيوان', 'تافه', 'كلب', 'شرموط', 'شرموطه', 'منيوك', 'عرص', 'يلعن', 'زباله', 'كس',
];
const ABUSE_RE = new RegExp(`(^|[^\\p{L}])(${ABUSE_WORDS.map(escRe).join('|')})(?=$|[^\\p{L}])`, 'u');
const THREAT_RE = /\b(i('ll| will)|gonna) (kill|hurt|burn|destroy|sue)\b|\bte voy a (matar|denunciar)\b|(رح|سوف) (اقتلك|اذبحك)/;

export function checkInput({ text, audience = 'customer' } = {}) {
  let clean = String(text ?? '').replace(INVISIBLE, '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n');
  const flags = [];
  if (clean.length > LIMITS.input) { clean = clean.slice(0, LIMITS.input); flags.push('too_long'); }
  clean = clean.trim();
  const f = fold(clean);
  // also check with spaces/dots removed between letters ("i g n o r e") for the shortest tricks
  const squeezed = f.replace(/(?<=\p{L})[\s.\-_*]+(?=\p{L}(\s|[.\-_*]|$))/gu, '');
  if (INJECTION.some(re => re.test(f) || re.test(squeezed))) flags.push('injection');
  // the owner and staff may of course ask for their own numbers; only customers are flagged
  if (audience === 'customer' && INTERNAL.some(re => re.test(f))) flags.push('internal_request');
  if (ABUSE_RE.test(f) || THREAT_RE.test(f)) flags.push('abuse');
  return { text: clean, flags };
}

// ---------- output ----------

// The model naming itself as a vendor's product. "Google" alone is common (Google Maps), so it needs the phrasing.
const VENDOR = '(chat ?gpt|gpt-?\\d[\\w.-]*|openai|open ai|gemini|bard|google|claude|anthropic|llama|meta ai|mistral|deepseek|copilot|grok|a large language model|an? llm|a language model)';
// "I am X" needs the name right after it: "I'm sending the Google Maps link" and "I'm booking Claude" are fine.
const VENDOR_SELF = '(chat ?gpt|gpt-?\\d[\\w.-]*|openai|open ai|gemini|google gemini|google bard|bard|claude|anthropic|llama|meta ai|mistral|deepseek|copilot|grok|a large language model|an? llm|a language model)';
const IDENTITY = [
  new RegExp(`\\b(i am|i'm|im|i was)\\s+(just |actually |really |simply )?(a |an |the )?((ai |language )?(model|assistant|bot|chatbot) )?((made|built|created|developed|trained|powered|run) )?((by|from|on) )?${VENDOR_SELF}`),
  new RegExp(`\\b(made|built|created|developed|trained|designed) by\\s+(the )?(team at |company )?${VENDOR}`),
  new RegExp(`\\b(based on|built on|running on|powered by)\\s+(the )?${VENDOR}`),
  new RegExp(`\\b(soy|estoy (basado|basada) en)\\s+(un |una |el )?(modelo |asistente )?(de )?${VENDOR_SELF}`),
  new RegExp(`\\b((fui )?(creado|creada|desarrollado|desarrollada|entrenado|entrenada) por|basado en|funciono con)\\s+(el equipo de )?${VENDOR}`),
  new RegExp(`\\bje suis\\s+(un |une )?(modele |assistant )?(de )?${VENDOR_SELF}|\\b(cree|developpe|entraine) par\\s+${VENDOR}|\\bbase sur\\s+${VENDOR}`),
  /(انا|انني|اني)\s(نموذج |مساعد )?(شات ?جي ?بي ?تي|chat ?gpt|اوبن ?اي ?اي|openai|جيميني|gemini|كلود|claude)/,
  /(تم تطويري|من تطوير|مبني علي|طورتني|صنعتني|من صنع|دربتني)\s?(شركه |من )?(شات ?جي ?بي ?تي|chat ?gpt|اوبن ?اي ?اي|openai|جيميني|gemini|جوجل|غوغل|google|كلود|claude|انثروبيك|anthropic)/,
  // the vendor names that are never a customer's or business's name: any mention at all
  /\b(chat ?gpt|openai|gpt-?[345]|anthropic)\b|شات ?جي ?بي ?تي|اوبن ?اي ?اي|انثروبيك/,
];

// Words from the system prompt and the decision format: if they show up, the model is reciting its instructions.
const PROMPT_MARKERS = [
  /\bcontext\.(business|customer|availability|now|conversation|quick_slots)/, /\bquick_slots\b|\bnext_open_days\b|\bunknown_question\b|\bmissing_for_booking\b/,
  /owner'?s strict rules|fast booking flow|tap-to-answer|\bmy (system )?(prompt|instructions) (say|tell|are)\b|\bsystem prompt\b/,
  /"(action|reply|why|tool|confidence)"\s*:/, /\bstaff[ _]notes?\b|\binternal notes?\b|\bnotas internas\b|ملاحظات (الموظفين|داخليه)/,
  /\b(i was|i'm|i am) (told|instructed|programmed) (to|not to)\b/,
];

// Money and counts that only the owner should see.
const LEAK = [
  // (free times are fine: "we have 3 appointments available tomorrow"; the customer's own: "you have 2 bookings")
  /\b(revenue|turnover|takings|income|earnings|profit)\b.{0,40}(\d|\$|€)/, /(\d|\$|€).{0,20}\b(in revenue|of revenue|in sales|in takings)\b/,
  /\bwe (made|earned|took in|brought in)\b.{0,20}(\d|\$|€)/,
  /\b(we have|we had|we've had|there (are|were)|we got|in total|a total of)\s+\d+\s+(clients|customers|bookings|appointments|reservations|patients|visits|people booked)\b(?!\s*(available|free|left|open|still|slots?))/,
  /(?<!(you have|you've got|you had|your) )\b\d+\s+(clients|customers|bookings|appointments|reservations|patients|visits)\b(?!\s*(available|free|left|open|still))[^.!?]{0,10}\b(today|this week|this month|so far|in total|last (week|month)|yesterday)\b/,
  /\b(ingresos|facturacion|ganancias|facturamos|ganamos)\b.{0,30}\d/,
  /\b(tenemos|hay|hubo|tuvimos)\s+\d+\s+(clientes|clientas|reservas|citas|pacientes)\b(?!\s*(disponibles|libres|abiertas))/,
  /(?<!(tienes|tiene) )\b\d+\s+(clientes|reservas|citas)\b(?!\s*(disponibles|libres))[^.!?]{0,10}\b(hoy|esta semana|este mes|en total)\b/,
  /\bchiffre d'affaires\b.{0,30}\d|\bnous avons (eu )?\d+\s+(clients|reservations|rendez-vous)\b(?!\s*(disponibles|libres))/,
  /(ايرادات|الايرادات|ارباح|الارباح|مدخول|ربحنا|دخلنا).{0,30}\d/, /(لدينا|عندنا|كان عندنا|اجانا|اجا)\s+\d+\s+(زبون|زباين|زبائن|عميل|عملاء|حجز|حجوزات)/,
];

// Pointing the customer somewhere else: another business, a booking app, "just Google it".
const ELSEWHERE = [
  /\b(try|visit|go to|check out|recommend|suggest|head to|look for|consider)\b[^.?!]{0,20}(?<!our )\b(another|a different|other|some other|a nearby|nearby|a cheaper|cheaper)\b[^.?!,]{0,12}\b(salon|place|shop|clinic|barber|barbershop|spa|gym|restaurant|business|garage|dentist|doctor|studio|provider|centre|center)s?\b/,
  /(?<!our )\b(another|other|a different|a cheaper)\s+(salon|clinic|barber|spa|gym|restaurant|garage|dentist)s?\b.{0,30}\b(might|may|could|would|can|will)\b/,
  /\b(fresha|booksy|treatwell|vagaro|planity|styleseat|setmore|calendly|groupon|mindbody|zocdoc|doctolib|opentable|thefork|eltenedor|el tenedor|ubereats|uber eats|deliveroo|glovo|toters|talabat|yelp|tripadvisor|classpass|square appointments)\b/,
  /\b(search|look|check|find)\b.{0,15}\b(on|in|using)\s+(google|google maps|instagram|facebook|tiktok)\b|\bgoogle (it|for)\b/,
  // Spanish
  /\b(prueba|pruebe|ve a|vaya a|te recomiendo|le recomiendo|recomiendo|busca|busque|mira)\b.{0,20}\b(otr[oa]s?|algun[oa]? otr[oa])\b.{0,10}\b(salon|peluqueria|sitio|lugar|clinica|barberia|centro|negocio|spa|gimnasio|restaurante|taller)/,
  /\b(busca|busque|buscalo|mira)\b.{0,10}\ben (google|instagram)\b/,
  // French
  /\b(essayez|essaie|allez|va|je vous recommande|je recommande|cherchez)\b.{0,20}\b(un autre|une autre|d'autres)\b.{0,10}\b(salon|endroit|clinique|barbier|institut|lieu|commerce)/,
  // Arabic (folded)
  /(صالون|محل|مكان|عياده|مركز|نادي|مطعم|كراج)\s(تاني|ثاني|اخر|غير)/,
  /(روح|روحي|اذهب|اذهبي|انصحك|بنصحك|بنصحكي|جرب|جربي)\s.{0,20}غيرنا|عند غيرنا|غير مكان/,
  /(دور|دوري|ابحث|ابحثي)\s.{0,10}(علي|ب)\s?(جوجل|غوغل|google)/,
];

// Promising money off without a code the owner made.
const DISCOUNT_PROMISE = [
  /\b(i|we)\s*('ll|will|can|could|'d|would)\s+(happily\s+)?(give|offer|get|do|make)\s+(you|it)\b.{0,20}(\b(discount|deal|cheaper|for free|free of charge)|\d\s?% off)/,
  /\b(special|exclusive) (discount|price|offer|deal) (for you|just for you)\b|\bfor you,? (only|just) (\$|€)?\d/,
  /\b(te|le|os) (puedo|podemos|hago|hacemos|dejo|doy|damos)( (hacer|dar|ofrecer|dejar|aplicar|regalar))? (un |una |el )?(descuento|rebaja|precio especial|oferta)/,
  /\bje (peux|vais) vous (faire|offrir|accorder) (une )?(remise|reduction|promo)/,
  /(بعطيكي|بعطيك|بعملك|بعملكي|منعطيكي|منعطيك|نعطيك|اعطيك|بقدر اعطيك|نقدر نعطيك).{0,15}(خصم|حسم|تخفيض|سعر خاص)/,
];
const DISCOUNT_WORD = /(off|discount|descuento|rebaja|remise|reduction|promo|خصم|حسم|تخفيض)/;

// Prices: a number next to a currency sign or word. Times ("10:30") and counts ("3 times") have no currency.
const CUR = '(\\$|€|£|usd|eur|euros?|dollars?|dolares|bucks|lbp|l\\.l\\.?|lira|liras|ليره|ل\\.ل|دولار|دولارات|يورو)';
const PRICE_RE = new RegExp(`${CUR}\\s?(\\d[\\d.,]*\\d|\\d)(\\s?(k|m|الف)(?![a-z]))?|(\\d[\\d.,]*\\d|\\d)(\\s?(k|m|الف)(?![a-z]))?\\s?${CUR}`, 'giu');

function parseAmount(raw, mult) {
  let s = String(raw).replace(/\s/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');          // 500,000 or 500.000
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');               // 25,50 (Spanish)
  else s = s.replace(/,/g, '');
  let n = parseFloat(s);
  if (/^\s?(k|الف)$/i.test(mult || '')) n *= 1000;
  if (/^\s?m$/i.test(mult || '')) n *= 1e6;
  return n;
}
function pricesIn(segment) {
  const out = [];
  for (const m of segment.matchAll(PRICE_RE)) {
    const n = m[2] ? parseAmount(m[2], m[4]) : parseAmount(m[5], m[7]);
    if (Number.isFinite(n) && n > 0) out.push({ n, at: m.index, text: m[0] });
  }
  return out;
}
const same = (a, b) => Math.abs(a - b) < 0.011;

// Everything we know about this business, wherever the caller put it (flat facts or { public: ... }).
function factsOf(biz = {}, facts = {}) {
  const pub = facts.public || facts.business || {};
  const services = [...(biz.services || []), ...(facts.services || []), ...(pub.services || []), ...(Array.isArray(facts.catalog) ? facts.catalog : facts.catalog?.services || [])]
    .filter(s => s && s.name).map(s => ({ name: String(s.name), key: fold(s.name), price: Number(s.price) }));
  const cfg = biz.ai_config || {};
  const competitors = [...(facts.competitors || []), ...(cfg.competitors || [])];
  const others = (facts.otherBusinesses || []).map(b => typeof b === 'string' ? b : b?.name);
  const coupons = (facts.activeCoupons || []).map(c => typeof c === 'string' ? { code: c } : c).filter(c => c && c.code);
  const team = [...(facts.team || []), ...(pub.team || []), ...(Array.isArray(biz.team) ? biz.team : [])].map(t => typeof t === 'string' ? t : t?.name).filter(Boolean);
  return { services, competitors, others, coupons, team, pub, never: [...(cfg.never_say || []), ...(facts.never_say || [])] };
}

// The business's own links: website, maps, Instagram, payment link, its booking page and anything the caller adds.
function allowedLinks(biz = {}, facts = {}, pub = {}) {
  const list = [];
  const add = (u) => { const n = normUrl(u); if (n) list.push(n); };
  for (const u of [biz.website, biz.maps_url, biz.payment_link, pub.website, pub.maps_url, ...(facts.allowedLinks || [])]) add(u);
  for (const ig of [biz.instagram, pub.instagram]) {
    if (!ig) continue;
    if (/instagram\.com/i.test(ig)) add(ig);
    else add('instagram.com/' + String(ig).replace(/^@/, '').trim());
  }
  // the business's own WhatsApp chat link
  for (const p of [biz.phone, pub.phone]) { const d = digits(p); if (d.length >= 7) list.push('wa.me/' + d); }
  const site = process.env.PUBLIC_URL || 'https://app.nexfoyz.dev';
  return { list, publicHost: normUrl(site).split('/')[0], bizId: biz.id };
}
function normUrl(u) {
  if (!u) return '';
  return String(u).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[)\].,!?;:'"»]+$/, '').replace(/\/$/, '');
}
const TLD = '(com|net|org|io|app|me|ly|dev|es|lb|co|fr|uk|de|info|biz|site|online|shop|store|link|gl|gle|page|ai|tv|us|eu|xyz|cat|ar|ca|it|pt|ae|sa|to|sh|gg|bio|cc)';
const LINK_RE = new RegExp(`(?<![@\\w.])((?:https?:\\/\\/)?(?:[a-z0-9-]+\\.)+${TLD}(?![a-z0-9-])(?:[\\/?#][^\\s<>"'()\\]]*)?)`, 'gi');
function badLinks(reply, allow) {
  const bad = [];
  for (const m of reply.matchAll(LINK_RE)) {
    const u = normUrl(m[1]); const host = u.split(/[/?#]/)[0];
    if (!host) continue;
    if (host === allow.publicHost || host.endsWith('.' + allow.publicHost)) {
      // MXAi's own address: fine, unless it is another business's booking page
      const b = u.match(/[?&]b=(\d+)/);
      if (b && allow.bizId != null && +b[1] !== +allow.bizId) bad.push(m[1]);
      continue;
    }
    const ok = allow.list.some(a => {
      const ah = a.split(/[/?#]/)[0];
      if (/instagram\.com$/.test(ah) || /(^|\.)(goo\.gl|google\.[a-z.]+|maps\.app\.goo\.gl)$/.test(ah)) return u === a || u.startsWith(a + '/') || u.startsWith(a + '?') || u === a.replace(/\/$/, '');
      return host === ah || host.endsWith('.' + ah);   // the business's own website, any page
    });
    if (!ok) bad.push(m[1]);
  }
  return bad;
}

// A name from the list appears as a whole word (folded). Names too short or part of our own name are skipped.
function namesIn(f, names, ownName) {
  const own = fold(ownName || '');
  return names.map(n => fold(n || '')).filter(n => n.length >= 3 && !(own && (own === n || own.includes(n))))
    .filter((n, i, a) => a.indexOf(n) === i).filter(n => wordRe(n).test(f));
}

// Phones: any run of 8+ digits that is not this business's number or the customer's own.
function strangerPhones(reply, biz, facts, said = '') {
  const mine = new Set();
  const addP = p => { const d = digits(p); if (d.length >= 7) mine.add(d.slice(-8)); };
  for (const [k, v] of Object.entries(biz || {})) if (/phone|whatsapp|tel/i.test(k) && typeof v === 'string') addP(v);
  for (const p of [facts.customer?.phone, facts.customer?.contact_phone, facts.public?.phone, facts.phone, ...(facts.allowedPhones || [])]) addP(p);
  for (const m of String(said || '').matchAll(/\+?\d[\d\s().-]{6,}\d/g)) addP(m[0]);   // the customer's own number, typed just now
  const out = [];
  const conv = String(reply).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
  for (const m of conv.matchAll(/\+?\d[\d\s().-]{6,}\d/g)) {
    if (/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(m[0])) continue;   // a date, not a phone
    const d = digits(m[0]);
    if (d.length < 8 || d.length > 15) continue;
    if (/^20\d{2}[01]\d[0-3]\d/.test(d) && d.length === 8) continue;   // a date written as 20261107
    if (!mine.has(d.slice(-8))) out.push(m[0].trim());
  }
  return out;
}

// Other customers of this business (never the person we are talking to, never a team member's name).
function otherCustomers(f, reply, facts, teamNames, said = '') {
  const me = fold(facts.customer?.name || '');
  const own = fold(said), ownDigits = digits(said);
  const myFirst = me.split(' ')[0];
  const TITLES = /^(dr|dra|doctor|doctora|docteur|mr|mrs|ms|miss|mme|mlle|m|sr|sra|srta|prof|profesor|profesora|chef|coach|د|دكتور|الدكتور|دكتوره|الدكتوره|السيد|السيده|الاستاذ|الاستاذه)$/;
  const team = new Set(teamNames.filter(Boolean).flatMap(t => fold(t).replace(/[^\p{L}\p{N}' ]/gu, ' ').split(' ').filter(w => w && !TITLES.test(w)).slice(0, 1)));
  const hits = [];
  const myDigits = digits(facts.customer?.phone).slice(-8);
  const replyDigits = digits(reply);
  for (const c of facts.knownCustomers || []) {
    const name = fold(c?.name || '');
    if (name && name !== me && !(own && wordRe(name.split(' ')[0]).test(own))) {
      const first = name.split(' ')[0];
      if (name.includes(' ') && name.length >= 5 && wordRe(name).test(f)) hits.push(c.name);
      else if (first.length >= 4 && first !== myFirst && !team.has(first) && wordRe(first).test(f)) hits.push(c.name);
    }
    const d = digits(c?.phone).slice(-8);
    if (d.length >= 7 && d !== myDigits && !ownDigits.includes(d) && replyDigits.includes(d)) hits.push('phone of ' + (c.name || 'a customer'));
  }
  return [...new Set(hits)];
}

// Shingles of 8 words from the real system prompt: a reply that copies any of them is reciting it.
function recitesPrompt(f, prompt) {
  if (!prompt) return false;
  const w = fold(prompt).split(' '), r = f.split(' ');
  if (r.length < 8) return false;
  const set = new Set();
  for (let i = 0; i + 8 <= w.length; i++) set.add(w.slice(i, i + 8).join(' '));
  for (let i = 0; i + 8 <= r.length; i++) if (set.has(r.slice(i, i + 8).join(' '))) return true;
  return false;
}

// Price check per sentence: a price next to a service must be that service's price; a price on its own must be
// one of the catalog prices (or two added together, or the deposit). Anything else was made up.
function inventedPrices(reply, services, extra) {
  const bad = [];
  const all = services.map(s => s.price).filter(Number.isFinite).concat(extra);
  const pairs = [];
  for (let i = 0; i < all.length; i++) for (let j = i; j < all.length; j++) pairs.push(all[i] + all[j]);
  const segments = String(reply).split(/\n|;|•|\||(?<=[.!?؟])\s+|,\s+(?=\D)|،\s*|\s+-\s+/);
  for (const seg of segments) {
    const prices = pricesIn(fold(seg));
    if (!prices.length) continue;
    const fs = fold(seg);
    // longest names first so "Hair colour" wins over "Hair"
    const named = services.filter(s => s.key.length >= 3 && wordRe(s.key).test(fs)).sort((a, b) => b.key.length - a.key.length)
      .filter((s, i, arr) => !arr.slice(0, i).some(o => o.key.includes(s.key)));
    for (const p of prices) {
      if (extra.some(x => same(x, p.n))) continue;
      if (named.length) { if (!named.some(s => same(s.price, p.n)) && !(named.length > 1 && pairs.some(x => same(x, p.n)))) bad.push(p.text.trim()); }
      else if (!all.some(x => same(x, p.n)) && !pairs.some(x => same(x, p.n))) bad.push(p.text.trim());
    }
  }
  return bad;
}

// Discount codes and percentages: only the owner's active coupons. Codes the customer typed may be echoed back.
function badDiscounts(reply, f, coupons, customerText) {
  const bad = [];
  const known = new Set(coupons.map(c => String(c.code).toUpperCase()));
  const typed = String(customerText || '').toUpperCase();
  const seen = new Set();
  for (const m of reply.matchAll(/(?:code|coupon|promo|c[oó]digo|cup[oó]n|voucher|كود|رمز|الكود)\s*[:\-]?\s*["'“«]?([A-Za-z0-9_-]{3,24})/giu)) seen.add(m[1]);
  for (const m of reply.matchAll(/\b([A-Z]{3,}[0-9]{1,3}|[A-Z]+[0-9]+[A-Z]+)\b/g)) seen.add(m[1]);
  for (const tok of seen) {
    if (!/^[A-Z0-9_-]+$/.test(tok) || !/[A-Z]/.test(tok) && !/\d/.test(tok)) continue;   // a normal word, not a code
    if (/^(RB-?\d+|AM|PM|USD|EUR|LBP|WHATSAPP|SMS|OK|AI|IA)$/i.test(tok)) continue;     // booking refs and the like
    if (!known.has(tok.toUpperCase()) && !typed.includes(tok.toUpperCase())) bad.push('code ' + tok);
  }
  // percentages and amounts "off"
  for (const m of f.matchAll(/(\d{1,3})\s?%/g)) {
    const around = f.slice(Math.max(0, m.index - 30), m.index + 30);
    if (!DISCOUNT_WORD.test(around)) continue;
    if (!coupons.some(c => (c.kind || 'percent') === 'percent' && same(+c.value, +m[1]))) bad.push(m[0] + ' off');
  }
  for (const m of f.matchAll(new RegExp(`(${CUR}\\s?\\d[\\d.,]*|\\d[\\d.,]*\\s?${CUR})\\s+(off|de descuento|de remise|خصم)`, 'giu'))) {
    const n = parseFloat((m[1].match(/\d[\d.]*/) || ['0'])[0]);
    if (!coupons.some(c => c.kind === 'amount' && same(+c.value, n))) bad.push(m[0]);
  }
  if (DISCOUNT_PROMISE.some(re => re.test(f))) bad.push('discount promise');
  return [...new Set(bad)];
}

// Harmless fixes: a stray ``` block (often the model's own JSON), and length.
function tidy(reply, max) {
  let r = String(reply ?? ''), changed = [];
  if (/```/.test(r)) {
    const inner = r.match(/```(?:json)?\s*([\s\S]*?)```/i);
    let fromJson = null;
    if (inner) { try { const j = JSON.parse(inner[1]); if (typeof j?.reply === 'string') fromJson = j.reply; } catch { /* not JSON */ } }
    r = fromJson ?? r.replace(/```[a-z]*\s*[\s\S]*?```/gi, ' ').replace(/```/g, '');
    r = r.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    changed.push({ kind: 'code_block' });
  }
  if (r.length > max) {
    const cut = r.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('؟'), cut.lastIndexOf('\n'));
    r = end > max * 0.5 ? cut.slice(0, end + 1).trim() : cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).trim() + '…';
    changed.push({ kind: 'length' });
  }
  return { reply: r, changed };
}

// Remove sentences that claim a vendor identity (owner side: rewrite instead of hand over).
function dropIdentity(reply, lang) {
  const parts = String(reply).split(/(?<=[.!?؟\n])\s*/);
  const keep = parts.filter(p => !IDENTITY.some(re => re.test(fold(p))));
  return [OWNER_IDENTITY[lang] || OWNER_IDENTITY.en, ...keep].join(' ').replace(/\s+\n/g, '\n').trim();
}

// `text` (optional, not in the base contract) is the customer's message: codes they typed may be repeated back.
export function checkOutput({ reply, biz = {}, audience = 'customer', role = null, facts = {}, lang, text } = {}) {
  facts = facts || {};
  const L = HANDOFF_TEXT[lang] ? lang : langOf(reply);
  const customer = audience === 'customer';
  const { reply: tidied, changed } = tidy(reply, customer ? LIMITS.customerReply : LIMITS.ownerReply);
  const hits = [...changed];
  const f = fold(tidied);

  if (IDENTITY.some(re => re.test(f))) hits.push({ kind: 'identity' });

  if (!customer) {
    // Owners, staff and the admin see their own data; only the vendor identity and length are policed here.
    if (hits.some(h => h.kind === 'identity')) return { reply: dropIdentity(tidied, L), hits, action: 'rewrite' };
    return { reply: tidied, hits, action: hits.length ? 'rewrite' : 'pass' };
  }

  if (!tidied.trim()) hits.push({ kind: 'empty' });
  const k = factsOf(biz, facts);

  // (a) other businesses, rivals, booking apps
  const rivals = namesIn(f, [...k.competitors, ...k.others], biz.name || k.pub.name);
  if (rivals.length) hits.push({ kind: 'competitor', detail: rivals });
  if (ELSEWHERE.some(re => re.test(f))) hits.push({ kind: 'competitor', detail: 'sends the customer elsewhere' });

  // (b) internal data
  if (LEAK.some(re => re.test(f))) hits.push({ kind: 'leak', detail: 'numbers' });
  if (PROMPT_MARKERS.some(re => re.test(f)) || recitesPrompt(f, facts.systemPrompt)) hits.push({ kind: 'leak', detail: 'instructions' });
  const people = otherCustomers(f, tidied, facts, [...k.team, biz.assistant_name, k.pub.assistant_name, 'Nora'], text);
  if (people.length) hits.push({ kind: 'leak', detail: people });
  const phones = strangerPhones(tidied, biz, facts, text);
  if (phones.length) hits.push({ kind: 'leak', detail: phones.map(p => 'phone ' + p) });
  const never = namesIn(f, k.never, '');
  if (never.length) hits.push({ kind: 'never_say', detail: never });

  // (d) prices and discounts
  const extra = [biz.deposit_amount, k.pub.deposit_amount, ...(facts.allowedAmounts || [])].map(Number).filter(n => Number.isFinite(n) && n > 0);
  const prices = inventedPrices(tidied, k.services, extra);
  if (prices.length) hits.push({ kind: 'price', detail: prices });
  const disc = badDiscounts(tidied, f, k.coupons, text);
  if (disc.length) hits.push({ kind: 'coupon', detail: disc });

  // (e) links
  const links = badLinks(tidied, allowedLinks(biz, facts, k.pub));
  if (links.length) hits.push({ kind: 'link', detail: links });

  const serious = hits.filter(h => !['code_block', 'length'].includes(h.kind));
  if (serious.length) return { reply: HANDOFF_TEXT[L] || HANDOFF_TEXT.en, hits, action: 'handoff' };
  return { reply: tidied, hits, action: changed.length ? 'rewrite' : 'pass' };
}
