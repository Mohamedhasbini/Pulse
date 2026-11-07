// Checks on how to reach a person, at no cost by default:
//   phone: line type from Google's libphonenumber data (mobile, landline, VoIP, toll-free, premium). Twilio Lookup
//          (carrier data, about $0.008 a number) only when TWILIO_LOOKUP=1 and Twilio keys are set.
//   email: a match key that treats gmail dots and +tags as the same mailbox, and a deliverability check with
//          Reacher (self-hosted, free) run by the daily job.
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { q } from '../db.js';

// lines that can receive SMS / WhatsApp; fixed lines, toll-free and premium numbers cannot
export const TEXTABLE = new Set(['mobile', 'fixed_line_or_mobile', 'voip', 'personal_number', null]);

export function phoneLine(e164) {
  const p = parsePhoneNumberFromString(String(e164 || ''));
  const t = p?.getType?.();
  return t ? t.toLowerCase() : null;
}

export function matchKey(kind, value) {
  if (kind !== 'email') return value;
  let [user, domain] = String(value).toLowerCase().split('@');
  if (!domain) return value;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  user = user.split('+')[0];
  if (domain === 'gmail.com') user = user.replaceAll('.', '');
  return `${user}@${domain}`;
}

const twilioAuth = () => (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64') : null);

// paid lookup (opt-in): Twilio Lookup v2 line type intelligence
async function twilioLookup(e164) {
  const auth = twilioAuth();
  if (process.env.TWILIO_LOOKUP !== '1' || !auth) return null;
  const r = await fetch(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const d = await r.json();
  const t = d.line_type_intelligence?.type;
  return t ? { line_type: t.replace('nonFixedVoip', 'voip').replace('fixedVoip', 'voip').replace('landline', 'fixed_line').toLowerCase(), carrier: d.line_type_intelligence?.carrier_name || null } : null;
}

// check one identity row and store the result
export async function checkIdentity(row, db = { q }) {
  if (row.kind === 'phone') {
    const paid = await twilioLookup(row.value).catch(() => null);
    const line = paid?.line_type || phoneLine(row.value);
    await db.q(`UPDATE lp_identities SET line_type=$2, check_source=$3, checked_at=now(), match_key=COALESCE(match_key,$4) WHERE id=$1`,
      [row.id, line, paid ? 'twilio_lookup' : 'libphonenumber', row.value]);
    return { line_type: line, source: paid ? 'twilio_lookup' : 'libphonenumber' };
  }
  if (row.kind === 'email') {
    await db.q(`UPDATE lp_identities SET match_key=$2 WHERE id=$1`, [row.id, matchKey('email', row.value)]);
    return { match_key: matchKey('email', row.value) };
  }
  return {};
}

// deliverability with Reacher (daily job): valid | invalid | catch_all | unknown, plus disposable addresses
export async function checkEmails(limit = 100) {
  if (!process.env.ENGINE_REACHER_URL) return { checked: 0, skipped: 'Reacher not configured' };
  const { checkEmail } = await import('../engine/services.js');
  const rows = await q(`SELECT id, value FROM lp_identities WHERE kind='email' AND checked_at IS NULL AND value NOT LIKE '%@example.com' ORDER BY id LIMIT $1`, [limit]);
  let checked = 0, failed = 0;
  for (const r of rows) {
    try {
      const c = await checkEmail(r.value);
      await q(`UPDATE lp_identities SET status=$2, check_source='reacher', checked_at=now() WHERE id=$1`, [r.id, c.disposable ? 'disposable' : c.status]);
      checked++;
    } catch { failed++; }
  }
  return { checked, failed };
}
