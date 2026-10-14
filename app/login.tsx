import { Redirect, useLocalSearchParams } from 'expo-router';

import { resolveLegacyAuthRoute } from '@/lib/session-landing';

export default function LegacyLoginRedirect() {
  const params = useLocalSearchParams<{ service?: string; skipAuto?: string }>();
  return <Redirect href={resolveLegacyAuthRoute(params, 'login')} />;
}
