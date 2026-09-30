import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, createElement, useEffect, useState, type ReactElement } from 'react';

import { useBoardEditorSource } from '../use-board-editor-source';
import { useReadSessionScope } from '../use-read-session-scope';

const mockSession = { hydrated: true, role: 'admin', readOnly: false, residentId: 'fictional-actor', appSessionToken: 'fictional-session-a' };
jest.mock('../use-session', () => ({ useSession: () => mockSession }));
type Detail = { post: { id: string; content: string } };
type Renderer = { update: (element: ReactElement) => void; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer') as { create: (element: ReactElement) => Renderer };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('board editor complete source and session ownership', () => {
  let client: QueryClient;
  let renderer: Renderer;
  let postId: string;
  const fetchDetail = jest.fn<Promise<Detail>, []>();
  let latest: { ready: boolean; source: Detail | null; draft: string; edit: (text: string) => void; retry: () => Promise<unknown> };
  function Probe() {
    const scope = useReadSessionScope();
    const query = useQuery({ queryKey: ['board-detail', postId, scope], queryFn: fetchDetail });
    const source = useBoardEditorSource(String(scope), postId, query.data, query.isError);
    const [draft, edit] = useState('');
    useEffect(() => { if (source.source) edit(source.source.post.content); }, [source.source]);
    latest = { ...source, draft, edit, retry: query.refetch };
    return null;
  }
  const element = () => createElement(QueryClientProvider, { client }, createElement(Probe));
  const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); }); };
  const mount = async () => { await act(async () => { renderer = create(element()); }); await flush(); };
  const rerender = async () => { await act(async () => { renderer.update(element()); }); await flush(); };
  const detail = (id = 'post-a', content = 'complete fictional post') => ({ post: { id, content } });

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    postId = 'post-a';
    mockSession.appSessionToken = 'fictional-session-a';
    fetchDetail.mockReset();
  });
  afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); client.clear(); });

  it('blocks editing after failure, then initializes only from a successful matching full read', async () => {
    fetchDetail.mockRejectedValueOnce(new Error('synthetic read failure')).mockResolvedValueOnce(detail());
    await mount();
    expect(latest.ready).toBe(false);
    expect(latest.source).toBeNull();
    expect(latest.draft).toBe('');
    await act(async () => { await latest.retry(); }); await flush();
    expect(latest.ready).toBe(true);
    expect(latest.draft).toBe('complete fictional post');
  });

  it('preserves edited draft across successful and failed background refetches', async () => {
    fetchDetail.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail('post-a', 'new server text'))
      .mockRejectedValueOnce(new Error('synthetic failure')).mockResolvedValueOnce(detail('post-a', 'retry text'));
    await mount();
    await act(async () => latest.edit('unsaved fictional draft'));
    await act(async () => { await latest.retry(); }); await flush();
    expect(latest.draft).toBe('unsaved fictional draft');
    await act(async () => { await latest.retry(); }); await flush();
    expect(latest.ready).toBe(false);
    expect(latest.draft).toBe('unsaved fictional draft');
    await act(async () => { await latest.retry(); }); await flush();
    expect(latest.ready).toBe(true);
    expect(latest.draft).toBe('unsaved fictional draft');
  });

  it('ignores a late old-route response and never enables a mismatched post', async () => {
    let finishOld!: (value: Detail) => void;
    fetchDetail.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(detail('post-b', 'current post'));
    await mount();
    expect(latest.ready).toBe(false);
    postId = 'post-b'; await rerender();
    expect(latest.source?.post.id).toBe('post-b');
    await act(async () => finishOld(detail('post-a', 'late old post'))); await flush();
    expect(latest.source?.post.id).toBe('post-b');
    expect(latest.draft).toBe('current post');
  });

  it('does not accept cached or late previous-session detail after a signed-session change', async () => {
    let finishNew!: (value: Detail) => void;
    fetchDetail.mockResolvedValueOnce(detail()).mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
    await mount();
    expect(latest.ready).toBe(true);
    mockSession.appSessionToken = 'fictional-session-b'; await rerender();
    expect(latest.ready).toBe(false);
    expect(latest.source).toBeNull();
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain('fictional-session');
    await act(async () => finishNew(detail('post-a', 'new session source'))); await flush();
    expect(latest.ready).toBe(true);
    expect(latest.draft).toBe('new session source');
  });

  it('rejects a successful payload for another post', async () => {
    fetchDetail.mockResolvedValueOnce(detail('post-other'));
    await mount();
    expect(latest.ready).toBe(false);
    expect(latest.source).toBeNull();
  });
});
