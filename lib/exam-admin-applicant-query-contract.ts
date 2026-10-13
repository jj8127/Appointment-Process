import type { ExamFlowType } from './exam-flow-contract';

export type ExamAdminRoundRef = {
  exam_type: ExamFlowType;
  exam_date: string | null;
  round_label: string | null;
};

export type ExamAdminLocationRef = {
  location_name: string | null;
};

export type ExamAdminRegistrationRow = {
  id: string;
  resident_id: string;
  status: string;
  is_confirmed: boolean | null;
  includes_primary_exam: boolean | null;
  is_third_exam: boolean | null;
  fee_paid_date: string | null;
  rejection_reason: string | null;
  created_at: string;
  exam_rounds: ExamAdminRoundRef | ExamAdminRoundRef[];
  exam_locations: ExamAdminLocationRef | ExamAdminLocationRef[] | null;
};

export type ExamAdminFcProfileRow = {
  id: string;
  name: string | null;
  address: string | null;
  phone: string;
  affiliation: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isNullableString = (value: unknown): value is string | null => (
  value === null || typeof value === 'string'
);

const isNullableBoolean = (value: unknown): value is boolean | null => (
  value === null || typeof value === 'boolean'
);

const isRound = (value: unknown): value is ExamAdminRoundRef => (
  isRecord(value)
  && (value.exam_type === 'life' || value.exam_type === 'nonlife')
  && isNullableString(value.exam_date)
  && isNullableString(value.round_label)
);

const isLocation = (value: unknown): value is ExamAdminLocationRef => (
  isRecord(value) && isNullableString(value.location_name)
);

export const isExamAdminRegistrationRow = (value: unknown): value is ExamAdminRegistrationRow => (
  isRecord(value)
  && typeof value.id === 'string'
  && value.id.trim().length > 0
  && typeof value.resident_id === 'string'
  && value.resident_id.trim().length > 0
  && typeof value.status === 'string'
  && isNullableBoolean(value.is_confirmed)
  && isNullableBoolean(value.includes_primary_exam)
  && isNullableBoolean(value.is_third_exam)
  && isNullableString(value.fee_paid_date)
  && isNullableString(value.rejection_reason)
  && typeof value.created_at === 'string'
  && (isRound(value.exam_rounds)
    || (Array.isArray(value.exam_rounds)
      && value.exam_rounds.length === 1
      && isRound(value.exam_rounds[0])))
  && (value.exam_locations === null
    || isLocation(value.exam_locations)
    || (Array.isArray(value.exam_locations)
      && value.exam_locations.length <= 1
      && value.exam_locations.every(isLocation)))
);

export const isExamAdminFcProfileRow = (value: unknown): value is ExamAdminFcProfileRow => (
  isRecord(value)
  && typeof value.id === 'string'
  && value.id.trim().length > 0
  && isNullableString(value.name)
  && isNullableString(value.address)
  && typeof value.phone === 'string'
  && value.phone.trim().length > 0
  && isNullableString(value.affiliation)
);
