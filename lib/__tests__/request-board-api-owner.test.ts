import {
  captureAppSessionOwner,
  clearAuth,
  clearRequestBoardState,
  getStoredAppSessionToken,
  getStoredBridgeToken,
  getStoredToken,
  rbBridgeLogin,
  rbSendDmMessage,
  rbUploadAttachments,
  rbUploadRequestAttachments,
  setAppSessionToken,
  setBridgeToken,
} from '../request-board-api';
import { sensitiveTokenStorage } from '../secure-token-storage';

jest.mock('../request-board-url', () => ({ getRequestBoardApiBaseUrl: () => 'https://synthetic.invalid' }));
jest.mock('../safe-storage', () => ({ safeStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() } }));
jest.mock('../secure-token-storage', () => ({ sensitiveTokenStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() } }));
jest.mock('../supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('../logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));

const originalFetch = global.fetch;
const response = (body: unknown, status = 200): Response => ({ status, ok: status >= 200 && status < 300, json: async () => body } as Response);
const authResponse = (token = 'synthetic-jwt-A', id = 901) => response({ success: true, data: { token, user: { id, name: 'Synthetic', email: '', phone: '', role: 'fc' } } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const operations = [
  ['message', () => rbSendDmMessage(901, 'synthetic draft'), { success: true, data: { id: 1 } }],
  ['message attachment', () => rbUploadAttachments([{ uri: 'synthetic-file', name: 'synthetic.txt', type: 'text/plain' }]), { success: true, data: { attachments: [] } }],
  ['request attachment', () => rbUploadRequestAttachments(901, 902, { files: [{ uri: 'synthetic-file', name: 'synthetic.txt', type: 'text/plain' }], metadata: [{}] }), { success: true, data: [] }],
] as const;
beforeEach(async () => {
  await clearRequestBoardState({ clearAppSession: true }); jest.clearAllMocks();
  jest.mocked(sensitiveTokenStorage.getItem).mockResolvedValue(null);
});
afterEach(() => { global.fetch = originalFetch; });
async function loginB() { global.fetch = jest.fn(async () => authResponse('synthetic-jwt-B', 902)); expect((await rbBridgeLogin('synthetic-bridge-B')).success).toBe(true); }

test('cleanup blocked in storage cannot delete a login started after local logout', async () => {
  await setAppSessionToken('synthetic-app-A');
  await setBridgeToken('synthetic-bridge-A');
  const ownerA = captureAppSessionOwner();
  const stored = new Map<string, string>();
  const cleanup = deferred<void>();
  const started = deferred<void>();
  let firstRemove = true;
  jest.mocked(sensitiveTokenStorage.setItem).mockImplementation(async (key, value) => { stored.set(key, value); });
  jest.mocked(sensitiveTokenStorage.removeItem).mockImplementation(async (key) => {
    if (firstRemove) {
      firstRemove = false;
      started.resolve();
      await cleanup.promise;
    }
    stored.delete(key);
  });
  try {
    const clearing = clearRequestBoardState({ clearAppSession: true });
    expect(ownerA()).toBe(false);
    await started.promise;
    const app = setAppSessionToken('synthetic-app-B');
    const bridge = setBridgeToken('synthetic-bridge-B');
    const login = loginB();
    cleanup.resolve();
    await Promise.all([clearing, app, bridge, login]);
    expect(await getStoredAppSessionToken()).toBe('synthetic-app-B');
    expect(await getStoredBridgeToken()).toBe('synthetic-bridge-B');
    expect(await getStoredToken()).toBe('synthetic-jwt-B');
    expect(stored.get('rb_app_session_token')).toBe('synthetic-app-B');
    expect(stored.get('rb_bridge_token')).toBe('synthetic-bridge-B');
    expect(stored.get('rb_jwt_token')).toBe('synthetic-jwt-B');
  } finally {
    cleanup.resolve();
    jest.mocked(sensitiveTokenStorage.setItem).mockReset();
    jest.mocked(sensitiveTokenStorage.removeItem).mockReset();
  }
});

describe.each(operations)('D08 %s request owner boundaries', (_label, invoke, confirmedBody) => {
  test.each(['new login', 'app session', 'app session roundtrip'])('does not send old payload when %s changes during token read', async (transition) => {
    const token = deferred<string | null>(); jest.mocked(sensitiveTokenStorage.getItem).mockReturnValueOnce(token.promise);
    global.fetch = jest.fn(async () => response(confirmedBody));
    const pending = invoke(); await Promise.resolve(); await Promise.resolve();
    expect(sensitiveTokenStorage.getItem).toHaveBeenCalled();
    if (transition === 'new login') { await clearAuth(); await loginB(); }
    else {
      await setAppSessionToken('synthetic-app-B');
      if (transition === 'app session roundtrip') await setAppSessionToken(null);
    }
    const network = global.fetch as jest.Mock; network.mockClear();
    token.resolve('synthetic-jwt-A');
    expect(await pending).toMatchObject({ success: false, status: 409, code: 'session_changed', retryable: false });
    expect(network).not.toHaveBeenCalled();
    if (transition === 'new login') expect(await getStoredToken()).toBe('synthetic-jwt-B');
  });

  test.each(['new login', 'app session'])('ignores a confirmed response after %s changes', async (transition) => {
    await loginB(); const received = deferred<Response>(); global.fetch = jest.fn(() => received.promise);
    const pending = invoke(); await Promise.resolve(); await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    if (transition === 'new login') { await clearAuth(); await loginB(); }
    else await setAppSessionToken('synthetic-app-new');
    received.resolve(response(confirmedBody));
    expect(await pending).toMatchObject({ success: false, status: 409, code: 'session_changed', retryable: false });
    expect(await getStoredToken()).toBe('synthetic-jwt-B');
  });

  test('ignores a success body decoded after app-session ownership changes', async () => {
    await loginB(); const body = deferred<unknown>(); global.fetch = jest.fn(async () => ({ ...response(null), json: () => body.promise } as Response));
    const pending = invoke(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await setAppSessionToken('synthetic-app-new'); body.resolve(confirmedBody);
    expect(await pending).toMatchObject({ success: false, status: 409, code: 'session_changed', retryable: false });
  });

  test('keeps an ordinary same-owner confirmed operation working', async () => {
    await loginB(); global.fetch = jest.fn(async () => response(confirmedBody));
    expect(await invoke()).toMatchObject({ success: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-jwt-B');
  });

  test('does not restore an old bridge token or replay after app ownership changes during recovery', async () => {
    await loginB(); await setBridgeToken('synthetic-bridge');
    const bridge = deferred<Response>(); let bridgeStarted!: () => void;
    const started = new Promise<void>((done) => { bridgeStarted = done; });
    const network = jest.fn().mockResolvedValueOnce(response({}, 401)).mockImplementationOnce(() => { bridgeStarted(); return bridge.promise; });
    global.fetch = network;
    const pending = invoke(); await started;
    await setAppSessionToken('synthetic-app-new');
    bridge.resolve(authResponse('synthetic-stale-jwt', 903));
    expect(await pending).toMatchObject({ success: false, status: 409, code: 'session_changed', retryable: false });
    expect(await getStoredToken()).toBe('synthetic-jwt-B');
    expect(network).toHaveBeenCalledTimes(2);
  });

  test('an old network failure is reported as a stopped owner rather than a retryable request', async () => {
    await loginB(); let fail!: (error: Error) => void;
    const network = new Promise<Response>((_done, reject) => { fail = reject; });
    global.fetch = jest.fn(() => network); const pending = invoke();
    await Promise.resolve(); await Promise.resolve();
    await setAppSessionToken('synthetic-app-new'); fail(new Error('synthetic old network failure'));
    expect(await pending).toMatchObject({ success: false, status: 409, code: 'session_changed', retryable: false });
  });
});
