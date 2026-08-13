export function canAcceptIdentityGatedDestination(input: {
  enabled: boolean;
  hydrated: boolean;
  role: 'admin' | 'fc' | null;
  residentId?: string | null;
  isRequestBoardDesigner: boolean;
  isIdentityLoading: boolean;
  identityCompleted?: boolean | null;
}): boolean {
  if (!input.enabled) return true;
  if (!input.hydrated || !input.role) return false;
  if (input.role !== 'fc' || input.isRequestBoardDesigner) return true;
  return Boolean(
    input.residentId
    && !input.isIdentityLoading
    && input.identityCompleted === true,
  );
}
