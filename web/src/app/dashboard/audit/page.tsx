'use client';

import { Badge, Group, LoadingOverlay, Paper, ScrollArea, SegmentedControl, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useMemo, useState, type CSSProperties } from 'react';
import surface from '../surface.module.css';

import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { useSession } from '@/hooks/use-session';
import {
  ADMIN_AUDIT_ACTION_LABELS,
  ADMIN_AUDIT_CATEGORY_LABELS,
  describeAuditDetail,
  type AdminAuditCategory,
} from '@/lib/admin-audit-event';
import { QueryReadError } from '@/lib/query-read-error';

type AuditItem = {
  id: string;
  createdAt: string;
  category: AdminAuditCategory;
  action: string;
  actorName: string;
  targetFcId: string | null;
  targetName: string | null;
  targetCount: number;
  detail: Record<string, unknown>;
  reason: string | null;
};

const CATEGORY_COLORS: Record<AdminAuditCategory, string> = {
  fc_action: 'gray',
  export: 'orange',
  personal_info_view: 'red',
};

async function fetchAuditEvents(month: string, category: string): Promise<{ events: AuditItem[]; limited: boolean }> {
  const params = new URLSearchParams({ month });
  if (category !== 'all') params.set('category', category);
  const response = await fetch(`/api/admin/audit?${params}`, { credentials: 'same-origin', cache: 'no-store' });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new QueryReadError(response.status);
  if (!json || typeof json !== 'object' || (json as { ok?: unknown }).ok !== true || !Array.isArray((json as { events?: unknown }).events)) {
    throw new QueryReadError();
  }
  const { events, limited } = json as { events: AuditItem[]; limited?: boolean };
  return { events, limited: limited === true };
}

export default function AuditPage() {
  const { hydrated, role, isReadOnly } = useSession();
  const [month, setMonth] = useState<string>(dayjs().format('YYYY-MM'));
  const [category, setCategory] = useState('all');
  const [keyword, setKeyword] = useState('');
  const canRead = hydrated && role === 'admin' && !isReadOnly;

  const { data, error, isError, isFetching, isLoading, refetch } = useQuery({
    queryKey: ['admin-audit', month, category],
    queryFn: () => fetchAuditEvents(month, category),
    enabled: canRead,
  });

  const monthEvents = data?.events ?? [];

  const rows = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    const events = data?.events ?? [];
    if (!text) return events;
    return events.filter((item) => [item.actorName, item.targetName ?? ''].some((value) => value.toLowerCase().includes(text)));
  }, [data, keyword]);

  return (
    <div className={surface.page}>
      <Stack gap={14}>
        <div className={surface.head} style={{ '--i': 0 } as CSSProperties}>
        <div>
          <Title order={1} className={surface.title}>처리 이력</Title>
          <Text className={surface.subtitle}>처리, 엑셀 다운로드, 개인정보 조회 기록</Text>
          {data ? (
            <div className={surface.headMeta}>
              <span className={surface.metaChip}><i />{dayjs(`${month}-01`).format('M월')} 기록 <b>{monthEvents.length}</b>{data.limited ? '+' : ''}</span>
              <span className={surface.metaChip} data-tone={monthEvents.some((item) => item.category === 'personal_info_view') ? 'hot' : undefined}>
                <i />개인정보 조회 <b>{monthEvents.filter((item) => item.category === 'personal_info_view').length}</b>
              </span>
              <span className={surface.metaChip}><i />엑셀 다운로드 <b>{monthEvents.filter((item) => item.category === 'export').length}</b></span>
            </div>
          ) : null}
        </div>
        </div>

        <Group gap="sm" wrap="wrap">
          <MonthPickerInput
            aria-label="조회 월"
            value={`${month}-01`}
            onChange={(value) => { if (value) setMonth(dayjs(value).format('YYYY-MM')); }}
            valueFormat="YYYY년 M월"
            maxDate={dayjs().format('YYYY-MM-DD')}
            w={150}
            radius="xl"
            styles={{ input: { border: 0, height: 44 } }}
          />
          <SegmentedControl
            value={category}
            onChange={setCategory}
            radius="xl"
            size="md"
            bg="white"
            data={[
              { value: 'all', label: '전체' },
              { value: 'fc_action', label: ADMIN_AUDIT_CATEGORY_LABELS.fc_action },
              { value: 'export', label: ADMIN_AUDIT_CATEGORY_LABELS.export },
              { value: 'personal_info_view', label: ADMIN_AUDIT_CATEGORY_LABELS.personal_info_view },
            ]}
          />
          <TextInput
            aria-label="처리자 또는 대상 검색"
            placeholder="처리자, 대상 이름"
            leftSection={<IconSearch size={16} />}
            value={keyword}
            onChange={(event) => setKeyword(event.currentTarget.value)}
            w={220}
            radius="xl"
            styles={{ input: { border: 0, height: 44 } }}
          />
        </Group>

        {isError && <QueryErrorAlert error={error} onRetry={refetch} isFetching={isFetching} hasData={Boolean(data)} subject="처리 이력" />}

        <Paper radius={24} pos="relative" mih={240} className={surface.tableCard} style={{ '--i': 1 } as CSSProperties}>
          <LoadingOverlay visible={isLoading} />
          <ScrollArea>
            <Table verticalSpacing="sm" miw={900} className={surface.table}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={150}>시각</Table.Th>
                  <Table.Th w={110}>처리자</Table.Th>
                  <Table.Th w={140}>구분</Table.Th>
                  <Table.Th w={170}>동작</Table.Th>
                  <Table.Th w={140}>대상</Table.Th>
                  <Table.Th>내용</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((item) => (
                  <Table.Tr key={item.id}>
                    <Table.Td>{dayjs(item.createdAt).format('YYYY-MM-DD HH:mm')}</Table.Td>
                    <Table.Td>{item.actorName}</Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={CATEGORY_COLORS[item.category]}>{ADMIN_AUDIT_CATEGORY_LABELS[item.category]}</Badge>
                    </Table.Td>
                    <Table.Td>{ADMIN_AUDIT_ACTION_LABELS[item.action] ?? item.action}</Table.Td>
                    <Table.Td>
                      {item.targetFcId && item.targetName ? (
                        <Text component={Link} href={`/dashboard/profile/${item.targetFcId}`} size="sm" c="orange.7">{item.targetName}</Text>
                      ) : item.targetCount > 1 ? `${item.targetCount}명` : '-'}
                    </Table.Td>
                    <Table.Td>{describeAuditDetail(item)}</Table.Td>
                  </Table.Tr>
                ))}
                {data && !isError && rows.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={6} ta="center" py="xl" c="dimmed">기록이 없습니다.</Table.Td>
                  </Table.Tr>
                ) : null}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
        {data?.limited ? <Text size="xs" c="dimmed">최근 500건만 표시합니다. 구분을 나눠 조회하세요.</Text> : null}
      </Stack>
    </div>
  );
}
