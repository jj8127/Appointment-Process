export type AppRoleForRequestBoard = 'admin' | 'fc' | 'manager' | null;
export type RequestBoardRole = 'fc' | 'designer' | null;

export const canUseRequestBoardSession = (
  role: AppRoleForRequestBoard,
  readOnly: boolean,
) => role === 'fc' || role === 'manager' || (role === 'admin' && readOnly);

export const deriveRequestBoardFlags = (
  appRole: AppRoleForRequestBoard,
  requestBoardRole: RequestBoardRole,
) => ({
  requestBoardRole,
  isRequestBoardDesigner: requestBoardRole === 'designer' && appRole === 'fc',
});

export const shouldForceRequestBoardRelogin = (input: {
  authenticated: boolean;
  hasBridgeToken: boolean;
  hasAppSessionToken: boolean;
}) => input.authenticated && !input.hasBridgeToken && !input.hasAppSessionToken;
