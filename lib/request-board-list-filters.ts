export type RequestBoardListFilterKey =
  | 'all'
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'review_pending';

type RequestBoardListAssignmentLike = {
  status?: string | null;
  fc_decision?: string | null;
};

type RequestBoardListItemLike = {
  status?: string | null;
  request_designers?: RequestBoardListAssignmentLike[] | null;
};

const MAIN_BUCKETS: Exclude<RequestBoardListFilterKey, 'all' | 'review_pending'>[] = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
];

const normalize = (value?: string | null) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');

const getRequestStatusBucket = (
  request: RequestBoardListItemLike,
): Exclude<RequestBoardListFilterKey, 'all' | 'review_pending'> | null => {
  const status = normalize(request.status);
  if (status === 'pending') return 'pending';
  if (status === 'accepted' || status === 'in_progress' || status === 'inprogress') {
    return 'in_progress';
  }
  // A manager's rejection ends a request without a design; it belongs with cancellations, not done.
  if (status === 'rejected') return 'cancelled';
  if (status === 'completed') {
    const assignments = request.request_designers ?? [];
    const allStopped = assignments.length > 0 && assignments.every((assignment) => {
      const assignmentStatus = normalize(assignment.status);
      return assignmentStatus === 'rejected' || assignmentStatus === 'cancelled' || assignmentStatus === 'canceled';
    });
    return allStopped ? 'cancelled' : 'completed';
  }
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return null;
};

const getAssignmentStatusBucket = (
  assignment: RequestBoardListAssignmentLike,
): Exclude<RequestBoardListFilterKey, 'all' | 'review_pending'> | null => {
  const status = normalize(assignment.status);
  if (status === 'pending') return 'pending';
  if (status === 'accepted' || status === 'in_progress' || status === 'inprogress') {
    return 'in_progress';
  }
  if (status === 'completed') return 'completed';
  if (status === 'rejected' || status === 'cancelled' || status === 'canceled') return 'cancelled';
  return null;
};

const hasPendingFcReview = (request: RequestBoardListItemLike) =>
  (request.request_designers ?? []).some((assignment) => {
    const decision = normalize(assignment.fc_decision);
    return normalize(assignment.status) === 'completed'
      && (decision === '' || decision === 'pending');
  });

export function getRequestBoardListBuckets(
  request: RequestBoardListItemLike,
  isDesigner: boolean,
) {
  const buckets = new Set<RequestBoardListFilterKey>();

  if (isDesigner) {
    for (const assignment of request.request_designers ?? []) {
      const bucket = getAssignmentStatusBucket(assignment);
      if (bucket) {
        buckets.add(bucket);
      }
    }
  }

  if (!isDesigner || buckets.size === 0) {
    const bucket = getRequestStatusBucket(request);
    if (bucket) {
      buckets.add(bucket);
    }
  }

  if (hasPendingFcReview(request)) {
    buckets.add('review_pending');
  }

  return buckets;
}

export function requestBoardListHasBucket(
  request: RequestBoardListItemLike,
  bucket: RequestBoardListFilterKey,
  isDesigner: boolean,
) {
  const buckets = getRequestBoardListBuckets(request, isDesigner);
  if (bucket === 'all') {
    return MAIN_BUCKETS.some((mainBucket) => buckets.has(mainBucket));
  }
  return buckets.has(bucket);
}

export function getRequestBoardPrimaryStatus(
  request: RequestBoardListItemLike,
  isDesigner: boolean,
) {
  const buckets = getRequestBoardListBuckets(request, isDesigner);
  return MAIN_BUCKETS.find((bucket) => buckets.has(bucket))
    ?? getRequestStatusBucket(request)
    ?? normalize(request.status)
    ?? 'pending';
}
