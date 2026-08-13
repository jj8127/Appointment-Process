import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildRbMessageSearchPath,
  mapRbMessageSearchItems,
} from '../request-board-api';

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

describe('messenger v2 Request Board search wrappers', () => {
  test('URL-encodes a normalized query and maps request conversation scope', () => {
    const path = buildRbMessageSearchPath('request', '  보장 분석 & 검토  ', [4, 4, -1, 9]);
    expect(path).toBe('/api/messages/search?q=%EB%B3%B4%EC%9E%A5+%EB%B6%84%EC%84%9D+%26+%EA%B2%80%ED%86%A0&limit=50&conversationIds=4%2C9');
  });

  test('uses the direct GET endpoint and rejects an empty query', () => {
    expect(buildRbMessageSearchPath('direct', '홍길동')).toBe(
      '/api/direct-messages/search?q=%ED%99%8D%EA%B8%B8%EB%8F%99&limit=50',
    );
    expect(() => buildRbMessageSearchPath('direct', '   ')).toThrow('search query is required');
    const cappedQuery = new URL(`https://request-board.test${buildRbMessageSearchPath('direct', '가'.repeat(120))}`)
      .searchParams.get('q');
    expect(cappedQuery).toHaveLength(100);
    expect(new URL(
      `https://request-board.test${buildRbMessageSearchPath('direct', '가   나')}`,
    ).searchParams.get('q')).toBe('가   나');
    expect(Array.from(new URL(
      `https://request-board.test${buildRbMessageSearchPath('direct', '😀'.repeat(120))}`,
    ).searchParams.get('q') ?? '')).toHaveLength(100);
  });

  test('caps mapped server results at 50', () => {
    const rows = Array.from({ length: 72 }, (_, id) => ({ id }));
    expect(mapRbMessageSearchItems<{ id: number }>(rows)).toHaveLength(50);
    expect(mapRbMessageSearchItems(null)).toEqual([]);
  });

  test('the public search wrappers are strictly GET-only', () => {
    const source = readFileSync(join(__dirname, '..', 'request-board-api.ts'), 'utf8');
    const requestWrapper = source.slice(
      source.indexOf('export async function rbSearchMessages'),
      source.indexOf('export async function rbSearchDirectMessages'),
    );
    const directWrapper = source.slice(
      source.indexOf('export async function rbSearchDirectMessages'),
      source.indexOf('export async function rbGetRequestList'),
    );
    expect(requestWrapper).toContain("method: 'GET'");
    expect(requestWrapper).toContain("diagnosticPath: '/api/messages/search'");
    expect(directWrapper).toContain("method: 'GET'");
    expect(directWrapper).toContain("diagnosticPath: '/api/direct-messages/search'");
    expect(`${requestWrapper}${directWrapper}`).not.toMatch(/method:\s*'(POST|PATCH|DELETE)'/);
  });

  test('the screen capability-gates GaramLink before session or API access', () => {
    const screen = readFileSync(join(__dirname, '..', '..', 'app', 'messenger-search.tsx'), 'utf8');
    expect(screen).toContain('getMessengerHubCapabilities');
    const directoryLoader = screen.slice(
      screen.indexOf('const loadGaramlinkDirectory'),
      screen.indexOf('useEffect(() =>', screen.indexOf('const loadGaramlinkDirectory')),
    );
    expect(directoryLoader.indexOf('if (!capabilities.canReadRequestBoard)')).toBeLessThan(
      directoryLoader.indexOf('ensureRequestBoardSession()'),
    );
    expect(directoryLoader).toContain('capabilities.canLoadRequestBoardDirectory');
    expect(directoryLoader).toContain('rbGetConversationsOrThrow()');
    expect(directoryLoader).toContain('rbGetDmConversationsOrThrow()');
    expect(directoryLoader).toContain('rbGetDirectMessageUsersOrThrow');
    expect(directoryLoader).toContain('rbGetDesignersOrThrow()');
    expect(screen).not.toContain('rbCreateDmConversation');

    const messageSearch = screen.slice(
      screen.indexOf('const sequence = garamlinkMessageSequence.current.issue()'),
      screen.indexOf('const visibleSources'),
    );
    expect(messageSearch.indexOf('if (!capabilities.canReadRequestBoard)')).toBeLessThan(
      messageSearch.indexOf('rbSearchMessages('),
    );
  });

  test('connects all three bounded message sources without snapshot-message fallback', () => {
    const screen = readFileSync(join(__dirname, '..', '..', 'app', 'messenger-search.tsx'), 'utf8');
    expect(screen).toContain("searchGaraminDirectMessages({ q: searchQuery, limit: 50 })");
    expect(screen).toContain('groupChatSearch(searchQuery, 50)');
    expect(screen).toContain('rbSearchMessages(searchQuery, requestConversationIdsRef.current)');
    expect(screen.match(/coverage: 'partial'/g)).toHaveLength(4);
    expect(screen).toContain('anchorMessageId: result.messageId');
    expect(screen).toContain('anchorMessageId: message.id');
    expect(screen).toContain('`${result.senderLabel} · ${result.roomLabel}`');
    expect(screen).not.toContain('snapshot.messages.map');
    expect(screen).not.toMatch(/mark(Read|GaraminDirectMessagesRead)/);
    expect(screen).not.toMatch(/create(Room|DmConversation)/);
  });

  test('does not re-filter server-matched messages by their bounded excerpts', () => {
    const screen = readFileSync(join(__dirname, '..', '..', 'app', 'messenger-search.tsx'), 'utf8');
    const filterBlock = screen.slice(
      screen.indexOf('const filteredMetadata = filterMessengerSearchItems'),
      screen.indexOf('return { source, status, items: filtered, error: store.error };'),
    );
    expect(filterBlock).toContain("store.items.filter((item) => item.kind !== 'message')");
    expect(filterBlock).toContain("store.items.filter((item) => item.kind === 'message')");
    expect(filterBlock.indexOf('filterMessengerSearchItems')).toBeLessThan(
      filterBlock.indexOf("store.items.filter((item) => item.kind === 'message')"),
    );
  });

  test('guards every server message source at two Unicode code points', () => {
    const screen = readFileSync(join(__dirname, '..', '..', 'app', 'messenger-search.tsx'), 'utf8');
    const internalSearch = screen.slice(
      screen.indexOf('const runInternalMessageSearch'),
      screen.indexOf('const runGroupMessageSearch'),
    );
    const groupSearch = screen.slice(
      screen.indexOf('const runGroupMessageSearch'),
      screen.indexOf('const runGaramlinkMessageSearch'),
    );
    const garamlinkSearch = screen.slice(
      screen.indexOf('const runGaramlinkMessageSearch'),
      screen.indexOf('useEffect(() =>', screen.indexOf('const runGaramlinkMessageSearch')),
    );
    [internalSearch, groupSearch, garamlinkSearch].forEach((source) => {
      expect(source).toContain('Array.from(searchQuery).length');
      expect(source).toContain('queryLength < 2 || queryLength > 100');
    });
    expect(screen).toContain("? 'hint'");
    expect(screen).toContain('internalMessageSequence.current.issue()');
    expect(screen).toContain('groupMessageSequence.current.issue()');
    expect(screen).toContain('garamlinkMessageSequence.current.issue()');
  });
});
