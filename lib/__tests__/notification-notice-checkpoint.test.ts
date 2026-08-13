import {
  advanceNotificationNoticeCheckpointWithStorage,
  buildNotificationNoticeCheckpointKey,
  getNotificationNoticeCheckpointWithStorage,
  NOTIFICATION_NOTICE_EPOCH,
} from '../notification-notice-checkpoint';

const scope = {
  role: 'fc' as const,
  residentId: '01011112222',
  requestBoardRole: null,
};

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe('notification notice checkpoint', () => {
  it('keeps checkpoints isolated by signed-in viewer scope', () => {
    expect(buildNotificationNoticeCheckpointKey(scope)).not.toBe(
      buildNotificationNoticeCheckpointKey({
        ...scope,
        residentId: '01033334444',
      }),
    );
    expect(buildNotificationNoticeCheckpointKey(scope)).not.toBe(
      buildNotificationNoticeCheckpointKey({
        ...scope,
        requestBoardRole: 'designer',
      }),
    );
  });

  it('uses epoch before the viewer has observed the notice list', async () => {
    const storage = createStorage();
    await expect(
      getNotificationNoticeCheckpointWithStorage(scope, storage),
    ).resolves.toBe(NOTIFICATION_NOTICE_EPOCH);
  });

  it('advances monotonically so an older concurrent load cannot move it back', async () => {
    const storage = createStorage();
    const later = '2026-07-27T02:00:00.000Z';
    const earlier = '2026-07-27T01:00:00.000Z';

    await advanceNotificationNoticeCheckpointWithStorage(scope, later, storage);
    await expect(
      advanceNotificationNoticeCheckpointWithStorage(scope, earlier, storage),
    ).resolves.toBe(later);
    await expect(
      getNotificationNoticeCheckpointWithStorage(scope, storage),
    ).resolves.toBe(later);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid observation boundary', async () => {
    const storage = createStorage();
    await expect(
      advanceNotificationNoticeCheckpointWithStorage(scope, 'not-a-date', storage),
    ).rejects.toThrow('Invalid notification notice checkpoint');
  });
});
