import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';

import { logger } from '@/lib/logger';
import { openExternalUrl } from '@/lib/open-external-url';
import { compareUpdateVersions, createInAppUpdateRequest } from './in-app-update-lifecycle';

const PROMPT_STORAGE_KEY = 'garamin:ios-update-prompt:v1';
const PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const requestUpdate = createInAppUpdateRequest(async () => {
  const { default: SpInAppUpdates } = await import('sp-react-native-in-app-updates');
  const { getBundleId, getVersion } = await import('react-native-device-info');
  const installedVersion = getVersion();
  const bundleId = getBundleId();
  const inAppUpdates = new SpInAppUpdates(false);
  const result = await inAppUpdates.checkNeedsUpdate({ country: 'kr', curVersion: installedVersion, bundleId });
  const storeVersion = result.storeVersion;
  const details = result.other;
  if (!result.shouldUpdate || typeof storeVersion !== 'string'
    || compareUpdateVersions(storeVersion, installedVersion) <= 0
    || !details || !('bundleId' in details) || details.bundleId !== bundleId
    || !Number.isSafeInteger(details.trackId) || details.trackId <= 0
    || (typeof details.minimumOsVersion === 'string'
      && compareUpdateVersions(details.minimumOsVersion, String(Platform.Version)) > 0)) return null;

  const target = `${installedVersion}:${storeVersion}`;
  const stored = await AsyncStorage.getItem(PROMPT_STORAGE_KEY);
  if (stored) {
    try {
      const previous: unknown = JSON.parse(stored);
      if (previous && typeof previous === 'object' && 'target' in previous && previous.target === target
        && 'shownAt' in previous && typeof previous.shownAt === 'number'
        && Date.now() - previous.shownAt >= 0 && Date.now() - previous.shownAt < PROMPT_COOLDOWN_MS) return null;
    } catch { /* A malformed non-sensitive cooldown record does not block the app. */ }
  }
  // Store before presentation so leaving for the store or restarting cannot repeat this prompt.
  await AsyncStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify({ target, shownAt: Date.now() }));
  const storeUrl = `https://apps.apple.com/kr/app/id${details.trackId}`;
  return async () => {
    Alert.alert('업데이트 안내',
      `App Store에 ${storeVersion} 버전이 등록되어 있습니다. 스토어에 ‘열기’만 표시되면 현재 버전으로 계속 이용해주세요.`,
      [
        { text: '나중에', style: 'cancel' },
        { text: '스토어 확인', onPress: () => {
          void openExternalUrl(storeUrl, { preferExternalBrowser: true })
            .catch(() => logger.debug('[InAppUpdate] App Store open unavailable'));
        } },
      ],
      { cancelable: true });
  };
}, () => logger.debug('[InAppUpdate] iOS check unavailable'));

export const useInAppUpdate = (enabled = true) => {
  useEffect(() => {
    if (!enabled || Constants.executionEnvironment === 'storeClient') return;
    return requestUpdate();
  }, [enabled]);
};
