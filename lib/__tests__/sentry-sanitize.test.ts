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
    error.name = 'Bearer error-name-secret';
    error.stack = 'Error: failed for 9901011234567\n    at upload(customer-id-card.pdf)';

    const sanitized = sanitizeSentryContext(error);

    expect(sanitized).toMatchObject({
      name: 'Bearer [REDACTED]',
      message: 'failed for 990101-1****** and 010-****-5678',
    });
    expect((sanitized as { stack: string }).stack).toContain('990101-1******');
    expect((sanitized as { stack: string }).stack).toContain('[REDACTED_FILE]');
  });

  test('redacts bearer credentials, international phones, push tokens, OTPs, raw bodies, and storage paths', () => {
    const bearerToken = 'eyJhbGciOiJIUzI1NiJ9.payloadpayload.signaturesignature';
    const pushToken = 'ExponentPushToken[device-secret-value]';
    const storagePath = 'https://project.supabase.co/storage/v1/object/sign/fc-documents/user-1/customer-id.pdf';
    const sanitized = sanitizeSentryContext({
      message: `Authorization: Bearer ${bearerToken}; phone +82 10-1234-5678; alternate +82 (0)10-2345-6789; 인증번호는 765432입니다; OTP: 654321; file customer contract.pdf; storage path: bucket/user/opaque-object-key; ${pushToken}; ${storagePath}`,
      otpCode: '654321',
      upstreamResponseBody: '{"phone":"010-9876-5432","otp":"654321"}',
      status: 502,
      reason: 'upstream_rejected',
    });
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain(bearerToken);
    expect(serialized).not.toContain('+82 10-1234-5678');
    expect(serialized).not.toContain('+82 (0)10-2345-6789');
    expect(serialized).not.toContain('765432');
    expect(serialized).not.toContain('654321');
    expect(serialized).not.toContain('customer contract.pdf');
    expect(serialized).not.toContain('bucket/user/opaque-object-key');
    expect(serialized).not.toContain(pushToken);
    expect(serialized).not.toContain(storagePath);
    expect(serialized).not.toContain('010-9876-5432');
    expect(sanitized).toMatchObject({
      otpCode: '[REDACTED_OTP]',
      upstreamResponseBody: '[REDACTED_BODY]',
      status: 502,
      reason: 'upstream_rejected',
    });
  });
});
