import assert from 'node:assert/strict';
import test from 'node:test';

import { redactSensitiveText, containsSensitiveText } from './sensitive-text.ts';

test('redactSensitiveText removes env-style secret values while preserving labels', () => {
  const input = 'author SENTRY_READ_AUTH_TOKEN=abc123def456';

  assert.equal(redactSensitiveText(input), 'author SENTRY_READ_AUTH_TOKEN=[redacted]');
});

test('redactSensitiveText leaves ordinary notification text unchanged', () => {
  assert.equal(redactSensitiveText('보험소식 브리핑 2026.06.23'), '보험소식 브리핑 2026.06.23');
});

test('containsSensitiveText detects env-style secret assignments', () => {
  assert.equal(containsSensitiveText('BOARD_AUTOMATION_ACTOR_NAME=normal'), false);
  assert.equal(containsSensitiveText('SUPABASE_SERVICE_ROLE_KEY=secret-value'), true);
});
