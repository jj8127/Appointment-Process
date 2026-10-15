let channelTopicSequence = 0;

/**
 * Creates a non-identifying topic for one effect subscription instance.
 *
 * Realtime 2.109 reuses an existing channel when the topic matches. A screen
 * that remounts before the async removal of its previous channel finishes (or
 * two instances of the same screen) would get the already-subscribed channel
 * back and `.on()` would throw. Every subscription therefore owns its topic.
 */
export function createRealtimeChannelTopic(scope: string): string {
  channelTopicSequence += 1;
  return `${scope}-${Date.now().toString(36)}-${channelTopicSequence.toString(36)}`;
}
