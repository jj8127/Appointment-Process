import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { isBoardSuccess } from './upstream-response-policy.ts';

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
