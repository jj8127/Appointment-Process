import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { isHttpUrl, normalizeExternalUrl } from '@/lib/external-url';

type OpenExternalUrlOptions = {
  preferExternalBrowser?: boolean;
};

async function openWithLinking(normalized: string) {
  const supported = await Linking.canOpenURL(normalized);
  if (!supported) {
    throw new Error(`UNSUPPORTED_URL:${normalized}`);
  }

  await Linking.openURL(normalized);
}

export async function openExternalUrl(rawUrl: string, options?: OpenExternalUrlOptions) {
  const normalized = normalizeExternalUrl(rawUrl);
  if (!normalized) {
    throw new Error('EMPTY_URL');
  }

  if (options?.preferExternalBrowser) {
    await openWithLinking(normalized);
    return normalized;
  }

  if (isHttpUrl(normalized)) {
    try {
      await WebBrowser.openBrowserAsync(normalized);
    } catch {
      await openWithLinking(normalized);
    }
    return normalized;
  }

  await openWithLinking(normalized);
  return normalized;
}
