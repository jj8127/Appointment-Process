import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';

import { logger } from '@/lib/logger';

type CopyTextWithFeedbackOptions = {
  emptyTitle?: string;
  emptyMessage?: string;
  successTitle?: string;
  successMessage?: string;
  failureTitle?: string;
  failureMessage?: string;
  logScope?: string;
};

export async function copyTextWithFeedback(
  rawText: string | null | undefined,
  {
    emptyTitle = '복사할 수 없어요',
    emptyMessage = '복사할 메시지 내용이 없습니다.',
    successTitle = '복사 완료',
    successMessage = '메시지를 복사했습니다.',
    failureTitle = '복사 실패',
    failureMessage = '메시지를 복사하지 못했습니다.',
    logScope = 'messenger',
  }: CopyTextWithFeedbackOptions = {},
) {
  const text = String(rawText ?? '');
  if (!text.trim()) {
    Alert.alert(emptyTitle, emptyMessage);
    return false;
  }

  try {
    await Clipboard.setStringAsync(text);
    Alert.alert(successTitle, successMessage);
    return true;
  } catch (error) {
    logger.warn(`[${logScope}] copy failed`, error);
    Alert.alert(failureTitle, failureMessage);
    return false;
  }
}
