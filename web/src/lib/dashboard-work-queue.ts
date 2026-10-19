// Home "오늘 처리할 건" queues. Each FC belongs to at most one queue, decided from workflow signals
// the dashboard already computes (calcStep, getAllowanceDisplayState, getDocProgress, getHanwhaProgress,
// getAppointmentProgress). The first two queues keep the original metric-card conditions.
export const DASHBOARD_WORK_QUEUES = [
  { key: 'pendingAllowance', label: '보증 보험 동의 승인 대기', task: '보증 보험 동의 승인', step: 1 },
  { key: 'pendingDocs', label: '서류검토 대기', task: '서류 검토', step: 2 },
  { key: 'pendingHanwha', label: '다위촉 URL 승인 대기', task: '다위촉 URL 승인', step: 3 },
  { key: 'pendingAppointment', label: '생명/손해 위촉 확정 대기', task: '생명/손해 위촉 확정', step: 4 },
] as const;

export type DashboardWorkQueueKey = (typeof DASHBOARD_WORK_QUEUES)[number]['key'];
export type DashboardMetricFilter = 'all' | DashboardWorkQueueKey;

export type DashboardWorkSignals = {
  step: number;
  allowanceKey: string;
  docProgressKey: string;
  hanwhaKey: string;
  lifeKey: string;
  nonlifeKey: string;
};

export function getDashboardWorkQueueKey(signals: DashboardWorkSignals): DashboardWorkQueueKey | null {
  if (signals.step === 1 && (signals.allowanceKey === 'entered' || signals.allowanceKey === 'prescreen')) {
    return 'pendingAllowance';
  }
  if (signals.step === 2 && signals.docProgressKey === 'in-progress') return 'pendingDocs';
  if (signals.step === 3 && signals.hanwhaKey === 'review') return 'pendingHanwha';
  if (signals.step === 4 && (signals.lifeKey === 'fc-done' || signals.nonlifeKey === 'fc-done')) {
    return 'pendingAppointment';
  }
  return null;
}

export function isDashboardMetricFilter(value: unknown): value is DashboardMetricFilter {
  return value === 'all' || DASHBOARD_WORK_QUEUES.some((queue) => queue.key === value);
}

export function countDashboardWork(keys: Iterable<DashboardWorkQueueKey | null>) {
  const counts = Object.fromEntries(DASHBOARD_WORK_QUEUES.map((queue) => [queue.key, 0])) as Record<
    DashboardWorkQueueKey,
    number
  >;
  let pending = 0;
  for (const key of keys) {
    if (!key) continue;
    counts[key] += 1;
    pending += 1;
  }
  return { counts, pending };
}

// Fields that tell when a queue item started waiting on the admin.
export type DashboardWorkTimingFields = {
  allowance_date?: string | null;
  allowance_prescreen_requested_at?: string | null;
  hanwha_commission_date_sub?: string | null;
  appointment_date_life_sub?: string | null;
  appointment_date_nonlife_sub?: string | null;
  fc_documents?: Array<{ storage_path: string | null; status?: string | null; created_at?: string }> | null;
};

const latest = (values: Array<string | null | undefined>) =>
  values.filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(String(value))))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

// When the item entered the queue: the FC's latest submission for that step, or null when unknown.
export function getDashboardWorkOccurredAt(key: DashboardWorkQueueKey, fc: DashboardWorkTimingFields): string | null {
  if (key === 'pendingAllowance') return latest([fc.allowance_prescreen_requested_at ?? fc.allowance_date]);
  if (key === 'pendingHanwha') return latest([fc.hanwha_commission_date_sub]);
  if (key === 'pendingAppointment') return latest([fc.appointment_date_life_sub, fc.appointment_date_nonlife_sub]);
  const waiting = (fc.fc_documents ?? []).filter(
    (doc) => doc.storage_path && doc.storage_path !== 'deleted' && doc.status !== 'approved' && doc.status !== 'rejected',
  );
  return latest(waiting.map((doc) => doc.created_at));
}
