import type { GroupChatBootstrapResponse } from '../group-chat-api';
import type { InternalChatListItem } from '../internal-chat-api';
import {
  applyMessengerRoomPreferences,
  buildFcTargetRows,
  buildGroupConversation,
  buildInternalListRows,
  buildRequestDmRows,
  buildRequestDirectoryPeople,
  classifyMessengerPersonRole,
  dedupePeople,
  formatMessengerPersonDetail,
  formatOperationsMessengerName,
  groupMessengerPeopleByRole,
  getMessengerTotalUnread,
  isMessengerConversationVisible,
  parseMessengerTimestamp,
  sortMessengerConversations,
  type MessengerHubConversation,
} from '../messenger-hub-model';
import { getMessengerHubCapabilities } from '../messenger-role-capabilities';

describe('Messenger V2 hub role capabilities', () => {
  test('keeps a plain admin entirely outside GaramLink', () => {
    expect(getMessengerHubCapabilities({
      role: 'admin',
      readOnly: false,
      staffType: 'admin',
    })).toMatchObject({
      internalPeopleSource: 'internal-list',
      canUseGroupChat: true,
      canReadRequestBoard: false,
      canLoadRequestBoardDirectory: false,
      canCreateRequestBoardDm: false,
    });
  });

  test('lets a read-only manager read existing GaramLink chats without creating DMs', () => {
    expect(getMessengerHubCapabilities({
      role: 'admin',
      readOnly: true,
      staffType: null,
    })).toMatchObject({
      canReadRequestBoard: true,
      canLoadRequestBoardDirectory: false,
      canCreateRequestBoardDm: false,
    });
  });

  test('does not load the full GaramLink directory into the developer people tab', () => {
    expect(getMessengerHubCapabilities({
      role: 'admin',
      staffType: 'developer',
    })).toMatchObject({
      internalPeopleSource: 'internal-list',
      canReadRequestBoard: true,
      canLoadRequestBoardDirectory: false,
      canCreateRequestBoardDm: true,
    });
  });

  test('uses role-scoped internal sources and excludes designers from group chat', () => {
    expect(getMessengerHubCapabilities({ role: 'fc' }).internalPeopleSource).toBe('fc-targets');
    expect(getMessengerHubCapabilities({
      role: 'fc',
      isRequestBoardDesigner: true,
    })).toMatchObject({
      internalPeopleSource: 'internal-list',
      canUseGroupChat: false,
      canReadRequestBoard: true,
      canCreateRequestBoardDm: true,
    });
  });
});

describe('Messenger V2 hub model', () => {
  const baseConversation = (overrides: Partial<MessengerHubConversation>): MessengerHubConversation => ({
    key: 'base',
    name: '기본 대화',
    detail: 'FC',
    role: 'fc',
    sourceLabel: '가람in',
    route: { kind: 'group' },
    preview: '메시지',
    timestamp: null,
    timestampMs: 0,
    unreadCount: 0,
    ...overrides,
  });

  test('sorts by server timestamp and stable source/key fallback without current time', () => {
    const rows = sortMessengerConversations([
      baseConversation({ key: 'z', sourceLabel: '가람Link', timestampMs: 0 }),
      baseConversation({ key: 'b', sourceLabel: '가람in', timestampMs: 0 }),
      baseConversation({ key: 'a', sourceLabel: '가람in', timestampMs: 0 }),
      baseConversation({ key: 'new', timestampMs: 2 }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(['new', 'a', 'b', 'z']);
    expect(parseMessengerTimestamp('invalid')).toBe(0);
    expect(parseMessengerTimestamp(null)).toBe(0);
  });

  test('sorts pinned rooms first and restores a left room after a newer message', () => {
    const pinned = baseConversation({
      key: 'pinned',
      timestampMs: 1,
      pinnedAt: '2026-08-08T01:00:00.000Z',
    });
    const recent = baseConversation({ key: 'recent', timestampMs: 20 });
    expect(sortMessengerConversations([recent, pinned]).map((row) => row.key))
      .toEqual(['pinned', 'recent']);

    expect(isMessengerConversationVisible(baseConversation({
      timestampMs: Date.parse('2026-08-08T01:00:00.000Z'),
      leftAt: '2026-08-08T02:00:00.000Z',
    }))).toBe(false);
    expect(isMessengerConversationVisible(baseConversation({
      timestampMs: Date.parse('2026-08-08T03:00:00.000Z'),
      leftAt: '2026-08-08T02:00:00.000Z',
    }))).toBe(true);
  });

  test('formats person details without a GaramIn/GaramLink suffix', () => {
    expect(formatMessengerPersonDetail({
      affiliation: '본부장 · 가람in',
      fallback: 'FC',
    })).toBe('본부장');
    expect(formatMessengerPersonDetail({
      affiliation: '가람in 운영 · 가람in',
      fallback: 'FC',
    })).toBe('가람in 운영');
    expect(formatMessengerPersonDetail({
      affiliation: 'ABL생명 가람Link',
      role: 'designer',
      fallback: '설계 매니저',
    })).toBe('ABL생명 설계 매니저');
  });

  test('builds one exact thread per plain admin and keeps developer personal', () => {
    expect(formatOperationsMessengerName('김가람 총무')).toBe('김가람총무');
    const rows = buildFcTargetRows({
      managers: [],
      developers: [{
        name: '개발 담당자 실명',
        phone: '010-5555-6666',
        conversation_id: '11111111-1111-4111-8111-111111111111',
        unread_count: 1,
      }],
      admins: [
        {
          name: '김가람',
          phone: '010-1111-2222',
          conversation_id: '22222222-2222-4222-8222-222222222222',
          unread_count: 2,
        },
        {
          name: '이한화총무',
          phone: '010-3333-4444',
          unread_count: 0,
        },
      ],
      adminUnreadCount: 2,
    });

    expect(rows.people).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'internal-target:01055556666',
        name: '개발자',
        role: 'developer',
        route: expect.objectContaining({
          kind: 'internal',
          conversationId: '11111111-1111-4111-8111-111111111111',
        }),
      }),
      expect.objectContaining({
        key: 'internal-target:01011112222',
        name: '김가람총무',
        role: 'operations',
      }),
      expect.objectContaining({
        key: 'internal-target:01033334444',
        name: '이한화총무',
        role: 'operations',
        route: expect.objectContaining({ targetId: '01033334444' }),
      }),
    ]));
    expect(rows.people.some((row) => row.key === 'internal-target:admin')).toBe(false);
    expect(rows.conversations.find((row) => row.key === 'internal-target:01011112222'))
      .toMatchObject({ unreadCount: 2 });
  });

  test('builds stable internal keys and totals only non-negative unread counts', () => {
    const item: InternalChatListItem = {
      conversation_id: '11111111-1111-4111-8111-111111111111',
      fc_id: '22222222-2222-4222-8222-222222222222',
      name: '김가람',
      phone: '01012345678',
      affiliation: '서울본부',
      last_message: '확인했습니다.',
      last_time: '2026-08-04T10:00:00.000Z',
      unread_count: 3,
    };
    const result = buildInternalListRows([item]);
    expect(result.people[0].key).toBe(`internal-conversation:${item.conversation_id}`);
    expect(result.conversations[0]).toMatchObject({
      key: `internal-conversation:${item.conversation_id}`,
      unreadCount: 3,
    });
    expect(getMessengerTotalUnread([
      result.conversations[0],
      baseConversation({ key: 'negative', unreadCount: -10 }),
      baseConversation({ key: 'large', unreadCount: 101 }),
    ])).toBe(104);
  });

  test('uses an exact target fallback when no direct thread exists yet', () => {
    const item: InternalChatListItem = {
      conversation_id: null,
      target_id: '01012345678',
      fc_id: '22222222-2222-4222-8222-222222222222',
      name: '김가람',
      phone: '01012345678',
      affiliation: '서울본부',
      last_message: null,
      last_time: null,
      unread_count: 0,
    };
    expect(buildInternalListRows([item]).people[0]).toMatchObject({
      key: 'internal-target:01012345678',
      route: {
        kind: 'internal',
        targetId: '01012345678',
        targetName: '김가람',
      },
    });
  });

  test('groups people by role without relying on their source labels', () => {
    const result = buildInternalListRows([{
      conversation_id: null,
      target_id: '01012345678',
      fc_id: '22222222-2222-4222-8222-222222222222',
      name: '김가람',
      phone: '01012345678',
      affiliation: '서울본부',
      last_message: null,
      last_time: null,
      unread_count: 0,
    }]);
    const sections = groupMessengerPeopleByRole([
      ...result.people,
      { ...result.people[0], key: 'ops', role: 'operations' },
      { ...result.people[0], key: 'manager', role: 'manager' },
      { ...result.people[0], key: 'designer', role: 'designer' },
      { ...result.people[0], key: 'developer', role: 'developer' },
    ]);
    expect(sections.map((section) => section.role)).toEqual([
      'operations',
      'manager',
      'designer',
      'developer',
      'fc',
    ]);
    expect(groupMessengerPeopleByRole(result.people, 'manager')).toEqual([]);
  });

  test('derives staff role sections from the normalized GaramIn affiliation', () => {
    expect(classifyMessengerPersonRole({ affiliation: '총무 · 가람in' })).toBe('operations');
    expect(classifyMessengerPersonRole({ affiliation: '본부장 · 가람in' })).toBe('manager');
    expect(classifyMessengerPersonRole({ affiliation: '개발자 · 가람in' })).toBe('developer');
    expect(classifyMessengerPersonRole({ affiliation: 'ABL생명 가람Link' })).toBe('designer');
  });

  test('builds group and GaramLink DM keys from canonical identifiers', () => {
    const group = buildGroupConversation({
      room: { id: 'room-v2', slug: 'main', title: '가람in 단체방' },
      member_count: 12,
      unread_count: 2,
      last_message: null,
    } as GroupChatBootstrapResponse);
    const dm = buildRequestDmRows([{
      id: 42,
      type: 'direct',
      participant: { id: 9, name: '이설계', role: 'designer', phone: null },
      lastMessage: null,
      unreadCount: 0,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-02T00:00:00.000Z',
    }])[0];
    expect(group.key).toBe('internal-group:room-v2');
    expect(group.detail).toBe('12명 참여');
    expect(dm.key).toBe('request-dm:42');
    expect(dm.timestampMs).toBe(new Date('2026-08-02T00:00:00.000Z').getTime());
  });

  test('uses the designer company-title format for GaramLink directory people', () => {
    const person = buildRequestDirectoryPeople([{
      id: 9,
      name: '엄은숙',
      role: 'designer',
      phone: null,
      company_name: 'ABL생명 가람Link',
    }])[0];
    expect(person.detail).toBe('ABL생명 설계 매니저');
  });

  test('prefers an existing exact GaramLink room over a directory create route', () => {
    const directory = buildRequestDirectoryPeople([{
      id: 9,
      name: '이설계',
      role: 'designer',
      phone: null,
    }])[0];
    const direct = buildRequestDmRows([{
      id: 42,
      type: 'direct',
      participant: { id: 9, name: '이설계', role: 'designer', phone: null },
      lastMessage: null,
      unreadCount: 0,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-02T00:00:00.000Z',
    }])[0];
    expect(directory.route).toEqual({
      kind: 'request-directory',
      participantId: 9,
      targetName: '이설계',
    });
    expect(dedupePeople([directory, direct])).toHaveLength(1);
    expect(dedupePeople([directory, direct])[0].route).toEqual({
      kind: 'request-dm',
      directConversationId: 42,
    });
  });

  test('keeps equal request and direct numeric IDs in separate mute namespaces', () => {
    const request = baseConversation({
      key: 'request:17',
      route: { kind: 'request', requestDesignerId: 17 },
      requestConversationIds: [17, 29],
    });
    const direct = baseConversation({
      key: 'request-dm:29',
      route: { kind: 'request-dm', directConversationId: 29 },
      requestConversationIds: [29],
    });

    const requestMuted = applyMessengerRoomPreferences(
      [request, direct],
      [],
      [{
        room: { type: 'request', requestDesignerId: 29 },
        roomKey: 'request:29',
        muted: true,
      }],
    );
    expect(requestMuted.map((row) => row.muted)).toEqual([true, false]);

    const directMuted = applyMessengerRoomPreferences(
      [request, direct],
      [],
      [{
        room: { type: 'direct', conversationId: 29 },
        roomKey: 'direct:29',
        muted: true,
      }],
    );
    expect(directMuted.map((row) => row.muted)).toEqual([false, true]);
  });
});
