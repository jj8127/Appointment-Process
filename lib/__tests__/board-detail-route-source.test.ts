import { readFileSync } from 'fs';
import { join } from 'path';

describe('board-detail route guard', () => {
  it('redirects legacy board-detail route entries to the board modal route', () => {
    const source = readFileSync(join(process.cwd(), 'app/board-detail.tsx'), 'utf8');

    expect(source).toContain("router.replace({ pathname: '/board'");
    expect(source).toContain('params: { postId: postIdValue }');
    expect(source).not.toContain("queryFn: () => fetchBoardDetail(actor!, postIdValue)");
  });
});
