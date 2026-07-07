import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const files = [
  'supabase/functions/board-create/index.ts',
  'supabase/functions/board-update/index.ts',
  'supabase/functions/board-comment-create/index.ts',
  'supabase/functions/board-comment-like-toggle/index.ts',
];

describe('board notification mobile targets', () => {
  it('uses the board modal entry route for every board post notification target', () => {
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');

      expect(source).toContain('/board?postId=');
      expect(source).not.toContain('/board-detail?postId=');
    }
  });
});
