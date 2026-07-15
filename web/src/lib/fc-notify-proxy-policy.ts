import { createHash, timingSafeEqual } from 'node:crypto';

import { containsSensitiveText, redactSensitiveText } from './sensitive-text';
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
type BrowserAction = 'inbox_list' | 'internal_unread_count' | 'message' | 'exam_approval_notify';
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
  target_id: string;
  title: string;
  body: string;
  category: RequestBoardNotifyCategory;
  url: string;
};

export type BrowserFcNotifyPayload =
  | {
      type: 'inbox_list';
      role: 'admin' | 'fc';
      resident_id: string | null;
      limit: number;
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
      type: 'message';
      target_role: 'fc';
      target_id: string;
      message: string;
      sender_id: string;
      sender_name: string;
    }
  | {
      type: 'message';
      target_role: 'admin';
      target_id: null;
      message: string;
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
  'internal_unread_count',
  'message',
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
  const title = boundedSafeText(body.title, 120);
  const message = boundedSafeText(body.body, 2_000);
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const url = normalizeRelativeUrl(body.url);

  if (!PHONE_PATTERN.test(targetId)) return fail(400, 'Invalid FC notification target');
  if (!title || !message) return fail(400, 'Invalid notification content');
  if (!requestBoardCategories.has(category)) return fail(403, 'Request Board category is not allowed');
  if (!url) return fail(400, 'Invalid notification URL');

  return {
    ok: true,
    payload: {
      type: 'notify',
      target_role: 'fc',
      target_id: targetId,
      title,
      body: message,
      category: category as RequestBoardNotifyCategory,
      url,
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
  const requestedRole = body.role;
  let role: 'admin' | 'fc';
  let residentId: string | null;

  if (session.role === 'fc') {
    role = 'fc';
    residentId = session.residentDigits;
  } else if (session.role === 'manager' || session.staffType === 'developer') {
    if (requestedRole !== 'admin' && requestedRole !== 'fc') {
      return fail(403, 'Inbox role is not allowed');
    }
    role = requestedRole;
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
        type: 'message',
        target_role: 'admin',
        target_id: null,
        message,
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
      type: 'message',
      target_role: 'fc',
      target_id: targetId,
      message,
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
  if (
    !PHONE_PATTERN.test(targetId)
    || typeof body.is_confirmed !== 'boolean'
    || !examInfo
    || (examType !== 'life' && examType !== 'nonlife')
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
  if (body.type === 'internal_unread_count') return buildUnreadPayload(body, input.session);
  if (body.type === 'message') return buildMessagePayload(body, input.session);
  if (body.type === 'exam_approval_notify') return buildExamApprovalNotifyPayload(body, input.session);
  return fail(403, 'FC notify action is not allowed');
}
