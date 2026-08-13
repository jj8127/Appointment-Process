export type HomeRealtimeChannelScope =
  | 'home-messages'
  | 'home-profile'
  | 'home-documents';

let channelTopicSequence = 0;

/**
 * Creates a non-identifying topic for one effect subscription instance.
 *
 * Realtime 2.109 reuses an existing channel when the topic matches. React
 * development effects can remount before async channel removal completes, so
 * a stable topic can return an already-subscribed channel and reject `.on()`.
 */
export function createHomeRealtimeChannelTopic(scope: HomeRealtimeChannelScope): string {
  channelTopicSequence += 1;
  return `${scope}-${Date.now().toString(36)}-${channelTopicSequence.toString(36)}`;
}
