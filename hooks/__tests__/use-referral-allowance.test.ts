import { act, createElement, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useReferralAllowance, useReferralAllowanceAccess } from '../use-referral-allowance';
import { calculateReferralAllowance } from '@/lib/referral-allowance-calculation';
import type { ReferralAllowanceStatement } from '@/types/referral-allowance';

const mockSession = {
  hydrated: true, role: 'admin' as string | null, readOnly: true, isRequestBoardDesigner: false,
  residentId: 'fictional-account-a', appSessionToken: 'fictional-session-secret',
};
let mockFocused = true;
const mockInvoke = jest.fn();
const mockAppStateListeners = new Set<(state: string) => void>();
jest.mock('../use-session', () => ({ useSession: () => mockSession }));
jest.mock('../use-referral-app-session', () => ({
  useReferralAppSession: () => ({ invokeReferralFunction: mockInvoke }),
  ReferralAppSessionError: class extends Error { needsRelogin = true; },
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('react-native', () => ({ AppState: { addEventListener: (_: string, callback: (state: string) => void) => {
  mockAppStateListeners.add(callback);
  return { remove: () => mockAppStateListeners.delete(callback) };
} } }));

type Renderer = { update: (element: ReactElement) => void; unmount: () => void };
// The existing bundled renderer has no separate @types package; keep its small test-only surface typed here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer') as { create: (element: ReactElement) => Renderer };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function statement(month: string, amount: number): ReferralAllowanceStatement {
  const [year, monthNumber] = month.split('-').map(Number);
  const base = { affiliation: '가상 조직', activeAtPerformance: true, activeAtBasisDate: true, rankAtBasisDate: 'FP' };
  return calculateReferralAllowance({ performanceMonth: month,
    paymentDate: new Date(Date.UTC(year, monthNumber + 1, 1)).toISOString().slice(0, 10),
    genealogyAsOf: `${month}-01`, sourceSnapshotDates: [`${month}-01`], beneficiaryEmployeeCode: 'SYNTHETIC_ROOT',
    people: [
      { ...base, employeeCode: 'SYNTHETIC_ROOT', parentEmployeeCode: null, name: '가상 수령인', finalTargetPerformanceKrw: 0 },
      { ...base, employeeCode: 'SYNTHETIC_CHILD', parentEmployeeCode: 'SYNTHETIC_ROOT', name: '가상 구성원', finalTargetPerformanceKrw: amount * 10 },
    ] });
}
const response = (month: string, amount: number) => ({ ok: true, enabled: true,
  availableMonths: ['2026-08', '2026-07'], statement: statement(month, amount) });
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('allowance hooks isolate signed account and month requests', () => {
  let client: QueryClient;
  let renderer: Renderer | undefined;
  let latest: ReturnType<typeof useReferralAllowance>;
  let access: ReturnType<typeof useReferralAllowanceAccess>;
  let month: string | undefined;
  let kind: 'statement' | 'access';
  function Probe() {
    // The chosen probe stays constant throughout each test.
    latest = useReferralAllowance(month);
    return null;
  }
  function AccessProbe() { access = useReferralAllowanceAccess(); return null; }
  const element = () => createElement(QueryClientProvider, { client }, createElement(kind === 'access' ? AccessProbe : Probe));
  async function flush() { await act(async () => { await new Promise((done) => setTimeout(done, 15)); }); }
  async function mount() { await act(async () => { renderer = create(element()); }); await flush(); }
  async function rerender() { await act(async () => { renderer!.update(element()); }); await flush(); }

  beforeEach(() => {
    Object.assign(mockSession, { hydrated: true, role: 'admin', readOnly: true, isRequestBoardDesigner: false,
      residentId: 'fictional-account-a', appSessionToken: 'fictional-session-secret' });
    mockFocused = true; mockInvoke.mockReset(); month = undefined; kind = 'statement';
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });
  afterEach(async () => {
    if (renderer) await act(async () => { renderer!.unmount(); });
    renderer = undefined; client.clear(); mockAppStateListeners.clear();
  });

  it.each([
    { role: 'designer' }, { readOnly: false }, { isRequestBoardDesigner: true }, { hydrated: false },
    { residentId: '' }, { appSessionToken: '' }, { role: null },
  ])('does not request capability for an ineligible local session %j', async (overrides) => {
    Object.assign(mockSession, overrides); kind = 'access';
    await mount();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(access.enabled).toBe(false);
  });

  it('requests server-scoped capability for an FC and hides another owner during a switch', async () => {
    Object.assign(mockSession, { role: 'fc', readOnly: false });
    kind = 'access';
    mockInvoke.mockResolvedValue({ ok: true, enabled: true, availableMonths: ['2026-08'] });
    await mount();
    expect(access.enabled).toBe(true);
    const pending = deferred();
    mockInvoke.mockImplementation(() => pending.promise);
    mockSession.residentId = 'fictional-account-b';
    await rerender();
    expect(access.data).toBeUndefined();
    await act(async () => { pending.resolve({ ok: true, enabled: false }); });
    await flush();
    expect(access.enabled).toBe(false);
  });

  it('never puts account identifiers or session tokens into cache keys', async () => {
    mockInvoke.mockResolvedValue(response('2026-08', 10000));
    await mount();
    expect(latest.statement?.summary.newPaymentKrw).toBe(10000);
    const keys = JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey));
    expect(keys).not.toContain(mockSession.residentId);
    expect(keys).not.toContain(mockSession.appSessionToken);
    expect(mockInvoke.mock.calls.every(([name, options]) => name === 'get-my-referral-allowance'
      && options.requireCurrentToken === true
      && Object.keys(options.body).every((key) => ['action', 'month'].includes(key)))).toBe(true);
  });

  it('hides settled data and reads again when the same account receives a new token', async () => {
    mockInvoke.mockResolvedValue(response('2026-08', 10000)); await mount();
    const oldScope = latest.scope;
    const pending = deferred(); mockInvoke.mockReturnValue(pending.promise);
    mockSession.appSessionToken = 'fictional-replacement-token'; await rerender();
    expect(latest.scope).not.toBe(oldScope);
    expect(latest.statement).toBeNull(); expect(latest.isLoading).toBe(true);
    await act(async () => { pending.resolve(response('2026-08', 40000)); }); await flush();
    expect(latest.statement?.summary.newPaymentKrw).toBe(40000);
    const cacheKeys = JSON.stringify(client.getQueryCache().getAll().map((item) => item.queryKey));
    expect(cacheKeys).not.toContain('fictional-session-secret');
    expect(cacheKeys).not.toContain(mockSession.appSessionToken);
  });

  it('rejects an old-token access success while the replacement token is still being checked', async () => {
    kind = 'access'; const old = deferred(); const next = deferred();
    mockInvoke.mockImplementation(() => mockSession.appSessionToken === 'fictional-session-secret' ? old.promise : next.promise);
    await mount();
    mockSession.appSessionToken = 'fictional-replacement-token'; await rerender();
    await act(async () => { old.resolve({ ok: true, enabled: true, availableMonths: ['2026-08'] }); }); await flush();
    expect(access.enabled).toBe(false); expect(access.isLoading).toBe(true);
    await act(async () => { next.resolve({ ok: true, enabled: false }); }); await flush();
    expect(access.mode).toBe('empty');
  });

  it('ignores an expired old-token response after a replacement token has succeeded', async () => {
    const old = deferred(); const next = deferred();
    mockInvoke.mockImplementation(() => mockSession.appSessionToken === 'fictional-session-secret' ? old.promise : next.promise);
    await mount();
    mockSession.appSessionToken = 'fictional-replacement-token'; await rerender();
    await act(async () => { next.resolve(response('2026-08', 20000)); }); await flush();
    await act(async () => { old.reject(new Error('expired old session')); }); await flush();
    expect(latest.statement?.summary.newPaymentKrw).toBe(20000);
    expect(latest.error).toBeNull();
  });

  it('hides the previous month immediately and rejects a late previous-month response', async () => {
    const old = deferred(); const next = deferred();
    mockInvoke.mockImplementation((_name, options) => options.body.month === '2026-07' ? next.promise : old.promise);
    await mount();
    month = '2026-07'; await rerender();
    expect(latest.statement).toBeNull();
    await act(async () => { next.resolve(response('2026-07', 70000)); }); await flush();
    expect(latest.statement?.performanceMonth).toBe('2026-07');
    await act(async () => { old.resolve(response('2026-08', 80000)); }); await flush();
    expect(latest.statement?.summary.newPaymentKrw).toBe(70000);
  });

  it('does not expose an old account response after account change or logout', async () => {
    const old = deferred(); const next = deferred(); let owner = 'a';
    mockInvoke.mockImplementation(() => owner === 'a' ? old.promise : next.promise);
    await mount();
    owner = 'b'; mockSession.residentId = 'fictional-account-b'; await rerender();
    await act(async () => { next.resolve(response('2026-08', 20000)); }); await flush();
    await act(async () => { old.resolve(response('2026-08', 90000)); }); await flush();
    expect(latest.statement?.summary.newPaymentKrw).toBe(20000);
    mockSession.role = null; mockSession.residentId = ''; mockSession.appSessionToken = ''; await rerender();
    expect(latest.statement).toBeNull();
    expect(latest.data).toBeUndefined();
    expect(client.getQueryCache().getAll().filter((query) => query.state.data !== undefined)).toHaveLength(0);
  });

  it('suppresses stale statement data on refresh failure and access revocation', async () => {
    mockInvoke.mockResolvedValue(response('2026-08', 30000)); await mount();
    mockInvoke.mockRejectedValueOnce(new Error('forbidden'));
    await act(async () => { latest.retry(); }); await flush();
    expect(latest.statement).toBeNull(); expect(latest.error).toBeTruthy();
    mockInvoke.mockResolvedValueOnce({ ok: true, enabled: false });
    await act(async () => { latest.retry(); }); await flush();
    expect(latest.statement).toBeNull(); expect(latest.enabled).toBe(false);
  });

  it('returns an empty state when the server has no allowance access for this account', async () => {
    kind = 'access'; mockInvoke.mockResolvedValue({ ok: true, enabled: false }); await mount();
    expect(access.mode).toBe('empty');
    expect(access.enabled).toBe(false);
    expect(access.error).toBeNull();
  });

  it('rejects malformed statements before exposing them to the screen', async () => {
    mockInvoke.mockResolvedValue({ ok: true, enabled: true, availableMonths: ['2026-08'], statement: {} });
    await mount();
    expect(latest.statement).toBeNull();
    expect(latest.error).toBeTruthy();
  });

  it('does not turn an access lookup error into an empty result', async () => {
    kind = 'access'; mockInvoke.mockRejectedValue(new Error('network failure')); await mount();
    expect(access.mode).toBe('error'); expect(access.enabled).toBe(false);
  });

  it('requires login rather than showing an empty result when a manager has no signed app session', async () => {
    kind = 'access'; mockSession.appSessionToken = ''; await mount();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(access.mode).toBe('error');
    expect(access.error).toMatchObject({ needsRelogin: true });
  });

  it('removes a loaded month while the next month is loading and rejects the wrong month', async () => {
    mockInvoke.mockResolvedValue(response('2026-08', 30000)); await mount();
    expect(latest.statement?.performanceMonth).toBe('2026-08');
    const pending = deferred(); mockInvoke.mockReturnValue(pending.promise);
    month = '2026-07'; await rerender();
    expect(latest.statement).toBeNull(); expect(latest.isLoading).toBe(true);
    await act(async () => { pending.resolve(response('2026-08', 30000)); }); await flush();
    expect(latest.statement).toBeNull(); expect(latest.error).toBeTruthy();
  });

  it('refetches on focus and foreground and hides data while a route is unfocused', async () => {
    mockInvoke.mockResolvedValue(response('2026-08', 30000)); await mount();
    const initial = mockInvoke.mock.calls.length;
    mockFocused = false; await rerender(); expect(latest.statement).toBeNull();
    mockFocused = true; await rerender(); expect(mockInvoke.mock.calls.length).toBeGreaterThan(initial);
    const beforeActive = mockInvoke.mock.calls.length;
    await act(async () => { mockAppStateListeners.forEach((callback) => callback('active')); }); await flush();
    expect(mockInvoke.mock.calls.length).toBeGreaterThan(beforeActive);
  });
});
