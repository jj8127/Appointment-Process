import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const EDGE_PORT = 8000;
const EDGE_URL = `http://${HOST}:${EDGE_PORT}`;
const TEST_ORIGIN = 'http://127.0.0.1:3000';
const APP_SECRET = 'loopback-board-list-app-secret-not-production';
const SERVICE_KEY = 'loopback-board-list-service-key-not-production';
const AUTOMATION_TOKEN = 'loopback-board-list-automation-token-not-production';
const AUTOMATION_PHONE = '01091000001';
const APP_ADMIN_PHONE = '01091000002';
const RAW_TITLE_SECRET = 'loopback-title-secret-not-production';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const edgeEntry = path.join(repoRoot, 'supabase', 'functions', 'board-list', 'index.ts');

let state = { name: 'startup', requests: [] };

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function fakePostgrest(request, response) {
  const url = new URL(request.url ?? '/', `http://${HOST}`);
  const match = url.pathname.match(/^\/rest\/v1\/([^/]+)$/);
  if (!match || request.method !== 'GET') {
    sendJson(response, 500, { message: `unexpected request: ${request.method} ${url.pathname}` });
    return;
  }

  const table = match[1];
  state.requests.push({ table, url });

  if (table === 'admin_accounts') {
    const automation = state.name !== 'app mode preserves full list behavior';
    sendJson(response, 200, {
      id: automation ? 'automation-admin-1' : 'app-admin-1',
      name: automation ? 'Canonical Automation Admin' : 'Canonical App Admin',
      phone: automation ? AUTOMATION_PHONE : APP_ADMIN_PHONE,
      active: true,
    });
    return;
  }

  if (table === 'board_categories') {
    const arbitrary = state.name === 'arbitrary category';
    sendJson(response, 200, {
      id: arbitrary ? 'category-other' : 'category-general',
      slug: arbitrary ? 'garam-pick' : 'general',
      is_active: true,
    });
    return;
  }

  if (table === 'board_posts_with_stats') {
    if (state.name === 'valid automation duplicate check') {
      sendJson(response, 200, [{
        id: 'digest-post-1',
        title: `Insurance digest API_TOKEN=${RAW_TITLE_SECRET}`,
        created_at: '2026-07-12T00:00:00.000Z',
        content: 'must never reach automation',
        author_name: 'must never reach automation',
      }]);
      return;
    }
    sendJson(response, 200, []);
    return;
  }

  sendJson(response, 500, { message: `unexpected PostgREST table: ${table}` });
}

async function startFakeSupabase() {
  const server = createHttpServer(fakePostgrest);
  server.listen(0, HOST);
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  return { server, url: `http://${HOST}:${address.port}` };
}

async function assertPortAvailable() {
  const probe = createNetServer();
  try {
    probe.listen(EDGE_PORT, HOST);
    await once(probe, 'listening');
  } catch (error) {
    throw new Error(`loopback Edge port ${EDGE_PORT} is already in use`, { cause: error });
  } finally {
    if (probe.listening) await new Promise((resolve) => probe.close(resolve));
  }
}

function childEnvironment(fakeUrl) {
  const environment = {};
  for (const key of [
    'PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE',
    'LOCALAPPDATA', 'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'DENO_DIR',
  ]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return {
    ...environment,
    NO_COLOR: '1',
    ALLOWED_ORIGINS: TEST_ORIGIN,
    SUPABASE_URL: fakeUrl,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    FC_APP_SESSION_TOKEN_SECRET: APP_SECRET,
    FC_APP_SESSION_TOKEN_PREVIOUS_SECRET: '',
    REQUEST_BOARD_AUTH_BRIDGE_SECRET: '',
    BOARD_AUTOMATION_TOKEN: AUTOMATION_TOKEN,
    BOARD_AUTOMATION_ACTOR_PHONE: AUTOMATION_PHONE,
    BOARD_AUTOMATION_ACTOR_NAME: 'Canonical Automation Admin',
  };
}

function startEdge(fakeUrl) {
  const child = spawn('deno', [
    'run',
    '--frozen',
    '--allow-env',
    `--allow-net=${HOST},localhost,0.0.0.0:${EDGE_PORT}`,
    edgeEntry,
  ], {
    cwd: repoRoot,
    env: childEnvironment(fakeUrl),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
  return { child, diagnostics: () => ({ stdout, stderr }) };
}

async function waitForEdge(child, diagnostics) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const output = diagnostics();
      throw new Error(`board-list exited during startup\n${output.stdout}\n${output.stderr}`);
    }
    try {
      const response = await fetch(EDGE_URL, { signal: AbortSignal.timeout(750) });
      if (response.status === 405) return;
    } catch {
      // Not listening yet.
    }
    await delay(100);
  }
  const output = diagnostics();
  throw new Error(`timed out waiting for board-list\n${output.stdout}\n${output.stderr}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  if (await Promise.race([exited.then(() => true), delay(2_000).then(() => false)])) return;
  child.kill('SIGKILL');
  await Promise.race([once(child, 'exit'), delay(2_000)]);
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function appToken() {
  const now = Math.floor(Date.now() / 1000);
  const payloadPart = Buffer.from(JSON.stringify({
    kind: 'fc_onboarding_session',
    phone: APP_ADMIN_PHONE,
    role: 'admin',
    staffType: 'admin',
    iat: now,
    exp: now + 600,
  })).toString('base64url');
  const signature = createHmac('sha256', APP_SECRET).update(payloadPart).digest('base64url');
  return `${payloadPart}.${signature}`;
}

async function invoke(body, headers) {
  const response = await fetch(EDGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: TEST_ORIGIN, ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: JSON.parse(await response.text()) };
}

function tableRequests(table) {
  return state.requests.filter((request) => request.table === table);
}

async function scenario(name, test) {
  state = { name, requests: [] };
  await test();
  console.log(`ok - ${name}`);
}

async function runScenarios() {
  const automationHeaders = { 'x-board-automation-token': AUTOMATION_TOKEN };

  await scenario('missing category', async () => {
    const result = await invoke({ sort: 'created', order: 'desc' }, automationHeaders);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'automation_forbidden');
    assert.equal(tableRequests('admin_accounts').length, 1);
    assert.equal(tableRequests('board_categories').length, 0);
    assert.equal(tableRequests('board_posts_with_stats').length, 0);
  });

  await scenario('search forbidden', async () => {
    const result = await invoke({
      categoryId: 'category-general',
      search: 'admin',
      sort: 'created',
      order: 'desc',
    }, automationHeaders);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'automation_forbidden');
    assert.equal(tableRequests('admin_accounts').length, 1);
    assert.equal(tableRequests('board_categories').length, 0);
    assert.equal(tableRequests('board_posts_with_stats').length, 0);
  });

  await scenario('arbitrary category', async () => {
    const result = await invoke({
      categoryId: 'category-other',
      sort: 'created',
      order: 'desc',
    }, automationHeaders);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'automation_forbidden');
    assert.equal(tableRequests('board_categories').length, 1);
    assert.equal(tableRequests('board_posts_with_stats').length, 0);
  });

  await scenario('valid automation duplicate check', async () => {
    const result = await invoke({
      categoryId: 'category-general',
      sort: 'created',
      order: 'desc',
      limit: 50_000,
    }, automationHeaders);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      ok: true,
      data: {
        items: [{
          id: 'digest-post-1',
          title: 'Insurance digest API_TOKEN=[redacted]',
          createdAt: '2026-07-12T00:00:00.000Z',
        }],
      },
    });

    const reads = tableRequests('board_posts_with_stats');
    assert.equal(reads.length, 1);
    const params = reads[0].url.searchParams;
    assert.equal(params.get('select'), 'id,title,created_at');
    assert.equal(params.get('category_id'), 'eq.category-general');
    assert.equal(params.get('order'), 'created_at.desc');
    assert.equal(params.get('limit'), '20');
    assert.deepEqual([...params.keys()].sort(), ['category_id', 'limit', 'order', 'select']);
    assert.equal(tableRequests('board_post_reactions').length, 0);
    assert.equal(tableRequests('board_attachments').length, 0);
  });

  await scenario('app mode preserves full list behavior', async () => {
    const result = await invoke({
      categoryId: 'category-any',
      search: 'needle',
      sort: 'reactions',
      order: 'asc',
      limit: 7,
    }, { 'x-app-session-token': appToken() });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, data: { items: [], nextCursor: null } });

    const reads = tableRequests('board_posts_with_stats');
    assert.equal(reads.length, 2);
    for (const { url } of reads) {
      assert.match(url.searchParams.get('select') ?? '', /content,author_name/);
      assert.equal(url.searchParams.get('category_id'), 'eq.category-any');
      assert.match(url.searchParams.get('search_vector') ?? '', /needle/);
    }
    assert.deepEqual(
      reads.map(({ url }) => url.searchParams.get('is_pinned')).sort(),
      ['eq.false', 'eq.true'],
    );
    assert.deepEqual(
      reads.map(({ url }) => url.searchParams.get('limit')).sort(),
      ['10', '7'],
    );
    assert.equal(tableRequests('board_categories').length, 0);
  });
}

async function main() {
  let fakeServer;
  let edgeChild;
  let diagnostics = () => ({ stdout: '', stderr: '' });
  try {
    await assertPortAvailable();
    const fake = await startFakeSupabase();
    fakeServer = fake.server;
    const edge = startEdge(fake.url);
    edgeChild = edge.child;
    diagnostics = edge.diagnostics;
    await waitForEdge(edgeChild, diagnostics);
    await runScenarios();
    console.log('board-list loopback handler smoke: 5/5 passed');
  } catch (error) {
    const output = diagnostics();
    if (output.stdout.trim()) console.error(`\nboard-list stdout:\n${output.stdout.trim()}`);
    if (output.stderr.trim()) console.error(`\nboard-list stderr:\n${output.stderr.trim()}`);
    throw error;
  } finally {
    await stopChild(edgeChild);
    await closeServer(fakeServer);
  }
}

await main();
