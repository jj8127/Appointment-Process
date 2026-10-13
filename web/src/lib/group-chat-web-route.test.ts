import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildGroupChatFunctionHeaders,
  getGroupChatFunctionUrl,
  normalizeGroupChatProxyPayload,
} from './group-chat-web.ts';
import { parseGroupChatContextResponse } from './group-chat-client.ts';

const ROOM_ID = '7d493f2e-21c9-4c86-b94b-43c875555000';

function contextMessage(id: string) {
  return {
    id,
    room_id: ROOM_ID,
    sender_actor_id: 'admin:1',
    sender_role: 'admin',
    sender_phone: '01011112222',
    sender_name: '관리자',
    content: '메시지',
    message_type: 'text',
    file_url: null,
    file_name: null,
    file_size: null,
    attachments: [],
    created_at: '2026-10-13T00:00:00.000Z',
    unread_count: 0,
    reply_to_message_id: null,
    reply_to_sender_name: null,
    reply_to_content: null,
    deleted_at: null,
    deleted_by_actor_id: null,
    reactions: [],
  };
}

describe('group chat web route helpers', () => {
  it('keeps only the existing group chat action contract', () => {
    assert.deepEqual(normalizeGroupChatProxyPayload({ type: 'group_chat_bootstrap', limit: 80 }), {
      ok: true,
      payload: { type: 'group_chat_bootstrap', limit: 80 },
    });

    assert.deepEqual(
      normalizeGroupChatProxyPayload({
        type: 'group_chat_send',
        content: 'hello',
        message_type: 'text',
        extra_admin_only: true,
      }),
      {
        ok: true,
        payload: {
          type: 'group_chat_send',
          content: 'hello',
          message_type: 'text',
        },
      },
    );

    assert.deepEqual(normalizeGroupChatProxyPayload({ type: 'not_allowed' }), {
      ok: false,
      status: 400,
      message: 'Unsupported group chat action',
    });
  });

  it('proxies group chat context only with canonical UUID identifiers', () => {
    assert.deepEqual(
      normalizeGroupChatProxyPayload({
        type: 'group_chat_context',
        room_id: '7D493F2E-21C9-4C86-B94B-43C875555001',
        message_id: '7D493F2E-21C9-4C86-B94B-43C875555002',
        ignored: 'value',
      }),
      {
        ok: true,
        payload: {
          type: 'group_chat_context',
          room_id: '7d493f2e-21c9-4c86-b94b-43c875555001',
          message_id: '7d493f2e-21c9-4c86-b94b-43c875555002',
        },
      },
    );

    for (const payload of [
      { type: 'group_chat_context', room_id: 'not-a-room', message_id: '7d493f2e-21c9-4c86-b94b-43c875555002' },
      { type: 'group_chat_context', room_id: '7d493f2e-21c9-4c86-b94b-43c875555001', message_id: 'not-a-message' },
    ]) {
      assert.deepEqual(normalizeGroupChatProxyPayload(payload), {
        ok: false,
        status: 400,
        message: 'Invalid group chat context',
      });
    }
  });

  it('rejects malformed or unstable group chat context success payloads', () => {
    const firstId = '7d493f2e-21c9-4c86-b94b-43c875555001';
    const anchorId = '7d493f2e-21c9-4c86-b94b-43c875555002';
    const valid = {
      ok: true,
      roomRef: { version: 1, kind: 'group_chat', roomId: ROOM_ID },
      anchorMessageId: anchorId,
      messages: [contextMessage(firstId), contextMessage(anchorId)],
      hasBefore: false,
      hasAfter: false,
      nextCursor: null,
    };

    assert.deepEqual(parseGroupChatContextResponse(valid), valid);
    assert.throws(
      () => parseGroupChatContextResponse({
        ...valid,
        messages: [contextMessage(anchorId), contextMessage(firstId)],
      }),
      /이전 메시지 응답이 올바르지 않습니다/,
    );
    assert.throws(
      () => parseGroupChatContextResponse({ ...valid, unexpected: true }),
      /이전 메시지 응답이 올바르지 않습니다/,
    );
    assert.throws(
      () => parseGroupChatContextResponse({
        ...valid,
        messages: [{ ...contextMessage(anchorId), room_id: firstId }],
      }),
      /이전 메시지 응답이 올바르지 않습니다/,
    );
  });

  it('accepts only own group chat upload URLs for attachments', () => {
    assert.deepEqual(
      normalizeGroupChatProxyPayload(
        {
          type: 'group_chat_send',
          content: '',
          message_type: 'image',
          file_url: 'https://example.supabase.co/storage/v1/object/public/chat-uploads/group-chat/photo.png',
          file_name: 'photo.png',
          file_size: 1234,
        },
        { supabaseUrl: 'https://example.supabase.co' },
      ),
      {
        ok: true,
        payload: {
          type: 'group_chat_send',
          content: '',
          message_type: 'image',
          file_url: 'https://example.supabase.co/storage/v1/object/public/chat-uploads/group-chat/photo.png',
          file_name: 'photo.png',
          file_size: 1234,
        },
      },
    );

    assert.deepEqual(
      normalizeGroupChatProxyPayload(
        {
          type: 'group_chat_send',
          message_type: 'file',
          file_url: 'https://evil.example/file.pdf',
        },
        { supabaseUrl: 'https://example.supabase.co' },
      ),
      {
        ok: false,
        status: 400,
        message: 'Invalid group chat attachment URL',
      },
    );
  });

  it('accepts attachment-only v2 messages only with complete idempotency metadata', () => {
    const attachmentIntentId = '7d493f2e-21c9-4c86-b94b-43c875555001';
    const deliveryKey = '7d493f2e-21c9-4c86-b94b-43c875555002';
    const payloadFingerprint = 'a'.repeat(64);
    assert.deepEqual(
      normalizeGroupChatProxyPayload({
        type: 'group_chat_send',
        content: '',
        attachment_intent_ids: [attachmentIntentId],
        delivery_key: deliveryKey,
        payload_fingerprint: payloadFingerprint,
      }),
      {
        ok: true,
        payload: {
          type: 'group_chat_send',
          content: '',
          message_type: 'text',
          attachment_intent_ids: [attachmentIntentId],
          delivery_key: deliveryKey,
          payload_fingerprint: payloadFingerprint,
        },
      },
    );

    assert.deepEqual(
      normalizeGroupChatProxyPayload({
        type: 'group_chat_send',
        content: '',
        attachment_intent_ids: [attachmentIntentId],
        delivery_key: 'not-a-uuid',
        payload_fingerprint: payloadFingerprint,
      }),
      {
        ok: false,
        status: 400,
        message: 'Invalid group chat attachment delivery',
      },
    );
  });

  it('builds the Edge Function URL and required app-session headers', () => {
    assert.equal(
      getGroupChatFunctionUrl('https://example.supabase.co/'),
      'https://example.supabase.co/functions/v1/group-chat',
    );

    assert.deepEqual(buildGroupChatFunctionHeaders('service-role', 'app-session'), {
      'Content-Type': 'application/json',
      apikey: 'service-role',
      Authorization: 'Bearer service-role',
      'x-app-session-token': 'app-session',
    });
  });

  it('normalizes formatted FC actor ids for member send permission changes', () => {
    assert.deepEqual(
      normalizeGroupChatProxyPayload({
        type: 'group_chat_member_send_permission',
        target_actor_id: 'fc:010-1111-2222',
        can_send_messages: false,
      }),
      {
        ok: true,
        payload: {
          type: 'group_chat_member_send_permission',
          target_actor_id: 'fc:01011112222',
          can_send_messages: false,
        },
      },
    );

    assert.deepEqual(
      normalizeGroupChatProxyPayload({
        type: 'group_chat_member_send_permission',
        target_actor_id: '010 1111 2222',
        can_send_messages: true,
      }),
      {
        ok: true,
        payload: {
          type: 'group_chat_member_send_permission',
          target_actor_id: 'fc:01011112222',
          can_send_messages: true,
        },
      },
    );
  });
});
