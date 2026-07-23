import {
  buildGroupChatBootstrapBody,
  buildGroupChatDeleteBody,
  buildGroupChatMarkReadBody,
  buildGroupChatMemberSendPermissionBody,
  buildGroupChatNoticeClearBody,
  buildGroupChatNoticeSetBody,
  buildGroupChatPreferencesBody,
  buildGroupChatReactionBody,
  buildGroupChatSendBody,
  hasGroupChatPostCommitWarning,
  normalizeGroupChatPermissionActorId,
} from '../group-chat-api';

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

  test('classifies all post-commit warnings without message payloads', () => {
    expect(hasGroupChatPostCommitWarning({
      notification: {
        ok: false,
        status: 'partial',
        recipient_count: 1,
        notification_count: 1,
        push_token_count: 0,
        push_accepted_count: 0,
        push_rejected_count: 0,
      },
      warning: null,
    })).toBe(true);

    expect(hasGroupChatPostCommitWarning({
      read_state: { updated: false },
      warning: {
        code: 'notification_delivery_partial',
        message: 'fixed warning',
      },
    })).toBe(true);

    expect(hasGroupChatPostCommitWarning({
      read_state: { updated: true },
      notification: {
        ok: true,
        status: 'provider_accepted',
        recipient_count: 1,
        notification_count: 1,
        push_token_count: 1,
        push_accepted_count: 1,
        push_rejected_count: 0,
      },
      warning: null,
    })).toBe(false);
  });
});
