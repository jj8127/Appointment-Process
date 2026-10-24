export type DeleteAccountRole = 'fc' | 'admin' | 'manager';

export type DeleteAccountRequestBody = {
  appSessionToken?: string;
  residentId?: string;
  residentMask?: string;
  fcId?: string;
  role?: DeleteAccountRole;
  roleHint?: DeleteAccountRole;
  targetId?: string;
};

export type DeleteAccountSession = {
  role: DeleteAccountRole;
  phone: string;
  fcId?: string;
};

type DeleteAccountAuthorizationInput = {
  body: DeleteAccountRequestBody;
  authorizationHeader: string;
  internalSecretHeader: string;
  serviceRoleKey: string;
  internalSecret: string;
  session: DeleteAccountSession | null;
};

export type DeleteAccountAuthorizationResult =
  | {
      ok: true;
      mode: 'fc_self' | 'internal';
      targetRole: DeleteAccountRole;
      targetId: string;
    }
  | {
      ok: false;
      status: 401 | 403;
      code:
        | 'missing_app_session'
        | 'invalid_internal_authorization'
        | 'self_delete_role_forbidden'
        | 'self_delete_identity_missing'
        | 'self_delete_target_mismatch';
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDeleteAccountRole(value: unknown): value is DeleteAccountRole {
  return value === 'fc' || value === 'admin' || value === 'manager';
}

export function normalizeDeleteAccountPhone(value?: string | null): string {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

export function authorizeDeleteAccountRequest({
  body,
  authorizationHeader,
  internalSecretHeader,
  serviceRoleKey,
  internalSecret,
  session,
}: DeleteAccountAuthorizationInput): DeleteAccountAuthorizationResult {
  const isServiceRole = authorizationHeader === `Bearer ${serviceRoleKey}`;

  if (isServiceRole) {
    const targetId = String(body.targetId ?? '').trim();
    if (
      !internalSecret
      || internalSecretHeader !== internalSecret
      || !isDeleteAccountRole(body.role)
      || !UUID_PATTERN.test(targetId)
    ) {
      return {
        ok: false,
        status: 403,
        code: 'invalid_internal_authorization',
      };
    }
    return {
      ok: true,
      mode: 'internal',
      targetRole: body.role,
      targetId,
    };
  }

  if (!session) {
    return {
      ok: false,
      status: 401,
      code: 'missing_app_session',
    };
  }
  if (session.role !== 'fc') {
    return {
      ok: false,
      status: 403,
      code: 'self_delete_role_forbidden',
    };
  }

  const sessionFcId = String(session.fcId ?? '').trim();
  const sessionPhone = normalizeDeleteAccountPhone(session.phone);
  const requestedPhone = normalizeDeleteAccountPhone(body.residentId);
  if (!UUID_PATTERN.test(sessionFcId) || !sessionPhone || !requestedPhone) {
    return {
      ok: false,
      status: 403,
      code: 'self_delete_identity_missing',
    };
  }

  const requestedFcId = String(body.fcId ?? '').trim();
  const residentMaskPhone = normalizeDeleteAccountPhone(body.residentMask);
  const hasForeignSelector =
    body.role !== 'fc'
    || body.roleHint !== undefined
    || body.targetId !== undefined
    || (requestedFcId !== '' && requestedFcId !== sessionFcId)
    || requestedPhone !== sessionPhone
    || (residentMaskPhone !== '' && residentMaskPhone !== sessionPhone);
  if (hasForeignSelector) {
    return {
      ok: false,
      status: 403,
      code: 'self_delete_target_mismatch',
    };
  }

  return {
    ok: true,
    mode: 'fc_self',
    targetRole: 'fc',
    targetId: sessionFcId,
  };
}
