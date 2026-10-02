import { QueryClient } from '@tanstack/react-query';
import { createCommentRequestTracker } from '../board-comment-request';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('automatic retry and a manual retry reuse the draft operation until confirmed', async () => {
  let sequence = 0;
  const tracker = createCommentRequestTracker(() => `operation-${++sequence}`);
  const draft = { scope: 'synthetic-session', postId: 'post', content: 'comment' };
  const requestId = tracker.requestId(draft);
  const writes = new Map<string, string>();
  let calls = 0;
  const client = new QueryClient();
  const mutation = client.getMutationCache().build(client, {
    retry: 1, retryDelay: 0,
    mutationFn: async (id: string) => {
      if (!writes.has(id)) writes.set(id, 'comment-result');
      if (++calls === 1) throw new Error('response lost after commit');
      return writes.get(id);
    },
  });
  expect(await mutation.execute(requestId)).toBe('comment-result');
  expect(writes.size).toBe(1);
  expect(tracker.requestId(draft)).toBe(requestId);
  tracker.complete(requestId);
  expect(tracker.requestId(draft)).not.toBe(requestId);
  client.clear();
});

test('different drafts/sessions get fresh IDs and a late success cannot clear a newer operation', () => {
  let sequence = 0;
  const tracker = createCommentRequestTracker(() => `operation-${++sequence}`);
  const draft = { scope: 'A', postId: 'post', content: 'same' };
  const old = tracker.requestId(draft);
  const newer = tracker.requestId({ ...draft, scope: 'B' });
  tracker.complete(old);
  expect(tracker.requestId({ ...draft, scope: 'B' })).toBe(newer);
  expect(tracker.requestId({ ...draft, parentId: 'reply' })).not.toBe(newer);
});

test('web and mobile share the same request lifetime policy', () => {
  expect(readFileSync(join(process.cwd(), 'web/src/lib/board-comment-request.ts'), 'utf8'))
    .toBe(readFileSync(join(process.cwd(), 'lib/board-comment-request.ts'), 'utf8'));
});
