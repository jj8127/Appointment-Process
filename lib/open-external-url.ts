import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';

import { isHttpUrl, normalizeExternalUrl } from '@/lib/external-url';

type OpenExternalUrlOptions = {
  preferExternalBrowser?: boolean;
  sameWindowOnWeb?: boolean;
};

async function openWithLinking(normalized: string) {
  // Android package-visibility rules can make canOpenURL return false even when
  // ACTION_VIEW can open the link. openURL remains the source of truth and rejects
  // when no installed app can handle the URL.
  await Linking.openURL(normalized);
}

export async function openExternalUrl(rawUrl: string, options?: OpenExternalUrlOptions) {
  const normalized = normalizeExternalUrl(rawUrl);
  if (!normalized) {
    throw new Error('EMPTY_URL');
  }
  const openWithBrowser = async () => {
    if (Platform.OS === 'web' && options?.sameWindowOnWeb) {
      await WebBrowser.openBrowserAsync(normalized, { windowName: '_self' });
    } else {
      await WebBrowser.openBrowserAsync(normalized);
    }
  };

  if (options?.preferExternalBrowser) {
    try {
      await openWithLinking(normalized);
    } catch (error) {
      if (!isHttpUrl(normalized)) throw error;
      await openWithBrowser();
    }
    return normalized;
  }

  if (isHttpUrl(normalized)) {
    try {
      await openWithBrowser();
    } catch {
      await openWithLinking(normalized);
    }
    return normalized;
  }

  await openWithLinking(normalized);
  return normalized;
}
