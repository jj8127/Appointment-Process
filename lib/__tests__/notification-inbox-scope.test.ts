import {
  resolveNotificationInboxResidentId,
  shouldUsePersonalAdminNotificationInbox,
} from '../notification-inbox-scope';

describe('notification inbox scope', () => {
  it('keeps regular admin notifications in the shared admin inbox', () => {
    expect(
      resolveNotificationInboxResidentId({
        role: 'admin',
        residentId: '010-1111-2222',
        readOnly: false,
        staffType: 'admin',
      }),
    ).toBeNull();
    expect(
      shouldUsePersonalAdminNotificationInbox({
        role: 'admin',
        readOnly: false,
        staffType: 'admin',
      }),
    ).toBe(false);
  });

  it('uses a personal inbox for developers and read-only staff accounts', () => {
    expect(
      resolveNotificationInboxResidentId({
        role: 'admin',
        residentId: '010-3333-4444',
        readOnly: false,
        staffType: 'developer',
      }),
    ).toBe('01033334444');
    expect(
      resolveNotificationInboxResidentId({
        role: 'admin',
        residentId: '010-5555-6666',
        readOnly: true,
        staffType: null,
      }),
    ).toBe('01055556666');
  });

  it('always scopes FC notifications to the FC phone', () => {
    expect(
      resolveNotificationInboxResidentId({
        role: 'fc',
        residentId: '010-7777-8888',
      }),
    ).toBe('01077778888');
  });
});
