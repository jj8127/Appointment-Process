import {
  rbGetMessengerRoomPreferences,
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

const jsonResponse = (body: unknown, status: number): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

describe('Request Board room-preference legacy server compatibility', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('uses one 404 capability probe and stops later GET/PATCH HTTP attempts', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'Not Found' }, 404));

    await expect(rbGetMessengerRoomPreferences()).resolves.toEqual({
      success: true,
      data: { rooms: [] },
      supported: false,
    });
    await expect(rbGetMessengerRoomPreferences()).resolves.toEqual({
      success: true,
      data: { rooms: [] },
      supported: false,
    });
    await expect(rbSetMessengerRoomMuted({ type: 'request', requestDesignerId: 17 }, true))
      .resolves.toEqual({
        success: false,
        error: '가람Link 서버 업데이트 후 방 알림 설정을 사용할 수 있습니다.',
        retryable: false,
      });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
