import {
  classifyFcNotifyDeliveryFromInvoke,
  classifyFcNotifyDeliveryResult,
  getFcNotifyDeliveryUiKind,
} from '@/lib/fc-notify-delivery-result';

describe('fc-notify delivery result', () => {
  it('confirms a persisted notification with a provider-accepted device target', () => {
    expect(classifyFcNotifyDeliveryResult({
      data: {
        ok: true,
        logged: true,
        sent: 2,
        delivery: { attempted: 2, accepted: 2, rejected: 0 },
      },
      error: null,
    })).toEqual({
      confirmed: true,
      notificationStored: true,
      sent: 2,
      state: 'stored_and_pushed',
    });
  });

  it('treats a stored inbox row with no registered device as informational success', () => {
    expect(classifyFcNotifyDeliveryResult({
      data: {
        ok: false,
        logged: true,
        sent: 0,
        delivery: { attempted: 0, accepted: 0, rejected: 0 },
      },
      error: null,
    })).toEqual({
      confirmed: true,
      notificationStored: true,
      sent: 0,
      state: 'stored_no_registered_device',
    });
  });

  it.each([
    ['accepted', 'stored_and_pushed', 2],
    ['no_registered_device', 'stored_no_registered_device', 0],
    ['provider_rejected', 'stored_push_unconfirmed', 0],
    ['not_attempted', 'stored_push_unconfirmed', 0],
  ] as const)(
    'treats canonical stored delivery metadata with %s push status as success',
    (pushStatus, state, sent) => {
      expect(classifyFcNotifyDeliveryResult({
        data: {
          ok: pushStatus === 'accepted',
          delivery: {
            notificationStored: true,
            pushStatus,
            accepted: sent,
          },
        },
        error: null,
      })).toEqual({
        confirmed: true,
        notificationStored: true,
        sent,
        state,
      });
    },
  );

  it('preserves a canonical persistence failure even when transport reports HTTP error', () => {
    expect(classifyFcNotifyDeliveryResult({
      data: {
        ok: false,
        delivery: {
          notificationStored: false,
          pushStatus: 'not_attempted',
        },
      },
      error: new Error('HTTP 500'),
    })).toEqual({
      confirmed: false,
      notificationStored: false,
      reason: 'persistence_failed',
    });
  });

  it.each([
    'accepted',
    'no_registered_device',
    'provider_rejected',
    'not_attempted',
  ] as const)(
    'never exposes a sender retry warning when inbox storage succeeded (%s)',
    (pushStatus) => {
      const delivery = classifyFcNotifyDeliveryResult({
        data: {
          ok: true,
          delivery: {
            notificationStored: true,
            pushStatus,
          },
        },
        error: null,
      });
      expect(delivery.notificationStored).toBe(true);
      expect(getFcNotifyDeliveryUiKind(delivery)).not.toBe('retryable_failure');
    },
  );

  it.each([
    [
      { data: null, error: new Error('network') },
      {
        confirmed: false,
        notificationStored: null,
        reason: 'transport_error',
      },
    ],
    [
      { data: null, error: null },
      {
        confirmed: false,
        notificationStored: null,
        reason: 'invalid_response',
      },
    ],
    [
      {
        data: {
          ok: false,
          logged: true,
          sent: 0,
          delivery: { attempted: 1, accepted: 0, rejected: 1 },
        },
        error: null,
      },
      {
        confirmed: true,
        notificationStored: true,
        sent: 0,
        state: 'stored_push_unconfirmed',
      },
    ],
    [
      { data: { ok: false, logged: false, sent: 0 }, error: null },
      {
        confirmed: false,
        notificationStored: false,
        reason: 'persistence_failed',
      },
    ],
    [
      {
        data: {
          ok: false,
          logged: false,
          reason: 'invalid_recipient',
        },
        error: null,
      },
      {
        confirmed: false,
        notificationStored: false,
        reason: 'invalid_recipient',
      },
    ],
  ] as const)('classifies an actionable delivery outcome', (result, expected) => {
    expect(classifyFcNotifyDeliveryResult(result)).toEqual(expected);
  });

  it('turns a thrown transport failure into an unconfirmed result', async () => {
    await expect(classifyFcNotifyDeliveryFromInvoke(async () => {
      throw new Error('network');
    })).resolves.toEqual({
      confirmed: false,
      notificationStored: null,
      reason: 'transport_error',
    });
  });

  it('maps delivery taxonomy to distinct UI actions', () => {
    expect(getFcNotifyDeliveryUiKind({
      confirmed: true,
      notificationStored: true,
      sent: 0,
      state: 'stored_no_registered_device',
    })).toBe('inbox_only');
    expect(getFcNotifyDeliveryUiKind({
      confirmed: true,
      notificationStored: true,
      sent: 0,
      state: 'stored_push_unconfirmed',
    })).toBe('complete');
    expect(getFcNotifyDeliveryUiKind({
      confirmed: false,
      notificationStored: false,
      reason: 'persistence_failed',
    })).toBe('retryable_failure');
    expect(getFcNotifyDeliveryUiKind({
      confirmed: false,
      notificationStored: false,
      reason: 'invalid_recipient',
    })).toBe('invalid_recipient');
  });
});
