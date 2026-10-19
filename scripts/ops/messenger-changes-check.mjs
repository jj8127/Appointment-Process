// One-off production check of direct_message_list changes mode: A (test FC)
// loads the room in full, B (staff) sends and deletes a bot message, and A asks
// only for changes after its cursor each time. Reads the same MSGBOT_* variables
// as run-messenger-bot.ps1; prints sizes and timings, never message content.
import { randomUUID } from 'node:crypto';

import { BOT_PREFIX, createClient, readConfig } from './messenger-synthetic-traffic.mjs';

const config = readConfig();
const client = createClient(config);
const a = await client.login(config.a);
const b = await client.login(config.b);
const resolve = async (session, target) =>
  (await client.fcNotify(session, { type: 'resolve_garamin_direct_conversation', target_id: target })).json.conversation?.id;
const conversation_id = await resolve(a, config.b.phone);
if (!conversation_id || conversation_id !== await resolve(b, config.a.phone)) throw new Error('both sides must resolve the same conversation');

const list = async (since) => {
  const { json, ms } = await client.fcNotify(a, { type: 'direct_message_list', conversation_id, ...(since ? { since } : {}) });
  return { ms, bytes: JSON.stringify(json).length, mode: json.mode, rows: json.messages?.length ?? 0, ids: (json.messages ?? []).map((m) => m.id), deleted: json.deleted_ids ?? [], cursor: json.cursor };
};
const show = (label, page) => console.log(`${label}: mode=${page.mode} rows=${page.rows} deleted=${page.deleted.length} bytes=${page.bytes} ms=${page.ms}`);

const full = await list(null);
show('full', full);
if (!full.cursor) throw new Error('no cursor from a full list');

const id = randomUUID();
await client.fcNotify(b, { type: 'direct_message_send', conversation_id, client_message_id: id, content: `${BOT_PREFIX} cursor ${new Date().toISOString()}` });
const afterSend = await list(full.cursor);
show('after send', afterSend);
console.log(`  new message included: ${afterSend.ids.includes(id)}`);

await client.fcNotify(b, { type: 'direct_message_delete', conversation_id, message_id: id });
const afterDelete = await list(afterSend.cursor);
show('after delete', afterDelete);
console.log(`  deleted id reported: ${afterDelete.deleted.includes(id)}; still listed: ${afterDelete.ids.includes(id)}`);

const quiet = await list(afterDelete.cursor);
show('nothing new', quiet);
