import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  buildCorsHeaders,
  json,
  parseJson,
  redactSensitiveText,
  requireActor,
  requireRole,
  supabase,
} from '../_shared/board.ts';
import {
  BOARD_NOTIFICATION_ROLES,
  boardNotificationDeliveryKey,
  deriveBoardNotificationEventKey,
  isBoardNotificationEventKey,
  type BoardNotificationRole,
} from '../_shared/board-notification-event.ts';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';
import type { NotificationTargetV1 } from '../_shared/notification-target.ts';
import { validatePersistedNotificationForDelivery } from '../_shared/persisted-notification-delivery.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  postId?: string;
  eventKey?: string;
};

type PushStatus =
  | 'accepted'
  | 'no_registered_device'
  | 'provider_rejected'
  | 'not_attempted';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUSH_TIMEOUT_MS = 10_000;

function getEnv(name: string): string | undefined {
  const runtime = globalThis as {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.Deno?.env?.get?.(name) ?? runtime.process?.env?.[name];
}

async function persistBoardNotifications(input: {
  postId: string;
  eventKey: string;
  title: string;
  body: string;
}) {
  const target: NotificationTargetV1 = {
    version: 1,
    kind: 'board_post',
    postId: input.postId,
  };
  const targetUrl = `/board?postId=${input.postId}`;
  const rows = BOARD_NOTIFICATION_ROLES.map((role) => ({
    recipient_role: role,
    resident_id: null,
    recipient_actor_id: null,
    title: input.title,
    body: input.body,
    category: 'board_post',
    target,
    target_url: targetUrl,
    delivery_key: boardNotificationDeliveryKey(input.eventKey, role),
  }));
  const { data, error } = await supabase
    .from('notifications')
    .upsert(rows, { onConflict: 'delivery_key' })
    .select('id,recipient_role,recipient_actor_id,resident_id,target,delivery_key');
  if (error || (data?.length ?? 0) !== rows.length) {
    return {
      ok: false as const,
      target,
      targetUrl,
      notificationIds: [] as string[],
      notificationIdByRole: new Map<BoardNotificationRole, string>(),
    };
  }

  const notificationIdByRole = new Map<BoardNotificationRole, string>();
  for (const row of data ?? []) {
    const role = row.recipient_role as BoardNotificationRole;
    if (!BOARD_NOTIFICATION_ROLES.includes(role)) continue;
    const expectedKey = boardNotificationDeliveryKey(input.eventKey, role);
    if (row.delivery_key !== expectedKey || notificationIdByRole.has(role)) continue;
    const validation = validatePersistedNotificationForDelivery(row, {
      target,
      recipientRole: role,
      recipientActorId: null,
      residentId: null,
    });
    if (validation.ok) {
      notificationIdByRole.set(role, validation.notificationId);
    }
  }
  const ok = notificationIdByRole.size === BOARD_NOTIFICATION_ROLES.length;
  return {
    ok,
    target,
    targetUrl,
    notificationIds: ok ? Array.from(notificationIdByRole.values()) : [],
    notificationIdByRole,
  };
}

async function sendProviderPush(input: {
  role: 'fc' | 'admin';
  notificationId: string;
  target: NotificationTargetV1;
  title: string;
  body: string;
  url: string;
}): Promise<PushStatus> {
  const supabaseUrl = getEnv('SUPABASE_URL')?.trim();
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!supabaseUrl || !serviceKey) return 'provider_rejected';

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/fc-notify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({
          type: 'notify',
          target_role: input.role,
          target_id: null,
          title: input.title,
          body: input.body,
          category: 'board_post',
          url: input.url,
          target: input.target,
          notification_id: input.notificationId,
          skip_notification_insert: true,
        }),
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      },
    );
    if (!response.ok) return 'provider_rejected';
    const parsed = await response.json().catch(() => null) as {
      delivery?: {
        notificationStored?: unknown;
        pushStatus?: unknown;
      };
    } | null;
    if (parsed?.delivery?.notificationStored !== true) return 'provider_rejected';
    if (parsed.delivery.pushStatus === 'accepted') return 'accepted';
    if (parsed.delivery.pushStatus === 'no_registered_device') {
      return 'no_registered_device';
    }
    return 'provider_rejected';
  } catch {
    return 'provider_rejected';
  }
}

serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? undefined;
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405, origin);
  }

  const body = await parseJson<Payload>(req);
  if (!body) {
    return json({ ok: false, code: 'invalid_json', message: 'Invalid JSON' }, 400, origin);
  }
  const actorCheck = await requireActor(
    req,
    body,
    'board-notification-retry',
    origin,
  );
  if (actorCheck.ok === false) return actorCheck.response;
  const forbidden = requireRole(actorCheck.actor, ['admin', 'manager'], origin);
  if (forbidden) return forbidden;

  const postId = typeof body.postId === 'string'
    ? body.postId.trim().toLowerCase()
    : '';
  const eventKey = typeof body.eventKey === 'string' ? body.eventKey.trim() : '';
  if (!UUID_PATTERN.test(postId) || !isBoardNotificationEventKey(eventKey)) {
    return json({ ok: false, code: 'invalid_payload', message: 'Invalid notification retry target' }, 400, origin);
  }

  const { data: post, error: postError } = await supabase
    .from('board_posts')
    .select('id,title,author_role,author_resident_id,created_at,updated_at')
    .eq('id', postId)
    .maybeSingle();
  if (postError) {
    return json({ ok: false, code: 'db_error', message: 'Notification retry lookup failed' }, 500, origin);
  }
  if (!post?.id || !post.updated_at) {
    return json({ ok: false, code: 'not_found', message: 'Post not found' }, 404, origin);
  }
  if (
    actorCheck.actor.role === 'manager'
    && (
      post.author_role !== 'manager'
      || post.author_resident_id !== actorCheck.actor.residentId
    )
  ) {
    return json({ ok: false, code: 'forbidden', message: 'Cannot retry this post notification' }, 403, origin);
  }

  const canonicalEventKey = await deriveBoardNotificationEventKey({
    postId,
    updatedAt: post.updated_at,
  });
  if (canonicalEventKey !== eventKey) {
    return json({ ok: false, code: 'stale_notification_event', message: 'Notification retry event is stale' }, 409, origin);
  }

  const notificationTitle = post.created_at === post.updated_at
    ? '새 게시글'
    : '게시글 수정';
  const notificationBody = typeof post.title === 'string' && post.title.trim()
    ? redactSensitiveText(post.title.trim(), '게시글')
    : '게시글';
  const persisted = await persistBoardNotifications({
    postId,
    eventKey,
    title: notificationTitle,
    body: notificationBody,
  });
  if (!persisted.ok) {
    reportEdgeDiagnostic({
      event: 'board_notification_retry.notification_insert',
      reason: 'insert_failed',
      errorClass: 'database',
    });
    return json({
      ok: false,
      delivery: {
        notificationStored: false,
        pushStatus: 'not_attempted',
        retryable: true,
      },
      notificationRetry: { postId, eventKey },
      notificationWarning: 'notification_delivery_incomplete',
    }, 200, origin);
  }

  const providerStatuses = await Promise.all(
    (['fc', 'admin'] as const).map((role) =>
      sendProviderPush({
        role,
        notificationId: persisted.notificationIdByRole.get(role)!,
        target: persisted.target,
        title: notificationTitle,
        body: notificationBody,
        url: persisted.targetUrl,
      })
    ),
  );
  const pushStatus: PushStatus = providerStatuses.includes('provider_rejected')
    ? 'provider_rejected'
    : providerStatuses.includes('accepted')
      ? 'accepted'
      : 'no_registered_device';

  return json({
    ok: true,
    delivery: {
      notificationStored: true,
      pushStatus,
      retryable: false,
      notificationIds: persisted.notificationIds,
    },
    notificationRetry: null,
    notificationWarning: null,
  }, 200, origin);
});
