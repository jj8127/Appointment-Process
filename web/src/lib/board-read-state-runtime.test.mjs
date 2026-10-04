import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as editDetail from './board-edit-detail.ts';
import * as queryError from './query-read-error.ts';
import * as commentRequest from './board-comment-request.ts';

const rootRequire = createRequire(new URL('../../../package.json', import.meta.url));
const webRequire = createRequire(import.meta.url);
const React = rootRequire('react');
const { act, create } = rootRequire('react-test-renderer');
const ts = rootRequire('typescript');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const componentCache = new Map();
function component(name) {
  if (!componentCache.has(name)) {
    const fn = ({ children, ...props }) => React.createElement(name, props,
      typeof children === 'function' ? children({}) : children);
    componentCache.set(name, new Proxy(fn, { get: (target, key) => (
      typeof key === 'string' && /^[A-Z]/.test(key) ? component(`${name}.${key}`) : Reflect.get(target, key)
    ) }));
  }
  return componentCache.get(name);
}
const ui = new Proxy({}, { get: (_, key) => component(String(key)) });
const initialQuery = { data: undefined, isSuccess: false, isError: false, isLoading: true, isFetching: true, error: null, refetch() {} };
const success = (data) => ({ ...initialQuery, data, isSuccess: true, isLoading: false, isFetching: false });
const failure = (error = new Error('synthetic_read_failure'), data) => ({ ...initialQuery, data, error, isError: true, isLoading: false, isFetching: false });
const fullBody = '가상 게시글 원문입니다. '.repeat(25);
const post = (id) => ({
  id, categoryId: 'general', title: `가상 제목 ${id}`, contentPreview: `${fullBody.slice(0, 140)}...`,
  authorName: '가상 작성자', authorRole: 'admin', createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z', isPinned: false, isMine: true,
  stats: { commentCount: 0, reactionCount: 0, attachmentCount: 0, viewCount: 0 },
});
const detail = (id, content = fullBody) => ({
  post: { ...post(id), content }, attachments: [], comments: [], reactions: { like: 0, heart: 0, check: 0, smile: 0 },
});

function loadTsx(path, mocks, globals = {}) {
  const file = new URL(path, import.meta.url);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, require: (id) => {
      if (id in mocks) return mocks[id];
      if (id === '@/lib/board-comment-request') return commentRequest;
      if (id === 'react' || id === 'react/jsx-runtime') return rootRequire(id);
      if (id === '@mantine/core' || id === '@tabler/icons-react') return ui;
      throw new Error(`Unmocked dependency: ${id}`);
    }, URL, URLSearchParams, console, process: { env: {} }, ...globals,
  }, { filename: file.pathname });
  return exports;
}

function makeBoard() {
  let session = { role: 'admin', residentId: 'synthetic-actor', displayName: '가상 작성자' };
  const queries = new Map();
  const queryOptions = new Map();
  const mutations = [];
  const submissions = [];
  const reactionRequests = [];
  const commentLikeRequests = [];
  const notices = [];
  const invalidations = [];
  const queryKey = (key) => JSON.stringify(key[0] === 'board-detail' && key.length <= 3
    ? [...key, session.role, session.residentId] : key);
  queries.set(queryKey(['board-categories', 'admin', 'synthetic-actor']), success([{ id: 'general', name: '일반' }]));
  queries.set(queryKey(['board-posts', 'admin', 'synthetic-actor']), success({ items: [post('A'), post('B')] }));
  let cancelBarrier;
  const queryClient = {
    invalidateQueries: (key) => invalidations.push(key),
    cancelQueries: async () => { if (cancelBarrier) await cancelBarrier; },
    getQueryData: (key) => queries.get(queryKey(key))?.data,
    setQueryData(key, next) {
      const previous = queries.get(queryKey(key));
      const data = typeof next === 'function' ? next(previous?.data) : next;
      queries.set(queryKey(key), { ...success(data), ...previous, data });
    },
  };
  const mocks = {
    '@/hooks/use-session': { useSession: () => session },
    '@/components/NotificationDestinationReady': ui,
    '@/components/QueryErrorAlert': ui,
    '@/lib/board-edit-detail': editDetail,
    '@/lib/board-attachment-delivery': { deliverBoardAttachments: async () => ({ complete: true, manifest: null }) },
    '@/lib/staff-identity': new Proxy({}, { get: () => () => 'admin' }),
    '@/lib/board-api': {
      buildBoardActor: (actor) => actor,
      fetchBoardDetail: async (_, id) => detail(id),
      updateBoardPost: async (_, payload) => { submissions.push(payload); return {}; },
      toggleBoardReaction: async (actor, postId, reactionType) => { reactionRequests.push({ actor, postId, reactionType }); return { myReaction: reactionType }; },
      toggleCommentLike: async (actor, commentId) => { commentLikeRequests.push({ actor, commentId }); return { liked: true, likeCount: 1 }; },
      getBoardNotificationWarningMessage: () => null,
    },
    '@mantine/hooks': { useDisclosure(initial) {
      const [opened, setOpened] = React.useState(initial);
      return [opened, { open: () => setOpened(true), close: () => setOpened(false) }];
    } },
    '@mantine/notifications': { notifications: { show: (notice) => notices.push(notice) } },
    '@tanstack/react-query': {
      useQuery(options) { queryOptions.set(queryKey(options.queryKey), options); return queries.get(queryKey(options.queryKey)) ?? initialQuery; },
      useQueryClient: () => queryClient,
      useMutation(options) {
        const slot = React.useRef(null);
        if (!slot.current) { slot.current = {}; mutations.push(slot.current); }
        slot.current.options = options;
        return { isPending: false, mutate: (...args) => { slot.current.calls = [...(slot.current.calls ?? []), args]; } };
      },
    },
    'framer-motion': { AnimatePresence: component('AnimatePresence'), motion: { div: component('MotionDiv') } },
    'next/navigation': { useRouter: () => ({ replace() {} }), useSearchParams: () => new URLSearchParams() },
  };
  const Page = loadTsx('../app/dashboard/board/page.tsx', mocks).default;
  let renderer;
  const render = async () => act(async () => {
    if (renderer) renderer.update(React.createElement(Page));
    else renderer = create(React.createElement(Page));
  });
  const find = (type, predicate = () => true) => renderer.root.findAllByType(type).find(predicate);
  return {
    render, find, submissions, mutations, notices, invalidations, reactionRequests, commentLikeRequests,
    cached: (key) => queries.get(queryKey(key))?.data,
    pauseCancellation() {
      let release;
      cancelBarrier = new Promise((resolve) => { release = resolve; });
      return () => { cancelBarrier = undefined; release(); };
    },
    async edit(index = 0) { await act(async () => renderer.root.findAllByType('Menu.Item').filter((node) => node.props.children === '수정')[index].props.onClick({ stopPropagation() {} })); },
    async setQuery(key, value) { queries.set(queryKey(key), value); await render(); },
    queryOptions: (key) => queryOptions.get(queryKey(key)),
    async view(index = 0) { await act(async () => renderer.root.findAllByType('Card').filter((node) => typeof node.props.onClick === 'function')[index].props.onClick()); },
    async changeActor() {
      session = { ...session, residentId: 'other-synthetic-actor' };
      queries.set(queryKey(['board-categories', session.role, session.residentId]), success([{ id: 'general', name: '일반' }]));
      queries.set(queryKey(['board-posts', session.role, session.residentId]), success({ items: [post('A'), post('B')] }));
      await render();
    },
    async close() { await act(async () => renderer.unmount()); },
  };
}

test('board title-only edit cannot submit while detail is loading or failed; retry loads the full body', async () => {
  const page = makeBoard();
  await page.render();
  await page.edit();
  assert.equal(page.find('Textarea', (n) => n.props.label === '내용').props.value, '');
  assert.equal(page.find('TextInput', (n) => n.props.label === '제목').props.disabled, true);
  let save = page.find('Button', (n) => n.props.children === '수정 완료');
  assert.equal(save.props.disabled, true);
  save.props.onClick();
  assert.equal(page.mutations[1].calls, undefined);
  await assert.rejects(page.mutations[1].options.mutationFn(), /원문/);

  let retries = 0;
  await page.setQuery(['board-detail', 'A', 'edit'], { ...failure(), refetch() { retries += 1; } });
  page.find('QueryErrorAlert', (n) => n.props.subject === '게시글 원문').props.onRetry();
  assert.equal(retries, 1);
  await assert.rejects(page.mutations[1].options.mutationFn(), /원문/);
  assert.equal(page.submissions.length, 0);

  await page.setQuery(['board-detail', 'A', 'edit'], success(detail('A')));
  await act(async () => page.find('TextInput', (n) => n.props.label === '제목').props.onChange({ currentTarget: { value: '제목만 변경' } }));
  save = page.find('Button', (n) => n.props.children === '수정 완료');
  assert.equal(save.props.disabled, false);
  save.props.onClick();
  assert.equal(page.mutations[1].calls.length, 1);
  await page.mutations[1].options.mutationFn();
  assert.equal(page.submissions[0].postId, 'A');
  assert.equal(page.submissions[0].title, '제목만 변경');
  assert.equal(page.submissions[0].content, fullBody.trim());
  assert.ok(page.submissions[0].content.length > 140);
  await page.close();
});

test('board rejects a wrong-post response, ignores a delayed old post, and preserves drafts across refetches', async () => {
  const page = makeBoard();
  await page.render(); await page.edit();
  await page.setQuery(['board-detail', 'A', 'edit'], success(detail('B')));
  assert.equal(page.find('Button', (n) => n.props.children === '수정 완료').props.disabled, true);
  await page.edit(1);
  await page.setQuery(['board-detail', 'A', 'edit'], success(detail('A')));
  assert.equal(page.find('Textarea', (n) => n.props.label === '내용').props.value, '');
  await page.setQuery(['board-detail', 'B', 'edit'], success(detail('B')));
  await act(async () => page.find('Textarea', (n) => n.props.label === '내용').props.onChange({ currentTarget: { value: '보존할 사용자 초안' } }));
  await page.setQuery(['board-detail', 'B', 'edit'], success(detail('B', '백그라운드 서버 응답')));
  assert.equal(page.find('Textarea', (n) => n.props.label === '내용').props.value, '보존할 사용자 초안');
  await page.setQuery(['board-detail', 'B', 'edit'], failure(new Error('refresh_failed'), detail('B')));
  assert.equal(page.find('Textarea', (n) => n.props.label === '내용').props.value, '보존할 사용자 초안');
  const result = await page.mutations[1].options.mutationFn();
  assert.equal(result.id, 'B');
  assert.equal(page.submissions[0].postId, 'B');
  assert.equal(page.submissions[0].content, '보존할 사용자 초안');
  await page.close();
});

test('cached detail from a failed or in-flight refresh is not accepted for a new edit', async () => {
  const page = makeBoard();
  await page.setQuery(['board-detail', 'A', 'edit'], { ...success(detail('A')), isFetching: true });
  await page.edit();
  assert.equal(page.find('Button', (n) => n.props.children === '수정 완료').props.disabled, true);
  await page.setQuery(['board-detail', 'A', 'edit'], failure(new Error('refresh_failed'), detail('A')));
  await assert.rejects(page.mutations[1].options.mutationFn(), /원문/);
  await page.close();
});

test('committed board attachment retry remains enabled after category reads fail', async () => {
  const page = makeBoard();
  await page.render(); await page.edit();
  await page.setQuery(['board-detail', 'A', 'edit'], success(detail('A')));
  await act(async () => page.mutations[1].options.onSuccess({
    id: 'A', attachmentIncomplete: true, attachmentManifest: null, notificationRetry: null, notificationWarning: null,
  }));
  await page.setQuery(['board-categories', 'admin', 'synthetic-actor'], failure());
  const retryButton = page.find('Button', (node) => node.props.children === '첨부 다시 시도');
  assert.equal(retryButton.props.disabled, false);
  retryButton.props.onClick();
  const retry = page.mutations.find((mutation) => mutation.options.mutationFn.toString().includes('attachment_retry_not_available'));
  assert.equal(retry.calls.length, 1);
  assert.equal(page.submissions.length, 0);
  await page.close();
});

test('an in-place account switch clears the composer and cannot reuse another actor’s cached detail', async () => {
  const page = makeBoard();
  await page.render(); await page.edit();
  await page.setQuery(['board-detail', 'A', 'edit'], success(detail('A')));
  await act(async () => page.find('TextInput', (node) => node.props.label === '제목').props.onChange({ currentTarget: { value: '이전 계정의 초안' } }));
  await page.changeActor();
  assert.equal(page.find('TextInput', (node) => node.props.label === '제목').props.value, '');
  assert.equal(page.find('Modal').props.opened, false);
  await page.edit();
  assert.equal(page.find('Button', (node) => node.props.children === '수정 완료').props.disabled, true);
  assert.equal(page.find('Textarea', (node) => node.props.label === '내용').props.value, '');
  await page.setQuery(['board-detail', 'A', 'edit'], success(detail('A', '새 계정에서 조회한 원문')));
  assert.equal(page.find('Textarea', (node) => node.props.label === '내용').props.value, '새 계정에서 조회한 원문');
  await page.close();
});

for (const changeAccount of [false, true]) {
  test(`late comment success preserves an identical draft on another ${changeAccount ? 'account' : 'post'}`, async () => {
    const page = makeBoard();
    await page.setQuery(['board-detail', 'A'], success(detail('A')));
    await page.setQuery(['board-detail', 'B'], success(detail('B')));
    await page.view();
    const mutation = page.mutations.find((entry) => entry.options.mutationFn.toString().includes('createBoardComment'));
    const variables = {
      postId: 'A', content: '같은 가상 댓글', requestId: 'synthetic-operation',
      scope: JSON.stringify(['admin', 'synthetic-actor']),
      detailKey: ['board-detail', 'A', 'admin', 'synthetic-actor'],
    };
    assert.equal(mutation.options.networkMode, 'always');
    if (changeAccount) {
      await page.changeActor();
      await page.setQuery(['board-detail', 'B'], success(detail('B')));
    }
    await page.view(1);
    const composer = () => page.find('Textarea', (node) => node.props.placeholder === '댓글을 입력하세요...');
    await act(async () => composer().props.onChange({ currentTarget: { value: variables.content } }));
    await act(async () => mutation.options.onSuccess({}, variables));
    assert.equal(composer().props.value, variables.content);
    assert.ok(page.invalidations.some(({ queryKey }) => JSON.stringify(queryKey) === JSON.stringify(variables.detailKey)));
    if (changeAccount) {
      await assert.rejects(() => mutation.options.mutationFn(variables), /로그인/);
      assert.equal(page.notices.length, 0);
    }
    await page.close();
  });
}

for (const kind of ['reaction', 'comment-like']) {
  for (const outcome of ['success', 'failure']) {
    test(`${kind}: switching posts while optimistic setup awaits cannot redirect the request or ${outcome} cache write`, async () => {
      const page = makeBoard();
      const original = detail('A');
      original.comments = [{
        id: 'comment-A', content: '가상 댓글', authorName: '가상 작성자', authorRole: 'admin',
        createdAt: '2026-01-01T00:00:00Z', stats: { likeCount: 0, replyCount: 0 }, isMine: false, isLiked: false,
      }];
      const other = detail('B', '다른 글의 원문');
      await page.setQuery(['board-detail', 'A'], success(original));
      await page.setQuery(['board-detail', 'B'], success(other));
      await page.view();
      const mutation = page.mutations[kind === 'reaction' ? 3 : 7];
      if (kind === 'reaction') {
        page.find('Tooltip', (node) => node.props.label === '좋아요').findByType('ActionIcon').props.onClick();
      } else {
        page.find('ActionIcon', (node) => node.props.variant === 'subtle'
          && node.props.color === 'gray' && typeof node.props.onClick === 'function'
          && node.findAllByType('IconHeart').length > 0).props.onClick();
      }
      const variables = mutation.calls[0][0];
      const release = page.pauseCancellation();
      const pendingContext = mutation.options.onMutate(variables);
      await page.view(1);
      let context;
      await act(async () => { release(); context = await pendingContext; });
      const result = await mutation.options.mutationFn(variables);
      if (kind === 'reaction') assert.equal(page.reactionRequests[0].postId, 'A');
      else assert.equal(page.commentLikeRequests[0].commentId, 'comment-A');
      await act(async () => {
        if (outcome === 'failure') mutation.options.onError(new Error('synthetic_write_failure'), variables, context);
        else mutation.options.onSuccess(result, variables, context);
      });
      assert.equal(page.cached(['board-detail', 'B']), other);
      assert.equal(page.cached(['board-detail', 'A']).post.id, 'A');
      if (outcome === 'failure') assert.equal(page.cached(['board-detail', 'A']), original);
      else if (kind === 'reaction') assert.equal(page.cached(['board-detail', 'A']).reactions.myReaction, 'like');
      else assert.equal(page.cached(['board-detail', 'A']).comments[0].isLiked, true);
      await page.close();
    });
  }
}

test('web login recovery relies on status/codes, never on arbitrary error text', () => {
  assert.equal(queryError.requiresQueryLogin(new queryError.QueryReadError(401)), true);
  assert.equal(queryError.requiresQueryLogin({ code: 'PGRST301' }), true);
  assert.equal(queryError.requiresQueryLogin(new queryError.QueryReadError(403)), false);
  assert.equal(queryError.requiresQueryLogin(new Error('401 login token')), false);
});

test('board read failure never renders the preview as full content or invents zero comments', async () => {
  const page = makeBoard();
  await page.render(); await page.view();
  await page.setQuery(['board-detail', 'A'], failure());
  assert.ok(page.find('QueryErrorAlert', (node) => node.props.subject === '게시글 상세'));
  assert.equal(page.find('Textarea', (node) => node.props.placeholder === '댓글을 입력하세요...'), undefined);
  await page.setQuery(['board-detail', 'A'], success(detail('A')));
  assert.ok(page.find('Text', (node) => node.props.children === fullBody));
  assert.ok(page.find('Textarea', (node) => node.props.placeholder === '댓글을 입력하세요...'));
  await page.close();
});

function simplePage(path, moduleMocks = {}, globals = {}, exportName = 'default', props = {}) {
  let queryState = initialQuery;
  let queryOptions;
  const mocks = {
    '@/hooks/use-session': { useSession: () => ({ role: 'admin', residentId: 'synthetic-actor', hydrated: true }) },
    '@/components/QueryErrorAlert': ui,
    '@/lib/query-read-error': queryError,
    '@tanstack/react-query': {
      useQuery(options) { queryOptions = options; return queryState; },
      useMutation: () => ({ isPending: false, mutate() {} }),
      useQueryClient: () => ({ invalidateQueries() {} }),
    },
    '@mantine/hooks': { useDisclosure(initial) {
      const [opened, setOpened] = React.useState(initial);
      return [opened, { open: () => setOpened(true), close: () => setOpened(false) }];
    } },
    '@mantine/notifications': { notifications: { show() {} } },
    '@mantine/dates': ui,
    '@mantine/form': { useForm: ({ initialValues }) => ({ values: initialValues, errors: {}, onSubmit: () => () => {}, getInputProps: () => ({}) }) },
    dayjs: { default: webRequire('dayjs') },
    zod: webRequire('zod'),
    'next/navigation': { useRouter: () => ({ replace() {} }), useSearchParams: () => new URLSearchParams() },
    ...moduleMocks,
  };
  const Page = loadTsx(path, mocks, globals)[exportName];
  let renderer;
  const render = async () => act(async () => {
    if (renderer) renderer.update(React.createElement(Page, props));
    else renderer = create(React.createElement(Page, props));
  });
  return {
    render,
    find: (type, predicate = () => true) => renderer.root.findAllByType(type).find(predicate),
    findAll: (type) => renderer.root.findAllByType(type),
    async setQuery(state) { queryState = state; await render(); },
    async fetch() { return queryOptions.queryFn(); },
    async close() { await act(async () => renderer.unmount()); },
  };
}

test('recommender 401/500/network failure is distinct from a successful empty search, with retry', async () => {
  let response;
  const page = simplePage('../components/RecommenderSelect.tsx', {}, {
    fetch: async () => { if (response instanceof Error) throw response; return response; },
  }, 'RecommenderSelect', { value: null, onChange() {} });
  await page.render();
  for (const status of [401, 500]) {
    response = { ok: false, status, json: async () => ({ error: 'UPSTREAM_PRIVATE_DETAILS' }) };
    let error;
    try { await page.fetch(); } catch (caught) { error = caught; }
    assert.equal(error.status, status);
    let retries = 0;
    await page.setQuery({ ...failure(error), refetch() { retries += 1; } });
    assert.equal(page.find('Select').props.nothingFoundMessage, '후보를 불러오지 못했습니다.');
    page.find('QueryErrorAlert').props.onRetry();
    assert.equal(retries, 1);
  }
  response = new Error('offline');
  await assert.rejects(page.fetch(), /offline/);
  response = { ok: true, json: async () => ({ ok: true, candidates: [], selectedCandidate: null }) };
  await page.setQuery(success(await page.fetch()));
  assert.equal(page.find('Select').props.nothingFoundMessage, '검색 결과가 없습니다.');
  assert.equal(page.find('QueryErrorAlert'), undefined);
  await page.close();
});

test('messenger partial read failures keep successful counts and show unknown badges instead of zero', async () => {
  const failures = new Set(['group_chat_bootstrap', 'inbox_list']);
  const page = simplePage('../app/dashboard/messenger/page.tsx', {
    '@/lib/request-board-url': { resolveRequestBoardMessengerConfig: () => ({ available: true, messengerUrl: 'https://example.invalid/messenger' }) },
    '@/lib/staff-identity': { getWebStaffChatActorId: () => 'synthetic-actor', isDeveloperSession: () => false },
  }, {
    fetch: async (_, options) => {
      const { type } = JSON.parse(options.body);
      if (failures.has(type)) return { ok: false, status: type === 'inbox_list' ? 401 : 500, json: async () => ({ ok: false }) };
      if (type === 'group_chat_bootstrap') return { ok: true, json: async () => ({ ok: true, unread_count: 0 }) };
      return { ok: true, json: async () => ({ ok: true, data: type === 'internal_unread_count' ? { ok: true, count: 7 } : { ok: true, notifications: [] } }) };
    },
  });
  await page.render();
  const partial = await page.fetch();
  assert.equal(partial.internalUnread, 7);
  assert.equal(partial.groupChatUnread, null);
  assert.equal(partial.requestBoardUnread, null);
  assert.equal(partial.errors.length, 2);
  await page.setQuery(success(partial));
  assert.equal(page.findAll('Badge').filter((node) => node.props.children === '미확인 수 확인 불가').length, 2);
  assert.equal(queryError.requiresQueryLogin(page.find('QueryErrorAlert').props.error), true);
  failures.add('internal_unread_count');
  const failed = await page.fetch();
  await page.setQuery(success(failed));
  assert.equal(page.findAll('Badge').filter((node) => node.props.children === '미확인 수 확인 불가').length, 3);
  failures.clear();
  const recovered = await page.fetch();
  assert.equal(recovered.groupChatUnread, 0);
  assert.equal(recovered.requestBoardUnread, 0);
  await page.setQuery(success(recovered));
  assert.equal(page.find('QueryErrorAlert'), undefined);
  assert.equal(page.findAll('Badge').filter((node) => node.props.children === '미확인 수 확인 불가').length, 0);
  await page.close();
});

test('safe read-error UI never renders upstream text and provides login only for structured auth failure', async () => {
  let retries = 0;
  const { QueryErrorAlert } = loadTsx('../components/QueryErrorAlert.tsx', { '@/lib/query-read-error': queryError });
  let renderer;
  await act(async () => { renderer = create(React.createElement(QueryErrorAlert, { error: new Error('UPSTREAM_PRIVATE_DETAILS'), onRetry() { retries += 1; } })); });
  assert.ok(!JSON.stringify(renderer.toJSON()).includes('UPSTREAM_PRIVATE_DETAILS'));
  renderer.root.findAllByType('Button')[0].props.onClick();
  assert.equal(retries, 1);
  assert.equal(renderer.root.findAllByType('Button').length, 1);
  await act(async () => renderer.update(React.createElement(QueryErrorAlert, { error: new queryError.QueryReadError(401), onRetry() {} })));
  assert.equal(renderer.root.findAllByType('Button').find((node) => node.props.href)?.props.href, '/auth');
  await act(async () => renderer.unmount());
});

const commonListMocks = {
  '@/components/StatusToggle': ui,
  '@/components/RejectReasonModal': ui,
  '@/components/NotificationDestinationReady': ui,
  '@/lib/supabase': { supabase: {} },
  '@/lib/admin-document-client': { fetchAdminDocuments: async () => [], fetchAdminFcList: async () => [], signAdminDocument: async () => 'https://storage.example.test/synthetic' },
  '@/lib/logger': { logger: {} },
  '@/lib/show-admin-notification-warning': { showAdminNotificationWarning() {} },
  '@/lib/notification-delivery-feedback': { notificationFeedbackColor: () => 'green' },
  '@/lib/exam-round-sort': { sortExamRoundsNewestFirst: (rounds) => rounds },
  './actions': {},
  'next/link': { default: component('Link') },
};

for (const [path, emptyText, subject] of [
  ['appointment', '조건에 맞는 FC가 없습니다.', '위촉 대상 FC'],
  ['docs', '해당 조건의 서류가 존재하지 않습니다.', '서류 목록'],
  ['notifications', '등록된 공지사항이 없습니다.', '공지 목록'],
  ['exam/schedule', '등록된 일정이 없습니다.', '시험 일정'],
]) {
  test(`${path}: initial error/refresh error/loading/verified empty render distinct states and retry`, async () => {
    const page = simplePage(`../app/dashboard/${path}/page.tsx`, commonListMocks);
    await page.render();
    const textExists = (text) => [...page.findAll('Text'), ...page.findAll('Table.Td')].some((node) => node.props.children === text);
    assert.equal(textExists(emptyText), false);
    let retries = 0;
    await page.setQuery({ ...failure(new queryError.QueryReadError(401)), refetch() { retries += 1; } });
    assert.equal(textExists(emptyText), false);
    const alert = page.find('QueryErrorAlert', (node) => node.props.subject === subject);
    assert.ok(alert);
    assert.equal(alert.props.hasData, false);
    alert.props.onRetry();
    assert.equal(retries, 1);
    await page.setQuery(failure(new queryError.QueryReadError(500), []));
    assert.equal(page.find('QueryErrorAlert').props.hasData, true);
    assert.equal(textExists(emptyText), false);
    await page.setQuery(success([]));
    assert.equal(page.find('QueryErrorAlert'), undefined);
    assert.equal(textExists(emptyText), true);
    await page.close();
  });
}

test('dashboard failed FC reads do not display empty-list text or invented zero KPIs', async () => {
  const page = simplePage('../app/dashboard/page.tsx', {
    ...commonListMocks,
    '@/hooks/use-resident-number': { useResidentNumber: () => ({}) },
    '@/hooks/use-visible-page-resident-numbers': { useVisiblePageResidentNumbers: () => new Map() },
    '@/lib/admin-file-open': {},
    '../../components/StatusToggle': ui,
    '../../lib/fc-workflow': {},
    '../../lib/shared': { ADMIN_STEP_LABELS: {}, DOC_OPTIONS: [] },
    '../actions': {},
    './appointment/actions': {},
    './docs/actions': {},
    './page.module.css': { default: {} },
    '@/lib/dashboard-table-display': { DASHBOARD_FC_LIST_COLUMNS: [], DASHBOARD_FC_LIST_COLUMN_COUNT: 9 },
    '../../lib/logger': { logger: {} },
  });
  await page.render();
  await page.setQuery(failure());
  assert.ok(page.find('QueryErrorAlert'));
  assert.equal(page.findAll('Text').filter((node) => node.props.children === '조건에 맞는 데이터가 없습니다.').length, 0);
  assert.deepEqual(page.findAll('Text').filter((node) => node.props.size === '2.5rem').map((node) => node.props.children), ['—', '—', '—']);
  await page.setQuery(success([]));
  assert.equal(page.find('QueryErrorAlert'), undefined);
  assert.ok(page.find('Text', (node) => node.props.children === '조건에 맞는 데이터가 없습니다.'));
  assert.deepEqual(page.findAll('Text').filter((node) => node.props.size === '2.5rem').map((node) => node.props.children), [0, 0, 0]);
  await page.close();
});
