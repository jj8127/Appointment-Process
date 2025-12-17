import { useEffect } from 'react';
import { Platform } from 'react-native';
import SpInAppUpdates, { IAUUpdateKind } from 'sp-react-native-in-app-updates';

export const useInAppUpdate = () => {
    useEffect(() => {
        if (Platform.OS !== 'android') return;

        const checkForUpdate = async () => {
            try {
                const inAppUpdates = new SpInAppUpdates(
                    false // isDebug: false in production
                );

                const result = await inAppUpdates.checkNeedsUpdate();

                if (result.shouldUpdate) {
                    // Flexible Update: Downloads in background, then prompts to restart
                    // Immediate Update: Blocks usage until updated
                    await inAppUpdates.startUpdate({
                        updateType: IAUUpdateKind.FLEXIBLE,
                    });
                }
            } catch (error) {
                // In development or if app is not in Play Store, this might fail.
                // We catch it silently to avoid crashing the app.
                console.log('[InAppUpdate] Check failed (This is expected in Dev/Simulator):', error);
            }
        };

        checkForUpdate();
    }, []);
};
