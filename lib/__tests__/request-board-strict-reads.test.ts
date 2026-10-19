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
  clearAuth,
  getStoredToken,
  getStoredUser,
  getStoredBridgeToken,
  rbBridgeLogin,
  rbCheckAuth,
  rbCreateRequest,
  rbUploadAttachments,
  rbUploadRequestAttachments,
  setAppSessionToken,
  setBridgeToken,
} from '../request-board-api';
import { isRequestBoardSessionReauthError } from '../request-board-session-error';
import { sensitiveTokenStorage } from '../secure-token-storage';
import { safeStorage } from '../safe-storage';
import { supabase } from '../supabase';

jest.mock('../request-board-url', () => ({ getRequestBoardApiBaseUrl: () => 'https://request-board.test' }));
jest.mock('../safe-storage', () => ({ safeStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() } }));
jest.mock('../secure-token-storage', () => ({ sensitiveTokenStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() } }));
jest.mock('../supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('../logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));

const originalFetch = global.fetch;
const secureValues = new Map<string, string>();
const safeValues = new Map<string, string>();
const jsonResponse = (body: unknown, status = 200): Response => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
} as Response);
const authResponse = (token = 'synthetic-old-jwt', id = 1) => jsonResponse({
  success: true,
  data: { token, user: { id, name: 'Synthetic user', email: '', phone: '', role: 'fc' } },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function seedAuth() {
  await setBridgeToken('synthetic-bridge');
  global.fetch = jest.fn(async () => authResponse());
  expect((await rbBridgeLogin()).success).toBe(true);
  jest.clearAllMocks();
}
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

beforeEach(async () => {
  await clearRequestBoardState({ clearAppSession: true });
  secureValues.clear();
  safeValues.clear();
  jest.clearAllMocks();
  jest.mocked(sensitiveTokenStorage.getItem).mockImplementation(async (key) => secureValues.get(key) ?? null);
  jest.mocked(sensitiveTokenStorage.setItem).mockImplementation(async (key, value) => { secureValues.set(key, value); });
  jest.mocked(sensitiveTokenStorage.removeItem).mockImplementation(async (key) => { secureValues.delete(key); });
  jest.mocked(safeStorage.getItem).mockImplementation(async (key) => safeValues.get(key) ?? null);
  jest.mocked(safeStorage.setItem).mockImplementation(async (key, value) => { safeValues.set(key, value); });
  jest.mocked(safeStorage.removeItem).mockImplementation(async (key) => { safeValues.delete(key); });
  jest.mocked(supabase.functions.invoke).mockReset();
});
afterAll(() => { global.fetch = originalFetch; });

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

describe('Request Board authentication recovery', () => {
  test.each([401, 403])('recovers an invalid session from HTTP %i once and uses the new JWT', async (status) => {
    await seedAuth();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'SESSION_INVALID' }, status))
      .mockResolvedValueOnce(authResponse('synthetic-refreshed-jwt'))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: [] }));
    global.fetch = fetchMock;

    await expect(rbGetProductsOrThrow()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-old-jwt');
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer synthetic-refreshed-jwt');
    expect(await getStoredToken()).toBe('synthetic-refreshed-jwt');
    expect(sensitiveTokenStorage.removeItem).not.toHaveBeenCalled();
  });

  test.each(['FORBIDDEN', 'ROLE_MISMATCH', 'SESSION_MALFORMED'])('preserves ordinary 403 %s without recovery', async (code) => {
    await seedAuth();
    global.fetch = jest.fn(async () => jsonResponse({ code, error: '접근 권한이 없습니다.' }, 403));

    await expect(rbGetProductsOrThrow()).rejects.toMatchObject({ status: 403, code, retryable: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(await getStoredToken()).toBe('synthetic-old-jwt');
    expect(sensitiveTokenStorage.removeItem).not.toHaveBeenCalled();
  });

  test.each([401, 403])('stops after one successful recovery followed by HTTP %i invalid session', async (status) => {
    await seedAuth();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'SESSION_INVALID' }, status))
      .mockResolvedValueOnce(authResponse('synthetic-refreshed-jwt'))
      .mockResolvedValueOnce(jsonResponse({ code: 'SESSION_INVALID' }, status));

    await expect(rbGetProductsOrThrow()).rejects.toMatchObject({ status: 401, retryable: false });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(await getStoredToken()).toBeNull();
    expect(await getStoredUser()).toBeNull();
  });

  test.each([408, 429, 503])('preserves authentication after bridge HTTP %i', async (status) => {
    await seedAuth();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ error: '브릿지 인증이 설정되지 않았습니다.' }, status));

    const error = await rbGetProductsOrThrow().catch((reason: unknown) => reason);
    expect(error).toMatchObject({ status, retryable: true });
    expect(isRequestBoardSessionReauthError(error)).toBe(false);
    expect(await getStoredToken()).toBe('synthetic-old-jwt');
    expect((await getStoredUser())?.id).toBe(1);
    expect(sensitiveTokenStorage.removeItem).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  test.each(['network', 'timeout'])('preserves authentication after bridge %s failure', async (kind) => {
    await seedAuth();
    const error = new Error('synthetic connection failure');
    if (kind === 'timeout') error.name = 'AbortError';
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'SESSION_INVALID' }, 403))
      .mockRejectedValueOnce(error);

    const failure = await rbGetProductsOrThrow().catch((reason: unknown) => reason);
    expect(failure).toMatchObject({ status: 503, retryable: true, code: 'network_error' });
    expect(isRequestBoardSessionReauthError(failure)).toBe(false);
    expect(await getStoredToken()).toBe('synthetic-old-jwt');
    expect(sensitiveTokenStorage.removeItem).not.toHaveBeenCalled();
  });

  test('preserves authentication when the bridge 503 body is not JSON', async () => {
    await seedAuth();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce({ status: 503, ok: false, json: async () => { throw new SyntaxError('synthetic HTML'); } });

    await expect(rbGetProductsOrThrow()).rejects.toMatchObject({ status: 503, retryable: true });
    expect(await getStoredToken()).toBe('synthetic-old-jwt');
  });

  test.each(['invalid_app_session', 'expired_app_session'])('keeps canonical %s terminal through FunctionsHttpError', async (code) => {
    await seedAuth();
    await setAppSessionToken('synthetic-app-session');
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ error: '유효하지 않은 브릿지 토큰입니다.' }, 401));
    jest.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('synthetic non-2xx'), {
        context: jsonResponse({ code, message: '앱 세션이 만료되었습니다.' }, 401),
      }),
    });

    await expect(rbGetProductsOrThrow()).rejects.toMatchObject({ status: 401, retryable: false });
    expect(await getStoredToken()).toBeNull();
  });

  test.each(['http', 'network'])('preserves authentication after app-session refresh %s failure', async (kind) => {
    await seedAuth();
    await setBridgeToken(null);
    await setAppSessionToken('synthetic-app-session');
    global.fetch = jest.fn(async () => jsonResponse({}, 401));
    const error = Object.assign(new Error('synthetic service failure'), kind === 'http' ? {
      context: jsonResponse({ code: 'session_verification_unavailable' }, 503),
    } : {});
    jest.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error });

    const failure = await rbGetProductsOrThrow().catch((reason: unknown) => reason);
    expect(failure).toMatchObject({ status: 503, retryable: true });
    expect(isRequestBoardSessionReauthError(failure)).toBe(false);
    expect(await getStoredToken()).toBe('synthetic-old-jwt');
    expect(sensitiveTokenStorage.removeItem).not.toHaveBeenCalledWith('rb_jwt_token');
  });

  test.each([false, true].flatMap(initial =>
    ['inactive_account', 'not_completed', 'request_board_not_applicable'].map(code => [initial, code] as const)
  ))('preserves access denial through FunctionsHttpError with initial auth %s and code %s', async (initial, code) => {
    if (!initial) await seedAuth();
    await setBridgeToken(null);
    await setAppSessionToken('synthetic-app-session');
    global.fetch = jest.fn(async () => jsonResponse({}, 401));
    jest.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('synthetic non-2xx'), {
        context: jsonResponse({ code, message: '비활성화된 계정입니다.' }, 403),
      }),
    });

    if (initial) {
      expect(await rbCheckAuth()).toMatchObject({ authenticated: false, status: 403, retryable: false, needsRelogin: false });
    } else {
      await expect(rbGetProductsOrThrow()).rejects.toMatchObject({ status: 403, code, retryable: false });
    }
    expect(global.fetch).toHaveBeenCalledTimes(initial ? 0 : 1);
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
    expect(await getStoredToken()).toBe(initial ? null : 'synthetic-old-jwt');
  });

  test.each(['http', 'network'])('auth/me %s failure keeps the saved session and returns retryable failure', async (kind) => {
    await seedAuth();
    global.fetch = kind === 'http'
      ? jest.fn(async () => jsonResponse({ error: '잠시 후 다시 시도해주세요.' }, 503))
      : jest.fn(async () => { throw new TypeError('synthetic offline'); });

    expect(await rbCheckAuth()).toMatchObject({ authenticated: false, retryable: true, needsRelogin: false });
    expect(await getStoredToken()).toBe('synthetic-old-jwt');
    expect((await getStoredUser())?.id).toBe(1);
    expect(sensitiveTokenStorage.removeItem).not.toHaveBeenCalled();
  });

  test('auth/me ordinary 403 keeps its permission failure and saved session', async () => {
    await seedAuth();
    global.fetch = jest.fn(async () => jsonResponse({ code: 'ROLE_MISMATCH', error: '접근 권한이 없습니다.' }, 403));
    expect(await rbCheckAuth()).toMatchObject({ authenticated: false, status: 403, needsRelogin: false, retryable: false });
    expect(await getStoredToken()).toBe('synthetic-old-jwt');
  });

  test('initial auth check keeps a bridge 503 retryable even with an auth-shaped error code', async () => {
    await setBridgeToken('synthetic-bridge');
    global.fetch = jest.fn(async () => jsonResponse({ code: 'invalid_bridge_token' }, 503));

    expect(await rbCheckAuth()).toMatchObject({ authenticated: false, status: 503, retryable: true, needsRelogin: false });
    expect(sensitiveTokenStorage.removeItem).not.toHaveBeenCalled();
  });

  test.each([false, true])('initial bridge permission denials stay HTTP 403 with app-session presence %s', async (hasAppSession) => {
    await setBridgeToken('synthetic-bridge');
    if (hasAppSession) await setAppSessionToken('synthetic-app-session');
    for (const code of [undefined, 'ACCOUNT_INACTIVE', 'invalid_bridge_token']) {
      jest.clearAllMocks();
      global.fetch = jest.fn(async () => jsonResponse({ code, error: 'Bridge role is not allowed.' }, 403));

      expect(await rbCheckAuth()).toMatchObject({
        authenticated: false, status: 403, retryable: false, needsRelogin: false,
        error: 'Bridge role is not allowed.',
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(supabase.functions.invoke).not.toHaveBeenCalled();
      expect(await getStoredBridgeToken()).toBe('synthetic-bridge');
      expect(await getStoredToken()).toBeNull();
    }
  });

  test.each(['FC_IDENTITY_BINDING_CONFLICT', 'FC_ACCOUNT_RETIRED'])('initial bridge %s asks for review instead of relogin', async (code) => {
    await setBridgeToken('synthetic-bridge');
    await setAppSessionToken('synthetic-app-session');
    global.fetch = jest.fn(async () => jsonResponse({ success: false, code }, 409));

    const result = await rbCheckAuth();
    expect(result).toMatchObject({ authenticated: false, status: 409, retryable: false, needsRelogin: false });
    expect(isRequestBoardSessionReauthError(result.error)).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  test('initial bridge FC_IDENTITY_SYNC_V2_REQUIRED keeps relogin guidance', async () => {
    await setBridgeToken('synthetic-bridge');
    global.fetch = jest.fn(async () => jsonResponse({ success: false, code: 'FC_IDENTITY_SYNC_V2_REQUIRED' }, 409));

    expect(await rbCheckAuth()).toMatchObject({ authenticated: false, status: 401, needsRelogin: true });
  });

  test('initial auth check requires relogin for a canonical expired app session', async () => {
    await setAppSessionToken('synthetic-app-session');
    jest.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('synthetic non-2xx'), {
        context: jsonResponse({ code: 'expired_app_session', message: '앱 세션이 만료되었습니다.' }, 401),
      }),
    });

    expect(await rbCheckAuth()).toMatchObject({ authenticated: false, status: 401, retryable: false, needsRelogin: true });
  });

  test('a permission denial after recovery keeps the refreshed JWT', async () => {
    await seedAuth();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(authResponse('synthetic-refreshed-jwt'))
      .mockResolvedValueOnce(jsonResponse({ code: 'ROLE_MISMATCH', error: '접근 권한이 없습니다.' }, 403));

    await expect(rbGetProductsOrThrow()).rejects.toMatchObject({ status: 403, code: 'ROLE_MISMATCH', retryable: false });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(await getStoredToken()).toBe('synthetic-refreshed-jwt');
    expect(sensitiveTokenStorage.removeItem).not.toHaveBeenCalled();
  });

  test('a delayed invalid-session read cannot remove or retry with a newer login', async () => {
    await seedAuth();
    const response = deferred<Response>();
    const started = deferred<void>();
    global.fetch = jest.fn()
      .mockImplementationOnce(() => { started.resolve(); return response.promise; })
      .mockResolvedValueOnce(authResponse('synthetic-new-jwt', 2));
    const read = rbGetProductsOrThrow().catch((reason: unknown) => reason);
    await started.promise;
    await rbBridgeLogin('synthetic-new-bridge');
    response.resolve(jsonResponse({ code: 'SESSION_INVALID' }, 403));

    expect(await read).toMatchObject({ status: 409, retryable: false });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(await getStoredToken()).toBe('synthetic-new-jwt');
    expect((await getStoredUser())?.id).toBe(2);
    expect(secureValues.get('rb_jwt_token')).toBe('synthetic-new-jwt');
    expect(sensitiveTokenStorage.removeItem).not.toHaveBeenCalled();
  });

  test.each(['failure', 'success'])('a delayed bridge %s cannot replace a newer login', async (kind) => {
    await seedAuth();
    const response = deferred<Response>();
    const started = deferred<void>();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockImplementationOnce(() => { started.resolve(); return response.promise; })
      .mockResolvedValueOnce(authResponse('synthetic-new-jwt', 2));
    const read = rbGetProductsOrThrow().catch((reason: unknown) => reason);
    await started.promise;
    await rbBridgeLogin('synthetic-new-bridge');
    response.resolve(kind === 'failure' ? jsonResponse({}, 503) : authResponse('synthetic-stale-jwt'));

    expect(await read).toMatchObject({ status: 409, retryable: false });
    expect(await getStoredToken()).toBe('synthetic-new-jwt');
    expect((await getStoredUser())?.id).toBe(2);
    expect(secureValues.get('rb_jwt_token')).toBe('synthetic-new-jwt');
    expect(sensitiveTokenStorage.removeItem).not.toHaveBeenCalled();
  });

  test('new authentication persists after an earlier storage removal finishes', async () => {
    await seedAuth();
    const removal = deferred<void>();
    const started = deferred<void>();
    jest.mocked(sensitiveTokenStorage.removeItem).mockImplementationOnce(async (key) => {
      started.resolve();
      await removal.promise;
      secureValues.delete(key);
    });
    const clearing = clearAuth();
    await started.promise;
    global.fetch = jest.fn(async () => authResponse('synthetic-new-jwt', 2));
    const login = rbBridgeLogin('synthetic-new-bridge');
    removal.resolve();
    await Promise.all([clearing, login]);

    expect(await getStoredToken()).toBe('synthetic-new-jwt');
    expect(secureValues.get('rb_jwt_token')).toBe('synthetic-new-jwt');
    expect(JSON.parse(safeValues.get('rb_user') ?? '{}').id).toBe(2);
  });

  test('a delayed bridge success cannot restore authentication after logout', async () => {
    await seedAuth();
    const response = deferred<Response>();
    const started = deferred<void>();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockImplementationOnce(() => { started.resolve(); return response.promise; });
    const read = rbGetProductsOrThrow().catch((reason: unknown) => reason);
    await started.promise;
    await clearRequestBoardState({ clearAppSession: true });
    response.resolve(authResponse('synthetic-stale-jwt'));

    expect(await read).toMatchObject({ status: 409, retryable: false });
    expect(await getStoredToken()).toBeNull();
    expect(await getStoredUser()).toBeNull();
    expect(secureValues.has('rb_jwt_token')).toBe(false);
  });

  test.each(['logout', 'new login'])('an old app-session sync cannot replace the bridge after %s', async (transition) => {
    await seedAuth();
    await setBridgeToken(null);
    await setAppSessionToken('synthetic-old-app-session');
    const response = deferred<{ data: { ok: boolean; requestBoardBridgeToken: string }; error: null }>();
    const started = deferred<void>();
    jest.mocked(supabase.functions.invoke).mockImplementationOnce(async () => {
      started.resolve();
      return response.promise;
    });
    global.fetch = jest.fn(async () => jsonResponse({}, 401));
    const read = rbGetProductsOrThrow().catch((reason: unknown) => reason);
    await started.promise;
    await clearRequestBoardState({ clearAppSession: true });
    if (transition === 'new login') {
      await setAppSessionToken('synthetic-new-app-session');
      await setBridgeToken('synthetic-new-bridge');
      global.fetch = jest.fn(async () => authResponse('synthetic-new-jwt', 2));
      await rbBridgeLogin();
    }
    response.resolve({ data: { ok: true, requestBoardBridgeToken: 'synthetic-stale-bridge' }, error: null });

    expect(await read).toMatchObject({ status: 409, retryable: false });
    expect(await getStoredBridgeToken()).toBe(transition === 'new login' ? 'synthetic-new-bridge' : null);
    expect(secureValues.get('rb_bridge_token')).toBe(transition === 'new login' ? 'synthetic-new-bridge' : undefined);
    const nextLogin = await rbBridgeLogin();
    expect(nextLogin.success).toBe(transition === 'new login');
    expect((await getStoredUser())?.id).toBe(transition === 'new login' ? 2 : undefined);
  });

  test('a new app session starts its own sync while an old sync is still pending', async () => {
    await setAppSessionToken('synthetic-old-app-session');
    const oldResponse = deferred<{ data: { ok: boolean; requestBoardBridgeToken: string }; error: null }>();
    const newResponse = deferred<{ data: { ok: boolean; requestBoardBridgeToken: string }; error: null }>();
    const oldStarted = deferred<void>();
    const newStarted = deferred<void>();
    jest.mocked(supabase.functions.invoke)
      .mockImplementationOnce(async () => { oldStarted.resolve(); return oldResponse.promise; })
      .mockImplementationOnce(async () => { newStarted.resolve(); return newResponse.promise; });
    global.fetch = jest.fn(async () => authResponse('synthetic-new-jwt', 2));
    const oldCheck = rbCheckAuth();
    await oldStarted.promise;
    await clearRequestBoardState({ clearAppSession: true });
    await setAppSessionToken('synthetic-new-app-session');
    const newCheck = rbCheckAuth();
    await newStarted.promise;
    oldResponse.resolve({ data: { ok: true, requestBoardBridgeToken: 'synthetic-stale-bridge' }, error: null });
    expect(await oldCheck).toMatchObject({ authenticated: false, status: 409 });
    newResponse.resolve({ data: { ok: true, requestBoardBridgeToken: 'synthetic-new-bridge' }, error: null });

    expect(await newCheck).toMatchObject({ authenticated: true, user: { id: 2 } });
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
    expect(await getStoredBridgeToken()).toBe('synthetic-new-bridge');
  });

  test('a delayed auth/me success cannot replace the newer cached user', async () => {
    await seedAuth();
    const response = deferred<Response>();
    const started = deferred<void>();
    global.fetch = jest.fn()
      .mockImplementationOnce(() => { started.resolve(); return response.promise; })
      .mockResolvedValueOnce(authResponse('synthetic-new-jwt', 2));
    const check = rbCheckAuth();
    await started.promise;
    await clearRequestBoardState({ clearAppSession: true });
    await setBridgeToken('synthetic-new-bridge');
    await rbBridgeLogin();
    response.resolve(jsonResponse({ success: true, data: { id: 1, name: 'Old synthetic user', role: 'fc' } }));

    expect(await check).toMatchObject({ authenticated: false, status: 409, retryable: false });
    expect((await getStoredUser())?.id).toBe(2);
    expect(JSON.parse(safeValues.get('rb_user') ?? '{}').id).toBe(2);
    expect(await getStoredToken()).toBe('synthetic-new-jwt');
  });

  test('an initial auth check cannot start a new bridge exchange after app ownership changes during token restore', async () => {
    const token = deferred<string | null>();
    const started = deferred<void>();
    jest.mocked(sensitiveTokenStorage.getItem).mockImplementationOnce(() => { started.resolve(); return token.promise; });
    global.fetch = jest.fn(async () => authResponse());
    const check = rbCheckAuth();
    await started.promise;
    await setAppSessionToken('synthetic-new-app-session');
    await setBridgeToken('synthetic-new-bridge');
    token.resolve(null);
    expect(await check).toMatchObject({ authenticated: false, status: 409, needsRelogin: false });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await getStoredBridgeToken()).toBe('synthetic-new-bridge');
    expect(await getStoredToken()).toBeNull();
  });

  test('auth/me cannot cache an old user after app ownership changes during recovery-token restore', async () => {
    await seedAuth();
    await setBridgeToken(null);
    await setAppSessionToken('synthetic-old-app-session');
    const bridge = deferred<string | null>(); const started = deferred<void>();
    jest.mocked(sensitiveTokenStorage.getItem).mockImplementation(async (key) => {
      if (key === 'rb_bridge_token') { started.resolve(); return bridge.promise; }
      return secureValues.get(key) ?? null;
    });
    global.fetch = jest.fn(async () => jsonResponse({ success: true, data: { id: 99, name: 'Old response', role: 'fc' } }));
    const check = rbCheckAuth();
    await started.promise;
    await setAppSessionToken('synthetic-new-app-session');
    bridge.resolve(null);
    expect(await check).toMatchObject({ authenticated: false, status: 409, needsRelogin: false });
    expect((await getStoredUser())?.id).toBe(1);
    expect(JSON.parse(safeValues.get('rb_user') ?? '{}').id).toBe(1);
    expect(await getStoredToken()).toBe('synthetic-old-jwt');
  });

  test('a delayed invalid-session create cannot replay its payload under a newer account', async () => {
    await seedAuth();
    const response = deferred<Response>();
    const started = deferred<void>();
    global.fetch = jest.fn()
      .mockImplementationOnce(() => { started.resolve(); return response.promise; })
      .mockResolvedValueOnce(authResponse('synthetic-new-jwt', 2));
    const create = rbCreateRequest({
      clientRequestKey: 'synthetic-request-key',
      customerName: 'Synthetic customer',
      customerSsn: '',
      designerIds: [1],
      productIds: [1],
    });
    await started.promise;
    await rbBridgeLogin('synthetic-new-bridge');
    response.resolve(jsonResponse({ code: 'SESSION_INVALID' }, 403));

    expect(await create).toMatchObject({ success: false, status: 409, code: 'session_changed', retryable: false });
    const createCalls = jest.mocked(global.fetch).mock.calls.filter(([url]) => String(url).endsWith('/api/requests'));
    expect(createCalls).toHaveLength(1);
    expect(await getStoredToken()).toBe('synthetic-new-jwt');
  });
});

describe.each([
  ['message', () => rbUploadAttachments([])],
  ['request', () => rbUploadRequestAttachments(1, 2, { files: [], metadata: [] })],
] as const)('%s attachment authentication recovery', (_label, upload) => {
  test('recovers SESSION_INVALID once and retries with the refreshed JWT', async () => {
    await seedAuth();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'SESSION_INVALID' }, 403))
      .mockResolvedValueOnce(authResponse('synthetic-refreshed-jwt'))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: _label === 'message' ? { attachments: [] } : [] }));
    global.fetch = fetchMock;

    expect(await upload()).toMatchObject({ success: true, data: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-old-jwt');
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer synthetic-refreshed-jwt');
    expect(fetchMock.mock.calls[2][1].headers['Content-Type']).toBeUndefined();
  });

  test.each([401, 403])('keeps the JWT when HTTP %i recovery hits bridge 503', async (status) => {
    await seedAuth();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'SESSION_INVALID' }, status))
      .mockResolvedValueOnce(jsonResponse({}, 503));

    expect(await upload()).toMatchObject({ success: false, status: 503, retryable: true });
    expect(await getStoredToken()).toBe('synthetic-old-jwt');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(sensitiveTokenStorage.removeItem).not.toHaveBeenCalled();
  });

  test('preserves ordinary 403 without retrying the upload', async () => {
    await seedAuth();
    global.fetch = jest.fn(async () => jsonResponse({ code: 'ROLE_MISMATCH', error: '접근 권한이 없습니다.' }, 403));
    expect(await upload()).toMatchObject({ success: false, status: 403, code: 'ROLE_MISMATCH', retryable: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await getStoredToken()).toBe('synthetic-old-jwt');
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
