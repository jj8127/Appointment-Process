import {
  sanitizeSentryContext,
  sanitizeSentryEvent,
} from '../sentry-sanitize';

describe('Sentry privacy sanitizer', () => {
  test('masks resident numbers and phone numbers in nested event data', () => {
    const sanitized = sanitizeSentryEvent({
      message: 'submit failed for 990101-1234567 / 010-1234-5678',
      extra: {
        customerName: '홍길동',
        nested: {
          policyholder_ssn: '8801012234567',
          phone: '01012345678',
        },
      },
    });

    expect(sanitized.message).toBe('submit failed for 990101-1****** / 010-****-5678');
    expect(sanitized.extra.customerName).toBe('[REDACTED_NAME]');
    expect(sanitized.extra.nested.policyholder_ssn).toBe('880101-2******');
    expect(sanitized.extra.nested.phone).toBe('010-****-5678');
  });

  test('redacts authorization, jwt, supabase keys, and file names', () => {
    const sanitized = sanitizeSentryEvent({
      request: {
        headers: {
          Authorization: 'Bearer abc.def.ghi',
          apikey: 'sb_secret_live_value',
        },
      },
      extra: {
        jwt: 'eyJhbGciOiJIUzI1NiJ9.abc.def',
        fileName: 'customer-id-card.png',
      },
    });

    expect(sanitized.request.headers.Authorization).toBe('[REDACTED]');
    expect(sanitized.request.headers.apikey).toBe('[REDACTED]');
    expect(sanitized.extra.jwt).toBe('[REDACTED]');
    expect(sanitized.extra.fileName).toBe('[REDACTED_FILE]');
  });

  test('sanitizes Error instances without losing stack shape', () => {
    const error = new Error('failed for 9901011234567 and 01012345678');
    error.stack = 'Error: failed for 9901011234567\n    at upload(customer-id-card.pdf)';

    const sanitized = sanitizeSentryContext(error);

    expect(sanitized).toMatchObject({
      name: 'Error',
      message: 'failed for 990101-1****** and 010-****-5678',
    });
    expect((sanitized as { stack: string }).stack).toContain('990101-1******');
    expect((sanitized as { stack: string }).stack).toContain('[REDACTED_FILE]');
  });
});
