import { normalizeKeyboardPadding } from '@/lib/mobile-keyboard-layout';

type KeyboardAuditResult = {
  discovered: string[];
  registered: string[];
  errors: string[];
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runAudit } = require('../../scripts/audit/mobile-keyboard-surface-audit.cjs') as {
  runAudit: () => KeyboardAuditResult;
};

describe('mobile keyboard surface contract', () => {
  it('keeps the discovered input surfaces identical to the reviewed registry', () => {
    const result = runAudit();

    expect(result.errors).toEqual([]);
    expect(result.discovered).toEqual(result.registered);
    expect(result.discovered.length).toBeGreaterThan(30);
  });

  it('preserves explicit Android scroll room instead of assuming adjustResize always succeeds', () => {
    expect(normalizeKeyboardPadding(320)).toBe(320);
    expect(normalizeKeyboardPadding(0)).toBe(0);
    expect(normalizeKeyboardPadding(-10)).toBe(0);
    expect(normalizeKeyboardPadding(Number.NaN)).toBe(0);
  });
});
