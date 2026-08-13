export const MAX_MESSENGER_ATTACHMENTS = 10;
export const MAX_MESSENGER_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const MESSENGER_ATTACHMENT_ERROR_COPY = {
  tooMany: '파일은 메시지당 최대 10개까지 첨부할 수 있습니다.',
  tooLarge: '파일당 최대 20MiB까지 첨부할 수 있습니다.',
  unsupported:
    '지원하지 않는 파일 형식입니다. 이미지, PDF, Word, Excel, PowerPoint, TXT 파일만 첨부할 수 있습니다.',
  uploadFailed: '파일을 업로드하지 못했습니다. 다시 시도해 주세요.',
  downloadFailed: '파일을 열지 못했습니다. 다시 시도해 주세요.',
} as const;

export const MESSENGER_ATTACHMENT_MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
} as const;

export type MessengerAttachmentMimeType =
  (typeof MESSENGER_ATTACHMENT_MIME_BY_EXTENSION)[keyof typeof MESSENGER_ATTACHMENT_MIME_BY_EXTENSION];

export type MessengerAttachmentCandidate = {
  name: string;
  size: number;
  type?: string;
};

export type ValidatedMessengerAttachment = {
  name: string;
  size: number;
  mimeType: MessengerAttachmentMimeType;
};

export type MessengerAttachmentValidationResult =
  | { ok: true; files: ValidatedMessengerAttachment[] }
  | { ok: false; error: string };

function cleanAttachmentName(value: string) {
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim()
    .slice(0, 180);
}

function getExtension(name: string) {
  const index = name.lastIndexOf('.');
  return index > -1 ? name.slice(index + 1).toLowerCase() : '';
}

export function validateMessengerAttachmentSelection(
  selected: readonly MessengerAttachmentCandidate[],
  existingCount = 0,
): MessengerAttachmentValidationResult {
  if (
    existingCount < 0
    || existingCount > MAX_MESSENGER_ATTACHMENTS
    || selected.length + existingCount > MAX_MESSENGER_ATTACHMENTS
  ) {
    return { ok: false, error: MESSENGER_ATTACHMENT_ERROR_COPY.tooMany };
  }

  const files: ValidatedMessengerAttachment[] = [];
  for (const candidate of selected) {
    if (
      !Number.isFinite(candidate.size)
      || candidate.size < 1
      || candidate.size > MAX_MESSENGER_ATTACHMENT_BYTES
    ) {
      return { ok: false, error: MESSENGER_ATTACHMENT_ERROR_COPY.tooLarge };
    }
    const name = cleanAttachmentName(candidate.name);
    const extension = getExtension(name) as keyof typeof MESSENGER_ATTACHMENT_MIME_BY_EXTENSION;
    const mimeType = MESSENGER_ATTACHMENT_MIME_BY_EXTENSION[extension];
    const browserMimeType = String(candidate.type ?? '').trim().toLowerCase();
    if (!name || !mimeType || (browserMimeType && browserMimeType !== mimeType)) {
      return { ok: false, error: MESSENGER_ATTACHMENT_ERROR_COPY.unsupported };
    }
    files.push({ name, size: candidate.size, mimeType });
  }
  return { ok: true, files };
}

export function formatMessengerAttachmentSize(size: number) {
  if (!Number.isFinite(size) || size < 0) return '0 B';
  if (size < 1024) return `${Math.floor(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}
