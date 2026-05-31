import assert from 'node:assert/strict';
import test from 'node:test';

import { parseResidentNumberEdgeFallbackResponse } from './resident-number-edge-response.ts';

test('accepts ok response with object residentNumbers', () => {
  assert.deepStrictEqual(
    parseResidentNumberEdgeFallbackResponse({
      responseOk: true,
      data: {
        ok: true,
        residentNumbers: {
          'fc-1': '900101-1234567',
          'fc-2': null,
        },
      },
    }),
    {
      ok: true,
      residentNumbers: {
        'fc-1': '900101-1234567',
        'fc-2': null,
      },
    },
  );
});

test('rejects malformed success bodies even when HTTP response is ok', () => {
  for (const data of [
    null,
    { ok: true },
    { ok: false, residentNumbers: {} },
    { ok: true, residentNumbers: [] },
    { ok: true, residentNumbers: null },
  ]) {
    assert.deepStrictEqual(
      parseResidentNumberEdgeFallbackResponse({ responseOk: true, data }),
      { ok: false, message: 'Edge Function failed' },
    );
  }
});

test('rejects non-ok HTTP responses even when body looks successful', () => {
  assert.deepStrictEqual(
    parseResidentNumberEdgeFallbackResponse({
      responseOk: false,
      data: { ok: true, residentNumbers: { 'fc-1': '900101-1234567' } },
    }),
    { ok: false, message: 'Edge Function failed' },
  );
});

test('uses message before error before default failure message', () => {
  assert.deepStrictEqual(
    parseResidentNumberEdgeFallbackResponse({
      responseOk: false,
      data: { message: 'custom message', error: 'custom error' },
    }),
    { ok: false, message: 'custom message' },
  );

  assert.deepStrictEqual(
    parseResidentNumberEdgeFallbackResponse({
      responseOk: false,
      data: { error: 'custom error' },
    }),
    { ok: false, message: 'custom error' },
  );

  assert.deepStrictEqual(
    parseResidentNumberEdgeFallbackResponse({
      responseOk: false,
      data: 'plain text error',
    }),
    { ok: false, message: 'Edge Function failed' },
  );
});
