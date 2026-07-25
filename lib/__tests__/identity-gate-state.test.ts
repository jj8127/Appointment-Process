import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canAcceptIdentityGatedDestination } from '../identity-gate-state';

const base = {
  enabled: true,
  hydrated: true,
  role: 'fc' as const,
  residentId: '01000000000',
  isRequestBoardDesigner: false,
  isIdentityLoading: false,
};

describe('identity-gated notification destination acceptance', () => {
  it('blocks receipt completion until an FC identity is confirmed', () => {
    expect(
      canAcceptIdentityGatedDestination({
        ...base,
        identityCompleted: false,
      }),
    ).toBe(false);
    expect(
      canAcceptIdentityGatedDestination({
        ...base,
        isIdentityLoading: true,
        identityCompleted: true,
      }),
    ).toBe(false);
    expect(
      canAcceptIdentityGatedDestination({
        ...base,
        identityCompleted: true,
      }),
    ).toBe(true);
  });

  it('allows destinations that do not require the FC identity gate', () => {
    expect(
      canAcceptIdentityGatedDestination({
        ...base,
        enabled: false,
        hydrated: false,
        identityCompleted: false,
      }),
    ).toBe(true);
    expect(
      canAcceptIdentityGatedDestination({
        ...base,
        role: 'admin',
        identityCompleted: false,
      }),
    ).toBe(true);
    expect(
      canAcceptIdentityGatedDestination({
        ...base,
        isRequestBoardDesigner: true,
        identityCompleted: false,
      }),
    ).toBe(true);
  });

  it('keeps every identity-gated notification destination waiting for gate approval', () => {
    for (const screen of [
      'appointment.tsx',
      'consent.tsx',
      'docs-upload.tsx',
      'exam-apply.tsx',
      'exam-apply2.tsx',
      'hanwha-commission.tsx',
    ]) {
      const source = readFileSync(
        join(__dirname, '..', '..', 'app', screen),
        'utf8',
      );
      expect(source).toContain(
        'destinationAccepted: identityGateAccepted',
      );
      expect(source).toMatch(
        /loadState:[\s\S]{0,120}identityGateAccepted/,
      );
    }
  });
});
