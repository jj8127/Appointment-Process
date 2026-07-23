import {
  classifyExpoPushDelivery,
  mergeExpoPushDeliverySummaries,
  toExpoPushDeliveryOutcome,
} from '../expo-push-delivery';

describe('Expo push delivery classification', () => {
  it('rejects every attempted delivery when Expo returns a non-2xx response', () => {
    expect(classifyExpoPushDelivery(2, 503, {
      data: [{ status: 'ok', id: 'must-not-be-retained' }, { status: 'ok' }],
    })).toEqual({ attempted: 2, accepted: 0, rejected: 2 });
  });

  it.each([
    null,
    'not-json',
    {},
    { data: null },
    { data: { status: 'ok' } },
  ])('rejects every attempted delivery for a malformed 2xx body', (body) => {
    expect(classifyExpoPushDelivery(2, 200, body)).toEqual({
      attempted: 2,
      accepted: 0,
      rejected: 2,
    });
  });

  it('counts a 200 ticket with status:error as rejected', () => {
    expect(classifyExpoPushDelivery(1, 200, {
      data: [{
        status: 'error',
        message: 'provider detail must not be retained',
        details: { error: 'DeviceNotRegistered' },
      }],
    })).toEqual({ attempted: 1, accepted: 0, rejected: 1 });
  });

  it('counts mixed tickets and treats missing tickets as rejected', () => {
    expect(classifyExpoPushDelivery(4, 200, {
      data: [
        { status: 'ok', id: 'provider-ticket-id' },
        { status: 'error', message: 'rejected' },
        { status: 'ok' },
      ],
    })).toEqual({ attempted: 4, accepted: 2, rejected: 2 });
  });

  it('ignores surplus tickets and returns only the privacy-safe delivery counts', () => {
    const result = classifyExpoPushDelivery(1, 200, {
      data: [
        { status: 'ok', id: 'provider-ticket-id' },
        { status: 'error', message: 'surplus provider detail' },
      ],
    });

    expect(result).toEqual({ attempted: 1, accepted: 1, rejected: 0 });
    expect(Object.keys(result).sort()).toEqual(['accepted', 'attempted', 'rejected']);
  });

  it('merges chunk summaries without retaining chunk response details', () => {
    expect(mergeExpoPushDeliverySummaries([
      { attempted: 100, accepted: 98, rejected: 2 },
      { attempted: 3, accepted: 1, rejected: 2 },
    ])).toEqual({ attempted: 103, accepted: 99, rejected: 4 });
  });

  it('confirms delivery only when every attempted ticket is accepted', () => {
    expect(toExpoPushDeliveryOutcome({ attempted: 2, accepted: 1, rejected: 1 })).toEqual({
      ok: false,
      sent: 1,
      delivery: { attempted: 2, accepted: 1, rejected: 1 },
      message: 'Push provider delivery was not fully confirmed',
    });
    expect(toExpoPushDeliveryOutcome({ attempted: 2, accepted: 0, rejected: 2 })).toEqual({
      ok: false,
      sent: 0,
      delivery: { attempted: 2, accepted: 0, rejected: 2 },
      message: 'Push provider delivery was not fully confirmed',
    });
    expect(toExpoPushDeliveryOutcome({ attempted: 0, accepted: 0, rejected: 0 })).toEqual({
      ok: false,
      sent: 0,
      delivery: { attempted: 0, accepted: 0, rejected: 0 },
      message: 'Push provider delivery was not fully confirmed',
    });
    expect(toExpoPushDeliveryOutcome({ attempted: 2, accepted: 2, rejected: 0 })).toEqual({
      ok: true,
      sent: 2,
      delivery: { attempted: 2, accepted: 2, rejected: 0 },
    });
  });
});
