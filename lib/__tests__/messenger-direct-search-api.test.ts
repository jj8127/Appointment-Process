import { invokeFcNotify } from '../fc-notify-client';
import {
  fetchGaraminDirectMessageContext,
  resolveGaraminDirectConversation,
  searchGaraminDirectMessages,
} from '../direct-message-api';

jest.mock('../fc-notify-client', () => ({
  invokeFcNotify: jest.fn(),
  classifyFcNotifyDeliveryResult: jest.fn(),
}));

const invokeFcNotifyMock = invokeFcNotify as jest.MockedFunction<typeof invokeFcNotify>;
const conversationId = '123e4567-e89b-42d3-a456-426614174000';
const messageId = '223e4567-e89b-42d3-a456-426614174000';
const beforeId = '123e4567-e89b-42d3-a456-426614174001';

const room = {
  version: 1,
  kind: 'garamin_direct_chat',
  conversationId,
} as const;

describe('Messenger V2 direct search client contract', () => {
  beforeEach(() => invokeFcNotifyMock.mockReset());

  test('sends only bounded search input and parses canonical existing-room results', async () => {
    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        results: [{
          source: 'garamin_direct',
          room,
          messageId,
          sentAt: '2026-08-04T01:00:00.000Z',
          excerpt: 'literal %_ query',
          roomLabel: 'FC',
          senderLabel: '총무',
        }],
      },
      error: null,
    });

    await expect(searchGaraminDirectMessages({ q: '  %_  ', limit: 1 }))
      .resolves.toEqual([expect.objectContaining({ messageId, room })]);
    expect(invokeFcNotifyMock).toHaveBeenCalledWith({
      type: 'direct_message_search',
      q: '%_',
      limit: 1,
    });
  });

  test.each([
    { q: '한' },
    { q: '가'.repeat(101) },
    { q: 'ok', limit: 0 },
    { q: 'ok', limit: 51 },
  ])('rejects malformed search input without invoking Edge: %o', async (input) => {
    await expect(searchGaraminDirectMessages(input)).rejects.toThrow();
    expect(invokeFcNotifyMock).not.toHaveBeenCalled();
  });

  test('rejects foreign or fabricated room references in the response', async () => {
    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        results: [{
          source: 'garamin_direct',
          room: { ...room, conversationId: 'legacy-envelope' },
          messageId,
          sentAt: '2026-08-04T01:00:00.000Z',
          excerpt: 'match',
          roomLabel: 'FC',
          senderLabel: '총무',
        }],
      },
      error: null,
    });
    await expect(searchGaraminDirectMessages({ q: 'match' })).rejects.toThrow();
  });

  test('accepts an explicitly canonicalized thread id but never returns the legacy envelope id', async () => {
    const legacyId = '423e4567-e89b-42d3-a456-426614174000';
    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        conversation: {
          id: conversationId,
          requested_id: legacyId,
          counterparty_id: '01022223333',
          counterparty_name: 'FC',
        },
      },
      error: null,
    });
    await expect(resolveGaraminDirectConversation({ conversationId: legacyId }))
      .resolves.toMatchObject({ id: conversationId });
  });
});

describe('Messenger V2 direct message context client contract', () => {
  beforeEach(() => invokeFcNotifyMock.mockReset());

  test('requests canonical context without read or actor claims', async () => {
    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        room,
        anchorMessageId: messageId,
        messages: [
          {
            messageId: beforeId,
            sentAt: '2026-08-04T00:59:00.000Z',
            content: 'before',
            senderLabel: 'FC',
            senderSide: 'counterparty',
            isAnchor: false,
          },
          {
            messageId,
            sentAt: '2026-08-04T01:00:00.000Z',
            content: 'anchor',
            senderLabel: '총무',
            senderSide: 'viewer',
            isAnchor: true,
          },
        ],
      },
      error: null,
    });

    await expect(fetchGaraminDirectMessageContext({ conversationId, messageId }))
      .resolves.toMatchObject({
        anchorMessageId: messageId,
        room,
        messages: [
          expect.objectContaining({ messageId: beforeId, senderSide: 'counterparty' }),
          expect.objectContaining({ messageId, senderSide: 'viewer' }),
        ],
      });
    expect(invokeFcNotifyMock).toHaveBeenCalledWith({
      type: 'direct_message_context',
      conversation_id: conversationId,
      message_id: messageId,
    });
  });

  test('rejects context with the wrong anchor or more than 41 rows', async () => {
    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        room,
        anchorMessageId: messageId,
        messages: Array.from({ length: 42 }, (_, index) => ({
          messageId: index === 0 ? messageId : beforeId,
          sentAt: '2026-08-04T01:00:00.000Z',
          content: 'message',
          senderLabel: 'FC',
          senderSide: 'counterparty',
          isAnchor: index === 0,
        })),
      },
      error: null,
    });
    await expect(fetchGaraminDirectMessageContext({ conversationId, messageId }))
      .rejects.toThrow();
  });

  test.each([
    { label: 'missing', senderSide: undefined },
    { label: 'unknown string', senderSide: 'staff' },
    { label: 'string-coercible object', senderSide: { toString: (): string => 'viewer' } },
  ])('rejects a $label sender side', async ({ senderSide }) => {
    invokeFcNotifyMock.mockResolvedValue({
      data: {
        ok: true,
        room,
        anchorMessageId: messageId,
        messages: [{
          messageId,
          sentAt: '2026-08-04T01:00:00.000Z',
          content: 'anchor',
          senderLabel: '총무',
          senderSide,
          isAnchor: true,
        }],
      },
      error: null,
    });

    await expect(fetchGaraminDirectMessageContext({ conversationId, messageId }))
      .rejects.toThrow('Direct message context response is invalid');
  });
});
