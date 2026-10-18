'use client';

// Obsidian 그래프 설정 패널처럼 그래프 위에 떠 있는 접히는 패널 하나에 조작을 모은다.
// 닫으면 톱니 버튼만 남아 그래프가 화면 전체를 쓴다.
import { ActionIcon, Box, Group, Paper, ScrollArea, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconRefresh, IconSettings, IconX } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';

type PanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
  summary?: ReactNode;
  /** 오른쪽 상세 패널이 열려 있으면 그만큼 비켜 선다 */
  right: number;
  width: number;
  maxHeight: string;
  children: ReactNode;
};

export function GraphControlPanel({ open, onOpenChange, onReset, summary, right, width, maxHeight, children }: PanelProps) {
  if (!open) {
    return <Tooltip label="그래프 설정" withArrow position="left">
      <ActionIcon aria-label="그래프 설정 열기" aria-expanded={false} variant="default" size="lg" radius="md"
        onClick={() => onOpenChange(true)}
        style={{ position: 'absolute', top: 12, right, zIndex: 5, boxShadow: '0 4px 14px rgba(15, 23, 42, 0.12)', transition: 'right 300ms ease' }}>
        <IconSettings size={18} />
      </ActionIcon>
    </Tooltip>;
  }
  return <Paper withBorder radius="md" role="region" aria-label="그래프 설정"
    style={{ position: 'absolute', top: 12, right, width, maxHeight, zIndex: 5, display: 'flex', flexDirection: 'column',
      background: 'rgba(255, 255, 255, 0.97)', borderColor: '#dbe4ee', boxShadow: '0 12px 32px rgba(15, 23, 42, 0.14)',
      overflow: 'hidden', transition: 'right 300ms ease' }}>
    <Group justify="space-between" wrap="nowrap" px="sm" pt={8} pb={summary ? 4 : 8} gap={4}>
      <Box style={{ minWidth: 0, flex: 1 }}>{summary}</Box>
      <Group gap={2} wrap="nowrap">
        <Tooltip label="설정 초기화" withArrow><ActionIcon aria-label="그래프 설정 초기화" variant="subtle" color="gray" size="sm" onClick={onReset}>
          <IconRefresh size={15} /></ActionIcon></Tooltip>
        <ActionIcon aria-label="그래프 설정 닫기" variant="subtle" color="gray" size="sm" onClick={() => onOpenChange(false)}>
          <IconX size={15} /></ActionIcon>
      </Group>
    </Group>
    <ScrollArea.Autosize mah={`calc(${maxHeight} - 40px)`} type="auto">
      <Stack gap={0} pb={6}>{children}</Stack>
    </ScrollArea.Autosize>
  </Paper>;
}

export function GraphControlSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return <Box style={{ borderTop: '1px solid #eef2f7' }}>
    <UnstyledButton onClick={() => setOpen((value) => !value)} aria-expanded={open}
      style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 6, padding: '8px 12px' }}>
      <IconChevronDown size={14} color="#94a3b8"
        style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 200ms ease' }} />
      <Text size="sm" fw={700} c="dark.7">{title}</Text>
    </UnstyledButton>
    {open ? <Stack gap="xs" px="sm" pb="sm" pl={32}>{children}</Stack> : null}
  </Box>;
}
