import {
  collectPresenceSnapshotBatches,
  parsePresenceSnapshotList,
} from '../presence-read-response';

const snapshot = (phone = '01011112222') => ({
  phone,
  garam_in_at: '2026-10-13T00:00:00.000Z',
  garam_link_at: null,
  last_seen_at: '2026-10-13T00:00:00.000Z',
  is_online: true,
  updated_at: '2026-10-13T00:00:00.000Z',
});

describe('presence read response contract', () => {
  it('accepts unique, requested presence snapshots and authorized subsets', () => {
    expect(parsePresenceSnapshotList([snapshot()], ['010-1111-2222'])).toEqual([snapshot()]);
    expect(parsePresenceSnapshotList([], ['01011112222'])).toEqual([]);
  });

  it('rejects missing arrays, malformed timestamps, duplicates, and out-of-scope phones', () => {
    expect(() => parsePresenceSnapshotList(undefined, ['01011112222'])).toThrow('활동 상태');
    expect(() => parsePresenceSnapshotList([
      { ...snapshot(), last_seen_at: '2026-10-12T00:00:00.000Z' },
    ], ['01011112222'])).toThrow('활동 상태');
    expect(() => parsePresenceSnapshotList([snapshot(), snapshot()], ['01011112222']))
      .toThrow('활동 상태');
    expect(() => parsePresenceSnapshotList([snapshot('01099998888')], ['01011112222']))
      .toThrow('활동 상태');
  });

  it('requests every normalized phone in bounded batches and validates the combined result', async () => {
    const phones = Array.from({ length: 201 }, (_, index) => `010${String(index).padStart(8, '0')}`);
    const requestedBatches: string[][] = [];
    const rows = await collectPresenceSnapshotBatches(phones, async (batch) => {
      requestedBatches.push(batch);
      return batch.map((phone) => snapshot(phone));
    });

    expect(requestedBatches.map((batch) => batch.length)).toEqual([100, 100, 1]);
    expect(rows.map((row) => row.phone)).toEqual(phones);
  });

  it('rejects duplicate or out-of-scope rows across batches', async () => {
    const phones = Array.from({ length: 101 }, (_, index) => `010${String(index).padStart(8, '0')}`);
    await expect(collectPresenceSnapshotBatches(phones, async (batch) => (
      batch[0] === phones[100] ? [snapshot(phones[0])] : batch.map((phone) => snapshot(phone))
    ))).rejects.toThrow('활동 상태');
  });
});
