// Growth engine: discovery. Finds candidate companies for a client's ideal customer from two legal sources:
// web search (SearXNG: only links; we then read each company's own site) and OpenStreetMap places with a website.
// Directories, marketplaces, news sites and government pages are dropped; one candidate per website domain.
import { search, osmPlaces } from './services.js';
import { domainOf, isDirectory } from './text.js';
import { PLACE_KINDS } from './brain.js';

// boxes for the cities MXAi serves first (south, west, north, east)
const BOXES = { dubai: [24.95, 54.95, 25.40, 55.60], 'abu dhabi': [24.20, 54.25, 24.60, 54.75], sharjah: [25.25, 55.35, 25.42, 55.60], riyadh: [24.45, 46.45, 25.00, 47.00], jeddah: [21.35, 39.05, 21.80, 39.30] };
const LIST_PAGE = /\b(top \d+|best \d+|\d+ best|list of|directory|near me|reviews?)\b/i;

export async function discover(profile, { want = 80, exclude = new Set(), log = () => {} } = {}) {
  const found = new Map();
  const own = domainOf(profile.website);
  const add = (c) => {
    const d = domainOf(c.website);
    if (!d || d === own || isDirectory(d) || exclude.has(d) || found.has(d)) return;
    found.set(d, { ...c, domain: d, website: `https://${d}` });
  };

  // 1. web search, page by page, until there are plenty of candidates
  for (const q of profile.search_queries || []) {
    if (found.size >= want) break;
    for (const r of await search(q, { pages: 2 }).catch(e => { log(`search "${q}" failed: ${e.message}`); return []; })) {
      if (LIST_PAGE.test(r.title)) continue;
      add({ name: r.title.split(/[|\-–—:]/)[0].trim(), website: r.url, found_via: 'search', hint: r.snippet.slice(0, 300), query: q });
    }
    log(`search "${q}": ${found.size} candidates`);
  }

  // 2. OpenStreetMap places in the client's cities that match its customer kinds
  const filters = (profile.place_kinds || []).flatMap(k => PLACE_KINDS[k] || []);
  const boxes = (profile.ideal_customer?.cities || ['Dubai']).map(c => BOXES[String(c).toLowerCase().trim()]).filter(Boolean);
  if (filters.length && found.size < want * 2) {
    for (const box of boxes.length ? boxes : [BOXES.dubai]) {
      const places = await osmPlaces(filters, box).catch(e => { log(`OpenStreetMap failed: ${e.message}`); return []; });
      for (const p of places) if (p.website) add({ name: p.name, website: p.website, found_via: 'osm', hint: p.kind, phone: p.phone });
      log(`OpenStreetMap: ${places.length} places, ${found.size} candidates`);
    }
  }
  return [...found.values()];
}
