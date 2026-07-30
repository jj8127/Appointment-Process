import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { parseNotificationTargetV1 } from '@/lib/notification-target';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeToken = (value?: string | null) =>
  (value ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\\n/g, '')
    .replace(/\r?\n/g, '')
    .trim();

/**
 * Compatibility endpoint for older fc-notify deployments.
 *
 * The administrator product now delivers incoming work only through the
 * canonical in-app inbox. Authentication and payload validation remain in
 * place so legacy callers receive a bounded success response without causing
 * browser or operating-system notification delivery.
 */
export async function POST(req: Request) {
  const secret = normalizeToken(req.headers.get('X-Admin-Push-Secret'));
  const expectedSecret = normalizeToken(process.env.ADMIN_PUSH_SECRET);
  const serviceRoleKey = normalizeToken(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const authHeader = req.headers.get('Authorization') ?? '';
  const apikey = normalizeToken(req.headers.get('apikey'));
  const bearer = authHeader.startsWith('Bearer ') ? normalizeToken(authHeader.slice(7)) : '';

  const secretAuthOk = Boolean(expectedSecret && secret && secret === expectedSecret);
  const serviceRoleAuthOk = Boolean(serviceRoleKey && bearer && bearer === serviceRoleKey);
  const apikeyAuthOk = Boolean(serviceRoleKey && apikey && apikey === serviceRoleKey);

  if (!secretAuthOk && !serviceRoleAuthOk && !apikeyAuthOk) {
    logger.warn('[admin/push] unauthorized request', {
      hasSecret: Boolean(secret),
      hasBearer: Boolean(bearer),
      hasApikey: Boolean(apikey),
      secretConfigured: Boolean(expectedSecret),
      serviceRoleConfigured: Boolean(serviceRoleKey),
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: {
    title?: string;
    body?: string;
    notificationId?: string;
    target?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const notificationId = String(payload.notificationId ?? '').trim().toLowerCase();
  if (
    !payload.title
    || !payload.body
    || !UUID_PATTERN.test(notificationId)
    || !parseNotificationTargetV1(payload.target)
  ) {
    return NextResponse.json(
      { error: 'Missing or invalid notification payload' },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    sent: 0,
    failed: 0,
    noTarget: true,
    mode: 'in_app_only',
  });
}
