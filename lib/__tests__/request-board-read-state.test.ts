import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { createReadScope } from '../request-board-read-state';

// Execute the actual screen callback with synthetic services/state setters.
function screenCallback(path: string, name: string, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      callback = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!callback) throw new Error(`Missing callback ${name}`);
  const context = createContext({ ...bindings, exports: {} });
  runInContext(ts.transpileModule(`exports.run = ${callback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, context);
  return context.exports.run as (...args: any[]) => Promise<void>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function messenger() {
  const state = { messages: [{ id: 1 }], error: '', loading: false };
  const scope = createReadScope();
  scope.setScope('account-a:room-a');
  const active = { current: 'room-a' };
  const fetchMessages = jest.fn();
  const latest = { current: state.messages };
  const run = screenCallback('app/request-board-messenger.tsx', 'loadMessages', {
    sessionReadKey: 'account-a', rbUser: { id: 1 }, activeConversationRef: active, messageReadScope: { current: scope },
    setMsgLoading: (value: boolean) => { state.loading = value; },
    setMsgError: (value: string) => { state.error = value; },
    setMessages: (value: typeof state.messages) => { state.messages = value; },
    setLoadedConversationId: jest.fn(), rbGetMessagesOrThrow: fetchMessages, rbGetDmMessagesOrThrow: fetchMessages,
    mergeMessagesDesc: (rows: unknown[]) => rows, mapRawMessageToUnified: (row: unknown) => row,
    latestMessagesRef: latest, hasAnchorMessageParam: false, logger: { warn: jest.fn() },
    toRequestBoardSessionErrorMessage: (_error: unknown, fallback: string) => fallback,
  });
  return { state, scope, active, fetchMessages, run };
}

const room = { id: 'room-a', type: 'request', conversationIds: [1] };

test('failed background message read retains the last successful snapshot and exposes an error', async () => {
  const env = messenger();
  env.fetchMessages.mockRejectedValue(new Error('offline'));
  await env.run(room);
  expect(env.state.messages).toEqual([{ id: 1 }]);
  expect(env.state.error).toContain('다시 시도');
  expect(env.state.loading).toBe(false);
});

test('successful empty message read is allowed to replace old data', async () => {
  const env = messenger();
  env.state.error = 'previous failure';
  env.fetchMessages.mockResolvedValue([]);
  await env.run(room);
  expect(env.state.messages).toEqual([]);
  expect(env.state.error).toBe('');
});

test.each(['account-b:room-a', 'account-a:room-b'])('late read cannot write after scope changes to %s', async (nextScope) => {
  const env = messenger();
  const pending = deferred<unknown[]>();
  env.fetchMessages.mockReturnValue(pending.promise);
  const run = env.run(room);
  env.scope.setScope(nextScope);
  env.state.messages = [];
  pending.resolve([{ id: 99 }]);
  await run;
  expect(env.state.messages).toEqual([]);
});

test('an older failure cannot overwrite a newer successful message read', async () => {
  const env = messenger();
  const pending = deferred<unknown[]>();
  env.fetchMessages.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([{ id: 2 }]);
  const old = env.run(room);
  await env.run(room);
  pending.reject(new Error('old offline'));
  await old;
  expect(env.state.messages).toEqual([{ id: 2 }]);
  expect(env.state.error).toBe('');
});

test('unmounted scope invalidates pending completions', () => {
  const scope = createReadScope();
  const current = scope.issue();
  scope.invalidate();
  expect(current()).toBe(false);
});

test.each(['customers', 'products', 'designers', 'codes'])('request creation does not mark initial data complete when %s fails', async (failedResource) => {
  const scope = createReadScope();
  const complete = { current: false };
  const state = { error: '', loading: true, catalogLoading: true };
  const result = (resource: string) => () => resource === failedResource ? Promise.reject(new Error('synthetic failure')) : Promise.resolve([]);
  const run = screenCallback('app/request-board-create.tsx', 'loadData', {
    sessionReadKey: '', hydrated: true, canUseCreateFlow: true, dataReadScope: { current: scope }, hasLoadedInitialRequestDataRef: complete,
    setLoading: (value: boolean) => { state.loading = value; }, setCatalogLoading: (value: boolean) => { state.catalogLoading = value; },
    setDataError: (value: string) => { state.error = value; }, ensureRequestBoardSession: async () => ({ ok: true }),
    rbGetCustomersOrThrow: result('customers'), rbGetProductsOrThrow: result('products'), rbGetDesignersOrThrow: result('designers'), rbGetFcCodesOrThrow: result('codes'),
    setCustomers: jest.fn(), setProducts: jest.fn(), setDesigners: jest.fn(), setFcCodes: jest.fn(),
    mapRequestBoardProductsToMobileCatalog: () => ({ products: [] }), logger: { warn: jest.fn() },
    toRequestBoardSessionErrorMessage: (_error: unknown, fallback: string) => fallback,
  });
  await run();
  expect(complete.current).toBe(false);
  expect(state.error).toContain('불러오지 못했습니다');
  expect(state.loading).toBe(false);
  expect(state.catalogLoading).toBe(false);
});

test('a partial conversation failure retains its last good rows and exposes a persistent warning', async () => {
  const retained = { id: 'req-1', type: 'request', participantUserId: 1 };
  const state: { conversations: unknown[]; error: string; directory: unknown[] } = { conversations: [], error: '', directory: [] };
  const run = screenCallback('app/request-board-messenger.tsx', 'loadConversations', {
    sessionReadKey: '', authState: 'ready', rbUser: { id: 1, role: 'fc' }, conversationReadScope: { current: createReadScope() },
    conversationsRef: { current: [retained] },
    rbGetConversationsOrThrow: async () => { throw new Error('synthetic failure'); },
    rbGetDmConversationsOrThrow: async () => [], rbGetDesignersOrThrow: async () => [],
    setConvError: (value: string) => { state.error = value; },
    setConversations: (value: unknown[]) => { state.conversations = value; },
    setDirectoryUsers: (value: unknown[]) => { state.directory = value; },
    setActiveConv: jest.fn(), setConvLoading: jest.fn(), setConvRefreshing: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn() }, isRequestBoardSessionReauthError: () => false,
    sortConversationsByLastMessageTime: (value: unknown[]) => value,
  });
  await run();
  expect(state.conversations).toEqual([retained]);
  expect(state.error).toContain('일부');
  expect(state.directory).toEqual([]);
});

test.each(['failure', 'empty'])('FC code read distinguishes %s and supports a successful retry', async (mode) => {
  const state: { error: string | null; loaded: boolean; codes: unknown[] } = { error: null, loaded: false, codes: [] };
  const codes = jest.fn().mockImplementationOnce(async () => {
    if (mode === 'failure') throw new Error('offline');
    return [];
  }).mockResolvedValue([]);
  const run = screenCallback('app/request-board-fc-codes.tsx', 'fetchData', {
    sessionReadKey: '', canManageCodes: true, readScope: { current: createReadScope() }, ensureRequestBoardSession: async () => ({ ok: true }),
    rbGetFcCodesOrThrow: codes, rbGetCompanyNamesOrThrow: async () => [],
    setFetchError: (value: string | null) => { state.error = value; },
    setHasLoadedData: (value: boolean) => { state.loaded = value; },
    setCodes: (value: unknown[]) => { state.codes = value; },
    setCompanyNames: jest.fn(), setLoading: jest.fn(), setRefreshing: jest.fn(),
    logger: { warn: jest.fn() }, toRequestBoardSessionErrorMessage: (_error: unknown, fallback: string) => fallback,
  });
  await run();
  expect(state.loaded).toBe(mode === 'empty');
  expect(Boolean(state.error)).toBe(mode === 'failure');
  await run();
  expect(state).toEqual({ loaded: true, error: null, codes: [] });
});

test('group-chat silent background failure preserves messages and persists an error until a successful retry', async () => {
  const state = { messages: [{ id: 'message-1' }], error: null as unknown, failed: false };
  const bootstrap = jest.fn().mockRejectedValueOnce(new Error('synthetic failure')).mockResolvedValueOnce({
    room: { id: 'room-1' }, actor: {}, member_count: 0, members: [], muted: false, messages: [],
  });
  const alert = jest.fn();
  const run = screenCallback('app/group-chat.tsx', 'load', {
    roomReadKey: '', roomReadScope: { current: createReadScope() }, MESSAGE_LIMIT: 50, groupChatBootstrap: bootstrap,
    setRoom: jest.fn(), setActor: jest.fn(), setMemberCount: jest.fn(), setMembers: jest.fn(), setMuted: jest.fn(),
    setCanSendMessages: jest.fn(), resolveGroupChatSendPermission: () => false, setNotice: jest.fn(),
    messagesRef: { current: [] }, routeAnchorMessageId: null,
    setRoomLoadFailed: (value: boolean) => { state.failed = value; },
    setRoomLoadError: (value: unknown) => { state.error = value; },
    applyMessages: (value: typeof state.messages) => { state.messages = value; },
    setLoading: jest.fn(), setRefreshing: jest.fn(), logger: { warn: jest.fn() },
    classifyGroupChatError: () => ({ message: '조회 실패' }), showGroupChatErrorAlert: alert,
  });
  await run({ silent: true });
  expect(state.messages).toEqual([{ id: 'message-1' }]);
  expect(state.error).toEqual({ message: '조회 실패' });
  expect(state.failed).toBe(true);
  expect(alert).not.toHaveBeenCalled();
  await run();
  expect(state).toEqual({ messages: [], error: null, failed: false });
});

test.each([false, true])('committed attachment-only retry stays visible after a catalog failure (retry loading=%s)', (loading) => {
  const path = 'app/request-board-create.tsx';
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let content: ts.ConditionalExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isConditionalExpression(node) && node.condition.getText(source) === "loading && step !== 'sent'") content = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(content).toBeDefined();
  const retryAttachmentDelivery = jest.fn();
  type Element = { type: string; props?: { onPress?: unknown; disabled?: boolean }; children: unknown[] };
  const bindings = {
    React: { createElement: (type: string, props: Element['props'], ...children: unknown[]): Element => ({ type, props, children }) },
    View: 'View', Text: 'Text', Feather: 'Feather', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
    KeyboardAvoidingView: 'KeyboardAvoidingView', ScrollView: 'ScrollView', MotiView: 'MotiView',
    styles: {}, COLORS: { warning: { dark: 'orange' } }, Platform: { OS: 'ios' }, insets: { bottom: 0 }, screenKeyboardHeight: 0,
    step: 'sent', loading, dataError: 'catalog failure', submitting: false,
    pendingAttachmentDelivery: { remainingRequestIds: [1] }, requestNotificationFeedback: null, failedRequestJobCount: 0,
    selectedCustomer: { name: 'Synthetic Customer' }, products: [], selectedProductIds: [], selectedDesigners: [],
    getProductSummary: () => '', getDesignerNameWithHeadquarters: () => '', sentRequestIds: [1],
    retryAttachmentDelivery, router: { replace: jest.fn() },
  };
  const renderSentStep = screenCallback(path, 'renderSentStep', bindings);
  const context = createContext({ ...bindings, renderSentStep, exports: {} });
  runInContext(ts.transpileModule(`exports.result = ${content!.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, context);
  const findRetry = (value: unknown): Element | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const element = value as Element;
    if (element.props?.onPress === retryAttachmentDelivery) return element;
    return element.children?.flat(Infinity).map(findRetry).find(Boolean);
  };
  expect(findRetry(context.exports.result)?.props?.disabled).toBe(false);
});
