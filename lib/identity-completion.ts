type IdentityCompletionRow = {
  identity_completed?: boolean | null;
  [key: string]: unknown;
} | null | undefined;

export const normalizeIdentityCompleted = (row: IdentityCompletionRow) => row?.identity_completed === true;
