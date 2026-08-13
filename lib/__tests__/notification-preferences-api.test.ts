const getStoredAppSessionTokenMock = jest.fn();
const invokeMock = jest.fn();
const unregisterAllPushTokensMock = jest.fn();

jest.mock('../request-board-api', () => ({
  getStoredAppSessionToken: getStoredAppSessionTokenMock,
}));
jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: invokeMock } },
}));
jest.mock('../notifications', () => ({
  unregisterAllPushTokens: unregisterAllPushTokensMock,
}));

import {
  buildMessengerRoomRef,
  getMutedMessengerRooms,
  getNotificationPreferences,
  leaveRoom,
  setGlobalPushEnabled,
  setPushCategoryEnabled,
  setRoomPinned,
  setRoomMuted,
} from '../notification-preferences-api';

const response = {
  ok: true,
  actor: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'fc' },
  globalPushEnabled: true,
  categories: {
    messages: true,
    request_activity: true,
    notices: false,
    operations: true,
  },
  rooms: [{
    roomKey: 'garamin:direct-thread:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    muted: true,
    updatedAt: '2026-08-04T00:00:00.000Z',
  }],
};

describe('notification preferences mobile API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getStoredAppSessionTokenMock.mockResolvedValue('signed-session');
    invokeMock.mockResolvedValue({ data: response, error: null });
    unregisterAllPushTokensMock.mockResolvedValue({ ok: true });
  });

  it('bootstraps the fixed four-category contract', async () => {
    await expect(getNotificationPreferences()).resolves.toEqual(response);
    expect(invokeMock).toHaveBeenCalledWith('notification-preferences', {
      body: { action: 'bootstrap' },
      headers: { 'x-app-session-token': 'signed-session' },
    });
  });

  it('fails closed for malformed or duplicate room preference rows', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        ...response,
        rooms: [response.rooms[0], { ...response.rooms[0] }],
      },
      error: null,
    });
    await expect(getNotificationPreferences()).rejects.toThrow(
      'notification_preferences_request_failed',
    );

    invokeMock.mockResolvedValueOnce({
      data: {
        ...response,
        rooms: [{ ...response.rooms[0], roomKey: 'garamin:group:not-a-uuid' }],
      },
      error: null,
    });
    await expect(getNotificationPreferences()).rejects.toThrow(
      'notification_preferences_request_failed',
    );
  });

  it('sends only canonical room keys', async () => {
    const ref = buildMessengerRoomRef(
      'direct-thread',
      'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
    );
    await setRoomMuted(ref, true);
    expect(invokeMock).toHaveBeenLastCalledWith('notification-preferences', expect.objectContaining({
      body: {
        action: 'set_room',
        roomKey: 'garamin:direct-thread:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        muted: true,
      },
    }));
  });

  it('sends pin and non-destructive leave actions through the signed room contract', async () => {
    const ref = buildMessengerRoomRef(
      'direct-thread',
      'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
    );
    await setRoomPinned(ref, true);
    expect(invokeMock).toHaveBeenLastCalledWith('notification-preferences', expect.objectContaining({
      body: {
        action: 'set_room_pinned',
        roomKey: ref.key,
        pinned: true,
      },
    }));
    await leaveRoom(ref);
    expect(invokeMock).toHaveBeenLastCalledWith('notification-preferences', expect.objectContaining({
      body: { action: 'leave_room', roomKey: ref.key },
    }));
  });

  it('accepts PostgREST RFC 3339 timestamps with a numeric UTC offset', async () => {
    const postgrestResponse = {
      ...response,
      rooms: [
        {
          roomKey: 'garamin:group:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          muted: false,
          pinnedAt: '2026-08-09T01:02:03.456+00:00',
          leftAt: null,
          updatedAt: '2026-08-09T01:02:03.456+00:00',
        },
        {
          roomKey: 'garamin:direct-thread:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          muted: false,
          pinnedAt: null,
          leftAt: '2026-08-09T01:03:04.567+00:00',
          updatedAt: '2026-08-09T01:03:04.567+00:00',
        },
      ],
    };
    invokeMock.mockResolvedValueOnce({ data: postgrestResponse, error: null });

    await expect(getNotificationPreferences()).resolves.toEqual(postgrestResponse);
  });

  it('supports all category updates and returns only muted rooms', async () => {
    await setPushCategoryEnabled('operations', false);
    await expect(getMutedMessengerRooms()).resolves.toEqual(response.rooms);
  });

  it('unregisters the signed actor tokens after global OFF is durable', async () => {
    await setGlobalPushEnabled(false);
    expect(invokeMock).toHaveBeenCalledWith('notification-preferences', expect.objectContaining({
      body: { action: 'set_global', enabled: false },
    }));
    expect(unregisterAllPushTokensMock).toHaveBeenCalledTimes(1);
  });
});
