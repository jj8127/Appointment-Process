import { act, createElement, type ReactElement } from 'react';

import { useReferralAppSession } from '../use-referral-app-session';

const mockReplace = jest.fn();
const mockSession = { appSessionToken: 'fictional-current-token' as string | null, replaceAppSessionToken: mockReplace,
  role: 'fc', residentId: '01000000000', readOnly: false, hydrated: true };
const mockStoredApp = jest.fn();
const mockStoredBridge = jest.fn();
const mockClear = jest.fn();
const mockInvoke = jest.fn();
let mockAppSessionRevision = 0;
jest.mock('../use-session', () => ({ useSession: () => mockSession }));
jest.mock('@/lib/request-board-api', () => ({
  captureAppSessionOwner: () => {
    const owner = mockAppSessionRevision;
    return () => owner === mockAppSessionRevision;
  },
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
    mockSession.role = 'fc'; mockSession.residentId = '01000000000';
    mockSession.readOnly = false; mockSession.hydrated = true;
    mockAppSessionRevision = 0;
    mockReplace.mockReset().mockImplementation(async () => { mockAppSessionRevision += 1; });
    mockStoredApp.mockReset().mockResolvedValue(null);
    mockStoredBridge.mockReset().mockResolvedValue('fictional-bridge');
    mockClear.mockReset().mockImplementation(async () => { mockAppSessionRevision += 1; });
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

  it.each([
    [401, '{}', true], [403, '{}', false], [403, 'not-json', false],
    [403, '{"code":"expired_app_session"}', true], [503, '{}', false],
  ])('preserves HTTP %s denial or failure without trusting the body %s', async (status, body, needsRelogin) => {
    mockInvoke.mockResolvedValue({ data: null, error: { context: new Response(body, { status }) } });
    await expect(session.invokeReferralFunction('get-my-referral-allowance', options))
      .rejects.toMatchObject({ status, needsRelogin });
    expect(mockInvoke).toHaveBeenCalledTimes(1); expectNoSessionIO();
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

  it.each([
    { data: { ok: true, appSessionToken: 'fictional-old-refreshed-token' }, error: null },
    { data: { ok: false, code: 'invalid_bridge_token' }, error: null },
  ])('does not let a late refresh response mutate a new login: %j', async (response) => {
    mockSession.appSessionToken = null;
    await act(async () => { renderer.update(createElement(Probe)); });
    const pending = deferred(); mockInvoke.mockReturnValueOnce(pending.promise);
    const result = session.ensureReferralAppSession();
    const checked = expect(result).rejects.toMatchObject({ code: 'session_changed', needsRelogin: false });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    mockAppSessionRevision += 1; mockSession.appSessionToken = 'fictional-new-account-token';
    await act(async () => { renderer.update(createElement(Probe)); });
    pending.resolve(response);
    await checked;
    expect(mockReplace).not.toHaveBeenCalled(); expect(mockClear).not.toHaveBeenCalled();
  });

  it('does not start a refresh after the stored bridge read loses its owner', async () => {
    mockSession.appSessionToken = null;
    await act(async () => { renderer.update(createElement(Probe)); });
    const pending = deferred(); mockStoredBridge.mockReturnValueOnce(pending.promise);
    const result = session.ensureReferralAppSession();
    const checked = expect(result).rejects.toMatchObject({ code: 'session_changed' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    mockAppSessionRevision += 1;
    pending.resolve('fictional-old-bridge');
    await checked;
    expect(mockInvoke).not.toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not recover an old read after the same token string leaves and returns', async () => {
    const pending = deferred(); mockInvoke.mockReturnValueOnce(pending.promise);
    const result = session.invokeReferralFunction('get-referral-tree', { fallbackMessage: '조회 실패' });
    const checked = expect(result).rejects.toMatchObject({ code: 'session_changed' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    mockAppSessionRevision += 2;
    pending.resolve({ data: { ok: false, code: 'expired_app_session' }, error: null });
    await checked;
    expect(mockInvoke).toHaveBeenCalledTimes(1); expectNoSessionIO();
  });

  it('invalidates an earlier read when account identity leaves and returns with the same token', async () => {
    const pending = deferred(); mockInvoke.mockReturnValueOnce(pending.promise);
    const result = session.invokeReferralFunction('get-referral-tree', { fallbackMessage: '조회 실패' });
    const checked = expect(result).rejects.toMatchObject({ code: 'session_changed' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    mockSession.residentId = '01000000001';
    await act(async () => { renderer.update(createElement(Probe)); });
    mockSession.residentId = '01000000000';
    await act(async () => { renderer.update(createElement(Probe)); });
    pending.resolve({ data: { ok: true, value: 'fictional-old-account-data' }, error: null });
    await checked;
    expect(mockInvoke).toHaveBeenCalledTimes(1); expectNoSessionIO();
  });

  it('stops cleanup before replacing the token when a new login begins during storage deletion', async () => {
    const pending = deferred();
    mockClear.mockImplementationOnce(() => { mockAppSessionRevision += 1; return pending.promise; });
    const result = session.clearReferralSession();
    const checked = expect(result).rejects.toMatchObject({ code: 'session_changed' });
    mockAppSessionRevision += 1;
    pending.resolve(undefined);
    await checked;
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('rejects refresh completion after unmount without saving or deleting a session', async () => {
    mockSession.appSessionToken = null;
    await act(async () => { renderer.update(createElement(Probe)); });
    const pending = deferred(); mockInvoke.mockReturnValueOnce(pending.promise);
    const result = session.ensureReferralAppSession();
    const checked = expect(result).rejects.toMatchObject({ code: 'session_changed' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); renderer.unmount(); });
    pending.resolve({ data: { ok: true, appSessionToken: 'fictional-stale-token' }, error: null });
    await checked;
    expect(mockReplace).not.toHaveBeenCalled(); expect(mockClear).not.toHaveBeenCalled();
  });

  it('keeps the new refresh single-flight when an old owner finishes', async () => {
    mockSession.appSessionToken = null;
    await act(async () => { renderer.update(createElement(Probe)); });
    const old = deferred(); const current = deferred();
    mockInvoke.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const first = session.ensureReferralAppSession();
    const checked = expect(first).rejects.toMatchObject({ code: 'session_changed' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    mockAppSessionRevision += 1;
    const second = session.ensureReferralAppSession();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    old.resolve({ data: { ok: true, appSessionToken: 'fictional-old-token' }, error: null });
    await checked;
    const shared = session.ensureReferralAppSession();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    current.resolve({ data: { ok: true, appSessionToken: 'fictional-current-refreshed-token' }, error: null });
    await expect(Promise.all([second, shared])).resolves.toEqual([
      'fictional-current-refreshed-token', 'fictional-current-refreshed-token',
    ]);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('keeps a refresh shared while its own token persistence is pending', async () => {
    mockSession.appSessionToken = null;
    await act(async () => { renderer.update(createElement(Probe)); });
    const persistence = deferred();
    mockReplace.mockImplementationOnce(() => { mockAppSessionRevision += 1; return persistence.promise; });
    mockInvoke.mockResolvedValue({ data: { ok: true, appSessionToken: 'fictional-refreshed-token' }, error: null });
    const first = session.ensureReferralAppSession();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const second = session.ensureReferralAppSession();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(mockInvoke).toHaveBeenCalledTimes(1); expect(mockReplace).toHaveBeenCalledTimes(1);
    persistence.resolve(undefined);
    await expect(Promise.all([first, second])).resolves.toEqual(['fictional-refreshed-token', 'fictional-refreshed-token']);
  });
});
