// Growth engine: reaching the right person. Checks published addresses, guesses work addresses for named decision
// makers (only when the mail server does not accept everything), and picks the best contact for a company.
// Nothing is ever sent: Reacher only asks the mail server whether the mailbox exists.
import { q } from '../db.js';
import { checkEmail } from './services.js';
import { emailGuesses } from './text.js';

const DECIDER = /owner|founder|co-?founder|ceo|chief|managing|director|head|general manager|\bgm\b|partner|president|principal|operations|facilit|procurement|purchas|marketing manager|sales manager|مدير|المؤسس|الرئيس/i;
const RANK = { valid: 4, catch_all: 2, unknown: 1, unchecked: 0, invalid: -1 };

async function check(contactId, email) {
  let status = 'unknown';
  try { status = (await checkEmail(email)).status; } catch { status = 'unknown'; }
  await q('UPDATE eng_contacts SET email_status=$2, checked_at=now() WHERE id=$1', [contactId, status]);
  return status;
}

// Returns { contact_id, label } for the best way to reach this company, or null.
export async function reach(company, { roles = [], log = () => {} } = {}) {
  const rolesRe = roles.length ? new RegExp(roles.map(r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i') : null;
  const isDecider = c => c.role && (DECIDER.test(c.role) || rolesRe?.test(c.role));
  let rows = await q('SELECT * FROM eng_contacts WHERE company_id=$1 ORDER BY id', [company.id]);

  // 1. published addresses on the company's own domain (up to 3)
  let catchAll = false;
  for (const c of rows.filter(c => c.email && c.email_status === 'unchecked' && c.email.endsWith('@' + company.domain)).slice(0, 3)) {
    c.email_status = await check(c.id, c.email);
    if (c.email_status === 'catch_all') catchAll = true;
  }
  // 2. a guessed address for up to 2 named decision makers, unless the server accepts any address
  if (!catchAll && !rows.some(c => c.email && c.email_status === 'valid' && c.name)) {
    for (const p of rows.filter(c => c.name && !c.email && isDecider(c)).slice(0, 2)) {
      for (const guess of emailGuesses(p.name, company.domain).slice(0, 3)) {
        const status = await check(p.id, guess).catch(() => 'unknown');
        if (status === 'catch_all') { catchAll = true; break; }
        if (status === 'valid') { await q(`UPDATE eng_contacts SET email=$2, email_kind='pattern' WHERE id=$1`, [p.id, guess]).catch(() => {}); break; }
      }
      if (catchAll) break;
    }
    // a failed guess leaves no address on the person
    await q(`UPDATE eng_contacts SET email_status='unchecked' WHERE company_id=$1 AND email IS NULL`, [company.id]);
    rows = await q('SELECT * FROM eng_contacts WHERE company_id=$1 ORDER BY id', [company.id]);
  }

  // 3. the best contact: a named decision maker with a working address, then any named person, then a generic address
  const score = c => (RANK[c.email_status] ?? 0) * 10 + (c.name ? 5 : 0) + (isDecider(c) ? 6 : 0) + (c.email_kind === 'generic' ? -2 : 0) + (c.email ? 0 : -50);
  const best = rows.filter(c => c.email && c.email_status !== 'invalid').sort((a, b) => score(b) - score(a))[0]
    || rows.filter(c => c.name && isDecider(c))[0] || null;
  if (best) log(`${company.domain}: contact ${best.name || best.email} (${best.email_status})`);
  return best;
}
