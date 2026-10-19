import assert from 'node:assert/strict';
import test from 'node:test';

import { BOT_PREFIX, createClient, percentile, readConfig, runTraffic } from './messenger-synthetic-traffic.mjs';

const env = {
  MSGBOT_SUPABASE_URL: 'https://example.supabase.co/',
  MSGBOT_SUPABASE_ANON_KEY: 'anon',
  MSGBOT_A_PHONE: '01000000001',
  MSGBOT_A_PASSWORD: 'secret-a',
  MSGBOT_B_PHONE: '01000000002',
  MSGBOT_B_PASSWORD: 'secret-b',
  MSGBOT_ROUNDS: '6',
  MSGBOT_INTERVAL_MS: '0',
  MSGBOT_DELETE_EVERY: '3',
  MSGBOT_ATTACH_EVERY: '4',
};

// A fake Supabase that keeps one thread and enforces sender-only delete.
function fakeServer() {
  const messages = [];
  const calls = [];
  const sessions = { 'tok-a': { phone: '01000000001', role: 'fc' }, 'tok-b': { phone: '01000000002', role: 'admin', staffType: 'developer' } };
  const reply = (status, json) => ({ ok: status < 400, status, json: async () => json });
  const fetchImpl = async (url, init) => {
    if (init.method === 'PUT') { calls.push({ fn: 'upload', url }); return reply(200, {}); }
    const fn = url.split('/functions/v1/')[1];
    const body = JSON.parse(init.body);
    calls.push({ fn, type: body.type, headers: init.headers, body });
    if (fn === 'login-with-password') {
      if (body.password === 'secret-a') return reply(200, { ok: true, role: 'fc', appSessionToken: 'tok-a' });
      if (body.password === 'secret-b') return reply(200, { ok: true, role: 'admin', staffType: 'developer', appSessionToken: 'tok-b' });
      return reply(401, { ok: false, code: 'invalid_password' });
    }
    const me = sessions[init.headers['x-app-session-token']];
    if (!me) return reply(401, { ok: false, message: 'Unauthorized' });
    if (fn === 'messenger-attachments') {
      return reply(200, { ok: true, state: 'pending', intents: [{ id: 'intent-1', upload: { bucket: 'b', path: 'p', token: 't', signedUrl: 'https://example.supabase.co/storage/v1/object/upload/sign/b/p?token=t' } }] });
    }
    switch (body.type) {
      case 'resolve_garamin_direct_conversation': return reply(200, { ok: true, conversation: { id: 'thread-1' } });
      case 'direct_message_send':
        messages.push({ id: body.client_message_id, sender: me.phone, is_read: false, deleted: false, files: body.attachment_intent_ids?.length ?? 0 });
        return reply(200, { ok: true, message: { id: body.client_message_id } });
      case 'direct_message_list':
        return reply(200, { ok: true, messages: messages.filter((m) => !m.deleted).map(({ id, is_read }) => ({ id, is_read })) });
      case 'direct_message_mark_read':
        messages.filter((m) => m.sender !== me.phone).forEach((m) => { m.is_read = true; });
        return reply(200, { ok: true, updated: 1 });
      case 'direct_message_delete': {
        const target = messages.find((m) => m.id === body.message_id && m.sender === me.phone);
        if (!target) return reply(404, { ok: false, message: 'Direct message not found' });
        target.deleted = true;
        return reply(200, { ok: true, deleted: true });
      }
      default: return reply(400, { ok: false, message: 'unknown' });
    }
  };
  return { fetchImpl, messages, calls };
}

test('a run alternates senders, waits for delivery and read, deletes and attaches on schedule', async () => {
  const config = readConfig(env);
  const server = fakeServer();
  const rows = [];
  const logs = [];
  const summary = await runTraffic(config, createClient(config, server.fetchImpl), {
    log: (line) => logs.push(line), record: (row) => rows.push(row), pause: async () => {},
  });
  assert.deepEqual(summary, { conversationId: 'thread-1', sent: 6, delivered: 6, read: 6, deleted: 2, attachments: 1, failures: 0 });
  assert.deepEqual(rows.map((r) => r.sender), ['A', 'B', 'A', 'B', 'A', 'B']);
  assert.equal(server.messages.filter((m) => m.deleted).length, 2);
  assert.equal(server.messages[3].files, 1, 'round 4 carries the file');
  assert.ok(server.calls.some((c) => c.fn === 'upload'));
  for (const row of rows) assert.equal(typeof row.peerDeliveryMs, 'number');
  const sends = server.calls.filter((c) => c.type === 'direct_message_send');
  assert.ok(sends.every((c) => c.body.content.startsWith(BOT_PREFIX)), 'bot messages are marked');
  assert.ok(sends.every((c) => /^[0-9a-f-]{36}$/.test(c.body.client_message_id)));
});

test('secrets never reach logs, rows or error messages', async () => {
  const config = readConfig({ ...env, MSGBOT_B_PASSWORD: 'wrong-secret' });
  const server = fakeServer();
  const logs = [];
  await assert.rejects(
    runTraffic(config, createClient(config, server.fetchImpl), { log: (l) => logs.push(l), pause: async () => {} }),
    (error) => { assert.doesNotMatch(error.message, /secret/); assert.match(error.message, /invalid_password/); return true; },
  );
  assert.doesNotMatch(logs.join('\n'), /secret|tok-/);
});

test('the sides must be an FC and a staff account sharing one thread', async () => {
  const swapped = readConfig({ ...env, MSGBOT_A_PASSWORD: 'secret-b', MSGBOT_B_PASSWORD: 'secret-a' });
  await assert.rejects(runTraffic(swapped, createClient(swapped, fakeServer().fetchImpl), { log: () => {}, pause: async () => {} }), /A must be an FC account/);
});

test('config fails closed and keeps attachments under the hourly batch limit', () => {
  assert.throws(() => readConfig({ ...env, MSGBOT_A_PASSWORD: '' }), /missing env: MSGBOT_A_PASSWORD/);
  assert.throws(() => readConfig({ ...env, MSGBOT_A_PHONE: '010-1234-5678' }), /11 digits/);
  assert.throws(() => readConfig({ ...env, MSGBOT_ATTACH_EVERY: '2' }), /0 or >= 4/);
  assert.equal(readConfig(env).url, 'https://example.supabase.co');
  assert.equal(percentile([5, 1, 3, null, 9], 50), 3);
  assert.equal(percentile([5, 1, 3, 9], 95), 9);
  assert.equal(percentile([], 50), null);
});
