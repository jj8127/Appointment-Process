import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import {
  formatExternalUrlDisplayText,
  isHttpUrl,
  normalizeExternalUrl,
  stripTrailingUrlPunctuation,
} from '@/lib/external-url';
import { openExternalUrl } from '@/lib/open-external-url';

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
  WebBrowserResultType: {
    OPENED: 'opened',
  },
}));

jest.mock('react-native', () => ({
  Linking: {
    canOpenURL: jest.fn(),
    openURL: jest.fn(),
  },
}));

const mockedOpenBrowserAsync = WebBrowser.openBrowserAsync as jest.MockedFunction<typeof WebBrowser.openBrowserAsync>;
const mockedCanOpenURL = Linking.canOpenURL as jest.MockedFunction<typeof Linking.canOpenURL>;
const mockedOpenURL = Linking.openURL as jest.MockedFunction<typeof Linking.openURL>;

describe('external url helpers', () => {
  it('preserves http and https urls', () => {
    expect(normalizeExternalUrl('https://www.youtube.com/watch?v=abc')).toBe('https://www.youtube.com/watch?v=abc');
    expect(normalizeExternalUrl('http://example.com/file.pdf')).toBe('http://example.com/file.pdf');
  });

  it('adds https to bare web addresses', () => {
    expect(normalizeExternalUrl('www.youtube.com/playlist?list=123')).toBe('https://www.youtube.com/playlist?list=123');
    expect(normalizeExternalUrl('example.com')).toBe('https://example.com');
  });

  it('removes trailing sentence punctuation from copied urls', () => {
    expect(stripTrailingUrlPunctuation('https://example.com/a).')).toBe('https://example.com/a');
    expect(normalizeExternalUrl('www.example.com/a,')).toBe('https://www.example.com/a');
  });

  it('preserves existing non-http schemes', () => {
    expect(normalizeExternalUrl('file:///storage/emulated/0/test.pdf')).toBe('file:///storage/emulated/0/test.pdf');
    expect(normalizeExternalUrl('content://media/external/file/1')).toBe('content://media/external/file/1');
    expect(normalizeExternalUrl('tel:01012341234')).toBe('tel:01012341234');
  });

  it('detects only web urls as in-app browser targets', () => {
    expect(isHttpUrl('https://www.youtube.com/playlist?list=123')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('file:///storage/emulated/0/test.pdf')).toBe(false);
    expect(isHttpUrl('tel:01012341234')).toBe(false);
  });

  it('formats long urls into short visible labels', () => {
    expect(formatExternalUrlDisplayText('https://www.example.com/very/long/path/to/article?utm_source=test', 28)).toBe(
      'example.com/very/long/pat...',
    );
  });
});

describe('openExternalUrl', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('opens an HTTPS meeting link without relying on the Android capability preflight', async () => {
    const url = 'https://us06web.zoom.us/j/00000000000?pwd=test-token';
    mockedCanOpenURL.mockResolvedValue(false);
    mockedOpenURL.mockResolvedValue(undefined);

    await expect(
      openExternalUrl(url, { preferExternalBrowser: true }),
    ).resolves.toBe(url);

    expect(mockedCanOpenURL).not.toHaveBeenCalled();
    expect(mockedOpenBrowserAsync).not.toHaveBeenCalled();
    expect(mockedOpenURL).toHaveBeenCalledWith(url);
  });

  it('falls back to the in-app browser when an external web-link launch fails', async () => {
    mockedOpenURL.mockRejectedValue(new Error('NO_EXTERNAL_HANDLER'));
    mockedOpenBrowserAsync.mockResolvedValue({ type: WebBrowser.WebBrowserResultType.OPENED });

    await expect(
      openExternalUrl('https://example.com/message', { preferExternalBrowser: true }),
    ).resolves.toBe('https://example.com/message');

    expect(mockedOpenURL).toHaveBeenCalledWith('https://example.com/message');
    expect(mockedOpenBrowserAsync).toHaveBeenCalledWith('https://example.com/message');
  });
});
