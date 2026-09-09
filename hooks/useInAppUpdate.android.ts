import Constants from 'expo-constants';
import { useEffect } from 'react';

import { logger } from '@/lib/logger';
import { createInAppUpdateRequest } from './in-app-update-lifecycle';

const requestUpdate = createInAppUpdateRequest(async () => {
  const { default: SpInAppUpdates, IAUUpdateKind } = await import('sp-react-native-in-app-updates');
  const inAppUpdates = new SpInAppUpdates(false);
  const result = await inAppUpdates.checkNeedsUpdate();
  if (!result.shouldUpdate) return null;
  return () => inAppUpdates.startUpdate({ updateType: IAUUpdateKind.FLEXIBLE });
}, () => logger.debug('[InAppUpdate] Android check unavailable'));

export const useInAppUpdate = (enabled = true) => {
  useEffect(() => {
    if (!enabled || Constants.executionEnvironment === 'storeClient') return;
    return requestUpdate();
  }, [enabled]);
};
