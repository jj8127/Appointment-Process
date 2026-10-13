import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
const requestOtpSource = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/functions/request-signup-otp/index.ts',
      import.meta.url,
    ),
  ),
  'utf8',
);
const signupSmsSource = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/functions/_shared/signup-sms.ts',
      import.meta.url,
    ),
  ),
  'utf8',
);
const atomicIssueMigrationSource = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/migrations/20261013041530_atomic_fc_signup_otp_issue.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

type TestSmsConfig = {
  enabled: boolean;
  code: string;
};

type TestSmsResolver = (
  env: Record<string, string | undefined>,
) => TestSmsConfig;

function loadSignupTestSmsResolver(): TestSmsResolver {
  const match = requestOtpSource.match(
    /export function resolveSignupTestSmsConfig[\s\S]*?\n}\r?\n(?=\r?\nconst signupTestSmsConfig)/,
  );
  assert.ok(match, 'request-signup-otp must expose its pure test-SMS policy for regression coverage');

  const compiled = ts.transpileModule(match[0], {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const commonJsModule = { exports: {} as Record<string, unknown> };
  Function('module', 'exports', compiled)(commonJsModule, commonJsModule.exports);

  return commonJsModule.exports.resolveSignupTestSmsConfig as TestSmsResolver;
}

describe('request-signup-otp production test-mode boundary', () => {
  it('resolves fail-closed policy before client creation and the public handler without a fixed code', () => {
    const policyIndex = requestOtpSource.indexOf(
      'const signupTestSmsConfig = resolveSignupTestSmsConfig({',
    );
    const clientIndex = requestOtpSource.indexOf('const supabase = createClient(');
    const handlerIndex = requestOtpSource.indexOf('serve(async');

    assert.ok(policyIndex >= 0, 'test-SMS policy must be wired');
    assert.ok(clientIndex > policyIndex, 'test-SMS policy must resolve before service-role client creation');
    assert.ok(handlerIndex > policyIndex, 'test-SMS policy must resolve before the public handler starts');
    assert.doesNotMatch(
      requestOtpSource,
      /TEST_SMS_CODE'\)\s*\?\?\s*['"]\d{6}['"]/,
    );
  });

  it('defaults to disabled when TEST_SMS_MODE is unset or false', () => {
    const resolveConfig = loadSignupTestSmsResolver();

    assert.deepEqual(resolveConfig({}), { enabled: false, code: '' });
    assert.deepEqual(
      resolveConfig({
        TEST_SMS_MODE: 'false',
        TEST_SMS_CODE: '654321',
      }),
      { enabled: false, code: '' },
    );
  });

  it('fails closed for explicit test mode in hosted or production runtimes', () => {
    const resolveConfig = loadSignupTestSmsResolver();

    assert.throws(
      () => resolveConfig({
        TEST_SMS_MODE: ' TRUE ',
        TEST_SMS_CODE: '654321',
        NODE_ENV: ' PrOdUcTiOn ',
      }),
      /must not be enabled in production/,
    );
    assert.throws(
      () => resolveConfig({
        TEST_SMS_MODE: 'true',
        TEST_SMS_CODE: '654321',
        DENO_DEPLOYMENT_ID: 'hosted-edge-deployment',
      }),
      /must not be enabled in production/,
    );
  });

  it('allows only local explicit mode with an env-provided six-digit deterministic code', () => {
    const resolveConfig = loadSignupTestSmsResolver();

    assert.deepEqual(
      resolveConfig({
        TEST_SMS_MODE: 'true',
        TEST_SMS_CODE: '654321',
        NODE_ENV: 'development',
      }),
      { enabled: true, code: '654321' },
    );
    assert.throws(
      () => resolveConfig({
        TEST_SMS_MODE: 'true',
        NODE_ENV: 'development',
      }),
      /six-digit test SMS code is required/,
    );
    assert.throws(
      () => resolveConfig({
        TEST_SMS_MODE: 'true',
        TEST_SMS_CODE: '12345',
        NODE_ENV: 'development',
      }),
      /six-digit test SMS code is required/,
    );
  });

  it('preserves random normal OTP, throttle, expiry, hash-only persistence, and bounded provider delivery', () => {
    assert.match(
      requestOtpSource,
      /function generateOtpCode\(\)[\s\S]*?signupTestSmsConfig\.enabled[\s\S]*?crypto\.getRandomValues/,
    );
    assert.match(
      requestOtpSource,
      /sha256Base64\(`\$\{code\}:\$\{phone\}`\)[\s\S]*?issue_fc_signup_otp_v1[\s\S]*?p_code_hash: hash[\s\S]*?sendOtpSms\(phone, code\)/,
    );
    assert.match(
      atomicIssueMigrationSource,
      /pg_advisory_xact_lock\(hashtextextended\(normalized_phone, 8102026\)\)[\s\S]*?clock_timestamp\(\)[\s\S]*?phone_verification_locked_until[\s\S]*?interval '60 seconds'[\s\S]*?interval '5 minutes'/,
    );
    assert.match(
      requestOtpSource,
      /async function sendOtpSms[\s\S]*?sendSignupSms\(to, code,[\s\S]*?signupTestSmsConfig\.enabled/,
    );
    assert.match(signupSmsSource, /https:\/\/sens\.apigw\.ntruss\.com/);
    assert.match(signupSmsSource, /deliveryState:\s*'unknown'/);
    assert.doesNotMatch(requestOtpSource, /fetch\(`https:\/\/sens\.apigw\.ntruss\.com/);
    assert.doesNotMatch(
      requestOtpSource,
      /phone_verification_(?:code|plain|otp)\s*:/,
    );
    assert.doesNotMatch(
      requestOtpSource,
      /console\.(?:log|info|warn|error|debug)\([^)]*(?:phone|code|secret)/,
    );
  });

  it('creates and finalizes the privacy-safe delivery attempt around every FC SMS send', () => {
    const begin = requestOtpSource.indexOf("supabase.rpc('issue_fc_signup_otp_v1'");
    const send = requestOtpSource.indexOf('sendOtpSms(phone, code)', begin);
    const finalize = requestOtpSource.indexOf(
      'finalizeFcSignupDeliveryAttempt(supabase, phone, deliveryId, smsResult)',
      send,
    );
    const success = requestOtpSource.lastIndexOf('return json({ ok: true, sent: true });');

    assert.ok(begin >= 0, 'FC signup must atomically reserve its challenge and delivery attempt');
    assert.ok(send > begin, 'SMS must not be sent before tracking starts');
    assert.ok(finalize > send, 'provider acceptance must be finalized after the send');
    assert.ok(success > finalize, 'success must require durable provider result tracking');
    assert.doesNotMatch(requestOtpSource, /beginSmsDeliveryAttempt\(supabase, 'fc_signup'\)/);
    assert.doesNotMatch(requestOtpSource, /\.from\('fc_profiles'\)\.update/);
    assert.match(atomicIssueMigrationSource, /insert into public\.platform_sms_delivery_attempts\(purpose\)[\s\S]*?values\('fc_signup'\)/);
    assert.match(atomicIssueMigrationSource, /phone_verification_delivery_id is distinct from p_delivery_id/);
    assert.doesNotMatch(requestOtpSource, /providerRequestId\s*[:=][^\n]*(?:phone|code)/i);
  });
});
