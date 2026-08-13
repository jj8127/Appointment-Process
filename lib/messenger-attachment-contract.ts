import { isNotificationUuid } from './notification-target';

export const MAX_MESSENGER_ATTACHMENTS = 10;
export const MAX_MESSENGER_ATTACHMENT_BYTES = 20 * 1024 * 1024;

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

export type MessengerAttachmentMetadata = {
  id: string;
  name: string;
  size: number;
  mimeType: MessengerAttachmentMimeType;
  sha256: string;
};

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function cleanMessengerAttachmentName(value: string) {
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim()
    .slice(0, 180);
}

export function getMessengerAttachmentMimeType(
  name: string,
  claimedMimeType?: string | null,
): MessengerAttachmentMimeType | null {
  const index = name.lastIndexOf('.');
  const extension = (
    index >= 0 ? name.slice(index + 1).toLowerCase() : ''
  ) as keyof typeof MESSENGER_ATTACHMENT_MIME_BY_EXTENSION;
  const canonical = MESSENGER_ATTACHMENT_MIME_BY_EXTENSION[extension];
  if (!canonical) return null;
  const claimed = String(claimedMimeType ?? '').trim().toLowerCase();
  return claimed && claimed !== canonical ? null : canonical;
}

export function normalizeMessengerAttachmentContent(value: string) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim();
}

export function parseMessengerAttachmentMetadataList(
  value: unknown,
): MessengerAttachmentMetadata[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value)
    || value.length > MAX_MESSENGER_ATTACHMENTS
  ) {
    throw new Error('첨부 파일 응답 형식이 올바르지 않습니다.');
  }
  const attachments = value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('첨부 파일 응답 형식이 올바르지 않습니다.');
    }
    const attachment = raw as Record<string, unknown>;
    const id =
      typeof attachment.id === 'string'
        ? attachment.id.toLowerCase()
        : '';
    const name =
      typeof attachment.name === 'string'
        ? cleanMessengerAttachmentName(attachment.name)
        : '';
    const mimeType = getMessengerAttachmentMimeType(
      name,
      typeof attachment.mimeType === 'string'
        ? attachment.mimeType
        : null,
    );
    const size = Number(attachment.size);
    const sha256 =
      typeof attachment.sha256 === 'string'
        ? attachment.sha256.trim().toLowerCase()
        : '';
    if (
      !isNotificationUuid(id)
      || !name
      || name !== attachment.name
      || !mimeType
      || !Number.isSafeInteger(size)
      || size < 1
      || size > MAX_MESSENGER_ATTACHMENT_BYTES
      || !SHA256_PATTERN.test(sha256)
    ) {
      throw new Error('첨부 파일 응답 형식이 올바르지 않습니다.');
    }
    return { id, name, size, mimeType, sha256 };
  });
  if (
    new Set(attachments.map((attachment) => attachment.id)).size
    !== attachments.length
  ) {
    throw new Error('첨부 파일 응답 형식이 올바르지 않습니다.');
  }
  return attachments;
}
