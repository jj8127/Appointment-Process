import {
  buildVerifiedBoardActor,
  isBoardPostWritableByActor,
  isCanonicalBoardAttachmentPath,
  isBoardAutomationActionAllowed,
  verifyBoardAutomationToken,
} from '../../supabase/functions/_shared/board-actor-policy';

describe('board Edge actor policy', () => {
  const verifiedAdmin = {
    role: 'admin' as const,
    residentId: '01011112222',
    displayName: 'Canonical Admin',
  };

  it('builds the board actor from the verified app session and database record', () => {
    expect(buildVerifiedBoardActor(verifiedAdmin)).toEqual({
      ok: true,
      actor: verifiedAdmin,
    });
  });

  it('rejects a client role escalation even when the forged account exists', () => {
    expect(buildVerifiedBoardActor(
      {
        role: 'fc',
        residentId: '01099998888',
        displayName: 'Canonical FC',
      },
      {
        role: 'admin',
        residentId: '01011112222',
        displayName: 'Forged Admin',
      },
    )).toEqual({
      ok: false,
      status: 403,
      code: 'actor_mismatch',
      message: 'Board actor does not match the signed session',
    });
  });

  it('rejects a client identity swap within the same role', () => {
    expect(buildVerifiedBoardActor(verifiedAdmin, {
      role: 'admin',
      residentId: '01099998888',
      displayName: 'Other Admin',
    })).toMatchObject({ ok: false, status: 403, code: 'actor_mismatch' });
  });

  it('ignores stale or forged display text and keeps the canonical database name', () => {
    expect(buildVerifiedBoardActor(verifiedAdmin, {
      role: 'admin',
      residentId: '010-1111-2222',
      displayName: 'CLIENT SUPPLIED NAME',
    })).toEqual({
      ok: true,
      actor: verifiedAdmin,
    });
  });

  it('limits managers to their own manager-authored posts while admins retain global access', () => {
    const ownManagerPost = {
      authorRole: 'manager',
      authorResidentId: '01011112222',
    };
    expect(isBoardPostWritableByActor(verifiedAdmin, ownManagerPost)).toBe(true);
    expect(isBoardPostWritableByActor(
      { role: 'manager', residentId: '01011112222', displayName: 'Manager' },
      ownManagerPost,
    )).toBe(true);
    expect(isBoardPostWritableByActor(
      { role: 'manager', residentId: '01099998888', displayName: 'Other Manager' },
      ownManagerPost,
    )).toBe(false);
    expect(isBoardPostWritableByActor(
      { role: 'fc', residentId: '01011112222', displayName: 'FC' },
      ownManagerPost,
    )).toBe(false);
  });

  it('accepts only canonical attachment paths bound to the same post and sanitized file name', () => {
    const input = {
      postId: 'post-1',
      storagePath: 'board/post-1/123e4567-e89b-12d3-a456-426614174000_report.pdf',
      fileName: 'report.pdf',
    };
    expect(isCanonicalBoardAttachmentPath(input)).toBe(true);
    expect(isCanonicalBoardAttachmentPath({ ...input, postId: 'post-2' })).toBe(false);
    expect(isCanonicalBoardAttachmentPath({
      ...input,
      storagePath: 'board/post-1/../../other/secret.pdf',
    })).toBe(false);
    expect(isCanonicalBoardAttachmentPath({ ...input, fileName: 'different.pdf' })).toBe(false);
  });

  it('uses an exact automation token and a minimal read/create action allowlist', () => {
    expect(verifyBoardAutomationToken('automation-secret', 'automation-secret')).toBe(true);
    expect(verifyBoardAutomationToken('automation-secret-x', 'automation-secret')).toBe(false);
    expect(verifyBoardAutomationToken('', '')).toBe(false);

    expect(isBoardAutomationActionAllowed('board-categories-list')).toBe(true);
    expect(isBoardAutomationActionAllowed('board-list')).toBe(true);
    expect(isBoardAutomationActionAllowed('board-create')).toBe(true);
    expect(isBoardAutomationActionAllowed('board-category-create')).toBe(false);
    expect(isBoardAutomationActionAllowed('board-update')).toBe(false);
    expect(isBoardAutomationActionAllowed('board-delete')).toBe(false);
  });
});
