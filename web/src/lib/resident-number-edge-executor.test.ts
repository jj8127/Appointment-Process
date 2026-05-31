import assert from 'node:assert/strict';
import test from 'node:test';

import { readResidentNumbersFromEdgeFallback } from './resident-number-edge-executor.ts';
import { buildResidentNumberEdgeFallbackRequest } from './resident-number-edge-fallback.ts';
import { parseResidentNumberEdgeFallbackResponse } from './resident-number-edge-response.ts';

type FetchCall = {
  url: string;
  init: RequestInit;
};

type LogCall = {
  message: string;
  details: Record<string, unknown>;
};

const baseOptions = {
  fcIds: ['fc-1', 'fc-2'],
  staffPhone: '01012345678',
  supabaseUrl: 'https://project.supabase.co',
  serviceKey: 'service-role-key',
  directFallbackDescription: 'FC_IDENTITY_KEY is not configured',
  runtimeDetails: { fallbackReason: 'missing_identity_key' },
  logPrefix: '[test]',
  buildRequest: buildResidentNumberEdgeFallbackRequest,
  parseResponse: parseResidentNumberEdgeFallbackResponse,
};

test('returns resident numbers from a successful edge fallback response', async () => {
  const fetchCalls: FetchCall[] = [];
  const logCalls: LogCall[] = [];

  const result = await readResidentNumbersFromEdgeFallback({
    ...baseOptions,
    fetcher: async (url, init) => {
      fetchCalls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          residentNumbers: {
            'fc-1': '900101-1234567',
            'fc-2': null,
          },
        }),
      };
    },
    logError: (message, details) => {
      logCalls.push({ message, details });
    },
  });

  assert.deepStrictEqual(result, {
    'fc-1': '900101-1234567',
    'fc-2': null,
  });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://project.supabase.co/functions/v1/admin-action');
  assert.deepStrictEqual(fetchCalls[0].init.headers, {
    'Content-Type': 'application/json',
    apikey: 'service-role-key',
    Authorization: 'Bearer service-role-key',
  });
  assert.deepStrictEqual(JSON.parse(String(fetchCalls[0].init.body)), {
    adminPhone: '01012345678',
    action: 'getResidentNumbers',
    payload: { fcIds: ['fc-1', 'fc-2'] },
  });
  assert.deepStrictEqual(logCalls, []);
});

test('throws the existing runtime misconfiguration error and skips fetch when edge env is missing', async () => {
  let fetched = false;
  const logCalls: LogCall[] = [];

  await assert.rejects(
    readResidentNumbersFromEdgeFallback({
      ...baseOptions,
      supabaseUrl: '',
      serviceKey: '',
      fetcher: async () => {
        fetched = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, residentNumbers: {} }),
        };
      },
      logError: (message, details) => {
        logCalls.push({ message, details });
      },
    }),
    {
      message: 'Resident-number runtime misconfigured: FC_IDENTITY_KEY is not configured and edge fallback is unavailable (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)',
    },
  );

  assert.equal(fetched, false);
  assert.deepStrictEqual(logCalls, [
    {
      message: '[test] edge fallback unavailable',
      details: {
        fallbackReason: 'missing_identity_key',
        missingEnv: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      },
    },
  ]);
});

test('logs response status and body before throwing the edge fallback server message', async () => {
  const logCalls: LogCall[] = [];

  await assert.rejects(
    readResidentNumbersFromEdgeFallback({
      ...baseOptions,
      fetcher: async () => ({
        ok: false,
        status: 500,
        json: async () => ({ message: 'server says no', error: 'secondary' }),
      }),
      logError: (message, details) => {
        logCalls.push({ message, details });
      },
    }),
    {
      message: 'Resident-number edge fallback failed after FC_IDENTITY_KEY is not configured: server says no',
    },
  );

  assert.deepStrictEqual(logCalls, [
    {
      message: '[test] resident-number edge function failed',
      details: {
        fallbackReason: 'missing_identity_key',
        status: 500,
        body: { message: 'server says no', error: 'secondary' },
      },
    },
  ]);
});

test('uses the default edge fallback error message when response JSON cannot be read', async () => {
  const logCalls: LogCall[] = [];

  await assert.rejects(
    readResidentNumbersFromEdgeFallback({
      ...baseOptions,
      fetcher: async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('bad json');
        },
      }),
      logError: (message, details) => {
        logCalls.push({ message, details });
      },
    }),
    {
      message: 'Resident-number edge fallback failed after FC_IDENTITY_KEY is not configured: Edge Function failed',
    },
  );

  assert.deepStrictEqual(logCalls, [
    {
      message: '[test] resident-number edge function failed',
      details: {
        fallbackReason: 'missing_identity_key',
        status: 502,
        body: null,
      },
    },
  ]);
});
