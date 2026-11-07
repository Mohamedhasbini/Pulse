// Lead pool routes.
//   Public:  GET/POST /f/:slug (capture form, ALTCHA bot filter), GET /c/:token (double opt-in), GET+POST /u/:token (opt-out),
//            GET /api/altcha (challenge), POST /hooks/google/:formId, GET+POST /hooks/meta (lead ads)
//            POST /v/send + /v/check (one-time code after a form, signed token)
//   Admin:   /api/pool/* (people with filters, one person, forms, country rules, decision check, saved views, stats,
//            duplicates and merging, daily upkeep runs)
import crypto from 'node:crypto';
import { createChallenge, verifySolution, randomInt } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { q, one } from '../db.js';
import { ingest, withdraw, rescore } from './capture.js';
import { decide, seedRules, ruleFor } from './rules.js';
import { verifyCert, isOptOut, normEmail, normPhone, idHash, keysReady } from './core.js';
import { CHANNELS } from './countries.js';
import { renderForm, renderMessage } from './form-page.js';
import { sendCode, checkCode, providerStatus } from './codes.js';
import { listCandidates, mergePeople, markDifferent } from './dedupe.js';
import { upkeep, lastRuns, startJobs } from './jobs.js';
import { TEXTABLE } from './checks.js';

const KEY = () => process.env.CERT_KEY || '';
const ALTCHA = { algorithm: 'PBKDF2/SHA-256', deriveKey, hmacSignatureSecret: () => process.env.ALTCHA_KEY || '', hmacKeySignatureSecret: () => (process.env.ALTCHA_KEY || '') + ':key' };
const sign = v => crypto.createHmac('sha256', KEY()).update(String(v)).digest('base64url').slice(0, 24);
export const unsubToken = personId => `${personId}.${sign('u:' + personId)}`;
const readToken = t => { const [id, s] = String(t || '').split('.'); return id && s && s === sign('u:' + id) ? +id : null; };
// after a form: lets the same browser ask for and check a code for that person only, for one hour
export const verifyToken = (personId, at = Date.now()) => `${personId}.${at}.${sign(`v:${personId}:${at}`)}`;
const readVerify = t => { const [id, at, s] = String(t || '').split('.'); return id && at && s === sign(`v:${id}:${at}`) && Date.now() - +at < 3600e3 ? +id : null; };

const hits = new Map();
const limited = (key, max, ms) => { const now = Date.now(), h = (hits.get(key) || []).filter(t => now - t < ms); h.push(now); hits.set(key, h); return h.length > max; };
setInterval(() => hits.clear(), 3600e3).unref();
const ipOf = req => String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '').slice(0, 64);

async function checkAltcha(raw) {
  try {
    const p = JSON.parse(Buffer.from(String(raw || ''), 'base64').toString('utf8'));
    const r = await verifySolution({ challenge: p.challenge, solution: p.solution, deriveKey: ALTCHA.deriveKey,
      hmacSignatureSecret: ALTCHA.hmacSignatureSecret(), hmacKeySignatureSecret: ALTCHA.hmacKeySignatureSecret() });
    return !!r?.verified;
  } catch { return false; }
}

// the consent sentence a person ticks, naming every business and the channel
export function consentText(form, clients, channel) {
  const names = clients.map(c => c.name).join(', ');
  const how = { email: 'email', sms: 'text message', whatsapp: 'WhatsApp', call: 'phone call', ai_call: 'automated (AI) phone call' }[channel];
  return `I agree that ${names} may contact me by ${how} about ${form.purpose}. I can opt out at any time.`;
}

export async function startPool() {
  await seedRules();
  startJobs().catch(e => console.error('Lead pool jobs did not start:', e.message));
}

export function mountPool(app, { adminOnly, wrap }) {
  // ---------- public: forms ----------
  app.get('/api/altcha', wrap(async (_req, res) => {
    const ch = await createChallenge({ algorithm: ALTCHA.algorithm, cost: 5000, counter: randomInt(5000, 10000), deriveKey: ALTCHA.deriveKey,
      hmacSignatureSecret: ALTCHA.hmacSignatureSecret(), hmacKeySignatureSecret: ALTCHA.hmacKeySignatureSecret(), expiresAt: new Date(Date.now() + 10 * 60000) });
    res.set('Cache-Control', 'no-store').json(ch);
  }));

  const loadForm = slug => one(`SELECT * FROM lp_forms WHERE slug=$1 AND active`, [String(slug).slice(0, 80)]);
  const formClients = async f => q(`SELECT id, name FROM eng_clients WHERE id = ANY($1) ORDER BY array_position($1, id)`, [[f.client_id, ...(f.partners || [])]]);
  const framable = res => { res.removeHeader('X-Frame-Options'); res.set('Content-Security-Policy', "frame-ancestors *"); };

  app.get('/f/:slug', wrap(async (req, res) => {
    const f = await loadForm(req.params.slug);
    if (!f) return res.status(404).send(renderMessage('Form not found', 'This form is not available.'));
    framable(res);
    const clients = await formClients(f);
    res.send(renderForm(f, clients, Object.fromEntries(f.channels.map(ch => [ch, consentText(f, clients, ch)]))));
  }));

  app.post('/f/:slug', wrap(async (req, res) => {
    const f = await loadForm(req.params.slug);
    if (!f) return res.status(404).json({ error: 'This form is not available.' });
    framable(res);
    if (limited(`f:${ipOf(req)}`, 8, 10 * 60000)) return res.status(429).json({ error: 'Too many submissions. Try again in a few minutes.' });
    const b = req.body || {};
    if (b.website) return res.json({ ok: true });                                       // honeypot: bots fill hidden fields
    if (!(await checkAltcha(b.altcha))) return res.status(400).json({ error: 'Please confirm you are not a robot.' });
    if (!b.agree_terms) return res.status(400).json({ error: 'Please accept the privacy notice to send your request.' });
    const clients = await formClients(f);
    const attributes = {}; const fields = f.fields || [];
    for (const fd of fields) if (!['name', 'email', 'phone', 'city', 'intent', 'budget', 'timing'].includes(fd.key) && b[fd.key] != null && b[fd.key] !== '' && !/prefer not to say/i.test(b[fd.key])) attributes[fd.key] = b[fd.key];
    const consents = f.channels.filter(ch => b[`consent_${ch}`]).map(ch => ({ channel: ch, purpose: 'marketing', buyers: clients.map(c => c.id), text: consentText(f, clients, ch), method: 'checkbox' }));
    // the request itself: the business may reply about it (service), on the channels the person gave
    consents.push({ channel: normEmail(b.email) ? 'email' : 'whatsapp', purpose: 'service', buyers: [f.client_id], text: `I ask ${clients[0]?.name} to contact me about my request.`, method: 'checkbox' });
    try {
      const r = await ingest({ clientId: f.client_id, source: `form:${f.id}`, name: b.name, email: b.email, phone: b.phone, country: b.country || f.country, city: b.city,
        language: f.language, attributes, interest: { vertical: f.vertical, intent: b.intent, budget: b.budget, timing: b.timing }, consents, event: 'form_submit',
        page_url: String(req.headers.referer || `/f/${f.slug}`).slice(0, 500), ip: ipOf(req), user_agent: req.headers['user-agent'],
        evidence: { form_id: f.id, form_version: f.version, utm: pick(b, ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']), click: pick(b, ['gclid', 'fbclid', 'ttclid']) } });
      const needConfirm = await one(`SELECT confirm_token FROM lp_consents WHERE id = ANY($1) AND confirm_token IS NOT NULL LIMIT 1`, [r.consentIds]);
      // prove the mobile number: offer a code when the form asks for it and the number can receive messages
      const phone = f.verify_phone ? await one(`SELECT value, line_type FROM lp_identities WHERE person_id=$1 AND kind='phone' AND verified_at IS NULL ORDER BY id DESC LIMIT 1`, [r.personId]) : null;
      const verify = phone && TEXTABLE.has(phone.line_type) ? { token: verifyToken(r.personId), ending: phone.value.slice(-3) } : null;
      res.json({ ok: true, confirm: !!needConfirm, verify });
    } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong. Please try again.' }); }
  }));

  // one-time code, asked for by the person right after the form
  app.post('/v/send', wrap(async (req, res) => {
    const id = readVerify(req.body?.t);
    if (!id) return res.status(400).json({ error: 'This page has expired. Please send the form again.' });
    if (limited(`v:${ipOf(req)}`, 6, 60 * 60000)) return res.status(429).json({ error: 'Too many codes. Try again later.' });
    try { const r = await sendCode(id, req.body?.channel === 'sms' ? 'sms' : 'whatsapp'); res.json({ ok: true, channel: r.channel, already: !!r.already }); }
    catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'The code could not be sent. Please try again.' }); }
  }));
  app.post('/v/check', wrap(async (req, res) => {
    const id = readVerify(req.body?.t);
    if (!id) return res.status(400).json({ error: 'This page has expired. Please send the form again.' });
    if (limited(`vc:${ipOf(req)}`, 20, 60 * 60000)) return res.status(429).json({ error: 'Too many tries. Try again later.' });
    const r = await checkCode(id, req.body?.code);
    res.status(r.ok ? 200 : 400).json(r);
  }));

  // double opt-in confirmation link (sent by email in DE/AT/CH)
  app.get('/c/:token', wrap(async (req, res) => {
    const c = await one(`UPDATE lp_consents SET confirmed_at=now(), confirm_token=NULL WHERE confirm_token=$1 AND withdrawn_at IS NULL RETURNING person_id`, [String(req.params.token).slice(0, 60)]);
    if (c) await q(`INSERT INTO lp_events (person_id, type, source) VALUES ($1,'consent_confirmed','double_opt_in')`, [c.person_id]);
    res.send(renderMessage(c ? 'Thank you' : 'Link not valid', c ? 'Your subscription is confirmed.' : 'This confirmation link has expired or was already used.'));
  }));

  // opt-out link in every message: one click, any channel
  const optOutPage = (id, done) => renderMessage(done ? 'You are unsubscribed' : 'Unsubscribe', done ? 'You will not receive marketing messages from us any more.' : 'Confirm to stop all marketing messages.', done ? null : `/u/${id}`);
  app.get('/u/:token', wrap(async (req, res) => { const id = readToken(req.params.token); res.send(id ? optOutPage(req.params.token, false) : renderMessage('Link not valid', 'This unsubscribe link is not valid.')); }));
  app.post('/u/:token', wrap(async (req, res) => { const id = readToken(req.params.token); if (!id) return res.status(400).send(renderMessage('Link not valid', 'This unsubscribe link is not valid.')); await withdraw(id, { how: 'unsubscribe_link' }); res.send(optOutPage(req.params.token, true)); }));

  // ---------- public: ad platforms ----------
  // Google lead form extension: JSON with google_key; the key per form is stored in the form's fields meta
  app.post('/hooks/google/:formId', wrap(async (req, res) => {
    const f = await one('SELECT * FROM lp_forms WHERE id=$1', [+req.params.formId]);
    const key = f?.fields?.find?.(x => x.key === '_google_key')?.value;
    if (!f || !key || req.body?.google_key !== key) return res.sendStatus(403);
    const col = Object.fromEntries((req.body.user_column_data || []).map(c => [String(c.column_id || c.column_name || '').toUpperCase(), c.string_value]));
    const clients = await formClients(f);
    await ingest({ clientId: f.client_id, source: 'google_lead', name: col.FULL_NAME || [col.FIRST_NAME, col.LAST_NAME].filter(Boolean).join(' '), email: col.EMAIL, phone: col.PHONE_NUMBER,
      country: f.country, city: col.CITY, interest: { vertical: f.vertical }, event: 'ad_lead', evidence: { google_lead_id: req.body.lead_id, campaign_id: req.body.campaign_id, gclid: req.body.gcl_id },
      consents: [{ channel: 'email', purpose: 'service', buyers: [f.client_id], text: `Google lead form for ${clients[0]?.name}`, method: 'ad_form' }] }).catch(() => {});
    res.json({});
  }));
  // Meta lead ads: verification handshake, then signed notifications carrying a leadgen_id (fetched with the page token)
  app.get('/hooks/meta', (req, res) => (req.query['hub.verify_token'] && req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN ? res.send(String(req.query['hub.challenge'] || '')) : res.sendStatus(403)));
  app.post('/hooks/meta', wrap(async (req, res) => {
    const sig = String(req.headers['x-hub-signature-256'] || ''), secret = process.env.META_APP_SECRET || '';
    const expect = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || JSON.stringify(req.body || {})).digest('hex');
    if (!secret || sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return res.sendStatus(403);
    for (const e of req.body?.entry || []) for (const ch of e.changes || []) if (ch.field === 'leadgen')
      await q(`INSERT INTO lp_events (type, source, payload) VALUES ('ad_lead_pending','meta_lead',$1)`, [JSON.stringify({ leadgen_id: ch.value?.leadgen_id, form_id: ch.value?.form_id, page_id: ch.value?.page_id, ad_id: ch.value?.ad_id })]);
    res.sendStatus(200);
  }));

  // ---------- admin: the pool ----------
  app.get('/api/pool/facets', adminOnly, wrap(async (_req, res) => {
    const [countries, cities, verticals, sources, genders, ages, timings, statuses, totals] = await Promise.all([
      q(`SELECT country AS v, count(*)::int AS n FROM lp_persons WHERE country IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 60`),
      q(`SELECT city AS v, count(*)::int AS n FROM lp_persons WHERE city IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 60`),
      q(`SELECT vertical AS v, count(DISTINCT person_id)::int AS n FROM lp_interests GROUP BY 1 ORDER BY 2 DESC`),
      q(`SELECT split_part(source, ':', 1) AS v, count(DISTINCT person_id)::int AS n FROM lp_events WHERE person_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
      q(`SELECT lower(value) AS v, count(DISTINCT person_id)::int AS n FROM lp_attributes WHERE key='gender' GROUP BY 1 ORDER BY 2 DESC`),
      q(`SELECT value AS v, count(DISTINCT person_id)::int AS n FROM lp_attributes WHERE key='age_range' GROUP BY 1 ORDER BY 1`),
      q(`SELECT timing AS v, count(DISTINCT person_id)::int AS n FROM lp_interests WHERE timing IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
      q(`SELECT status AS v, count(*)::int AS n FROM lp_persons GROUP BY 1 ORDER BY 2 DESC`),
      one(`SELECT count(*)::int AS people, count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_7d,
        (SELECT count(DISTINCT person_id)::int FROM lp_consents WHERE purpose='marketing' AND withdrawn_at IS NULL) AS consented,
        (SELECT count(DISTINCT i.person_id)::int FROM lp_suppressions s JOIN lp_identities i ON i.value_hash=s.value_hash WHERE s.scope='global') AS opted_out,
        (SELECT count(DISTINCT person_id)::int FROM lp_identities WHERE verified_at IS NOT NULL) AS verified,
        (SELECT count(*)::int FROM lp_merge_candidates WHERE status='open') AS duplicates,
        round(avg(score))::int AS avg_score FROM lp_persons`)]);
    res.json({ countries, cities, verticals, sources, genders, ages, timings, statuses, totals, channels: CHANNELS });
  }));

  // people with filters; every filter is a parameter, never pasted into SQL
  app.post('/api/pool/people', adminOnly, wrap(async (req, res) => {
    const f = req.body?.filters || {}, w = ['true'], p = [];
    const add = (sql, v) => { p.push(v); w.push(sql.replaceAll('$?', `$${p.length}`)); };
    const arr = v => (Array.isArray(v) ? v : []).map(String).slice(0, 100);
    if (f.q) add(`(p.full_name ILIKE $? OR EXISTS (SELECT 1 FROM lp_identities i WHERE i.person_id=p.id AND i.value ILIKE $?))`, `%${String(f.q).slice(0, 80)}%`);
    if (arr(f.countries).length) add(`p.country = ANY($?)`, arr(f.countries));
    if (arr(f.cities).length) add(`p.city = ANY($?)`, arr(f.cities));
    if (arr(f.statuses).length) add(`p.status = ANY($?)`, arr(f.statuses));
    if (arr(f.verticals).length) add(`EXISTS (SELECT 1 FROM lp_interests t WHERE t.person_id=p.id AND t.vertical = ANY($?))`, arr(f.verticals));
    if (arr(f.timings).length) add(`EXISTS (SELECT 1 FROM lp_interests t WHERE t.person_id=p.id AND t.timing = ANY($?))`, arr(f.timings));
    if (arr(f.genders).length) add(`EXISTS (SELECT 1 FROM lp_attributes a WHERE a.person_id=p.id AND a.key='gender' AND lower(a.value) = ANY($?))`, arr(f.genders));
    if (arr(f.ages).length) add(`EXISTS (SELECT 1 FROM lp_attributes a WHERE a.person_id=p.id AND a.key='age_range' AND a.value = ANY($?))`, arr(f.ages));
    if (arr(f.sources).length) add(`EXISTS (SELECT 1 FROM lp_events e WHERE e.person_id=p.id AND split_part(e.source, ':', 1) = ANY($?))`, arr(f.sources));
    if (arr(f.consent).length) add(`EXISTS (SELECT 1 FROM lp_consents c WHERE c.person_id=p.id AND c.purpose='marketing' AND c.withdrawn_at IS NULL AND c.channel = ANY($?))`, arr(f.consent));
    if (f.minScore) add(`p.score >= $?`, +f.minScore || 0);
    if (f.since) add(`p.created_at >= $?::timestamptz`, String(f.since));
    if (f.hasEmail) w.push(`EXISTS (SELECT 1 FROM lp_identities i WHERE i.person_id=p.id AND i.kind='email')`);
    if (f.verified) w.push(`EXISTS (SELECT 1 FROM lp_identities i WHERE i.person_id=p.id AND i.verified_at IS NOT NULL)`);
    if (f.hasPhone) w.push(`EXISTS (SELECT 1 FROM lp_identities i WHERE i.person_id=p.id AND i.kind='phone')`);
    if (!f.includeOptedOut) w.push(`NOT EXISTS (SELECT 1 FROM lp_suppressions s JOIN lp_identities i ON i.value_hash=s.value_hash WHERE i.person_id=p.id AND s.scope='global')`);
    const sorts = { score: 'p.score DESC', newest: 'p.created_at DESC', name: 'p.full_name NULLS LAST', recent: 'p.last_seen_at DESC' };
    const order = sorts[req.body?.sort] || sorts.score;
    const limit = Math.min(Math.max(+req.body?.limit || 50, 1), 200), offset = Math.max(+req.body?.offset || 0, 0);
    const where = w.join(' AND ');
    const [rows, total] = await Promise.all([
      q(`SELECT p.id, p.full_name, p.country, p.city, p.language, p.status, p.score, p.created_at, p.last_seen_at, p.owner_client_id,
          (SELECT value FROM lp_identities i WHERE i.person_id=p.id AND i.kind='email' ORDER BY i.id LIMIT 1) AS email,
          (SELECT value FROM lp_identities i WHERE i.person_id=p.id AND i.kind='phone' ORDER BY i.id LIMIT 1) AS phone,
          EXISTS (SELECT 1 FROM lp_identities i WHERE i.person_id=p.id AND i.kind='phone' AND i.verified_at IS NOT NULL) AS phone_verified,
          (SELECT line_type FROM lp_identities i WHERE i.person_id=p.id AND i.kind='phone' ORDER BY i.id LIMIT 1) AS phone_line,
          (SELECT status FROM lp_identities i WHERE i.person_id=p.id AND i.kind='email' ORDER BY i.id LIMIT 1) AS email_status,
          (SELECT json_object_agg(key, value) FROM (SELECT DISTINCT ON (key) key, value FROM lp_attributes a WHERE a.person_id=p.id ORDER BY key, observed_at DESC) x) AS attrs,
          (SELECT json_agg(json_build_object('vertical', vertical, 'timing', timing, 'budget', budget, 'intent', intent) ORDER BY created_at DESC) FROM lp_interests t WHERE t.person_id=p.id) AS interests,
          (SELECT array_agg(DISTINCT channel) FROM lp_consents c WHERE c.person_id=p.id AND c.purpose='marketing' AND c.withdrawn_at IS NULL) AS consent_channels,
          (SELECT split_part(source, ':', 1) FROM lp_events e WHERE e.person_id=p.id ORDER BY at LIMIT 1) AS first_source
        FROM lp_persons p WHERE ${where} ORDER BY ${order}, p.id DESC LIMIT ${limit} OFFSET ${offset}`, p),
      one(`SELECT count(*)::int AS n FROM lp_persons p WHERE ${where}`, p)]);
    res.json({ total: total.n, rows });
  }));

  app.get('/api/pool/people/:id', adminOnly, wrap(async (req, res) => {
    const id = +req.params.id;
    const p = await one('SELECT * FROM lp_persons WHERE id=$1', [id]);
    if (!p) return res.sendStatus(404);
    const [identities, attributes, interests, consents, events, decisions, deliveries] = await Promise.all([
      q('SELECT kind, value, verified_at, verified_via, status, line_type, check_source, checked_at, created_at FROM lp_identities WHERE person_id=$1 ORDER BY id', [id]),
      q('SELECT key, value, source, confidence, observed_at FROM lp_attributes WHERE person_id=$1 ORDER BY key, observed_at DESC', [id]),
      q('SELECT vertical, intent, budget, timing, score, source, created_at FROM lp_interests WHERE person_id=$1 ORDER BY created_at DESC', [id]),
      q(`SELECT c.*, t.text, t.text_hash, (SELECT array_agg(name) FROM eng_clients WHERE id = ANY(c.buyers)) AS buyer_names FROM lp_consents c LEFT JOIN lp_consent_texts t ON t.id=c.text_id WHERE c.person_id=$1 ORDER BY c.captured_at DESC`, [id]),
      q('SELECT type, source, payload, at FROM lp_events WHERE person_id=$1 ORDER BY at DESC LIMIT 50', [id]),
      q('SELECT channel, purpose, client_id, allowed, reason, at FROM lp_rule_log WHERE person_id=$1 ORDER BY at DESC LIMIT 30', [id]),
      q('SELECT client_id, exclusive, price, at FROM lp_deliveries WHERE person_id=$1 ORDER BY at DESC', [id])]);
    const rule = await ruleFor(p.country);
    const duplicates = await q(`SELECT m.id, m.score, m.reasons, o.id AS other_id, o.full_name AS other_name FROM lp_merge_candidates m JOIN lp_persons o ON o.id = CASE WHEN m.a=$1 THEN m.b ELSE m.a END
      WHERE (m.a=$1 OR m.b=$1) AND m.status='open' ORDER BY m.score DESC`, [id]);
    // what may be sent right now, per channel, for the owner business (no log: just a look)
    const now = {};
    for (const ch of CHANNELS) now[ch] = await decide({ personId: id, channel: ch, purpose: 'marketing', clientId: p.owner_client_id, log: false });
    res.json({ person: p, identities, duplicates, attributes, interests, decisions, deliveries, events, rule: { country: rule.country, name: rule.name, note: rule.note, channels: rule.channels, quiet: rule.quiet, tz: rule.tz },
      consents: consents.map(c => ({ ...c, certificate_valid: verifyCert({ ...c, text_hash: c.text_hash }), awaiting_confirm: !!c.confirm_token, confirm_token: undefined })), allowed_now: now, unsubscribe_url: `/u/${unsubToken(id)}` });
  }));

  app.post('/api/pool/people/:id/opt-out', adminOnly, wrap(async (req, res) => res.json(await withdraw(+req.params.id, { how: 'admin', channel: CHANNELS.includes(req.body?.channel) ? req.body.channel : null }))));
  app.post('/api/pool/people/:id/status', adminOnly, wrap(async (req, res) => {
    const s = ['new', 'qualified', 'contacted', 'booked', 'won', 'lost'].includes(req.body?.status) ? req.body.status : null;
    if (!s) return res.status(400).json({ error: 'Unknown status.' });
    await q('UPDATE lp_persons SET status=$2, updated_at=now() WHERE id=$1', [+req.params.id, s]);
    res.json({ ok: true });
  }));
  // a message that came in (any channel): opt-out words withdraw consent at once
  app.post('/api/pool/inbound', adminOnly, wrap(async (req, res) => {
    const email = normEmail(req.body?.from), phone = email ? null : normPhone(req.body?.from);
    const ident = email ? { kind: 'email', value: email } : phone ? { kind: 'phone', value: phone.value } : null;
    if (!ident) return res.status(400).json({ error: 'Unknown sender.' });
    const i = await one('SELECT person_id FROM lp_identities WHERE kind=$1 AND value_hash=$2', [ident.kind, idHash(ident.kind, ident.value)]);
    if (!i) return res.json({ known: false });
    const stop = isOptOut(req.body?.text);
    if (stop) await withdraw(i.person_id, { how: 'reply_stop' });
    res.json({ known: true, personId: i.person_id, optOut: stop });
  }));
  app.post('/api/pool/check', adminOnly, wrap(async (req, res) => res.json(await decide({ personId: +req.body?.personId, channel: String(req.body?.channel || ''), purpose: req.body?.purpose === 'service' ? 'service' : 'marketing', clientId: +req.body?.clientId || null, log: false }))));

  // forms
  app.get('/api/pool/forms', adminOnly, wrap(async (_req, res) => res.json(await q(`SELECT f.*, c.name AS client_name,
      (SELECT count(DISTINCT person_id)::int FROM lp_events e WHERE e.source = 'form:' || f.id) AS leads FROM lp_forms f LEFT JOIN eng_clients c ON c.id=f.client_id ORDER BY f.id DESC`))));
  app.post('/api/pool/forms', adminOnly, wrap(async (req, res) => {
    const b = req.body || {};
    const client = await one('SELECT id FROM eng_clients WHERE id=$1', [+b.client_id]);
    if (!client || !b.title || !b.vertical || !b.purpose) return res.status(400).json({ error: 'Business, title, sector and purpose are needed.' });
    const fields = Array.isArray(b.fields) && b.fields.length ? b.fields : DEFAULT_FIELDS;
    const slug = `${String(b.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'form'}-${crypto.randomBytes(3).toString('hex')}`;
    const channels = (Array.isArray(b.channels) ? b.channels : ['email', 'whatsapp']).filter(c => CHANNELS.includes(c));
    const partners = (Array.isArray(b.partners) ? b.partners : []).map(Number).filter(Boolean);
    const row = await one(`INSERT INTO lp_forms (slug, client_id, title, intro, vertical, country, language, fields, channels, partners, purpose) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [slug, client.id, String(b.title).slice(0, 120), b.intro ? String(b.intro).slice(0, 500) : null, String(b.vertical).toLowerCase().slice(0, 60), b.country ? String(b.country).toUpperCase().slice(0, 2) : null,
        String(b.language || 'en').slice(0, 5), JSON.stringify(fields), channels, partners, String(b.purpose).slice(0, 200)]);
    res.json(row);
  }));
  app.post('/api/pool/forms/:id/active', adminOnly, wrap(async (req, res) => { await q('UPDATE lp_forms SET active=$2, updated_at=now() WHERE id=$1', [+req.params.id, !!req.body?.active]); res.json({ ok: true }); }));

  // country rules
  app.get('/api/pool/rules', adminOnly, wrap(async (_req, res) => res.json(await q('SELECT country, name, rules, cold_allowed, reviewed_at FROM lp_country_rules ORDER BY name'))));
  app.post('/api/pool/rules/:country/cold', adminOnly, wrap(async (req, res) => {
    await q('UPDATE lp_country_rules SET cold_allowed=$2, updated_at=now() WHERE country=$1', [String(req.params.country).toUpperCase(), !!req.body?.on]);
    res.json({ ok: true });
  }));

  // saved views
  app.get('/api/pool/views', adminOnly, wrap(async (_req, res) => res.json(await q('SELECT * FROM lp_views ORDER BY id'))));
  app.post('/api/pool/views', adminOnly, wrap(async (req, res) => res.json(await one('INSERT INTO lp_views (name, filters) VALUES ($1,$2) RETURNING *', [String(req.body?.name || 'View').slice(0, 60), JSON.stringify(req.body?.filters || {})]))));
  app.delete('/api/pool/views/:id', adminOnly, wrap(async (req, res) => { await q('DELETE FROM lp_views WHERE id=$1', [+req.params.id]); res.json({ ok: true }); }));

  // a code sent by the admin (e.g. after a phone call): same limits as the form
  app.post('/api/pool/people/:id/send-code', adminOnly, wrap(async (req, res) => {
    try { res.json(await sendCode(+req.params.id, req.body?.channel === 'sms' ? 'sms' : 'whatsapp')); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));

  // duplicates
  app.get('/api/pool/duplicates', adminOnly, wrap(async (req, res) => res.json(await listCandidates(['open', 'merged', 'different'].includes(req.query.status) ? req.query.status : 'open'))));
  app.post('/api/pool/duplicates/:id/merge', adminOnly, wrap(async (req, res) => {
    const m = await one(`SELECT * FROM lp_merge_candidates WHERE id=$1 AND status='open'`, [+req.params.id]);
    if (!m) return res.status(404).json({ error: 'Already decided.' });
    const keep = +req.body?.keep === m.b ? m.b : m.a;
    try { res.json(await mergePeople(keep, keep === m.a ? m.b : m.a, 'admin')); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));
  app.post('/api/pool/duplicates/:id/different', adminOnly, wrap(async (req, res) => res.json({ ok: !!(await markDifferent(+req.params.id)) })));

  // daily upkeep
  app.get('/api/pool/upkeep', adminOnly, wrap(async (_req, res) => res.json({ runs: await lastRuns(),
    expiring: (await one(`SELECT count(*)::int AS n FROM lp_consents WHERE withdrawn_at IS NULL AND purpose='marketing' AND expires_at BETWEEN now() AND now() + interval '30 days'`)).n,
    providers: providerStatus() })));
  let running = false;
  app.post('/api/pool/upkeep/run', adminOnly, wrap(async (_req, res) => {
    if (running) return res.status(409).json({ error: 'Upkeep is already running.' });
    running = true;
    try { res.json(await upkeep()); } finally { running = false; }
  }));

  app.get('/api/pool/status', adminOnly, (_req, res) => res.json({ keys: keysReady(), altcha: !!process.env.ALTCHA_KEY, meta: !!process.env.META_APP_SECRET, codes: providerStatus() }));
}

export const DEFAULT_FIELDS = [
  { key: 'name', label: 'Full name', type: 'text', required: true },
  { key: 'email', label: 'Email', type: 'email', required: false },
  { key: 'phone', label: 'Mobile (WhatsApp)', type: 'tel', required: false },
  { key: 'city', label: 'City', type: 'text', required: false },
  { key: 'intent', label: 'What are you looking for?', type: 'textarea', required: false },
  { key: 'timing', label: 'When?', type: 'select', options: ['now', '1-3 months', '3-6 months', 'later'], required: false },
  { key: 'age_range', label: 'Age range (optional)', type: 'select', options: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'prefer not to say'], required: false },
  { key: 'gender', label: 'Gender (optional)', type: 'select', options: ['female', 'male', 'other', 'prefer not to say'], required: false },
];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k]).map(k => [k, String(o[k]).slice(0, 200)]));
