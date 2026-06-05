import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('fc-notify inbox unread count contract', () => {
  const source = readFileSync(join(process.cwd(), 'supabase/functions/fc-notify/index.ts'), 'utf8');

  it('counts the same visible inbox sources requested by the mobile badge', () => {
    expect(source).toContain('include_notices?: boolean');
    expect(source).toContain('only_request_board_categories?: boolean');
    expect(source).toContain('body.include_notices === true');
    expect(source).toContain('body.only_request_board_categories === true');
    expect(source).toContain("countQuery = countQuery.ilike('category', `${REQUEST_BOARD_CATEGORY_PREFIX}%`)");
    expect(source).toContain('const notices = await fetchUnifiedNotices(200)');
    expect(source).toContain('primaryCount ?? 0) + requestBoardFcCount + noticeCount');
  });
});
