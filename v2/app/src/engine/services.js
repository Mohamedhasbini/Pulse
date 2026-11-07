// Growth engine, layer 1: the outside services it uses (all self-hosted, see docs/repos.md).
//   Crawl4AI  reads web pages into clean text          ENGINE_CRAWL4AI_URL + CRAWL4AI_API_TOKEN
//   SearXNG   private web search                       ENGINE_SEARXNG_URL
//   Reacher   checks an email exists without sending   ENGINE_REACHER_URL + RCH__HEADER_SECRET
//   OpenStreetMap (Overpass)  places with a website    public API, attribution "© OpenStreetMap contributors"
// They are reached over the private Docker network "mxai-net" (docker-compose.override.yml).
const env = k => process.env[k] || '';
export const engineReady = () => !!(env('ENGINE_CRAWL4AI_URL') && env('ENGINE_SEARXNG_URL') && env('ENGINE_REACHER_URL'));

const timeout = ms => AbortSignal.timeout(ms);
const UA = 'MXAi-lab/1.0 (+https://nexfoyz.dev)';

// Web search: result links only (title, url, snippet). Several engines combined by SearXNG.
export async function search(query, { pages = 1 } = {}) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const r = await fetch(`${env('ENGINE_SEARXNG_URL')}/search?q=${encodeURIComponent(query)}&format=json&pageno=${p}`, { signal: timeout(25000) });
    if (!r.ok) throw new Error(`search failed (${r.status})`);
    const d = await r.json();
    out.push(...(d.results || []).map(x => ({ url: x.url, title: x.title || '', snippet: x.content || '' })));
  }
  return out;
}

// Read pages. Returns one entry per URL: { url, ok, markdown, html, links: [internal hrefs], status }.
export async function crawl(urls) {
  const r = await fetch(`${env('ENGINE_CRAWL4AI_URL')}/crawl`, {
    method: 'POST', signal: timeout(120000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('CRAWL4AI_API_TOKEN')}` },
    body: JSON.stringify({ urls }),
  });
  if (!r.ok) throw new Error(`crawl failed (${r.status})`);
  const d = await r.json();
  return (d.results || []).map(x => {
    const md = typeof x.markdown === 'object' && x.markdown ? x.markdown.raw_markdown : x.markdown;
    const links = [...(x.links?.internal || [])].map(l => (typeof l === 'string' ? l : l.href)).filter(Boolean);
    return { url: x.url, ok: !!x.success, markdown: String(md || ''), html: String(x.html || ''), links, status: x.status_code };
  });
}

// Email check over SMTP (nothing is sent). valid | catch_all (server accepts any address) | invalid | unknown
export async function checkEmail(email) {
  const r = await fetch(`${env('ENGINE_REACHER_URL')}/v0/check_email`, {
    method: 'POST', signal: timeout(90000),
    headers: { 'Content-Type': 'application/json', 'x-reacher-secret': env('RCH__HEADER_SECRET') },
    body: JSON.stringify({ to_email: email }),
  });
  if (!r.ok) throw new Error(`email check failed (${r.status})`);
  const d = await r.json();
  const smtp = d.smtp || {};
  const status = smtp.is_catch_all ? 'catch_all' : d.is_reachable === 'safe' ? 'valid' : d.is_reachable === 'invalid' ? 'invalid' : 'unknown';
  return { status, reachable: d.is_reachable, disposable: !!d.misc?.is_disposable, role: !!d.misc?.is_role_account };
}

// OpenStreetMap: named places with a website inside a box [south, west, north, east], for the given tag filters
// such as ['office'], ['amenity','dentist'], ['healthcare'], ['shop','hairdresser'].
export async function osmPlaces(filters, bbox = [24.95, 54.95, 25.40, 55.60]) {
  const box = bbox.join(',');
  const parts = filters.map(([k, v]) => `nwr["${k}"${v ? `="${v}"` : ''}]["website"]["name"](${box});`).join('');
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', signal: timeout(120000), headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(`[out:json][timeout:90];(${parts});out tags;`),
  });
  if (!r.ok) throw new Error(`OpenStreetMap failed (${r.status})`);
  const d = await r.json();
  return (d.elements || []).map(e => ({ name: e.tags.name, website: e.tags.website || e.tags['contact:website'], phone: e.tags.phone || e.tags['contact:phone'] || null,
    kind: Object.entries(e.tags).filter(([k]) => ['office', 'amenity', 'healthcare', 'shop', 'craft'].includes(k)).map(([k, v]) => `${k}=${v}`).join(',') }));
}
