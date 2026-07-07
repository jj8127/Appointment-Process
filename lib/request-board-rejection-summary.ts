type RequestBoardRejectionAssignmentLike = {
  id?: number | null;
  designer_id?: number | null;
  status?: string | null;
  rejection_reason?: string | null;
  designers?: {
    users?: {
      name?: string | null;
    } | null;
  } | null;
};

type RequestBoardRejectionRequestLike = {
  id?: number | null;
  request_designers?: RequestBoardRejectionAssignmentLike[] | null;
};

type DesignerRejectionSummary = {
  designerName: string | null;
  label: string;
  reason: string;
};

const normalizeStatus = (status?: string | null) =>
  String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');

const normalizeText = (value?: string | null) => {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
};

export const getDesignerRejectionSummary = (
  request: RequestBoardRejectionRequestLike,
): DesignerRejectionSummary | null => {
  const rejectedAssignment = (request.request_designers ?? []).find(
    (assignment) =>
      normalizeStatus(assignment.status) === 'rejected'
      && normalizeText(assignment.rejection_reason) != null,
  );

  if (!rejectedAssignment) {
    return null;
  }

  const reason = normalizeText(rejectedAssignment.rejection_reason);
  if (!reason) {
    return null;
  }

  const designerName = normalizeText(rejectedAssignment.designers?.users?.name);

  return {
    designerName,
    label: designerName ? `${designerName} 거절 사유` : '거절 사유',
    reason,
  };
};

export const requestNeedsDesignerRejectionReasonHydration = (
  request: RequestBoardRejectionRequestLike,
) =>
  (request.request_designers ?? []).some(
    (assignment) =>
      normalizeStatus(assignment.status) === 'rejected'
      && normalizeText(assignment.rejection_reason) == null,
  );

const getAssignmentMergeKey = (assignment: RequestBoardRejectionAssignmentLike) => {
  const id = assignment.id;
  if (typeof id === 'number' && Number.isFinite(id)) {
    return `id:${id}`;
  }

  const designerId = assignment.designer_id;
  if (typeof designerId === 'number' && Number.isFinite(designerId)) {
    return `designer:${designerId}`;
  }

  return null;
};

export const mergeDesignerRejectionReasonFromDetail = <
  TRequest extends RequestBoardRejectionRequestLike,
>(
  request: TRequest,
  detail: RequestBoardRejectionRequestLike | null | undefined,
): TRequest => {
  const detailAssignments = detail?.request_designers ?? [];
  if (detailAssignments.length === 0) {
    return request;
  }

  const detailByKey = new Map<string, RequestBoardRejectionAssignmentLike>();
  for (const assignment of detailAssignments) {
    const key = getAssignmentMergeKey(assignment);
    if (key) {
      detailByKey.set(key, assignment);
    }
  }

  let changed = false;
  const mergedAssignments = (request.request_designers ?? []).map((assignment) => {
    if (
      normalizeStatus(assignment.status) !== 'rejected'
      || normalizeText(assignment.rejection_reason) != null
    ) {
      return assignment;
    }

    const key = getAssignmentMergeKey(assignment);
    const detailAssignment = key ? detailByKey.get(key) : null;
    const detailReason = normalizeText(detailAssignment?.rejection_reason);
    if (!detailReason) {
      return assignment;
    }

    changed = true;
    return {
      ...assignment,
      rejection_reason: detailReason,
    };
  });

  if (!changed) {
    return request;
  }

  return {
    ...request,
    request_designers: mergedAssignments,
  };
};
