export const SIGNUP_COMPLETION_TOKEN_STORAGE_KEY = 'fc-onboarding/signup-completion-token-v1';

export function isSignupCompletionToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}
