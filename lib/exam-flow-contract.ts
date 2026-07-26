import type { ExamRoundWithLocations } from '@/types/exam';
import {
  isNotificationUuid,
  type NotificationTarget,
} from '@/lib/notification-target';

export type ExamFlowType = 'life' | 'nonlife';

export const INVALID_EXAM_LOCATION_MESSAGE =
  '선택한 응시 지역이 해당 시험 회차에 속하지 않습니다. 응시 지역을 다시 선택해주세요.';

type ExamFlowConfig = {
  examType: ExamFlowType;
  applyRoute: '/exam-apply' | '/exam-apply2';
  manageRoute: '/exam-manage' | '/exam-manage2';
  applyRoundsQueryKey: readonly ['exam-rounds-for-apply', ExamFlowType];
  myApplyQueryKeyPrefix: 'my-exam-apply-life' | 'my-exam-apply-nonlife';
  registerRoundsQueryKey: readonly ['exam-rounds-life'] | readonly ['exam-rounds-nonlife'];
  applyRealtimeChannelPrefix: 'exam-apply-life' | 'exam-apply-nonlife';
  registerRoundChannel: 'exam-register-life-rounds' | 'exam-register-nonlife-rounds';
  registerLocationChannel: 'exam-register-life-locations' | 'exam-register-nonlife-locations';
  feeAccount: {
    label: '응시료 납입 계좌';
    value: string;
  };
};

export const EXAM_FLOW_CONFIGS = {
  life: {
    examType: 'life',
    applyRoute: '/exam-apply',
    manageRoute: '/exam-manage',
    applyRoundsQueryKey: ['exam-rounds-for-apply', 'life'],
    myApplyQueryKeyPrefix: 'my-exam-apply-life',
    registerRoundsQueryKey: ['exam-rounds-life'],
    applyRealtimeChannelPrefix: 'exam-apply-life',
    registerRoundChannel: 'exam-register-life-rounds',
    registerLocationChannel: 'exam-register-life-locations',
    feeAccount: {
      label: '응시료 납입 계좌',
      value: '신한 110-505-328638 김태훈',
    },
  },
  nonlife: {
    examType: 'nonlife',
    applyRoute: '/exam-apply2',
    manageRoute: '/exam-manage2',
    applyRoundsQueryKey: ['exam-rounds-for-apply', 'nonlife'],
    myApplyQueryKeyPrefix: 'my-exam-apply-nonlife',
    registerRoundsQueryKey: ['exam-rounds-nonlife'],
    applyRealtimeChannelPrefix: 'exam-apply-nonlife',
    registerRoundChannel: 'exam-register-nonlife-rounds',
    registerLocationChannel: 'exam-register-nonlife-locations',
    feeAccount: {
      label: '응시료 납입 계좌',
      value: '신한 110-444-751201 김태훈',
    },
  },
} as const satisfies Record<ExamFlowType, ExamFlowConfig>;

export type ExamNotifyPayload = {
  type: 'notify';
  target_role: 'admin' | 'fc';
  target_id: string | null;
  title: string;
  body: string;
  category: 'exam_apply' | 'exam_round';
  url: string;
  target: Extract<NotificationTarget, { kind: 'exam' }>;
};

export type ExamApplyNotificationPayloads = {
  admin: ExamNotifyPayload;
  fcSelf: ExamNotifyPayload;
};

export type ExamApplyNotificationTarget = keyof ExamApplyNotificationPayloads;

export type ExamRoundFormState = {
  selectedRoundId: string | null;
  roundForm: {
    roundLabel: string;
    notes: string;
  };
  examDate: Date;
  deadlineDate: Date;
  locationInput: string;
  locationOrder: string;
  draftLocations: { id: string; name: string; order: number }[];
};

type ExistingExamApplicationSelection = {
  location_id?: string | null;
  includes_primary_exam?: boolean | null;
  is_third_exam?: boolean | null;
  fee_paid_date?: string | null;
} | null;

export const EXAM_MONTH_SLOT_STATUSES = [
  'applied',
  'confirmed',
  'completed',
  'no_show',
] as const;

type ActiveExamOwnershipRegistration = {
  id: string;
  fc_id?: string | null;
  resident_id?: string | null;
  status?: string | null;
};

type ExamOwnershipProfile = {
  id: string;
  phone?: string | null;
};

export type ActiveExamOwnershipValidation =
  | { ok: true }
  | {
      ok: false;
      registrationId: string;
      reason: 'missing_fc' | 'identity_mismatch';
    };

const normalizeExamOwnershipIdentity = (value?: string | null): string | null => {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits || null;
};

export function isExamMonthSlotConsumed(status?: string | null): boolean {
  return EXAM_MONTH_SLOT_STATUSES.includes(
    String(status ?? '') as (typeof EXAM_MONTH_SLOT_STATUSES)[number],
  );
}

export function isExamRegistrationVisibleInHistory(
  status?: string | null,
): boolean {
  return !['cancelled_by_fc', 'cancelled_by_admin'].includes(
    String(status ?? ''),
  );
}

export function validateActiveExamOwnershipFixture(
  registrations: readonly ActiveExamOwnershipRegistration[],
  profiles: readonly ExamOwnershipProfile[],
): ActiveExamOwnershipValidation {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

  for (const registration of registrations) {
    if (!isExamMonthSlotConsumed(registration.status)) continue;
    if (!registration.fc_id) {
      return {
        ok: false,
        registrationId: registration.id,
        reason: 'missing_fc',
      };
    }

    const profile = profilesById.get(registration.fc_id);
    if (
      !profile
      || normalizeExamOwnershipIdentity(profile.phone)
        !== normalizeExamOwnershipIdentity(registration.resident_id)
    ) {
      return {
        ok: false,
        registrationId: registration.id,
        reason: 'identity_mismatch',
      };
    }
  }

  return { ok: true };
}

export function getExamMonthKey(examDate?: string | null): string | null {
  const normalized = String(examDate ?? '').trim();
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(normalized);
  return match ? `${match[1]}-${match[2]}` : null;
}

export function formatExamRegistrationStatus(status?: string | null): string {
  const labels: Record<string, string> = {
    applied: '신청 완료',
    confirmed: '접수 완료',
    completed: '시험 완료',
    no_show: '미응시',
    rejected: '반려',
    cancelled_by_fc: 'FC 취소',
    cancelled_by_admin: '관리자 취소',
  };
  return labels[String(status ?? '')] ?? '상태 확인 필요';
}

export function formatExamSubjectSelection({
  examType,
  includesPrimaryExam,
  isThirdExam,
}: {
  examType?: string | null;
  includesPrimaryExam?: boolean | null;
  isThirdExam?: boolean | null;
}): string {
  const primaryLabel = examType === 'nonlife' ? '손해' : '생명';
  if (includesPrimaryExam && isThirdExam) return `${primaryLabel}, 제3`;
  if (includesPrimaryExam) return primaryLabel;
  if (isThirdExam) return '제3';
  return '-';
}

export function getExamFlowConfig(examType: ExamFlowType): ExamFlowConfig {
  return EXAM_FLOW_CONFIGS[examType];
}

let examApplyRealtimeChannelSequence = 0;

export function createExamApplyRealtimeChannelTopic(
  prefix: ExamFlowConfig['applyRealtimeChannelPrefix'],
): string {
  examApplyRealtimeChannelSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${examApplyRealtimeChannelSequence.toString(36)}`;
}

export function sortExamRoundsNewestFirst(
  rounds: readonly ExamRoundWithLocations[],
): ExamRoundWithLocations[] {
  return [...rounds].sort((a, b) => {
    const examDateOrder = String(b.exam_date ?? '').localeCompare(String(a.exam_date ?? ''));
    if (examDateOrder !== 0) return examDateOrder;

    const deadlineOrder = String(b.registration_deadline ?? '').localeCompare(
      String(a.registration_deadline ?? ''),
    );
    if (deadlineOrder !== 0) return deadlineOrder;

    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  });
}

export function getExamFeeAccountCopyText(examType: ExamFlowType) {
  const { feeAccount } = getExamFlowConfig(examType);
  return {
    label: feeAccount.label,
    value: feeAccount.value,
    copyLabel: '복사',
    accessibilityLabel: `${feeAccount.label} 복사`,
    accessibilityHint: `${feeAccount.label} 정보를 클립보드에 복사합니다.`,
  };
}

export function isLocationInRound(
  round: ExamRoundWithLocations | null,
  locationId: string | null | undefined,
): boolean {
  if (!round || !locationId) return false;
  return round.locations.some((location) => location.id === locationId);
}

const toDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toFormDate = (value: string | null | undefined, fallback: Date): Date => {
  const parsed = toDate(value);
  return parsed ?? new Date(fallback.getTime());
};

export function getExamRoundSelectionState(round: ExamRoundWithLocations) {
  return {
    selectedRoundId: round.id,
    selectedLocationId: null,
  };
}

export function getExamApplyRestoredSelectionState({
  existingForRound,
  selectedRound,
}: {
  existingForRound: ExistingExamApplicationSelection;
  selectedRound: ExamRoundWithLocations | null;
}) {
  if (!existingForRound) {
    return {
      selectedLocationId: null,
      wantsPrimary: true,
      wantsThird: false,
      feePaidDate: null,
      tempFeePaidDate: null,
    };
  }

  const restoredFeePaidDate = toDate(existingForRound.fee_paid_date);
  return {
    selectedLocationId: isLocationInRound(selectedRound, existingForRound.location_id)
      ? existingForRound.location_id ?? null
      : null,
    wantsPrimary:
      existingForRound.includes_primary_exam != null
        ? !!existingForRound.includes_primary_exam
        : true,
    wantsThird: existingForRound.is_third_exam != null ? !!existingForRound.is_third_exam : false,
    feePaidDate: restoredFeePaidDate,
    tempFeePaidDate: restoredFeePaidDate,
  };
}

export function getExamRoundCreateFormState(now = new Date()): ExamRoundFormState {
  return {
    selectedRoundId: null,
    roundForm: {
      roundLabel: '',
      notes: '',
    },
    examDate: new Date(now.getTime()),
    deadlineDate: new Date(now.getTime()),
    locationInput: '',
    locationOrder: '0',
    draftLocations: [],
  };
}

export function getExamRoundEditFormState(
  round: ExamRoundWithLocations,
  fallback = new Date(),
): ExamRoundFormState {
  return {
    selectedRoundId: round.id,
    roundForm: {
      roundLabel: round.round_label ?? '',
      notes: round.notes ?? '',
    },
    examDate: toFormDate(round.exam_date, fallback),
    deadlineDate: toFormDate(round.registration_deadline, fallback),
    locationInput: '',
    locationOrder: '0',
    draftLocations: [],
  };
}

export function buildExamApplyNotificationPayloads({
  examType,
  examRegistrationId,
  actor,
  residentId,
  examTitle,
  locationName,
}: {
  examType: ExamFlowType;
  examRegistrationId: string;
  actor: string;
  residentId: string;
  examTitle: string;
  locationName?: string | null;
}): ExamApplyNotificationPayloads {
  if (!isNotificationUuid(examRegistrationId)) {
    throw new Error('invalid_exam_registration_notification_target');
  }
  const config = getExamFlowConfig(examType);
  const title = `${actor}님이 ${examTitle}을 신청하였습니다.`;
  const body = locationName
    ? `${actor}님이 ${examTitle} (${locationName})을 신청하였습니다.`
    : title;

  return {
    admin: {
      type: 'notify',
      target_role: 'admin',
      target_id: null,
      title,
      body,
      category: 'exam_apply',
      url: config.manageRoute,
      target: {
        version: 1,
        kind: 'exam',
        examType,
        examRegistrationId,
      },
    },
    fcSelf: {
      type: 'notify',
      target_role: 'fc',
      target_id: residentId,
      title: '시험 신청이 접수되었습니다.',
      body: `${examTitle}${locationName ? ` (${locationName})` : ''} 접수가 완료되었습니다.`,
      category: 'exam_apply',
      url: config.applyRoute,
      target: {
        version: 1,
        kind: 'exam',
        examType,
        examRegistrationId,
      },
    },
  };
}

/**
 * Exam registration has already been committed before this helper runs. Delivery
 * failures are therefore reported as metadata and must never turn the saved
 * application into a mutation failure that invites a duplicate retry.
 */
export async function sendExamApplyNotificationsBestEffort(
  payloads: ExamApplyNotificationPayloads,
  notify: (payload: ExamNotifyPayload) => Promise<void>,
  targets: readonly ExamApplyNotificationTarget[] = ['admin', 'fcSelf'],
): Promise<{
  failedTargets: ExamApplyNotificationTarget[];
  invalidTargets: ExamApplyNotificationTarget[];
}> {
  const entries = [
    ['admin', payloads.admin],
    ['fcSelf', payloads.fcSelf],
  ] as const satisfies readonly (
    readonly [ExamApplyNotificationTarget, ExamNotifyPayload]
  )[];
  const selectedEntries = entries.filter(([target]) => targets.includes(target));
  const results = await Promise.allSettled(
    selectedEntries.map(([, payload]) =>
      Promise.resolve().then(() => notify(payload))
    ),
  );

  return {
    failedTargets: results.flatMap((result, index) =>
      result.status === 'rejected'
      && (
        !(result.reason instanceof Error)
        || result.reason.message !== 'notification_invalid_recipient'
      )
        ? [selectedEntries[index][0]]
        : [],
    ),
    invalidTargets: results.flatMap((result, index) =>
      result.status === 'rejected'
      && result.reason instanceof Error
      && result.reason.message === 'notification_invalid_recipient'
        ? [selectedEntries[index][0]]
        : [],
    ),
  };
}

export function buildExamRoundNotificationPayload({
  examType,
  examRoundId,
  title,
  body,
}: {
  examType: ExamFlowType;
  examRoundId: string;
  title: string;
  body: string;
}): ExamNotifyPayload {
  if (!isNotificationUuid(examRoundId)) {
    throw new Error('invalid_exam_round_notification_target');
  }
  return {
    type: 'notify',
    target_role: 'fc',
    target_id: null,
    title,
    body,
    category: 'exam_round',
    url: getExamFlowConfig(examType).applyRoute,
    target: {
      version: 1,
      kind: 'exam',
      examType,
      examRoundId,
    },
  };
}
