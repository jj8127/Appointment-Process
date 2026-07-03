type BoardAttachmentAlert = (title: string, message?: string) => void;
type BoardAttachmentOpener = (url: string) => Promise<unknown>;
type BoardAttachmentErrorLogger = (scope: string, error: unknown) => void;

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
  if (!signedUrl) {
    return false;
  }

  try {
    await openExternalUrl(signedUrl);
    return true;
  } catch (error) {
    logError?.('attachment-open', error);
    alert('오류', '첨부파일을 열 수 없습니다.');
    return false;
  }
}
