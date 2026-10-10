export type CommentDraft = { scope: string | number; postId: string; parentId?: string | null; content: string };

/** Keep one operation across a lost response and an unchanged draft retry. */
export function createCreationRequestTracker(createId: () => string = () => crypto.randomUUID()) {
  let pending: { fingerprint: string; requestId: string } | null = null;
  return {
    requestId(fingerprint: string) {
      if (!pending || pending.fingerprint !== fingerprint) {
        pending = { fingerprint, requestId: createId() };
      }
      return pending.requestId;
    },
    complete(requestId?: string) {
      if (requestId === undefined || pending?.requestId === requestId) pending = null;
    },
  };
}

export function createCommentRequestTracker(createId: () => string) {
  const tracker = createCreationRequestTracker(createId);
  return {
    complete: (requestId: string) => tracker.complete(requestId),
    requestId(draft: CommentDraft) {
      return tracker.requestId(JSON.stringify([draft.scope, draft.postId, draft.parentId ?? null, draft.content.trim()]));
    },
  };
}
