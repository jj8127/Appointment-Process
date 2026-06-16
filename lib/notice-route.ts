export const BOARD_NOTICE_ID_PREFIX = 'board_notice:';

const normalizeNoticeId = (noticeId?: string | null): string => {
  const trimmedNoticeId = typeof noticeId === 'string' ? noticeId.trim() : '';
  return trimmedNoticeId;
};

const extractBoardPostId = (noticeId: string): string => {
  return noticeId.slice(BOARD_NOTICE_ID_PREFIX.length).trim();
};

export function resolveNoticeRoute(noticeId?: string | null): string | null {
  const trimmedNoticeId = normalizeNoticeId(noticeId);
  if (!trimmedNoticeId) return null;

  if (trimmedNoticeId.startsWith(BOARD_NOTICE_ID_PREFIX)) {
    const postId = extractBoardPostId(trimmedNoticeId);
    if (!postId) return '/board';
    return `/board?postId=${encodeURIComponent(postId)}`;
  }

  return `/notice-detail?id=${encodeURIComponent(trimmedNoticeId)}`;
}

export function resolveHomeLatestNoticeRoute(noticeId?: string | null): string | null {
  const trimmedNoticeId = normalizeNoticeId(noticeId);
  if (!trimmedNoticeId) return null;

  if (trimmedNoticeId.startsWith(BOARD_NOTICE_ID_PREFIX)) {
    const postId = extractBoardPostId(trimmedNoticeId);
    if (!postId) return '/board';
    return `/board?postId=${encodeURIComponent(postId)}`;
  }

  return resolveNoticeRoute(trimmedNoticeId);
}
