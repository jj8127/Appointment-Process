import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'supabase', 'functions', 'board-list', 'index.ts'),
  'utf8',
);

describe('board-list automation source boundary', () => {
  it('branches automation before the full application list path', () => {
    const automationBranch = source.indexOf("actorCheck.authMode === 'automation'");
    const fullApplicationSelect = source.indexOf("const baseSelect =");

    expect(automationBranch).toBeGreaterThanOrEqual(0);
    expect(fullApplicationSelect).toBeGreaterThan(automationBranch);
    expect(source).toContain('validateAutomationBoardListRequest(body)');
    expect(source).toContain(".select('id,slug,is_active')");
    expect(source).toContain('isCanonicalGeneralBoardCategory');
  });

  it('uses a fixed minimal recent-post query for automation', () => {
    expect(source).toContain('.select(AUTOMATION_BOARD_LIST_SELECT)');
    expect(source).toContain(".order('created_at', { ascending: false })");
    expect(source).toContain('.limit(AUTOMATION_BOARD_LIST_LIMIT)');
    expect(source).toContain("code: 'automation_forbidden'");
  });

  it('keeps the full board response path for app sessions', () => {
    expect(source).toContain(
      "'id,category_id,title,content,author_name,author_role,author_resident_id,created_at,updated_at,edited_at,is_pinned,pinned_at,comment_count,reaction_count,attachment_count,view_count,search_vector'",
    );
    expect(source).toContain(".from('board_post_reactions')");
    expect(source).toContain(".from('board_attachments')");
    expect(source).toContain('createSignedUrlWithRetry');
  });
});
