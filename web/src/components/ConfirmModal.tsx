'use client';

import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';

type ConfirmModalProps = {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  color?: string;
  submitting?: boolean;
};

export function ConfirmModal({
  opened,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = '확인',
  color = 'orange',
  submitting = false,
}: ConfirmModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={() => { if (!submitting) onClose(); }}
      title={<Text fw={700}>{title}</Text>}
      size="sm"
      padding="lg"
      radius="md"
      centered
      overlayProps={{ blur: 2 }}
    >
      <Stack gap="md">
        {typeof message === 'string' ? <Text size="sm" style={{ whiteSpace: 'pre-line' }}>{message}</Text> : message}
        <Group justify="flex-end">
          <Button variant="default" disabled={submitting} onClick={onClose}>
            취소
          </Button>
          <Button color={color} loading={submitting} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
