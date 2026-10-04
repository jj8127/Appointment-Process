import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compiled = new Map();
const FC_ID = '00000000-0000-4000-8000-000000000001';
const NOTIFICATION_ID = '00000000-0000-4000-8000-000000000003';
const PHONE = '01000000001';
const DOC_PATH = `${FC_ID}/document.pdf`;
const DOC = {
  id: 'doc-1', fc_id: FC_ID, doc_type: 'Synthetic document', file_name: 'document.pdf',
  storage_path: DOC_PATH, status: 'submitted', reviewer_note: null, created_at: '2026-10-01T00:00:00Z',
};
const PROFILE = {
  id: FC_ID, phone: PHONE, name: 'Synthetic account', affiliation: 'Test affiliation',
  signup_completed: true, status: 'hanwha-commission-approved',
  hanwha_commission_date: '2026-10-01', hanwha_commission_pdf_path: DOC_PATH, hanwha_commission_pdf_name: 'document.pdf',
  fc_documents: [DOC],
};

function harness(options = {}) {
  const calls = [];
  const browserCalls = [];
  const signatures = [];
  const pushes = [];
  const webPushes = [];
  const revalidations = [];
  const cache = new Map();
  const role = options.role ?? 'admin';
  const profile = options.storedPath ? {
    ...PROFILE, hanwha_commission_pdf_path: options.storedPath,
    fc_documents: [{ ...DOC, storage_path: options.storedPath }],
  } : PROFILE;
  const session = async ({ allowedRoles }) => options.invalidSession
    ? { ok: false, status: 401, error: 'Invalid signed session' }
    : !allowedRoles.includes(role)
      ? { ok: false, status: 403, error: 'Forbidden' }
      : { ok: true, session: { role, residentDigits: PHONE, residentId: PHONE, displayName: 'Synthetic staff' } };

  function from(table) {
    const call = { table, operation: 'select', filters: [], columns: '' };
    calls.push(call);
    const finish = async (single = false) => {
      if (table === 'notifications') return {
        data: call.operation === 'insert'
          ? { id: options.invalidNotificationId ? 'invalid-id' : NOTIFICATION_ID }
          : options.existingNotification ? { id: NOTIFICATION_ID, target: { version: 1, kind: 'onboarding_section', fcId: FC_ID, section: 'consent' } } : null,
        error: options.notificationFailure ? { code: '23514' } : null,
      };
      if (table === 'device_tokens') return { data: options.expoFailure || options.pushDevices ? [{ expo_push_token: 'synthetic-token' }] : [], error: null };
      if (table === 'web_push_subscriptions') return { data: options.pushDevices ? [{ endpoint: 'https://push.example.test', p256dh: 'synthetic-key', auth: 'synthetic-auth' }] : [], error: null };
      if (table === 'admin_accounts' || table === 'manager_accounts') return { data: single ? { id: 'synthetic-staff', active: true, staff_type: 'admin' } : [], error: null };
      if (table === 'fc_documents') {
        const doc = call.columns === 'status, storage_path' || call.columns === 'status,storage_path'
          ? { ...DOC, status: 'approved' } : DOC;
        return { data: call.operation === 'update' ? null : single ? doc : [doc], error: null };
      }
      if (table === 'fc_profiles') {
        if (call.operation === 'update') {
          return { data: { ...PROFILE, ...call.payload }, error: options.statusFailure && 'status' in call.payload ? { code: 'synthetic_status_failure' } : null };
        }
        if (options.recipientMissing && call.columns === 'id,phone') return { data: null, error: null };
        if (options.listFailure && call.columns.includes('fc_credentials')) return { data: null, error: { code: 'synthetic_list_failure' } };
        return { data: single ? profile : [profile], error: null };
      }
      throw new Error(`Unexpected table ${table}`);
    };
    const query = {
      select(columns = '*') { call.columns = columns; return query; },
      eq(column, value) { call.filters.push([column, value]); return query; },
      in(column, values) { call.filters.push([column, values]); return query; },
      order() { return query; },
      update(payload) { call.operation = 'update'; call.payload = payload; return query; },
      insert(payload) { call.operation = 'insert'; call.payload = payload; return query; },
      delete() { call.operation = 'delete'; return query; },
      maybeSingle: () => finish(true), single: () => finish(true),
      then: (resolve, reject) => finish().then(resolve, reject),
    };
    return query;
  }

  const mocks = {
    'server-only': {},
    'next/server': require('next/server'),
    'next/cache': { revalidatePath: (path) => revalidations.push(path) },
    '@/lib/logger': { logger: { error() {}, warn() {}, info() {}, debug() {} } },
    '@/lib/server-session': {
      getVerifiedServerSession: session,
      getVerifiedAdminSession: () => session({ allowedRoles: ['admin'] }),
      buildPhoneCandidates: (raw, digits) => [raw, digits],
    },
    '@/lib/csrf': { verifyOrigin: async () => ({ valid: !options.invalidOrigin }), checkRateLimit: () => ({ allowed: true }) },
    '@/lib/admin-route-auth': {
      requireAdminOrManagerReadRoute: () => session({ allowedRoles: ['admin', 'manager'] }),
      adminRouteAuthErrorResponse: (result) => Response.json({ error: 'Unauthorized' }, { status: result.status }),
    },
    '@/lib/admin-referrals': {},
    '@/lib/web-push': { sendWebPush: async (_subscriptions, payload) => {
      webPushes.push(payload);
      return { sent: 1, failed: 0, expired: [] };
    } },
    '@/lib/admin-supabase': {
      adminSupabase: {
        from,
        storage: { from: (bucket) => ({
          createSignedUrl: async (path, ttl) => {
            signatures.push({ bucket, path, ttl });
            return options.signFailure
              ? { data: null, error: new Error('synthetic signing failure') }
              : { data: { signedUrl: 'https://storage.example.test/signed-document' }, error: null };
          },
        }) },
      },
    },
  };

  async function browserFetch(url, init) {
    browserCalls.push({ url, ...init });
    assert.equal(init.credentials, 'same-origin');
    if (url === '/api/admin/list') return load('app/api/admin/list/route.ts').GET();
    if (url === '/api/admin/fc') return callFc(JSON.parse(init.body));
    throw new Error('Unexpected browser URL');
  }

  function load(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath).exports;
    if (!compiled.has(relativePath)) {
      const output = ts.transpileModule(readFileSync(resolve(srcDir, relativePath), 'utf8'), {
        fileName: relativePath, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      compiled.set(relativePath, compileFunction(output, ['exports', 'require', 'module', 'fetch', 'process']));
    }
    const loaded = { exports: {} };
    cache.set(relativePath, loaded);
    const scopedRequire = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === 'dayjs') return require(name);
      if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
      if (name.startsWith('.')) return load(relative(srcDir, resolve(srcDir, dirname(relativePath), name)).replaceAll('\\', '/') + (name.endsWith('.ts') ? '' : '.ts'));
      throw new Error(`Unexpected dependency ${name}`);
    };
    const fetch = relativePath === 'lib/admin-document-client.ts' ? browserFetch : async (url, init) => {
      pushes.push({ url, ...init });
      return Response.json({ data: [{ status: options.expoFailure ? 'error' : 'ok' }] });
    };
    compiled.get(relativePath)(loaded.exports, scopedRequire, loaded, fetch, { env: {} });
    return loaded.exports;
  }

  function callFc(body) {
    return load('app/api/admin/fc/route.ts').POST(new Request('https://app.example.test/api/admin/fc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
  }
  return { load, callFc, calls, browserCalls, signatures, pushes, webPushes, revalidations };
}

for (const role of ['admin', 'manager']) {
  test(`${role} lists documents and previews through signed server routes`, async () => {
    const h = harness({ role });
    const client = h.load('lib/admin-document-client.ts');
    const docs = await client.fetchAdminDocuments();
    assert.equal(docs[0].id, DOC.id);
    assert.equal(docs[0].fc_id, FC_ID);
    assert.equal(docs[0].created_at, DOC.created_at);
    assert.equal(docs[0].fc_profiles.name, PROFILE.name);
    const listQuery = h.calls.find((call) => call.table === 'fc_profiles' && call.columns.includes('fc_documents('));
    assert.match(listQuery.columns, /fc_documents\(id,fc_id,[^)]*created_at\)/);
    assert.equal(await client.signAdminDocument(FC_ID, DOC_PATH), 'https://storage.example.test/signed-document');
    assert.deepEqual(h.signatures, [{ bucket: 'fc-documents', path: DOC_PATH, ttl: 60 }]);
    assert.ok(h.calls.every((call) => call.operation === 'select'));
  });
}

test('signing rejects unregistered paths and mismatched document ownership', async () => {
  const h = harness({ role: 'manager' });
  const response = await h.callFc({ action: 'signDoc', payload: { fcId: FC_ID, path: 'other/private.pdf' } });
  assert.equal(response.status, 404);
  assert.equal(h.signatures.length, 0);
});

test('path-only dashboard previews retain existing document access', async () => {
  const h = harness();
  const response = await h.callFc({ action: 'signDoc', payload: { path: DOC_PATH } });
  assert.equal(response.status, 200);
  assert.equal(h.signatures.length, 1);
});

test('read failures are errors rather than empty lists or endless preview promises', async () => {
  for (const options of [{ invalidSession: true }, { listFailure: true }]) {
    const h = harness(options);
    await assert.rejects(h.load('lib/admin-document-client.ts').fetchAdminDocuments());
  }
  const h = harness({ signFailure: true });
  await assert.rejects(h.load('lib/admin-document-client.ts').signAdminDocument(FC_ID, DOC_PATH), /파일을 불러오지 못했습니다/);
});

for (const options of [{ invalidSession: true }, { role: 'manager' }, { role: 'fc' }, { invalidOrigin: true }]) {
  test(`document and appointment actions reject ${JSON.stringify(options)} before database writes`, async () => {
    const h = harness(options);
    const appointment = await h.load('app/dashboard/appointment/actions.ts').updateAppointmentAction({}, {
      fcId: FC_ID, phone: PHONE, type: 'schedule', category: 'life', value: 'October',
    });
    const document = await h.load('app/dashboard/docs/actions.ts').updateDocStatusAction({}, {
      fcId: FC_ID, phone: PHONE, docType: DOC.doc_type, status: 'approved',
    });
    assert.equal(appointment.success, false);
    assert.equal(document.success, false);
    assert.equal(h.calls.length, 0);
    assert.equal(h.pushes.length, 0);
  });
}

test('manager cannot turn read access into a document mutation', async () => {
  const h = harness({ role: 'manager' });
  const response = await h.callFc({ action: 'updateDocStatus', payload: { fcId: FC_ID, docType: DOC.doc_type, status: 'approved' } });
  assert.equal(response.status, 403);
  assert.ok(h.calls.every((call) => call.operation === 'select'));
});

test('appointment notification uses stored FC identity rather than caller phone', async () => {
  const h = harness();
  const result = await h.load('app/dashboard/appointment/actions.ts').updateAppointmentAction({}, {
    fcId: FC_ID, phone: '01000000002', type: 'schedule', category: 'life', value: 'October',
  });
  assert.equal(result.success, true);
  const insert = h.calls.find((call) => call.table === 'notifications');
  assert.equal(insert.payload.recipient_actor_id, FC_ID);
  assert.equal(insert.payload.resident_id, PHONE);
  assert.deepEqual(insert.payload.target, { version: 1, kind: 'onboarding_section', fcId: FC_ID, section: 'appointment' });
  assert.ok(h.calls.filter((call) => ['device_tokens', 'web_push_subscriptions'].includes(call.table))
    .every((call) => call.filters.some(([column, value]) => column === 'role' && value === 'fc')));
});

test('post-save workflow and notification failures remain saved success with a warning', async () => {
  for (const [options, warning] of [
    [{ notificationFailure: true }, 'notification_persistence_incomplete'],
    [{ statusFailure: true }, 'workflow_update_incomplete'],
    [{ expoFailure: true }, undefined],
  ]) {
    const h = harness(options);
    const result = await h.load('app/dashboard/appointment/actions.ts').updateAppointmentAction({}, {
      fcId: FC_ID, phone: '01000000002', type: 'confirm', category: 'life', value: '2026-10-02',
    });
    assert.equal(result.success, true);
    assert.equal(result.warning, warning);
    assert.equal(result.message, '처리 완료');
    assert.ok(h.calls.some((call) => call.operation === 'update' && call.payload.appointment_date_life));
    assert.ok(h.revalidations.includes('/dashboard/appointment'));
  }
});

test('admin document mutation sends canonical targeted notification and preserves saved failure warning', async () => {
  const h = harness({ notificationFailure: true });
  const response = await h.callFc({ action: 'updateDocStatus', payload: {
    fcId: FC_ID, docType: DOC.doc_type, status: 'rejected', reviewerNote: 'Synthetic reason', phone: '01000000002',
  } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.warning, 'notification_persistence_incomplete');
  const insert = h.calls.find((call) => call.table === 'notifications');
  assert.equal(insert.payload.recipient_actor_id, FC_ID);
  assert.equal(insert.payload.resident_id, PHONE);
  assert.equal(insert.payload.target.section, 'docs_upload');
});


