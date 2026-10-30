// one real chat turn through each path, printing the decision trail stored with the reply
import { handleMessage } from './brain.js';
import { q, one, pool } from './db.js';
const phone = 'test-trail-' + Date.now();
for (const [label, text] of [['main', 'How much is a manicure?'], ['main', 'Do you sell gift cards?']]) {
  const r = await handleMessage({ businessId: 1, phone, name: 'Trail Check', text, channel: 'test' });
  const m = await one("SELECT source, confidence, trail FROM messages WHERE conversation_id=$1 AND role='assistant' ORDER BY id DESC LIMIT 1", [r.conversationId]);
  console.log(JSON.stringify({ path: process.env.AI_PRIMARY || label, asked: text, reply: String(r.reply).slice(0, 90), ...m }));
}
await q("DELETE FROM learning WHERE conversation_id IN (SELECT c.id FROM conversations c JOIN customers cu ON cu.id=c.customer_id WHERE cu.phone=$1)", [phone]);
await q("DELETE FROM messages WHERE conversation_id IN (SELECT c.id FROM conversations c JOIN customers cu ON cu.id=c.customer_id WHERE cu.phone=$1)", [phone]);
await q("DELETE FROM conversations WHERE customer_id IN (SELECT id FROM customers WHERE phone=$1)", [phone]);
await q("DELETE FROM customers WHERE phone=$1", [phone]);
await pool.end();
