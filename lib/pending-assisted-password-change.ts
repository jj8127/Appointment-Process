export type PendingAssistedPasswordChange = {
  token: string;
  expiresAt: string | null;
};

let pendingChallenge: PendingAssistedPasswordChange | null = null;

export function setPendingAssistedPasswordChange(
  token: string,
  expiresAt?: string | null,
) {
  const normalizedToken = String(token ?? '').trim();
  pendingChallenge = normalizedToken
    ? {
      token: normalizedToken,
      expiresAt: String(expiresAt ?? '').trim() || null,
    }
    : null;
}

export function getPendingAssistedPasswordChange() {
  return pendingChallenge;
}

export function clearPendingAssistedPasswordChange() {
  pendingChallenge = null;
}
