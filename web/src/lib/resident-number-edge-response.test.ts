import assert from 'node:assert/strict';
import test from 'node:test';

import { parseResidentNumberEdgeFallbackResponse } from './resident-number-edge-response.ts';

test('accepts ok response with object residentNumbers', () => {
  assert.deepStrictEqual(
    parseResidentNumberEdgeFallbackResponse({
      responseOk: true,
      expectedFcIds: ['fc-1', 'fc-2'],
      data: {
        ok: true,
        residentNumbers: {
          'fc-1': '900101-1234567',
          'fc-2': null,
        },
        residentNumberStatuses: {
          'fc-1': 'ready',
          'fc-2': 'missing',
        },
      },
    }),
    {
      ok: true,
      residentNumbers: {
        'fc-1': '900101-1234567',
        'fc-2': null,
      },
      residentNumberStatuses: {
        'fc-1': 'ready',
        'fc-2': 'missing',
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
      parseResidentNumberEdgeFallbackResponse({ responseOk: true, data, expectedFcIds: ['fc-1'] }),
      { ok: false, message: 'Edge Function failed' },
    );
  }
});

test('rejects masked, partial, or otherwise invalid row values', () => {
  assert.deepStrictEqual(
    parseResidentNumberEdgeFallbackResponse({
      responseOk: true,
      expectedFcIds: ['fc-masked', 'fc-partial', 'fc-missing'],
      data: {
        ok: true,
        residentNumbers: {
          'fc-masked': 'masked-value',
          'fc-partial': 'partial-value',
          'fc-missing': null,
        },
        residentNumberStatuses: {
          'fc-masked': 'unavailable',
          'fc-partial': 'unavailable',
          'fc-missing': 'missing',
        },
      },
    }),
    { ok: false, message: 'Edge Function failed' },
  );
});

test('preserves explicit per-row decrypt failures from the edge function', () => {
  assert.deepStrictEqual(
    parseResidentNumberEdgeFallbackResponse({
      responseOk: true,
      expectedFcIds: ['fc-failed', 'fc-missing'],
      data: {
        ok: true,
        residentNumbers: {
          'fc-failed': null,
          'fc-missing': null,
        },
        residentNumberStatuses: {
          'fc-failed': 'unavailable',
          'fc-missing': 'missing',
        },
      },
    }),
    {
      ok: true,
      residentNumbers: {
        'fc-failed': null,
        'fc-missing': null,
      },
      residentNumberStatuses: {
        'fc-failed': 'unavailable',
        'fc-missing': 'missing',
      },
    },
  );
});

test('rejects non-ok HTTP responses even when body looks successful', () => {
  assert.deepStrictEqual(
    parseResidentNumberEdgeFallbackResponse({
      responseOk: false,
      expectedFcIds: ['fc-1'],
      data: { ok: true, residentNumbers: { 'fc-1': '900101-1234567' } },
    }),
    { ok: false, message: 'Edge Function failed' },
  );
});

test('uses message before error before default failure message', () => {
  assert.deepStrictEqual(
    parseResidentNumberEdgeFallbackResponse({
      responseOk: false,
      expectedFcIds: ['fc-1'],
      data: { message: 'custom message', error: 'custom error' },
    }),
    { ok: false, message: 'custom message' },
  );

  assert.deepStrictEqual(
    parseResidentNumberEdgeFallbackResponse({
      responseOk: false,
      expectedFcIds: ['fc-1'],
      data: { error: 'custom error' },
    }),
    { ok: false, message: 'custom error' },
  );

  assert.deepStrictEqual(
    parseResidentNumberEdgeFallbackResponse({
      responseOk: false,
      expectedFcIds: ['fc-1'],
      data: 'plain text error',
    }),
    { ok: false, message: 'Edge Function failed' },
  );
});

test('rejects missing, extra, duplicate-request, and contradictory identity sets', () => {
  const valid = {
    ok: true,
    residentNumbers: { 'fc-1': null, 'fc-2': '900101-1234567' },
    residentNumberStatuses: { 'fc-1': 'missing', 'fc-2': 'ready' },
  };
  for (const [expectedFcIds, data] of [
    [['fc-1', 'fc-2'], { ...valid, residentNumbers: { 'fc-1': null } }],
    [['fc-1'], valid],
    [['fc-1', 'fc-1'], valid],
    [['fc-1', 'fc-2'], { ...valid, residentNumberStatuses: { 'fc-1': 'ready', 'fc-2': 'ready' } }],
  ] as const) {
    assert.deepStrictEqual(
      parseResidentNumberEdgeFallbackResponse({ responseOk: true, data, expectedFcIds: [...expectedFcIds] }),
      { ok: false, message: 'Edge Function failed' },
    );
  }
});
