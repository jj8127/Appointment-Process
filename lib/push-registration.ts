type PushRegistrationRole = 'admin' | 'fc' | null;
type PushRegistrationRequestBoardRole = 'fc' | 'designer' | null;

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

  const pushRole = requestBoardRole === 'designer' ? 'fc' : role;
  return `${pushRole}:${residentId}:${requestBoardRole ?? 'none'}`;
}
