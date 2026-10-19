/**
 * Where a design request stands, per manager assignment: the step it reached, whose turn it is,
 * and who the manager is. A manager's rejection ends the request; it is never shown as done.
 */

export const REQUEST_PROGRESS_STEPS = ['수락 대기', '설계 중', '검토 대기', '완료'] as const;

export type RequestProgressViewer = 'fc' | 'designer';
export type RequestProgressTone = 'waiting' | 'active' | 'action' | 'done' | 'stopped';

export type RequestProgress = {
  label: string;
  /** Index into REQUEST_PROGRESS_STEPS reached so far. */
  step: number;
  /** The viewer must act now. */
  isMyTurn: boolean;
  turnLabel: string;
  tone: RequestProgressTone;
  ended: boolean;
};

type AssignmentLike = {
  status?: string | null;
  fc_decision?: string | null;
  designers?: { company_name?: string | null; users?: { name?: string | null } | null } | null;
};

const normalize = (value?: string | null) => String(value ?? '').trim().toLowerCase().replace(/-/g, '_');

export function getAssignmentProgress(assignment: AssignmentLike, viewer: RequestProgressViewer): RequestProgress {
  const status = normalize(assignment.status);
  const decision = normalize(assignment.fc_decision);
  const turnOf = (party: 'fc' | 'designer') => ({
    isMyTurn: party === viewer,
    turnLabel: party === viewer ? '내 차례' : party === 'fc' ? 'FC 검토 중' : '매니저 처리 중',
  });
  if (status === 'pending') {
    return { label: '수락 대기', step: 0, tone: 'waiting', ended: false, ...turnOf('designer') };
  }
  if (status === 'accepted' || status === 'in_progress' || status === 'inprogress') {
    return { label: '설계 중', step: 1, tone: 'active', ended: false, ...turnOf('designer') };
  }
  if (status === 'completed' && (decision === '' || decision === 'pending')) {
    return { label: '검토 대기', step: 2, tone: 'action', ended: false, ...turnOf('fc') };
  }
  if (status === 'completed' && decision === 'accepted') {
    return { label: '승인 완료', step: 3, tone: 'done', ended: true, isMyTurn: false, turnLabel: '종료' };
  }
  if (status === 'completed' && decision === 'rejected') {
    return { label: 'FC 거절', step: 3, tone: 'stopped', ended: true, isMyTurn: false, turnLabel: '종료' };
  }
  if (status === 'rejected') {
    return { label: '매니저 거절', step: 0, tone: 'stopped', ended: true, isMyTurn: false, turnLabel: '다시 요청 필요' };
  }
  if (status === 'cancelled' || status === 'canceled') {
    return { label: '요청 취소', step: 0, tone: 'stopped', ended: true, isMyTurn: false, turnLabel: '종료' };
  }
  return { label: '확인 중', step: 0, tone: 'waiting', ended: false, isMyTurn: false, turnLabel: '확인 중' };
}

export function getAssignmentManager(assignment: AssignmentLike): string | null {
  const name = String(assignment.designers?.users?.name ?? '').trim();
  const company = String(assignment.designers?.company_name ?? '').trim();
  if (!name && !company) return null;
  return [name, company].filter(Boolean).join(' · ');
}

/**
 * One line for a request card: the assignment that needs the viewer first, then one still moving,
 * then the first one. `others` counts the remaining assignments.
 */
export function summarizeRequestProgress(
  assignments: AssignmentLike[] | null | undefined,
  viewer: RequestProgressViewer,
): (RequestProgress & { manager: string | null; others: number }) | null {
  const list = assignments ?? [];
  if (list.length === 0) return null;
  const withProgress = list.map((assignment) => ({ assignment, progress: getAssignmentProgress(assignment, viewer) }));
  const lead = withProgress.find((item) => item.progress.isMyTurn)
    ?? withProgress.find((item) => !item.progress.ended)
    ?? withProgress[0];
  return { ...lead.progress, manager: getAssignmentManager(lead.assignment), others: list.length - 1 };
}
