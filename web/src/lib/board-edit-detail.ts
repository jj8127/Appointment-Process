type EditableDetail = {
  post: { id: string; title: string; content: string; categoryId: string };
};

/** Hydrate a composer only once, after this edit's complete detail read succeeds. */
export function canHydrateBoardEdit({
  postId, loadedPostId, detail, isSuccess, isFetching,
}: {
  postId: string | null;
  loadedPostId: string | null;
  detail: EditableDetail | null | undefined;
  isSuccess: boolean;
  isFetching: boolean;
}): boolean {
  return Boolean(postId && loadedPostId !== postId && isSuccess && !isFetching
    && detail?.post.id === postId && typeof detail.post.content === 'string');
}

export function buildBoardEditPayload({
  postId, loadedPostId, categoryId, draft,
}: {
  postId: string | null;
  loadedPostId: string | null;
  categoryId: string | null;
  draft: { title: string; content: string };
}) {
  if (!postId || loadedPostId !== postId) throw new Error('게시글 원문을 먼저 불러와주세요.');
  if (!categoryId) throw new Error('카테고리를 선택해주세요.');
  return { postId, categoryId, title: draft.title.trim(), content: draft.content.trim() };
}
