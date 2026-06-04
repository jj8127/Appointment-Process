export function normalizeNotificationTargetUrl(url?: string | null): string {
  const trimmed = String(url ?? '').trim();
  if (!trimmed) return '/notifications';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const match = trimmed.match(/^https?:\/\/[^/]+(\/.*)?$/i);
    return normalizeNotificationTargetUrl(match?.[1] ?? '/notifications');
  }

  if (trimmed.startsWith('/dashboard/notifications')) return '/notice';
  if (trimmed.startsWith('/dashboard/chat')) return '/messenger?channel=garam';
  if (trimmed === '/admin-messenger') return '/messenger?channel=garam';
  if (trimmed === '/chat') return '/messenger?channel=garam';
  if (trimmed === '/request-board-messenger') return '/messenger?channel=request-board';
  if (trimmed.startsWith('/board?')) return trimmed.replace('/board?', '/board-detail?');
  if (trimmed.startsWith('/exam/apply2')) return '/exam-apply2';
  if (trimmed.startsWith('/exam/apply')) return '/exam-apply';
  if (trimmed.startsWith('/dashboard')) return '/dashboard';
  return trimmed;
}

const isGenericNotificationTarget = (target: string) =>
  target === '/notifications'
  || target === '/request-board'
  || target === '/request-board/'
  || target === '/';

export function resolveRequestBoardNotificationRoute(input: {
  category?: string | null;
  targetUrl?: string | null;
}) {
  const category = String(input.category ?? '').trim().toLowerCase();

  if (category === 'request_board_message') {
    return '/messenger?channel=request-board';
  }

  const target = normalizeNotificationTargetUrl(input.targetUrl);
  if (!isGenericNotificationTarget(target)) {
    return target;
  }

  if (category === 'request_board_new_request') {
    return '/request-board-requests?filter=pending';
  }
  if (category === 'request_board_accepted' || category === 'request_board_fc-accepted') {
    return '/request-board-requests?filter=in_progress';
  }
  if (
    category === 'request_board_completed'
    || category === 'request_board_rejected'
    || category === 'request_board_fc-rejected'
  ) {
    return '/request-board-requests?filter=completed';
  }
  if (category === 'request_board_cancelled') {
    return '/request-board-requests?filter=cancelled';
  }

  return '/request-board';
}
