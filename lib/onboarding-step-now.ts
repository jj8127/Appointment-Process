// What the FC should do right now on each appointment step screen: whose turn it is,
// one sentence of what to do, and the rejection reason when there is one.

export type StepNowTone = 'mine' | 'waiting' | 'rejected' | 'done' | 'locked';

export type StepNow = {
  tone: StepNowTone;
  title: string;
  detail?: string | null;
  reason?: string | null;
};

export const ONBOARDING_STEP_NAMES = ['보증보험 동의', '문서 제출', '다위촉 URL', '생명/손해 위촉', '완료'] as const;

export const STEP_NOW_LABEL: Record<StepNowTone, string> = {
  mine: '내 차례',
  waiting: '총무 확인 중',
  rejected: '다시 제출 필요',
  done: '완료',
  locked: '이전 단계 진행 중',
};

const text = (value?: string | null) => {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
};

export function getConsentStepNow(input: {
  approved: boolean;
  tempId?: string | null;
  allowanceDate?: string | Date | null;
  status?: string | null;
  rejectReason?: string | null;
}): StepNow {
  if (input.approved) return { tone: 'done', title: '보증보험 동의가 승인됐어요' };
  if (!text(input.tempId)) return { tone: 'waiting', title: '총무가 임시사번을 발급하고 있어요' };
  const reason = text(input.rejectReason);
  if (reason && input.status === 'allowance-pending') {
    return { tone: 'rejected', title: '동의 후 동의일을 다시 입력해주세요', reason };
  }
  if (!input.allowanceDate) {
    return { tone: 'mine', title: '서울보증보험에서 동의하고 동의일을 입력해주세요' };
  }
  return { tone: 'waiting', title: '총무가 사전 심사를 준비하고 있어요' };
}

export type StepNowDoc = { status?: string | null; hasFile: boolean };

export function getDocsStepNow(input: { handedOff: boolean; docs: StepNowDoc[] }): StepNow {
  const { docs } = input;
  const approved = docs.filter((doc) => doc.status === 'approved').length;
  if (input.handedOff || (docs.length > 0 && approved === docs.length)) {
    return { tone: 'done', title: '서류가 모두 승인됐어요' };
  }
  if (docs.length === 0) return { tone: 'waiting', title: '총무가 필요한 서류를 정리하고 있어요' };
  const rejected = docs.filter((doc) => doc.status === 'rejected').length;
  const detail = `제출 ${docs.filter((doc) => doc.hasFile).length}/${docs.length} · 승인 ${approved}`;
  if (rejected > 0) return { tone: 'rejected', title: `반려된 서류 ${rejected}건을 다시 올려주세요`, detail };
  const missing = docs.filter((doc) => !doc.hasFile && doc.status !== 'approved').length;
  if (missing > 0) return { tone: 'mine', title: `서류 ${missing}건을 올려주세요`, detail };
  return { tone: 'waiting', title: '제출한 서류를 총무가 확인하고 있어요', detail };
}

export function getHanwhaStepNow(input: {
  blocked: boolean;
  approved: boolean;
  hasPdf: boolean;
  rejected: boolean;
  pending: boolean;
  rejectReason?: string | null;
}): StepNow {
  if (input.approved && input.hasPdf) return { tone: 'done', title: '다위촉이 승인됐어요' };
  if (input.approved) return { tone: 'waiting', title: '총무가 승인 PDF를 올리고 있어요' };
  if (input.blocked) return { tone: 'locked', title: '서류가 승인되면 열려요' };
  if (input.rejected) {
    return {
      tone: 'rejected',
      title: '다위촉 URL을 다시 진행하고 완료일을 제출해주세요',
      reason: text(input.rejectReason),
    };
  }
  if (input.pending) return { tone: 'waiting', title: '제출한 완료일을 총무가 확인하고 있어요' };
  return {
    tone: 'mine',
    title: '다위촉 URL을 진행하고 완료일을 입력해주세요',
    detail: '다위촉 URL은 카카오톡으로 받아요',
  };
}

export type StepNowTrack = {
  label: '생명' | '손해';
  scheduled: boolean;
  approved: boolean;
  pending: boolean;
  rejectReason?: string | null;
};

export function getAppointmentStepNow(input: {
  gateLocked: boolean;
  tracks: StepNowTrack[];
}): StepNow {
  if (input.gateLocked) return { tone: 'locked', title: '다위촉 승인 PDF가 등록되면 열려요' };
  const active = input.tracks.filter((track) => track.scheduled || track.approved || track.pending);
  if (active.length === 0) return { tone: 'waiting', title: '총무가 위촉 차수를 입력하고 있어요' };
  if (active.every((track) => track.approved)) return { tone: 'done', title: '위촉이 모두 끝났어요' };
  const open = active.filter((track) => !track.approved && !track.pending);
  const rejected = open.filter((track) => text(track.rejectReason));
  if (rejected.length > 0) {
    return {
      tone: 'rejected',
      title: `${rejected.map((track) => track.label).join('·')} 위촉 완료일을 다시 보고해주세요`,
      reason: rejected.length === 1 ? text(rejected[0].rejectReason) : null,
    };
  }
  const canReport = open.filter((track) => track.scheduled);
  if (canReport.length > 0) {
    return {
      tone: 'mine',
      title: `${canReport.map((track) => track.label).join('·')} 위촉을 마치고 완료일을 보고해주세요`,
    };
  }
  return { tone: 'waiting', title: '보고한 위촉 완료일을 총무가 확인하고 있어요' };
}
