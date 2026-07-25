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

  it('preserves random normal OTP, throttle, expiry, hash-only persistence, and provider delivery', () => {
    assert.match(
      requestOtpSource,
      /function generateOtpCode\(\)[\s\S]*?signupTestSmsConfig\.enabled[\s\S]*?crypto\.getRandomValues/,
    );
    assert.match(
      requestOtpSource,
      /phone_verification_locked_until[\s\S]*?OTP_COOLDOWN_SECONDS[\s\S]*?sha256Base64\(`\$\{code\}:\$\{phone\}`\)[\s\S]*?OTP_TTL_MINUTES[\s\S]*?phone_verification_hash: hash[\s\S]*?sendOtpSms\(phone, code\)/,
    );
    assert.match(
      requestOtpSource,
      /async function sendOtpSms[\s\S]*?signupTestSmsConfig\.enabled[\s\S]*?fetch\(`https:\/\/sens\.apigw\.ntruss\.com/,
    );
    assert.doesNotMatch(
      requestOtpSource,
      /phone_verification_(?:code|plain|otp)\s*:/,
    );
    assert.doesNotMatch(
      requestOtpSource,
      /console\.(?:log|info|warn|error|debug)\([^)]*(?:phone|code|secret)/,
    );
  });
});
