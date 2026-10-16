type Handler = () => void;
type StatusHandler = (state: string) => void;

const channels: { topic: string; handlers: Handler[]; status?: StatusHandler; removed: boolean }[] = [];

jest.mock('../supabase', () => ({
  supabase: {
    getChannels: () => channels.filter((channel) => !channel.removed),
    channel: (topic: string) => {
      const record = { topic: `realtime:${topic}`, handlers: [] as Handler[], status: undefined as StatusHandler | undefined, removed: false };
      channels.push(record);
      const api = {
        topic: record.topic,
        on: (_type: string, _filter: unknown, handler: Handler) => {
          record.handlers.push(handler);
          return api;
        },
        subscribe: (status: StatusHandler) => {
          record.status = status;
          return api;
        },
      };
      return api;
    },
    removeChannel: async (channel: { topic: string }) => {
      const record = channels.find((item) => item.topic === channel.topic && !item.removed);
      if (record) record.removed = true;
      return 'ok';
    },
  },
}));

import { subscribeDirectMessageSignal } from '../direct-message-realtime';

const TOPIC = `dm-${'a'.repeat(64)}`;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('1:1 changed signal subscription', () => {
  beforeEach(() => {
    channels.length = 0;
  });

  it('shares one channel per topic and tells every screen', async () => {
    const first = { changed: jest.fn(), status: jest.fn() };
    const second = { changed: jest.fn(), status: jest.fn() };
    const offFirst = subscribeDirectMessageSignal(TOPIC, first.changed, first.status);
    const offSecond = subscribeDirectMessageSignal(TOPIC, second.changed, second.status);
    await flush();
    expect(channels).toHaveLength(1);

    channels[0].status?.('SUBSCRIBED');
    expect(first.status).toHaveBeenCalledWith('live');
    expect(second.status).toHaveBeenCalledWith('live');
    channels[0].handlers.forEach((handler) => handler());
    expect(first.changed).toHaveBeenCalledTimes(1);
    expect(second.changed).toHaveBeenCalledTimes(1);

    offFirst();
    expect(channels[0].removed).toBe(false);
    offSecond();
    await flush();
    expect(channels[0].removed).toBe(true);
  });

  it('opens a fresh channel after the old one is fully removed', async () => {
    const off = subscribeDirectMessageSignal(TOPIC, jest.fn(), jest.fn());
    await flush();
    off();
    const offAgain = subscribeDirectMessageSignal(TOPIC, jest.fn(), jest.fn());
    await flush();
    await flush();
    expect(channels).toHaveLength(2);
    expect(channels[0].removed).toBe(true);
    expect(channels[1].removed).toBe(false);
    offAgain();
  });

  it('ignores names that are not signal channels', async () => {
    const off = subscribeDirectMessageSignal('messages', jest.fn(), jest.fn());
    await flush();
    expect(channels).toHaveLength(0);
    off();
  });
});
