import Constants from 'expo-constants';
import { useEffect } from 'react';

import { logger } from '@/lib/logger';

export const useInAppUpdate = () => {
  useEffect(() => {
    if (Constants.executionEnvironment === 'storeClient') return;

    const checkForUpdate = async () => {
      try {
        const { default: SpInAppUpdates } = await import('sp-react-native-in-app-updates');
        const inAppUpdates = new SpInAppUpdates(false);
        const result = await inAppUpdates.checkNeedsUpdate({ country: 'kr' });

        if (result.shouldUpdate) {
          await inAppUpdates.startUpdate({
            title: '업데이트 안내',
            message: '가람in의 새 버전이 App Store에 있습니다. 업데이트하시겠습니까?',
            buttonUpgradeText: '업데이트',
            buttonCancelText: '나중에',
            country: 'kr',
          });
        }
      } catch (error) {
        logger.debug('[InAppUpdate] iOS check failed (This is expected in Dev/Simulator)', error);
      }
    };

    checkForUpdate();
  }, []);
};
