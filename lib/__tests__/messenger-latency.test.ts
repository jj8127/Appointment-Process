import {
  createPeerDeliveryTracker,
  createScrollFrameMonitor,
  measureMessengerLatency,
  recordMessengerLatency,
  recordPushDelivery,
  recordServerToDeviceLatency,
  resetMessengerLatencyForTests,
  setMessengerLatencyReporter,
  type MessengerLatencySample,
} from '../messenger-latency';

describe('messenger-latency', () => {
  let samples: MessengerLatencySample[];

  beforeEach(() => {
    resetMessengerLatencyForTests();
    samples = [];
    setMessengerLatencyReporter((sample) => samples.push(sample));
  });

  afterEach(() => {
    jest.useRealTimers();
    resetMessengerLatencyForTests();
  });

  it('drops invalid durations and never throws when the reporter fails', () => {
    recordMessengerLatency('send_ack', -1);
    recordMessengerLatency('send_ack', Number.NaN);
    recordMessengerLatency('send_ack', 11 * 60 * 1000);
    expect(samples).toHaveLength(0);

    setMessengerLatencyReporter(() => {
      throw new Error('reporter down');
    });
    expect(() => recordMessengerLatency('send_ack', 10)).not.toThrow();
  });

  it('measures async tasks with ok and error outcomes', async () => {
    await expect(measureMessengerLatency('send_ack', async () => 'done', { room_type: 'group' }))
      .resolves.toBe('done');
    await expect(measureMessengerLatency('send_ack', async () => {
      throw new Error('fail');
    })).rejects.toThrow('fail');

    expect(samples.map((sample) => sample.attributes.outcome)).toEqual(['ok', 'error']);
    expect(samples[0].attributes.room_type).toBe('group');
  });

  it('clamps small clock skew to zero and drops large negative skew', () => {
    const serverMs = Date.parse('2026-10-16T00:00:00.000Z');
    recordServerToDeviceLatency('peer_delivery', serverMs, serverMs - 1_000);
    recordServerToDeviceLatency('peer_delivery', serverMs, serverMs - 5_000);
    recordServerToDeviceLatency('peer_delivery', 'not-a-date', serverMs);
    expect(samples).toHaveLength(1);
    expect(samples[0].durationMs).toBe(0);
  });

  it('counts only incoming messages created after the room opened, once each', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-16T00:00:10.000Z'));
    const openedAtMs = Date.parse('2026-10-16T00:00:05.000Z');
    const tracker = createPeerDeliveryTracker<{ id: string; created_at: string; mine: boolean }>({
      roomType: 'direct',
      getId: (message) => message.id,
      getCreatedAt: (message) => message.created_at,
      isIncoming: (message) => !message.mine,
      openedAtMs,
    });
    const rows = [
      { id: 'old', created_at: '2026-10-16T00:00:01.000Z', mine: false },
      { id: 'mine', created_at: '2026-10-16T00:00:08.000Z', mine: true },
      { id: 'new', created_at: '2026-10-16T00:00:07.000Z', mine: false },
    ];

    tracker.observe(rows, { path: 'refetch' });
    tracker.observe(rows, { path: 'refetch' });

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      metric: 'peer_delivery',
      durationMs: 3_000,
      attributes: { room_type: 'direct', path: 'refetch', clock: 'server_to_device' },
    });
  });

  it('records push delivery from sentAt to the notification date only once per request', () => {
    const notification = {
      date: Date.parse('2026-10-16T00:00:02.500Z'),
      request: {
        identifier: 'push-1',
        content: { data: { sentAt: '2026-10-16T00:00:00.000Z', type: 'message' } },
      },
    };

    recordPushDelivery(notification, 'received');
    recordPushDelivery(notification, 'opened');
    recordPushDelivery({ request: { identifier: 'push-2', content: { data: {} } } }, 'opened');

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      metric: 'push_delivery',
      durationMs: 2_500,
      attributes: { trigger: 'received', kind: 'message' },
    });
  });

  it('accepts notification dates expressed in seconds', () => {
    recordPushDelivery({
      date: Date.parse('2026-10-16T00:00:04.000Z') / 1000,
      request: {
        identifier: 'push-3',
        content: { data: { sentAt: '2026-10-16T00:00:00.000Z', category: 'group_chat' } },
      },
    }, 'opened');
    expect(samples[0]).toMatchObject({ durationMs: 4_000, attributes: { kind: 'group_chat' } });
  });

  it('reports scroll frames after momentum ends and ignores short flicks', () => {
    let now = 0;
    const frames: (() => void)[] = [];
    const performanceSpy = jest.spyOn(performance, 'now').mockImplementation(() => now);
    const globals = globalThis as unknown as {
      requestAnimationFrame?: (callback: (time: number) => void) => number;
      cancelAnimationFrame?: (id: number) => void;
    };
    const originalRaf = globals.requestAnimationFrame;
    const originalCancel = globals.cancelAnimationFrame;
    globals.requestAnimationFrame = (callback) => {
      frames.push(() => callback(now));
      return frames.length;
    };
    globals.cancelAnimationFrame = () => undefined;

    const monitor = createScrollFrameMonitor({ room_type: 'group' });
    monitor.onScrollBeginDrag();
    for (let i = 0; i < 30; i += 1) {
      now += i === 10 ? 50 : 16;
      frames.shift()?.();
    }
    monitor.onScrollEndDrag();
    monitor.onMomentumScrollBegin();
    now = 600;
    monitor.onMomentumScrollEnd();

    const shortMonitor = createScrollFrameMonitor();
    shortMonitor.onScrollBeginDrag();
    now += 100;
    shortMonitor.onMomentumScrollEnd();

    expect(samples).toHaveLength(1);
    expect(samples[0].metric).toBe('scroll_frames');
    expect(samples[0].attributes).toMatchObject({ room_type: 'group', fps: 48 });
    expect(samples[0].attributes.long_frame_ratio).toBeCloseTo(0.03, 2);

    performanceSpy.mockRestore();
    globals.requestAnimationFrame = originalRaf;
    globals.cancelAnimationFrame = originalCancel;
  });
});
