'use client';

import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  LoadingOverlay,
  Modal,
  Pagination,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle,
  IconBan,
  IconGraph,
  IconKey,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useDeferredValue, useState } from 'react';

import { RecommenderSelect } from '@/components/RecommenderSelect';
import { useSession } from '@/hooks/use-session';
import type {
  ReferralAdminDetail,
  ReferralAdminEventItem,
  ReferralAdminListItem,
  ReferralAdminListResponse,
  ReferralAdminMutationRequest,
  ReferralAdminMutationResponse,
  ReferralAdminUnresolvedItem,
} from '@/types/referrals';

const PAGE_SIZE = 20;
const BACKFILL_LIMIT = 100;

type ActionModalState =
  | { action: 'backfill_missing_codes'; target: null }
  | { action: 'rotate_code' | 'disable_code'; target: ReferralAdminListItem }
  | { action: 'link_legacy_recommender'; target: ReferralAdminUnresolvedItem }
  | null;

function formatDateTime(value?: string | null) {
  if (!value) {
    return '미기록';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('ko-KR', { hour12: false });
}

function getEventLabel(eventType: string) {
  if (eventType === 'code_generated') return '코드 발급';
  if (eventType === 'code_rotated') return '코드 재발급';
  if (eventType === 'code_disabled') return '코드 비활성';
  if (eventType === 'admin_override_applied') return '추천인 연결 변경';
  return eventType;
}

function getMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getEventCode(event: ReferralAdminEventItem) {
  return (
    event.referralCode
    ?? getMetadataString(event.metadata, 'nextCode')
    ?? getMetadataString(event.metadata, 'previousCode')
  );
}

function getEventActorLabel(event: ReferralAdminEventItem) {
  return (
    getMetadataString(event.metadata, 'actorStaffType')
    ?? getMetadataString(event.metadata, 'actorRole')
    ?? 'system'
  );
}

function getUnresolvedStatusLabel(status: ReferralAdminUnresolvedItem['matchStatus']) {
  if (status === 'ambiguous') return '동명이인 후보 다수';
  if (status === 'auto_resolvable') return '자동 연결 가능';
  return '활성 코드 후보 없음';
}

function getUnresolvedStatusColor(status: ReferralAdminUnresolvedItem['matchStatus']) {
  if (status === 'ambiguous') return 'orange';
  if (status === 'auto_resolvable') return 'blue';
  return 'gray';
}

async function fetchReferrals(params: { page: number; search: string; fcId: string | null }) {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(PAGE_SIZE),
  });

  if (params.search.trim()) {
    query.set('search', params.search.trim());
  }

  if (params.fcId) {
    query.set('fcId', params.fcId);
  }

  const response = await fetch(`/api/admin/referrals?${query.toString()}`);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error?: string }).error ?? '추천인 코드 조회에 실패했습니다.')
        : '추천인 코드 조회에 실패했습니다.',
    );
  }

  return data as ReferralAdminListResponse;
}

async function postReferralAction(body: ReferralAdminMutationRequest) {
  const response = await fetch('/api/admin/referrals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error?: string }).error ?? '추천인 코드 작업에 실패했습니다.')
        : '추천인 코드 작업에 실패했습니다.',
    );
  }

  return data as ReferralAdminMutationResponse;
}

function SummaryCard(props: {
  title: string;
  value: number;
  tone?: 'orange' | 'blue' | 'gray';
}) {
  const color = props.tone === 'blue' ? '#1c7ed6' : props.tone === 'gray' ? '#6b7280' : '#f97316';

  return (
    <Card withBorder radius="md" p="lg" bg="white">
      <Stack gap={6}>
        <Text size="sm" c="dimmed">
          {props.title}
        </Text>
        <Text size="xl" fw={800} style={{ color }}>
          {props.value.toLocaleString('ko-KR')}
        </Text>
      </Stack>
    </Card>
  );
}

function DetailPanel(props: {
  detail: ReferralAdminDetail | null;
  fallbackItem: ReferralAdminListItem | null;
  canMutate: boolean;
  onRotate: () => void;
  onDisable: () => void;
}) {
  const detailName = props.detail?.name ?? props.fallbackItem?.name ?? '선택된 FC';
  const detailPhone = props.detail?.phone ?? props.fallbackItem?.phone ?? '';
  const detailAffiliation = props.detail?.affiliation ?? props.fallbackItem?.affiliation ?? '';

  if (!props.detail && !props.fallbackItem) {
    return (
      <Paper withBorder radius="md" p="lg" bg="white">
        <Text size="sm" c="dimmed">
          목록에서 FC를 선택하면 현재 추천코드와 운영 이력을 확인할 수 있습니다.
        </Text>
      </Paper>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={4}>{detailName}</Title>
          <Text size="sm" c="dimmed">
            {[detailAffiliation, detailPhone].filter(Boolean).join(' · ') || '상세 정보를 불러오는 중입니다.'}
          </Text>
        </div>
        {props.canMutate ? (
          <Group gap="xs">
            <Button
              variant="default"
              size="xs"
              leftSection={<IconRefresh size={14} />}
              onClick={props.onRotate}
            >
              재발급
            </Button>
            <Button
              color="red"
              variant="light"
              size="xs"
              leftSection={<IconBan size={14} />}
              onClick={props.onDisable}
            >
              비활성
            </Button>
          </Group>
        ) : (
          <Badge color="gray" variant="light">
            읽기 전용
          </Badge>
        )}
      </Group>

      <Card withBorder radius="md" p="md" bg="gray.0">
        <Stack gap={6}>
          <Text size="sm" fw={700}>
            현재 활성 코드
          </Text>
          {props.detail?.currentCode ? (
            <>
              <Badge size="lg" color="orange" variant="light" leftSection={<IconKey size={12} />}>
                {props.detail.currentCode.code}
              </Badge>
              <Text size="xs" c="dimmed">
                발급일: {formatDateTime(props.detail.currentCode.createdAt)}
              </Text>
            </>
          ) : (
            <Text size="sm" c="dimmed">
              활성 코드가 없습니다.
            </Text>
          )}
        </Stack>
      </Card>

      <Stack gap="xs">
        <Text size="sm" fw={700}>
          비활성 코드 이력
        </Text>
        {props.detail?.codeHistory.length ? (
          <Stack gap={8}>
            {props.detail.codeHistory.map((item) => (
              <Paper key={item.id} withBorder radius="md" p="sm">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Badge color="gray" variant="light">
                      {item.code}
                    </Badge>
                    <Text size="xs" c="dimmed" mt={6}>
                      발급일: {formatDateTime(item.createdAt)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      비활성일: {formatDateTime(item.disabledAt)}
                    </Text>
                  </div>
                  <Badge color="gray" variant="dot">
                    비활성
                  </Badge>
                </Group>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            비활성 코드 이력이 없습니다.
          </Text>
        )}
      </Stack>

      <Stack gap="xs">
        <Text size="sm" fw={700}>
          최근 운영 이벤트
        </Text>
        {props.detail?.recentEvents.length ? (
          <Stack gap={8}>
            {props.detail.recentEvents.map((event) => {
              const eventCode = getEventCode(event);
              const reason = getMetadataString(event.metadata, 'reason');
              return (
                <Paper key={event.id} withBorder radius="md" p="sm">
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Text size="sm" fw={600}>
                        {getEventLabel(event.eventType)}
                      </Text>
                      {eventCode ? (
                        <Text size="xs" c="dimmed">
                          코드: {eventCode}
                        </Text>
                      ) : null}
                      {reason ? (
                        <Text size="xs" c="dimmed">
                          사유: {reason}
                        </Text>
                      ) : null}
                      <Text size="xs" c="dimmed">
                        {formatDateTime(event.createdAt)}
                      </Text>
                    </div>
                    <Badge color="gray" variant="light">
                      {getEventActorLabel(event)}
                    </Badge>
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            운영 이벤트가 없습니다.
          </Text>
        )}
      </Stack>
    </Stack>
  );
}

export default function ReferralDashboardPage() {
  const queryClient = useQueryClient();
  const { hydrated, role, isReadOnly } = useSession();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedFcId, setSelectedFcId] = useState<string | null>(
    () => searchParams.get('fcId')?.trim() || null,
  );
  const [actionModal, setActionModal] = useState<ActionModalState>(null);
  const [reasonInput, setReasonInput] = useState('');
  const [legacySelectedInviterFcId, setLegacySelectedInviterFcId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  const isAuthorized = hydrated && (role === 'admin' || role === 'manager');

  const listQuery = useQuery({
    queryKey: ['dashboard-referrals', 'list', page, deferredSearch],
    queryFn: () => fetchReferrals({ page, search: deferredSearch, fcId: null }),
    enabled: isAuthorized,
  });

  const items = listQuery.data?.items ?? [];
  const effectiveSelectedFcId =
    selectedFcId && items.some((item) => item.fcId === selectedFcId)
      ? selectedFcId
      : items[0]?.fcId ?? null;

  const detailQuery = useQuery({
    queryKey: ['dashboard-referrals', 'detail', page, deferredSearch, effectiveSelectedFcId],
    queryFn: () => fetchReferrals({ page, search: deferredSearch, fcId: effectiveSelectedFcId }),
    enabled: isAuthorized && Boolean(effectiveSelectedFcId),
  });

  const serverCanMutate =
    detailQuery.data?.permissions.canMutate
    ?? listQuery.data?.permissions.canMutate
    ?? false;
  const showMutateControls = role === 'admin' && !isReadOnly && serverCanMutate;
  const summary = listQuery.data?.summary;
  const detail = detailQuery.data?.detail ?? null;
  const unresolvedItems = listQuery.data?.unresolvedItems ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedItem = items.find((item) => item.fcId === effectiveSelectedFcId) ?? null;

  const mutation = useMutation({
    mutationFn: postReferralAction,
    onSuccess: (data, variables) => {
      const result = data.result;
      const message =
        variables.action === 'backfill_missing_codes'
          ? `추천코드 일괄 발급을 실행했습니다. 생성 ${Number(result.created ?? 0)}건, 건너뜀 ${Number(result.skipped ?? 0)}건`
          : variables.action === 'rotate_code'
            ? '추천코드를 재발급했습니다.'
            : variables.action === 'disable_code'
              ? '추천코드를 비활성화했습니다.'
              : '레거시 추천인을 구조화 링크로 저장했습니다.';

      notifications.show({
        title: '처리 완료',
        message,
        color: 'green',
      });

      setActionModal(null);
      setReasonInput('');
      setLegacySelectedInviterFcId(null);
      queryClient.invalidateQueries({ queryKey: ['dashboard-referrals'] });
    },
    onError: (error: Error) => {
      notifications.show({
        title: '오류',
        message: error.message,
        color: 'red',
      });
    },
  });

  const openRotateModal = () => {
    if (!showMutateControls || !selectedItem) {
      return;
    }

    setReasonInput('');
    setActionModal({ action: 'rotate_code', target: selectedItem });
  };

  const openDisableModal = () => {
    if (!showMutateControls || !selectedItem) {
      return;
    }

    setReasonInput('');
    setActionModal({ action: 'disable_code', target: selectedItem });
  };

  const openLegacyLinkModal = (target: ReferralAdminUnresolvedItem) => {
    if (!showMutateControls) {
      return;
    }

    setReasonInput('');
    setLegacySelectedInviterFcId(null);
    setActionModal({ action: 'link_legacy_recommender', target });
  };

  const closeModal = () => {
    setActionModal(null);
    setReasonInput('');
    setLegacySelectedInviterFcId(null);
  };

  const submitAction = () => {
    if (!actionModal || !showMutateControls) {
      return;
    }

    if (actionModal.action === 'backfill_missing_codes') {
      mutation.mutate({
        action: 'backfill_missing_codes',
        payload: { limit: BACKFILL_LIMIT },
      });
      return;
    }

    if (!reasonInput.trim()) {
      notifications.show({
        title: '사유 입력',
        message: '사유를 입력해주세요.',
        color: 'red',
      });
      return;
    }

    if (actionModal.action === 'link_legacy_recommender') {
      if (!legacySelectedInviterFcId) {
        notifications.show({
          title: '추천인 선택',
          message: '연결할 추천인을 선택해주세요.',
          color: 'red',
        });
        return;
      }

      mutation.mutate({
        action: 'link_legacy_recommender',
        payload: {
          inviteeFcId: actionModal.target.inviteeFcId,
          inviterFcId: legacySelectedInviterFcId,
          reason: reasonInput.trim(),
        },
      });
      return;
    }

    mutation.mutate({
      action: actionModal.action,
      payload: {
        fcId: actionModal.target.fcId,
        reason: reasonInput.trim(),
      },
    });
  };

  const refreshQueries = () => {
    listQuery.refetch();
    if (effectiveSelectedFcId) {
      detailQuery.refetch();
    }
  };

  if (!hydrated) {
    return null;
  }

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={2}>추천인 코드</Title>
            <Text size="sm" c="dimmed" mt={4}>
              기존 FC 추천코드 발급 현황을 조회하고 운영 이력을 확인합니다.
            </Text>
          </div>

          <Group gap="xs">
            <Button
              component={Link}
              href="/dashboard/referrals/graph"
              variant="subtle"
              leftSection={<IconGraph size={16} />}
            >
              그래프 보기
            </Button>
            {showMutateControls ? (
              <Button
                leftSection={<IconRefresh size={16} />}
                onClick={() => setActionModal({ action: 'backfill_missing_codes', target: null })}
              >
                일괄 발급
              </Button>
            ) : (
              <Badge color="gray" variant="light">
                {role === 'manager' ? '본부장 읽기 전용' : '조회 전용'}
              </Badge>
            )}
          </Group>
        </Group>

        {!showMutateControls ? (
          <Alert color="gray" variant="light" icon={<IconAlertCircle size={16} />}>
            본 화면은 조회 전용입니다. 코드 발급, 재발급, 비활성 작업은 관리자 또는 개발자 세션에서만 가능합니다.
          </Alert>
        ) : null}

        {listQuery.error || detailQuery.error ? (
          <Alert color="red" icon={<IconAlertCircle size={16} />} title="불러오기 실패">
            {((listQuery.error ?? detailQuery.error) as Error).message}
          </Alert>
        ) : null}

        <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }}>
          <SummaryCard title="발급 대상 FC" value={summary?.eligibleCount ?? 0} />
          <SummaryCard title="활성 코드 보유" value={summary?.activeCodeCount ?? 0} tone="blue" />
          <SummaryCard title="미발급 FC" value={summary?.missingCodeCount ?? 0} />
          <SummaryCard title="비활성 코드 이력" value={summary?.disabledCodeCount ?? 0} tone="gray" />
          <SummaryCard title="검토 필요 추천인" value={summary?.unresolvedLegacyCount ?? 0} />
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
          <Paper withBorder radius="md" p="lg" pos="relative" bg="white">
            <LoadingOverlay visible={listQuery.isLoading} overlayProps={{ radius: 'md', blur: 1 }} />

            <Stack gap="md">
              <Group justify="space-between" align="center">
                <TextInput
                  placeholder="이름, 전화번호, 소속, 코드 검색"
                  leftSection={<IconSearch size={16} />}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.currentTarget.value);
                    setPage(1);
                  }}
                  styles={{ root: { flex: 1 } }}
                />
                <Button variant="default" onClick={refreshQueries}>
                  새로고침
                </Button>
              </Group>

              <ScrollArea>
                <Table highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>FC</Table.Th>
                      <Table.Th>활성 코드</Table.Th>
                      <Table.Th>비활성 이력</Table.Th>
                      <Table.Th>최근 변경</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {items.length ? (
                      items.map((item) => (
                        <Table.Tr
                          key={item.fcId}
                          style={{ cursor: 'pointer' }}
                          bg={effectiveSelectedFcId === item.fcId ? 'orange.0' : undefined}
                          onClick={() => setSelectedFcId(item.fcId)}
                        >
                          <Table.Td>
                            <Stack gap={0}>
                              <Text size="sm" fw={600}>
                                {item.name}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {item.affiliation || '소속 미기록'}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {item.phone}
                              </Text>
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            {item.activeCode ? (
                              <Stack gap={2}>
                                <Badge color="orange" variant="light" w="fit-content">
                                  {item.activeCode}
                                </Badge>
                                <Text size="xs" c="dimmed">
                                  {formatDateTime(item.activeCodeCreatedAt)}
                                </Text>
                              </Stack>
                            ) : (
                              <Badge color="gray" variant="light">
                                미발급
                              </Badge>
                            )}
                          </Table.Td>
                          <Table.Td>{item.disabledCodeCount}</Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {formatDateTime(item.lastEventAt)}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))
                    ) : (
                      <Table.Tr>
                        <Table.Td colSpan={4}>
                          <Text size="sm" c="dimmed" ta="center" py="md">
                            {listQuery.isLoading ? '불러오는 중입니다.' : '조회 결과가 없습니다.'}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea>

              <Group justify="space-between" align="center">
                <Text size="sm" c="dimmed">
                  총 {total}건
                </Text>
                <Pagination total={totalPages} value={page} onChange={setPage} />
              </Group>
            </Stack>
          </Paper>

          <Paper withBorder radius="md" p="lg" pos="relative" bg="white">
            <LoadingOverlay
              visible={detailQuery.isFetching && Boolean(effectiveSelectedFcId)}
              overlayProps={{ radius: 'md', blur: 1 }}
            />
            <DetailPanel
              detail={detail}
              fallbackItem={selectedItem}
              canMutate={showMutateControls && Boolean(selectedItem)}
              onRotate={openRotateModal}
              onDisable={openDisableModal}
            />
          </Paper>
        </SimpleGrid>

        <Paper withBorder radius="md" p="lg" bg="white">
          <Stack gap="md">
            <Group justify="space-between" align="flex-end">
              <div>
                <Title order={4}>레거시 추천인 검토</Title>
                <Text size="sm" c="dimmed" mt={4}>
                  `recommender` 문자열만 있고 구조화된 `recommender_fc_id`가 없는 FC를 검토합니다.
                </Text>
              </div>
              <Badge color="gray" variant="light">
                총 {unresolvedItems.length}건
              </Badge>
            </Group>

            {unresolvedItems.length ? (
              <ScrollArea>
                <Table highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>FC</Table.Th>
                      <Table.Th>기존 추천인</Table.Th>
                      <Table.Th>후보 현황</Table.Th>
                      <Table.Th>작업</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {unresolvedItems.map((item) => (
                      <Table.Tr key={item.inviteeFcId}>
                        <Table.Td>
                          <Stack gap={0}>
                            <Text size="sm" fw={600}>
                              {item.inviteeName}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {item.inviteeAffiliation || '소속 미기록'}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {item.inviteePhone}
                            </Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{item.legacyRecommenderName}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={4}>
                            <Badge color={getUnresolvedStatusColor(item.matchStatus)} variant="light" w="fit-content">
                              {getUnresolvedStatusLabel(item.matchStatus)}
                            </Badge>
                            <Text size="xs" c="dimmed">
                              후보 {item.candidateCount}명
                            </Text>
                            {item.candidatePreview.length ? (
                              <Stack gap={2}>
                                {item.candidatePreview.map((preview) => (
                                  <Text key={preview} size="xs" c="dimmed">
                                    {preview}
                                  </Text>
                                ))}
                              </Stack>
                            ) : null}
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          {showMutateControls ? (
                            <Button size="xs" variant="light" onClick={() => openLegacyLinkModal(item)}>
                              연결
                            </Button>
                          ) : (
                            <Badge color="gray" variant="light">
                              읽기 전용
                            </Badge>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            ) : (
              <Text size="sm" c="dimmed">
                검토가 필요한 레거시 추천인이 없습니다.
              </Text>
            )}
          </Stack>
        </Paper>
      </Stack>

      <Modal
        opened={showMutateControls && Boolean(actionModal)}
        onClose={closeModal}
        title={
          actionModal?.action === 'backfill_missing_codes'
            ? '기존 FC 추천코드 일괄 발급'
            : actionModal?.action === 'rotate_code'
              ? '추천코드 재발급'
              : actionModal?.action === 'disable_code'
                ? '추천코드 비활성'
                : '레거시 추천인 연결'
        }
        centered
      >
        <Stack gap="md">
          {actionModal?.action === 'backfill_missing_codes' ? (
            <Alert color="orange" icon={<IconAlertCircle size={16} />}>
              한 번 실행할 때 최대 {BACKFILL_LIMIT}명의 미발급 FC를 처리합니다. 활성 코드가 있는 FC는 자동으로 건너뜁니다.
            </Alert>
          ) : actionModal?.action === 'link_legacy_recommender' ? (
            <>
              <Text size="sm">
                대상: <strong>{actionModal.target.inviteeName}</strong> ({actionModal.target.inviteePhone})
              </Text>
              <Text size="sm" c="dimmed">
                기존 추천인 문자열: {actionModal.target.legacyRecommenderName}
              </Text>
              <RecommenderSelect
                value={legacySelectedInviterFcId}
                inviteeFcId={actionModal.target.inviteeFcId}
                onChange={(candidate) => setLegacySelectedInviterFcId(candidate?.fcId ?? null)}
              />
              <Textarea
                label="사유"
                placeholder="운영 연결 사유를 입력해주세요."
                minRows={3}
                value={reasonInput}
                onChange={(event) => setReasonInput(event.currentTarget.value)}
              />
            </>
          ) : (
            <>
              <Text size="sm">
                대상: <strong>{actionModal?.target.name}</strong> ({actionModal?.target.phone})
              </Text>
              <Textarea
                label="사유"
                placeholder="운영 사유를 입력해주세요."
                minRows={3}
                value={reasonInput}
                onChange={(event) => setReasonInput(event.currentTarget.value)}
              />
            </>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={closeModal}>
              취소
            </Button>
            <Button
              color={actionModal?.action === 'disable_code' ? 'red' : 'orange'}
              loading={mutation.isPending}
              onClick={submitAction}
            >
              실행
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
