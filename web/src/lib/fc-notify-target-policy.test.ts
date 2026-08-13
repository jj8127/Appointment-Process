import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'fc-notify-proxy-policy.ts'),
  'utf8',
);

test('Request Board bridge preserves the strict target instead of deriving navigation from URL', () => {
  assert.match(source, /parseRequestBoardTargetForFc\(body\.target\)/);
  assert.match(source, /if \(!target\) return fail\(400, 'Invalid Request Board notification target'\)/);
  assert.match(source, /category: category as RequestBoardNotifyCategory,[\s\S]*?target/);
  assert.doesNotMatch(
    source,
    /payload:\s*\{[\s\S]*?category: category as RequestBoardNotifyCategory,[\s\S]*?\burl,[\s\S]*?target/,
  );
});

test('receipt and get actions bind the verified actor server-side', () => {
  assert.match(source, /type: 'inbox_get'/);
  assert.match(source, /type: 'inbox_mark_read' \| 'inbox_dismiss'/);
  assert.match(source, /viewer_actor_role: session\.role/);
  assert.match(source, /viewer_actor_phone: session\.residentDigits/);
  assert.doesNotMatch(source, /viewer_actor_role: body\./);
  assert.doesNotMatch(source, /viewer_actor_phone: body\./);
});

test('direct chat resolver requires exactly one stable identifier', () => {
  assert.match(source, /Boolean\(targetId\) === Boolean\(conversationId\)/);
  assert.match(source, /UUID_PATTERN\.test\(conversationId\)/);
  assert.match(source, /type: 'resolve_garamin_direct_conversation'/);
});

test('direct message actions require UUID conversations and inject only the verified actor', () => {
  assert.match(source, /body\.type === 'direct_message_list' \|\| body\.type === 'direct_message_mark_read'/);
  assert.match(source, /UUID_PATTERN\.test\(conversationId\)/);
  assert.match(source, /const content = boundedSafeText\(body\.content, 4_000\)/);
  assert.match(source, /UUID_PATTERN\.test\(messageId\)/);
  assert.match(source, /viewer_actor_role: session\.role/);
  assert.match(source, /viewer_actor_phone: session\.residentDigits/);
  assert.doesNotMatch(source, /sender_id: body\./);
  assert.doesNotMatch(source, /receiver_id: body\./);
  assert.match(source, /Read-only managers cannot access direct conversations/);
});

test('direct messages and one-to-many announcements forward only verified attachment intents', () => {
  assert.match(source, /attachment_intent_ids: attachmentDelivery\.attachmentIntentIds/);
  assert.match(source, /delivery_key: attachmentDelivery\.deliveryKey!/);
  assert.match(source, /payload_fingerprint: attachmentDelivery\.payloadFingerprint!/);
  assert.match(source, /type: 'direct_message_broadcast_send'/);
  assert.match(source, /session\.role !== 'admin'/);
  assert.match(source, /new Set\(attachmentIntentIds\)\.size !== attachmentIntentIds\.length/);
  assert.equal(source.includes("!/^[0-9a-f]{64}$/.test(payloadFingerprint)"), true);
  assert.doesNotMatch(source, /attachment_intent_ids: body\.attachment_intent_ids/);
});
