#!/usr/bin/env node
// Synthetic 1:1 messenger traffic between two test accounts (stage-1 gate and
// latency baseline). It logs in through login-with-password like the app's
// insurance session, then alternates senders through fc-notify:
//   send -> peer sees it (poll) -> peer marks read -> sender sees is_read,
// deleting every Nth message and attaching a tiny PNG every Mth.
// Every send is a real message with real push to both accounts' devices.
//
// Passwords are read from the environment and never printed or written.
//   MSGBOT_SUPABASE_URL, MSGBOT_SUPABASE_ANON_KEY
//   MSGBOT_A_PHONE / MSGBOT_A_PASSWORD   (FC side)
//   MSGBOT_B_PHONE / MSGBOT_B_PASSWORD   (staff side: developer/admin/manager)
//   MSGBOT_ROUNDS (20), MSGBOT_INTERVAL_MS (20000), MSGBOT_DELETE_EVERY (5),
//   MSGBOT_ATTACH_EVERY (0 = off; keep >= 4 so each account stays under 20 batches/hour),
//   MSGBOT_OUT (messenger-synthetic-<time>.jsonl)
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BOT_PREFIX = '[자동 점검]';
const POLL_MS = 400;
const WAIT_TIMEOUT_MS = 20_000;
// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function readConfig(env = process.env) {
  const need = ['MSGBOT_SUPABASE_URL', 'MSGBOT_SUPABASE_ANON_KEY', 'MSGBOT_A_PHONE', 'MSGBOT_A_PASSWORD', 'MSGBOT_B_PHONE', 'MSGBOT_B_PASSWORD'];
  const missing = need.filter((key) => !env[key]);
  if (missing.length) throw new Error(`missing env: ${missing.join(', ')}`);
  for (const key of ['MSGBOT_A_PHONE', 'MSGBOT_B_PHONE']) {
    if (!/^01\d{9}$/.test(env[key])) throw new Error(`${key} must be 11 digits`);
  }
  const int = (key, fallback) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`);
    return value;
  };
  const attachEvery = int('MSGBOT_ATTACH_EVERY', 0);
  if (attachEvery > 0 && attachEvery < 4) throw new Error('MSGBOT_ATTACH_EVERY must be 0 or >= 4');
  return {
    url: env.MSGBOT_SUPABASE_URL.replace(/\/+$/, ''),
    anonKey: env.MSGBOT_SUPABASE_ANON_KEY,
    a: { label: 'A', phone: env.MSGBOT_A_PHONE, password: env.MSGBOT_A_PASSWORD },
    b: { label: 'B', phone: env.MSGBOT_B_PHONE, password: env.MSGBOT_B_PASSWORD },
    rounds: int('MSGBOT_ROUNDS', 20),
    intervalMs: int('MSGBOT_INTERVAL_MS', 20_000),
    deleteEvery: int('MSGBOT_DELETE_EVERY', 5),
    attachEvery,
    out: env.MSGBOT_OUT || `messenger-synthetic-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
  };
}

export function createClient(config, fetchImpl = fetch, now = () => performance.now()) {
  const call = async (fn, body, token) => {
    const started = now();
    const response = await fetchImpl(`${config.url}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        'Content-Type': 'application/json',
        ...(token ? { 'x-app-session-token': token } : {}),
      },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    const ms = Math.round(now() - started);
    if (!response.ok || json.ok === false) {
      // Never echo the request body: it may hold a password.
      const code = json.code || json.error || json.message || `http_${response.status}`;
      throw Object.assign(new Error(`${fn}:${body.type ?? body.action ?? 'call'} failed: ${code}`), { status: response.status, ms });
    }
    return { json, ms };
  };

  return {
    async login(account) {
      const { json } = await call('login-with-password', { phone: account.phone, password: account.password });
      if (!json.appSessionToken) throw new Error(`login ${account.label}: no session token (${json.code ?? 'unknown'})`);
      return { ...account, token: json.appSessionToken, role: json.role, staffType: json.staffType ?? null };
    },
    fcNotify: (session, body) => call('fc-notify', body, session.token),
    async uploadAttachment(session, conversationId, content) {
      const clientFileId = randomUUID();
      const file = { clientFileId, name: 'bot-check.png', size: TINY_PNG.length, mimeType: 'image/png', sha256: sha256(TINY_PNG) };
      const deliveryKey = randomUUID();
      const payloadFingerprint = sha256(JSON.stringify({
        version: 1,
        context: { kind: 'direct', conversationId },
        content,
        files: [{ order: 0, clientFileId, name: file.name, size: file.size, mimeType: file.mimeType, sha256: file.sha256 }],
      }));
      const { json } = await call('messenger-attachments', {
        type: 'upload_intents_create', context: { kind: 'direct', conversationId }, deliveryKey, payloadFingerprint, files: [file],
      }, session.token);
      const intent = json.intents?.[0];
      if (!intent?.upload?.path || !intent.upload.token) throw new Error('attachment intent missing upload target');
      // Same request supabase-js uploadToSignedUrl makes.
      const target = intent.upload.signedUrl
        ?? `${config.url}/storage/v1/object/upload/sign/${intent.upload.bucket}/${intent.upload.path}?token=${encodeURIComponent(intent.upload.token)}`;
      const upload = await fetchImpl(target, {
        method: 'PUT',
        headers: { apikey: config.anonKey, 'Content-Type': 'image/png', 'x-upsert': 'false' },
        body: TINY_PNG,
      });
      if (!upload.ok && upload.status !== 409) throw new Error(`attachment upload failed: http_${upload.status}`);
      return { intentIds: [intent.id], deliveryKey, payloadFingerprint };
    },
  };
}

async function waitFor(check, now) {
  const started = now();
  for (;;) {
    const value = await check();
    if (value) return Math.round(now() - started);
    if (now() - started > WAIT_TIMEOUT_MS) return null;
    await sleep(POLL_MS);
  }
}

export async function runTraffic(config, client, { log = console.log, record = () => {}, now = () => performance.now(), pause = sleep } = {}) {
  const a = await client.login(config.a);
  const b = await client.login(config.b);
  if (a.role !== 'fc') throw new Error(`A must be an FC account (got ${a.role})`);
  if (b.role === 'fc') throw new Error('B must be a staff account');
  log(`logged in: A=fc, B=${b.role}${b.staffType ? `/${b.staffType}` : ''}`);

  const resolve = async (session, target) =>
    (await client.fcNotify(session, { type: 'resolve_garamin_direct_conversation', target_id: target })).json.conversation?.id;
  const conversationA = await resolve(a, config.b.phone);
  const conversationB = await resolve(b, config.a.phone);
  if (!conversationA || conversationA !== conversationB) throw new Error('both sides must resolve the same conversation');
  const conversation_id = conversationA;
  const list = async (session) => (await client.fcNotify(session, { type: 'direct_message_list', conversation_id })).json.messages ?? [];

  const summary = { sent: 0, delivered: 0, read: 0, deleted: 0, attachments: 0, failures: 0 };
  for (let round = 1; round <= config.rounds; round += 1) {
    const [sender, receiver] = round % 2 === 1 ? [a, b] : [b, a];
    const id = randomUUID();
    const content = `${BOT_PREFIX} #${round} ${new Date().toISOString()}`;
    const row = { round, sender: sender.label, id, at: new Date().toISOString() };
    try {
      let attachment = null;
      if (config.attachEvery && round % config.attachEvery === 0) {
        attachment = await client.uploadAttachment(sender, conversation_id, content);
      }
      const send = await client.fcNotify(sender, {
        type: 'direct_message_send', conversation_id, client_message_id: id, content,
        ...(attachment ? { attachment_intent_ids: attachment.intentIds, delivery_key: attachment.deliveryKey, payload_fingerprint: attachment.payloadFingerprint } : {}),
      });
      row.sendAckMs = send.ms;
      row.attachment = Boolean(attachment);
      summary.sent += 1;
      if (attachment) summary.attachments += 1;

      row.peerDeliveryMs = await waitFor(async () => (await list(receiver)).some((m) => m.id === id), now);
      if (row.peerDeliveryMs !== null) summary.delivered += 1;

      const markRead = await client.fcNotify(receiver, { type: 'direct_message_mark_read', conversation_id });
      row.markReadMs = markRead.ms;
      row.readSeenMs = await waitFor(async () => (await list(sender)).some((m) => m.id === id && m.is_read), now);
      if (row.readSeenMs !== null) summary.read += 1;

      if (config.deleteEvery && round % config.deleteEvery === 0) {
        row.deleteMs = (await client.fcNotify(sender, { type: 'direct_message_delete', conversation_id, message_id: id })).ms;
        summary.deleted += 1;
      }
    } catch (error) {
      row.error = error.message;
      summary.failures += 1;
    }
    record(row);
    log(`#${round} ${row.sender} ack=${row.sendAckMs ?? '-'}ms peer=${row.peerDeliveryMs ?? '-'}ms read=${row.readSeenMs ?? '-'}ms${row.deleteMs ? ' deleted' : ''}${row.attachment ? ' +file' : ''}${row.error ? ` ERROR ${row.error}` : ''}`);
    if (round < config.rounds) await pause(config.intervalMs);
  }
  return { conversationId: conversation_id, ...summary };
}

export function percentile(values, p) {
  const sorted = values.filter((v) => typeof v === 'number').sort((x, y) => x - y);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  const config = readConfig();
  const rows = [];
  const summary = await runTraffic(config, createClient(config), {
    record: (row) => { rows.push(row); appendFileSync(config.out, `${JSON.stringify(row)}\n`); },
  });
  for (const key of ['sendAckMs', 'peerDeliveryMs', 'readSeenMs']) {
    const values = rows.map((row) => row[key]);
    console.log(`${key}: p50=${percentile(values, 50)}ms p95=${percentile(values, 95)}ms n=${values.filter((v) => typeof v === 'number').length}`);
  }
  console.log(JSON.stringify(summary));
  console.log(`rows: ${config.out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
