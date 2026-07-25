import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const source = readFileSync(
  join(root, 'supabase', 'functions', 'fc-notify', 'index.ts'),
  'utf8',
);

describe('exact notice lookup boundary', () => {
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
    expect(helper).not.toContain('.limit(');
    expect(source).toContain('authorized: true');
  });
});
