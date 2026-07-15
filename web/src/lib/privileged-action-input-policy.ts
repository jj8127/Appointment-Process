export type InputParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type ExamRoundSaveInput = {
  roundId: string | null;
  exam_date: string | null;
  registration_deadline: string;
  round_label: string;
  exam_type: 'life' | 'nonlife';
  notes: string | null;
  locations: string[];
};

export type ExamRoundDeleteInput = { roundId: string };

export type AppointmentActionInput =
  | {
      fcId: string;
      type: 'schedule';
      category: 'life' | 'nonlife';
      value: string;
      reason: null;
    }
  | {
      fcId: string;
      type: 'confirm';
      category: 'life' | 'nonlife';
      value: string;
      reason: null;
    }
  | {
      fcId: string;
      type: 'reject';
      category: 'life' | 'nonlife';
      value: null;
      reason: string;
    };

export type DocStatusActionInput = {
  fcId: string;
  docType: string;
  status: 'approved' | 'rejected' | 'pending';
  reason: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const EXAM_ROUND_LABEL_MAX_LENGTH = 120;
const EXAM_NOTES_MAX_LENGTH = 2000;
const EXAM_LOCATION_MAX_LENGTH = 120;
const EXAM_LOCATION_MAX_COUNT = 50;
const APPOINTMENT_VALUE_MAX_LENGTH = 200;
const REASON_MAX_LENGTH = 1000;
const DOC_TYPE_MAX_LENGTH = 120;

const fail = <T>(error: string): InputParseResult<T> => ({ ok: false, error });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const isValidIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

const parseBoundedString = (
  value: unknown,
  { label, maxLength, allowEmpty = false }: { label: string; maxLength: number; allowEmpty?: boolean },
): InputParseResult<string> => {
  if (typeof value !== 'string') {
    return fail(`${label} 형식이 올바르지 않습니다.`);
  }

  const normalized = value.trim();
  if (!allowEmpty && !normalized) {
    return fail(`${label}을(를) 입력해주세요.`);
  }
  if (normalized.length > maxLength) {
    return fail(`${label}은(는) ${maxLength}자 이하여야 합니다.`);
  }

  return { ok: true, value: normalized };
};

const parseOptionalBoundedString = (
  value: unknown,
  { label, maxLength }: { label: string; maxLength: number },
): InputParseResult<string | null> => {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  const parsed = parseBoundedString(value, { label, maxLength, allowEmpty: true });
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value || null };
};

export function parseExamRoundSaveInput(input: unknown): InputParseResult<ExamRoundSaveInput> {
  if (!isRecord(input)) {
    return fail('시험 일정 입력 형식이 올바르지 않습니다.');
  }

  let roundId: string | null = null;
  if (input.roundId !== undefined && input.roundId !== null) {
    if (!isUuid(input.roundId)) {
      return fail('시험 회차 ID 형식이 올바르지 않습니다.');
    }
    roundId = input.roundId;
  }

  let examDate: string | null = null;
  if (input.exam_date !== null) {
    if (!isValidIsoDate(input.exam_date)) {
      return fail('시험일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.');
    }
    examDate = input.exam_date;
  }

  if (!isValidIsoDate(input.registration_deadline)) {
    return fail('접수 마감일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.');
  }
  if (examDate && input.registration_deadline > examDate) {
    return fail('접수 마감일은 시험일보다 늦을 수 없습니다.');
  }

  const roundLabel = parseBoundedString(input.round_label, {
    label: '시험 회차명',
    maxLength: EXAM_ROUND_LABEL_MAX_LENGTH,
  });
  if (!roundLabel.ok) return roundLabel;

  if (input.exam_type !== 'life' && input.exam_type !== 'nonlife') {
    return fail('시험 유형이 올바르지 않습니다.');
  }

  const notes = parseOptionalBoundedString(input.notes, {
    label: '비고',
    maxLength: EXAM_NOTES_MAX_LENGTH,
  });
  if (!notes.ok) return notes;

  if (!Array.isArray(input.locations)) {
    return fail('시험 장소 형식이 올바르지 않습니다.');
  }
  if (input.locations.length < 1 || input.locations.length > EXAM_LOCATION_MAX_COUNT) {
    return fail(`시험 장소는 1개 이상 ${EXAM_LOCATION_MAX_COUNT}개 이하여야 합니다.`);
  }

  const normalizedLocations: string[] = [];
  for (const location of input.locations) {
    const parsedLocation = parseBoundedString(location, {
      label: '시험 장소',
      maxLength: EXAM_LOCATION_MAX_LENGTH,
    });
    if (!parsedLocation.ok) return parsedLocation;
    normalizedLocations.push(parsedLocation.value);
  }

  return {
    ok: true,
    value: {
      roundId,
      exam_date: examDate,
      registration_deadline: input.registration_deadline,
      round_label: roundLabel.value,
      exam_type: input.exam_type,
      notes: notes.value,
      locations: Array.from(new Set(normalizedLocations)),
    },
  };
}

export function parseExamRoundDeleteInput(input: unknown): InputParseResult<ExamRoundDeleteInput> {
  if (!isRecord(input) || !isUuid(input.roundId)) {
    return fail('시험 회차 ID 형식이 올바르지 않습니다.');
  }
  return { ok: true, value: { roundId: input.roundId } };
}

export function parseAppointmentActionInput(input: unknown): InputParseResult<AppointmentActionInput> {
  if (!isRecord(input)) {
    return fail('위촉 처리 입력 형식이 올바르지 않습니다.');
  }
  if (!isUuid(input.fcId)) {
    return fail('FC ID 형식이 올바르지 않습니다.');
  }
  if (input.category !== 'life' && input.category !== 'nonlife') {
    return fail('위촉 구분이 올바르지 않습니다.');
  }
  if (input.type !== 'schedule' && input.type !== 'confirm' && input.type !== 'reject') {
    return fail('위촉 처리 유형이 올바르지 않습니다.');
  }

  if (input.type === 'schedule') {
    if (input.reason !== undefined && input.reason !== null) {
      return fail('예정 정보 저장에는 반려 사유를 사용할 수 없습니다.');
    }
    const value = parseBoundedString(input.value, {
      label: '위촉 예정 정보',
      maxLength: APPOINTMENT_VALUE_MAX_LENGTH,
    });
    if (!value.ok) return value;
    return {
      ok: true,
      value: { fcId: input.fcId, type: input.type, category: input.category, value: value.value, reason: null },
    };
  }

  if (input.type === 'confirm') {
    if (input.reason !== undefined && input.reason !== null) {
      return fail('위촉 승인에는 반려 사유를 사용할 수 없습니다.');
    }
    if (!isValidIsoDate(input.value)) {
      return fail('위촉 확정일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.');
    }
    return {
      ok: true,
      value: { fcId: input.fcId, type: input.type, category: input.category, value: input.value, reason: null },
    };
  }

  if (input.value !== null) {
    return fail('위촉 반려 시 확정일 값은 비어 있어야 합니다.');
  }
  const reason = parseBoundedString(input.reason, {
    label: '반려 사유',
    maxLength: REASON_MAX_LENGTH,
  });
  if (!reason.ok) return reason;
  return {
    ok: true,
    value: { fcId: input.fcId, type: input.type, category: input.category, value: null, reason: reason.value },
  };
}

export function parseDocStatusActionInput(input: unknown): InputParseResult<DocStatusActionInput> {
  if (!isRecord(input)) {
    return fail('서류 처리 입력 형식이 올바르지 않습니다.');
  }
  if (!isUuid(input.fcId)) {
    return fail('FC ID 형식이 올바르지 않습니다.');
  }

  const docType = parseBoundedString(input.docType, {
    label: '서류 유형',
    maxLength: DOC_TYPE_MAX_LENGTH,
  });
  if (!docType.ok) return docType;

  if (input.status !== 'approved' && input.status !== 'rejected' && input.status !== 'pending') {
    return fail('서류 상태가 올바르지 않습니다.');
  }

  const reason = parseOptionalBoundedString(input.reason, {
    label: '검토 사유',
    maxLength: REASON_MAX_LENGTH,
  });
  if (!reason.ok) return reason;
  if (input.status === 'rejected' && !reason.value) {
    return fail('반려 사유를 입력해주세요.');
  }

  return {
    ok: true,
    value: {
      fcId: input.fcId,
      docType: docType.value,
      status: input.status,
      reason: reason.value,
    },
  };
}

export function parseFcNotificationPhone(input: unknown): InputParseResult<string> {
  if (typeof input !== 'string') {
    return fail('FC 전화번호를 확인할 수 없습니다.');
  }

  const normalizedInput = input.trim();
  if (!normalizedInput || !/^[0-9\s-]+$/.test(normalizedInput)) {
    return fail('FC 전화번호 형식이 올바르지 않습니다.');
  }

  const digits = normalizedInput.replace(/[^0-9]/g, '');
  if (digits.length !== 11) {
    return fail('FC 전화번호는 11자리여야 합니다.');
  }

  return { ok: true, value: digits };
}
