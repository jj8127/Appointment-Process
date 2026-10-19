#!/usr/bin/env node

/**
 * Privacy-safe NCP SMS receive probe.
 *
 * Required environment:
 *   SMS_TEST_ACK=dedicated-consenting-device
 *   SMS_TEST_PHONE=<dedicated test device number>
 *   SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL
 *   SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY
 *
 * Request a code:
 *   node test-sms.js request
 *
 * Verify the code in a separate shell step, without requesting another SMS:
 *   SMS_TEST_OTP=<received six digits> node test-sms.js verify
 *
 * The script never prints the phone, OTP, key, raw provider response, or
 * signup completion capability.
 */

require('dotenv').config();

const mode = process.argv[2];
const acknowledgement = process.env.SMS_TEST_ACK;
const phone = String(process.env.SMS_TEST_PHONE ?? '').replace(/[^0-9]/g, '');
const otp = String(process.env.SMS_TEST_OTP ?? '').trim();
const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const startedAt = new Date().toISOString();

function stop(message) {
  console.error(message);
  process.exit(1);
}

if (!['request', 'verify'].includes(mode)) {
  stop('Usage: node test-sms.js <request|verify>');
}
if (acknowledgement !== 'dedicated-consenting-device') {
  stop('Set SMS_TEST_ACK=dedicated-consenting-device after confirming the target is a consenting dedicated test device.');
}
if (!/^01[016789][0-9]{7,8}$/.test(phone)) {
  stop('SMS_TEST_PHONE must contain a valid Korean mobile number for the dedicated test device.');
}
if (!supabaseUrl || !anonKey) {
  stop('Set the explicit Supabase URL and anonymous key for the intended test environment.');
}
if (mode === 'verify' && !/^[0-9]{6}$/.test(otp)) {
  stop('SMS_TEST_OTP must contain the six digits received by the dedicated test device.');
}

let functionsBase;
try {
  const parsed = new URL(supabaseUrl);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('unsafe protocol');
  }
  functionsBase = new URL('/functions/v1/', parsed);
} catch {
  stop('The configured Supabase URL is invalid.');
}

function safeCode(value) {
  return typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value) ? value : null;
}

function releaseValue(value, fallback) {
  const normalized = String(value ?? '').trim();
  return /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/.test(normalized) ? normalized : fallback;
}

async function invoke(functionName, body) {
  const response = await fetch(new URL(functionName, functionsBase), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      'x-moduon-platform': 'unknown',
      'x-moduon-app-version': releaseValue(process.env.SMS_TEST_APP_VERSION, 'ops-probe'),
      'x-moduon-build-number': releaseValue(process.env.SMS_TEST_BUILD_NUMBER, 'manual'),
      'x-moduon-signup-protocol': 'signup-capability-v1',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Raw bodies are deliberately not printed.
  }
  return { response, data };
}

async function main() {
  if (mode === 'request') {
    const { response, data } = await invoke('request-signup-otp', { phone });
    const result = {
      phase: 'request',
      startedAt,
      httpStatus: response.status,
      acceptedByApplication: data?.ok === true,
      code: safeCode(data?.code),
    };
    console.log(JSON.stringify(result));
    if (!response.ok || data?.ok !== true) process.exitCode = 1;
    return;
  }

  const { response, data } = await invoke('verify-signup-otp', { phone, code: otp });
  const result = {
    phase: 'verify',
    startedAt,
    httpStatus: response.status,
    verified: data?.ok === true,
    completionCapabilityIssued: data?.ok === true
      && typeof data?.completionToken === 'string'
      && /^[A-Za-z0-9_-]{43}$/.test(data.completionToken),
    code: safeCode(data?.code),
  };
  console.log(JSON.stringify(result));
  if (!response.ok || !result.verified || !result.completionCapabilityIssued) process.exitCode = 1;
}

main().catch((error) => {
  const reason = error instanceof DOMException && error.name === 'TimeoutError'
    ? 'timeout'
    : 'request_failed';
  console.error(JSON.stringify({ phase: mode, startedAt, ok: false, reason }));
  process.exitCode = 1;
});
