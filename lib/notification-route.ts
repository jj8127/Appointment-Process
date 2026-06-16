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
  if (trimmed === '/group-chat') return '/group-chat';
  if (trimmed === '/request-board-messenger') return '/messenger?channel=request-board';
  if (trimmed.startsWith('/board?')) return trimmed;
  if (trimmed.startsWith('/board-detail?')) return trimmed.replace('/board-detail?', '/board?');
  if (trimmed.startsWith('/dashboard/board?')) {
    return trimmed.replace('/dashboard/board?', '/board?');
  }
  if (trimmed === '/dashboard/board' || trimmed === '/dashboard/board/') return '/board';
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
  if (category === 'group_chat_message') {
    return '/group-chat';
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

function lowerString(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function isHanwhaWorkflowNotification(input: { title?: unknown; body?: unknown }) {
  const title = lowerString(input.title);
  const body = lowerString(input.body);

  return (
    title.includes('다위촉 승인') ||
    title.includes('다위촉 반려') ||
    title.includes('다위촉 url 승인') ||
    title.includes('다위촉 url 반려') ||
    title.includes('다위촉url') ||
    title.includes('다위촉 서류') ||
    body.includes('다위촉이 승인') ||
    body.includes('다위촉이 반려') ||
    body.includes('다위촉 url이 승인') ||
    body.includes('다위촉 url이 반려') ||
    body.includes('다위촉url') ||
    body.includes('다위촉 서류') ||
    body.includes('승인 pdf')
  );
}

export function resolvePushNotificationRoute(content?: {
  title?: unknown;
  body?: unknown;
  data?: Record<string, unknown> | null;
} | null): string {
  const data = content?.data ?? {};
  const rawUrl = typeof data.url === 'string' ? data.url : undefined;
  const category =
    typeof data.type === 'string'
      ? data.type
      : typeof data.category === 'string'
        ? data.category
        : undefined;

  if (isHanwhaWorkflowNotification({ title: content?.title, body: content?.body })) {
    return '/hanwha-commission';
  }

  const normalizedCategory = String(category ?? '').trim().toLowerCase();
  if (normalizedCategory.startsWith('request_board_') || normalizedCategory === 'group_chat_message') {
    return resolveRequestBoardNotificationRoute({
      category: normalizedCategory,
      targetUrl: rawUrl,
    });
  }

  return normalizeNotificationTargetUrl(rawUrl);
}
