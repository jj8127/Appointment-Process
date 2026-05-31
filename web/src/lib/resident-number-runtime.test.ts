import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveResidentNumberDirectDecryptMode } from './resident-number-runtime.ts';

test('maps empty, auto, and enabled direct-decrypt modes to auto', () => {
  for (const value of [undefined, null, '', ' auto ', 'ENABLED']) {
    assert.deepStrictEqual(resolveResidentNumberDirectDecryptMode(value), {
      directMode: 'auto',
      invalidConfiguredValue: null,
    });
  }
});

test('maps disabled aliases to disabled mode', () => {
  for (const value of ['disabled', ' off ', 'OFF']) {
    assert.deepStrictEqual(resolveResidentNumberDirectDecryptMode(value), {
      directMode: 'disabled',
      invalidConfiguredValue: null,
    });
  }
});

test('maps report aliases to report-only mode', () => {
  for (const value of ['report', ' report-only ', 'REPORT-ONLY']) {
    assert.deepStrictEqual(resolveResidentNumberDirectDecryptMode(value), {
      directMode: 'report-only',
      invalidConfiguredValue: null,
    });
  }
});

test('defaults invalid mode to auto while preserving invalid configured value metadata', () => {
  assert.deepStrictEqual(resolveResidentNumberDirectDecryptMode('edge-only'), {
    directMode: 'auto',
    invalidConfiguredValue: 'edge-only',
  });
});
