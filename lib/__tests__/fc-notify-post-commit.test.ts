import { Alert } from 'react-native';

import { presentPostCommitNotificationDelivery } from '../fc-notify-post-commit';

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
}));

describe('post-commit notification presentation', () => {
  const base = {
    successTitle: '저장 완료',
    successMessage: '내용이 저장되었습니다.',
    notificationLabel: '관리자',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows no-device delivery as plain success without retry', () => {
    const alert = Alert.alert as jest.Mock;
    const retryNotification = jest.fn();

    presentPostCommitNotificationDelivery({
      ...base,
      delivery: {
        confirmed: true,
        notificationStored: true,
        sent: 0,
        state: 'stored_no_registered_device',
      },
      retryNotification,
    });

    expect(alert).toHaveBeenCalledWith(
      '저장 완료',
      '내용이 저장되었습니다.',
      expect.any(Array),
    );
    expect(retryNotification).not.toHaveBeenCalled();
  });

  it('retries notification only and never repeats the committed domain action', async () => {
    const calls: string[] = [];
    const alert = Alert.alert as jest.Mock;
    const retryNotification = jest.fn(async () => {
      calls.push('notification');
      return {
        confirmed: true as const,
        notificationStored: true as const,
        sent: 1,
        state: 'stored_and_pushed' as const,
      };
    });

    presentPostCommitNotificationDelivery({
      ...base,
      delivery: {
        confirmed: false,
        notificationStored: false,
        reason: 'persistence_failed',
      },
      retryNotification,
    });

    const buttons = alert.mock.calls[0][2];
    const retryButton = buttons?.find(
      (button: { text?: string }) => button.text === '알림 다시 등록',
    );
    retryButton?.onPress?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(retryNotification).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['notification']);
    expect(alert).toHaveBeenLastCalledWith(
      '알림 등록 완료',
      expect.stringContaining('알림을 등록했습니다.'),
      expect.any(Array),
    );
  });

  it('does not offer retry for an invalid recipient', () => {
    const alert = Alert.alert as jest.Mock;

    presentPostCommitNotificationDelivery({
      ...base,
      delivery: {
        confirmed: false,
        notificationStored: false,
        reason: 'invalid_recipient',
      },
      retryNotification: jest.fn(),
    });

    expect(alert.mock.calls[0][2]).toHaveLength(1);
    expect(alert.mock.calls[0][0]).toContain('알림 대상 오류');
  });
});
