import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { classifyFcNotifyDeliveryResult } from '../../../lib/fc-notify-delivery-result.ts';
import { requireExamTransitionReceipt } from '../../../supabase/functions/_shared/ux-mutation-contract.ts';
import { isBoardSuccess } from './upstream-response-policy.ts';
import { collectSupabaseRows, requireSupabaseRows } from './supabase-query-contract.ts';
import { normalizeAdminTempId, resolveAdminTempIdUpdate } from './admin-temp-id-update.ts';
import {
  isNonEmptyResponseString,
  isHttpsResponseUrl,
  isValidCareerType,
  isValidFcStatusResponse,
  isValidYmdResponse,
  requireCleanupMutationReceipt,
  requireMutationSuccess,
  requireProfileMutationReceipt,
} from './user-intent-policy.ts';

function syntax(relative) {
  const text = readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
  return ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function extract(relative, name) {
  const source = syntax(relative);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      found = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, name);
  return found.getText(source);
}
function extractIfBranch(relative, condition) {
  const source = syntax(relative);
  let found;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(source) === condition) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, condition);
  return found.getText(source);
}
function effect(relative, contains) {
  const source = syntax(relative);
  let found;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
        && node.arguments[0].getText(source).includes(contains)) found = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, contains);
  return found.getText(source);
}
function execute(code, values) {
  const output = ts.transpileModule(`const callback = ${code}; callback;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return vm.runInNewContext(output, { exports: {}, ...values, require: () => ({ jsx: () => null }) });
}
const noNotifications = { show() {} };

test('exam decision delivery requires the canonical persisted notification receipt', async () => {
  const registrationId = '00000000-0000-4000-8000-000000000001';
  const notificationId = '00000000-0000-4000-8000-000000000002';
  const recipientActorId = '00000000-0000-4000-8000-000000000003';
  let transport;
  const send = execute(extract('app/api/admin/exam-applicants/route.ts', 'sendExamDecisionPush'), {
    adminSupabase: { functions: { invoke: async () => transport } },
    classifyFcNotifyDeliveryResult,
    UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  });
  const transition = {
    registration_id: registrationId,
    status: 'confirmed',
    proof_path: null,
    target_resident_id: '01000000001',
    exam_type: 'life',
    notification_id: notificationId,
    recipient_actor_id: recipientActorId,
  };
  const canonical = {
    ok: true,
    confirmed: true,
    stored: true,
    logged: true,
    notificationId,
    delivery: {
      notificationStored: true,
      pushStatus: 'no_registered_device',
      retryable: false,
      notificationId,
    },
  };

  transport = { data: canonical, error: null };
  assert.equal(await send(transition, registrationId, 'confirm', null), false);

  for (const data of [
    null,
    { ...canonical, ok: false },
    { ...canonical, confirmed: false },
    { ...canonical, stored: false },
    { ...canonical, notificationId: '00000000-0000-4000-8000-000000000004' },
    { ok: true },
  ]) {
    transport = { data, error: null };
    assert.equal(await send(transition, registrationId, 'confirm', null), true);
  }

  transport = { data: canonical, error: new Error('synthetic transport failure') };
  assert.equal(await send(transition, registrationId, 'confirm', null), true);
});

test('memo-triggered profile refetch cannot overwrite a basic/recommender draft', () => {
  let writes = 0;
  const values = {
    profile: { name: 'stored', admin_memo: 'new memo' }, fcId: 'same-owner',
    hydratedOwner: { current: 'same-owner' }, isEditing: true, isEditingRecommender: false,
    form: { isDirty: () => true, setValues: () => writes++, resetDirty() {} },
    setSelectedRecommenderFcId() {}, setClearRecommenderSelection() {},
    setRecommenderOverrideReason() {}, setIsEditingRecommender() {},
  };
  execute(effect('app/dashboard/profile/[id]/page.tsx', 'form.setValues'), values)();
  assert.equal(writes, 0);
});

test('independent memo draft survives profile refresh, but an unchanged memo updates', () => {
  let memo = 'typed memo';
  const values = {
    profile: { admin_memo: 'changed elsewhere' }, fcId: 'owner',
    memoSource: { current: { owner: 'owner', value: 'old memo' } },
    setMemoDraft: (update) => { memo = update(memo); },
  };
  execute(effect('app/dashboard/profile/[id]/page.tsx', 'storedMemo'), values)();
  assert.equal(memo, 'typed memo');
  memo = 'old memo'; values.memoSource.current.value = 'old memo';
  execute(effect('app/dashboard/profile/[id]/page.tsx', 'storedMemo'), values)();
  assert.equal(memo, 'changed elsewhere');
});

test('canceling composer discard keeps the draft and attachment; busy create cannot close', () => {
  let closes = 0; let prompts = 0;
  const values = { createPostMutation: { isPending: false }, updatePostMutation: { isPending: false },
    pendingAttachmentRetry: null, newPost: { title: 'draft', content: 'body' }, attachments: [{}], editingPostId: null,
    window: { confirm: () => { prompts++; return false; } }, close: () => closes++, notifications: noNotifications };
  execute(extract('app/dashboard/board/page.tsx', 'handleCloseComposer'), values)();
  assert.equal(closes, 0); assert.equal(prompts, 1);
  values.createPostMutation.isPending = true;
  execute(extract('app/dashboard/board/page.tsx', 'handleCloseComposer'), values)();
  assert.equal(closes, 0); assert.equal(prompts, 1);
});

test('exam draft cancel and in-flight save cannot reset the form', () => {
  let resets = 0; let closes = 0;
  const values = { saveMutation: { isPending: false }, form: { isDirty: () => true, reset: () => resets++ },
    window: { confirm: () => false }, close: () => closes++, setEditingId() {} };
  const close = execute(extract('app/dashboard/exam/schedule/page.tsx', 'handleClose'), values);
  close(); assert.equal(resets, 0); assert.equal(closes, 0);
  values.saveMutation.isPending = true; close(); assert.equal(resets, 0);
  close(true); assert.equal(resets, 1); assert.equal(closes, 1);
});

for (const relative of ['app/dashboard/notifications/create/page.tsx', 'app/dashboard/notifications/[id]/edit/page.tsx']) {
  test(`${relative}: slow upload owns submitting until save and blocks a second submission`, async () => {
    let release; let uploads = 0; let saves = 0; let pending = false;
    const waiting = new Promise((resolve) => { release = resolve; });
    const submit = execute(extract(relative, 'handleSubmit'), {
      submittingRef: { current: false }, setSubmitting: (value) => { pending = value; }, setSubmitPhase() {},
      images: [{}], files: [], newImages: [{}], newFiles: [], existingImages: [], existingFiles: [], id: 'synthetic',
      uploadToSupabase: async () => { uploads++; await waiting; return 'https://example.test/file'; },
      FormData, form: { setErrors() {} }, notifications: noNotifications, logger: { error() {} },
      createNoticeAction: async () => { saves++; return { success: false }; },
      updateNoticeAction: async () => { saves++; return { success: false }; },
    });
    const first = submit({ category: 'test', title: 'draft', body: 'body' });
    await submit({ category: 'test', title: 'duplicate', body: 'body' });
    assert.equal(pending, true); assert.equal(uploads, 1); assert.equal(saves, 0);
    release(); await first; assert.equal(pending, false); assert.equal(saves, 1);
  });
}

test('pinned notice X error releases pending even when the original message is outside the window', async () => {
  const states = [];
  const clear = execute(extract('app/dashboard/group-chat/page.tsx', 'handleClearNotice'), {
    canManageNotice: true, noticeUpdating: false, setNoticeUpdating: (value) => states.push(value),
    groupChatClearNotice: async () => { throw new Error('synthetic failure'); }, showGroupChatErrorNotification() {}, setNotice() {},
  });
  await clear(); assert.deepEqual(states, [true, false]);
});

test('round filter is applied before the global read limit', async () => {
  const calls = [];
  const query = { select() { return this; }, eq(field, value) { calls.push(['eq', field, value]); return this; },
    order() { return this; }, range(start, end) { calls.push(['range', start, end]); return Promise.resolve({ data: [], error: null }); } };
  const read = execute(extract('app/api/admin/exam-applicants/route.ts', 'readRegistrationRows'), {
    adminSupabase: { from: () => query },
    EXAM_REGISTRATION_SELECT: 'synthetic',
    collectSupabaseRows,
    isExamRegistrationRow: () => true,
  });
  await read(undefined, 'selected-round');
  assert.deepEqual(calls, [['eq', 'round_id', 'selected-round'], ['range', 0, 499]]);
});

test('exam applicant reads reject null successful collections instead of reporting an empty list', async () => {
  const read = execute(extract('app/api/admin/exam-applicants/route.ts', 'readRegistrationRows'), {
    EXAM_REGISTRATION_SELECT: 'synthetic',
    collectSupabaseRows,
    isExamRegistrationRow: () => true,
    adminSupabase: {
      from: () => ({
        select() { return this; },
        order() { return this; },
        range: async () => ({ data: null, error: null }),
      }),
    },
  });
  await assert.rejects(read(), /exam_registrations_page_query_contract_invalid/);

  const historyRead = execute(extract('app/api/admin/exam-applicants/route.ts', 'readRegistrationRows'), {
    EXAM_REGISTRATION_SELECT: 'synthetic',
    collectSupabaseRows,
    isExamRegistrationRow: () => true,
    adminSupabase: {
      from: () => ({
        select() { return this; },
        eq() { return this; },
        lte() { return this; },
        order() { return this; },
        maybeSingle: async () => ({
          data: { created_at: '2026-10-13T00:00:00.000Z', resident_id: 'synthetic-resident' },
          error: null,
        }),
        range: async () => ({ data: null, error: null }),
      }),
    },
  });
  await assert.rejects(historyRead('synthetic-registration'), /exam_registration_history_page_query_contract_invalid/);

  const listApplicants = execute(extract('app/api/admin/exam-applicants/route.ts', 'listApplicants'), {
    adminSupabase: {
      from: () => ({
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        range: async () => ({ data: null, error: null }),
      }),
    },
    applyExamApplicantApplicationTypes: (rows) => rows,
    buildExamApplicantBaseRows: (rows) => rows,
    buildExamApplicantPhoneCandidates: () => ['01000000000'],
    buildPhoneCandidates: () => ['01000000000'],
    readRegistrationRows: async () => [{ id: 'synthetic-registration', round_id: 'synthetic-round' }],
    collectSupabaseRows,
    isExamApplicantProfileRow: () => true,
  });
  await assert.rejects(
    listApplicants('01000000000'),
    /exam_applicant_profiles_page_query_contract_invalid/,
  );
});

test('exam applicant navigation preserves the database timestamp precision', async () => {
  const registrationId = '11111111-1111-4111-8111-111111111111';
  const createdAt = '2026-10-13T00:00:00.123456+00:00';
  const tupleFilters = [];
  const readNavigation = execute(extract('app/api/admin/exam-applicants/route.ts', 'readApplicantNavigation'), {
    adminSupabase: {
      from: () => {
        let isNeighborQuery = false;
        return {
          select() { return this; },
          eq() { return this; },
          or(filter) { isNeighborQuery = true; tupleFilters.push(filter); return this; },
          order() { return this; },
          limit() { return this; },
          maybeSingle: async () => isNeighborQuery
            ? { data: null, error: null }
            : { data: { id: registrationId, created_at: createdAt }, error: null },
        };
      },
    },
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(await readNavigation(registrationId))),
    { previousId: null, nextId: null },
  );
  assert.equal(tupleFilters.length, 2);
  assert.ok(tupleFilters.every((filter) => filter.includes(createdAt)));
  assert.ok(tupleFilters.every((filter) => !filter.includes('00.123Z')));
});

test('exam applicant navigation rejects an invalid anchor before neighbor reads', async () => {
  const registrationId = '11111111-1111-4111-8111-111111111111';
  let neighborReads = 0;
  const readNavigation = execute(extract('app/api/admin/exam-applicants/route.ts', 'readApplicantNavigation'), {
    adminSupabase: {
      from: () => ({
        select() { return this; },
        eq() { return this; },
        or() { neighborReads += 1; return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle: async () => ({
          data: { id: registrationId, created_at: 'not-a-timestamp' },
          error: null,
        }),
      }),
    },
  });

  await assert.rejects(
    readNavigation(registrationId),
    /exam_registration_navigation_anchor_contract_invalid/,
  );
  assert.equal(neighborReads, 0);
});

test('exam transition boundary accepts only supported admin actions and maps known database errors', () => {
  const parseAction = execute(extract('app/api/admin/exam-applicants/route.ts', 'parseAdminExamTransitionAction'), {});
  assert.equal(parseAction('confirm', undefined), 'confirm');
  assert.equal(parseAction(undefined, false), 'unconfirm');
  assert.equal(parseAction('invalid_action', undefined), null);
  assert.equal(parseAction(42, undefined), null);

  const details = execute(extract('app/api/admin/exam-applicants/route.ts', 'getExamTransitionErrorDetails'), {});
  assert.equal(JSON.stringify(details({ message: 'exam_registration_not_found' })), JSON.stringify({
    message: '시험 신청 내역을 찾을 수 없습니다.',
    status: 404,
  }));
  assert.equal(JSON.stringify(details({ message: 'exam_transition_forbidden' })), JSON.stringify({
    message: '시험 신청 상태를 변경할 권한이 없습니다.',
    status: 403,
  }));
  assert.equal(JSON.stringify(details({ message: 'terminal_exam_registration' })), JSON.stringify({
    message: '완료되었거나 불참 처리된 시험 신청은 변경할 수 없습니다.',
    status: 409,
  }));
  assert.equal(JSON.stringify(details({ message: 'invalid_exam_transition' })), JSON.stringify({
    message: '현재 상태에서는 요청한 시험 신청 상태로 변경할 수 없습니다.',
    status: 409,
  }));
  assert.equal(details({ message: 'private_database_detail' }), null);

  const registrationId = '11111111-1111-4111-8111-111111111111';
  const validReceipt = {
    registration_id: registrationId,
    status: 'confirmed',
    proof_path: null,
    target_resident_id: '01000000001',
    exam_type: 'life',
    notification_id: null,
    recipient_actor_id: null,
  };
  assert.throws(
    () => requireExamTransitionReceipt(null, registrationId, 'confirm'),
    /mutation_receipt_unverified/,
  );
  assert.throws(
    () => requireExamTransitionReceipt([], registrationId, 'confirm'),
    /mutation_receipt_unverified/,
  );
  assert.throws(
    () => requireExamTransitionReceipt([{ ...validReceipt, status: 'applied' }], registrationId, 'confirm'),
    /mutation_receipt_unverified/,
  );
  assert.throws(
    () => requireExamTransitionReceipt([{ ...validReceipt, registration_id: '22222222-2222-4222-8222-222222222222' }], registrationId, 'confirm'),
    /mutation_receipt_unverified/,
  );
  assert.equal(
    requireExamTransitionReceipt([{ ...validReceipt, registration_id: registrationId.toUpperCase() }], registrationId, 'confirm').status,
    'confirmed',
  );
});

test('exam mutations reject malformed registration UUIDs before calling the transition RPC', async () => {
  const parseAction = execute(extract('app/api/admin/exam-applicants/route.ts', 'parseAdminExamTransitionAction'), {});
  const uuidPattern = execute(extract('app/api/admin/exam-applicants/route.ts', 'UUID_PATTERN'), {});
  let rpcCalls = 0;
  const dependencies = {
    adminSupabase: { rpc: () => { rpcCalls += 1; } },
    checkRateLimit: () => ({ allowed: true }),
    getAdminSession: async () => ({
      ok: true,
      session: { residentId: '01000000000' },
    }),
    logger: { error() {} },
    NextResponse: {
      json: (body, options) => ({ body, status: options?.status ?? 200 }),
    },
    parseAdminExamTransitionAction: parseAction,
    SECURITY_HEADERS: {},
    UUID_PATTERN: uuidPattern,
  };
  const patch = execute(
    extract('app/api/admin/exam-applicants/route.ts', 'PATCH').replace(/^export\s+/, ''),
    dependencies,
  );
  const remove = execute(
    extract('app/api/admin/exam-applicants/route.ts', 'DELETE').replace(/^export\s+/, ''),
    dependencies,
  );

  const patchResponse = await patch({
    json: async () => ({ action: 'confirm', registrationId: 'not-a-uuid' }),
  });
  const deleteResponse = await remove({
    json: async () => ({ registrationId: 'not-a-uuid' }),
  });

  assert.equal(patchResponse.status, 400);
  assert.equal(deleteResponse.status, 400);
  assert.equal(patchResponse.body.error, '유효하지 않은 시험 신청 식별자입니다.');
  assert.equal(deleteResponse.body.error, '유효하지 않은 시험 신청 식별자입니다.');
  assert.equal(rpcCalls, 0);
});

test('exam admin actor lookup distinguishes database failure from a real missing account', async () => {
  let result = { data: null, error: null };
  const query = {
    select() { return this; },
    in() { return this; },
    eq() { return this; },
    maybeSingle() { return Promise.resolve(result); },
  };
  const resolveAdminActor = execute(extract('app/api/admin/exam-applicants/route.ts', 'resolveAdminActor'), {
    adminSupabase: { from: () => query },
    buildPhoneCandidates: () => ['01000000000'],
  });

  assert.equal(await resolveAdminActor('01000000000'), null);
  result = { data: null, error: new Error('private database detail') };
  await assert.rejects(resolveAdminActor('01000000000'), /private database detail/);
});


test('real board client rejects missing saved/data instead of synthesizing completion', async () => {
  let payload = { ok: true };
  const invoke = execute(extract('lib/board-api.ts', 'invokeBoardResponse'), {
    isBoardSuccess, fetch: async () => ({ ok: true, status: 200, json: async () => payload }),
  });
  await assert.rejects(invoke('board-update', {}), /처리 결과/);
  await assert.rejects(invoke('board-create', {}), /처리 결과/);
  await assert.rejects(invoke('board-list', {}), /처리 결과/);
  payload = { ok: true, saved: true };
  assert.equal((await invoke('board-update', {})).saved, true);
  const postId = '33333333-3333-4333-8333-333333333333';
  payload = { ok: true, data: { postId, cleanupPending: false } };
  assert.equal((await invoke('board-delete', { postId })).ok, true);
});


test('cleanup status projects a real migration column and enforces profile scope before querying', async () => {
  const migration = readFileSync(new URL('../../../supabase/migrations/20261009065353_ux_priority_one_atomic_mutations.sql', import.meta.url), 'utf8');
  const columns = [...migration.match(/create table if not exists public\.fc_document_cleanup_queue \(([\s\S]*?)\);/)[1].matchAll(/^\s*(\w+)\s+(?:text|uuid|timestamptz)\b/gm)].map((match) => match[1]);
  const source = syntax('app/api/admin/fc/route.ts');
  let branch;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(source) === "action === 'getDocumentCleanupStatus'") branch = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(branch);
  let queries = 0; let denied = null; let count = 1;
  const handler = execute(`async () => { ${branch} }`, {
    action: 'getDocumentCleanupStatus', payload: { fcId: 'synthetic-fc' }, sessionCheck: { session: { role: 'admin' } },
    requireFcProfileScope: async () => denied, badRequest: (error) => ({ error }),
    NextResponse: { json: (value) => value },
    adminSupabase: { from(table) {
      queries++; assert.equal(table, 'fc_document_cleanup_queue');
      return { select(column, options) {
        assert.ok(columns.includes(column), `Unknown queue column: ${column}`);
        assert.equal(column, 'storage_path'); assert.equal(options.head, true); assert.equal(options.count, 'exact');
        return { eq: async (field, value) => { assert.equal(field, 'fc_id'); assert.equal(value, 'synthetic-fc'); return { count, error: null }; } };
      } };
    } },
  });
  assert.equal((await handler()).cleanupPending, true);
  count = 0; assert.equal((await handler()).cleanupPending, false);
  count = null; assert.equal((await handler()).ok, false);
  count = undefined; assert.equal((await handler()).ok, false);
  denied = { status: 403 }; assert.equal((await handler()).status, 403); assert.equal(queries, 4);
});

test('admin FC document reads fail closed when Supabase returns null without an error', async () => {
  const dependencies = {
    readAdminDocumentWorkflowRows: async (_fcId, queryName) => {
      throw new Error(`${queryName}_query_contract_invalid`);
    },
  };
  const syncWorkflow = execute(extract('app/api/admin/fc/route.ts', 'syncProfileAfterDocMutation'), dependencies);
  const allApproved = execute(extract('app/api/admin/fc/route.ts', 'areAllRequestedDocsApproved'), dependencies);

  await assert.rejects(syncWorkflow('synthetic-fc'), /admin_fc_document_workflow_query_contract_invalid/);
  await assert.rejects(allApproved('synthetic-fc'), /admin_fc_requested_documents_query_contract_invalid/);

  const signDocBranch = extractIfBranch('app/api/admin/fc/route.ts', "action === 'signDoc'");
  const signDoc = execute(`async () => { ${signDocBranch} }`, {
    action: 'signDoc',
    payload: { fcId: 'synthetic-fc', path: 'documents/synthetic.pdf' },
    normalizeFcDocumentStoragePath: (value) => value,
    requireFcProfileScope: async () => null,
    requireSupabaseRows,
    sessionCheck: { session: { role: 'admin' } },
    adminSupabase: {
      from: () => ({
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({
          data: { hanwha_commission_pdf_path: null, fc_documents: null },
          error: null,
        }),
      }),
    },
  });
  await assert.rejects(signDoc(), /admin_fc_document_owner_query_contract_invalid/);
});

test('admin FC mutation receipts reject missing and mismatched database results', () => {
  const requireReceipt = execute(extract('app/api/admin/fc/route.ts', 'requireFcMutationReceipt'), {});
  const requireSingleReceipt = execute(
    extract('app/api/admin/fc/route.ts', 'requireSingleFcMutationReceipt'),
    { requireFcMutationReceipt: requireReceipt, requireSupabaseRows },
  );
  const expected = { status: 'docs-approved', updated_at: '2026-10-13T00:00:00.000Z' };

  assert.throws(
    () => requireReceipt(null, expected, 'synthetic_update'),
    /synthetic_update_mutation_receipt_invalid/,
  );
  assert.throws(
    () => requireReceipt({ ...expected, status: 'docs-pending' }, expected, 'synthetic_update'),
    /synthetic_update_mutation_receipt_invalid/,
  );
  assert.equal(
    requireReceipt(
      { ...expected, updated_at: '2026-10-13T09:00:00.000+09:00' },
      expected,
      'synthetic_update',
    ).status,
    'docs-approved',
  );
  assert.throws(
    () => requireSingleReceipt([], expected, 'synthetic_update'),
    /synthetic_update_mutation_receipt_invalid/,
  );
  assert.throws(
    () => requireSingleReceipt([expected, expected], expected, 'synthetic_update'),
    /synthetic_update_mutation_receipt_invalid/,
  );
  assert.throws(
    () => requireSingleReceipt([{ ...expected, status: 'docs-pending' }], expected, 'synthetic_update'),
    /synthetic_update_mutation_receipt_invalid/,
  );
});

test('admin FC profile updates require a returned or reloaded profile before success', async () => {
  const requireReceipt = execute(extract('app/api/admin/fc/route.ts', 'requireFcMutationReceipt'), {});
  const branch = extractIfBranch('app/api/admin/fc/route.ts', "action === 'updateProfile'");
  let notificationCalls = 0;

  async function runProfileUpdate(data) {
    const handler = execute(`async () => { ${branch} }`, {
      action: 'updateProfile',
      ADMIN_PROFILE_UPDATE_FIELDS: new Set([
        'career_type',
        'temp_id',
        'status',
        'allowance_date',
        'allowance_prescreen_requested_at',
        'allowance_reject_reason',
        'life_commission_completed',
        'nonlife_commission_completed',
      ]),
      ADMIN_PROFILE_UPDATE_RECEIPT_SELECT: 'id,name,recommender,recommender_fc_id,career_type,temp_id,status,allowance_date,allowance_prescreen_requested_at,allowance_reject_reason,life_commission_completed,nonlife_commission_completed',
      adminSupabase: {
        from: () => ({
          eq() { return this; },
          maybeSingle: async () => ({ data: null, error: null }),
          select() { return this; },
          update() { return this; },
        }),
      },
      badRequest: (error) => ({ error }),
      hasRetiredLegacyRecommenderMutationFields: () => false,
      isValidCareerType: () => true,
      notificationResponse: () => ({}),
      payload: { data, fcId: 'synthetic-fc' },
      requireFcMutationReceipt: requireReceipt,
      requireFcProfileScope: async () => null,
      sendPushNotificationToCanonicalFc: async () => { notificationCalls += 1; },
      sessionCheck: { session: { role: 'admin' } },
    });
    return handler();
  }

  await assert.rejects(
    runProfileUpdate({ career_type: '경력' }),
    /admin_fc_update_profile_mutation_receipt_invalid/,
  );
  await assert.rejects(
    runProfileUpdate({}),
    /admin_fc_reload_profile_mutation_receipt_invalid/,
  );
  assert.equal(notificationCalls, 0);
});

test('admin FC document status updates stop before workflow and notification when zero rows change', async () => {
  const requireReceipt = execute(extract('app/api/admin/fc/route.ts', 'requireFcMutationReceipt'), {});
  const branch = extractIfBranch('app/api/admin/fc/route.ts', "action === 'updateDocStatus'");
  let workflowCalls = 0;
  let notificationCalls = 0;
  const handler = execute(`async () => { ${branch} }`, {
    action: 'updateDocStatus',
    adminSupabase: {
      from: () => {
        let operation = null;
        return {
          eq() { return this; },
          maybeSingle: async () => operation === 'update'
            ? { data: null, error: null }
            : { data: { storage_path: 'stored.pdf' }, error: null },
          select() { if (operation === null) operation = 'read'; return this; },
          update() { operation = 'update'; return this; },
        };
      },
    },
    badRequest: (error) => ({ error }),
    isNoFileDoc: () => false,
    logger: { warn() {} },
    NO_FILE_APPROVAL_NOTE: 'synthetic',
    notificationResponse: () => ({}),
    payload: { docType: 'proof', fcId: 'synthetic-fc', status: 'approved' },
    queuePushNotificationToCanonicalFc: async () => { notificationCalls += 1; },
    requireFcMutationReceipt: requireReceipt,
    requireFcProfileScope: async () => null,
    sessionCheck: { session: { role: 'admin' } },
    syncProfileAfterDocMutation: async () => { workflowCalls += 1; return { allApproved: true }; },
  });

  await assert.rejects(handler(), /admin_fc_update_document_status_mutation_receipt_invalid/);
  assert.equal(workflowCalls, 0);
  assert.equal(notificationCalls, 0);
});

test('dashboard mutations reject request-mismatched and incomplete 200 receipts', async () => {
  const fcId = '00000000-0000-4000-8000-000000000001';
  const requestedDate = '2026-10-13';
  const response = (body) => async () => ({ ok: true, json: async () => body });
  const dayjs = () => ({ format: () => requestedDate });
  const profile = { id: fcId, status: 'draft', temp_id: 'OLD' };

  const updateInfo = execute(extract('app/dashboard/page.tsx', 'updateInfoMutation'), {
    selectedFc: profile,
    careerInput: '경력',
    tempIdInput: 'NEW',
    fetch: response({
      ok: true,
      profile: { id: fcId, career_type: '경력', temp_id: 'OTHER', status: 'temp-id-issued' },
    }),
    normalizeAdminTempId,
    requireProfileMutationReceipt,
  });
  await assert.rejects(updateInfo.mutationFn(), /저장 결과를 확인하지 못했습니다/);

  const commissionUpdate = {
    life_commission_completed: true,
    nonlife_commission_completed: false,
  };
  const updateCommission = execute(extract('app/dashboard/page.tsx', 'updateCommissionMutation'), {
    selectedFc: profile,
    commissionInput: 'life_only',
    buildCommissionProfileUpdate: () => commissionUpdate,
    fetch: response({ ok: true, profile: { id: fcId, ...commissionUpdate, life_commission_completed: false } }),
    requireProfileMutationReceipt,
  });
  await assert.rejects(updateCommission.mutationFn(), /저장 결과를 확인하지 못했습니다/);

  const resetToLookup = execute(extract('app/dashboard/page.tsx', 'resetToLookupMutation'), {
    selectedFc: profile,
    fetch: response({ ok: true, profile: { id: fcId, status: 'draft' } }),
    requireProfileMutationReceipt,
  });
  await assert.rejects(resetToLookup.mutationFn(), /저장 결과를 확인하지 못했습니다/);

  const updateStatus = execute(extract('app/dashboard/page.tsx', 'updateStatusMutation'), {
    selectedFc: profile,
    fetch: response({ ok: true, status: 'docs-pending', profile: { id: fcId, status: 'docs-approved' } }),
    requireProfileMutationReceipt,
  });
  await assert.rejects(
    updateStatus.mutationFn({ status: 'docs-approved', msg: 'synthetic' }),
    /상태 업데이트 응답이 올바르지 않습니다/,
  );

  const updateAllowanceDate = execute(extract('app/dashboard/page.tsx', 'updateAllowanceDateMutation'), {
    selectedFc: profile,
    allowanceDateInput: new Date('2026-10-13T00:00:00.000Z'),
    dayjs,
    fetch: response({ ok: true, allowance_date: '2026-10-12', status: 'allowance-consented' }),
    requireMutationSuccess,
    isValidYmdResponse,
    isValidFcStatusResponse,
  });
  await assert.rejects(updateAllowanceDate.mutationFn(), /보증보험 조회 동의일 저장 응답/);

  const updateHanwhaDate = execute(extract('app/dashboard/page.tsx', 'updateHanwhaSubmissionDateMutation'), {
    selectedFc: profile,
    hanwhaSubmittedDateInput: new Date('2026-10-13T00:00:00.000Z'),
    dayjs,
    fetch: response({ ok: true, hanwha_commission_date_sub: '2026-10-12', status: 'hanwha-commission-review' }),
    requireMutationSuccess,
    isValidYmdResponse,
    isValidFcStatusResponse,
  });
  await assert.rejects(updateHanwhaDate.mutationFn(), /다위촉 URL 완료일 저장 응답/);

  const updateAppointmentDate = execute(extract('app/dashboard/page.tsx', 'updateAppointmentDateMutation'), {
    selectedFc: profile,
    appointmentInputs: { lifeDate: new Date('2026-10-13T00:00:00.000Z') },
    dayjs,
    fetch: response({ ok: true, category: 'life', appointmentDate: '2026-10-12', status: 'appointment-completed' }),
    requireMutationSuccess,
    isValidYmdResponse,
    isValidFcStatusResponse,
  });
  await assert.rejects(
    updateAppointmentDate.mutationFn({ category: 'life' }),
    /위촉 완료일 저장 응답/,
  );

  const markDawichok = execute(extract('app/dashboard/page.tsx', 'markDawichokUrlSentMutation'), {
    selectedFc: profile,
    residentId: '010-1111-2222',
    fetch: response({
      ok: true,
      dawichok_url_sent_at: '2026-10-13T00:00:00.000Z',
      dawichok_url_sent_by: '01099998888',
    }),
    requireMutationSuccess,
    isNonEmptyResponseString,
    showAdminNotificationWarning() {},
  });
  await assert.rejects(markDawichok.mutationFn(), /다위촉 URL 발송 신호 응답/);

  const updateDocsRequest = execute(extract('app/dashboard/page.tsx', 'updateDocsRequestMutation'), {
    selectedFc: profile,
    dayjs,
    fetch: response({ ok: true, updated: true, cleanupPending: 'no' }),
    logger: { debug() {} },
    requireMutationSuccess,
    requireCleanupMutationReceipt,
  });
  await assert.rejects(
    updateDocsRequest.mutationFn({ types: ['proof'], deadline: null }),
    /저장 결과를 확인하지 못했습니다/,
  );
});

test('dashboard document preview rejects unsafe signed URLs before navigation', async () => {
  let closes = 0;
  let navigations = 0;
  const popup = {};
  let signedUrl = 'javascript:alert(1)';
  const handleOpenDoc = execute(extract('app/dashboard/page.tsx', 'handleOpenDoc'), {
    trimValue: (value) => String(value ?? '').trim(),
    selectedFc: { id: 'synthetic-fc' },
    openPendingAdminFileWindow: () => popup,
    closePendingAdminFileWindow: (target) => { if (target === popup) closes += 1; },
    navigateAdminFileWindowOrCurrentTab: () => { navigations += 1; },
    fetch: async () => ({
      ok: true,
      json: async () => ({ ok: true, signedUrl }),
    }),
    isHttpsResponseUrl,
    notifications: noNotifications,
    window: { open() {}, location: { assign() {} } },
  });

  for (const unsafeUrl of [
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'http://storage.example.test/file.pdf',
    'https://user:secret@storage.example.test/file.pdf',
  ]) {
    signedUrl = unsafeUrl;
    await handleOpenDoc('fc-documents/synthetic.pdf');
  }
  assert.equal(closes, 4);
  assert.equal(navigations, 0);
});

test('profile detail saves require the requested FC and committed fields in the 200 receipt', async () => {
  const fcId = '00000000-0000-4000-8000-000000000001';
  const values = {
    name: 'Updated FC',
    phone: '01011112222',
    affiliation: 'Seoul',
    address: '',
    address_detail: '',
    email: '',
    career_type: '경력',
    temp_id: 'TEMP-1',
  };
  const expected = {
    name: values.name,
    phone: values.phone,
    affiliation: values.affiliation,
    address: null,
    address_detail: null,
    email: null,
    career_type: values.career_type,
  };
  let body = { ok: true };
  const dependencies = {
    fcId,
    profile: { temp_id: 'TEMP-1' },
    isValidCareerType,
    resolveAdminTempIdUpdate,
    requireProfileMutationReceipt,
    fetch: async () => ({ ok: true, json: async () => body }),
  };
  const updateProfile = execute(
    extract('app/dashboard/profile/[id]/page.tsx', 'updateProfileMutation'),
    dependencies,
  );

  await assert.rejects(updateProfile.mutationFn(values), /저장 결과를 확인하지 못했습니다/);
  body = { ok: true, profile: { id: '00000000-0000-4000-8000-000000000002', ...expected } };
  await assert.rejects(updateProfile.mutationFn(values), /저장 결과를 확인하지 못했습니다/);
  body = { ok: true, profile: { id: fcId, ...expected, name: 'Unchanged FC' } };
  await assert.rejects(updateProfile.mutationFn(values), /저장 결과를 확인하지 못했습니다/);

  const saveMemo = execute(
    extract('app/dashboard/profile/[id]/page.tsx', 'saveMemoMutation'),
    {
      fcId,
      requireProfileMutationReceipt,
      fetch: async () => ({
        ok: true,
        json: async () => ({ ok: true, profile: { id: fcId, admin_memo: 'old memo' } }),
      }),
    },
  );
  await assert.rejects(saveMemo.mutationFn('new memo'), /저장 결과를 확인하지 못했습니다/);
});

test('FC notify proxy keeps downstream 5xx details private and preserves valid 4xx contracts', async () => {
  let downstream = {
    status: 500,
    ok: false,
    body: JSON.stringify({ ok: false, error: 'private SQL detail: synthetic_secret' }),
  };
  const logs = [];
  const proxy = execute(extract('app/api/fc-notify/route.ts', 'proxyToFcNotify'), {
    supabaseUrl: 'https://project.supabase.test',
    serviceKey: 'synthetic-service-key',
    FC_NOTIFY_PROXY_TIMEOUT_MS: 10_000,
    FC_NOTIFY_DOWNSTREAM_ERROR: 'FC notification service request failed',
    FC_NOTIFY_DOWNSTREAM_UNAVAILABLE: 'FC notification service is unavailable',
    AbortSignal: { timeout: () => undefined },
    fetch: async () => ({
      status: downstream.status,
      ok: downstream.ok,
      text: async () => downstream.body,
    }),
    json: (body, status = 200) => ({ body, status }),
    logger: {
      error: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
    },
  });

  const serverFailure = await proxy({ type: 'synthetic' });
  assert.equal(serverFailure.status, 500);
  assert.equal(serverFailure.body.ok, false);
  assert.equal(serverFailure.body.error, 'FC notification service is unavailable');
  assert.doesNotMatch(JSON.stringify(serverFailure.body), /private SQL detail|synthetic_secret/);
  assert.doesNotMatch(JSON.stringify(logs), /private SQL detail|synthetic_secret/);
  assert.match(JSON.stringify(logs), /downstream_server_error/);

  downstream = {
    status: 400,
    ok: false,
    body: JSON.stringify({ ok: false, error: 'Invalid notification target' }),
  };
  const clientFailure = await proxy({ type: 'synthetic' });
  assert.equal(clientFailure.status, 400);
  assert.equal(clientFailure.body.data.error, 'Invalid notification target');

  downstream = { status: 400, ok: false, body: 'private malformed failure' };
  const malformedFailure = await proxy({ type: 'synthetic' });
  assert.equal(malformedFailure.body.error, 'FC notification service request failed');
  assert.doesNotMatch(JSON.stringify(malformedFailure.body), /private malformed failure/);
});

test('Hanwha PDF deletion requires the database clear receipt after storage removal', async () => {
  const requireReceipt = execute(extract('app/api/admin/fc/route.ts', 'requireFcMutationReceipt'), {});
  const branch = extractIfBranch(
    'app/api/admin/fc/route.ts',
    "action === 'createHanwhaPdfUploadUrl' || action === 'deleteHanwhaPdf'",
  );
  const handler = execute(`async () => { ${branch} }`, {
    action: 'deleteHanwhaPdf',
    payload: { fcId: 'synthetic-fc' },
    validateHanwhaPdfPayload: () => ({ ok: true, fcId: 'synthetic-fc' }),
    requireFcProfileScope: async () => null,
    sessionCheck: { session: { role: 'admin' } },
    normalizeFcDocumentStoragePath: (value) => value,
    badRequest: (error) => ({ error }),
    requireFcMutationReceipt: requireReceipt,
    adminSupabase: {
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
      from: () => {
        let operation = 'read';
        return {
          select() { return this; },
          update() { operation = 'update'; return this; },
          eq() { return this; },
          maybeSingle: async () => operation === 'update'
            ? { data: null, error: null }
            : { data: { hanwha_commission_pdf_path: 'hanwha-url-pdf/synthetic.pdf' }, error: null },
        };
      },
    },
  });

  await assert.rejects(handler(), /admin_fc_delete_hanwha_pdf_mutation_receipt_invalid/);
});

test('admin FC date routes reject impossible calendar dates before database mutation', async () => {
  let databaseCalls = 0;
  const common = {
    badRequest: (error) => ({ error }),
    isValidIsoDate: isValidYmdResponse,
    requireFcProfileScope: async () => null,
    sessionCheck: { session: { role: 'admin' } },
    adminSupabase: {
      from: () => { databaseCalls += 1; return {}; },
      rpc: async () => { databaseCalls += 1; return { data: null, error: null }; },
    },
  };

  const allowanceBranch = extractIfBranch('app/api/admin/fc/route.ts', "action === 'updateAllowanceDate'");
  const updateAllowanceDate = execute(`async () => { ${allowanceBranch} }`, {
    ...common,
    action: 'updateAllowanceDate',
    payload: { fcId: 'synthetic-fc', allowanceDate: '2026-02-31' },
  });
  assert.deepEqual(await updateAllowanceDate(), { error: '유효한 보증보험 조회 동의일을 입력해주세요.' });

  const docsBranch = extractIfBranch('app/api/admin/fc/route.ts', "action === 'updateDocsRequest'");
  const updateDocsRequest = execute(`async () => { ${docsBranch} }`, {
    ...common,
    action: 'updateDocsRequest',
    payload: { fcId: 'synthetic-fc', types: ['proof'], deadline: '2026-04-31' },
  });
  assert.deepEqual(await updateDocsRequest(), { error: '서류 마감일을 확인해주세요.' });
  assert.equal(databaseCalls, 0);
});


test('committed cleanup preserves pending when the final exact count is unconfirmed', async () => {
  let count = null;
  let rows = [];
  const drain = execute(extract('app/api/admin/fc/route.ts', 'drainDocumentCleanup'), {
    requireSupabaseRows,
    adminSupabase: { from: () => ({ select: () => ({ eq: () => ({
      limit: async () => ({ data: rows, error: null }),
      then: (resolve) => resolve({ count, error: null }),
    }) }) }) },
  });
  assert.equal(await drain('synthetic-fc'), true);
  count = undefined; assert.equal(await drain('synthetic-fc'), true);
  count = 0; assert.equal(await drain('synthetic-fc'), false);
  count = 1; assert.equal(await drain('synthetic-fc'), true);
  rows = null; count = 0; assert.equal(await drain('synthetic-fc'), true);
});
