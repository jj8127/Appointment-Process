import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { isHttpUrl, normalizeExternalUrl } from '@/lib/external-url';

export async function openExternalUrl(rawUrl: string) {
  const normalized = normalizeExternalUrl(rawUrl);
  if (!normalized) {
    throw new Error('EMPTY_URL');
  }

  if (isHttpUrl(normalized)) {
    await WebBrowser.openBrowserAsync(normalized);
    return normalized;
  }

  const supported = await Linking.canOpenURL(normalized);
  if (!supported) {
    throw new Error(`UNSUPPORTED_URL:${normalized}`);
  }

  await Linking.openURL(normalized);
  return normalized;
}
