import { Alert } from 'react-native';

import { logger } from '@/lib/logger';
import {
  createMessengerAttachmentDownloadUrl,
  MESSENGER_ATTACHMENT_ERROR_COPY,
} from '@/lib/messenger-attachment-api';
import { openExternalUrl } from '@/lib/open-external-url';

type OpenMessengerAttachmentOptions = {
  logScope?: string;
};

export async function openMessengerAttachment(
  rawUrl: string | null | undefined,
  { logScope = 'messenger' }: OpenMessengerAttachmentOptions = {},
) {
  const url = String(rawUrl ?? '').trim();
  if (!url) {
    Alert.alert('열기 실패', '첨부 파일을 열지 못했습니다.');
    return false;
  }

  try {
    await openExternalUrl(url, { preferExternalBrowser: true });
    return true;
  } catch (error) {
    logger.warn(`[${logScope}] attachment open failed`, error);
    Alert.alert('열기 실패', '첨부 파일을 열지 못했습니다.');
    return false;
  }
}

export async function openAuthorizedMessengerAttachment(
  attachmentId: string,
  { logScope = 'messenger' }: OpenMessengerAttachmentOptions = {},
) {
  try {
    const signedUrl = await createMessengerAttachmentDownloadUrl(attachmentId);
    await openExternalUrl(signedUrl, { preferExternalBrowser: true });
    return true;
  } catch {
    logger.warn(`[${logScope}] authorized attachment open failed`);
    Alert.alert('열기 실패', MESSENGER_ATTACHMENT_ERROR_COPY.downloadFailed);
    return false;
  }
}
