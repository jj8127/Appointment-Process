import {
  formatExternalUrlDisplayText,
  isHttpUrl,
  normalizeExternalUrl,
  stripTrailingUrlPunctuation,
} from '@/lib/external-url';

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
