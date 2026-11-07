// Growth engine: enrichment. Reads a candidate's own website (home + contact/about/team pages), extracts the company
// facts and the people and addresses it publishes, and keeps only what is really on those pages (the grounding rule).
// Every fact is stored with its page and quote in eng_facts. Results are reused for 30 days.
import { z } from 'zod';
import { q, one } from '../db.js';
import { crawl } from './services.js';
import { ask } from './ai.js';
import { domainOf, nameKey, emailsIn, emailKind, onPage, detectTech } from './text.js';

const MORE = /contact|about|team|leadership|management|our-?people|who-?we-?are|company|اتصل|تواصل|فريق|من-?نحن/i;
const FRESH_DAYS = 30;

const Extract = z.object({
  is_company: z.boolean().describe('true only if these pages are the website of ONE specific business. false for directories, marketplaces, news, blogs, job boards, government or personal pages.'),
  name: z.string().nullable(),
  description: z.string().nullable().describe('What the company does, one sentence, based on the pages.'),
  sector: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  size_hint: z.string().nullable().describe('Only if stated: staff count, branches, years in business.'),
  people: z.array(z.object({
    name: z.string().describe('Full name exactly as written on the page.'),
    role: z.string().nullable(),
    quote: z.string().describe('The exact sentence or line from the page that shows this name.'),
  })).max(12),
  phones: z.array(z.string()).max(4),
});

export async function enrich(candidate, { log = () => {} } = {}) {
  const domain = domainOf(candidate.website);
  const known = await one('SELECT * FROM eng_companies WHERE domain=$1', [domain]);
  if (known?.crawled_at && Date.now() - new Date(known.crawled_at) < FRESH_DAYS * 864e5) return known;

  const [home] = await crawl([`https://${domain}`]);
  if (!home?.ok || home.markdown.length < 120) {
    const row = await upsertCompany(domain, { name: candidate.name, is_company: false, found_via: candidate.found_via });
    log(`${domain}: site not readable`);
    return row;
  }
  const extra = [...new Set(home.links.filter(l => domainOf(l) === domain && MORE.test(l)))].slice(0, 3);
  const pages = [home, ...(extra.length ? await crawl(extra).catch(() => []) : [])].filter(p => p.ok);
  const text = pages.map(p => `=== PAGE ${p.url}\n${p.markdown.slice(0, 7000)}`).join('\n\n').slice(0, 22000);
  const all = pages.map(p => p.markdown + '\n' + p.html).join('\n');

  const x = await ask({
    kind: 'read', schema: Extract,
    system: 'You read a company website and copy facts from it. Copy names and roles exactly as written. '
      + 'Never guess or complete a name, role, city or size: if a page does not say it, use null or leave the list empty.',
    prompt: `WEBSITE: https://${domain}\nSEARCH HINT: ${candidate.hint || ''}\n\n${text}`,
  });

  // the grounding rule: only names that are really on the pages; only addresses found in the pages' own text
  const people = (x.people || []).filter(p => onPage(p.name, all)).slice(0, 8);
  const emails = emailsIn(all).filter(e => emailKind(e) !== 'never');
  const tech = detectTech(pages.map(p => p.html).join('\n'));

  const row = await upsertCompany(domain, {
    name: x.name || candidate.name, website: `https://${domain}`, city: x.city, country: x.country, sector: x.sector, size_hint: x.size_hint,
    description: x.description, tech, is_company: x.is_company, found_via: candidate.found_via,
  });
  await q('DELETE FROM eng_facts WHERE company_id=$1', [row.id]);
  const src = home.url;
  for (const [field, value] of Object.entries({ name: x.name, description: x.description, sector: x.sector, city: x.city, country: x.country, size_hint: x.size_hint }))
    if (value) await q('INSERT INTO eng_facts (company_id, field, value, source_url) VALUES ($1,$2,$3,$4)', [row.id, field, String(value).slice(0, 500), src]);
  if (candidate.query) await q(`INSERT INTO eng_facts (company_id, field, value, source_url) VALUES ($1,'found_by_search',$2,NULL)`, [row.id, candidate.query]);

  // people and published addresses become contacts (emails are checked later in verify.js)
  for (const p of people) {
    const page = pages.find(pg => onPage(p.name, pg.markdown + pg.html)) || home;
    await q(`INSERT INTO eng_contacts (company_id, name, role, source_url, quote) SELECT $1,$2,$3,$4,$5
      WHERE NOT EXISTS (SELECT 1 FROM eng_contacts WHERE company_id=$1 AND lower(name)=lower($2))`, [row.id, p.name.slice(0, 120), p.role?.slice(0, 120) || null, page.url, p.quote?.slice(0, 300) || null]);
  }
  for (const e of emails.slice(0, 6)) {
    const page = pages.find(pg => (pg.markdown + pg.html).toLowerCase().includes(e)) || home;
    await q(`INSERT INTO eng_contacts (company_id, email, email_kind, source_url) VALUES ($1,$2,$3,$4) ON CONFLICT (company_id, email) DO NOTHING`,
      [row.id, e, emailKind(e) === 'generic' ? 'generic' : 'published', page.url]);
  }
  log(`${domain}: ${x.is_company ? 'company' : 'not a company'}, ${people.length} people, ${emails.length} emails`);
  return row;
}

async function upsertCompany(domain, c) {
  return one(`INSERT INTO eng_companies (domain, name, name_key, website, city, country, sector, size_hint, description, tech, is_company, found_via, crawled_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
    ON CONFLICT (domain) DO UPDATE SET name=EXCLUDED.name, name_key=EXCLUDED.name_key, website=COALESCE(EXCLUDED.website, eng_companies.website),
      city=EXCLUDED.city, country=EXCLUDED.country, sector=EXCLUDED.sector, size_hint=EXCLUDED.size_hint, description=EXCLUDED.description,
      tech=EXCLUDED.tech, is_company=EXCLUDED.is_company, crawled_at=now(), embedding=NULL
    RETURNING *`,
  [domain, c.name?.slice(0, 160) || null, nameKey(c.name), c.website || `https://${domain}`, c.city || null, c.country || null, c.sector || null,
    c.size_hint || null, c.description?.slice(0, 600) || null, JSON.stringify(c.tech || []), c.is_company ?? null, c.found_via || null]);
}
