import {
  classifyFcNotifyDeliveryFromInvoke,
  classifyFcNotifyDeliveryResult,
} from '@/lib/fc-notify-delivery-result';

describe('fc-notify delivery result', () => {
  it('confirms only a persisted notification with at least one device target', () => {
    expect(classifyFcNotifyDeliveryResult({
      data: { ok: true, logged: true, sent: 2 },
      error: null,
    })).toEqual({ confirmed: true, sent: 2 });
  });

  it.each([
    [{ data: null, error: new Error('network') }, 'transport_error'],
    [{ data: null, error: null }, 'invalid_response'],
    [{ data: { ok: false, logged: true, sent: 1 }, error: null }, 'downstream_error'],
    [{ data: { ok: true, logged: false, sent: 1 }, error: null }, 'not_logged'],
    [{ data: { ok: true, logged: true, sent: 0 }, error: null }, 'no_device_target'],
  ] as const)('rejects an unconfirmed result as %s', (result, reason) => {
    expect(classifyFcNotifyDeliveryResult(result)).toEqual({ confirmed: false, reason });
  });

  it('turns a thrown transport failure into an unconfirmed result', async () => {
    await expect(classifyFcNotifyDeliveryFromInvoke(async () => {
      throw new Error('network');
    })).resolves.toEqual({
      confirmed: false,
      reason: 'transport_error',
    });
  });
});
