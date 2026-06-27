import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildGroupChatFunctionHeaders,
  getGroupChatFunctionUrl,
  normalizeGroupChatProxyPayload,
} from './group-chat-web.ts';

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
});
