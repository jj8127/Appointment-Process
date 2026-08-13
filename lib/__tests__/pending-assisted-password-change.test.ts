import {
  clearPendingAssistedPasswordChange,
  getPendingAssistedPasswordChange,
  setPendingAssistedPasswordChange,
} from '../pending-assisted-password-change';

describe('pending assisted password change', () => {
  afterEach(() => clearPendingAssistedPasswordChange());

  it('holds the one-purpose challenge only in memory and clears it', () => {
    setPendingAssistedPasswordChange('payload.signature', '2030-01-01T00:00:00.000Z');
    expect(getPendingAssistedPasswordChange()).toEqual({
      token: 'payload.signature',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    clearPendingAssistedPasswordChange();
    expect(getPendingAssistedPasswordChange()).toBeNull();
  });
});
