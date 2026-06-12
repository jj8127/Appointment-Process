type PushRegistrationRole = 'admin' | 'fc' | null;
type PushRegistrationRequestBoardRole = 'fc' | 'designer' | null;
export type PushRegistrationDeviceRole = 'admin' | 'fc' | 'manager';

type BuildPushRegistrationAttemptKeyInput = {
  hydrated: boolean;
  role: PushRegistrationRole;
  residentId: string | null | undefined;
  requestBoardRole: PushRegistrationRequestBoardRole;
};

export function buildPushRegistrationAttemptKey({
  hydrated,
  role,
  residentId,
  requestBoardRole,
}: BuildPushRegistrationAttemptKeyInput): string | null {
  if (!hydrated || !role || !residentId) {
    return null;
  }

  const pushRole = resolvePushRegistrationDeviceRole({ role, requestBoardRole });
  if (!pushRole) return null;

  return `${pushRole}:${residentId}:${requestBoardRole ?? 'none'}`;
}

export function resolvePushRegistrationDeviceRole(input: {
  role: PushRegistrationRole;
  requestBoardRole: PushRegistrationRequestBoardRole;
}): PushRegistrationDeviceRole | null {
  if (!input.role) return null;
  if (input.requestBoardRole === 'designer') return 'manager';
  return input.role;
}
