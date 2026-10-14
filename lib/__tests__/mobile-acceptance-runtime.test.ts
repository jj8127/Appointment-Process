import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { createReadScope } from '../request-board-read-state';
import { getDesignerRequestDetailActions } from '../request-board-review-actions';
import { getMessengerHubCapabilities } from '../messenger-role-capabilities';
import { goBackOrReplace } from '../back-navigation';
import { INSURANCE_HOME_ROUTE } from '../service-home';
import { normalizePhone, validateEmail, validatePassword, validatePhone, validateRequired } from '../validation';
import { resolvePlatformAuthRoute, resolveSessionLandingRoute } from '../session-landing';
import { normalizeReferralInviteCode, parseReferralInvite } from '../referral-deeplink';
import { parseInboxListPayload } from '../inbox-list-contract';
import { parseLoginSuccessResponse } from '../login-response-contract';
import { collectSupabaseRows, chunkSupabaseFilterValues } from '../supabase-query-contract';
import { buildExamPhoneCandidates, normalizeExamSingle } from '../exam-display';
import { createCreationRequestTracker } from '../board-comment-request';
import { buildStoredSignupReferral, getSignupReferralSelectionError, hasValidStoredSignupReferral } from '../signup-referral';
import { normalizeLicenseStatuses } from '../license-statuses';

type Handler = (...args: unknown[]) => Promise<unknown>;
const root = join(__dirname, '../..');

// Execute each actual route callback with controlled I/O. The callback body is
// not copied into the test, so its failure handling and synchronous guards run.
function routeHandler<T = Handler>(path: string, name: string, dependencies: Record<string, unknown>): T {
  const file = ts.createSourceFile(path, readFileSync(join(root, path), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer) {
      expression = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!expression) throw new Error(`Missing callback ${path}:${name}`);
  const code = ts.transpileModule(`const result = ${expression.getText(file)}; return result;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies)) as T;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function controlledScope(matches = () => true) {
  return { matches, captureOwner: (_expected: string) => matches };
}

function mobileModule(path: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exported: Record<string, (...args: any[]) => any> = {};
  const code = ts.transpileModule(readFileSync(join(root, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', ...Object.keys(globals), code)(exported, (name: string) => modules[name], ...Object.values(globals));
  return exported;
}

function actualBeginAttempt() {
  return mobileModule('lib/use-read-attempt.ts', { react: {
    useRef: (value: unknown) => ({ current: value }), useEffect: (effect: () => void) => effect(), useCallback: (callback: unknown) => callback,
  } }).useReadAttempt();
}

class ConfirmedWriteError extends Error {}
const initialPreferences = { globalPushEnabled: false, categories: { messages: true, operations: true, notices: true, request_activity: true }, rooms: [] };
function preferenceContext(overrides: Record<string, unknown> = {}) {
  return {
    preferences: initialPreferences, pendingKey: null, savingRef: { current: false },
    beginMutation: () => () => true, beginLoad: () => () => true,
    ownerScope: { current: controlledScope() }, ownerKey: 'synthetic-session',
    NotificationPreferenceWriteConfirmedError: ConfirmedWriteError,
    setConfirmGlobalOff: jest.fn(), setPendingKey: jest.fn(), setError: jest.fn(), setPreferences: jest.fn(), setPermission: jest.fn(),
    setLoading: jest.fn(), getNotificationPreferences: jest.fn(async () => initialPreferences),
    setGlobalPushEnabled: jest.fn(async (enabled: boolean) => ({ ...initialPreferences, globalPushEnabled: enabled })),
    setPushCategoryEnabled: jest.fn(async () => ({ ...initialPreferences, globalPushEnabled: true })),
    registerPushToken: jest.fn(async () => ({ ok: true })), getPushPermissionStatus: jest.fn(async () => 'granted'),
    pushRole: 'fc', residentId: 'synthetic-actor', displayName: 'synthetic', load: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe('M05 / D04 / D08 notification preference route behavior', () => {
  it.each(['registration', 'permission'])('keeps a completed ON write when %s throws', async (failure) => {
    const context = preferenceContext(failure === 'registration'
      ? { registerPushToken: jest.fn(async () => { throw new Error('synthetic registration failure'); }) }
      : { getPushPermissionStatus: jest.fn(async () => { throw new Error('synthetic permission failure'); }) });
    await routeHandler('app/notification-settings.tsx', 'commitGlobal', context)(true);
    expect(context.setPreferences.mock.calls.every(([value]) => value.globalPushEnabled === true)).toBe(true);
    expect(context.setError).toHaveBeenLastCalledWith(expect.stringContaining('저장했습니다'));
    expect(context.savingRef.current).toBe(false);
  });

  it('blocks a synchronous second setting write before React rerenders', async () => {
    const pending = deferred<typeof initialPreferences>();
    const context = preferenceContext({ setGlobalPushEnabled: jest.fn(() => pending.promise) });
    const commit = routeHandler('app/notification-settings.tsx', 'commitGlobal', context);
    const first = commit(true);
    const second = commit(true);
    const calls = context.setGlobalPushEnabled.mock.calls.length;
    pending.resolve({ ...initialPreferences, globalPushEnabled: true });
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  it('retains a committed category value after the confirmation read failed', async () => {
    const context = preferenceContext({ preferences: { ...initialPreferences, globalPushEnabled: true }, setPushCategoryEnabled: jest.fn(async () => { throw new ConfirmedWriteError(); }) });
    await routeHandler('app/notification-settings.tsx', 'commitCategory', context)('operations', false);
    expect(context.setPreferences).toHaveBeenCalledTimes(1);
    expect(context.setPreferences).toHaveBeenCalledWith(expect.objectContaining({ categories: expect.objectContaining({ operations: false }) }));
    expect(context.setError).toHaveBeenLastCalledWith(expect.stringContaining('저장했습니다'));
  });

  it('ignores a late successful write after account ownership changes', async () => {
    let current = true;
    const pending = deferred<typeof initialPreferences>();
    const context = preferenceContext({ ownerScope: { current: controlledScope(() => current) }, setGlobalPushEnabled: jest.fn(() => pending.promise) });
    const first = routeHandler('app/notification-settings.tsx', 'commitGlobal', context)(true);
    current = false;
    context.setPreferences.mockClear(); context.setPendingKey.mockClear(); context.setError.mockClear();
    pending.resolve({ ...initialPreferences, globalPushEnabled: true });
    await first;
    expect(context.setPreferences).not.toHaveBeenCalled();
    expect(context.setPendingKey).not.toHaveBeenCalled();
    expect(context.registerPushToken).not.toHaveBeenCalled();
  });

  it('ignores a late preference read after account ownership changes', async () => {
    let current = true;
    const pending = deferred<typeof initialPreferences>();
    const context = preferenceContext({ ownerScope: { current: controlledScope(() => current) }, getNotificationPreferences: () => pending.promise, setLoading: jest.fn() });
    const first = routeHandler('app/notification-settings.tsx', 'load', context)();
    current = false;
    context.setPreferences.mockClear(); context.setPermission.mockClear();
    pending.resolve(initialPreferences);
    await first;
    expect(context.setPreferences).not.toHaveBeenCalled();
    expect(context.setPermission).not.toHaveBeenCalled();
  });

  it('keeps the saved warning through a failed recovery read', async () => {
    const context = preferenceContext({ getNotificationPreferences: jest.fn(async () => { throw new Error('synthetic read failure'); }), setLoading: jest.fn() });
    await routeHandler('app/notification-settings.tsx', 'load', context)({ preserveError: true });
    expect(context.setError).not.toHaveBeenCalled();
    expect(context.setPreferences).not.toHaveBeenCalled();
    expect(context.setLoading).toHaveBeenLastCalledWith(false);
  });

  it('does not start a background read while a setting write is pending', async () => {
    const context = preferenceContext({ savingRef: { current: true }, getNotificationPreferences: jest.fn(), setLoading: jest.fn() });
    await routeHandler('app/notification-settings.tsx', 'load', context)();
    expect(context.getNotificationPreferences).not.toHaveBeenCalled();
  });

  it('preserves last-good preferences on an ordinary failed refresh', async () => {
    const context = preferenceContext({ getNotificationPreferences: jest.fn(async () => { throw new Error('synthetic read failure'); }), setLoading: jest.fn() });
    await routeHandler('app/notification-settings.tsx', 'load', context)();
    expect(context.setPreferences).not.toHaveBeenCalled();
    expect(context.setError).toHaveBeenLastCalledWith(expect.stringContaining('불러오지 못'));
  });
});

function acceptanceContext(overrides: Record<string, unknown> = {}) {
  return {
    getActionableAssignment: () => ({ id: 2, designer_id: 3, status: 'pending' }),
    getDesignerRequestDetailActions, isRequestBoardDesigner: true,
    designerActionRef: { current: false }, beginDesignerAction: () => () => true,
    accountScope: { current: controlledScope() }, sessionReadKey: 'synthetic-session',
    setDesignerActionKey: jest.fn(), rbAcceptRequest: jest.fn(async () => ({ success: true })),
    getRequestBoardNotificationFeedback: () => null, Alert: { alert: jest.fn() },
    fetchData: jest.fn(async () => undefined), logger: { warn: jest.fn() }, toRequestBoardSessionErrorMessage: () => 'synthetic',
    ...overrides,
  };
}

describe('M09 / D04 / D08 designer quick acceptance', () => {
  it('keeps completion distinct from a later refresh failure', async () => {
    const context = acceptanceContext({ fetchData: jest.fn(async () => { throw new Error('synthetic refresh failure'); }) });
    await routeHandler('app/request-board.tsx', 'handleDesignerAccept', context)({ id: 1 });
    expect(context.Alert.alert).toHaveBeenCalledWith('수락 완료', expect.any(String));
    expect(context.Alert.alert.mock.calls.some(([title]) => title === '수락 실패')).toBe(false);
  });

  it('sends one acceptance during same-tick repeated presses', async () => {
    const pending = deferred<{ success: boolean }>();
    const context = acceptanceContext({ rbAcceptRequest: jest.fn(() => pending.promise) });
    const accept = routeHandler('app/request-board.tsx', 'handleDesignerAccept', context);
    const first = accept({ id: 1 }); const second = accept({ id: 1 });
    const calls = context.rbAcceptRequest.mock.calls.length;
    pending.resolve({ success: true }); await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(context.designerActionRef.current).toBe(false);
  });

  it('does not alert or refresh a later account from an old acceptance', async () => {
    let current = true;
    const pending = deferred<{ success: boolean }>();
    const context = acceptanceContext({ accountScope: { current: controlledScope(() => current) }, rbAcceptRequest: jest.fn(() => pending.promise) });
    const first = routeHandler('app/request-board.tsx', 'handleDesignerAccept', context)({ id: 1 });
    current = false; context.setDesignerActionKey.mockClear();
    pending.resolve({ success: true }); await first;
    expect(context.Alert.alert).not.toHaveBeenCalled();
    expect(context.fetchData).not.toHaveBeenCalled();
    expect(context.setDesignerActionKey).not.toHaveBeenCalled();
  });

  it('retains rejection input on failure and releases the guard for retry', async () => {
    const context = {
      ...acceptanceContext(), designerRejectTarget: { requestId: 1, assignmentId: 2, designerId: 3 },
      designerRejectReason: 'synthetic reason', normalizeDesignerRejectReason: (value: string) => value.trim(),
      rbRejectRequest: jest.fn(async () => ({ success: false })), resetDesignerRejectModal: jest.fn(),
    };
    const reject = routeHandler('app/request-board.tsx', 'handleDesignerRejectConfirm', context);
    await reject(); await reject();
    expect(context.resetDesignerRejectModal).not.toHaveBeenCalled();
    expect(context.rbRejectRequest).toHaveBeenCalledTimes(2);
    expect(context.designerActionRef.current).toBe(false);
  });
});

function homeReadContext(overrides: Record<string, unknown> = {}) {
  return {
    requestBoardRefreshInFlightRef: { current: null as Promise<void> | null }, lastRequestBoardRefreshCompletedAtRef: { current: 0 },
    shouldSkipRequestBoardPassiveRefresh: () => false, role: 'fc', requestBoardRole: 'designer', notificationInboxResidentId: 'synthetic', includeRequestBoardFcInbox: false,
    beginHomeRead: () => () => true, accountScope: { current: controlledScope() }, sessionReadKey: 'synthetic-session',
    isRequestBoardDesigner: true, hasRequestBoardFcReadAccess: false, REQUEST_BOARD_CATEGORY_PREFIX: 'request_board_',
    invokeFcNotify: jest.fn(async () => ({ data: { ok: true, notifications: [], notices: [] }, error: null })), parseInboxListPayload,
    fetchMobileUnreadNotificationCountOrThrow: jest.fn(async () => 0), ensureRequestBoardSession: jest.fn(async () => ({ ok: true })),
    rbGetRequestListOrThrow: jest.fn(async () => []), computeRequestBoardHomeStats: () => ({ total: 0 }),
    setRequestBoardAccessError: jest.fn(), setNotifications: jest.fn(), setUnreadNotifCount: jest.fn(), setUnreadNotifVerified: jest.fn(),
    setDesignerRequests: jest.fn(), setReqStats: jest.fn(), setLoading: jest.fn(), setRefreshing: jest.fn(),
    logger: { warn: jest.fn() }, toRequestBoardSessionErrorMessage: () => 'synthetic error', ...overrides,
  };
}

describe('C03 / C04 / D06 / D08 request-board home reads', () => {
  it.each([undefined, null, {}])('retains the previous inbox and exposes malformed notifications %p', async (notifications) => {
    const context = homeReadContext({ invokeFcNotify: async () => ({ data: { ok: true, notifications, notices: [] }, error: null }) });
    await routeHandler('app/request-board.tsx', 'fetchData', context)({ force: true });
    expect(context.setNotifications).not.toHaveBeenCalled();
    expect(context.setRequestBoardAccessError).toHaveBeenLastCalledWith(expect.stringContaining('알림을 불러오지 못'));
  });

  it('accepts an authoritative empty inbox after a failed read and clears its warning', async () => {
    const context = homeReadContext();
    await routeHandler('app/request-board.tsx', 'fetchData', context)({ force: true });
    expect(context.setNotifications).toHaveBeenCalledWith([]);
    expect(context.setRequestBoardAccessError).toHaveBeenCalledWith(null);
  });

  it('does not apply the original A home result after A to B to A', async () => {
    const scope = createReadScope(); scope.setScope('A');
    const pending = deferred<[]>();
    const context = homeReadContext({ accountScope: { current: scope }, sessionReadKey: 'A', beginHomeRead: actualBeginAttempt(), rbGetRequestListOrThrow: () => pending.promise });
    const first = routeHandler('app/request-board.tsx', 'fetchData', context)({ force: true });
    await Promise.resolve(); await Promise.resolve();
    scope.setScope('B'); scope.setScope('A');
    for (const callback of [context.setDesignerRequests, context.setReqStats, context.setLoading, context.setRefreshing, context.setRequestBoardAccessError]) callback.mockClear();
    pending.resolve([]); await first;
    for (const callback of [context.setDesignerRequests, context.setReqStats, context.setLoading, context.setRefreshing, context.setRequestBoardAccessError]) expect(callback).not.toHaveBeenCalled();
  });

  it('does not replace a later account with any old home read result', async () => {
    let current = true;
    const inbox = deferred<{ data: { ok: boolean; notifications: []; notices: [] }; error: null }>();
    const count = deferred<number>();
    const requests = deferred<[]>();
    const context = homeReadContext({ accountScope: { current: controlledScope(() => current) }, invokeFcNotify: () => inbox.promise, fetchMobileUnreadNotificationCountOrThrow: () => count.promise, rbGetRequestListOrThrow: () => requests.promise });
    const first = routeHandler('app/request-board.tsx', 'fetchData', context)({ force: true });
    await Promise.resolve();
    current = false;
    context.setRequestBoardAccessError.mockClear();
    context.requestBoardRefreshInFlightRef.current = null;
    inbox.resolve({ data: { ok: true, notifications: [], notices: [] }, error: null }); count.resolve(0); requests.resolve([]);
    await first;
    for (const callback of [context.setNotifications, context.setUnreadNotifCount, context.setUnreadNotifVerified, context.setDesignerRequests, context.setReqStats, context.setLoading, context.setRefreshing, context.setRequestBoardAccessError]) {
      expect(callback).not.toHaveBeenCalled();
    }
  });

  it('preserves successful counts and requests when their refresh fails', async () => {
    const context = homeReadContext({
      rbGetRequestListOrThrow: jest.fn(async () => { throw new Error('synthetic 503'); }),
      fetchMobileUnreadNotificationCountOrThrow: jest.fn(async () => { throw new Error('synthetic 503'); }),
    });
    await routeHandler('app/request-board.tsx', 'fetchData', context)({ force: true });
    expect(context.setDesignerRequests).not.toHaveBeenCalled();
    expect(context.setReqStats).not.toHaveBeenCalled();
    expect(context.setUnreadNotifCount).not.toHaveBeenCalled();
    expect(context.setUnreadNotifVerified).toHaveBeenCalledWith(false);
    expect(context.setRequestBoardAccessError).toHaveBeenLastCalledWith('synthetic error');
  });

  it('coalesces overlapping home refreshes into one request list read', async () => {
    const pending = deferred<[]>();
    const context = homeReadContext({ rbGetRequestListOrThrow: jest.fn(() => pending.promise) });
    const read = routeHandler('app/request-board.tsx', 'fetchData', context);
    const first = read({ force: true }); const second = read({ force: true });
    await Promise.resolve(); expect(context.rbGetRequestListOrThrow).toHaveBeenCalledTimes(1);
    pending.resolve([]); await Promise.all([first, second]);
  });
});

describe('C02 / D08 Garamin direct and group text sends', () => {
  it.each(['chat', 'group-chat'])('%s sends once before React updates its busy state', async (route) => {
    const pending = deferred<boolean>();
    const context = {
      text: 'synthetic message', selectedAttachments: [], sendingAttachments: false, uploading: false, canSendMessages: true,
      sendingTextRef: { current: false }, beginSend: () => () => true,
      sendOwnerScope: { current: controlledScope() }, sendOwnerKey: 'synthetic-room',
      roomReadScope: { current: controlledScope() }, roomReadKey: 'synthetic-room',
      setSendingAttachments: jest.fn(), setUploading: jest.fn(), setText: jest.fn(), setSelectedAttachments: jest.fn(),
      showSendPermissionAlert: jest.fn(), sendPayload: jest.fn(() => pending.promise), Alert: { alert: jest.fn() }, logger: { warn: jest.fn() },
    };
    const send = routeHandler(`app/${route}.tsx`, 'handleSendText', context);
    send(); send();
    const calls = context.sendPayload.mock.calls.length;
    pending.resolve(true);
    await new Promise((done) => setTimeout(done, 0));
    expect(calls).toBe(1);
    expect(context.sendingTextRef.current).toBe(false);
  });

  it.each(['chat', 'group-chat'])('%s keeps a later room draft after an old success', async (route) => {
    let current = true;
    const pending = deferred<boolean>();
    const context = {
      text: 'synthetic message', selectedAttachments: [], sendingAttachments: false, uploading: false, canSendMessages: true,
      sendingTextRef: { current: false }, beginSend: () => () => true,
      sendOwnerScope: { current: controlledScope(() => current) }, sendOwnerKey: 'synthetic-room',
      roomReadScope: { current: controlledScope(() => current) }, roomReadKey: 'synthetic-room',
      setSendingAttachments: jest.fn(), setUploading: jest.fn(), setText: jest.fn(), setSelectedAttachments: jest.fn(),
      showSendPermissionAlert: jest.fn(), sendPayload: jest.fn(() => pending.promise), Alert: { alert: jest.fn() }, logger: { warn: jest.fn() },
    };
    routeHandler(`app/${route}.tsx`, 'handleSendText', context)();
    current = false;
    context.setSendingAttachments.mockClear(); context.setUploading.mockClear();
    pending.resolve(true);
    await new Promise((done) => setTimeout(done, 0));
    expect(context.setText).not.toHaveBeenCalled();
    expect(context.setSelectedAttachments).not.toHaveBeenCalled();
    expect(context.setSendingAttachments).not.toHaveBeenCalled();
    expect(context.setUploading).not.toHaveBeenCalled();
  });

  it('direct send cannot merge a previous account response into current messages', async () => {
    let current = true;
    const pending = deferred<unknown>();
    const context = {
      myId: 'synthetic-actor', otherId: 'synthetic-target', role: 'fc', resolvedConversation: { id: 'synthetic-room' },
      attachmentBatchRef: { current: null }, randomUUID: () => 'synthetic-client-message',
      createOptimisticMessage: () => ({ id: 'synthetic-local' }), applyMessages: jest.fn(), messagesRef: { current: [] },
      sendGaraminDirectMessage: jest.fn(() => pending.promise), deletedIdsRef: { current: new Set<string>() },
      Alert: { alert: jest.fn() }, logger: { warn: jest.fn() },
    };
    const first = routeHandler('app/chat.tsx', 'sendPayload', context)('synthetic message', [], () => current);
    await Promise.resolve(); current = false; context.applyMessages.mockClear();
    pending.resolve({ message: { id: 'synthetic-sent' }, delivery: { confirmed: true } }); await first;
    expect(context.applyMessages).not.toHaveBeenCalled();
  });

  it('group send cannot merge a previous account response into current messages', async () => {
    let current = true;
    const pending = deferred<unknown>();
    const context = {
      groupChatSend: jest.fn(() => pending.promise), applyMessages: jest.fn(), messagesRef: { current: [] },
      groupChatMarkRead: jest.fn(async () => undefined), hasGroupChatPostCommitWarning: () => false,
      getGroupChatNotificationRetry: () => null, removeMessage: jest.fn(), updateMessage: jest.fn(),
      logger: { warn: jest.fn(), debug: jest.fn() }, showGroupChatErrorAlert: jest.fn(),
    };
    const first = routeHandler('app/group-chat.tsx', 'sendOptimisticToServer', context)('synthetic-local', { content: 'synthetic message', messageType: 'text' }, () => current);
    current = false;
    pending.resolve({ message: { id: 'synthetic-sent' } }); await first;
    expect(context.applyMessages).not.toHaveBeenCalled();
    expect(context.groupChatMarkRead).not.toHaveBeenCalled();
  });

  it.each(['chat', 'group-chat'])('%s stops before sending after account changes during attachment preparation', async (route) => {
    let current = true;
    const pending = deferred<unknown>();
    const context = {
      myId: 'synthetic-actor', otherId: 'synthetic-target', role: 'fc', resolvedConversation: { id: 'synthetic-room' },
      room: { id: 'synthetic-room' }, canSendMessages: true, replyTarget: null,
      attachmentBatchRef: { current: null }, attachmentBatchReplyTargetRef: { current: null },
      isPreparedMessengerAttachmentBatchForDraft: () => false, prepareMessengerAttachmentBatch: () => pending.promise,
      sendGaraminDirectMessage: jest.fn(), sendOptimisticToServer: jest.fn(), createOptimisticMessage: jest.fn(), buildOptimisticMessage: jest.fn(),
      Alert: { alert: jest.fn() }, showSendPermissionAlert: jest.fn(),
    };
    const first = routeHandler(`app/${route}.tsx`, 'sendPayload', context)('synthetic message', [{ clientFileId: 'synthetic-file' }], () => current);
    current = false; pending.resolve({ deliveryKey: 'synthetic-batch' }); await first;
    expect(context.sendGaraminDirectMessage).not.toHaveBeenCalled();
    expect(context.sendOptimisticToServer).not.toHaveBeenCalled();
    expect(context.createOptimisticMessage).not.toHaveBeenCalled();
    expect(context.buildOptimisticMessage).not.toHaveBeenCalled();
    expect(context.attachmentBatchRef.current).toBeNull();
  });
});

describe('C06 / D08 GaramLink mobile messenger controlled failures', () => {
  it.each([
    ['manager', { role: 'admin', readOnly: true, staffType: null, isRequestBoardDesigner: false }, false],
    ['FC', { role: 'fc', readOnly: false, staffType: null, isRequestBoardDesigner: false }, true],
    ['developer', { role: 'admin', readOnly: false, staffType: 'developer', isRequestBoardDesigner: false }, true],
    ['designer', { role: 'fc', readOnly: false, staffType: null, isRequestBoardDesigner: true }, true],
  ] as const)('%s uses the actual screen permission for every write and retains existing-room reads', async (_label, session, writable) => {
    const canWriteRequestBoard = routeHandler('app/request-board-messenger.tsx', 'canWriteRequestBoard', {
      ...session, getMessengerHubCapabilities,
    }) as unknown as boolean;
    expect(canWriteRequestBoard).toBe(writable);
    const account = createReadScope(); account.setScope('account');
    const room = createReadScope(); room.setScope('account:room');
    let onDelete: (() => Promise<void>) | undefined;
    const context = {
      canWriteRequestBoard, activeConv: { id: 'room', primaryConversationId: 1, type: 'dm' },
      accountReadScope: { current: account }, messageReadScope: { current: room }, sessionReadKey: 'account', activeConversationRef: { current: 'room' },
      inputText: 'synthetic draft', pendingFiles: [{ uri: 'synthetic-file', name: 'synthetic', type: 'text/plain' }],
      sendingRef: { current: false }, beginSend: () => () => true, rbUser: { id: 1 }, conversations: [], creatingDm: null,
      setInputText: jest.fn(), setPendingFiles: jest.fn(), setSending: jest.fn(), setMessages: jest.fn(), setConversations: jest.fn(), setCreatingDm: jest.fn(),
      rbUploadAttachments: jest.fn(async () => ({ success: true, data: [] })),
      rbSendDmMessage: jest.fn(async () => ({ success: true, data: { id: 1, message: 'synthetic', createdAt: '2026-01-01T00:00:00Z' } })),
      rbCreateDmConversation: jest.fn(async () => ({ success: true, data: { id: 2, participant: { id: 2 } } })), openConversation: jest.fn(),
      rbDeleteDmMessage: jest.fn(async () => ({ success: true })), rbDeleteMessage: jest.fn(),
      confirmMessengerDelete: jest.fn((options: { onDelete: () => Promise<void> }) => { onDelete = options.onDelete; }),
      loadMessages: jest.fn(), loadConversations: jest.fn(),
      ImagePicker: { requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted' })), launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })) },
      DocumentPicker: { getDocumentAsync: jest.fn(async () => ({ canceled: true })) },
      requestBoardRoomRef: { type: 'direct', conversationId: 1 }, roomPreferenceReady: true, roomPreferencePending: false, roomMuted: false,
      roomPreferenceLoadSequenceRef: { current: 0 },
      rbSetMessengerRoomMuted: jest.fn(async () => ({ success: true, data: { muted: true } })),
      rbGetMessengerRoomPreferences: jest.fn(async () => ({ success: true, data: { rooms: [] } })),
      setRoomMuted: jest.fn(), setRoomPreferencePending: jest.fn(), setRoomPreferenceFailure: jest.fn(), setRoomPreferenceLoading: jest.fn(), setRoomPreferenceReady: jest.fn(),
      fmtRelative: () => '', mapRawMessageToUnified: (value: unknown) => value, mergeMessagesDesc: (value: unknown) => value,
      sortConversationsByLastMessageTime: (value: unknown) => value, flatListRef: { current: null }, Alert: { alert: jest.fn() },
    };
    const run = (name: string, ...args: unknown[]) => routeHandler('app/request-board-messenger.tsx', name, context)(...args);
    await run('handleSend');
    await run('handlePickImage');
    await run('handlePickDocument');
    await run('handleStartDm', { id: 'person', userId: 2 });
    await run('handleDeleteMessage', { id: 1, isOwn: true });
    if (onDelete) await onDelete();
    await run('saveRequestBoardRoomPreference', true);
    for (const write of [context.rbUploadAttachments, context.rbSendDmMessage, context.rbCreateDmConversation, context.rbDeleteDmMessage, context.rbSetMessengerRoomMuted,
      context.ImagePicker.requestMediaLibraryPermissionsAsync, context.ImagePicker.launchImageLibraryAsync, context.DocumentPicker.getDocumentAsync]) {
      expect(write).toHaveBeenCalledTimes(writable ? 1 : 0);
    }
    if (!writable) {
      expect(context.confirmMessengerDelete).not.toHaveBeenCalled();
      expect(context.setInputText).not.toHaveBeenCalled();
      expect(context.setPendingFiles).not.toHaveBeenCalled();
      context.conversations.push({ participantUserId: 2 } as never);
      await run('handleStartDm', { id: 'person', userId: 2, hasConversation: true });
      expect(context.openConversation).toHaveBeenCalledWith(context.conversations[0]);
      expect(context.rbCreateDmConversation).not.toHaveBeenCalled();
    }
    await run('loadRequestBoardRoomPreference');
    expect(context.rbGetMessengerRoomPreferences).toHaveBeenCalledTimes(1);
    expect(context.setRoomPreferenceReady).toHaveBeenLastCalledWith(true);
  });

  it.each(['handlePickImage', 'handlePickDocument', 'handleStartDm', 'saveRequestBoardRoomPreference'])('%s ignores an old result after account A to B to A', async (handler) => {
    const account = createReadScope(); account.setScope('account');
    const room = createReadScope(); room.setScope('account:room');
    const pending = deferred<unknown>();
    const context = {
      canWriteRequestBoard: true, activeConv: { id: 'room', type: 'dm' }, accountReadScope: { current: account }, messageReadScope: { current: room }, sessionReadKey: 'account',
      creatingDm: null, conversations: [], requestBoardRoomRef: { type: 'direct', conversationId: 1 }, roomPreferenceReady: true, roomPreferencePending: false, roomMuted: false,
      ImagePicker: { requestMediaLibraryPermissionsAsync: jest.fn(() => pending.promise), launchImageLibraryAsync: jest.fn() },
      DocumentPicker: { getDocumentAsync: jest.fn(() => pending.promise) }, rbCreateDmConversation: jest.fn(() => pending.promise), rbSetMessengerRoomMuted: jest.fn(() => pending.promise),
      setPendingFiles: jest.fn(), setCreatingDm: jest.fn(), openConversation: jest.fn(), setRoomMuted: jest.fn(), setRoomPreferencePending: jest.fn(), setRoomPreferenceFailure: jest.fn(),
      Alert: { alert: jest.fn() },
    };
    const first = routeHandler('app/request-board-messenger.tsx', handler, context)(handler === 'handleStartDm' ? { id: 'person', userId: 2 } : true);
    account.setScope('other-account'); account.setScope('account');
    for (const update of [context.setPendingFiles, context.setCreatingDm, context.openConversation, context.setRoomMuted, context.setRoomPreferencePending, context.setRoomPreferenceFailure]) update.mockClear();
    pending.resolve({ status: 'granted', canceled: false, assets: [], success: true, data: { id: 2, participant: { id: 2 }, muted: true } });
    await first;
    for (const update of [context.setPendingFiles, context.setCreatingDm, context.openConversation, context.setRoomMuted, context.setRoomPreferencePending, context.setRoomPreferenceFailure, context.Alert.alert]) expect(update).not.toHaveBeenCalled();
    expect(context.ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it.each(['before confirmation', 'after request'])('delete stops %s when account ownership changes', async (transition) => {
    const account = createReadScope(); account.setScope('account');
    const room = createReadScope(); room.setScope('account:room');
    const pending = deferred<{ success: boolean }>(); let onDelete!: () => Promise<void>;
    const context = {
      canWriteRequestBoard: true, activeConv: { id: 'room', type: 'dm' }, accountReadScope: { current: account }, messageReadScope: { current: room }, sessionReadKey: 'account',
      confirmMessengerDelete: ({ onDelete: action }: { onDelete: typeof onDelete }) => { onDelete = action; }, rbDeleteDmMessage: jest.fn(() => pending.promise),
      setMessages: jest.fn(), loadMessages: jest.fn(), loadConversations: jest.fn(),
    };
    await routeHandler('app/request-board-messenger.tsx', 'handleDeleteMessage', context)({ id: 1, isOwn: true });
    const first = transition === 'after request' ? onDelete() : undefined;
    account.setScope('other-account'); account.setScope('account');
    if (!first) await onDelete();
    pending.resolve({ success: true }); await first;
    expect(context.rbDeleteDmMessage).toHaveBeenCalledTimes(transition === 'after request' ? 1 : 0);
    for (const update of [context.setMessages, context.loadMessages, context.loadConversations]) expect(update).not.toHaveBeenCalled();
  });

  it('keeps body and attachment after upload rejection and sends no message', async () => {
    let input = 'synthetic draft'; let files = [{ uri: 'synthetic-file' }];
    const context = {
      canWriteRequestBoard: true, activeConv: { id: 'synthetic-room', primaryConversationId: 1, type: 'direct' }, inputText: input, pendingFiles: files,
      sendingRef: { current: false }, beginSend: () => () => true,
      accountReadScope: { current: controlledScope() }, messageReadScope: { current: controlledScope() }, sessionReadKey: 'synthetic-session', activeConversationRef: { current: 'synthetic-room' },
      conversations: [], setInputText: (value: string | ((old: string) => string)) => { input = typeof value === 'function' ? value(input) : value; },
      setPendingFiles: (value: typeof files | ((old: typeof files) => typeof files)) => { files = typeof value === 'function' ? value(files) : value; },
      setSending: jest.fn(), rbUploadAttachments: jest.fn(async () => ({ success: false })), rbSendDmMessage: jest.fn(),
      Alert: { alert: jest.fn() }, toRequestBoardSessionErrorMessage: () => 'synthetic upload failure',
    };
    await routeHandler('app/request-board-messenger.tsx', 'handleSend', context)();
    expect(input).toBe('synthetic draft'); expect(files).toEqual([{ uri: 'synthetic-file' }]);
    expect(context.rbSendDmMessage).not.toHaveBeenCalled();
    expect(context.Alert.alert).toHaveBeenCalledWith('업로드 실패', 'synthetic upload failure');
    expect(context.sendingRef.current).toBe(false);
  });

  it('does not dispatch an old writable send callback after the account became read-only', async () => {
    const account = createReadScope(); account.setScope('writable-account');
    const room = createReadScope(); room.setScope('writable-account:room');
    const context = {
      canWriteRequestBoard: true, activeConv: { id: 'room' }, inputText: 'synthetic draft', pendingFiles: [{ uri: 'synthetic-file' }],
      sendingRef: { current: false }, beginSend: () => () => true, accountReadScope: { current: account }, messageReadScope: { current: room },
      sessionReadKey: 'writable-account', activeConversationRef: { current: 'room' },
      setInputText: jest.fn(), setPendingFiles: jest.fn(), setSending: jest.fn(), rbUploadAttachments: jest.fn(), rbSendDmMessage: jest.fn(),
    };
    const send = routeHandler('app/request-board-messenger.tsx', 'handleSend', context);
    account.setScope('read-only-account'); room.setScope('read-only-account:room');
    await send();
    for (const action of [context.setInputText, context.setPendingFiles, context.setSending, context.rbUploadAttachments, context.rbSendDmMessage]) expect(action).not.toHaveBeenCalled();
    expect(context.sendingRef.current).toBe(false);
  });

  it('does not restore an old failed send into another room or account', async () => {
    let current = true;
    const pending = deferred<{ success: boolean }>();
    const conv = { id: 'synthetic-room-A', primaryConversationId: 1, type: 'direct' };
    const context = {
      canWriteRequestBoard: true, activeConv: conv, inputText: 'synthetic draft', pendingFiles: [], sendingRef: { current: false }, beginSend: () => () => true,
      accountReadScope: { current: controlledScope(() => current) }, messageReadScope: { current: controlledScope(() => current) }, sessionReadKey: 'synthetic-session', activeConversationRef: { current: conv.id },
      conversations: [], setInputText: jest.fn(), setPendingFiles: jest.fn(), setSending: jest.fn(), setMessages: jest.fn(), setConversations: jest.fn(),
      rbUser: { id: 1 }, fmtRelative: () => '', rbSendDmMessage: jest.fn(() => pending.promise), Alert: { alert: jest.fn() },
    };
    const first = routeHandler('app/request-board-messenger.tsx', 'handleSend', context)();
    current = false; context.activeConversationRef.current = 'synthetic-room-B';
    context.setInputText.mockClear(); context.setPendingFiles.mockClear(); context.setSending.mockClear(); context.setMessages.mockClear(); context.setConversations.mockClear();
    pending.resolve({ success: false }); await first;
    for (const callback of [context.setInputText, context.setPendingFiles, context.setSending, context.setMessages, context.setConversations, context.Alert.alert]) expect(callback).not.toHaveBeenCalled();
  });
});

describe('D08 owner transitions A to B to A without another operation', () => {
  it.each(['chat', 'group-chat'])('%s retains an equal-text new A draft after the original A send completes', async (route) => {
    const scope = createReadScope(); scope.setScope('A');
    const pending = deferred<boolean>(); let draft = 'same synthetic draft';
    const context = {
      text: draft, selectedAttachments: [], sendingAttachments: false, uploading: false, canSendMessages: true,
      sendingTextRef: { current: false }, beginSend: actualBeginAttempt(),
      sendOwnerScope: { current: scope }, sendOwnerKey: 'A', roomReadScope: { current: scope }, roomReadKey: 'A',
      setSendingAttachments: jest.fn(), setUploading: jest.fn(),
      setText: jest.fn((update: (value: string) => string) => { draft = update(draft); }), setSelectedAttachments: jest.fn(),
      showSendPermissionAlert: jest.fn(), sendPayload: jest.fn(() => pending.promise), Alert: { alert: jest.fn() }, logger: { warn: jest.fn() },
    };
    routeHandler(`app/${route}.tsx`, 'handleSendText', context)();
    scope.setScope('B'); context.sendingTextRef.current = false;
    scope.setScope('A'); context.sendingTextRef.current = false;
    context.setSendingAttachments.mockClear(); context.setUploading.mockClear();
    pending.resolve(true); await new Promise((done) => setTimeout(done, 0));
    expect(draft).toBe('same synthetic draft');
    for (const callback of [context.setText, context.setSelectedAttachments, context.setSendingAttachments, context.setUploading]) expect(callback).not.toHaveBeenCalled();
  });

  it.each(['commitGlobal', 'commitCategory', 'load'])('settings %s rejects an old A result after returning to A', async (handler) => {
    const scope = createReadScope(); scope.setScope('A');
    const pending = deferred<typeof initialPreferences>();
    const context = preferenceContext({
      ownerScope: { current: scope }, ownerKey: 'A', beginMutation: actualBeginAttempt(), beginLoad: actualBeginAttempt(),
      preferences: { ...initialPreferences, globalPushEnabled: true },
      setGlobalPushEnabled: () => pending.promise, setPushCategoryEnabled: () => pending.promise, getNotificationPreferences: () => pending.promise,
    });
    const run = routeHandler('app/notification-settings.tsx', handler, context);
    const first = handler === 'commitGlobal' ? run(false) : handler === 'commitCategory' ? run('operations', false) : run();
    scope.setScope('B'); context.savingRef.current = false; scope.setScope('A');
    for (const callback of [context.setPreferences, context.setPendingKey, context.setPermission, context.setLoading, context.setError]) callback.mockClear();
    pending.resolve(initialPreferences); await first;
    for (const callback of [context.setPreferences, context.setPendingKey, context.setPermission, context.setLoading, context.setError, context.registerPushToken]) expect(callback).not.toHaveBeenCalled();
  });

  it.each(['handleDesignerAccept', 'handleDesignerRejectConfirm'])('%s rejects an old A result after returning to A', async (handler) => {
    const scope = createReadScope(); scope.setScope('A');
    const pending = deferred<{ success: boolean }>();
    const context = acceptanceContext({
      accountScope: { current: scope }, sessionReadKey: 'A', beginDesignerAction: actualBeginAttempt(),
      rbAcceptRequest: () => pending.promise, rbRejectRequest: () => pending.promise,
      designerRejectTarget: { requestId: 1, assignmentId: 2, designerId: 3 }, designerRejectReason: 'synthetic',
      normalizeDesignerRejectReason: (value: string) => value, resetDesignerRejectModal: jest.fn(),
    });
    const first = routeHandler('app/request-board.tsx', handler, context)({ id: 1 });
    scope.setScope('B'); context.designerActionRef.current = false; scope.setScope('A');
    context.setDesignerActionKey.mockClear(); pending.resolve({ success: true }); await first;
    expect(context.Alert.alert).not.toHaveBeenCalled(); expect(context.fetchData).not.toHaveBeenCalled();
    expect(context.setDesignerActionKey).not.toHaveBeenCalled();
  });

  it('mobile GaramLink failed A send cannot restore its draft after A to B to A', async () => {
    const account = createReadScope(); account.setScope('account');
    const room = createReadScope(); room.setScope('account:room-A');
    const pending = deferred<{ success: boolean }>();
    const context = {
      canWriteRequestBoard: true, activeConv: { id: 'room-A', primaryConversationId: 1, type: 'direct' }, inputText: 'original synthetic draft', pendingFiles: [],
      sendingRef: { current: false }, beginSend: actualBeginAttempt(), accountReadScope: { current: account }, messageReadScope: { current: room },
      sessionReadKey: 'account', activeConversationRef: { current: 'room-A' }, conversations: [], rbUser: { id: 1 }, fmtRelative: () => '',
      setInputText: jest.fn(), setPendingFiles: jest.fn(), setSending: jest.fn(), setMessages: jest.fn(), setConversations: jest.fn(),
      rbSendDmMessage: () => pending.promise, Alert: { alert: jest.fn() },
    };
    const first = routeHandler('app/request-board-messenger.tsx', 'handleSend', context)();
    room.setScope('account:room-B'); context.activeConversationRef.current = 'room-B';
    room.setScope('account:room-A'); context.activeConversationRef.current = 'room-A';
    for (const callback of [context.setInputText, context.setPendingFiles, context.setSending, context.setMessages, context.setConversations]) callback.mockClear();
    pending.resolve({ success: false }); await first;
    for (const callback of [context.setInputText, context.setPendingFiles, context.setSending, context.setMessages, context.setConversations, context.Alert.alert]) expect(callback).not.toHaveBeenCalled();
  });
});

function noticeContext(overrides: Record<string, unknown> = {}) {
  return {
    submitRef: { current: false }, beginSubmit: () => () => true, createIntent: { current: null },
    role: 'admin', readOnly: false, residentId: 'synthetic-actor',
    title: ' synthetic notice ', body: ' synthetic body ', category: ' synthetic category ',
    images: [{ uri: 'synthetic-image' }], files: [], uploadToSupabase: jest.fn(async () => ({ url: 'synthetic-image-url' })),
    Crypto: { randomUUID: jest.fn(() => 'synthetic-request-key') },
    invokeAdminAction: jest.fn<Promise<{ notice: { id: string } }>, unknown[]>(async () => ({ notice: { id: 'synthetic-notice' } })),
    isNotificationUuid: () => true, notifyAllFcs: jest.fn(async () => ({ confirmed: true })), presentPostCommitNotificationDelivery: jest.fn(),
    setLoading: jest.fn(), setTitle: jest.fn(), setBody: jest.fn(), setCategory: jest.fn(), setImages: jest.fn(), setFiles: jest.fn(),
    Alert: { alert: jest.fn() }, ...overrides,
  };
}

describe('C01 / C02 / D01 / D08 actual mobile notice creation', () => {
  it('reuses one creation key and uploaded payload after a lost response', async () => {
    const context = noticeContext();
    context.invokeAdminAction.mockRejectedValueOnce(new Error('synthetic lost response'));
    const submit = routeHandler('app/admin-notice.tsx', 'submit', context);
    await submit();
    expect(context.setTitle).not.toHaveBeenCalled(); expect(context.setBody).not.toHaveBeenCalled();
    expect(context.createIntent.current).toBeTruthy();
    await submit();
    expect(context.Crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(context.uploadToSupabase).toHaveBeenCalledTimes(1);
    expect(context.invokeAdminAction.mock.calls[0][2]).toBe(context.invokeAdminAction.mock.calls[1][2]);
    expect(context.presentPostCommitNotificationDelivery).toHaveBeenCalledTimes(1);
    expect(context.createIntent.current).toBeNull();
  });

  it('blocks duplicate submission and ignores late completion from an old owner', async () => {
    let current = true;
    const pending = deferred<{ notice: { id: string } }>();
    const invokeAdminAction = jest.fn(() => pending.promise);
    const context = noticeContext({ beginSubmit: () => () => current, images: [], invokeAdminAction });
    const submit = routeHandler('app/admin-notice.tsx', 'submit', context);
    const first = submit(); await Promise.resolve(); await Promise.resolve();
    await submit(); expect(invokeAdminAction).toHaveBeenCalledTimes(1);
    current = false;
    pending.resolve({ notice: { id: 'synthetic-notice' } }); await first;
    expect(context.setTitle).not.toHaveBeenCalled(); expect(context.setBody).not.toHaveBeenCalled();
    expect(context.notifyAllFcs).not.toHaveBeenCalled(); expect(context.presentPostCommitNotificationDelivery).not.toHaveBeenCalled();
  });
});


describe('mobile route regressions moved from the Edge fixture', () => {
  it('exam pending counts use the latest application status', async () => {
    const rows = [['a', 'applied', false], ['b', 'cancelled', false], ['c', 'rejected', false], ['d', 'confirmed', true], ['e', 'applied', false], ['e', 'cancelled', false]]
      .map(([resident_id, status, is_confirmed], index) => ({ id: `registration-${index}`, created_at: new Date(2026, 0, index + 1).toISOString(), resident_id, status, is_confirmed, exam_rounds: { exam_type: 'life' } }));
    const isRecord = routeHandler('app/index.tsx', 'isRecord', {});
    const isNullableBoolean = routeHandler('app/index.tsx', 'isNullableBoolean', {});
    const isExamStatsRound = routeHandler('app/index.tsx', 'isExamStatsRound', { isRecord });
    const isExamStatsRegistrationRow = routeHandler('app/index.tsx', 'isExamStatsRegistrationRow', { isRecord, isNullableBoolean, isExamStatsRound });
    const isExamStatsProfileRow = routeHandler('app/index.tsx', 'isExamStatsProfileRow', { isRecord });
    const read = routeHandler('app/index.tsx', 'fetchExamStats', {
      collectSupabaseRows, chunkSupabaseFilterValues, buildExamPhoneCandidates, normalizeExamSingle,
      isExamStatsRegistrationRow, isExamStatsProfileRow,
      supabase: { from(table: string) {
        let data: (typeof rows[number] | { id: string; phone: string })[] = table === 'exam_registrations' ? rows : ['a', 'b', 'c', 'd', 'e'].map(phone => ({ id: `profile-${phone}`, phone }));
        return {
          select() { return this; }, order() { return this; },
          in(_field: string, phones: string[]) { data = data.filter(value => 'phone' in value && phones.includes(value.phone as string)); return this; },
          range: async (from: number, to: number) => ({ data: data.slice(from, to + 1), error: null }),
        };
      } },
    });
    const result = await read() as { lifeTotal: number; lifePending: number; nonlifePending: number };
    expect(result).toMatchObject({ lifeTotal: 5, lifePending: 1, nonlifePending: 0 });
  });

  it.each([true, false])('consent refresh preserves known state on a %s current owner', async (current) => {
    const changes: string[] = [];
    await routeHandler('app/consent.tsx', 'loadProfile', {
      residentId: '00000000002', beginRead: () => () => current,
      supabase: { from() { return this; }, select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: new Error('synthetic') }) },
      setProfileLoadState: (state: string) => changes.push(state),
      setProfileId: jest.fn(), setTempId: jest.fn(), setSelectedDate: jest.fn(), setCareerType: jest.fn(), setRejectReason: jest.fn(), setIsApproved: jest.fn(),
    })();
    expect(changes).toEqual(current ? ['loading', 'error'] : []);
  });

  it('dirty basic information blocks a read; edits during a read block hydration', async () => {
    const dirty = { current: true }; const invoke = jest.fn(async () => { dirty.current = true; return { profile: { id: 'synthetic' } }; }); const reset = jest.fn(); const alert = jest.fn();
    const load = routeHandler('app/fc/new.tsx', 'loadExisting', {
      phoneFromSession: '00000000002', normalizePhone: (value: string) => value, beginRead: () => () => true,
      draftDirtyRef: dirty, Alert: { alert }, setProfileLoadState: jest.fn(), invokeAdminAction: invoke, reset,
    });
    await load(); expect(invoke).not.toHaveBeenCalled(); expect(alert).toHaveBeenCalledTimes(1);
    dirty.current = false; await load(); expect(invoke).toHaveBeenCalledTimes(1); expect(reset).not.toHaveBeenCalled();
  });

  it('old basic information save cannot restore a later account', async () => {
    let active = true; const loginAs = jest.fn(); const sendNotificationAndPush = jest.fn(); const invokeAdminAction = jest.fn(async () => { active = false; return { profile: { id: 'synthetic-profile' } }; });
    const values = { name: 'synthetic-new', affiliation: 'branch', email: 'synthetic@example.invalid', carrier: 'carrier', address: 'same', addressDetail: 'same', residentFront: '', residentBack: '' };
    await routeHandler('app/fc/new.tsx', 'onSubmit', {
      submittingRef: { current: false }, beginSubmit: () => () => active, profileLoadState: 'ready', existingProfile: { id: 'synthetic-profile', ...values }, existingAddress: 'same', existingAddressDetail: 'same', existingResidentMasked: 'synthetic-masked',
      phoneFromSession: '00000000002', normalizePhone: (value: string) => value, role: 'fc', canOpenFcProfileRegistration: () => true, setSubmitting: jest.fn(), buildFcBasicInformationPatch: () => ({ name: 'synthetic-new' }),
      invokeAdminAction, loginAs, sendNotificationAndPush, Alert: { alert: jest.fn() }, logger: { warn: jest.fn() },
    })(values);
    expect(invokeAdminAction).toHaveBeenCalledTimes(1); expect(loginAs).not.toHaveBeenCalled(); expect(sendNotificationAndPush).not.toHaveBeenCalled();
  });

  it('basic information completion returns to the insurance home after a confirmed save', async () => {
    const values = { name: 'synthetic', affiliation: 'branch', email: '', carrier: 'carrier', address: 'same', addressDetail: 'same', residentFront: '', residentBack: '' };
    const router = { replace: jest.fn() };
    await routeHandler('app/fc/new.tsx', 'onSubmit', {
      submittingRef: { current: false }, beginSubmit: () => () => true, profileLoadState: 'ready', existingProfile: { id: 'synthetic-profile', ...values }, existingAddress: 'same', existingAddressDetail: 'same', existingResidentMasked: 'synthetic-masked',
      phoneFromSession: '00000000002', normalizePhone: (value: string) => value, role: 'fc', canOpenFcProfileRegistration: () => true, setSubmitting: jest.fn(), buildFcBasicInformationPatch: () => ({ name: values.name }),
      invokeAdminAction: async () => ({ profile: { id: 'synthetic-profile' } }), queryClient: { invalidateQueries: jest.fn() }, sendNotificationAndPush: jest.fn(), allowSavedExit: jest.fn(), setSavedExit: jest.fn(), reset: jest.fn(), loginAs: jest.fn(), appSessionToken: 'synthetic-session',
      presentPostCommitNotificationDelivery: ({ onDone }: { onDone: () => void }) => onDone(), router, INSURANCE_HOME_ROUTE, Alert: { alert: jest.fn() }, logger: { warn: jest.fn() },
    })(values);
    expect(router.replace).toHaveBeenCalledWith(INSURANCE_HOME_ROUTE);
  });

  it('consent completion retains the insurance home after a confirmed save', async () => {
    const router = { replace: jest.fn() };
    await routeHandler('app/consent.tsx', 'submit', {
      tempId: 'synthetic', selectedDate: new Date('2026-10-10T00:00:00Z'), ymd: '2026-10-10', residentId: '00000000002', setLoading: jest.fn(),
      appSessionToken: 'synthetic-session',
      supabase: { functions: { invoke: async () => ({ data: { ok: true, profile: { id: 'synthetic-profile' } }, error: null }) } }, invokeFcNotifyForDelivery: jest.fn(),
      presentPostCommitNotificationDelivery: ({ onDone }: { onDone: () => void }) => onDone(), router, INSURANCE_HOME_ROUTE, Alert: { alert: jest.fn() }, logger: { warn: jest.fn() },
    })();
    expect(router.replace).toHaveBeenCalledWith(INSURANCE_HOME_ROUTE);
  });

  it.each([[false, false], [false, true], [true, true]])('document home action preserves the insurance or approved handoff destination (admin=%s, approved=%s)', (isAdmin, isDocsApproved) => {
    expect(routeHandler<string>('app/docs-upload.tsx', 'footerRoute', { isAdmin, isDocsApproved, INSURANCE_HOME_ROUTE }))
      .toBe(!isAdmin && isDocsApproved ? '/hanwha-commission' : INSURANCE_HOME_ROUTE);
  });

  it('document deletion cancel performs no write; confirm locks writes and protects approved documents', async () => {
    let buttons!: { style?: string; onPress?: () => Promise<void> }[];
    const invokeAdminAction = jest.fn(async () => ({ cleanupPending: false })); const docs = [{ type: 'required', status: 'pending' }];
    const context = {
      fc: { id: 'synthetic' }, docs, deletingRef: { current: false }, beginMutation: () => () => true, uploadingType: null, profileLoadState: 'success', residentId: '00000000002', isAdmin: false,
      Alert: { alert: (_title: string, _text: string, next: typeof buttons) => { buttons = next; } }, setDeletingType: jest.fn(), setDocs: jest.fn(), setFc: jest.fn(), setCleanupPending: jest.fn(), loadData: jest.fn(), DOC_WORKFLOW_RESET_FIELDS: {}, invokeAdminAction,
    };
    const remove = routeHandler('app/docs-upload.tsx', 'handleDelete', context);
    await remove('required', 'path'); expect(invokeAdminAction).not.toHaveBeenCalled(); expect(buttons[0].style).toBe('cancel');
    await Promise.all([buttons[1].onPress!(), buttons[1].onPress!()]); expect(invokeAdminAction).toHaveBeenCalledTimes(1);
    docs[0].status = 'approved'; await remove('required', 'path'); expect(invokeAdminAction).toHaveBeenCalledTimes(1);
  });

  it('cleanup retry locks immediately and ignores a changed route', async () => {
    let active = true; const pending = deferred<{ cleanupPending: boolean }>(); const invokeAdminAction = jest.fn(() => pending.promise); const setCleanupPending = jest.fn();
    const retry = routeHandler('app/docs-upload.tsx', 'retryCleanup', {
      fc: { id: 'synthetic-first' }, deletingRef: { current: false }, beginMutation: () => () => active, residentId: '00000000001', isAdmin: true,
      setDeletingType: jest.fn(), invokeAdminAction, setCleanupPending, setCleanupStatusError: jest.fn(), Alert: { alert: jest.fn() },
    });
    const first = retry(); await retry(); expect(invokeAdminAction).toHaveBeenCalledTimes(1);
    active = false; pending.resolve({ cleanupPending: false }); await first; expect(setCleanupPending).not.toHaveBeenCalled();
  });

  it('document re-entry restores the durable cleanup status without exposing queue records', async () => {
    const setCleanupPending = jest.fn(); const invokeAdminAction = jest.fn(async () => ({ cleanupPending: true }));
    const loadAllDocuments = jest.fn(async () => []); const alert = jest.fn();
    const query = { from() { return this; }, select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 'synthetic-profile' }, error: null }) };
    await routeHandler('app/docs-upload.tsx', 'loadData', {
      beginRead: () => () => true, hasInvalidUserRoute: false, isAdmin: true, routeUserId: 'synthetic-profile', residentId: '00000000001', supabase: query,
      setProfileLoadState: jest.fn(), setFc: jest.fn(), setDocs: jest.fn(), setCleanupStatusError: jest.fn(), setCleanupPending, invokeAdminAction, loadAllDocuments, Alert: { alert },
    })();
    expect(setCleanupPending).toHaveBeenCalledWith(true); expect(invokeAdminAction).toHaveBeenCalledWith('00000000001', 'getDocumentCleanupStatus', { fcId: 'synthetic-profile' });
    expect(loadAllDocuments).toHaveBeenCalledWith('synthetic-profile'); expect(alert).not.toHaveBeenCalled();
  });

  it('failed messenger response preserves the old draft beside newly typed input', async () => {
    let input = 'sent draft'; let files = [{ uri: 'synthetic-old' }]; const pending = deferred<{ success: boolean }>(); const send = jest.fn(() => { input = 'next draft'; return pending.promise; }); const alert = jest.fn(); const busy = { current: false };
    const conv = { id: 'synthetic-conversation', primaryConversationId: 1, type: 'direct' };
    const action = routeHandler('app/request-board-messenger.tsx', 'handleSend', {
      canWriteRequestBoard: true, activeConv: conv, inputText: input, pendingFiles: files, sendingRef: busy, beginSend: () => () => true,
      accountReadScope: { current: controlledScope() }, messageReadScope: { current: controlledScope() }, sessionReadKey: 'synthetic-session', activeConversationRef: { current: conv.id },
      conversations: [], setInputText: (update: string | ((old: string) => string)) => { input = typeof update === 'function' ? update(input) : update; }, setPendingFiles: (update: typeof files | ((old: typeof files) => typeof files)) => { files = typeof update === 'function' ? update(files) : update; },
      setSending: jest.fn(), rbUploadAttachments: async () => ({ success: true, data: [] }), rbSendDmMessage: send, rbUser: { id: 1 }, setMessages: jest.fn(), setConversations: jest.fn(), fmtRelative: () => '', Alert: { alert },
    });
    const first = action(); await new Promise(resolve => setTimeout(resolve, 0)); await action(); expect(send).toHaveBeenCalledTimes(1);
    pending.resolve({ success: false }); await first;
    expect(input).toBe('sent draft\nnext draft'); expect(files).toHaveLength(1); expect(alert).toHaveBeenCalledWith('전송 확인 필요', expect.any(String)); expect(busy.current).toBe(false);
  });

  it('unmount invalidates existing and future read continuations', () => {
    let cleanup!: () => void;
    const begin = mobileModule('lib/use-read-attempt.ts', { react: {
      useRef: (value: unknown) => ({ current: value }), useCallback: (callback: unknown) => callback, useEffect: (effect: () => () => void) => { cleanup = effect(); },
    } }).useReadAttempt();
    const before = begin(); expect(before()).toBe(true); cleanup(); expect(before()).toBe(false); expect(begin()()).toBe(false);
  });
});


it('draft navigation preserves cancellation and busy exits; explicit discard and saved exits dispatch once', () => {
  function scenario(dirty: boolean, busy: boolean, os = 'android', focused = true) {
    let callback!: (event: { data: { action: string } }) => void;
    let buttons: { style: string; onPress?: () => void }[] | undefined;
    let hardware!: () => boolean; let beforeUnload!: (event: { preventDefault: () => void; returnValue: string | null }) => void;
    const dispatch: string[] = []; const effects: (() => unknown)[] = [];
    const removeBack = jest.fn();
    const navigation = { dispatch: (action: string) => dispatch.push(action), canGoBack: () => true, goBack: () => callback({ data: { action: 'back' } }) };
    const allow = mobileModule('hooks/use-draft-exit-guard.ts', {
      '@react-navigation/native': { useNavigation: () => navigation, usePreventRemove: (_enabled: boolean, fn: typeof callback) => { callback = fn; }, useFocusEffect: (fn: () => unknown) => { if (focused) effects.push(fn); } },
      react: { useRef: (value: unknown) => ({ current: value }), useCallback: (fn: unknown) => fn },
      'react-native': { Alert: { alert: (_title: string, _text: string, next: typeof buttons) => { buttons = next; } }, BackHandler: { addEventListener: (_event: string, fn: typeof hardware) => { hardware = fn; return { remove: removeBack }; } }, Platform: { OS: os } },
    }, { window: { addEventListener: (_event: string, fn: typeof beforeUnload) => { beforeUnload = fn; }, removeEventListener() {} } }).useDraftExitGuard(dirty, busy);
    const cleanups = effects.map(effect => effect());
    return { dispatch, allow, exit: () => callback({ data: { action: 'leave' } }), get buttons() { return buttons; }, hardware, event: () => beforeUnload,
      blur: () => cleanups.forEach(cleanup => { if (typeof cleanup === 'function') cleanup(); }), removeBack };
  }
  const dirty = scenario(true, false); dirty.exit(); expect(dirty.dispatch).toEqual([]); expect(dirty.buttons![0].style).toBe('cancel'); dirty.buttons![1].onPress!(); expect(dirty.dispatch).toEqual(['leave']);
  const busy = scenario(false, true); busy.hardware(); expect(busy.dispatch).toEqual([]); expect(busy.buttons).toBeUndefined();
  const saved = scenario(true, true); saved.allow(); saved.exit(); expect(saved.dispatch).toEqual(['leave']);
  const preventDefault = jest.fn(); scenario(true, false, 'web').event()({ preventDefault, returnValue: null }); expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(scenario(true, false, 'android', false).hardware).toBeUndefined();
  expect(scenario(true, false, 'web', false).event()).toBeUndefined();
  dirty.blur(); expect(dirty.removeBack).toHaveBeenCalledTimes(1);
});

describe('common member signup and login use isolated verified authentication', () => {
  const PLATFORM_TERMS_VERSION = '2026-10-12';
  class TestPlatformApiError extends Error {
    constructor(message: string, public readonly code: string) { super(message); }
  }
  const authContext = (overrides: Record<string, unknown> = {}) => ({
    pending: { current: false }, cooldown: 0, phone: '01000000000', name: '가상 회원', code: '123456',
    password: 'Synthetic1!', confirmation: 'Synthetic1!', termsAccepted: true, referralCode: ' testcode ',
    PLATFORM_TERMS_VERSION,
    validatePhone, validateRequired, validatePassword, normalizePhone,
    resolvePlatformAuthRoute, resolveSessionLandingRoute, service: undefined, skipAuto: undefined,
    Keyboard: { dismiss: jest.fn() }, setError: jest.fn(), setOtpError: jest.fn(), setNotice: jest.fn(), setLoading: jest.fn(), setCooldown: jest.fn(),
    PlatformApiError: TestPlatformApiError,
    beginAttempt: () => () => true, allowCompletedExit: jest.fn(), loginPlatformMember: jest.fn(async () => undefined),
    captureAppSessionOwner: () => () => true,
    acceptLoginResponse: jest.fn(async () => 'fc'),
    handleLoginRejection: jest.fn(async () => false), setManualLoginSucceeded: jest.fn(),
    rememberPassword: false, setSavedLoginCredentials: jest.fn(async () => undefined),
    sessionKey: 'synthetic-session', currentSessionKey: { current: 'synthetic-session' },
    platformRequest: jest.fn(async () => ({ memberId: 'synthetic-member', displayName: '가상 회원', appSessionToken: 'fictional-consumer-token' })),
    router: { replace: jest.fn(), dismissTo: jest.fn() }, ...overrides,
  });

  it('submits phone proof and minimum member fields without creating an FC identity', async () => {
    const context = authContext();
    await routeHandler('app/services/signup.tsx', 'submit', context)('signup');
    expect(context.platformRequest).toHaveBeenCalledWith('signup', {
      phone: '01000000000', code: '123456', name: '가상 회원', password: 'Synthetic1!', termsAccepted: true, termsVersion: PLATFORM_TERMS_VERSION, referralCode: 'TESTCODE',
    });
    expect(context.loginPlatformMember).toHaveBeenCalledWith({ id: 'synthetic-member', name: '가상 회원' }, 'fictional-consumer-token');
    expect(context.router.dismissTo).toHaveBeenCalledWith('/services/account');
    expect(context.router.replace).not.toHaveBeenCalled();
  });

  it('signup preserves insurance intent instead of dismissing to the common account', async () => {
    const context = authContext({ service: 'insurance' });
    await routeHandler('app/services/signup.tsx', 'submit', context)('signup');
    expect(context.router.replace).toHaveBeenCalledWith({ pathname: '/apply-gate', params: { next: '/?mode=insurance' } });
    expect(context.router.dismissTo).not.toHaveBeenCalled();
  });

  it('OTP requests send only the phone and do not grant a local verified flag', async () => {
    const context = authContext();
    await routeHandler('app/services/signup.tsx', 'submit', context)('otp');
    expect(context.platformRequest).toHaveBeenCalledWith('request_otp', { phone: '01000000000' });
    expect(context.setCooldown).toHaveBeenCalledWith(60);
    expect(context.loginPlatformMember).not.toHaveBeenCalled();
  });

  it.each(['request_timeout','sms_delivery_unknown'])('keeps an ambiguous %s issuance on cooldown while allowing an arriving code', async code => {
    const context = authContext({ platformRequest: jest.fn(async () => {
      throw new TestPlatformApiError('synthetic private transport detail',code);
    }) });
    await routeHandler('app/services/signup.tsx','submit',context)('otp');
    expect(context.setCooldown).toHaveBeenCalledWith(60);
    expect(context.setOtpError).toHaveBeenCalledWith(expect.stringContaining('문자가 오면 인증번호를 입력'));
    expect(context.setOtpError).not.toHaveBeenCalledWith(expect.stringContaining('synthetic private'));
  });

  it.each([{ termsAccepted: false }, { code: '123' }, { confirmation: 'different' }])('rejects incomplete signup before a network mutation (%j)', async override => {
    const context = authContext(override);
    await routeHandler('app/services/signup.tsx', 'submit', context)('signup');
    expect(context.platformRequest).not.toHaveBeenCalled();
    expect(context.setError).toHaveBeenCalledWith(expect.any(String));
  });

  it('blocks duplicate signup and preserves the form when OTP verification fails', async () => {
    const pending = deferred<unknown>();
    const context = authContext({ platformRequest: jest.fn(() => pending.promise) });
    const submit = routeHandler('app/services/signup.tsx', 'submit', context);
    const first = submit('signup'); await submit('signup');
    expect(context.platformRequest).toHaveBeenCalledTimes(1);
    pending.resolve(Promise.reject(new Error('인증번호를 확인해주세요.')));
    await first;
    expect(context.setError).toHaveBeenCalledWith('인증번호를 확인해주세요.');
    expect(context.loginPlatformMember).not.toHaveBeenCalled();
    expect(context.router.replace).not.toHaveBeenCalled();
    expect(context.pending.current).toBe(false);
  });

  it.each(['unmount', 'account-change'])('%s prevents a late login from replacing the session', async change => {
    let active = true; let owner = true;
    const pending = deferred<unknown>();
    const context = authContext({ beginAttempt: () => () => active, captureAppSessionOwner: () => () => owner, platformRequest: jest.fn(() => pending.promise) });
    const login = routeHandler('app/services/login.tsx', 'login', context);
    const first = login(); if (change === 'unmount') active = false; else owner = false;
    pending.resolve({ memberId: 'synthetic-member', displayName: '가상 회원', appSessionToken: 'fictional-consumer-token' });
    await first;
    expect(context.loginPlatformMember).not.toHaveBeenCalled();
    expect(context.router.replace).not.toHaveBeenCalled();
  });

  it('common login preserves an existing signed FC response instead of replacing it with consumer rights', async () => {
    const insuranceSession = { ok: true, role: 'fc', residentId: '01000000000', appSessionToken: 'fictional-fc-token', requestBoardBridgeToken: 'fictional-bridge-token' };
    const context = authContext({ platformRequest: jest.fn(async () => ({ insuranceSession })) });
    await routeHandler('app/services/login.tsx', 'login', context)();
    expect(context.acceptLoginResponse).toHaveBeenCalledWith(insuranceSession, '01000000000', expect.any(Function));
    expect(context.loginPlatformMember).not.toHaveBeenCalled();
    expect(context.setManualLoginSucceeded).toHaveBeenCalledWith(true);
    expect(context.router.replace).not.toHaveBeenCalled();
  });

  it.each([true, false])('password recovery reuses the screen and keeps platform=%s transport separate', async isPlatform => {
    const invoke = jest.fn(async () => ({ data: { ok: true }, error: null }));
    const context = { ...authContext(), isPlatform, token: '123456', newPassword: 'Synthetic1!', setRequested: jest.fn(), platformRequest: jest.fn(async () => ({ ok: true })),
      supabase: { functions: { invoke }, auth: { signOut: jest.fn(async () => undefined) } }, logout: jest.fn(), Alert: { alert: jest.fn() } };
    await routeHandler('app/reset-password.tsx', 'handleRequest', context)();
    expect(context.setRequested).toHaveBeenCalledWith(true);
    await routeHandler('app/reset-password.tsx', 'handleReset', context)();
    if (isPlatform) {
      expect(invoke).not.toHaveBeenCalled();
      expect(context.platformRequest).toHaveBeenCalledWith('request_password_reset', { phone: '01000000000' });
      expect(context.platformRequest).toHaveBeenCalledWith('reset_password', { phone: '01000000000', code: '123456', password: 'Synthetic1!' });
      expect(context.router.dismissTo).toHaveBeenCalledWith('/services/login');
    } else {
      expect(context.platformRequest).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith('request-password-reset', { body: { phone: '01000000000' } });
      expect(invoke).toHaveBeenCalledWith('reset-password', { body: { phone: '01000000000', token: '123456', newPassword: 'Synthetic1!' } });
      expect(context.router.dismissTo).toHaveBeenCalledWith('/services/login');
    }
    expect(context.logout).toHaveBeenCalledTimes(1);
    expect(context.logout.mock.invocationCallOrder[0]).toBeLessThan(context.router.dismissTo.mock.invocationCallOrder[0]);
  });

  it('password reset returns to the existing login while retaining insurance and skipAuto intent', async () => {
    const context = { ...authContext({ service: 'insurance', skipAuto: '1' }), isPlatform: true, token: '123456', newPassword: 'Synthetic1!',
      platformRequest: jest.fn(async () => ({ ok: true })), supabase: { auth: { signOut: jest.fn(async () => undefined) } },
      logout: jest.fn(), Alert: { alert: jest.fn() } };
    await routeHandler('app/reset-password.tsx', 'handleReset', context)();
    expect(context.router.dismissTo).toHaveBeenCalledWith({ pathname: '/services/login', params: { service: 'insurance', skipAuto: '1' } });
    expect(context.router.replace).not.toHaveBeenCalled();
    expect(context.logout).toHaveBeenCalledTimes(1);
  });

  it.each(['unmount', 'account-change'])('password reset preserves input, blocks repeats and ignores %s responses', async change => {
    let active = true; let owner = true; const result = deferred<unknown>();
    const context = { ...authContext(), isPlatform: true, token: '123456', newPassword: 'Synthetic1!',
      platformRequest: jest.fn(() => result.promise), beginAttempt: () => () => active,
      captureAppSessionOwner: () => () => owner,
      supabase: { auth: { signOut: jest.fn() } }, logout: jest.fn(), Alert: { alert: jest.fn() } };
    const reset = routeHandler('app/reset-password.tsx', 'handleReset', context);
    const first = reset(); await reset(); expect(context.platformRequest).toHaveBeenCalledTimes(1);
    result.resolve(Promise.reject(new Error('시험 연결 실패'))); await first;
    expect(context.Alert.alert).toHaveBeenCalledWith('오류', '시험 연결 실패');
    expect(context.token).toBe('123456'); expect(context.newPassword).toBe('Synthetic1!');
    expect(context.logout).not.toHaveBeenCalled(); expect(context.pending.current).toBe(false);
    const late = deferred<unknown>(); context.platformRequest.mockImplementation(() => late.promise);
    const second = reset(); if (change === 'unmount') active = false; else owner = false; late.resolve({ ok: true }); await second;
    expect(context.logout).not.toHaveBeenCalled(); expect(context.router.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['fc', 'fc', false, null, 'fc'], ['admin', 'admin', false, 'admin', null], ['manager', 'admin', true, null, 'fc'],
    ['admin', 'admin', false, 'developer', 'fc'],
  ])('shared legacy session install preserves %s permissions and tokens', async (role, expectedRole, readOnly, staffType, requestBoardRole) => {
    const context = {
      clearRequestBoardState: jest.fn(async () => undefined), setAppSessionToken: jest.fn(async () => undefined),
      setBridgeToken: jest.fn(async () => undefined), loginAs: jest.fn(), parseLoginSuccessResponse,
      captureAppSessionOwner: () => () => true,
    };
    const result = await routeHandler('hooks/use-login.ts', 'acceptLoginResponse', context)({
      ok: true, role, staffType, residentId: '01000000000', displayName: '가상 계정', appSessionToken: 'fictional-fc-token', requestBoardBridgeToken: 'fictional-bridge-token', requestBoardRole,
    });
    expect(result).toBe(expectedRole);
    expect(context.setAppSessionToken).toHaveBeenCalledWith('fictional-fc-token');
    expect(context.setBridgeToken).toHaveBeenCalledWith('fictional-bridge-token');
    expect(context.loginAs).toHaveBeenCalledWith(expectedRole, '01000000000', '가상 계정', staffType, readOnly, false, requestBoardRole, 'fictional-fc-token');
  });

  it('a consumer role cannot be accepted as a legacy FC login response', async () => {
    const context = { clearRequestBoardState: jest.fn(), setAppSessionToken: jest.fn(), setBridgeToken: jest.fn(), loginAs: jest.fn(), parseLoginSuccessResponse,
      captureAppSessionOwner: () => () => true };
    await expect(routeHandler('hooks/use-login.ts', 'acceptLoginResponse', context)({ ok: true, role: 'member', appSessionToken: 'fictional-consumer-token' }))
      .rejects.toThrow('로그인 응답');
    expect(context.loginAs).not.toHaveBeenCalled();
    expect(context.setAppSessionToken).not.toHaveBeenCalled();
  });
  it.each(['before', 'clear', 'app-token', 'bridge-token'])('stops a stale legacy session installation at %s before granting FC rights', async stage => {
    let current = stage !== 'before';
    const pause = deferred<void>();
    const context = {
      clearRequestBoardState: jest.fn(() => stage === 'clear' ? pause.promise : Promise.resolve()),
      setAppSessionToken: jest.fn(() => stage === 'app-token' ? pause.promise : Promise.resolve()),
      setBridgeToken: jest.fn(() => stage === 'bridge-token' ? pause.promise : Promise.resolve()),
      loginAs: jest.fn(), parseLoginSuccessResponse, captureAppSessionOwner: () => () => current,
    };
    const result = routeHandler('hooks/use-login.ts', 'acceptLoginResponse', context)({
      ok: true, role: 'fc', residentId: '01000000000', displayName: '합성 계정', appSessionToken: 'fictional-fc-token', requestBoardRole: 'fc',
    }, '01000000000', () => current);
    await Promise.resolve(); await Promise.resolve();
    current = false; pause.resolve(); await result;
    expect(context.loginAs).not.toHaveBeenCalled();
    if (stage === 'before') expect(context.clearRequestBoardState).not.toHaveBeenCalled();
    if (stage === 'before' || stage === 'clear') expect(context.setAppSessionToken).not.toHaveBeenCalled();
    if (stage !== 'bridge-token') expect(context.setBridgeToken).not.toHaveBeenCalled();
  });
  it('keeps temporary-password proof and incomplete preregistration recovery on the common entry', async () => {
    const context = { clearRequestBoardState: jest.fn(async () => undefined), clearSavedLoginCredentials: jest.fn(async () => undefined),
      captureAppSessionOwner: () => () => true, setPendingAssistedPasswordChange: jest.fn(), resolvePlatformAuthRoute, router: { replace: jest.fn() } };
    const reject = routeHandler('hooks/use-login.ts', 'handleLoginRejection', context);
    await reject({ ok: false, code: 'password_change_required', passwordChangeToken: 'synthetic-change-proof', passwordChangeExpiresAt: '2026-10-14T00:00:00Z' }, 'insurance');
    expect(context.setPendingAssistedPasswordChange).toHaveBeenCalledWith('synthetic-change-proof', '2026-10-14T00:00:00Z');
    expect(context.router.replace).toHaveBeenLastCalledWith({ pathname: '/first-password-change', params: { service: 'insurance' } });
    await reject({ ok: false, code: 'not_completed' }, 'insurance');
    expect(context.router.replace).toHaveBeenLastCalledWith({ pathname: '/services/signup', params: { service: 'insurance' } });
    await reject({ ok: false, code: 'needs_password_setup', role: 'fc' }, 'insurance');
    expect(context.router.replace).toHaveBeenLastCalledWith({ pathname: '/reset-password', params: { audience: 'platform', service: 'insurance' } });
  });
});

describe('family-care invitations keep common signup separate from insurance', () => {
  it.each([
    ['anonymous', null, true], ['anonymous', 'fc', false], ['anonymous', 'admin', false],
    ['synthetic-member', null, false], ['fc:synthetic-phone', null, false],
  ])('preserves the initial insurance invite only for %s entering common-only role %s', (previous, role, expected) => {
    const keep = routeHandler<boolean>('app/_layout.tsx', 'keepInitialInsuranceInvite', { previousSessionKey: { current: previous }, role });
    expect(keep).toBe(expected);
  });
  it('ignores unrelated warm events without accepting or replacing a cold invitation', () => {
    const context = { active: true, parseReferralInvite, currentSessionKey: { current: 'anonymous' }, sequence: { current: 0 }, setPending: jest.fn() };
    const capture = routeHandler<(url: string) => boolean>('app/_layout.tsx', 'captureInvite', context);
    expect(capture('hanwhafcpass://services/care')).toBe(false);
    expect(capture('https://unrelated.invalid/')).toBe(false);
    expect(context.setPending).not.toHaveBeenCalled();
    expect(capture('hanwhafcpass://services/signup?service=care&code=ABC123ABCDEF')).toBe(true);
    expect(context.setPending).toHaveBeenCalledWith({ invite: { service: 'care', code: 'ABC123ABCDEF' }, owner: 'anonymous', nonce: 1 });
  });
  const inviteContext = (overrides: Record<string, unknown> = {}) => ({
    active: true, sessionKey: 'anonymous', currentSessionKey: { current: 'anonymous' }, isPlatformSignedIn: false, role: null,
    pending: { invite: { code: 'ABC123ABCDEF', service: 'care' }, nonce: 2 },
    clearPendingReferralCodes: jest.fn(async () => undefined), savePendingReferralCode: jest.fn(async () => undefined),
    router: { replace: jest.fn() }, setPending: jest.fn(), ...overrides,
  });

  it.each(['care', undefined])('routes %s invitations to their own signup with the current code', async service => {
    const context = inviteContext({ pending: { invite: { code: 'ABC123ABCDEF', service }, nonce: 2 } });
    await routeHandler('app/_layout.tsx', 'routeInvite', context)();
    expect(context.savePendingReferralCode).toHaveBeenCalledWith('ABC123ABCDEF', service);
    expect(context.router.replace).toHaveBeenCalledWith(service === 'care'
      ? { pathname: '/services/signup', params: { service: 'care', code: 'ABC123ABCDEF', referralNonce: '2' } }
      : { pathname: '/signup', params: { referralNonce: '2' } });
    expect(context.setPending).toHaveBeenCalledWith(null);
  });

  it('preserves direct care code delivery when optional pending storage fails', async () => {
    const context = inviteContext({ savePendingReferralCode: jest.fn(async () => { throw new Error('synthetic storage failure'); }) });
    await routeHandler('app/_layout.tsx', 'routeInvite', context)();
    expect(context.router.replace).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ code: 'ABC123ABCDEF' }) }));
  });

  it('never saves a referral to reassign an existing signed member', async () => {
    const context = inviteContext({ isPlatformSignedIn: true });
    await routeHandler('app/_layout.tsx', 'routeInvite', context)();
    expect(context.clearPendingReferralCodes).toHaveBeenCalledTimes(1);
    expect(context.savePendingReferralCode).not.toHaveBeenCalled();
  });
  it.each([null, 'fc', 'admin'])('insurance invitations are saved only before FC enrollment for role %s', async role => {
    const context = inviteContext({ isPlatformSignedIn: true, role, pending: { invite: { code: 'ABC123ABCDEF' }, nonce: 2 } });
    await routeHandler('app/_layout.tsx', 'routeInvite', context)();
    if (role === null) expect(context.savePendingReferralCode).toHaveBeenCalledWith('ABC123ABCDEF', undefined);
    else expect(context.savePendingReferralCode).not.toHaveBeenCalled();
  });

  it.each(['clear', 'save'])('does not route a delayed %s after ownership changes', async phase => {
    const deferredWork = deferred<void>();
    const context = inviteContext({ [phase === 'clear' ? 'clearPendingReferralCodes' : 'savePendingReferralCode']: jest.fn(() => deferredWork.promise) });
    const action = routeHandler('app/_layout.tsx', 'routeInvite', context)();
    await Promise.resolve(); await Promise.resolve();
    context.currentSessionKey.current = 'different-synthetic-member';
    deferredWork.resolve(); await action;
    expect(context.router.replace).not.toHaveBeenCalled();
    if (phase === 'clear') expect(context.savePendingReferralCode).not.toHaveBeenCalled();
  });

  const signupInviteContext = (overrides: Record<string, unknown> = {}) => ({
    invitationCode: undefined, isPlatformSignedIn: false, active: true, ownsSession: () => true,
    referralEdited: { current: false }, normalizeReferralInviteCode,
    setReferralCode: jest.fn(), consumePendingReferralCode: jest.fn(async () => 'ABC123ABCDEF'), ...overrides,
  });

  it('uses the explicit common invitation and discards older pending values', async () => {
    const context = signupInviteContext({ invitationCode: ' def456abcdef ' });
    await routeHandler('app/services/signup.tsx', 'loadReferralInvite', context)();
    expect(context.setReferralCode).toHaveBeenCalledTimes(1);
    expect(context.setReferralCode).toHaveBeenCalledWith('DEF456ABCDEF');
    expect(context.consumePendingReferralCode).toHaveBeenCalledWith('care');
  });

  it.each(['manual-edit', 'owner-change', 'existing-member'])('does not apply pending common code after %s', async reason => {
    const pending = deferred<string>(); let owns = true;
    const context = signupInviteContext({ consumePendingReferralCode: jest.fn(() => pending.promise), ownsSession: () => owns,
      isPlatformSignedIn: reason === 'existing-member' });
    const action = routeHandler('app/services/signup.tsx', 'loadReferralInvite', context)();
    if (reason === 'manual-edit') context.referralEdited.current = true;
    if (reason === 'owner-change') owns = false;
    pending.resolve('ABC123ABCDEF'); await action;
    expect(context.setReferralCode).not.toHaveBeenCalled();
    expect(context.consumePendingReferralCode).toHaveBeenCalledWith('care');
  });

  it('ignores an invalid direct code instead of importing an unrelated saved referral', async () => {
    const context = signupInviteContext({ invitationCode: '<invalid>' });
    await routeHandler('app/services/signup.tsx', 'loadReferralInvite', context)();
    expect(context.setReferralCode).toHaveBeenCalledTimes(1);
    expect(context.setReferralCode).toHaveBeenCalledWith('');
  });
});

describe('platform requests keep their account and service owner', () => {
  it.each([
    ['app/services/account.tsx', 'requestDeletion'],
  ])('confirmation opened by an old account cannot submit after a new login (%s)', (path, handler) => {
    let revision = 0;
    const context = {
      token: 'fictional-member-token', deleting: { current: false }, consentPending: { current: false }, pending: { current: false },
      captureAppSessionOwner: () => { const captured = revision; return () => captured === revision; },
      Alert: { alert: jest.fn() }, beginDelete: actualBeginAttempt(), beginCancel: actualBeginAttempt(),
      platformRequest: jest.fn(), setDeleteError: jest.fn(), setDeleteLoading: jest.fn(), setCancelError: jest.fn(), setCancelling: jest.fn(),
      session: { logout: jest.fn() }, router: { replace: jest.fn() }, refresh: jest.fn(),
      deletePending: false,
      deletionCheckFailed: false,
    };
    routeHandler<(id?: string) => void>(path, handler, context)('synthetic-application');
    revision += 1;
    context.Alert.alert.mock.calls[0][2][1].onPress();
    expect(context.platformRequest).not.toHaveBeenCalled();
    expect(context.session.logout).not.toHaveBeenCalled();
    expect(context.pending.current).toBe(false);
    expect(context.deleting.current).toBe(false);
  });

  class PlatformReadError extends Error { constructor(public status: number) { super('조회 실패'); } }
  const adminContext = (overrides: Record<string, unknown> = {}) => {
    const ownerKey = JSON.stringify(['fictional-admin-token', true]);
    return {
      allowed: true, token: 'fictional-admin-token', ownerKey, owner: { current: ownerKey }, pending: { current: false },
      beginRead: actualBeginAttempt(), beginWrite: actualBeginAttempt(),
      PlatformApiError: PlatformReadError, setData: jest.fn(), setError: jest.fn(), setMessage: jest.fn(), setBusy: jest.fn(),
      platformRequest: jest.fn(async () => ({ ok: true })), ...overrides,
    };
  };

  it('a previous account mutation does not block the current administrator read', async () => {
    const context = adminContext({ pending: { current: true } });
    await routeHandler('app/services/manage.tsx', 'refresh', context)();
    expect(context.platformRequest).toHaveBeenCalledWith('get_admin', {}, context.token);
    expect(context.setData).toHaveBeenCalledWith({ ok: true });
  });

  it.each([401, 403, 503])('administrator reads clear cached financial data only on access denial (%s)', async status => {
    const context = adminContext({ platformRequest: jest.fn(async () => { throw new PlatformReadError(status); }) });
    await routeHandler('app/services/manage.tsx', 'refresh', context)();
    expect(context.setError).toHaveBeenCalledWith('조회 실패');
    if (status === 503) expect(context.setData).not.toHaveBeenCalled();
    else expect(context.setData).toHaveBeenCalledWith(null);
  });

  it.each([403, 503])('administrator write denial clears old financial data while transport failure keeps it (%s)', async status => {
    const context = {
      ...adminContext({ platformRequest: jest.fn(async () => { throw new PlatformReadError(status); }) }),
      tracker: { current: { requestId: () => 'synthetic-request' } }, refresh: jest.fn(),
    };
    await routeHandler('app/services/manage.tsx', 'write', context)('save_partner', { name: '가상 제휴사' });
    expect(context.setError).toHaveBeenCalledWith('조회 실패');
    if (status === 503) expect(context.setData).not.toHaveBeenCalled();
    else expect(context.setData).toHaveBeenCalledWith(null);
    expect(context.refresh).not.toHaveBeenCalled();
    expect(context.pending.current).toBe(false);
  });

  it('an old administrator save cannot unlock a new save or overwrite its result', async () => {
    const result = deferred<unknown>();
    const context = {
      ...adminContext({ platformRequest: jest.fn(() => result.promise) }),
      tracker: { current: { requestId: () => 'synthetic-request', complete: jest.fn() } }, refresh: jest.fn(),
      setFields: jest.fn(), setPartnerId: jest.fn(), setEditing: jest.fn(), setRevision: jest.fn(), setActive: jest.fn(),
      setSettlement: jest.fn(), setConfirmed: jest.fn(), setPayment: jest.fn(), setPaymentConfirmed: jest.fn(), setBenefitId: jest.fn(),
      EMPTY_PARTNER: {}, EMPTY_SETTLEMENT: {}, randomUUID: () => 'synthetic-next-partner',
    };
    const first = routeHandler('app/services/manage.tsx', 'write', context)('save_partner', { name: '가상 제휴사' });
    context.owner.current = JSON.stringify(['fictional-next-admin-token', true]);
    context.beginWrite(); context.setBusy.mockClear(); context.setMessage.mockClear();
    result.resolve({ ok: true }); await first;
    expect(context.setMessage).not.toHaveBeenCalled();
    expect(context.setFields).not.toHaveBeenCalled();
    expect(context.refresh).not.toHaveBeenCalled();
    expect(context.setBusy).not.toHaveBeenCalled();
    expect(context.pending.current).toBe(true);
  });
});

it.each([
  ['fc', 'home', true, 'back'],
  ['fc', undefined, true, 'back'],
  ['fc', 'home', false, '/'],
  ['fc', 'auth', true, '/'],
  ['fc', 'login', true, '/'],
  [null, 'home', true, 'login'],
] as const)('basic information back preserves history and authentication routing (%s, %s, %s)', async (role, fromParam, canGoBack, expected) => {
  const router = { back: jest.fn(), replace: jest.fn(), canGoBack: () => canGoBack };
  const back = routeHandler('app/fc/new.tsx', 'handleBack', { role, fromParam, router, goBackOrReplace });
  await back();
  if (expected === 'back') {
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  } else {
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith(expected === 'login' ? { pathname: '/services/login', params: { service: 'insurance', skipAuto: '1' } } : '/');
  }
});

it.each(['signup', 'signup-verify', 'signup-password'])('legacy %s has one common signup boundary', route => {
  const source = readFileSync(join(process.cwd(), `app/${route}.tsx`), 'utf8');
  expect(source.trim()).toBe("export { default } from '@/components/LegacySignupRedirect';");
});

describe('unified common account to insurance registration callbacks', () => {
  const selectedReferral = { fcId: 'fictional-inviter', name: '시험 추천인', affiliation: '1본부', code: 'TEST0001' };
  const insuranceSession = { ok: true, role: 'fc', residentId: 'fictional-phone', appSessionToken: 'fictional-fc-session' };
  const makeContext = (overrides: Record<string, unknown> = {}) => ({
    token: 'fictional-common-session', tokenRef: { current: 'fictional-common-session' }, commonOnly: true,
    pending: { current: false }, installingToken: { current: null }, consentAccepted: true,
    affiliation: '1본부', email: 'test@example.invalid', carrier: 'KT', licenseStatuses: ['none'],
    searchQuery: '시험 추천인', selectedReferral, validating: false,
    buildStoredSignupReferral, getSignupReferralSelectionError, hasValidStoredSignupReferral,
    validateEmail, validateRequired, normalizeLicenseStatuses, INSURANCE_CONSENT_VERSION: 'insurance-additional-info-v1',
    tracker: { current: createCreationRequestTracker(() => 'fictional-operation') }, beginSubmit: actualBeginAttempt(),
    setSubmitting: jest.fn(), setSaveError: jest.fn(), Alert: { alert: jest.fn() },
    platformRequest: jest.fn(async () => ({ ok: true, insuranceSession, alreadyApplied: false })),
    acceptLoginResponse: jest.fn(async () => 'fc'), allowExit: jest.fn(),
    buildApplyGateIdentityRoute: (next: string) => ({ pathname: '/identity', params: { next } }),
    safeNext: '/?mode=insurance', router: { replace: jest.fn() }, ...overrides,
  });

  it.each([
    { consentAccepted: false }, { affiliation: '' }, { email: 'bad email' }, { carrier: '' }, { selectedReferral: null }, { validating: true },
  ])('rejects an incomplete consent/service/referral selection before mutation: %j', async (missing) => {
    const context = makeContext(missing);
    await routeHandler('app/apply-gate.tsx', 'submitEnrollment', context)();
    expect(context.platformRequest).not.toHaveBeenCalled();
    expect(context.Alert.alert).toHaveBeenCalledWith('입력 확인', expect.any(String));
  });

  it('uses explicit insurance fields and signed common session, never repeating account signup', async () => {
    const context = makeContext();
    await routeHandler('app/apply-gate.tsx', 'submitEnrollment', context)();
    expect(context.platformRequest).toHaveBeenCalledTimes(1);
    const [action, body, token] = context.platformRequest.mock.calls[0] as unknown as [string, Record<string, unknown>, string];
    expect(action).toBe('enroll_insurance'); expect(token).toBe(context.token);
    expect(body).toMatchObject({ confirmed: true, consentAccepted: true, consentVersion: 'insurance-additional-info-v1',
      referralCode: 'TEST0001', referralInviterFcId: 'fictional-inviter', email: 'test@example.invalid' });
    for (const forbidden of ['password', 'phone', 'memberId', 'fcId', 'name', 'referrerId']) expect(body).not.toHaveProperty(forbidden);
    expect(context.acceptLoginResponse).toHaveBeenCalledWith(insuranceSession, undefined, expect.any(Function));
    expect(context.router.replace).toHaveBeenCalledWith({ pathname: '/identity', params: { next: '/?mode=insurance' } });
  });

  it('blocks a synchronous second registration and keeps one operation for an unchanged lost-response retry', async () => {
    const pending = deferred<unknown>();
    let call = 0;
    const context = makeContext({ platformRequest: jest.fn(() => {
      call += 1; return call === 1 ? pending.promise : Promise.resolve({ ok: true, insuranceSession, alreadyApplied: true });
    }) });
    const submit = routeHandler('app/apply-gate.tsx', 'submitEnrollment', context);
    const first = submit(); await submit();
    expect(context.platformRequest).toHaveBeenCalledTimes(1);
    pending.resolve(Promise.reject(new Error('fictional timeout'))); await first;
    expect(context.router.replace).not.toHaveBeenCalled();
    await submit();
    const calls = context.platformRequest.mock.calls as unknown as [string, { idempotencyKey: string }][];
    expect(calls[0][1].idempotencyKey).toBe(calls[1][1].idempotencyKey);
    expect(context.router.replace).toHaveBeenCalledTimes(1);
  });

  it('does not install the completed registration into an account changed during the request', async () => {
    const pending = deferred<unknown>();
    const context = makeContext({ platformRequest: jest.fn(() => pending.promise) });
    const work = routeHandler('app/apply-gate.tsx', 'submitEnrollment', context)();
    context.tokenRef.current = 'fictional-other-account';
    pending.resolve({ ok: true, insuranceSession, alreadyApplied: false }); await work;
    expect(context.acceptLoginResponse).not.toHaveBeenCalled(); expect(context.router.replace).not.toHaveBeenCalled();
  });

  it('does not navigate when guarded session installation was superseded', async () => {
    const context = makeContext({ acceptLoginResponse: jest.fn(async () => null) });
    await routeHandler('app/apply-gate.tsx', 'submitEnrollment', context)();
    expect(context.router.replace).not.toHaveBeenCalled(); expect(context.allowExit).not.toHaveBeenCalled();
  });

  it('starts only the local service form after consent, without creating an FC on entry', () => {
    const context = { commonOnly: true, consentAccepted: false, setFormShown: jest.fn(), addSentryBreadcrumb: jest.fn(),
      buildHomeEntryBreadcrumb: jest.fn(), safeNext: '/?mode=insurance', router: { push: jest.fn() }, buildApplyGateIdentityRoute: jest.fn() };
    routeHandler<() => void>('app/apply-gate.tsx', 'startIdentityInput', context)();
    expect(context.setFormShown).not.toHaveBeenCalled();
    context.consentAccepted = true;
    routeHandler<() => void>('app/apply-gate.tsx', 'startIdentityInput', context)();
    expect(context.setFormShown).toHaveBeenCalledWith(true); expect(context.router.push).not.toHaveBeenCalled();
  });

  it('returns later to common home rather than the separate FC home-lite', () => {
    const context = { addSentryBreadcrumb: jest.fn(), buildHomeEntryBreadcrumb: jest.fn(), router: { replace: jest.fn() } };
    routeHandler<() => void>('app/apply-gate.tsx', 'returnHomeLite', context)();
    expect(context.router.replace).toHaveBeenCalledWith('/');
  });

  it('ignores stale insurance-referral validation after the member edits the selection', async () => {
    const pending = deferred<unknown>();
    const beginSelection = actualBeginAttempt();
    const context = { token: 'fictional-common', tokenRef: { current: 'fictional-common' }, beginSelection,
      setValidating: jest.fn(), setSelectedReferral: jest.fn(), setReferralError: jest.fn(), setSearchQuery: jest.fn(), setSearchResults: jest.fn(),
      platformRequest: jest.fn(() => pending.promise) };
    const work = routeHandler('app/apply-gate.tsx', 'validateReferral', context)('TEST0001');
    beginSelection();
    pending.resolve({ ok: true, inviterFcId: 'fictional-inviter', inviterName: '늦은 결과', inviterAffiliation: '', referralCode: 'TEST0001' }); await work;
    expect(context.setSelectedReferral).toHaveBeenCalledTimes(1); expect(context.setSelectedReferral).toHaveBeenCalledWith(null);
    expect(context.setSearchQuery).not.toHaveBeenCalled();
  });
});

describe('identity save current account and duplicate boundary', () => {
  it('ignores a late identity receipt after account change and blocks a synchronous duplicate', async () => {
    const pendingWrite = deferred<unknown>();
    const context = { pending: { current: false }, role: 'fc', residentId: 'fictional-phone', appSessionToken: 'fictional-session',
      sessionRef: { current: { residentId: 'fictional-phone', appSessionToken: 'fictional-session' } }, beginSubmit: actualBeginAttempt(),
      setSubmitting: jest.fn(), setError: jest.fn(), validateResidentId: () => ({ isValid: true }),
      invokeStoreIdentity: jest.fn(() => pendingWrite.promise), requireStoreIdentityReceipt: jest.fn(),
      queryClient: { invalidateQueries: jest.fn(), refetchQueries: jest.fn() }, Alert: { alert: jest.fn() }, router: { replace: jest.fn() } };
    const submit = routeHandler('app/identity.tsx', 'onSubmit', context);
    const values = { residentFront: '000000', residentBack: '0000000', address: '합성 주소', addressDetail: '합성 상세' };
    const first = submit(values); await submit(values);
    expect(context.invokeStoreIdentity).toHaveBeenCalledTimes(1);
    context.sessionRef.current.appSessionToken = 'fictional-other-session';
    pendingWrite.resolve({ data: { ok: true }, error: null }); await first;
    expect(context.requireStoreIdentityReceipt).not.toHaveBeenCalled();
    expect(context.queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(context.router.replace).not.toHaveBeenCalled(); expect(context.Alert.alert).not.toHaveBeenCalled();
  });
});

describe('request chat room back navigation', () => {
  it.each([
    ['req-2001', true, false], ['dm-2001', true, false], ['dm-2001', false, false], ['dm-2001', true, true],
  ] as const)('returns %s to the messenger hub (history=%s, sending=%s)', (roomId, hasHistory, sending) => {
    const stack = hasHistory ? ['/', '/messenger', '/request-board-messenger'] : ['/request-board-messenger'];
    const context = {
      sending: false, sendingRef: { current: sending }, activeConv: { id: roomId }, goBackOrReplace,
      router: {
        back: jest.fn(() => { stack.pop(); }),
        replace: jest.fn((href: string) => { stack[stack.length - 1] = href; }),
        canGoBack: () => stack.length > 1, setParams: jest.fn(),
      }, Alert: { alert: jest.fn() }, setActiveConv: jest.fn(),
    };
    const handleBack = routeHandler<() => void>('app/request-board-messenger.tsx', 'handleBack', context);
    const hardware = routeHandler<() => boolean>('app/request-board-messenger.tsx', 'onHardwareBack', { ...context, handleBack });

    expect(hardware()).toBe(true);
    expect(context.setActiveConv).not.toHaveBeenCalled();
    expect(context.router.setParams).not.toHaveBeenCalled();
    if (sending) {
      expect(context.Alert.alert).toHaveBeenCalledWith('전송 중', expect.any(String));
      expect(stack.at(-1)).toBe('/request-board-messenger');
      expect(context.router.back).not.toHaveBeenCalled();
      expect(context.router.replace).not.toHaveBeenCalled();
    } else {
      expect(stack.at(-1)).toBe('/messenger');
      expect(context.router.back).toHaveBeenCalledTimes(hasHistory ? 1 : 0);
      expect(context.router.replace).toHaveBeenCalledTimes(hasHistory ? 0 : 1);
    }
  });

  it('lets the next hardware back leave the conversation list', () => {
    const router = { back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
    const handleBack = routeHandler<() => void>('app/request-board-messenger.tsx', 'handleBack', {
      activeConv: null, sending: false, sendingRef: { current: false }, router, goBackOrReplace,
    });
    const hardware = routeHandler<() => boolean>('app/request-board-messenger.tsx', 'onHardwareBack', {
      activeConv: null, sending: false, sendingRef: { current: false }, handleBack,
    });
    expect(hardware()).toBe(false);
    expect(router.back).not.toHaveBeenCalled();
    handleBack();
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
