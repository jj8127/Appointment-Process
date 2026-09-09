import { act, createElement, type ReactElement } from 'react';
import { useReferralGraphSearch } from '../../hooks/use-referral-graph-search';

const { create } = jest.requireActual<{
  create(element: ReactElement): { unmount(): void };
}>('react-test-renderer');

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;

describe('referral graph search coalescing', () => {
  let result: ReturnType<typeof useReferralGraphSearch>;
  let renderer: ReturnType<typeof create> | null;
  let consoleError: jest.SpyInstance;

  beforeAll(() => { environment.IS_REACT_ACT_ENVIRONMENT = true; });
  afterAll(() => { environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });

  beforeEach(() => {
    jest.useFakeTimers();
    const reportError = console.error;
    consoleError = jest.spyOn(console, 'error').mockImplementation((message: unknown, ...args: unknown[]) => {
      // React 19 deprecates this installed test renderer; preserve all other warnings.
      if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated.')) return;
      reportError(message, ...args);
    });
    function Harness() {
      result = useReferralGraphSearch();
      return null;
    }
    act(() => { renderer = create(createElement(Harness)); });
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    consoleError.mockRestore();
    jest.useRealTimers();
  });

  it('updates draft immediately and applies only the final term after 180ms of quiet', () => {
    act(() => result.setSearchTerm('가'));
    expect(result.searchTerm).toBe('가');
    expect(result.appliedSearchTerm).toBe('');
    act(() => jest.advanceTimersByTime(179));
    expect(result.appliedSearchTerm).toBe('');
    act(() => result.setSearchTerm('가람'));
    act(() => jest.advanceTimersByTime(179));
    expect(result.searchTerm).toBe('가람');
    expect(result.appliedSearchTerm).toBe('');
    act(() => jest.advanceTimersByTime(1));
    expect(result.appliedSearchTerm).toBe('가람');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears an applied or pending term immediately without a stale timer restoring it', () => {
    act(() => result.setSearchTerm('가람'));
    act(() => jest.advanceTimersByTime(180));
    expect(result.appliedSearchTerm).toBe('가람');
    act(() => result.setSearchTerm('다른 검색'));
    act(() => result.setSearchTerm(''));
    expect(result.searchTerm).toBe('');
    expect(result.appliedSearchTerm).toBe('');
    expect(jest.getTimerCount()).toBe(0);
    act(() => jest.advanceTimersByTime(1000));
    expect(result.appliedSearchTerm).toBe('');
  });

  it('flushes the latest draft on submit even before React has rendered that draft', () => {
    const originalSet = result.setSearchTerm;
    const originalFlush = result.flushSearchTerm;
    act(() => {
      result.setSearchTerm('첫 검색');
      result.setSearchTerm('마지막 검색');
      result.flushSearchTerm();
    });
    expect(result.searchTerm).toBe('마지막 검색');
    expect(result.appliedSearchTerm).toBe('마지막 검색');
    expect(result.setSearchTerm).toBe(originalSet);
    expect(result.flushSearchTerm).toBe(originalFlush);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels pending work on unmount', () => {
    act(() => result.setSearchTerm('가상 검색'));
    expect(jest.getTimerCount()).toBe(1);
    act(() => renderer?.unmount());
    renderer = null;
    expect(jest.getTimerCount()).toBe(0);
    act(() => jest.advanceTimersByTime(1000));
    expect(result.appliedSearchTerm).toBe('');
  });
});
