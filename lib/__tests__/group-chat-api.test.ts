import {
  buildGroupChatBootstrapBody,
  buildGroupChatDeleteBody,
  buildGroupChatMarkReadBody,
  buildGroupChatPreferencesBody,
  buildGroupChatReactionBody,
  buildGroupChatSendBody,
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
});
