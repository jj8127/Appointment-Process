import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeSentryContext } from './sentry-sanitize.ts';

test('web diagnostics redact sensitive values while preserving status and reason', () => {
  const bearerToken = 'eyJhbGciOiJIUzI1NiJ9.payloadpayload.signaturesignature';
  const pushToken = 'ExponentPushToken[device-secret-value]';
  const storagePath = 'fc-documents/user-1/customer-id.pdf';
  const sanitized = sanitizeSentryContext({
    message: `Bearer ${bearerToken} +82 10-1234-5678 +82 (0)10-2345-6789 인증번호는 765432입니다 file customer contract.pdf storage path: bucket/user/opaque-object-key ${pushToken} ${storagePath}`,
    otpCode: '654321',
    responseBody: '{"resident":"990101-1234567"}',
    status: 503,
    reason: 'provider_unavailable',
  }) as Record<string, unknown>;
  const serialized = JSON.stringify(sanitized);

  for (const sensitiveValue of [
    bearerToken,
    '+82 10-1234-5678',
    '+82 (0)10-2345-6789',
    '765432',
    '654321',
    'customer contract.pdf',
    'bucket/user/opaque-object-key',
    pushToken,
    storagePath,
    '990101-1234567',
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
  assert.equal(sanitized.otpCode, '[REDACTED_OTP]');
  assert.equal(sanitized.responseBody, '[REDACTED_BODY]');
  assert.equal(sanitized.status, 503);
  assert.equal(sanitized.reason, 'provider_unavailable');
});

test('web Error names are sanitized before logger and Sentry consumers receive them', () => {
  const error = new Error('provider unavailable');
  error.name = 'Bearer error-name-secret';

  const sanitized = sanitizeSentryContext(error) as { name: string; message: string; stack: string };
  assert.equal(sanitized.name, 'Bearer [REDACTED]');
  assert.equal(sanitized.message, 'provider unavailable');
  assert.equal(sanitized.stack.includes('error-name-secret'), false);
});
