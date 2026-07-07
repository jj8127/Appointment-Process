export type RequestBoardHomeStats = {
  total: number;
  pending: number;
  reviewPending: number;
  inProgress: number;
  completed: number;
  completedThisMonth: number;
  avgDays: number;
};

type RequestBoardHomeStatsAssignment = {
  status?: string | null;
  fc_decision?: string | null;
};

type RequestBoardHomeStatsItem = {
  status?: string | null;
  assignmentStatus?: string | null;
  completedAt?: string | null;
  completed_at?: string | null;
  processingDays?: number | null;
  processing_days?: number | null;
  request_products?: { product_id?: number | string | null }[] | null;
  request_designers?: RequestBoardHomeStatsAssignment[] | null;
};

const normalizeStatus = (raw?: string | null): string => {
  const status = String(raw ?? '').trim().toLowerCase();
  if (!status) return '';
  if (status === 'accepted' || status === 'in-progress' || status === 'inprogress') {
    return 'in_progress';
  }
  return status;
};

const countUniqueProducts = (request: RequestBoardHomeStatsItem): number => {
  if (!request.request_products) return 0;
  const ids = new Set(
    request.request_products
      .map((rp) => String(rp.product_id ?? '').trim())
      .filter((id) => id.length > 0),
  );
  return ids.size;
};

const assignmentStatusToBucket = (
  status: string,
): 'pending' | 'in_progress' | 'completed' | 'cancelled' | null => {
  if (status === 'pending') return 'pending';
  if (status === 'accepted' || status === 'in_progress') return 'in_progress';
  if (status === 'completed' || status === 'rejected') return 'completed';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return null;
};

const getDesignerStatus = (request: RequestBoardHomeStatsItem) =>
  normalizeStatus(
    request.assignmentStatus
      ?? request.request_designers?.[0]?.status
      ?? request.status
      ?? '',
  );

const getCompletedAt = (request: RequestBoardHomeStatsItem) =>
  request.completedAt ?? request.completed_at ?? null;

const getProcessingDays = (request: RequestBoardHomeStatsItem) =>
  request.processingDays ?? request.processing_days ?? 0;

export function computeRequestBoardHomeStats(
  requests: RequestBoardHomeStatsItem[],
  isDesigner: boolean,
): RequestBoardHomeStats {
  if (!isDesigner) {
    let pending = 0;
    let reviewPending = 0;
    let inProgress = 0;
    let completed = 0;
    let cancelled = 0;

    requests.forEach((request) => {
      const productCount = countUniqueProducts(request);
      if (productCount <= 0) return;

      const assignments = request.request_designers ?? [];
      assignments.forEach((assignment) => {
        const status = normalizeStatus(assignment.status);
        if (
          status === 'completed'
          && (assignment.fc_decision === 'pending' || assignment.fc_decision == null)
        ) {
          reviewPending += productCount;
        }

        const bucket = assignmentStatusToBucket(status);
        if (bucket === 'pending') pending += productCount;
        if (bucket === 'in_progress') inProgress += productCount;
        if (bucket === 'completed') completed += productCount;
        if (bucket === 'cancelled') cancelled += productCount;
      });
    });

    const total = pending + inProgress + completed + cancelled;
    return {
      total,
      pending,
      reviewPending,
      inProgress,
      completed,
      completedThisMonth: completed,
      avgDays: 0,
    };
  }

  const now = new Date();
  const pending = requests.filter((r) => getDesignerStatus(r) === 'pending').length;
  const inProgress = requests.filter((r) => getDesignerStatus(r) === 'in_progress').length;
  const completedAll = requests.filter((r) => getDesignerStatus(r) === 'completed' || getDesignerStatus(r) === 'rejected');
  const cancelled = requests.filter((r) => {
    const status = getDesignerStatus(r);
    return status === 'cancelled' || status === 'canceled';
  }).length;
  const completed = completedAll.length;
  const total = pending + inProgress + completed + cancelled;

  const completedThisMonth = completedAll.filter((r) => {
    const d = new Date(getCompletedAt(r) ?? '');
    return (
      !isNaN(d.getTime()) &&
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth()
    );
  }).length;

  const avgDays =
    completedAll.length > 0
      ? Math.round(
          (completedAll.reduce((s, r) => s + Number(getProcessingDays(r) ?? 0), 0) /
            completedAll.length) *
            10,
        ) / 10
      : 0;

  return { total, pending, reviewPending: 0, inProgress, completed, completedThisMonth, avgDays };
}
