// Pulse AI: everything the AI has prepared and that waits for the owner, in one list. Each item says what it is,
// why, and the action that carries it out; the actions are the existing ones, so this list never acts on its own.
//   request  a customer asked to cancel or move a booking       → approve / reject  (/api/requests/:id/…)
//   lesson   a rule the AI suggests from its own chats          → approve / dismiss (/api/lessons)
//   question a question the AI couldn't answer, asked again     → answer in Teach AI
//   agent    customers an agent found, with messages ready      → review and send in AI team
import { q } from './db.js';
import { agentFindings } from './agents.js';
import { lessonSuggestions } from './lab.js';

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

export async function waiting(B) {
  const [requests, lessons, questions, agents] = await Promise.all([
    q(`SELECT r.id, r.type, r.details, to_char(b.starts_at AT TIME ZONE COALESCE(bz.timezone,'Asia/Beirut'),'Dy DD Mon HH24:MI') AS start, s.name AS service, cu.name
        FROM requests r JOIN bookings b ON b.id=r.booking_id JOIN services s ON s.id=b.service_id JOIN customers cu ON cu.id=b.customer_id JOIN businesses bz ON bz.id=r.business_id
        WHERE r.business_id=$1 AND r.status='pending' ORDER BY r.created_at LIMIT 30`, [B]),
    lessonSuggestions(B),
    q(`SELECT min(id) AS id, min(question) AS question, count(*)::int AS n FROM learning WHERE business_id=$1 AND status='open' GROUP BY lower(question) ORDER BY 3 DESC LIMIT 10`, [B]),
    agentFindings(B).then(r => r.out.filter(a => a.list.length && !a.blocked))]);
  const items = [
    ...requests.map(r => ({ kind: 'request', id: r.id, title: `${r.name} wants to ${r.type === 'cancel' ? 'cancel' : r.type === 'reschedule' ? 'move' : 'change'} ${r.service}`, why: [r.start, r.details].filter(Boolean).join(' · ') })),
    ...lessons.filter(l => l.kind === 'rule').map(l => ({ kind: 'lesson', title: l.title, why: l.evidence, body: l.body })),
    ...questions.map(x => ({ kind: 'question', id: x.id, title: `Answer “${x.question}”`, why: `asked ${x.n} time${x.n === 1 ? '' : 's'}, the AI couldn't answer` })),
    ...agents.map(a => ({ kind: 'agent', id: a.id, title: `${a.name}: ${a.list.length} customer${a.list.length === 1 ? '' : 's'} to contact`, why: a.does }))];
  return { count: items.length, items };
}

export function mountPulse(app, BIZ) {
  app.get('/api/pulse/waiting', wrap(async (_req, res) => res.json(await waiting(BIZ()))));
}
