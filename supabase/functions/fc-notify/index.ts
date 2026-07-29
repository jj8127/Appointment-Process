import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  attachChatSummariesToContacts,
  buildDirectChatTargetSummaries,
  buildInternalChatList,
  shouldIncludeInternalChatParticipant,
} from '../_shared/internal-chat.ts';
import { filterManagerTokensForNotification } from '../_shared/notification-delivery-policy.ts';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';
import {
  classifyExpoPushDelivery,
  mergeExpoPushDeliverySummaries,
  toExpoPushDeliveryOutcome,
  type ExpoPushDeliverySummary,
} from '../_shared/expo-push-delivery.ts';
import {
  buildAppFcNotifyPayload,
  getAllowedNotificationTokenRoles,
  isTrustedFcNotifyServiceKey,
  shouldRequireActiveStaffNotificationTarget,
  type FcNotifyAppActor,
} from '../_shared/fc-notify-auth-policy.ts';
import {
  parseDesignerCompanyNameFromAffiliation,
  requireAppSessionFromRequest,
  type AppSessionTokenPayload,
} from '../_shared/request-board-auth.ts';
import {
  parseNotificationTargetV1,
  type NotificationTargetV1,
} from '../_shared/notification-target.ts';
import { validatePersistedNotificationForDelivery } from '../_shared/persisted-notification-delivery.ts';
import {
  drainMessengerAttachmentCleanup,
  finalizeMessengerAttachmentBatch,
  listMessengerAttachmentsByBatchIds,
  mapMessengerAttachmentRpcError,
  MessengerAttachmentServiceError,
  type MessengerAttachmentMetadata,
} from '../_shared/messenger-attachment-service.ts';
import {
  authorizeNotificationReceipt,
  authorizeNotificationReceiptSet,
  classifyNotificationReceiptState,
  type NotificationOwnershipRow,
  type NotificationReceiptViewer,
} from '../_shared/notification-receipt-policy.ts';
import { collectVisibleNotificationInboxRows } from '../_shared/notification-inbox-pagination.ts';
import {
  buildDirectMessageIdentity,
  canAccessDirectConversation,
  canDeleteDirectMessage,
  isCurrentDirectMessageVisible,
  isLegacyDirectMessageVisible,
  type DirectConversationCounterparty,
} from '../_shared/direct-message-policy.ts';

type Payload =
  | { type: 'fc_update'; fc_id: string; message?: string }
  | { type: 'fc_delete'; fc_id: string; message?: string }
  | { type: 'admin_update'; fc_id: string; message?: string }
  | { type: 'chat_targets'; resident_id?: string | null }
  | {
      type: 'internal_chat_list';
      viewer_id?: string | null;
      viewer_role: 'admin' | 'fc';
      viewer_staff_type?: 'admin' | 'developer' | null;
      viewer_read_only?: boolean;
      viewer_is_request_board_designer?: boolean;
    }
  | {
      type: 'internal_unread_count';
      viewer_id?: string | null;
      viewer_role: 'admin' | 'fc';
      viewer_staff_type?: 'admin' | 'developer' | null;
      viewer_read_only?: boolean;
      viewer_is_request_board_designer?: boolean;
    }
  | {
      type: 'inbox_list';
      role: 'admin' | 'fc';
      resident_id?: string | null;
      limit?: number;
      include_request_board_fc?: boolean;
      only_request_board_categories?: boolean;
      viewer_actor_id?: string;
      viewer_actor_role?: 'fc' | 'manager' | 'admin' | 'developer';
    }
  | {
      type: 'inbox_get';
      role: 'admin' | 'fc';
      resident_id?: string | null;
      notification_id: string;
      include_request_board_fc?: boolean;
      viewer_actor_id?: string;
      viewer_actor_role?: 'fc' | 'manager' | 'admin' | 'developer';
    }
  | {
      type: 'inbox_unread_count';
      role: 'admin' | 'fc';
      resident_id?: string | null;
      since?: string | null;
      notice_since?: string | null;
      include_request_board_fc?: boolean;
      exclude_request_board_categories?: boolean;
      include_notices?: boolean;
      only_request_board_categories?: boolean;
      viewer_actor_id?: string;
      viewer_actor_role?: 'fc' | 'manager' | 'admin' | 'developer';
    }
  | {
      type: 'inbox_mark_read' | 'inbox_dismiss' | 'inbox_delete';
      role: 'admin' | 'fc';
      resident_id?: string | null;
      notification_ids?: string[];
      notice_ids?: string[];
      include_request_board_fc?: boolean;
      viewer_actor_id?: string;
      viewer_actor_role?: 'fc' | 'manager' | 'admin' | 'developer';
    }
  | {
      type: 'resolve_garamin_direct_conversation';
      conversation_id?: string | null;
      target_id?: string | null;
      viewer_actor_id?: string;
      viewer_actor_role?: 'fc' | 'manager' | 'admin' | 'developer';
    }
  | {
      type: 'direct_message_list' | 'direct_message_mark_read';
      conversation_id: string;
      viewer_actor_id?: string;
      viewer_actor_role?: 'fc' | 'manager' | 'admin' | 'developer';
    }
  | {
      type: 'direct_message_send';
      conversation_id: string;
      content: string;
      client_message_id?: string;
      attachment_intent_ids?: string[];
      delivery_key?: string;
      payload_fingerprint?: string;
      viewer_actor_id?: string;
      viewer_actor_role?: 'fc' | 'manager' | 'admin' | 'developer';
    }
  | {
      type: 'direct_message_broadcast_send';
      conversation_ids: string[];
      client_message_ids: string[];
      content: string;
      attachment_intent_ids: string[];
      delivery_key: string;
      payload_fingerprint: string;
      viewer_actor_id?: string;
      viewer_actor_role?: 'admin' | 'developer';
    }
  | {
      type: 'direct_message_delete';
      conversation_id: string;
      message_id: string;
      viewer_actor_id?: string;
      viewer_actor_role?: 'fc' | 'manager' | 'admin' | 'developer';
    }
  | {
      type: 'notice_get';
      notice_id: string;
      viewer_actor_id?: string;
      viewer_actor_role?: 'fc' | 'manager' | 'admin' | 'developer';
    }
  | { type: 'latest_notice' }
  | {
      type: 'notify';
      target_role: 'admin' | 'fc';
      target_id: string | null;
      title: string;
      body: string;
      category?: string;
      url?: string;
      fc_id?: string | null;
      sender_id?: string;
      sender_name?: string;
      skip_notification_insert?: boolean;
      target?: NotificationTargetV1;
      notification_id?: string;
      recipient_actor_id?: string | null;
    }
  | {
      type: 'message';
      target_role: 'admin' | 'fc';
      target_id: string | null;
      message: string;
      sender_id: string;
      sender_name?: string;
      title?: string;
      body?: string;
      category?: string;
      url?: string;
      fc_id?: string | null;
      skip_notification_insert?: boolean;
      target?: NotificationTargetV1;
      notification_id?: string;
      recipient_actor_id?: string | null;
    };

type TokenRow = {
  expo_push_token: string;
  resident_id: string | null;
  display_name: string | null;
  role?: string | null;
};
type FcRow = {
  id: string;
  name: string | null;
  resident_id_masked: string | null;
  phone: string | null;
  affiliation: string | null;
};
type AdminAccountRow = { name?: string | null; phone: string | null; staff_type?: string | null };
type ManagerAccountRow = { phone: string | null };
type AffiliationManagerMappingRow = { manager_phone: string | null };
type NoticeFile = { name?: string; url?: string; type?: string };
type NotificationInsert = {
  title: string;
  body: string;
  category: string;
  recipient_role: 'admin' | 'fc' | 'manager';
  resident_id: string | null;
  fc_id?: string | null;
  target_url?: string | null;
  target: NotificationTargetV1;
  recipient_actor_id?: string | null;
};
type NoticeRow = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  created_at: string;
  images?: string[] | null;
  files?: NoticeFile[] | null;
  target?: NotificationTargetV1 | null;
};
type BoardNoticeCategoryRow = {
  id: string;
  name: string | null;
  slug: string | null;
};
type BoardNoticePostRow = {
  id: string;
  category_id: string | null;
  title: string;
  content: string;
  created_at: string;
};
type BoardAttachmentRow = {
  id: string;
  post_id: string;
  file_type: 'image' | 'file';
  file_name: string;
  file_size: number;
  mime_type: string | null;
  storage_path: string;
  sort_order: number;
  created_at: string;
};
type InternalChatMessageRow = {
  sender_id: string | null;
  receiver_id: string | null;
  content: string | null;
  created_at: string | null;
  is_read: boolean | null;
};
type InternalChatMessageAttachmentRow = InternalChatMessageRow & {
  file_name?: string | null;
  attachment_batch_id?: string | null;
  deleted_at?: string | null;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_CHUNK_SIZE = 100;
const EXPO_PUSH_TIMEOUT_MS = 10_000;
const ADMIN_WEB_PUSH_TIMEOUT_MS = 10_000;
const BOARD_HOME_CATEGORY_SLUGS = ['notice', 'garam-pick'] as const;
const BOARD_NOTICE_ID_PREFIX = 'board_notice:';
const BOARD_ATTACHMENT_SIGN_EXPIRES_SECONDS = 60 * 60 * 6;
const ADMIN_CHAT_ID = 'admin';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AFFILIATION_OPTIONS = [
  '1본부 서선미',
  '2본부 박성훈',
  '3본부 김태희',
  '4본부 현경숙',
  '5본부 최철준',
  '6본부 김정수(박선희)',
  '7본부 이동훈',
  '8본부 정승철',
  '9본부 이현욱(김주용)',
  '10본부 한태균',
] as const;
const LEGACY_AFFILIATION_TO_NEW: Record<string, string> = {
  '1본부 [본부장: 서선미]': '1본부 서선미',
  '2본부 [본부장: 박성훈]': '2본부 박성훈',
  '3본부 [본부장: 김태희]': '3본부 김태희',
  '4본부 [본부장: 현경숙]': '4본부 현경숙',
  '5본부 [본부장: 최철준]': '5본부 최철준',
  '6본부 [본부장: 김정수]': '6본부 김정수(박선희)',
  '6본부 [본부장: 박선희]': '6본부 김정수(박선희)',
  '7본부 [본부장: 김동훈]': '7본부 이동훈',
  '7본부 [본부장: 이동훈]': '7본부 이동훈',
  '8본부 [본부장: 정승철]': '8본부 정승철',
  '9본부 [본부장: 이현욱]': '9본부 이현욱(김주용)',
  '9본부 [본부장: 김주용]': '9본부 이현욱(김주용)',
  '10본부 [본부장: 한태균]': '10본부 한태균',
  '1팀(서울1) : 서선미 본부장님': '1본부 서선미',
  '2팀(서울2) : 박성훈 본부장님': '2본부 박성훈',
  '3팀(부산1) : 김태희 본부장님': '3본부 김태희',
  '4팀(대전1) : 현경숙 본부장님': '4본부 현경숙',
  '5팀(대전2) : 최철준 본부장님': '5본부 최철준',
  '6팀(전주1) : 김정수 본부장님': '6본부 김정수(박선희)',
  '6팀(전주1) : 박선희 본부장님': '6본부 김정수(박선희)',
  '7팀(청주1/직할) : 김동훈 본부장님': '7본부 이동훈',
  '7팀(청주1/직할) : 이동훈 본부장님': '7본부 이동훈',
  '8팀(서울3) : 정승철 본부장님': '8본부 정승철',
  '9팀(서울4) : 이현옥 본부장님': '9본부 이현욱(김주용)',
  '9팀(서울4) : 이현욱 본부장님': '9본부 이현욱(김주용)',
};

const sanitize = (v?: string | null) => (v ?? '').replace(/[^0-9]/g, '');
const normalizeWhitespace = (value?: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();
const SECRET_ASSIGNMENT_PATTERN =
  /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ROLE_KEY|AUTH_TOKEN|API_KEY)\b\s*=\s*[^\s"'`<>]+/gi;
const LONG_HEX_TOKEN_PATTERN = /\b[a-f0-9]{32,}\b/gi;

function redactSensitiveText(value?: string | null, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text
    .replace(SECRET_ASSIGNMENT_PATTERN, (match) => {
      const key = match.split('=')[0]?.trim() || 'SECRET';
      return `${key}=[redacted]`;
    })
    .replace(LONG_HEX_TOKEN_PATTERN, '[redacted]')
    .trim();
}

function sanitizeNotificationInsert(payload: NotificationInsert): NotificationInsert {
  return {
    ...payload,
    title: redactSensitiveText(payload.title, '알림'),
    body: redactSensitiveText(payload.body),
    category: redactSensitiveText(payload.category, 'app_event'),
    target_url: payload.target_url ? redactSensitiveText(payload.target_url) : payload.target_url,
  };
}
const normalizeAffiliationLabel = (value?: string | null): string => {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return '';
  if (AFFILIATION_OPTIONS.includes(trimmed as (typeof AFFILIATION_OPTIONS)[number])) return trimmed;

  const mapped = LEGACY_AFFILIATION_TO_NEW[trimmed];
  if (mapped) return mapped;

  const prefix = trimmed.match(/^(10|[1-9])\s*(본부|팀)/);
  if (prefix?.[1]) {
    const index = Number(prefix[1]) - 1;
    return AFFILIATION_OPTIONS[index] ?? trimmed;
  }

  return trimmed;
};

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

// Security: Validate required environment variables
const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}
if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}

function getReceiptViewer(body: {
  viewer_actor_id?: string;
  viewer_actor_role?: 'fc' | 'manager' | 'admin' | 'developer';
}) {
  const actorId = String(body.viewer_actor_id ?? '').trim();
  const role = body.viewer_actor_role;
  return UUID_PATTERN.test(actorId) && role
    ? { actorId, role }
    : null;
}

async function fetchReceiptMap(
  notificationIds: string[],
  viewer: { actorId: string; role: 'fc' | 'manager' | 'admin' | 'developer' },
) {
  if (notificationIds.length === 0) return new Map<string, { read_at: string | null; dismissed_at: string | null }>();
  const { data, error } = await supabase
    .from('notification_receipts')
    .select('notification_id,read_at,dismissed_at')
    .eq('viewer_actor_id', viewer.actorId)
    .eq('viewer_role', viewer.role)
    .in('notification_id', notificationIds);
  if (error) throw error;
  return new Map(
    (data ?? []).map((row) => [
      String(row.notification_id),
      {
        read_at: typeof row.read_at === 'string' ? row.read_at : null,
        dismissed_at: typeof row.dismissed_at === 'string' ? row.dismissed_at : null,
      },
    ]),
  );
}

const requiredServiceKey = serviceKey;
const supabase = createClient(supabaseUrl, requiredServiceKey);

async function buildInternalChatSummaryRows(
  rows: InternalChatMessageAttachmentRow[],
): Promise<InternalChatMessageRow[]> {
  const visibleRows = rows.filter((row) => !row.deleted_at);
  const attachmentsByBatch = await listMessengerAttachmentsByBatchIds({
    supabase,
    batchIds: visibleRows.map((row) => row.attachment_batch_id),
  });
  return visibleRows.map((row) => {
    const batchAttachments = row.attachment_batch_id
      ? attachmentsByBatch.get(row.attachment_batch_id) ?? []
      : [];
    const preview = String(row.content ?? '').trim()
      || String(row.file_name ?? '').trim()
      || (
        batchAttachments.length === 1
          ? batchAttachments[0].name
          : batchAttachments.length > 1
            ? `첨부파일 ${batchAttachments.length}개`
            : ''
      );
    return { ...row, content: preview };
  });
}

function buildNotificationReceiptViewer(input: {
  viewer: { actorId: string; role: 'fc' | 'manager' | 'admin' | 'developer' };
  inboxRole: 'admin' | 'fc';
  residentId: string;
  includeRequestBoardFc?: boolean;
}): NotificationReceiptViewer {
  return {
    actorId: input.viewer.actorId,
    inboxRole: input.inboxRole,
    residentId: input.residentId || null,
    includeRequestBoardFc:
      input.inboxRole === 'admin'
      && Boolean(input.residentId)
      && input.includeRequestBoardFc === true,
  };
}

function toNotificationOwnershipRow(
  row: Record<string, unknown>,
): NotificationOwnershipRow {
  return {
    id: String(row.id ?? ''),
    recipient_actor_id:
      typeof row.recipient_actor_id === 'string' ? row.recipient_actor_id : null,
    recipient_role:
      typeof row.recipient_role === 'string' ? row.recipient_role : null,
    resident_id: typeof row.resident_id === 'string' ? row.resident_id : null,
    category: typeof row.category === 'string' ? row.category : null,
  };
}

function getAdminPushEndpoint(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}/api/admin/push`;
  } catch {
    try {
      const parsed = new URL(`https://${trimmed}`);
      return `${parsed.origin}/api/admin/push`;
    } catch {
      return null;
    }
  }
}

type AdminWebPushResult = {
  ok: boolean;
  status?: number;
  sent: number;
  failed: number;
  noTarget: boolean;
  reason?: string;
};
type DirectMessageRow = {
  id: string;
  conversation_id: string | null;
  thread_id: string | null;
  sender_id: string;
  receiver_id: string;
  sender_actor_id: string | null;
  receiver_actor_id: string | null;
  content: string;
  created_at: string;
  is_read: boolean;
  message_type: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  attachment_batch_id: string | null;
  deleted_at: string | null;
  deleted_by_actor_id: string | null;
};

const NOTIFICATION_DELIVERY_INCOMPLETE_WARNING = 'notification_delivery_incomplete';

function isTimeoutError(error: unknown): boolean {
  return error !== null
    && typeof error === 'object'
    && 'name' in error
    && (error as { name?: unknown }).name === 'TimeoutError';
}

type NotificationSource = 'request_board' | 'fc_onboarding';
const REQUEST_BOARD_CATEGORY_PREFIX = 'request_board_';

function resolveNotificationSource(category?: string | null): NotificationSource {
  const normalized = (category ?? '').trim().toLowerCase();
  if (normalized.startsWith(REQUEST_BOARD_CATEGORY_PREFIX)) {
    return 'request_board';
  }
  return 'fc_onboarding';
}

function buildPushTitleWithSource(title: string, source: NotificationSource): string {
  if (source !== 'request_board') return title;

  const trimmed = title.trim();
  if (trimmed.startsWith('[설계요청]')) return trimmed;
  return `[설계요청] ${trimmed}`;
}

/**
 * Send web push notification to all admin browser subscribers.
 * Calls the Next.js /api/admin/push endpoint.
 * Delivery is best-effort, but the callback result is classified and exposed so
 * the caller can distinguish a saved notification from partial delivery.
 */
async function notifyAdminWebPush(
  title: string,
  body: string,
  url: string,
  targetId: string | null,
  notificationId: string,
  target: NotificationTargetV1,
) {
  const adminWebUrl = getEnv('ADMIN_WEB_URL');
  const pushSecret = getEnv('ADMIN_PUSH_SECRET');

  if (!adminWebUrl) {
    console.warn('[fc-notify] admin web push disabled: missing ADMIN_WEB_URL');
    return {
      ok: false,
      sent: 0,
      failed: 0,
      noTarget: false,
      reason: 'missing-admin-web-url',
    } as AdminWebPushResult;
  }

  const endpoint = getAdminPushEndpoint(adminWebUrl);
  if (!endpoint) {
    console.warn('[fc-notify] admin web push disabled: invalid ADMIN_WEB_URL');
    return {
      ok: false,
      sent: 0,
      failed: 0,
      noTarget: false,
      reason: 'invalid-admin-web-url',
    } as AdminWebPushResult;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${requiredServiceKey}`,
    'apikey': requiredServiceKey,
  };
  if (pushSecret) {
    headers['X-Admin-Push-Secret'] = pushSecret;
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title,
        body,
        url,
        targetId: targetId ?? null,
        notificationId,
        target,
      }),
      signal: AbortSignal.timeout(ADMIN_WEB_PUSH_TIMEOUT_MS),
    });

    if (!resp.ok) {
      reportEdgeDiagnostic({
        event: 'fc_notify.admin_web_push',
        reason: 'upstream_rejected',
        status: resp.status,
        retryable: resp.status >= 500,
        errorClass: 'upstream',
      });
      return {
        ok: false,
        status: resp.status,
        sent: 0,
        failed: 0,
        noTarget: false,
        reason: `http-${resp.status}`,
      } as AdminWebPushResult;
    }

    const text = await resp.text().catch(() => '');
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }

    const sent = typeof parsed?.sent === 'number' && Number.isInteger(parsed.sent) && parsed.sent >= 0
      ? parsed.sent
      : null;
    const failed = typeof parsed?.failed === 'number' && Number.isInteger(parsed.failed) && parsed.failed >= 0
      ? parsed.failed
      : null;
    const noTargetValue = parsed?.noTarget;
    const noTargetFieldIsValid = noTargetValue === undefined || typeof noTargetValue === 'boolean';
    const responseIsValid = parsed !== null
      && typeof parsed.ok === 'boolean'
      && sent !== null
      && failed !== null
      && noTargetFieldIsValid;

    if (!responseIsValid) {
      reportEdgeDiagnostic({
        event: 'fc_notify.admin_web_push',
        reason: 'upstream_rejected',
        status: resp.status,
        retryable: false,
        errorClass: 'upstream',
      });
      return {
        ok: false,
        status: resp.status,
        sent: 0,
        failed: 0,
        noTarget: false,
        reason: 'invalid-callback-response',
      } as AdminWebPushResult;
    }

    const noTarget = noTargetValue === true || (sent === 0 && failed === 0);
    const callbackReportedSuccess = parsed?.ok === true;
    const concreteTargetMissed = Boolean(targetId) && sent === 0;
    const inconsistentNoTarget = noTargetValue === true && (sent > 0 || failed > 0);
    const callbackAccepted = callbackReportedSuccess
      && failed === 0
      && !concreteTargetMissed
      && !inconsistentNoTarget;

    if (!callbackAccepted) {
      reportEdgeDiagnostic({
        event: 'fc_notify.admin_web_push',
        reason: 'upstream_rejected',
        status: resp.status,
        retryable: failed > 0,
        errorClass: 'upstream',
      });
    }

    return {
      ok: callbackAccepted,
      status: resp.status,
      sent,
      failed,
      noTarget,
      ...(!callbackAccepted
        ? { reason: concreteTargetMissed ? 'no-concrete-web-target' : 'callback-reported-failure' }
        : {}),
    } as AdminWebPushResult;
  } catch (error: unknown) {
    const timedOut = isTimeoutError(error);
    reportEdgeDiagnostic({
      event: 'fc_notify.admin_web_push',
      reason: 'request_failed',
      retryable: true,
      errorClass: timedOut ? 'timeout' : 'network',
    });
    return {
      ok: false,
      sent: 0,
      failed: 0,
      noTarget: false,
      reason: timedOut ? 'callback-timeout' : 'callback-network-error',
    } as AdminWebPushResult;
  }
}

function getNotificationDeliveryWarning(adminWebPush: AdminWebPushResult | null): string | null {
  // Provider delivery is operational metadata only. Once the canonical inbox
  // row exists, sender-facing UI must report success regardless of device state.
  void adminWebPush;
  return null;
}

function resolvePushStatus(input: {
  expoAttempted: number;
  expoAccepted: number;
  expoRejected: number;
  adminWebPush: AdminWebPushResult | null;
}): 'delivered' | 'queued' | 'no_registered_device' | 'provider_failed' {
  if (input.adminWebPush?.ok === true && input.adminWebPush.sent > 0) return 'delivered';
  if (
    input.expoAttempted > 0
    && input.expoAccepted === input.expoAttempted
    && input.expoRejected === 0
  ) {
    return 'queued';
  }
  if (input.expoAttempted === 0 && (!input.adminWebPush || input.adminWebPush.noTarget)) {
    return 'no_registered_device';
  }
  return 'provider_failed';
}

function buildDeliveryMetadata(input: {
  notificationStored: boolean;
  pushStatus: 'accepted' | 'no_registered_device' | 'provider_rejected' | 'not_attempted';
  retryable: boolean;
  notificationId?: string;
  notificationIds?: string[];
  attempted?: number;
  accepted?: number;
  rejected?: number;
}) {
  return {
    notificationStored: input.notificationStored,
    pushStatus: input.pushStatus,
    retryable: input.retryable,
    ...(input.notificationId ? { notificationId: input.notificationId } : {}),
    ...(input.notificationIds ? { notificationIds: input.notificationIds } : {}),
    attempted: input.attempted ?? 0,
    accepted: input.accepted ?? 0,
    rejected: input.rejected ?? 0,
  };
}

async function fetchNoticesWithOptionalAttachments(limit = 20): Promise<NoticeRow[]> {
  const withAttachments = await supabase
    .from('notices')
    .select('id,title,body,category,created_at,images,files')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!withAttachments.error) {
    return ((withAttachments.data ?? []) as NoticeRow[]).map((row) => ({
      ...row,
      target: UUID_PATTERN.test(row.id)
        ? { version: 1, kind: 'notice', noticeId: row.id }
        : null,
    }));
  }

  // Backward compatibility: some environments may not have images/files columns yet.
  if (withAttachments.error.code === '42703') {
    const basic = await supabase
      .from('notices')
      .select('id,title,body,category,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (basic.error) throw basic.error;
    return ((basic.data ?? []) as NoticeRow[]).map((row) => ({
      ...row,
      images: null,
      files: null,
      target: UUID_PATTERN.test(row.id)
        ? { version: 1, kind: 'notice', noticeId: row.id }
        : null,
    }));
  }

  throw withAttachments.error;
}

async function fetchNoticeByIdWithOptionalAttachments(
  noticeId: string,
): Promise<NoticeRow | null> {
  const withAttachments = await supabase
    .from('notices')
    .select('id,title,body,category,created_at,images,files')
    .eq('id', noticeId)
    .maybeSingle();

  if (!withAttachments.error) {
    const row = withAttachments.data as NoticeRow | null;
    return row
      ? {
          ...row,
          target: { version: 1, kind: 'notice', noticeId: row.id },
        }
      : null;
  }

  if (withAttachments.error.code === '42703') {
    const basic = await supabase
      .from('notices')
      .select('id,title,body,category,created_at')
      .eq('id', noticeId)
      .maybeSingle();
    if (basic.error) throw basic.error;
    const row = basic.data as NoticeRow | null;
    return row
      ? {
          ...row,
          images: null,
          files: null,
          target: { version: 1, kind: 'notice', noticeId: row.id },
        }
      : null;
  }

  throw withAttachments.error;
}

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01';
}

async function fetchBoardHomeCategories(): Promise<BoardNoticeCategoryRow[]> {
  const { data, error } = await supabase
    .from('board_categories')
    .select('id,name,slug')
    .in('slug', [...BOARD_HOME_CATEGORY_SLUGS]);

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }

  return (data ?? []) as BoardNoticeCategoryRow[];
}

async function sendExpoPushPayloads(
  pushPayload: Array<Record<string, unknown>>,
): Promise<ExpoPushDeliverySummary> {
  const chunks: ExpoPushDeliverySummary[] = [];

  for (let index = 0; index < pushPayload.length; index += EXPO_PUSH_CHUNK_SIZE) {
    const chunk = pushPayload.slice(index, index + EXPO_PUSH_CHUNK_SIZE);
    try {
      const resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS),
      });

      const responseText = await resp.text().catch(() => '');
      let responseBody: unknown = null;
      try {
        responseBody = responseText ? JSON.parse(responseText) : null;
      } catch {
        responseBody = null;
      }
      chunks.push(classifyExpoPushDelivery(chunk.length, resp.status, responseBody));
    } catch (error: unknown) {
      const timedOut = isTimeoutError(error);
      reportEdgeDiagnostic({
        event: 'fc_notify.expo_push',
        reason: timedOut ? 'timeout' : 'request_failed',
        retryable: true,
        errorClass: timedOut ? 'timeout' : 'network',
      });
      chunks.push(classifyExpoPushDelivery(chunk.length, 0, null));
    }
  }

  return mergeExpoPushDeliverySummaries(chunks);
}

async function createBoardAttachmentSignedUrl(storagePath: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase.storage
      .from('board-attachments')
      .createSignedUrl(storagePath, BOARD_ATTACHMENT_SIGN_EXPIRES_SECONDS);
    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
  }
  return null;
}

async function fetchBoardNoticesWithAttachments(limit = 20): Promise<NoticeRow[]> {
  const categories = await fetchBoardHomeCategories();
  if (categories.length === 0) return [];

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const categoryIds = categories.map((category) => category.id);

  const { data: posts, error: postError } = await supabase
    .from('board_posts')
    .select('id,category_id,title,content,created_at')
    .in('category_id', categoryIds)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (postError) {
    if (isMissingTableError(postError)) return [];
    throw postError;
  }

  const postRows = (posts ?? []) as BoardNoticePostRow[];
  if (postRows.length === 0) return [];

  const postIds = postRows.map((row) => row.id);
  const { data: attachments, error: attachmentError } = await supabase
    .from('board_attachments')
    .select('id,post_id,file_type,file_name,file_size,mime_type,storage_path,sort_order,created_at')
    .in('post_id', postIds)
    .order('post_id', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (attachmentError) {
    if (isMissingTableError(attachmentError)) {
      return postRows.map((row) => ({
        id: `${BOARD_NOTICE_ID_PREFIX}${row.id}`,
        title: row.title,
        body: row.content,
        category: categoryById.get(row.category_id ?? '')?.name ?? '공지',
        created_at: row.created_at,
        images: null,
        files: null,
        target: { version: 1, kind: 'board_post', postId: row.id },
      }));
    }
    throw attachmentError;
  }

  const attachmentRows = (attachments ?? []) as BoardAttachmentRow[];
  const signedEntries = await Promise.all(
    attachmentRows.map(async (row) => [row.id, await createBoardAttachmentSignedUrl(row.storage_path)] as const),
  );
  const signedUrlMap = new Map<string, string>();
  signedEntries.forEach(([id, signedUrl]) => {
    if (signedUrl) {
      signedUrlMap.set(id, signedUrl);
    }
  });

  const imageMap = new Map<string, string[]>();
  const fileMap = new Map<string, NoticeFile[]>();

  attachmentRows.forEach((row) => {
    const signedUrl = signedUrlMap.get(row.id);
    if (!signedUrl) return;

    if (row.file_type === 'image') {
      const current = imageMap.get(row.post_id) ?? [];
      current.push(signedUrl);
      imageMap.set(row.post_id, current);
      return;
    }

    const currentFiles = fileMap.get(row.post_id) ?? [];
    currentFiles.push({
      name: row.file_name,
      url: signedUrl,
      type: row.mime_type ?? 'application/octet-stream',
    });
    fileMap.set(row.post_id, currentFiles);
  });

  return postRows.map((row) => ({
    id: `${BOARD_NOTICE_ID_PREFIX}${row.id}`,
    title: row.title,
    body: row.content,
    category: categoryById.get(row.category_id ?? '')?.name ?? '공지',
    created_at: row.created_at,
    images: imageMap.get(row.id) ?? null,
    files: fileMap.get(row.id) ?? null,
    target: { version: 1, kind: 'board_post', postId: row.id },
  }));
}

async function fetchUnifiedNotices(limit = 20): Promise<NoticeRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const [legacyNotices, boardNotices] = await Promise.all([
    fetchNoticesWithOptionalAttachments(safeLimit).catch((error) => {
      if (isMissingTableError(error)) return [] as NoticeRow[];
      throw error;
    }),
    fetchBoardNoticesWithAttachments(safeLimit).catch((error) => {
      if (isMissingTableError(error)) return [] as NoticeRow[];
      throw error;
    }),
  ]);

  const merged = [...legacyNotices, ...boardNotices];
  merged.sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    return bTime - aTime;
  });
  return merged.slice(0, safeLimit);
}

function getTargetUrl(role: 'admin' | 'fc', payload: Payload, message: string, fcId: string): string {
  const msg = message.toLowerCase();
  const explicitUrl =
    'url' in (payload as Record<string, unknown>) && typeof (payload as { url?: unknown }).url === 'string'
      ? String((payload as { url?: string }).url ?? '').trim()
      : '';

  if (explicitUrl) {
    return explicitUrl;
  }

  if (role === 'fc') {
    if (msg.includes('임시번호') || msg.includes('경력')) return '/consent';
    if (msg.includes('서류 요청')) return '/docs-upload';
    if (msg.includes('한화')) return '/hanwha-commission';
    if (msg.includes('보험 위촉')) return '/appointment';
    if (msg.includes('위촉 url') || msg.includes('위촉url') || msg.includes('위촉')) return '/appointment';
    return '/notifications';
  }

  if (msg.includes('보증 보험 동의')) return '/dashboard';
  if (msg.includes('한화')) return '/dashboard';
  if (msg.includes('업로드') || msg.includes('제출') || msg.includes('서류')) return `/docs-upload?userId=${fcId}`;
  return '/notifications';
}

function buildTitle(fcName: string | null, payload: Payload, message?: string) {
  const name = fcName ?? 'FC';
  const msg = (message ?? '').toLowerCase();

  if (payload.type === 'admin_update') {
    if (msg.includes('한화')) return '다위촉 안내';
    if (msg.includes('보험 위촉')) return '생명/손해 위촉 안내';
    if (msg.includes('위촉')) return '생명/손해 위촉 안내';
    if (msg.includes('temp')) return `${name}의 임시번호 안내`;
    if (msg.includes('docs') || msg.includes('서류')) return `${name} 서류 요청`;
    return `${name} 정보 업데이트`;
  }
  if (payload.type === 'fc_delete') {
    const parts = message?.split(' ') ?? [];
    const docName = parts.length > 1 ? parts[1].replace(/[:,]/g, '') : '파일';
    return `${name} ${docName} 삭제`;
  }
  if (payload.type === 'fc_update') {
    if (msg.includes('한화')) return `${name} 다위촉 제출`;
    if (msg.includes('기본') || msg.includes('정보')) return `${name} 기본 정보 업데이트`;
    if (msg.includes('temp')) return `${name}의 임시번호 안내`;
    if (msg.includes('서류') || msg.includes('업로드') || msg.includes('upload')) {
      const parts = message?.split(' ') ?? [];
      const docName = parts.length > 1 ? parts[1].replace(/[:,]/g, '') : '서류';
      return `${name} ${docName} 제출`;
    }
  }
  return `${name} 업데이트`;
}

function dedupeTokens(tokens: TokenRow[]): TokenRow[] {
  const seen = new Set<string>();
  return tokens.filter((token) => {
    const key = token.expo_push_token?.trim();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeAdminNotificationTargetId(value?: string | null): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === ADMIN_CHAT_ID) return '';
  return sanitize(value);
}

async function fetchSharedAdminPhones(): Promise<string[]> {
  const { data, error } = await supabase
    .from('admin_accounts')
    .select('phone,staff_type')
    .eq('active', true);
  if (error) throw error;

  return Array.from(
    new Set(
      ((data ?? []) as AdminAccountRow[])
        .filter((account) => account.staff_type !== 'developer')
        .map((account) => sanitize(account.phone))
        .filter((phone) => phone.length > 0),
    ),
  );
}

function getLifecycleNotificationTarget(fcId: string, targetUrl: string): NotificationTargetV1 {
  const sectionByPath: Record<string, 'home' | 'consent' | 'docs_upload' | 'hanwha_commission' | 'appointment'> = {
    '/consent': 'consent',
    '/docs-upload': 'docs_upload',
    '/hanwha-commission': 'hanwha_commission',
    '/appointment': 'appointment',
  };
  const section = sectionByPath[targetUrl]
    ?? (targetUrl === `/docs-upload?userId=${fcId}` ? 'docs_upload' : null);
  return section
    ? { version: 1, kind: 'onboarding_section', fcId, section }
    : { version: 1, kind: 'fc_profile', fcId };
}

type ActiveStaffTargetValidation = 'allowed' | 'denied' | 'failed';

async function validateActiveStaffNotificationTarget(
  targetId: string,
  targetRole: 'admin' | 'fc',
): Promise<ActiveStaffTargetValidation> {
  if (targetRole === 'fc') {
    const { data, error } = await supabase
      .from('fc_profiles')
      .select('phone')
      .eq('phone', targetId)
      .eq('signup_completed', true)
      .maybeSingle();

    if (error) return 'failed';
    return data?.phone && sanitize(data.phone) === targetId ? 'allowed' : 'denied';
  }

  const [adminsResult, managersResult] = await Promise.all([
    supabase
      .from('admin_accounts')
      .select('phone')
      .eq('active', true),
    supabase
      .from('manager_accounts')
      .select('phone')
      .eq('active', true),
  ]);

  if (adminsResult.error || managersResult.error) return 'failed';

  const isAllowed = [
    ...((adminsResult.data ?? []) as AdminAccountRow[]),
    ...((managersResult.data ?? []) as ManagerAccountRow[]),
  ].some((account) => sanitize(account.phone) === targetId);

  return isAllowed ? 'allowed' : 'denied';
}

async function resolveNotificationRecipientActorId(
  targetRole: 'admin' | 'fc',
  targetId: string | null,
): Promise<string | null> {
  if (!targetId) return null;
  if (targetRole === 'fc') {
    const { data, error } = await supabase
      .from('fc_profiles')
      .select('id')
      .eq('phone', targetId)
      .eq('signup_completed', true)
      .maybeSingle();
    if (error) throw error;
    return typeof data?.id === 'string' ? data.id : null;
  }

  const [adminResult, managerResult] = await Promise.all([
    supabase
      .from('admin_accounts')
      .select('id')
      .eq('phone', targetId)
      .eq('active', true),
    supabase
      .from('manager_accounts')
      .select('id')
      .eq('phone', targetId)
      .eq('active', true),
  ]);
  if (adminResult.error) throw adminResult.error;
  if (managerResult.error) throw managerResult.error;
  const candidates = [
    ...(adminResult.data ?? []),
    ...(managerResult.data ?? []),
  ]
    .map((row) => String(row.id ?? '').trim())
    .filter((id) => UUID_PATTERN.test(id));
  return candidates.length === 1 ? candidates[0] : null;
}

async function resolveFcUpdateAdminRecipientIds(fcAffiliation?: string | null): Promise<string[]> {
  const normalizedAffiliation = normalizeAffiliationLabel(fcAffiliation);
  const [adminsRes, mappingRes] = await Promise.all([
    supabase
      .from('admin_accounts')
      .select('phone')
      .eq('active', true),
    supabase
      .from('affiliation_manager_mappings')
      .select('manager_phone')
      .eq('active', true)
      .eq('affiliation', normalizedAffiliation),
  ]);

  if (adminsRes.error) throw adminsRes.error;
  if (mappingRes.error && mappingRes.error.code !== '42P01') throw mappingRes.error;

  const adminPhones = ((adminsRes.data ?? []) as AdminAccountRow[])
    .map((admin) => sanitize(admin.phone))
    .filter((phone) => phone.length > 0);

  const mappedManagerPhones = ((mappingRes.data ?? []) as AffiliationManagerMappingRow[])
    .map((row) => sanitize(row.manager_phone))
    .filter((phone) => phone.length > 0);

  let managerPhones: string[] = [];
  if (mappedManagerPhones.length > 0) {
    const { data: activeManagers, error: managerErr } = await supabase
      .from('manager_accounts')
      .select('phone')
      .eq('active', true)
      .in('phone', mappedManagerPhones);
    if (managerErr) throw managerErr;
    managerPhones = ((activeManagers ?? []) as ManagerAccountRow[])
      .map((manager) => sanitize(manager.phone))
      .filter((phone) => phone.length > 0);
  }

  return Array.from(new Set([...adminPhones, ...managerPhones]));
}

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

function ok(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function err(message: string, status = 400) {
  return new Response(message, { status, headers: corsHeaders });
}

function messengerAttachmentErrorResponse(error: unknown): Response {
  const mapped = error instanceof MessengerAttachmentServiceError
    ? error
    : mapMessengerAttachmentRpcError(error);
  return ok({
    ok: false,
    code: mapped.code,
    message: 'Attachment processing failed',
  }, mapped.status);
}

async function insertNotificationWithFallback(payload: NotificationInsert) {
  const sanitizedPayload = sanitizeNotificationInsert(payload);
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      ...sanitizedPayload,
      target_url: sanitizedPayload.target_url ?? null,
    })
    .select('id,target,recipient_role,recipient_actor_id,resident_id')
    .single();
  if (error) {
    return {
      error,
      id: null,
      failureReason: 'notification_insert_failed' as const,
    };
  }
  const validation = validatePersistedNotificationForDelivery(data, {
    target: sanitizedPayload.target,
    recipientRole: sanitizedPayload.recipient_role === 'admin' ? 'admin' : 'fc',
    recipientActorId: sanitizedPayload.recipient_actor_id ?? null,
    residentId: sanitizedPayload.resident_id,
  });
  return validation.ok === true
    ? { error: null, id: validation.notificationId, failureReason: null }
    : { error: null, id: null, failureReason: validation.reason };
}

async function verifyExistingNotificationForDelivery(input: {
  notificationId: string;
  target: NotificationTargetV1;
  recipientRole: 'admin' | 'fc';
  recipientActorId: string | null;
  residentId: string | null;
}) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id,target,recipient_role,recipient_actor_id,resident_id')
    .eq('id', input.notificationId)
    .maybeSingle();
  if (error) {
    return {
      error,
      id: null,
      failureReason: 'notification_lookup_failed' as const,
    };
  }
  const validation = validatePersistedNotificationForDelivery(data, {
    target: input.target,
    recipientRole: input.recipientRole,
    recipientActorId: input.recipientActorId,
    residentId: input.residentId,
  });
  return validation.ok === true
    ? { error: null, id: validation.notificationId, failureReason: null }
    : { error: null, id: null, failureReason: validation.reason };
}

async function fetchInternalFcProfiles() {
  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id,name,phone,affiliation')
    .eq('signup_completed', true);

  if (error) throw error;
  return (data ?? []) as {
    id: string;
    name: string | null;
    phone: string | null;
    affiliation: string | null;
  }[];
}

type FcNotifyActorResolution =
  | { ok: true; actor: FcNotifyAppActor }
  | { ok: false; status: 401 | 403 | 500; message: string };

async function resolveFcNotifyAppActor(
  session: AppSessionTokenPayload,
): Promise<FcNotifyActorResolution> {
  const phone = sanitize(session.phone);
  if (phone.length !== 11) {
    return { ok: false, status: 401, message: 'Invalid signed session actor' };
  }

  if (session.role === 'admin') {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('id,name,phone,active,staff_type')
      .eq('phone', phone)
      .eq('active', true)
      .maybeSingle();
    if (error) return { ok: false, status: 500, message: error.message };
    if (!data?.phone || sanitize(data.phone) !== phone) {
      return { ok: false, status: 403, message: 'Active admin account not found' };
    }
    return {
      ok: true,
      actor: {
        actorId: data.id,
        sessionRole: 'admin',
        phone,
        displayName: typeof data.name === 'string' ? data.name.trim() || null : null,
        staffType: data.staff_type === 'developer' ? 'developer' : 'admin',
        fcId: null,
        isRequestBoardDesigner: false,
      },
    };
  }

  if (session.role === 'manager') {
    const { data, error } = await supabase
      .from('manager_accounts')
      .select('id,name,phone,active')
      .eq('phone', phone)
      .eq('active', true)
      .maybeSingle();
    if (error) return { ok: false, status: 500, message: error.message };
    if (!data?.phone || sanitize(data.phone) !== phone) {
      return { ok: false, status: 403, message: 'Active manager account not found' };
    }
    return {
      ok: true,
      actor: {
        actorId: data.id,
        sessionRole: 'manager',
        phone,
        displayName: typeof data.name === 'string' ? data.name.trim() || null : null,
        staffType: null,
        fcId: null,
        isRequestBoardDesigner: false,
      },
    };
  }

  const query = supabase
    .from('fc_profiles')
    .select('id,name,phone,affiliation,signup_completed');
  const { data, error } = session.fcId
    ? await query.eq('id', session.fcId).maybeSingle()
    : await query.eq('phone', phone).maybeSingle();
  if (error) return { ok: false, status: 500, message: error.message };
  if (
    !data?.id
    || sanitize(data.phone) !== phone
    || data.signup_completed !== true
  ) {
    return { ok: false, status: 403, message: 'Completed FC profile not found' };
  }

  return {
    ok: true,
      actor: {
      actorId: data.id,
      sessionRole: 'fc',
      phone,
      displayName: typeof data.name === 'string' ? data.name.trim() || null : null,
      staffType: null,
      fcId: data.id,
      isRequestBoardDesigner: Boolean(parseDesignerCompanyNameFromAffiliation(data.affiliation)),
    },
  };
}

const VIEWER_BOUND_ACTIONS = new Set([
  'inbox_list',
  'inbox_get',
  'inbox_unread_count',
  'inbox_mark_read',
  'inbox_dismiss',
  'inbox_delete',
  'notice_get',
  'resolve_garamin_direct_conversation',
  'direct_message_list',
  'direct_message_send',
  'direct_message_broadcast_send',
  'direct_message_mark_read',
  'direct_message_delete',
  'message',
]);

async function resolveTrustedServiceViewer(
  body: Record<string, unknown>,
): Promise<FcNotifyActorResolution> {
  const phone = sanitize(String(body.viewer_actor_phone ?? ''));
  const requestedRole = String(body.viewer_actor_role ?? '');
  if (phone.length !== 11 || !['admin', 'manager', 'fc'].includes(requestedRole)) {
    return { ok: false, status: 401, message: 'Verified notification viewer is required' };
  }

  if (requestedRole === 'admin') {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('id,name,phone,active,staff_type')
      .eq('phone', phone)
      .eq('active', true)
      .maybeSingle();
    if (error) return { ok: false, status: 500, message: error.message };
    if (!data?.id || sanitize(data.phone) !== phone) {
      return { ok: false, status: 403, message: 'Active admin viewer not found' };
    }
    return {
      ok: true,
      actor: {
        actorId: data.id,
        sessionRole: 'admin',
        phone,
        displayName: typeof data.name === 'string' ? data.name.trim() || null : null,
        staffType: data.staff_type === 'developer' ? 'developer' : 'admin',
        fcId: null,
        isRequestBoardDesigner: false,
      },
    };
  }

  if (requestedRole === 'manager') {
    const { data, error } = await supabase
      .from('manager_accounts')
      .select('id,name,phone,active')
      .eq('phone', phone)
      .eq('active', true)
      .maybeSingle();
    if (error) return { ok: false, status: 500, message: error.message };
    if (!data?.id || sanitize(data.phone) !== phone) {
      return { ok: false, status: 403, message: 'Active manager viewer not found' };
    }
    return {
      ok: true,
      actor: {
        actorId: data.id,
        sessionRole: 'manager',
        phone,
        displayName: typeof data.name === 'string' ? data.name.trim() || null : null,
        staffType: null,
        fcId: null,
        isRequestBoardDesigner: false,
      },
    };
  }

  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id,name,phone,affiliation,signup_completed')
    .eq('phone', phone)
    .eq('signup_completed', true)
    .maybeSingle();
  if (error) return { ok: false, status: 500, message: error.message };
  if (!data?.id || sanitize(data.phone) !== phone) {
    return { ok: false, status: 403, message: 'Completed FC viewer not found' };
  }
  return {
    ok: true,
    actor: {
      actorId: data.id,
      sessionRole: 'fc',
      phone,
      displayName: typeof data.name === 'string' ? data.name.trim() || null : null,
      staffType: null,
      fcId: data.id,
      isRequestBoardDesigner: Boolean(parseDesignerCompanyNameFromAffiliation(data.affiliation)),
    },
  };
}

type DirectConversationResolution =
  | {
      ok: true;
      id: string;
      threadId: string;
      legacyConversationId: string;
      fcId: string;
      fcPhone: string;
      fcName: string | null;
      counterparty: DirectConversationCounterparty;
      counterpartyId: string;
      counterpartyName: string | null;
    }
  | { ok: false; status: 400 | 403 | 404 | 500; message: string };

type DirectConversationThreadRow = {
  id: string;
  legacy_conversation_id: string;
  counterparty_role: 'admin' | 'manager' | 'developer';
  counterparty_actor_id: string | null;
};

async function resolveActiveDirectCounterparty(input: {
  role: 'admin' | 'manager' | 'developer';
  actorId: string | null;
}): Promise<
  | {
      ok: true;
      counterparty: DirectConversationCounterparty;
      name: string | null;
    }
  | { ok: false; status: 400 | 403 | 404 | 500; message: string }
> {
  if (input.role === 'admin') {
    if (input.actorId !== null) {
      return { ok: false, status: 400, message: 'Direct conversation target is invalid' };
    }
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('id')
      .eq('active', true)
      .or('staff_type.neq.developer,staff_type.is.null')
      .limit(1);
    if (error) {
      return { ok: false, status: 500, message: 'Direct conversation target lookup failed' };
    }
    if (!data?.length) {
      return { ok: false, status: 404, message: 'Direct conversation target not found' };
    }
    return {
      ok: true,
      counterparty: { role: 'admin', actorId: null, phone: null },
      name: null,
    };
  }

  if (!input.actorId) {
    return { ok: false, status: 400, message: 'Direct conversation target is invalid' };
  }
  if (input.role === 'developer') {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('id,name,phone,staff_type,active')
      .eq('id', input.actorId)
      .eq('active', true)
      .eq('staff_type', 'developer')
      .maybeSingle();
    if (error) {
      return { ok: false, status: 500, message: 'Direct conversation target lookup failed' };
    }
    const phone = sanitize(data?.phone);
    if (!data?.id || phone.length !== 11) {
      return { ok: false, status: 404, message: 'Direct conversation target not found' };
    }
    return {
      ok: true,
      counterparty: { role: 'developer', actorId: data.id, phone },
      name: typeof data.name === 'string' ? data.name.trim() || null : null,
    };
  }

  const { data, error } = await supabase
    .from('manager_accounts')
    .select('id,name,phone,active')
    .eq('id', input.actorId)
    .eq('active', true)
    .maybeSingle();
  if (error) {
    return { ok: false, status: 500, message: 'Direct conversation target lookup failed' };
  }
  const phone = sanitize(data?.phone);
  if (!data?.id || phone.length !== 11) {
    return { ok: false, status: 404, message: 'Direct conversation target not found' };
  }
  return {
    ok: true,
    counterparty: { role: 'manager', actorId: data.id, phone },
    name: typeof data.name === 'string' ? data.name.trim() || null : null,
  };
}

async function resolveDirectCounterpartyFromTarget(
  targetId?: string | null,
): Promise<
  | {
      ok: true;
      counterparty: DirectConversationCounterparty;
      name: string | null;
    }
  | { ok: false; status: 400 | 403 | 404 | 500; message: string }
> {
  const rawTarget = String(targetId ?? '').trim().toLowerCase();
  if (!rawTarget || rawTarget === ADMIN_CHAT_ID) {
    return resolveActiveDirectCounterparty({ role: 'admin', actorId: null });
  }
  const targetPhone = sanitize(rawTarget);
  if (targetPhone.length !== 11) {
    return { ok: false, status: 400, message: 'Direct conversation target is invalid' };
  }
  const [developerResult, managerResult] = await Promise.all([
    supabase
      .from('admin_accounts')
      .select('id,name,phone')
      .eq('phone', targetPhone)
      .eq('active', true)
      .eq('staff_type', 'developer'),
    supabase
      .from('manager_accounts')
      .select('id,name,phone')
      .eq('phone', targetPhone)
      .eq('active', true),
  ]);
  if (developerResult.error || managerResult.error) {
    return { ok: false, status: 500, message: 'Direct conversation target lookup failed' };
  }
  const matches = [
    ...((developerResult.data ?? []) as Array<{ id: string }>).map((row) => ({
      role: 'developer' as const,
      actorId: row.id,
    })),
    ...((managerResult.data ?? []) as Array<{ id: string }>).map((row) => ({
      role: 'manager' as const,
      actorId: row.id,
    })),
  ];
  if (matches.length !== 1) {
    return {
      ok: false,
      status: matches.length === 0 ? 404 : 400,
      message:
        matches.length === 0
          ? 'Direct conversation target not found'
          : 'Direct conversation target is ambiguous',
    };
  }
  return resolveActiveDirectCounterparty(matches[0]);
}

type DirectCounterpartyResolution =
  Awaited<ReturnType<typeof resolveActiveDirectCounterparty>>;

async function resolveGaraminDirectConversation(input: {
  actor: FcNotifyAppActor;
  conversationId?: string | null;
  targetId?: string | null;
}): Promise<DirectConversationResolution> {
  let fcId: string | null = null;
  let thread: DirectConversationThreadRow | null = null;
  let counterpartyResult: DirectCounterpartyResolution | null = null;
  if (input.conversationId) {
    const { data: directThread, error: threadError } = await supabase
      .from('garamin_direct_threads')
      .select('id,legacy_conversation_id,counterparty_role,counterparty_actor_id')
      .eq('id', input.conversationId)
      .maybeSingle();
    if (threadError) {
      return { ok: false, status: 500, message: 'Direct conversation lookup failed' };
    }
    if (directThread?.id) {
      thread = directThread as DirectConversationThreadRow;
    } else {
      const { data: legacyConversation, error: legacyError } = await supabase
        .from('garamin_direct_conversations')
        .select('id,fc_id')
        .eq('id', input.conversationId)
        .maybeSingle();
      if (legacyError) {
        return { ok: false, status: 500, message: 'Direct conversation lookup failed' };
      }
      if (!legacyConversation?.id) {
        return { ok: false, status: 404, message: 'Direct conversation not found' };
      }
      const legacyCounterparty =
        input.actor.sessionRole === 'manager'
          ? { role: 'manager' as const, actorId: input.actor.actorId }
          : input.actor.sessionRole === 'admin'
              && input.actor.staffType === 'developer'
            ? { role: 'developer' as const, actorId: input.actor.actorId }
            : { role: 'admin' as const, actorId: null };
      const { data: matchingThread, error: matchingThreadError } = await supabase
        .from('garamin_direct_threads')
        .upsert({
          legacy_conversation_id: legacyConversation.id,
          counterparty_role: legacyCounterparty.role,
          counterparty_actor_id: legacyCounterparty.actorId,
        }, {
          onConflict:
            'legacy_conversation_id,counterparty_role,counterparty_actor_id',
        })
        .select('id,legacy_conversation_id,counterparty_role,counterparty_actor_id')
        .single();
      if (matchingThreadError) {
        return { ok: false, status: 500, message: 'Direct conversation lookup failed' };
      }
      if (!matchingThread?.id) {
        return { ok: false, status: 404, message: 'Direct conversation not found' };
      }
      thread = matchingThread as DirectConversationThreadRow;
    }
    const { data: legacyConversation, error: legacyError } = await supabase
      .from('garamin_direct_conversations')
      .select('id,fc_id')
      .eq('id', thread.legacy_conversation_id)
      .maybeSingle();
    if (legacyError) {
      return { ok: false, status: 500, message: 'Direct conversation lookup failed' };
    }
    if (!legacyConversation?.fc_id) {
      return { ok: false, status: 404, message: 'Direct conversation not found' };
    }
    fcId = legacyConversation.fc_id;
    counterpartyResult = await resolveActiveDirectCounterparty({
      role: thread.counterparty_role,
      actorId: thread.counterparty_actor_id,
    });
    if (counterpartyResult.ok === false) return counterpartyResult;
    if (!canAccessDirectConversation(input.actor, {
      fcActorId: legacyConversation.fc_id,
      counterparty: counterpartyResult.counterparty,
    })) {
      return { ok: false, status: 404, message: 'Direct conversation not found' };
    }
  } else {
    if (input.actor.sessionRole === 'fc') {
      fcId = input.actor.fcId;
      counterpartyResult = await resolveDirectCounterpartyFromTarget(input.targetId);
    } else {
      const targetPhone = sanitize(input.targetId);
      if (targetPhone.length !== 11) {
        return { ok: false, status: 400, message: 'Direct conversation target is invalid' };
      }
      const { data: target, error } = await supabase
        .from('fc_profiles')
        .select('id')
        .eq('phone', targetPhone)
        .eq('signup_completed', true)
        .maybeSingle();
      if (error) {
        return { ok: false, status: 500, message: 'Direct conversation target lookup failed' };
      }
      if (!target?.id) {
        return { ok: false, status: 404, message: 'Direct conversation target not found' };
      }
      fcId = target.id;
      counterpartyResult = await resolveActiveDirectCounterparty(
        input.actor.sessionRole === 'manager'
          ? { role: 'manager', actorId: input.actor.actorId }
          : input.actor.staffType === 'developer'
            ? { role: 'developer', actorId: input.actor.actorId }
            : { role: 'admin', actorId: null },
      );
    }
    if (!counterpartyResult) {
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation target lookup failed',
      };
    }
    if (counterpartyResult.ok === false) return counterpartyResult;
  }

  if (!fcId || !counterpartyResult) {
    return { ok: false, status: 403, message: 'Direct conversation is not allowed' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id,phone,name,signup_completed')
    .eq('id', fcId)
    .eq('signup_completed', true)
    .maybeSingle();
  if (profileError) return { ok: false, status: 500, message: 'Direct conversation target lookup failed' };
  const fcPhone = sanitize(profile?.phone);
  if (!profile?.id || fcPhone.length !== 11) {
    return { ok: false, status: 404, message: 'Direct conversation target not found' };
  }

  if (!thread) {
    const { data: legacyConversation, error: conversationError } = await supabase
      .from('garamin_direct_conversations')
      .upsert({ fc_id: fcId }, { onConflict: 'fc_id' })
      .select('id,fc_id')
      .single();
    if (conversationError || !legacyConversation?.id) {
      return { ok: false, status: 500, message: 'Direct conversation resolution failed' };
    }
    const { data: resolvedThread, error: resolvedThreadError } = await supabase
      .from('garamin_direct_threads')
      .upsert({
        legacy_conversation_id: legacyConversation.id,
        counterparty_role: counterpartyResult.counterparty.role,
        counterparty_actor_id: counterpartyResult.counterparty.actorId,
      }, {
        onConflict:
          'legacy_conversation_id,counterparty_role,counterparty_actor_id',
      })
      .select('id,legacy_conversation_id,counterparty_role,counterparty_actor_id')
      .single();
    if (resolvedThreadError || !resolvedThread?.id) {
      return { ok: false, status: 500, message: 'Direct conversation resolution failed' };
    }
    thread = resolvedThread as DirectConversationThreadRow;
  }

  return {
    ok: true,
    id: input.conversationId ?? thread.id,
    threadId: thread.id,
    legacyConversationId: thread.legacy_conversation_id,
    fcId,
    fcPhone,
    fcName: typeof profile.name === 'string' ? profile.name.trim() || null : null,
    counterparty: counterpartyResult.counterparty,
    counterpartyId:
      counterpartyResult.counterparty.role === 'admin'
        ? ADMIN_CHAT_ID
        : sanitize(counterpartyResult.counterparty.phone),
    counterpartyName: counterpartyResult.name,
  };
}

serve(async (req: Request) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return err('Method not allowed', 405);
  }

  let rawBody: Record<string, unknown>;
  try {
    const parsedBody: unknown = await req.json();
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return err('Invalid JSON', 400);
    }
    rawBody = parsedBody as Record<string, unknown>;
  } catch {
    return err('Invalid JSON', 400);
  }

  let body: Payload;
  let authMode: 'public' | 'service' | 'app';
  let appActor: FcNotifyAppActor | null = null;

  if (rawBody.type === 'latest_notice') {
    body = { type: 'latest_notice' };
    authMode = 'public';
  } else if (isTrustedFcNotifyServiceKey(req.headers.get('apikey'), serviceKey)) {
    authMode = 'service';
    if (VIEWER_BOUND_ACTIONS.has(String(rawBody.type ?? ''))) {
      const actorResult = await resolveTrustedServiceViewer(rawBody);
      if (actorResult.ok === false) {
        return err(actorResult.message, actorResult.status);
      }
      appActor = actorResult.actor;
      if (rawBody.type === 'message') {
        body = rawBody as unknown as Payload;
      } else {
        const policyResult = buildAppFcNotifyPayload(rawBody, actorResult.actor);
        if (policyResult.ok === false) {
          return err(policyResult.error, policyResult.status);
        }
        body = policyResult.payload as unknown as Payload;
      }
    } else {
      body = rawBody as unknown as Payload;
    }
  } else {
    const sessionResult = await requireAppSessionFromRequest(req);
    if (sessionResult.ok === false) {
      return err(sessionResult.message, sessionResult.status);
    }
    const actorResult = await resolveFcNotifyAppActor(sessionResult.session);
    if (actorResult.ok === false) {
      return err(actorResult.message, actorResult.status);
    }
    const policyResult = buildAppFcNotifyPayload(rawBody, actorResult.actor);
    if (policyResult.ok === false) {
      return err(policyResult.error, policyResult.status);
    }
    appActor = actorResult.actor;
    body = policyResult.payload as unknown as Payload;
    authMode = 'app';
  }

  if (body.type === 'resolve_garamin_direct_conversation') {
    if (!appActor) return err('Verified notification viewer is required', 401);
    const resolution = await resolveGaraminDirectConversation({
      actor: appActor,
      conversationId: body.conversation_id,
      targetId: body.target_id,
    });
    if (resolution.ok === false) return err(resolution.message, resolution.status);
    return ok({
      ok: true,
      conversation: {
        id: resolution.id,
        counterparty_id:
          appActor.sessionRole === 'fc'
            ? resolution.counterpartyId
            : resolution.fcPhone,
        counterparty_name:
          appActor.sessionRole === 'fc'
            ? resolution.counterpartyName
            : resolution.fcName,
      },
    });
  }

  if (body.type === 'direct_message_broadcast_send') {
    if (
      !appActor
      || appActor.sessionRole !== 'admin'
      || !['admin', 'developer'].includes(String(appActor.staffType ?? 'admin'))
    ) {
      return err('Direct broadcast messaging is not allowed', 403);
    }
    const resolutions = await Promise.all(
      body.conversation_ids.map((conversationId) =>
        resolveGaraminDirectConversation({
          actor: appActor!,
          conversationId,
        })
      ),
    );
    const failedResolution = resolutions.find((resolution) => resolution.ok === false);
    if (failedResolution?.ok === false) {
      return err(failedResolution.message, failedResolution.status);
    }
    const directResolutions = resolutions.filter(
      (resolution): resolution is Extract<DirectConversationResolution, { ok: true }> =>
        resolution.ok,
    );
    if (directResolutions.length !== body.conversation_ids.length) {
      return err('Direct conversation lookup failed', 500);
    }

    let finalized: Awaited<ReturnType<typeof finalizeMessengerAttachmentBatch>>;
    try {
      finalized = await finalizeMessengerAttachmentBatch({
        supabase,
        actor: { id: appActor.actorId, role: 'admin' },
        deliveryKey: body.delivery_key,
        payloadFingerprint: body.payload_fingerprint,
        intentIds: body.attachment_intent_ids,
      });
    } catch (error) {
      return messengerAttachmentErrorResponse(error);
    }
    const commit = await supabase.rpc(
      'commit_garamin_direct_broadcast_with_attachments_v2',
      {
        p_message_ids: body.client_message_ids,
        p_conversation_ids: body.conversation_ids,
        p_sender_actor_id: appActor.actorId,
        p_content: body.content,
        p_delivery_key: body.delivery_key,
        p_payload_fingerprint: body.payload_fingerprint,
        p_attachment_intent_ids: body.attachment_intent_ids,
      },
    );
    if (commit.error || !commit.data || typeof commit.data !== 'object') {
      return messengerAttachmentErrorResponse(commit.error);
    }
    const atomic = commit.data as Record<string, unknown>;
    const resolutionByPhone = new Map(
      directResolutions.map((resolution) => [resolution.fcPhone, resolution]),
    );
    const rawNotifications = Array.isArray(atomic.notifications)
      ? atomic.notifications
      : [];
    const persistedNotifications: Array<{
      notificationId: string;
      residentId: string;
      recipientActorId: string;
      target: Extract<NotificationTargetV1, { kind: 'garamin_direct_chat' }>;
    }> = [];
    for (const rawRow of rawNotifications) {
      if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) continue;
      const row = rawRow as Record<string, unknown>;
      const residentId = typeof row.resident_id === 'string' ? row.resident_id.trim() : '';
      const resolution = resolutionByPhone.get(residentId);
      if (!resolution) continue;
      const target: NotificationTargetV1 = {
        version: 1,
        kind: 'garamin_direct_chat',
        conversationId: resolution.id,
      };
      const validation = validatePersistedNotificationForDelivery(row, {
        target,
        recipientRole: 'fc',
        recipientActorId: resolution.fcId,
        residentId,
      });
      if (!validation.ok) continue;
      persistedNotifications.push({
        notificationId: validation.notificationId,
        residentId,
        recipientActorId: resolution.fcId,
        target,
      });
    }
    if (
      persistedNotifications.length !== directResolutions.length
      || persistedNotifications.length !== rawNotifications.length
    ) {
      return ok({
        ok: false,
        message: 'Direct message notification persistence failed',
        delivery: buildDeliveryMetadata({
          notificationStored: false,
          pushStatus: 'not_attempted',
          retryable: true,
        }),
      }, 500);
    }

    const messageColumns =
      'id,conversation_id,thread_id,sender_id,receiver_id,sender_actor_id,receiver_actor_id,content,created_at,'
      + 'is_read,message_type,file_url,file_name,file_size,attachment_batch_id,deleted_at,deleted_by_actor_id';
    const messageResult = await supabase
      .from('messages')
      .select(messageColumns)
      .in('id', body.client_message_ids)
      .is('deleted_at', null);
    if (messageResult.error || (messageResult.data?.length ?? 0) !== body.client_message_ids.length) {
      return ok({
        ok: false,
        message: 'Direct message lookup failed',
        delivery: buildDeliveryMetadata({
          notificationStored: true,
          pushStatus: 'not_attempted',
          retryable: true,
          notificationIds: persistedNotifications.map((row) => row.notificationId),
        }),
      }, 500);
    }
    let attachments: MessengerAttachmentMetadata[];
    try {
      const attachmentMap = await listMessengerAttachmentsByBatchIds({
        supabase,
        batchIds: [finalized.batchId],
      });
      attachments = attachmentMap.get(finalized.batchId) ?? [];
    } catch (error) {
      return messengerAttachmentErrorResponse(error);
    }
    const resolutionById = new Map(
      directResolutions.map((resolution) => [resolution.threadId, resolution]),
    );
    const normalizedMessages = ((messageResult.data ?? []) as unknown as DirectMessageRow[])
      .sort((left, right) =>
        body.client_message_ids.indexOf(left.id) - body.client_message_ids.indexOf(right.id)
      )
      .map((row) => ({
        id: row.id,
        conversation_id:
          (row.thread_id ? resolutionById.get(row.thread_id)?.id : null)
          ?? row.conversation_id,
        sender_id: row.sender_id,
        receiver_id: row.receiver_id,
        content: row.content,
        created_at: row.created_at,
        is_read: row.is_read === true,
        message_type: row.message_type ?? 'text',
        file_url: row.file_url,
        file_name: row.file_name,
        file_size: row.file_size,
        attachments,
        counterparty_name: row.thread_id
          ? resolutionById.get(row.thread_id)?.fcName ?? null
          : null,
      }));
    const replayed = finalized.replayed || atomic.replayed === true;
    const notificationIds = persistedNotifications.map((row) => row.notificationId);
    if (replayed) {
      return ok({
        ok: true,
        messages: normalizedMessages,
        attachmentCommit: { batchId: finalized.batchId, replayed: true },
        delivery: buildDeliveryMetadata({
          notificationStored: true,
          pushStatus: 'not_attempted',
          retryable: false,
          notificationIds,
        }),
      });
    }

    const recipientPhones = persistedNotifications.map((row) => row.residentId);
    const tokenResult = await supabase
      .from('device_tokens')
      .select('expo_push_token,resident_id,display_name,role')
      .in('resident_id', recipientPhones);
    const notificationByResident = new Map(
      persistedNotifications.map((row) => [row.residentId, row]),
    );
    const eligibleTokens = tokenResult.error
      ? []
      : dedupeTokens(((tokenResult.data ?? []) as TokenRow[]).filter((token) => {
        const notification = notificationByResident.get(String(token.resident_id ?? ''));
        return Boolean(
          notification
          && getAllowedNotificationTokenRoles('fc', 'message')
            .includes(String(token.role ?? '') as 'admin' | 'manager' | 'fc'),
        );
      }));
    const preview = body.content || '첨부파일을 보냈습니다.';
    const expoDelivery = tokenResult.error
      ? { attempted: 0, accepted: 0, rejected: 0 }
      : await sendExpoPushPayloads(eligibleTokens.map((token) => {
        const notification = notificationByResident.get(String(token.resident_id ?? ''))!;
        return {
          to: token.expo_push_token,
          title: '새 메시지',
          body: preview.slice(0, 160),
          data: {
            url: '/chat',
            type: 'message',
            notificationId: notification.notificationId,
            target: notification.target,
            conversationId: notification.target.conversationId,
          },
          sound: 'default',
          priority: 'high',
          channelId: 'alerts',
        };
      }));
    const providerRejected = Boolean(tokenResult.error) || expoDelivery.rejected > 0;
    const pushStatus = providerRejected
      ? 'provider_rejected' as const
      : expoDelivery.accepted > 0
        ? 'accepted' as const
        : 'no_registered_device' as const;
    return ok({
      ok: true,
      messages: normalizedMessages,
      attachmentCommit: { batchId: finalized.batchId, replayed: false },
      delivery: buildDeliveryMetadata({
        notificationStored: true,
        pushStatus,
        retryable: providerRejected,
        notificationIds,
        attempted: expoDelivery.attempted,
        accepted: expoDelivery.accepted,
        rejected: expoDelivery.rejected,
      }),
    });
  }

  if (
    body.type === 'direct_message_list'
    || body.type === 'direct_message_send'
    || body.type === 'direct_message_mark_read'
    || body.type === 'direct_message_delete'
  ) {
    if (!appActor) return err('Verified direct message actor is required', 401);
    const resolution = await resolveGaraminDirectConversation({
      actor: appActor,
      conversationId: body.conversation_id,
    });
    if (resolution.ok === false) {
      return err(
        resolution.message,
        resolution.status,
      );
    }

    const identity = buildDirectMessageIdentity({
      actor: appActor,
      fcActorId: resolution.fcId,
      fcPhone: resolution.fcPhone,
      counterparty: resolution.counterparty,
    });
    if (!identity) return err('Direct messaging is not allowed', 403);

    const messageColumns =
      'id,conversation_id,thread_id,sender_id,receiver_id,sender_actor_id,receiver_actor_id,content,created_at,'
      + 'is_read,message_type,file_url,file_name,file_size,attachment_batch_id,deleted_at,deleted_by_actor_id';
    const legacyActorId = appActor.sessionRole === 'fc'
      ? resolution.fcPhone
      : appActor.sessionRole === 'manager' || appActor.staffType === 'developer'
        ? sanitize(appActor.phone)
        : ADMIN_CHAT_ID;
    const legacyCounterpartId = appActor.sessionRole === 'fc'
      ? resolution.counterpartyId
      : resolution.fcPhone;
    const buildCurrentMessageQuery = (ordered: boolean) => {
      let query = supabase
        .from('messages')
        .select(messageColumns);
      query = resolution.counterparty.role === 'admin'
        ? query.or(
          `thread_id.eq.${resolution.threadId},`
          + `and(thread_id.is.null,conversation_id.eq.${resolution.legacyConversationId})`,
        )
        : query.eq('thread_id', resolution.threadId);
      return ordered ? query.order('created_at', { ascending: true }) : query;
    };
    const normalizeMessage = (
      row: DirectMessageRow,
      attachments: MessengerAttachmentMetadata[] = [],
    ) => ({
      id: row.id,
      conversation_id: resolution.id,
      sender_id: row.sender_id,
      receiver_id: row.receiver_id,
      content: row.content,
      created_at: row.created_at,
      is_read: row.is_read === true,
      message_type: row.message_type ?? 'text',
      file_url: row.file_url,
      file_name: row.file_name,
      file_size: row.file_size,
      attachments,
    });

    if (body.type === 'direct_message_list') {
      const [currentResult, legacyResult] = await Promise.all([
        buildCurrentMessageQuery(true),
        supabase
          .from('messages')
          .select(messageColumns)
          .is('conversation_id', null)
          .or(
            `and(sender_id.eq.${legacyActorId},receiver_id.eq.${legacyCounterpartId}),`
            + `and(sender_id.eq.${legacyCounterpartId},receiver_id.eq.${legacyActorId})`,
          )
          .order('created_at', { ascending: true }),
      ]);
      if (currentResult.error || legacyResult.error) {
        return err('Direct message lookup failed', 500);
      }

      const currentRows = ((currentResult.data ?? []) as unknown as DirectMessageRow[])
        .filter((row) =>
          row.deleted_at === null
          && (
            isCurrentDirectMessageVisible({
              fcActorId: resolution.fcId,
              fcPhone: resolution.fcPhone,
              counterparty: resolution.counterparty,
              row,
            })
            || (
              !row.sender_actor_id
              && !row.receiver_actor_id
              && isLegacyDirectMessageVisible({
                actor: appActor,
                fcPhone: resolution.fcPhone,
                counterpartyId: resolution.counterpartyId,
                row,
              })
            )
          )
        );
      const legacyRows = ((legacyResult.data ?? []) as unknown as DirectMessageRow[])
        .filter((row) =>
          row.deleted_at === null
          && isLegacyDirectMessageVisible({
            actor: appActor,
            fcPhone: resolution.fcPhone,
            counterpartyId: resolution.counterpartyId,
            row,
          })
        );
      const uniqueRows = Array.from(
        new Map(
          [...currentRows, ...legacyRows].map((row) => [row.id, row]),
        ).values(),
      ).sort((left, right) => {
        const created = left.created_at.localeCompare(right.created_at);
        return created || left.id.localeCompare(right.id);
      });
      let attachmentsByBatch: Map<string, MessengerAttachmentMetadata[]>;
      try {
        attachmentsByBatch = await listMessengerAttachmentsByBatchIds({
          supabase,
          batchIds: uniqueRows.map((row) => row.attachment_batch_id),
        });
      } catch (error) {
        return messengerAttachmentErrorResponse(error);
      }

      return ok({
        ok: true,
        conversation: {
          id: resolution.id,
          counterparty_id:
            appActor.sessionRole === 'fc'
              ? resolution.counterpartyId
              : resolution.fcPhone,
          counterparty_name:
            appActor.sessionRole === 'fc'
              ? resolution.counterpartyName
              : resolution.fcName,
        },
        messages: uniqueRows.map((row) =>
          normalizeMessage(
            row,
            row.attachment_batch_id
              ? attachmentsByBatch.get(row.attachment_batch_id) ?? []
              : [],
          )
        ),
      });
    }

    if (body.type === 'direct_message_send') {
      const messageId = UUID_PATTERN.test(String(body.client_message_id ?? ''))
        ? String(body.client_message_id).toLowerCase()
        : crypto.randomUUID();
      const directTarget: NotificationTargetV1 = {
        version: 1,
        kind: 'garamin_direct_chat',
        conversationId: resolution.id,
      };
      const attachmentIntentIds = body.attachment_intent_ids ?? [];
      const hasAttachments = attachmentIntentIds.length > 0;
      let attachmentBatchId: string | null = null;
      let attachmentReplay = false;
      let atomicResult: unknown;
      let atomicError: unknown = null;
      if (hasAttachments) {
        try {
          const finalized = await finalizeMessengerAttachmentBatch({
            supabase,
            actor: {
              id: appActor.actorId,
              role: appActor.sessionRole,
            },
            deliveryKey: body.delivery_key!,
            payloadFingerprint: body.payload_fingerprint!,
            intentIds: attachmentIntentIds,
          });
          attachmentBatchId = finalized.batchId;
          attachmentReplay = finalized.replayed;
          const attachmentCommit = await supabase.rpc(
            'commit_garamin_direct_message_with_attachments_v2',
            {
              p_message_id: messageId,
              p_conversation_id: resolution.id,
              p_sender_id: identity.senderId,
              p_receiver_id: identity.receiverId,
              p_sender_actor_id: identity.senderActorId,
              p_receiver_actor_id: identity.receiverActorId,
              p_content: body.content,
              p_delivery_key: body.delivery_key,
              p_payload_fingerprint: body.payload_fingerprint,
              p_attachment_intent_ids: attachmentIntentIds,
            },
          );
          atomicResult = attachmentCommit.data;
          atomicError = attachmentCommit.error;
        } catch (error) {
          return messengerAttachmentErrorResponse(error);
        }
      } else {
        const textCommit = await supabase.rpc(
          'send_garamin_direct_message_with_notification',
          {
            p_message_id: messageId,
            p_conversation_id: resolution.id,
            p_sender_id: identity.senderId,
            p_receiver_id: identity.receiverId,
            p_sender_actor_id: identity.senderActorId,
            p_receiver_actor_id: identity.receiverActorId,
            p_content: body.content,
          },
        );
        atomicResult = textCommit.data;
        atomicError = textCommit.error;
      }
      if (atomicError || !atomicResult || typeof atomicResult !== 'object') {
        if (hasAttachments && atomicError) {
          return messengerAttachmentErrorResponse(atomicError);
        }
        return ok({
          ok: false,
          message: 'Direct message notification persistence failed',
          delivery: buildDeliveryMetadata({
            notificationStored: false,
            pushStatus: 'not_attempted',
            retryable: true,
          }),
        }, 500);
      }
      const atomic = atomicResult as Record<string, unknown>;
      const rawNotifications = Array.isArray(atomic.notifications)
        ? atomic.notifications
        : [];
      const persistedNotifications: Array<{
        notificationId: string;
        residentId: string;
        recipientActorId: string;
        recipientRole: 'admin' | 'manager' | 'fc';
      }> = [];
      for (const rawRow of rawNotifications) {
        if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) continue;
        const row = rawRow as Record<string, unknown>;
        const residentId = typeof row.resident_id === 'string' ? row.resident_id.trim() : '';
        const recipientActorId = typeof row.recipient_actor_id === 'string'
          ? row.recipient_actor_id.trim()
          : '';
        const recipientRole =
          row.recipient_role === 'admin'
            ? 'admin'
            : row.recipient_role === 'manager'
              ? 'manager'
              : 'fc';
        const validation = validatePersistedNotificationForDelivery(row, {
          target: directTarget,
          recipientRole,
          recipientActorId,
          residentId,
        });
        if (!validation.ok || !residentId || !recipientActorId) continue;
        persistedNotifications.push({
          notificationId: validation.notificationId,
          residentId,
          recipientActorId,
          recipientRole,
        });
      }
      if (
        persistedNotifications.length === 0
        || persistedNotifications.length !== rawNotifications.length
      ) {
        return ok({
          ok: false,
          message: 'Direct message notification persistence failed',
          delivery: buildDeliveryMetadata({
            notificationStored: false,
            pushStatus: 'not_attempted',
            retryable: true,
          }),
        }, 500);
      }

      const { data, error } = await supabase
        .from('messages')
        .select(messageColumns)
        .eq('id', messageId)
        .eq('thread_id', resolution.threadId)
        .maybeSingle();
      if (error || !data) {
        return ok({
          ok: false,
          message: 'Direct message lookup failed',
          delivery: buildDeliveryMetadata({
            notificationStored: true,
            pushStatus: 'not_attempted',
            retryable: true,
            notificationIds: persistedNotifications.map((row) => row.notificationId),
          }),
        }, 500);
      }
      let messageAttachments: MessengerAttachmentMetadata[] = [];
      if (attachmentBatchId) {
        try {
          const attachmentMap = await listMessengerAttachmentsByBatchIds({
            supabase,
            batchIds: [attachmentBatchId],
          });
          messageAttachments = attachmentMap.get(attachmentBatchId) ?? [];
        } catch (attachmentError) {
          return messengerAttachmentErrorResponse(attachmentError);
        }
      }
      const attachmentWasReplayed = hasAttachments
        && (attachmentReplay || atomic.replayed === true);
      if (attachmentWasReplayed) {
        const notificationIds = persistedNotifications.map((row) => row.notificationId);
        return ok({
          ok: true,
          message: normalizeMessage(data as unknown as DirectMessageRow, messageAttachments),
          attachmentCommit: {
            batchId: attachmentBatchId,
            replayed: true,
          },
          delivery: buildDeliveryMetadata({
            notificationStored: true,
            pushStatus: 'not_attempted',
            retryable: false,
            ...(notificationIds.length === 1
              ? { notificationId: notificationIds[0] }
              : { notificationIds }),
          }),
        });
      }

      const recipientPhones = Array.from(
        new Set(persistedNotifications.map((row) => row.residentId)),
      );
      const { data: tokenRows, error: tokenError } = await supabase
        .from('device_tokens')
        .select('expo_push_token,resident_id,display_name,role')
        .in('resident_id', recipientPhones);
      const notificationByResident = new Map(
        persistedNotifications.map((row) => [row.residentId, row]),
      );
      const eligibleTokens = tokenError
        ? []
        : dedupeTokens(((tokenRows ?? []) as TokenRow[]).filter((token) => {
          const notification = notificationByResident.get(String(token.resident_id ?? ''));
          return Boolean(
            notification
            && (
              notification.recipientRole === 'manager'
                ? ['manager']
                : getAllowedNotificationTokenRoles(
                  notification.recipientRole,
                  'message',
                )
            )
              .includes(String(token.role ?? '') as 'admin' | 'manager' | 'fc'),
          );
        }));
      const pushPayload = eligibleTokens.map((token) => {
        const notification = notificationByResident.get(String(token.resident_id ?? ''))!;
        const preview = body.content || '첨부파일을 보냈습니다.';
        return {
          to: token.expo_push_token,
          title: '새 메시지',
          body: preview.slice(0, 160),
          data: {
            url: '/chat',
            type: 'message',
            notificationId: notification.notificationId,
            target: directTarget,
            conversationId: resolution.id,
          },
          sound: 'default',
          priority: 'high',
          channelId: 'alerts',
        };
      });
      const adminWebResults = await Promise.all(
        persistedNotifications
          .filter((notification) => notification.recipientRole === 'admin')
          .map((notification) => {
            const preview = body.content || '첨부파일을 보냈습니다.';
            return (
            notifyAdminWebPush(
              '새 메시지',
              preview.slice(0, 160),
              '/chat',
              notification.residentId,
              notification.notificationId,
              directTarget,
            )
            );
          }),
      );
      const expoDelivery = tokenError
        ? { attempted: 0, accepted: 0, rejected: 0 }
        : await sendExpoPushPayloads(pushPayload);
      const webAccepted = adminWebResults.reduce(
        (sum, result) => sum + (result.ok ? result.sent : 0),
        0,
      );
      const providerRejected = Boolean(tokenError)
        || expoDelivery.rejected > 0
        || adminWebResults.some((result) => !result.ok && !result.noTarget);
      const providerAccepted = expoDelivery.accepted > 0 || webAccepted > 0;
      const pushStatus = providerRejected
        ? 'provider_rejected' as const
        : providerAccepted
          ? 'accepted' as const
          : 'no_registered_device' as const;
      const notificationIds = persistedNotifications.map((row) => row.notificationId);
      return ok({
        ok: true,
        message: normalizeMessage(data as unknown as DirectMessageRow, messageAttachments),
        ...(attachmentBatchId
          ? {
            attachmentCommit: {
              batchId: attachmentBatchId,
              replayed: attachmentReplay || atomic.replayed === true,
            },
          }
          : {}),
        delivery: buildDeliveryMetadata({
          notificationStored: true,
          pushStatus,
          retryable: providerRejected,
          ...(notificationIds.length === 1
            ? { notificationId: notificationIds[0] }
            : { notificationIds }),
          attempted: expoDelivery.attempted,
          accepted: expoDelivery.accepted + webAccepted,
          rejected: expoDelivery.rejected,
        }),
      });
    }

    const [currentResult, legacyResult] = await Promise.all([
      buildCurrentMessageQuery(false),
      supabase
        .from('messages')
        .select(messageColumns)
        .is('conversation_id', null)
        .or(
          `and(sender_id.eq.${legacyActorId},receiver_id.eq.${legacyCounterpartId}),`
          + `and(sender_id.eq.${legacyCounterpartId},receiver_id.eq.${legacyActorId})`,
        ),
    ]);
    if (currentResult.error || legacyResult.error) {
      return err('Direct message ownership lookup failed', 500);
    }

    const currentRows = ((currentResult.data ?? []) as unknown as DirectMessageRow[])
      .filter((row) =>
        row.deleted_at === null
        && (
          isCurrentDirectMessageVisible({
            fcActorId: resolution.fcId,
            fcPhone: resolution.fcPhone,
            counterparty: resolution.counterparty,
            row,
          })
          || (
            !row.sender_actor_id
            && !row.receiver_actor_id
            && isLegacyDirectMessageVisible({
              actor: appActor,
              fcPhone: resolution.fcPhone,
              counterpartyId: resolution.counterpartyId,
              row,
            })
          )
        )
      );
    const legacyRows = ((legacyResult.data ?? []) as unknown as DirectMessageRow[])
      .filter((row) =>
        row.deleted_at === null
        && isLegacyDirectMessageVisible({
          actor: appActor,
          fcPhone: resolution.fcPhone,
          counterpartyId: resolution.counterpartyId,
          row,
        })
      );

    if (body.type === 'direct_message_mark_read') {
      const incomingIds = Array.from(new Set(
        [...currentRows, ...legacyRows]
          .filter((row) => row.receiver_id === identity.senderId && row.is_read !== true)
          .map((row) => row.id),
      ));
      if (incomingIds.length === 0) return ok({ ok: true, updated: 0 });
      const { data, error } = await supabase
        .from('messages')
        .update({ is_read: true })
        .in('id', incomingIds)
        .select('id');
      if (error) return err('Direct message read update failed', 500);
      return ok({ ok: true, updated: data?.length ?? 0 });
    }

    const deleteMessageId =
      body.type === 'direct_message_delete' ? body.message_id : null;
    const candidate = [...currentRows, ...legacyRows]
      .find((row) => row.id === deleteMessageId);
    if (
      !candidate
      || !canDeleteDirectMessage({
        actor: appActor,
        fcPhone: resolution.fcPhone,
        counterpartyId: resolution.counterpartyId,
        row: candidate,
      })
    ) {
      return err('Direct message not found', 404);
    }
    if (candidate.attachment_batch_id) {
      const deletion = await supabase.rpc(
        'delete_messenger_attachment_delivery_v2',
        {
          p_message_kind: 'direct',
          p_message_id: candidate.id,
          p_actor_id: appActor.actorId,
          p_actor_role: appActor.sessionRole,
          p_group_actor_id: null,
        },
      );
      if (deletion.error) {
        return messengerAttachmentErrorResponse(deletion.error);
      }
      const result = deletion.data && typeof deletion.data === 'object'
        ? deletion.data as Record<string, unknown>
        : {};
      const batchId = typeof result.batchId === 'string'
        ? result.batchId
        : candidate.attachment_batch_id;
      const cleanup = await drainMessengerAttachmentCleanup({
        supabase,
        limit: 20,
        batchId,
      });
      return ok({
        ok: true,
        deleted: true,
        cleanup: {
          scheduled: Number(result.scheduled ?? 0),
          removed: cleanup.removed,
          requeued: cleanup.requeued,
          exhausted: cleanup.exhausted,
        },
      });
    }
    const { data, error } = await supabase
      .from('messages')
      .update({
        content: '',
        deleted_at: new Date().toISOString(),
        deleted_by_actor_id: appActor.actorId,
      })
      .eq('id', candidate.id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (error || !data?.id) return err('Direct message delete failed', 500);
    return ok({ ok: true, deleted: true });
  }

  if (body.type === 'chat_targets') {
    const residentId = sanitize(body.resident_id);
    if (!residentId) {
      return err('resident_id is required', 400);
    }

    const { data: fcProfile, error: fcProfileErr } = await supabase
      .from('fc_profiles')
      .select('id')
      .eq('phone', residentId)
      .eq('signup_completed', true)
      .maybeSingle();
    if (fcProfileErr) return err(fcProfileErr.message, 500);
    if (!fcProfile?.id) return err('FC profile not found', 403);

    const [
      { data: managers, error: managerErr },
      { data: developers, error: developerErr },
      { data: admins, error: adminErr },
    ] = await Promise.all([
      supabase
        .from('manager_accounts')
        .select('name,phone')
        .eq('active', true)
        .order('name'),
      supabase
        .from('admin_accounts')
        .select('name,phone,staff_type')
        .eq('active', true)
        .eq('staff_type', 'developer')
        .order('name'),
      supabase
        .from('admin_accounts')
        .select('name,phone,staff_type')
        .eq('active', true)
        .neq('staff_type', 'developer')
        .order('name'),
    ]);
    if (managerErr) return err(managerErr.message, 500);
    if (developerErr) return err(developerErr.message, 500);
    if (adminErr) return err(adminErr.message, 500);

    const targetSenderIds = Array.from(
      new Set(
        [
          ...((managers ?? []) as { phone?: string | null }[]).map((manager) => sanitize(manager.phone)),
          ...((developers ?? []) as { phone?: string | null }[]).map((developer) => sanitize(developer.phone)),
          ADMIN_CHAT_ID,
        ].filter((value) => value.length > 0),
      ),
    );

    let chatSummaries = buildDirectChatTargetSummaries({
      viewerId: residentId,
      targetIds: targetSenderIds,
      messages: [],
    });
    if (targetSenderIds.length > 0) {
      const targetFilter = targetSenderIds.join(',');
      const { data: messageRows, error: messageErr } = await supabase
        .from('messages')
        .select('sender_id,receiver_id,content,created_at,is_read,file_name,attachment_batch_id,deleted_at')
        .or(
          `and(sender_id.eq.${residentId},receiver_id.in.(${targetFilter})),`
          + `and(receiver_id.eq.${residentId},sender_id.in.(${targetFilter}))`,
        )
        .order('created_at', { ascending: false });
      if (messageErr) return err(messageErr.message, 500);
      let summaryRows: InternalChatMessageRow[];
      try {
        summaryRows = await buildInternalChatSummaryRows(
          (messageRows ?? []) as unknown as InternalChatMessageAttachmentRow[],
        );
      } catch (error) {
        return messengerAttachmentErrorResponse(error);
      }
      chatSummaries = buildDirectChatTargetSummaries({
        viewerId: residentId,
        targetIds: targetSenderIds,
        messages: summaryRows,
      });
    }

    const adminSummary = chatSummaries[ADMIN_CHAT_ID] ?? {
      last_message: null,
      last_time: null,
      unread_count: 0,
    };

    return ok({
      ok: true,
      managers: attachChatSummariesToContacts(
        (managers ?? [])
          .map((manager) => ({
            name: typeof manager.name === 'string' ? manager.name : '',
            phone: sanitize(manager.phone),
          }))
          .filter((manager) => manager.phone.length > 0),
        chatSummaries,
      ),
      developers: attachChatSummariesToContacts(
        ((developers ?? []) as AdminAccountRow[])
          .map((developer) => ({
            name: typeof developer.name === 'string' ? developer.name : '',
            phone: sanitize(developer.phone),
          }))
          .filter((developer) => developer.phone.length > 0),
        chatSummaries,
      ),
      admins: ((admins ?? []) as AdminAccountRow[])
        .map((admin) => ({
          name: typeof admin.name === 'string' ? admin.name : '',
          phone: sanitize(admin.phone),
          staff_type: typeof admin.staff_type === 'string' ? admin.staff_type : null,
          ...adminSummary,
        }))
        .filter((admin) => admin.phone.length > 0),
      admin_unread_count: adminSummary.unread_count,
    });
  }

  if (body.type === 'internal_chat_list') {
    const viewerId = String(body.viewer_id ?? '').trim();
    if (!viewerId) {
      return err('viewer_id is required', 400);
    }
    if (body.viewer_role !== 'admin') {
      return err('viewer_role is not allowed', 403);
    }

    try {
      const [participants, messagesResult] = await Promise.all([
        fetchInternalFcProfiles(),
        supabase
          .from('messages')
          .select('sender_id,receiver_id,content,created_at,is_read,file_name,attachment_batch_id,deleted_at')
          .or(`sender_id.eq.${viewerId},receiver_id.eq.${viewerId}`)
          .order('created_at', { ascending: false }),
      ]);

      if (messagesResult.error) {
        return err(messagesResult.error.message, 500);
      }

      const chatParticipants = participants.map((participant) => ({
        fc_id: participant.id,
        name: participant.name,
        phone: participant.phone,
        affiliation: participant.affiliation,
      }));
      const summaryRows = await buildInternalChatSummaryRows(
        (messagesResult.data ?? []) as unknown as InternalChatMessageAttachmentRow[],
      );

      const summary = buildInternalChatList({
        viewerId,
        participants: chatParticipants,
        messages: summaryRows,
        includeAllCompletedFc: body.viewer_read_only === true,
      });

      return ok({
        ok: true,
        items: summary.items,
        total_unread: summary.totalUnread,
      });
    } catch (listErr) {
      const message = listErr instanceof Error ? listErr.message : 'internal chat list failed';
      return err(message, 500);
    }
  }

  if (body.type === 'internal_unread_count') {
    const viewerId = String(body.viewer_id ?? '').trim();
    if (!viewerId) {
      return err('viewer_id is required', 400);
    }

    try {
      const shouldScopeInternalUnread = body.viewer_role === 'admin' || body.viewer_is_request_board_designer === true;

      if (!shouldScopeInternalUnread) {
        const { count, error } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('receiver_id', viewerId)
          .eq('is_read', false)
          .is('deleted_at', null);
        if (error) return err(error.message, 500);
        return ok({ ok: true, count: count ?? 0 });
      }

      const participants = await fetchInternalFcProfiles();
      const chatParticipants = participants.map((participant) => ({
        fc_id: participant.id,
        name: participant.name,
        phone: participant.phone,
        affiliation: participant.affiliation,
      }));
      const scopedSenderIds = chatParticipants
        .filter((participant) =>
          shouldIncludeInternalChatParticipant(participant, {
            includeAllCompletedFc: body.viewer_read_only === true,
          })
        )
        .map((participant) => sanitize(participant.phone))
        .filter((phone) => phone.length > 0);

      if (scopedSenderIds.length === 0) {
        return ok({ ok: true, count: 0 });
      }

      const { count, error } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', viewerId)
        .eq('is_read', false)
        .is('deleted_at', null)
        .in('sender_id', scopedSenderIds);
      if (error) return err(error.message, 500);

      return ok({ ok: true, count: count ?? 0 });
    } catch (countErr) {
      const message = countErr instanceof Error ? countErr.message : 'internal unread count failed';
      return err(message, 500);
    }
  }

  // 알림센터 목록 조회 (RLS 우회)
  if (body.type === 'inbox_list') {
    const viewer = getReceiptViewer(body);
    if (!viewer) return err('Verified notification viewer is required', 401);
    const role = body.role;
    const residentId = sanitize(body.resident_id);
    const limit = Math.max(1, Math.min(Number(body.limit ?? 80) || 80, 200));
    const includeRequestBoardFc = role === 'admin' && residentId.length > 0 && body.include_request_board_fc === true;
    const onlyRequestBoardCategories = body.only_request_board_categories === true;
    const receiptViewer = buildNotificationReceiptViewer({
      viewer,
      inboxRole: role,
      residentId,
      includeRequestBoardFc,
    });

    const buildPrimaryNotifQuery = (selectColumns: string) => {
      let query = supabase
        .from('notifications')
        .select(selectColumns)
        .eq('recipient_role', role)
        .or(
          `recipient_actor_id.eq.${viewer.actorId},and(recipient_actor_id.is.null,resident_id.is.null)`,
        )
        .order('created_at', { ascending: false });

      if (onlyRequestBoardCategories) {
        query = query.ilike('category', `${REQUEST_BOARD_CATEGORY_PREFIX}%`);
      }

      return query;
    };

    const runNotifQuery = async (
      buildQuery: (selectColumns: string) => any,
    ): Promise<Array<Record<string, any>>> =>
      collectVisibleNotificationInboxRows<Record<string, any>>({
        limit,
        pageSize: 200,
        fetchPage: async (offset, pageSize) => {
          const result = await buildQuery(
            'id,title,body,category,target,target_url,created_at,resident_id,recipient_role,recipient_actor_id',
          ).range(offset, offset + pageSize - 1);
          const data = result.data as Array<Record<string, any>> | null;
          const error = result.error as { code?: string } | null;

          if (error) throw error;

          return (data ?? []).map((rawRow) => {
            const row = rawRow as Record<string, any>;
            return {
              ...row,
              target: parseNotificationTargetV1(row.target),
              target_url: 'target_url' in row ? row.target_url ?? null : null,
            };
          });
        },
        selectVisible: async (rows) => {
          const authorizedRows = rows.filter((row) =>
            authorizeNotificationReceipt(
              toNotificationOwnershipRow(row),
              receiptViewer,
            ).authorized
          );
          const receiptMap = await fetchReceiptMap(
            authorizedRows.map((item) => String(item.id)),
            viewer,
          );
          return authorizedRows
            .map((item): Record<string, any> => {
              const receipt = receiptMap.get(String(item.id));
              return {
                ...item,
                read_at: receipt?.read_at ?? null,
                dismissed_at: receipt?.dismissed_at ?? null,
              };
            })
            .filter((item) => item.dismissed_at === null);
        },
      });

    try {
      const [primaryNotifications, requestBoardFcNotifications] = await Promise.all([
        runNotifQuery(buildPrimaryNotifQuery),
        includeRequestBoardFc
          ? runNotifQuery((selectColumns) =>
              supabase
                .from('notifications')
                .select(selectColumns)
                .eq('recipient_role', 'fc')
                .eq('recipient_actor_id', viewer.actorId)
                .ilike('category', `${REQUEST_BOARD_CATEGORY_PREFIX}%`)
                .order('created_at', { ascending: false }),
            )
          : Promise.resolve([]),
      ]);

      const dedupedNotifications: Array<Record<string, any>> = Array.from(
        ([...primaryNotifications, ...requestBoardFcNotifications] as Array<Record<string, any>>)
          .reduce((map, item) => {
            if (!map.has(item.id)) map.set(item.id, item);
            return map;
          }, new Map<string, Record<string, any>>())
          .values(),
      );
      const notifications: Array<Record<string, any>> = dedupedNotifications
        .sort(
          (a, b) =>
            new Date(String(b.created_at ?? 0)).getTime() - new Date(String(a.created_at ?? 0)).getTime(),
        )
        .slice(0, limit);

      const notices: NoticeRow[] = onlyRequestBoardCategories
        ? []
        : await fetchUnifiedNotices(limit);

      return ok({
        ok: true,
        notifications,
        notices: notices ?? [],
      });
    } catch (listErr: unknown) {
      const message = listErr instanceof Error ? listErr.message : 'Failed to fetch notifications';
      return err(message, 500);
    }
  }

  if (body.type === 'inbox_get') {
    const viewer = getReceiptViewer(body);
    if (!viewer) return err('Verified notification viewer is required', 401);
    const residentId = sanitize(body.resident_id);
    const selectColumns =
      'id,title,body,category,target,target_url,created_at,resident_id,recipient_role,recipient_actor_id';

    const { data, error } = await supabase
      .from('notifications')
      .select(selectColumns)
      .eq('id', body.notification_id)
      .maybeSingle();
    if (error) return err('Notification lookup failed', 500);
    if (!data) return err('Notification not found', 404);

    const receiptViewer = buildNotificationReceiptViewer({
      viewer,
      inboxRole: body.role,
      residentId,
      includeRequestBoardFc: body.include_request_board_fc,
    });
    const ownership = authorizeNotificationReceipt(
      toNotificationOwnershipRow(data as Record<string, unknown>),
      receiptViewer,
    );
    if (!ownership.authorized) return err('Notification access denied', 403);

    const receiptMap = await fetchReceiptMap([String(data.id)], viewer).catch(() => null);
    if (!receiptMap) return err('Notification receipt lookup failed', 500);
    const receipt = receiptMap.get(String(data.id));
    if (receipt?.dismissed_at) return err('Notification not found', 404);
    return ok({
      ok: true,
      authorized: true,
      notification: {
        ...data,
        target: parseNotificationTargetV1(data.target),
        target_url: data.target_url ?? null,
        read_at: receipt?.read_at ?? null,
        dismissed_at: receipt?.dismissed_at ?? null,
      },
    });
  }

  // 홈 벨 아이콘 unread 개수 조회 (RLS 우회)
  if (body.type === 'inbox_unread_count') {
    const viewer = getReceiptViewer(body);
    if (!viewer) return err('Verified notification viewer is required', 401);
    const role = body.role;
    const residentId = sanitize(body.resident_id);
    const includeRequestBoardFc = role === 'admin' && residentId.length > 0 && body.include_request_board_fc === true;
    const excludeRequestBoardCategories = body.exclude_request_board_categories === true;
    const includeNotices = body.include_notices === true;
    const onlyRequestBoardCategories = body.only_request_board_categories === true;
    const receiptViewer = buildNotificationReceiptViewer({
      viewer,
      inboxRole: role,
      residentId,
      includeRequestBoardFc,
    });

    const sinceDate = body.since ? new Date(body.since) : new Date(0);
    const sinceIso = Number.isNaN(sinceDate.getTime()) ? new Date(0).toISOString() : sinceDate.toISOString();
    const noticeSinceDate = body.notice_since ? new Date(body.notice_since) : sinceDate;
    const noticeSinceIso = Number.isNaN(noticeSinceDate.getTime())
      ? sinceIso
      : noticeSinceDate.toISOString();

    const buildPrimaryCountQuery = () => {
      let countQuery = supabase
        .from('notifications')
        .select('id,recipient_actor_id,recipient_role,resident_id,category')
        .eq('recipient_role', role)
        .or(
          `recipient_actor_id.eq.${viewer.actorId},and(recipient_actor_id.is.null,resident_id.is.null)`,
        )
        .gt('created_at', sinceIso);

        if (onlyRequestBoardCategories) {
          countQuery = countQuery.ilike('category', `${REQUEST_BOARD_CATEGORY_PREFIX}%`);
        } else if (excludeRequestBoardCategories) {
          countQuery = countQuery.not('category', 'ilike', `${REQUEST_BOARD_CATEGORY_PREFIX}%`);
        }

        return countQuery;
      };

    const { data: primaryRows, error: primaryCountErr } = await buildPrimaryCountQuery();
    if (primaryCountErr) return err(primaryCountErr.message, 500);

    let requestBoardFcRows: Array<Record<string, unknown>> = [];
    if (includeRequestBoardFc && !excludeRequestBoardCategories) {
      const { data, error } = await supabase
        .from('notifications')
        .select('id,recipient_actor_id,recipient_role,resident_id,category')
        .eq('recipient_role', 'fc')
        .eq('recipient_actor_id', viewer.actorId)
        .ilike('category', `${REQUEST_BOARD_CATEGORY_PREFIX}%`)
        .gt('created_at', sinceIso);
      if (error) return err(error.message, 500);
      requestBoardFcRows = data ?? [];
    }

    const visibleIds = Array.from(new Set(
      [
        ...((primaryRows ?? []) as Array<Record<string, unknown>>),
        ...requestBoardFcRows,
      ]
        .filter((row) =>
          authorizeNotificationReceipt(
            toNotificationOwnershipRow(row as Record<string, unknown>),
            receiptViewer,
          ).authorized
        )
        .map((row) => String(row.id)),
    ));
    const receiptMap = await fetchReceiptMap(visibleIds, viewer).catch(() => null);
    if (!receiptMap) return err('Notification receipt lookup failed', 500);
    const notificationCount = visibleIds.filter((id) => {
      const receipt = receiptMap.get(id);
      return !receipt?.read_at && !receipt?.dismissed_at;
    }).length;

    let noticeCount = 0;
    if (includeNotices && !onlyRequestBoardCategories) {
      const notices = await fetchUnifiedNotices(200).catch((error) => {
        if (isMissingTableError(error)) return [] as NoticeRow[];
        throw error;
      });
      const sinceTime = new Date(noticeSinceIso).getTime();
      noticeCount = notices.filter((notice) => new Date(String(notice.created_at ?? 0)).getTime() > sinceTime).length;
    }

    return ok({ ok: true, count: notificationCount + noticeCount });
  }

  if (
    body.type === 'inbox_mark_read'
    || body.type === 'inbox_dismiss'
    || body.type === 'inbox_delete'
  ) {
    const viewer = getReceiptViewer(body);
    if (!viewer) return err('Verified notification viewer is required', 401);
    const residentId = sanitize(body.resident_id);
    const requestedIds = Array.from(new Set(
      (body.notification_ids ?? []).filter((id) => UUID_PATTERN.test(id)),
    ));
    if (requestedIds.length === 0) return err('notification_ids are required', 400);

    const { data: ownershipRows, error: visibilityError } = await supabase
      .from('notifications')
      .select('id,recipient_actor_id,recipient_role,resident_id,category')
      .in('id', requestedIds);
    if (visibilityError) return err('Notification ownership lookup failed', 500);
    const loadedRows = ((ownershipRows ?? []) as Array<Record<string, unknown>>)
      .map(toNotificationOwnershipRow);
    const receiptViewer = buildNotificationReceiptViewer({
      viewer,
      inboxRole: body.role,
      residentId,
      includeRequestBoardFc: body.include_request_board_fc,
    });
    const ownershipSet = authorizeNotificationReceiptSet(
      requestedIds,
      loadedRows,
      receiptViewer,
    );
    if (ownershipSet.authorized === false) {
      return ownershipSet.status === 404
        ? err('Notification not found', 404)
        : err('Notification access denied', 403);
    }

    const receiptMap = await fetchReceiptMap(requestedIds, viewer).catch(() => null);
    if (!receiptMap) return err('Notification receipt lookup failed', 500);
    const timestamp = new Date().toISOString();
    const isDismiss = body.type === 'inbox_dismiss' || body.type === 'inbox_delete';
    const receiptAction = isDismiss ? 'dismiss' as const : 'mark_read' as const;
    const states = requestedIds.map((notificationId) => {
      const receipt = receiptMap.get(notificationId);
      return {
        notificationId,
        receipt,
        ...classifyNotificationReceiptState({
          action: receiptAction,
          readAt: receipt?.read_at ?? null,
          dismissedAt: receipt?.dismissed_at ?? null,
        }),
      };
    });
    const changedStates = states.filter((state) => state.changed);
    if (changedStates.length > 0) {
      const receiptRows = changedStates.map(({ notificationId, receipt }) => ({
        notification_id: notificationId,
        viewer_actor_id: viewer.actorId,
        viewer_role: viewer.role,
        read_at: isDismiss ? receipt?.read_at ?? timestamp : timestamp,
        ...(isDismiss ? { dismissed_at: timestamp } : {}),
        updated_at: timestamp,
      }));
      const { error: receiptError } = await supabase
        .from('notification_receipts')
        .upsert(receiptRows, {
          onConflict: 'notification_id,viewer_actor_id,viewer_role',
        });
      if (receiptError) return err('Notification receipt update failed', 500);
    }
    return ok({
      ok: true,
      authorized: true,
      changed: changedStates.length > 0,
      state: changedStates.length > 0
        ? isDismiss ? 'dismissed' : 'read'
        : isDismiss ? 'already_dismissed' : 'already_read',
      updated: changedStates.length,
    });
  }

  // Legacy physical-delete block is unreachable for signed/service-bound
  // inbox actions; inbox_delete is normalized to a per-viewer dismissal above.
  // 알림센터 선택 항목 삭제 (RLS 우회)
  if ((body as { type?: string }).type === 'inbox_delete') {
    const legacyBody = body as {
      role: 'admin' | 'fc';
      resident_id?: string | null;
      include_request_board_fc?: boolean;
      notification_ids?: string[];
      notice_ids?: string[];
    };
    const role = legacyBody.role;
    const residentId = sanitize(legacyBody.resident_id);
    const includeRequestBoardFc =
      role === 'admin' && residentId.length > 0 && legacyBody.include_request_board_fc === true;
    const notificationIds = Array.isArray(legacyBody.notification_ids)
      ? legacyBody.notification_ids.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];
    const noticeIds = Array.isArray(legacyBody.notice_ids)
      ? legacyBody.notice_ids.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];
    const regularNoticeIds: string[] = [];
    const boardNoticePostIds: string[] = [];

    noticeIds.forEach((id) => {
      if (id.startsWith(BOARD_NOTICE_ID_PREFIX)) {
        const postId = id.slice(BOARD_NOTICE_ID_PREFIX.length).trim();
        if (postId) boardNoticePostIds.push(postId);
        return;
      }
      regularNoticeIds.push(id);
    });

    let deletedNotifications = 0;
    let deletedNotices = 0;

    if (notificationIds.length > 0) {
      let deleteQuery = supabase
        .from('notifications')
        .delete({ count: 'exact' })
        .in('id', notificationIds);

      if (role === 'fc') {
        if (appActor?.sessionRole === 'fc') {
          // A signed FC may delete only a row addressed to that FC. Global broadcast rows
          // are shared state and must never be physically deleted by one recipient.
          deleteQuery = deleteQuery.eq('recipient_role', 'fc').eq('resident_id', residentId);
        } else if (residentId) {
          deleteQuery = deleteQuery.eq('recipient_role', 'fc').or(`resident_id.eq.${residentId},resident_id.is.null`);
        } else {
          deleteQuery = deleteQuery.eq('recipient_role', 'fc').is('resident_id', null);
        }
      } else {
        if (residentId) {
          deleteQuery = deleteQuery.eq('recipient_role', 'admin').eq('resident_id', residentId);
        } else {
          deleteQuery = deleteQuery.eq('recipient_role', 'admin').is('resident_id', null);
        }
      }

      const { count, error: notifDeleteErr } = await deleteQuery;
      if (notifDeleteErr) return err(notifDeleteErr.message, 500);
      deletedNotifications = count ?? 0;

      if (includeRequestBoardFc) {
        const { count: requestBoardDeleteCount, error: requestBoardDeleteErr } = await supabase
          .from('notifications')
          .delete({ count: 'exact' })
          .in('id', notificationIds)
          .eq('recipient_role', 'fc')
          .eq('resident_id', residentId)
          .ilike('category', `${REQUEST_BOARD_CATEGORY_PREFIX}%`);
        if (requestBoardDeleteErr) return err(requestBoardDeleteErr.message, 500);
        deletedNotifications += requestBoardDeleteCount ?? 0;
      }
    }

    // 공지 삭제는 admin 계정에서만 서버 삭제 허용
    if (regularNoticeIds.length > 0 && role === 'admin') {
      const { count, error: noticeDeleteErr } = await supabase
        .from('notices')
        .delete({ count: 'exact' })
        .in('id', regularNoticeIds);
      if (noticeDeleteErr) return err(noticeDeleteErr.message, 500);
      deletedNotices = count ?? 0;
    }

    // 게시판 홈 노출 카테고리도 공지 목록에서 삭제 요청 시 함께 삭제
    if (boardNoticePostIds.length > 0 && role === 'admin') {
      const categories = await fetchBoardHomeCategories();
      const categoryIds = categories.map((category) => category.id);
      if (categoryIds.length > 0) {
        const { data: deletablePosts, error: postErr } = await supabase
          .from('board_posts')
          .select('id')
          .in('category_id', categoryIds)
          .in('id', boardNoticePostIds);
        if (postErr) return err(postErr.message, 500);

        const deletableIds = (deletablePosts ?? []).map((row) => row.id as string);
        if (deletableIds.length > 0) {
          const { data: attachments, error: attachmentErr } = await supabase
            .from('board_attachments')
            .select('storage_path')
            .in('post_id', deletableIds);
          if (attachmentErr) return err(attachmentErr.message, 500);

          const storagePaths = (attachments ?? [])
            .map((row) => row.storage_path as string)
            .filter((path) => typeof path === 'string' && path.length > 0);
          if (storagePaths.length > 0) {
            const { error: storageErr } = await supabase.storage
              .from('board-attachments')
              .remove(storagePaths);
            if (storageErr) {
              reportEdgeDiagnostic({
                event: 'fc_notify.attachment_cleanup',
                reason: 'storage_remove_failed',
                errorClass: 'upstream',
              });
            }
          }

          const { count: boardDeleteCount, error: boardDeleteErr } = await supabase
            .from('board_posts')
            .delete({ count: 'exact' })
            .in('id', deletableIds);
          if (boardDeleteErr) return err(boardDeleteErr.message, 500);
          deletedNotices += boardDeleteCount ?? 0;
        }
      }
    }

    return ok({
      ok: true,
      deleted_notifications: deletedNotifications,
      deleted_notices: deletedNotices,
    });
  }

  // 홈 상단 최신 공지 조회 (RLS 우회)
  if (body.type === 'notice_get') {
    const viewer = getReceiptViewer(body);
    if (!viewer) return err('Verified notification viewer is required', 401);
    try {
      const notice = await fetchNoticeByIdWithOptionalAttachments(body.notice_id);
      if (!notice) return err('Notice not found', 404);
      return ok({
        ok: true,
        authorized: true,
        notice,
      });
    } catch {
      return err('Notice lookup failed', 500);
    }
  }

  if (body.type === 'latest_notice') {
    try {
      const notices = await fetchUnifiedNotices(1).catch((error) => {
        if (isMissingTableError(error)) return [] as NoticeRow[];
        throw error;
      });
      const notice = notices.length > 0
        ? {
          id: notices[0].id,
          title: notices[0].title,
          body: notices[0].body,
          category: notices[0].category,
          created_at: notices[0].created_at,
          target: notices[0].target ?? null,
        }
        : null;
      return ok({ ok: true, notice });
    } catch (latestErr: unknown) {
      const message = latestErr instanceof Error ? latestErr.message : 'Failed to fetch latest notice';
      return err(message, 500);
    }
  }

  // 직접 알림 처리 (notify/message)
  if (body.type === 'notify' || body.type === 'message') {
    const target_role = body.target_role;
    const target_id = target_role === 'admin'
      ? normalizeAdminNotificationTargetId(body.target_id)
      : sanitize(body.target_id);
    const skipNotificationInsert = body.skip_notification_insert === true;

    const title = redactSensitiveText(
      body.type === 'notify'
        ? body.title
        : body.title ?? '\uba54\uc2dc\uc9c0',
      '\uc54c\ub9bc',
    );
    const message = redactSensitiveText(
      body.type === 'notify'
        ? body.body
        : body.body ?? body.message ?? '\uc0c8\ub85c\uc6b4 \uba54\uc2dc\uc9c0\uac00 \ub3c4\ucc29\ud588\uc2b5\ub2c8\ub2e4.',
    );
    const category = redactSensitiveText(
      body.type === 'notify'
        ? body.category ?? 'app_event'
        : body.category ?? 'message',
      'app_event',
    );
    const notificationSource = resolveNotificationSource(category);
    const pushTitle = buildPushTitleWithSource(title, notificationSource);
    let notificationTarget = parseNotificationTargetV1(body.target);
    let directConversationId: string | null = null;
    let canonicalFcId = body.fc_id ?? null;

    if (category === 'message') {
      if (!appActor) return err('Verified message actor is required', 401);
      const directConversation = await resolveGaraminDirectConversation({
        actor: appActor,
        targetId: target_id,
      });
      if (directConversation.ok === false) {
        return err(directConversation.message, directConversation.status);
      }
      const canonicalTarget: NotificationTargetV1 = {
        version: 1,
        kind: 'garamin_direct_chat',
        conversationId: directConversation.id,
      };
      if (
        notificationTarget
        && JSON.stringify(notificationTarget) !== JSON.stringify(canonicalTarget)
      ) {
        return err('Notification target does not match the direct conversation', 400);
      }
      notificationTarget = canonicalTarget;
      directConversationId = directConversation.id;
      canonicalFcId = directConversation.fcId;
    }

    if (!notificationTarget) return err('A valid typed notification target is required', 400);
    const suppliedNotificationId = String(body.notification_id ?? '').trim();
    if (skipNotificationInsert && !UUID_PATTERN.test(suppliedNotificationId)) {
      return err('notification_id is required when notification insert is skipped', 400);
    }

    if (
      appActor
      && shouldRequireActiveStaffNotificationTarget({
        actorSessionRole: appActor.sessionRole,
        targetRole: target_role,
        category,
        targetId: target_id,
      })
    ) {
      const targetValidation = await validateActiveStaffNotificationTarget(target_id, target_role);
      if (targetValidation === 'failed') {
        return err('Notification target validation failed', 500);
      }
      if (targetValidation === 'denied') {
        return err('Notification target is not allowed', 403);
      }
    }

    let url = redactSensitiveText(body.type === 'notify' ? body.url ?? '/notifications' : body.url ?? '/chat', '/notifications');
    if (body.type === 'message' && !body.url && body.sender_id?.trim()) {
      let senderName = body.sender_name?.trim() || '';

      if (!senderName && target_role === 'admin') {
        const { data: senderProfile } = await supabase
          .from('fc_profiles')
          .select('name')
          .eq('phone', sanitize(body.sender_id))
          .maybeSingle();
        senderName = senderProfile?.name?.trim() || '';
      }

      const resolvedSenderName = redactSensitiveText(senderName || body.sender_id || 'FC', 'FC');
      url = `/chat?targetId=${encodeURIComponent(body.sender_id)}&targetName=${encodeURIComponent(resolvedSenderName)}`;
    }

    let tokens: TokenRow[] = [];
    let tokenLoadFailed = false;

    if (target_id) {
      // A concrete identity may own multiple app roles. Restrict delivery to the
      // role requested by the already-authorized notification payload.
      const { data, error } = await supabase
        .from('device_tokens')
        .select('expo_push_token,resident_id,display_name,role')
        .eq('resident_id', target_id)
        .in('role', [...getAllowedNotificationTokenRoles(target_role, category)]);
      if (error) {
        tokenLoadFailed = true;
        reportEdgeDiagnostic({
          event: 'fc_notify.device_token_load',
          reason: 'query_failed',
          errorClass: 'database',
        });
      } else if (data) {
        tokens = data;
      }
    } else {
      if (target_role === 'admin') {
        let sharedAdminPhones: string[] = [];
        try {
          sharedAdminPhones = await fetchSharedAdminPhones();
        } catch {
          tokenLoadFailed = true;
          reportEdgeDiagnostic({
            event: 'fc_notify.device_token_load',
            reason: 'query_failed',
            errorClass: 'database',
          });
        }
        if (!tokenLoadFailed && sharedAdminPhones.length > 0) {
          const { data, error } = await supabase
            .from('device_tokens')
            .select('expo_push_token,resident_id,display_name,role')
            .eq('role', 'admin')
            .in('resident_id', sharedAdminPhones);
          if (error) {
            tokenLoadFailed = true;
            reportEdgeDiagnostic({
              event: 'fc_notify.device_token_load',
              reason: 'query_failed',
              errorClass: 'database',
            });
          } else if (data) {
            tokens = data;
          }
        }
      } else {
        const { data, error } = await supabase
          .from('device_tokens')
          .select('expo_push_token,resident_id,display_name,role')
          .eq('role', 'fc');
        if (error) {
          tokenLoadFailed = true;
          reportEdgeDiagnostic({
            event: 'fc_notify.device_token_load',
            reason: 'query_failed',
            errorClass: 'database',
          });
        } else if (data) {
          tokens = data;
        }
      }
    }
    tokens = filterManagerTokensForNotification(tokens, { category, targetId: target_id });
    tokens = dedupeTokens(tokens);

    let recipientActorId: string | null = null;
    try {
      recipientActorId = await resolveNotificationRecipientActorId(target_role, target_id || null);
    } catch {
      return err('Notification recipient resolution failed', 500);
    }
    const claimedRecipientActorId = String(body.recipient_actor_id ?? '').trim();
    if (!target_id) {
      if (claimedRecipientActorId) {
        return err('Broadcast notifications cannot claim one recipient actor', 400);
      }
    } else {
      if (!recipientActorId) {
        return err('Notification recipient is not active', 403);
      }
      if (authMode === 'service' && !UUID_PATTERN.test(claimedRecipientActorId)) {
        return err('recipient_actor_id is required for a direct service notification', 400);
      }
      if (
        claimedRecipientActorId
        && claimedRecipientActorId.toLowerCase() !== recipientActorId.toLowerCase()
      ) {
        return err('Notification recipient actor does not match the active target', 403);
      }
    }

    const logResult = skipNotificationInsert
      ? await verifyExistingNotificationForDelivery({
          notificationId: suppliedNotificationId,
          target: notificationTarget,
          recipientRole: target_role,
          recipientActorId,
          residentId: target_id || null,
        })
      : await insertNotificationWithFallback({
          title,
          body: message,
          category,
          recipient_role: target_role,
          resident_id: target_id || null,
          recipient_actor_id: recipientActorId,
          fc_id: canonicalFcId,
          target: notificationTarget,
          target_url: url,
        });
    const logError = logResult.error;
    const notificationId = logResult.id;
    if (logError || !notificationId) {
      reportEdgeDiagnostic({
        event: 'fc_notify.notification_insert',
        reason: 'insert_failed',
        errorClass: 'database',
      });
      return ok({
        ok: false,
        confirmed: false,
        stored: false,
        push_status: 'provider_failed',
        sent: 0,
        logged: false,
        target: notificationTarget,
        ...(directConversationId ? { conversationId: directConversationId } : {}),
        delivery: buildDeliveryMetadata({
          notificationStored: false,
          pushStatus: 'not_attempted',
          retryable: true,
        }),
        message: 'Notification inbox persistence was not confirmed',
        reason: logResult.failureReason ?? 'notification_insert_failed',
        web_push: null,
        warning: NOTIFICATION_DELIVERY_INCOMPLETE_WARNING,
      });
    }

    let adminWebPush: AdminWebPushResult | null = null;
    // Send web push to admin browser subscribers
    if (target_role === 'admin') {
      adminWebPush = await notifyAdminWebPush(
        pushTitle,
        message,
        url,
        target_id || null,
        notificationId,
        notificationTarget,
      );
    }
    const warning = getNotificationDeliveryWarning(adminWebPush);

    if (tokenLoadFailed) {
      return ok({
        ok: true,
        confirmed: true,
        stored: true,
        push_status: 'provider_failed',
        sent: 0,
        logged: true,
        notificationId,
        target: notificationTarget,
        ...(directConversationId ? { conversationId: directConversationId } : {}),
        delivery: buildDeliveryMetadata({
          notificationStored: true,
          pushStatus: 'provider_rejected',
          retryable: true,
          notificationId,
        }),
        message: 'Device token lookup failed',
        web_push: adminWebPush,
        warning,
      });
    }

    if (!tokens.length) {
      return ok({
        ...toExpoPushDeliveryOutcome({ attempted: 0, accepted: 0, rejected: 0 }),
        ok: true,
        confirmed: true,
        stored: true,
        push_status: resolvePushStatus({
          expoAttempted: 0,
          expoAccepted: 0,
          expoRejected: 0,
          adminWebPush,
        }),
        logged: true,
        notificationId,
        target: notificationTarget,
        ...(directConversationId ? { conversationId: directConversationId } : {}),
        msg: 'No tokens found',
        delivery: buildDeliveryMetadata({
          notificationStored: true,
          pushStatus: adminWebPush?.ok === true && adminWebPush.sent > 0
            ? 'accepted'
            : 'no_registered_device',
          retryable: false,
          notificationId,
          accepted: adminWebPush?.ok === true ? adminWebPush.sent : 0,
        }),
        web_push: adminWebPush,
        warning,
      });
    }

    const pushPayload = tokens.map((t) => ({
      to: t.expo_push_token,
      title: pushTitle,
      body: message,
      data: {
        url,
        type: category,
        source: notificationSource,
        resident_id: target_id || null,
        notificationId,
        target: notificationTarget,
        ...(directConversationId ? { conversationId: directConversationId } : {}),
        ...(body.sender_id?.trim()
          ? {
              sender_id: body.sender_id.trim(),
              sender_name: redactSensitiveText(body.sender_name ?? '', ''),
            }
          : {}),
      },
      sound: 'default',
      priority: 'high',
      channelId: 'alerts',
    }));

    const delivery = await sendExpoPushPayloads(pushPayload);

    return ok({
      ...toExpoPushDeliveryOutcome(delivery),
      ok: true,
      confirmed: true,
      stored: true,
      push_status: resolvePushStatus({
        expoAttempted: delivery.attempted,
        expoAccepted: delivery.accepted,
        expoRejected: delivery.rejected,
        adminWebPush,
      }),
      logged: true,
      notificationId,
      target: notificationTarget,
      ...(directConversationId ? { conversationId: directConversationId } : {}),
      web_push: adminWebPush,
      warning,
      delivery: buildDeliveryMetadata({
        notificationStored: true,
        pushStatus:
          delivery.rejected > 0 || adminWebPush?.ok === false
            ? 'provider_rejected'
            : 'accepted',
        retryable: delivery.rejected > 0 || adminWebPush?.ok === false,
        notificationId,
        attempted: delivery.attempted,
        accepted: delivery.accepted + (adminWebPush?.ok === true ? adminWebPush.sent : 0),
        rejected: delivery.rejected,
      }),
    });
  }

  // 기존 fc/admin 업데이트/삭제 로직
  if (!(body as any).fc_id) {
    return err('fc_id required', 400);
  }

  const fc_id = (body as any).fc_id;

  const { data: fc, error: fcError } = await supabase
    .from('fc_profiles')
    .select('id,name,resident_id_masked,phone,affiliation')
    .eq('id', fc_id)
    .maybeSingle();

  if (fcError || !fc) {
    return err('fc not found', 404);
  }
  const fcRow = fc as FcRow;

  const targetRole: 'admin' | 'fc' = body.type === 'admin_update' ? 'fc' : 'admin';
  const targetResidentId = targetRole === 'fc' ? sanitize(fcRow.phone) : null;
  const isFcAdminUpdateEvent = body.type === 'fc_update' || body.type === 'fc_delete';

  const title = buildTitle(fcRow.name, body, (body as any).message);
  const message = (body as any).message ?? title;
  const targetUrl = getTargetUrl(targetRole, body, message, fcRow.id);
  const lifecycleTarget = getLifecycleNotificationTarget(fcRow.id, targetUrl);
  let tokens: TokenRow[] = [];
  let logError: { message: string } | null = null;
  let tokenLoadFailed = false;
  let notificationPersistenceFailed = false;
  let notificationPersistenceReason = 'notification_insert_failed';
  const notificationIdByRecipient = new Map<string, string>();

  if (isFcAdminUpdateEvent) {
    let recipientResidentIds: string[] = [];
    try {
      recipientResidentIds = await resolveFcUpdateAdminRecipientIds(fcRow.affiliation);
    } catch (recipientError: unknown) {
      const message = recipientError instanceof Error ? recipientError.message : 'failed to resolve admin recipients';
      return err(message, 500);
    }

    if (recipientResidentIds.length > 0) {
      const { data, error } = await supabase
        .from('device_tokens')
        .select('expo_push_token,resident_id,display_name,role')
        .in('resident_id', recipientResidentIds)
        .in('role', [...getAllowedNotificationTokenRoles(targetRole)]);
      if (error) {
        tokenLoadFailed = true;
        reportEdgeDiagnostic({
          event: 'fc_notify.device_token_load',
          reason: 'query_failed',
          errorClass: 'database',
        });
      } else if (data) {
        tokens = data;
      }

      const notificationRows = [];
      for (const recipientId of recipientResidentIds) {
        const recipientActorId = await resolveNotificationRecipientActorId('admin', recipientId);
        if (!recipientActorId) continue;
        notificationRows.push(sanitizeNotificationInsert({
          title,
          body: message,
          category: (body as any).type,
          fc_id: fcRow.id,
          resident_id: recipientId,
          recipient_actor_id: recipientActorId,
          recipient_role: 'admin' as const,
          target: lifecycleTarget,
          target_url: targetUrl,
        }));
      }

      const insertResult = notificationRows.length > 0
        ? await supabase
          .from('notifications')
          .insert(notificationRows)
          .select('id,resident_id,recipient_role,recipient_actor_id,target')
        : { data: [], error: null };
      if (insertResult.error) {
        logError = insertResult.error;
        notificationPersistenceFailed = true;
      } else {
        const expectedByResident = new Map(
          notificationRows.map((row) => [String(row.resident_id ?? ''), row]),
        );
        for (const row of insertResult.data ?? []) {
          const residentId = String(row.resident_id ?? '');
          const expected = expectedByResident.get(residentId);
          if (!expected) {
            notificationPersistenceFailed = true;
            notificationPersistenceReason = 'recipient_mismatch';
            continue;
          }
          const validation = validatePersistedNotificationForDelivery(row, {
            target: lifecycleTarget,
            recipientRole: 'admin',
            recipientActorId: String(expected.recipient_actor_id ?? '') || null,
            residentId,
          });
          if (validation.ok === false) {
            notificationPersistenceFailed = true;
            notificationPersistenceReason = validation.reason;
            continue;
          }
          notificationIdByRecipient.set(residentId, validation.notificationId);
        }
        if (
          notificationRows.length !== recipientResidentIds.length
          || notificationIdByRecipient.size !== notificationRows.length
        ) {
          notificationPersistenceFailed = true;
          notificationPersistenceReason = 'notification_id_mapping_incomplete';
        }
      }
    } else {
      reportEdgeDiagnostic({
        event: 'fc_notify.recipient_resolution',
        reason: 'no_admin_recipients',
        count: 0,
      });
      notificationPersistenceFailed = true;
      notificationPersistenceReason = 'no_notification_recipients';
    }
  } else {
    if (!targetResidentId) return err('FC phone number not found', 400);
    const { data, error } = await supabase
      .from('device_tokens')
      .select('expo_push_token,resident_id,display_name,role')
      .eq('resident_id', targetResidentId)
      .in('role', [...getAllowedNotificationTokenRoles(targetRole)]);
    if (error) {
      tokenLoadFailed = true;
      reportEdgeDiagnostic({
        event: 'fc_notify.device_token_load',
        reason: 'query_failed',
        errorClass: 'database',
      });
    } else if (data) {
      tokens = data;
    }

    const logResult = await insertNotificationWithFallback({
      title,
      body: message,
      category: (body as any).type,
      fc_id: fcRow.id,
      resident_id: targetResidentId,
      recipient_actor_id: fcRow.id,
      recipient_role: targetRole,
      target: lifecycleTarget,
      target_url: targetUrl,
    });
    logError = logResult.error;
    if (logResult.id) {
      notificationIdByRecipient.set(targetResidentId, logResult.id);
    } else {
      notificationPersistenceFailed = true;
      notificationPersistenceReason = logResult.failureReason ?? 'notification_insert_failed';
    }
  }

  tokens = filterManagerTokensForNotification(tokens, {
    category: (body as any).type,
    targetId: targetResidentId,
    allowScopedManagerLifecycle: isFcAdminUpdateEvent,
  });
  tokens = dedupeTokens(tokens);
  if (isFcAdminUpdateEvent) {
    tokens = tokens.filter((token) =>
      notificationIdByRecipient.has(String(token.resident_id ?? ''))
    );
  }
  if (logError) {
    reportEdgeDiagnostic({
      event: 'fc_notify.notification_insert',
      reason: 'insert_failed',
      errorClass: 'database',
    });
  }
  if (notificationPersistenceFailed) {
    return ok({
      ok: false,
      confirmed: false,
      stored: false,
      push_status: 'provider_failed',
      sent: 0,
      logged: false,
      target: lifecycleTarget,
      delivery: buildDeliveryMetadata({
        notificationStored: false,
        pushStatus: 'not_attempted',
        retryable: true,
      }),
      message: 'Notification inbox persistence was not confirmed',
      reason: notificationPersistenceReason,
      web_push: null,
      warning: NOTIFICATION_DELIVERY_INCOMPLETE_WARNING,
    });
  }

  let adminWebPush: AdminWebPushResult | null = null;
  // Send web push to admin browser subscribers for fc_update / fc_delete
  if (targetRole === 'admin') {
    const webPushResults = await Promise.all(
      Array.from(notificationIdByRecipient.entries()).map(([recipientId, notificationId]) =>
        notifyAdminWebPush(
          title,
          message,
          targetUrl,
          recipientId,
          notificationId,
          lifecycleTarget,
        )
      ),
    );
    if (webPushResults.length > 0) {
      adminWebPush = {
        ok: webPushResults.every((result) => result.ok),
        sent: webPushResults.reduce((sum, result) => sum + result.sent, 0),
        failed: webPushResults.reduce((sum, result) => sum + result.failed, 0),
        noTarget: webPushResults.every((result) => result.noTarget),
        reason: webPushResults.find((result) => !result.ok)?.reason,
      };
    }
  }
  const warning = getNotificationDeliveryWarning(adminWebPush);

  if (tokenLoadFailed) {
    return ok({
      ok: true,
      confirmed: true,
      sent: 0,
      stored: true,
      push_status: 'provider_failed',
      logged: true,
      delivery: buildDeliveryMetadata({
        notificationStored: true,
        pushStatus: 'provider_rejected',
        retryable: true,
        notificationIds: Array.from(notificationIdByRecipient.values()),
      }),
      message: 'Device token lookup failed',
      web_push: adminWebPush,
      warning,
    });
  }

  if (!tokens.length) {
    return ok({
      ...toExpoPushDeliveryOutcome({ attempted: 0, accepted: 0, rejected: 0 }),
      ok: true,
      confirmed: true,
      stored: true,
      push_status: resolvePushStatus({
        expoAttempted: 0,
        expoAccepted: 0,
        expoRejected: 0,
        adminWebPush,
      }),
      logged: true,
      delivery: buildDeliveryMetadata({
        notificationStored: true,
        pushStatus: adminWebPush?.ok === true && adminWebPush.sent > 0
          ? 'accepted'
          : 'no_registered_device',
        retryable: false,
        notificationIds: Array.from(notificationIdByRecipient.values()),
        accepted: adminWebPush?.ok === true ? adminWebPush.sent : 0,
      }),
      web_push: adminWebPush,
      warning,
    });
  }

  const payload = tokens.map((t) => ({
    to: t.expo_push_token,
    title,
    body: message,
    data: {
      fc_id: fcRow.id,
      resident_id: fcRow.phone ?? fcRow.resident_id_masked,
      name: fcRow.name,
      url: targetUrl,
      notificationId: notificationIdByRecipient.get(String(t.resident_id ?? '')),
      target: lifecycleTarget,
    },
    sound: 'default',
    priority: 'high',
    channelId: 'alerts',
  }));

  const delivery = await sendExpoPushPayloads(payload);

  return ok({
    ...toExpoPushDeliveryOutcome(delivery),
    ok: true,
    confirmed: true,
    stored: true,
    push_status: resolvePushStatus({
      expoAttempted: delivery.attempted,
      expoAccepted: delivery.accepted,
      expoRejected: delivery.rejected,
      adminWebPush,
    }),
    logged: true,
    target: lifecycleTarget,
    web_push: adminWebPush,
    warning,
    delivery: buildDeliveryMetadata({
      notificationStored: true,
      pushStatus:
        delivery.rejected > 0 || adminWebPush?.ok === false
          ? 'provider_rejected'
          : 'accepted',
      retryable: delivery.rejected > 0 || adminWebPush?.ok === false,
      notificationIds: Array.from(notificationIdByRecipient.values()),
      attempted: delivery.attempted,
      accepted: delivery.accepted + (adminWebPush?.ok === true ? adminWebPush.sent : 0),
      rejected: delivery.rejected,
    }),
  });
});
