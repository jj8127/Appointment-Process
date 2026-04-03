'use client';

import Link from 'next/link';
import {
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Drawer,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Timeline,
} from '@mantine/core';
import { IconCalendar, IconArrowRight, IconExternalLink, IconUser, IconUsers } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { GraphNode, GraphRelationshipState } from '@/types/referral-graph';
import type { ReferralAdminDetail } from '@/types/referrals';

const EVENT_LABELS: Record<string, string> = {
  code_generated: '코드 발급',
  code_rotated: '코드 교체',
  code_disabled: '코드 비활성화',
  admin_override_applied: '추천인 연결 변경',
};

function getEventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function getRelationshipLabel(relationshipState: GraphRelationshipState) {
  if (relationshipState === 'structured_confirmed') {
    return '구조화 + 확정';
  }

  if (relationshipState === 'confirmed') {
    return '확정';
  }

  return '구조화';
}

export type GraphNodeDrawerProps = {
  node: GraphNode | null;
  opened: boolean;
  onClose: () => void;
  onSelectNode: (fcId: string) => void;
  connectedNodes: Array<{
    node: GraphNode;
    direction: 'outbound' | 'inbound';
    relationshipState: GraphRelationshipState;
  }>;
};

async function fetchNodeDetail(fcId: string): Promise<ReferralAdminDetail | null> {
  const res = await fetch(`/api/admin/referrals?fcId=${encodeURIComponent(fcId)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.detail ?? null;
}

export function GraphNodeDrawer({
  node,
  opened,
  onClose,
  onSelectNode,
  connectedNodes,
}: GraphNodeDrawerProps) {
  const detailQuery = useQuery({
    queryKey: ['referral-graph-detail', node?.id],
    queryFn: () => fetchNodeDetail(node!.id),
    enabled: opened && node != null,
    staleTime: 60 * 1000,
  });

  const detail = detailQuery.data;

  const nodeStatusLabel =
    node?.nodeStatus === 'has_active_code'
      ? '활성 코드'
      : node?.nodeStatus === 'code_disabled'
        ? '비활성'
        : '미발급';

  const nodeStatusColor =
    node?.nodeStatus === 'has_active_code'
      ? 'orange'
      : node?.nodeStatus === 'code_disabled'
        ? 'gray'
        : 'gray';

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={
        node ? (
          <Group gap="xs" wrap="wrap">
            <IconUser size={18} />
            <Text fw={700} size="md">
              {node.name}
            </Text>
            <Badge color={nodeStatusColor} variant="light" size="sm">
              {nodeStatusLabel}
            </Badge>
            {node.hasLegacyUnresolved ? (
              <Badge color="yellow" variant="dot" size="sm">
                레거시 미해결
              </Badge>
            ) : null}
            {node.isIsolated ? (
              <Badge color="gray" variant="light" size="sm">
                고립 노드
              </Badge>
            ) : null}
          </Group>
        ) : (
          'FC 상세'
        )
      }
      position="right"
      size="md"
      overlayProps={{ opacity: 0.08, color: '#94a3b8' }}
      scrollAreaComponent={ScrollArea.Autosize}
    >
      {!node ? null : detailQuery.isLoading ? (
        <Stack align="center" py="xl">
          <Loader size="sm" color="orange" />
          <Text c="dimmed" size="sm">
            불러오는 중...
          </Text>
        </Stack>
      ) : detailQuery.isError ? (
        <Stack align="center" py="xl" gap="xs">
          <Text c="dimmed" size="sm">
            상세 정보를 불러올 수 없습니다.
          </Text>
        </Stack>
      ) : (
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Box>
              <Text size="sm" c="dimmed">
                {node.affiliation || '소속 미기록'}
              </Text>
              <Text size="xs" c="dimmed">
                {node.phone || '전화번호 미기록'}
              </Text>
            </Box>
            <Button
              component={Link}
              href={`/dashboard/referrals?fcId=${encodeURIComponent(node.id)}`}
              variant="light"
              size="xs"
              leftSection={<IconExternalLink size={14} />}
            >
              목록에서 보기
            </Button>
          </Group>

          <Group gap="xs" wrap="wrap">
            <Badge color="orange" variant="light">
              추천 {node.referralCount}명
            </Badge>
            <Badge color="blue" variant="light">
              추천받음 {node.inboundCount}명
            </Badge>
          </Group>

          <Divider />

          <Stack gap="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              현재 코드
            </Text>
            {detail?.currentCode ? (
              <>
                <Code style={{ fontSize: 20, letterSpacing: 2 }}>
                  {detail.currentCode.code}
                </Code>
                <Text size="xs" c="dimmed">
                  발급일: {formatDate(detail.currentCode.createdAt)}
                </Text>
              </>
            ) : (
              <Text size="sm" c="dimmed">
                활성 추천코드가 없습니다.
              </Text>
            )}
          </Stack>

          {detail && detail.codeHistory.length > 0 ? (
            <>
              <Divider />
              <Stack gap="xs">
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  비활성 코드 이력
                </Text>
                {detail.codeHistory.slice(0, 5).map((item) => (
                  <Group key={item.id} gap="xs" justify="space-between">
                    <Code c="dimmed">{item.code}</Code>
                    <Text size="xs" c="dimmed">
                      {item.disabledAt ? formatDate(item.disabledAt) : '-'}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </>
          ) : null}

          {connectedNodes.length > 0 ? (
            <>
              <Divider />
              <Stack gap="xs">
                <Group gap="xs">
                  <IconUsers size={14} />
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    연결된 FC ({connectedNodes.length}명)
                  </Text>
                </Group>
                {connectedNodes.slice(0, 8).map((connected) => (
                  <Group key={connected.node.id} gap="xs" justify="space-between" wrap="nowrap">
                    <Box>
                      <Text size="sm">{connected.node.name}</Text>
                      <Text size="xs" c="dimmed">
                        {connected.direction === 'outbound' ? '내가 추천' : '나를 추천'}
                        {' · '}
                        {getRelationshipLabel(connected.relationshipState)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {connected.node.affiliation || '소속 미기록'}
                      </Text>
                    </Box>
                    <Button
                      variant="subtle"
                      size="xs"
                      rightSection={<IconArrowRight size={12} />}
                      onClick={() => onSelectNode(connected.node.id)}
                    >
                      이동
                    </Button>
                  </Group>
                ))}
              </Stack>
            </>
          ) : null}

          {detail && detail.recentEvents.length > 0 ? (
            <>
              <Divider />
              <Stack gap="xs">
                <Group gap="xs">
                  <IconCalendar size={14} />
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    최근 이벤트
                  </Text>
                </Group>
                <Timeline active={-1} bulletSize={10} lineWidth={1}>
                  {detail.recentEvents.slice(0, 8).map((event) => (
                    <Timeline.Item
                      key={event.id}
                      title={
                        <Text size="xs" fw={600}>
                          {getEventLabel(event.eventType)}
                        </Text>
                      }
                    >
                      <Text size="xs" c="dimmed">
                        {event.referralCode ? <Code style={{ fontSize: 11 }}>{event.referralCode}</Code> : null}
                        {' '}
                        {formatDate(event.createdAt)}
                      </Text>
                      {event.metadata?.reason ? (
                        <Text size="xs" c="dimmed">
                          사유: {String(event.metadata.reason)}
                        </Text>
                      ) : null}
                    </Timeline.Item>
                  ))}
                </Timeline>
              </Stack>
            </>
          ) : null}
        </Stack>
      )}
    </Drawer>
  );
}
