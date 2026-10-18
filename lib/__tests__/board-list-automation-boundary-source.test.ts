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
    expect(source).toMatch(
      /\.select\(AUTOMATION_BOARD_LIST_SELECT\)[\s\S]*?\.order\('created_at', \{ ascending: false \}\)[\s\S]*?\.order\('id', \{ ascending: false \}\)[\s\S]*?\.limit\(AUTOMATION_BOARD_LIST_LIMIT\)/,
    );
    expect(source).toContain('.limit(AUTOMATION_BOARD_LIST_LIMIT)');
    expect(source).toContain("code: 'automation_forbidden'");
  });

  it('keeps the full board response path for app sessions', () => {
    expect(source).toContain(
      "'id,category_id,title,content,author_name,author_role,author_resident_id,created_at,updated_at,edited_at,is_pinned,pinned_at,comment_count,reaction_count,attachment_count,view_count'",
    );
    expect(source).toContain(".from('board_post_reactions')");
    expect(source).toContain(".from('board_attachments')");
    expect(source).toContain('createSignedUrlWithRetry');
    expect(source).toMatch(
      /collectGroupChatDataApiPages\(async \(from, to\) => \{[\s\S]*?\.eq\('is_pinned', true\)[\s\S]*?\.order\('pinned_at', \{ ascending: false \}\)[\s\S]*?\.order\('created_at', \{ ascending: false \}\)[\s\S]*?\.order\('id', \{ ascending: false \}\)[\s\S]*?\.range\(from, to\)/,
    );
    expect(source).not.toContain(".eq('is_pinned', true)\n    .limit(10)");
  });

  it('batches and fully pages relation reads with deterministic row order', () => {
    expect(source.match(/collectGroupChatDataApiBatches\(postIds/g)).toHaveLength(2);
    expect(source.match(/collectGroupChatDataApiPages\(async \(from, to\)/g)).toHaveLength(3);
    expect(source.match(/\.range\(from, to\)/g)).toHaveLength(3);
    expect(source).toMatch(
      /board_post_reactions'[\s\S]*?\.order\('post_id',[\s\S]*?\.order\('resident_id',[\s\S]*?\.range\(from, to\)/,
    );
    expect(source).toMatch(
      /board_attachments'[\s\S]*?\.order\('post_id',[\s\S]*?\.order\('sort_order',[\s\S]*?\.order\('created_at',[\s\S]*?\.order\('id',[\s\S]*?\.range\(from, to\)/,
    );
    expect(source).toContain('item.stats.reactionCount !== returnedReactionCount');
    expect(source).toContain('item.stats.attachmentCount !== (attachmentMap.get(postId)?.length ?? 0)');
  });
});
