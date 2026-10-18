import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const source = readFileSync(
  join(root, 'supabase', 'functions', 'fc-notify', 'index.ts'),
  'utf8',
);

describe('exact notice lookup boundary', () => {
  it('uses stable source and merge ordering for identical notice timestamps', () => {
    const legacyStart = source.indexOf('async function fetchNoticesWithOptionalAttachments(');
    const legacyEnd = source.indexOf('async function fetchNoticeByIdWithOptionalAttachments(', legacyStart);
    const boardStart = source.indexOf('async function fetchBoardNoticesWithAttachments(');
    const boardEnd = source.indexOf('async function fetchUnifiedNoticePage(', boardStart);
    const stableOrder = /\.order\('created_at', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: false \}\)/;

    expect(source.slice(legacyStart, legacyEnd)).toMatch(stableOrder);
    expect(source.slice(boardStart, boardEnd)).toMatch(stableOrder);
    expect(source).toContain(
      'const createdAtDifference = Date.parse(right.created_at) - Date.parse(left.created_at);',
    );
    expect(source).toContain('return left.id < right.id ? 1 : -1;');
  });

  it('pages every board attachment and fails the notice read if any signature is missing', () => {
    const helperStart = source.indexOf('async function fetchBoardNoticesWithAttachments(');
    const helperEnd = source.indexOf('async function fetchUnifiedNotices(', helperStart);
    const helper = source.slice(helperStart, helperEnd);

    expect(helper).toContain('for (const postIdChunk of chunkSupabaseFilterValues(postIds))');
    expect(helper).toContain('collectSupabaseRows<BoardAttachmentRow>({');
    expect(helper).toContain('isRow: isBoardAttachmentQueryRow');
    expect(helper).toContain('rowKey: (row) => row.id');
    expect(helper).toContain(".order('post_id', { ascending: true })");
    expect(helper).toContain(".order('id', { ascending: true })");
    expect(helper).toContain('.range(from, to)');
    expect(helper).toContain("throw new Error('board_notice_attachment_signing_failed')");
    expect(helper).not.toContain('if (!signedUrl) return;');
  });

  it('keeps notice_get viewer-bound and queries the requested UUID directly', () => {
    const viewerActionsStart = source.indexOf('const VIEWER_BOUND_ACTIONS');
    const viewerActionsEnd = source.indexOf(']);', viewerActionsStart);
    expect(source.slice(viewerActionsStart, viewerActionsEnd)).toContain(
      "'notice_get'",
    );
    expect(source).toContain("if (body.type === 'notice_get')");
    expect(source).toContain('fetchNoticeByIdWithOptionalAttachments(body.notice_id)');
    expect(source).toContain(".eq('id', noticeId)");
    expect(source).toContain("return err('Notice not found', 404)");
  });

  it('returns the stored notice fields and canonical target without list scanning', () => {
    const helperStart = source.indexOf(
      'async function fetchNoticeByIdWithOptionalAttachments(',
    );
    const helperEnd = source.indexOf(
      'function isMissingTableError',
      helperStart,
    );
    const helper = source.slice(helperStart, helperEnd);

    expect(helper).toContain(
      ".select('id,title,body,category,created_at,images,files')",
    );
    expect(helper).toContain(
      "target: { version: 1, kind: 'notice', noticeId: row.id }",
    );
    expect(helper).toContain('row !== null && !isNoticeQueryRow(row, true)');
    expect(helper).toContain('row !== null && !isNoticeQueryRow(row, false)');
    expect(helper).toContain('notice_query_contract_invalid');
    expect(helper).not.toContain('.limit(');
    expect(source).toContain('authorized: true');
  });
});
