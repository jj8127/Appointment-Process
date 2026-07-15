import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HOST = '127.0.0.1';
const EDGE_PORT = 8000;
const EDGE_ORIGIN = `http://${HOST}:${EDGE_PORT}`;
const TEST_ORIGIN = 'http://127.0.0.1:3000';

const DUMMY_APP_SESSION_SECRET = 'loopback-app-session-secret-not-production';
const DUMMY_SERVICE_ROLE_KEY = 'loopback-service-role-key-not-production';
const DUMMY_AUTOMATION_TOKEN = 'loopback-board-automation-token-not-production';
const DUMMY_AUTOMATION_PHONE = '01090000001';
const DUMMY_ADMIN_PHONE = '01090000002';
const DUMMY_FC_PHONE = '01090000003';
const DUMMY_SECRET_VALUE = 'loopback-sensitive-value-not-production';
const DUMMY_LONG_HEX = '0123456789abcdef0123456789abcdef01234567';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..', '..');
const edgeEntry = path.join(repoRoot, 'supabase', 'functions', 'board-create', 'index.ts');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(response, status, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function newScenarioState(name) {
  return {
    name,
    dbRequests: [],
    downstreamRequests: [],
    postWrites: [],
    notificationWrites: [],
  };
}

let scenario = newScenarioState('startup');

function actorRecord(table) {
  if (table === 'fc_profiles') {
    return {
      id: 'fc-loopback-1',
      name: 'Canonical FC',
      phone: DUMMY_FC_PHONE,
      signup_completed: true,
    };
  }
  if (table === 'admin_accounts') {
    const isAutomation = scenario.name === 'exact automation token + non-general category';
    return {
      id: isAutomation ? 'admin-automation-loopback-1' : 'admin-loopback-1',
      name: isAutomation ? 'Canonical Automation Admin' : 'Canonical Admin',
      phone: isAutomation ? DUMMY_AUTOMATION_PHONE : DUMMY_ADMIN_PHONE,
      active: true,
    };
  }
  if (table === 'manager_accounts') {
    return {
      id: 'manager-loopback-1',
      name: 'Canonical Manager',
      phone: '01090000004',
      active: true,
    };
  }
  return null;
}

async function fakeSupabaseHandler(request, response) {
  const url = new URL(request.url ?? '/', `http://${HOST}`);
  const pathname = url.pathname;
  const method = request.method ?? 'GET';

  if (pathname === '/functions/v1/fc-notify') {
    const body = await readJson(request);
    scenario.downstreamRequests.push({ method, pathname, headers: request.headers, body });
    sendJson(response, 200, { ok: true });
    return;
  }

  const tableMatch = pathname.match(/^\/rest\/v1\/([^/]+)$/);
  if (!tableMatch) {
    sendJson(response, 404, { message: `unexpected loopback path: ${pathname}` });
    return;
  }

  const table = tableMatch[1];
  const body = method === 'GET' || method === 'HEAD' ? null : await readJson(request);
  const record = { method, pathname, table, search: url.search, headers: request.headers, body };
  scenario.dbRequests.push(record);

  if (method === 'GET' && ['fc_profiles', 'admin_accounts', 'manager_accounts'].includes(table)) {
    sendJson(response, 200, actorRecord(table));
    return;
  }

  if (method === 'GET' && table === 'board_categories') {
    const isNonGeneral = scenario.name === 'exact automation token + non-general category';
    sendJson(response, 200, {
      id: isNonGeneral ? 'category-non-general' : 'category-general',
      is_active: true,
      slug: isNonGeneral ? 'garam-pick' : 'general',
    });
    return;
  }

  if (method === 'POST' && table === 'board_posts') {
    scenario.postWrites.push(body);
    sendJson(response, 201, { id: 'post-loopback-1' });
    return;
  }

  if (method === 'POST' && table === 'notifications') {
    scenario.notificationWrites.push(body);
    sendJson(response, 201, undefined);
    return;
  }

  sendJson(response, 500, {
    code: 'LOOPBACK_UNEXPECTED_REQUEST',
    message: `unexpected fake PostgREST request: ${method} ${pathname}`,
  });
}

async function startFakeSupabase() {
  const server = createHttpServer((request, response) => {
    fakeSupabaseHandler(request, response).catch((error) => {
      sendJson(response, 500, { message: String(error?.stack ?? error) });
    });
  });
  server.listen(0, HOST);
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  return { server, url: `http://${HOST}:${address.port}` };
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function assertPortAvailable(port) {
  const probe = createNetServer();
  try {
    probe.listen(port, HOST);
    await once(probe, 'listening');
  } catch (error) {
    throw new Error(`loopback Edge port ${port} is already in use`, { cause: error });
  } finally {
    if (probe.listening) {
      await new Promise((resolve) => probe.close(resolve));
    }
  }
}

function makeChildEnvironment(fakeSupabaseUrl) {
  const environment = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'HOMEDRIVE',
    'HOMEPATH',
    'DENO_DIR',
  ]) {
    if (process.env[key]) environment[key] = process.env[key];
  }

  return {
    ...environment,
    NO_COLOR: '1',
    ALLOWED_ORIGINS: TEST_ORIGIN,
    SUPABASE_URL: fakeSupabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: DUMMY_SERVICE_ROLE_KEY,
    FC_APP_SESSION_TOKEN_SECRET: DUMMY_APP_SESSION_SECRET,
    FC_APP_SESSION_TOKEN_PREVIOUS_SECRET: '',
    REQUEST_BOARD_AUTH_BRIDGE_SECRET: '',
    BOARD_AUTOMATION_TOKEN: DUMMY_AUTOMATION_TOKEN,
    BOARD_AUTOMATION_ACTOR_PHONE: DUMMY_AUTOMATION_PHONE,
    BOARD_AUTOMATION_ACTOR_NAME: 'Canonical Automation Admin',
  };
}

function startEdgeHandler(fakeSupabaseUrl) {
  const child = spawn(
    'deno',
    [
      'run',
      '--frozen',
      '--allow-env',
      `--allow-net=${HOST},localhost,0.0.0.0:${EDGE_PORT}`,
      edgeEntry,
    ],
    {
      cwd: repoRoot,
      env: makeChildEnvironment(fakeSupabaseUrl),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  let stdout = '';
  let stderr = '';
  const append = (current, chunk) => `${current}${chunk}`.slice(-20_000);
  child.stdout.on('data', (chunk) => {
    stdout = append(stdout, chunk.toString());
  });
  child.stderr.on('data', (chunk) => {
    stderr = append(stderr, chunk.toString());
  });

  return {
    child,
    diagnostics: () => ({ stdout, stderr }),
  };
}

async function waitForEdge(child, diagnostics) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const output = diagnostics();
      throw new Error(
        `board-create handler exited during startup (${child.exitCode})\n${output.stdout}\n${output.stderr}`,
      );
    }
    try {
      const response = await fetch(EDGE_ORIGIN, { signal: AbortSignal.timeout(750) });
      if (response.status === 405) return;
    } catch {
      // Handler is not listening yet.
    }
    await delay(100);
  }
  const output = diagnostics();
  throw new Error(`timed out waiting for board-create handler\n${output.stdout}\n${output.stderr}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  if (await Promise.race([exited.then(() => true), delay(2_000).then(() => false)])) return;
  child.kill('SIGKILL');
  await Promise.race([once(child, 'exit'), delay(2_000)]);
}

function makeAppSessionToken({ phone, role, staffType, fcId }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    kind: 'fc_onboarding_session',
    phone,
    role,
    ...(staffType ? { staffType } : {}),
    ...(fcId ? { fcId } : {}),
    iat: now,
    exp: now + 600,
  };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signaturePart = createHmac('sha256', DUMMY_APP_SESSION_SECRET)
    .update(payloadPart)
    .digest('base64url');
  return `${payloadPart}.${signaturePart}`;
}

async function invokeBoardCreate(body, headers = {}) {
  const response = await fetch(EDGE_ORIGIN, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: TEST_ORIGIN,
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

function dbWriteCount() {
  return scenario.dbRequests.filter(({ method }) => !['GET', 'HEAD'].includes(method)).length;
}

function actorLookupCount() {
  return scenario.dbRequests.filter(({ table, method }) => (
    method === 'GET' && ['fc_profiles', 'admin_accounts', 'manager_accounts'].includes(table)
  )).length;
}

function assertNoDbOrDownstream() {
  assert.equal(scenario.dbRequests.length, 0, 'expected no PostgREST request');
  assert.equal(scenario.downstreamRequests.length, 0, 'expected no downstream function request');
}

async function runScenario(name, test) {
  scenario = newScenarioState(name);
  await test();
  console.log(`ok - ${name}`);
}

async function runScenarios() {
  const validFcToken = makeAppSessionToken({
    phone: DUMMY_FC_PHONE,
    role: 'fc',
    fcId: 'fc-loopback-1',
  });
  const validAdminToken = makeAppSessionToken({
    phone: DUMMY_ADMIN_PHONE,
    role: 'admin',
    staffType: 'admin',
  });

  await runScenario('anon forged admin', async () => {
    const result = await invokeBoardCreate({
      actor: { role: 'admin', residentId: DUMMY_ADMIN_PHONE, displayName: 'Forged Admin' },
      categoryId: 'category-general',
      title: 'Anonymous forged post',
      content: 'Must not be written',
    });
    assert.equal(result.status, 401);
    assert.equal(result.body?.code, 'missing_app_session');
    assertNoDbOrDownstream();
  });

  await runScenario('invalid token', async () => {
    const result = await invokeBoardCreate(
      {
        actor: { role: 'admin', residentId: DUMMY_ADMIN_PHONE },
        categoryId: 'category-general',
        title: 'Invalid session post',
        content: 'Must not be written',
      },
      { 'x-app-session-token': 'invalid.loopback.token' },
    );
    assert.equal(result.status, 401);
    assert.equal(result.body?.code, 'invalid_app_session');
    assertNoDbOrDownstream();
  });

  await runScenario('valid signed FC + forged admin', async () => {
    const result = await invokeBoardCreate(
      {
        actor: { role: 'admin', residentId: DUMMY_ADMIN_PHONE, displayName: 'Forged Admin' },
        categoryId: 'category-general',
        title: 'Forged role post',
        content: 'Must not be written',
      },
      { 'x-app-session-token': validFcToken },
    );
    assert.equal(result.status, 403);
    assert.equal(result.body?.code, 'actor_mismatch');
    assert.equal(actorLookupCount(), 1, 'expected one canonical FC actor lookup');
    assert.equal(scenario.dbRequests[0]?.table, 'fc_profiles');
    assert.equal(dbWriteCount(), 0, 'expected no PostgREST write');
    assert.equal(scenario.downstreamRequests.length, 0);
  });

  await runScenario('invalid automation token', async () => {
    const result = await invokeBoardCreate(
      {
        categoryId: 'category-general',
        title: 'Invalid automation post',
        content: 'Must not be written',
      },
      { 'x-board-automation-token': 'wrong-loopback-automation-token' },
    );
    assert.equal(result.status, 401);
    assert.equal(result.body?.code, 'invalid_automation_token');
    assertNoDbOrDownstream();
  });

  await runScenario('exact automation token + non-general category', async () => {
    const result = await invokeBoardCreate(
      {
        categoryId: 'category-non-general',
        title: 'Automation must not write here',
        content: 'Must not be written',
      },
      { 'x-board-automation-token': DUMMY_AUTOMATION_TOKEN },
    );
    assert.equal(result.status, 403);
    assert.equal(result.body?.code, 'automation_forbidden');
    assert.equal(actorLookupCount(), 1, 'expected one automation admin lookup');
    assert.equal(dbWriteCount(), 0, 'expected no PostgREST write');
    assert.equal(scenario.downstreamRequests.length, 0);
  });

  await runScenario('valid signed admin create', async () => {
    const rawTitle = `Board notice API_TOKEN=${DUMMY_SECRET_VALUE}`;
    const rawContent = `Sensitive body ${DUMMY_LONG_HEX}`;
    const result = await invokeBoardCreate(
      {
        actor: {
          role: 'admin',
          residentId: DUMMY_ADMIN_PHONE,
          displayName: 'Forged Display Name',
        },
        categoryId: 'category-general',
        title: rawTitle,
        content: rawContent,
      },
      { 'x-app-session-token': validAdminToken },
    );

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, data: { id: 'post-loopback-1' } });
    assert.equal(actorLookupCount(), 1, 'expected one canonical admin actor lookup');
    assert.equal(dbWriteCount(), 2, 'expected one post write and one notification write');
    assert.equal(scenario.postWrites.length, 1);
    assert.equal(scenario.notificationWrites.length, 1);
    assert.equal(scenario.downstreamRequests.length, 2);

    const rawPost = scenario.postWrites[0];
    const post = Array.isArray(rawPost) ? rawPost[0] : rawPost;
    assert.equal(post.author_role, 'admin');
    assert.equal(post.author_resident_id, DUMMY_ADMIN_PHONE);
    assert.equal(post.author_name, 'Canonical Admin');
    assert.notEqual(post.author_name, 'Forged Display Name');
    assert.match(post.title, /API_TOKEN=\[redacted\]/);
    assert.doesNotMatch(post.title, new RegExp(DUMMY_SECRET_VALUE));
    assert.match(post.content, /\[redacted\]/);
    assert.doesNotMatch(post.content, new RegExp(DUMMY_LONG_HEX));

    const notifications = scenario.notificationWrites[0];
    assert(Array.isArray(notifications), 'expected notification batch insert');
    assert.deepEqual(
      notifications.map(({ recipient_role }) => recipient_role).sort(),
      ['admin', 'fc', 'manager'],
    );
    for (const notification of notifications) {
      assert.equal(notification.body, post.title);
      assert.equal(notification.target_url, '/board?postId=post-loopback-1');
      assert.doesNotMatch(JSON.stringify(notification), new RegExp(DUMMY_SECRET_VALUE));
      assert.doesNotMatch(JSON.stringify(notification), new RegExp(DUMMY_LONG_HEX));
    }

    assert.deepEqual(
      scenario.downstreamRequests.map(({ body }) => body.target_role).sort(),
      ['admin', 'fc'],
    );
    for (const request of scenario.downstreamRequests) {
      assert.equal(request.body.body, post.title);
      assert.equal(request.body.url, '/board?postId=post-loopback-1');
      assert.equal(request.body.skip_notification_insert, true);
      assert.equal(request.headers.authorization, `Bearer ${DUMMY_SERVICE_ROLE_KEY}`);
      assert.equal(request.headers.apikey, DUMMY_SERVICE_ROLE_KEY);
      assert.doesNotMatch(JSON.stringify(request.body), new RegExp(DUMMY_SECRET_VALUE));
      assert.doesNotMatch(JSON.stringify(request.body), new RegExp(DUMMY_LONG_HEX));
    }
  });
}

async function main() {
  let fakeServer;
  let edgeProcess;
  let diagnostics = () => ({ stdout: '', stderr: '' });

  try {
    await assertPortAvailable(EDGE_PORT);
    const fake = await startFakeSupabase();
    fakeServer = fake.server;
    const edge = startEdgeHandler(fake.url);
    edgeProcess = edge.child;
    diagnostics = edge.diagnostics;
    await waitForEdge(edgeProcess, diagnostics);
    await runScenarios();
    console.log('board-create loopback handler smoke: 6/6 passed');
  } catch (error) {
    const output = diagnostics();
    if (output.stdout.trim()) console.error(`\nboard-create stdout:\n${output.stdout.trim()}`);
    if (output.stderr.trim()) console.error(`\nboard-create stderr:\n${output.stderr.trim()}`);
    throw error;
  } finally {
    await stopChild(edgeProcess);
    await closeServer(fakeServer);
  }
}

await main();
