import { Redirect, useLocalSearchParams } from 'expo-router';

import { resolvePlatformAuthRoute } from '@/lib/session-landing';

export default function ServiceApplication() {
  const { service } = useLocalSearchParams<{ service?: string }>();
  return <Redirect href={resolvePlatformAuthRoute(service)} />;
}
