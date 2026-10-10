import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { createReadScope } from '../request-board-read-state';
import { getDesignerRequestDetailActions } from '../request-board-review-actions';
import { getMessengerHubCapabilities } from '../messenger-role-capabilities';
import { goBackOrReplace } from '../back-navigation';
import { INSURANCE_HOME_ROUTE } from '../service-home';

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
    invokeFcNotify: jest.fn(async () => ({ data: { ok: true, notifications: [] }, error: null })),
    fetchMobileUnreadNotificationCountOrThrow: jest.fn(async () => 0), ensureRequestBoardSession: jest.fn(async () => ({ ok: true })),
    rbGetRequestList: jest.fn(async () => []), computeRequestBoardHomeStats: () => ({ total: 0 }),
    setRequestBoardAccessError: jest.fn(), setNotifications: jest.fn(), setUnreadNotifCount: jest.fn(), setUnreadNotifVerified: jest.fn(),
    setDesignerRequests: jest.fn(), setReqStats: jest.fn(), setLoading: jest.fn(), setRefreshing: jest.fn(),
    logger: { warn: jest.fn() }, toRequestBoardSessionErrorMessage: () => 'synthetic error', ...overrides,
  };
}

describe('C03 / C04 / D06 / D08 request-board home reads', () => {
  it.each([undefined, null, {}])('retains the previous inbox and exposes malformed notifications %p', async (notifications) => {
    const context = homeReadContext({ invokeFcNotify: async () => ({ data: { ok: true, notifications }, error: null }) });
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
    const context = homeReadContext({ accountScope: { current: scope }, sessionReadKey: 'A', beginHomeRead: actualBeginAttempt(), rbGetRequestList: () => pending.promise });
    const first = routeHandler('app/request-board.tsx', 'fetchData', context)({ force: true });
    await Promise.resolve(); await Promise.resolve();
    scope.setScope('B'); scope.setScope('A');
    for (const callback of [context.setDesignerRequests, context.setReqStats, context.setLoading, context.setRefreshing, context.setRequestBoardAccessError]) callback.mockClear();
    pending.resolve([]); await first;
    for (const callback of [context.setDesignerRequests, context.setReqStats, context.setLoading, context.setRefreshing, context.setRequestBoardAccessError]) expect(callback).not.toHaveBeenCalled();
  });

  it('does not replace a later account with any old home read result', async () => {
    let current = true;
    const inbox = deferred<{ data: { ok: boolean; notifications: [] }; error: null }>();
    const count = deferred<number>();
    const requests = deferred<[]>();
    const context = homeReadContext({ accountScope: { current: controlledScope(() => current) }, invokeFcNotify: () => inbox.promise, fetchMobileUnreadNotificationCountOrThrow: () => count.promise, rbGetRequestList: () => requests.promise });
    const first = routeHandler('app/request-board.tsx', 'fetchData', context)({ force: true });
    await Promise.resolve();
    current = false;
    context.setRequestBoardAccessError.mockClear();
    context.requestBoardRefreshInFlightRef.current = null;
    inbox.resolve({ data: { ok: true, notifications: [] }, error: null }); count.resolve(0); requests.resolve([]);
    await first;
    for (const callback of [context.setNotifications, context.setUnreadNotifCount, context.setUnreadNotifVerified, context.setDesignerRequests, context.setReqStats, context.setLoading, context.setRefreshing, context.setRequestBoardAccessError]) {
      expect(callback).not.toHaveBeenCalled();
    }
  });

  it('preserves successful counts and requests when their refresh fails', async () => {
    const context = homeReadContext({
      rbGetRequestList: jest.fn(async () => { throw new Error('synthetic 503'); }),
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
    const context = homeReadContext({ rbGetRequestList: jest.fn(() => pending.promise) });
    const read = routeHandler('app/request-board.tsx', 'fetchData', context);
    const first = read({ force: true }); const second = read({ force: true });
    await Promise.resolve(); expect(context.rbGetRequestList).toHaveBeenCalledTimes(1);
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
      .map(([resident_id, status, is_confirmed]) => ({ resident_id, status, is_confirmed, exam_rounds: { exam_type: 'life' } }));
    const read = routeHandler('app/index.tsx', 'fetchExamStats', { supabase: { from(table: string) {
      return table === 'exam_registrations' ? { select() { return this; }, order(field: string) { return field === 'created_at' ? Promise.resolve({ data: rows, error: null }) : this; } }
        : { select() { return this; }, in: async () => ({ data: ['a', 'b', 'c', 'd', 'e'].map(phone => ({ phone })), error: null }) };
    } } });
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
    const query = { from() { return this; }, select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 'synthetic-profile' }, error: null }), then: (resolve: (value: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve) };
    await routeHandler('app/docs-upload.tsx', 'loadData', {
      beginRead: () => () => true, hasInvalidUserRoute: false, isAdmin: true, routeUserId: 'synthetic-profile', residentId: '00000000001', supabase: query,
      setProfileLoadState: jest.fn(), setFc: jest.fn(), setDocs: jest.fn(), setCleanupStatusError: jest.fn(), setCleanupPending, invokeAdminAction,
    })();
    expect(setCleanupPending).toHaveBeenCalledWith(true); expect(invokeAdminAction).toHaveBeenCalledWith('00000000001', 'getDocumentCleanupStatus', { fcId: 'synthetic-profile' });
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
  function scenario(dirty: boolean, busy: boolean, os = 'android') {
    let callback!: (event: { data: { action: string } }) => void;
    let buttons: { style: string; onPress?: () => void }[] | undefined;
    let hardware!: () => boolean; let beforeUnload!: (event: { preventDefault: () => void; returnValue: string | null }) => void;
    const dispatch: string[] = []; const effects: (() => unknown)[] = [];
    const navigation = { dispatch: (action: string) => dispatch.push(action), canGoBack: () => true, goBack: () => callback({ data: { action: 'back' } }) };
    const allow = mobileModule('hooks/use-draft-exit-guard.ts', {
      '@react-navigation/native': { useNavigation: () => navigation, usePreventRemove: (_enabled: boolean, fn: typeof callback) => { callback = fn; } },
      react: { useRef: (value: unknown) => ({ current: value }), useEffect: (fn: () => unknown) => effects.push(fn) },
      'react-native': { Alert: { alert: (_title: string, _text: string, next: typeof buttons) => { buttons = next; } }, BackHandler: { addEventListener: (_event: string, fn: typeof hardware) => { hardware = fn; return { remove() {} }; } }, Platform: { OS: os } },
    }, { window: { addEventListener: (_event: string, fn: typeof beforeUnload) => { beforeUnload = fn; }, removeEventListener() {} } }).useDraftExitGuard(dirty, busy);
    effects.forEach(effect => effect());
    return { dispatch, allow, exit: () => callback({ data: { action: 'leave' } }), get buttons() { return buttons; }, hardware, event: () => beforeUnload };
  }
  const dirty = scenario(true, false); dirty.exit(); expect(dirty.dispatch).toEqual([]); expect(dirty.buttons![0].style).toBe('cancel'); dirty.buttons![1].onPress!(); expect(dirty.dispatch).toEqual(['leave']);
  const busy = scenario(false, true); busy.hardware(); expect(busy.dispatch).toEqual([]); expect(busy.buttons).toBeUndefined();
  const saved = scenario(true, true); saved.allow(); saved.exit(); expect(saved.dispatch).toEqual(['leave']);
  const preventDefault = jest.fn(); scenario(true, false, 'web').event()({ preventDefault, returnValue: null }); expect(preventDefault).toHaveBeenCalledTimes(1);
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
    expect(router.replace).toHaveBeenCalledWith(expected === 'login' ? { pathname: '/login', params: { skipAuto: '1' } } : '/');
  }
});

it.each([true, false])('verification back restores the existing signup form when history exists (%s)', async (canGoBack) => {
  const router = { back: jest.fn(), replace: jest.fn(), canGoBack: () => canGoBack };
  const back = routeHandler('app/signup-verify.tsx', 'handleBack', { router, goBackOrReplace });
  await back();
  if (canGoBack) {
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  } else {
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/signup');
  }
});
