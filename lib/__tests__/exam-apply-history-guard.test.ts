import {
  getExamApplicationHistoryGuardState,
  getExamApplicationRouteHydrationKey,
} from '@/lib/exam-apply-history-guard';

describe('exam application history guard', () => {
  it('fails closed while an enabled history query is loading, fetching, or failed', () => {
    expect(getExamApplicationHistoryGuardState({
      enabled: true,
      isLoading: true,
      isFetching: false,
      hasError: false,
    })).toBe('loading');
    expect(getExamApplicationHistoryGuardState({
      enabled: true,
      isLoading: false,
      isFetching: true,
      hasError: false,
    })).toBe('loading');
    expect(getExamApplicationHistoryGuardState({
      enabled: true,
      isLoading: false,
      isFetching: false,
      hasError: true,
    })).toBe('error');
    expect(getExamApplicationHistoryGuardState({
      enabled: true,
      isLoading: false,
      isFetching: false,
      hasError: false,
    })).toBe('ready');
  });

  it('does not block before a proxy application target enables history', () => {
    expect(getExamApplicationHistoryGuardState({
      enabled: false,
      isLoading: false,
      isFetching: false,
      hasError: false,
    })).toBe('not-required');
  });

  it('keys route hydration by actor, flow, and exactly one target', () => {
    expect(getExamApplicationRouteHydrationKey({
      actorId: 'actor-1',
      examType: 'life',
      registrationId: 'registration-1',
    })).toBe('actor-1:life:registration:registration-1');
    expect(getExamApplicationRouteHydrationKey({
      actorId: 'actor-1',
      examType: 'nonlife',
      roundId: 'round-1',
    })).toBe('actor-1:nonlife:round:round-1');
    expect(getExamApplicationRouteHydrationKey({
      actorId: null,
      examType: 'life',
      roundId: 'round-1',
    })).toBeNull();
    expect(getExamApplicationRouteHydrationKey({
      actorId: 'actor-1',
      examType: 'life',
      registrationId: 'registration-1',
      roundId: 'round-1',
    })).toBeNull();
  });
});
