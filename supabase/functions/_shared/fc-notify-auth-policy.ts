export type FcNotifyAppActor = {
  sessionRole: 'admin' | 'manager' | 'fc';
  phone: string;
  displayName: string | null;
  staffType: 'admin' | 'developer' | null;
  fcId: string | null;
  isRequestBoardDesigner: boolean;
};

export type FcNotifyTargetRole = 'admin' | 'fc';
export type FcNotifyDeviceTokenRole = 'admin' | 'manager' | 'fc';

const ADMIN_NOTIFICATION_TOKEN_ROLES = ['admin', 'manager'] as const;
const FC_NOTIFICATION_TOKEN_ROLES = ['fc'] as const;
const REQUEST_BOARD_FC_NOTIFICATION_TOKEN_ROLES = ['fc', 'manager'] as const;

type PolicySuccess = { ok: true; payload: Record<string, unknown> };
type PolicyFailure = { ok: false; status: 400 | 401 | 403; error: string };
export type FcNotifyAppPolicyResult = PolicySuccess | PolicyFailure;

const SECRET_ASSIGNMENT_PATTERN =
  /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ROLE_KEY|AUTH_TOKEN|API_KEY)\b\s*=\s*[^\s"'`<>]+/gi;
const LONG_HEX_TOKEN_PATTERN = /\b[a-f0-9]{32,}\b/gi;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function deny(error: string, status: 400 | 401 | 403 = 403): PolicyFailure {
  return { ok: false, status, error };
}

function sanitizePhone(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^0-9]/g, '') : '';
}

export function getAllowedNotificationTokenRoles(
  targetRole: FcNotifyTargetRole,
  category?: string | null,
): readonly FcNotifyDeviceTokenRole[] {
  if (targetRole === 'admin') return ADMIN_NOTIFICATION_TOKEN_ROLES;

  // Request Board designers keep the FC inbox contract, but their mobile
  // device is registered with the concrete manager role. This exception is
  // limited to Request Board categories; the caller still scopes by the exact
  // resident id before the existing manager-delivery policy is applied.
  return String(category ?? '').trim().toLowerCase().startsWith('request_board_')
    ? REQUEST_BOARD_FC_NOTIFICATION_TOKEN_ROLES
    : FC_NOTIFICATION_TOKEN_ROLES;
}

export function shouldRequireActiveStaffNotificationTarget(input: {
  actorSessionRole: FcNotifyAppActor['sessionRole'];
  targetRole: FcNotifyTargetRole;
  category?: string | null;
  targetId?: string | null;
}): boolean {
  const isDirectMessage = String(input.category ?? '').trim().toLowerCase() === 'message'
    && sanitizePhone(input.targetId).length === 11;

  return isDirectMessage && (
    (input.actorSessionRole === 'fc' && input.targetRole === 'admin')
    || (input.actorSessionRole === 'admin' && input.targetRole === 'fc')
  );
}

function safeText(value: unknown, maxLength: number, fallback = ''): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const redacted = (normalized || fallback)
    .replace(SECRET_ASSIGNMENT_PATTERN, (match) => {
      const key = match.split('=')[0]?.trim() || 'SECRET';
      return `${key}=[redacted]`;
    })
    .replace(LONG_HEX_TOKEN_PATTERN, '[redacted]')
    .trim();
  let bounded = redacted.slice(0, maxLength);
  if (/[\uD800-\uDBFF]$/.test(bounded)) bounded = bounded.slice(0, -1);
  return bounded;
}

function safeRelativeUrl(value: unknown, fallback: string): string | null {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (
    !normalized.startsWith('/')
    || normalized.startsWith('//')
    || normalized.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(normalized)
    || normalized.length > 500
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

function constantTimeTextEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

export function isTrustedFcNotifyServiceKey(
  providedApiKey: string | null | undefined,
  expectedServiceKey: string | null | undefined,
): boolean {
  const provided = providedApiKey?.trim() ?? '';
  const expected = expectedServiceKey?.trim() ?? '';
  return Boolean(provided && expected && constantTimeTextEqual(provided, expected));
}

function getActorScope(actor: FcNotifyAppActor) {
  const phone = sanitizePhone(actor.phone);
  const role = actor.sessionRole === 'fc' ? 'fc' as const : 'admin' as const;
  const personalAdmin = actor.sessionRole === 'manager' || actor.staffType === 'developer';
  const residentId = role === 'fc' || personalAdmin ? phone : null;
  const viewerId = actor.sessionRole === 'admin' && actor.staffType !== 'developer'
    ? 'admin'
    : phone;
  return {
    phone,
    role,
    residentId,
    viewerId,
    viewerRole: role,
    viewerStaffType: actor.sessionRole === 'admin' ? actor.staffType : null,
    viewerReadOnly: actor.sessionRole === 'manager',
    viewerIsRequestBoardDesigner: actor.isRequestBoardDesigner,
  };
}

function matchesRoleClaim(body: Record<string, unknown>, expectedRole: 'admin' | 'fc'): boolean {
  return body.role === undefined || body.role === expectedRole;
}

function matchesResidentClaim(body: Record<string, unknown>, expectedResidentId: string | null): boolean {
  if (body.resident_id === undefined) return true;
  const supplied = sanitizePhone(body.resident_id);
  return expectedResidentId === null ? supplied.length === 0 : supplied === expectedResidentId;
}

function matchesViewerClaims(
  body: Record<string, unknown>,
  scope: ReturnType<typeof getActorScope>,
): boolean {
  if (body.viewer_id !== undefined && String(body.viewer_id ?? '').trim() !== scope.viewerId) return false;
  if (body.viewer_role !== undefined && body.viewer_role !== scope.viewerRole) return false;
  if (
    body.viewer_staff_type !== undefined
    && (body.viewer_staff_type ?? null) !== scope.viewerStaffType
  ) return false;
  if (body.viewer_read_only !== undefined && body.viewer_read_only !== scope.viewerReadOnly) return false;
  if (
    body.viewer_is_request_board_designer !== undefined
    && body.viewer_is_request_board_designer !== scope.viewerIsRequestBoardDesigner
  ) return false;
  return true;
}

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((item) => item.slice(0, 160)),
  ));
}

function buildInboxPayload(
  type: 'inbox_list' | 'inbox_unread_count' | 'inbox_delete',
  body: Record<string, unknown>,
  actor: FcNotifyAppActor,
): FcNotifyAppPolicyResult {
  const scope = getActorScope(actor);
  if (!scope.phone || !matchesRoleClaim(body, scope.role) || !matchesResidentClaim(body, scope.residentId)) {
    return deny('Notification inbox actor does not match the signed session');
  }

  const includeRequestBoardFc = scope.role === 'admin'
    && Boolean(scope.residentId)
    && body.include_request_board_fc === true;

  if (type === 'inbox_list') {
    const limit = Math.max(1, Math.min(Number(body.limit ?? 80) || 80, 200));
    const onlyRequestBoardCategories =
      actor.isRequestBoardDesigner || body.only_request_board_categories === true;
    return {
      ok: true,
      payload: {
        type,
        role: scope.role,
        resident_id: scope.residentId,
        limit,
        include_request_board_fc: includeRequestBoardFc,
        only_request_board_categories: onlyRequestBoardCategories,
      },
    };
  }

  if (type === 'inbox_unread_count') {
    return {
      ok: true,
      payload: {
        type,
        role: scope.role,
        resident_id: scope.residentId,
        since: typeof body.since === 'string' ? body.since.slice(0, 64) : null,
        include_request_board_fc: includeRequestBoardFc,
        exclude_request_board_categories: body.exclude_request_board_categories === true,
        include_notices: actor.isRequestBoardDesigner ? false : body.include_notices === true,
        only_request_board_categories:
          actor.isRequestBoardDesigner || body.only_request_board_categories === true,
      },
    };
  }

  const noticeIds = cleanIds(body.notice_ids);
  if ((actor.sessionRole === 'manager' || actor.sessionRole === 'fc') && noticeIds.length > 0) {
    return deny('This session cannot delete shared notices');
  }
  return {
    ok: true,
    payload: {
      type,
      role: scope.role,
      resident_id: scope.residentId,
      notification_ids: cleanIds(body.notification_ids),
      notice_ids: actor.sessionRole === 'admin' ? noticeIds : [],
      include_request_board_fc: includeRequestBoardFc,
    },
  };
}

function buildNotifyPayload(
  body: Record<string, unknown>,
  actor: FcNotifyAppActor,
): FcNotifyAppPolicyResult {
  if (actor.sessionRole === 'manager' || actor.isRequestBoardDesigner) {
    return deny('This session cannot send notifications');
  }

  const expectedTargetRole = actor.sessionRole === 'admin' ? 'fc' : 'admin';
  if (body.target_role !== expectedTargetRole) {
    return deny('Notification target role is not allowed for this session');
  }

  const category = safeText(body.category, 120, 'app_event');
  const rawTarget = String(body.target_id ?? '').trim();
  let targetId: string | null;
  if (expectedTargetRole === 'admin' && category !== 'message') {
    // FC workflow events belong to the shared admin inbox. Only direct chat may
    // address one concrete staff recipient.
    targetId = null;
  } else if (expectedTargetRole === 'admin' && (!rawTarget || rawTarget.toLowerCase() === 'admin')) {
    targetId = null;
  } else if (!rawTarget && actor.sessionRole === 'admin') {
    targetId = null;
  } else {
    const digits = sanitizePhone(rawTarget);
    if (digits.length !== 11) return deny('Notification target is invalid', 400);
    targetId = digits;
  }

  const title = safeText(body.title, 120);
  const message = safeText(body.body, 2_000);
  if (!title || !message) return deny('Notification content is required', 400);
  const url = safeRelativeUrl(body.url, '/notifications');
  if (!url) return deny('Notification URL must be an internal relative path', 400);

  const scope = getActorScope(actor);
  const payload: Record<string, unknown> = {
    type: 'notify',
    target_role: expectedTargetRole,
    target_id: targetId,
    title,
    body: message,
    category,
    url,
    sender_id: scope.viewerId,
    sender_name: safeText(actor.displayName, 120, actor.sessionRole === 'fc' ? 'FC' : '관리자'),
    skip_notification_insert: actor.sessionRole === 'admin' && body.skip_notification_insert === true,
  };
  if (actor.sessionRole === 'fc' && actor.fcId) payload.fc_id = actor.fcId;
  return { ok: true, payload };
}

export function buildAppFcNotifyPayload(
  rawBody: unknown,
  actor: FcNotifyAppActor,
): FcNotifyAppPolicyResult {
  const body = asRecord(rawBody);
  if (!body || typeof body.type !== 'string') return deny('Invalid notification payload', 400);
  const scope = getActorScope(actor);
  if (scope.phone.length !== 11) return deny('Invalid signed session actor', 401);

  if (body.type === 'inbox_list' || body.type === 'inbox_unread_count' || body.type === 'inbox_delete') {
    return buildInboxPayload(body.type, body, actor);
  }

  if (body.type === 'chat_targets') {
    if (actor.sessionRole !== 'fc' || actor.isRequestBoardDesigner) {
      return deny('Chat targets are available only to an eligible FC session');
    }
    if (body.resident_id !== undefined && sanitizePhone(body.resident_id) !== scope.phone) {
      return deny('Chat target actor does not match the signed session');
    }
    return { ok: true, payload: { type: 'chat_targets', resident_id: scope.phone } };
  }

  if (body.type === 'internal_chat_list' || body.type === 'internal_unread_count') {
    if (body.type === 'internal_chat_list' && actor.sessionRole === 'fc') {
      return deny('Internal chat list is not allowed for this session');
    }
    if (!matchesViewerClaims(body, scope)) {
      return deny('Internal chat actor does not match the signed session');
    }
    return {
      ok: true,
      payload: {
        type: body.type,
        viewer_id: scope.viewerId,
        viewer_role: scope.viewerRole,
        viewer_staff_type: scope.viewerStaffType,
        viewer_read_only: scope.viewerReadOnly,
        viewer_is_request_board_designer: scope.viewerIsRequestBoardDesigner,
      },
    };
  }

  if (body.type === 'notify') return buildNotifyPayload(body, actor);

  if (body.type === 'fc_update') {
    if (
      actor.sessionRole !== 'fc'
      || actor.isRequestBoardDesigner
      || !actor.fcId
      || String(body.fc_id ?? '').trim() !== actor.fcId
    ) {
      return deny('FC update does not match the signed FC profile');
    }
    const message = safeText(body.message, 2_000);
    return {
      ok: true,
      payload: {
        type: 'fc_update',
        fc_id: actor.fcId,
        ...(message ? { message } : {}),
      },
    };
  }

  return deny('This action is available only to a trusted internal caller');
}
