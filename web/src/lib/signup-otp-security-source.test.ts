import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
const signupOtpSource = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/functions/verify-signup-otp/index.ts',
      import.meta.url,
    ),
  ),
  'utf8',
);

type SmsBypassConfig = {
  enabled: boolean;
  code: string;
};

type SmsBypassResolver = (
  env: Record<string, string | undefined>,
) => SmsBypassConfig;

function loadSignupSmsBypassResolver(): SmsBypassResolver {
  const match = signupOtpSource.match(
    /export function resolveSignupSmsBypassConfig[\s\S]*?\n}\r?\n(?=\r?\nconst signupSmsBypassConfig)/,
  );
  assert.ok(match, 'verify-signup-otp must expose its pure SMS bypass policy for regression coverage');

  const compiled = ts.transpileModule(match[0], {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const commonJsModule = { exports: {} as Record<string, unknown> };
  Function('module', 'exports', compiled)(commonJsModule, commonJsModule.exports);

  return commonJsModule.exports.resolveSignupSmsBypassConfig as SmsBypassResolver;
}

describe('verify-signup-otp SMS bypass security contract', () => {
  it('resolves policy before the public handler and routes bypass through the same transactional verifier', () => {
    assert.match(
      signupOtpSource,
      /const signupSmsBypassConfig = resolveSignupSmsBypassConfig\(\{[\s\S]*?\}\);\s*[\s\S]*?serve\(async/,
    );
    assert.match(
      signupOtpSource,
      /const isTestBypass = signupSmsBypassConfig\.enabled && code === signupSmsBypassConfig\.code;[\s\S]*?supabase\.rpc\('verify_fc_signup_otp_v1',[\s\S]*?p_test_bypass: isTestBypass/,
    );
    assert.doesNotMatch(signupOtpSource, /\.from\('fc_profiles'\)/);
    assert.doesNotMatch(signupOtpSource, /phone_verified:\s*true/);
    assert.doesNotMatch(
      signupOtpSource,
      /SMS_BYPASS_CODE'\)\s*\?\?\s*getEnv\('TEST_SMS_CODE'\)\s*\?\?\s*['"]\d{6}['"]/,
    );
  });

  it('defaults to disabled when the opt-in is unset or false', () => {
    const resolveConfig = loadSignupSmsBypassResolver();

    assert.deepEqual(resolveConfig({}), { enabled: false, code: '' });
    assert.deepEqual(
      resolveConfig({
        SMS_BYPASS_ENABLED: 'false',
        SMS_BYPASS_CODE: '654321',
      }),
      { enabled: false, code: '' },
    );
  });

  it('fails closed for explicit bypass in hosted or production runtimes', () => {
    const resolveConfig = loadSignupSmsBypassResolver();

    assert.throws(
      () => resolveConfig({
        SMS_BYPASS_ENABLED: ' TRUE ',
        SMS_BYPASS_CODE: '654321',
        NODE_ENV: ' PrOdUcTiOn ',
      }),
      /must not be enabled in production/,
    );
    assert.throws(
      () => resolveConfig({
        SMS_BYPASS_ENABLED: 'true',
        SMS_BYPASS_CODE: '654321',
        DENO_DEPLOYMENT_ID: 'hosted-edge-deployment',
      }),
      /must not be enabled in production/,
    );
  });

  it('allows only an explicit non-production opt-in with an env-provided six-digit code', () => {
    const resolveConfig = loadSignupSmsBypassResolver();

    assert.deepEqual(
      resolveConfig({
        SMS_BYPASS_ENABLED: 'true',
        SMS_BYPASS_CODE: '654321',
        NODE_ENV: 'development',
      }),
      { enabled: true, code: '654321' },
    );
    assert.throws(
      () => resolveConfig({
        SMS_BYPASS_ENABLED: 'true',
        NODE_ENV: 'development',
      }),
      /six-digit SMS bypass code is required/,
    );
    assert.throws(
      () => resolveConfig({
        SMS_BYPASS_ENABLED: 'true',
        SMS_BYPASS_CODE: '12345',
        NODE_ENV: 'development',
      }),
      /six-digit SMS bypass code is required/,
    );
  });

  it('passes only hashes to the verifier and returns a fresh opaque completion capability without sensitive logs', () => {
    assert.match(
      signupOtpSource,
      /crypto\.getRandomValues\(new Uint8Array\(32\)\)[\s\S]*?sha256Base64\(`\$\{code\}:\$\{phone\}`\)[\s\S]*?sha256Hex\(`fc-signup-completion-v1:\$\{phone\}:\$\{completionToken\}`\)[\s\S]*?p_completion_token_hash: completionTokenHash[\s\S]*?return json\(\{ ok: true, completionToken \}\)/,
    );
    assert.doesNotMatch(signupOtpSource, /console\.(?:log|info|warn|error|debug)/);
  });
});
