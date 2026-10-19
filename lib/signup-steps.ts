/**
 * Signup-style forms ask one question at a time and stack answered questions below the new one,
 * following the 2026-10-16 Shinhan SOL Life recording the user chose as the reference.
 */

/** Durations measured frame by frame from the reference recording (30fps); the user chose the original speed. */
export const SIGNUP_MOTION = {
  /** New question slides down from above while earlier answers move down. */
  insert: 300,
  /** The new question's label appears in the last part of the insert. */
  labelDelay: 200,
  label: 100,
  /** Focus moves into the new question just before the insert settles. */
  focusDelay: 270,
  /** Bottom sheet rise and dim fade. */
  sheet: 300,
  /** One sheet's content cross-fades into the next question's content. */
  sheetSwap: 330,
  /** The picked option stays highlighted for a moment before the sheet moves on. */
  pickHold: 60,
  /** The 다음 button docks above the keyboard once the answer is not empty. */
  nextBar: 66,
} as const;

/** 모두온 common signup; consent (and a family-care invitation) follow in the final sheet. */
export const PLATFORM_SIGNUP_STEPS = ['name', 'phone', 'code', 'password', 'confirmation'] as const;
export type PlatformSignupStep = (typeof PLATFORM_SIGNUP_STEPS)[number];

/** 가람in additional information for a common member; pickers chain in one sheet before the typed answers. */
export const INSURANCE_ENROLLMENT_STEPS = ['affiliation', 'carrier', 'license', 'email', 'referral'] as const;
export type InsuranceEnrollmentStep = (typeof INSURANCE_ENROLLMENT_STEPS)[number];

/** Questions shown so far, newest first. */
export function getStackOrder<T>(steps: readonly T[], revealed: number) {
  return steps.slice(0, Math.max(1, Math.min(revealed, steps.length))).reverse();
}

/**
 * Answering the newest question reveals the next one; re-answering an earlier question
 * (editing) leaves the stack as it is.
 */
export function advanceStackReveal<T>(steps: readonly T[], revealed: number, answered: T) {
  const index = steps.indexOf(answered);
  if (index !== revealed - 1) return { revealed, advanced: false };
  const next = Math.min(steps.length, revealed + 1);
  return { revealed: next, advanced: next > revealed };
}
