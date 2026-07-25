'use client';

import {
  ActionIcon,
  Badge,
  Button,
  FileButton,
  Group,
  Stack,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconPaperclip, IconX } from '@tabler/icons-react';

import {
  openMessengerAttachment,
  type MessengerAttachmentMetadata,
} from '@/lib/messenger-attachment-client';
import {
  MESSENGER_ATTACHMENT_ERROR_COPY,
  formatMessengerAttachmentSize,
  validateMessengerAttachmentSelection,
} from '@/lib/messenger-attachment-policy';

const ACCEPTED_FILES =
  '.jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';

export function MessengerAttachmentPicker({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const addFiles = (selected: File[]) => {
    const validation = validateMessengerAttachmentSelection(selected, files.length);
    if (!validation.ok) {
      notifications.show({ title: '파일 첨부 실패', message: validation.error, color: 'red' });
      return;
    }
    onChange([...files, ...selected]);
  };
  return (
    <Stack gap={6}>
      {files.length > 0 ? (
        <Group gap={6}>
          {files.map((file, index) => (
            <Badge
              key={`${file.name}-${file.size}-${index}`}
              variant="light"
              color="gray"
              rightSection={
                <ActionIcon
                  size="xs"
                  variant="transparent"
                  color="gray"
                  aria-label={`${file.name} 첨부 제거`}
                  onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
                >
                  <IconX size={12} />
                </ActionIcon>
              }
            >
              {file.name}
            </Badge>
          ))}
        </Group>
      ) : null}
      <FileButton
        multiple
        accept={ACCEPTED_FILES}
        onChange={(selected) => addFiles(selected ?? [])}
      >
        {(props) => (
          <ActionIcon
            {...props}
            variant="light"
            color="gray"
            disabled={disabled}
            aria-label="파일 첨부"
          >
            <IconPaperclip size={17} />
          </ActionIcon>
        )}
      </FileButton>
    </Stack>
  );
}

export function MessengerAttachmentList({
  attachments,
  ownMessage,
}: {
  attachments?: MessengerAttachmentMetadata[] | null;
  ownMessage?: boolean;
}) {
  if (!attachments?.length) return null;
  return (
    <Stack gap={4} mt={6}>
      {attachments.map((attachment) => (
        <Button
          key={attachment.id}
          size="compact-xs"
          variant="light"
          color={ownMessage ? 'gray' : 'blue'}
          leftSection={<IconDownload size={14} />}
          onClick={() => void openMessengerAttachment(attachment.id).catch(() => {
            notifications.show({
              title: '파일 열기 실패',
              message: MESSENGER_ATTACHMENT_ERROR_COPY.downloadFailed,
              color: 'red',
            });
          })}
        >
          {attachment.name} · {formatMessengerAttachmentSize(attachment.size)}
        </Button>
      ))}
    </Stack>
  );
}
