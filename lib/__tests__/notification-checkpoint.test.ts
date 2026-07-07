import { buildNotificationCheckpointKey } from '@/lib/notification-checkpoint';

describe('buildNotificationCheckpointKey', () => {
  it('uses stable guest/global/none defaults for unidentified sessions', () => {
    expect(
      buildNotificationCheckpointKey({
        role: null,
        residentId: '',
        requestBoardRole: null,
      }),
    ).toBe('lastNotificationCheckTime:guest:global:none');

    expect(
      buildNotificationCheckpointKey({
        role: null,
      }),
    ).toBe('lastNotificationCheckTime:guest:global:none');
  });

  it('trims resident id and includes request-board role to isolate bridge checkpoints', () => {
    expect(
      buildNotificationCheckpointKey({
        role: 'admin',
        residentId: ' 01058006018 ',
        requestBoardRole: 'fc',
      }),
    ).toBe('lastNotificationCheckTime:admin:01058006018:fc');

    expect(
      buildNotificationCheckpointKey({
        role: 'admin',
        residentId: '01058006018',
        requestBoardRole: 'designer',
      }),
    ).toBe('lastNotificationCheckTime:admin:01058006018:designer');
  });
});
