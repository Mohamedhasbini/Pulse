// Growth engine: the business brain. Reads a client's own website (plus the owner's notes) and writes its sales
// profile: what it sells, its proof points, and its ideal customer, which drives discovery, scoring and writing.
import { z } from 'zod';
import { crawl } from './services.js';
import { ask } from './ai.js';
import { domainOf } from './text.js';

// OpenStreetMap kinds of place the brain may pick; each maps to an Overpass tag filter (discover.js)
export const PLACE_KINDS = {
  office_company: [['office', 'company']], it_company: [['office', 'it']], consulting: [['office', 'consulting']],
  advertising_agency: [['office', 'advertising_agency']], estate_agent: [['office', 'estate_agent']], lawyer: [['office', 'lawyer']],
  accountant: [['office', 'accountant']], logistics: [['office', 'logistics'], ['office', 'moving_company']], architect: [['office', 'architect']],
  clinic: [['amenity', 'clinic'], ['healthcare', 'clinic']], dentist: [['amenity', 'dentist']], beauty_salon: [['shop', 'beauty']],
  hairdresser: [['shop', 'hairdresser']], gym: [['leisure', 'fitness_centre']], restaurant: [['amenity', 'restaurant']], cafe: [['amenity', 'cafe']],
  hotel: [['tourism', 'hotel']], school: [['amenity', 'school'], ['amenity', 'kindergarten']], car_dealer: [['shop', 'car']], retail_shop: [['shop', 'clothes'], ['shop', 'furniture']],
};

export const Profile = z.object({
  name: z.string(),
  offer: z.string().describe('One sentence: what the business sells and to whom.'),
  services: z.array(z.string()).max(12),
  proof_points: z.array(z.string()).max(8).describe('Trust facts stated on the site (clients, years, projects, certifications). Empty if none are stated.'),
  ideal_customer: z.object({
    summary: z.string().describe('One or two sentences describing the companies that buy this.'),
    sectors: z.array(z.string()).min(1).max(8),
    company_size: z.string().describe('e.g. "10-200 staff", "single-location clinics"'),
    cities: z.array(z.string()).min(1).max(6),
    roles: z.array(z.string()).min(1).max(6).describe('Job titles of the person who decides to buy.'),
    triggers: z.array(z.string()).max(6).describe('Moments when a company needs this (new office, funding, hiring, expansion...).'),
    exclude: z.array(z.string()).max(8).describe('Companies that are NOT a fit: competitors, enterprises, other countries...'),
  }),
  search_queries: z.array(z.string()).min(4).max(12).describe('Web searches that return websites of individual companies matching the ideal customer, e.g. "dental clinic Jumeirah Dubai", "logistics company Al Quoz". Avoid words that return directories ("best", "top 10", "list").'),
  place_kinds: z.array(z.enum(Object.keys(PLACE_KINDS))).max(5).describe('Map categories that match the ideal customer; empty if none fit.'),
  tone: z.string(),
  language: z.enum(['en', 'ar', 'both']),
});

const ABOUT = /about|who-?we-?are|services|solutions|what-?we-?do|industries|sectors|clients|portfolio|projects|case-?stud|من-?نحن|خدمات|عملاؤنا/i;

export async function buildProfile({ website, name = '', notes = '' }) {
  const domain = domainOf(website);
  if (!domain) throw new Error('That website address is not valid.');
  const home = `https://${domain}`;
  const [first] = await crawl([home]);
  if (!first?.ok || first.markdown.length < 150) throw new Error(`Could not read ${home}.`);
  const more = [...new Set(first.links.filter(l => domainOf(l) === domain && ABOUT.test(l)))].slice(0, 3);
  const pages = [first, ...(more.length ? await crawl(more).catch(() => []) : [])].filter(p => p.ok);
  const text = pages.map(p => `=== PAGE ${p.url}\n${p.markdown.slice(0, 9000)}`).join('\n\n').slice(0, 26000);
  const profile = await ask({
    kind: 'judge', schema: Profile,
    system: 'You build the sales profile of a business from its own website, so an AI can find it new B2B customers. '
      + 'Use only facts the pages state for services and proof points; never invent clients, numbers or certifications. '
      + 'For the ideal customer, reason from the services and any clients shown. The owner\'s notes override the website when they disagree. '
      + 'Customers are businesses in the Gulf unless the notes say otherwise; default city Dubai.',
    prompt: `BUSINESS: ${name || domain}\nWEBSITE: ${home}\nOWNER NOTES: ${notes || '(none)'}\n\nPAGES:\n${text}`,
  });
  return { ...profile, website: home, read_pages: pages.map(p => p.url) };
}
