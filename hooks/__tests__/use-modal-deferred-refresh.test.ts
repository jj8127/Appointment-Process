import { createElement } from 'react';
import { Platform } from 'react-native';
import { useModalDeferredRefresh } from '../use-modal-deferred-refresh';

const mockNative = Platform as { OS: string };
const mockInteractions: { callback: () => void; cancel: jest.Mock }[] = [];

jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn() } }));
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  InteractionManager: {
    runAfterInteractions: (callback: () => void) => {
      const task = { callback, cancel: jest.fn() };
      mockInteractions.push(task);
      return task;
    },
  },
}));

// The repository uses a node Jest environment, so render only the hook host.
// No renderer type package is installed; keep this test-only dependency local.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

describe('modal-deferred screen refresh', () => {
  let hook: ReturnType<typeof useModalDeferredRefresh>;
  let tree: { update: (element: unknown) => void; unmount: () => void };
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let refresh: jest.Mock<Promise<void>, [() => boolean]>;
  const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

  function Host({ visibleModal }: { visibleModal: string | null }) {
    hook = useModalDeferredRefresh({ visibleModal, refresh });
    return null;
  }

  function show(visibleModal: string | null) {
    act(() => { tree.update(createElement(Host, { visibleModal })); });
  }

  function mountIosHost() {
    act(() => tree.unmount());
    mockNative.OS = 'ios';
    act(() => { tree = create(createElement(Host, { visibleModal: 'edit' })); });
  }

  beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    mockNative.OS = 'android';
    mockInteractions.length = 0;
    frames = new Map();
    nextFrame = 0;
    refresh = jest.fn<Promise<void>, [() => boolean]>(async () => {});
    global.requestAnimationFrame = jest.fn((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    global.cancelAnimationFrame = jest.fn((id) => { frames.delete(id); });
    jest.spyOn(console, 'error').mockImplementation((message: unknown) => {
      if (!String(message).startsWith('react-test-renderer is deprecated.')) {
        throw new Error(String(message));
      }
    });
    act(() => { tree = create(createElement(Host, { visibleModal: 'edit' })); });
  });

  afterEach(() => {
    act(() => { tree.unmount(); });
    jest.restoreAllMocks();
  });

  async function flushScheduledRefresh() {
    const task = mockInteractions[mockInteractions.length - 1];
    act(() => task.callback());
    await act(async () => {
      for (const callback of frames.values()) callback(0);
      frames.clear();
    });
  }

  it('never refreshes in the save/close render and coalesces requests until the next frame', async () => {
    act(() => { hook.requestRefresh(); hook.requestRefresh(); });
    expect(mockInteractions).toHaveLength(0);
    show(null);
    expect(refresh).not.toHaveBeenCalled();
    expect(mockInteractions).toHaveLength(1);
    await flushScheduledRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('cancels a queued interaction on reopen and refreshes after the next close', async () => {
    act(() => hook.requestRefresh());
    show(null);
    const cancelledTask = mockInteractions[0];
    show('edit');
    expect(cancelledTask.cancel).toHaveBeenCalledTimes(1);
    act(() => cancelledTask.callback());
    expect(frames.size).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
    show(null);
    await flushScheduledRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('cancels a queued frame when the route unmounts', () => {
    act(() => hook.requestRefresh());
    show(null);
    act(() => mockInteractions[0].callback());
    expect(frames.size).toBe(1);
    const staleFrame = frames.values().next().value;
    act(() => tree.unmount());
    expect(frames.size).toBe(0);
    act(() => staleFrame?.(0));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('waits for the matching iOS dismissal and prevents reopening its native dialog too soon', async () => {
    mountIosHost();
    act(() => hook.requestRefresh());
    show(null);
    expect(hook.canOpenModal()).toBe(false);
    expect(mockInteractions).toHaveLength(0);
    act(() => hook.onModalDismiss('delete'));
    expect(mockInteractions).toHaveLength(0);
    act(() => hook.onModalDismiss('edit'));
    expect(hook.canOpenModal()).toBe(true);
    await flushScheduledRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
    show('edit');
    // A delayed event while this modal is visible must not dismiss it.
    act(() => hook.onModalDismiss('edit'));
    act(() => hook.requestRefresh());
    show(null);
    expect(mockInteractions).toHaveLength(1);
    act(() => hook.onModalDismiss('edit'));
    await flushScheduledRefresh();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not let the previous iOS modal dismissal unlock a different closing modal', async () => {
    mountIosHost();
    act(() => hook.requestRefresh());
    // Exercise a programmatic transition even though canOpenModal blocks user reopening.
    show('delete');
    show(null);
    act(() => hook.onModalDismiss('edit'));
    expect(mockInteractions).toHaveLength(0);
    act(() => hook.onModalDismiss('delete'));
    await flushScheduledRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('starts the initial iOS refresh without a dismissal event when no modal was shown', async () => {
    act(() => tree.unmount());
    mockNative.OS = 'ios';
    act(() => { tree = create(createElement(Host, { visibleModal: null })); });
    act(() => hook.requestRefresh());
    await flushScheduledRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(hook.canOpenModal()).toBe(true);
  });

  it('discards an in-flight response on reopen and applies a fresh response after closing again', async () => {
    const commit = jest.fn();
    const respond: (() => void)[] = [];
    refresh.mockImplementation((canCommit) => new Promise<void>((resolve) => {
      respond.push(() => {
        if (canCommit()) commit();
        resolve();
      });
    }));
    act(() => hook.requestRefresh());
    show(null);
    await flushScheduledRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
    show('delete');
    await act(async () => respond[0]());
    expect(commit).not.toHaveBeenCalled();
    show(null);
    await flushScheduledRefresh();
    await act(async () => respond[1]());
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('cancels in-flight response state after unmount', async () => {
    const commit = jest.fn();
    let respond = () => {};
    refresh.mockImplementation((canCommit) => new Promise<void>((resolve) => {
      respond = () => {
        if (canCommit()) commit();
        resolve();
      };
    }));
    act(() => hook.requestRefresh());
    show(null);
    await flushScheduledRefresh();
    act(() => tree.unmount());
    await act(async () => respond());
    expect(commit).not.toHaveBeenCalled();
  });

  it('invalidates an older response when a later mutation requests another refresh', async () => {
    const applied: number[] = [];
    const respond: (() => void)[] = [];
    refresh.mockImplementation((canCommit) => new Promise<void>((resolve) => {
      const version = respond.length;
      respond.push(() => {
        if (canCommit()) applied.push(version);
        resolve();
      });
    }));
    act(() => hook.requestRefresh());
    show(null);
    await flushScheduledRefresh();
    act(() => { hook.requestRefresh(); hook.requestRefresh(); });
    await flushScheduledRefresh();
    await act(async () => { respond[1](); respond[0](); });
    expect(applied).toEqual([1]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
