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
  created_at: '2026-09-01T00:00:00Z',
  signup_completed: true, status: 'hanwha-commission-approved',
  fc_credentials: null,
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
      if (table === 'admin_accounts' || table === 'manager_accounts') return {
        data: !single && options.nullManagerList ? null : single
          ? { id: 'synthetic-staff', active: true, staff_type: 'admin' }
          : [],
        error: null,
      };
      if (table === 'fc_documents') {
        const doc = call.columns === 'status, storage_path' || call.columns === 'status,storage_path'
          ? { ...DOC, status: 'approved' } : DOC;
        if (call.operation === 'update') {
          return {
            data: options.docUpdateMissing ? null : {
              ...DOC,
              ...call.payload,
              ...(options.docUpdateMismatch ? { status: 'submitted' } : {}),
            },
            error: null,
          };
        }
        if (options.nullDocWorkflow && call.columns.includes('id,fc_id,status,storage_path')) {
          return { data: null, error: null };
        }
        return { data: single ? doc : [doc], error: null };
      }
      if (table === 'fc_profiles') {
        if (call.operation === 'update') {
          const updated = {
            ...PROFILE,
            ...call.payload,
            ...(options.appointmentUpdateMismatch && 'appointment_date_life' in call.payload
              ? { appointment_date_life: '2026-10-01' }
              : {}),
          };
          const statusMutation = 'status' in call.payload;
          return {
            data: statusMutation && options.statusReceiptMissing
              ? null
              : single ? updated : options.workflowProfileUpdateMissing ? [] : [updated],
            error: options.statusFailure && statusMutation ? { code: 'synthetic_status_failure' } : null,
          };
        }
        if (options.recipientMissing && call.columns === 'id,phone') return { data: null, error: null };
        if (options.listFailure && call.columns.includes('fc_credentials')) return { data: null, error: { code: 'synthetic_list_failure' } };
        if (options.nullProfileList && call.columns.includes('fc_credentials')) return { data: null, error: null };
        return { data: single ? profile : [profile], error: null };
      }
      throw new Error(`Unexpected table ${table}`);
    };
    const query = {
      select(columns = '*') { call.columns = columns; return query; },
      eq(column, value) { call.filters.push([column, value]); return query; },
      in(column, values) { call.filters.push([column, values]); return query; },
      order() { return query; },
      range(from, to) { call.range = [from, to]; return query; },
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
              : { data: { signedUrl: options.signedUrl ?? 'https://storage.example.test/signed-document' }, error: null };
          },
        }) },
      },
    },
  };

  async function browserFetch(url, init) {
    browserCalls.push({ url, ...init });
    assert.equal(init.credentials, 'same-origin');
    if (url === '/api/admin/list') {
      const response = await load('app/api/admin/list/route.ts').GET();
      if (options.malformedList && response.ok) return Response.json({ ok: true });
      if (options.wrappedList && response.ok) return Response.json({ data: await response.json() });
      if (options.missingDocuments && response.ok) {
        const rows = await response.json();
        return Response.json(rows.map((row) => {
          const malformedRow = { ...row };
          delete malformedRow.fc_documents;
          return malformedRow;
        }));
      }
      if (options.malformedRow && response.ok) {
        return Response.json([{}]);
      }
      if (options.malformedDocument && response.ok) {
        return Response.json([{ ...PROFILE, fc_documents: [{}] }]);
      }
      return response;
    }
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
      if (name.startsWith('@shared/')) return load(`../../${name.slice('@shared/'.length)}.ts`);
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

test('FC list client accepts the documented array and data-envelope contracts', async () => {
  const h = harness();
  const client = h.load('lib/admin-document-client.ts');
  const profiles = await client.fetchAdminFcList(client.isAdminFcProfile);
  assert.equal(profiles[0].id, FC_ID);
  assert.deepEqual(
    h.calls.find((call) => call.table === 'fc_profiles' && call.columns.includes('fc_credentials'))?.range,
    [0, 499],
  );
  assert.equal((await client.fetchAdminDocuments())[0].id, DOC.id);
  const wrappedClient = harness({ wrappedList: true }).load('lib/admin-document-client.ts');
  assert.equal((await wrappedClient.fetchAdminFcList(wrappedClient.isAdminFcProfile))[0].id, FC_ID);
  const envelopeClient = harness({ malformedList: true }).load('lib/admin-document-client.ts');
  await assert.rejects(envelopeClient.fetchAdminFcList(envelopeClient.isAdminFcProfile));
});

test('FC list and detail selects expose only the browser contract', async () => {
  const h = harness();
  const client = h.load('lib/admin-document-client.ts');
  await client.fetchAdminFcList(client.isAdminFcProfile);
  await h.callFc({ action: 'getProfile', payload: { fcId: FC_ID } });

  const selectedColumns = h.calls
    .filter((call) => call.table === 'fc_profiles')
    .map((call) => call.columns)
    .filter(Boolean);
  assert.ok(selectedColumns.some((value) => value.includes('fc_credentials(password_set_at)')));
  assert.ok(selectedColumns.some((value) => value.includes('admin_memo')));
  for (const value of selectedColumns) {
    assert.doesNotMatch(value, /(^|,)\s*\*\s*(,|$)/);
    assert.doesNotMatch(value, /resident_id_hash|resident_id_masked|verification_hash|password_hash|otp/i);
  }
});

test('all FC list consumers reject successful rows without the selected documents relation', async () => {
  const client = harness({ missingDocuments: true }).load('lib/admin-document-client.ts');
  await assert.rejects(
    client.fetchAdminFcList(client.isAdminFcProfile),
    (error) => error?.name === 'QueryReadError' && error.status === undefined,
  );
  await assert.rejects(
    client.fetchAdminDocuments(),
    (error) => error?.name === 'QueryReadError' && error.status === undefined,
  );
});

test('document cleanup acknowledgements require an explicit pending boolean', () => {
  const client = harness().load('lib/admin-document-client.ts');
  assert.equal(client.isAdminCleanupPendingResponse({ ok: true, cleanupPending: false }), true);
  assert.equal(client.isAdminCleanupPendingResponse({ ok: true, cleanupPending: true }), true);
  assert.equal(client.isAdminCleanupPendingResponse({ ok: true }), false);
  assert.equal(client.isAdminCleanupPendingResponse({ ok: true, cleanupPending: 'false' }), false);
});

test('FC detail guard requires the rendered profile and document contract', () => {
  const client = harness().load('lib/admin-document-client.ts');
  const detail = { ...PROFILE, admin_memo: null };
  assert.equal(client.isAdminFcProfileDetail(detail), true);
  assert.equal(client.isAdminFcProfileDetail({}), false);
  assert.equal(client.isAdminFcProfileDetail({ ...detail, admin_memo: 7 }), false);
  assert.equal(client.isAdminFcProfileDetail({ ...detail, fc_documents: undefined }), false);
  assert.equal(client.isAdminFcProfileDetail({ ...detail, fc_documents: [{}] }), false);
  assert.equal(client.isAdminFcProfileDetail({
    ...detail,
    fc_documents: [{ ...DOC, created_at: null }],
  }), false);
});

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
  const unauthorizedClient = harness({ invalidSession: true }).load('lib/admin-document-client.ts');
  await assert.rejects(
    unauthorizedClient.fetchAdminDocuments(),
    (error) => error?.name === 'QueryReadError' && error.status === 401,
  );
  for (const options of [
    { listFailure: true },
    { nullProfileList: true },
    { nullManagerList: true },
    { malformedList: true },
    { malformedRow: true },
    { malformedDocument: true },
  ]) {
    const h = harness(options);
    await assert.rejects(
      h.load('lib/admin-document-client.ts').fetchAdminDocuments(),
      (error) => error?.name === 'QueryReadError'
        && error.status === (
          options.listFailure || options.nullProfileList || options.nullManagerList ? 500 : undefined
        ),
    );
  }
  const h = harness({ signFailure: true });
  await assert.rejects(h.load('lib/admin-document-client.ts').signAdminDocument(FC_ID, DOC_PATH), /파일을 불러오지 못했습니다/);
});

test('signed document previews accept only credential-free HTTPS URLs', async () => {
  for (const signedUrl of [
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'http://storage.example.test/signed-document',
    'https://user:secret@storage.example.test/signed-document',
  ]) {
    const client = harness({ signedUrl }).load('lib/admin-document-client.ts');
    await assert.rejects(
      client.signAdminDocument(FC_ID, DOC_PATH),
      /파일을 불러오지 못했습니다/,
    );
  }
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

test('W08: manager profile, document request, deletion, and approval writes fail before mutations', async () => {
  for (const action of ['updateProfile', 'updateDocsRequest', 'deleteDoc', 'deleteHanwhaPdf', 'deleteFc', 'updateAppointmentDate', 'updateStatus']) {
    const h = harness({ role: 'manager' });
    const response = await h.callFc({ action, payload: { fcId: FC_ID, data: { name: 'Synthetic' }, docType: DOC.doc_type, status: 'approved' } });
    assert.equal(response.status, 403, action);
    assert.ok(h.calls.every((call) => call.operation === 'select'), action);
    assert.equal(h.pushes.length, 0);
  }
});

test('admin profile updates use an explicit receipt and reject arbitrary profile columns', async () => {
  const allowed = harness();
  const allowedResponse = await allowed.callFc({
    action: 'updateProfile',
    payload: { fcId: FC_ID, data: { career_type: '경력' } },
  });
  assert.equal(allowedResponse.status, 200);
  const updateCall = allowed.calls.find((call) => call.table === 'fc_profiles' && call.operation === 'update');
  assert.ok(updateCall);
  assert.doesNotMatch(updateCall.columns, /\*/);
  assert.doesNotMatch(updateCall.columns, /resident|password|otp|hash/i);

  const rejected = harness();
  const rejectedResponse = await rejected.callFc({
    action: 'updateProfile',
    payload: { fcId: FC_ID, data: { resident_id_masked: 'sensitive' } },
  });
  assert.equal(rejectedResponse.status, 400);
  assert.equal(
    rejected.calls.filter((call) => call.table === 'fc_profiles' && call.operation === 'update').length,
    0,
  );
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
    [{ statusReceiptMissing: true }, 'workflow_update_incomplete'],
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

test('appointment actions reject a request-mismatched primary receipt before workflow and notification effects', async () => {
  const h = harness({ appointmentUpdateMismatch: true });
  const result = await h.load('app/dashboard/appointment/actions.ts').updateAppointmentAction({}, {
    fcId: FC_ID, phone: PHONE, type: 'confirm', category: 'life', value: '2026-10-02',
  });
  assert.equal(result.success, false);
  assert.match(result.error, /위촉 정보를 업데이트하지 못했습니다/);
  assert.equal(h.pushes.length, 0);
  assert.equal(h.revalidations.length, 0);
  assert.equal(h.calls.filter((call) => call.table === 'fc_profiles' && call.operation === 'update').length, 1);
});

test('document decisions require an exact updated row before workflow or notification effects', async () => {
  for (const options of [{ docUpdateMissing: true }, { docUpdateMismatch: true }]) {
    const h = harness(options);
    const result = await h.load('app/dashboard/docs/actions.ts').updateDocStatusAction({}, {
      fcId: FC_ID, phone: PHONE, docType: DOC.doc_type, status: 'approved',
    });
    assert.equal(result.success, false);
    assert.match(result.error, /서류 상태를 업데이트하지 못했습니다/);
    assert.equal(h.pushes.length, 0);
    assert.equal(h.revalidations.length, 0);
  }
});

test('document workflow null success keeps the committed decision visible with a warning', async () => {
  const h = harness({ nullDocWorkflow: true });
  const result = await h.load('app/dashboard/docs/actions.ts').updateDocStatusAction({}, {
    fcId: FC_ID, phone: PHONE, docType: DOC.doc_type, status: 'approved',
  });
  assert.equal(result.success, true);
  assert.equal(result.warning, 'workflow_update_incomplete');
  assert.equal(result.status, 'approved');
  assert.equal(result.reviewerNote, null);
  assert.equal(result.allApproved, null);
  assert.equal(h.pushes.length, 0);
});

test('document workflow requires one exact profile update receipt after the committed decision', async () => {
  const h = harness({ workflowProfileUpdateMissing: true });
  const response = await h.callFc({ action: 'updateDocStatus', payload: {
    fcId: FC_ID, docType: DOC.doc_type, status: 'approved', phone: PHONE,
  } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.warning, 'workflow_update_incomplete');
  assert.equal(result.allApproved, null);
  assert.equal(h.pushes.length, 0);
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
  assert.equal(result.status, 'rejected');
  assert.equal(result.reviewerNote, 'Synthetic reason');
  assert.equal(result.allApproved, false);
  const insert = h.calls.find((call) => call.table === 'notifications');
  assert.equal(insert.payload.recipient_actor_id, FC_ID);
  assert.equal(insert.payload.resident_id, PHONE);
  assert.equal(insert.payload.target.section, 'docs_upload');
});


