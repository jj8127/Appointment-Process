import {
  RbListReadError,
  rbGetConversationsOrThrow,
  rbGetDmConversationsOrThrow,
  rbGetDesignersOrThrow,
  rbGetDirectMessageUsersOrThrow,
  rbGetMessagesOrThrow,
  rbGetDmMessagesOrThrow,
  rbGetProductsOrThrow,
  rbGetCustomersOrThrow,
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

const originalFetch = global.fetch;
const readers = [
  ['request conversations', rbGetConversationsOrThrow],
  ['direct conversations', rbGetDmConversationsOrThrow],
  ['designers', rbGetDesignersOrThrow],
  ['FC directory', rbGetDirectMessageUsersOrThrow],
  ['messages', () => rbGetMessagesOrThrow([1])],
  ['direct messages', () => rbGetDmMessagesOrThrow(1)],
  ['products', rbGetProductsOrThrow],
  ['customers', rbGetCustomersOrThrow],
  ['FC codes', rbGetFcCodesOrThrow],
  ['company names', rbGetCompanyNamesOrThrow],
] as const;

beforeEach(async () => { await clearRequestBoardState({ clearAppSession: true }); });
afterAll(() => { global.fetch = originalFetch; });

describe.each(readers)('%s strict read', (_label, read) => {
  test.each([500, 403, 401])('rejects HTTP %i instead of reporting successful empty data', async (status) => {
    global.fetch = jest.fn(async () => ({ status, ok: false, json: async () => ({ error: 'synthetic failure' }) } as Response));
    const error = await read().then(() => null, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(RbListReadError);
    expect(error).toMatchObject({ status, retryable: status === 500 });
    expect(isRequestBoardSessionReauthError(error)).toBe(status === 401);
  });

  test('rejects an offline read', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('synthetic offline'); });
    await expect(read()).rejects.toMatchObject({ name: 'RbListReadError', retryable: true });
  });

  test('accepts a successful empty array', async () => {
    global.fetch = jest.fn(async () => ({ status: 200, ok: true, json: async () => ({ success: true, data: [] }) } as Response));
    await expect(read()).resolves.toEqual([]);
  });

  test('does not accept a malformed success response as empty data', async () => {
    global.fetch = jest.fn(async () => ({ status: 200, ok: true, json: async () => ({ success: true, data: null }) } as Response));
    await expect(read()).rejects.toBeInstanceOf(RbListReadError);
  });
});
