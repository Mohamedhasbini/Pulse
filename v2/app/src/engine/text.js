// Growth engine helpers: domains, company-name keys, directory filter, emails, and the grounding check
// (a fact is kept only when its exact words appear on the page it came from).

export function domainOf(url) {
  if (!url) return null;
  try {
    const h = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
    return h.replace(/^www\d?\./, '') || null;
  } catch { return null; }
}

// Sites that list or write about companies rather than being one: never a lead.
const NOT_A_COMPANY = new Set(('linkedin facebook instagram twitter x youtube tiktok snapchat threads wikipedia wikimedia yelp tripadvisor bayut dubizzle ' +
  'propertyfinder yellowpages google bing yahoo amazon noon zomato talabat deliveroo careem glassdoor indeed bayt naukrigulf gulftalent ' +
  'crunchbase zawya gulfnews khaleejtimes thenationalnews arabianbusiness gulfbusiness reddit quora medium pinterest apple microsoft github ' +
  'clutch goodfirms sortlist designrush upcity trustpilot justdial 2gis hidubai cylex kompass opencorporates dnb zoominfo apollo rocketreach ' +
  'fresha booksy treatwell vezeeta okadoc practo whatclinic timeoutdubai timeout visitdubai dubaitourism emirates247 gulftoday wam ' +
  'expatwoman dubizzle mapquest waze bloomberg reuters forbes entrepreneur magnitt wamda').split(' '));
export function isDirectory(domain) {
  if (!domain) return true;
  if (/(^|\.)gov(\.[a-z]{2})?$/.test(domain) || /\.gov\./.test(domain) || /\.(edu|mil)(\.|$)/.test(domain)) return true;
  return domain.split('.').some(label => NOT_A_COMPANY.has(label));
}

// "Al Noor Trading L.L.C." and "Noor Trading LLC" share one key
export function nameKey(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(al|el)[\s-]+/g, '')
    .replace(/\b(l\.?l\.?c|fz-?llc|fz-?e|fzco|fze|dmcc|ltd|limited|company|co|est|establishment|trading|group|holding|inc|plc|w\.?l\.?l|spc|sole proprietorship)\b\.?/g, ' ')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const GENERIC = /^(info|hello|hi|contact|contactus|sales|enquiries|enquiry|inquiries|inquiry|admin|office|mail|team|business|marketing|reception|bookings?|support|customercare|customerservice|care)$/i;
const NEVER = /^(careers?|jobs|hr|recruitment|cv|resumes?|noreply|no-reply|donotreply|privacy|legal|abuse|webmaster|postmaster|example|test|accounts?|billing|invoices?|press|media)$/i;
export const emailKind = email => { const local = String(email).split('@')[0]; return NEVER.test(local) ? 'never' : GENERIC.test(local) ? 'generic' : 'personal'; };
export const emailsIn = text => [...new Set((String(text).match(EMAIL_RE) || []).map(e => e.toLowerCase().replace(/^mailto:/, '').replace(/[.,;:]+$/, '')))]
  .filter(e => !/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e) && !/@(sentry|wixpress|example)\./.test(e));

// The grounding rule: a name, email or quote is kept only if it is really on the page.
const squash = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const onPage = (needle, page) => { const n = squash(needle); return n.length >= 3 && squash(page).includes(n); };

// Likely work addresses for a named person (latin names only; Arabic-script names are never guessed).
export function emailGuesses(fullName, domain) {
  const parts = String(fullName || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(dr|mr|mrs|ms|eng|prof)\.?\s+/g, '').split(/\s+/).filter(p => /^[a-z][a-z'-]*$/.test(p)).map(p => p.replace(/['-]/g, ''));
  if (parts.length < 2 || !domain) return [];
  const f = parts[0], l = parts[parts.length - 1];
  return [...new Set([`${f}.${l}`, `${f}`, `${f[0]}${l}`, `${f}${l}`, `${f[0]}.${l}`])].map(x => `${x}@${domain}`);
}

// Software visible in a page's HTML: useful facts and buying signals ("no booking system", "runs on Shopify").
const TECH = [['Shopify', /cdn\.shopify\.com|Shopify\.theme/i], ['WordPress', /wp-content|wp-includes/i], ['WooCommerce', /woocommerce/i],
  ['Wix', /wixstatic\.com|_wixCIDX/i], ['Squarespace', /squarespace\.com/i], ['Webflow', /webflow\.(com|io)/i], ['HubSpot', /js\.hs-scripts\.com|hs-analytics/i],
  ['Salesforce', /salesforce\.com|force\.com/i], ['Zoho', /zoho(cdn)?\.com/i], ['Google Analytics', /googletagmanager\.com|google-analytics\.com/i],
  ['Meta Pixel', /connect\.facebook\.net\/.*fbevents/i], ['WhatsApp chat', /wa\.me\/|api\.whatsapp\.com/i], ['Intercom', /widget\.intercom\.io/i],
  ['Zendesk', /zdassets\.com|zendesk/i], ['Tawk.to', /tawk\.to/i], ['Calendly', /calendly\.com/i], ['Fresha', /fresha\.com/i], ['Booksy', /booksy\.com/i],
  ['Salla', /salla\.(sa|network)/i], ['Zid', /zid\.(sa|store)/i]];
export const detectTech = html => TECH.filter(([, re]) => re.test(html || '')).map(([n]) => n);
