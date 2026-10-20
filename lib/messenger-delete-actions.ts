import { Alert } from 'react-native';

import { logger } from '@/lib/logger';

type MessengerDeleteFailure = {
  title?: string;
  message?: string;
};

type ConfirmMessengerDeleteOptions = {
  onDelete: () => Promise<void> | void;
  logScope?: string;
  failureTitle?: string;
  failureMessage?: string;
  formatFailure?: (error: unknown) => MessengerDeleteFailure;
  /** Runs right after the user confirms, before the request, so the screen can mark the message as deleting. */
  onStart?: () => void;
  /** Runs once the delete finished, whether it succeeded or failed. */
  onSettled?: () => void;
};

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return null;
}

export function confirmMessengerDelete({
  onDelete,
  logScope = 'messenger',
  failureTitle = '삭제 실패',
  failureMessage = '메시지를 삭제하지 못했습니다.',
  formatFailure,
  onStart,
  onSettled,
}: ConfirmMessengerDeleteOptions) {
  Alert.alert('메시지 삭제', '이 메시지를 삭제하시겠습니까?', [
    { text: '취소', style: 'cancel' },
    {
      text: '삭제',
      style: 'destructive',
      onPress: () => {
        onStart?.();
        void Promise.resolve()
          .then(onDelete)
          .catch((error) => {
          logger.warn(`[${logScope}] delete failed`, error);
          const formatted = formatFailure?.(error);
          Alert.alert(
            formatted?.title ?? failureTitle,
            formatted?.message ?? getErrorMessage(error) ?? failureMessage,
          );
          })
          .finally(() => onSettled?.());
      },
    },
  ]);
}
