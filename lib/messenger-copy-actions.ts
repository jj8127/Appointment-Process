import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';

import { showToast } from '@/components/Toast';
import { logger } from '@/lib/logger';

type CopyTextWithFeedbackOptions = {
  emptyMessage?: string;
  successMessage?: string;
  failureMessage?: string;
  /** 'none' lets a caller show the result on the control itself, e.g. inside a modal that would cover a toast. */
  feedback?: 'toast' | 'none';
  logScope?: string;
};

const ANDROID_SYSTEM_CLIPBOARD_CONFIRMATION_API = 33;

function systemConfirmsClipboardCopy() {
  return Platform.OS === 'android' && Number(Platform.Version) >= ANDROID_SYSTEM_CLIPBOARD_CONFIRMATION_API;
}

// Copying is reversible and frequent, so its result never blocks the screen with a modal.
export async function copyTextWithFeedback(
  rawText: string | null | undefined,
  {
    emptyMessage = '복사할 메시지 내용이 없습니다.',
    successMessage = '메시지를 복사했습니다.',
    failureMessage = '메시지를 복사하지 못했습니다.',
    feedback = 'toast',
    logScope = 'messenger',
  }: CopyTextWithFeedbackOptions = {},
) {
  const notify = (message: string, variant: 'success' | 'warning' | 'error') => {
    if (feedback === 'toast') showToast({ message, variant });
  };
  const text = String(rawText ?? '');
  if (!text.trim()) {
    notify(emptyMessage, 'warning');
    return false;
  }

  try {
    await Clipboard.setStringAsync(text);
    // Android 13+ shows its own clipboard confirmation, so an app toast would duplicate it.
    if (!systemConfirmsClipboardCopy()) notify(successMessage, 'success');
    return true;
  } catch (error) {
    logger.warn(`[${logScope}] copy failed`, error);
    notify(failureMessage, 'error');
    return false;
  }
}
