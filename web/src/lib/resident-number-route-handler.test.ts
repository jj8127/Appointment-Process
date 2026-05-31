import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleResidentNumberRoutePost } from './resident-number-route-handler.ts';
import { normalizeResidentNumberRouteFcIds } from './resident-number-route-request.ts';

const normalizeFcIds = normalizeResidentNumberRouteFcIds;

test('resident-number route handler returns session failures before later work', async () => {
  let rateLimitCalls = 0;
  let jsonCalls = 0;
  let readCalls = 0;

  const response = await handleResidentNumberRoutePost({
    getSession: async () => ({ ok: false, status: 401, error: 'No session found' }),
    checkRateLimit: () => {
      rateLimitCalls += 1;
      return { allowed: true };
    },
    readJson: async () => {
      jsonCalls += 1;
      return {};
    },
    readResidentNumbers: async () => {
      readCalls += 1;
      return {};
    },
    normalizeFcIds,
    logInvalidJson: () => undefined,
    logReadFailure: () => undefined,
  });

  assert.deepEqual(response, {
    body: { error: 'No session found' },
    status: 401,
  });
  assert.equal(rateLimitCalls, 0);
  assert.equal(jsonCalls, 0);
  assert.equal(readCalls, 0);
});

test('resident-number route handler rate-limits before parsing the body', async () => {
  const rateLimitCalls: Array<{ key: string; limit: number; windowMs: number }> = [];
  let jsonCalls = 0;
  let readCalls = 0;

  const response = await handleResidentNumberRoutePost({
    getSession: async () => ({
      ok: true,
      session: { residentDigits: '01012345678' },
    }),
    checkRateLimit: (key, limit, windowMs) => {
      rateLimitCalls.push({ key, limit, windowMs });
      return { allowed: false };
    },
    readJson: async () => {
      jsonCalls += 1;
      return {};
    },
    readResidentNumbers: async () => {
      readCalls += 1;
      return {};
    },
    normalizeFcIds,
    logInvalidJson: () => undefined,
    logReadFailure: () => undefined,
  });

  assert.deepEqual(response, {
    body: { error: 'Too many requests' },
    status: 429,
  });
  assert.deepEqual(rateLimitCalls, [{
    key: 'resident-numbers:01012345678',
    limit: 30,
    windowMs: 60_000,
  }]);
  assert.equal(jsonCalls, 0);
  assert.equal(readCalls, 0);
});

test('resident-number route handler logs invalid JSON and returns current 400 response', async () => {
  const parseError = new Error('invalid json');
  const invalidJsonLogs: unknown[] = [];

  const response = await handleResidentNumberRoutePost({
    getSession: async () => ({
      ok: true,
      session: { residentDigits: '01012345678' },
    }),
    checkRateLimit: () => ({ allowed: true }),
    readJson: async () => {
      throw parseError;
    },
    readResidentNumbers: async () => {
      throw new Error('should not read resident numbers');
    },
    normalizeFcIds,
    logInvalidJson: (error) => invalidJsonLogs.push(error),
    logReadFailure: () => undefined,
  });

  assert.deepEqual(response, {
    body: { error: 'Invalid JSON payload' },
    status: 400,
  });
  assert.deepEqual(invalidJsonLogs, [parseError]);
});

test('resident-number route handler short-circuits empty fcIds without reading residents', async () => {
  let readCalls = 0;

  const response = await handleResidentNumberRoutePost({
    getSession: async () => ({
      ok: true,
      session: { residentDigits: '01012345678' },
    }),
    checkRateLimit: () => ({ allowed: true }),
    readJson: async () => ({ fcIds: [' ', null, undefined, ''] }),
    readResidentNumbers: async () => {
      readCalls += 1;
      return {};
    },
    normalizeFcIds,
    logInvalidJson: () => undefined,
    logReadFailure: () => undefined,
  });

  assert.deepEqual(response, {
    body: { ok: true, residentNumbers: {} },
    status: 200,
  });
  assert.equal(readCalls, 0);
});

test('resident-number route handler reads normalized fcIds with current staff phone and log prefix', async () => {
  const readCalls: unknown[] = [];

  const response = await handleResidentNumberRoutePost({
    getSession: async () => ({
      ok: true,
      session: { residentDigits: '01012345678' },
    }),
    checkRateLimit: () => ({ allowed: true }),
    readJson: async () => ({ fcIds: [' fc-1 ', 'fc-2', 'fc-1'] }),
    readResidentNumbers: async (options) => {
      readCalls.push(options);
      return {
        'fc-1': '900101-1234567',
        'fc-2': null,
      };
    },
    normalizeFcIds,
    logInvalidJson: () => undefined,
    logReadFailure: () => undefined,
  });

  assert.deepEqual(response, {
    body: {
      ok: true,
      residentNumbers: {
        'fc-1': '900101-1234567',
        'fc-2': null,
      },
    },
    status: 200,
  });
  assert.deepEqual(readCalls, [{
    fcIds: ['fc-1', 'fc-2'],
    staffPhone: '01012345678',
    logPrefix: '[api/admin/resident-numbers]',
  }]);
});

test('resident-number route handler logs read failures and returns the generic 500 response', async () => {
  const readError = new Error('decrypt failed');
  const readFailureLogs: unknown[] = [];

  const response = await handleResidentNumberRoutePost({
    getSession: async () => ({
      ok: true,
      session: { residentDigits: '01012345678' },
    }),
    checkRateLimit: () => ({ allowed: true }),
    readJson: async () => ({ fcIds: ['fc-1'] }),
    readResidentNumbers: async () => {
      throw readError;
    },
    normalizeFcIds,
    logInvalidJson: () => undefined,
    logReadFailure: (error) => readFailureLogs.push(error),
  });

  assert.deepEqual(response, {
    body: { error: '요청 처리에 실패했습니다.' },
    status: 500,
  });
  assert.deepEqual(readFailureLogs, [readError]);
});
