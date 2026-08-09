import {
  MESSENGER_NOTIFICATION_LOAD_ERROR,
  MESSENGER_NOTIFICATION_SAVE_ERROR,
  buildMessengerNotificationPreferenceChange,
  buildMessengerNotificationPreferenceFailure,
  buildMessengerNotificationPreferenceLoadFailure,
  getMessengerNotificationRoomLabel,
  parseMessengerNotificationPreference,
  parseMessengerNotificationRoomRef,
  type MessengerNotificationRoomRef,
} from '../messenger-notification-preferences';

const UUIDS = {
  conversation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  room: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

const rooms: MessengerNotificationRoomRef[] = [
  {
    version: 1,
    kind: 'garamin_direct_chat',
    conversationId: UUIDS.conversation,
  },
  { version: 1, kind: 'group_chat', roomId: UUIDS.room },
  { version: 1, kind: 'request_chat', requestDesignerId: 17 },
  { version: 1, kind: 'request_direct_chat', directConversationId: 29 },
];

describe('messenger notification preference model', () => {
  it('strictly validates all four canonical typed room references', () => {
    for (const room of rooms) {
      expect(parseMessengerNotificationRoomRef(room)).toEqual(room);
      expect(parseMessengerNotificationRoomRef(JSON.stringify(room))).toEqual(room);
      expect(parseMessengerNotificationRoomRef({ ...room, roomKey: 'client-authority' })).toBeNull();
    }

    expect(parseMessengerNotificationRoomRef({
      version: 1,
      kind: 'group_chat',
      roomId: 'not-a-uuid',
    })).toBeNull();
    expect(parseMessengerNotificationRoomRef({
      version: 1,
      kind: 'request_chat',
      requestDesignerId: 0,
    })).toBeNull();
    expect(parseMessengerNotificationRoomRef({
      version: 1,
      kind: 'board_post',
      postId: UUIDS.room,
    })).toBeNull();
  });

  it('provides stable display labels without exposing raw identifiers', () => {
    expect(rooms.map(getMessengerNotificationRoomLabel)).toEqual([
      '가람In 1:1 대화',
      '가람PA 단톡방',
      '가람Link 설계요청 대화',
      '가람Link 1:1 대화',
    ]);
    for (const room of rooms) {
      expect(getMessengerNotificationRoomLabel(room)).not.toMatch(/[0-9a-f]{8}-/i);
    }
  });

  it('parses only an exact room and muted preference pair', () => {
    expect(parseMessengerNotificationPreference({ room: rooms[0], muted: true })).toEqual({
      room: rooms[0],
      muted: true,
    });
    expect(parseMessengerNotificationPreference({ room: rooms[0], muted: 'true' })).toBeNull();
    expect(parseMessengerNotificationPreference({
      room: rooms[0],
      muted: true,
      roomKey: 'forged',
    })).toBeNull();
  });

  it('builds typed changes and bounded inline failure state for caller-owned rollback', () => {
    expect(buildMessengerNotificationPreferenceChange(rooms[1], true)).toEqual({
      room: rooms[1],
      muted: true,
    });
    expect(buildMessengerNotificationPreferenceFailure(false)).toEqual({
      operation: 'save',
      attemptedMuted: false,
      message: MESSENGER_NOTIFICATION_SAVE_ERROR,
    });
    expect(buildMessengerNotificationPreferenceFailure(true, `  ${'x'.repeat(200)}  `)).toEqual({
      operation: 'save',
      attemptedMuted: true,
      message: 'x'.repeat(160),
    });
    expect(buildMessengerNotificationPreferenceLoadFailure()).toEqual({
      operation: 'load',
      message: MESSENGER_NOTIFICATION_LOAD_ERROR,
    });
    expect(buildMessengerNotificationPreferenceLoadFailure(`  ${'y'.repeat(200)}  `)).toEqual({
      operation: 'load',
      message: 'y'.repeat(160),
    });
  });
});
