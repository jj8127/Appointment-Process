import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, useState, type ReactElement } from 'react';
import * as ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';

import { formatHomeCount, isReadSessionError } from '@/lib/home-read-state';

type Instance = { children: (Instance | string)[]; props: Record<string, unknown>; findAllByType: (type: string) => Instance[] };
type Renderer = { root: Instance; update: (element: ReactElement) => void; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer') as { create: (element: ReactElement) => Renderer };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const replace = jest.fn();
const rootPath = join(__dirname, '../..');
const source = (path: string) => ts.createSourceFile(path, readFileSync(join(rootPath, path), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function execute(code: string, dependencies: Record<string, unknown> = {}) {
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exported: Record<string, unknown> = {};
  new Function('require', 'exports', ...Object.keys(dependencies), output)((name: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (value: unknown) => value } };
    if (name === 'expo-router') return { router: { replace } };
    if (name === '@/lib/home-read-state') return { isReadSessionError };
    throw new Error(`Unexpected dependency ${name}`);
  }, exported, ...Object.values(dependencies));
  return exported;
}
const QueryReadState = execute(readFileSync(join(rootPath, 'components/QueryReadState.tsx'), 'utf8')).QueryReadState;

// Render the actual route JSX branches, replacing only native hosts. This catches
// error/empty precedence and retry wiring, without loading unrelated route plugins.
function expression(path: string, beginning: string): string {
  const file = source(path);
  let result = '';
  function visit(node: ts.Node) {
    if (!result && ts.isJsxExpression(node) && node.expression?.getText(file).startsWith(beginning)) result = node.expression.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!result) throw new Error(`Missing route expression ${path}: ${beginning}`);
  return result;
}
function routeLocal(path: string, name: string, dependencies: Record<string, unknown>) {
  const file = source(path);
  let declaration = '';
  function visit(node: ts.Node) {
    if (!declaration && ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(file) === name)) declaration = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!declaration) throw new Error(`Missing route local ${name}`);
  return execute(`${declaration}\nexports.value = ${name};`, dependencies).value;
}
async function renderBranches(path: string, beginnings: string[], variables: Record<string, unknown>) {
  const code = `export default function Render() { return <>${beginnings.map((beginning) => `{${expression(path, beginning)}}`).join('')}</>; }`;
  const Render = execute(code, {
    View: 'View', Text: 'Text', Feather: 'Feather', Pressable: 'Pressable', CardSkeleton: 'CardSkeleton',
    BrandedLoadingState: 'BrandedLoadingState', QueryReadState,
    styles: new Proxy({}, { get: () => ({}) }), ...variables,
  }).default as () => ReactElement;
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Render)); });
  const texts = renderer.root.findAllByType('Text').map((node) => node.children.filter((child) => typeof child === 'string').join(''));
  return { renderer, texts };
}

describe('mobile read failure presentation', () => {
  const renderers: Renderer[] = [];
  afterEach(async () => { for (const renderer of renderers.splice(0)) await act(async () => renderer.unmount()); replace.mockClear(); });
  async function render(path: string, beginnings: string[], variables: Record<string, unknown>) {
    const result = await renderBranches(path, beginnings, variables); renderers.push(result.renderer); return result;
  }

  it.each(['exam-register.tsx', 'exam-register2.tsx'])('%s separates failed rounds from genuine empty and retries', async (route) => {
    const refetch = jest.fn();
    const variables = { isLoading: false, isFetching: false, isError: true, roundsError: new Error('synthetic'), sortedRounds: [], canEdit: true, refetch };
    const failed = await render(`app/${route}`, ['isLoading || isFetching ?'], variables);
    expect(failed.texts).toContain('시험 일정을 불러오지 못했습니다.');
    expect(failed.texts.join(' ')).not.toContain('등록된 시험 일정이 없습니다');
    await act(async () => (failed.renderer.root.findAllByType('Pressable')[0].props.onPress as () => void)());
    expect(refetch).toHaveBeenCalledTimes(1);
    const empty = await render(`app/${route}`, ['isLoading || isFetching ?'], { ...variables, isError: false });
    expect(empty.texts).toContain('등록된 시험 일정이 없습니다');
  });

  it.each(['board.tsx', 'admin-board-manage.tsx'])('%s cannot present incomplete detail as zero comments', async (route) => {
    const refetchDetail = jest.fn();
    const variables = { hasCompleteDetail: false, isDetailError: true, isDetailFetching: false, detailError: new Error('synthetic'), refetchDetail };
    const failed = await render(`app/${route}`, ['!hasCompleteDetail ?'], variables);
    expect(failed.texts).toContain('게시글 상세를 불러오지 못했습니다.');
    expect(failed.texts.join(' ')).not.toContain('첫 댓글');
    await act(async () => (failed.renderer.root.findAllByType('Pressable')[0].props.onPress as () => void)());
    expect(refetchDetail).toHaveBeenCalledTimes(1);
    const pending = await render(`app/${route}`, ['!hasCompleteDetail ?'], { ...variables, isDetailError: false, detailError: null });
    expect(pending.texts).toContain('게시글을 불러오는 중...');
    expect(pending.texts.join(' ')).not.toContain('첫 댓글');
    const emptyComments = await render(`app/${route}`, ['threadedComments.roots.length > 0 ?'], { threadedComments: { roots: [] } });
    expect(emptyComments.texts).toContain('첫 댓글을 남겨보세요!');
  });

  it.each(['board.tsx', 'admin-board-manage.tsx', 'notice.tsx'])('%s never renders error and legitimate empty together', async (route) => {
    const notice = route === 'notice.tsx';
    const failed = await render(`app/${route}`, ['isError &&', notice ? '!isLoading && !isError && !notices.length' : '!isLoading && !isError && filteredPosts.length === 0'], {
      isError: true, isFetchNextPageError: false, isLoading: false, filteredPosts: [], notices: [], refetch: jest.fn(), listError: new Error('synthetic'), noticesError: new Error('synthetic'),
    });
    expect(failed.texts.join(' ')).toContain('불러오지 못했습니다');
    expect(failed.texts.join(' ')).not.toContain('등록된');
  });

  it('composer distinguishes failed, pending and legitimately empty categories', async () => {
    const variables = { isCategoriesError: true, isCategoriesPending: false, isCategoriesFetching: false, categoriesError: new Error('synthetic'), categories: [], refetchCategories: jest.fn() };
    const failed = await render('app/admin-board.tsx', ['isCategoriesError ?'], variables);
    expect(failed.texts).toContain('카테고리를 불러오지 못했습니다.');
    expect(failed.texts.join(' ')).not.toContain('불러오는 중');
    const empty = await render('app/admin-board.tsx', ['isCategoriesError ?'], { ...variables, isCategoriesError: false });
    expect(empty.texts).toContain('등록된 카테고리가 없습니다.');
    const pending = await render('app/admin-board.tsx', ['isCategoriesError ?'], { ...variables, isCategoriesError: false, isCategoriesPending: true });
    expect(pending.texts).toContain('카테고리를 불러오는 중입니다.');
  });

  it('session errors offer a working re-login action instead of repeating a forbidden read', async () => {
    const failed = await render('app/admin-board.tsx', ['isCategoriesError ?'], {
      isCategoriesError: true, categoriesError: { status: 401 }, isCategoriesFetching: false, refetchCategories: jest.fn(),
    });
    expect(failed.texts).toContain('다시 로그인');
    expect(failed.texts).not.toContain('다시 시도');
    await act(async () => (failed.renderer.root.findAllByType('Pressable')[0].props.onPress as () => void)());
    expect(replace).toHaveBeenCalledWith('/login?skipAuto=1');
  });

  it('home preserves successful zero and marks failed or unknown counts honestly', () => {
    expect(formatHomeCount(0, false)).toBe('0명');
    expect(formatHomeCount(undefined, false)).toBe('조회 중');
    expect(formatHomeCount(undefined, true)).toBe('확인 불가');
    expect(formatHomeCount(17, true)).toBe('확인 불가');
  });

  it.each([
    { isSourceReady: false, isCategoriesError: false, pendingAttachmentRetry: null },
    { isSourceReady: true, isCategoriesError: true, pendingAttachmentRetry: null },
    { isSourceReady: true, isCategoriesError: false, pendingAttachmentRetry: { postId: 'saved-post' } },
  ])('composer guards editing/saving during missing source, category error or attachment retry: %j', (scenario) => {
    const canEditComposer = routeLocal('app/admin-board.tsx', 'canEditComposer', { canWrite: true, canEditPost: true, createIntent: { current: null }, ...scenario });
    const canSubmitContent = routeLocal('app/admin-board.tsx', 'canSubmitContent', { canEditComposer, isCategoriesPending: false, categories: [{}], ...scenario });
    expect(canSubmitContent).toBe(false);
    if (!scenario.isSourceReady || scenario.pendingAttachmentRetry) expect(canEditComposer).toBe(false);
  });

  it('actual mobile save handler blocks an unread original and retains full draft when saving is allowed', async () => {
    const updateBoardPost = jest.fn().mockResolvedValue({});
    const createBoardPost = jest.fn();
    const alert = jest.fn();
    const dependencies = {
      canWrite: true, pendingAttachmentRetry: null, canSubmitContent: false,
      title: 'Fictional edited title', content: 'complete fictional draft '.repeat(20), categoryId: 'fictional-category',
      actor: { role: 'admin' }, postId: 'fictional-post', isEditMode: true,
      attachments: [], existingAttachments: [], setLoading: jest.fn(),
      submitRef: { current: false }, beginMutation: () => () => true, currentOutcome: { current: () => true }, createIntent: { current: null },
      updateBoardPost, createBoardPost, Alert: { alert }, queryClient: { invalidateQueries: jest.fn() }, finishSavedPost: jest.fn(), logBoardError: jest.fn(),
    };
    const blocked = routeLocal('app/admin-board.tsx', 'handleSubmit', dependencies) as () => Promise<void>;
    await blocked();
    expect(updateBoardPost).not.toHaveBeenCalled();
    expect(createBoardPost).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('조회 필요', expect.any(String));
    const allowed = routeLocal('app/admin-board.tsx', 'handleSubmit', { ...dependencies, canSubmitContent: true }) as () => Promise<void>;
    await allowed();
    expect(updateBoardPost).toHaveBeenCalledWith(dependencies.actor, expect.objectContaining({ content: dependencies.content.trim() }));
  });

  it('saved attachment retry remains available without repeating the blocked content write', async () => {
    const createBoardPost = jest.fn();
    const updateBoardPost = jest.fn();
    const uploadSelectedAttachments = jest.fn().mockResolvedValue({ complete: true });
    const retry = routeLocal('app/admin-board.tsx', 'handleSubmit', {
      canWrite: true, canSubmitContent: false,
      pendingAttachmentRetry: { postId: 'fictional-saved-post', operation: 'update', manifest: 'fictional-manifest' },
      setLoading: jest.fn(), uploadSelectedAttachments, queryClient: { invalidateQueries: jest.fn() }, finishSavedPost: jest.fn(),
      submitRef: { current: false }, beginMutation: () => () => true, currentOutcome: { current: () => true }, createIntent: { current: null },
      createBoardPost, updateBoardPost, Alert: { alert: jest.fn() },
    }) as () => Promise<void>;
    await retry();
    expect(uploadSelectedAttachments).toHaveBeenCalledWith('fictional-saved-post', 'fictional-manifest');
    expect(createBoardPost).not.toHaveBeenCalled();
    expect(updateBoardPost).not.toHaveBeenCalled();
  });

  it('composer freezes editing while an uncertain create intent is retained', () => {
    const canEditComposer = routeLocal('app/admin-board.tsx', 'canEditComposer', {
      canWrite: true, canEditPost: true, isSourceReady: true, pendingAttachmentRetry: null,
      createIntent: { current: { requestId: 'stable-intent' } },
    });
    expect(canEditComposer).toBe(false);
  });

  it('actual saved attachment retry rejects a duplicate synchronous submission', async () => {
    const beginMutation = jest.fn();
    const uploadSelectedAttachments = jest.fn();
    const run = routeLocal('app/admin-board.tsx', 'handleSubmit', {
      submitRef: { current: true }, beginMutation, uploadSelectedAttachments,
    }) as () => Promise<void>;
    await run();
    expect(beginMutation).not.toHaveBeenCalled();
    expect(uploadSelectedAttachments).not.toHaveBeenCalled();
  });

  it('actual saved attachment retry cannot finish or refresh another session after a delayed result', async () => {
    let current = true;
    let resolveUpload!: (value: { complete: boolean }) => void;
    const uploadSelectedAttachments = jest.fn(() => new Promise<{ complete: boolean }>((resolve) => { resolveUpload = resolve; }));
    const invalidateQueries = jest.fn();
    const finishSavedPost = jest.fn();
    const setLoading = jest.fn();
    const run = routeLocal('app/admin-board.tsx', 'handleSubmit', {
      canWrite: true, pendingAttachmentRetry: { postId: 'fictional-post', operation: 'update', manifest: null },
      submitRef: { current: false }, beginMutation: () => () => current, currentOutcome: { current: () => current },
      uploadSelectedAttachments, setLoading, queryClient: { invalidateQueries }, finishSavedPost,
    }) as () => Promise<void>;
    const pending = run();
    expect(uploadSelectedAttachments).toHaveBeenCalledTimes(1);
    current = false;
    resolveUpload({ complete: true });
    await pending;
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(finishSavedPost).not.toHaveBeenCalled();
    expect(setLoading.mock.calls).toEqual([[true]]);
  });

  it.each([
    ['board.tsx', 'BoardScreen', 'BoardScreenContent'],
    ['admin-board-manage.tsx', 'AdminBoardManageScreen', 'AdminBoardManageContent'],
  ])('%s remounts all modal/draft state when the signed-session scope changes', async (route, name, contentName) => {
    const file = source(`app/${route}`);
    const wrapper = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
    expect(wrapper).toBeDefined();
    let scope = 1;
    let current!: Record<string, string>;
    let update!: (value: Record<string, string>) => void;
    function ContentProbe() {
      const [state, setState] = useState<Record<string, string>>({});
      current = state;
      update = setState;
      return createElement('Text', {}, JSON.stringify(state));
    }
    const Screen = execute(wrapper!.getText(file), { useReadSessionScope: () => scope, [contentName]: ContentProbe }).default as () => ReactElement;
    let renderer!: Renderer;
    await act(async () => { renderer = create(createElement(Screen)); }); renderers.push(renderer);
    const oldSessionUpdate = update;
    await act(async () => update({ selectedPost: 'old post', commentText: 'old draft', editingCommentText: 'old edit', replyTarget: 'old reply', previewImage: 'old image' }));
    expect(current.commentText).toBe('old draft');
    scope = 2;
    await act(async () => renderer.update(createElement(Screen)));
    expect(current).toEqual({});
    await act(async () => oldSessionUpdate({ commentText: 'late old callback' }));
    expect(current).toEqual({});
  });

  it.each(['board.tsx', 'admin-board-manage.tsx'])('%s pins pending comment-like rollback and success to its originating detail cache', async (route) => {
    const client = new QueryClient();
    const oldKey = ['board-detail', 'post-a', 1];
    const newKey = ['board-detail', 'post-b', 1];
    const oldDetail = { post: { id: 'post-a' }, comments: [{ id: 'comment-a', isLiked: false, stats: { likeCount: 0 } }] };
    const newDetail = { post: { id: 'post-b' }, comments: [] };
    client.setQueryData(oldKey, oldDetail);
    client.setQueryData(newKey, newDetail);
    type Context = { detailKey: (string | number)[]; previousDetail: typeof oldDetail };
    type Options = {
      onMutate: (id: string) => Promise<Context>;
      onError: (error: Error, id: string, context: Context) => void;
      onSuccess: (data: { liked: boolean; likeCount: number }, id: string, context: Context) => void;
    };
    const options = (selectedPostId: string) => routeLocal(`app/${route}`, 'toggleCommentLikeMutation', {
      useMutation: (value: unknown) => value, actor: {}, selectedPostId, sessionScope: 1, queryClient: client,
      toggleCommentLike: jest.fn(), logBoardError: jest.fn(), showBoardFeedbackAlert: jest.fn(), Alert: { alert: jest.fn() },
    }) as Options;
    const context = await options('post-a').onMutate('comment-a');
    expect(client.getQueryData<typeof oldDetail>(oldKey)?.comments[0].isLiked).toBe(true);
    // TanStack updates callback options after the screen selects another post.
    const moved = options('post-b');
    moved.onError(new Error('synthetic delayed failure'), 'comment-a', context);
    expect(client.getQueryData(oldKey)).toEqual(oldDetail);
    expect(client.getQueryData(newKey)).toEqual(newDetail);
    moved.onSuccess({ liked: true, likeCount: 7 }, 'comment-a', context);
    expect(client.getQueryData<typeof oldDetail>(oldKey)?.comments[0].stats.likeCount).toBe(7);
    expect(client.getQueryData(newKey)).toEqual(newDetail);
    client.clear();
  });

  it.each(['board.tsx', 'admin-board-manage.tsx'])('%s ignores late reaction overrides after moving to another post', (route) => {
    const client = new QueryClient();
    const setMyReactionOverride = jest.fn();
    type Options = {
      onError: (error: Error, variables: { postId: string }, context: { previousMyReaction: string }) => void;
      onSuccess: (data: { myReaction: string }, variables: { postId: string }) => void;
    };
    const options = (selectedPostId: string) => routeLocal(`app/${route}`, 'addReactionMutation', {
      useMutation: (value: unknown) => value, queryClient: client, sessionScope: 1, selectedPostId,
      setMyReactionOverride, logBoardError: jest.fn(), showBoardFeedbackAlert: jest.fn(), Alert: { alert: jest.fn() },
    }) as Options;
    const moved = options('post-b');
    moved.onError(new Error('synthetic delayed failure'), { postId: 'post-a' }, { previousMyReaction: 'like' });
    moved.onSuccess({ myReaction: 'heart' }, { postId: 'post-a' });
    expect(setMyReactionOverride).not.toHaveBeenCalled();
    const current = options('post-a');
    current.onSuccess({ myReaction: 'heart' }, { postId: 'post-a' });
    expect(setMyReactionOverride).toHaveBeenCalledWith('heart');
    client.clear();
  });
});

describe('home summary fetches preserve failures', () => {
  function loadFunction(name: string, dependencies: Record<string, unknown>) {
    const file = source('app/index.tsx');
    const statement = file.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(file) === name));
    if (!statement) throw new Error(`Missing home function ${name}`);
    return execute(`${statement.getText(file)}\nexports.run = ${name};`, dependencies).run as (...args: unknown[]) => Promise<unknown>;
  }
  it('latest notice rejects transport/server failures but resolves a genuine no-notice result', async () => {
    const invokeFcNotify = jest.fn().mockResolvedValueOnce({ error: new Error('synthetic') })
      .mockResolvedValueOnce({ data: { ok: false } }).mockResolvedValueOnce({ data: { ok: true, notice: null } });
    const fetch = loadFunction('fetchLatestNotice', { invokeFcNotify });
    await expect(fetch()).rejects.toThrow('synthetic');
    await expect(fetch()).rejects.toThrow('최신 공지');
    await expect(fetch()).resolves.toBeNull();
  });
  it('latest message rejects lookup failure but resolves a genuine empty conversation', async () => {
    const resolveGaraminDirectConversation = jest.fn().mockRejectedValueOnce(new Error('synthetic')).mockResolvedValue({ id: 'fictional-room' });
    const fetchGaraminDirectMessages = jest.fn().mockResolvedValue({ messages: [] });
    const fetch = loadFunction('fetchLatestAdminMessage', { resolveGaraminDirectConversation, fetchGaraminDirectMessages });
    await expect(fetch('fictional-actor')).rejects.toThrow('synthetic');
    await expect(fetch('fictional-actor')).resolves.toBeNull();
  });
});
