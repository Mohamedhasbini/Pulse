// Client websites: one page per business, built on the server from the business data plus its `site` settings.
// Styles: elegant, modern, warm, bold. Languages: en, ar (right to left), es. Sections switch on and off per client.
// Booking, chat and reviews come live from the platform, so the site is never out of date.
import { q, one } from './db.js';
import { loadBusiness } from './brain.js';
import { VERTICALS } from './verticals.js';

export const STYLES = {
  elegant: { label: 'Elegant', accent: '#a8824f', fonts: 'family=Cormorant+Garamond:wght@500;600;700&family=Jost:wght@400;500;600',
    head: '"Cormorant Garamond", Georgia, serif', body: 'Jost, system-ui, sans-serif', vars: '--bg:#faf7f2;--bg2:#f2ece3;--card:#fffdf9;--ink:#1f1b16;--ink2:#5b534a;--line:rgba(31,27,22,.12);--r:4px;--hw:600;--ht:none;--hs:.01em' },
  modern: { label: 'Modern', accent: '#2557e6', fonts: 'family=Manrope:wght@400;500;600;700;800',
    head: 'Manrope, system-ui, sans-serif', body: 'Manrope, system-ui, sans-serif', vars: '--bg:#ffffff;--bg2:#f3f5f9;--card:#ffffff;--ink:#0e1424;--ink2:#4c5568;--line:rgba(14,20,36,.1);--r:16px;--hw:800;--ht:none;--hs:-.03em' },
  warm: { label: 'Warm', accent: '#c4552b', fonts: 'family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Nunito+Sans:wght@400;600;700',
    head: 'Fraunces, Georgia, serif', body: '"Nunito Sans", system-ui, sans-serif', vars: '--bg:#fff8f0;--bg2:#f8ebdc;--card:#fffdfa;--ink:#2b1d14;--ink2:#6b5446;--line:rgba(43,29,20,.12);--r:24px;--hw:700;--ht:none;--hs:-.02em' },
  bold: { label: 'Bold', accent: '#ff5a36', fonts: 'family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600',
    head: '"Space Grotesk", system-ui, sans-serif', body: 'Inter, system-ui, sans-serif', vars: '--bg:#0d0d10;--bg2:#17171c;--card:#1b1b21;--ink:#f6f5f2;--ink2:#a9a8b2;--line:rgba(255,255,255,.12);--r:10px;--hw:700;--ht:uppercase;--hs:-.01em', dark: true },
};
export const SECTIONS = ['hero', 'about', 'services', 'booking', 'gallery', 'team', 'reviews', 'hours', 'faq', 'contact'];
export const LANGS = { en: 'English', ar: 'العربية', es: 'Español' };
const RESERVED = new Set(['app', 'www', 'api', 'admin', 'jarvis', 'mail', 'webook', 'pulse', 'static', 'media', 'cdn', 'status', 'help', 'support']);
export const validSubdomain = s => /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(s) && !RESERVED.has(s);
export const validDomain = d => /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(d);

const T = {
  en: { book: 'Book now', bookOnline: 'Book online', whatsapp: 'WhatsApp us', chat: 'Chat with our assistant', about: 'About us', services: 'Services', prices: 'Prices',
    min: 'min', from: 'from', free: 'Free', bookTitle: 'Book in under a minute', bookSub: 'Pick a time online, or message us and our assistant books you in, day or night.',
    gallery: 'Gallery', team: 'Our team', reviews: 'What clients say', reviewsN: n => `${n} review${n === 1 ? '' : 's'}`, hours: 'Opening hours', findUs: 'Find us', closed: 'Closed',
    openNow: 'Open now', closedNow: 'Closed now', until: 'until', faq: 'Questions', contact: 'Contact', call: 'Call', directions: 'Get directions', menu: 'See the menu',
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], today: 'Today', powered: 'Powered by', privacy: 'Privacy', instagram: 'Instagram', lang: 'Language', skip: 'Skip to content' },
  ar: { book: 'احجز الآن', bookOnline: 'احجز أونلاين', whatsapp: 'راسلنا على واتساب', chat: 'تحدث مع مساعدنا', about: 'من نحن', services: 'الخدمات', prices: 'الأسعار',
    min: 'دقيقة', from: 'من', free: 'مجاناً', bookTitle: 'احجز في أقل من دقيقة', bookSub: 'اختر الوقت أونلاين، أو راسلنا وسيحجز لك مساعدنا في أي وقت، ليلاً أو نهاراً.',
    gallery: 'معرض الصور', team: 'فريقنا', reviews: 'آراء عملائنا', reviewsN: n => `${n} تقييم`, hours: 'ساعات العمل', findUs: 'موقعنا', closed: 'مغلق',
    openNow: 'مفتوح الآن', closedNow: 'مغلق الآن', until: 'حتى', faq: 'أسئلة شائعة', contact: 'تواصل معنا', call: 'اتصل', directions: 'الاتجاهات', menu: 'القائمة',
    days: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'], today: 'اليوم', powered: 'بدعم من', privacy: 'الخصوصية', instagram: 'إنستغرام', lang: 'اللغة', skip: 'انتقل إلى المحتوى' },
  es: { book: 'Reservar', bookOnline: 'Reservar online', whatsapp: 'Escríbenos por WhatsApp', chat: 'Habla con nuestro asistente', about: 'Sobre nosotros', services: 'Servicios', prices: 'Precios',
    min: 'min', from: 'desde', free: 'Gratis', bookTitle: 'Reserva en menos de un minuto', bookSub: 'Elige tu hora online, o escríbenos y nuestro asistente te reserva, de día o de noche.',
    gallery: 'Galería', team: 'Nuestro equipo', reviews: 'Lo que dicen nuestros clientes', reviewsN: n => `${n} reseña${n === 1 ? '' : 's'}`, hours: 'Horario', findUs: 'Dónde estamos', closed: 'Cerrado',
    openNow: 'Abierto ahora', closedNow: 'Cerrado ahora', until: 'hasta', faq: 'Preguntas', contact: 'Contacto', call: 'Llamar', directions: 'Cómo llegar', menu: 'Ver la carta',
    days: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'], today: 'Hoy', powered: 'Con la tecnología de', privacy: 'Privacidad', instagram: 'Instagram', lang: 'Idioma', skip: 'Saltar al contenido' },
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => { const s = String(u || '').trim(); return /^(https?:\/\/|\/(?!\/))/i.test(s) ? s : ''; };
const digits = s => String(s || '').replace(/\D/g, '');
const hexOk = c => /^#[0-9a-f]{6}$/i.test(c || '');
const money = (v, cur) => { const n = Number(v); if (!n) return null; return `${n.toLocaleString('en', { maximumFractionDigits: 2 })} ${cur}`; };

// Default settings for a business that has never been customised.
export function defaultSite(biz) {
  const v = VERTICALS[biz.vertical] || VERTICALS.salon;
  return { style: biz.vertical === 'restaurant' ? 'warm' : biz.vertical === 'clinic' || biz.vertical === 'dental' ? 'modern' : 'elegant',
    accent: '', langs: ['en'], default_lang: 'en', sections: SECTIONS.filter(s => s !== 'gallery'), published: false, gallery: [],
    text: { en: { tagline: v.label, hero_title: biz.name, hero_sub: biz.description || '', about_title: '', about: biz.description || '' } } };
}
export function siteOf(biz) {
  const d = defaultSite(biz), s = biz.site && typeof biz.site === 'object' ? biz.site : {};
  const out = { ...d, ...s, text: { ...d.text, ...(s.text || {}) } };
  if (!STYLES[out.style]) out.style = d.style;
  out.langs = (Array.isArray(out.langs) ? out.langs : ['en']).filter(l => LANGS[l]);
  if (!out.langs.length) out.langs = ['en'];
  if (!out.langs.includes(out.default_lang)) out.default_lang = out.langs[0];
  out.sections = (Array.isArray(out.sections) ? out.sections : d.sections).filter(x => SECTIONS.includes(x));
  if (!out.sections.includes('hero')) out.sections.unshift('hero');
  out.gallery = (Array.isArray(out.gallery) ? out.gallery : []).map(safeUrl).filter(Boolean);
  return out;
}

// Opening state in the business's own time zone.
function nowIn(tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz || process.env.TZ || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), mins: +p.hour * 60 + +p.minute };
  } catch { const d = new Date(); return { day: d.getDay(), mins: d.getHours() * 60 + d.getMinutes() }; }
}
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

export async function siteData(bizId) {
  const biz = await loadBusiness(bizId);
  if (!biz) return null;
  const [rating] = await q('SELECT round(avg(stars)::numeric,1)::float AS avg, count(*)::int AS n FROM reviews WHERE business_id=$1', [bizId]);
  const reviews = await q(`SELECT stars, text, COALESCE(NULLIF(author,''),'') AS author FROM reviews WHERE business_id=$1 AND stars >= 4 AND length(coalesce(text,'')) > 8
    ORDER BY created_at DESC LIMIT 6`, [bizId]);
  return { biz, site: siteOf(biz), rating, reviews };
}

// Full HTML page. `base` is the path the site lives at ('' on its own domain, '/s/<id>' in preview).
export function renderSite({ biz, site, rating, reviews }, lang, { base = '', preview = false } = {}) {
  if (!site.langs.includes(lang)) lang = site.default_lang;
  const t = T[lang], st = STYLES[site.style], rtl = lang === 'ar', cur = biz.currency || 'USD';
  const tx = { ...(site.text[site.default_lang] || {}), ...(site.text[lang] || {}) };
  const accent = hexOk(site.accent) ? site.accent : st.accent;
  const v = VERTICALS[biz.vertical] || VERTICALS.salon;
  const bookUrl = `/book?b=${biz.id}`, chatUrl = `/webook/${biz.id}?chat=1`;
  const wa = digits(biz.phone).length >= 7 ? `https://wa.me/${digits(biz.phone)}` : '';
  const ig = String(biz.instagram || '').replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '');
  const maps = safeUrl(biz.maps_url) || (biz.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(biz.address + (biz.city ? ', ' + biz.city : ''))}` : '');
  const now = nowIn(biz.timezone), todayR = (biz.hours?.[now.day] || []).map(([a, b]) => [toMin(a), toMin(b), b]);
  const openR = todayR.find(([a, b]) => now.mins >= a && now.mins < b);
  const on = s => site.sections.includes(s);
  const svcs = (biz.services || []).filter(s => s.name);
  const team = String(biz.team || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [n, ...r] = l.split(/\s+[–—-]\s+/); return { n, r: r.join(' – ') }; });
  const faqs = (biz.faqs || []).filter(f => f.q && f.a).slice(0, 12);
  const cover = safeUrl(biz.cover_url), logo = safeUrl(biz.logo_url), menu = safeUrl(biz.menu_url);
  const nav = [['about', t.about], ['services', t.services], ['gallery', t.gallery], ['reviews', t.reviews], ['hours', t.hours], ['contact', t.contact]]
    .filter(([k]) => on(k) && (k !== 'gallery' || site.gallery.length) && (k !== 'reviews' || reviews.length) && (k !== 'services' || svcs.length));
  const langLinks = site.langs.length > 1 ? `<div class="langs" role="group" aria-label="${t.lang}">${site.langs.map(l => `<a href="${base || '/'}?lang=${l}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`).join('')}</div>` : '';
  const btn = (href, label, cls = 'pri', ext = false) => href ? `<a class="btn ${cls}" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${label}</a>` : '';
  const desc = tx.hero_sub || biz.description || `${v.label} · ${biz.address || ''}`;
  const title = `${biz.name}${tx.tagline ? ' · ' + tx.tagline : ''}`;
  const ld = { '@context': 'https://schema.org', '@type': biz.vertical === 'restaurant' ? 'Restaurant' : biz.vertical === 'clinic' || biz.vertical === 'dental' ? 'MedicalBusiness' : 'LocalBusiness',
    name: biz.name, description: desc, telephone: biz.phone || undefined, image: cover || logo || undefined, url: base ? undefined : '/',
    address: biz.address ? { '@type': 'PostalAddress', streetAddress: biz.address, addressLocality: biz.city || undefined } : undefined,
    aggregateRating: rating?.n ? { '@type': 'AggregateRating', ratingValue: rating.avg, reviewCount: rating.n } : undefined,
    openingHoursSpecification: [0, 1, 2, 3, 4, 5, 6].flatMap(d => (biz.hours?.[d] || []).map(([o, c]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/' + T.en.days[d], opens: o, closes: c }))) };

  const S = {
    hero: () => `<header class="hero${cover ? ' has-img' : ''}" id="top"${cover ? ` style="--img:url('${esc(cover)}')"` : ''}>
      <div class="wrap hero-in">
        ${tx.tagline ? `<p class="eyebrow">${esc(tx.tagline)}</p>` : ''}
        <h1>${esc(tx.hero_title || biz.name)}</h1>
        ${tx.hero_sub ? `<p class="lead">${esc(tx.hero_sub)}</p>` : ''}
        <div class="ctas">${btn(bookUrl, t.book)}${btn(wa, t.whatsapp, 'ghost', true)}</div>
        <div class="facts">${rating?.n ? `<span>★ ${rating.avg.toFixed(1)} · ${t.reviewsN(rating.n)}</span>` : ''}${todayR.length || biz.hours ? `<span class="${openR ? 'open' : 'shut'}"><i></i>${openR ? `${t.openNow} · ${t.until} ${esc(openR[2])}` : t.closedNow}</span>` : ''}${biz.address ? `<span>${esc(biz.city || biz.address)}</span>` : ''}</div>
      </div></header>`,
    about: () => (tx.about || biz.description) ? `<section id="about" class="sec"><div class="wrap split">
      <div><p class="kicker">${t.about}</p><h2>${esc(tx.about_title || biz.name)}</h2></div>
      <div class="prose">${esc(tx.about || biz.description).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}${menu ? btn(menu, t.menu, 'ghost', true) : ''}</div></div></section>` : '',
    services: () => svcs.length ? `<section id="services" class="sec alt"><div class="wrap">
      <div class="sh"><p class="kicker">${t.prices}</p><h2>${t.services}</h2></div>
      <ul class="menu">${svcs.map(s => `<li><div><b>${esc(s.name)}</b>${s.description ? `<small>${esc(s.description)}</small>` : ''}</div>
        <span class="dots" aria-hidden="true"></span><div class="pr"><b>${money(s.price, cur) || t.free}</b><small>${s.minutes} ${t.min}</small></div></li>`).join('')}</ul>
      <div class="center">${btn(bookUrl, t.book)}</div></div></section>` : '',
    booking: () => `<section id="book" class="sec band"><div class="wrap band-in">
      <div><h2>${t.bookTitle}</h2><p>${t.bookSub}</p></div>
      <div class="ctas">${btn(bookUrl, t.bookOnline)}${btn(wa, t.whatsapp, 'ghost', true)}${btn(chatUrl, t.chat, 'ghost', true)}</div></div></section>`,
    gallery: () => site.gallery.length ? `<section id="gallery" class="sec"><div class="wrap"><div class="sh"><h2>${t.gallery}</h2></div>
      <div class="gal">${site.gallery.slice(0, 12).map((g, i) => `<figure><img src="${esc(g)}" alt="${esc(biz.name)} ${i + 1}" loading="lazy" decoding="async"></figure>`).join('')}</div></div></section>` : '',
    team: () => team.length ? `<section id="team" class="sec alt"><div class="wrap"><div class="sh"><h2>${t.team}</h2></div>
      <div class="team">${team.map(m => `<div class="mem"><span class="av" aria-hidden="true">${esc([...m.n][0] || '')}</span><b>${esc(m.n)}</b>${m.r ? `<small>${esc(m.r)}</small>` : ''}</div>`).join('')}</div></div></section>` : '',
    reviews: () => reviews.length ? `<section id="reviews" class="sec"><div class="wrap"><div class="sh"><p class="kicker">★ ${rating.avg.toFixed(1)} · ${t.reviewsN(rating.n)}</p><h2>${t.reviews}</h2></div>
      <div class="revs">${reviews.map(r => `<blockquote><div class="stars" aria-label="${r.stars}/5">${'★'.repeat(r.stars)}</div><p>${esc(r.text)}</p>${r.author ? `<cite>${esc(r.author)}</cite>` : ''}</blockquote>`).join('')}</div></div></section>` : '',
    hours: () => `<section id="hours" class="sec alt"><div class="wrap split">
      <div><div class="sh"><h2>${t.hours}</h2></div><table class="hrs">${[1, 2, 3, 4, 5, 6, 0].map(d => `<tr${d === now.day ? ' class="today"' : ''}><th>${t.days[d]}</th><td>${(biz.hours?.[d] || []).map(r => r.join('–')).join(', ') || t.closed}</td></tr>`).join('')}</table></div>
      <div><div class="sh"><h2>${t.findUs}</h2></div>${biz.address ? `<p class="addr">${esc(biz.address)}${biz.city && !biz.address.includes(biz.city) ? ', ' + esc(biz.city) : ''}</p>` : ''}
        ${biz.address ? `<div class="map"><iframe title="${t.findUs}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(biz.address + (biz.city ? ', ' + biz.city : ''))}&output=embed"></iframe></div>` : ''}
        <div class="ctas">${btn(maps, t.directions, 'ghost', true)}</div></div></div></section>`,
    faq: () => faqs.length ? `<section id="faq" class="sec"><div class="wrap narrow"><div class="sh"><h2>${t.faq}</h2></div>
      ${faqs.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div></section>` : '',
    contact: () => `<section id="contact" class="sec band dark"><div class="wrap band-in">
      <div><h2>${esc(biz.name)}</h2><p>${[biz.address, biz.phone].filter(Boolean).map(esc).join(' · ')}</p></div>
      <div class="ctas">${btn(bookUrl, t.book)}${btn(wa, t.whatsapp, 'ghost', true)}${biz.phone ? btn('tel:' + digits(biz.phone).replace(/^/, '+'), t.call, 'ghost') : ''}${ig ? btn('https://instagram.com/' + encodeURIComponent(ig), t.instagram, 'ghost', true) : ''}</div></div></section>`,
  };

  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc.slice(0, 160))}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc.slice(0, 200))}"><meta property="og:type" content="website">${cover ? `<meta property="og:image" content="${esc(cover)}">` : ''}
<meta name="theme-color" content="${st.dark ? '#0d0d10' : '#ffffff'}">
${logo ? `<link rel="icon" href="${esc(logo)}">` : ''}
${site.langs.map(l => `<link rel="alternate" hreflang="${l}" href="${base || '/'}?lang=${l}">`).join('')}
${preview || !site.published ? '<meta name="robots" content="noindex">' : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${st.fonts}${rtl ? '&family=Tajawal:wght@400;500;700;800' : ''}&display=swap">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>
:root{${st.vars};--acc:${accent};--head:${rtl ? 'Tajawal, ' : ''}${st.head};--body:${rtl ? 'Tajawal, ' : ''}${st.body};color-scheme:${st.dark ? 'dark' : 'light'}}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.65 var(--body);-webkit-font-smoothing:antialiased;overflow-x:hidden}
img{max-width:100%;display:block}a{color:inherit}
h1,h2,h3{font-family:var(--head);font-weight:var(--hw);letter-spacing:${rtl ? '0' : 'var(--hs)'};line-height:1.08;margin:0;text-transform:${rtl ? 'none' : 'var(--ht)'}}
.wrap{width:min(1140px,100% - 40px);margin:0 auto}.narrow{width:min(780px,100% - 40px)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:50px;padding:0 26px;border-radius:var(--r);font:600 16px/1 var(--body);text-decoration:none;border:1.5px solid transparent;transition:transform .15s,background .2s,color .2s;white-space:nowrap}
.btn:active{transform:scale(.98)}.btn.pri{background:var(--acc);color:#fff}.btn.pri:hover{filter:brightness(1.08)}
.btn.ghost{border-color:currentColor;background:transparent}.btn.ghost:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
:focus-visible{outline:3px solid var(--acc);outline-offset:3px}
.skip{position:absolute;top:8px;inset-inline-start:8px;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;background:var(--acc);color:#fff;padding:10px 14px;z-index:99}.skip:focus{width:auto;height:auto;clip-path:none}
/* top bar */
.bar{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.bar .wrap{display:flex;align-items:center;gap:18px;height:70px}
.brand{display:flex;align-items:center;gap:10px;font:var(--hw) 21px/1 var(--head);text-decoration:none;min-width:0}.brand img{width:38px;height:38px;border-radius:calc(var(--r) / 2 + 4px);object-fit:cover}
.brand span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.links{display:flex;gap:22px;margin-inline-start:auto;font-size:15px;color:var(--ink2)}.links a{text-decoration:none}.links a:hover{color:var(--ink)}
.langs{display:flex;gap:2px;border:1px solid var(--line);border-radius:999px;padding:3px}.langs a{font-size:12px;font-weight:600;text-decoration:none;padding:5px 9px;border-radius:999px;color:var(--ink2)}
.langs a[aria-current]{background:var(--ink);color:var(--bg)}
.bar .btn{min-height:42px;padding:0 18px;font-size:14.5px}
@media (max-width:900px){.links{display:none}.langs{margin-inline-start:auto}.bar .btn{display:none}}
/* hero */
.hero{position:relative;padding:clamp(70px,12vw,150px) 0 clamp(60px,9vw,110px);background:var(--bg2);overflow:hidden}
.hero.has-img{background:linear-gradient(${rtl ? '270deg' : '90deg'},rgba(0,0,0,.72),rgba(0,0,0,.25)),var(--img) center/cover no-repeat;color:#fff}
.hero.has-img .lead,.hero.has-img .facts{color:rgba(255,255,255,.88)}
.hero:not(.has-img)::after{content:"";position:absolute;inset:auto -10% -40% auto;width:60vmax;height:60vmax;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--acc) 26%,transparent),transparent);pointer-events:none}
.hero-in{position:relative;z-index:1;max-width:820px}.hero h1{font-size:clamp(42px,7.4vw,92px);margin:10px 0 18px}
.eyebrow,.kicker{font-size:13.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);margin:0}
.hero.has-img .eyebrow{color:#fff;opacity:.85}.lead{font-size:clamp(18px,2vw,21px);color:var(--ink2);max-width:620px;margin:0 0 30px}
.ctas{display:flex;gap:12px;flex-wrap:wrap}.facts{display:flex;gap:10px 22px;flex-wrap:wrap;margin-top:28px;font-size:15px;color:var(--ink2)}
.facts span{display:inline-flex;align-items:center;gap:8px}.facts i{width:9px;height:9px;border-radius:50%;background:#9a9a9a}.facts .open i{background:#22c55e;box-shadow:0 0 0 4px rgba(34,197,94,.2)}
/* sections */
.sec{padding:clamp(64px,9vw,110px) 0}.alt{background:var(--bg2)}.sh{margin-bottom:34px}.sh h2,.split h2{font-size:clamp(32px,4.6vw,54px);margin-top:8px}
.split{display:grid;grid-template-columns:1fr 1.25fr;gap:clamp(30px,6vw,80px);align-items:start}@media (max-width:820px){.split{grid-template-columns:1fr}}
.prose p{margin:0 0 16px;color:var(--ink2);font-size:18px}.prose .btn{margin-top:8px}.center{text-align:center;margin-top:36px}
.menu{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:4px 54px}
.menu li{display:flex;align-items:baseline;gap:12px;padding:18px 0;border-bottom:1px solid var(--line)}.menu li>div:first-child{min-width:0}
.menu b{font-weight:600;font-size:18px}.menu small{display:block;color:var(--ink2);font-size:14.5px;margin-top:3px}
.dots{flex:1;border-bottom:1.5px dotted var(--line);transform:translateY(-5px);min-width:18px}.pr{text-align:end;white-space:nowrap}.pr b{color:var(--acc)}
.band{background:var(--acc);color:#fff}.band.dark{background:var(--ink);color:var(--bg)}.band-in{display:flex;gap:30px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.band h2{font-size:clamp(28px,3.6vw,44px)}.band p{margin:10px 0 0;opacity:.85;max-width:560px}.band .btn.pri{background:#fff;color:#111}.band.dark .btn.pri{background:var(--acc);color:#fff}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:12px}.gal figure{margin:0;aspect-ratio:4/5;overflow:hidden;border-radius:var(--r);background:var(--bg2)}
.gal img{width:100%;height:100%;object-fit:cover;transition:transform .5s}.gal figure:hover img{transform:scale(1.04)}
.team{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px}.mem{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:24px;display:flex;flex-direction:column;gap:4px}
.mem .av{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--acc) 16%,transparent);color:var(--acc);font:var(--hw) 22px var(--head);margin-bottom:10px}
.mem small{color:var(--ink2)}
.revs{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:18px}
blockquote{margin:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:26px}.stars{color:#f5a524;letter-spacing:2px}
blockquote p{margin:10px 0 14px;font-size:17px}cite{font-style:normal;font-weight:600;color:var(--ink2);font-size:15px}
.hrs{width:100%;border-collapse:collapse;font-size:16.5px}.hrs th,.hrs td{text-align:start;padding:12px 0;border-bottom:1px solid var(--line);font-weight:400}.hrs td{text-align:end;color:var(--ink2)}
.hrs .today th,.hrs .today td{font-weight:700;color:var(--acc)}.addr{font-size:18px;margin:0 0 16px}
.map{border-radius:var(--r);overflow:hidden;border:1px solid var(--line);aspect-ratio:16/10;margin-bottom:16px;background:var(--bg2)}.map iframe{width:100%;height:100%;border:0;display:block}
details{border-bottom:1px solid var(--line);padding:20px 0}summary{cursor:pointer;font-weight:600;font-size:18px;list-style:none;display:flex;justify-content:space-between;gap:16px}
summary::-webkit-details-marker{display:none}summary::after{content:"+";color:var(--acc);font-size:24px;line-height:1}details[open] summary::after{content:"−"}details p{color:var(--ink2);margin:12px 0 0}
footer{padding:30px 0 100px;font-size:14px;color:var(--ink2)}footer .wrap{display:flex;gap:12px 22px;flex-wrap:wrap;align-items:center}footer a{text-decoration:none}footer .sp{flex:1}
/* phone: sticky actions */
.dock{position:fixed;inset-inline:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:30;display:none;gap:8px}
.dock .btn{flex:1;min-height:52px;box-shadow:0 12px 30px -10px rgba(0,0,0,.45)}.dock .btn.ghost{background:var(--card);border-color:var(--line);color:var(--ink)}
@media (max-width:900px){.dock{display:flex}footer{padding-bottom:110px}}
@media (min-width:901px){footer{padding-bottom:30px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
${preview ? '.pv{position:fixed;top:0;inset-inline:0;z-index:50;background:#111;color:#fff;font:600 13px/1 system-ui;text-align:center;padding:8px}.bar{top:29px}body{padding-top:29px}' : ''}
</style>
</head>
<body>
${preview ? `<div class="pv">Preview${site.published ? '' : ' · not published yet'}</div>` : ''}
<a class="skip" href="#main">${t.skip}</a>
<nav class="bar" aria-label="Main"><div class="wrap">
  <a class="brand" href="${base || '/'}${lang !== site.default_lang ? '?lang=' + lang : ''}">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<span>${esc(biz.name)}</span></a>
  <div class="links">${nav.map(([k, l]) => `<a href="#${k}">${l}</a>`).join('')}</div>
  ${langLinks}${btn(bookUrl, t.book)}
</div></nav>
<main id="main">
${site.sections.map(s => S[s] ? S[s]() : '').join('\n')}
</main>
<footer><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(biz.name)}</span><a href="/privacy">${t.privacy}</a><span class="sp"></span>${biz.show_branding !== false ? `<a href="/go?b=${biz.id}&amp;s=site">${t.powered} <b>Pulse</b></a>` : ''}</div></footer>
<div class="dock">${btn(bookUrl, t.book)}${btn(wa || chatUrl, wa ? 'WhatsApp' : t.chat, 'ghost', true)}</div>
</body>
</html>`;
}

// Which business a host name belongs to: its own domain, or <sub>.<SITES_DOMAIN>.
export async function businessForHost(host) {
  host = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
  if (!host) return null;
  const root = String(process.env.SITES_DOMAIN || '').toLowerCase();
  if (root && host.endsWith('.' + root)) {
    const sub = host.slice(0, -root.length - 1);
    if (!sub.includes('.') && validSubdomain(sub)) return (await one('SELECT id FROM businesses WHERE subdomain=$1', [sub]))?.id || null;
    return null;
  }
  return (await one('SELECT id FROM businesses WHERE custom_domain=$1', [host]))?.id || null;
}

// Routes: the site on its own host (before anything else), a preview link, and robots/sitemap per host.
export function mountClientSites(app, readSession) {
  const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
  const send = (res, html) => res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(html);
  const langOf = (req, site) => {
    const want = String(req.query.lang || '').toLowerCase();
    if (site.langs.includes(want)) return want;
    // No choice yet: the visitor's browser language if the site has it, else the site's main language.
    const browser = String(req.get('accept-language') || '').toLowerCase().split(',').map(x => x.trim().slice(0, 2))[0];
    return site.langs.includes(browser) ? browser : site.default_lang;
  };
  // A business's own domain or subdomain
  app.use(wrap(async (req, res, next) => {
    if (req.method !== 'GET' || !['/', '/robots.txt', '/sitemap.xml'].includes(req.path)) return next();
    const id = await businessForHost(req.hostname);
    if (!id) return next();
    const d = await siteData(id);
    if (!d || !d.site.published || !(await siteAllowed(id))) return res.status(404).type('text').send('This website is not available.');
    const origin = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
    if (req.path === '/robots.txt') return res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`);
    if (req.path === '/sitemap.xml') return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${d.site.langs.map(l => `<url><loc>${origin}/?lang=${l}</loc></url>`).join('')}</urlset>`);
    send(res, renderSite(d, langOf(req, d.site)));
  }));
  // Preview by id: public once published; before that only for people signed in to that business (or the admin)
  app.get('/s/:id', wrap(async (req, res) => {
    const id = +req.params.id, d = id && await siteData(id);
    if (!d) return res.status(404).type('text').send('Not found.');
    if (!d.site.published || !(await siteAllowed(id))) {
      const s = readSession(req.get('cookie'));
      const u = s && await one('SELECT role, business_id, session_version FROM users WHERE id=$1 AND NOT disabled', [s.uid]);
      if (!u || u.session_version !== s.version || (u.role !== 'admin' && u.business_id !== id)) return res.status(404).type('text').send('This website is not published yet.');
    }
    send(res, renderSite(d, langOf(req, d.site), { base: `/s/${id}`, preview: true }));
  }));
}
// The plan must include the website (admin switches count too).
async function siteAllowed(id) { const { hasFeature } = await import('./features.js'); return hasFeature(id, 'website'); }

// Settings the owner may change; everything else (style, sections, languages, addresses, publishing) is the platform admin's.
const OWNER_TEXT = ['tagline', 'hero_title', 'hero_sub', 'about_title', 'about'];
export function mergeSite(current, body, isAdmin) {
  const s = { ...current, text: { ...current.text } };
  for (const [lang, fields] of Object.entries(body.text || {})) {
    if (!LANGS[lang] || typeof fields !== 'object') continue;
    s.text[lang] = { ...(s.text[lang] || {}) };
    for (const k of OWNER_TEXT) if (k in fields) s.text[lang][k] = String(fields[k] ?? '').slice(0, k === 'about' ? 3000 : 300);
  }
  if (Array.isArray(body.gallery)) s.gallery = body.gallery.map(String).filter(g => current.gallery.includes(g)); // reorder or remove only
  if (isAdmin) {
    if (STYLES[body.style]) s.style = body.style;
    if (body.accent === '' || hexOk(body.accent)) s.accent = body.accent;
    if (Array.isArray(body.langs)) { const l = body.langs.filter(x => LANGS[x]); if (l.length) s.langs = [...new Set(l)]; }
    if (LANGS[body.default_lang]) s.default_lang = body.default_lang;
    if (Array.isArray(body.sections)) s.sections = [...new Set(body.sections.filter(x => SECTIONS.includes(x)))];
    if (typeof body.published === 'boolean') s.published = body.published;
  }
  return s;
}
