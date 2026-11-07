// Layer 07: cache + router. Three jobs, none of which costs an AI call:
//   fastPath  answers greetings, thanks, opening hours, location and owner-written FAQs straight from the setup
//   pickSize  chooses the small (fast, cheap quota) or large (careful) model for everything else
//   cache     remembers answers per business for an hour, so the same question twice is answered once
// The matching rules are the ones quick.js already uses for the receptionist (smallTalk, quickAnswer), widened to
// English, Arabic, Spanish and French, because Lebanon and Spain customers write in all four.
import { smallTalk } from '../quick.js';
import { hoursText } from '../slots.js';

const AR = /[\u0600-\u06FF]/;
// lower case, accents kept as letters, punctuation removed: "¡Hola!" -> "hola", "Bonjour :)" -> "bonjour"
export const norm = s => String(s || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
// Latin accents only ("qué" -> "que", "où" -> "ou"); recomposed so Arabic letters like أ stay one letter
const fold = s => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');

// Which of our four languages a message is in. A guess from a few words is enough to answer a greeting in the
// customer's own language; the AI decides properly for everything else.
export function detectLang(text) {
  const raw = String(text || '');
  if (AR.test(raw)) return 'ar';
  const t = ' ' + fold(raw) + ' ';
  if (/[¿¡ñ]/.test(raw) || / (hola|buenas|buenos|gracias|donde|cuando|cuanto|horario|abren|cierran|direccion|ubicacion|quiero|tienen|por favor|que tal|adios|hasta luego|hasta pronto|nos vemos|vale|perfecto) /.test(t)) return 'es';
  if (/ (bonjour|bonsoir|salut|merci|ou etes|adresse|horaires|ouvert|fermez|je voudrais|s il vous plait|svp|ca va|au revoir|a bientot|bonne journee|bonne soiree|parfait) /.test(t)) return 'fr';
  return 'en';
}

// ---- greetings ----------------------------------------------------------------------------------------------
// The whole message must be a greeting (plus "there", "team", a name or "how are you"), so "hi, can I book Friday?"
// still goes to the AI.
const HELLO = '(?:hi|hii+|hey|heyy+|hello|helo|hallo|hiya|yo|good (?:morning|afternoon|evening|day)|morning|evening|salam|salaam|salam alaykum|assalamu alaikum|marhaba|marhaban|ahlan|ahla|kifak|kifik|kifkon|bonjour|bonsoir|salut|coucou|hola|buenas|buenos dias|buenas tardes|buenas noches|مرحبا|مرحباً|مرحبتين|هلا|اهلا|أهلا|اهلين|السلام عليكم|سلام|صباح الخير|مساء الخير|كيفك|كيفكن)';
const TAIL = '(?: (?:there|all|team|everyone|guys|dear|habibi|حبيبي|how are you|how r u|como estas|que tal|ca va|comment ca va|كيف الحال|شو الأخبار))*';
const GREETING = new RegExp(`^(?:${HELLO})(?: ${HELLO})*${TAIL}$`);
export const isGreeting = (text, name) => {
  let t = fold(text);
  // "hi Nora" is still just a greeting (padded with spaces, because \b only knows Latin letters, not Arabic names)
  const n = name && fold(name);
  if (n) t = (' ' + t + ' ').split(' ' + n + ' ').join(' ').replace(/\s+/g, ' ').trim();
  return !!t && t.split(' ').length <= 6 && GREETING.test(t);
};

// ---- thanks / bye: quick.js knows en/ar; Spanish and French added here -------------------------------------
const THANKS_ES_FR = /^(?:(?:ok|vale|genial|perfecto|super|parfait|d accord|tres bien|bien) )*(?:muchas gracias|gracias|mil gracias|merci beaucoup|merci|adios|hasta luego|hasta pronto|nos vemos|chao|au revoir|a bientot|bonne journee|bonne soiree)(?: (?:a vous|a ti|de nada|merci|gracias))*$/;
const isBye = t => /bye|ciao|chao|see you|باي|السلامة|adios|hasta|nos vemos|au revoir|a bientot|bonne journee|bonne soiree/.test(t);

const TEXT = {
  hello: {
    en: (n, b) => `Hi! I'm ${n}, the assistant of ${b}. How can I help you today?`,
    ar: (n, b) => `أهلاً وسهلاً! أنا ${n}، مساعدة ${b}. كيف فيني ساعدك اليوم؟`,
    es: (n, b) => `¡Hola! Soy ${n}, la asistente de ${b}. ¿En qué puedo ayudarte hoy?`,
    fr: (n, b) => `Bonjour ! Je suis ${n}, l'assistante de ${b}. Comment puis-je vous aider aujourd'hui ?`,
  },
  again: { en: 'Hi again! How can I help?', ar: 'أهلاً من جديد! كيف فيني ساعدك؟', es: '¡Hola de nuevo! ¿En qué te ayudo?', fr: 'Re-bonjour ! Comment puis-je vous aider ?' },
  staff: { en: 'Hi! What would you like to look at?', ar: 'أهلاً! شو بتحب نشوف؟', es: '¡Hola! ¿Qué quieres revisar?', fr: 'Bonjour ! Que voulez-vous consulter ?' },
  thanks: { en: "You're welcome! Message us anytime 😊", ar: 'العفو! نحن هنا إذا احتجت أي شيء 😊', es: '¡De nada! Escríbenos cuando quieras 😊', fr: 'Avec plaisir ! Écrivez-nous quand vous voulez 😊' },
  bye: { en: 'Bye, have a lovely day! 😊', ar: 'مع السلامة! 😊', es: '¡Hasta pronto, que tengas un buen día! 😊', fr: 'Au revoir, belle journée ! 😊' },
  hours: { en: 'Our opening hours: ', ar: 'أوقات العمل: ', es: 'Nuestro horario: ', fr: "Nos horaires d'ouverture : " },
  where: { en: a => `We're at ${a}`, ar: a => `عنواننا: ${a}`, es: a => `Estamos en ${a}`, fr: a => `Nous sommes au ${a}` },
  options: {
    en: ['Book an appointment', 'Prices', 'Opening hours'], ar: ['احجز موعد', 'الأسعار', 'أوقات العمل'],
    es: ['Reservar cita', 'Precios', 'Horario'], fr: ['Prendre rendez-vous', 'Tarifs', 'Horaires'],
  },
};
const pickLang = (lang, text) => (['en', 'ar', 'es', 'fr'].includes(lang) ? lang : detectLang(text));

// Booking, changes or free times need live availability, never a saved answer (it would offer stale slots).
const NEEDS_LIVE = /\b(book|booking|appointment|reserve|reservation|reschedule|cancel|slot|slots|available|availability|free time|tomorrow|tonight|today|reservar|reserva|cita|cancelar|cambiar|manana|hoy|disponible|rendez vous|reserver|annuler|deplacer|demain|aujourd hui|disponible)\b|احجز|حجز|موعد|بكرا|بكرة|اليوم|الغا|إلغاء|بدي روح/;
const ASKS_HOURS = /\b(open|opening|close|closing|hours|working hours|what time|horario|abren|abierto|cierran|hora abren|ouvert|ouvrez|fermez|horaires|heures d ouverture)\b|دوام|بتفتح|بتسكر|ساعات|اوقات|أوقات/;
const ASKS_WHERE = /\b(where|address|location|located|map|directions|donde|direccion|ubicacion|ubicados|ou etes|ou se trouve|adresse|localisation)\b|وين|عنوان|موقع|العنوان/;

// FAQ match, the same scoring as quick.js: most specific answer, written by the owner.
const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'can', 'what', 'how', 'are', 'there', 'have', 'does', 'with', 'please', 'hello', 'need', 'want', 'ask', 'about', 'tell',
  'que', 'los', 'las', 'del', 'una', 'por', 'para', 'con', 'les', 'des', 'est', 'vous', 'pour', 'une', 'avec', 'شو', 'في', 'عندكن', 'من', 'على']);
const words = s => new Set(fold(s).split(' ').filter(w => w.length > 2 && !STOP.has(w)));
export function faqMatch(faqs, text) {
  const q = words(text);
  let best = null, bestScore = 0;
  for (const f of faqs || []) {
    const fq = words(f.q); if (!fq.size) continue;
    const hit = [...fq].filter(w => q.has(w)).length, score = hit / fq.size;
    if (hit >= 2 && score > bestScore) { best = f; bestScore = score; }
  }
  return best && bestScore >= 0.5 ? best : null;
}

// Instant answer or null. Customers get greetings, thanks, hours, location and FAQs; owners and staff only the
// small talk (their questions are about live numbers, so they always go to the model).
export function fastPath({ biz = {}, audience = 'customer', text, lang, history = [] } = {}) {
  const raw = String(text || ''), t = fold(raw);
  const L = pickLang(lang, raw), name = biz.assistant_name || 'Nora', bizName = biz.name || 'us';
  const spoke = (history || []).some(m => m && (m.role === 'assistant' || m.role === 'ai'));

  // only emojis (a thumbs up, a heart): a friendly emoji back
  if (!t && /\p{Extended_Pictographic}/u.test(raw)) return { reply: '😊', options: [], kind: 'emoji' };
  if (!t) return null;

  if (isGreeting(raw, name)) {
    if (audience !== 'customer') return { reply: TEXT.staff[L], options: [], kind: 'greeting' };
    return spoke ? { reply: TEXT.again[L], options: [], kind: 'greeting' }
      : { reply: TEXT.hello[L](name, bizName), options: TEXT.options[L], kind: 'greeting' };
  }
  // thanks / bye (quick.js handles English and Arabic; Spanish and French here)
  if (smallTalk(raw) || THANKS_ES_FR.test(t)) return { reply: (isBye(t) ? TEXT.bye : TEXT.thanks)[L], options: [], kind: 'thanks' };

  if (audience !== 'customer') return null;
  if (NEEDS_LIVE.test(t) || t.split(' ').length > 12) return null;

  const faq = faqMatch(biz.faqs, raw);
  if (faq) return { reply: faq.a, options: [], kind: 'faq' };
  if (ASKS_HOURS.test(t) && biz.hours) return { reply: TEXT.hours[L] + hoursText(biz) + '.', options: [], kind: 'hours' };
  if (ASKS_WHERE.test(t) && biz.address)
    return { reply: TEXT.where[L](biz.address) + (biz.maps_url ? ` (${biz.maps_url})` : '') + '.', options: [], kind: 'location' };
  return null;
}

// ---- small or large model ---------------------------------------------------------------------------------
// Small (lite) is fast and has the biggest free allowance; large is slower but better at anything with
// consequences or several parts. When in doubt for a customer: small, because most chats are simple questions.
const CHANGE = /\b(reschedul\w*|cancel\w*|move|change|postpone|push back|swap|instead|refund|cambiar|cancelar|mover|aplazar|devolucion|annuler|deplacer|changer|reporter|rembourse\w*)\b|الغ|إلغاء|غير الموعد|غيّر|أجل|اجل|بدل|استرجاع/;
const COMPLAINT = /\b(complain\w*|complaint|angry|upset|disappointed|terrible|awful|worst|rude|unacceptable|never again|manager|refund|burn\w*|allerg\w*|hurt|damage\w*|queja|reclamacion|enfadad\w*|fatal|horrible|plainte|furieux|decu|inacceptable)\b|زعلان|معصب|شكوى|سيء|سيئ|مش مقبول|حرق/;
export function pickSize({ text, role, audience } = {}) {
  if (role === 'mxai' || (audience && audience !== 'customer')) return 'large'; // owner questions mix numbers and judgement
  const raw = String(text || ''), t = fold(raw);
  if (!t) return 'small';
  if (CHANGE.test(t) || COMPLAINT.test(t)) return 'large';
  const questions = (raw.match(/[?؟]/g) || []).length;
  const sentences = raw.split(/[.!?؟\n]+/).filter(s => s.trim().split(/\s+/).length >= 3).length;
  if (questions >= 2 || sentences >= 3 || raw.length > 220 || / and also | also | ademas | aussi | كمان | وكمان /.test(' ' + t + ' ')) return 'large';
  return 'small';
}

// ---- answer cache -----------------------------------------------------------------------------------------
// In memory, per business, one hour. Kept per business so one business's answer can never reach another's
// customer, and cleared whenever an owner changes the setup (services, hours, FAQs) so a stale price is not repeated.
const TTL = 3600e3, MAX = 500;
const store = new Map(); // bizId -> Map(key -> { value, exp })
const keyOf = k => (typeof k === 'string' ? fold(k) : JSON.stringify(k));
export const cache = {
  get(bizId, key) {
    const m = store.get(String(bizId)); if (!m) return undefined;
    const k = keyOf(key), e = m.get(k);
    if (!e) return undefined;
    if (e.exp <= Date.now()) { m.delete(k); return undefined; }
    return e.value;
  },
  set(bizId, key, value) {
    if (bizId == null) return;
    let m = store.get(String(bizId));
    if (!m) store.set(String(bizId), (m = new Map()));
    const k = keyOf(key);
    m.delete(k); m.set(k, { value, exp: Date.now() + TTL });
    // the oldest entry goes first when a business has very many different questions
    while (m.size > MAX) m.delete(m.keys().next().value);
  },
  clear(bizId) { if (bizId == null) store.clear(); else store.delete(String(bizId)); },
  _ttl: TTL,
};
