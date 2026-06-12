import {
  buildPushRegistrationAttemptKey,
  resolvePushRegistrationDeviceRole,
} from '@/lib/push-registration';

describe('buildPushRegistrationAttemptKey', () => {
  it('returns null until the session is hydrated and identified', () => {
    expect(
      buildPushRegistrationAttemptKey({
        hydrated: false,
        role: 'fc',
        residentId: '01051078127',
        requestBoardRole: null,
      }),
    ).toBeNull();

    expect(
      buildPushRegistrationAttemptKey({
        hydrated: true,
        role: 'fc',
        residentId: '',
        requestBoardRole: null,
      }),
    ).toBeNull();
  });

  it('uses manager push scope for request-board designers', () => {
    expect(
      buildPushRegistrationAttemptKey({
        hydrated: true,
        role: 'fc',
        residentId: '01051078127',
        requestBoardRole: 'designer',
      }),
    ).toBe('manager:01051078127:designer');
  });

  it('keeps admin scope for internal admin sessions', () => {
    expect(
      buildPushRegistrationAttemptKey({
        hydrated: true,
        role: 'admin',
        residentId: '01058006018',
        requestBoardRole: 'fc',
      }),
    ).toBe('admin:01058006018:fc');
  });
});

describe('resolvePushRegistrationDeviceRole', () => {
  it('registers FC and admin mobile sessions for push tokens', () => {
    expect(resolvePushRegistrationDeviceRole({ role: 'fc', requestBoardRole: null })).toBe('fc');
    expect(resolvePushRegistrationDeviceRole({ role: 'admin', requestBoardRole: null })).toBe('admin');
    expect(resolvePushRegistrationDeviceRole({ role: 'admin', requestBoardRole: 'fc' })).toBe('admin');
  });

  it('keeps request-board designers on the manager token scope', () => {
    expect(resolvePushRegistrationDeviceRole({ role: 'fc', requestBoardRole: 'designer' })).toBe('manager');
    expect(resolvePushRegistrationDeviceRole({ role: 'admin', requestBoardRole: 'designer' })).toBe('manager');
  });
});
