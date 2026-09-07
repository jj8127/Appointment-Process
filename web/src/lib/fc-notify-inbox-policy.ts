import type { VerifiedServerSession } from './server-session';

export function isSameOriginInboxRequest(request: Request) {
  const source = request.headers.get('origin') || request.headers.get('referer');
  if (!source) return false;
  try {
    return new URL(source).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function buildVerifiedInboxPayload(
  body: { limit?: unknown },
  session: VerifiedServerSession,
) {
  const personalStaff = session.role === 'manager' || session.staffType === 'developer';
  const requestedLimit = Number(body.limit ?? 80);
  return {
    type: 'inbox_list' as const,
    role: session.role === 'fc' ? 'fc' as const : 'admin' as const,
    resident_id: session.role === 'fc' || personalStaff ? session.residentDigits : null,
    include_request_board_fc: personalStaff,
    limit: Math.max(1, Math.min(Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 80, 200)),
    viewer_actor_role: session.role,
    viewer_actor_phone: session.residentDigits,
  };
}
