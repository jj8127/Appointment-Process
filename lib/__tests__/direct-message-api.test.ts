import { invokeFcNotify } from '../fc-notify-client';
import {
  deleteGaraminDirectMessage,
  fetchGaraminDirectMessages,
  markGaraminDirectMessagesRead,
  resolveGaraminDirectConversation,
  sendGaraminDirectBroadcast,
  sendGaraminDirectMessage,
} from '../direct-message-api';

jest.mock('../fc-notify-client', () => ({
  invokeFcNotify: jest.fn(),
  classifyFcNotifyDeliveryResult: jest.fn(() => ({
    confirmed: true,
    notificationStored: true,
    sent: 0,
    state: 'stored_push_unconfirmed',
  })),
}));

const invokeFcNotifyMock = invokeFcNotify as jest.MockedFunction<
  typeof invokeFcNotify
>;
const conversationId = '123e4567-e89b-42d3-a456-426614174000';
const messageId = '223e4567-e89b-42d3-a456-426614174000';
const secondMessageId = '323e4567-e89b-42d3-a456-426614174000';
const clientMessageId = messageId;

const conversation = {
  id: conversationId,
  counterparty_id: '01012345678',
  counterparty_name: 'FC',
};

const message = {
  id: messageId,
  conversation_id: conversationId,
  sender_id: 'admin',
  receiver_id: '01012345678',
  content: 'hello',
  created_at: '2026-07-25T00:00:00.000Z',
  is_read: false,
  message_type: 'text' as const,
};

describe('direct-message authenticated service API', () => {
  beforeEach(() => {
    invokeFcNotifyMock.mockReset();
  });

  it('resolves only the requested conversation id', async () => {
    invokeFcNotifyMock.mockResolvedValue({
      data: { ok: true, conversation },
      error: null,
    });

    await expect(
      resolveGaraminDirectConversation({ conversationId }),
    ).resolves.toEqual({
      id: conversationId,
      counterpartyId: '01012345678',
      counterpartyName: 'FC',
    });
    expect(invokeFcNotifyMock).toHaveBeenCalledWith({
      type: 'resolve_garamin_direct_conversation',
      conversation_id: conversationId,
    });

    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        conversation: {
          ...conversation,
          id: '423e4567-e89b-42d3-a456-426614174000',
        },
      },
      error: null,
    });
    await expect(
      resolveGaraminDirectConversation({ conversationId }),
    ).rejects.toThrow();
  });

  it('lists exact-conversation messages in server order', async () => {
    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        conversation,
        messages: [
          message,
          {
            ...message,
            id: secondMessageId,
            created_at: '2026-07-25T00:01:00.000Z',
          },
        ],
      },
      error: null,
    });

    await expect(fetchGaraminDirectMessages(conversationId)).resolves.toMatchObject({
      conversation: { id: conversationId },
      messages: [{ id: messageId }, { id: secondMessageId }],
    });
    expect(invokeFcNotifyMock).toHaveBeenCalledWith({
      type: 'direct_message_list',
      conversation_id: conversationId,
    });
  });

  it('rejects foreign, malformed, and out-of-order list rows', async () => {
    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        conversation,
        messages: [{ ...message, conversation_id: secondMessageId }],
      },
      error: null,
    });
    await expect(fetchGaraminDirectMessages(conversationId)).rejects.toThrow();

    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        conversation,
        messages: [
          { ...message, created_at: '2026-07-25T00:01:00.000Z' },
          {
            ...message,
            id: secondMessageId,
            created_at: '2026-07-25T00:00:00.000Z',
          },
        ],
      },
      error: null,
    });
    await expect(fetchGaraminDirectMessages(conversationId)).rejects.toThrow();
  });

  it('dual-reads legacy single-file rows while keeping V2 URLs private', async () => {
    invokeFcNotifyMock.mockResolvedValueOnce({
      data: {
        ok: true,
        conversation,
        messages: [{
          ...message,
          message_type: 'file',
          content: 'legacy.pdf',
          file_url: 'https://legacy.example/legacy.pdf',
          file_name: 'legacy.pdf',
          file_size: 42,
        }],
      },
      error: null,
    });
    await expect(fetchGaraminDirectMessages(conversationId)).resolves.toMatchObject({
      messages: [{
        message_type: 'file',
        attachments: [],
        file_url: 'https://legacy.example/legacy.pdf',
        file_name: 'legacy.pdf',
        file_size: 42,
      }],
    });

    invokeFcNotifyMock.mockResolvedValueOnce({
      data: {
        ok: true,
        conversation,
        messages: [{
          ...message,
          message_type: 'file',
          content: '',
          file_url: 'https://must-not-mix.example/file.pdf',
          attachments: [{
            id: '423e4567-e89b-42d3-a456-426614174000',
            name: 'private.pdf',
            size: 42,
            mimeType: 'application/pdf',
            sha256: 'a'.repeat(64),
          }],
        }],
      },
      error: null,
    });
    await expect(fetchGaraminDirectMessages(conversationId)).rejects.toThrow();
  });

  it('sends trimmed text through an exact conversation', async () => {
    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        message,
        delivery: {
          notificationStored: true,
          pushStatus: 'provider_rejected',
          accepted: 0,
        },
      },
      error: null,
    });

    await expect(
      sendGaraminDirectMessage({
        conversationId,
        clientMessageId,
        content: '  hello  ',
      }),
    ).resolves.toEqual({
      message: {
        ...message,
        attachments: [],
        file_url: null,
        file_name: null,
        file_size: null,
      },
      delivery: {
        confirmed: true,
        notificationStored: true,
        sent: 0,
        state: 'stored_push_unconfirmed',
      },
      attachmentCommit: null,
    });
    expect(invokeFcNotifyMock).toHaveBeenCalledWith({
      type: 'direct_message_send',
      conversation_id: conversationId,
      client_message_id: clientMessageId,
      content: 'hello',
    });
  });

  it('sends attachment-only messages with the exact idempotency tuple', async () => {
    const intentId = '423e4567-e89b-42d3-a456-426614174000';
    const deliveryKey = '523e4567-e89b-42d3-a456-426614174000';
    const batchId = '623e4567-e89b-42d3-a456-426614174000';
    const attachment = {
      id: '723e4567-e89b-42d3-a456-426614174000',
      name: '계약서.pdf',
      size: 123,
      mimeType: 'application/pdf',
      sha256: 'a'.repeat(64),
    };
    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        message: {
          ...message,
          content: '',
          message_type: 'file',
          attachments: [attachment],
          file_url: null,
          file_name: null,
          file_size: null,
        },
        attachmentCommit: { batchId, replayed: false },
      },
      error: null,
    });

    await expect(sendGaraminDirectMessage({
      conversationId,
      clientMessageId,
      content: '',
      attachmentIntentIds: [intentId],
      deliveryKey,
      payloadFingerprint: 'b'.repeat(64),
    })).resolves.toMatchObject({
      message: { content: '', attachments: [attachment] },
      attachmentCommit: { batchId, replayed: false },
    });
    expect(invokeFcNotifyMock).toHaveBeenCalledWith({
      type: 'direct_message_send',
      conversation_id: conversationId,
      client_message_id: clientMessageId,
      content: '',
      attachment_intent_ids: [intentId],
      delivery_key: deliveryKey,
      payload_fingerprint: 'b'.repeat(64),
    });
  });

  it('rejects attachment sends unless the response proves the exact file commit', async () => {
    const intentId = '423e4567-e89b-42d3-a456-426614174000';
    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        message: {
          ...message,
          content: '',
          message_type: 'file',
          attachments: [{
            id: '623e4567-e89b-42d3-a456-426614174000',
            name: '계약서.pdf',
            size: 42,
            mimeType: 'application/pdf',
            sha256: 'a'.repeat(64),
          }],
          file_url: null,
          file_name: null,
          file_size: null,
        },
        attachmentCommit: null,
      },
      error: null,
    });

    await expect(sendGaraminDirectMessage({
      conversationId,
      clientMessageId,
      content: '',
      attachmentIntentIds: [intentId],
      deliveryKey: '523e4567-e89b-42d3-a456-426614174000',
      payloadFingerprint: 'b'.repeat(64),
    })).rejects.toThrow('서버가 첨부파일 저장을 확인하지 못했습니다.');
  });

  it('uses one shared attachment batch for a multi-recipient broadcast', async () => {
    const conversationIds = [
      conversationId,
      '423e4567-e89b-42d3-a456-426614174000',
    ];
    const clientMessageIds = [messageId, secondMessageId];
    const intentId = '523e4567-e89b-42d3-a456-426614174000';
    const deliveryKey = '623e4567-e89b-42d3-a456-426614174000';
    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        messages: conversationIds.map((id, index) => ({
          ...message,
          id: clientMessageIds[index],
          conversation_id: id,
          content: '',
          message_type: 'file',
          attachments: [{
            id: '723e4567-e89b-42d3-a456-426614174000',
            name: '공지.txt',
            size: 3,
            mimeType: 'text/plain',
            sha256: 'c'.repeat(64),
          }],
          file_url: null,
          file_name: null,
          file_size: null,
        })),
        attachmentCommit: {
          batchId: '823e4567-e89b-42d3-a456-426614174000',
          replayed: false,
        },
      },
      error: null,
    });

    await sendGaraminDirectBroadcast({
      conversationIds,
      clientMessageIds,
      content: '',
      attachmentIntentIds: [intentId],
      deliveryKey,
      payloadFingerprint: 'd'.repeat(64),
    });

    expect(invokeFcNotifyMock).toHaveBeenCalledTimes(1);
    expect(invokeFcNotifyMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'direct_message_broadcast_send',
      conversation_ids: conversationIds,
      client_message_ids: clientMessageIds,
      attachment_intent_ids: [intentId],
      delivery_key: deliveryKey,
    }));
  });

  it('marks and deletes through mandatory conversation-scoped actions', async () => {
    invokeFcNotifyMock.mockResolvedValueOnce({
      data: { ok: true, updated: 2 },
      error: null,
    });
    await expect(
      markGaraminDirectMessagesRead(conversationId),
    ).resolves.toBe(2);
    expect(invokeFcNotifyMock).toHaveBeenLastCalledWith({
      type: 'direct_message_mark_read',
      conversation_id: conversationId,
    });

    invokeFcNotifyMock.mockResolvedValueOnce({
      data: { ok: true, deleted: true },
      error: null,
    });
    await expect(
      deleteGaraminDirectMessage({ conversationId, messageId }),
    ).resolves.toBeUndefined();
    expect(invokeFcNotifyMock).toHaveBeenLastCalledWith({
      type: 'direct_message_delete',
      conversation_id: conversationId,
      message_id: messageId,
    });
  });

  it('fails closed before invoking for invalid ids or content', async () => {
    await expect(
      fetchGaraminDirectMessages('not-a-uuid'),
    ).rejects.toThrow();
    await expect(
      sendGaraminDirectMessage({
        conversationId,
        clientMessageId,
        content: '   ',
      }),
    ).rejects.toThrow();
    await expect(
      sendGaraminDirectMessage({
        conversationId,
        clientMessageId: 'not-a-uuid',
        content: 'hello',
      }),
    ).rejects.toThrow();
    await expect(
      deleteGaraminDirectMessage({
        conversationId,
        messageId: 'not-a-uuid',
      }),
    ).rejects.toThrow();
    expect(invokeFcNotifyMock).not.toHaveBeenCalled();
  });
});
