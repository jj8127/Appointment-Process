type PublicBoardError = {
  message: string;
  status: number;
};

const BOARD_PUBLIC_ERRORS: Record<string, PublicBoardError> = {
  invalid_json: { message: '요청 내용을 확인해주세요.', status: 400 },
  invalid_payload: { message: '입력 내용을 확인해주세요.', status: 400 },
  invalid_pagination: { message: '게시글 조회 조건을 확인해주세요.', status: 400 },
  invalid_category: { message: '게시판 분류를 확인해주세요.', status: 400 },
  invalid_title: { message: '제목을 확인해주세요.', status: 400 },
  invalid_content: { message: '내용을 확인해주세요.', status: 400 },
  invalid_attachment_order: { message: '첨부 파일 순서를 확인해주세요.', status: 400 },
  invalid_attachment: { message: '첨부 파일을 확인해주세요.', status: 400 },
  invalid_file: { message: '첨부 파일 정보를 확인해주세요.', status: 400 },
  file_limit: { message: '첨부 파일 개수 또는 크기를 확인해주세요.', status: 400 },
  file_total_limit: { message: '첨부 파일 전체 크기를 확인해주세요.', status: 400 },
  invalid_storage_path: { message: '첨부 파일 경로를 확인해주세요.', status: 400 },
  invalid_storage_object: { message: '첨부 파일을 확인해주세요.', status: 400 },
  duplicate_attachment: { message: '이미 처리된 첨부 파일입니다.', status: 409 },
  invalid_request_id: { message: '요청을 다시 시도해주세요.', status: 400 },
  not_found: { message: '대상을 찾을 수 없습니다.', status: 404 },
  forbidden: { message: '요청 권한이 없습니다.', status: 403 },
  automation_forbidden: { message: '허용되지 않은 자동화 요청입니다.', status: 403 },
  stale_notification_event: { message: '알림 재시도 시간이 지났습니다.', status: 409 },
  method_not_allowed: { message: '허용되지 않은 요청입니다.', status: 405 },
  actor_mismatch: { message: '세션 정보를 다시 확인해주세요.', status: 403 },
  invalid_session_actor: { message: '세션 정보를 다시 확인해주세요.', status: 403 },
  missing_app_session: { message: '게시판을 사용하려면 다시 로그인해주세요.', status: 401 },
  invalid_app_session: { message: '세션이 유효하지 않습니다. 다시 로그인해주세요.', status: 401 },
  expired_app_session: { message: '세션이 만료되었습니다. 다시 로그인해주세요.', status: 401 },
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

export function sanitizeBoardUpstreamError(
  value: unknown,
  upstreamStatus?: number,
): {
  body: { ok: false; code: string; message: string };
  status: number;
  upstreamCode: string | null;
} {
  const upstreamCode = isRecord(value) && typeof value.code === 'string'
    ? value.code
    : null;
  const publicError = upstreamCode ? BOARD_PUBLIC_ERRORS[upstreamCode] : undefined;
  const resolvedStatus = Number.isSafeInteger(upstreamStatus)
    ? Number(upstreamStatus)
    : publicError?.status ?? 502;

  if (resolvedStatus >= 500 || resolvedStatus < 400) {
    return {
      body: {
        ok: false,
        code: 'board_upstream_failed',
        message: '게시판 요청을 처리하지 못했습니다.',
      },
      status: 502,
      upstreamCode,
    };
  }

  if (!upstreamCode || !publicError) {
    return {
      body: {
        ok: false,
        code: 'board_upstream_rejected',
        message: '게시판 요청을 처리하지 못했습니다.',
      },
      status: resolvedStatus,
      upstreamCode,
    };
  }

  return {
    body: { ok: false, code: upstreamCode, message: publicError.message },
    status: resolvedStatus,
    upstreamCode,
  };
}
