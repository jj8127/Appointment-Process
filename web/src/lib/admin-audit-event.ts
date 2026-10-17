// Shared shape of admin_audit_events rows. Stores who, when, which target and which action;
// never resident numbers, decrypted values or free-form field values.

export type AdminAuditCategory = 'fc_action' | 'export' | 'personal_info_view';

export type AdminAuditActor = {
  role: 'admin' | 'manager';
  staffType: 'admin' | 'developer' | null;
  residentDigits: string;
};

type DetailValue = string | number | boolean | null | string[];

export type AdminAuditEventInput = {
  category: AdminAuditCategory;
  action: string;
  targetFcId?: string | null;
  targetCount?: number;
  detail?: Record<string, DetailValue>;
  reason?: string | null;
};

export type AdminAuditRow = {
  actor_role: 'admin' | 'manager';
  actor_staff_type: 'admin' | 'developer' | null;
  actor_phone: string;
  category: AdminAuditCategory;
  action: string;
  target_fc_id: string | null;
  target_count: number;
  detail: Record<string, DetailValue>;
  reason: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESIDENT_NUMBER_PATTERN = /[0-9]{6}-?[1-8][0-9]{6}/;

/** Converts an admin-fc API action name to the stored snake_case action. */
export function toAuditAction(action: string): string {
  return action.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, '');
}

export function buildAdminAuditRow(actor: AdminAuditActor, event: AdminAuditEventInput): AdminAuditRow {
  const phone = actor.residentDigits.replace(/[^0-9]/g, '');
  if (!/^[0-9]{9,11}$/.test(phone)) throw new Error('admin_audit_invalid_actor');
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(event.action)) throw new Error('admin_audit_invalid_action');
  const targetFcId = event.targetFcId && UUID_PATTERN.test(event.targetFcId) ? event.targetFcId : null;
  const detail = event.detail ?? {};
  if (RESIDENT_NUMBER_PATTERN.test(JSON.stringify(detail))) throw new Error('admin_audit_detail_rejected');
  const reason = event.reason?.trim() || null;
  if (reason && (reason.length > 200 || RESIDENT_NUMBER_PATTERN.test(reason))) throw new Error('admin_audit_reason_rejected');
  return {
    actor_role: actor.role,
    actor_staff_type: actor.role === 'admin' ? actor.staffType ?? 'admin' : null,
    actor_phone: phone,
    category: event.category,
    action: event.action,
    target_fc_id: targetFcId,
    target_count: Math.max(0, Math.trunc(event.targetCount ?? (targetFcId ? 1 : 0))),
    detail,
    reason,
  };
}

// Payload keys whose values are short codes, not personal data.
const SAFE_FC_ACTION_KEYS = ['status', 'docType', 'type', 'category', 'step'] as const;

/** Keeps action codes and the names (not values) of edited fields. */
export function summarizeFcActionPayload(payload: unknown): Record<string, DetailValue> {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  const detail: Record<string, DetailValue> = {};
  for (const key of SAFE_FC_ACTION_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.length <= 64 && !RESIDENT_NUMBER_PATTERN.test(value)) detail[key] = value;
  }
  const data = record.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    detail.fields = Object.keys(data).filter((key) => /^[a-z_][a-z0-9_]{0,63}$/i.test(key)).sort();
  }
  return detail;
}

export const ADMIN_AUDIT_CATEGORY_LABELS: Record<AdminAuditCategory, string> = {
  fc_action: '처리',
  export: '엑셀 다운로드',
  personal_info_view: '개인정보 조회',
};

export const ADMIN_AUDIT_ACTION_LABELS: Record<string, string> = {
  update_profile: '기본정보 수정',
  update_status: '단계 변경',
  update_allowance_date: '보증보험 동의일 저장',
  update_hanwha_submission_date: '다위촉 완료일 저장',
  mark_dawichok_url_sent: '다위촉 URL 전송',
  update_appointment_date: '위촉 일정·완료일 저장',
  update_docs_request: '서류 요청 변경',
  update_doc_status: '서류 승인·반려',
  delete_doc_file: '서류 파일 삭제',
  retry_document_cleanup: '서류 정리 재시도',
  delete_hanwha_pdf: '다위촉 PDF 삭제',
  send_reminder: '알림 재발송',
  appointment_decision: '위촉 처리',
  document_decision: '서류 처리',
  notice_create: '공지 등록',
  notice_update: '공지 수정',
  exam_confirmed: '시험 접수 완료',
  exam_unconfirmed: '시험 미접수 변경',
  exam_rejected: '시험 신청 반려',
  exam_cancelled_by_admin: '시험 신청 관리자 취소',
  exam_applicants_xlsx: '시험 신청자 엑셀',
  resident_number_view: '주민번호 조회',
};

export const EXPORT_REASONS = ['협회 시험 접수', '내부 업무 보고', '응시료 정산', '기타 업무'] as const;

/** Converts YYYY-MM (Korea time) to an inclusive-exclusive UTC range. */
export function monthRange(month: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const from = new Date(Date.UTC(year, monthIndex, 1) - 9 * 3600_000);
  const to = new Date(Date.UTC(year, monthIndex + 1, 1) - 9 * 3600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** One-line description of an audit row's detail for the history table. */
export function describeAuditDetail(item: {
  category: AdminAuditCategory;
  targetCount: number;
  detail: Record<string, unknown>;
  reason: string | null;
}): string {
  const detail = item.detail ?? {};
  const text = (key: string) => (typeof detail[key] === 'string' ? (detail[key] as string) : null);
  if (item.category === 'export') return [`${item.targetCount}명`, item.reason].filter(Boolean).join(' · ');
  if (item.category === 'personal_info_view') {
    const source = text('source') === 'exam_applicants' ? '시험 신청자 목록' : '대시보드';
    return `${item.targetCount}명 · ${source}`;
  }
  const parts: string[] = [];
  const from = text('from');
  const to = text('to');
  if (from || to) parts.push(`${from ?? '-'} → ${to ?? '-'}`);
  for (const key of ['docType', 'status', 'type', 'category']) {
    const value = text(key);
    if (value) parts.push(value);
  }
  if (Array.isArray(detail.fields) && detail.fields.length > 0) parts.push(`항목: ${detail.fields.join(', ')}`);
  if (item.reason) parts.push(`사유: ${item.reason}`);
  return parts.join(' · ') || '-';
}
