import { createHash, timingSafeEqual } from 'node:crypto';

import { containsSensitiveText, redactSensitiveText } from './sensitive-text';
import {
  parseNotificationTargetV1,
  parseRequestBoardTargetForFc,
  type NotificationTargetV1,
} from './notification-target';
import { getWebStaffSenderName } from './staff-identity';

export const REQUEST_BOARD_NOTIFY_CATEGORIES = [
  'request_board_new_request',
  'request_board_accepted',
  'request_board_rejected',
  'request_board_completed',
  'request_board_cancelled',
  'request_board_fc-accepted',
  'request_board_fc-rejected',
  'request_board_message',
] as const;

type RequestBoardNotifyCategory = (typeof REQUEST_BOARD_NOTIFY_CATEGORIES)[number];
type BrowserAction =
  | 'inbox_list'
  | 'inbox_get'
  | 'inbox_mark_read'
  | 'inbox_dismiss'
  | 'internal_unread_count'
  | 'message'
  | 'resolve_garamin_direct_conversation'
  | 'direct_message_list'
  | 'direct_message_send'
  | 'direct_message_broadcast_send'
  | 'direct_message_mark_read'
  | 'direct_message_delete'
  | 'exam_approval_notify';
type BrowserSessionRole = 'admin' | 'manager' | 'fc';
type BrowserStaffType = 'admin' | 'developer' | null;

export type FcNotifyBrowserSession = {
  role: BrowserSessionRole;
  residentDigits: string;
  displayName: string;
  staffType: BrowserStaffType;
};

export type RequestBoardNotifyPayload = {
  type: 'notify';
  target_role: 'fc';
  recipient_binding: 'canonical_person_v1';
  target_id: string;
  title: string;
  body: string;
  category: RequestBoardNotifyCategory;
  target: Extract<
    NotificationTargetV1,
    { kind: 'request' | 'request_chat' | 'request_direct_chat' }
  >;
};

export type BrowserFcNotifyPayload =
  | {
      type: 'inbox_list';
      role: 'admin' | 'fc';
      resident_id: string | null;
      limit: number;
      viewer_actor_role: BrowserSessionRole;
      viewer_actor_phone: string;
    }
  | {
      type: 'inbox_mark_read' | 'inbox_dismiss';
      notification_ids: string[];
      viewer_actor_role: BrowserSessionRole;
      viewer_actor_phone: string;
    }
  | {
      type: 'inbox_get';
      notification_id: string;
      viewer_actor_role: BrowserSessionRole;
      viewer_actor_phone: string;
    }
  | {
      type: 'internal_unread_count';
      viewer_id: string;
      viewer_role: 'admin' | 'fc';
      viewer_staff_type: BrowserStaffType;
      viewer_read_only: boolean;
      viewer_is_request_board_designer: false;
    }
  | {
      type: 'notify';
      target_role: 'fc';
      target_id: string;
      title: string;
      body: string;
      category: 'message';
      sender_id: string;
      sender_name: string;
    }
  | {
      type: 'resolve_garamin_direct_conversation';
      target_id: string | null;
      conversation_id: string | null;
      viewer_actor_role: BrowserSessionRole;
      viewer_actor_phone: string;
    }
  | {
      type: 'direct_message_list' | 'direct_message_mark_read';
      conversation_id: string;
      viewer_actor_role: BrowserSessionRole;
      viewer_actor_phone: string;
    }
  | {
      type: 'direct_message_send';
      conversation_id: string;
      client_message_id: string;
      content: string;
      attachment_intent_ids?: string[];
      delivery_key?: string;
      payload_fingerprint?: string;
      viewer_actor_role: BrowserSessionRole;
      viewer_actor_phone: string;
    }
  | {
      type: 'direct_message_broadcast_send';
      conversation_ids: string[];
      client_message_ids: string[];
      content: string;
      attachment_intent_ids?: string[];
      delivery_key?: string;
      payload_fingerprint?: string;
      viewer_actor_role: 'admin';
      viewer_actor_phone: string;
    }
  | {
      type: 'direct_message_delete';
      conversation_id: string;
      message_id: string;
      viewer_actor_role: BrowserSessionRole;
      viewer_actor_phone: string;
    }
  | {
      type: 'notify';
      target_role: 'admin';
      target_id: null;
      title: string;
      body: string;
      category: 'message';
      sender_id: string;
      sender_name: string;
    }
  | {
      type: 'notify';
      target_role: 'fc';
      target_id: string;
      title: string;
      body: string;
      category: 'exam_apply';
      url: '/exam-apply' | '/exam-apply2';
      target: Extract<NotificationTargetV1, { kind: 'exam' }>;
    };

type PolicyFailure = {
  ok: false;
  status: number;
  error: string;
};

type PolicySuccess<T> = {
  ok: true;
  payload: T;
};

type PolicyResult<T> = PolicySuccess<T> | PolicyFailure;

const PHONE_PATTERN = /^\d{11}$/;
const browserActions = new Set<BrowserAction>([
  'inbox_list',
  'inbox_get',
  'inbox_mark_read',
  'inbox_dismiss',
  'internal_unread_count',
  'message',
  'resolve_garamin_direct_conversation',
  'direct_message_list',
  'direct_message_send',
  'direct_message_broadcast_send',
  'direct_message_mark_read',
  'direct_message_delete',
  'exam_approval_notify',
]);
const requestBoardCategories = new Set<string>(REQUEST_BOARD_NOTIFY_CATEGORIES);

function fail(status: number, error: string): PolicyFailure {
  return { ok: false, status, error };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function boundedSafeText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const redacted = redactSensitiveText(normalized);
  let bounded = redacted.slice(0, maxLength);
  if (/[\uD800-\uDBFF]$/.test(bounded)) {
    bounded = bounded.slice(0, -1);
  }
  return bounded || null;
}

function normalizeRelativeUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  let decoded = normalized;
  for (let depth = 0; depth < 3; depth += 1) {
    if (
      decoded.startsWith('//')
      || decoded.includes('\\')
      || /%(?:2e|2f|5c)/i.test(decoded)
      || decoded.split(/[?#]/, 1)[0].split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      return null;
    }
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return null;
    }
  }
  if (
    !normalized.startsWith('/')
    || normalized.startsWith('//')
    || normalized.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(normalized)
    || normalized.length > 500
    || containsSensitiveText(normalized)
  ) {
    return null;
  }

  try {
    const parsed = new URL(normalized, 'https://fc-notify.invalid');
    if (parsed.origin !== 'https://fc-notify.invalid') return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function normalizedIdentity(value: unknown) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

function hasMismatchedIdentity(
  body: Record<string, unknown>,
  key: string,
  expected: string | null,
) {
  if (!hasOwn(body, key)) return false;
  const provided = body[key];
  if (expected === null) {
    return provided !== null && String(provided ?? '').trim() !== '';
  }
  return normalizedIdentity(provided) !== expected;
}

function hasMismatchedString(
  body: Record<string, unknown>,
  key: string,
  expected: string | null,
) {
  if (!hasOwn(body, key)) return false;
  const provided = body[key];
  if (expected === null) return provided !== null && String(provided ?? '').trim() !== '';
  return String(provided ?? '').trim() !== expected;
}

function hasMismatchedBoolean(
  body: Record<string, unknown>,
  key: string,
  expected: boolean,
) {
  return hasOwn(body, key) && body[key] !== expected;
}

export function classifyFcNotifyIngress(
  body: unknown,
  bridgeToken: string | null | undefined,
): { ok: true; ingress: 'browser' | 'request_board' } | PolicyFailure {
  const record = asRecord(body);
  if (!record) return fail(400, 'Invalid request body');

  const action = typeof record.type === 'string' ? record.type.trim() : '';
  if (action === 'notify' || String(bridgeToken ?? '').trim()) {
    return { ok: true, ingress: 'request_board' };
  }
  if (!browserActions.has(action as BrowserAction)) {
    return fail(403, 'FC notify action is not allowed');
  }
  return { ok: true, ingress: 'browser' };
}

export function verifyRequestBoardBridgeToken(
  providedToken: string | null | undefined,
  expectedToken: string | null | undefined,
) {
  const provided = String(providedToken ?? '').trim();
  const expected = String(expectedToken ?? '').trim();
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return Boolean(provided && expected && timingSafeEqual(providedDigest, expectedDigest));
}

export function buildRequestBoardNotifyPayload(input: {
  body: unknown;
  providedToken: string | null | undefined;
  expectedToken: string | null | undefined;
}): PolicyResult<RequestBoardNotifyPayload> {
  const expectedToken = String(input.expectedToken ?? '').trim();
  if (!expectedToken) return fail(503, 'Request Board notification bridge is not configured');
  if (!verifyRequestBoardBridgeToken(input.providedToken, expectedToken)) {
    return fail(401, 'Invalid Request Board bridge token');
  }

  const body = asRecord(input.body);
  if (!body) return fail(400, 'Invalid request body');
  if (body.type !== 'notify' || body.target_role !== 'fc') {
    return fail(403, 'Request Board bridge action is not allowed');
  }

  const targetId = typeof body.target_id === 'string' ? body.target_id.trim() : '';
  const recipientBinding = body.recipient_binding;
  const title = boundedSafeText(body.title, 120);
  const message = boundedSafeText(body.body, 2_000);
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const legacyUrl = normalizeRelativeUrl(body.url);
  const target = parseRequestBoardTargetForFc(body.target);

  if (!PHONE_PATTERN.test(targetId)) return fail(400, 'Invalid FC notification target');
  if (recipientBinding !== 'canonical_person_v1') {
    return fail(400, 'Invalid Request Board recipient binding');
  }
  if (!title || !message) return fail(400, 'Invalid notification content');
  if (!requestBoardCategories.has(category)) return fail(403, 'Request Board category is not allowed');
  if (!legacyUrl) return fail(400, 'Invalid notification URL');
  if (!target) return fail(400, 'Invalid Request Board notification target');

  return {
    ok: true,
    payload: {
      type: 'notify',
      target_role: 'fc',
      recipient_binding: 'canonical_person_v1',
      target_id: targetId,
      title,
      body: message,
      category: category as RequestBoardNotifyCategory,
      target,
    },
  };
}

export function verifyBrowserSameOrigin(input: {
  origin?: string | null;
  referer?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
  requestUrl?: string | null;
}): PolicyFailure | { ok: true } {
  // `X-Forwarded-Host` is caller-controlled in some deployments. A canonical
  // Host header is required; forwarded host may be supplied for diagnostics
  // but is never accepted as the sole same-origin authority.
  const expectedHost = String(input.host ?? '').trim();
  const source = String(input.origin ?? '').trim() || String(input.referer ?? '').trim();
  const requestUrl = String(input.requestUrl ?? '').trim();
  if (!expectedHost || !source || !requestUrl) {
    return fail(403, 'Same-origin evidence is required');
  }

  try {
    const sourceUrl = new URL(source);
    const expectedUrl = new URL(requestUrl);
    if (
      (sourceUrl.protocol !== 'https:' && sourceUrl.protocol !== 'http:')
      || expectedUrl.host.toLowerCase() !== expectedHost.toLowerCase()
      || sourceUrl.origin.toLowerCase() !== expectedUrl.origin.toLowerCase()
    ) {
      return fail(403, 'Cross-origin request is not allowed');
    }
    return { ok: true };
  } catch {
    return fail(403, 'Invalid request origin');
  }
}

function buildInboxPayload(
  body: Record<string, unknown>,
  session: FcNotifyBrowserSession,
): PolicyResult<BrowserFcNotifyPayload> {
  let role: 'admin' | 'fc';
  let residentId: string | null;

  if (session.role === 'fc') {
    role = 'fc';
    residentId = session.residentDigits;
  } else if (session.role === 'manager' || session.staffType === 'developer') {
    role = 'admin';
    residentId = session.residentDigits;
  } else {
    role = 'admin';
    residentId = null;
  }

  if (
    hasMismatchedString(body, 'role', role)
    || hasMismatchedIdentity(body, 'resident_id', residentId)
  ) {
    return fail(403, 'Inbox identity does not match the verified session');
  }

  const requestedLimit = Number(body.limit ?? 80);
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 80, 200));
  return {
    ok: true,
    payload: {
      type: 'inbox_list',
      role,
      resident_id: residentId,
      limit,
      viewer_actor_role: session.role,
      viewer_actor_phone: session.residentDigits,
    },
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildInboxMutationPayload(
  body: Record<string, unknown>,
  session: FcNotifyBrowserSession,
): PolicyResult<BrowserFcNotifyPayload> {
  if (body.type !== 'inbox_mark_read' && body.type !== 'inbox_dismiss') {
    return fail(403, 'Inbox mutation is not allowed');
  }
  if (!Array.isArray(body.notification_ids) || body.notification_ids.length < 1 || body.notification_ids.length > 200) {
    return fail(400, 'Invalid notification ids');
  }
  const ids = body.notification_ids.map((value) =>
    typeof value === 'string' ? value.trim().toLowerCase() : '',
  );
  if (ids.some((id) => !UUID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
    return fail(400, 'Invalid notification ids');
  }
  return {
    ok: true,
    payload: {
      type: body.type,
      notification_ids: ids,
      viewer_actor_role: session.role,
      viewer_actor_phone: session.residentDigits,
    },
  };
}

function buildInboxGetPayload(
  body: Record<string, unknown>,
  session: FcNotifyBrowserSession,
): PolicyResult<BrowserFcNotifyPayload> {
  const notificationId =
    typeof body.notification_id === 'string' ? body.notification_id.trim().toLowerCase() : '';
  if (!UUID_PATTERN.test(notificationId)) return fail(400, 'Invalid notification id');
  return {
    ok: true,
    payload: {
      type: 'inbox_get',
      notification_id: notificationId,
      viewer_actor_role: session.role,
      viewer_actor_phone: session.residentDigits,
    },
  };
}

function buildResolveDirectConversationPayload(
  body: Record<string, unknown>,
  session: FcNotifyBrowserSession,
): PolicyResult<BrowserFcNotifyPayload> {
  const rawTargetId = typeof body.target_id === 'string' ? body.target_id.trim() : '';
  const rawConversationId =
    typeof body.conversation_id === 'string' ? body.conversation_id.trim().toLowerCase() : '';
  const targetId = rawTargetId ? rawTargetId : null;
  const conversationId = rawConversationId ? rawConversationId : null;

  if (Boolean(targetId) === Boolean(conversationId)) {
    return fail(400, 'Provide exactly one direct conversation identifier');
  }
  if (targetId && !PHONE_PATTERN.test(targetId)) {
    return fail(400, 'Invalid FC notification target');
  }
  if (conversationId && !UUID_PATTERN.test(conversationId)) {
    return fail(400, 'Invalid direct conversation id');
  }
  if (session.role === 'manager') {
    return fail(403, 'Read-only managers cannot resolve direct conversations');
  }
  return {
    ok: true,
    payload: {
      type: 'resolve_garamin_direct_conversation',
      target_id: targetId,
      conversation_id: conversationId,
      viewer_actor_role: session.role,
      viewer_actor_phone: session.residentDigits,
    },
  };
}

function buildDirectMessagePayload(
  body: Record<string, unknown>,
  session: FcNotifyBrowserSession,
): PolicyResult<BrowserFcNotifyPayload> {
  if (session.role === 'manager') {
    return fail(403, 'Read-only managers cannot access direct conversations');
  }
  const conversationId =
    typeof body.conversation_id === 'string' ? body.conversation_id.trim().toLowerCase() : '';
  if (!UUID_PATTERN.test(conversationId)) return fail(400, 'Invalid direct conversation id');
  const actor = {
    viewer_actor_role: session.role,
    viewer_actor_phone: session.residentDigits,
  };

  if (body.type === 'direct_message_list' || body.type === 'direct_message_mark_read') {
    return {
      ok: true,
      payload: {
        type: body.type,
        conversation_id: conversationId,
        ...actor,
      },
    };
  }
  if (body.type === 'direct_message_send') {
    const content = boundedSafeText(body.content, 4_000) ?? '';
    const clientMessageId =
      typeof body.client_message_id === 'string'
        ? body.client_message_id.trim().toLowerCase()
        : '';
    if (!UUID_PATTERN.test(clientMessageId)) {
      return fail(400, 'Invalid direct message client id');
    }
    const attachmentDelivery = parseAttachmentDelivery(body);
    if (!attachmentDelivery.ok) return attachmentDelivery;
    if (!content && attachmentDelivery.attachmentIntentIds.length === 0) {
      return fail(400, 'Invalid direct message content');
    }
    return {
      ok: true,
      payload: {
        type: 'direct_message_send',
        conversation_id: conversationId,
        client_message_id: clientMessageId,
        content,
        ...(attachmentDelivery.attachmentIntentIds.length
          ? {
              attachment_intent_ids: attachmentDelivery.attachmentIntentIds,
              delivery_key: attachmentDelivery.deliveryKey!,
              payload_fingerprint: attachmentDelivery.payloadFingerprint!,
            }
          : {}),
        ...actor,
      },
    };
  }
  if (body.type === 'direct_message_delete') {
    const messageId =
      typeof body.message_id === 'string' ? body.message_id.trim().toLowerCase() : '';
    if (!UUID_PATTERN.test(messageId)) return fail(400, 'Invalid direct message id');
    return {
      ok: true,
      payload: {
        type: 'direct_message_delete',
        conversation_id: conversationId,
        message_id: messageId,
        ...actor,
      },
    };
  }
  return fail(403, 'Direct message action is not allowed');
}

function parseAttachmentDelivery(body: Record<string, unknown>):
  | {
      ok: true;
      attachmentIntentIds: string[];
      deliveryKey: string | null;
      payloadFingerprint: string | null;
    }
  | PolicyFailure {
  const rawIds = body.attachment_intent_ids;
  const hasDeliveryMetadata =
    body.delivery_key !== undefined || body.payload_fingerprint !== undefined;
  if (rawIds === undefined) {
    return hasDeliveryMetadata
      ? fail(400, 'Attachment delivery metadata requires attachment intents')
      : {
          ok: true,
          attachmentIntentIds: [],
          deliveryKey: null,
          payloadFingerprint: null,
        };
  }
  if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 10) {
    return fail(400, 'Invalid attachment intent ids');
  }
  const attachmentIntentIds = rawIds.map((value) =>
    typeof value === 'string' ? value.trim().toLowerCase() : '',
  );
  const deliveryKey =
    typeof body.delivery_key === 'string' ? body.delivery_key.trim().toLowerCase() : '';
  const payloadFingerprint =
    typeof body.payload_fingerprint === 'string'
      ? body.payload_fingerprint.trim().toLowerCase()
      : '';
  if (
    attachmentIntentIds.some((id) => !UUID_PATTERN.test(id))
    || new Set(attachmentIntentIds).size !== attachmentIntentIds.length
    || !UUID_PATTERN.test(deliveryKey)
    || !/^[0-9a-f]{64}$/.test(payloadFingerprint)
  ) {
    return fail(400, 'Invalid attachment delivery metadata');
  }
  return {
    ok: true,
    attachmentIntentIds,
    deliveryKey,
    payloadFingerprint,
  };
}

function buildDirectMessageBroadcastPayload(
  body: Record<string, unknown>,
  session: FcNotifyBrowserSession,
): PolicyResult<BrowserFcNotifyPayload> {
  if (session.role !== 'admin') {
    return fail(403, 'Direct message broadcast is restricted to administrators');
  }
  if (!Array.isArray(body.conversation_ids) || !Array.isArray(body.client_message_ids)) {
    return fail(400, 'Invalid direct message broadcast targets');
  }
  const conversationIds = body.conversation_ids.map((value) =>
    typeof value === 'string' ? value.trim().toLowerCase() : '',
  );
  const clientMessageIds = body.client_message_ids.map((value) =>
    typeof value === 'string' ? value.trim().toLowerCase() : '',
  );
  if (
    conversationIds.length < 1
    || conversationIds.length > 200
    || clientMessageIds.length !== conversationIds.length
    || conversationIds.some((id) => !UUID_PATTERN.test(id))
    || clientMessageIds.some((id) => !UUID_PATTERN.test(id))
    || new Set(conversationIds).size !== conversationIds.length
    || new Set(clientMessageIds).size !== clientMessageIds.length
  ) {
    return fail(400, 'Invalid direct message broadcast targets');
  }
  const content = boundedSafeText(body.content, 4_000) ?? '';
  const attachmentDelivery = parseAttachmentDelivery(body);
  if (!attachmentDelivery.ok) return attachmentDelivery;
  if (!content && attachmentDelivery.attachmentIntentIds.length === 0) {
    return fail(400, 'Invalid direct message content');
  }
  return {
    ok: true,
    payload: {
      type: 'direct_message_broadcast_send',
      conversation_ids: conversationIds,
      client_message_ids: clientMessageIds,
      content,
      ...(attachmentDelivery.attachmentIntentIds.length
        ? {
            attachment_intent_ids: attachmentDelivery.attachmentIntentIds,
            delivery_key: attachmentDelivery.deliveryKey!,
            payload_fingerprint: attachmentDelivery.payloadFingerprint!,
          }
        : {}),
      viewer_actor_role: 'admin',
      viewer_actor_phone: session.residentDigits,
    },
  };
}

function buildUnreadPayload(
  body: Record<string, unknown>,
  session: FcNotifyBrowserSession,
): PolicyResult<BrowserFcNotifyPayload> {
  const isManager = session.role === 'manager';
  const isDeveloper = session.role === 'admin' && session.staffType === 'developer';
  const viewerRole: 'admin' | 'fc' = session.role === 'fc' ? 'fc' : 'admin';
  const viewerId = session.role === 'fc' || isManager || isDeveloper
    ? session.residentDigits
    : 'admin';
  const viewerStaffType = session.role === 'admin' ? session.staffType : null;
  const viewerReadOnly = isManager;

  if (
    hasMismatchedString(body, 'viewer_id', viewerId)
    || hasMismatchedString(body, 'viewer_role', viewerRole)
    || hasMismatchedString(body, 'viewer_staff_type', viewerStaffType)
    || hasMismatchedBoolean(body, 'viewer_read_only', viewerReadOnly)
    || hasMismatchedBoolean(body, 'viewer_is_request_board_designer', false)
  ) {
    return fail(403, 'Unread identity does not match the verified session');
  }

  return {
    ok: true,
    payload: {
      type: 'internal_unread_count',
      viewer_id: viewerId,
      viewer_role: viewerRole,
      viewer_staff_type: viewerStaffType,
      viewer_read_only: viewerReadOnly,
      viewer_is_request_board_designer: false,
    },
  };
}

function buildMessagePayload(
  body: Record<string, unknown>,
  session: FcNotifyBrowserSession,
): PolicyResult<BrowserFcNotifyPayload> {
  const message = boundedSafeText(body.message, 4_000);
  if (!message) return fail(400, 'Invalid FC message payload');

  if (session.role === 'fc') {
    if (
      body.target_role !== 'admin'
      || hasMismatchedIdentity(body, 'target_id', null)
    ) {
      return fail(403, 'FC messages may target only the shared admin conversation');
    }

    const senderId = session.residentDigits;
    const expectedSenderName = getWebStaffSenderName({
      role: session.role,
      residentId: session.residentDigits,
      displayName: session.displayName,
      staffType: session.staffType,
    });
    if (
      hasMismatchedString(body, 'sender_id', senderId)
      || hasMismatchedString(body, 'sender_name', expectedSenderName)
    ) {
      return fail(403, 'Message sender does not match the verified session');
    }

    return {
      ok: true,
      payload: {
        type: 'notify',
        target_role: 'admin',
        target_id: null,
        title: 'message',
        body: message,
        category: 'message',
        sender_id: senderId,
        sender_name: redactSensitiveText(expectedSenderName, 'FC'),
      },
    };
  }

  if (session.role !== 'admin' || (session.staffType !== 'admin' && session.staffType !== 'developer')) {
    return fail(403, 'Only admin staff can send FC notifications');
  }
  if (body.target_role !== 'fc') return fail(403, 'Message target role is not allowed');

  const targetId = typeof body.target_id === 'string' ? body.target_id.trim() : '';
  if (!PHONE_PATTERN.test(targetId) || !message) return fail(400, 'Invalid FC message payload');

  const isDeveloper = session.staffType === 'developer';
  const senderId = isDeveloper ? session.residentDigits : 'admin';
  const expectedSenderName = getWebStaffSenderName({
    role: session.role,
    residentId: session.residentDigits,
    displayName: session.displayName,
    staffType: session.staffType,
  });

  if (
    hasMismatchedString(body, 'sender_id', senderId)
    || hasMismatchedString(body, 'sender_name', expectedSenderName)
  ) {
    return fail(403, 'Message sender does not match the verified session');
  }

  return {
    ok: true,
    payload: {
      type: 'notify',
      target_role: 'fc',
      target_id: targetId,
      title: 'message',
      body: message,
      category: 'message',
      sender_id: senderId,
      sender_name: redactSensitiveText(expectedSenderName, isDeveloper ? '개발자' : '총무팀'),
    },
  };
}

function buildExamApprovalNotifyPayload(
  body: Record<string, unknown>,
  session: FcNotifyBrowserSession,
): PolicyResult<BrowserFcNotifyPayload> {
  if (
    session.role !== 'admin'
    || (session.staffType !== 'admin' && session.staffType !== 'developer')
  ) {
    return fail(403, 'Only writable admin staff can send exam approval notifications');
  }

  const targetId = typeof body.target_id === 'string' ? body.target_id.trim() : '';
  const examInfo = boundedSafeText(body.exam_info, 300);
  const examType = body.exam_type;
  const target = parseNotificationTargetV1(body.target);
  if (
    !PHONE_PATTERN.test(targetId)
    || typeof body.is_confirmed !== 'boolean'
    || !examInfo
    || (examType !== 'life' && examType !== 'nonlife')
    || target?.kind !== 'exam'
    || !('examRegistrationId' in target)
    || target.examType !== examType
  ) {
    return fail(400, 'Invalid exam approval notification payload');
  }

  const isConfirmed = body.is_confirmed;
  return {
    ok: true,
    payload: {
      type: 'notify',
      target_role: 'fc',
      target_id: targetId,
      title: isConfirmed
        ? '시험 신청이 승인되었습니다.'
        : '시험 신청 승인 상태가 변경되었습니다.',
      body: isConfirmed
        ? `${examInfo} 접수가 승인되었습니다. 시험 신청 화면에서 상태를 확인해주세요.`
        : `${examInfo} 접수 완료가 해제되었습니다. 시험 신청 화면에서 상태를 확인해주세요.`,
      category: 'exam_apply',
      url: examType === 'nonlife' ? '/exam-apply2' : '/exam-apply',
      target,
    },
  };
}

export function buildBrowserFcNotifyPayload(input: {
  body: unknown;
  session: FcNotifyBrowserSession;
}): PolicyResult<BrowserFcNotifyPayload> {
  const body = asRecord(input.body);
  if (!body) return fail(400, 'Invalid request body');

  if (body.type === 'inbox_list') return buildInboxPayload(body, input.session);
  if (body.type === 'inbox_get') return buildInboxGetPayload(body, input.session);
  if (body.type === 'inbox_mark_read' || body.type === 'inbox_dismiss') {
    return buildInboxMutationPayload(body, input.session);
  }
  if (body.type === 'internal_unread_count') return buildUnreadPayload(body, input.session);
  if (body.type === 'message') return buildMessagePayload(body, input.session);
  if (body.type === 'resolve_garamin_direct_conversation') {
    return buildResolveDirectConversationPayload(body, input.session);
  }
  if (
    body.type === 'direct_message_list'
    || body.type === 'direct_message_send'
    || body.type === 'direct_message_mark_read'
    || body.type === 'direct_message_delete'
  ) {
    return buildDirectMessagePayload(body, input.session);
  }
  if (body.type === 'direct_message_broadcast_send') {
    return buildDirectMessageBroadcastPayload(body, input.session);
  }
  if (body.type === 'exam_approval_notify') return buildExamApprovalNotifyPayload(body, input.session);
  return fail(403, 'FC notify action is not allowed');
}
