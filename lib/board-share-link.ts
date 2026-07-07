const DEFAULT_GARAMIN_SHARE_BASE_URL = 'https://garam-invite.vercel.app';

export type BoardPostShareInput = {
  postId?: string | null;
  title?: string | null;
  shareBaseUrl?: string | null;
};

export function normalizeBoardPostShareId(postId?: string | null): string {
  return String(postId ?? '').trim();
}

function normalizeShareBaseUrl(value?: string | null): string {
  const trimmed = String(value ?? '').trim();
  return (trimmed || DEFAULT_GARAMIN_SHARE_BASE_URL).replace(/\/+$/, '');
}

export function buildBoardPostShareUrl(
  postId: string,
  shareBaseUrl?: string | null,
): string {
  const normalizedPostId = normalizeBoardPostShareId(postId);
  if (!normalizedPostId) {
    throw new Error('postId is required to share a board post.');
  }

  return `${normalizeShareBaseUrl(shareBaseUrl)}/board?postId=${encodeURIComponent(normalizedPostId)}`;
}

export function buildBoardPostShareContent(
  input: BoardPostShareInput,
) {
  const url = buildBoardPostShareUrl(normalizeBoardPostShareId(input.postId), input.shareBaseUrl);
  const title = String(input.title ?? '').trim() || '가람in 게시글';

  return {
    title,
    url,
    message: [
      '가람in 게시글을 확인하세요.',
      title,
      url,
    ].join('\n'),
  };
}
