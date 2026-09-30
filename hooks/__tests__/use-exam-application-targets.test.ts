import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactElement } from 'react';

import { ExamPaymentProofApiError, type ExamApplicationTarget } from '@/lib/exam-payment-proof-api';

import { useExamApplicationTargets } from '../use-exam-application-targets';

const mockSession = {
  hydrated: true, role: 'admin' as string | null, readOnly: false, staffType: 'admin',
  residentId: 'fictional-account-a', appSessionToken: 'fictional-token-a' as string | null,
};
const mockListTargets = jest.fn();
jest.mock('../use-session', () => ({ useSession: () => mockSession }));
jest.mock('@/lib/exam-payment-proof-api', () => ({
  ...jest.requireActual('@/lib/exam-payment-proof-api'),
  listExamApplicationTargets: (...args: unknown[]) => mockListTargets(...args),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-file-system/legacy', () => ({}));

type Renderer = { update: (element: ReactElement) => void; unmount: () => void };
// The installed renderer has no separate types package; describe only the used surface.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer') as { create: (element: ReactElement) => Renderer };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const target: ExamApplicationTarget = {
  fcId: 'fictional-fc-a', residentId: 'fictional-resident-a', name: '가상 FC',
  affiliation: '가상 본부', phoneLast4: '0001',
};
function deferred() {
  let resolve!: (targets: ExamApplicationTarget[]) => void;
  const promise = new Promise<ExamApplicationTarget[]>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('exam proxy target query recovery', () => {
  let client: QueryClient;
  let renderer: Renderer | undefined;
  let latest: ReturnType<typeof useExamApplicationTargets>;
  function Probe() { latest = useExamApplicationTargets(); return null; }
  const element = () => createElement(QueryClientProvider, { client }, createElement(Probe));
  const flush = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 15)); }); };
  const mount = async () => { await act(async () => { renderer = create(element()); }); await flush(); };
  const rerender = async () => { await act(async () => { renderer!.update(element()); }); await flush(); };

  beforeEach(() => {
    Object.assign(mockSession, {
      hydrated: true, role: 'admin', readOnly: false, staffType: 'admin',
      residentId: 'fictional-account-a', appSessionToken: 'fictional-token-a',
    });
    mockListTargets.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(async () => {
    if (renderer) await act(async () => { renderer!.unmount(); });
    renderer = undefined;
    client.clear();
  });

  it('shows a login action for a restored staff session without a token instead of an empty result', async () => {
    mockSession.appSessionToken = null;
    await mount();
    expect(mockListTargets).not.toHaveBeenCalled();
    expect(latest.needsRelogin).toBe(true);
    expect(latest.errorMessage).toContain('다시 로그인');
    expect(latest.isLoading).toBe(false);
    await act(async () => { await latest.refetch(); });
    expect(mockListTargets).not.toHaveBeenCalled();
  });

  it('preserves an expired-session error and reloads automatically after a new signed login', async () => {
    mockListTargets.mockRejectedValueOnce(new ExamPaymentProofApiError('세션이 만료되었습니다. 다시 로그인해주세요.', 'expired_app_session'))
      .mockResolvedValueOnce([target]);
    await mount();
    expect(latest.needsRelogin).toBe(true);
    expect(latest.errorMessage).toContain('만료');
    mockSession.appSessionToken = 'fictional-renewed-token';
    await rerender();
    expect(mockListTargets).toHaveBeenLastCalledWith('fictional-renewed-token');
    expect(latest.targets).toEqual([target]);
    expect(latest.errorMessage).toBeNull();
    expect(latest.needsRelogin).toBe(false);
  });

  it('recovers a transient failure by retrying the actual target query', async () => {
    mockListTargets.mockRejectedValueOnce(new ExamPaymentProofApiError('FC 목록을 불러오지 못했습니다.', 'db_error'))
      .mockResolvedValueOnce([target]);
    await mount();
    expect(latest.errorMessage).toContain('불러오지 못했습니다');
    expect(latest.needsRelogin).toBe(false);
    await act(async () => { await latest.refetch(); });
    await flush();
    expect(mockListTargets).toHaveBeenCalledTimes(2);
    expect(latest.targets).toEqual([target]);
    expect(latest.errorMessage).toBeNull();
  });

  it('distinguishes genuine empty success from loading and errors', async () => {
    const pending = deferred();
    mockListTargets.mockReturnValue(pending.promise);
    await mount();
    expect(latest.isLoading).toBe(true);
    expect(latest.errorMessage).toBeNull();
    await act(async () => { pending.resolve([]); });
    await flush();
    expect(latest.isLoading).toBe(false);
    expect(latest.targets).toEqual([]);
    expect(latest.errorMessage).toBeNull();
  });

  it('hides stale successful data when a later refetch fails', async () => {
    mockListTargets.mockResolvedValueOnce([target]).mockRejectedValueOnce(new Error('unsafe internal detail'));
    await mount();
    expect(latest.targets).toEqual([target]);
    await act(async () => { await latest.refetch(); });
    await flush();
    expect(latest.targets).toEqual([]);
    expect(latest.errorMessage).toContain('다시 시도');
    expect(latest.errorMessage).not.toContain('unsafe internal detail');
  });

  it('isolates results and selection on an account switch without putting identity in cache keys', async () => {
    mockListTargets.mockResolvedValueOnce([target]);
    await mount();
    await act(async () => { latest.selectTarget(target); });
    expect(latest.selectedTarget).toEqual(target);
    const pending = deferred();
    mockListTargets.mockReturnValue(pending.promise);
    mockSession.residentId = 'fictional-account-b';
    mockSession.appSessionToken = 'fictional-token-b';
    await rerender();
    expect(latest.selectedTarget).toBeNull();
    expect(latest.targets).toEqual([]);
    expect(latest.isLoading).toBe(true);
    const cacheKeys = JSON.stringify(client.getQueryCache().getAll().map((entry) => entry.queryKey));
    expect(cacheKeys).not.toContain('fictional-');
    await act(async () => { pending.resolve([]); });
    await flush();
  });

  it('ignores a late previous-session result while the new request is pending', async () => {
    const old = deferred();
    const next = deferred();
    mockListTargets.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await mount();
    mockSession.appSessionToken = 'fictional-new-token';
    await rerender();
    await act(async () => { old.resolve([target]); });
    await flush();
    expect(latest.targets).toEqual([]);
    expect(latest.isLoading).toBe(true);
    await act(async () => { next.resolve([]); });
    await flush();
    expect(latest.targets).toEqual([]);
  });

  it.each([{ role: 'fc' }, { role: null }, { hydrated: false }])(
    'does not request the staff list outside an active proxy session %j', async (overrides) => {
      Object.assign(mockSession, overrides);
      await mount();
      await act(async () => { await latest.refetch(); });
      expect(mockListTargets).not.toHaveBeenCalled();
      expect(latest.targets).toEqual([]);
    },
  );
});
