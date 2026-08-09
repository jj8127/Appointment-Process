import { MessengerSearchHistory } from '../messenger-search-history';
import { getMessengerHubCapabilities } from '../messenger-role-capabilities';
import {
  aggregateMessengerSearchSources,
  buildInternalMessengerSearchTarget,
  buildMessengerSearchRoute,
  containsPrivateIdentifierShape,
  LatestMessengerSearchSequence,
  MESSENGER_SEARCH_DEBOUNCE_MS,
  messengerSearchResultKey,
  normalizeMessengerSearchQuery,
  settleMessengerSearchSources,
  type MessengerSearchRoom,
} from '../messenger-search-model';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('messenger v2 search normalization and privacy', () => {
  test('uses the exact 250ms debounce contract', () => {
    expect(MESSENGER_SEARCH_DEBOUNCE_MS).toBe(250);
  });

  test('trims, preserves internal whitespace, and caps the query at 100 code points', () => {
    expect(normalizeMessengerSearchQuery('  홍길동   본부장  ')).toBe('홍길동   본부장');
    expect(normalizeMessengerSearchQuery(`  ${'가'.repeat(120)}  `)).toHaveLength(100);
    expect(Array.from(normalizeMessengerSearchQuery(` ${'😀'.repeat(120)} `))).toHaveLength(100);
    expect(normalizeMessengerSearchQuery(null)).toBe('');
  });

  test.each([
    '010-1234-5678',
    '연락처 010 1234 5678 확인',
    '900101-1234567',
    '900101 2234567',
  ])('detects phone or resident-number-shaped input: %s', (query) => {
    expect(containsPrivateIdentifierShape(query)).toBe(true);
  });

  test('keeps history actor scoped, duplicate-first, bounded, and process-only', () => {
    const history = new MessengerSearchHistory();
    history.setActor('fc:actor-a');
    for (let index = 0; index < 12; index += 1) history.add(`검색 ${index}`);
    expect(history.snapshot().queries).toHaveLength(10);
    expect(history.add('검색 5').queries[0]).toBe('검색 5');
    expect(history.add('010-1234-5678').queries).not.toContain('010-1234-5678');

    history.setSaveEnabled(false);
    history.add('저장 안 함');
    expect(history.snapshot().queries).not.toContain('저장 안 함');

    expect(history.setActor('fc:actor-b').queries).toEqual([]);
  });
});

describe('messenger v2 search role boundaries', () => {
  test('keeps plain admin outside GaramLink and manager outside its directory', () => {
    expect(getMessengerHubCapabilities({
      role: 'admin', readOnly: false, staffType: 'admin',
    })).toMatchObject({
      canReadRequestBoard: false,
      canLoadRequestBoardDirectory: false,
    });
    expect(getMessengerHubCapabilities({
      role: 'admin', readOnly: true, staffType: null,
    })).toMatchObject({
      canReadRequestBoard: true,
      canLoadRequestBoardDirectory: false,
    });
  });
});

describe('messenger v2 search routes and aggregation', () => {
  test('builds only canonical existing-room routes and never adds a message anchor', () => {
    expect(buildMessengerSearchRoute({ kind: 'internal', conversationId: UUID })).toEqual({
      pathname: '/chat',
      params: { conversationId: UUID },
    });
    expect(buildMessengerSearchRoute({ kind: 'group', roomId: UUID })).toEqual({
      pathname: '/group-chat',
      params: { roomId: UUID },
    });
    expect(buildMessengerSearchRoute({ kind: 'garamlink-request', requestDesignerId: 31 })).toEqual({
      pathname: '/request-board-messenger',
      params: { requestDesignerId: '31' },
    });
    expect(buildMessengerSearchRoute({ kind: 'garamlink-direct', directConversationId: 8 })).toEqual({
      pathname: '/request-board-messenger',
      params: { directConversationId: '8' },
    });
    expect(buildMessengerSearchRoute({ kind: 'internal', conversationId: 'not-a-uuid' })).toBeNull();
    expect(buildMessengerSearchRoute({
      kind: 'internal', targetId: '01012345678', targetName: '홍길동',
    })).toEqual({
      pathname: '/chat',
      params: { targetId: '01012345678', targetName: '홍길동' },
    });
    expect(buildMessengerSearchRoute({
      kind: 'internal', targetId: 'admin', targetName: '총무',
    })).toEqual({
      pathname: '/chat',
      params: { targetId: 'admin', targetName: '총무' },
    });
    expect(buildMessengerSearchRoute({
      kind: 'internal', targetId: '0101234567', targetName: '홍길동',
    })).toBeNull();
    expect(buildMessengerSearchRoute({ kind: 'garamlink-direct', directConversationId: 0 })).toBeNull();
  });

  test('adds only exact typed message anchors to existing room routes', () => {
    const anchor = '223e4567-e89b-42d3-a456-426614174000';
    expect(buildMessengerSearchRoute({
      kind: 'internal', conversationId: UUID, anchorMessageId: anchor,
    })).toEqual({
      pathname: '/chat',
      params: { conversationId: UUID, anchorMessageId: anchor },
    });
    expect(buildMessengerSearchRoute({
      kind: 'group', roomId: UUID, anchorMessageId: anchor,
    })).toEqual({
      pathname: '/group-chat',
      params: { roomId: UUID, anchorMessageId: anchor },
    });
    expect(buildMessengerSearchRoute({
      kind: 'garamlink-request', requestDesignerId: 31, anchorMessageId: 91,
    })).toEqual({
      pathname: '/request-board-messenger',
      params: { requestDesignerId: '31', anchorMessageId: '91' },
    });
    expect(buildMessengerSearchRoute({
      kind: 'garamlink-direct', directConversationId: 8, anchorMessageId: 92,
    })).toEqual({
      pathname: '/request-board-messenger',
      params: { directConversationId: '8', anchorMessageId: '92' },
    });
    expect(buildMessengerSearchRoute({
      kind: 'internal', conversationId: UUID, anchorMessageId: 'bad-anchor',
    })).toBeNull();
    expect(buildMessengerSearchRoute({
      kind: 'garamlink-direct', directConversationId: 8, anchorMessageId: 0,
    })).toBeNull();
  });

  test('prefers a canonical conversation and otherwise uses only an exact target fallback', () => {
    expect(buildInternalMessengerSearchTarget({
      conversationId: UUID,
      targetId: '010-1234-5678',
      targetName: ' 홍길동 ',
    })).toEqual({ kind: 'internal', conversationId: UUID, targetName: '홍길동' });
    expect(buildInternalMessengerSearchTarget({
      conversationId: null,
      targetId: '010-1234-5678',
      targetName: '홍길동',
    })).toEqual({ kind: 'internal', targetId: '01012345678', targetName: '홍길동' });
    expect(buildInternalMessengerSearchTarget({
      conversationId: 'not-a-uuid',
      targetId: '1234',
      targetName: '홍길동',
    })).toBeNull();
  });

  test('keys include source and kind and aggregation removes duplicate keys', () => {
    const key = messengerSearchResultKey('group', 'room', UUID.toUpperCase());
    expect(key).toBe(`group:room:${UUID}`);
    const room: MessengerSearchRoom = {
      kind: 'room', key, source: 'group', title: '단체 채팅', detail: '3명',
      route: { kind: 'group', roomId: UUID },
    };
    expect(aggregateMessengerSearchSources([
      { source: 'group', status: 'ready', items: [room] },
      { source: 'group', status: 'ready', items: [room] },
    ])).toEqual([room]);
  });

  test('only the latest issued sequence owns results', () => {
    const guard = new LatestMessengerSearchSequence();
    const first = guard.issue();
    const second = guard.issue();
    expect(guard.owns(first)).toBe(false);
    expect(guard.owns(second)).toBe(true);
  });

  test('source settlement preserves successful sections when another source fails', async () => {
    const result = await settleMessengerSearchSources({
      internal: Promise.resolve(['ok']),
      garamlink: Promise.reject(new Error('offline')),
    });
    expect(result.internal).toEqual({ status: 'ready', value: ['ok'] });
    expect(result.garamlink.status).toBe('error');
  });
});
