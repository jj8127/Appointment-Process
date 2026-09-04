import type { GroupChatMessage } from '../group-chat-api';
import { subscribeGroupChatMessages } from '../group-chat-realtime';

type RealtimeClient = Parameters<typeof subscribeGroupChatMessages>[0]['client'];
type Channel = ReturnType<RealtimeClient['channel']>;
type RemovalResult = Awaited<ReturnType<RealtimeClient['removeChannel']>>;
type InsertCallback = (payload: { new: GroupChatMessage }) => void;
type TestChannel = {
  topic: string;
  on: jest.Mock;
  subscribe: jest.Mock;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createRealtimeClient() {
  const channels = new Map<string, Channel>();
  const callbacks = new Map<Channel, InsertCallback>();
  const removals = new Map<Channel, ReturnType<typeof deferred<RemovalResult>>>();
  const channel = jest.fn((topic: string): Channel => {
    // Supabase reuses a matching topic until removeChannel finishes. Subscribing
    // to that instance twice reproduces the reported rapid re-entry crash.
    const existing = channels.get(topic);
    if (existing) return existing;
    let subscribed = false;
    const created: TestChannel = {
      topic,
      on: jest.fn((_event, _filter, callback: InsertCallback) => {
        callbacks.set(created as unknown as Channel, callback);
        return created;
      }),
      subscribe: jest.fn(() => {
        if (subscribed) throw new Error('subscribe can only be called once per channel');
        subscribed = true;
        return created;
      }),
    };
    channels.set(topic, created as unknown as Channel);
    return created as unknown as Channel;
  });
  const removeChannel = jest.fn((capturedChannel: Channel) => {
    const pending = deferred<RemovalResult>();
    removals.set(capturedChannel, pending);
    return pending.promise.then((result) => {
      if (result === 'ok') channels.delete(capturedChannel.topic);
      return result;
    });
  });
  const client: RealtimeClient = { channel, removeChannel };
  return { client, channel, removeChannel, channels, callbacks, removals };
}

function message(id: string): GroupChatMessage {
  return { id } as GroupChatMessage;
}

describe('group chat realtime lifecycle', () => {
  it('subscribes to inserts for the exact room without putting its identity in the topic', () => {
    const realtime = createRealtimeClient();
    const onInsert = jest.fn();
    subscribeGroupChatMessages({
      client: realtime.client,
      roomId: 'test-room-one',
      onInsert,
      onCleanupFailure: jest.fn(),
    });

    const channel = realtime.channel.mock.results[0].value;
    expect(channel.topic).not.toContain('test-room-one');
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'group_chat_messages',
        filter: 'room_id=eq.test-room-one',
      },
      expect.any(Function),
    );
    realtime.callbacks.get(channel)!({ new: message('first') });
    expect(onInsert).toHaveBeenCalledWith(message('first'));
  });

  it('allows repeated effect setup while earlier same-room removals are still pending', async () => {
    const realtime = createRealtimeClient();
    const onInsert = jest.fn();
    const onCleanupFailure = jest.fn();
    const start = () => subscribeGroupChatMessages({
      client: realtime.client,
      roomId: 'same-test-room',
      onInsert,
      onCleanupFailure,
    });

    const firstCleanup = start();
    const firstChannel = realtime.channel.mock.results[0].value;
    firstCleanup();
    const secondCleanup = start();
    const secondChannel = realtime.channel.mock.results[1].value;
    secondCleanup();
    const thirdCleanup = start();
    const thirdChannel = realtime.channel.mock.results[2].value;

    expect(new Set(realtime.channel.mock.calls.map(([topic]) => topic)).size).toBe(3);
    expect(realtime.channels.size).toBe(3);
    expect(realtime.removeChannel.mock.calls).toEqual([[firstChannel], [secondChannel]]);
    realtime.callbacks.get(firstChannel)!({ new: message('stale-first') });
    realtime.callbacks.get(secondChannel)!({ new: message('stale-second') });
    realtime.callbacks.get(thirdChannel)!({ new: message('current') });
    expect(onInsert.mock.calls).toEqual([[message('current')]]);

    // Completing an earlier cleanup must not remove the current subscription.
    realtime.removals.get(secondChannel)!.resolve('ok');
    realtime.removals.get(firstChannel)!.resolve('ok');
    await Promise.all(realtime.removeChannel.mock.results.map(({ value }) => value));
    expect([...realtime.channels.values()]).toEqual([thirdChannel]);
    expect(onCleanupFailure).not.toHaveBeenCalled();
    thirdCleanup();
    realtime.removals.get(thirdChannel)!.resolve('ok');
    await realtime.removeChannel.mock.results[2].value;
  });

  it('keeps simultaneous screen subscriptions separate and cleanup idempotent', async () => {
    const realtime = createRealtimeClient();
    const firstInsert = jest.fn();
    const secondInsert = jest.fn();
    const firstCleanup = subscribeGroupChatMessages({
      client: realtime.client,
      roomId: 'same-test-room',
      onInsert: firstInsert,
      onCleanupFailure: jest.fn(),
    });
    subscribeGroupChatMessages({
      client: realtime.client,
      roomId: 'same-test-room',
      onInsert: secondInsert,
      onCleanupFailure: jest.fn(),
    });
    const firstChannel = realtime.channel.mock.results[0].value;
    const secondChannel = realtime.channel.mock.results[1].value;
    firstCleanup();
    firstCleanup();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    realtime.callbacks.get(firstChannel)!({ new: message('stale') });
    realtime.callbacks.get(secondChannel)!({ new: message('active') });
    expect(firstInsert).not.toHaveBeenCalled();
    expect(secondInsert).toHaveBeenCalledWith(message('active'));
    realtime.removals.get(firstChannel)!.resolve('ok');
    await realtime.removeChannel.mock.results[0].value;
  });

  it('handles a rejected removal while the stale callback stays disabled', async () => {
    const realtime = createRealtimeClient();
    const onInsert = jest.fn();
    const onCleanupFailure = jest.fn();
    const cleanup = subscribeGroupChatMessages({
      client: realtime.client,
      roomId: 'test-room',
      onInsert,
      onCleanupFailure,
    });
    const channel = realtime.channel.mock.results[0].value;
    cleanup();
    realtime.removals.get(channel)!.reject(new Error('transport interrupted'));
    await Promise.allSettled([realtime.removeChannel.mock.results[0].value]);
    realtime.callbacks.get(channel)!({ new: message('stale') });
    expect(onInsert).not.toHaveBeenCalled();
    expect(onCleanupFailure).toHaveBeenCalledTimes(1);
  });

  it.each<RemovalResult>(['error', 'timed out'])(
    'reports a resolved %s cleanup result without reactivating the listener',
    async (result) => {
      const realtime = createRealtimeClient();
      const onCleanupFailure = jest.fn();
      const onInsert = jest.fn();
      const cleanup = subscribeGroupChatMessages({
        client: realtime.client,
        roomId: 'test-room',
        onInsert,
        onCleanupFailure,
      });
      const channel = realtime.channel.mock.results[0].value;
      cleanup();
      realtime.removals.get(channel)!.resolve(result);
      await realtime.removeChannel.mock.results[0].value;
      realtime.callbacks.get(channel)!({ new: message('stale') });
      expect(onInsert).not.toHaveBeenCalled();
      expect(onCleanupFailure).toHaveBeenCalledTimes(1);
    },
  );

  it('contains synchronous cleanup errors too', () => {
    const realtime = createRealtimeClient();
    realtime.removeChannel.mockImplementation(() => {
      throw new Error('client unavailable');
    });
    const onCleanupFailure = jest.fn();
    const cleanup = subscribeGroupChatMessages({
      client: realtime.client,
      roomId: 'test-room',
      onInsert: jest.fn(),
      onCleanupFailure,
    });
    expect(cleanup).not.toThrow();
    expect(onCleanupFailure).toHaveBeenCalledTimes(1);
  });
});
