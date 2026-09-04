import type { SupabaseClient } from '@supabase/supabase-js';

import type { GroupChatMessage } from './group-chat-api';

type GroupChatRealtimeClient = Pick<SupabaseClient, 'channel' | 'removeChannel'>;

// The sequence separates effect restarts as well as concurrent screen instances.
// The runtime prefix also avoids reusing a topic after a development module reload.
const runtimePrefix = Math.random().toString(36).slice(2);
let subscriptionSequence = 0;

export function subscribeGroupChatMessages({
  client,
  roomId,
  onInsert,
  onCleanupFailure,
}: {
  client: GroupChatRealtimeClient;
  roomId: string;
  onInsert: (message: GroupChatMessage) => void;
  onCleanupFailure: () => void;
}): () => void {
  let active = true;
  const topic = `group-chat-messages-${runtimePrefix}-${++subscriptionSequence}`;
  const channel = client
    .channel(topic)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'group_chat_messages',
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        if (!active) return;
        onInsert(payload.new as GroupChatMessage);
      },
    )
    .subscribe();

  return () => {
    if (!active) return;
    // React cannot await cleanup. Stop callbacks before asynchronous removal so
    // the previous screen cannot update messages or mark them read after exit.
    active = false;
    void (async () => {
      try {
        const result = await client.removeChannel(channel);
        if (result !== 'ok') onCleanupFailure();
      } catch {
        onCleanupFailure();
      }
    })();
  };
}
