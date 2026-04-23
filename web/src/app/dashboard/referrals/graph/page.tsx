'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ActionIcon, Badge, Box, Button, Center, Group, Loader, Paper, ScrollArea, Slider, Stack, Switch, Text, TextInput, Tooltip } from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import { IconAdjustmentsHorizontal, IconArrowLeft, IconFocus2, IconRefresh, IconSearch, IconSettings, IconX } from '@tabler/icons-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { ReferralGraphCanvasProps } from '@/components/referrals/ReferralGraphCanvas';
import { GraphNodeDrawer } from '@/components/referrals/GraphNodeDrawer';
import {
  DEFAULT_REFERRAL_GRAPH_PHYSICS,
  type GraphApiResponse,
  type GraphEdge,
  type GraphNode,
  type ReferralGraphPhysicsSettings,
} from '@/types/referral-graph';

const ReferralGraphCanvas = dynamic<ReferralGraphCanvasProps>(
  () => import('@/components/referrals/ReferralGraphCanvas').then((m) => m.ReferralGraphCanvas),
  {
    ssr: false,
    loading: () => (
      <Center h="100%">
        <Stack align="center" gap="xs">
          <Loader size="lg" color="orange" />
          <Text c="dimmed" size="sm">
            그래프 로딩 중...
          </Text>
        </Stack>
      </Center>
    ),
  },
);

const STATUS_FILTERS = [
  { key: 'has_active_code', label: '사용 중 코드', color: 'orange' },
  { key: 'code_disabled', label: '사용 중지', color: 'gray' },
  { key: 'missing_code', label: '코드 없음', color: 'gray' },
  { key: 'legacy_unresolved', label: '예전 기록 확인', color: 'yellow' },
] as const;

type StatusFilterKey = (typeof STATUS_FILTERS)[number]['key'];

const PHYSICS_SLIDERS: Array<{
  key: keyof ReferralGraphPhysicsSettings;
  label: string;
  description: string;
  minLabel: string;
  maxLabel: string;
}> = [
  { key: 'centerGravity', label: '중심 모임', description: '그래프가 가운데로 모이는 정도', minLabel: '자유롭게', maxLabel: '가운데로' },
  { key: 'repulsion', label: '반발력', description: '표시들이 서로 밀어내는 정도', minLabel: '가깝게', maxLabel: '멀리' },
  { key: 'linkStrength', label: '연결 강도', description: '연결된 표시끼리 당기는 정도', minLabel: '느슨하게', maxLabel: '단단하게' },
  { key: 'linkDistance', label: '연결 거리', description: '연결된 표시 사이 거리', minLabel: '짧게', maxLabel: '길게' },
] as const;

const PHYSICS_PRESETS: Array<{
  key: string;
  label: string;
  values: ReferralGraphPhysicsSettings;
}> = [
  { key: 'balanced', label: '균형', values: DEFAULT_REFERRAL_GRAPH_PHYSICS },
  { key: 'spread', label: '퍼짐', values: { centerGravity: 44, repulsion: 74, linkStrength: 58, linkDistance: 72 } },
  { key: 'tight', label: '밀집', values: { centerGravity: 72, repulsion: 28, linkStrength: 84, linkDistance: 18 } },
] as const;

function fetchGraphData(): Promise<GraphApiResponse> {
  return fetch('/api/admin/referrals/graph').then(async (res) => {
    if (!res.ok) {
      throw new Error('그래프 데이터를 불러오지 못했습니다.');
    }

    return res.json();
  });
}

function buildAdjacency(edges: GraphEdge[]) {
  const adjacency = new Map<string, Set<string>>();

  for (const edge of edges) {
    const source = typeof edge.source === 'object' ? (edge.source as GraphNode).id : edge.source;
    const target = typeof edge.target === 'object' ? (edge.target as GraphNode).id : edge.target;

    if (!adjacency.has(source)) adjacency.set(source, new Set());
    if (!adjacency.has(target)) adjacency.set(target, new Set());
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  }

  return adjacency;
}

function bfsNeighborhood(startId: string, adjacency: Map<string, Set<string>>, hops: number) {
  const visited = new Set<string>([startId]);
  let frontier = new Set<string>([startId]);

  for (let i = 0; i < hops; i += 1) {
    const next = new Set<string>();

    for (const nodeId of frontier) {
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.add(neighbor);
        }
      }
    }

    frontier = next;
    if (frontier.size === 0) break;
  }

  return visited;
}

export default function ReferralGraphPage() {
  const graphQuery = useQuery({
    queryKey: ['referral-graph'],
    queryFn: fetchGraphData,
    staleTime: 2 * 60 * 1000,
  });

  const graphData = graphQuery.data;
  const allNodes = useMemo(() => graphData?.nodes ?? [], [graphData]);
  const allEdges = useMemo(() => graphData?.edges ?? [], [graphData]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [drawerOpen, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [depthHops, setDepthHops] = useState<1 | 2 | 3>(2);
  const [hideIsolatedNodes, setHideIsolatedNodes] = useState(true);
  const [enabledStatuses, setEnabledStatuses] = useState<StatusFilterKey[]>(STATUS_FILTERS.map((item) => item.key));
  const [fitRequestId, setFitRequestId] = useState(0);
  const [resetLayoutRequestId, setResetLayoutRequestId] = useState(0);
  const [physicsPanelOpen, setPhysicsPanelOpen] = useState(false);
  const [storedPhysicsSettings, setStoredPhysicsSettings] = useLocalStorage<ReferralGraphPhysicsSettings>({
    key: 'referral-graph-physics-settings-v1',
    defaultValue: DEFAULT_REFERRAL_GRAPH_PHYSICS,
    getInitialValueInEffect: true,
  });
  const [draftPhysicsSettings, setDraftPhysicsSettings] = useState<ReferralGraphPhysicsSettings | null>(null);
  const physicsSettings = draftPhysicsSettings ?? storedPhysicsSettings;
  const [appliedPhysicsSettings, setAppliedPhysicsSettings] = useState<ReferralGraphPhysicsSettings>(DEFAULT_REFERRAL_GRAPH_PHYSICS);

  const containerRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef(0);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const commitCanvasSize = (nextWidth: number, nextHeight: number) => {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        setCanvasSize((current) => {
          if (current?.width === nextWidth && current.height === nextHeight) {
            return current;
          }

          return {
            width: nextWidth,
            height: nextHeight,
          };
        });
      });
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      commitCanvasSize(
        Math.max(1, Math.floor(entry.contentRect.width)),
        Math.max(1, Math.floor(entry.contentRect.height)),
      );
    });

    observer.observe(el);
    commitCanvasSize(
      Math.max(1, Math.floor(el.clientWidth)),
      Math.max(1, Math.floor(el.clientHeight)),
    );

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(resizeFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setAppliedPhysicsSettings((current) => {
        if (
          current.centerGravity === physicsSettings.centerGravity
          && current.repulsion === physicsSettings.repulsion
          && current.linkStrength === physicsSettings.linkStrength
          && current.linkDistance === physicsSettings.linkDistance
        ) {
          return current;
        }

        return physicsSettings;
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [physicsSettings]);

  const isCanvasReady = Boolean(canvasSize && canvasSize.width >= 120 && canvasSize.height >= 120);

  const enabledStatusSet = useMemo(() => new Set(enabledStatuses), [enabledStatuses]);
  const matchesSearch = useCallback((node: GraphNode) => {
    const keyword = deferredSearchTerm.trim().toLowerCase();
    if (!keyword) {
      return true;
    }

    return `${node.name} ${node.affiliation} ${node.activeCode ?? ''}`.toLowerCase().includes(keyword);
  }, [deferredSearchTerm]);

  const baseVisibleNodes = useMemo(() => {
    return allNodes.filter((node) => {
      if (node.id !== selectedNodeId && hideIsolatedNodes && node.isIsolated) {
        return false;
      }

      if (node.id === selectedNodeId) {
        return true;
      }

      if (!matchesSearch(node)) {
        return false;
      }

      return (
        enabledStatusSet.has(node.nodeStatus)
        || (node.hasLegacyUnresolved && enabledStatusSet.has('legacy_unresolved'))
      );
    });
  }, [allNodes, enabledStatusSet, hideIsolatedNodes, matchesSearch, selectedNodeId]);

  const baseVisibleNodeIds = useMemo(() => new Set(baseVisibleNodes.map((node) => node.id)), [baseVisibleNodes]);
  const baseVisibleEdges = useMemo(() => {
    return allEdges.filter((edge) => {
      const source = typeof edge.source === 'object' ? (edge.source as GraphNode).id : edge.source;
      const target = typeof edge.target === 'object' ? (edge.target as GraphNode).id : edge.target;
      return baseVisibleNodeIds.has(source) && baseVisibleNodeIds.has(target);
    });
  }, [allEdges, baseVisibleNodeIds]);

  const focusNodeIds = useMemo(() => {
    if (!selectedNodeId || !baseVisibleNodeIds.has(selectedNodeId)) {
      return null;
    }

    const adjacency = buildAdjacency(baseVisibleEdges);
    return bfsNeighborhood(selectedNodeId, adjacency, depthHops);
  }, [baseVisibleEdges, baseVisibleNodeIds, depthHops, selectedNodeId]);

  const visibleNodes = useMemo(() => {
    if (!focusNodeIds) {
      return baseVisibleNodes;
    }

    return baseVisibleNodes.filter((node) => focusNodeIds.has(node.id));
  }, [baseVisibleNodes, focusNodeIds]);

  const visibleNodeIdSet = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);

  const visibleEdges = useMemo(() => {
    return baseVisibleEdges.filter((edge) => {
      const source = typeof edge.source === 'object' ? (edge.source as GraphNode).id : edge.source;
      const target = typeof edge.target === 'object' ? (edge.target as GraphNode).id : edge.target;
      return visibleNodeIdSet.has(source) && visibleNodeIdSet.has(target);
    });
  }, [baseVisibleEdges, visibleNodeIdSet]);

  const effectiveSelectedNodeId = selectedNodeId && visibleNodeIdSet.has(selectedNodeId) ? selectedNodeId : null;
  const allNodeMap = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);

  const selectedNode = useMemo(
    () => (selectedNodeId ? allNodeMap.get(selectedNodeId) ?? null : null),
    [allNodeMap, selectedNodeId],
  );

  const connectedNodes = useMemo(() => {
    if (!selectedNodeId) return [];

    const related = new Map<
      string,
      {
        node: GraphNode;
        direction: 'outbound' | 'inbound';
      }
    >();

    for (const edge of allEdges) {
      const source = typeof edge.source === 'object' ? (edge.source as GraphNode).id : edge.source;
      const target = typeof edge.target === 'object' ? (edge.target as GraphNode).id : edge.target;

      if (source === selectedNodeId && allNodeMap.has(target)) {
        related.set(target, {
          node: allNodeMap.get(target)!,
          direction: 'outbound',
        });
      }

      if (target === selectedNodeId && allNodeMap.has(source)) {
        related.set(source, {
          node: allNodeMap.get(source)!,
          direction: 'inbound',
        });
      }
    }

    return Array.from(related.values()).sort((left, right) => left.node.name.localeCompare(right.node.name, 'ko-KR'));
  }, [allEdges, allNodeMap, selectedNodeId]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNodeId(node.id);
    openDrawer();
  }, [openDrawer]);

  const handleClearSelection = useCallback(() => {
    setSelectedNodeId(null);
    closeDrawer();
  }, [closeDrawer]);

  const toggleStatus = useCallback((key: StatusFilterKey) => {
    setEnabledStatuses((current) => {
      if (current.includes(key)) {
        return current.filter((item) => item !== key);
      }

      return [...current, key];
    });
  }, []);

  const toggleHideIsolatedNodes = useCallback(() => {
    setHideIsolatedNodes((current) => !current);
  }, []);

  const updatePhysicsSetting = useCallback(
    (key: keyof ReferralGraphPhysicsSettings, value: number) => {
      setDraftPhysicsSettings((current) => ({
        ...(current ?? physicsSettings),
        [key]: value,
      }));
    },
    [physicsSettings],
  );

  const persistPhysicsSetting = useCallback(
    (key: keyof ReferralGraphPhysicsSettings, value: number) => {
      const next = {
        ...physicsSettings,
        [key]: value,
      };
      setDraftPhysicsSettings(null);
      setStoredPhysicsSettings(next);
    },
    [physicsSettings, setStoredPhysicsSettings],
  );

  const applyPhysicsPreset = useCallback((values: ReferralGraphPhysicsSettings) => {
    setDraftPhysicsSettings(null);
    setStoredPhysicsSettings(values);
  }, [setStoredPhysicsSettings]);

  const resetPhysicsSettings = useCallback(() => {
    setDraftPhysicsSettings(null);
    setStoredPhysicsSettings(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  }, [setStoredPhysicsSettings]);

  return (
    <Box
      style={{
        height: 'calc(100vh - 64px)',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)',
        overflow: 'hidden',
      }}
    >
      <Box
        px="md"
        py="sm"
        style={{
          background: 'rgba(255, 255, 255, 0.94)',
          borderBottom: '1px solid #dbe4ee',
          flexShrink: 0,
        }}
      >
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap" align="center">
            <Group gap="xs" wrap="nowrap">
              <Tooltip label="리스트로 돌아가기" withArrow>
                <ActionIcon
                  component={Link}
                  href="/dashboard/referrals"
                  variant="subtle"
                  color="gray"
                  size="sm"
                >
                  <IconArrowLeft size={16} />
                </ActionIcon>
              </Tooltip>

              <Box>
                <Text size="sm" fw={700} c="dark.8">
                  추천인 그래프
                </Text>
                <Text size="xs" c="gray.7">
                  현재 추천인으로 연결된 관계만 보여줍니다. 예전 `recommender` 문자열만 남은 사람은 노드 경고로 따로 표시합니다.
                </Text>
              </Box>
            </Group>

            <Group gap="xs" wrap="nowrap">
              <Button size="xs" variant="light" onClick={() => setFitRequestId((value) => value + 1)}>
                화면 맞춤
              </Button>
              <Tooltip label="고정된 항목을 풀고 배치를 다시 정리합니다." withArrow>
                <Button size="xs" variant="light" onClick={() => setResetLayoutRequestId((value) => value + 1)}>
                  고정 해제
                </Button>
              </Tooltip>
              <Button
                size="xs"
                variant="subtle"
                leftSection={<IconFocus2 size={14} />}
                onClick={handleClearSelection}
                disabled={!selectedNodeId}
              >
                선택 해제
              </Button>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                loading={graphQuery.isFetching}
                onClick={() => graphQuery.refetch()}
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Group>
          </Group>

          <Group justify="space-between" wrap="wrap" align="center">
            <Group gap="xs" wrap="wrap">
              <TextInput
                placeholder="이름·소속·코드 검색"
                size="xs"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.currentTarget.value)}
                leftSection={<IconSearch size={14} />}
                rightSection={
                  searchTerm ? (
                    <ActionIcon size="xs" variant="subtle" onClick={() => setSearchTerm('')}>
                      <IconX size={12} />
                    </ActionIcon>
                  ) : null
                }
                styles={{ input: { background: '#ffffff', color: '#0f172a', borderColor: '#cbd5e1' } }}
              />

              <Group gap="xs" wrap="wrap">
                {STATUS_FILTERS.map((item) => {
                  const active = enabledStatusSet.has(item.key);
                  return (
                    <Button
                      key={item.key}
                      size="xs"
                      variant={active ? 'filled' : 'default'}
                      color={item.color}
                      onClick={() => toggleStatus(item.key)}
                    >
                      {item.label}
                    </Button>
                  );
                })}
              </Group>

              {selectedNodeId ? (
                <Group gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    범위
                  </Text>
                  {[1, 2, 3].map((value) => (
                    <Button
                      key={value}
                      size="xs"
                      variant={depthHops === value ? 'filled' : 'default'}
                      color="orange"
                      onClick={() => setDepthHops(value as 1 | 2 | 3)}
                    >
                      {value}단계
                    </Button>
                  ))}
                </Group>
              ) : null}

              <Switch
                checked={hideIsolatedNodes}
                onChange={toggleHideIsolatedNodes}
                label="연결 없는 사람 숨기기"
                size="sm"
              />
            </Group>

            <Group gap="xs" wrap="wrap">
              {effectiveSelectedNodeId ? (
                <Badge color="orange" variant="light">
                  선택된 사람 주변 {depthHops}단계
                </Badge>
              ) : null}
              <Badge color="gray" variant="light">
                조회 전용
              </Badge>
              <Badge color="gray" variant="light">
                {visibleNodes.length.toLocaleString('ko-KR')}명
              </Badge>
              <Badge color="gray" variant="light">
                {visibleEdges.length.toLocaleString('ko-KR')}개 연결
              </Badge>
            </Group>
          </Group>

        </Stack>
      </Box>

      <Box ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {graphQuery.isLoading ? (
          <Center h="100%">
            <Stack align="center" gap="xs">
              <Loader size="lg" color="orange" />
              <Text c="dimmed" size="sm">
                추천인 그래프 불러오는 중...
              </Text>
            </Stack>
          </Center>
        ) : graphQuery.isError ? (
          <Center h="100%">
            <Stack align="center" gap="xs">
              <Text c="red.4" size="sm">
                그래프를 불러오지 못했습니다.
              </Text>
              <Button size="xs" variant="light" onClick={() => graphQuery.refetch()}>
                다시 시도
              </Button>
            </Stack>
          </Center>
        ) : !isCanvasReady || !canvasSize ? (
          <Center h="100%">
            <Stack align="center" gap="xs">
              <Loader size="lg" color="orange" />
              <Text c="dimmed" size="sm">
                화면 준비 중...
              </Text>
            </Stack>
          </Center>
        ) : visibleNodes.length === 0 ? (
          <Center h="100%">
            <Stack align="center" gap="xs">
              <Text c="dimmed" size="sm">
                지금 조건에 맞는 사람이 없습니다.
              </Text>
              <Button size="xs" variant="light" onClick={handleClearSelection}>
                선택 해제
              </Button>
            </Stack>
          </Center>
        ) : (
          <ReferralGraphCanvas
            nodes={visibleNodes}
            edges={visibleEdges}
            selectedNodeId={effectiveSelectedNodeId}
            searchTerm={deferredSearchTerm}
            depthHops={depthHops}
            fitRequestId={fitRequestId}
            resetLayoutRequestId={resetLayoutRequestId}
            physicsSettings={appliedPhysicsSettings}
            onNodeClick={handleNodeClick}
            width={canvasSize.width}
            height={canvasSize.height}
          />
        )}

        <Tooltip label="배치 설정" withArrow>
          <ActionIcon
            variant="filled"
            radius="xl"
            size="lg"
            color={physicsPanelOpen ? 'orange' : 'dark'}
            onClick={() => setPhysicsPanelOpen((current) => !current)}
            style={{
              position: 'absolute',
              right: 16,
              top: 16,
              zIndex: 4,
              boxShadow: '0 12px 24px rgba(15, 23, 42, 0.18)',
            }}
          >
            <IconSettings size={18} />
          </ActionIcon>
        </Tooltip>

        <Paper
          withBorder
          radius="md"
          p="sm"
          style={{
            position: 'absolute',
            left: 16,
            bottom: 16,
            background: 'rgba(255, 255, 255, 0.94)',
            borderColor: '#dbe4ee',
            pointerEvents: 'none',
            boxShadow: '0 18px 36px rgba(15, 23, 42, 0.08)',
          }}
        >
          <Stack gap={4}>
            <Text size="xs" fw={700} c="dark.7">
              범례
            </Text>
            <Group gap={6} wrap="wrap">
              <Badge color="orange" variant="light">
                추천인 연결
              </Badge>
              <Badge color="yellow" variant="light">
                예전 기록 확인
              </Badge>
                  <Badge color="yellow" variant="filled">
                    본부장
                  </Badge>
            </Group>
          </Stack>
        </Paper>

        {physicsPanelOpen ? (
          <Paper
            radius="lg"
            withBorder
            p={0}
            style={{
              position: 'absolute',
              right: 16,
              top: 64,
              bottom: 16,
              width: 340,
              zIndex: 4,
              background: '#3c362f',
              borderColor: '#5f564c',
              boxShadow: '0 24px 48px rgba(15, 23, 42, 0.24)',
              overflow: 'hidden',
            }}
          >
            <Stack gap={0} h="100%">
              <Group justify="space-between" px="md" py="sm" style={{ borderBottom: '1px solid #5f564c' }}>
                <Group gap="xs">
                  <IconAdjustmentsHorizontal size={16} color="#f3eee6" />
                  <Text size="sm" fw={700} c="#f3eee6">
                    장력 설정
                  </Text>
                </Group>
                <Group gap="xs">
                  <ActionIcon variant="subtle" color="gray" onClick={resetPhysicsSettings}>
                    <IconRefresh size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" onClick={() => setPhysicsPanelOpen(false)}>
                    <IconX size={16} />
                  </ActionIcon>
                </Group>
              </Group>

              <ScrollArea style={{ flex: 1 }}>
                <Stack gap="lg" p="md">
                  <Box>
                    <Text size="xs" fw={700} c="#d8cfc4" mb="xs">
                      프리셋
                    </Text>
                    <Group gap="xs" wrap="wrap">
                      {PHYSICS_PRESETS.map((preset) => (
                        <Button
                          key={preset.key}
                          size="compact-sm"
                          radius="xl"
                          variant="light"
                          color="orange"
                          onClick={() => applyPhysicsPreset(preset.values)}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </Group>
                  </Box>

                  <Box>
                    <Text size="xs" fw={700} c="#d8cfc4" mb="xs">
                      장력
                    </Text>
                    <Stack gap="lg">
                      {PHYSICS_SLIDERS.map((slider) => (
                        <Stack key={slider.key} gap={6}>
                          <Group justify="space-between" align="center">
                            <Text size="sm" fw={600} c="#f8f5ef">
                              {slider.label}
                            </Text>
                            <Badge variant="light" color="orange">
                              {physicsSettings[slider.key]}
                            </Badge>
                          </Group>
                          <Text size="xs" c="#b6a998">
                            {slider.description}
                          </Text>
                          <Slider
                            value={physicsSettings[slider.key]}
                            onChange={(value) => updatePhysicsSetting(slider.key, value)}
                            onChangeEnd={(value) => persistPhysicsSetting(slider.key, value)}
                            min={0}
                            max={100}
                            step={1}
                            color="orange"
                            size="sm"
                            label={(value) => `${value}`}
                            styles={{
                              track: { backgroundColor: '#51473e' },
                              bar: { backgroundColor: '#f59e0b' },
                              thumb: { borderColor: '#fff7ed' },
                              label: { backgroundColor: '#2f2924', color: '#f8f5ef' },
                            }}
                          />
                          <Group justify="space-between">
                            <Text size="xs" c="#9f9488">
                              {slider.minLabel}
                            </Text>
                            <Text size="xs" c="#9f9488">
                              {slider.maxLabel}
                            </Text>
                          </Group>
                        </Stack>
                      ))}
                    </Stack>
                  </Box>
                </Stack>
              </ScrollArea>
            </Stack>
          </Paper>
        ) : null}

      </Box>

      <GraphNodeDrawer
        node={selectedNode}
        opened={drawerOpen && Boolean(effectiveSelectedNodeId)}
        onClose={handleClearSelection}
        onSelectNode={(fcId) => {
          setSelectedNodeId(fcId);
          openDrawer();
        }}
        connectedNodes={connectedNodes}
      />
    </Box>
  );
}
