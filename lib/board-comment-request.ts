export type CommentDraft = { scope: string | number; postId: string; parentId?: string | null; content: string };

// Keep the same operation across response loss and a user's retry of the draft.
export function createCommentRequestTracker(createId: () => string) {
  let pending: { key: string; requestId: string } | null = null;
  return {
    requestId(draft: CommentDraft) {
      const key = JSON.stringify([draft.scope, draft.postId, draft.parentId ?? null, draft.content.trim()]);
      if (!pending || pending.key !== key) pending = { key, requestId: createId() };
      return pending.requestId;
    },
    complete(requestId: string) {
      if (pending?.requestId === requestId) pending = null;
    },
  };
}
