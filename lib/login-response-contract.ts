export type LoginSuccess = {
  ok: true;
  role: 'admin' | 'fc' | 'manager';
  residentId: string;
  displayName: string;
  staffType: 'admin' | 'developer' | null;
  requestBoardBridgeToken: string | null;
  appSessionToken: string;
  requestBoardRole: 'fc' | 'designer' | null;
};

const LOGIN_RESPONSE_ERROR = '로그인 응답을 확인하지 못했습니다. 다시 시도해주세요.';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

export function parseLoginSuccessResponse(value: unknown, expectedResidentId: string): LoginSuccess {
  if (!isRecord(value)
    || value.ok !== true
    || (value.role !== 'admin' && value.role !== 'fc' && value.role !== 'manager')
    || value.residentId !== expectedResidentId
    || !isNonEmptyString(value.displayName)
    || !isNonEmptyString(value.appSessionToken)
    || (value.requestBoardBridgeToken !== undefined
      && !isNonEmptyString(value.requestBoardBridgeToken))) {
    throw new Error(LOGIN_RESPONSE_ERROR);
  }

  const bridgeToken = typeof value.requestBoardBridgeToken === 'string'
    ? value.requestBoardBridgeToken.trim()
    : null;

  if (value.role === 'admin') {
    if ((value.staffType !== 'admin' && value.staffType !== 'developer')
      || (value.staffType === 'developer'
        ? value.requestBoardRole !== 'fc'
        : value.requestBoardRole !== null)) {
      throw new Error(LOGIN_RESPONSE_ERROR);
    }
    return {
      ok: true,
      role: value.role,
      residentId: value.residentId,
      displayName: value.displayName.trim(),
      staffType: value.staffType,
      requestBoardBridgeToken: bridgeToken,
      appSessionToken: value.appSessionToken.trim(),
      requestBoardRole: value.staffType === 'developer' ? 'fc' : null,
    };
  }

  if (value.staffType !== undefined && value.staffType !== null) {
    throw new Error(LOGIN_RESPONSE_ERROR);
  }
  if (value.role === 'manager' && value.requestBoardRole !== 'fc') {
    throw new Error(LOGIN_RESPONSE_ERROR);
  }
  if (value.role === 'fc'
    && value.requestBoardRole !== 'fc'
    && value.requestBoardRole !== 'designer') {
    throw new Error(LOGIN_RESPONSE_ERROR);
  }
  const requestBoardRole: 'fc' | 'designer' = value.requestBoardRole === 'designer'
    ? 'designer'
    : 'fc';

  return {
    ok: true,
    role: value.role,
    residentId: value.residentId,
    displayName: value.displayName.trim(),
    staffType: null,
    requestBoardBridgeToken: bridgeToken,
    appSessionToken: value.appSessionToken.trim(),
    requestBoardRole,
  };
}
