import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, requireRole, supabase , dbError, redactSensitiveText } from '../_shared/board.ts';
import { isCanonicalBoardCategorySlug } from '../_shared/board-categories.ts';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';
import type { NotificationTargetV1 } from '../_shared/notification-target.ts';
import { validatePersistedNotificationForDelivery } from '../_shared/persisted-notification-delivery.ts';
import {
  boardNotificationDeliveryKey,
  deriveBoardNotificationEventKey,
} from '../_shared/board-notification-event.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  categoryId?: string;
  title?: string;
  content?: string;
};

type BoardPushTargetRole = 'admin' | 'fc';

type BoardPushDeliveryCounts = Readonly<{
  attempted: number;
  accepted: number;
  rejected: number;
}>;

type BoardPushDeliveryResult = Readonly<{
  targetRole: BoardPushTargetRole;
  ok: boolean;
  pushStatus: 'accepted' | 'no_registered_device' | 'provider_rejected';
  sent: number;
  logged: boolean;
  delivery: BoardPushDeliveryCounts;
  failure?:
    | 'missing_configuration'
    | 'upstream_rejected'
    | 'invalid_response'
    | 'delivery_unconfirmed'
    | 'request_failed';
}>;

const NOTIFICATION_FETCH_TIMEOUT_MS = 10_000;
const MAX_PUSH_DELIVERY_COUNT = 1_000_000;
const EMPTY_PUSH_DELIVERY: BoardPushDeliveryCounts = Object.freeze({
  attempted: 0,
  accepted: 0,
  rejected: 0,
});

function toNonNegativeInteger(value: unknown): number | null {
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < 0
    || value > MAX_PUSH_DELIVERY_COUNT
  ) {
    return null;
  }
  return value;
}

function isTimeoutError(value: unknown): boolean {
  return value instanceof Error && (value.name === 'TimeoutError' || value.name === 'AbortError');
}

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

async function insertNotificationsWithFallback(rows: Record<string, unknown>[]) {
  const sanitizedRows: Record<string, unknown>[] = rows.map((row) => ({
    ...row,
    title: redactSensitiveText(String(row.title ?? ''), '알림'),
    body: redactSensitiveText(String(row.body ?? '')),
    category: redactSensitiveText(String(row.category ?? ''), 'board_post'),
    target_url: row.target_url ? redactSensitiveText(String(row.target_url)) : row.target_url,
  }));
  const { data, error } = await supabase
    .from('notifications')
    .upsert(sanitizedRows, { onConflict: 'delivery_key' })
    .select('id,recipient_role,recipient_actor_id,resident_id,target,delivery_key');
  if (error) return { error, rows: [] };
  const expectedByRole = new Map(
    sanitizedRows.map((row) => [String(row.recipient_role), row]),
  );
  const persistedRows = (data ?? []) as Array<Record<string, unknown>>;
  const rowsWithCanonicalIds = persistedRows.filter((row) => {
    const expected = expectedByRole.get(String(row.recipient_role));
    if (!expected) return false;
    if (row.delivery_key !== expected.delivery_key) return false;
    return validatePersistedNotificationForDelivery(row, {
      target: expected.target as NotificationTargetV1,
      recipientRole: expected.recipient_role as 'admin' | 'fc' | 'manager',
      recipientActorId: null,
      residentId: null,
    }).ok;
  });
  const mappingComplete =
    rowsWithCanonicalIds.length === sanitizedRows.length
    && rowsWithCanonicalIds.length === persistedRows.length;
  return {
    error: mappingComplete ? null : { message: 'notification_id_mapping_incomplete' },
    rows: mappingComplete ? rowsWithCanonicalIds : [],
  };
}

async function sendBoardPush(
  targetRole: BoardPushTargetRole,
  title: string,
  body: string,
  url: string,
  target: NotificationTargetV1,
  notificationId: string,
): Promise<BoardPushDeliveryResult> {
  const supabaseUrl = getEnv('SUPABASE_URL')?.trim();
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.warn('[board-create] push skipped: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return {
      targetRole,
      ok: false,
      pushStatus: 'provider_rejected',
      sent: 0,
      logged: false,
      delivery: EMPTY_PUSH_DELIVERY,
      failure: 'missing_configuration',
    };
  }

  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/fc-notify`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({
        type: 'notify',
        target_role: targetRole,
        target_id: null,
        title,
        body,
        category: 'board_post',
        url,
        target,
        notification_id: notificationId,
        skip_notification_insert: true,
      }),
      signal: AbortSignal.timeout(NOTIFICATION_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      reportEdgeDiagnostic({
        event: 'board_create.push_fanout',
        reason: 'upstream_rejected',
        status: response.status,
        retryable: response.status >= 500,
        errorClass: 'upstream',
      });
      return {
        targetRole,
        ok: false,
        pushStatus: 'provider_rejected',
        sent: 0,
        logged: false,
        delivery: EMPTY_PUSH_DELIVERY,
        failure: 'upstream_rejected',
      };
    }

    const raw = await response.text().catch(() => '');
    try {
      const parsed = raw
        ? JSON.parse(raw) as {
          ok?: unknown;
          logged?: unknown;
          sent?: unknown;
          delivery?: {
            notificationStored?: unknown;
            pushStatus?: unknown;
            attempted?: unknown;
            accepted?: unknown;
            rejected?: unknown;
          };
        }
        : null;
      const sent = toNonNegativeInteger(parsed?.sent) ?? 0;
      const logged = parsed?.logged === true;
      const attempted = toNonNegativeInteger(parsed?.delivery?.attempted);
      const accepted = toNonNegativeInteger(parsed?.delivery?.accepted);
      const rejected = toNonNegativeInteger(parsed?.delivery?.rejected);
      const delivery = attempted === null || accepted === null || rejected === null
        ? EMPTY_PUSH_DELIVERY
        : { attempted, accepted, rejected };
      const confirmed = parsed?.ok === true
        && logged
        && parsed?.delivery?.notificationStored === true;
      if (!confirmed) {
        reportEdgeDiagnostic({
          event: 'board_create.push_fanout',
          reason: 'upstream_rejected',
          status: response.status,
          retryable: false,
          errorClass: 'upstream',
        });
        return {
          targetRole,
          ok: false,
          pushStatus: 'provider_rejected',
          sent,
          logged,
          delivery,
          failure: 'delivery_unconfirmed',
        };
      }

      const pushStatus =
        parsed?.delivery?.pushStatus === 'accepted'
        || parsed?.delivery?.pushStatus === 'no_registered_device'
          ? parsed.delivery.pushStatus
          : 'provider_rejected';
      return { targetRole, ok: true, pushStatus, sent, logged, delivery };
    } catch {
      reportEdgeDiagnostic({
        event: 'board_create.push_fanout',
        reason: 'upstream_rejected',
        status: response.status,
        retryable: false,
        errorClass: 'upstream',
      });
      return {
        targetRole,
        ok: false,
        pushStatus: 'provider_rejected',
        sent: 0,
        logged: false,
        delivery: EMPTY_PUSH_DELIVERY,
        failure: 'invalid_response',
      };
    }
  } catch (error: unknown) {
    reportEdgeDiagnostic({
      event: 'board_create.push_fanout',
      reason: 'request_failed',
      retryable: true,
      errorClass: isTimeoutError(error) ? 'timeout' : 'network',
    });
    return {
      targetRole,
      ok: false,
      pushStatus: 'provider_rejected',
      sent: 0,
      logged: false,
      delivery: EMPTY_PUSH_DELIVERY,
      failure: 'request_failed',
    };
  }
}

serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? undefined;
  const corsHeaders = buildCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405, origin);
  }

  const body = await parseJson<Payload>(req);
  if (!body) return json({ ok: false, code: 'invalid_json', message: 'Invalid JSON' }, 400, origin);

  const actorCheck = await requireActor(req, body, 'board-create', origin);
  if (actorCheck.ok === false) return actorCheck.response;
  const forbidden = requireRole(actorCheck.actor, ['admin', 'manager'], origin);
  if (forbidden) return forbidden;

  const title = redactSensitiveText(body.title ?? '').trim();
  const content = redactSensitiveText(body.content ?? '').trim();
  const categoryId = body.categoryId;

  if (!title || !content || !categoryId) {
    return json({ ok: false, code: 'invalid_payload', message: 'title, content, categoryId required' }, 400, origin);
  }

  const { data: category, error: categoryError } = await supabase
    .from('board_categories')
    .select('id,is_active,slug')
    .eq('id', categoryId)
    .maybeSingle();

  if (categoryError) {
    return json({ ok: false, code: 'db_error', message: categoryError.message }, 500, origin);
  }
  if (!category?.id || category.is_active !== true || !isCanonicalBoardCategorySlug(category.slug)) {
    return json({ ok: false, code: 'invalid_category', message: 'category not found or inactive' }, 400, origin);
  }
  if (
    actorCheck.authMode === 'automation'
    && (category.slug !== 'general' || !title.startsWith('보험소식 브리핑'))
  ) {
    return json({
      ok: false,
      code: 'automation_forbidden',
      message: 'board automation may create only the canonical insurance digest',
    }, 403, origin);
  }

  const { data, error } = await supabase
    .from('board_posts')
    .insert({
      category_id: categoryId,
      title,
      content,
      author_role: actorCheck.actor.role,
      author_resident_id: actorCheck.actor.residentId,
      author_name: redactSensitiveText(actorCheck.actor.displayName ?? '', '작성자'),
    })
    .select('id,updated_at')
    .single();

  if (error) {
    return dbError(error, origin);
  }

  const notificationTitle = '새 게시글';
  const targetUrl = `/board?postId=${data.id}`;
  const target: NotificationTargetV1 = { version: 1, kind: 'board_post', postId: data.id };
  const eventKey = await deriveBoardNotificationEventKey({
    postId: data.id,
    updatedAt: data.updated_at,
  });
  const notificationRows = [
    {
      recipient_role: 'fc',
      resident_id: null,
      title: notificationTitle,
      body: title,
      category: 'board_post',
      target,
      target_url: targetUrl,
      delivery_key: boardNotificationDeliveryKey(eventKey, 'fc'),
    },
    {
      recipient_role: 'admin',
      resident_id: null,
      title: notificationTitle,
      body: title,
      category: 'board_post',
      target,
      target_url: targetUrl,
      delivery_key: boardNotificationDeliveryKey(eventKey, 'admin'),
    },
    {
      recipient_role: 'manager',
      resident_id: null,
      title: notificationTitle,
      body: title,
      category: 'board_post',
      target,
      target_url: targetUrl,
      delivery_key: boardNotificationDeliveryKey(eventKey, 'manager'),
    },
  ];

  const notificationInsert = await insertNotificationsWithFallback(notificationRows);
  const notificationError = notificationInsert.error;
  if (notificationError) {
    reportEdgeDiagnostic({
      event: 'board_create.notification_insert',
      reason: 'insert_failed',
      errorClass: 'database',
    });
  }

  const notificationIdByRole = new Map(
    notificationInsert.rows.map((row) =>
      [String(row.recipient_role), String(row.id)] as const
    ),
  );
  const pushTargets = notificationError
    ? []
    : await Promise.all([
        sendBoardPush('fc', notificationTitle, title, targetUrl, target, notificationIdByRole.get('fc')!),
        sendBoardPush('admin', notificationTitle, title, targetUrl, target, notificationIdByRole.get('admin')!),
      ]);

  const inboxOk = !notificationError;
  const pushOk = inboxOk && pushTargets.every((target) => target.ok);
  const pushStatus = pushTargets.some((target) => target.pushStatus === 'provider_rejected')
    ? 'provider_rejected'
    : pushTargets.some((target) => target.pushStatus === 'accepted')
      ? 'accepted'
      : 'no_registered_device';
  const notification = {
    ok: inboxOk,
    inbox: {
      ok: inboxOk,
      attempted: notificationRows.length,
    },
    push: {
      ok: pushOk,
      attempted: pushTargets.length,
      confirmed: pushTargets.filter((target) => target.ok).length,
      targets: pushTargets,
    },
  };

  return json({
    ok: true,
    saved: true,
    data: { id: data.id },
    notification,
    delivery: {
      notificationStored: inboxOk,
      pushStatus: !inboxOk
        ? 'not_attempted'
        : pushStatus,
      retryable: !inboxOk,
      ...(inboxOk
        ? { notificationIds: Array.from(notificationIdByRole.values()) }
        : {}),
    },
    notificationRetry: inboxOk ? null : { postId: data.id, eventKey },
    notificationWarning: inboxOk ? null : 'notification_delivery_incomplete',
  }, 200, origin);
});
