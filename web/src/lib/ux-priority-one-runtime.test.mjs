import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { isBoardSuccess } from './upstream-response-policy.ts';
import { createCreationRequestTracker } from './creation-request.ts';
import { shouldSubmitOnEnter, requireMutationSuccess, isValidCareerType } from './user-intent-policy.ts';
import { QueryReadError } from './query-read-error.ts';
import { createChatRequestGuard } from './chat-request-guard.ts';

const require = createRequire(import.meta.url);

function syntax(relative) {
  const text = readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
  return ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function extract(relative, name) {
  const source = syntax(relative);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      found = ts.isCallExpression(node.initializer) && ['useMutation', 'useCallback'].includes(node.initializer.expression.getText(source))
        ? node.initializer.arguments[0] : node.initializer;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, name);
  return found.getText(source);
}
function execute(code, values) {
  const output = ts.transpileModule(`const callback = ${code.replace(/^export\s+/, '')}; callback;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return vm.runInNewContext(output, { exports: {}, ...values, require: () => ({ jsx: () => null }) });
}
const noNotifications = { show() {} };

test('appointment years include current and returned data years without hiding current-year FCs', () => {
  const dayjs = require('dayjs');
  const currentYear = dayjs().format('YYYY');
  const fcs = [
    { id: 'current', created_at: `${currentYear}-06-01T00:00:00Z` },
    { id: 'older', created_at: '2023-06-01T00:00:00Z' },
    { id: 'future', created_at: '2031-06-01T00:00:00Z' },
    { id: 'invalid', created_at: 'invalid' },
    { id: 'missing' },
  ];
  const values = { fcs, dayjs, useMemo: (compute) => compute() };
  const years = execute(extract('app/dashboard/appointment/page.tsx', 'yearOptions'), values);
  assert.deepEqual(Array.from(years), [...new Set([currentYear, '2025', '2024', '2023', '2031'])].sort((a, b) => Number(b) - Number(a)));
  assert.deepEqual(Array.from(execute(extract('app/dashboard/appointment/page.tsx', 'processedFcs'), {
    ...values, filterYear: currentYear, canManageInsuranceStage: () => true,
  }), (fc) => fc.id), ['current']);
});

test('appointment confirm saves the FC-submitted date shown in 확정일 and blocks a cleared date', async () => {
  const page = 'app/dashboard/appointment/page.tsx';
  const fc = { id: 'fc-1', appointment_date_life: null, appointment_date_life_sub: '2026-10-03' };
  const shown = []; const calls = []; let confirmConfig = null;
  const values = {
    dayjs: require('dayjs'), canManageInsuranceStage: () => true, inputs: {},
    resolveInsuranceDate: execute(extract(page, 'resolveInsuranceDate'), {}),
    notifications: { show: (item) => shown.push(item.title) },
    showConfirm: (config) => { confirmConfig = config; }, openRejectModal() {},
    updateAppointmentAction: async (_state, input) => { calls.push(input); return { success: true, message: 'ok' }; },
    showAdminNotificationWarning() {}, refetch() {},
  };
  execute(extract(page, 'executeAction'), values)(fc, 'confirm', 'life');
  assert.deepEqual(shown, []);
  await confirmConfig.onConfirm();
  assert.equal(calls[0].value, '2026-10-03');

  confirmConfig = null;
  execute(extract(page, 'executeAction'), { ...values, inputs: { 'fc-1': { lifeDate: null } } })(fc, 'confirm', 'life');
  assert.equal(confirmConfig, null);
  assert.deepEqual(shown, ['성공', '입력 필요']);
});

test('dashboard list state round-trips through the URL and ignores unknown values', () => {
  const page = 'app/dashboard/page.tsx';
  const read = execute(extract(page, 'readDashboardListState'), { URLSearchParams });
  const write = execute(extract(page, 'writeDashboardListState'), { URLSearchParams });
  const tabs = ['all', 'g_done', 'step2'];
  const state = { activeTab: 'step2', metricFilter: 'pendingDocs', keyword: '가상', currentPage: 3 };
  const search = write('?fcId=keep', state);
  assert.deepEqual({ ...read(search, tabs) }, state);
  assert.equal(new URLSearchParams(search).get('fcId'), 'keep');
  assert.equal(write(search, { activeTab: 'all', metricFilter: 'all', keyword: '', currentPage: 1 }), 'fcId=keep');
  assert.deepEqual({ ...read('?tab=bogus&metric=bogus&page=-2', tabs) }, { activeTab: 'all', metricFilter: 'all', keyword: '', currentPage: 1 });
});

test('quick-filter tabs clear the KPI filter and reset the page like workflow tabs', () => {
  const source = syntax('app/dashboard/page.tsx').getFullText();
  assert.equal((source.match(/onChange=\{handleActiveTabChange\}/g) || []).length, 2);
  const calls = [];
  execute(extract('app/dashboard/page.tsx', 'handleActiveTabChange'), {
    setActiveTab: (v) => calls.push(['tab', v]), setMetricFilter: (v) => calls.push(['metric', v]), setCurrentPage: (v) => calls.push(['page', v]),
  })('g_done');
  assert.deepEqual(calls, [['tab', 'g_done'], ['metric', 'all'], ['page', 1]]);
});

test('bulk exam reception confirms each applicant and reports partial failures', async () => {
  const shown = []; let cache = [{ id: 'a', is_confirmed: false, status: 'applied' }, { id: 'b', is_confirmed: false, status: 'applied' }];
  const options = execute(extract('app/dashboard/exam/applicants/page.tsx', 'bulkConfirmMutation'), {
    requestReception: async (item) => { if (item.id === 'b') throw new Error('synthetic failure'); return { ok: true }; },
    getAdminNotificationWarning: () => null,
    setReceptionInCache: (ids, isConfirmed) => { cache = cache.map((row) => ids.has(row.id) ? { ...row, is_confirmed: isConfirmed } : row); },
    setBulkConfirmOpened() {}, notifications: { show: (item) => shown.push(item) },
  });
  const result = await options.mutationFn(cache);
  assert.equal(result.confirmedIds.size, 1); assert.equal(result.failed, 1);
  options.onSuccess(result);
  assert.deepEqual(cache.map((row) => row.is_confirmed), [true, false]);
  assert.equal(shown[0].title, '일괄 접수 일부 실패'); assert.equal(shown[0].color, 'yellow');
});

test('canceling composer discard keeps the draft and attachment; busy create cannot close', () => {
  let closes = 0; let prompts = 0;
  const values = { createPostMutation: { isPending: false }, updatePostMutation: { isPending: false },
    saveSubmitting: { current: false },
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
      pendingCreationRef: { current: null }, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
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

test('round filter is applied before the global read limit', async () => {
  const calls = [];
  const query = { select() { return this; }, eq(field, value) { calls.push(['eq', field, value]); return this; },
    order() { return this; }, range(start, end) { calls.push(['range', start, end]); return Promise.resolve({ data: [], error: null }); } };
  const read = execute(extract('app/api/admin/exam-applicants/route.ts', 'readRegistrationRows'), {
    adminSupabase: { from: () => query }, EXAM_REGISTRATION_SELECT: 'synthetic',
  });
  await read(undefined, 'selected-round');
  assert.deepEqual(calls, [['eq', 'round_id', 'selected-round'], ['range', 0, 999]]);
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
  payload = { ok: true };
  assert.equal((await invoke('board-delete', {})).ok, true);
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


test('committed cleanup preserves pending when the final exact count is unconfirmed', async () => {
  let count = null;
  const drain = execute(extract('app/api/admin/fc/route.ts', 'drainDocumentCleanup'), {
    adminSupabase: { from: () => ({ select: () => ({ eq: () => ({
      limit: async () => ({ data: [], error: null }),
      then: (resolve) => resolve({ count, error: null }),
    }) }) }) },
  });
  assert.equal(await drain('synthetic-fc'), true);
  count = undefined; assert.equal(await drain('synthetic-fc'), true);
  count = 0; assert.equal(await drain('synthetic-fc'), false);
  count = 1; assert.equal(await drain('synthetic-fc'), true);
});

const uuid = '00000000-0000-4000-8000-000000000001';

test('C02/D01: board double click locks immediately and lost acknowledgement retries the same durable request', async () => {
  const creationRequest = { current: createCreationRequestTracker(() => uuid) };
  const receipts = new Map(); const calls = []; let loseResponse = true;
  const values = {
    actor: { role: 'admin', residentId: 'synthetic' }, categoryId: 'category',
    newPost: { title: ' draft ', content: ' body ' }, creationRequest,
    createBoardPost: async (_, payload) => {
      calls.push(payload); if (!receipts.has(payload.requestId)) receipts.set(payload.requestId, { id: 'one-post' });
      if (loseResponse) { loseResponse = false; throw new Error('response_lost_after_commit'); }
      return receipts.get(payload.requestId);
    },
    uploadAttachments: async () => ({ complete: true, manifest: null }),
  };
  const mutation = execute(extract('app/dashboard/board/page.tsx', 'createPostMutation'), values);
  await assert.rejects(mutation.mutationFn(), /response_lost/);
  assert.equal((await mutation.mutationFn()).id, 'one-post');
  assert.equal(receipts.size, 1); assert.equal(calls[0].requestId, calls[1].requestId);
  assert.equal(calls[0].title, 'draft');
  let submits = 0;
  const saveSubmitting = { current: false };
  const handler = execute(extract('app/dashboard/board/page.tsx', 'handleCreateOrUpdate'), {
    ...values, saveSubmitting, pendingAttachmentRetry: null, postSaving: false,
    categoriesQuery: { isError: false }, isEditMode: false, editingPostId: null,
    createPostMutation: { isPending: false, mutate() { submits++; } },
    updatePostMutation: { isPending: false }, retryAttachmentMutation: { isPending: false }, notifications: noNotifications,
  });
  handler(); handler(); assert.equal(submits, 1);
  const settled = execute(extract('app/dashboard/board/page.tsx', 'createPostMutation'), { ...values, saveSubmitting });
  settled.onSettled(); handler(); assert.equal(submits, 2);
});

test('C01/C02/D01: notice retry retains uploaded URLs and request id after response loss', async () => {
  const sent = []; let uploads = 0; let requests = 0; let pending = false;
  const file = { name: 'synthetic.pdf', size: 5, type: 'application/pdf' };
  const pendingCreationRef = { current: null };
  const values = {
    submittingRef: { current: false }, pendingCreationRef,
    setSubmitting: (next) => { pending = next; }, setSubmitPhase() {}, images: [], files: [file],
    uploadToSupabase: async () => { uploads++; return 'https://example.test/one-upload'; }, FormData,
    crypto: { randomUUID: () => `${uuid.slice(0, -1)}${++requests}` },
    createNoticeAction: async (_, formData) => { sent.push(formData); throw new Error('response_lost_after_commit'); },
    form: { setErrors() {} }, notifications: noNotifications, logger: { error() {} },
  };
  const submit = execute(extract('app/dashboard/notifications/create/page.tsx', 'handleSubmit'), values);
  const draft = { category: 'test', title: 'synthetic', body: 'body' };
  await submit(draft); await submit(draft);
  assert.equal(pending, false); assert.equal(uploads, 1); assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1]); assert.equal(sent[0].get('requestId'), `${uuid.slice(0, -1)}1`);
  await submit({ ...draft, body: 'new intended body' });
  assert.equal(uploads, 2); assert.notEqual(sent[2].get('requestId'), sent[0].get('requestId'));
  let prevented = 0;
  const leave = execute(extract('app/dashboard/notifications/create/page.tsx', 'handleLeave'), {
    ...values, form: { isDirty: () => true }, window: { confirm: () => false },
  });
  leave({ preventDefault() { prevented++; } }); assert.equal(prevented, 1);
  values.submittingRef.current = true; leave({ preventDefault() { prevented++; } }); assert.equal(prevented, 2);
});

test('W02: document mutation double click locks synchronously and failure settlement allows retry', () => {
  let calls = 0; const statusSubmitting = { current: false };
  const values = { statusSubmitting, isReadOnly: false, updateStatusMutation: { isPending: false, mutate() { calls++; } } };
  const submit = execute(extract('app/dashboard/docs/page.tsx', 'submitDocumentStatus'), values);
  const input = { doc: { id: 'synthetic' }, status: 'approved' };
  submit(input); submit(input); assert.equal(calls, 1);
  execute(extract('app/dashboard/docs/page.tsx', 'updateStatusMutation'), values).onSettled();
  submit(input); assert.equal(calls, 2);
  values.isReadOnly = true; statusSubmitting.current = false;
  execute(extract('app/dashboard/docs/page.tsx', 'submitDocumentStatus'), values)(input); assert.equal(calls, 2);
});

test('W03: group send blocks a same-tick duplicate and retains body/files when send fails', async () => {
  let fail; let sends = 0; let cleared = 0; let pending = false;
  const waiting = new Promise((_, reject) => { fail = reject; });
  const values = {
    sendingRef: { current: false }, requestGuard: createChatRequestGuard(), inputEnabled: true,
    room: { id: 'synthetic-room' }, selectedFiles: [{ name: 'small.pdf' }],
    pendingAttachmentBatchRef: { current: null }, replyTarget: null,
    setSending: (value) => { pending = value; }, setUploading() {},
    prepareMessengerAttachmentBatch: async () => ({ files: [{}] }),
    uploadMessengerAttachmentBatch: async () => ({ state: 'uploaded', intentIds: ['synthetic-intent'] }),
    groupChatSend: async () => { sends++; await waiting; },
    setInput() { cleared++; }, setSelectedFiles() { cleared++; }, showGroupChatErrorNotification() {},
  };
  const send = execute(extract('app/dashboard/group-chat/page.tsx', 'handleSend'), values);
  const first = send('한글 본문'); await send('한글 본문');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending, true); assert.equal(sends, 1);
  fail(new Error('synthetic-network-failure')); await first;
  assert.equal(pending, false); assert.equal(cleared, 0); assert.equal(values.selectedFiles.length, 1);
});

test('W03: pin clearing keeps pending until failure and rejects an immediate duplicate', async () => {
  let fail; let calls = 0; const states = [];
  const waiting = new Promise((_, reject) => { fail = reject; });
  const clear = execute(extract('app/dashboard/group-chat/page.tsx', 'handleClearNotice'), {
    canManageNotice: true, noticeUpdating: false, noticeUpdatingRef: { current: false },
    setNoticeUpdating: (value) => states.push(value),
    groupChatClearNotice: async () => { calls++; await waiting; }, showGroupChatErrorNotification() {}, setNotice() {},
  });
  const first = clear(); await clear(); assert.equal(calls, 1); assert.deepEqual(states, [true]);
  fail(new Error('synthetic-pin-failure')); await first; assert.deepEqual(states, [true, false]);
});

test('W03: canceling real group message deletion leaves the message and pinned notice intact', async () => {
  let calls = 0; let changes = 0; let prompts = 0;
  const remove = execute(extract('app/dashboard/group-chat/page.tsx', 'handleDelete'), {
    actor: { id: 'synthetic-actor' }, notice: { message_id: 'synthetic-message' },
    window: { confirm: () => { prompts++; return false; } },
    groupChatDeleteMessage: async () => { calls++; },
    mergeMessage: () => { changes++; }, setNotice: () => { changes++; }, showGroupChatErrorNotification() {},
  });
  await remove({ id: 'synthetic-message', sender_actor_id: 'synthetic-actor', deleted_at: null });
  assert.equal(prompts, 1); assert.equal(calls, 0); assert.equal(changes, 0);
  await remove({ id: 'synthetic-message', sender_actor_id: 'another-actor', deleted_at: null });
  await remove({ id: 'synthetic-message', sender_actor_id: 'synthetic-actor', deleted_at: '2026-10-10' });
  assert.equal(prompts, 1); assert.equal(calls, 0); assert.equal(changes, 0);
});

test('C05/W02: reject modal ignores Korean composition fallback and Shift+Enter before explicit submit', () => {
  let submits = 0; let consumed = 0;
  const values = { shouldSubmitOnEnter, submitting: false, submitDisabled: false, onSubmit: () => submits++ };
  const handler = execute(extract('components/RejectReasonModal.tsx', 'handleReasonKeyDown'), values);
  for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
    handler({ key: 'Enter', shiftKey: false, nativeEvent, preventDefault() { consumed++; } });
  }
  handler({ key: 'Enter', shiftKey: true, nativeEvent: {}, preventDefault() { consumed++; } });
  assert.equal(submits, 0); assert.equal(consumed, 0);
  handler({ key: 'Enter', shiftKey: false, nativeEvent: {}, preventDefault() { consumed++; } });
  assert.equal(submits, 1); assert.equal(consumed, 1);
});

for (const count of [999, 1000, 1001, 2000, 2001]) {
  test(`W06/D07: server round read traverses every page for ${count} synthetic applications`, async () => {
    const rows = Array.from({ length: count }, (_, index) => ({ id: `synthetic-${index}` }));
    const calls = [];
    const read = execute(extract('app/api/admin/exam-applicants/route.ts', 'readRegistrationRows'), {
      EXAM_REGISTRATION_SELECT: 'synthetic',
      adminSupabase: { from: () => {
        const call = { orders: [] }; calls.push(call);
        return { select() { return this; }, eq(field, value) { call.filter = [field, value]; return this; },
          order(field, options) { call.orders.push([field, options.ascending]); return this; },
          async range(start, end) { call.range = [start, end]; return { data: rows.slice(start, end + 1), error: null }; } };
      } },
    });
    const result = await read(undefined, 'synthetic-round');
    assert.equal(result.length, count); assert.equal(new Set(result.map((row) => row.id)).size, count);
    assert.equal(calls.length, Math.floor(count / 1000) + 1);
    for (let index = 0; index < calls.length; index++) {
      assert.deepEqual(calls[index].filter, ['round_id', 'synthetic-round']);
      assert.deepEqual(calls[index].orders, [['created_at', false], ['id', false]]);
      assert.deepEqual(calls[index].range, [index * 1000, index * 1000 + 999]);
    }
  });
}

test('C03/C04/D06: a malformed page or a failed second exam page rejects the whole read', async () => {
  for (const malformed of [true, false]) {
    const read = execute(extract('app/api/admin/exam-applicants/route.ts', 'readRegistrationRows'), {
      EXAM_REGISTRATION_SELECT: 'synthetic', adminSupabase: { from: () => ({ select() { return this; }, order() { return this; },
        async range(start) { return malformed ? { data: null, error: null }
          : start === 0 ? { data: Array(1000).fill({ id: 'synthetic' }), error: null } : { data: null, error: new Error('second-page-failure') }; },
      }) },
    });
    await assert.rejects(read(), malformed ? /응답/ : /second-page/);
  }
});

test('W01/D08: a late group refresh cannot replace an acknowledged send or mutate a disposed owner', async () => {
  for (const dispose of [false, true]) {
    let resolve; let applies = 0; let marks = 0;
    const requestGuard = createChatRequestGuard();
    const load = execute(extract('app/dashboard/group-chat/page.tsx', 'loadGroupChat'), {
      requestGuard, setLoading() {},
      groupChatBootstrap: () => new Promise((done) => { resolve = done; }),
      applyBootstrap: () => applies++, newestMessageId: () => 'synthetic-message',
      groupChatMarkRead: () => marks++, scrollToBottom() {}, showGroupChatErrorNotification() {},
    });
    const pending = load();
    if (dispose) requestGuard.dispose(); else requestGuard.changed();
    resolve({ messages: [] }); await pending;
    assert.equal(applies, 0); assert.equal(marks, 0);
  }
});

test('W04/D06: profile career validation rejects unsupported values before any fetch and false acknowledgements fail', async () => {
  let reads = 0;
  const values = { isValidCareerType, requireMutationSuccess, fcId: 'synthetic', profile: {},
    resolveAdminTempIdUpdate: () => ({ changed: false }), isRecord: (value) => value && typeof value === 'object',
    fetch: async () => { reads++; return { ok: true, json: async () => ({ ok: 'true' }) }; },
  };
  const mutation = execute(extract('app/dashboard/profile/[id]/page.tsx', 'updateProfileMutation'), values);
  const input = { name: 'synthetic', phone: 'synthetic', affiliation: 'test', address: '', address_detail: '', email: '', temp_id: '', career_type: 'expert' };
  await assert.rejects(mutation.mutationFn(input), /신입 또는 경력/); assert.equal(reads, 0);
  await assert.rejects(mutation.mutationFn({ ...input, career_type: '경력' }), /저장 결과/); assert.equal(reads, 1);
});

test('D01: actual notice action retries an atomic receipt and rejects changed payload with the same key', async () => {
  const z = require('zod').z;
  const NoticeSchema = execute(extract('app/dashboard/notifications/actions.ts', 'NoticeSchema'), { z });
  const receipts = new Map(); const events = new Map(); let rows = 0; let loseResponse = true;
  const values = {
    z, NoticeSchema, logger: { error() {}, warn() {}, debug() {}, info() {} },
    getVerifiedAdminSession: async () => ({ ok: true, session: { role: 'admin', residentId: 'synthetic-actor' } }),
    emptyExpoDelivery: () => ({ attempted: 0, accepted: 0, rejected: 0 }), revalidatePath() {},
    adminSupabase: {
      async rpc(name, input) {
        assert.equal(name, 'create_notice_idempotent_v1'); assert.equal(input.p_actor_role, 'admin');
        assert.equal(input.p_actor_phone, 'synthetic-actor');
        const key = input.p_request_id; const fingerprint = JSON.stringify(input.p_notice);
        if (receipts.has(key) && receipts.get(key).fingerprint !== fingerprint) return { data: null, error: { code: '22023' } };
        if (!receipts.has(key)) receipts.set(key, { fingerprint, result: { id: `synthetic-notice-${++rows}` } });
        if (loseResponse) { loseResponse = false; throw new Error('response_lost_after_commit'); }
        return { data: receipts.get(key).result, error: null };
      },
      from(table) {
        if (table === 'notifications') return { upsert(row, options) {
          assert.equal(options.onConflict, 'delivery_key');
          if (!events.has(row.delivery_key)) events.set(row.delivery_key, { id: 'synthetic-event' });
          return { select: () => ({ single: async () => ({ data: events.get(row.delivery_key), error: null }) }) };
        } };
        assert.equal(table, 'device_tokens');
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      },
    },
  };
  const action = execute(extract('app/dashboard/notifications/actions.ts', 'createNoticeAction'), values);
  const form = new FormData();
  for (const [key, value] of Object.entries({ requestId: uuid, title: 'synthetic title', body: 'body', category: 'test', images: '[]', files: '[]' })) form.append(key, value);
  await assert.rejects(action({}, form), /response_lost/);
  assert.equal((await action({}, form)).success, true); assert.equal((await action({}, form)).success, true);
  assert.equal(rows, 1); assert.equal(events.size, 1);
  form.set('body', 'changed body'); assert.equal((await action({}, form)).success, false);
  assert.equal(rows, 1);
});

test('D06: malformed successful notice RPC cannot continue into notification delivery or report success', async () => {
  const z = require('zod').z;
  const NoticeSchema = execute(extract('app/dashboard/notifications/actions.ts', 'NoticeSchema'), { z });
  let payload; let downstream = 0;
  const action = execute(extract('app/dashboard/notifications/actions.ts', 'createNoticeAction'), {
    z, NoticeSchema,
    getVerifiedAdminSession: async () => ({ ok: true, session: { role: 'admin', residentId: 'synthetic-actor' } }),
    adminSupabase: { rpc: async () => ({ data: payload, error: null }), from: () => { downstream++; throw new Error('unexpected downstream'); } },
  });
  const form = new FormData();
  for (const [key, value] of Object.entries({ requestId: uuid, title: 'synthetic', body: 'body', category: 'test' })) form.append(key, value);
  for (const malformed of [null, {}, { id: 123 }, { id: ' ' }, { id: [] }]) {
    payload = malformed; assert.equal((await action({}, form)).success, false);
  }
  assert.equal(downstream, 0);
});

test('W07/D07: written consent dates use Seoul today and enforce today/90-day/future/calendar bounds', () => {
  const code = ts.transpileModule(readFileSync(new URL('./admin-assisted-signup-validation.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fixed = new Date('2026-10-09T15:00:00.000Z');
  class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [fixed])); } }
  const exports = {};
  vm.runInNewContext(code, { exports, Date: FixtureDate, Intl, require: (name) => {
    if (name === 'zod') return require('zod');
    return { SIGNUP_AFFILIATION_OPTIONS: ['Synthetic affiliation'], SIGNUP_CARRIER_OPTIONS: ['SKT'] };
  } });
  assert.equal(exports.getSeoulTodayIsoDate(), '2026-10-10');
  const input = { requestId: uuid, name: '가상계정', phone: '01000000000', affiliation: 'Synthetic affiliation',
    email: 'synthetic@example.test', carrier: 'SKT', licenseStatuses: ['none'], inviterFcId: uuid,
    evidenceReference: 'TEST-0001', password: 'Synthetic1!', confirmPassword: 'Synthetic1!', consentAttested: true };
  for (const [consentObtainedOn, expected] of [['2026-10-10', true], ['2026-07-12', true], ['2026-07-11', false], ['2026-10-11', false], ['2026-02-30', false]]) {
    assert.equal(exports.adminAssistedSignupSchema.safeParse({ ...input, consentObtainedOn }).success, expected, consentObtainedOn);
  }
});

test('W04/D06: missing or malformed referral fields fail instead of becoming no referral code', () => {
  const read = execute(extract('app/dashboard/profile/[id]/page.tsx', 'readSignupReferralCode'), {
    QueryReadError, isRecord: (value) => value && typeof value === 'object' && !Array.isArray(value),
  });
  for (const malformed of [{ ok: true }, { signupReferralCode: 0 }, { signupReferralCode: {} }, { signupReferralCode: undefined }, null]) assert.throws(() => read(malformed));
  assert.equal(read({ signupReferralCode: null }), null);
  assert.equal(read({ signupReferralCode: 'TEST-CODE' }), 'TEST-CODE');
});

test('W06/D07: navigation follows timestamp/id order across tied timestamps and 2001 rows', async () => {
  const rows = Array.from({ length: 2001 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    created_at: '2026-10-09T15:00:00.000Z',
  }));
  rows[0].created_at = '2026-10-09T14:59:59.999Z';
  rows[2000].created_at = '2026-10-09T15:00:00.001Z';
  const canonical = [...rows].sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
  const read = execute(extract('app/api/admin/exam-applicants/route.ts', 'readApplicantNavigation'), {
    adminSupabase: { from: () => {
      let id; let expression; const order = [];
      return { select() { return this; }, eq(_field, value) { id = value; return this; }, or(value) { expression = value; return this; },
        order(field, options) { order.push([field, options.ascending]); return this; }, limit() { return this; },
        async maybeSingle() {
          if (id) return { data: rows.find((row) => row.id === id), error: null };
          const direction = expression.startsWith('created_at.gt.') ? 1 : -1;
          const timestamp = expression.slice(`created_at.${direction === 1 ? 'gt' : 'lt'}.`.length).split(',')[0];
          const selectedId = expression.match(/,id\.(?:gt|lt)\.([^)]*)/)[1];
          const matches = rows.filter((row) => direction * (row.created_at.localeCompare(timestamp) || row.id.localeCompare(selectedId)) > 0);
          matches.sort((left, right) => direction * (left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)));
          assert.deepEqual(order, [['created_at', direction === 1], ['id', direction === 1]]);
          return { data: matches[0] ?? null, error: null };
        },
      };
    } },
  });
  for (const index of [0, 1, 999, 1000, 1001, 1999, 2000]) {
    const navigation = await read(canonical[index].id);
    assert.equal(navigation.previousId, canonical[index - 1]?.id ?? null);
    assert.equal(navigation.nextId, canonical[index + 1]?.id ?? null);
  }
});

test('D06: real admin chat list query rejects malformed HTTP 200 rather than inventing an empty list', async () => {
  const file = syntax('app/dashboard/chat/page.tsx'); let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useQuery') {
      const options = node.arguments[0];
      if (ts.isObjectLiteralExpression(options) && options.getText(file).includes("'admin-chat-list'")) {
        callback = options.properties.find((property) => property.name?.getText(file) === 'queryFn').initializer;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file); assert.ok(callback);
  let payload = { ok: true };
  const read = execute(callback.getText(file), { fetch: async () => ({ ok: true, json: async () => payload }) });
  await assert.rejects(read(), /응답/);
  payload = []; assert.equal((await read()).length, 0);
});


test('existing board attachment deletion updates the list and frees capacity only after confirmation', async () => {
  let existing = [{ id: 'one', fileName: 'synthetic.txt' }, { id: 'two', fileName: 'other.txt' }];
  let writes = 0; let accepted = false; const invalidated = [];
  const remove = execute(extract('app/dashboard/board/page.tsx', 'removeExistingAttachment'), {
    actor: { role: 'admin' }, editingPostId: 'synthetic-post', window: { confirm: () => accepted },
    deleteBoardAttachments: async (_, id, files) => { writes++; assert.equal(id, 'synthetic-post'); assert.deepEqual([...files], ['one']); },
    setExistingAttachments: (update) => { existing = update(existing); }, notifications: noNotifications,
    queryClient: { invalidateQueries: (query) => invalidated.push(query.queryKey) },
  });
  await remove(existing[0]); assert.equal(writes, 0); assert.equal(existing.length, 2);
  accepted = true; await remove(existing[0]); assert.equal(writes, 1); assert.deepEqual(existing.map((file) => file.id), ['two']);
  assert.deepEqual(invalidated.map(key => [...key]), [['board-detail', 'synthetic-post'], ['board-posts']]);
  let added = [];
  execute(extract('app/dashboard/board/page.tsx', 'appendAttachments'), {
    existingAttachmentCount: existing.length, attachments: [], MAX_ATTACHMENTS: 2, notifications: noNotifications,
    setAttachments: (update) => { added = update(added); },
  })([{ name: 'new.txt' }, { name: 'excess.txt' }], 'file');
  assert.equal(added.length, 1); assert.equal(added[0].file.name, 'new.txt');
});
