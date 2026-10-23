import { NEW_CARE_REQUEST_MESSAGE, buildCarePushPayloads, careAnswerMessage, overdueCareMessage, sendCarePush } from '../hospital-care-push';

describe('hospital care push', () => {
  it('notifies members only for final decisions and never includes request details', () => {
    expect(careAnswerMessage('reviewing')).toBeNull();
    expect(careAnswerMessage('cancelled')).toBeNull();
    for (const status of ['confirmed', 'adjusted', 'declined']) {
      const message = careAnswerMessage(status)!;
      expect(message.title).toContain('간병 예약');
      expect(`${message.title} ${message.body}`).not.toMatch(/병원 |\d{3}-?\d{3,4}-?\d{4}/);
    }
    expect(overdueCareMessage(2).body).toBe('첫 연락 기한을 넘긴 간병 예약 요청이 2건 있습니다.');
  });

  it('dedupes tokens and routes the tap with care data only', () => {
    expect(buildCarePushPayloads(['ExponentPushToken[a]', 'ExponentPushToken[a]', ''], NEW_CARE_REQUEST_MESSAGE)).toEqual([{
      to: 'ExponentPushToken[a]', title: NEW_CARE_REQUEST_MESSAGE.title, body: NEW_CARE_REQUEST_MESSAGE.body,
      sound: 'default', channelId: 'alerts', data: { kind: 'hospital_care' },
    }]);
  });

  it('returns only tokens Expo reports as unregistered', async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({ data: [
      { status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ] }), { status: 200 }));
    await expect(sendCarePush(['ExponentPushToken[a]', 'ExponentPushToken[b]'], NEW_CARE_REQUEST_MESSAGE, fetcher as unknown as typeof fetch))
      .resolves.toEqual(['ExponentPushToken[b]']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(sendCarePush([], NEW_CARE_REQUEST_MESSAGE, fetcher as unknown as typeof fetch)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
