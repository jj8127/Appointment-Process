import { Alert } from 'react-native';

import {
  getFcNotifyDeliveryUiKind,
  type FcNotifyDeliveryResult,
} from './fc-notify-delivery-result';

type PostCommitNotificationCopy = {
  successTitle: string;
  successMessage: string;
  notificationLabel: string;
};

export type PresentPostCommitNotificationInput =
  PostCommitNotificationCopy & {
    delivery: FcNotifyDeliveryResult;
    retryNotification: () => Promise<FcNotifyDeliveryResult>;
    onDone?: () => void;
  };

function presentDeliveryResult(
  input: PresentPostCommitNotificationInput,
  isRetry: boolean,
): void {
  const kind = getFcNotifyDeliveryUiKind(input.delivery);
  if (kind === 'complete') {
    Alert.alert(
      isRetry ? '알림 등록 완료' : input.successTitle,
      isRetry
        ? `${input.notificationLabel} 알림을 등록했습니다.`
        : input.successMessage,
      [{ text: '확인', onPress: input.onDone }],
    );
    return;
  }
  if (kind === 'inbox_only') {
    Alert.alert(
      input.successTitle,
      input.successMessage,
      [{ text: '확인', onPress: input.onDone }],
    );
    return;
  }
  if (kind === 'invalid_recipient') {
    Alert.alert(
      `${input.successTitle} · 알림 대상 오류`,
      `${input.successMessage}\n\n알림을 받을 사용자를 확인할 수 없습니다. 관리자에게 대상 계정 상태를 확인해주세요.`,
      [{ text: '확인', onPress: input.onDone }],
    );
    return;
  }

  const retry = async () => {
    const retryDelivery = await input.retryNotification();
    presentDeliveryResult(
      { ...input, delivery: retryDelivery },
      true,
    );
  };
  Alert.alert(
    `${input.successTitle} · 알림 등록 실패`,
    `${input.successMessage}\n\n${input.notificationLabel} 알림을 등록하지 못했습니다. 저장된 내용은 다시 제출하지 말고 알림만 다시 등록해 주세요.`,
    [
      { text: '나중에', onPress: input.onDone },
      { text: '알림 다시 등록', onPress: () => void retry() },
    ],
  );
}

export function presentPostCommitNotificationDelivery(
  input: PresentPostCommitNotificationInput,
): void {
  presentDeliveryResult(input, false);
}
