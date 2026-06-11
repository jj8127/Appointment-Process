'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ActionIcon, Badge, Box, Button, Center, Group, Loader, Paper, ScrollArea, Slider, Stack, Switch, Text, TextInput, Tooltip } from '@mantine/core';
import { useDisclosure, useLocalStorage, useViewportSize } from '@mantine/hooks';
import { IconAdjustmentsHorizontal, IconArrowLeft, IconFocus2, IconRefresh, IconSearch, IconSettings, IconX } from '@tabler/icons-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { ReferralGraphCanvasProps } from '@/components/referrals/ReferralGraphCanvas';
import { GraphNodeDrawer } from '@/components/referrals/GraphNodeDrawer';
import { useSession } from '@/hooks/use-session';
import { buildReferralGraphDescendantCountMap } from '@/lib/referral-graph-descendants';
import { getReferralGraphResponsiveLayout } from '@/lib/referral-graph-responsive';
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
  { key: 'has_active_code', label: '추천코드 있음', color: 'orange' },
  { key: 'code_disabled', label: '추천코드 중지', color: 'gray' },
  { key: 'missing_code', label: '추천코드 없음', color: 'gray' },
  { key: 'legacy_unresolved', label: '예전 기록 확인', color: 'yellow' },
] as const;

type StatusFilterKey = (typeof STATUS_FILTERS)[number]['key'];

const PHYSICS_SLIDERS: Array<{
  key: keyof ReferralGraphPhysicsSettings;
  label: string;
  description: string;
  minLabel: string;
  maxLabel: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'centerGravity', label: 'Center force', description: '그래프를 가운데로 모으는 힘', minLabel: '0', maxLabel: '1', min: 0, max: 1, step: 0.01 },
  { key: 'repulsion', label: 'Repel force', description: '노드끼리 서로 밀어내는 힘', minLabel: '0', maxLabel: '20', min: 0, max: 20, step: 0.5 },
  { key: 'linkStrength', label: 'Link force', description: '연결된 노드가 목표 거리로 돌아가는 힘', minLabel: '0', maxLabel: '1', min: 0, max: 1, step: 0.05 },
  { key: 'linkDistance', label: 'Link distance', description: '연결된 노드 사이의 목표 거리', minLabel: '30px', maxLabel: '500px', min: 30, max: 500, step: 10 },
] as const;

const PHYSICS_PRESETS: Array<{
  key: string;
  label: string;
  values: ReferralGraphPhysicsSettings;
}> = [
  { key: 'balanced', label: '균형', values: DEFAULT_REFERRAL_GRAPH_PHYSICS },
  { key: 'spread', label: '퍼짐', values: { centerGravity: 0.2, repulsion: 15, linkStrength: 0.7, linkDistance: 350 } },
  { key: 'tight', label: '밀집', values: { centerGravity: 0.8, repulsion: 5, linkStrength: 1, linkDistance: 100 } },
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
  const { hydrated, isReadOnly, residentId, role, staffType } = useSession();
  const graphQuery = useQuery({
    queryKey: ['referral-graph', role, residentId, isReadOnly, staffType],
    queryFn: fetchGraphData,
    enabled: hydrated,
    staleTime: 2 * 60 * 1000,
  });

  const graphData = graphQuery.data;
  const isDownlineScope = graphData?.permissions.scope === 'downline';
  const allowAdminDetail = graphData?.permissions.scope !== 'downline';
  const highlightLegendLabel = graphData?.permissions.viewerRole === 'fc'
    ? '현재 로그인한 FC'
    : '본부장 강조';
  const allNodes = useMemo(() => graphData?.nodes ?? [], [graphData]);
  const allEdges = useMemo(() => graphData?.edges ?? [], [graphData]);
  const descendantCountByNodeId = useMemo(
    () => buildReferralGraphDescendantCountMap(allNodes, allEdges),
    [allEdges, allNodes],
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [drawerOpen, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [depthHops, setDepthHops] = useState<1 | 2 | 3>(2);
  const [hideIsolatedNodes, setHideIsolatedNodes] = useState(false);
  const [enabledStatuses, setEnabledStatuses] = useState<StatusFilterKey[]>(STATUS_FILTERS.map((item) => item.key));
  const [fitRequestId, setFitRequestId] = useState(0);
  const [resetLayoutRequestId, setResetLayoutRequestId] = useState(0);
  const [physicsPanelOpen, setPhysicsPanelOpen] = useState(false);
  const [storedPhysicsSettings, setStoredPhysicsSettings] = useLocalStorage<ReferralGraphPhysicsSettings>({
    key: 'referral-graph-physics-settings-v16',
    defaultValue: DEFAULT_REFERRAL_GRAPH_PHYSICS,
    getInitialValueInEffect: true,
  });
  const [draftPhysicsSettings, setDraftPhysicsSettings] = useState<ReferralGraphPhysicsSettings | null>(null);
  const physicsSettings = draftPhysicsSettings ?? storedPhysicsSettings;
  const [appliedPhysicsSettings, setAppliedPhysicsSettings] = useState<ReferralGraphPhysicsSettings>(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const { width: viewportWidth } = useViewportSize();
  const responsiveLayout = useMemo(
    () => getReferralGraphResponsiveLayout(viewportWidth),
    [viewportWidth],
  );
  const isMobileGraph = responsiveLayout.mode === 'mobile';

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
  const visibleCompletedCommissionCount = useMemo(
    () => visibleNodes.filter((node) => node.allCommissionsCompleted).length,
    [visibleNodes],
  );

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
        height: isMobileGraph ? 'auto' : responsiveLayout.shellHeight,
        minHeight: responsiveLayout.shellHeight,
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)',
        overflow: isMobileGraph ? 'visible' : 'hidden',
      }}
    >
      <Box
        px={isMobileGraph ? 'md' : 'md'}
        py={isMobileGraph ? 'sm' : 'sm'}
        style={{
          background: 'rgba(255, 255, 255, 0.94)',
          borderBottom: '1px solid #dbe4ee',
          flexShrink: 0,
        }}
      >
        <Stack gap={isMobileGraph ? 'xs' : 'sm'}>
          <Group
            justify="space-between"
            wrap={responsiveLayout.headerStacked ? 'wrap' : 'nowrap'}
            align="center"
            style={{ rowGap: isMobileGraph ? 8 : undefined }}
          >
            <Group
              gap="xs"
              wrap="nowrap"
              style={{
                minWidth: 0,
                flex: responsiveLayout.headerStacked ? '1 1 100%' : '1 1 auto',
                width: responsiveLayout.headerStacked ? '100%' : undefined,
              }}
            >
              {!isDownlineScope ? (
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
              ) : null}

              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text
                  size={isMobileGraph ? 'lg' : 'sm'}
                  fw={isMobileGraph ? 800 : 700}
                  c="dark.8"
                  style={{ lineHeight: 1.18, whiteSpace: 'nowrap' }}
                >
                  {isMobileGraph ? '추천 관계 보기' : '추천인 그래프'}
                </Text>
                <Text size={isMobileGraph ? 'sm' : 'xs'} c="gray.7" style={{ lineHeight: 1.35 }}>
                  {responsiveLayout.showLongDescription
                    ? isDownlineScope
                      ? '내 추천 관계 하위 조직만 보여줍니다.'
                      : '현재 추천인으로 연결된 관계만 보여줍니다. 예전 `recommender` 문자열만 남은 사람은 노드 경고로 따로 표시합니다.'
                    : isDownlineScope
                      ? '내 하위 조직만 표시'
                      : '추천 관계만 표시'}
                </Text>
              </Box>
            </Group>

            <Group
              gap="xs"
              wrap="nowrap"
              style={{
                width: responsiveLayout.controlsScrollable ? '100%' : undefined,
                overflowX: responsiveLayout.controlsScrollable ? 'auto' : undefined,
                paddingBottom: responsiveLayout.controlsScrollable ? 2 : undefined,
              }}
            >
              <Button
                size={isMobileGraph ? 'compact-sm' : 'xs'}
                variant="light"
                onClick={() => setFitRequestId((value) => value + 1)}
                styles={{ root: { flex: '0 0 auto' } }}
              >
                {isMobileGraph ? '화면 맞춤' : '화면 맞춤'}
              </Button>
              <Tooltip label="배치를 초기 원형 구조로 다시 정리합니다." withArrow>
                <Button
                  size={isMobileGraph ? 'compact-sm' : 'xs'}
                  variant="light"
                  onClick={() => setResetLayoutRequestId((value) => value + 1)}
                  styles={{ root: { flex: '0 0 auto' } }}
                >
                  {isMobileGraph ? '배치 초기화' : '배치 초기화'}
                </Button>
              </Tooltip>
              <Button
                size={isMobileGraph ? 'compact-sm' : 'xs'}
                variant="subtle"
                leftSection={<IconFocus2 size={14} />}
                onClick={handleClearSelection}
                disabled={!selectedNodeId}
                styles={{ root: { flex: '0 0 auto' } }}
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
            <Group
              gap="xs"
              wrap={responsiveLayout.controlsScrollable ? 'nowrap' : 'wrap'}
              style={{
                flex: '1 1 auto',
                minWidth: 0,
                width: responsiveLayout.controlsScrollable ? '100%' : undefined,
                overflowX: responsiveLayout.controlsScrollable ? 'auto' : undefined,
                paddingBottom: responsiveLayout.controlsScrollable ? 2 : undefined,
              }}
            >
              <TextInput
                placeholder="이름·소속·코드 검색"
                size={isMobileGraph ? 'sm' : 'xs'}
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
                style={{
                  flex: isMobileGraph ? '1 0 100%' : responsiveLayout.controlsScrollable ? '0 0 240px' : '0 1 280px',
                  minWidth: isMobileGraph ? 0 : responsiveLayout.controlsScrollable ? 240 : 220,
                }}
              />

              <Group
                gap={isMobileGraph ? 6 : 'xs'}
                wrap="nowrap"
                style={{
                  flexShrink: 0,
                  width: isMobileGraph ? '100%' : undefined,
                  overflowX: isMobileGraph ? 'auto' : undefined,
                  paddingBottom: isMobileGraph ? 2 : undefined,
                }}
              >
                {STATUS_FILTERS.map((item) => {
                  const active = enabledStatusSet.has(item.key);
                  return (
                    <Button
                      key={item.key}
                      size={isMobileGraph ? 'compact-sm' : 'xs'}
                      variant={active ? 'filled' : 'default'}
                      color={item.color}
                      onClick={() => toggleStatus(item.key)}
                      styles={{ root: { flex: '0 0 auto' } }}
                    >
                      {item.label}
                    </Button>
                  );
                })}
              </Group>

              {selectedNodeId ? (
                <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
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
                style={{ flexShrink: 0, width: isMobileGraph ? '100%' : undefined }}
              />
            </Group>

            <Group
              gap="xs"
              wrap={responsiveLayout.statsScrollable ? 'nowrap' : 'wrap'}
              style={{
                width: responsiveLayout.statsScrollable ? '100%' : undefined,
                overflowX: responsiveLayout.statsScrollable ? 'auto' : undefined,
                paddingBottom: responsiveLayout.statsScrollable ? 2 : undefined,
              }}
            >
              {effectiveSelectedNodeId ? (
                <Badge color="orange" variant="light" style={{ flex: '0 0 auto' }}>
                  선택된 사람 주변 {depthHops}단계
                </Badge>
              ) : null}
              <Badge color="gray" variant="light" style={{ flex: '0 0 auto' }}>
                {isDownlineScope ? 'FC 전용 범위' : '조회 전용'}
              </Badge>
              <Badge color="gray" variant="light" style={{ flex: '0 0 auto' }}>
                {visibleNodes.length.toLocaleString('ko-KR')}명
              </Badge>
              <Badge color="teal" variant="filled" style={{ flex: '0 0 auto' }}>
                모든 위촉 완료 {visibleCompletedCommissionCount.toLocaleString('ko-KR')}명
              </Badge>
              <Badge color="gray" variant="light" style={{ flex: '0 0 auto' }}>
                {visibleEdges.length.toLocaleString('ko-KR')}개 연결
              </Badge>
            </Group>
          </Group>

        </Stack>
      </Box>

      <Box
        ref={containerRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          minHeight: responsiveLayout.canvasMinHeight,
        }}
      >
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
            descendantCountByNodeId={descendantCountByNodeId}
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
              right: isMobileGraph ? 12 : 16,
              top: isMobileGraph ? 12 : 16,
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
          p={isMobileGraph ? 8 : 'sm'}
          style={{
            position: 'absolute',
            left: responsiveLayout.legendPlacement === 'bottom-strip' ? 8 : 16,
            right: responsiveLayout.legendPlacement === 'bottom-strip' ? 8 : undefined,
            bottom: responsiveLayout.legendPlacement === 'bottom-strip' ? 8 : 16,
            maxWidth: responsiveLayout.legendPlacement === 'bottom-strip' ? 'calc(100% - 16px)' : 360,
            maxHeight: isMobileGraph ? 86 : undefined,
            background: 'rgba(255, 255, 255, 0.94)',
            borderColor: '#dbe4ee',
            pointerEvents: isMobileGraph ? 'auto' : 'none',
            boxShadow: '0 18px 36px rgba(15, 23, 42, 0.08)',
            overflow: 'hidden',
          }}
        >
          <Stack gap={isMobileGraph ? 4 : 6}>
            <Text size="xs" fw={700} c="dark.7" style={{ flexShrink: 0 }}>
              {isMobileGraph ? '범례' : '색상 범례'}
            </Text>
            <Group
              gap={responsiveLayout.legendPlacement === 'bottom-strip' ? 'sm' : 4}
              wrap={isMobileGraph ? 'nowrap' : 'wrap'}
              style={{
                overflowX: isMobileGraph ? 'auto' : undefined,
                paddingBottom: isMobileGraph ? 2 : undefined,
              }}
            >
              <Group gap={6} wrap="nowrap">
                <Box
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '999px',
                    flexShrink: 0,
                    background: '#0f9f6e',
                  }}
                />
                <Text size="xs" c="gray.7">
                  {isMobileGraph ? '위촉 완료' : '생명·손해 위촉 모두 완료'}
                </Text>
              </Group>
              <Group gap={6} wrap="nowrap">
                <Box
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '999px',
                    flexShrink: 0,
                    background: '#ea580c',
                  }}
                />
                <Text size="xs" c="gray.7">
                  본등록 완료
                </Text>
              </Group>
              <Group gap={6} wrap="nowrap">
                <Box
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '999px',
                    flexShrink: 0,
                    background: '#facc15',
                  }}
                />
                <Text size="xs" c="gray.7">
                  {isMobileGraph ? '현재 사용자' : highlightLegendLabel}
                </Text>
              </Group>
              <Group gap={6} wrap="nowrap">
                <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
                  <Box
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '999px',
                      background: '#64748b',
                    }}
                  />
                  <Box
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '999px',
                      background: '#64748b',
                    }}
                  />
                  <Box
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '999px',
                      background: '#64748b',
                    }}
                  />
                </Group>
                <Text size="xs" c="gray.7">
                  {isMobileGraph ? '크기=하위 수' : '크기: 하위 전체 조직 수'}
                </Text>
              </Group>
              <Group gap={6} wrap="nowrap">
                <Box
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '999px',
                    flexShrink: 0,
                    background: '#94a3b8',
                  }}
                />
                <Text size="xs" c="gray.7">
                  {isMobileGraph ? '사전등록' : '사전등록까지만 한 사람'}
                </Text>
              </Group>
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
              left: responsiveLayout.physicsPanelPlacement === 'bottom-sheet' ? 8 : undefined,
              right: responsiveLayout.physicsPanelPlacement === 'bottom-sheet' ? 8 : 16,
              top: responsiveLayout.physicsPanelPlacement === 'bottom-sheet' ? undefined : 64,
              bottom: responsiveLayout.physicsPanelPlacement === 'bottom-sheet' ? 8 : 16,
              width: responsiveLayout.physicsPanelPlacement === 'bottom-sheet' ? 'auto' : responsiveLayout.physicsPanelWidth,
              maxHeight: responsiveLayout.physicsPanelPlacement === 'bottom-sheet' ? 'min(62dvh, 480px)' : undefined,
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
                              {Number.isInteger(physicsSettings[slider.key])
                                ? physicsSettings[slider.key]
                                : physicsSettings[slider.key].toFixed(2)}
                            </Badge>
                          </Group>
                          <Text size="xs" c="#b6a998">
                            {slider.description}
                          </Text>
                          <Slider
                            value={physicsSettings[slider.key]}
                            onChange={(value) => updatePhysicsSetting(slider.key, value)}
                            onChangeEnd={(value) => persistPhysicsSetting(slider.key, value)}
                            min={slider.min}
                            max={slider.max}
                            step={slider.step}
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
        allowAdminDetail={allowAdminDetail}
        connectedNodes={connectedNodes}
        descendantCount={effectiveSelectedNodeId ? descendantCountByNodeId.get(effectiveSelectedNodeId) ?? 0 : 0}
      />
    </Box>
  );
}
