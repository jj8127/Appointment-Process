const sanitizeDigits = (value: string | null | undefined) => String(value ?? '').replace(/[^0-9]/g, '');

const normalizeTargetName = (value: string | null | undefined) => String(value ?? '').trim();

export const buildAdminDashboardChatUrl = (input?: {
  targetId?: string | null;
  targetName?: string | null;
}) => {
  const params = new URLSearchParams();
  const targetId = sanitizeDigits(input?.targetId);
  const targetName = normalizeTargetName(input?.targetName);

  if (targetId) params.set('targetId', targetId);
  if (targetName) params.set('targetName', targetName);

  const query = params.toString();
  return query ? `/dashboard/chat?${query}` : '/dashboard/chat';
};

export const normalizeAdminDashboardUrl = (url: string | null | undefined) => {
  let trimmed = String(url ?? '').trim();
  if (!trimmed) return '/dashboard';

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      trimmed = `${parsed.pathname}${parsed.search}`;
    } catch {
      return '/dashboard';
    }
  }

  if (trimmed.startsWith('/dashboard/chat')) {
    return trimmed;
  }

  if (trimmed.startsWith('/dashboard/messenger')) {
    try {
      const parsed = new URL(trimmed, 'https://example.local');
      const channel = (parsed.searchParams.get('channel') ?? '').trim().toLowerCase();
      if (channel === 'garam') {
        return buildAdminDashboardChatUrl({
          targetId: parsed.searchParams.get('targetId'),
          targetName: parsed.searchParams.get('targetName'),
        });
      }
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return '/dashboard/messenger';
    }
  }

  if (trimmed.startsWith('/chat')) {
    try {
      const parsed = new URL(trimmed, 'https://example.local');
      return buildAdminDashboardChatUrl({
        targetId: parsed.searchParams.get('targetId'),
        targetName: parsed.searchParams.get('targetName'),
      });
    } catch {
      return '/dashboard/chat';
    }
  }

  if (trimmed.startsWith('/dashboard')) {
    return trimmed;
  }

  return '/dashboard';
};
