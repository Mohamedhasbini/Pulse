// Email sending through Resend (resend.com, free tier 3,000 emails/month).
// Off until RESEND_API_KEY and EMAIL_FROM are set in .env; the AI never offers email while it's off.
export const emailEnabled = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Our messages use WhatsApp-style *bold* and • bullets; turn them into simple, clean HTML.
const toHtml = text => `<div style="font:15px/1.55 -apple-system,Segoe UI,Arial,sans-serif;color:#111722;max-width:560px">${
  esc(text).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</div>`;

export async function sendEmail(to, subject, text, businessName) {
  if (!emailEnabled()) return { ok: false, reason: 'Email sending is not connected yet' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || ''))) return { ok: false, reason: 'No valid email address' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${businessName || 'Bookings'} <${process.env.EMAIL_FROM}>`, to: [to], subject, text: text.replace(/\*([^*\n]+)\*/g, '$1'), html: toHtml(text) }),
    });
    if (!r.ok) return { ok: false, reason: `Email error ${r.status}: ${(await r.text()).slice(0, 120)}` };
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'Email error: ' + e.message }; }
}
