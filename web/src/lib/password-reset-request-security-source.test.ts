import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
const requestResetSource = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/functions/request-password-reset/index.ts',
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

function loadPasswordResetTestSmsResolver(): TestSmsResolver {
  const match = requestResetSource.match(
    /export function resolvePasswordResetTestSmsConfig[\s\S]*?\n}\r?\n(?=\r?\nconst passwordResetTestSmsConfig)/,
  );
  assert.ok(match, 'request-password-reset must expose its pure test-SMS policy for regression coverage');

  const compiled = ts.transpileModule(match[0], {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const commonJsModule = { exports: {} as Record<string, unknown> };
  Function('module', 'exports', compiled)(commonJsModule, commonJsModule.exports);

  return commonJsModule.exports.resolvePasswordResetTestSmsConfig as TestSmsResolver;
}

describe('request-password-reset production test-mode boundary', () => {
  it('resolves fail-closed policy before client creation and the public handler without a fixed code', () => {
    const policyIndex = requestResetSource.indexOf(
      'const passwordResetTestSmsConfig = resolvePasswordResetTestSmsConfig({',
    );
    const clientIndex = requestResetSource.indexOf('const supabase = createClient(');
    const handlerIndex = requestResetSource.indexOf('serve(async');

    assert.ok(policyIndex >= 0, 'test-SMS policy must be wired');
    assert.ok(clientIndex > policyIndex, 'test-SMS policy must resolve before service-role client creation');
    assert.ok(handlerIndex > policyIndex, 'test-SMS policy must resolve before the public handler starts');
    assert.doesNotMatch(
      requestResetSource,
      /TEST_SMS_CODE'\)\s*\?\?\s*['"]\d{6}['"]/,
    );
  });

  it('defaults to disabled when TEST_SMS_MODE is unset or false', () => {
    const resolveConfig = loadPasswordResetTestSmsResolver();

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
    const resolveConfig = loadPasswordResetTestSmsResolver();

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
    const resolveConfig = loadPasswordResetTestSmsResolver();

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

  it('preserves lookup, cooldown, expiry, random code, hash-only persistence, and provider delivery', () => {
    assert.match(
      requestResetSource,
      /findPasswordResetAccount\(supabase, phone\)[\s\S]*?account\.resetSentAt[\s\S]*?RESET_COOLDOWN_SECONDS/,
    );
    assert.match(
      requestResetSource,
      /function generateResetCode\(\)[\s\S]*?passwordResetTestSmsConfig\.enabled[\s\S]*?crypto\.getRandomValues/,
    );
    assert.match(
      requestResetSource,
      /sha256Base64\(code\)[\s\S]*?15 \* 60 \* 1000[\s\S]*?reset_token_hash: tokenHash[\s\S]*?sendResetSms\(phone, code\)/,
    );
    assert.match(
      requestResetSource,
      /async function sendResetSms[\s\S]*?passwordResetTestSmsConfig\.enabled[\s\S]*?fetch\(`https:\/\/sens\.apigw\.ntruss\.com/,
    );
    assert.doesNotMatch(
      requestResetSource,
      /reset_token_(?:code|plain|otp)\s*:/,
    );
    assert.doesNotMatch(
      requestResetSource,
      /console\.(?:log|info|warn|error|debug)\([^)]*(?:phone|code|secret)/,
    );
  });
});
