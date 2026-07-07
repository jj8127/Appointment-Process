import { Alert } from 'react-native';

import { formatExternalUrlDisplayText, normalizeExternalUrl } from '@/lib/external-url';
import { copyTextWithFeedback } from '@/lib/messenger-copy-actions';
import { openExternalUrl } from '@/lib/open-external-url';

export async function openLinkExternallyWithFeedback(rawUrl: string) {
  const normalized = normalizeExternalUrl(rawUrl);
  if (!normalized) return false;

  try {
    await openExternalUrl(normalized, { preferExternalBrowser: true });
    return true;
  } catch {
    Alert.alert('오류', '링크를 열 수 없습니다.');
    return false;
  }
}

export function showLinkifiedTextOptions(rawUrl: string) {
  const normalized = normalizeExternalUrl(rawUrl);
  if (!normalized) return;

  const displayText = formatExternalUrlDisplayText(normalized, 56);

  Alert.alert('링크 옵션', displayText, [
    {
      text: '열기',
      onPress: () => {
        void openLinkExternallyWithFeedback(normalized);
      },
    },
    {
      text: '복사',
      onPress: () => {
        void copyTextWithFeedback(normalized, {
          successTitle: '복사 완료',
          successMessage: '링크를 클립보드에 복사했습니다.',
          failureTitle: '복사 실패',
          failureMessage: '링크 복사에 실패했습니다.',
          logScope: 'linkified-text',
        });
      },
    },
    {
      text: '선택/부분선택',
      onPress: () => {
        Alert.alert('안내', '본문을 길게 누르면 텍스트를 선택할 수 있습니다.');
      },
    },
    { text: '취소', style: 'cancel' },
  ]);
}
