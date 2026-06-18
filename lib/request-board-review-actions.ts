type DesignerRequestDetailActionInput = {
  isRequestBoardDesigner: boolean;
  assignmentStatus?: string | null;
};

type DesignerRequestDetailActions = {
  canRespond: boolean;
  canAccept: boolean;
  canReject: boolean;
};

const normalizeStatus = (status?: string | null) =>
  String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');

export const normalizeDesignerRejectReason = (reason?: string | null) => {
  const trimmed = String(reason ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const getDesignerRequestDetailActions = ({
  isRequestBoardDesigner,
  assignmentStatus,
}: DesignerRequestDetailActionInput): DesignerRequestDetailActions => {
  const status = normalizeStatus(assignmentStatus);
  const canAccept = isRequestBoardDesigner && status === 'pending';
  const canReject = isRequestBoardDesigner && (status === 'pending' || status === 'accepted');

  return {
    canRespond: canAccept || canReject,
    canAccept,
    canReject,
  };
};
