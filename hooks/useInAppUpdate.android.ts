import Constants from 'expo-constants';
import { useEffect } from 'react';

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
