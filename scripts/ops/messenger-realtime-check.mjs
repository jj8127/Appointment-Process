// Production check of the 1:1 "changed" signal. A (test FC) opens the room in
// full, listens on the realtime channel it was handed, and B (staff) sends bot
// messages. Per round it times B's send, the signal reaching A, and A's changes
// fetch finishing. Reads the MSGBOT_* variables; prints timings only.
//   MSGBOT_SUPABASE_JS: path to @supabase/supabase-js (any checkout's node_modules)
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { BOT_PREFIX, createClient, percentile, readConfig } from './messenger-synthetic-traffic.mjs';

const require = createRequire(import.meta.url);
const { createClient: createSupabase } = require(process.env.MSGBOT_SUPABASE_JS ?? '@supabase/supabase-js');
const rounds = Number(process.env.MSGBOT_ROUNDS ?? 10);
const intervalMs = Number(process.env.MSGBOT_INTERVAL_MS ?? 4000);

const config = readConfig();
const client = createClient(config);
const a = await client.login(config.a);
const b = await client.login(config.b);
const resolve = async (session, target) =>
  (await client.fcNotify(session, { type: 'resolve_garamin_direct_conversation', target_id: target })).json.conversation?.id;
const conversation_id = await resolve(a, config.b.phone);
if (!conversation_id || conversation_id !== await resolve(b, config.a.phone)) throw new Error('both sides must resolve the same conversation');

const full = (await client.fcNotify(a, { type: 'direct_message_list', conversation_id })).json;
if (!full.realtime_topic) throw new Error('no realtime_topic from a full list');
let cursor = full.cursor;

const realtime = createSupabase(config.url, config.anonKey, { auth: { persistSession: false } });
let waiter = null;
const channel = realtime.channel(full.realtime_topic, { config: { private: false } })
  .on('broadcast', { event: 'changed' }, () => { if (waiter) waiter(performance.now()); });
await new Promise((resolveSub, reject) => {
  const timer = setTimeout(() => reject(new Error('subscribe timeout')), 10_000);
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') { clearTimeout(timer); resolveSub(); }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(status)); }
  });
});
console.log('subscribed');

const sendAck = [], signal = [], visible = [];
for (let round = 1; round <= rounds; round += 1) {
  const id = randomUUID();
  const started = performance.now();
  const signalled = new Promise((resolveSignal) => {
    const timer = setTimeout(() => resolveSignal(null), 15_000);
    waiter = (at) => { clearTimeout(timer); waiter = null; resolveSignal(at); };
  });
  const send = await client.fcNotify(b, { type: 'direct_message_send', conversation_id, client_message_id: id, content: `${BOT_PREFIX} realtime #${round} ${new Date().toISOString()}` });
  const at = await signalled;
  let seen = null;
  if (at !== null) {
    const page = (await client.fcNotify(a, { type: 'direct_message_list', conversation_id, since: cursor })).json;
    cursor = page.cursor ?? cursor;
    if ((page.messages ?? []).some((message) => message.id === id)) seen = Math.round(performance.now() - started);
  }
  sendAck.push(send.ms);
  signal.push(at === null ? null : Math.round(at - started));
  visible.push(seen);
  console.log(`#${round} send=${send.ms}ms signal=${signal.at(-1) ?? 'none'}ms onScreen=${seen ?? 'none'}ms`);
  if (round < rounds) await new Promise((r) => setTimeout(r, intervalMs));
}
console.log(`sendAck p50=${percentile(sendAck, 50)} p95=${percentile(sendAck, 95)}`);
console.log(`signal (from send start) p50=${percentile(signal, 50)} p95=${percentile(signal, 95)} missed=${signal.filter((v) => v === null).length}`);
console.log(`onScreen (send start to fetched) p50=${percentile(visible, 50)} p95=${percentile(visible, 95)}`);
await realtime.removeChannel(channel);
process.exit(0);
