import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

// The 1:1 "changed" signal arrives on a broadcast channel whose name the server
// fixes, so two screens on the same conversation would ask Supabase for the same
// topic. A topic already subscribed comes back as the existing channel and
// adding a listener to it throws, so every screen shares one channel per topic
// here and the channel closes when its last listener leaves.

export type DirectMessageSignalStatus = 'live' | 'down';

type Listener = {
  onChanged: () => void;
  onStatus: (status: DirectMessageSignalStatus) => void;
};

type Entry = {
  listeners: Set<Listener>;
  status: DirectMessageSignalStatus;
  channel: RealtimeChannel | null;
};

const entries = new Map<string, Entry>();
// Removal is asynchronous; a topic is not reopened until its old channel is gone.
const closing = new Map<string, Promise<unknown>>();

export const DIRECT_MESSAGE_SIGNAL_TOPIC = /^dm-[0-9a-f]{64}$/;

async function openChannel(topic: string, entry: Entry) {
  await closing.get(topic);
  if (entries.get(topic) !== entry || entry.listeners.size === 0) return;
  const stale = supabase.getChannels().find((channel) => channel.topic === `realtime:${topic}`);
  if (stale) await supabase.removeChannel(stale);
  if (entries.get(topic) !== entry || entry.listeners.size === 0) return;
  entry.channel = supabase
    .channel(topic, { config: { private: false } })
    .on('broadcast', { event: 'changed' }, () => {
      for (const listener of entry.listeners) listener.onChanged();
    })
    .subscribe((state) => {
      entry.status = state === 'SUBSCRIBED' ? 'live' : 'down';
      for (const listener of entry.listeners) listener.onStatus(entry.status);
    });
}

export function subscribeDirectMessageSignal(
  topic: string,
  onChanged: () => void,
  onStatus: (status: DirectMessageSignalStatus) => void,
): () => void {
  if (!DIRECT_MESSAGE_SIGNAL_TOPIC.test(topic)) return () => {};
  const listener: Listener = { onChanged, onStatus };
  let entry = entries.get(topic);
  if (!entry) {
    entry = { listeners: new Set(), status: 'down', channel: null };
    entries.set(topic, entry);
    entry.listeners.add(listener);
    void openChannel(topic, entry).catch(() => {
      // No signal: screens keep their timer refresh.
    });
  } else {
    entry.listeners.add(listener);
    if (entry.status === 'live') onStatus('live');
  }

  const current = entry;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    current.listeners.delete(listener);
    if (current.listeners.size > 0 || entries.get(topic) !== current) return;
    entries.delete(topic);
    if (current.channel) {
      const removal = supabase.removeChannel(current.channel).catch(() => undefined);
      closing.set(topic, removal);
      void removal.finally(() => {
        if (closing.get(topic) === removal) closing.delete(topic);
      });
    }
  };
}
