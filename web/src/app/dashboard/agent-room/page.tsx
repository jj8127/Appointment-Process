'use client';

import {
  Badge,
  Button,
  Grid,
  Group,
  LoadingOverlay,
  Paper,
  Progress,
  ScrollArea,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';

import { AgentRoomScene } from '@/components/agent-room/AgentRoomScene';
import {
  type AgentRoomAgent,
  type AgentRoomSnapshot,
  type AgentRoomStatus,
} from '@/types/agent-room';

const STATUS_META: Record<AgentRoomStatus, { color: string; label: string }> = {
  coding: { color: 'orange', label: '작성 중' },
  done: { color: 'green', label: '완료' },
  idle: { color: 'gray', label: '유휴' },
  researching: { color: 'blue', label: '탐색 중' },
  thinking: { color: 'violet', label: '사고 중' },
  waiting: { color: 'yellow', label: '대기 중' },
};

const EMPTY_SNAPSHOT: AgentRoomSnapshot = {
  agents: [],
  focus: {
    activeCount: 0,
    quietAgentIds: [],
    quietCount: 0,
    recentCount: 0,
    stageAgentIds: [],
    stageCount: 0,
  },
  generatedAt: '',
  hosts: [],
  summary: {
    activeCount: 0,
    quietCount: 0,
    recentCount: 0,
    statusCounts: {
      coding: 0,
      done: 0,
      idle: 0,
      researching: 0,
      thinking: 0,
      waiting: 0,
    },
    total: 0,
    vendorCounts: {
      claude: 0,
      codex: 0,
    },
  },
  warnings: [],
  workspace: null,
};

const SHELL_PANEL_STYLE = {
  background: 'linear-gradient(180deg, rgba(16, 19, 29, 0.98), rgba(8, 10, 16, 0.98))',
  border: '1px solid rgba(255,255,255,0.07)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03), 0 28px 60px rgba(0,0,0,0.34)',
};

const MONO_STYLE = {
  fontFamily: 'var(--mantine-font-family-monospace)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
};

const STAGE_AGENT_LIMIT = 6;
const RECENT_WINDOW_MS = 8 * 60_000;
const ACTIVE_STATUSES: AgentRoomStatus[] = ['coding', 'researching', 'thinking', 'waiting'];

async function fetchAgentRoom(): Promise<AgentRoomSnapshot> {
  const response = await fetch('/api/agent-room', {
    cache: 'no-store',
  });

  if (!response.ok) {
    let message = '에이전트 스냅샷을 불러오지 못했습니다.';
    try {
      const payload = await response.json();
      if (payload?.error) {
        message = String(payload.error);
      }
    } catch {
      // Ignore JSON parsing errors.
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentRoomSnapshot>;
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.NaN;
  }
  return new Date(value).getTime();
}

function getAgeMs(value: string | null, nowMs: number) {
  const timestamp = parseTimestamp(value);
  if (!Number.isFinite(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }
  return nowMs - timestamp;
}

function isActiveStatus(status: AgentRoomStatus) {
  return ACTIVE_STATUSES.includes(status);
}

function formatUpdatedAt(value: string | null, nowMs: number) {
  if (!value) {
    return '최근 시각 없음';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '시각 파싱 실패';
  }

  const secondsAgo = Math.max(0, Math.round((nowMs - date.getTime()) / 1000));
  if (secondsAgo < 60) {
    return `${date.toLocaleTimeString('ko-KR', { hour12: false })} · 방금`;
  }
  if (secondsAgo < 3600) {
    return `${date.toLocaleTimeString('ko-KR', { hour12: false })} · ${Math.floor(secondsAgo / 60)}분 전`;
  }
  return `${date.toLocaleTimeString('ko-KR', { hour12: false })} · ${Math.floor(secondsAgo / 3600)}시간 전`;
}

function getActivityPercent(agent: AgentRoomAgent, nowMs: number) {
  const ageMs = getAgeMs(agent.updatedAt, nowMs);
  const freshness = Number.isFinite(ageMs) ? Math.max(12, 100 - ageMs / 900) : 12;

  const statusBase: Record<AgentRoomStatus, number> = {
    coding: 94,
    done: 88,
    idle: 24,
    researching: 82,
    thinking: 76,
    waiting: 48,
  };

  return Math.round(Math.min(100, Math.max(statusBase[agent.status], freshness)));
}

function getTone(color: string) {
  switch (color) {
    case 'orange':
      return '#f47a2c';
    case 'blue':
      return '#4f94ff';
    case 'violet':
      return '#9e6cff';
    case 'yellow':
      return '#e7ba4c';
    case 'green':
      return '#4dbd77';
    default:
      return '#7b8597';
  }
}

function getAttentionPriority(agent: AgentRoomAgent) {
  switch (agent.status) {
    case 'coding':
      return 50;
    case 'researching':
      return 40;
    case 'thinking':
      return 30;
    case 'waiting':
      return 20;
    case 'done':
      return 10;
    case 'idle':
      return 0;
  }
}

function deriveAgentBuckets(roster: AgentRoomAgent[], snapshot: AgentRoomSnapshot, nowMs: number) {
  const stageAgentIds = snapshot.focus.stageAgentIds.length > 0 ? snapshot.focus.stageAgentIds : deriveStageIds(roster, nowMs);
  const stageIdSet = new Set(stageAgentIds);
  const quietAgentIds = snapshot.focus.quietAgentIds.length > 0
    ? snapshot.focus.quietAgentIds
    : roster.filter((agent) => !stageIdSet.has(agent.id)).map((agent) => agent.id);
  const agentById = new Map(roster.map((agent) => [agent.id, agent] as const));

  return {
    quietAgents: quietAgentIds.map((id) => agentById.get(id)).filter((agent): agent is AgentRoomAgent => Boolean(agent)),
    stageAgents: stageAgentIds.map((id) => agentById.get(id)).filter((agent): agent is AgentRoomAgent => Boolean(agent)),
  };
}

function deriveStageIds(roster: AgentRoomAgent[], nowMs: number) {
  const ranked = roster
    .map((agent) => ({
      agent,
      ageMs: getAgeMs(agent.updatedAt, nowMs),
    }))
    .map((item) => ({
      ...item,
      isRecent: item.ageMs <= RECENT_WINDOW_MS,
    }))
    .filter((item) => isActiveStatus(item.agent.status) || item.isRecent)
    .sort((left, right) => {
      const leftPriority = getAttentionPriority(left.agent);
      const rightPriority = getAttentionPriority(right.agent);
      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }
      if (left.isRecent !== right.isRecent) {
        return Number(right.isRecent) - Number(left.isRecent);
      }
      if (left.ageMs !== right.ageMs) {
        return left.ageMs - right.ageMs;
      }
      return left.agent.name.localeCompare(right.agent.name);
    });

  if (ranked.length === 0) {
    return roster.slice(0, STAGE_AGENT_LIMIT).map((agent) => agent.id);
  }

  return ranked.slice(0, STAGE_AGENT_LIMIT).map((item) => item.agent.id);
}

function sortAgents(agents: AgentRoomAgent[]) {
  return [...agents].sort((left, right) => {
    const leftTime = parseTimestamp(left.updatedAt);
    const rightTime = parseTimestamp(right.updatedAt);
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return left.name.localeCompare(right.name);
  });
}

function getDetailText(agent: AgentRoomAgent) {
  if (agent.consoleDetail) {
    return agent.consoleDetail;
  }
  if (agent.detail) {
    return agent.detail;
  }

  switch (agent.status) {
    case 'coding':
      return 'Patch queued into active workspace.';
    case 'researching':
      return 'Search and fetch cycle is active.';
    case 'thinking':
      return 'Reasoning loop is currently running.';
    case 'waiting':
      return 'Waiting on tool or parent response.';
    case 'done':
      return 'Latest task completed and parked.';
    case 'idle':
      return 'No recent events were detected.';
  }
}

function getFreshnessTone(agent: AgentRoomAgent, nowMs: number) {
  const time = parseTimestamp(agent.updatedAt);
  if (!Number.isFinite(time)) {
    return { color: 'gray', label: 'cold' };
  }

  const age = nowMs - time;
  if (age < 60_000) {
    return { color: 'green', label: 'live' };
  }
  if (age < 5 * 60_000) {
    return { color: 'yellow', label: 'warm' };
  }
  return { color: 'gray', label: 'cold' };
}

export default function AgentRoomPage() {
  const { data, error, isFetching, isLoading, refetch } = useQuery({
    queryFn: fetchAgentRoom,
    queryKey: ['agent-room'],
    refetchInterval: 5_000,
    staleTime: 4_000,
  });

  const snapshot = data ?? EMPTY_SNAPSHOT;
  const roster = sortAgents(snapshot.agents);
  const snapshotTime = parseTimestamp(snapshot.generatedAt);
  const nowMs = Number.isFinite(snapshotTime) ? snapshotTime : 0;
  const { quietAgents, stageAgents } = deriveAgentBuckets(roster, snapshot, nowMs);
  const stageCount = stageAgents.length;
  const activeCount = snapshot.summary.activeCount;
  const recentCount = snapshot.summary.recentCount;
  const quietCount = quietAgents.length;

  return (
    <Stack gap="md">
      <Paper
        radius={28}
        p={{ base: 'md', md: 'xl' }}
        style={{
          background: 'radial-gradient(circle at top, rgba(34, 40, 60, 0.42), transparent 42%), linear-gradient(180deg, #11141d 0%, #090b10 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 38px 80px rgba(3,5,10,0.4)',
        }}
      >
        <Stack gap="md">
          <Group justify="space-between" align="flex-start" gap="md">
            <div>
              <Group gap="xs" mb={8}>
                <Badge color="green" variant="light">
                  LIVE
                </Badge>
                <Badge color="gray" variant="outline">
                  local runtime
                </Badge>
              </Group>
              <Title order={2} c="#f3f5f9">
                Operational Floorplan
              </Title>
            </div>

            <Group gap="sm" align="center">
              <Text c="rgba(223, 230, 241, 0.68)" size="sm" style={MONO_STYLE}>
                {snapshot.generatedAt ? `update · ${formatUpdatedAt(snapshot.generatedAt, nowMs)}` : 'snapshot · loading'}
              </Text>
              <Button
                leftSection={<IconRefresh size={16} stroke={1.8} />}
                loading={isFetching}
                onClick={() => void refetch()}
                radius="xl"
                size="sm"
                style={{
                  background: 'linear-gradient(180deg, #1c2433, #10151f)',
                  border: '1px solid rgba(255,255,255,0.09)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
                }}
              >
                Sync
              </Button>
            </Group>
          </Group>

          {error instanceof Error ? (
            <Paper
              radius="xl"
              p="md"
              style={{
                background: 'rgba(55, 18, 24, 0.76)',
                border: '1px solid rgba(255, 107, 107, 0.26)',
              }}
            >
              <Group gap="sm" align="center">
                <IconAlertTriangle size={18} stroke={1.8} color="#ff9d9d" />
                <Text fw={700} c="#ffe1e1">
                  {error.message}
                </Text>
              </Group>
            </Paper>
          ) : null}

          <Grid gutter="md">
            <Grid.Col span={{ base: 12, xl: 9 }}>
              <Paper radius="xl" p="sm" pos="relative" style={SHELL_PANEL_STYLE}>
                <LoadingOverlay visible={isLoading} zIndex={2} overlayProps={{ radius: 'xl', blur: 1 }} />
                <AgentRoomScene agents={stageAgents} />
              </Paper>
            </Grid.Col>

            <Grid.Col span={{ base: 12, xl: 3 }}>
              <Paper radius="xl" p="md" style={SHELL_PANEL_STYLE}>
                <Stack gap="md">
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Text size="xs" c="rgba(159, 170, 189, 0.74)" style={MONO_STYLE}>
                        Roster
                      </Text>
                      <Text fw={800} c="#f2f5fb" mt={4}>
                        Live Agents
                      </Text>
                    </div>
                    <Badge variant="filled" color="dark">
                      {snapshot.summary.total} total
                    </Badge>
                  </Group>

                  <Group gap="xs">
                    <Badge color="violet" variant="light">
                      active {activeCount}
                    </Badge>
                    <Badge color="blue" variant="light">
                      recent {recentCount}
                    </Badge>
                    <Badge color="gray" variant="light">
                      quiet {quietCount}
                    </Badge>
                  </Group>

                  <Paper
                    radius="lg"
                    p="sm"
                    style={{
                      background: 'rgba(8, 11, 17, 0.78)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <Group justify="space-between" align="center">
                      <Text size="xs" c="rgba(159, 170, 189, 0.74)" style={MONO_STYLE}>
                        On Floor
                      </Text>
                      <Badge color="green" variant="light">
                        {stageCount}
                      </Badge>
                    </Group>

                    <Stack gap="xs" mt="sm">
                      {stageAgents.length > 0 ? stageAgents.slice(0, 3).map((agent) => {
                        const tone = getTone(STATUS_META[agent.status].color);
                        const freshness = getFreshnessTone(agent, nowMs);

                        return (
                          <Paper
                            key={agent.id}
                            radius="lg"
                            p="sm"
                            style={{
                              background: 'linear-gradient(180deg, rgba(17, 21, 32, 0.98), rgba(9, 12, 19, 0.98))',
                              border: `1px solid ${tone}2a`,
                              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03), 0 12px 28px rgba(0,0,0,0.24)',
                              position: 'relative',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                background: `linear-gradient(180deg, ${tone}, transparent)`,
                                height: 56,
                                left: 0,
                                opacity: 0.08,
                                position: 'absolute',
                                right: 0,
                                top: 0,
                              }}
                            />

                            <Stack gap="xs" style={{ position: 'relative' }}>
                              <Group justify="space-between" align="flex-start" gap="xs">
                                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                                  <Text fw={800} c="#f7fafc" truncate>
                                    {agent.name}
                                  </Text>
                                  <Badge size="xs" variant="filled" color={agent.vendor === 'codex' ? 'orange' : 'teal'}>
                                    {agent.vendor.toUpperCase()}
                                  </Badge>
                                </Group>
                                <Badge color={STATUS_META[agent.status].color} variant="light">
                                  {STATUS_META[agent.status].label}
                                </Badge>
                              </Group>

                              <Text c="#dce4ef" size="sm">
                                {getDetailText(agent)}
                              </Text>

                              <Progress color={tone} radius="xl" size="sm" value={getActivityPercent(agent, nowMs)} />

                              <Group justify="space-between" align="center" gap="xs">
                                <Text size="xs" c="rgba(239,244,255,0.56)">
                                  {formatUpdatedAt(agent.updatedAt, nowMs)}
                                </Text>
                                <Badge size="xs" variant="light" color={freshness.color}>
                                  {freshness.label}
                                </Badge>
                              </Group>
                            </Stack>
                          </Paper>
                        );
                      }) : (
                        <Text size="sm" c="rgba(223, 230, 241, 0.68)">
                          현재 무대에 올릴 active agent가 없습니다.
                        </Text>
                      )}
                    </Stack>
                  </Paper>

                  <Paper
                    radius="lg"
                    p="sm"
                    style={{
                      background: 'rgba(8, 11, 17, 0.78)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <Group justify="space-between" align="center">
                      <Text size="xs" c="rgba(159, 170, 189, 0.74)" style={MONO_STYLE}>
                        Quiet Stack
                      </Text>
                      <Badge color="gray" variant="light">
                        {quietCount}
                      </Badge>
                    </Group>

                    <ScrollArea.Autosize mah={320} offsetScrollbars>
                      <Stack gap="xs" mt="sm">
                        {quietAgents.length === 0 ? (
                          <Text size="sm" c="rgba(223, 230, 241, 0.64)">
                            quiet agent는 없습니다.
                          </Text>
                        ) : quietAgents.slice(0, 4).map((agent) => {
                          const freshness = getFreshnessTone(agent, nowMs);

                          return (
                            <Paper
                              key={agent.id}
                              radius="md"
                              p="xs"
                              style={{
                                background: 'rgba(255,255,255,0.025)',
                                border: '1px solid rgba(255,255,255,0.05)',
                              }}
                            >
                              <Group justify="space-between" align="center" gap="xs" wrap="nowrap">
                                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                                  <Text fw={700} c="#f7fafc" size="sm" truncate>
                                    {agent.name}
                                  </Text>
                                  <Badge size="xs" variant="light" color={STATUS_META[agent.status].color}>
                                    {STATUS_META[agent.status].label}
                                  </Badge>
                                </Group>
                                <Badge size="xs" variant="outline" color={freshness.color}>
                                  {freshness.label}
                                </Badge>
                              </Group>
                            </Paper>
                          );
                        })}
                        {quietAgents.length > 4 ? (
                          <Text size="xs" c="rgba(159, 170, 189, 0.68)">
                            나머지 quiet agent {quietAgents.length - 4}개는 접어 두었습니다.
                          </Text>
                        ) : null}
                      </Stack>
                    </ScrollArea.Autosize>
                  </Paper>

                  {snapshot.warnings.length > 0 ? (
                    <Paper
                      radius="lg"
                      p="sm"
                      style={{
                        background: 'rgba(90, 72, 16, 0.2)',
                        border: '1px solid rgba(231, 186, 76, 0.24)',
                      }}
                    >
                      <Text size="xs" c="rgba(245, 225, 168, 0.74)" style={MONO_STYLE}>
                        warnings
                      </Text>
                      <Stack gap={6} mt="sm">
                        {snapshot.warnings.slice(0, 2).map((warning) => (
                          <Text key={warning} size="sm" c="#f5e1a8">
                            {warning}
                          </Text>
                        ))}
                      </Stack>
                    </Paper>
                  ) : null}
                </Stack>
              </Paper>
            </Grid.Col>
          </Grid>
        </Stack>
      </Paper>
    </Stack>
  );
}
