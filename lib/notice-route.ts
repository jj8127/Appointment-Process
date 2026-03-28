export const BOARD_NOTICE_ID_PREFIX = 'board_notice:';

export function resolveNoticeRoute(noticeId?: string | null): string | null {
  const trimmedNoticeId = typeof noticeId === 'string' ? noticeId.trim() : '';
  if (!trimmedNoticeId) return null;

  if (trimmedNoticeId.startsWith(BOARD_NOTICE_ID_PREFIX)) {
    const postId = trimmedNoticeId.slice(BOARD_NOTICE_ID_PREFIX.length).trim();
    if (!postId) return '/board';
    return `/board?postId=${encodeURIComponent(postId)}`;
  }

  return `/notice-detail?id=${encodeURIComponent(trimmedNoticeId)}`;
}
