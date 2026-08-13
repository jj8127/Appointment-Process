import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  REQUEST_BOARD_MESSAGE_CONTEXT_GUIDANCE,
  buildRbMessageContextPath,
  buildRbMessengerRoomMutedPayload,
  parseRbMessageContextPage,
  parseRbMessengerRoomPreference,
  parseRbMessengerRoomPreferencesPayload,
  rbGetDirectMessageContext,
  rbGetMessageContext,
  rbGetMessengerRoomPreferences,
  rbLeaveMessengerRoom,
  rbMarkDmMessagesRead,
  rbMarkMessagesRead,
  rbSetMessengerRoomPinned,
  rbSetMessengerRoomMuted,
} from '../request-board-api';

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn() },
}));
jest.mock('../request-board-url', () => ({
  getRequestBoardApiBaseUrl: () => 'https://request-board.test',
}));
jest.mock('../safe-storage', () => ({
  safeStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('../secure-token-storage', () => ({
  sensitiveTokenStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const requestMessage = (id: number, roomId = 7) => ({
  id,
  request_designer_id: roomId,
  sender_id: 3,
  message: `request-${id}`,
  is_read: false,
  created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
  deleted_at: null,
  sender: { id: 3, name: 'FC', role: 'fc', affiliation: null },
  message_attachments: [],
});

const directMessage = (id: number, roomId = 9) => ({
  id,
  direct_conversation_id: roomId,
  sender_id: 4,
  message: `direct-${id}`,
  is_read: true,
  created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
  deleted_at: null,
  sender: { id: 4, name: '설계매니저', role: 'designer' },
  direct_message_attachments: [],
});

const contextPage = (messages: unknown[], anchorId: number) => ({
  messages,
  hasBefore: true,
  hasAfter: false,
  anchorId,
  anchorFound: true,
});

const jsonResponse = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

describe('Request Board exact message context contracts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds only the exact read-only request and direct context paths', () => {
    expect(buildRbMessageContextPath('request', 7, 11)).toBe(
      '/api/messages/context?requestDesignerId=7&messageId=11',
    );
    expect(buildRbMessageContextPath('direct', 9, 12)).toBe(
      '/api/direct-messages/context?conversationId=9&messageId=12',
    );
    expect(() => buildRbMessageContextPath('request', 0, 11)).toThrow();
    expect(() => buildRbMessageContextPath('direct', 9, Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it('accepts at most 41 oldest-first messages with one exact anchor in one exact room', () => {
    const requestPage = contextPage(
      [requestMessage(10), requestMessage(11), requestMessage(12)],
      11,
    );
    expect(parseRbMessageContextPage('request', 7, 11, requestPage)).toEqual(requestPage);

    const directPage = contextPage(
      [directMessage(20), directMessage(21), directMessage(22)],
      21,
    );
    expect(parseRbMessageContextPage('direct', 9, 21, directPage)).toEqual(directPage);

    const cappedPage = contextPage(
      Array.from({ length: 41 }, (_, index) => requestMessage(index + 1)),
      21,
    );
    expect(parseRbMessageContextPage('request', 7, 21, cappedPage)?.messages).toHaveLength(41);
  });

  it.each([
    ['more than 41 rows', contextPage(Array.from({ length: 42 }, (_, i) => requestMessage(i + 1)), 21)],
    ['wrong room row', contextPage([requestMessage(10), requestMessage(11, 8)], 11)],
    ['missing anchor row', contextPage([requestMessage(10), requestMessage(12)], 11)],
    ['descending rows', contextPage([requestMessage(12), requestMessage(11)], 11)],
    ['duplicate rows', contextPage([requestMessage(11), requestMessage(11)], 11)],
    ['forged sender relation', contextPage([
      { ...requestMessage(11), sender: { id: 99, name: '다른 사용자', role: 'fc' } },
    ], 11)],
    ['forged attachment relation', contextPage([{
      ...requestMessage(11),
      message_attachments: [{
        id: 1,
        message_id: 99,
        file_name: 'proof.pdf',
        file_type: 'application/pdf',
        file_size: 12,
        file_url: 'https://files.test/proof.pdf',
        created_at: '2026-01-01T00:00:00.000Z',
      }],
    }], 11)],
  ])('fails closed for %s', (_label, payload) => {
    expect(parseRbMessageContextPage('request', 7, 11, payload)).toBeNull();
  });

  it('performs strict GETs without mark-read parameters and hides server lookup details', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: contextPage([requestMessage(10), requestMessage(11)], 11),
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: contextPage([directMessage(20), directMessage(21)], 21),
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: false,
        error: 'internal user 44 is not a participant',
      }, 404));

    await expect(rbGetMessageContext(7, 11)).resolves.toMatchObject({ success: true });
    await expect(rbGetDirectMessageContext(9, 21)).resolves.toMatchObject({ success: true });
    await expect(rbGetMessageContext(7, 99)).resolves.toEqual({
      success: false,
      error: REQUEST_BOARD_MESSAGE_CONTEXT_GUIDANCE,
      retryable: false,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://request-board.test/api/messages/context?requestDesignerId=7&messageId=11',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://request-board.test/api/direct-messages/context?conversationId=9&messageId=21',
      expect.objectContaining({ method: 'GET' }),
    );
    const requestedUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(requestedUrls.join('\n')).not.toContain('markRead');
    expect(JSON.stringify(await rbGetMessageContext(0, 1))).not.toContain('participant');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('wires route anchor merge, exact inverted-list scrolling, highlighting, and safe fallback', () => {
    const screen = readFileSync(
      join(__dirname, '..', '..', 'app', 'request-board-messenger.tsx'),
      'utf8',
    );
    expect(screen).toContain('anchorMessageId?: string | string[]');
    expect(screen).toContain('parseExactlyOnePositiveIntegerRouteParam(anchorMessageId)');
    expect(screen).toContain('rbGetMessageContext(parsedRequestDesignerId!');
    expect(screen).toContain('rbGetDirectMessageContext(parsedDirectConversationId!');
    expect(screen).toContain('mergeMessagesDesc([...mappedContext, ...current])');
    expect(screen).toContain('scrollToIndex({');
    expect(screen).toContain('onScrollToIndexFailed={handleAnchorScrollToIndexFailed}');
    expect(screen).toContain('styles.anchorMessageHighlight');
    expect(screen).toContain('scrollToOffset({ offset: 0, animated: true })');
    expect(screen).toContain('latestMessagesRef.current.some((message) => message.id === messageId)');
    expect(screen).toContain('focusAnchorFromLoadedMessages(parsedAnchorMessageId)');
    expect(screen).toContain('accessibilityLabel="최신 메시지로 이동"');
    expect(screen).toContain('<Text style={styles.anchorLatestButtonText}>최신 메시지로</Text>');
    expect(screen).toContain('onPress={handleReturnToLatestMessage}');
    expect(screen).toMatch(
      /const handleReturnToLatestMessage = useCallback\(\(\) => \{[\s\S]{0,160}anchorContextSequenceRef\.current \+= 1/,
    );
  });
});

describe('Request Board messenger room preference API contracts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const requestPreference = {
    room: { type: 'request', requestDesignerId: 17 },
    roomKey: 'garamlink:request-peer:designer:41',
    displayLabel: '설계매니저',
    muted: true,
  } as const;
  const directPreference = {
    room: { type: 'direct', conversationId: 29 },
    roomKey: 'garamlink:direct:29',
    muted: false,
  } as const;

  it('strictly validates server-derived keys and rejects client-authored roomKey fields', () => {
    expect(parseRbMessengerRoomPreference(requestPreference)).toEqual(requestPreference);
    expect(parseRbMessengerRoomPreference(directPreference)).toEqual(directPreference);
    expect(parseRbMessengerRoomPreference({
      ...directPreference,
      roomKey: 'garamlink:direct:30',
    })).toBeNull();
    expect(parseRbMessengerRoomPreference({
      ...directPreference,
      pinnedAt: '2026-08-08T00:00:00.000Z',
      leftAt: null,
    })).toEqual({
      ...directPreference,
      pinnedAt: '2026-08-08T00:00:00.000Z',
      leftAt: null,
    });
    expect(parseRbMessengerRoomPreferencesPayload({
      rooms: [requestPreference, directPreference],
    })).toEqual({ rooms: [requestPreference, directPreference] });
    expect(parseRbMessengerRoomPreferencesPayload({
      rooms: [directPreference, directPreference],
    })).toBeNull();
    expect(buildRbMessengerRoomMutedPayload({
      type: 'request',
      requestDesignerId: 17,
      roomKey: 'client-authority',
    }, true)).toBeNull();
  });

  it('GETs all accessible rooms and PATCHes only typed room plus muted', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: { rooms: [requestPreference, directPreference] },
      }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: requestPreference }));

    await expect(rbGetMessengerRoomPreferences()).resolves.toEqual({
      success: true,
      data: { rooms: [requestPreference, directPreference] },
    });
    await expect(rbSetMessengerRoomMuted(requestPreference.room, true)).resolves.toEqual({
      success: true,
      data: requestPreference,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://request-board.test/api/notification-preferences/rooms',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://request-board.test/api/notification-preferences/rooms',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          room: { type: 'request', requestDesignerId: 17 },
          muted: true,
        }),
      }),
    );
    const patchOptions = fetchMock.mock.calls[1][1];
    expect(String(patchOptions?.body)).not.toContain('roomKey');
  });

  it('uses typed lightweight endpoints for pin, leave, and read actions', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const pinned = { ...directPreference, pinnedAt: '2026-08-08T00:00:00.000Z', leftAt: null };
    const left = { ...directPreference, pinnedAt: null, leftAt: '2026-08-08T00:01:00.000Z' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: pinned }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: left }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { conversationIds: [17] } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { conversationId: 29 } }));

    await expect(rbSetMessengerRoomPinned(directPreference.room, true))
      .resolves.toEqual({ success: true, data: pinned });
    await expect(rbLeaveMessengerRoom(directPreference.room))
      .resolves.toEqual({ success: true, data: left });
    await expect(rbMarkMessagesRead([17])).resolves.toEqual({ success: true });
    await expect(rbMarkDmMessagesRead(29)).resolves.toEqual({ success: true });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://request-board.test/api/notification-preferences/rooms',
      'https://request-board.test/api/notification-preferences/rooms',
      'https://request-board.test/api/messages/read',
      'https://request-board.test/api/direct-messages/29/read',
    ]);
  });

});
