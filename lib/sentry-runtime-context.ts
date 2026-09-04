// Only route file names are diagnostic context. Never send resolved paths or
// search parameters, which can contain account IDs, referral codes, or tokens.
export const SENTRY_SCREEN_NAMES = new Set([
  '/',
  '/admin-board', '/admin-board-manage', '/admin-messenger', '/admin-notice',
  '/apply-gate', '/appointment', '/board', '/board-detail', '/chat', '/consent',
  '/dashboard', '/docs-upload', '/exam-apply', '/exam-apply2', '/exam-manage',
  '/exam-manage2', '/exam-register', '/exam-register2', '/exams/life',
  '/exams/nonlife', '/fc/new', '/group-chat',
  '/hanwha-commission', '/home-lite', '/identity', '/login', '/messenger',
  '/notice', '/notice-detail', '/notifications', '/referral', '/referral-tree',
  '/request-board', '/request-board-create', '/request-board-fc-codes',
  '/request-board-messenger', '/request-board-requests', '/request-board-review',
  '/reset-password', '/settings', '/signup', '/signup-password', '/signup-verify',
]);

export function getSentryScreenName(segments: readonly string[]): string {
  const route = segments.length === 0 || (segments.length === 1 && segments[0] === 'index')
    ? '/'
    : `/${segments.join('/')}`;
  return SENTRY_SCREEN_NAMES.has(route) ? route : 'unknown';
}

export function getSentryUpdateTags(metadata: {
  runtimeVersion?: unknown;
  updateId?: unknown;
  isEmbeddedLaunch?: unknown;
}): Record<string, string> {
  const runtimeVersion = typeof metadata.runtimeVersion === 'string'
    && /^[a-zA-Z0-9._-]{1,80}$/.test(metadata.runtimeVersion)
    ? metadata.runtimeVersion
    : 'unknown';
  // An OTA UUID identifies the deployed bundle, never a person or record.
  const updateId = typeof metadata.updateId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metadata.updateId)
    ? metadata.updateId
    : 'unknown';

  return {
    'expo.runtime_version': runtimeVersion,
    'expo.update_id': updateId,
    'expo.embedded_launch': typeof metadata.isEmbeddedLaunch === 'boolean'
      ? String(metadata.isEmbeddedLaunch)
      : 'unknown',
  };
}
