import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('board attachment signed upload retry scope', () => {
  const source = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'supabase',
      'functions',
      'board-attachment-sign',
      'index.ts',
    ),
    'utf8',
  );

  it('allows same-path retry only for a server-generated post-scoped path', () => {
    const actorCheck = source.indexOf('const actorCheck = await requireActor');
    const writableCheck = source.indexOf('if (!isBoardPostWritableByActor');
    const generatedPath = source.indexOf('const requestedStoragePath = file.storagePath?.trim()');
    const canonicalRetryCheck = source.indexOf('!isCanonicalBoardAttachmentPath({');
    const signedUpload = source.indexOf(
      '.createSignedUploadUrl(storagePath, { upsert: true })',
    );

    expect(actorCheck).toBeGreaterThan(-1);
    expect(writableCheck).toBeGreaterThan(actorCheck);
    expect(generatedPath).toBeGreaterThan(writableCheck);
    expect(canonicalRetryCheck).toBeGreaterThan(generatedPath);
    expect(signedUpload).toBeGreaterThan(generatedPath);
    expect(source).toContain("const forbidden = requireRole(actorCheck.actor, ['admin', 'manager']");
    expect(source).toContain('storagePath?: string;');
    expect(source).toContain('?? `board/${postId}/${crypto.randomUUID()}_${sanitized}`');
  });
});
