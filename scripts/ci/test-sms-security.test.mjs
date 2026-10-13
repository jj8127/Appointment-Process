import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = resolve(repository, 'test-sms.js');
const source = readFileSync(scriptPath, 'utf8');

test('live SMS probe requires an acknowledged dedicated device and explicit target', () => {
  assert.match(source, /SMS_TEST_ACK/);
  assert.match(source, /dedicated-consenting-device/);
  assert.match(source, /SMS_TEST_PHONE/);
  assert.match(source, /Set the explicit Supabase URL and anonymous key/);
  assert.doesNotMatch(source, /ubeginyxaotcamuqpmud/);
});

test('live SMS probe separates send and verify without printing secrets', () => {
  assert.match(source, /\['request', 'verify'\]/);
  assert.match(source, /The script never prints the phone, OTP, key, raw provider response/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:phone|otp|anonKey|completionToken)/i);

  const markerPhone = '01098765432';
  const result = spawnSync(process.execPath, [scriptPath, 'request'], {
    cwd: repository,
    encoding: 'utf8',
    env: {
      ...process.env,
      SMS_TEST_ACK: 'dedicated-consenting-device',
      SMS_TEST_PHONE: markerPhone,
      SUPABASE_URL: '',
      EXPO_PUBLIC_SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: '',
    },
    windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(markerPhone));
});
