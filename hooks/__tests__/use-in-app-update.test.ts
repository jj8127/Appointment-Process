/* eslint-disable @typescript-eslint/no-require-imports */
import type { ReactElement } from 'react';

const mockCheckNeedsUpdate = jest.fn();
const mockStartUpdate = jest.fn();
const mockDebug = jest.fn();
const mockAlert = jest.fn();
const mockOpenExternalUrl = jest.fn();
const mockStorage = new Map<string, string>();
let mockInstalledVersion = '4.2.8';
let mockExecutionEnvironment = 'standalone';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { get executionEnvironment() { return mockExecutionEnvironment; } },
}));
jest.mock('sp-react-native-in-app-updates', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    checkNeedsUpdate: mockCheckNeedsUpdate,
    startUpdate: mockStartUpdate,
  })),
  IAUUpdateKind: { FLEXIBLE: 0 },
}));
jest.mock('@/lib/logger', () => ({ logger: { debug: mockDebug } }));
jest.mock('react-native', () => ({ Alert: { alert: mockAlert }, Platform: { OS: 'ios', Version: '18.0' } }));
jest.mock('react-native-device-info', () => ({
  getVersion: () => mockInstalledVersion,
  getBundleId: () => 'test.garamin',
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockStorage.set(key, value); },
  },
}));
jest.mock('@/lib/open-external-url', () => ({ openExternalUrl: mockOpenExternalUrl }));

type Renderer = { update: (element: ReactElement) => void; unmount: () => void };
type UpdateResult = { shouldUpdate: boolean };

function updateResult(shouldUpdate = true) {
  return { shouldUpdate, storeVersion: '4.2.9', other: {
    bundleId: 'test.garamin', trackId: 1234567890, minimumOsVersion: '15.0',
  } };
}

function deferred() {
  let resolve!: (result: UpdateResult) => void;
  const promise = new Promise<UpdateResult>((done) => { resolve = done; });
  return { promise, resolve: (result: UpdateResult) => resolve(updateResult(result.shouldUpdate)) };
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe.each(['android', 'ios'])('%s startup update lifecycle', (platform) => {
  let act: typeof import('react')['act'];
  let createElement: typeof import('react')['createElement'];
  let create: (element: ReactElement) => Renderer;
  let useInAppUpdate: (enabled?: boolean) => void;
  let renderers: Renderer[];
  const prompt = () => platform === 'ios' ? mockAlert : mockStartUpdate;

  function Probe({ enabled = true }: { enabled?: boolean }) {
    useInAppUpdate(enabled);
    return null;
  }

  async function mount(enabled = true) {
    let renderer!: Renderer;
    await act(async () => { renderer = create(createElement(Probe, { enabled })); });
    renderers.push(renderer);
    return renderer;
  }

  beforeEach(() => {
    // Each test models a fresh JS process, including the process-wide update check.
    jest.resetModules();
    renderers = [];
    ({ act, createElement } = require('react') as typeof import('react'));
    ({ create } = require('react-test-renderer') as { create: (element: ReactElement) => Renderer });
    ({ useInAppUpdate } = require(`../useInAppUpdate.${platform}`));
    mockCheckNeedsUpdate.mockReset().mockResolvedValue(updateResult());
    mockStartUpdate.mockReset().mockResolvedValue(undefined);
    mockDebug.mockReset();
    mockAlert.mockReset();
    mockOpenExternalUrl.mockReset().mockResolvedValue(undefined);
    mockStorage.clear();
    mockInstalledVersion = '4.2.8';
    mockExecutionEnvironment = 'standalone';
    renderers = [];
  });

  afterEach(async () => {
    await act(async () => { renderers.forEach((renderer) => renderer.unmount()); });
  });

  it('shares one store check and one update request across concurrent mounts', async () => {
    const pending = deferred();
    mockCheckNeedsUpdate.mockReturnValue(pending.promise);
    await mount();
    await mount();
    expect(mockCheckNeedsUpdate).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ shouldUpdate: true }); });
    expect(prompt()).toHaveBeenCalledTimes(1);
  });

  it('does not open an update prompt after its owner unmounts', async () => {
    const pending = deferred();
    mockCheckNeedsUpdate.mockReturnValue(pending.promise);
    const renderer = await mount();
    await act(async () => { renderer.unmount(); });
    await act(async () => { pending.resolve({ shouldUpdate: true }); });
    expect(prompt()).not.toHaveBeenCalled();
  });

  it('reuses a pending check when an effect remounts and presents only for a live owner', async () => {
    const pending = deferred();
    mockCheckNeedsUpdate.mockReturnValue(pending.promise);
    const first = await mount();
    await act(async () => { first.unmount(); });
    await mount();
    await act(async () => { pending.resolve({ shouldUpdate: true }); });
    expect(mockCheckNeedsUpdate).toHaveBeenCalledTimes(1);
    expect(prompt()).toHaveBeenCalledTimes(1);
  });

  it('waits for the startup surface to be ready', async () => {
    const renderer = await mount(false);
    expect(mockCheckNeedsUpdate).not.toHaveBeenCalled();
    await act(async () => { renderer.update(createElement(Probe, { enabled: true })); });
    expect(mockCheckNeedsUpdate).toHaveBeenCalledTimes(1);
    expect(prompt()).toHaveBeenCalledTimes(1);
  });

  it('does not repeat an update prompt after navigation or root remount', async () => {
    const first = await mount();
    await act(async () => { first.unmount(); });
    await mount();
    expect(mockCheckNeedsUpdate).toHaveBeenCalledTimes(1);
    expect(prompt()).toHaveBeenCalledTimes(1);
  });

  it('does not request an update when the installed version is current', async () => {
    mockCheckNeedsUpdate.mockResolvedValue({ shouldUpdate: false });
    await mount();
    expect(prompt()).not.toHaveBeenCalled();
  });

  it('handles an unavailable store without opening a blocking alert', async () => {
    mockCheckNeedsUpdate.mockRejectedValue(new Error('fictional-store-unavailable'));
    await mount();
    expect(prompt()).not.toHaveBeenCalled();
    expect(mockDebug).toHaveBeenCalledTimes(1);
  });

  it('does not load the native updater in Expo Go', async () => {
    mockExecutionEnvironment = 'storeClient';
    await mount();
    expect(mockCheckNeedsUpdate).not.toHaveBeenCalled();
  });

  if (platform === 'ios') {
    it('uses one lookup and a cancelable app alert with the Korean store link', async () => {
      await mount();
      expect(mockCheckNeedsUpdate).toHaveBeenCalledWith({ country: 'kr', curVersion: '4.2.8', bundleId: 'test.garamin' });
      expect(mockStartUpdate).not.toHaveBeenCalled();
      const [, , buttons, options] = mockAlert.mock.calls[0];
      expect(buttons[0]).toMatchObject({ style: 'cancel' });
      expect(options).toEqual({ cancelable: true });
      await act(async () => { buttons[1].onPress(); });
      expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://apps.apple.com/kr/app/id1234567890', { preferExternalBrowser: true });
      expect(mockCheckNeedsUpdate).toHaveBeenCalledTimes(1);
      expect(mockAlert).toHaveBeenCalledTimes(1);
    });

    it.each(['4.2.9', '4.3.0'])('does not prompt when native %s is already current or newer', async (version) => {
      mockInstalledVersion = version;
      await mount();
      expect(mockAlert).not.toHaveBeenCalled();
    });

    it('suppresses the same installed/store target across restart during the cooldown', async () => {
      mockStorage.set('garamin:ios-update-prompt:v1', JSON.stringify({ target: '4.2.8:4.2.9', shownAt: Date.now() }));
      await mount();
      expect(mockAlert).not.toHaveBeenCalled();
    });

    it('checks a new target even if a prior target was recently dismissed', async () => {
      mockStorage.set('garamin:ios-update-prompt:v1', JSON.stringify({ target: '4.2.8:4.2.8', shownAt: Date.now() }));
      await mount();
      expect(mockAlert).toHaveBeenCalledTimes(1);
    });

    it('allows an optional reminder after the bounded cooldown expires', async () => {
      mockStorage.set('garamin:ios-update-prompt:v1', JSON.stringify({ target: '4.2.8:4.2.9', shownAt: Date.now() - 25 * 60 * 60 * 1000 }));
      await mount();
      expect(mockAlert).toHaveBeenCalledTimes(1);
    });

    it.each([
      { bundleId: 'another.app' }, { trackId: -1 }, { minimumOsVersion: '19.0' },
    ])('does not prompt for an invalid or incompatible store result %j', async (details) => {
      const result = updateResult();
      mockCheckNeedsUpdate.mockResolvedValue({ ...result, other: { ...result.other, ...details } });
      await mount();
      expect(mockAlert).not.toHaveBeenCalled();
    });

    it('persists the target before presenting so store return cannot create a prompt loop', async () => {
      mockAlert.mockImplementation(() => {
        expect(JSON.parse(mockStorage.get('garamin:ios-update-prompt:v1')!)).toMatchObject({ target: '4.2.8:4.2.9' });
      });
      await mount();
      expect(mockAlert).toHaveBeenCalledTimes(1);
    });
  }
});
