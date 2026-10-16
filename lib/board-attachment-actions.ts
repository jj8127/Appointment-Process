import { isCredentialFreeHttpsUrl } from './external-url';

type BoardAttachmentAlert = (title: string, message?: string) => void;
type BoardAttachmentOpener = (url: string, options?: { preferExternalBrowser?: boolean }) => Promise<unknown>;
type BoardAttachmentErrorLogger = (scope: string, error: unknown) => void;

// board-detail signs attachment URLs for 1 hour. Re-sign before reusing an older detail response,
// otherwise the preview shows an empty black overlay and file links open a storage error page.
export const BOARD_ATTACHMENT_URL_REUSE_MS = 50 * 60 * 1000;

export function isBoardAttachmentUrlStale(signedAt: number, now = Date.now()) {
  return !signedAt || now - signedAt >= BOARD_ATTACHMENT_URL_REUSE_MS;
}

/** Returns the current attachments, re-signed through `refresh` when the detail response is near expiry. */
export async function getFreshBoardAttachments<T>(
  current: T[],
  signedAt: number,
  refresh: () => Promise<T[] | null | undefined>,
  now = Date.now(),
): Promise<T[] | null> {
  if (!isBoardAttachmentUrlStale(signedAt, now)) return current;
  try {
    return (await refresh()) ?? null;
  } catch {
    return null;
  }
}

export type OpenBoardAttachmentOptions = {
  signedUrl?: string | null;
  openExternalUrl: BoardAttachmentOpener;
  alert: BoardAttachmentAlert;
  logError?: BoardAttachmentErrorLogger;
};

export async function openBoardAttachment({
  signedUrl,
  openExternalUrl,
  alert,
  logError,
}: OpenBoardAttachmentOptions) {
  if (!isCredentialFreeHttpsUrl(signedUrl)) {
    alert('오류', '첨부파일을 열 수 없습니다.');
    return false;
  }

  try {
    // Android Custom Tabs cannot render PDF/HWP/Office responses: they start a download and leave
    // an empty (black in dark mode) tab behind. Hand files to the default browser/viewer instead.
    await openExternalUrl(signedUrl, { preferExternalBrowser: true });
    return true;
  } catch (error) {
    logError?.('attachment-open', error);
    alert('오류', '첨부파일을 열 수 없습니다.');
    return false;
  }
}
