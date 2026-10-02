import type { SupabaseClient } from '@supabase/supabase-js';

type ExamRealtimeClient = Pick<SupabaseClient, 'channel' | 'removeChannel'>;
type ExamType = 'life' | 'nonlife';

let topicSequence = 0;

/** Each effect owns a channel, even while another screen instance is active. */
export function subscribeToExamRegistrationChanges(
  client: ExamRealtimeClient,
  examType: ExamType,
  onChange: () => unknown,
): () => void {
  topicSequence += 1;
  // Same non-identifying instance-topic policy as home-realtime-channel.ts.
  // Realtime reuses matching topics and disallows adding postgres callbacks
  // after subscribe, so a stable route topic cannot be shared across effects.
  const topic = `exam-manage-${examType}-registrations-${Date.now().toString(36)}-${topicSequence.toString(36)}`;
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
