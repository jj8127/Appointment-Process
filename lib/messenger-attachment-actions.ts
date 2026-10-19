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

// Signed URLs live 5 minutes on the server; reuse one for 4 so a busy room asks once per attachment.
const SIGNED_URL_REUSE_MS = 4 * 60 * 1000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const signedUrlRequests = new Map<string, Promise<string>>();

export function getMessengerAttachmentSignedUrl(attachmentId: string): Promise<string> {
  const cached = signedUrlCache.get(attachmentId);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url);
  const pending = signedUrlRequests.get(attachmentId);
  if (pending) return pending;
  const request = createMessengerAttachmentDownloadUrl(attachmentId)
    .then((url) => {
      signedUrlCache.set(attachmentId, { url, expiresAt: Date.now() + SIGNED_URL_REUSE_MS });
      return url;
    })
    .finally(() => signedUrlRequests.delete(attachmentId));
  signedUrlRequests.set(attachmentId, request);
  return request;
}

export async function openAuthorizedMessengerAttachment(
  attachmentId: string,
  { logScope = 'messenger' }: OpenMessengerAttachmentOptions = {},
) {
  try {
    const signedUrl = await getMessengerAttachmentSignedUrl(attachmentId);
    await openExternalUrl(signedUrl, { preferExternalBrowser: true });
    return true;
  } catch {
    logger.warn(`[${logScope}] authorized attachment open failed`);
    Alert.alert('열기 실패', MESSENGER_ATTACHMENT_ERROR_COPY.downloadFailed);
    return false;
  }
}
