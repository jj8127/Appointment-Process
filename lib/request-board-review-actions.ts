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
  const canRespond = isRequestBoardDesigner && normalizeStatus(assignmentStatus) === 'pending';

  return {
    canRespond,
    canAccept: canRespond,
    canReject: canRespond,
  };
};
