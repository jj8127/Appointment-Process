import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRequestBoardPasswordSyncBody,
  syncRequestBoardPasswordWithDeps,
} from '../request-board-password-sync.ts';
import type { EdgeDiagnosticInput } from '../edge-diagnostic.ts';

test('builds request_board password-sync body for FC with affiliation and metadata', () => {
  assert.deepEqual(
    buildRequestBoardPasswordSyncBody('01012345678', 'Pass!1234', {
      role: 'fc',
      name: ' 홍길동 ',
      affiliation: ' 1본부 ',
      initiatorRole: 'self',
      syncReason: 'login',
    }),
    {
      phone: '01012345678',
      password: 'Pass!1234',
      role: 'fc',
      name: ' 홍길동 ',
      affiliation: ' 1본부 ',
      initiatorRole: 'self',
      syncReason: 'login',
    },
  );
});

test('builds request_board password-sync body for manager while preserving manager role', () => {
  assert.deepEqual(
    buildRequestBoardPasswordSyncBody('01022223333', 'Manager!1234', {
      role: 'manager',
      name: '서선미',
      affiliation: '1본부 서선미',
      initiatorRole: 'manager',
      syncReason: 'self-reset',
    }),
    {
      phone: '01022223333',
      password: 'Manager!1234',
      role: 'manager',
      name: '서선미',
      affiliation: '1본부 서선미',
      initiatorRole: 'manager',
      syncReason: 'self-reset',
    },
  );
});

test('builds request_board password-sync body for designer with company name but without affiliation', () => {
  assert.deepEqual(
    buildRequestBoardPasswordSyncBody('01033334444', 'Designer!1234', {
      role: 'designer',
      name: '한지아',
      companyName: '농협생명',
      affiliation: '농협생명 설계매니저',
      initiatorRole: 'system',
      syncReason: 'bootstrap',
    }),
    {
      phone: '01033334444',
      password: 'Designer!1234',
      role: 'designer',
      name: '한지아',
      companyName: '농협생명',
      initiatorRole: 'system',
      syncReason: 'bootstrap',
    },
  );
});

test('builds request_board password-sync body for developer FC mirror without affiliation', () => {
  assert.deepEqual(
    buildRequestBoardPasswordSyncBody('01044445555', 'Developer!1234', {
      role: 'fc',
      name: '개발자',
      initiatorRole: 'admin',
      syncReason: 'login',
    }),
    {
      phone: '01044445555',
      password: 'Developer!1234',
      role: 'fc',
      name: '개발자',
      initiatorRole: 'admin',
      syncReason: 'login',
    },
  );
});

test('omits blank optional request_board password-sync fields with current truthiness checks', () => {
  assert.deepEqual(
    buildRequestBoardPasswordSyncBody('01055556666', 'Blank!1234', {
      role: 'fc',
      name: '',
      companyName: '',
      affiliation: '',
    }),
    {
      phone: '01055556666',
      password: 'Blank!1234',
      role: 'fc',
    },
  );
});

test('skips request_board password sync fetch when url or token is missing', async () => {
  let sideEffects = 0;
  const deps = {
    fetchImpl: async () => {
      sideEffects += 1;
      throw new Error('fetch should not run');
    },
    createAbortController: () => {
      sideEffects += 1;
      return {
        signal: {} as AbortSignal,
        abort: () => {},
      };
    },
    setTimeoutImpl: () => {
      sideEffects += 1;
      return 'timeout';
    },
    clearTimeoutImpl: () => {
      sideEffects += 1;
    },
    diagnostic: () => {
      sideEffects += 1;
    },
  };

  await syncRequestBoardPasswordWithDeps({
    syncUrl: '',
    syncToken: 'token',
    timeoutMs: 5000,
    logPrefix: 'test',
    phone: '01012345678',
    password: 'Pass!1234',
    options: { role: 'fc' },
  }, deps);

  await syncRequestBoardPasswordWithDeps({
    syncUrl: 'https://request.example/api/auth/sync-password',
    syncToken: '',
    timeoutMs: 5000,
    logPrefix: 'test',
    phone: '01012345678',
    password: 'Pass!1234',
    options: { role: 'fc' },
  }, deps);

  assert.equal(sideEffects, 0);
});

test('sends request_board password sync fetch with current headers, body, signal, and timeout cleanup', async () => {
  const calls: Array<{ input: string; init: Record<string, unknown> }> = [];
  const timeoutMsValues: number[] = [];
  const clearedTimeouts: unknown[] = [];
  const diagnostics: EdgeDiagnosticInput[] = [];
  let abortCount = 0;
  const signal = { kind: 'test-signal' } as unknown as AbortSignal;
  const timeoutCallbacks: Array<() => void> = [];

  await syncRequestBoardPasswordWithDeps({
    syncUrl: 'https://request.example/api/auth/sync-password',
    syncToken: 'bridge-token',
    timeoutMs: 4321,
    logPrefix: 'reset-password',
    phone: '01012345678',
    password: 'Pass!1234',
    options: {
      role: 'fc',
      name: '홍길동',
      affiliation: '1본부',
      initiatorRole: 'self',
      syncReason: 'self-reset',
    },
  }, {
    fetchImpl: async (input, init) => {
      calls.push({ input, init: init as unknown as Record<string, unknown> });
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ success: true }),
      };
    },
    createAbortController: () => ({
      signal,
      abort: () => {
        abortCount += 1;
      },
    }),
    setTimeoutImpl: (handler, timeoutMs) => {
      timeoutCallbacks.push(handler);
      timeoutMsValues.push(timeoutMs);
      return 'timeout-handle';
    },
    clearTimeoutImpl: (handle) => {
      clearedTimeouts.push(handle);
    },
    diagnostic: (input) => {
      diagnostics.push(input);
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, 'https://request.example/api/auth/sync-password');
  assert.equal(calls[0]?.init.method, 'POST');
  assert.deepEqual(calls[0]?.init.headers, {
    'Content-Type': 'application/json',
    'x-request-bridge-token': 'bridge-token',
  });
  assert.deepEqual(
    JSON.parse(String(calls[0]?.init.body)),
    buildRequestBoardPasswordSyncBody('01012345678', 'Pass!1234', {
      role: 'fc',
      name: '홍길동',
      affiliation: '1본부',
      initiatorRole: 'self',
      syncReason: 'self-reset',
    }),
  );
  assert.equal(calls[0]?.init.signal, signal);
  assert.deepEqual(timeoutMsValues, [4321]);
  assert.deepEqual(clearedTimeouts, ['timeout-handle']);
  assert.deepEqual(diagnostics, []);

  timeoutCallbacks[0]?.();
  assert.equal(abortCount, 1);
});

test('reports only fixed metadata for a non-ok request_board password sync response', async () => {
  const body = 'POISON-UPSTREAM-BODY-01077778888-REF-CODE';
  const diagnostics: EdgeDiagnosticInput[] = [];
  let bodyReadCount = 0;

  await syncRequestBoardPasswordWithDeps({
    syncUrl: 'https://request.example/api/auth/sync-password',
    syncToken: 'bridge-token',
    timeoutMs: 1000,
    logPrefix: 'login-with-password',
    phone: '01012345678',
    password: 'Pass!1234',
    options: { role: 'designer', companyName: '농협생명' },
  }, {
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => {
        bodyReadCount += 1;
        return body;
      },
      json: async () => ({ success: false }),
    }),
    createAbortController: () => ({
      signal: {} as AbortSignal,
      abort: () => {},
    }),
    setTimeoutImpl: () => 'timeout-handle',
    clearTimeoutImpl: () => {},
    diagnostic: (input) => {
      diagnostics.push(input);
    },
  });

  assert.equal(bodyReadCount, 0);
  assert.deepEqual(diagnostics, [{
    event: 'request_board.password_sync',
    reason: 'upstream_rejected',
    status: 503,
    retryable: true,
    errorClass: 'upstream',
  }]);
  assert.equal(JSON.stringify(diagnostics).includes(body), false);
});

test('reports only fixed metadata for an unsuccessful request_board password sync json body', async () => {
  const jsonBody = {
    success: false,
    error: 'POISON-JSON-ERROR',
    phone: '010-7777-8888',
    affiliation: 'POISON-AFFILIATION',
  };
  const diagnostics: EdgeDiagnosticInput[] = [];

  await syncRequestBoardPasswordWithDeps({
    syncUrl: 'https://request.example/api/auth/sync-password',
    syncToken: 'bridge-token',
    timeoutMs: 1000,
    logPrefix: 'reset-password',
    phone: '01012345678',
    password: 'Pass!1234',
    options: { role: 'manager', affiliation: '1본부' },
  }, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => jsonBody,
    }),
    createAbortController: () => ({
      signal: {} as AbortSignal,
      abort: () => {},
    }),
    setTimeoutImpl: () => 'timeout-handle',
    clearTimeoutImpl: () => {},
    diagnostic: (input) => {
      diagnostics.push(input);
    },
  });

  assert.deepEqual(diagnostics, [{
    event: 'request_board.password_sync',
    reason: 'invalid_response',
    errorClass: 'upstream',
  }]);
  assert.equal(JSON.stringify(diagnostics).includes('POISON'), false);
  assert.equal(JSON.stringify(diagnostics).includes('010-7777-8888'), false);
});

test('reports only a coarse class for thrown request_board password sync fetch errors', async () => {
  const error = new Error('POISON-NETWORK-ERROR-01077778888');
  const diagnostics: EdgeDiagnosticInput[] = [];

  await syncRequestBoardPasswordWithDeps({
    syncUrl: 'https://request.example/api/auth/sync-password',
    syncToken: 'bridge-token',
    timeoutMs: 1000,
    logPrefix: 'set-password',
    phone: '01012345678',
    password: 'Pass!1234',
    options: { role: 'fc' },
  }, {
    fetchImpl: async () => {
      throw error;
    },
    createAbortController: () => ({
      signal: {} as AbortSignal,
      abort: () => {},
    }),
    setTimeoutImpl: () => 'timeout-handle',
    clearTimeoutImpl: () => {},
    diagnostic: (input) => {
      diagnostics.push(input);
    },
  });

  assert.deepEqual(diagnostics, [{
    event: 'request_board.password_sync',
    reason: 'request_failed',
    retryable: true,
    errorClass: 'network',
  }]);
  assert.equal(JSON.stringify(diagnostics).includes('POISON'), false);
});

test('classifies an aborted request_board password sync without serializing its error', async () => {
  const diagnostics: EdgeDiagnosticInput[] = [];

  await syncRequestBoardPasswordWithDeps({
    syncUrl: 'https://request.example/api/auth/sync-password',
    syncToken: 'bridge-token',
    timeoutMs: 1000,
    logPrefix: 'set-password',
    phone: '01012345678',
    password: 'Pass!1234',
    options: { role: 'fc' },
  }, {
    fetchImpl: async () => {
      throw new Error('POISON-TIMEOUT-ERROR-01077778888');
    },
    createAbortController: () => ({
      signal: { aborted: true } as AbortSignal,
      abort: () => {},
    }),
    setTimeoutImpl: () => 'timeout-handle',
    clearTimeoutImpl: () => {},
    diagnostic: (input) => {
      diagnostics.push(input);
    },
  });

  assert.deepEqual(diagnostics, [{
    event: 'request_board.password_sync',
    reason: 'timeout',
    retryable: true,
    errorClass: 'timeout',
  }]);
  assert.equal(JSON.stringify(diagnostics).includes('POISON'), false);
});

test('does not let an injected diagnostic failure escape password sync', async () => {
  await assert.doesNotReject(() => syncRequestBoardPasswordWithDeps({
    syncUrl: 'https://request.example/api/auth/sync-password',
    syncToken: 'bridge-token',
    timeoutMs: 1000,
    logPrefix: 'set-password',
    phone: '01012345678',
    password: 'Pass!1234',
    options: { role: 'fc' },
  }, {
    fetchImpl: async () => ({
      ok: false,
      status: 502,
      text: async () => 'POISON-BODY',
      json: async () => ({ success: false }),
    }),
    createAbortController: () => ({
      signal: {} as AbortSignal,
      abort: () => {},
    }),
    setTimeoutImpl: () => 'timeout-handle',
    clearTimeoutImpl: () => {},
    diagnostic: () => {
      throw new Error('diagnostic unavailable');
    },
  }));
});
