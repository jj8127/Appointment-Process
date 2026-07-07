'use client';

import { Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import type { KeyboardEvent, ReactNode } from 'react';

type RejectReasonModalProps = {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  description: ReactNode;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  submitting?: boolean;
  submitDisabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  minRows?: number;
};

export function RejectReasonModal({
  opened,
  onClose,
  title,
  description,
  placeholder,
  value,
  onChange,
  onSubmit,
  submitting = false,
  submitDisabled = false,
  size = 'md',
  minRows = 3,
}: RejectReasonModalProps) {
  const handleReasonKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    if (submitting || submitDisabled) return;
    void onSubmit();
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700}>{title}</Text>}
      size={size}
      padding="lg"
      radius="md"
      centered
      overlayProps={{ blur: 2 }}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {description}
        </Text>
        <Textarea
          placeholder={placeholder}
          classNames={{ input: 'muted-placeholder-input' }}
          minRows={minRows}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={handleReasonKeyDown}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={submitting}>
            취소
          </Button>
          <Button
            color="red"
            onClick={() => void onSubmit()}
            loading={submitting}
            disabled={submitDisabled}
          >
            반려 처리
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
