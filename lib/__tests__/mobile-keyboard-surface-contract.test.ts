import {
  getAndroidKeyboardFootprint,
  getKeyboardOverlapFromRestingFrame,
  normalizeKeyboardPadding,
} from '@/lib/mobile-keyboard-layout';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

  it('builds a dynamic Android IME footprint from the keyboard and system inset', () => {
    expect(getAndroidKeyboardFootprint({
      androidApiLevel: 36,
      keyboardHeight: 327,
      safeAreaBottom: 48,
    })).toBe(375);
    expect(getAndroidKeyboardFootprint({
      androidApiLevel: 29,
      keyboardHeight: 375,
      safeAreaBottom: 48,
    })).toBe(375);
  });

  it('subtracts native window resize from the required keyboard movement', () => {
    expect(getKeyboardOverlapFromRestingFrame({
      keyboardFootprint: 375,
      restingBottom: 849,
      viewBottom: 849,
    })).toBe(375);
    expect(getKeyboardOverlapFromRestingFrame({
      keyboardFootprint: 375,
      restingBottom: 849,
      viewBottom: 474,
    })).toBe(0);
    expect(getKeyboardOverlapFromRestingFrame({
      keyboardFootprint: 375,
      restingBottom: 849,
      viewBottom: 649,
    })).toBe(175);
  });

  it('keeps chat inputs focused while measured bottom bars own keyboard overlap', () => {
    const readAppSource = (fileName: string) =>
      readFileSync(path.join(process.cwd(), 'app', fileName), 'utf8');
    const directSource = readAppSource('chat.tsx');
    const groupSource = readAppSource('group-chat.tsx');
    const requestSource = readAppSource('request-board-messenger.tsx');

    for (const source of [directSource, groupSource, requestSource]) {
      expect(source).toContain('<KeyboardSafeBottomBar>');
      expect(source).not.toContain(
        "behavior={Platform.OS === 'ios' ? 'padding' : undefined}",
      );
    }
    expect(directSource).not.toContain('editable={!sendingAttachments}');
    expect(groupSource).not.toContain('editable={canSendMessages && !uploading}');
    expect(requestSource).not.toContain('editable={!sending}');
  });

  it('raises board comment bars above the Android keyboard clearance area', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'components', 'KeyboardSafeBottomBar.tsx'),
      'utf8',
    );

    expect(source).toContain('measureInWindow');
    expect(source).toContain('getAndroidKeyboardFootprint');
    expect(source).toContain('getKeyboardOverlapFromRestingFrame');
    expect(source).toContain('restingBottomRef');
    expect(source).toContain('{ marginBottom: androidOverlap }');
    expect(source).not.toContain('translateY: -androidOverlap');
    expect(source).not.toMatch(/Platform\.OS === 'android' \? \d+/);
  });
});
