import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

function extractBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('board comment reply flow', () => {
  const mobileBoardPaths = [
    'app/board.tsx',
    'app/admin-board-manage.tsx',
  ];

  it.each(mobileBoardPaths)(
    '%s preserves the reply target until the mutation succeeds',
    (path) => {
      const source = readRepoFile(path);
      const mutation = extractBetween(
        source,
        '// Add comment mutation',
        'const toggleCommentLikeMutation',
      );
      const submit = extractBetween(
        source,
        'const handleAddComment =',
        'const openCommentActions',
      );

      expect(mutation).toContain('onSuccess: (_data, variables)');
      expect(mutation).toContain('setReplyTarget((current)');
      expect(mutation).toContain('variables.threadRootId');
      expect(submit).toContain('threadRootId: replyTarget?.threadRootId');
      expect(submit).not.toContain('setReplyTarget(null)');
    },
  );

  it.each(mobileBoardPaths)(
    '%s keeps the root thread identity while rendering nested replies',
    (path) => {
      const source = readRepoFile(path);
      const render = extractBetween(
        source,
        'const renderCommentThread =',
        'useEffect(() =>',
      );

      expect(render).toContain('threadRootId = comment.id');
      expect(render).toContain('threadRootId,');
      expect(render).toContain('renderCommentThread(reply, depth + 1, threadRootId)');
    },
  );

  it('keeps mobile admin and admin web threads open after a successful reply', () => {
    const mobileAdmin = readRepoFile('app/admin-board-manage.tsx');
    const webAdmin = readRepoFile('web/src/app/dashboard/board/page.tsx');

    for (const source of [mobileAdmin, webAdmin]) {
      expect(source).toContain('const [isThreadInitialized, setIsThreadInitialized] = useState(false)');
      expect(source).toContain('current.filter((commentId) => commentId !== variables.threadRootId)');
      expect(source).toContain('setIsThreadInitialized(true)');
    }
  });

  it('persists the selected parent id in the Edge Function insert', () => {
    const edgeFunction = readRepoFile('supabase/functions/board-comment-create/index.ts');

    expect(edgeFunction).toContain(".eq('id', parentId)");
    expect(edgeFunction).toContain('parent.post_id !== postId');
    expect(edgeFunction).toContain('parent_id: parentId');
  });
});
