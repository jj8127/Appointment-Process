import { buildPushRegistrationAttemptKey } from '@/lib/push-registration';

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

  it('uses fc push scope for request-board designers', () => {
    expect(
      buildPushRegistrationAttemptKey({
        hydrated: true,
        role: 'fc',
        residentId: '01051078127',
        requestBoardRole: 'designer',
      }),
    ).toBe('fc:01051078127:designer');
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
