import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
const resetPasswordSource = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/functions/reset-password/index.ts',
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

function loadSmsBypassResolver(): SmsBypassResolver {
  const match = resetPasswordSource.match(
    /export function resolveSmsBypassConfig[\s\S]*?\n}\r?\n(?=\r?\nconst smsBypassConfig)/,
  );
  assert.ok(match, 'reset-password must expose its pure SMS bypass policy for regression coverage');

  const compiled = ts.transpileModule(match[0], {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const commonJsModule = { exports: {} as Record<string, unknown> };
  Function('module', 'exports', compiled)(commonJsModule, commonJsModule.exports);

  return commonJsModule.exports.resolveSmsBypassConfig as SmsBypassResolver;
}

describe('reset-password SMS bypass source contract', () => {
  it('wires the resolved policy into the real token comparison without a fixed fallback code', () => {
    assert.match(
      resetPasswordSource,
      /const smsBypassConfig = resolveSmsBypassConfig\(\{/,
    );
    assert.match(
      resetPasswordSource,
      /const bypassToken = smsBypassConfig\.enabled && token === smsBypassConfig\.code;/,
    );
    assert.doesNotMatch(
      resetPasswordSource,
      /SMS_BYPASS_CODE'\)\s*\?\?\s*getEnv\('TEST_SMS_CODE'\)\s*\?\?\s*['"]\d{6}['"]/,
    );
  });

  it('preserves the normal stored-token hash and expiry validation path', () => {
    assert.match(
      resetPasswordSource,
      /if \(!bypassToken\) \{[\s\S]*?if \(!resetTokenHash \|\| !resetTokenExpiresAt\)[\s\S]*?new Date\(resetTokenExpiresAt\)[\s\S]*?sha256Base64\(token\)[\s\S]*?tokenHash !== resetTokenHash/,
    );
  });

  it('defaults to disabled when the opt-in is unset or false', () => {
    const resolveConfig = loadSmsBypassResolver();

    assert.deepEqual(resolveConfig({}), { enabled: false, code: '' });
    assert.deepEqual(
      resolveConfig({
        SMS_BYPASS_ENABLED: 'false',
        SMS_BYPASS_CODE: '654321',
      }),
      { enabled: false, code: '' },
    );
  });

  it('fails closed when bypass is explicitly enabled in a production runtime', () => {
    const resolveConfig = loadSmsBypassResolver();

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

  it('preserves explicit non-production development opt-in with an env-provided code', () => {
    const resolveConfig = loadSmsBypassResolver();

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
  });
});
