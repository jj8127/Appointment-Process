export type RequestBoardAppRole = 'admin' | 'fc' | 'manager' | null | undefined;
export type RequestBoardBridgeRole = 'fc' | 'designer' | null | undefined;
export type RequestBoardStaffType = 'admin' | 'developer' | string | null | undefined;

export type RequestBoardPermissionInput = {
  role?: RequestBoardAppRole;
  readOnly?: boolean;
  staffType?: RequestBoardStaffType;
  requestBoardRole?: RequestBoardBridgeRole;
  isRequestBoardDesigner?: boolean;
};

const isReadOnlyAdminSession = ({ role, readOnly }: RequestBoardPermissionInput) =>
  role === 'admin' && readOnly === true;

export function canUseRequestBoardAsFc(input: RequestBoardPermissionInput): boolean {
  if (input.isRequestBoardDesigner || input.requestBoardRole === 'designer') {
    return false;
  }
  if (isReadOnlyAdminSession(input) || input.role === 'admin') {
    return false;
  }
  return input.role === 'fc';
}

export const canManageRequestBoardFcCodes = canUseRequestBoardAsFc;
export const canMakeRequestBoardFcDecision = canUseRequestBoardAsFc;
