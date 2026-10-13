import {
  RbListReadError,
  rbGetConversationsOrThrow,
  rbGetConversationsPageOrThrow,
  rbGetDmConversationsOrThrow,
  rbGetDesignersOrThrow,
  rbGetDirectMessageUsersOrThrow,
  rbGetMessagesOrThrow,
  rbGetDmMessagesOrThrow,
  rbGetProductsOrThrow,
  rbGetCustomersOrThrow,
  rbGetRequestListOrThrow,
  rbGetRequestDetail,
  rbGetFcCodesOrThrow,
  rbGetCompanyNamesOrThrow,
  clearRequestBoardState,
} from '../request-board-api';
import { isRequestBoardSessionReauthError } from '../request-board-session-error';

jest.mock('../request-board-url', () => ({ getRequestBoardApiBaseUrl: () => 'https://request-board.test' }));
jest.mock('../safe-storage', () => ({ safeStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() } }));
jest.mock('../secure-token-storage', () => ({ sensitiveTokenStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() } }));
jest.mock('../supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('../logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));

const originalFetch = globalThis.fetch;
const requestListRow = (id: number) => ({
  id,
  status: 'pending',
  customer_name: `고객 ${id}`,
  created_at: '2026-10-13T00:00:00.000Z',
  request_products: [],
  request_designers: [],
});
const readers = [
  ['request conversations', rbGetConversationsOrThrow],
  ['direct conversations', rbGetDmConversationsOrThrow],
  ['designers', rbGetDesignersOrThrow],
  ['FC directory', rbGetDirectMessageUsersOrThrow],
  ['messages', () => rbGetMessagesOrThrow([1])],
  ['direct messages', () => rbGetDmMessagesOrThrow(1)],
  ['products', rbGetProductsOrThrow],
  ['customers', rbGetCustomersOrThrow],
  ['requests', rbGetRequestListOrThrow],
  ['FC codes', rbGetFcCodesOrThrow],
  ['company names', rbGetCompanyNamesOrThrow],
] as const;

beforeEach(async () => { await clearRequestBoardState({ clearAppSession: true }); });
afterAll(() => { globalThis.fetch = originalFetch; });

describe.each(readers)('%s strict read', (_label, read) => {
  test.each([500, 403, 401])('rejects HTTP %i instead of reporting successful empty data', async (status) => {
    globalThis.fetch = jest.fn(async () => ({ status, ok: false, json: async () => ({ error: 'synthetic failure' }) } as Response));
    const error = await read().then(() => null, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(RbListReadError);
    expect(error).toMatchObject({ status, retryable: status === 500 });
    expect(isRequestBoardSessionReauthError(error)).toBe(status === 401);
  });

  test('rejects an offline read', async () => {
    globalThis.fetch = jest.fn(async () => { throw new TypeError('synthetic offline'); });
    await expect(read()).rejects.toMatchObject({ name: 'RbListReadError', retryable: true });
  });

  test('accepts a successful empty array', async () => {
    globalThis.fetch = jest.fn(async () => ({ status: 200, ok: true, json: async () => ({ success: true, data: [] }) } as Response));
    await expect(read()).resolves.toEqual([]);
  });

  test('does not accept a malformed success response as empty data', async () => {
    globalThis.fetch = jest.fn(async () => ({ status: 200, ok: true, json: async () => ({ success: true, data: null }) } as Response));
    await expect(read()).rejects.toBeInstanceOf(RbListReadError);
  });

  test('rejects malformed successful rows instead of trusting a generic array cast', async () => {
    globalThis.fetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: [{}] }),
    } as Response));
    await expect(read()).rejects.toBeInstanceOf(RbListReadError);
  });
});

describe('request list pagination and row contract', () => {
  test('loads every server page and preserves the canonical order', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => requestListRow(index + 2));
    const secondPage = [requestListRow(1)];
    const fetchMock = jest.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const page = Number(new URL(String(input)).searchParams.get('page'));
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          data: page === 1 ? firstPage : secondPage,
          pagination: { page, limit: 100, total: 101, totalPages: 2 },
        }),
      } as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(rbGetRequestListOrThrow()).resolves.toEqual([...firstPage, ...secondPage]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      '/api/requests?limit=100&page=2&ssnView=masked&includeAttachments=false',
    );
  });

  test('rejects malformed nested rows instead of handing them to the screens', async () => {
    globalThis.fetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        success: true,
        data: [{ ...requestListRow(1), request_designers: [null] }],
        pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
      }),
    } as Response));

    await expect(rbGetRequestListOrThrow()).rejects.toBeInstanceOf(RbListReadError);
  });

  test('rejects duplicate rows and inconsistent pagination', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => requestListRow(index + 1));
    const fetchMock = jest.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const page = Number(new URL(String(input)).searchParams.get('page'));
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          data: page === 1 ? firstPage : [requestListRow(100)],
          pagination: { page, limit: 100, total: 101, totalPages: 2 },
        }),
      } as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(rbGetRequestListOrThrow()).rejects.toBeInstanceOf(RbListReadError);
  });
});

describe('request detail response contract', () => {
  test('accepts a valid detail whose identity matches the requested request', async () => {
    const detail = requestListRow(17);
    globalThis.fetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: detail }),
    } as Response));

    await expect(rbGetRequestDetail(17)).resolves.toEqual(detail);
  });

  test.each([500, 403, 401])('rejects HTTP %i instead of returning null', async (status) => {
    globalThis.fetch = jest.fn(async () => ({
      status,
      ok: false,
      json: async () => ({ error: 'synthetic failure' }),
    } as Response));

    await expect(rbGetRequestDetail(17)).rejects.toMatchObject({
      name: 'RbListReadError',
      status,
    });
  });

  test.each([
    ['null data', null],
    ['missing required fields', {}],
    ['mismatched identity', requestListRow(18)],
    ['malformed nested assignment', {
      ...requestListRow(17),
      request_designers: [{ id: 1, designer_id: 2, status: 'rejected', fc_decision: null, request_attachments: [null] }],
    }],
  ])('rejects malformed successful detail: %s', async (_label, data) => {
    globalThis.fetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data }),
    } as Response));

    await expect(rbGetRequestDetail(17)).rejects.toBeInstanceOf(RbListReadError);
  });
});

describe('cursor pagination metadata contract', () => {
  test('accepts wholly absent legacy metadata and exact terminal metadata', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ success: true, data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ success: true, data: [], has_more: false, next_cursor: null }),
      } as Response);

    await expect(rbGetConversationsPageOrThrow()).resolves.toMatchObject({
      items: [],
      hasMore: false,
      nextCursor: null,
    });
    await expect(rbGetConversationsPageOrThrow()).resolves.toMatchObject({
      items: [],
      hasMore: false,
      nextCursor: null,
    });
  });

  test.each([
    ['true without cursor', { has_more: true }],
    ['cursor without has_more', { next_cursor: 'cursor-2' }],
    ['false with cursor', { has_more: false, next_cursor: 'cursor-2' }],
    ['true with null cursor', { has_more: true, next_cursor: null }],
    ['true with blank cursor', { has_more: true, next_cursor: '  ' }],
  ])('rejects inconsistent pagination metadata: %s', async (_label, pagination) => {
    globalThis.fetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: [], ...pagination }),
    } as Response));

    await expect(rbGetConversationsPageOrThrow()).rejects.toBeInstanceOf(RbListReadError);
  });
});
