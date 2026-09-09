import { act, createElement, type ReactElement } from 'react';

import { useReferralAppSession } from '../use-referral-app-session';

const mockReplace = jest.fn();
const mockSession = { appSessionToken: 'fictional-current-token' as string | null, replaceAppSessionToken: mockReplace };
const mockStoredApp = jest.fn();
const mockStoredBridge = jest.fn();
const mockClear = jest.fn();
const mockInvoke = jest.fn();
jest.mock('../use-session', () => ({ useSession: () => mockSession }));
jest.mock('@/lib/request-board-api', () => ({
  getStoredAppSessionToken: () => mockStoredApp(), getStoredBridgeToken: () => mockStoredBridge(),
  clearRequestBoardState: (...args: unknown[]) => mockClear(...args),
}));
jest.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } } }));
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn() } }));

type Renderer = { update: (element: ReactElement) => void; unmount: () => void };
// The repository bundles this renderer without separate declaration files.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer') as { create: (element: ReactElement) => Renderer };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe('financial reads require the currently signed token without mutating account storage', () => {
  let renderer: Renderer;
  let session: ReturnType<typeof useReferralAppSession>;
  function Probe() { session = useReferralAppSession(); return null; }
  const options = { body: { action: 'access' }, fallbackMessage: '조회 실패', requireCurrentToken: true };
  beforeEach(async () => {
    mockSession.appSessionToken = 'fictional-current-token';
    mockReplace.mockReset().mockResolvedValue(undefined);
    mockStoredApp.mockReset().mockResolvedValue(null);
    mockStoredBridge.mockReset().mockResolvedValue('fictional-bridge');
    mockClear.mockReset().mockResolvedValue(undefined);
    mockInvoke.mockReset();
    await act(async () => { renderer = create(createElement(Probe)); });
  });
  afterEach(async () => { await act(async () => { renderer.unmount(); }); });
  function expectNoSessionIO() {
    expect(mockStoredApp).not.toHaveBeenCalled(); expect(mockStoredBridge).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled();
  }

  it('executes once with the current token and does not restore or refresh it', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, enabled: true }, error: null });
    await expect(session.invokeReferralFunction('get-my-referral-allowance', options)).resolves.toEqual({ ok: true, enabled: true });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('get-my-referral-allowance', {
      body: { action: 'access' }, headers: { 'x-app-session-token': 'fictional-current-token' },
    });
    expectNoSessionIO();
  });

  it('requires re-login on an expired token without refreshing or clearing the new login', async () => {
    const pending = deferred(); mockInvoke.mockReturnValue(pending.promise);
    const result = session.invokeReferralFunction('get-my-referral-allowance', options);
    mockSession.appSessionToken = 'fictional-new-account-token';
    await act(async () => { renderer.update(createElement(Probe)); });
    pending.resolve({ data: { ok: false, code: 'expired_app_session' }, error: null });
    await expect(result).rejects.toMatchObject({ code: 'expired_app_session', needsRelogin: true });
    expect(mockSession.appSessionToken).toBe('fictional-new-account-token');
    expect(mockInvoke).toHaveBeenCalledTimes(1); expectNoSessionIO();
  });

  it('does not fall back to a stored app or bridge token when the current session is missing', async () => {
    mockSession.appSessionToken = null;
    await act(async () => { renderer.update(createElement(Probe)); });
    await expect(session.invokeReferralFunction('get-my-referral-allowance', options))
      .rejects.toMatchObject({ code: 'missing_app_session', needsRelogin: true });
    expect(mockInvoke).not.toHaveBeenCalled(); expectNoSessionIO();
  });

  it('does not start session recovery after unmount when a late error body is parsed', async () => {
    const body = deferred();
    const response = new Response('{}', { status: 401 });
    jest.spyOn(response, 'clone').mockReturnValue({ json: () => body.promise } as unknown as Response);
    mockInvoke.mockResolvedValue({ data: null, error: { context: response } });
    const result = session.invokeReferralFunction('get-my-referral-allowance', options);
    await act(async () => { await Promise.resolve(); renderer.unmount(); });
    body.resolve({ code: 'invalid_app_session' });
    await expect(result).rejects.toMatchObject({ code: 'invalid_app_session', needsRelogin: true });
    expect(mockInvoke).toHaveBeenCalledTimes(1); expectNoSessionIO();
  });

  it('preserves the existing one-refresh, one-retry path when the strict option is omitted', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: false, code: 'expired_app_session' }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, appSessionToken: 'fictional-refreshed-token' }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, value: 'restored' }, error: null });
    await expect(session.invokeReferralFunction('get-referral-tree', { fallbackMessage: '조회 실패' }))
      .resolves.toMatchObject({ ok: true, value: 'restored' });
    expect(mockInvoke.mock.calls.map(([name]) => name)).toEqual(['get-referral-tree', 'refresh-app-session', 'get-referral-tree']);
    expect(mockReplace).toHaveBeenCalledWith('fictional-refreshed-token');
    expect(mockInvoke.mock.calls[2][1].headers['x-app-session-token']).toBe('fictional-refreshed-token');
  });

  it('preserves single-flight refresh for concurrent legacy requests', async () => {
    mockSession.appSessionToken = null;
    await act(async () => { renderer.update(createElement(Probe)); });
    const pending = deferred(); mockInvoke.mockReturnValue(pending.promise);
    const first = session.ensureReferralAppSession(); const second = session.ensureReferralAppSession();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(mockInvoke).toHaveBeenCalledTimes(1); expect(mockStoredBridge).toHaveBeenCalledTimes(1);
    pending.resolve({ data: { ok: true, appSessionToken: 'fictional-refreshed-token' }, error: null });
    await expect(Promise.all([first, second])).resolves.toEqual(['fictional-refreshed-token', 'fictional-refreshed-token']);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
});
