import {
  buildGroupChatBootstrapBody,
  buildGroupChatDeleteBody,
  buildGroupChatMarkReadBody,
  buildGroupChatMemberSendPermissionBody,
  buildGroupChatNotificationRetryBody,
  buildGroupChatNoticeClearBody,
  buildGroupChatNoticeSetBody,
  buildGroupChatPreferencesBody,
  buildGroupChatReactionBody,
  buildGroupChatSendBody,
  getGroupChatNotificationRetry,
  groupChatSend,
  groupChatRetryNotification,
  hasGroupChatPostCommitWarning,
  normalizeGroupChatPermissionActorId,
  parseGroupChatBootstrapResponse,
} from '../group-chat-api';
import { getStoredAppSessionToken } from '../request-board-api';
import { supabase } from '../supabase';

jest.mock('../request-board-api', () => ({
  getStoredAppSessionToken: jest.fn(),
}));

jest.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

describe('group chat API payload builders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('builds bootstrap and mark-read bodies', () => {
    expect(buildGroupChatBootstrapBody(80)).toEqual({
      type: 'group_chat_bootstrap',
      limit: 80,
    });

    expect(buildGroupChatMarkReadBody('message-1')).toEqual({
      type: 'group_chat_mark_read',
      message_id: 'message-1',
    });
  });

  test('requires complete bootstrap member and message arrays', () => {
    const payload = {
      ok: true,
      room: {
        id: '11111111-1111-4111-8111-111111111111',
        slug: 'all',
        title: '전체 단톡방',
      },
      actor: { id: 'fc:01011112222', role: 'fc', phone: '01011112222', name: 'FC' },
      can_send_messages: true,
      member_count: 1,
      members: [{
        actor_id: 'fc:01011112222',
        role: 'fc',
        phone: '01011112222',
        name: 'FC',
        headquarters: null,
        appointment_label: '활성',
        can_send_messages: true,
      }],
      muted: false,
      unread_count: 0,
      last_read_at: null,
      last_message: null,
      messages: [],
      notice: null,
    };
    expect(parseGroupChatBootstrapResponse(payload, 50)).toMatchObject({ member_count: 1 });
    expect(() => parseGroupChatBootstrapResponse({ ...payload, members: undefined }, 50))
      .toThrow('단톡방 조회 응답');
    expect(() => parseGroupChatBootstrapResponse({
      ...payload,
      member_count: 2,
      members: [payload.members[0], payload.members[0]],
    }, 50)).toThrow('단톡방 조회 응답');
  });

  test('builds text and file send bodies', () => {
    expect(buildGroupChatSendBody({ content: '안녕하세요' })).toEqual({
      type: 'group_chat_send',
      content: '안녕하세요',
      message_type: 'text',
    });

    expect(
      buildGroupChatSendBody({
        content: '사진을 보냈습니다.',
        messageType: 'image',
        fileUrl: 'https://example.com/image.png',
        fileName: 'image.png',
        fileSize: 1234,
      }),
    ).toEqual({
      type: 'group_chat_send',
      content: '사진을 보냈습니다.',
      message_type: 'image',
      file_url: 'https://example.com/image.png',
      file_name: 'image.png',
      file_size: 1234,
    });

    expect(
      buildGroupChatSendBody({
        content: '답장입니다.',
        replyToMessageId: 'message-parent',
      }),
    ).toEqual({
      type: 'group_chat_send',
      content: '답장입니다.',
      message_type: 'text',
      reply_to_message_id: 'message-parent',
    });

    // A resend after an unknown outcome reuses this id so the server returns the stored message.
    expect(buildGroupChatSendBody({
      content: '중복 없이 보내기',
      clientMessageId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    })).toEqual({
      type: 'group_chat_send',
      content: '중복 없이 보내기',
      message_type: 'text',
      client_message_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(() => buildGroupChatSendBody({ content: '잘못된 식별자', clientMessageId: 'not-a-uuid' }))
      .toThrow('메시지 식별자가 올바르지 않습니다.');
  });

  test('preserves multiline text in send bodies', () => {
    expect(buildGroupChatSendBody({ content: '첫 줄\n둘째 줄' })).toEqual({
      type: 'group_chat_send',
      content: '첫 줄\n둘째 줄',
      message_type: 'text',
    });
  });

  test('builds reaction and delete bodies', () => {
    expect(buildGroupChatReactionBody('message-1', '👍')).toEqual({
      type: 'group_chat_reaction_set',
      message_id: 'message-1',
      reaction: '👍',
    });

    expect(buildGroupChatDeleteBody('message-1')).toEqual({
      type: 'group_chat_delete',
      message_id: 'message-1',
    });
  });

  test('builds preference body', () => {
    expect(buildGroupChatPreferencesBody(true)).toEqual({
      type: 'group_chat_preferences',
      muted: true,
    });
  });

  test('builds member send permission body', () => {
    expect(buildGroupChatMemberSendPermissionBody('fc:01011112222', true)).toEqual({
      type: 'group_chat_member_send_permission',
      target_actor_id: 'fc:01011112222',
      can_send_messages: true,
    });
  });

  test('normalizes FC member send permission targets before invoking the Edge Function', () => {
    expect(normalizeGroupChatPermissionActorId('010-1111-2222')).toBe('fc:01011112222');
    expect(normalizeGroupChatPermissionActorId('fc:010-1111-2222')).toBe('fc:01011112222');
    expect(buildGroupChatMemberSendPermissionBody('010 1111 2222', false)).toEqual({
      type: 'group_chat_member_send_permission',
      target_actor_id: 'fc:01011112222',
      can_send_messages: false,
    });
  });

  test('builds notice set and clear bodies', () => {
    expect(buildGroupChatNoticeSetBody('message-1')).toEqual({
      type: 'group_chat_notice_set',
      message_id: 'message-1',
    });

    expect(buildGroupChatNoticeClearBody()).toEqual({
      type: 'group_chat_notice_clear',
    });
  });

  test('builds attachment-only sends without legacy file URLs', () => {
    const intentId = '11111111-1111-4111-8111-111111111111';
    const deliveryKey = '22222222-2222-4222-8222-222222222222';
    expect(buildGroupChatSendBody({
      content: '',
      messageType: 'file',
      attachmentIntentIds: [intentId],
      deliveryKey,
      payloadFingerprint: 'a'.repeat(64),
      replyToMessageId: 'message-parent',
    })).toEqual({
      type: 'group_chat_send',
      content: '',
      message_type: 'file',
      attachment_intent_ids: [intentId],
      delivery_key: deliveryKey,
      payload_fingerprint: 'a'.repeat(64),
      reply_to_message_id: 'message-parent',
    });

    expect(() => buildGroupChatSendBody({
      content: '',
      messageType: 'file',
      fileUrl: 'https://legacy.example/file.pdf',
      attachmentIntentIds: [intentId],
      deliveryKey,
      payloadFingerprint: 'a'.repeat(64),
    })).toThrow();
  });

  test('classifies only exact inbox persistence failure as a post-commit warning', () => {
    const retry = {
      messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      retryToken: 'opaque-signed-retry-token',
    };
    const persistenceFailure = {
      delivery: {
        notificationStored: false,
        pushStatus: 'not_attempted' as const,
        retryable: true,
      },
      notification: {
        ok: false,
        status: 'partial',
        recipient_count: 1,
        notification_count: 1,
        push_token_count: 0,
        push_accepted_count: 0,
        push_rejected_count: 0,
        delivery: {
          notificationStored: false,
          pushStatus: 'not_attempted' as const,
          retryable: true,
        },
      },
      notificationRetry: retry,
      warning: {
        code: 'notification_delivery_partial' as const,
        message: 'fixed warning',
      },
    };
    expect(hasGroupChatPostCommitWarning(persistenceFailure)).toBe(true);
    expect(getGroupChatNotificationRetry(persistenceFailure)).toEqual(retry);

    expect(hasGroupChatPostCommitWarning({
      delivery: {
        notificationStored: true,
        pushStatus: 'provider_rejected',
        retryable: false,
      },
      read_state: { updated: false },
      notification: {
        ok: false,
        status: 'partial',
        recipient_count: 1,
        notification_count: 1,
        push_token_count: 0,
        push_accepted_count: 0,
        push_rejected_count: 0,
        delivery: {
          notificationStored: true,
          pushStatus: 'provider_rejected',
          retryable: false,
        },
      },
      warning: {
        code: 'notification_delivery_partial',
        message: 'fixed warning',
      },
    })).toBe(false);

    expect(hasGroupChatPostCommitWarning({
      delivery: {
        notificationStored: true,
        pushStatus: 'no_registered_device',
        retryable: false,
      },
    })).toBe(false);
    expect(getGroupChatNotificationRetry({
      ...persistenceFailure,
      delivery: {
        notificationStored: true,
        pushStatus: 'provider_rejected',
        retryable: false,
      },
    })).toBeNull();
  });

  test('builds and invokes only the notification retry action with the opaque server token', async () => {
    const retry = {
      messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      retryToken: 'opaque-signed-retry-token',
    };
    expect(buildGroupChatNotificationRetryBody(retry)).toEqual({
      type: 'group_chat_notification_retry',
      message_id: retry.messageId,
      retry_token: retry.retryToken,
    });
    expect(() => buildGroupChatNotificationRetryBody({
      ...retry,
      messageId: 'not-a-uuid',
    })).toThrow('알림 재시도 정보가 올바르지 않습니다.');

    (getStoredAppSessionToken as jest.Mock).mockResolvedValue('app-session');
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: {
        ok: true,
        delivery: {
          notificationStored: true,
          pushStatus: 'no_registered_device',
          retryable: false,
        },
        notificationRetry: null,
      },
      error: null,
    });

    await groupChatRetryNotification(retry);

    expect(supabase.functions.invoke).toHaveBeenCalledWith('group-chat', {
      body: {
        type: 'group_chat_notification_retry',
        message_id: retry.messageId,
        retry_token: retry.retryToken,
      },
      headers: {
        'x-app-session-token': 'app-session',
      },
    });
  });

  test('hydrates omitted legacy attachments as an empty V2 metadata list', async () => {
    (getStoredAppSessionToken as jest.Mock).mockResolvedValue('app-session');
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: {
        ok: true,
        message: {
          id: '11111111-1111-4111-8111-111111111111',
          room_id: '22222222-2222-4222-8222-222222222222',
          sender_actor_id: 'fc:01011112222',
          sender_role: 'fc',
          sender_phone: '01011112222',
          sender_name: 'FC',
          content: 'legacy.pdf',
          message_type: 'file',
          file_url: 'https://legacy.example/legacy.pdf',
          file_name: 'legacy.pdf',
          file_size: 42,
          created_at: '2026-07-25T00:00:00.000Z',
          unread_count: 0,
          reply_to_message_id: null,
          reply_to_sender_name: null,
          reply_to_content: null,
          deleted_at: null,
          deleted_by_actor_id: null,
          reactions: [],
        },
        delivery: {
          notificationStored: true,
          pushStatus: 'no_registered_device',
          retryable: false,
        },
        notificationRetry: null,
      },
      error: null,
    });

    await expect(groupChatSend({
      content: 'legacy.pdf',
      messageType: 'file',
      fileUrl: 'https://legacy.example/legacy.pdf',
      fileName: 'legacy.pdf',
      fileSize: 42,
    })).resolves.toMatchObject({
      message: {
        file_url: 'https://legacy.example/legacy.pdf',
        attachments: [],
      },
    });
  });

  test('requires a file message, exact attachment count, and commit proof for V2 sends', async () => {
    const intentId = '11111111-1111-4111-8111-111111111111';
    const deliveryKey = '22222222-2222-4222-8222-222222222222';
    const attachment = {
      id: '33333333-3333-4333-8333-333333333333',
      name: '계약서.pdf',
      size: 42,
      mimeType: 'application/pdf',
      sha256: 'a'.repeat(64),
    };
    const message = {
      id: '44444444-4444-4444-8444-444444444444',
      message_type: 'file',
      attachments: [attachment],
    };
    (getStoredAppSessionToken as jest.Mock).mockResolvedValue('app-session');
    (supabase.functions.invoke as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          ok: true,
          message: { ...message, attachments: [] },
          attachmentCommit: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          message,
          attachmentCommit: {
            batchId: '55555555-5555-4555-8555-555555555555',
            replayed: false,
          },
        },
        error: null,
      });
    const input = {
      content: '',
      messageType: 'file' as const,
      attachmentIntentIds: [intentId],
      deliveryKey,
      payloadFingerprint: 'b'.repeat(64),
    };

    await expect(groupChatSend(input)).rejects.toMatchObject({
      code: 'invalid_attachment_commit_response',
    });
    await expect(groupChatSend(input)).resolves.toMatchObject({
      message: { attachments: [attachment] },
      attachmentCommit: {
        batchId: '55555555-5555-4555-8555-555555555555',
        replayed: false,
      },
    });
  });
});
