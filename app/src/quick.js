// Instant answers straight from the business setup, used when the AI is slow or unavailable.
// It only answers what it is sure about; anything else goes to staff and to the AI Training page.
import { hoursText } from './slots.js';

const AR = /[؀-ۿ]/;
const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const words = s => new Set(norm(s).split(' ').filter(w => w.length > 2 && !STOP.has(w)));
const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'can', 'what', 'how', 'is', 'are', 'there', 'have', 'does', 'with', 'please', 'hello', 'need', 'want', 'ask', 'about', 'tell', 'شو', 'في', 'عندكن', 'من', 'على']);

// Arabic / Lebanese words customers use for common services (matched against words in the service name).
const ALIASES = {
  manicure: ['مانيكور', 'منيكير', 'مناكير', 'اظافر', 'أظافر'], pedicure: ['باديكور', 'بديكير', 'pedi'], facial: ['فيشل', 'تنظيف بشرة', 'تنظيف البشرة', 'بشرة'],
  haircut: ['قص', 'قصة', 'قصّة', 'قص شعر', 'حلاقة'], hair: ['شعر'], colour: ['صبغة', 'صبغ', 'لون', 'color'], color: ['صبغة', 'صبغ', 'لون', 'colour'],
  blow: ['سشوار', 'استشوار', 'بروشينغ', 'brushing'], massage: ['مساج', 'تدليك'], beard: ['دقن', 'ذقن', 'لحية'], waxing: ['واكس', 'شمع'],
  keratin: ['كيراتين'], makeup: ['مكياج', 'ميك اب'], cleaning: ['تنظيف'], consultation: ['استشارة', 'كشف', 'معاينة'], whitening: ['تبييض'],
  filling: ['حشوة', 'حشو'], training: ['تمرين', 'مدرب'], lesson: ['درس', 'حصة'], oil: ['زيت'], wash: ['غسيل'],
};

// Thanks / bye on their own need no AI: answering instantly also means a slow AI can never turn them into a handoff.
// A short word before or after is fine too: "ok thanks", "perfect thank you", "great see you then", "thanks bye".
const LEAD = '(?:(?:ok|okay|okey|k|great|perfect|amazing|awesome|cool|nice|super|good|lovely|alright|all good|done|sure|yes|yeah|yep|wow|tamam|تمام|ممتاز|حلو|اوكي|أوكي) )*';
const ONE = '(?:thanks?(?: you)?(?: so much| a lot| very much)?|thank u|thx|ty|tysm|merci(?: beaucoup)?|gracias|shukran|شكرا|شكراً|يسلمو|يسلموا|مرسي|bye|goodbye|bye bye|ciao|see you(?: then| soon| there)?|يلا باي|باي)';
const THANKS = new RegExp(`^${LEAD}${ONE}(?: ${LEAD}${ONE})*(?: (?:again|dear|habibi|حبيبي))?$`);
export function smallTalk(text) {
  const t = norm(text);
  // only emojis (a thumbs up, a heart): a friendly emoji back
  if (!t && /\p{Extended_Pictographic}/u.test(String(text || ''))) return '😊';
  if (!t || !THANKS.test(t)) return null;
  const ar = AR.test(text), bye = /bye|ciao|see you|باي/.test(t);
  return ar ? (bye ? 'مع السلامة! 😊' : 'العفو! نحن هنا إذا احتجت أي شيء 😊') : bye ? 'Bye, have a lovely day! 😊' : "You're welcome! Message us anytime 😊";
}

export function quickAnswer(biz, text) {
  const t = norm(text), ar = AR.test(text), cur = biz.currency || 'USD';
  const svc = (biz.services || []).find(s => t.includes(norm(s.name)) || norm(s.name).split(' ').some(w => w.length > 3 && t.includes(w))
    || norm(s.name).split(' ').some(w => (ALIASES[w] || []).some(a => t.includes(a))));
  const asksPrice = /price|cost|how much|بقديش|كم|سعر|قديش/.test(t), asksTime = /how long|time|duration|minutes|takes|قديش بياخد|مدة|وقت/.test(t);
  // Booking, rescheduling or free times need live availability: never a saved answer (it would offer stale slots).
  if (/\b(book|booking|appointment|reserve|reservation|reschedule|cancel|slot|slots|available|availability|free time)\b|احجز|حجز|موعد|بدي روح/.test(t)) return null;

  // 1) Saved FAQ that clearly matches (most specific: written by the owner)
  const q = words(text);
  let best = null, bestScore = 0;
  for (const f of biz.faqs || []) {
    const fq = words(f.q); if (!fq.size) continue;
    const hit = [...fq].filter(w => q.has(w)).length, score = hit / fq.size;
    if (hit >= 2 && score > bestScore) { best = f; bestScore = score; }
  }
  if (best && bestScore >= 0.5) return best.a;

  // 2) A specific service: price and/or length
  if (svc && (asksPrice || asksTime || t.split(' ').length <= 4)) {
    const parts = [];
    if (asksPrice || !asksTime) parts.push(ar ? `السعر ${Number(svc.price)} ${cur}` : `costs ${Number(svc.price)} ${cur}`);
    if (asksTime || !asksPrice) parts.push(ar ? `ومدته حوالي ${svc.minutes} دقيقة` : `takes about ${svc.minutes} minutes`);
    return ar ? `${svc.name}: ${parts.join(' ')}.${svc.description ? ' ' + svc.description + '.' : ''} بتحب احجزلك؟`
      : `${svc.name} ${parts.join(' and ')}.${svc.description ? ' ' + svc.description + '.' : ''} Would you like to book it?`;
  }
  // 3) General questions
  if (/services|what do you (do|offer)|menu|price list|prices|خدمات|شو بتعملو|أسعار/.test(t))
    return (ar ? 'خدماتنا: ' : 'Our services: ') + biz.services.map(s => `${s.name} (${Number(s.price)} ${cur}, ${s.minutes} min)`).join(', ') + (ar ? '. أي خدمة بتحب تحجز؟' : '. Which one would you like to book?');
  if (/open|close|hours|working|دوام|بتفتح|بتسكر|ساعات/.test(t)) return (ar ? 'أوقات العمل: ' : 'Our opening hours: ') + hoursText(biz) + '.';
  if (/where|address|location|map|park|وين|عنوان|موقع/.test(t) && biz.address)
    return (ar ? `عنواننا: ${biz.address}` : `We're at ${biz.address}`) + (biz.maps_url ? ` (${biz.maps_url})` : '') + '.';
  if (/pay|card|cash|visa|apple pay|دفع|كاش|بطاقة/.test(t) && biz.payment_methods) return (ar ? 'طرق الدفع: ' : 'Payment: ') + biz.payment_methods + '.';
  if (/phone|call|number|رقم|اتصل/.test(t) && biz.phone) return (ar ? `رقمنا: ${biz.phone}` : `You can call us on ${biz.phone}.`);
  return null;
}
