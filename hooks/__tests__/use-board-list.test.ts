import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactElement } from 'react';

import type { BoardListItem } from '@/lib/board-api';
import type { BoardListPage } from '@/lib/board-list-pages';

import { useBoardList } from '../use-board-list';
import { useReadSessionScope } from '../use-read-session-scope';

const mockSession = {
  hydrated: true, role: 'fc' as string | null, readOnly: false,
  residentId: 'fictional-actor', displayName: 'Fictional User', appSessionToken: 'fictional-session-a',
};
jest.mock('../use-session', () => ({ useSession: () => mockSession }));
const mockFetchBoardList = jest.fn<Promise<BoardListPage>, unknown[]>();
jest.mock('@/lib/board-api', () => ({
  buildBoardActor: (session: typeof mockSession) => session.role && session.residentId
    ? { role: session.readOnly ? 'manager' : session.role, residentId: session.residentId, displayName: session.displayName }
    : null,
  fetchBoardList: (...args: unknown[]) => mockFetchBoardList(...args),
}));

type Renderer = { update: (element: ReactElement) => void; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer') as { create: (element: ReactElement) => Renderer };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const item = (id: string) => ({ id, stats: { viewCount: 0 } }) as BoardListItem;
const firstPage = () => ({ items: Array.from({ length: 20 }, (_, index) => item(`post-${index + 1}`)), nextCursor: 'opaque+/= cursor' });

describe('board list infinite reads', () => {
  let client: QueryClient;
  let renderer: Renderer | undefined;
  let options: { selectedCategoryId: string | null; sortOption: 'created' | 'latest' | 'comments' | 'reactions'; searchQuery: string };
  let latest: ReturnType<typeof useBoardList>;
  function Probe() {
    latest = useBoardList({ ...options, sessionScope: useReadSessionScope() });
    return null;
  }
  const element = () => createElement(QueryClientProvider, { client }, createElement(Probe));
  const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); };
  const mount = async () => { await act(async () => { renderer = create(element()); }); await flush(); };
  const rerender = async () => { await act(async () => { renderer!.update(element()); }); await flush(); };

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    options = { selectedCategoryId: null, sortOption: 'created', searchQuery: '' };
    Object.assign(mockSession, { hydrated: true, role: 'fc', readOnly: false, residentId: 'fictional-actor', appSessionToken: 'fictional-session-a' });
    mockFetchBoardList.mockReset();
    renderer = undefined;
  });
  afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); client.clear(); });

  it('loads the 21st older post with the unchanged server cursor and deduplicates repeated pins', async () => {
    let finishNext!: (value: BoardListPage) => void;
    mockFetchBoardList.mockResolvedValueOnce({ ...firstPage(), items: [item('pin'), ...firstPage().items] })
      .mockImplementationOnce(() => new Promise((resolve) => { finishNext = resolve; }));
    await mount();
    expect(latest.posts).toHaveLength(21);
    expect(latest.hasNextPage).toBe(true);
    let load!: Promise<unknown>;
    await act(async () => { load = latest.fetchNextPage(); }); await flush();
    expect(latest.isFetchingNextPage).toBe(true);
    expect(latest.posts).toHaveLength(21);
    expect(mockFetchBoardList.mock.calls[1][1]).toEqual({ limit: 20, sort: 'created', cursor: 'opaque+/= cursor' });
    await act(async () => { finishNext({ items: [item('pin'), item('post-21')], nextCursor: null }); await load; }); await flush();
    expect(latest.posts.map((post) => post.id)).toEqual(['pin', ...Array.from({ length: 21 }, (_, index) => `post-${index + 1}`)]);
    expect(latest.hasNextPage).toBe(false);
    expect(mockFetchBoardList).toHaveBeenCalledTimes(2);
  });

  it('retains the loaded list after a next-page failure and retries that page', async () => {
    mockFetchBoardList.mockResolvedValueOnce(firstPage()).mockRejectedValueOnce(new Error('synthetic page failure'))
      .mockResolvedValueOnce({ items: [item('post-21')], nextCursor: null });
    await mount();
    await act(async () => { await latest.fetchNextPage(); }); await flush();
    expect(latest.isFetchNextPageError).toBe(true);
    expect(latest.posts).toHaveLength(20);
    expect(latest.hasNextPage).toBe(true);
    await act(async () => { await latest.fetchNextPage(); }); await flush();
    expect(latest.isFetchNextPageError).toBe(false);
    expect(latest.posts).toHaveLength(21);
    expect(mockFetchBoardList.mock.calls[2][1]).toEqual(mockFetchBoardList.mock.calls[1][1]);
  });

  it('starts independent first pages on category, sort, and search changes and ignores a late old page', async () => {
    let finishOld!: (value: BoardListPage) => void;
    mockFetchBoardList.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce({ items: [item('education')], nextCursor: null })
      .mockResolvedValueOnce({ items: [item('comments')], nextCursor: null })
      .mockResolvedValueOnce({ items: [item('search')], nextCursor: null });
    await mount();
    options.selectedCategoryId = 'education'; await rerender();
    expect(latest.posts[0].id).toBe('education');
    await act(async () => finishOld(firstPage())); await flush();
    expect(latest.posts.map((post) => post.id)).toEqual(['education']);
    options.sortOption = 'comments'; await rerender();
    options.searchQuery = '  older post  '; await rerender();
    expect(latest.posts.map((post) => post.id)).toEqual(['search']);
    expect(mockFetchBoardList.mock.calls.slice(1).map((call) => call[1])).toEqual([
      { limit: 20, sort: 'created', categoryId: 'education' },
      { limit: 20, sort: 'comments', categoryId: 'education' },
      { limit: 20, sort: 'comments', categoryId: 'education', search: 'older post' },
    ]);
  });

  it('hides cached old-session posts during token renewal and after logout', async () => {
    let finishNew!: (value: BoardListPage) => void;
    mockFetchBoardList.mockResolvedValueOnce(firstPage())
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
    await mount();
    mockSession.appSessionToken = 'fictional-session-b'; await rerender();
    expect(latest.posts).toEqual([]);
    expect(latest.isLoading).toBe(true);
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain('fictional-session');
    await act(async () => finishNew({ items: [item('new-session')], nextCursor: null })); await flush();
    expect(latest.posts.map((post) => post.id)).toEqual(['new-session']);
    mockSession.role = null; await rerender();
    expect(latest.posts).toEqual([]);
    expect(mockFetchBoardList).toHaveBeenCalledTimes(2);
  });

  it('hides old actor data while an account switch is loading', async () => {
    let finishOther!: (value: BoardListPage) => void;
    mockFetchBoardList.mockResolvedValueOnce(firstPage())
      .mockImplementationOnce(() => new Promise((resolve) => { finishOther = resolve; }));
    await mount();
    mockSession.residentId = 'fictional-other'; await rerender();
    expect(latest.posts).toEqual([]);
    expect(mockFetchBoardList.mock.calls[1][0]).toMatchObject({ residentId: 'fictional-other' });
    await act(async () => finishOther({ items: [item('other-account')], nextCursor: null })); await flush();
    expect(latest.posts.map((post) => post.id)).toEqual(['other-account']);
  });
});
