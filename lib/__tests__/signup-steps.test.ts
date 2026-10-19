import { advanceStackReveal, getStackOrder, PLATFORM_SIGNUP_STEPS, SIGNUP_STEPS } from '@/lib/signup-steps';

describe('stacked signup questions', () => {
  it('shows the newest question on top of the answered ones', () => {
    expect(getStackOrder(SIGNUP_STEPS, 1)).toEqual(['name']);
    expect(getStackOrder(SIGNUP_STEPS, 3)).toEqual(['carrier', 'phone', 'name']);
    expect(getStackOrder(PLATFORM_SIGNUP_STEPS, 99)).toEqual([...PLATFORM_SIGNUP_STEPS].reverse());
  });

  it('reveals the next question only when the newest one is answered', () => {
    expect(advanceStackReveal(PLATFORM_SIGNUP_STEPS, 1, 'name')).toEqual({ revealed: 2, advanced: true });
    // Editing an earlier answer keeps the stack where it is.
    expect(advanceStackReveal(PLATFORM_SIGNUP_STEPS, 4, 'phone')).toEqual({ revealed: 4, advanced: false });
    // The last question has nothing after it.
    expect(advanceStackReveal(SIGNUP_STEPS, SIGNUP_STEPS.length, 'referral')).toEqual({ revealed: SIGNUP_STEPS.length, advanced: false });
  });
});
