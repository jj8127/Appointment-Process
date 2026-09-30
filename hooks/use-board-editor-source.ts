import { useEffect, useState } from 'react';

type PostDetail = { post: { id: string } };

/** Capture one complete source per editor identity. Refetches must not reset a draft. */
export function useBoardEditorSource<T extends PostDetail>(
  ownerKey: string,
  postId: string | null,
  detail: T | null | undefined,
  isError: boolean,
) {
  const [loaded, setLoaded] = useState<{ ownerKey: string; postId: string; detail: T } | null>(null);
  const source = loaded?.ownerKey === ownerKey && loaded.postId === postId ? loaded.detail : null;

  useEffect(() => {
    if (!postId || source || isError || detail?.post.id !== postId) return;
    setLoaded({ ownerKey, postId, detail });
  }, [detail, isError, ownerKey, postId, source]);

  return { source, ready: !postId || (!!source && !isError && detail?.post.id === postId) };
}
