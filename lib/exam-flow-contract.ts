import type { ExamRoundWithLocations } from '@/types/exam';

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
};

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
  is_third_exam?: boolean | null;
  fee_paid_date?: string | null;
} | null;

export function getExamFlowConfig(examType: ExamFlowType): ExamFlowConfig {
  return EXAM_FLOW_CONFIGS[examType];
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
  actor,
  residentId,
  examTitle,
  locationName,
}: {
  examType: ExamFlowType;
  actor: string;
  residentId: string;
  examTitle: string;
  locationName?: string | null;
}): { admin: ExamNotifyPayload; fcSelf: ExamNotifyPayload } {
  const config = getExamFlowConfig(examType);
  const title = `${actor}님이 ${examTitle}을 신청하였습니다.`;
  const body = locationName
    ? `${actor}님이 ${examTitle} (${locationName})을 신청하였습니다.`
    : title;

  return {
    admin: {
      type: 'notify',
      target_role: 'admin',
      target_id: residentId,
      title,
      body,
      category: 'exam_apply',
      url: config.manageRoute,
    },
    fcSelf: {
      type: 'notify',
      target_role: 'fc',
      target_id: residentId,
      title: '시험 신청이 접수되었습니다.',
      body: `${examTitle}${locationName ? ` (${locationName})` : ''} 접수가 완료되었습니다.`,
      category: 'exam_apply',
      url: config.applyRoute,
    },
  };
}

export function buildExamRoundNotificationPayload({
  examType,
  title,
  body,
}: {
  examType: ExamFlowType;
  title: string;
  body: string;
}): ExamNotifyPayload {
  return {
    type: 'notify',
    target_role: 'fc',
    target_id: null,
    title,
    body,
    category: 'exam_round',
    url: getExamFlowConfig(examType).applyRoute,
  };
}
