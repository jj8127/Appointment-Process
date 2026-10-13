import type { ExamRoundWithLocations } from '@/types/exam';
import type { ExamFlowType } from './exam-flow-contract';

export type ExamRoundQueryRow = {
  id: string;
  exam_type?: ExamFlowType;
  exam_month?: string | null;
  exam_date: string | null;
  registration_deadline: string;
  round_label: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  exam_locations: {
    id: string;
    round_id: string;
    location_name: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }[];
};

export type ExamRegistrationHistoryQueryRow = {
  id: string;
  round_id: string;
  location_id: string;
  status: string;
  is_confirmed: boolean | null;
  includes_primary_exam: boolean | null;
  is_third_exam: boolean | null;
  fee_paid_date: string | null;
  payment_proof_attached: boolean | null;
  rejection_reason: string | null;
  rejected_at: string | null;
  created_at: string;
  exam_month?: string | null;
  exam_rounds:
    | ExamRegistrationHistoryRoundQueryRow
    | ExamRegistrationHistoryRoundQueryRow[];
  exam_locations:
    | ExamRegistrationHistoryLocationQueryRow
    | ExamRegistrationHistoryLocationQueryRow[];
};

export type ExamRegistrationHistoryRoundQueryRow = {
  exam_date: string | null;
  registration_deadline: string;
  round_label: string | null;
  exam_type?: ExamFlowType;
  exam_month?: string | null;
};

export type ExamRegistrationHistoryLocationQueryRow = {
  location_name: string;
};

type ExamRoundGuardOptions = {
  includeExamMonth: boolean;
  includeExamType: boolean;
};

type ExamRegistrationHistoryGuardOptions = {
  includeExamMonth: boolean;
  includeNestedExamType: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

const isNullableString = (value: unknown): value is string | null => (
  value === null || typeof value === 'string'
);

const isNullableNonEmptyString = (value: unknown): value is string | null => (
  value === null || isNonEmptyString(value)
);

const isNullableBoolean = (value: unknown): value is boolean | null => (
  value === null || typeof value === 'boolean'
);

const isExamFlowType = (value: unknown): value is ExamFlowType => (
  value === 'life' || value === 'nonlife'
);

const isExamLocationQueryRow = (
  value: unknown,
  expectedRoundId: string,
): value is ExamRoundQueryRow['exam_locations'][number] => (
  isRecord(value)
  && isNonEmptyString(value.id)
  && value.round_id === expectedRoundId
  && isNonEmptyString(value.location_name)
  && Number.isSafeInteger(value.sort_order)
  && isNonEmptyString(value.created_at)
  && isNonEmptyString(value.updated_at)
);

export const isExamRoundQueryRow = (
  value: unknown,
  options: ExamRoundGuardOptions,
): value is ExamRoundQueryRow => (
  isRecord(value)
  && isNonEmptyString(value.id)
  && (!options.includeExamType || isExamFlowType(value.exam_type))
  && (value.exam_type === undefined || isExamFlowType(value.exam_type))
  && (!options.includeExamMonth || isNullableNonEmptyString(value.exam_month))
  && (value.exam_month === undefined || isNullableNonEmptyString(value.exam_month))
  && isNullableNonEmptyString(value.exam_date)
  && isNonEmptyString(value.registration_deadline)
  && isNullableString(value.round_label)
  && isNullableString(value.notes)
  && isNonEmptyString(value.created_at)
  && isNonEmptyString(value.updated_at)
  && Array.isArray(value.exam_locations)
  && value.exam_locations.every(
    (location) => isExamLocationQueryRow(location, value.id as string),
  )
);

export const toExamRoundWithLocations = (
  row: ExamRoundQueryRow,
  includeExamMonth: boolean,
): ExamRoundWithLocations => ({
  id: row.id,
  exam_month: includeExamMonth ? row.exam_month ?? null : null,
  exam_date: row.exam_date,
  registration_deadline: row.registration_deadline,
  round_label: row.round_label,
  notes: row.notes,
  created_at: row.created_at,
  updated_at: row.updated_at,
  locations: [...row.exam_locations].sort(
    (a, b) => a.sort_order - b.sort_order || a.location_name.localeCompare(b.location_name),
  ),
});

const isExamRegistrationHistoryRound = (
  value: unknown,
  options: ExamRegistrationHistoryGuardOptions,
): value is ExamRegistrationHistoryRoundQueryRow => (
  isRecord(value)
  && isNullableNonEmptyString(value.exam_date)
  && isNonEmptyString(value.registration_deadline)
  && isNullableString(value.round_label)
  && (!options.includeNestedExamType || isExamFlowType(value.exam_type))
  && (value.exam_type === undefined || isExamFlowType(value.exam_type))
  && (!options.includeExamMonth || isNullableNonEmptyString(value.exam_month))
  && (value.exam_month === undefined || isNullableNonEmptyString(value.exam_month))
);

const isExamRegistrationHistoryLocation = (
  value: unknown,
): value is ExamRegistrationHistoryLocationQueryRow => (
  isRecord(value) && isNonEmptyString(value.location_name)
);

const isExactlyOne = <T>(
  value: unknown,
  isItem: (item: unknown) => item is T,
): value is T | T[] => (
  isItem(value)
  || (Array.isArray(value) && value.length === 1 && isItem(value[0]))
);

export const isExamRegistrationHistoryQueryRow = (
  value: unknown,
  options: ExamRegistrationHistoryGuardOptions,
): value is ExamRegistrationHistoryQueryRow => (
  isRecord(value)
  && isNonEmptyString(value.id)
  && isNonEmptyString(value.round_id)
  && isNonEmptyString(value.location_id)
  && isNonEmptyString(value.status)
  && isNullableBoolean(value.is_confirmed)
  && isNullableBoolean(value.includes_primary_exam)
  && isNullableBoolean(value.is_third_exam)
  && isNullableNonEmptyString(value.fee_paid_date)
  && isNullableBoolean(value.payment_proof_attached)
  && isNullableString(value.rejection_reason)
  && isNullableNonEmptyString(value.rejected_at)
  && isNonEmptyString(value.created_at)
  && (!options.includeExamMonth || isNullableNonEmptyString(value.exam_month))
  && (value.exam_month === undefined || isNullableNonEmptyString(value.exam_month))
  && isExactlyOne(
    value.exam_rounds,
    (round): round is ExamRegistrationHistoryRoundQueryRow => (
      isExamRegistrationHistoryRound(round, options)
    ),
  )
  && isExactlyOne(value.exam_locations, isExamRegistrationHistoryLocation)
);

export const getExamRegistrationHistoryRound = (
  row: ExamRegistrationHistoryQueryRow,
): ExamRegistrationHistoryRoundQueryRow => (
  Array.isArray(row.exam_rounds) ? row.exam_rounds[0]! : row.exam_rounds
);

export const getExamRegistrationHistoryLocation = (
  row: ExamRegistrationHistoryQueryRow,
): ExamRegistrationHistoryLocationQueryRow => (
  Array.isArray(row.exam_locations) ? row.exam_locations[0]! : row.exam_locations
);
