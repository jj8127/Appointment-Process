import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import { QueryReadError } from './query-read-error.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadServerError() {
  const loggerCalls = [];
  const source = readFileSync(new URL('./api-error.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (id) => {
    if (id === 'next/server') {
      return { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200, headers: options?.headers }) } };
    }
    if (id === '@/lib/logger') {
      return { logger: { error: (...args) => loggerCalls.push(args) } };
    }
    throw new Error(`Unexpected dependency ${id}`);
  } });
  return { serverError: exports.serverError, loggerCalls };
}

function loadAgentRoomRoute({
  sessionResult = { ok: true, session: { role: 'admin', staffType: 'developer' } },
  snapshot,
  snapshotError,
} = {}) {
  const loggerCalls = [];
  const source = readFileSync(new URL('../app/api/agent-room/route.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};

  vm.runInNewContext(code, { exports, require: (id) => {
    if (id === 'next/server') {
      return {
        NextResponse: {
          json: (body, options) => ({
            body,
            headers: options?.headers,
            status: options?.status ?? 200,
          }),
        },
      };
    }
    if (id === '@/lib/agent-room-server') {
      return { getAgentRoomSnapshot: async () => {
        if (snapshotError) throw snapshotError;
        return snapshot;
      } };
    }
    if (id === '@/lib/api-error') {
      return {
        serverError: (error, label, headers) => {
          loggerCalls.push([`[${label}] internal error`, error]);
          return { body: { error: '요청 처리에 실패했습니다.' }, headers, status: 500 };
        },
      };
    }
    if (id === '@/lib/server-session') {
      return { getVerifiedServerSession: async () => sessionResult };
    }
    throw new Error(`Unexpected dependency ${id}`);
  } });

  return { GET: exports.GET, loggerCalls };
}

function loadAgentRoomFetcher() {
  const source = `${readFileSync(new URL('../app/dashboard/agent-room/page.tsx', import.meta.url), 'utf8')}\nexport const __testFetchAgentRoom = fetchAgentRoom;`;
  const code = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  const noopComponent = () => null;
  const constants = {
    AGENT_ROOM_STATUSES: ['coding', 'researching', 'thinking', 'waiting', 'done', 'idle'],
    AGENT_ROOM_VENDORS: ['codex', 'claude'],
    AGENT_ROOM_ZONES: ['terminal', 'library', 'whiteboard', 'lounge', 'shipping', 'idle'],
  };

  vm.runInNewContext(code, { exports, require: (id) => {
    if (id === '@mantine/core') return new Proxy({}, { get: () => noopComponent });
    if (id === '@tabler/icons-react') return new Proxy({}, { get: () => noopComponent });
    if (id === '@tanstack/react-query') return { useQuery: () => ({}) };
    if (id === 'next/navigation') return { useRouter: () => ({ replace() {} }) };
    if (id === 'react') return { useEffect() {} };
    if (id === '@/hooks/use-session') return { useSession: () => ({ hydrated: true, staffType: 'developer' }) };
    if (id === '@/components/agent-room/AgentRoomScene') return { AgentRoomScene: noopComponent };
    if (id === '@/components/QueryErrorAlert') return { QueryErrorAlert: noopComponent };
    if (id === '@/lib/query-read-error') return { QueryReadError };
    if (id === '@/types/agent-room') return constants;
    if (id === 'react/jsx-runtime') return { Fragment: 'fragment', jsx: () => null, jsxs: () => null };
    throw new Error(`Unexpected dependency ${id}`);
  }, fetch: (...args) => globalThis.fetch(...args) });

  return exports.__testFetchAgentRoom;
}

const validSnapshot = {
  agents: [],
  focus: {
    activeCount: 0,
    quietAgentIds: [],
    quietCount: 0,
    recentCount: 0,
    stageAgentIds: [],
    stageCount: 0,
  },
  generatedAt: '2026-10-13T00:00:00.000Z',
  hosts: [],
  summary: {
    activeCount: 0,
    quietCount: 0,
    recentCount: 0,
    statusCounts: { coding: 0, done: 0, idle: 0, researching: 0, thinking: 0, waiting: 0 },
    total: 0,
    vendorCounts: { claude: 0, codex: 0 },
  },
  warnings: [],
  workspace: null,
};

const codingAgent = {
  id: 'codex:root',
  name: 'root',
  isSubagent: false,
  status: 'coding',
  vendor: 'codex',
  zone: 'terminal',
  detail: null,
  consoleDetail: null,
  parentId: null,
  pendingTool: null,
  role: null,
  sourcePath: null,
  title: null,
  updatedAt: '2026-10-13T00:00:00.000Z',
};

const populatedSnapshot = {
  ...validSnapshot,
  agents: [codingAgent],
  focus: {
    activeCount: 1,
    quietAgentIds: [],
    quietCount: 0,
    recentCount: 1,
    stageAgentIds: [codingAgent.id],
    stageCount: 1,
  },
  summary: {
    activeCount: 1,
    quietCount: 0,
    recentCount: 1,
    statusCounts: { coding: 1, done: 0, idle: 0, researching: 0, thinking: 0, waiting: 0 },
    total: 1,
    vendorCounts: { claude: 0, codex: 1 },
  },
};

async function fetchSnapshotPayload(payload) {
  const fetchAgentRoom = loadAgentRoomFetcher();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
  try {
    return await fetchAgentRoom();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('agent-room API logs internal detail but returns a stable public error', async () => {
  const snapshotError = new Error('private workspace path');
  const h = loadAgentRoomRoute({ snapshotError });
  const response = await h.GET();

  assert.equal(response.status, 500);
  assert.equal(
    JSON.stringify(response.body),
    JSON.stringify({ error: '요청 처리에 실패했습니다.' }),
  );
  assert.equal(JSON.stringify(response.body).includes(snapshotError.message), false);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(h.loggerCalls.length, 1);
  assert.equal(h.loggerCalls[0][1], snapshotError);
});

test('agent-room API prevents caching for successful and rejected reads', async () => {
  const success = await loadAgentRoomRoute({ snapshot: validSnapshot }).GET();
  assert.equal(success.status, 200);
  assert.equal(success.headers['Cache-Control'], 'no-store');

  const unauthorized = await loadAgentRoomRoute({
    sessionResult: { error: 'Unauthorized', ok: false, status: 401 },
  }).GET();
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers['Cache-Control'], 'no-store');
});

test('agent-room API serves developer accounts only', async () => {
  for (const session of [{ role: 'manager', staffType: null }, { role: 'admin', staffType: 'admin' }]) {
    const rejected = await loadAgentRoomRoute({
      sessionResult: { ok: true, session },
      snapshotError: new Error('snapshot must not be read'),
    }).GET();
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers['Cache-Control'], 'no-store');
  }
});

test('shared serverError logs private detail but returns only the stable public contract', () => {
  const privateError = new Error('private database detail');
  const headers = { 'X-Test-Security': 'present' };
  const { serverError, loggerCalls } = loadServerError();
  const response = serverError(privateError, 'test/error-boundary', headers);

  assert.equal(response.status, 500);
  assert.equal(response.headers, headers);
  assert.equal(JSON.stringify(response.body), JSON.stringify({ error: '요청 처리에 실패했습니다.' }));
  assert.equal(JSON.stringify(response.body).includes(privateError.message), false);
  assert.equal(loggerCalls.length, 1);
  assert.equal(loggerCalls[0][1], privateError);
});

test('agent-room client rejects malformed 200 responses instead of showing an empty room', async () => {
  const fetchAgentRoom = loadAgentRoomFetcher();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ agents: [] }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

  try {
    await assert.rejects(fetchAgentRoom(), (error) => error instanceof QueryReadError && error.status === undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agent-room client preserves HTTP status without rendering the response body', async () => {
  const fetchAgentRoom = loadAgentRoomFetcher();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'private detail' }), {
    headers: { 'Content-Type': 'application/json' },
    status: 401,
  });

  try {
    await assert.rejects(fetchAgentRoom(), (error) => error instanceof QueryReadError && error.status === 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agent-room client accepts the complete snapshot contract', async () => {
  const fetchAgentRoom = loadAgentRoomFetcher();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(validSnapshot), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

  try {
    assert.equal(JSON.stringify(await fetchAgentRoom()), JSON.stringify(validSnapshot));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agent-room client requires focus and summary to match the unique agent roster', async () => {
  assert.equal(JSON.stringify(await fetchSnapshotPayload(populatedSnapshot)), JSON.stringify(populatedSnapshot));

  const malformedSnapshots = [
    { ...populatedSnapshot, agents: [codingAgent, codingAgent] },
    { ...populatedSnapshot, focus: { ...populatedSnapshot.focus, stageAgentIds: ['missing-agent'] } },
    { ...populatedSnapshot, focus: { ...populatedSnapshot.focus, quietAgentIds: [codingAgent.id], quietCount: 1 } },
    { ...populatedSnapshot, focus: { ...populatedSnapshot.focus, stageCount: 0 } },
    { ...populatedSnapshot, focus: { ...populatedSnapshot.focus, activeCount: 0 } },
    { ...populatedSnapshot, summary: { ...populatedSnapshot.summary, total: 0 } },
    { ...populatedSnapshot, summary: { ...populatedSnapshot.summary, statusCounts: { ...populatedSnapshot.summary.statusCounts, coding: 0 } } },
    { ...populatedSnapshot, summary: { ...populatedSnapshot.summary, vendorCounts: { ...populatedSnapshot.summary.vendorCounts, codex: 0 } } },
  ];

  for (const snapshot of malformedSnapshots) {
    await assert.rejects(fetchSnapshotPayload(snapshot), (error) => (
      error instanceof QueryReadError && error.status === undefined
    ));
  }
});
