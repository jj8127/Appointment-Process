import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  attachChatSummariesToContacts,
  buildDirectChatTargetSummaries,
  buildInternalChatList,
  shouldIncludeInternalChatParticipant,
} from '../_shared/internal-chat.ts';
import { runAfterResponse } from '../_shared/run-after-response.ts';
import { filterManagerTokensForNotification } from '../_shared/notification-delivery-policy.ts';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';
import {
  classifyExpoPushDelivery,
  type ExpoPushDeliverySummary,
  mergeExpoPushDeliverySummaries,
  toExpoPushDeliveryOutcome,
} from '../_shared/expo-push-delivery.ts';
import {
  buildAppFcNotifyPayload,
  type FcNotifyAppActor,
  type FcNotifyInboxCursor,
  getAllowedNotificationTokenRoles,
  isTrustedFcNotifyServiceKey,
  parseFcNotifyInboxCursor,
  shouldRequireActiveStaffNotificationTarget,
} from '../_shared/fc-notify-auth-policy.ts';
import {
  type AppSessionTokenPayload,
  parseDesignerCompanyNameFromAffiliation,
  requireAppSessionFromRequest,
} from '../_shared/request-board-auth.ts';
import {
  type NotificationTargetV1,
  parseNotificationTargetV1,
} from '../_shared/notification-target.ts';
import { validatePersistedNotificationForDelivery } from '../_shared/persisted-notification-delivery.ts';
import {
  drainMessengerAttachmentCleanup,
  finalizeMessengerAttachmentBatch,
  listMessengerAttachmentsByBatchIds,
  mapMessengerAttachmentRpcError,
  type MessengerAttachmentMetadata,
  MessengerAttachmentServiceError,
} from '../_shared/messenger-attachment-service.ts';
import {
  authorizeNotificationReceipt,
  authorizeNotificationReceiptSet,
  classifyNotificationReceiptState,
  type NotificationOwnershipRow,
  type NotificationReceiptViewer,
} from '../_shared/notification-receipt-policy.ts';
import { collectVisibleNotificationInboxRows } from '../_shared/notification-inbox-pagination.ts';
import { parseQueryCount, parseQueryRows } from '../_shared/query-result-contract.ts';
import {
  chunkSupabaseFilterValues,
  collectSupabaseRows,
} from '../../../lib/supabase-query-contract.ts';
import { mutationRowReceiptMatches } from '../_shared/ux-mutation-contract.ts';
import {
  buildDirectMessageIdentity,
  canAccessDirectConversation,
  canDeleteDirectMessage,
  type DirectConversationCounterparty,
  isCurrentDirectMessageVisible,
  isLegacyDirectMessageVisible,
} from '../_shared/direct-message-policy.ts';
import {
  buildDirectMessageExcerpt,
  escapePostgrestLikeLiteral,
} from '../_shared/direct-message-search.ts';
import {
  type AppPreferenceActorRole,
  type AppPushCategoryPreferenceRow as CategoryPreferenceRow,
  type AppPushPreferenceRow as GlobalPreferenceRow,
  buildMessengerRoomKey,
  evaluateNotificationPreference,
  isAppPushCategoryPreferenceRow as isCategoryPreferenceRow,
  isAppPushPreferenceRow as isGlobalPreferenceRow,
  isMessengerRoomPreferenceRow as isRoomPreferenceRow,
} from '../_shared/notification-preferences.ts';
import {
  isGeneralExpoPushEnabled,
  mapNotificationCategoryToAppPushCategory,
  selectSingleCanonicalPreferenceActor,
} from '../_shared/general-push-preference-policy.ts';

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
      limit?: number;
      cursor?: string | null;
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
      notification_cursor?: FcNotifyInboxCursor | null;
      notice_cursor?: FcNotifyInboxCursor | null;
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
      type: 'inbox_mark_all_read';
      role: 'admin' | 'fc';
      resident_id?: string | null;
      include_request_board_fc?: boolean;
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
      // direct_message_list only: the cursor from an earlier list; asks for changes after it.
      since?: string | null;
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
      type: 'direct_message_search';
      q: string;
      limit: number;
      viewer_actor_id?: string;
      viewer_actor_role?: 'fc' | 'manager' | 'admin' | 'developer';
    }
  | {
      type: 'direct_message_context';
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
      recipient_binding?: 'canonical_person_v1';
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
type AffiliationManagerMappingRow = {
  affiliation: string;
  manager_phone: string;
};
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
type GeneralPushActorRow = {
  id: string;
  phone: string | null;
  affiliation?: string | null;
  signup_completed?: boolean | null;
  is_manager_referral_shadow?: boolean | null;
};

type GeneralPushFcActorRow = GeneralPushActorRow & {
  affiliation: string | null;
  signup_completed: true;
  is_manager_referral_shadow: boolean;
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
  category_id: string;
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
type InternalMessengerSummary = {
  last_message: string | null;
  last_time: string | null;
  unread_count: number;
};
type InternalChatPageRow = {
  fc_id: string;
  name: string;
  phone: string;
  affiliation: string | null;
  last_message: string | null;
  last_time: string | null;
  unread_count: number;
  total_unread: number;
  latest_at: string;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_CHUNK_SIZE = 100;
// UUID filters are much longer than resident-number filters. Keep preference
// lookups below gateway URL limits for broadcast-sized FC audiences.
const GENERAL_PUSH_PREFERENCE_QUERY_CHUNK_SIZE = 100;
const EXPO_PUSH_TIMEOUT_MS = 10_000;
const NOTIFICATION_QUERY_PAGE_SIZE = 200;
const NOTIFICATION_RECEIPT_BATCH_SIZE = 100;
const BOARD_HOME_CATEGORY_SLUGS = ['notice', 'garam-pick'] as const;
const BOARD_NOTICE_ID_PREFIX = 'board_notice:';
const LEGACY_NOTICE_ID_AFTER_BOARD_PREFIX_BOUNDARY = 'c0000000-0000-0000-0000-000000000000';
const INTERNAL_CHAT_EPOCH = '1970-01-01T00:00:00.000Z';
const BOARD_ATTACHMENT_SIGN_EXPIRES_SECONDS = 60 * 60 * 6;
const ADMIN_CHAT_ID = 'admin';

function formatOperationsMessengerName(value: unknown): string {
  const realName =
    typeof value === 'string'
      ? value
          .trim()
          .replace(/\s*총무\s*$/, '')
          .trim()
    : '';
  return realName ? `${realName}총무` : '총무';
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  '10본부 이수민',
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
  '10본부 [본부장: 한태균]': '10본부 이수민',
  '10본부 [본부장: 이수민]': '10본부 이수민',
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
const requireCanonicalRequestBoardRecipientBinding =
  getEnv('REQUIRE_CANONICAL_REQUEST_BOARD_RECIPIENT_BINDING') === 'true';

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
  return UUID_PATTERN.test(actorId) && role ? { actorId, role } : null;
}

async function fetchReceiptMap(
  notificationIds: string[],
  viewer: { actorId: string; role: 'fc' | 'manager' | 'admin' | 'developer' },
) {
  const uniqueIds = Array.from(new Set(notificationIds));
  if (
    uniqueIds.length !== notificationIds.length ||
    uniqueIds.some((notificationId) => !UUID_PATTERN.test(notificationId))
  )
    throw new Error('notification_receipt_query_contract_invalid');
  const receipts = new Map<string, { read_at: string | null; dismissed_at: string | null }>();

  for (let offset = 0; offset < uniqueIds.length; offset += NOTIFICATION_RECEIPT_BATCH_SIZE) {
    const batchIds = uniqueIds.slice(offset, offset + NOTIFICATION_RECEIPT_BATCH_SIZE);
    const batchIdSet = new Set(batchIds);
  const { data, error } = await supabase
    .from('notification_receipts')
    .select('notification_id,read_at,dismissed_at')
    .eq('viewer_actor_id', viewer.actorId)
    .eq('viewer_role', viewer.role)
      .in('notification_id', batchIds);
  if (error) throw error;
    const rows = parseQueryRows(data, isReceiptQueryRow);
    if (
      !rows ||
      rows.some(
        (row) => !batchIdSet.has(row.notification_id) || receipts.has(row.notification_id),
      ) ||
      new Set(rows.map((row) => row.notification_id)).size !== rows.length
    ) {
      throw new Error('notification_receipt_query_contract_invalid');
    }
    rows.forEach((row) => {
      receipts.set(row.notification_id, {
        read_at: row.read_at,
        dismissed_at: row.dismissed_at,
      });
    });
  }

  return receipts;
}

type NotificationReceiptWriteRow = {
  notification_id: string;
  viewer_actor_id: string;
  viewer_role: 'fc' | 'manager' | 'admin' | 'developer';
  read_at: string | null;
  dismissed_at?: string | null;
  updated_at: string;
};

async function persistNotificationReceiptRows(
  receiptRows: NotificationReceiptWriteRow[],
  viewer: { actorId: string; role: 'fc' | 'manager' | 'admin' | 'developer' },
): Promise<void> {
  if (
    new Set(receiptRows.map((row) => row.notification_id)).size !== receiptRows.length ||
    receiptRows.some(
      (row) =>
        !UUID_PATTERN.test(row.notification_id) ||
        row.viewer_actor_id !== viewer.actorId ||
        row.viewer_role !== viewer.role,
    )
  )
    throw new Error('notification_receipt_write_contract_invalid');

  for (let offset = 0; offset < receiptRows.length; offset += NOTIFICATION_RECEIPT_BATCH_SIZE) {
    const batchRows = receiptRows.slice(offset, offset + NOTIFICATION_RECEIPT_BATCH_SIZE);
    const expectedReceiptById = new Map(
      batchRows.map((row) => [
        row.notification_id,
      {
          read_at: row.read_at,
          hasDismissedAt: Object.prototype.hasOwnProperty.call(row, 'dismissed_at'),
          dismissed_at: row.dismissed_at ?? null,
      },
    ]),
  );
    const { data, error } = await supabase
      .from('notification_receipts')
      .upsert(batchRows, {
        onConflict: 'notification_id,viewer_actor_id,viewer_role',
      })
      .select('notification_id,viewer_actor_id,viewer_role,read_at,dismissed_at');
    const persistedReceipts = parseQueryRows(
      data,
      (
        value,
      ): value is ReceiptQueryRow & {
        viewer_actor_id: string;
        viewer_role: string;
      } => {
        if (!isReceiptQueryRow(value) || !isRecord(value)) return false;
        const row = value as Record<string, unknown>;
        return row.viewer_actor_id === viewer.actorId && row.viewer_role === viewer.role;
      },
    );
    if (
      error ||
      !persistedReceipts ||
      persistedReceipts.length !== batchRows.length ||
      new Set(persistedReceipts.map((row) => row.notification_id)).size !==
        persistedReceipts.length ||
      persistedReceipts.some((row) => {
        const expected = expectedReceiptById.get(row.notification_id);
        const expectedReceipt = expected
          ? {
              read_at: expected.read_at,
              ...(expected.hasDismissedAt ? { dismissed_at: expected.dismissed_at } : {}),
            }
          : null;
        return !expected || !expectedReceipt || !mutationRowReceiptMatches(row, expectedReceipt);
      })
    )
      throw new Error('notification_receipt_write_contract_invalid');
  }
}

const requiredServiceKey = serviceKey;
const supabase = createClient(supabaseUrl, requiredServiceKey);

type DirectPreferenceNotification = {
  notificationId: string;
  recipientActorId: string;
  recipientRole: AppPreferenceActorRole;
};

async function applyDirectMessageNotificationPreferences<T extends DirectPreferenceNotification>(
  threadId: string,
  notifications: T[],
): Promise<
  | {
      ok: true;
      retained: T[];
      expoEligibleIds: Set<string>;
      mutedCount: number;
    }
  | { ok: false }
> {
  if (notifications.length === 0) {
    return {
      ok: true,
      retained: [],
      expoEligibleIds: new Set(),
      mutedCount: 0,
    };
  }
  const roomKey = buildMessengerRoomKey('direct-thread', threadId);
  if (!roomKey) return { ok: false };
  const actorIds = Array.from(new Set(notifications.map((row) => row.recipientActorId)));
  const [globalResult, categoryResult, roomResult] = await Promise.all([
    supabase
      .from('app_push_preferences')
      .select('actor_id,actor_role,enabled')
      .in('actor_id', actorIds),
    supabase
      .from('app_push_category_preferences')
      .select('actor_id,actor_role,category,enabled')
      .in('actor_id', actorIds)
      .eq('category', 'messages'),
    supabase
      .from('messenger_room_notification_preferences')
      .select('actor_id,actor_role,room_key,muted')
      .in('actor_id', actorIds)
      .eq('room_key', roomKey),
  ]);
  const globalRows = parseQueryRows(globalResult.data, isGlobalPreferenceRow);
  const categoryRows = parseQueryRows(categoryResult.data, isCategoryPreferenceRow);
  const roomRows = parseQueryRows(roomResult.data, isRoomPreferenceRow);
  const actorIdSet = new Set(actorIds);
  if (
    globalResult.error ||
    categoryResult.error ||
    roomResult.error ||
    !globalRows ||
    !categoryRows ||
    !roomRows ||
    !hasUniquePreferenceActors(globalRows) ||
    !hasUniquePreferenceActors(categoryRows) ||
    !hasUniquePreferenceActors(roomRows) ||
    globalRows.some((row) => !actorIdSet.has(row.actor_id)) ||
    categoryRows.some((row) => !actorIdSet.has(row.actor_id) || row.category !== 'messages') ||
    roomRows.some((row) => !actorIdSet.has(row.actor_id) || row.room_key !== roomKey)
  )
    return { ok: false };

  const expoEligibleIds = new Set<string>();
  const mutedIds: string[] = [];
  const retained: T[] = [];
  for (const notification of notifications) {
    const preference = evaluateNotificationPreference({
      actor: {
        id: notification.recipientActorId,
        role: notification.recipientRole,
      },
      category: 'messages',
      roomKey,
      globalRows,
      categoryRows,
      roomRows,
    });
    if (preference.suppressInbox) {
      mutedIds.push(notification.notificationId);
      continue;
    }
    retained.push(notification);
    if (!preference.suppressExpo) {
      expoEligibleIds.add(notification.notificationId);
    }
  }

  if (mutedIds.length > 0) {
    const { data, error } = await supabase
      .from('notifications')
      .delete()
      .in('id', mutedIds)
      .select('id');
    const deletedRows = parseQueryRows(
      data,
      (value): value is { id: string } =>
        isRecord(value) && typeof value.id === 'string' && UUID_PATTERN.test(value.id),
    );
    if (error || !deletedRows) {
      return { ok: false };
    }
    const deletedIds = new Set(deletedRows.map((row) => row.id));
    if (mutedIds.some((id) => !deletedIds.has(id))) {
      return { ok: false };
    }
  }
  return { ok: true, retained, expoEligibleIds, mutedCount: mutedIds.length };
}

function buildGeneralPushActorKey(role: AppPreferenceActorRole, residentId: string) {
  return `${role}:${sanitize(residentId)}`;
}

async function loadGeneralPushPreferenceEligibility(
  tokens: TokenRow[],
  rawCategory: string,
): Promise<{ eligibleTokens: TokenRow[]; lookupFailed: boolean }> {
  if (tokens.length === 0) return { eligibleTokens: [], lookupFailed: false };

  const residentIdsByRole = {
    admin: new Set<string>(),
    manager: new Set<string>(),
    fc: new Set<string>(),
  };
  for (const token of tokens) {
    const role = String(token.role ?? '').trim();
    const residentId = sanitize(token.resident_id);
    if (residentId && (role === 'admin' || role === 'manager' || role === 'fc')) {
      residentIdsByRole[role].add(residentId);
    }
  }

  const queryStaffActors = async (
    table: 'admin_accounts' | 'manager_accounts',
    residentIds: Set<string>,
  ): Promise<GeneralPushActorRow[]> => {
    const rows: GeneralPushActorRow[] = [];
    const seenIds = new Set<string>();
    for (const phoneChunk of chunkSupabaseFilterValues(
      Array.from(residentIds),
      GENERAL_PUSH_PREFERENCE_QUERY_CHUNK_SIZE,
    )) {
      const phoneSet = new Set(phoneChunk);
      const chunkRows = await collectSupabaseRows<GeneralPushActorRow>({
        queryName: `${table}_general_push_actors`,
        isRow: isGeneralPushStaffActorRow,
        rowKey: (row) => row.id,
        fetchPage: (from, to) =>
          supabase
      .from(table)
      .select('id,phone')
            .in('phone', phoneChunk)
            .eq('active', true)
            .order('id', { ascending: true })
            .range(from, to),
      });
      if (chunkRows.some((row) => !phoneSet.has(sanitize(row.phone)) || seenIds.has(row.id))) {
        throw new Error('general_push_actor_query_contract_invalid');
    }
      chunkRows.forEach((row) => seenIds.add(row.id));
      rows.push(...chunkRows);
    }
    return rows;
  };
  const queryFcActors = async (residentIds: Set<string>): Promise<GeneralPushFcActorRow[]> => {
    const rows: GeneralPushFcActorRow[] = [];
    const seenIds = new Set<string>();
    for (const phoneChunk of chunkSupabaseFilterValues(
      Array.from(residentIds),
      GENERAL_PUSH_PREFERENCE_QUERY_CHUNK_SIZE,
    )) {
      const phoneSet = new Set(phoneChunk);
      const chunkRows = await collectSupabaseRows<GeneralPushFcActorRow>({
        queryName: 'fc_general_push_actors',
        isRow: isGeneralPushFcActorRow,
        rowKey: (row) => row.id,
        fetchPage: (from, to) =>
          supabase
      .from('fc_profiles')
      .select('id,phone,affiliation,signup_completed,is_manager_referral_shadow')
            .in('phone', phoneChunk)
            .eq('signup_completed', true)
            .order('id', { ascending: true })
            .range(from, to),
      });
      if (chunkRows.some((row) => !phoneSet.has(sanitize(row.phone)) || seenIds.has(row.id))) {
        throw new Error('general_push_actor_query_contract_invalid');
      }
      chunkRows.forEach((row) => seenIds.add(row.id));
      rows.push(...chunkRows);
    }
    return rows;
  };

  const [adminRows, managerRows, designerFcRows, fcRows] = await Promise.all([
    queryStaffActors('admin_accounts', residentIdsByRole.admin),
    queryStaffActors('manager_accounts', residentIdsByRole.manager),
    queryFcActors(residentIdsByRole.manager),
    queryFcActors(residentIdsByRole.fc),
  ]);

  const actorCandidatesByKey = new Map<
    string,
    Array<{ id: string; role: AppPreferenceActorRole }>
  >();
  const addActors = (role: AppPreferenceActorRole, rows: GeneralPushActorRow[]) => {
    for (const row of rows) {
      const actorId = String(row.id ?? '')
        .trim()
        .toLowerCase();
      const residentId = sanitize(row.phone);
      if (!UUID_PATTERN.test(actorId) || !residentId) continue;
      const key = buildGeneralPushActorKey(role, residentId);
      actorCandidatesByKey.set(key, [
        ...(actorCandidatesByKey.get(key) ?? []),
        { id: actorId, role },
      ]);
    }
  };
  addActors('admin', adminRows);
  addActors('manager', managerRows);
  addActors(
    'manager',
    designerFcRows.filter(
      (row) =>
        row.is_manager_referral_shadow !== true &&
        Boolean(parseDesignerCompanyNameFromAffiliation(row.affiliation)),
    ),
  );
  addActors(
    'fc',
    fcRows.filter(
      (row) =>
        row.is_manager_referral_shadow !== true &&
        !parseDesignerCompanyNameFromAffiliation(row.affiliation),
    ),
  );
  const actorsByKey = new Map(
    Array.from(actorCandidatesByKey.entries()).map(([key, candidates]) => [
      key,
      selectSingleCanonicalPreferenceActor(candidates),
    ]),
  );

  const actors = Array.from(actorsByKey.values()).filter(
    (actor): actor is { id: string; role: AppPreferenceActorRole } => actor !== null,
  );
  if (actors.length === 0) {
    return { eligibleTokens: [], lookupFailed: true };
  }
  const actorIds = Array.from(new Set(actors.map((actor) => actor.id)));
  const category = mapNotificationCategoryToAppPushCategory(rawCategory);
  const preferenceResults = await Promise.all(
    chunkSupabaseFilterValues(actorIds, GENERAL_PUSH_PREFERENCE_QUERY_CHUNK_SIZE).map(
      async (actorIdChunk) => {
      const [globalResult, categoryResult] = await Promise.all([
        supabase
          .from('app_push_preferences')
          .select('actor_id,actor_role,enabled')
          .in('actor_id', actorIdChunk),
        supabase
          .from('app_push_category_preferences')
          .select('actor_id,actor_role,category,enabled')
          .in('actor_id', actorIdChunk)
          .eq('category', category),
      ]);
        return { actorIdChunk, globalResult, categoryResult };
      },
    ),
  );
  const preferenceLookupInvalid = preferenceResults.some(
    ({ actorIdChunk, globalResult, categoryResult }) => {
      const globalRows = parseQueryRows(globalResult.data, isGlobalPreferenceRow);
      const categoryRows = parseQueryRows(categoryResult.data, isCategoryPreferenceRow);
      const actorIdSet = new Set(actorIdChunk);
      return (
        Boolean(globalResult.error) ||
        Boolean(categoryResult.error) ||
        !globalRows ||
        !categoryRows ||
        !hasUniquePreferenceActors(globalRows) ||
        !hasUniquePreferenceActors(categoryRows) ||
        globalRows.some((row) => !actorIdSet.has(row.actor_id)) ||
        categoryRows.some((row) => !actorIdSet.has(row.actor_id) || row.category !== category)
      );
    },
  );
  if (preferenceLookupInvalid) {
    return { eligibleTokens: [], lookupFailed: true };
  }
  const globalRows = preferenceResults.flatMap(
    ({ globalResult }) => globalResult.data as GlobalPreferenceRow[],
  );
  const categoryRows = preferenceResults.flatMap(
    ({ categoryResult }) => categoryResult.data as CategoryPreferenceRow[],
  );

  let unresolvedActor = false;
  const eligibleTokens = tokens.filter((token) => {
    const role = String(token.role ?? '').trim();
    const residentId = sanitize(token.resident_id);
    if (role !== 'admin' && role !== 'manager' && role !== 'fc') {
      unresolvedActor = true;
      return false;
    }
    const actor = actorsByKey.get(buildGeneralPushActorKey(role, residentId));
    if (!actor) {
      unresolvedActor = true;
      return false;
    }
    return isGeneralExpoPushEnabled({
      actor,
      category,
      globalRows,
      categoryRows,
    });
  });
  return { eligibleTokens, lookupFailed: unresolvedActor };
}

async function applyGeneralPushPreferences(
  tokens: TokenRow[],
  rawCategory: string,
): Promise<{ eligibleTokens: TokenRow[]; lookupFailed: boolean }> {
  try {
    return await loadGeneralPushPreferenceEligibility(tokens, rawCategory);
  } catch {
    return { eligibleTokens: [], lookupFailed: true };
  }
}

async function fetchInternalMessengerSummaries(
  viewerId: string,
  targetIds: string[],
): Promise<Record<string, InternalMessengerSummary>> {
  const uniqueTargetIds = Array.from(
    new Set(targetIds.map((value) => value.trim()).filter(Boolean)),
  );
  const summaries = Object.fromEntries(
    uniqueTargetIds.map((targetId) => [
      targetId,
      {
    last_message: null,
    last_time: null,
    unread_count: 0,
      },
    ]),
  ) as Record<string, InternalMessengerSummary>;
  if (uniqueTargetIds.length === 0) return summaries;

  const { data, error } = await supabase.rpc('get_internal_messenger_summaries_v1', {
    p_viewer_id: viewerId,
    p_target_ids: uniqueTargetIds,
  });
  if (error) throw error;
  const rows = parseQueryRows(data, isInternalMessengerSummaryQueryRow);
  const targetIdSet = new Set(uniqueTargetIds);
  if (
    !rows ||
    rows.some((row) => !targetIdSet.has(row.target_id.trim())) ||
    new Set(rows.map((row) => row.target_id.trim())).size !== rows.length
  ) {
    throw new Error('internal_messenger_summary_query_contract_invalid');
  }

  for (const rawRow of rows) {
    const targetId = rawRow.target_id.trim();
    const unreadCount = rawRow.unread_count;
    summaries[targetId] = {
      last_message: rawRow.last_message,
      last_time: rawRow.last_time,
      unread_count: unreadCount,
    };
  }
  return summaries;
}

function isMissingInternalMessengerSummaryRpc(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const code = String(record.code ?? '').toUpperCase();
  const message = String(record.message ?? '');
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    (message.includes('get_internal_messenger_summaries_v1') &&
      /could not find|does not exist/i.test(message))
    );
}

function isMissingInternalChatPageRpc(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const code = String(record.code ?? '').toUpperCase();
  const message = String(record.message ?? '');
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    (message.includes('list_internal_chat_page_v1') &&
      /could not find|does not exist/i.test(message))
    );
}

async function fetchLegacyInternalMessengerSummaries(
  viewerId: string,
  targetIds: string[],
): Promise<Record<string, InternalMessengerSummary>> {
  const uniqueTargetIds = Array.from(
    new Set(targetIds.map((value) => value.trim()).filter(Boolean)),
  );
  if (uniqueTargetIds.length === 0) {
    return buildDirectChatTargetSummaries({
      viewerId,
      targetIds: [],
      messages: [],
    });
  }

  const targetFilter = uniqueTargetIds.join(',');
  const rows = await collectSupabaseRows<LegacyInternalMessageQueryRow>({
    queryName: 'internal_messenger_legacy_messages',
    isRow: isLegacyInternalMessageQueryRow,
    rowKey: (row) => row.id,
    fetchPage: (from, to) =>
      supabase
        .from('messages')
        .select(
          'id,sender_id,receiver_id,content,created_at,is_read,file_name,attachment_batch_id,deleted_at',
        )
        .or(
          `and(sender_id.eq.${viewerId},receiver_id.in.(${targetFilter})),` +
            `and(receiver_id.eq.${viewerId},sender_id.in.(${targetFilter}))`,
        )
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
  });

  return buildDirectChatTargetSummaries({
    viewerId,
    targetIds: uniqueTargetIds,
    messages: rows.map((row) => {
      const content = row.content.trim();
      const fileName = row.file_name?.trim() ?? '';
      return {
        sender_id: row.sender_id,
        receiver_id: row.receiver_id,
        content: content || fileName || (row.attachment_batch_id ? '첨부파일' : null),
        created_at: row.created_at,
        is_read: row.is_read,
      };
    }),
  });
}

async function fetchLegacyInternalChatList(viewerId: string, includeAllCompletedFc: boolean) {
  const [participants, messageRows] = await Promise.all([
    fetchInternalFcProfiles(),
    collectSupabaseRows<LegacyInternalMessageQueryRow>({
      queryName: 'internal_chat_legacy_messages',
      isRow: isLegacyInternalMessageQueryRow,
      rowKey: (row) => row.id,
      fetchPage: (from, to) =>
        supabase
          .from('messages')
          .select(
            'id,sender_id,receiver_id,content,created_at,is_read,file_name,attachment_batch_id,deleted_at',
          )
          .or(`sender_id.eq.${viewerId},receiver_id.eq.${viewerId}`)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
    }),
  ]);

  return buildInternalChatList({
    viewerId,
    participants: participants.map((participant) => ({
      fc_id: participant.id,
      name: participant.name,
      phone: participant.phone,
      affiliation: participant.affiliation,
    })),
    messages: messageRows.map((row) => {
      const content = row.content.trim();
      const fileName = row.file_name?.trim() ?? '';
      return {
        sender_id: row.sender_id,
        receiver_id: row.receiver_id,
        content: content || fileName || (row.attachment_batch_id ? '첨부파일' : null),
        created_at: row.created_at,
        is_read: row.is_read,
      };
    }),
    includeAllCompletedFc,
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
    allowBroadcast: input.inboxRole === 'fc' || !input.residentId,
    includeRequestBoardFc:
      input.inboxRole === 'admin' &&
      Boolean(input.residentId) &&
      input.includeRequestBoardFc === true,
  };
}

function applyNotificationAudienceScope(query: any, viewer: NotificationReceiptViewer) {
  return viewer.allowBroadcast
    ? query.or(
      `recipient_actor_id.eq.${viewer.actorId},and(recipient_actor_id.is.null,resident_id.is.null)`,
    )
    : query.eq('recipient_actor_id', viewer.actorId);
}

function toNotificationOwnershipRow(row: Record<string, unknown>): NotificationOwnershipRow {
  return {
    id: String(row.id ?? ''),
    recipient_actor_id: typeof row.recipient_actor_id === 'string' ? row.recipient_actor_id : null,
    recipient_role: typeof row.recipient_role === 'string' ? row.recipient_role : null,
    resident_id: typeof row.resident_id === 'string' ? row.resident_id : null,
    category: typeof row.category === 'string' ? row.category : null,
  };
}

type NotificationOwnershipQueryOptions = {
  role: 'admin' | 'fc';
  receiptViewer: NotificationReceiptViewer;
  sinceIso?: string;
  excludeRequestBoardCategories?: boolean;
  onlyRequestBoardCategories?: boolean;
};

type NotificationQueryResult = { data: unknown; error: unknown };
type NotificationQueryBuilder = PromiseLike<NotificationQueryResult> & {
  order(column: string, options: { ascending: boolean }): NotificationQueryBuilder;
  range(from: number, to: number): NotificationQueryBuilder;
  gt(column: string, value: string): NotificationQueryBuilder;
  ilike(column: string, pattern: string): NotificationQueryBuilder;
  not(column: string, operator: string, value: string): NotificationQueryBuilder;
};

function collectAllNotificationOwnershipRows(
  buildQuery: (selectColumns: string) => NotificationQueryBuilder,
): Promise<Array<Record<string, unknown>>> {
  return collectSupabaseRows<Record<string, unknown>>({
    queryName: 'notification_ownership',
    isRow: isNotificationOwnershipPageQueryRow,
    rowKey: (row) => String(row.id),
    pageSize: NOTIFICATION_QUERY_PAGE_SIZE,
    fetchPage: (from, to) => buildQuery(
      'id,recipient_actor_id,recipient_role,resident_id,category,created_at',
    )
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  });
}

async function fetchVisibleNotificationOwnershipRows({
  role,
  receiptViewer,
  sinceIso,
  excludeRequestBoardCategories = false,
  onlyRequestBoardCategories = false,
}: NotificationOwnershipQueryOptions): Promise<Array<Record<string, unknown>>> {
  const applyFilters = (query: NotificationQueryBuilder) => {
    let filtered = query;
    if (sinceIso) filtered = filtered.gt('created_at', sinceIso);
    if (onlyRequestBoardCategories) {
      filtered = filtered.ilike('category', `${REQUEST_BOARD_CATEGORY_PREFIX}%`);
    } else if (excludeRequestBoardCategories) {
      filtered = filtered.not('category', 'ilike', `${REQUEST_BOARD_CATEGORY_PREFIX}%`);
    }
    return filtered;
  };
  const primaryRows = await collectAllNotificationOwnershipRows((selectColumns) =>
    applyFilters(
      applyNotificationAudienceScope(
        supabase.from('notifications').select(selectColumns).eq('recipient_role', role),
        receiptViewer,
      ),
    ),
  );
  const requestBoardFcRows =
    receiptViewer.includeRequestBoardFc && !excludeRequestBoardCategories
      ? await collectAllNotificationOwnershipRows((selectColumns) => {
          let query = supabase
            .from('notifications')
            .select(selectColumns)
            .eq('recipient_role', 'fc')
            .eq('recipient_actor_id', receiptViewer.actorId)
            .ilike('category', `${REQUEST_BOARD_CATEGORY_PREFIX}%`);
          if (sinceIso) query = query.gt('created_at', sinceIso);
          return query;
        })
      : [];
  const mergedRows = [...primaryRows, ...requestBoardFcRows];
  if (new Set(mergedRows.map((row) => String(row.id))).size !== mergedRows.length) {
    throw new Error('notification_ownership_query_contract_invalid');
  }
  return mergedRows.filter(
    (row) =>
      authorizeNotificationReceipt(toNotificationOwnershipRow(row), receiptViewer).authorized,
  );
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
  changed_at?: string;
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

type ReceiptQueryRow = {
  notification_id: string;
  read_at: string | null;
  dismissed_at: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && UUID_PATTERN.test(value));
}

function isGeneralPushStaffActorRow(value: unknown): value is GeneralPushActorRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    typeof value.phone === 'string' &&
    sanitize(value.phone).length === 11
  );
}

function isGeneralPushFcActorRow(value: unknown): value is GeneralPushFcActorRow {
  return (
    isGeneralPushStaffActorRow(value) &&
    isNullableString((value as Record<string, unknown>).affiliation) &&
    (value as Record<string, unknown>).signup_completed === true &&
    typeof (value as Record<string, unknown>).is_manager_referral_shadow === 'boolean'
  );
}

function isPhoneQueryRow(value: unknown): value is { phone: string } {
  return isRecord(value) && typeof value.phone === 'string' && sanitize(value.phone).length === 11;
}

function isAdminPhoneStaffQueryRow(
  value: unknown,
): value is { phone: string; staff_type: string | null } {
  return isPhoneQueryRow(value) && isNullableString((value as Record<string, unknown>).staff_type);
}

function isUuidQueryRow(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === 'string' && UUID_PATTERN.test(value.id);
}

function isManagerPhoneMappingQueryRow(value: unknown): value is { manager_phone: string } {
  return (
    isRecord(value) &&
    typeof value.manager_phone === 'string' &&
    sanitize(value.manager_phone).length === 11
  );
}

type AccountIdentityQueryRow = {
  id: string;
  name: string | null;
  phone: string;
};

function isAccountIdentityQueryRow(value: unknown): value is AccountIdentityQueryRow {
  return (
    isUuidQueryRow(value) &&
    isNullableString((value as Record<string, unknown>).name) &&
    typeof (value as Record<string, unknown>).phone === 'string' &&
    sanitize((value as Record<string, unknown>).phone as string).length === 11
  );
}

function isActiveStaffIdentityQueryRow(value: unknown): value is AccountIdentityQueryRow & {
  active: true;
  staff_type: string | null;
} {
  return (
    isAccountIdentityQueryRow(value) &&
    (value as Record<string, unknown>).active === true &&
    isNullableString((value as Record<string, unknown>).staff_type)
  );
}

function isActiveManagerIdentityQueryRow(
  value: unknown,
): value is AccountIdentityQueryRow & { active: true } {
  return isAccountIdentityQueryRow(value) && (value as Record<string, unknown>).active === true;
}

function isTokenQueryRow(value: unknown): value is TokenRow {
  return (
    isRecord(value) &&
    typeof value.expo_push_token === 'string' &&
    value.expo_push_token.trim().length > 0 &&
    isNullableString(value.resident_id) &&
    isNullableString(value.display_name) &&
    isNullableString(value.role)
  );
}

// Rows stamped just before another transaction commits can become visible a
// moment later, so a changes request re-reads this much before its cursor.
const DIRECT_MESSAGE_CURSOR_OVERLAP_MS = 10_000;
// A cursor older than this is treated as missing: the client reloads in full.
const DIRECT_MESSAGE_CURSOR_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function parseDirectMessageCursor(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = new Date(value);
  const time = parsed.getTime();
  if (!Number.isFinite(time)) return null;
  const now = Date.now();
  if (time > now + 60_000 || time < now - DIRECT_MESSAGE_CURSOR_MAX_AGE_MS) return null;
  return parsed;
}

// The public broadcast channel that says "this conversation changed". Its name
// is an HMAC of the thread id kept in the database, so only participants learn
// it. A failure only costs the realtime hint: the room keeps its timer refresh.
async function loadDirectMessageRealtimeTopic(threadId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('messenger_direct_realtime_topic_v1', {
      p_thread_id: threadId,
    });
    if (error) return null;
    return typeof data === 'string' && /^dm-[0-9a-f]{64}$/.test(data) ? data : null;
  } catch {
    return null;
  }
}

function latestDirectMessageChange(rows: DirectMessageRow[]): string | null {
  let latest: number | null = null;
  for (const row of rows) {
    const time = typeof row.changed_at === 'string' ? Date.parse(row.changed_at) : NaN;
    if (Number.isFinite(time) && (latest === null || time > latest)) latest = time;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

function isDirectMessageRow(value: unknown): value is DirectMessageRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    isNullableUuid(value.conversation_id) &&
    isNullableUuid(value.thread_id) &&
    typeof value.sender_id === 'string' &&
    value.sender_id.trim().length > 0 &&
    typeof value.receiver_id === 'string' &&
    value.receiver_id.trim().length > 0 &&
    isNullableUuid(value.sender_actor_id) &&
    isNullableUuid(value.receiver_actor_id) &&
    typeof value.content === 'string' &&
    typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at)) &&
    typeof value.is_read === 'boolean' &&
    (value.message_type === null ||
      value.message_type === 'text' ||
      value.message_type === 'image' ||
      value.message_type === 'file') &&
    isNullableString(value.file_url) &&
    isNullableString(value.file_name) &&
    (value.file_size === null ||
      (Number.isSafeInteger(value.file_size) && Number(value.file_size) >= 0)) &&
    isNullableUuid(value.attachment_batch_id) &&
    (value.deleted_at === null ||
      (typeof value.deleted_at === 'string' && Number.isFinite(Date.parse(value.deleted_at)))) &&
    isNullableUuid(value.deleted_by_actor_id)
  );
}

function hasUniquePreferenceActors(rows: Array<{ actor_id: string; actor_role: string }>) {
  const keys = rows.map((row) => `${row.actor_role}:${row.actor_id}`);
  return new Set(keys).size === keys.length;
}

function isReceiptQueryRow(value: unknown): value is ReceiptQueryRow {
  if (
    !isRecord(value) ||
    typeof value.notification_id !== 'string' ||
    !UUID_PATTERN.test(value.notification_id)
  )
    return false;
  return (
    (value.read_at === null ||
      (typeof value.read_at === 'string' && Number.isFinite(Date.parse(value.read_at)))) &&
    (value.dismissed_at === null ||
      (typeof value.dismissed_at === 'string' && Number.isFinite(Date.parse(value.dismissed_at))))
  );
}

function isNotificationOwnershipQueryRow(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)) {
    return false;
  }
  return (
    isNullableUuid(value.recipient_actor_id) &&
    (value.recipient_role === null ||
      value.recipient_role === 'fc' ||
      value.recipient_role === 'manager' ||
      value.recipient_role === 'admin') &&
    isNullableString(value.resident_id) &&
    isNullableString(value.category)
  );
}

function isNotificationOwnershipPageQueryRow(value: unknown): value is Record<string, unknown> {
  return (
    isNotificationOwnershipQueryRow(value) &&
    typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at))
  );
}

type InternalMessengerSummaryQueryRow = {
  target_id: string;
  last_message: string | null;
  last_time: string | null;
  unread_count: number;
};

function isInternalMessengerSummaryQueryRow(
  value: unknown,
): value is InternalMessengerSummaryQueryRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.target_id === 'string' &&
    value.target_id.trim().length > 0 &&
    isNullableString(value.last_message) &&
    (value.last_time === null ||
      (typeof value.last_time === 'string' && Number.isFinite(Date.parse(value.last_time)))) &&
    Number.isSafeInteger(value.unread_count) &&
    Number(value.unread_count) >= 0
  );
}

function isInternalChatPageQueryRow(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const phone = sanitize(typeof value.phone === 'string' ? value.phone : '');
  return (
    typeof value.fc_id === 'string' &&
    UUID_PATTERN.test(value.fc_id) &&
    phone.length === 11 &&
    isNullableString(value.name) &&
    isNullableString(value.affiliation) &&
    isNullableString(value.last_message) &&
    (value.last_time === null ||
      (typeof value.last_time === 'string' && Number.isFinite(Date.parse(value.last_time)))) &&
    Number.isSafeInteger(value.unread_count) &&
    Number(value.unread_count) >= 0 &&
    Number.isSafeInteger(value.total_unread) &&
    Number(value.total_unread) >= 0 &&
    typeof value.latest_at === 'string' &&
    Number.isFinite(Date.parse(value.latest_at))
  );
}

type LegacyInternalMessageQueryRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
  file_name: string | null;
  attachment_batch_id: string | null;
  deleted_at: null;
};

function isLegacyInternalMessageQueryRow(value: unknown): value is LegacyInternalMessageQueryRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    typeof value.sender_id === 'string' &&
    value.sender_id.trim().length > 0 &&
    typeof value.receiver_id === 'string' &&
    value.receiver_id.trim().length > 0 &&
    typeof value.content === 'string' &&
    typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at)) &&
    typeof value.is_read === 'boolean' &&
    isNullableString(value.file_name) &&
    isNullableUuid(value.attachment_batch_id) &&
    value.deleted_at === null
  );
}

type InternalFcProfileQueryRow = {
  id: string;
  name: string | null;
  phone: string;
  affiliation: string | null;
};

function isInternalFcProfileQueryRow(value: unknown): value is InternalFcProfileQueryRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    isNullableString(value.name) &&
    typeof value.phone === 'string' &&
    sanitize(value.phone).length === 11 &&
    isNullableString(value.affiliation)
  );
}

function isDirectConversationThreadRow(value: unknown): value is DirectConversationThreadRow {
  if (!isRecord(value)) return false;
  const hasValidCounterparty =
    value.counterparty_role === 'admin'
      ? isNullableUuid(value.counterparty_actor_id)
      : (value.counterparty_role === 'manager' || value.counterparty_role === 'developer') &&
        typeof value.counterparty_actor_id === 'string' &&
        UUID_PATTERN.test(value.counterparty_actor_id);
  return (
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    typeof value.legacy_conversation_id === 'string' &&
    UUID_PATTERN.test(value.legacy_conversation_id) &&
    hasValidCounterparty
  );
}

type DirectConversationQueryRow = { id: string; fc_id: string };

function isDirectConversationQueryRow(value: unknown): value is DirectConversationQueryRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    typeof value.fc_id === 'string' &&
    UUID_PATTERN.test(value.fc_id)
  );
}

type AccessibleFcProfileQueryRow = InternalFcProfileQueryRow & {
  signup_completed: boolean;
  is_manager_referral_shadow: boolean;
};

function isAccessibleFcProfileQueryRow(value: unknown): value is AccessibleFcProfileQueryRow {
  return (
    isInternalFcProfileQueryRow(value) &&
    (value as Record<string, unknown>).signup_completed === true &&
    (value as Record<string, unknown>).is_manager_referral_shadow === false
  );
}

type ChatTargetAccountQueryRow = {
  name: string | null;
  phone: string;
  staff_type?: string | null;
};

function isChatTargetManagerQueryRow(value: unknown): value is ChatTargetAccountQueryRow {
  return (
    isRecord(value) &&
    isNullableString(value.name) &&
    typeof value.phone === 'string' &&
    sanitize(value.phone).length === 11 &&
    value.staff_type === undefined
  );
}

function isChatTargetStaffQueryRow(value: unknown): value is ChatTargetAccountQueryRow {
  return (
    isRecord(value) &&
    isNullableString(value.name) &&
    typeof value.phone === 'string' &&
    sanitize(value.phone).length === 11 &&
    isNullableString(value.staff_type)
  );
}

function isAffiliationManagerMappingQueryRow(
  value: unknown,
): value is AffiliationManagerMappingRow {
  return (
    isRecord(value) &&
    typeof value.affiliation === 'string' &&
    normalizeAffiliationLabel(value.affiliation).length > 0 &&
    typeof value.manager_phone === 'string' &&
    sanitize(value.manager_phone).length === 11
  );
}

function isNoticeFile(value: unknown): value is NoticeFile {
  if (!isRecord(value)) return false;
  return (
    (value.name === undefined || typeof value.name === 'string') &&
    (value.url === undefined || typeof value.url === 'string') &&
    (value.type === undefined || typeof value.type === 'string')
  );
}

function isNoticeQueryRow(value: unknown, includeAttachments: boolean): value is NoticeRow {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.title !== 'string' ||
    typeof value.body !== 'string' ||
    !isNullableString(value.category) ||
    typeof value.created_at !== 'string' ||
    !Number.isFinite(Date.parse(value.created_at))
  )
    return false;
  if (!includeAttachments) return true;
  return (
    (value.images === null ||
      (Array.isArray(value.images) && value.images.every((item) => typeof item === 'string'))) &&
    (value.files === null || (Array.isArray(value.files) && value.files.every(isNoticeFile)))
  );
}

function isBoardNoticeCategoryQueryRow(value: unknown): value is BoardNoticeCategoryRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    isNullableString(value.name) &&
    typeof value.slug === 'string' &&
    (BOARD_HOME_CATEGORY_SLUGS as readonly string[]).includes(value.slug)
  );
}

function isBoardNoticePostQueryRow(value: unknown): value is BoardNoticePostRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    typeof value.category_id === 'string' &&
    UUID_PATTERN.test(value.category_id) &&
    typeof value.title === 'string' &&
    typeof value.content === 'string' &&
    typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at))
  );
}

function isBoardAttachmentQueryRow(value: unknown): value is BoardAttachmentRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    typeof value.post_id === 'string' &&
    UUID_PATTERN.test(value.post_id) &&
    (value.file_type === 'image' || value.file_type === 'file') &&
    typeof value.file_name === 'string' &&
    value.file_name.trim().length > 0 &&
    Number.isSafeInteger(value.file_size) &&
    Number(value.file_size) >= 0 &&
    isNullableString(value.mime_type) &&
    typeof value.storage_path === 'string' &&
    value.storage_path.trim().length > 0 &&
    Number.isSafeInteger(value.sort_order) &&
    Number(value.sort_order) >= 0 &&
    typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at))
  );
}

const NOTIFICATION_DELIVERY_INCOMPLETE_WARNING = 'notification_delivery_incomplete';

function isTimeoutError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: unknown }).name === 'TimeoutError'
  );
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
 * Compatibility no-op for the retired administrator Web Push channel.
 *
 * The canonical inbox row remains the complete administrator delivery
 * boundary. Returning an accepted no-target result keeps older response
 * contracts stable without invoking the browser push callback or creating a
 * sender-facing warning.
 */
function notifyAdminWebPush(
  title: string,
  body: string,
  url: string,
  targetId: string | null,
  notificationId: string,
  target: NotificationTargetV1,
) {
  void title;
  void body;
  void url;
  void targetId;
  void notificationId;
  void target;

  return {
    ok: true,
    sent: 0,
    failed: 0,
    noTarget: true,
    reason: 'in-app-only',
  } as AdminWebPushResult;
}

function getNotificationDeliveryWarning(adminWebPush: AdminWebPushResult | null): string | null {
  // Provider delivery is operational metadata only. Once the canonical inbox
  // row exists, sender-facing UI must report success regardless of device state.
  void adminWebPush;
  return null;
}

type InboxCursorPage<Row> = {
  rows: Row[];
  hasMore: boolean;
  nextCursor: FcNotifyInboxCursor | null;
};

type NotificationInboxRow = Record<string, any> & {
  id: string;
  created_at: string;
};

function compareInboxRowsDescending(
  left: { created_at: string; id: string },
  right: { created_at: string; id: string },
): number {
  const createdAtDifference = Date.parse(right.created_at) - Date.parse(left.created_at);
  if (createdAtDifference !== 0) return createdAtDifference;
  if (left.id === right.id) return 0;
  return left.id < right.id ? 1 : -1;
}

function toInboxCursorPage<Row extends { created_at: string; id: string }>(
  rows: Row[],
  limit: number,
): InboxCursorPage<Row> {
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows[pageRows.length - 1];
  return {
    rows: pageRows,
    hasMore,
    nextCursor: hasMore && lastRow ? { created_at: lastRow.created_at, id: lastRow.id } : null,
  };
}

function applyNotificationInboxCursor(query: any, cursor: FcNotifyInboxCursor | null) {
  if (!cursor) return query;
  return query.or(
    `created_at.lt.${cursor.created_at},` +
      `and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
  );
}

function applyLegacyNoticeCursor(query: any, cursor: FcNotifyInboxCursor | null) {
  if (!cursor) return query;
  const idBoundary = cursor.id.startsWith(BOARD_NOTICE_ID_PREFIX)
    ? LEGACY_NOTICE_ID_AFTER_BOARD_PREFIX_BOUNDARY
    : cursor.id;
  return query.or(
    `created_at.lt.${cursor.created_at},` +
      `and(created_at.eq.${cursor.created_at},id.lt.${idBoundary})`,
  );
}

function applyBoardNoticeCursor(query: any, cursor: FcNotifyInboxCursor | null) {
  if (!cursor) return query;
  if (cursor.id.startsWith(BOARD_NOTICE_ID_PREFIX)) {
    const boardPostId = cursor.id.slice(BOARD_NOTICE_ID_PREFIX.length);
    return query.or(
      `created_at.lt.${cursor.created_at},` +
        `and(created_at.eq.${cursor.created_at},id.lt.${boardPostId})`,
    );
  }
  return BOARD_NOTICE_ID_PREFIX < cursor.id
    ? query.lte('created_at', cursor.created_at)
    : query.lt('created_at', cursor.created_at);
}

function resolvePushStatus(input: {
  expoAttempted: number;
  expoAccepted: number;
  expoRejected: number;
  adminWebPush: AdminWebPushResult | null;
}): 'delivered' | 'queued' | 'no_registered_device' | 'provider_failed' {
  if (input.adminWebPush?.ok === true && input.adminWebPush.sent > 0) {
    return 'delivered';
  }
  if (
    input.expoAttempted > 0 &&
    input.expoAccepted === input.expoAttempted &&
    input.expoRejected === 0
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

async function fetchNoticesWithOptionalAttachments(
  limit = 20,
  cursor: FcNotifyInboxCursor | null = null,
): Promise<NoticeRow[]> {
  const withAttachments = await applyLegacyNoticeCursor(
    supabase.from('notices').select('id,title,body,category,created_at,images,files'),
    cursor,
  )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (!withAttachments.error) {
    const rows = parseQueryRows(withAttachments.data, (value): value is NoticeRow =>
      isNoticeQueryRow(value, true),
    );
    if (!rows || new Set(rows.map((row) => row.id)).size !== rows.length) {
      throw new Error('notice_query_contract_invalid');
    }
    return rows.map((row) => ({
      ...row,
      target: UUID_PATTERN.test(row.id) ? { version: 1, kind: 'notice', noticeId: row.id } : null,
    }));
  }

  // Backward compatibility: some environments may not have images/files columns yet.
  if (withAttachments.error.code === '42703') {
    const basic = await applyLegacyNoticeCursor(
      supabase.from('notices').select('id,title,body,category,created_at'),
      cursor,
    )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (basic.error) throw basic.error;
    const rows = parseQueryRows(basic.data, (value): value is NoticeRow =>
      isNoticeQueryRow(value, false),
    );
    if (!rows || new Set(rows.map((row) => row.id)).size !== rows.length) {
      throw new Error('notice_query_contract_invalid');
    }
    return rows.map((row) => ({
      ...row,
      images: null,
      files: null,
      target: UUID_PATTERN.test(row.id) ? { version: 1, kind: 'notice', noticeId: row.id } : null,
    }));
  }

  throw withAttachments.error;
}

async function fetchNoticeByIdWithOptionalAttachments(noticeId: string): Promise<NoticeRow | null> {
  const withAttachments = await supabase
    .from('notices')
    .select('id,title,body,category,created_at,images,files')
    .eq('id', noticeId)
    .maybeSingle();

  if (!withAttachments.error) {
    const row = withAttachments.data;
    if (row !== null && !isNoticeQueryRow(row, true)) {
      throw new Error('notice_query_contract_invalid');
    }
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
    const row = basic.data;
    if (row !== null && !isNoticeQueryRow(row, false)) {
      throw new Error('notice_query_contract_invalid');
    }
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
  const rows = parseQueryRows(data, isBoardNoticeCategoryQueryRow);
  if (!rows || new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error('board_notice_category_query_contract_invalid');
  }
  return rows;
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

async function fetchBoardNoticesWithAttachments(
  limit = 20,
  cursor: FcNotifyInboxCursor | null = null,
): Promise<NoticeRow[]> {
  const categories = await fetchBoardHomeCategories();
  if (categories.length === 0) return [];

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const categoryIds = categories.map((category) => category.id);

  const { data: posts, error: postError } = await applyBoardNoticeCursor(
    supabase
    .from('board_posts')
    .select('id,category_id,title,content,created_at')
      .in('category_id', categoryIds),
    cursor,
  )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (postError) {
    if (isMissingTableError(postError)) return [];
    throw postError;
  }

  const postRows = parseQueryRows(posts, isBoardNoticePostQueryRow);
  if (
    !postRows ||
    new Set(postRows.map((row) => row.id)).size !== postRows.length ||
    postRows.some((row) => !categoryIds.includes(row.category_id))
  )
    throw new Error('board_notice_post_query_contract_invalid');
  if (postRows.length === 0) return [];

  const postIds = postRows.map((row) => row.id);
  const attachmentRows: BoardAttachmentRow[] = [];
  const seenAttachmentIds = new Set<string>();
  try {
    for (const postIdChunk of chunkSupabaseFilterValues(postIds)) {
      const postIdSet = new Set(postIdChunk);
      const chunkRows = await collectSupabaseRows<BoardAttachmentRow>({
        queryName: 'board_notice_attachments',
        isRow: isBoardAttachmentQueryRow,
        rowKey: (row) => row.id,
        fetchPage: (from, to) =>
          supabase
    .from('board_attachments')
            .select(
              'id,post_id,file_type,file_name,file_size,mime_type,storage_path,sort_order,created_at',
            )
            .in('post_id', postIdChunk)
    .order('post_id', { ascending: true })
    .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
      });
      if (chunkRows.some((row) => !postIdSet.has(row.post_id) || seenAttachmentIds.has(row.id))) {
        throw new Error('board_notice_attachment_query_contract_invalid');
      }
      chunkRows.forEach((row) => seenAttachmentIds.add(row.id));
      attachmentRows.push(...chunkRows);
    }
  } catch (error) {
    if (isMissingTableError(error)) {
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
    throw error;
  }
  const signedEntries = await Promise.all(
    attachmentRows.map(
      async (row) => [row.id, await createBoardAttachmentSignedUrl(row.storage_path)] as const,
    ),
  );
  if (signedEntries.some(([, signedUrl]) => !signedUrl)) {
    throw new Error('board_notice_attachment_signing_failed');
  }
  const signedUrlMap = new Map<string, string>();
  signedEntries.forEach(([id, signedUrl]) => {
    signedUrlMap.set(id, signedUrl as string);
  });

  const imageMap = new Map<string, string[]>();
  const fileMap = new Map<string, NoticeFile[]>();

  attachmentRows.forEach((row) => {
    const signedUrl = signedUrlMap.get(row.id);
    if (!signedUrl) throw new Error('board_notice_attachment_signing_failed');

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

async function fetchUnifiedNoticePage(
  limit = 20,
  cursor: FcNotifyInboxCursor | null = null,
): Promise<InboxCursorPage<NoticeRow>> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const sourceLimit = safeLimit + 1;
  const [legacyNotices, boardNotices] = await Promise.all([
    fetchNoticesWithOptionalAttachments(sourceLimit, cursor).catch((error) => {
      if (isMissingTableError(error)) return [] as NoticeRow[];
      throw error;
    }),
    fetchBoardNoticesWithAttachments(sourceLimit, cursor).catch((error) => {
      if (isMissingTableError(error)) return [] as NoticeRow[];
      throw error;
    }),
  ]);

  const merged = [...legacyNotices, ...boardNotices];
  if (new Set(merged.map((row) => row.id)).size !== merged.length) {
    throw new Error('unified_notice_query_contract_invalid');
  }
  merged.sort(compareInboxRowsDescending);
  return toInboxCursorPage(merged, safeLimit);
}

async function fetchUnifiedNotices(limit = 20): Promise<NoticeRow[]> {
  return (await fetchUnifiedNoticePage(limit)).rows;
}

async function countUnifiedNoticesAfter(sinceIso: string): Promise<number> {
  const [legacyResult, boardCategories] = await Promise.all([
    supabase
      .from('notices')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', sinceIso),
    fetchBoardHomeCategories(),
  ]);
  let legacyCount = 0;
  if (legacyResult.error) {
    if (!isMissingTableError(legacyResult.error)) throw legacyResult.error;
  } else {
    const exactLegacyCount = parseQueryCount(legacyResult.count);
    if (exactLegacyCount === null) {
      throw new Error('notice_count_query_contract_invalid');
    }
    legacyCount = exactLegacyCount;
  }

  if (boardCategories.length === 0) return legacyCount;
  const boardResult = await supabase
    .from('board_posts')
    .select('id', { count: 'exact', head: true })
    .in(
      'category_id',
      boardCategories.map((category) => category.id),
    )
    .gt('created_at', sinceIso);
  if (boardResult.error) {
    if (isMissingTableError(boardResult.error)) return legacyCount;
    throw boardResult.error;
  }
  const boardCount = parseQueryCount(boardResult.count);
  if (boardCount === null) {
    throw new Error('board_notice_count_query_contract_invalid');
  }
  return legacyCount + boardCount;
}

function getTargetUrl(
  role: 'admin' | 'fc',
  payload: Payload,
  message: string,
  fcId: string,
): string {
  const msg = message.toLowerCase();
  const explicitUrl =
    'url' in (payload as Record<string, unknown>) &&
    typeof (payload as { url?: unknown }).url === 'string'
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
    if (msg.includes('위촉 url') || msg.includes('위촉url') || msg.includes('위촉'))
      return '/appointment';
    return '/notifications';
  }

  if (msg.includes('보증 보험 동의')) return '/dashboard';
  if (msg.includes('한화')) return '/dashboard';
  if (msg.includes('업로드') || msg.includes('제출') || msg.includes('서류')) {
    return `/docs-upload?userId=${fcId}`;
  }
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
    if (msg.includes('docs') || msg.includes('서류')) {
      return `${name} 서류 요청`;
    }
    return `${name} 정보 업데이트`;
  }
  if (payload.type === 'fc_delete') {
    const parts = message?.split(' ') ?? [];
    const docName = parts.length > 1 ? parts[1].replace(/[:,]/g, '') : '파일';
    return `${name} ${docName} 삭제`;
  }
  if (payload.type === 'fc_update') {
    if (msg.includes('한화')) return `${name} 다위촉 제출`;
    if (msg.includes('기본') || msg.includes('정보')) {
      return `${name} 기본 정보 업데이트`;
    }
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
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw || raw === ADMIN_CHAT_ID) return '';
  return sanitize(value);
}

async function fetchSharedAdminPhones(): Promise<string[]> {
  const { data, error } = await supabase
    .from('admin_accounts')
    .select('phone,staff_type')
    .eq('active', true);
  if (error) throw error;

  const rows = parseQueryRows(data, isAdminPhoneStaffQueryRow);
  if (!rows) throw new Error('admin_phone_query_contract_invalid');

  return Array.from(
    new Set(
      rows
        .filter((account) => account.staff_type !== 'developer')
        .map((account) => sanitize(account.phone))
        .filter((phone) => phone.length > 0),
    ),
  );
}

function getLifecycleNotificationTarget(fcId: string, targetUrl: string): NotificationTargetV1 {
  const sectionByPath: Record<
    string,
    'home' | 'consent' | 'docs_upload' | 'hanwha_commission' | 'appointment'
  > = {
    '/consent': 'consent',
    '/docs-upload': 'docs_upload',
    '/hanwha-commission': 'hanwha_commission',
    '/appointment': 'appointment',
  };
  const section =
    sectionByPath[targetUrl] ??
    (targetUrl === `/docs-upload?userId=${fcId}` ? 'docs_upload' : null);
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
    if (data === null) return 'denied';
    if (!isPhoneQueryRow(data)) return 'failed';
    return sanitize(data.phone) === targetId ? 'allowed' : 'denied';
  }

  const [adminsResult, managersResult] = await Promise.all([
    supabase.from('admin_accounts').select('phone').eq('active', true),
    supabase.from('manager_accounts').select('phone').eq('active', true),
  ]);

  if (adminsResult.error || managersResult.error) return 'failed';

  const adminRows = parseQueryRows(adminsResult.data, isPhoneQueryRow);
  const managerRows = parseQueryRows(managersResult.data, isPhoneQueryRow);
  if (!adminRows || !managerRows) return 'failed';
  const isAllowed = [...adminRows, ...managerRows].some(
    (account) => sanitize(account.phone) === targetId,
  );

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
    if (data === null) return null;
    if (!isUuidQueryRow(data)) {
      throw new Error('recipient_actor_query_contract_invalid');
    }
    return data.id;
  }

  const [adminResult, managerResult] = await Promise.all([
    supabase.from('admin_accounts').select('id').eq('phone', targetId).eq('active', true),
    supabase.from('manager_accounts').select('id').eq('phone', targetId).eq('active', true),
  ]);
  if (adminResult.error) throw adminResult.error;
  if (managerResult.error) throw managerResult.error;
  const adminRows = parseQueryRows(adminResult.data, isUuidQueryRow);
  const managerRows = parseQueryRows(managerResult.data, isUuidQueryRow);
  if (!adminRows || !managerRows) {
    throw new Error('recipient_actor_query_contract_invalid');
  }
  const candidates = [...adminRows, ...managerRows].map((row) => row.id);
  return candidates.length === 1 ? candidates[0] : null;
}

async function resolveFcUpdateAdminRecipientIds(fcAffiliation?: string | null): Promise<string[]> {
  const normalizedAffiliation = normalizeAffiliationLabel(fcAffiliation);
  const [adminsRes, mappingRes] = await Promise.all([
    supabase.from('admin_accounts').select('phone').eq('active', true),
    supabase
      .from('affiliation_manager_mappings')
      .select('manager_phone')
      .eq('active', true)
      .eq('affiliation', normalizedAffiliation),
  ]);

  if (adminsRes.error) throw adminsRes.error;
  if (mappingRes.error && mappingRes.error.code !== '42P01') {
    throw mappingRes.error;
  }

  const adminRows = parseQueryRows(adminsRes.data, isPhoneQueryRow);
  const mappingRows =
    mappingRes.error?.code === '42P01'
      ? []
      : parseQueryRows(mappingRes.data, isManagerPhoneMappingQueryRow);
  if (!adminRows || !mappingRows) {
    throw new Error('admin_recipient_query_contract_invalid');
  }

  const adminPhones = adminRows
    .map((admin) => sanitize(admin.phone))
    .filter((phone) => phone.length > 0);

  const mappedManagerPhones = mappingRows
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
    const activeManagerRows = parseQueryRows(activeManagers, isPhoneQueryRow);
    if (!activeManagerRows) {
      throw new Error('active_manager_query_contract_invalid');
    }
    managerPhones = activeManagerRows
      .map((manager) => sanitize(manager.phone))
      .filter((phone) => phone.length > 0);
  }

  return Array.from(new Set([...adminPhones, ...managerPhones]));
}

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : '*',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
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
  const mapped =
    error instanceof MessengerAttachmentServiceError
    ? error
    : mapMessengerAttachmentRpcError(error);
  return ok(
    {
    ok: false,
    code: mapped.code,
    message: 'Attachment processing failed',
    },
    mapped.status,
  );
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

function fetchInternalFcProfiles() {
  return collectSupabaseRows<InternalFcProfileQueryRow>({
    queryName: 'internal_fc_profiles',
    isRow: isInternalFcProfileQueryRow,
    rowKey: (row) => row.id,
    fetchPage: (from, to) =>
      supabase
    .from('fc_profiles')
    .select('id,name,phone,affiliation')
        .eq('signup_completed', true)
        .order('id', { ascending: true })
        .range(from, to),
  });
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
      return {
        ok: false,
        status: 403,
        message: 'Active admin account not found',
      };
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
      return {
        ok: false,
        status: 403,
        message: 'Active manager account not found',
      };
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

  const query = supabase.from('fc_profiles').select('id,name,phone,affiliation,signup_completed');
  const { data, error } = session.fcId
    ? await query.eq('id', session.fcId).maybeSingle()
    : await query.eq('phone', phone).maybeSingle();
  if (error) return { ok: false, status: 500, message: error.message };
  if (!data?.id || sanitize(data.phone) !== phone || data.signup_completed !== true) {
    return {
      ok: false,
      status: 403,
      message: 'Completed FC profile not found',
    };
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
  'inbox_mark_all_read',
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
  'direct_message_search',
  'direct_message_context',
  'message',
]);

async function resolveTrustedServiceViewer(
  body: Record<string, unknown>,
): Promise<FcNotifyActorResolution> {
  const phone = sanitize(String(body.viewer_actor_phone ?? ''));
  const requestedRole = String(body.viewer_actor_role ?? '');
  if (phone.length !== 11 || !['admin', 'manager', 'fc'].includes(requestedRole)) {
    return {
      ok: false,
      status: 401,
      message: 'Verified notification viewer is required',
    };
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
      return {
        ok: false,
        status: 403,
        message: 'Active admin viewer not found',
      };
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
      return {
        ok: false,
        status: 403,
        message: 'Active manager viewer not found',
      };
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
    let query = supabase
      .from('admin_accounts')
      .select('id,name,phone,staff_type,active')
      .eq('active', true)
      .or('staff_type.neq.developer,staff_type.is.null');
    query = input.actorId === null ? query.limit(1) : query.eq('id', input.actorId).limit(1);
    const { data, error } = await query;
    if (error) {
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation target lookup failed',
      };
    }
    const accounts = parseQueryRows(data, isActiveStaffIdentityQueryRow);
    if (!accounts || accounts.length > 1) {
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation target lookup failed',
      };
    }
    if (accounts.length === 0) {
      return {
        ok: false,
        status: 404,
        message: 'Direct conversation target not found',
      };
    }
    const account = accounts[0];
    if (
      account.staff_type === 'developer' ||
      (input.actorId !== null && account.id !== input.actorId)
    ) {
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation target lookup failed',
      };
    }
    const phone = input.actorId === null ? null : sanitize(account.phone);
    if (input.actorId !== null && phone?.length !== 11) {
      return {
        ok: false,
        status: 404,
        message: 'Direct conversation target not found',
      };
    }
    return {
      ok: true,
      counterparty: { role: 'admin', actorId: input.actorId, phone },
      name: input.actorId === null ? null : formatOperationsMessengerName(account.name),
    };
  }

  if (!input.actorId) {
    return {
      ok: false,
      status: 400,
      message: 'Direct conversation target is invalid',
    };
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
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation target lookup failed',
      };
    }
    if (data === null) {
      return {
        ok: false,
        status: 404,
        message: 'Direct conversation target not found',
      };
    }
    if (
      !isActiveStaffIdentityQueryRow(data) ||
      data.id !== input.actorId ||
      data.staff_type !== 'developer'
    ) {
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation target lookup failed',
      };
    }
    const phone = sanitize(data.phone);
    return {
      ok: true,
      counterparty: { role: 'developer', actorId: data.id, phone },
      name: '개발자',
    };
  }

  const { data, error } = await supabase
    .from('manager_accounts')
    .select('id,name,phone,active')
    .eq('id', input.actorId)
    .eq('active', true)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      status: 500,
      message: 'Direct conversation target lookup failed',
    };
  }
  if (data === null) {
    return {
      ok: false,
      status: 404,
      message: 'Direct conversation target not found',
    };
  }
  if (!isActiveManagerIdentityQueryRow(data) || data.id !== input.actorId) {
    return {
      ok: false,
      status: 500,
      message: 'Direct conversation target lookup failed',
    };
  }
  const phone = sanitize(data.phone);
  return {
    ok: true,
    counterparty: { role: 'manager', actorId: data.id, phone },
    name: typeof data.name === 'string' ? data.name.trim() || null : null,
  };
}

async function resolveDirectCounterpartyFromTarget(targetId?: string | null): Promise<
  | {
      ok: true;
      counterparty: DirectConversationCounterparty;
      name: string | null;
    }
  | { ok: false; status: 400 | 403 | 404 | 500; message: string }
> {
  const rawTarget = String(targetId ?? '')
    .trim()
    .toLowerCase();
  if (!rawTarget || rawTarget === ADMIN_CHAT_ID) {
    return resolveActiveDirectCounterparty({ role: 'admin', actorId: null });
  }
  const targetPhone = sanitize(rawTarget);
  if (targetPhone.length !== 11) {
    return {
      ok: false,
      status: 400,
      message: 'Direct conversation target is invalid',
    };
  }
  const [developerResult, adminResult, managerResult] = await Promise.all([
    supabase
      .from('admin_accounts')
      .select('id,name,phone')
      .eq('phone', targetPhone)
      .eq('active', true)
      .eq('staff_type', 'developer'),
    supabase
      .from('admin_accounts')
      .select('id,name,phone')
      .eq('phone', targetPhone)
      .eq('active', true)
      .or('staff_type.neq.developer,staff_type.is.null'),
    supabase
      .from('manager_accounts')
      .select('id,name,phone')
      .eq('phone', targetPhone)
      .eq('active', true),
  ]);
  if (developerResult.error || adminResult.error || managerResult.error) {
    return {
      ok: false,
      status: 500,
      message: 'Direct conversation target lookup failed',
    };
  }
  const developerRows = parseQueryRows(developerResult.data, isAccountIdentityQueryRow);
  const adminRows = parseQueryRows(adminResult.data, isAccountIdentityQueryRow);
  const managerRows = parseQueryRows(managerResult.data, isAccountIdentityQueryRow);
  if (
    !developerRows ||
    !adminRows ||
    !managerRows ||
    [...developerRows, ...adminRows, ...managerRows].some(
      (row) => sanitize(row.phone) !== targetPhone,
    )
  ) {
    return {
      ok: false,
      status: 500,
      message: 'Direct conversation target lookup failed',
    };
  }
  const matches = [
    ...developerRows.map((row) => ({
      role: 'developer' as const,
      actorId: row.id,
    })),
    ...adminRows.map((row) => ({
      role: 'admin' as const,
      actorId: row.id,
    })),
    ...managerRows.map((row) => ({
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

type DirectCounterpartyResolution = Awaited<ReturnType<typeof resolveActiveDirectCounterparty>>;

async function resolveGaraminDirectConversation(input: {
  actor: FcNotifyAppActor;
  conversationId?: string | null;
  targetId?: string | null;
  existingCanonicalOnly?: boolean;
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
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation lookup failed',
      };
    }
    if (directThread?.id) {
      thread = directThread as DirectConversationThreadRow;
    } else {
      if (input.existingCanonicalOnly) {
        return {
          ok: false,
          status: 404,
          message: 'Direct conversation not found',
        };
      }
      const { data: legacyConversation, error: legacyError } = await supabase
        .from('garamin_direct_conversations')
        .select('id,fc_id')
        .eq('id', input.conversationId)
        .maybeSingle();
      if (legacyError) {
        return {
          ok: false,
          status: 500,
          message: 'Direct conversation lookup failed',
        };
      }
      if (!legacyConversation?.id) {
        return {
          ok: false,
          status: 404,
          message: 'Direct conversation not found',
        };
      }
      const legacyCounterparty =
        input.actor.sessionRole === 'manager'
          ? { role: 'manager' as const, actorId: input.actor.actorId }
          : input.actor.sessionRole === 'admin' && input.actor.staffType === 'developer'
            ? { role: 'developer' as const, actorId: input.actor.actorId }
            : { role: 'admin' as const, actorId: null };
      const { data: matchingThread, error: matchingThreadError } = await supabase
        .from('garamin_direct_threads')
        .upsert(
          {
          legacy_conversation_id: legacyConversation.id,
          counterparty_role: legacyCounterparty.role,
          counterparty_actor_id: legacyCounterparty.actorId,
          },
          {
            onConflict: 'legacy_conversation_id,counterparty_role,counterparty_actor_id',
          },
        )
        .select('id,legacy_conversation_id,counterparty_role,counterparty_actor_id')
        .single();
      if (matchingThreadError) {
        return {
          ok: false,
          status: 500,
          message: 'Direct conversation lookup failed',
        };
      }
      if (!matchingThread?.id) {
        return {
          ok: false,
          status: 404,
          message: 'Direct conversation not found',
        };
      }
      thread = matchingThread as DirectConversationThreadRow;
    }
    const { data: legacyConversation, error: legacyError } = await supabase
      .from('garamin_direct_conversations')
      .select('id,fc_id')
      .eq('id', thread.legacy_conversation_id)
      .maybeSingle();
    if (legacyError) {
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation lookup failed',
      };
    }
    if (!legacyConversation?.fc_id) {
      return {
        ok: false,
        status: 404,
        message: 'Direct conversation not found',
      };
    }
    fcId = legacyConversation.fc_id;
    counterpartyResult = await resolveActiveDirectCounterparty({
      role: thread.counterparty_role,
      actorId: thread.counterparty_actor_id,
    });
    if (counterpartyResult.ok === false) return counterpartyResult;
    if (
      !canAccessDirectConversation(input.actor, {
      fcActorId: legacyConversation.fc_id,
      counterparty: counterpartyResult.counterparty,
      })
    ) {
      return {
        ok: false,
        status: 404,
        message: 'Direct conversation not found',
      };
    }
  } else {
    if (input.actor.sessionRole === 'fc') {
      fcId = input.actor.fcId;
      counterpartyResult = await resolveDirectCounterpartyFromTarget(input.targetId);
    } else {
      const targetPhone = sanitize(input.targetId);
      if (targetPhone.length !== 11) {
        return {
          ok: false,
          status: 400,
          message: 'Direct conversation target is invalid',
        };
      }
      const { data: target, error } = await supabase
        .from('fc_profiles')
        .select('id')
        .eq('phone', targetPhone)
        .eq('signup_completed', true)
        .maybeSingle();
      if (error) {
        return {
          ok: false,
          status: 500,
          message: 'Direct conversation target lookup failed',
        };
      }
      if (!target?.id) {
        return {
          ok: false,
          status: 404,
          message: 'Direct conversation target not found',
        };
      }
      fcId = target.id;
      counterpartyResult = await resolveActiveDirectCounterparty(
        input.actor.sessionRole === 'manager'
          ? { role: 'manager', actorId: input.actor.actorId }
          : input.actor.staffType === 'developer'
            ? { role: 'developer', actorId: input.actor.actorId }
            : { role: 'admin', actorId: input.actor.actorId },
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
    return {
      ok: false,
      status: 403,
      message: 'Direct conversation is not allowed',
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id,phone,name,affiliation,signup_completed,is_manager_referral_shadow')
    .eq('id', fcId)
    .eq('signup_completed', true)
    .eq('is_manager_referral_shadow', false)
    .maybeSingle();
  if (profileError) {
    return {
      ok: false,
      status: 500,
      message: 'Direct conversation target lookup failed',
    };
  }
  const fcPhone = sanitize(profile?.phone);
  if (
    !profile?.id ||
    fcPhone.length !== 11 ||
    Boolean(parseDesignerCompanyNameFromAffiliation(profile.affiliation))
  ) {
    return {
      ok: false,
      status: 404,
      message: 'Direct conversation target not found',
    };
  }

  if (!thread) {
    const { data: legacyConversation, error: conversationError } = await supabase
      .from('garamin_direct_conversations')
      .upsert({ fc_id: fcId }, { onConflict: 'fc_id' })
      .select('id,fc_id')
      .single();
    if (conversationError || !legacyConversation?.id) {
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation resolution failed',
      };
    }
    const { data: resolvedThread, error: resolvedThreadError } = await supabase
      .from('garamin_direct_threads')
      .upsert(
        {
        legacy_conversation_id: legacyConversation.id,
        counterparty_role: counterpartyResult.counterparty.role,
        counterparty_actor_id: counterpartyResult.counterparty.actorId,
        },
        {
          onConflict: 'legacy_conversation_id,counterparty_role,counterparty_actor_id',
        },
      )
      .select('id,legacy_conversation_id,counterparty_role,counterparty_actor_id')
      .single();
    if (resolvedThreadError || !resolvedThread?.id) {
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation resolution failed',
      };
    }
    thread = resolvedThread as DirectConversationThreadRow;
  }

  return {
    ok: true,
    id: thread.id,
    threadId: thread.id,
    legacyConversationId: thread.legacy_conversation_id,
    fcId,
    fcPhone,
    fcName: typeof profile.name === 'string' ? profile.name.trim() || null : null,
    counterparty: counterpartyResult.counterparty,
    counterpartyId:
      counterpartyResult.counterparty.role === 'admin'
        ? counterpartyResult.counterparty.actorId === null
          ? ADMIN_CHAT_ID
          : sanitize(counterpartyResult.counterparty.phone)
        : sanitize(counterpartyResult.counterparty.phone),
    counterpartyName: counterpartyResult.name,
  };
}

type AccessibleDirectThread = {
  id: string;
  legacyConversationId: string;
  fcId: string;
  fcPhone: string;
  fcName: string | null;
  counterparty: DirectConversationCounterparty;
  counterpartyId: string;
  counterpartyName: string | null;
};

type AccessibleDirectThreadResult =
  | { ok: true; threads: AccessibleDirectThread[] }
  | { ok: false; status: 403 | 500; message: string };

async function listAccessibleExistingDirectThreads(
  actor: FcNotifyAppActor,
  scopedFcIds?: string[],
): Promise<AccessibleDirectThreadResult> {
  if (!actor.fcId && actor.sessionRole === 'fc') {
    return {
      ok: false,
      status: 403,
      message: 'Direct messaging is not allowed',
    };
  }

  let legacyIds: string[] | null = null;
  if (actor.sessionRole === 'fc') {
    const { data, error } = await supabase
      .from('garamin_direct_conversations')
      .select('id')
      .eq('fc_id', actor.fcId)
      .maybeSingle();
    if (error) {
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation lookup failed',
      };
    }
    if (
      data !== null &&
      (!isRecord(data) || typeof data.id !== 'string' || !UUID_PATTERN.test(data.id))
    ) {
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation lookup failed',
      };
    }
    legacyIds = data ? [data.id as string] : [];
    if (legacyIds.length === 0) return { ok: true, threads: [] };
  } else if (scopedFcIds) {
    const safeFcIds = Array.from(new Set(scopedFcIds.filter((id) => UUID_PATTERN.test(id))));
    if (safeFcIds.length === 0) return { ok: true, threads: [] };
    const conversationRows: Array<{ id: string }> = [];
    const seenConversationIds = new Set<string>();
    try {
      for (const fcIdChunk of chunkSupabaseFilterValues(safeFcIds)) {
        const chunkRows = await collectSupabaseRows<{ id: string }>({
          queryName: 'scoped_direct_conversations',
          isRow: (value): value is { id: string } =>
            isRecord(value) && typeof value.id === 'string' && UUID_PATTERN.test(value.id),
          rowKey: (row) => row.id,
          fetchPage: (from, to) =>
            supabase
      .from('garamin_direct_conversations')
      .select('id')
              .in('fc_id', fcIdChunk)
              .order('id', { ascending: true })
              .range(from, to),
        });
        if (chunkRows.some((row) => seenConversationIds.has(row.id))) {
          throw new Error('direct_conversation_identity_contract_invalid');
    }
        chunkRows.forEach((row) => seenConversationIds.add(row.id));
        conversationRows.push(...chunkRows);
      }
    } catch {
      return {
        ok: false,
        status: 500,
        message: 'Direct conversation lookup failed',
      };
    }
    legacyIds = conversationRows.map((row) => row.id);
    if (legacyIds.length === 0) return { ok: true, threads: [] };
  }

  const rawThreadRows: DirectConversationThreadRow[] = [];
  const seenThreadIds = new Set<string>();
  try {
    const legacyIdChunks: Array<string[] | null> = legacyIds
      ? chunkSupabaseFilterValues(legacyIds)
      : [null];
    for (const legacyIdChunk of legacyIdChunks) {
      const chunkRows = await collectSupabaseRows<DirectConversationThreadRow>({
        queryName: 'accessible_direct_threads',
        isRow: isDirectConversationThreadRow,
        rowKey: (row) => row.id,
        fetchPage: (from, to) => {
          let query = supabase
    .from('garamin_direct_threads')
    .select('id,legacy_conversation_id,counterparty_role,counterparty_actor_id');
          if (legacyIdChunk) {
            query = query.in('legacy_conversation_id', legacyIdChunk);
  }
  if (actor.sessionRole !== 'fc') {
    if (actor.sessionRole === 'manager') {
              query = query
        .eq('counterparty_role', 'manager')
        .eq('counterparty_actor_id', actor.actorId);
    } else if (actor.staffType === 'developer') {
              query = query
        .eq('counterparty_role', 'developer')
        .eq('counterparty_actor_id', actor.actorId);
    } else {
              query = query
        .eq('counterparty_role', 'admin')
        .eq('counterparty_actor_id', actor.actorId);
    }
  }
          return query.order('id', { ascending: true }).range(from, to);
        },
      });
      if (chunkRows.some((row) => seenThreadIds.has(row.id))) {
        throw new Error('direct_thread_identity_contract_invalid');
      }
      chunkRows.forEach((row) => seenThreadIds.add(row.id));
      rawThreadRows.push(...chunkRows);
    }
  } catch {
    return {
      ok: false,
      status: 500,
      message: 'Direct conversation lookup failed',
    };
  }
  const threadRows = rawThreadRows.filter(
    (row) =>
      !(
        actor.sessionRole === 'fc' &&
        row.counterparty_role === 'admin' &&
        row.counterparty_actor_id === null
      ),
    );
  if (threadRows.length === 0) return { ok: true, threads: [] };

  const uniqueLegacyIds = Array.from(new Set(threadRows.map((row) => row.legacy_conversation_id)));
  const conversations: DirectConversationQueryRow[] = [];
  const seenLegacyIds = new Set<string>();
  try {
    for (const legacyIdChunk of chunkSupabaseFilterValues(uniqueLegacyIds)) {
      const legacyIdSet = new Set(legacyIdChunk);
      const chunkRows = await collectSupabaseRows<DirectConversationQueryRow>({
        queryName: 'direct_conversation_profiles',
        isRow: isDirectConversationQueryRow,
        rowKey: (row) => row.id,
        fetchPage: (from, to) =>
          supabase
    .from('garamin_direct_conversations')
    .select('id,fc_id')
            .in('id', legacyIdChunk)
            .order('id', { ascending: true })
            .range(from, to),
      });
      if (chunkRows.some((row) => !legacyIdSet.has(row.id) || seenLegacyIds.has(row.id))) {
        throw new Error('direct_conversation_identity_contract_invalid');
      }
      chunkRows.forEach((row) => seenLegacyIds.add(row.id));
      conversations.push(...chunkRows);
    }
  } catch {
    return {
      ok: false,
      status: 500,
      message: 'Direct conversation lookup failed',
    };
  }
  const conversationById = new Map(conversations.map((row) => [row.id, row]));
  const fcIds = Array.from(new Set(conversations.map((row) => row.fc_id)));
  if (fcIds.length === 0) return { ok: true, threads: [] };
  const profiles: AccessibleFcProfileQueryRow[] = [];
  const seenProfileIds = new Set<string>();
  try {
    for (const fcIdChunk of chunkSupabaseFilterValues(fcIds)) {
      const fcIdSet = new Set(fcIdChunk);
      const chunkRows = await collectSupabaseRows<AccessibleFcProfileQueryRow>({
        queryName: 'accessible_direct_fc_profiles',
        isRow: isAccessibleFcProfileQueryRow,
        rowKey: (row) => row.id,
        fetchPage: (from, to) =>
          supabase
    .from('fc_profiles')
    .select('id,phone,name,affiliation,signup_completed,is_manager_referral_shadow')
            .in('id', fcIdChunk)
    .eq('signup_completed', true)
            .eq('is_manager_referral_shadow', false)
            .order('id', { ascending: true })
            .range(from, to),
      });
      if (chunkRows.some((row) => !fcIdSet.has(row.id) || seenProfileIds.has(row.id))) {
        throw new Error('direct_profile_identity_contract_invalid');
      }
      chunkRows.forEach((row) => seenProfileIds.add(row.id));
      profiles.push(...chunkRows);
    }
  } catch {
    return {
      ok: false,
      status: 500,
      message: 'Direct conversation lookup failed',
    };
  }
  const profileById = new Map(
    profiles
      .filter((row) => !parseDesignerCompanyNameFromAffiliation(row.affiliation))
      .map((row) => [row.id, row]),
  );

  const counterpartyCache = new Map<string, DirectCounterpartyResolution>();
  const threads: AccessibleDirectThread[] = [];
  for (const row of threadRows) {
    const conversation = conversationById.get(row.legacy_conversation_id);
    const profile = conversation ? profileById.get(conversation.fc_id) : null;
    if (!conversation || !profile) continue;
    const counterpartyKey = `${row.counterparty_role}:${row.counterparty_actor_id ?? ''}`;
    let counterpartyResult = counterpartyCache.get(counterpartyKey);
    if (!counterpartyResult) {
      counterpartyResult = await resolveActiveDirectCounterparty({
        role: row.counterparty_role,
        actorId: row.counterparty_actor_id,
      });
      counterpartyCache.set(counterpartyKey, counterpartyResult);
    }
    if (counterpartyResult.ok === false) continue;
    if (
      !canAccessDirectConversation(actor, {
      fcActorId: conversation.fc_id,
      counterparty: counterpartyResult.counterparty,
      })
    )
      continue;
    threads.push({
      id: row.id,
      legacyConversationId: row.legacy_conversation_id,
      fcId: conversation.fc_id,
      fcPhone: sanitize(profile.phone),
      fcName: typeof profile.name === 'string' ? profile.name.trim() || null : null,
      counterparty: counterpartyResult.counterparty,
      counterpartyId:
        counterpartyResult.counterparty.role === 'admin'
        ? counterpartyResult.counterparty.actorId === null
          ? ADMIN_CHAT_ID
          : sanitize(counterpartyResult.counterparty.phone)
        : sanitize(counterpartyResult.counterparty.phone),
      counterpartyName: counterpartyResult.name,
    });
  }
  return { ok: true, threads };
}

function isDirectSearchRowVisible(input: {
  actor: FcNotifyAppActor;
  thread: AccessibleDirectThread;
  row: DirectMessageRow;
}): boolean {
  if (input.row.deleted_at !== null) return false;
  const isCurrentScope =
    input.row.thread_id === input.thread.id ||
    (input.thread.counterparty.role === 'admin' &&
      input.thread.counterparty.actorId === null &&
      input.row.thread_id === null &&
      input.row.conversation_id === input.thread.legacyConversationId);
  if (isCurrentScope) {
    return (
      isCurrentDirectMessageVisible({
      fcActorId: input.thread.fcId,
      fcPhone: input.thread.fcPhone,
      counterparty: input.thread.counterparty,
      row: input.row,
      }) ||
      (!input.row.sender_actor_id &&
        !input.row.receiver_actor_id &&
        isLegacyDirectMessageVisible({
        actor: input.actor,
        fcPhone: input.thread.fcPhone,
        counterpartyId: input.thread.counterpartyId,
        row: input.row,
        }))
    );
  }
  return (
    input.row.conversation_id === null &&
    isLegacyDirectMessageVisible({
      actor: input.actor,
      fcPhone: input.thread.fcPhone,
      counterpartyId: input.thread.counterpartyId,
      row: input.row,
    })
  );
}

function directThreadRoomLabel(actor: FcNotifyAppActor, thread: AccessibleDirectThread): string {
  if (actor.sessionRole !== 'fc') return thread.fcName ?? 'FC';
  if (thread.counterpartyName) return thread.counterpartyName;
  if (thread.counterparty.role === 'manager') return '본부장';
  if (thread.counterparty.role === 'developer') return '개발자';
  return '총무';
}

function directMessageSenderLabel(thread: AccessibleDirectThread, row: DirectMessageRow): string {
  if (row.sender_actor_id === thread.fcId || sanitize(row.sender_id) === thread.fcPhone)
    return thread.fcName ?? 'FC';
  if (thread.counterpartyName) return thread.counterpartyName;
  if (thread.counterparty.role === 'manager') return '본부장';
  if (thread.counterparty.role === 'developer') return '개발자';
  return '총무';
}

function legacySearchActorId(actor: FcNotifyAppActor, thread?: AccessibleDirectThread): string {
  if (
    thread?.counterparty.role === 'admin' &&
    thread.counterparty.actorId === null &&
    actor.sessionRole === 'admin' &&
    actor.staffType === 'admin'
  )
    return ADMIN_CHAT_ID;
  return sanitize(actor.phone);
}

type DirectMessageSenderSide = 'viewer' | 'counterparty';

function directMessageSenderSide(input: {
  actor: FcNotifyAppActor;
  thread: AccessibleDirectThread;
  row: DirectMessageRow;
}): DirectMessageSenderSide | null {
  const senderActorId = String(input.row.sender_actor_id ?? '').trim();
  const receiverActorId = String(input.row.receiver_actor_id ?? '').trim();
  if (senderActorId || receiverActorId) {
    if (senderActorId === input.actor.actorId) return 'viewer';
    if (receiverActorId === input.actor.actorId) return 'counterparty';

    // The generic admin conversation is a shared staff endpoint. Preserve that
    // endpoint meaning while still preferring the signed actor's exact tuple.
    if (senderActorId === input.thread.fcId) {
      return input.actor.sessionRole === 'fc' ? 'viewer' : 'counterparty';
    }
    if (receiverActorId === input.thread.fcId) {
      return input.actor.sessionRole === 'fc' ? 'counterparty' : 'viewer';
    }
    return null;
  }

  const viewerEndpointId = legacySearchActorId(input.actor, input.thread);
  const counterpartyEndpointId =
    input.actor.sessionRole === 'fc' ? input.thread.counterpartyId : input.thread.fcPhone;
  if (input.row.sender_id === viewerEndpointId && input.row.receiver_id === counterpartyEndpointId)
    return 'viewer';
  if (input.row.sender_id === counterpartyEndpointId && input.row.receiver_id === viewerEndpointId)
    return 'counterparty';
  return null;
}

const DIRECT_SEARCH_MESSAGE_COLUMNS =
  'id,conversation_id,thread_id,sender_id,receiver_id,sender_actor_id,receiver_actor_id,content,created_at,' +
  'is_read,message_type,file_url,file_name,file_size,attachment_batch_id,deleted_at,deleted_by_actor_id';

function findVisibleThreadForMessage(input: {
  actor: FcNotifyAppActor;
  threads: AccessibleDirectThread[];
  row: DirectMessageRow;
}): AccessibleDirectThread | null {
  const directThread = input.row.thread_id
    ? input.threads.find((thread) => thread.id === input.row.thread_id)
    : null;
  if (directThread) {
    return isDirectSearchRowVisible({ ...input, thread: directThread }) ? directThread : null;
  }
  for (const thread of input.threads) {
    if (isDirectSearchRowVisible({ ...input, thread })) return thread;
  }
  return null;
}

async function searchDirectMessages(input: {
  actor: FcNotifyAppActor;
  threads: AccessibleDirectThread[];
  query: string;
  limit: number;
}) {
  if (input.threads.length === 0) return [];
  const pattern = `%${escapePostgrestLikeLiteral(input.query)}%`;
  const queries = [];
  const threadIds = input.threads.map((thread) => thread.id);
  queries.push(
    supabase
      .from('messages')
      .select(DIRECT_SEARCH_MESSAGE_COLUMNS)
      .in('thread_id', threadIds)
      .is('deleted_at', null)
      .ilike('content', pattern)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(input.limit),
  );
  const adminLegacyIds = input.threads
    .filter(
      (thread) => thread.counterparty.role === 'admin' && thread.counterparty.actorId === null,
    )
    .map((thread) => thread.legacyConversationId);
  if (adminLegacyIds.length > 0) {
    queries.push(
      supabase
        .from('messages')
        .select(DIRECT_SEARCH_MESSAGE_COLUMNS)
        .is('thread_id', null)
        .in('conversation_id', adminLegacyIds)
        .is('deleted_at', null)
        .ilike('content', pattern)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(input.limit),
    );
  }
  const legacyActorId = legacySearchActorId(input.actor);
  if (legacyActorId) {
    queries.push(
      supabase
        .from('messages')
        .select(DIRECT_SEARCH_MESSAGE_COLUMNS)
        .is('conversation_id', null)
        .is('deleted_at', null)
        .or(`sender_id.eq.${legacyActorId},receiver_id.eq.${legacyActorId}`)
        .ilike('content', pattern)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(input.limit),
    );
  }
  const results = await Promise.all(queries);
  if (results.some((result) => result.error)) {
    throw new Error('Direct message search failed');
  }
  const rowBatches = results.map((result) => parseQueryRows(result.data, isDirectMessageRow));
  if (rowBatches.some((rows) => rows === null)) {
    throw new Error('Direct message search failed');
  }
  const rows = Array.from(
    new Map(
      rowBatches.flatMap((result) => result as DirectMessageRow[]).map((row) => [row.id, row]),
    ).values(),
  );
  return rows
    .map((row) => ({
      row,
      thread: findVisibleThreadForMessage({
      actor: input.actor,
      threads: input.threads,
      row,
      }),
    }))
    .filter(
      (item): item is { row: DirectMessageRow; thread: AccessibleDirectThread } =>
        item.thread !== null &&
        UUID_PATTERN.test(item.row.id) &&
        Number.isFinite(Date.parse(item.row.created_at)),
    )
    .sort(
      (left, right) =>
        right.row.created_at.localeCompare(left.row.created_at) ||
        right.row.id.localeCompare(left.row.id),
    )
    .slice(0, input.limit)
    .map(({ row, thread }) => ({
      source: 'garamin_direct' as const,
      room: {
        version: 1 as const,
        kind: 'garamin_direct_chat' as const,
        conversationId: thread.id,
      },
      messageId: row.id,
      sentAt: row.created_at,
      excerpt: buildDirectMessageExcerpt(row.content),
      roomLabel: directThreadRoomLabel(input.actor, thread),
      senderLabel: directMessageSenderLabel(thread, row),
    }));
}

function buildContextScopeQuery(
  actor: FcNotifyAppActor,
  thread: AccessibleDirectThread,
  source: 'current' | 'envelope' | 'legacy',
) {
  const query = supabase.from('messages').select(DIRECT_SEARCH_MESSAGE_COLUMNS);
  if (source === 'current') return query.eq('thread_id', thread.id);
  if (source === 'envelope') {
    return query.is('thread_id', null).eq('conversation_id', thread.legacyConversationId);
  }
  const viewerEndpointId = legacySearchActorId(actor, thread);
  const counterpartyEndpointId =
    actor.sessionRole === 'fc' ? thread.counterpartyId : thread.fcPhone;
  return query
    .is('conversation_id', null)
    .or(
      `and(sender_id.eq.${viewerEndpointId},receiver_id.eq.${counterpartyEndpointId}),` +
        `and(sender_id.eq.${counterpartyEndpointId},receiver_id.eq.${viewerEndpointId})`,
    );
}

async function fetchDirectMessageContextSide(input: {
  actor: FcNotifyAppActor;
  thread: AccessibleDirectThread;
  anchor: DirectMessageRow;
  direction: 'before' | 'after';
}): Promise<DirectMessageRow[]> {
  const sources: ('current' | 'envelope' | 'legacy')[] = ['current', 'legacy'];
  if (input.thread.counterparty.role === 'admin' && input.thread.counterparty.actorId === null)
    sources.push('envelope');
  const ascending = input.direction === 'after';
  const comparison = input.direction === 'after' ? 'gt' : 'lt';
  const cursor =
    `created_at.${comparison}.${input.anchor.created_at},` +
    `and(created_at.eq.${input.anchor.created_at},id.${comparison}.${input.anchor.id})`;
  const results = await Promise.all(
    sources.map((source) =>
    buildContextScopeQuery(input.actor, input.thread, source)
      .is('deleted_at', null)
      .or(cursor)
      .order('created_at', { ascending })
      .order('id', { ascending })
        .limit(20),
    ),
  );
  if (results.some((result) => result.error)) {
    throw new Error('Direct message context lookup failed');
  }
  const rowBatches = results.map((result) => parseQueryRows(result.data, isDirectMessageRow));
  if (rowBatches.some((rows) => rows === null)) {
    throw new Error('Direct message context lookup failed');
  }
  const rows = Array.from(
    new Map(
      rowBatches.flatMap((result) => result as DirectMessageRow[]).map((row) => [row.id, row]),
    ).values(),
  ).filter((row) =>
    isDirectSearchRowVisible({
    actor: input.actor,
    thread: input.thread,
    row,
    }),
  );
  rows.sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
  );
  return input.direction === 'before' ? rows.slice(-20) : rows.slice(0, 20);
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
    if (resolution.ok === false) {
      return err(resolution.message, resolution.status);
    }
    return ok({
      ok: true,
      conversation: {
        id: resolution.id,
        requested_id: body.conversation_id ?? null,
        counterparty_id:
          appActor.sessionRole === 'fc' ? resolution.counterpartyId : resolution.fcPhone,
        counterparty_name:
          appActor.sessionRole === 'fc' ? resolution.counterpartyName : resolution.fcName,
      },
    });
  }

  if (body.type === 'direct_message_search') {
    if (!appActor) return err('Verified direct message actor is required', 401);
    const accessible = await listAccessibleExistingDirectThreads(appActor);
    if (accessible.ok === false) {
      return err(accessible.message, accessible.status);
    }
    try {
      const results = await searchDirectMessages({
        actor: appActor,
        threads: accessible.threads,
        query: body.q,
        limit: body.limit,
      });
      return ok({ ok: true, results });
    } catch {
      return err('Direct message search failed', 500);
    }
  }

  if (body.type === 'direct_message_context') {
    if (!appActor) return err('Verified direct message actor is required', 401);
    const resolution = await resolveGaraminDirectConversation({
      actor: appActor,
      conversationId: body.conversation_id,
      existingCanonicalOnly: true,
    });
    if (resolution.ok === false) {
      return err(resolution.message, resolution.status);
    }
    const thread: AccessibleDirectThread = {
      id: resolution.threadId,
      legacyConversationId: resolution.legacyConversationId,
      fcId: resolution.fcId,
      fcPhone: resolution.fcPhone,
      fcName: resolution.fcName,
      counterparty: resolution.counterparty,
      counterpartyId: resolution.counterpartyId,
      counterpartyName: resolution.counterpartyName,
    };
    const { data: rawAnchor, error: anchorError } = await supabase
      .from('messages')
      .select(DIRECT_SEARCH_MESSAGE_COLUMNS)
      .eq('id', body.message_id)
      .maybeSingle();
    if (anchorError) return err('Direct message context lookup failed', 500);
    if (rawAnchor === null) return err('Direct message not found', 404);
    if (!isDirectMessageRow(rawAnchor) || rawAnchor.id !== body.message_id) {
      return err('Direct message context lookup failed', 500);
    }
    const anchor = rawAnchor;
    if (!isDirectSearchRowVisible({ actor: appActor, thread, row: anchor })) {
      return err('Direct message not found', 404);
    }
    try {
      const [before, after] = await Promise.all([
        fetchDirectMessageContextSide({
          actor: appActor,
          thread,
          anchor,
          direction: 'before',
        }),
        fetchDirectMessageContextSide({
          actor: appActor,
          thread,
          anchor,
          direction: 'after',
        }),
      ]);
      const messages = [...before, anchor, ...after].map((row) => {
        const senderSide = directMessageSenderSide({
          actor: appActor,
          thread,
          row,
        });
        if (!senderSide) throw new Error('Direct message sender side is invalid');
        return {
          messageId: row.id,
          sentAt: row.created_at,
          content: row.content,
          senderLabel: directMessageSenderLabel(thread, row),
          senderSide,
          isAnchor: row.id === anchor.id,
        };
      });
      return ok({
        ok: true,
        room: {
          version: 1,
          kind: 'garamin_direct_chat',
          conversationId: thread.id,
        },
        anchorMessageId: anchor.id,
        messages,
      });
    } catch {
      return err('Direct message context lookup failed', 500);
    }
  }

  if (body.type === 'direct_message_broadcast_send') {
    if (
      !appActor ||
      appActor.sessionRole !== 'admin' ||
      !['admin', 'developer'].includes(String(appActor.staffType ?? 'admin'))
    ) {
      return err('Direct broadcast messaging is not allowed', 403);
    }
    const resolutions = await Promise.all(
      body.conversation_ids.map((conversationId) =>
        resolveGaraminDirectConversation({
          actor: appActor!,
          conversationId,
        }),
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
    const commit = await supabase.rpc('commit_garamin_direct_broadcast_with_attachments_v2', {
        p_message_ids: body.client_message_ids,
        p_conversation_ids: body.conversation_ids,
        p_sender_actor_id: appActor.actorId,
        p_content: body.content,
        p_delivery_key: body.delivery_key,
        p_payload_fingerprint: body.payload_fingerprint,
        p_attachment_intent_ids: body.attachment_intent_ids,
    });
    if (commit.error || !commit.data || typeof commit.data !== 'object') {
      return messengerAttachmentErrorResponse(commit.error);
    }
    const atomic = commit.data as Record<string, unknown>;
    const resolutionByPhone = new Map(
      directResolutions.map((resolution) => [resolution.fcPhone, resolution]),
    );
    const rawNotifications = Array.isArray(atomic.notifications) ? atomic.notifications : [];
    const persistedNotifications: Array<{
      notificationId: string;
      residentId: string;
      recipientActorId: string;
      recipientRole: 'fc';
      target: Extract<NotificationTargetV1, { kind: 'garamin_direct_chat' }>;
    }> = [];
    for (const rawRow of rawNotifications) {
      if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
        continue;
      }
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
        recipientRole: 'fc',
        target,
      });
    }
    if (
      persistedNotifications.length !== directResolutions.length ||
      persistedNotifications.length !== rawNotifications.length
    ) {
      return ok(
        {
        ok: false,
        message: 'Direct message notification persistence failed',
        delivery: buildDeliveryMetadata({
          notificationStored: false,
          pushStatus: 'not_attempted',
          retryable: true,
        }),
        },
        500,
      );
    }

    const preferenceBatches = await Promise.all(
      directResolutions.map((resolution) => {
        const rows = persistedNotifications.filter(
          (row) => row.target.conversationId === resolution.threadId,
        );
        return applyDirectMessageNotificationPreferences(resolution.threadId, rows);
      }),
    );
    if (preferenceBatches.some((result) => !result.ok)) {
      return ok(
        {
        ok: false,
        message: 'Direct message notification preferences failed',
        delivery: buildDeliveryMetadata({
          notificationStored: false,
          pushStatus: 'not_attempted',
          retryable: true,
        }),
        },
        500,
      );
    }
    const retainedNotifications = preferenceBatches.flatMap((result) =>
      result.ok ? result.retained : [],
    );
    const expoEligibleNotificationIds = new Set(
      preferenceBatches.flatMap((result) => (result.ok ? Array.from(result.expoEligibleIds) : [])),
    );

    const messageColumns =
      'id,conversation_id,thread_id,sender_id,receiver_id,sender_actor_id,receiver_actor_id,content,created_at,' +
      'is_read,message_type,file_url,file_name,file_size,attachment_batch_id,deleted_at,deleted_by_actor_id';
    const messageResult = await supabase
      .from('messages')
      .select(messageColumns)
      .in('id', body.client_message_ids)
      .is('deleted_at', null);
    const messageRows = parseQueryRows(messageResult.data, isDirectMessageRow);
    const expectedThreadByMessageId = new Map(
      body.client_message_ids.map((messageId, index) => [
        messageId,
        directResolutions[index]?.threadId,
      ]),
    );
    if (
      messageResult.error ||
      !messageRows ||
      messageRows.length !== body.client_message_ids.length ||
      new Set(messageRows.map((row) => row.id)).size !== messageRows.length ||
      messageRows.some((row) => expectedThreadByMessageId.get(row.id) !== row.thread_id)
    ) {
      return ok(
        {
        ok: false,
        message: 'Direct message lookup failed',
        delivery: buildDeliveryMetadata({
          notificationStored: true,
          pushStatus: 'not_attempted',
          retryable: true,
          notificationIds: retainedNotifications.map((row) => row.notificationId),
        }),
        },
        500,
      );
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
    const normalizedMessages = messageRows
      .sort(
        (left, right) =>
          body.client_message_ids.indexOf(left.id) - body.client_message_ids.indexOf(right.id),
      )
      .map((row) => ({
        id: row.id,
        conversation_id:
          (row.thread_id ? resolutionById.get(row.thread_id)?.id : null) ?? row.conversation_id,
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
          ? (resolutionById.get(row.thread_id)?.fcName ?? null)
          : null,
      }));
    const replayed = finalized.replayed || atomic.replayed === true;
    const notificationIds = retainedNotifications.map((row) => row.notificationId);
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

    const recipientPhones = retainedNotifications
      .filter((row) => expoEligibleNotificationIds.has(row.notificationId))
      .map((row) => row.residentId);
    const tokenResult = await supabase
      .from('device_tokens')
      .select('expo_push_token,resident_id,display_name,role')
      .in('resident_id', recipientPhones);
    const notificationByResident = new Map(
      retainedNotifications
        .filter((row) => expoEligibleNotificationIds.has(row.notificationId))
        .map((row) => [row.residentId, row]),
    );
    const tokenRows = parseQueryRows(tokenResult.data, isTokenQueryRow);
    const tokenLookupFailed =
      Boolean(tokenResult.error) ||
      !tokenRows ||
      tokenRows.some((token) => !recipientPhones.includes(String(token.resident_id ?? '')));
    const eligibleTokens = tokenLookupFailed
      ? []
      : dedupeTokens(
          tokenRows.filter((token) => {
        const notification = notificationByResident.get(String(token.resident_id ?? ''));
        return Boolean(
              notification &&
                getAllowedNotificationTokenRoles('fc', 'message').includes(
                  String(token.role ?? '') as 'admin' | 'manager' | 'fc',
                ),
            );
          }),
        );
    const preview = body.content || '첨부파일을 보냈습니다.';
    const expoDelivery = tokenLookupFailed
      ? { attempted: 0, accepted: 0, rejected: 0 }
      : await sendExpoPushPayloads(
          eligibleTokens.map((token) => {
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
            sentAt: new Date().toISOString(),
          },
          sound: 'default',
          priority: 'high',
          channelId: 'alerts',
        };
          }),
        );
    const providerRejected = tokenLookupFailed || expoDelivery.rejected > 0;
    const pushStatus = providerRejected
      ? ('provider_rejected' as const)
      : expoDelivery.accepted > 0
        ? ('accepted' as const)
        : ('no_registered_device' as const);
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
    body.type === 'direct_message_list' ||
    body.type === 'direct_message_send' ||
    body.type === 'direct_message_mark_read' ||
    body.type === 'direct_message_delete'
  ) {
    if (!appActor) return err('Verified direct message actor is required', 401);
    const resolution = await resolveGaraminDirectConversation({
      actor: appActor,
      conversationId: body.conversation_id,
    });
    if (resolution.ok === false) {
      return err(resolution.message, resolution.status);
    }

    const identity = buildDirectMessageIdentity({
      actor: appActor,
      fcActorId: resolution.fcId,
      fcPhone: resolution.fcPhone,
      counterparty: resolution.counterparty,
    });
    if (!identity) return err('Direct messaging is not allowed', 403);

    const messageColumns =
      'id,conversation_id,thread_id,sender_id,receiver_id,sender_actor_id,receiver_actor_id,content,created_at,' +
      'is_read,message_type,file_url,file_name,file_size,attachment_batch_id,deleted_at,deleted_by_actor_id';
    const legacyActorId =
      resolution.counterparty.role === 'admin' &&
      resolution.counterparty.actorId === null &&
      appActor.sessionRole === 'admin' &&
      appActor.staffType === 'admin'
        ? ADMIN_CHAT_ID
        : sanitize(appActor.phone);
    const legacyCounterpartId =
      appActor.sessionRole === 'fc' ? resolution.counterpartyId : resolution.fcPhone;
    type MessageRowsOptions = { withChangedAt?: boolean; changedSince?: string | null };
    const columnsFor = (options?: MessageRowsOptions) =>
      options?.withChangedAt ? `${messageColumns},changed_at` : messageColumns;
    const buildCurrentMessageQuery = (options?: MessageRowsOptions) => {
      let query = supabase.from('messages').select(columnsFor(options));
      if (options?.changedSince) query = query.gte('changed_at', options.changedSince);
      query =
        resolution.counterparty.role === 'admin' && resolution.counterparty.actorId === null
        ? query.or(
              `thread_id.eq.${resolution.threadId},` +
                `and(thread_id.is.null,conversation_id.eq.${resolution.legacyConversationId})`,
        )
        : query.eq('thread_id', resolution.threadId);
      return query;
    };
    const collectCurrentMessageRows = (options?: MessageRowsOptions) =>
      collectSupabaseRows<DirectMessageRow>({
        queryName: 'direct_messages_current',
        isRow: isDirectMessageRow,
        rowKey: (row) => row.id,
        fetchPage: (from, to) =>
          buildCurrentMessageQuery(options)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
      });
    const collectLegacyMessageRows = (options?: MessageRowsOptions) =>
      collectSupabaseRows<DirectMessageRow>({
        queryName: 'direct_messages_legacy',
        isRow: isDirectMessageRow,
        rowKey: (row) => row.id,
        fetchPage: (from, to) => {
          let query = supabase
            .from('messages')
            .select(columnsFor(options))
            .is('conversation_id', null);
          if (options?.changedSince) query = query.gte('changed_at', options.changedSince);
          return query
            .or(
              `and(sender_id.eq.${legacyActorId},receiver_id.eq.${legacyCounterpartId}),` +
                `and(sender_id.eq.${legacyCounterpartId},receiver_id.eq.${legacyActorId})`,
            )
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to);
        },
      });
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
      // With a cursor only rows changed since it come back, deleted ones as ids,
      // and the client merges them into what it holds. Without one (or with a
      // cursor that cannot be read) the whole conversation comes back as before.
      const since = parseDirectMessageCursor(body.since);
      const changedSince = since
        ? new Date(since.getTime() - DIRECT_MESSAGE_CURSOR_OVERLAP_MS).toISOString()
        : null;
      let currentQueryRows: DirectMessageRow[];
      let legacyQueryRows: DirectMessageRow[];
      let realtimeTopic: string | null;
      try {
        [currentQueryRows, legacyQueryRows, realtimeTopic] = await Promise.all([
          collectCurrentMessageRows({ withChangedAt: true, changedSince }),
          collectLegacyMessageRows({ withChangedAt: true, changedSince }),
          // Only a full load (opening the room) hands out the signal channel.
          since ? Promise.resolve(null) : loadDirectMessageRealtimeTopic(resolution.threadId),
      ]);
      } catch {
        return err('Direct message lookup failed', 500);
      }

      const cursor = latestDirectMessageChange([...currentQueryRows, ...legacyQueryRows]) ??
        (since ? since.toISOString() : null);
      const isVisibleCurrentRow = (row: DirectMessageRow) =>
        isCurrentDirectMessageVisible({
          fcActorId: resolution.fcId,
          fcPhone: resolution.fcPhone,
          counterparty: resolution.counterparty,
          row,
        }) ||
        (!row.sender_actor_id &&
          !row.receiver_actor_id &&
          isLegacyDirectMessageVisible({
            actor: appActor,
            fcPhone: resolution.fcPhone,
            counterpartyId: resolution.counterpartyId,
            row,
          }));
      const isVisibleLegacyRow = (row: DirectMessageRow) =>
        isLegacyDirectMessageVisible({
          actor: appActor,
          fcPhone: resolution.fcPhone,
          counterpartyId: resolution.counterpartyId,
          row,
        });
      const deletedIds = since
        ? Array.from(new Set([
            ...currentQueryRows.filter((row) => row.deleted_at !== null && isVisibleCurrentRow(row)),
            ...legacyQueryRows.filter((row) => row.deleted_at !== null && isVisibleLegacyRow(row)),
          ].map((row) => row.id)))
        : [];

      const currentRows = currentQueryRows.filter(
        (row) =>
          row.deleted_at === null &&
          (isCurrentDirectMessageVisible({
              fcActorId: resolution.fcId,
              fcPhone: resolution.fcPhone,
              counterparty: resolution.counterparty,
              row,
          }) ||
            (!row.sender_actor_id &&
              !row.receiver_actor_id &&
              isLegacyDirectMessageVisible({
                actor: appActor,
                fcPhone: resolution.fcPhone,
                counterpartyId: resolution.counterpartyId,
                row,
              }))),
        );
      const legacyRows = legacyQueryRows.filter(
        (row) =>
          row.deleted_at === null &&
          isLegacyDirectMessageVisible({
            actor: appActor,
            fcPhone: resolution.fcPhone,
            counterpartyId: resolution.counterpartyId,
            row,
          }),
        );
      const uniqueRows = Array.from(
        new Map([...currentRows, ...legacyRows].map((row) => [row.id, row])).values(),
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
          requested_id: body.conversation_id,
          counterparty_id:
            appActor.sessionRole === 'fc' ? resolution.counterpartyId : resolution.fcPhone,
          counterparty_name:
            appActor.sessionRole === 'fc' ? resolution.counterpartyName : resolution.fcName,
        },
        messages: uniqueRows.map((row) =>
          normalizeMessage(
            row,
            row.attachment_batch_id ? (attachmentsByBatch.get(row.attachment_batch_id) ?? []) : [],
          ),
        ),
        mode: since ? 'changes' : 'full',
        deleted_ids: deletedIds,
        cursor,
        realtime_topic: realtimeTopic,
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
        const textCommit = await supabase.rpc('send_garamin_direct_message_with_notification', {
            p_message_id: messageId,
            p_conversation_id: resolution.id,
            p_sender_id: identity.senderId,
            p_receiver_id: identity.receiverId,
            p_sender_actor_id: identity.senderActorId,
            p_receiver_actor_id: identity.receiverActorId,
            p_content: body.content,
        });
        atomicResult = textCommit.data;
        atomicError = textCommit.error;
      }
      if (atomicError || !atomicResult || typeof atomicResult !== 'object') {
        if (hasAttachments && atomicError) {
          return messengerAttachmentErrorResponse(atomicError);
        }
        return ok(
          {
          ok: false,
          message: 'Direct message notification persistence failed',
          delivery: buildDeliveryMetadata({
            notificationStored: false,
            pushStatus: 'not_attempted',
            retryable: true,
          }),
          },
          500,
        );
      }
      const atomic = atomicResult as Record<string, unknown>;
      const rawNotifications = Array.isArray(atomic.notifications) ? atomic.notifications : [];
      const persistedNotifications: Array<{
        notificationId: string;
        residentId: string;
        recipientActorId: string;
        recipientRole: 'admin' | 'manager' | 'fc';
      }> = [];
      for (const rawRow of rawNotifications) {
        if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
          continue;
        }
        const row = rawRow as Record<string, unknown>;
        const residentId = typeof row.resident_id === 'string' ? row.resident_id.trim() : '';
        const recipientActorId =
          typeof row.recipient_actor_id === 'string' ? row.recipient_actor_id.trim() : '';
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
        persistedNotifications.length === 0 ||
        persistedNotifications.length !== rawNotifications.length
      ) {
        return ok(
          {
          ok: false,
          message: 'Direct message notification persistence failed',
          delivery: buildDeliveryMetadata({
            notificationStored: false,
            pushStatus: 'not_attempted',
            retryable: true,
          }),
          },
          500,
        );
      }

      const preferenceResult = await applyDirectMessageNotificationPreferences(
        resolution.threadId,
        persistedNotifications,
      );
      if (!preferenceResult.ok) {
        return ok(
          {
          ok: false,
          message: 'Direct message notification preferences failed',
          delivery: buildDeliveryMetadata({
            notificationStored: false,
            pushStatus: 'not_attempted',
            retryable: true,
          }),
          },
          500,
        );
      }
      const retainedNotifications = preferenceResult.retained;
      const expoEligibleNotificationIds = preferenceResult.expoEligibleIds;

      const { data, error } = await supabase
        .from('messages')
        .select(messageColumns)
        .eq('id', messageId)
        .eq('thread_id', resolution.threadId)
        .maybeSingle();
      if (
        error ||
        !isDirectMessageRow(data) ||
        data.id !== messageId ||
        data.thread_id !== resolution.threadId
      ) {
        return ok(
          {
          ok: false,
          message: 'Direct message lookup failed',
          delivery: buildDeliveryMetadata({
            notificationStored: true,
            pushStatus: 'not_attempted',
            retryable: true,
            notificationIds: retainedNotifications.map((row) => row.notificationId),
          }),
          },
          500,
        );
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
      const attachmentWasReplayed =
        hasAttachments && (attachmentReplay || atomic.replayed === true);
      if (attachmentWasReplayed) {
        const notificationIds = retainedNotifications.map((row) => row.notificationId);
        return ok({
          ok: true,
          message: normalizeMessage(data, messageAttachments),
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

      const recipientCount = new Set(
        retainedNotifications
          .filter((row) => expoEligibleNotificationIds.has(row.notificationId))
          .map((row) => row.residentId),
      ).size;
      // The message and its notification rows are committed and the muted
      // recipients' rows are gone, so the sender gets the answer now. Token
      // lookup and the Expo send run after the response; the client treats
      // 'not_attempted' as stored with push unconfirmed and shows no alert.
      const deliverPush = async () => {
        const recipientPhones = Array.from(
          new Set(
            retainedNotifications
              .filter((row) => expoEligibleNotificationIds.has(row.notificationId))
              .map((row) => row.residentId),
          ),
        );
        const { data: tokenRows, error: tokenError } = await supabase
          .from('device_tokens')
          .select('expo_push_token,resident_id,display_name,role')
          .in('resident_id', recipientPhones);
        const notificationByResident = new Map(
          retainedNotifications
            .filter((row) => expoEligibleNotificationIds.has(row.notificationId))
            .map((row) => [row.residentId, row]),
        );
        const parsedTokenRows = parseQueryRows(tokenRows, isTokenQueryRow);
        const tokenLookupFailed =
          Boolean(tokenError) ||
          !parsedTokenRows ||
          parsedTokenRows.some((token) => !recipientPhones.includes(String(token.resident_id ?? '')));
        const eligibleTokens = tokenLookupFailed
          ? []
          : dedupeTokens(
              parsedTokenRows.filter((token) => {
            const notification = notificationByResident.get(String(token.resident_id ?? ''));
            return Boolean(
                  notification &&
                    (notification.recipientRole === 'manager'
                  ? ['manager']
                      : getAllowedNotificationTokenRoles(notification.recipientRole, 'message')
                    ).includes(String(token.role ?? '') as 'admin' | 'manager' | 'fc'),
                );
              }),
            );
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
              sentAt: new Date().toISOString(),
            },
            sound: 'default',
            priority: 'high',
            channelId: 'alerts',
          };
        });
        const adminWebResults = await Promise.all(
          retainedNotifications
            .filter(
              (notification) =>
                notification.recipientRole === 'admin' &&
                expoEligibleNotificationIds.has(notification.notificationId),
            )
            .map((notification) => {
              const preview = body.content || '첨부파일을 보냈습니다.';
              return notifyAdminWebPush(
                '새 메시지',
                preview.slice(0, 160),
                '/chat',
                notification.residentId,
                notification.notificationId,
                directTarget,
              );
            }),
        );
        const expoDelivery = tokenLookupFailed
          ? { attempted: 0, accepted: 0, rejected: 0 }
          : await sendExpoPushPayloads(pushPayload);
      };
      if (recipientCount > 0) runAfterResponse(deliverPush);
      const notificationIds = retainedNotifications.map((row) => row.notificationId);
      return ok({
        ok: true,
        message: normalizeMessage(data, messageAttachments),
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
          pushStatus: recipientCount > 0 ? 'not_attempted' : 'no_registered_device',
          retryable: false,
          ...(notificationIds.length === 1
            ? { notificationId: notificationIds[0] }
            : { notificationIds }),
        }),
      });
    }

    let currentQueryRows: DirectMessageRow[];
    let legacyQueryRows: DirectMessageRow[];
    try {
      [currentQueryRows, legacyQueryRows] = await Promise.all([
        collectCurrentMessageRows(),
        collectLegacyMessageRows(),
    ]);
    } catch {
      return err('Direct message ownership lookup failed', 500);
    }

    const currentRows = currentQueryRows.filter(
      (row) =>
        row.deleted_at === null &&
        (isCurrentDirectMessageVisible({
            fcActorId: resolution.fcId,
            fcPhone: resolution.fcPhone,
            counterparty: resolution.counterparty,
            row,
        }) ||
          (!row.sender_actor_id &&
            !row.receiver_actor_id &&
            isLegacyDirectMessageVisible({
              actor: appActor,
              fcPhone: resolution.fcPhone,
              counterpartyId: resolution.counterpartyId,
              row,
            }))),
      );
    const legacyRows = legacyQueryRows.filter(
      (row) =>
        row.deleted_at === null &&
        isLegacyDirectMessageVisible({
          actor: appActor,
          fcPhone: resolution.fcPhone,
          counterpartyId: resolution.counterpartyId,
          row,
        }),
      );

    if (body.type === 'direct_message_mark_read') {
      const incomingIds = Array.from(
        new Set(
        [...currentRows, ...legacyRows]
          .filter((row) => row.receiver_id === identity.senderId && row.is_read !== true)
          .map((row) => row.id),
        ),
      );
      if (incomingIds.length === 0) return ok({ ok: true, updated: 0 });
      let updatedCount = 0;
      for (const idBatch of chunkSupabaseFilterValues(incomingIds)) {
      const { data, error } = await supabase
        .from('messages')
        .update({ is_read: true })
          .in('id', idBatch)
        .select('id');
        const updatedRows = parseQueryRows(
          data,
          (value): value is { id: string } =>
            isRecord(value) && typeof value.id === 'string' && UUID_PATTERN.test(value.id),
        );
        if (error || !updatedRows) {
          return err('Direct message read update failed', 500);
        }
        const updatedIds = new Set(updatedRows.map((row) => row.id));
        if (updatedRows.length !== idBatch.length || idBatch.some((id) => !updatedIds.has(id)))
          return err('Direct message read update failed', 500);
        updatedCount += updatedRows.length;
      }
      return ok({ ok: true, updated: updatedCount });
    }

    const deleteMessageId = body.type === 'direct_message_delete' ? body.message_id : null;
    const candidate = [...currentRows, ...legacyRows].find((row) => row.id === deleteMessageId);
    if (
      !candidate ||
      !canDeleteDirectMessage({
        actor: appActor,
        fcPhone: resolution.fcPhone,
        counterpartyId: resolution.counterpartyId,
        row: candidate,
      })
    ) {
      return err('Direct message not found', 404);
    }
    if (candidate.attachment_batch_id) {
      const deletion = await supabase.rpc('delete_messenger_attachment_delivery_v2', {
          p_message_kind: 'direct',
          p_message_id: candidate.id,
          p_actor_id: appActor.actorId,
          p_actor_role: appActor.sessionRole,
          p_group_actor_id: null,
      });
      const result = isRecord(deletion.data) ? deletion.data : null;
      if (
        deletion.error ||
        !result ||
        result.deleted !== true ||
        result.batchId !== candidate.attachment_batch_id ||
        !Number.isSafeInteger(result.scheduled) ||
        Number(result.scheduled) < 0
      ) {
        return messengerAttachmentErrorResponse(deletion.error);
      }
      const cleanup = await drainMessengerAttachmentCleanup({
        supabase,
        limit: 20,
        batchId: candidate.attachment_batch_id,
      });
      return ok({
        ok: true,
        deleted: true,
        cleanup: {
          scheduled: Number(result.scheduled),
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
    if (error || data?.id !== candidate.id) {
      return err('Direct message delete failed', 500);
    }
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
    if (fcProfileErr) return err('FC profile lookup failed', 500);
    if (!fcProfile?.id) return err('FC profile not found', 403);

    const [
      { data: managers, error: managerErr },
      { data: managerMappings, error: managerMappingErr },
      { data: developers, error: developerErr },
      { data: admins, error: adminErr },
    ] = await Promise.all([
      supabase.from('manager_accounts').select('name,phone').eq('active', true).order('name'),
      supabase
        .from('affiliation_manager_mappings')
        .select('affiliation,manager_phone')
        .eq('active', true),
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
    if (managerErr || managerMappingErr || developerErr || adminErr) {
      return err('Chat target lookup failed', 500);
    }
    if (
      !isRecord(fcProfile) ||
      typeof fcProfile.id !== 'string' ||
      !UUID_PATTERN.test(fcProfile.id)
    )
      return err('FC profile lookup failed', 500);
    const managerRows = parseQueryRows(managers, isChatTargetManagerQueryRow);
    const managerMappingRows = parseQueryRows(managerMappings, isAffiliationManagerMappingQueryRow);
    const developerRows = parseQueryRows(developers, isChatTargetStaffQueryRow);
    const adminRows = parseQueryRows(admins, isChatTargetStaffQueryRow);
    if (
      !managerRows ||
      !managerMappingRows ||
      !developerRows ||
      !adminRows ||
      developerRows.some((row) => row.staff_type !== 'developer') ||
      adminRows.some((row) => row.staff_type === 'developer')
    )
      return err('Chat target lookup failed', 500);

    const managerAffiliationsByPhone = new Map<string, string[]>();
    managerMappingRows.forEach((mapping) => {
      const managerPhone = sanitize(mapping.manager_phone);
      const affiliation = normalizeAffiliationLabel(mapping.affiliation);
      if (!managerPhone || !affiliation) return;
      const current = managerAffiliationsByPhone.get(managerPhone) ?? [];
      if (!current.includes(affiliation)) {
        managerAffiliationsByPhone.set(managerPhone, [...current, affiliation]);
      }
    });
    managerAffiliationsByPhone.forEach((affiliations, managerPhone) => {
      const headquartersNumber = (value: string) => {
        const matched = value.match(/^(10|[1-9])\s*본부/);
        return matched?.[1] ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
      };
      managerAffiliationsByPhone.set(
        managerPhone,
        [...affiliations].sort(
          (left, right) =>
            headquartersNumber(left) - headquartersNumber(right) || left.localeCompare(right, 'ko'),
        ),
      );
    });

    const targetSenderIds = Array.from(
      new Set(
        [
          ...managerRows.map((manager) => sanitize(manager.phone)),
          ...developerRows.map((developer) => sanitize(developer.phone)),
          ...adminRows.map((admin) => sanitize(admin.phone)),
        ].filter((value) => value.length > 0),
      ),
    );

    let chatSummaries: Record<string, InternalMessengerSummary>;
    try {
      chatSummaries = await fetchInternalMessengerSummaries(residentId, targetSenderIds);
    } catch (summaryErr) {
      if (!isMissingInternalMessengerSummaryRpc(summaryErr)) {
        return err('Chat target lookup failed', 500);
      }
      try {
        chatSummaries = await fetchLegacyInternalMessengerSummaries(residentId, targetSenderIds);
      } catch {
        return err('Chat target lookup failed', 500);
      }
    }

    const canonicalThreadByTargetId = new Map<string, string | null>();
    if (appActor) {
      const accessible = await listAccessibleExistingDirectThreads(appActor);
      if (accessible.ok === false) {
        return err(accessible.message, accessible.status);
      }
      const idsByTarget = new Map<string, string[]>();
      accessible.threads.forEach((thread) => {
        idsByTarget.set(thread.counterpartyId, [
          ...(idsByTarget.get(thread.counterpartyId) ?? []),
          thread.id,
        ]);
      });
      idsByTarget.forEach((ids, targetId) => {
        canonicalThreadByTargetId.set(targetId, ids.length === 1 ? ids[0] : null);
      });
    }

    const attachCanonicalConversationId = <T extends { phone?: string | null }>(
      rows: T[],
      targetIdForRow: (row: T) => string = (row) => sanitize(row.phone),
    ) =>
      rows.map((row) => ({
      ...row,
      conversation_id: canonicalThreadByTargetId.get(targetIdForRow(row)) ?? null,
    }));

    return ok({
      ok: true,
      managers: attachCanonicalConversationId(
        attachChatSummariesToContacts(
          managerRows
          .map((manager) => ({
            name: typeof manager.name === 'string' ? manager.name : '',
            phone: sanitize(manager.phone),
              affiliation:
                managerAffiliationsByPhone.get(sanitize(manager.phone))?.join(' · ') ?? null,
          }))
          .filter((manager) => manager.phone.length > 0),
        chatSummaries,
        ),
      ),
      developers: attachCanonicalConversationId(
        attachChatSummariesToContacts(
          developerRows
          .map((developer) => ({
            name: typeof developer.name === 'string' ? developer.name : '',
            phone: sanitize(developer.phone),
          }))
          .filter((developer) => developer.phone.length > 0),
        chatSummaries,
        ),
      ),
      admins: attachCanonicalConversationId(
        attachChatSummariesToContacts(
          adminRows
          .map((admin) => ({
            name: typeof admin.name === 'string' ? admin.name : '',
            phone: sanitize(admin.phone),
            staff_type: typeof admin.staff_type === 'string' ? admin.staff_type : null,
          }))
          .filter((admin) => admin.phone.length > 0),
        chatSummaries,
        ),
      ),
      admin_unread_count: adminRows.reduce(
        (total, admin) => total + (chatSummaries[sanitize(admin.phone)]?.unread_count ?? 0),
        0,
      ),
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
      const requestedLimit = Number(body.limit);
      const paginated = body.limit !== undefined;
      if (
        paginated &&
        (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50)
      ) {
        return err('internal chat list limit is invalid', 400);
      }
      let cursorLatestAt: string | null = null;
      let cursorFcId: string | null = null;
      if (body.cursor) {
        try {
          const parsed = JSON.parse(atob(body.cursor)) as Record<string, unknown>;
          const latestAt = parsed.latestAt;
          const fcId = String(parsed.fcId ?? '').toLowerCase();
          if (
            typeof latestAt !== 'string' ||
            !Number.isFinite(Date.parse(latestAt)) ||
            !UUID_PATTERN.test(fcId)
          ) {
            return err('internal chat list cursor is invalid', 400);
          }
          cursorLatestAt = latestAt;
          cursorFcId = fcId;
        } catch {
          return err('internal chat list cursor is invalid', 400);
        }
      }
      const pageLimit = paginated ? requestedLimit : 10_000;
      const { data: rawPageRows, error: pageError } = await supabase.rpc(
        'list_internal_chat_page_v1',
        {
          p_viewer_id: viewerId,
          p_include_all_completed_fc: body.viewer_read_only === true,
          p_limit: paginated ? pageLimit + 1 : pageLimit,
          p_cursor_latest_at: cursorLatestAt,
          p_cursor_fc_id: cursorFcId,
        },
      );
      let pageRowPayload: unknown = rawPageRows;
      if (pageError) {
        if (!isMissingInternalChatPageRpc(pageError)) {
          return err('Internal chat list failed', 500);
        }
        const legacy = await fetchLegacyInternalChatList(viewerId, body.viewer_read_only === true);
        const cursorTimestamp = cursorLatestAt === null ? null : Date.parse(cursorLatestAt);
        const legacyRows = legacy.items
          .map((item) => ({
            ...item,
            fc_id: item.fc_id.trim().toLowerCase(),
            total_unread: legacy.totalUnread,
            latest_at: item.last_time ?? INTERNAL_CHAT_EPOCH,
          }))
          .sort((left, right) => {
            const timestampDifference = Date.parse(right.latest_at) - Date.parse(left.latest_at);
            return timestampDifference !== 0
              ? timestampDifference
              : right.fc_id.localeCompare(left.fc_id);
          })
          .filter((row) => {
            if (cursorTimestamp === null || cursorFcId === null) return true;
            const rowTimestamp = Date.parse(row.latest_at);
            return (
              rowTimestamp < cursorTimestamp ||
              (rowTimestamp === cursorTimestamp && row.fc_id < cursorFcId)
            );
          });
        pageRowPayload = legacyRows.slice(0, paginated ? pageLimit + 1 : pageLimit);
      }
      const pageRows = parseQueryRows(pageRowPayload, isInternalChatPageQueryRow);
          if (
        !pageRows ||
        new Set(pageRows.map((row) => String(row.fc_id).toLowerCase())).size !== pageRows.length ||
        new Set(pageRows.map((row) => Number(row.total_unread))).size > 1
      ) {
        return err('Internal chat list failed', 500);
      }
      const normalizedRows: InternalChatPageRow[] = pageRows.map((row) => {
        const phone = sanitize(String(row.phone));
          return {
          fc_id: String(row.fc_id).toLowerCase(),
            name: String(row.name ?? '').trim() || phone,
            phone,
          affiliation: row.affiliation as string | null,
          last_message: row.last_message as string | null,
          last_time: row.last_time as string | null,
          unread_count: Number(row.unread_count),
          total_unread: Number(row.total_unread),
          latest_at: row.latest_at as string,
          };
      });
      const hasMore = paginated && normalizedRows.length > pageLimit;
      const summaryItems = normalizedRows.slice(0, pageLimit);
      const tail = summaryItems[summaryItems.length - 1];
      const nextCursor =
        hasMore && tail
        ? btoa(JSON.stringify({ latestAt: tail.latest_at, fcId: tail.fc_id }))
        : null;
      const canonicalThreadByFcId = new Map<string, string | null>();
      if (appActor) {
        const accessible = await listAccessibleExistingDirectThreads(
          appActor,
          summaryItems.map((item) => item.fc_id),
        );
        if (accessible.ok === false) {
          return err(accessible.message, accessible.status);
        }
        const idsByFc = new Map<string, string[]>();
        accessible.threads.forEach((thread) => {
          idsByFc.set(thread.fcId, [...(idsByFc.get(thread.fcId) ?? []), thread.id]);
        });
        idsByFc.forEach((ids, fcId) => {
          canonicalThreadByFcId.set(fcId, ids.length === 1 ? ids[0] : null);
        });
      }

      return ok({
        ok: true,
        items: summaryItems.map((item) => ({
          ...item,
          total_unread: undefined,
          latest_at: undefined,
          conversation_id: canonicalThreadByFcId.get(item.fc_id) ?? null,
          target_id: item.phone,
        })),
        total_unread: summaryItems[0]?.total_unread ?? 0,
        next_cursor: nextCursor,
        has_more: hasMore,
        limit: paginated ? pageLimit : summaryItems.length,
      });
    } catch {
      return err('Internal chat list failed', 500);
    }
  }

  if (body.type === 'internal_unread_count') {
    const viewerId = String(body.viewer_id ?? '').trim();
    if (!viewerId) {
      return err('viewer_id is required', 400);
    }

    try {
      const shouldScopeInternalUnread =
        body.viewer_role === 'admin' || body.viewer_is_request_board_designer === true;

      if (!shouldScopeInternalUnread) {
        const { count, error } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('receiver_id', viewerId)
          .eq('is_read', false)
          .is('deleted_at', null);
        const exactCount = parseQueryCount(count);
        if (error || exactCount === null) {
          return err('Internal unread count failed', 500);
        }
        return ok({ ok: true, count: exactCount });
      }

      const participants = await fetchInternalFcProfiles();
      const chatParticipants = participants.map((participant) => ({
        fc_id: participant.id,
        name: participant.name,
        phone: participant.phone,
        affiliation: participant.affiliation,
      }));
      const scopedSenderIds = Array.from(
        new Set(
          chatParticipants
        .filter((participant) =>
          shouldIncludeInternalChatParticipant(participant, {
            includeAllCompletedFc: body.viewer_read_only === true,
              }),
        )
        .map((participant) => sanitize(participant.phone))
            .filter((phone) => phone.length > 0),
        ),
      );

      if (scopedSenderIds.length === 0) {
        return ok({ ok: true, count: 0 });
      }

      let exactCount = 0;
      for (const senderBatch of chunkSupabaseFilterValues(scopedSenderIds)) {
      const { count, error } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', viewerId)
        .eq('is_read', false)
        .is('deleted_at', null)
          .in('sender_id', senderBatch);
        const batchCount = parseQueryCount(count);
        if (error || batchCount === null || !Number.isSafeInteger(exactCount + batchCount))
          return err('Internal unread count failed', 500);
        exactCount += batchCount;
      }

      return ok({ ok: true, count: exactCount });
    } catch {
      return err('Internal unread count failed', 500);
    }
  }

  // 알림센터 목록 조회 (RLS 우회)
  if (body.type === 'inbox_list') {
    const viewer = getReceiptViewer(body);
    if (!viewer) return err('Verified notification viewer is required', 401);
    const role = body.role;
    const residentId = sanitize(body.resident_id);
    const limit = Math.max(1, Math.min(Number(body.limit ?? 80) || 80, 200));
    const notificationCursor =
      body.notification_cursor === undefined || body.notification_cursor === null
        ? null
        : parseFcNotifyInboxCursor(body.notification_cursor);
    if (
      body.notification_cursor !== undefined &&
      body.notification_cursor !== null &&
      !notificationCursor
    ) {
      return err('Notification cursor is invalid', 400);
    }
    const noticeCursor =
      body.notice_cursor === undefined || body.notice_cursor === null
        ? null
        : parseFcNotifyInboxCursor(body.notice_cursor, true);
    if (body.notice_cursor !== undefined && body.notice_cursor !== null && !noticeCursor) {
      return err('Notice cursor is invalid', 400);
    }
    const includeRequestBoardFc =
      role === 'admin' && residentId.length > 0 && body.include_request_board_fc === true;
    const onlyRequestBoardCategories = body.only_request_board_categories === true;
    const receiptViewer = buildNotificationReceiptViewer({
      viewer,
      inboxRole: role,
      residentId,
      includeRequestBoardFc,
    });

    const buildPrimaryNotifQuery = (selectColumns: string) => {
      let query = applyNotificationAudienceScope(
        supabase
        .from('notifications')
        .select(selectColumns)
        .eq('recipient_role', role)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }),
        receiptViewer,
      );

      if (onlyRequestBoardCategories) {
        query = query.ilike('category', `${REQUEST_BOARD_CATEGORY_PREFIX}%`);
      }

      return query;
    };

    const runNotifQuery = (
      buildQuery: (selectColumns: string) => any,
    ): Promise<NotificationInboxRow[]> =>
      collectVisibleNotificationInboxRows<NotificationInboxRow>({
        limit: limit + 1,
        pageSize: 200,
        fetchPage: async (offset, pageSize) => {
          const result = await applyNotificationInboxCursor(
            buildQuery(
            'id,title,body,category,target,target_url,created_at,resident_id,recipient_role,recipient_actor_id',
            ),
            notificationCursor,
          ).range(offset, offset + pageSize - 1);
          const data = result.data as Array<Record<string, any>> | null;
          const error = result.error as { code?: string } | null;

          if (error) throw error;
          if (!Array.isArray(data) || !data.every(isNotificationOwnershipPageQueryRow)) {
            throw new Error('notification_inbox_query_contract_invalid');
          }

          return data.map((rawRow): NotificationInboxRow => {
            const row = rawRow as NotificationInboxRow;
            return {
              ...row,
              target: parseNotificationTargetV1(row.target),
              target_url: 'target_url' in row ? (row.target_url ?? null) : null,
            };
          });
        },
        selectVisible: async (rows) => {
          const authorizedRows = rows.filter(
            (row) =>
              authorizeNotificationReceipt(toNotificationOwnershipRow(row), receiptViewer)
                .authorized,
          );
          const receiptMap = await fetchReceiptMap(
            authorizedRows.map((item) => String(item.id)),
            viewer,
          );
          return authorizedRows
            .map((item): NotificationInboxRow => {
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
                .order('created_at', { ascending: false })
                .order('id', { ascending: false }),
            )
          : Promise.resolve([]),
      ]);

      const dedupedNotifications: NotificationInboxRow[] = Array.from(
        ([...primaryNotifications, ...requestBoardFcNotifications] as NotificationInboxRow[])
          .reduce((map, item) => {
            if (!map.has(item.id)) map.set(item.id, item);
            return map;
          }, new Map<string, NotificationInboxRow>())
          .values(),
      );
      dedupedNotifications.sort(compareInboxRowsDescending);
      const notificationPage = toInboxCursorPage(dedupedNotifications, limit);
      const noticePage: InboxCursorPage<NoticeRow> = onlyRequestBoardCategories
        ? { rows: [], hasMore: false, nextCursor: null }
        : await fetchUnifiedNoticePage(limit, noticeCursor);

      return ok({
        ok: true,
        notifications: notificationPage.rows,
        notices: noticePage.rows,
        notification_has_more: notificationPage.hasMore,
        notification_next_cursor: notificationPage.nextCursor,
        notice_has_more: noticePage.hasMore,
        notice_next_cursor: noticePage.nextCursor,
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
    if (!isNotificationOwnershipQueryRow(data)) {
      return err('Notification lookup failed', 500);
    }

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
    const includeRequestBoardFc =
      role === 'admin' && residentId.length > 0 && body.include_request_board_fc === true;
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
    const sinceIso = Number.isNaN(sinceDate.getTime())
      ? new Date(0).toISOString()
      : sinceDate.toISOString();
    const noticeSinceDate = body.notice_since ? new Date(body.notice_since) : sinceDate;
    const noticeSinceIso = Number.isNaN(noticeSinceDate.getTime())
      ? sinceIso
      : noticeSinceDate.toISOString();

    try {
      const visibleRows = await fetchVisibleNotificationOwnershipRows({
        role,
            receiptViewer,
        sinceIso,
        excludeRequestBoardCategories,
        onlyRequestBoardCategories,
      });
      const visibleIds = visibleRows.map((row) => String(row.id));
      const receiptMap = await fetchReceiptMap(visibleIds, viewer);
      const notificationCount = visibleIds.filter((notificationId) => {
        const receipt = receiptMap.get(notificationId);
      return !receipt?.read_at && !receipt?.dismissed_at;
    }).length;
      const noticeCount =
        includeNotices && !onlyRequestBoardCategories
          ? await countUnifiedNoticesAfter(noticeSinceIso)
          : 0;
      return ok({ ok: true, count: notificationCount + noticeCount });
    } catch {
      return err('Notification unread count failed', 500);
    }
  }

  if (body.type === 'inbox_mark_all_read') {
    const viewer = getReceiptViewer(body);
    if (!viewer) return err('Verified notification viewer is required', 401);
    const role = body.role;
    const residentId = sanitize(body.resident_id);
    const includeRequestBoardFc =
      role === 'admin' && residentId.length > 0 && body.include_request_board_fc === true;
    const receiptViewer = buildNotificationReceiptViewer({
      viewer,
      inboxRole: role,
      residentId,
      includeRequestBoardFc,
      });

    try {
      const visibleRows = await fetchVisibleNotificationOwnershipRows({
        role,
        receiptViewer,
        onlyRequestBoardCategories: body.only_request_board_categories === true,
      });
      const visibleIds = visibleRows.map((row) => String(row.id));
      const receiptMap = await fetchReceiptMap(visibleIds, viewer);
      const nonDismissedIds = visibleIds.filter(
        (notificationId) => !receiptMap.get(notificationId)?.dismissed_at,
      );
      const unreadIds = nonDismissedIds.filter(
        (notificationId) => !receiptMap.get(notificationId)?.read_at,
      );
      const timestamp = new Date().toISOString();
      await persistNotificationReceiptRows(
        unreadIds.map((notificationId) => ({
          notification_id: notificationId,
          viewer_actor_id: viewer.actorId,
          viewer_role: viewer.role,
          read_at: timestamp,
          updated_at: timestamp,
        })),
        viewer,
      );
      return ok({
        ok: true,
        authorized: true,
        changed: unreadIds.length > 0,
        state: unreadIds.length > 0 ? 'read' : 'already_read',
        updated: unreadIds.length,
        matched: nonDismissedIds.length,
      });
    } catch {
      return err('Notification receipt update failed', 500);
    }
  }

  if (
    body.type === 'inbox_mark_read' ||
    body.type === 'inbox_dismiss' ||
    body.type === 'inbox_delete'
  ) {
    const viewer = getReceiptViewer(body);
    if (!viewer) return err('Verified notification viewer is required', 401);
    const residentId = sanitize(body.resident_id);
    const requestedIds = Array.from(
      new Set((body.notification_ids ?? []).filter((id) => UUID_PATTERN.test(id))),
    );
    if (requestedIds.length === 0) {
      return err('notification_ids are required', 400);
    }

    const { data: ownershipRows, error: visibilityError } = await supabase
      .from('notifications')
      .select('id,recipient_actor_id,recipient_role,resident_id,category')
      .in('id', requestedIds);
    if (visibilityError) {
      return err('Notification ownership lookup failed', 500);
    }
    const ownershipQueryRows = parseQueryRows(ownershipRows, isNotificationOwnershipQueryRow);
    if (
      !ownershipQueryRows ||
      new Set(ownershipQueryRows.map((row) => String(row.id))).size !== ownershipQueryRows.length ||
      ownershipQueryRows.some((row) => !requestedIds.includes(String(row.id)))
    )
      return err('Notification ownership lookup failed', 500);
    const loadedRows = ownershipQueryRows.map(toNotificationOwnershipRow);
    const receiptViewer = buildNotificationReceiptViewer({
      viewer,
      inboxRole: body.role,
      residentId,
      includeRequestBoardFc: body.include_request_board_fc,
    });
    const ownershipSet = authorizeNotificationReceiptSet(requestedIds, loadedRows, receiptViewer);
    if (ownershipSet.authorized === false) {
      return ownershipSet.status === 404
        ? err('Notification not found', 404)
        : err('Notification access denied', 403);
    }

    const receiptMap = await fetchReceiptMap(requestedIds, viewer).catch(() => null);
    if (!receiptMap) return err('Notification receipt lookup failed', 500);
    const timestamp = new Date().toISOString();
    const isDismiss = body.type === 'inbox_dismiss' || body.type === 'inbox_delete';
    const receiptAction = isDismiss ? ('dismiss' as const) : ('mark_read' as const);
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
      const receiptRows: NotificationReceiptWriteRow[] = changedStates.map(
        ({ notificationId, receipt }) => ({
        notification_id: notificationId,
        viewer_actor_id: viewer.actorId,
        viewer_role: viewer.role,
          read_at: isDismiss ? (receipt?.read_at ?? timestamp) : timestamp,
        ...(isDismiss ? { dismissed_at: timestamp } : {}),
        updated_at: timestamp,
        }),
      );
      try {
        await persistNotificationReceiptRows(receiptRows, viewer);
      } catch {
        return err('Notification receipt update failed', 500);
      }
    }
    return ok({
      ok: true,
      authorized: true,
      changed: changedStates.length > 0,
      state:
        changedStates.length > 0
          ? isDismiss
            ? 'dismissed'
            : 'read'
          : isDismiss
            ? 'already_dismissed'
            : 'already_read',
      updated: changedStates.length,
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
      const notice =
        notices.length > 0
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
      const message =
        latestErr instanceof Error ? latestErr.message : 'Failed to fetch latest notice';
      return err(message, 500);
    }
  }

  // 직접 알림 처리 (notify/message)
  if (body.type === 'notify' || body.type === 'message') {
    const target_role = body.target_role;
    const target_id =
      target_role === 'admin'
      ? normalizeAdminNotificationTargetId(body.target_id)
      : sanitize(body.target_id);
    const skipNotificationInsert = body.skip_notification_insert === true;

    const title = redactSensitiveText(
      body.type === 'notify' ? body.title : (body.title ?? '\uba54\uc2dc\uc9c0'),
      '\uc54c\ub9bc',
    );
    const message = redactSensitiveText(
      body.type === 'notify'
        ? body.body
        : (body.body ??
            body.message ??
            '\uc0c8\ub85c\uc6b4 \uba54\uc2dc\uc9c0\uac00 \ub3c4\ucc29\ud588\uc2b5\ub2c8\ub2e4.'),
    );
    const category = redactSensitiveText(
      body.type === 'notify' ? (body.category ?? 'app_event') : (body.category ?? 'message'),
      'app_event',
    );
    const isRequestBoardNotification = category.startsWith(REQUEST_BOARD_CATEGORY_PREFIX);
    const recipientBinding = body.type === 'notify' ? body.recipient_binding : undefined;
    if (
      isRequestBoardNotification &&
      recipientBinding === undefined &&
      requireCanonicalRequestBoardRecipientBinding
    ) {
      return err('Canonical Request Board recipient binding is required', 400);
    }
    if (
      isRequestBoardNotification &&
      recipientBinding !== undefined &&
      recipientBinding !== 'canonical_person_v1'
    ) {
      return err('Unsupported Request Board recipient binding', 400);
    }
    if (!isRequestBoardNotification && recipientBinding !== undefined) {
      return err('Recipient binding is not allowed for this notification category', 400);
    }
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
        notificationTarget &&
        JSON.stringify(notificationTarget) !== JSON.stringify(canonicalTarget)
      ) {
        return err('Notification target does not match the direct conversation', 400);
      }
      notificationTarget = canonicalTarget;
      directConversationId = directConversation.id;
      canonicalFcId = directConversation.fcId;
    }

    if (!notificationTarget) {
      return err('A valid typed notification target is required', 400);
    }
    const suppliedNotificationId = String(body.notification_id ?? '').trim();
    if (skipNotificationInsert && !UUID_PATTERN.test(suppliedNotificationId)) {
      return err('notification_id is required when notification insert is skipped', 400);
    }

    if (
      appActor &&
      shouldRequireActiveStaffNotificationTarget({
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

    let url = redactSensitiveText(
      body.type === 'notify' ? (body.url ?? '/notifications') : (body.url ?? '/chat'),
      '/notifications',
    );
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
        try {
          tokens = await collectSupabaseRows<TokenRow>({
            queryName: 'fc_broadcast_device_tokens',
            isRow: isTokenQueryRow,
            rowKey: (row) => row.expo_push_token,
            fetchPage: (from, to) =>
              supabase
          .from('device_tokens')
          .select('expo_push_token,resident_id,display_name,role')
                .eq('role', 'fc')
                .order('expo_push_token', { ascending: true })
                .range(from, to),
          });
        } catch {
          tokenLoadFailed = true;
          reportEdgeDiagnostic({
            event: 'fc_notify.device_token_load',
            reason: 'query_failed',
            errorClass: 'database',
          });
        }
      }
    }
    tokens = filterManagerTokensForNotification(tokens, {
      category,
      targetId: target_id,
    });
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
        claimedRecipientActorId &&
        claimedRecipientActorId.toLowerCase() !== recipientActorId.toLowerCase()
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

    const generalPushPreferenceResult = await applyGeneralPushPreferences(tokens, category);
    tokens = generalPushPreferenceResult.eligibleTokens;
    if (generalPushPreferenceResult.lookupFailed) {
      reportEdgeDiagnostic({
        event: 'fc_notify.device_token_load',
        reason: 'query_failed',
        errorClass: 'database',
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
          pushStatus:
            adminWebPush?.ok === true && adminWebPush.sent > 0
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
          delivery.rejected > 0 || adminWebPush?.ok === false ? 'provider_rejected' : 'accepted',
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
      const message =
        recipientError instanceof Error
          ? recipientError.message
          : 'failed to resolve admin recipients';
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
        notificationRows.push(
          sanitizeNotificationInsert({
          title,
          body: message,
          category: (body as any).type,
          fc_id: fcRow.id,
          resident_id: recipientId,
          recipient_actor_id: recipientActorId,
          recipient_role: 'admin' as const,
          target: lifecycleTarget,
          target_url: targetUrl,
          }),
        );
      }

      const insertResult =
        notificationRows.length > 0
        ? await supabase
          .from('notifications')
          .insert(notificationRows)
          .select('id,resident_id,recipient_role,recipient_actor_id,target')
        : { data: [], error: null };
      if (insertResult.error || !Array.isArray(insertResult.data)) {
        logError = insertResult.error;
        notificationPersistenceFailed = true;
      } else {
        const expectedByResident = new Map(
          notificationRows.map((row) => [String(row.resident_id ?? ''), row]),
        );
        for (const row of insertResult.data) {
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
          notificationRows.length !== recipientResidentIds.length ||
          notificationIdByRecipient.size !== notificationRows.length
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
      notificationIdByRecipient.has(String(token.resident_id ?? '')),
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
        notifyAdminWebPush(title, message, targetUrl, recipientId, notificationId, lifecycleTarget),
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

  const lifecyclePreferenceResult = await applyGeneralPushPreferences(
    tokens,
    (body as { type: string }).type,
  );
  tokens = lifecyclePreferenceResult.eligibleTokens;
  if (lifecyclePreferenceResult.lookupFailed) {
    reportEdgeDiagnostic({
      event: 'fc_notify.device_token_load',
      reason: 'query_failed',
      errorClass: 'database',
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
        pushStatus:
          adminWebPush?.ok === true && adminWebPush.sent > 0 ? 'accepted' : 'no_registered_device',
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
        delivery.rejected > 0 || adminWebPush?.ok === false ? 'provider_rejected' : 'accepted',
      retryable: delivery.rejected > 0 || adminWebPush?.ok === false,
      notificationIds: Array.from(notificationIdByRecipient.values()),
      attempted: delivery.attempted,
      accepted: delivery.accepted + (adminWebPush?.ok === true ? adminWebPush.sent : 0),
      rejected: delivery.rejected,
    }),
  });
});
