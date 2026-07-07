export type GroupChatErrorSeverity = 'error' | 'warning';

export type GroupChatUserError = {
  title: string;
  message: string;
  severity: GroupChatErrorSeverity;
  color: 'red' | 'orange' | 'yellow';
  code?: string;
  status?: number;
};

export class GroupChatRequestError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly raw?: unknown;

  constructor(message: string, options: { code?: string; status?: number; raw?: unknown } = {}) {
    super(message);
    this.name = 'GroupChatRequestError';
    this.code = options.code;
    this.status = options.status;
    this.raw = options.raw;
  }
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeCode(value: unknown) {
  return readString(value)?.toLowerCase().replace(/[\s-]+/g, '_');
}

function extractGroupChatError(input: unknown) {
  const record = input && typeof input === 'object'
    ? input as Record<string, unknown>
    : {};
  const context = record.context && typeof record.context === 'object'
    ? record.context as Record<string, unknown>
    : {};

  return {
    message: input instanceof Error ? input.message : readString(input),
    code: normalizeCode(record.code),
    status: readNumber(record.status)
      ?? readNumber(context.status)
      ?? readNumber((context.response as { status?: unknown } | undefined)?.status),
  };
}

function hasAny(value: string, needles: string[]) {
  const lower = value.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

function makeError(input: {
  title: string;
  message: string;
  severity?: GroupChatErrorSeverity;
  color?: GroupChatUserError['color'];
  code?: string;
  status?: number;
}): GroupChatUserError {
  const severity = input.severity ?? 'error';
  return {
    title: input.title,
    message: input.message,
    severity,
    color: input.color ?? (severity === 'warning' ? 'orange' : 'red'),
    code: input.code,
    status: input.status,
  };
}

export function classifyGroupChatError(input: unknown): GroupChatUserError {
  const { message = '', code, status } = extractGroupChatError(input);
  const normalizedMessage = message.trim();

  if (
    code === 'invalid_app_session'
    || code === 'expired_app_session'
    || code === 'missing_app_session'
    || code === 'invalid_session'
    || status === 401
  ) {
    return makeError({
      title: '단톡방 세션 확인 필요',
      message: '로그인 또는 단톡방 세션이 만료되었습니다. 다시 로그인한 뒤 이용해주세요.',
      severity: 'warning',
      code,
      status,
    });
  }

  if (code === 'not_completed' || hasAny(normalizedMessage, ['본등록', 'signup_completed'])) {
    return makeError({
      title: '본등록 완료 후 이용 가능',
      message: '서버 장애가 아니라 참여 조건 제한입니다. 본등록이 완료된 계정만 가람PA 단톡방에 참여할 수 있습니다.',
      severity: 'warning',
      code,
      status,
    });
  }

  if (code === 'request_board_designer_only' || code === 'manager_referral_shadow') {
    return makeError({
      title: '단톡방 참여 대상 아님',
      message: '서버 장애가 아니라 참여 대상 제한입니다. 설계요청 전용 계정은 가람PA 단톡방에 참여할 수 없습니다.',
      severity: 'warning',
      code,
      status,
    });
  }

  if (code === 'inactive_account') {
    return makeError({
      title: '비활성 계정',
      message: '서버 장애가 아니라 계정 상태 제한입니다. 비활성화된 계정은 단톡방에 참여할 수 없습니다.',
      severity: 'warning',
      code,
      status,
    });
  }

  if (code === 'send_forbidden' || hasAny(normalizedMessage, ['채팅 권한', '발언 권한'])) {
    return makeError({
      title: '발언 권한 제한',
      message: normalizedMessage || '현재 발언 권한이 꺼져 있습니다. 총무 또는 본부장에게 권한을 요청해주세요.',
      severity: 'warning',
      code,
      status,
    });
  }

  if (status === 403 || code === 'forbidden') {
    const actionOnly = normalizedMessage && !hasAny(normalizedMessage, ['참여할 수 없는', 'participate']);
    return makeError({
      title: actionOnly ? '단톡방 권한 없음' : '단톡방 참여 제한',
      message: actionOnly
        ? normalizedMessage
        : '서버 장애가 아니라 참여 조건 제한입니다. 본등록 완료, 활성 계정 여부, 단톡방 대상 여부를 확인해주세요.',
      severity: 'warning',
      code,
      status,
    });
  }

  if (status === 429 || code === 'rate_limited') {
    return makeError({
      title: '잠시 후 다시 시도',
      message: '요청이 짧은 시간에 너무 많았습니다. 잠시 후 다시 시도해주세요.',
      severity: 'warning',
      code,
      status,
    });
  }

  if (status === 400 || code === 'invalid_payload' || code === 'invalid_json') {
    return makeError({
      title: '요청 내용 확인 필요',
      message: normalizedMessage || '요청 내용이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해주세요.',
      severity: 'warning',
      code,
      status,
    });
  }

  if (status === 404 || code === 'not_found' || code === 'group_chat_account_not_found') {
    return makeError({
      title: '단톡방 계정 확인 필요',
      message: normalizedMessage || '단톡방에 연결할 계정을 찾을 수 없습니다. 로그인 계정을 확인해주세요.',
      severity: 'warning',
      code,
      status,
    });
  }

  if (
    (typeof status === 'number' && status >= 500)
    || code === 'db_error'
    || code === 'group_chat_proxy_failed'
    || code === 'missing_group_chat_config'
    || hasAny(normalizedMessage, ['failed to fetch', 'networkerror', 'load failed'])
  ) {
    return makeError({
      title: '단톡방 서버 오류',
      message: '단톡방 서버 또는 네트워크 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
      code,
      status,
    });
  }

  return makeError({
    title: '단톡방 처리 실패',
    message: normalizedMessage || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
    code,
    status,
  });
}
