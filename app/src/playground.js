// Test businesses (is_demo) are the admin's playgrounds: everything works, but nothing they do may reach a real person.
// Every place that sends a message on its own (reminders, campaigns, agents, replies from the Inbox) asks first.
import { one } from './db.js';

const seen = new Map(); // id -> { demo, at }
export async function isPlayground(id) {
  if (!id) return false;
  const c = seen.get(id);
  if (c && Date.now() - c.at < 60000) return c.demo;
  const demo = !!(await one('SELECT is_demo FROM businesses WHERE id=$1', [id]))?.is_demo;
  seen.set(id, { demo, at: Date.now() });
  return demo;
}
export const PLAYGROUND_SKIP = 'skipped: test business, nothing is sent to real people';
