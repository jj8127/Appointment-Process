import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupFailed, isGroupChatSuccess, parseUpstreamResponse } from './upstream-response-policy.ts';

test('malformed and empty acknowledgements are rejected', () => {
  for (const raw of ['', 'null', '[]', 'garbage', '{"message":"ok"}', '{"ok":1}']) {
    assert.equal(parseUpstreamResponse(raw), null);
  }
  assert.deepEqual(parseUpstreamResponse('{"ok":true,"data":null}'), { ok: true, data: null });
});
test('action success requires the consumed fields', () => {
  assert.equal(isGroupChatSuccess('group_chat_bootstrap', { ok: true }), false);
  assert.equal(isGroupChatSuccess('group_chat_delete', { ok: true }), false);
  assert.equal(isGroupChatSuccess('group_chat_notice_clear', { ok: true }), false);
  assert.equal(isGroupChatSuccess('group_chat_notice_clear', { ok: true, notice: null }), true);
  assert.equal(isGroupChatSuccess('group_chat_delete', { ok: true, message: { id: 'test' } }), true);
});
test('cleanup return errors and thrown errors both preserve committed success', async () => {
  assert.equal(await cleanupFailed(async () => ({ error: null })), false);
  assert.equal(await cleanupFailed(async () => ({ error: new Error('synthetic') })), true);
  assert.equal(await cleanupFailed(async () => { throw new Error('synthetic'); }), true);
});


test('board create/update reject missing durable acknowledgement and reads reject missing data', async () => {
  const { isBoardSuccess } = await import('./upstream-response-policy.ts');
  assert.equal(isBoardSuccess('board-update', { ok: true }), false);
  assert.equal(isBoardSuccess('board-create', { ok: true, saved: true }), false);
  assert.equal(isBoardSuccess('board-list', { ok: true }), false);
  assert.equal(isBoardSuccess('board-update', { ok: true, saved: true }), true);
  assert.equal(isBoardSuccess('board-delete', { ok: true }), true);
});
