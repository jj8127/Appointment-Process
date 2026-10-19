import { createRealtimeChannelTopic } from './realtime-channel-topic';

export type HomeRealtimeChannelScope =
  | 'home-messages'
  | 'home-profile'
  | 'home-documents';

/** Home subscriptions use the shared per-instance topic policy. */
export function createHomeRealtimeChannelTopic(scope: HomeRealtimeChannelScope): string {
  return createRealtimeChannelTopic(scope);
}
