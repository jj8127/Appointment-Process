import {
  BoardSessionError,
  invokeBoardWithDeps,
  invokeBoardWriteWithDeps,
  retryBoardNotificationWithDeps,
  type BoardActor,
} from '../board-api';

jest.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

jest.mock('../request-board-api', () => ({
  getStoredAppSessionToken: jest.fn(),
}));

const actor: BoardActor = {
  role: 'fc',
  residentId: '01011112222',
  displayName: 'Test FC',
};
const postId = '11111111-1111-4111-8111-111111111111';
const commentId = '22222222-2222-4222-8222-222222222222';
const attachmentId = '33333333-3333-4333-8333-333333333333';
const categoryId = '44444444-4444-4444-8444-444444444444';
const notificationId = '55555555-5555-4555-8555-555555555555';
const eventKey = `board-post:${'a'.repeat(64)}`;
const storagePath = `board/${postId}/one.png`;

const exactMutationCases = [
  {
    name: 'board-delete',
    body: { actor, postId },
    data: { postId, cleanupPending: false },
  },
  {
    name: 'board-pin',
    body: { actor, postId, isPinned: true },
    data: {
      postId,
      isPinned: true,
      pinnedAt: '2026-10-13T01:02:03.000Z',
      pinnedByResidentId: actor.residentId,
    },
  },
  {
    name: 'board-comment-update',
    body: { actor, commentId, content: '  수정 본문  ' },
    data: {
      commentId,
      content: '수정 본문',
      editedAt: '2026-10-13T01:02:03.000Z',
    },
  },
  {
    name: 'board-comment-delete',
    body: { actor, commentId },
    data: { commentId, postId },
  },
  {
    name: 'board-reaction-toggle',
    body: { actor, postId, reactionType: 'heart' },
    data: { postId, residentId: actor.residentId, myReaction: 'heart' },
  },
  {
    name: 'board-comment-like-toggle',
    body: { actor, commentId },
    data: { commentId, residentId: actor.residentId, liked: true, likeCount: 1 },
  },
  {
    name: 'board-attachment-finalize',
    body: {
      actor,
      postId,
      files: [{ storagePath, fileName: 'one.png', fileSize: 1, fileType: 'image' }],
    },
    data: { postId, attachments: [{ id: attachmentId, storagePath }] },
  },
  {
    name: 'board-attachment-delete',
    body: { actor, postId, attachmentIds: [attachmentId] },
    data: {
      postId,
      deletedAttachments: [{ id: attachmentId, storagePath }],
      cleanupPending: false,
    },
  },
  {
    name: 'board-category-update',
    body: {
      actor,
      id: categoryId,
      name: '공지',
      slug: 'notice',
      sortOrder: 1,
      isActive: true,
    },
    data: {
      id: categoryId,
      name: '공지',
      slug: 'notice',
      sortOrder: 1,
      isActive: true,
    },
  },
] as const;

describe('mobile board caller authentication', () => {
  it('fails closed before invoking the Edge Function when no app session exists', async () => {
    const invoke = jest.fn();

    await expect(invokeBoardWithDeps('board-list', { actor }, {
      getStoredAppSessionToken: async () => null,
      invoke,
    })).rejects.toEqual(expect.objectContaining({
      name: 'BoardSessionError',
      code: 'missing_app_session',
      status: 401,
    }));

    expect(invoke).not.toHaveBeenCalled();
  });

  it('attaches the stored app session header while preserving the legacy body actor', async () => {
    const invoke = jest.fn(async () => ({
      data: { ok: true, data: { items: [] } },
      error: null,
    }));

    const result = await invokeBoardWithDeps<{ items: unknown[] }>('board-list', { actor, limit: 20 }, {
      getStoredAppSessionToken: async () => '  signed-app-session  ',
      invoke,
    });

    expect(result).toEqual({ items: [] });
    expect(invoke).toHaveBeenCalledWith('board-list', {
      body: { actor, limit: 20 },
      headers: {
        'x-app-session-token': 'signed-app-session',
      },
    });
  });

  it('uses a typed session error for missing mobile board authentication', () => {
    const error = new BoardSessionError();
    expect(error).toMatchObject({
      name: 'BoardSessionError',
      code: 'missing_app_session',
      status: 401,
    });
  });

  it.each([
    ['board-list', {}, { items: [{ attachments: [{ signedUrl: 'javascript:alert(1)' }] }] }],
    ['board-detail', { postId: 'expected-post' }, {
      post: { id: 'different-post' },
      attachments: [],
    }],
    ['board-detail', { postId: 'expected-post' }, {
      post: { id: 'expected-post' },
      attachments: [{ signedUrl: 'https://user:secret@storage.example.test/file' }],
    }],
    ['board-attachment-sign', { files: [{ storagePath: 'board/post/file.pdf' }] }, [{
      storagePath: 'board/post/file.pdf',
      signedUrl: 'http://storage.example.test/upload',
    }]],
  ] as const)('rejects an unsafe or request-mismatched %s response', async (name, body, data) => {
    await expect(invokeBoardWithDeps(name, body, {
      getStoredAppSessionToken: async () => 'signed-app-session',
      invoke: async () => ({ data: { ok: true, data }, error: null }),
    })).rejects.toMatchObject({
      name: 'BoardApiError',
      code: 'invalid_response',
      status: 502,
    });
  });

  it('accepts request-bound credential-free HTTPS attachment responses', async () => {
    await expect(invokeBoardWithDeps('board-attachment-sign', {
      files: [{ storagePath: 'board/post/file.pdf' }],
    }, {
      getStoredAppSessionToken: async () => 'signed-app-session',
      invoke: async () => ({
        data: {
          ok: true,
          data: [{
            storagePath: 'board/post/file.pdf',
            signedUrl: 'https://storage.example.test/upload?token=opaque',
          }],
        },
        error: null,
      }),
    })).resolves.toEqual([{
      storagePath: 'board/post/file.pdf',
      signedUrl: 'https://storage.example.test/upload?token=opaque',
    }]);
  });

  it.each(exactMutationCases)(
    'accepts the exact request-bound $name receipt',
    async ({ name, body, data }) => {
      await expect(invokeBoardWithDeps(name, body, {
        getStoredAppSessionToken: async () => 'signed-app-session',
        invoke: async () => ({ data: { ok: true, data }, error: null }),
      })).resolves.toEqual(data);
    },
  );

  it.each(exactMutationCases)(
    'rejects an empty successful $name receipt',
    async ({ name, body }) => {
      await expect(invokeBoardWithDeps(name, body, {
        getStoredAppSessionToken: async () => 'signed-app-session',
        invoke: async () => ({ data: { ok: true, data: null }, error: null }),
      })).rejects.toMatchObject({
        name: 'BoardApiError',
        code: 'invalid_response',
        status: 502,
      });
    },
  );

  it.each([
    [
      'board-categories-list',
      { actor },
      [
        { id: categoryId, name: '공지', slug: 'notice', sortOrder: 1, isActive: true },
        {
          id: '44444444-4444-4444-8444-444444444445',
          name: '교육 일정',
          slug: 'education',
          sortOrder: 2,
          isActive: true,
        },
        {
          id: '44444444-4444-4444-8444-444444444446',
          name: '일반',
          slug: 'general',
          sortOrder: 3,
          isActive: true,
        },
        {
          id: '44444444-4444-4444-8444-444444444447',
          name: '상품추천',
          slug: 'garam-pick',
          sortOrder: 4,
          isActive: true,
        },
        {
          id: '44444444-4444-4444-8444-444444444448',
          name: '시책',
          slug: 'policy',
          sortOrder: 5,
          isActive: true,
        },
      ],
    ],
    ['board-comment-create', { actor, postId, content: '댓글' }, { id: commentId }],
    ['board-category-create', { actor, name: '공지', slug: 'notice' }, { id: categoryId }],
  ] as const)('validates the complete %s response shape', async (name, body, data) => {
    const deps = {
      getStoredAppSessionToken: async () => 'signed-app-session',
      invoke: async () => ({ data: { ok: true, data }, error: null }),
    };
    await expect(invokeBoardWithDeps(name, body, deps)).resolves.toEqual(data);
    await expect(invokeBoardWithDeps(name, body, {
      ...deps,
      invoke: async () => ({ data: { ok: true, data: null }, error: null }),
    })).rejects.toMatchObject({ code: 'invalid_response', status: 502 });
  });

  it('requires saved=true for board create/update responses', async () => {
    const deps = {
      getStoredAppSessionToken: async () => 'signed-app-session',
      invoke: async () => ({ data: { ok: true, data: null }, error: null }),
    };
    await expect(invokeBoardWriteWithDeps('board-update', { actor, postId }, deps))
      .rejects.toMatchObject({ code: 'invalid_response', status: 502 });
    await expect(invokeBoardWriteWithDeps('board-create', { actor }, deps))
      .rejects.toMatchObject({ code: 'invalid_response', status: 502 });

    await expect(invokeBoardWriteWithDeps('board-update', { actor, postId }, {
      ...deps,
      invoke: async () => ({
        data: { ok: true, saved: true, data: null },
        error: null,
      }),
    })).resolves.toMatchObject({ data: null, saved: true });
    await expect(invokeBoardWriteWithDeps('board-create', { actor }, {
      ...deps,
      invoke: async () => ({
        data: { ok: true, saved: true, data: { id: postId } },
        error: null,
      }),
    })).resolves.toMatchObject({ data: { id: postId }, saved: true });
  });

  it('validates successful and recoverable notification retry receipts against the request', async () => {
    const request = { postId, eventKey };
    const deps = {
      getStoredAppSessionToken: async () => 'signed-app-session',
      invoke: async () => ({
        data: {
          ok: true,
          delivery: {
            notificationStored: true,
            pushStatus: 'accepted',
            retryable: false,
            notificationIds: [notificationId],
          },
          notificationRetry: null,
          notificationWarning: null,
        },
        error: null,
      }),
    };
    await expect(retryBoardNotificationWithDeps(actor, request, deps)).resolves.toMatchObject({
      delivery: { notificationStored: true, retryable: false },
      notificationRetry: null,
    });
    await expect(retryBoardNotificationWithDeps(actor, request, {
      ...deps,
      invoke: async () => ({ data: { ok: true, data: null }, error: null }),
    })).rejects.toMatchObject({ code: 'invalid_response', status: 502 });
    await expect(retryBoardNotificationWithDeps(actor, request, {
      ...deps,
      invoke: async () => ({
        data: {
          ok: false,
          delivery: {
            notificationStored: false,
            pushStatus: 'not_attempted',
            retryable: true,
          },
          notificationRetry: {
            postId: '66666666-6666-4666-8666-666666666666',
            eventKey,
          },
        },
        error: null,
      }),
    })).rejects.toMatchObject({ code: 'board_upstream_failed', status: 502 });
  });
});
