import type { SupabaseClient } from '@supabase/supabase-js';

import { createRealtimeChannelTopic } from './realtime-channel-topic';

type ExamRealtimeClient = Pick<SupabaseClient, 'channel' | 'removeChannel'>;
type ExamType = 'life' | 'nonlife';

/** Each effect owns a channel, even while another screen instance is active. */
export function subscribeToExamRegistrationChanges(
  client: ExamRealtimeClient,
  examType: ExamType,
  onChange: () => unknown,
): () => void {
  const topic = createRealtimeChannelTopic(`exam-manage-${examType}-registrations`);
  let active = true;
  const channel = client.channel(topic)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_registrations' }, () => {
      if (active) void onChange();
    })
    .subscribe();

  return () => {
    if (!active) return;
    active = false;
    void client.removeChannel(channel);
  };
}
