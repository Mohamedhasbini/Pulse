// Layer 08: observability. Every AI answer leaves a trace: which layer decided what (access, guard, fast path, role,
// knowledge, model, tool, output check), any flags raised, which provider answered and how long it took.
// The Lab and the owner read these to see WHY the assistant said something, without opening the chat itself.
// Two promises:
//   - nothing personal is stored in full: phone numbers and emails are redacted before writing
//   - a trace can never break an answer: every write is caught and only logged

// ---- redaction ---------------------------------------------------------------------------------------------
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
// a run of digits (Western or Arabic-Indic) with the separators people type in phone numbers
const PHONE = /(?:\+|00)?[0-9٠-٩۰-۹][0-9٠-٩۰-۹\s().\-]{5,}[0-9٠-٩۰-۹]/g;
const DIGIT = /[0-9٠-٩۰-۹]/g;
// dates look like phone numbers to a regex ("2026-11-07"); they are not personal, and the trace needs them
const DATE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/;
// fields whose whole value is personal, whatever it looks like
const PERSONAL_KEY = /^(phone|phones|mobile|tel|telephone|email|e_mail|mail|whatsapp|wa_id|wa|msisdn|contact)$/i;

export function redactText(s) {
  return String(s)
    .replace(EMAIL, '[email]')
    .replace(PHONE, m => {
      const trimmed = m.trim(), n = (trimmed.match(DIGIT) || []).length;
      if (n < 7 || n > 15 || DATE.test(trimmed)) return m;
      const digits = trimmed.match(DIGIT).join('');
      const lead = m.match(/^\s*/)[0], tail = m.match(/\s*$/)[0];
      return `${lead}[phone …${digits.slice(-2)}]${tail}`; // last two digits: enough to tell two numbers apart
    });
}

// Deep copy with every string redacted, and size kept sane (a trace is a summary, not a copy of the database).
const MAX_STR = 1500, MAX_ARR = 40, MAX_DEPTH = 6;
export function redact(v, depth = 0, key = '') {
  if (v == null) return v;
  if (PERSONAL_KEY.test(key) && (typeof v === 'string' || typeof v === 'number')) return String(v).includes('@') ? '[email]' : '[phone]';
  if (typeof v === 'string') { const r = redactText(v); return r.length > MAX_STR ? r.slice(0, MAX_STR) + '…' : r; }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Set) v = [...v];
  if (v instanceof Error) return redactText(v.message);
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(v)) {
    const out = v.slice(0, MAX_ARR).map(x => redact(x, depth + 1));
    if (v.length > MAX_ARR) out.push(`[+${v.length - MAX_ARR} more]`);
    return out;
  }
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (typeof x !== 'function') out[k] = redact(x, depth + 1, k);
    return out;
  }
  return String(v);
}

// ---- writing --------------------------------------------------------------------------------------------------
let writer = null; // swapped in tests; otherwise the database, loaded only when the first trace ends
export const _setWriter = fn => { writer = fn; };
async function write(row) {
  if (!writer) {
    const { one } = await import('../db.js');
    writer = async r => (await one(`INSERT INTO ai_traces (business_id, conversation_id, audience, role, steps, flags, provider, model, ms, outcome)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [r.business_id, r.conversation_id, r.audience, r.role, JSON.stringify(r.steps), JSON.stringify(r.flags), r.provider, r.model, r.ms, r.outcome]))?.id ?? null;
  }
  return writer(row);
}

const int = v => (Number.isInteger(+v) && v !== null && v !== '' ? +v : null);

// startTrace({ businessId, conversationId, audience, role }) -> t
//   t.step(layer, data)   what a layer decided ("access", "guard_in", "fast_path", "delegate", "model", "tool", ...)
//   t.flag(name, detail)  something worth a look ("injection", "leak", "handoff", "busy", ...)
//   await t.end({ outcome, provider, model, ms })  writes the row once; returns its id, or null if it couldn't
// role may be set later (t.role = 'sales'), because delegation happens after the trace starts.
export function startTrace({ businessId, conversationId, audience, role } = {}) {
  const t0 = Date.now(), steps = [], flags = [];
  let ended = null;
  const t = {
    businessId, conversationId, audience, role, steps, flags,
    step(layer, data = {}) {
      try { steps.push({ layer: String(layer), ms: Date.now() - t0, ...(data && typeof data === 'object' && !Array.isArray(data) ? redact(data) : { value: redact(data) }) }); }
      catch (e) { console.warn('trace step:', e.message); }
      return t;
    },
    flag(name, detail = null) {
      try { flags.push({ name: String(name), ...(detail == null ? {} : { detail: redact(detail) }), ms: Date.now() - t0 }); }
      catch (e) { console.warn('trace flag:', e.message); }
      return t;
    },
    get flagged() { return flags.length > 0; },
    async end({ outcome = null, provider = null, model = null, ms = null, role: r } = {}) {
      if (ended) return ended; // a second end() (e.g. from a finally block) must not write a duplicate row
      ended = (async () => {
        try {
          return await write({
            business_id: int(t.businessId), conversation_id: int(t.conversationId),
            audience: t.audience ?? null, role: r ?? t.role ?? null,
            steps, flags, provider, model, ms: int(ms ?? Date.now() - t0), outcome: outcome == null ? null : String(outcome).slice(0, 60),
          });
        } catch (e) { console.warn('ai_traces write failed:', e.message); return null; }
      })();
      return ended;
    },
  };
  return t;
}

// ---- reading (Lab and owner views) ---------------------------------------------------------------------------
// filters: ?limit=50 (max 200), ?role=receptionist, ?flagged=1 (only traces with at least one flag);
// admin also ?business_id=12
export function listQuery({ businessId = null, limit, role, flagged } = {}) {
  const where = [], args = [];
  if (businessId != null) { args.push(+businessId); where.push(`t.business_id=$${args.length}`); }
  if (role) { args.push(String(role)); where.push(`t.role=$${args.length}`); }
  if (flagged === true || /^(1|true|yes)$/i.test(String(flagged ?? ''))) where.push(`jsonb_array_length(t.flags) > 0`);
  args.push(Math.min(200, Math.max(1, parseInt(limit, 10) || 50)));
  return {
    text: `SELECT t.id, t.business_id, b.name AS business, t.conversation_id, t.audience, t.role, t.steps, t.flags, t.provider, t.model, t.ms, t.outcome, t.at
      FROM ai_traces t LEFT JOIN businesses b ON b.id=t.business_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.at DESC LIMIT $${args.length}`,
    args,
  };
}

export function mountTraces(app, { adminOnly, wrap, BIZ }) {
  // the owner sees their own business only (staff don't: traces show how the assistant reasons about clients)
  app.get('/api/ai-traces', wrap(async (req, res) => {
    if (!['owner', 'admin'].includes(req.user?.role)) return res.status(403).json({ error: 'Only the account owner can see this.' });
    const { q } = await import('../db.js');
    const { text, args } = listQuery({ businessId: BIZ(), limit: req.query.limit, role: req.query.role, flagged: req.query.flagged });
    res.json(await q(text, args));
  }));
  // the platform admin sees every business, optionally one
  app.get('/api/admin/ai-traces', adminOnly, wrap(async (req, res) => {
    const { q } = await import('../db.js');
    const { text, args } = listQuery({ businessId: req.query.business_id ? +req.query.business_id || 0 : null, limit: req.query.limit, role: req.query.role, flagged: req.query.flagged });
    res.json(await q(text, args));
  }));
}
