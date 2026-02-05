import Constants from 'expo-constants';
import { useEffect } from 'react';

import { logger } from '@/lib/logger';

export const useInAppUpdate = () => {
    useEffect(() => {
        if (Constants.executionEnvironment === 'storeClient') return;

        const checkForUpdate = async () => {
            try {
                const { default: SpInAppUpdates, IAUUpdateKind } = await import('sp-react-native-in-app-updates');
                const inAppUpdates = new SpInAppUpdates(
                    false // isDebug: false in production
                );

                const result = await inAppUpdates.checkNeedsUpdate();

                if (result.shouldUpdate) {
                    // iOS: This will open the App Store
                    await inAppUpdates.startUpdate({
                        updateType: IAUUpdateKind.IMMEDIATE,
                    });
                }
            } catch (error) {
                // In development or if app is not in App Store, this might fail.
                logger.debug('[InAppUpdate] Check failed (This is expected in Dev/Simulator)', error);
            }
        };

        checkForUpdate();
    }, []);
};
