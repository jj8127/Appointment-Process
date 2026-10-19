'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ActionIcon, Box, Button, Center, Group, Loader, SegmentedControl, Slider, Stack, Switch, Text, TextInput, Tooltip } from '@mantine/core';
import { useDisclosure, useLocalStorage, useViewportSize } from '@mantine/hooks';
import { IconArrowLeft, IconFocus2, IconRefresh, IconSearch, IconX } from '@tabler/icons-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { ReferralClusterGraphCanvasProps } from '@/components/referrals/ReferralClusterGraphCanvas';
import type { ReferralGraphCanvasProps } from '@/components/referrals/ReferralGraphCanvas';
import { GraphControlPanel, GraphControlSection } from '@/components/referrals/GraphControlPanel';
import { GraphNodeDrawer } from '@/components/referrals/GraphNodeDrawer';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { useSession } from '@/hooks/use-session';
import { buildReferralGraphDescendantCountMap } from '@/lib/referral-graph-descendants';
import { getReferralGraphResponsiveLayout } from '@/lib/referral-graph-responsive';
import { QueryReadError } from '@/lib/query-read-error';
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

const ReferralClusterGraphCanvas = dynamic<ReferralClusterGraphCanvasProps>(
  () => import('@/components/referrals/ReferralClusterGraphCanvas').then((module) => module.ReferralClusterGraphCanvas),
  { ssr: false, loading: () => <Center h="100%"><Loader color="orange" /></Center> },
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
  { key: 'spread', label: '퍼짐', values: { centerGravity: 0.1, repulsion: 18, linkStrength: 0.42, linkDistance: 330 } },
  { key: 'tight', label: '밀집', values: { centerGravity: 0.36, repulsion: 8, linkStrength: 0.68, linkDistance: 150 } },
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonNegativeSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const isGraphNode = (value: unknown): value is GraphNode => isRecord(value)
  && typeof value.id === 'string'
  && typeof value.name === 'string'
  && typeof value.phone === 'string'
  && typeof value.affiliation === 'string'
  && (value.activeCode === null || typeof value.activeCode === 'string')
  && isNonNegativeSafeInteger(value.referralCount)
  && isNonNegativeSafeInteger(value.inboundCount)
  && ['has_active_code', 'missing_code', 'code_disabled'].includes(String(value.nodeStatus))
  && typeof value.isIsolated === 'boolean'
  && typeof value.signupCompleted === 'boolean'
  && typeof value.allCommissionsCompleted === 'boolean'
  && typeof value.hasLegacyUnresolved === 'boolean'
  && (value.highlightType === null || value.highlightType === 'manager' || value.highlightType === 'viewer');
const isGraphEdge = (value: unknown): value is GraphEdge => isRecord(value)
  && typeof value.id === 'string'
  && typeof value.source === 'string'
  && typeof value.target === 'string'
  && (value.referralCode === null || typeof value.referralCode === 'string');

function fetchGraphData(): Promise<GraphApiResponse> {
  return fetch('/api/admin/referrals/graph').then(async (res) => {
    if (!res.ok) {
      throw new QueryReadError(res.status);
    }
    const data: unknown = await res.json().catch(() => null);
    const permissions = isRecord(data) ? data.permissions : null;
    if (!isRecord(data) || data.ok !== true || !Array.isArray(data.nodes) || !data.nodes.every(isGraphNode)
      || !Array.isArray(data.edges) || !data.edges.every(isGraphEdge) || !isRecord(permissions)
      || typeof permissions.canMutate !== 'boolean' || !['all', 'downline'].includes(String(permissions.scope))
      || !['admin', 'manager', 'fc'].includes(String(permissions.viewerRole))
      || (permissions.rootFcId !== null && typeof permissions.rootFcId !== 'string')) {
      throw new QueryReadError();
    }
    return data as GraphApiResponse;
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
  const [layoutMode, setLayoutMode] = useState<'cluster' | 'free'>('cluster');
  // Obsidian처럼 설정은 접히는 패널 하나에. 열림 상태는 기억한다(처음엔 열어 둔다).
  const [controlsOpen, setControlsOpen] = useLocalStorage<boolean>({
    key: 'referral-graph-controls-open-v1',
    defaultValue: true,
    getInitialValueInEffect: true,
  });
  const [storedPhysicsSettings, setStoredPhysicsSettings] = useLocalStorage<ReferralGraphPhysicsSettings>({
    key: 'referral-graph-physics-settings-v18-natural',
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

  const resetControls = useCallback(() => {
    setSearchTerm('');
    setEnabledStatuses(STATUS_FILTERS.map((item) => item.key));
    setHideIsolatedNodes(false);
    setDepthHops(2);
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
      <Group
        px="md"
        py={6}
        gap="xs"
        wrap="nowrap"
        style={{ background: 'rgba(255, 255, 255, 0.94)', borderBottom: '1px solid #dbe4ee', flexShrink: 0 }}
      >
        {!isDownlineScope ? (
          <Tooltip label="리스트로 돌아가기" withArrow>
            <ActionIcon aria-label="추천인 코드로 이동" component={Link} href="/dashboard/referrals" variant="subtle" color="gray" size="sm">
              <IconArrowLeft size={16} />
            </ActionIcon>
          </Tooltip>
        ) : null}
        <Text size="sm" fw={700} c="dark.8" style={{ whiteSpace: 'nowrap' }}>
          {isMobileGraph ? '추천 관계 보기' : '추천인 그래프'}
        </Text>
        <SegmentedControl aria-label="그래프 배치 방식" value={layoutMode} onChange={(value) => setLayoutMode(value as 'cluster' | 'free')}
          data={[{ value: 'cluster', label: '집단 배치' }, { value: 'free', label: '자유 배치' }]} size="xs" />
        <Box style={{ flex: 1 }} />
        <ActionIcon aria-label="추천 관계 새로고침" variant="subtle" color="gray" size="sm"
          loading={graphQuery.isFetching} onClick={() => graphQuery.refetch()}>
          <IconRefresh size={16} />
        </ActionIcon>
      </Group>

      {graphQuery.isError ? (
        <Box px="md" py="xs">
          <QueryErrorAlert
            error={graphQuery.error}
            onRetry={graphQuery.refetch}
            isFetching={graphQuery.isFetching}
            hasData={Boolean(graphData)}
            subject="추천인 그래프"
          />
        </Box>
      ) : null}

      {graphQuery.isError ? (
        <Box px="md" py="xs">
          <QueryErrorAlert
            error={graphQuery.error}
            onRetry={graphQuery.refetch}
            isFetching={graphQuery.isFetching}
            hasData={Boolean(graphData)}
            subject="추천인 그래프"
          />
        </Box>
      ) : null}

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
        ) : graphQuery.isError && !graphData ? null : !isCanvasReady || !canvasSize ? (
          <Center h="100%">
            <Stack align="center" gap="xs">
              <Loader size="lg" color="orange" />
              <Text c="dimmed" size="sm">
                화면 준비 중...
              </Text>
            </Stack>
          </Center>
        ) : visibleNodes.length === 0 && (layoutMode === 'free' || allNodes.length === 0) ? (
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
        ) : layoutMode === 'cluster' ? (
          <ReferralClusterGraphCanvas
            layoutNodes={allNodes}
            layoutEdges={allEdges}
            nodes={visibleNodes}
            edges={visibleEdges}
            selectedNodeId={effectiveSelectedNodeId}
            searchTerm={deferredSearchTerm}
            descendantCountByNodeId={descendantCountByNodeId}
            fitRequestId={fitRequestId}
            resetLayoutRequestId={resetLayoutRequestId}
            onNodeClick={handleNodeClick}
            width={canvasSize.width}
            height={canvasSize.height}
            insetRight={drawerOpen && effectiveSelectedNodeId && !isMobileGraph ? 440 : 0}
          />
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

        <GraphControlPanel
          open={controlsOpen}
          onOpenChange={setControlsOpen}
          onReset={resetControls}
          right={drawerOpen && effectiveSelectedNodeId && !isMobileGraph ? 452 : 12}
          width={isMobileGraph ? Math.min(320, (canvasSize?.width ?? 344) - 24) : 300}
          maxHeight={isMobileGraph ? '70%' : 'calc(100% - 24px)'}
          summary={(
            <Text size="xs" c="gray.7" style={{ lineHeight: 1.5 }}>
              <b>{visibleNodes.length.toLocaleString('ko-KR')}명</b>
              {' · 위촉 완료 '}{visibleCompletedCommissionCount.toLocaleString('ko-KR')}명
              {' · '}{visibleEdges.length.toLocaleString('ko-KR')}개 연결
              {' · '}{isDownlineScope ? 'FC 전용 범위' : '조회 전용'}
            </Text>
          )}
        >
          <GraphControlSection title="필터" defaultOpen>
            <TextInput
              aria-label="이름·소속·코드 검색"
              placeholder="이름·소속·코드 검색"
              size="xs"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.currentTarget.value)}
              leftSection={<IconSearch size={14} />}
              rightSection={searchTerm ? (
                <ActionIcon aria-label="검색어 지우기" size="xs" variant="subtle" color="gray" onClick={() => setSearchTerm('')}>
                  <IconX size={12} />
                </ActionIcon>
              ) : null}
            />
            <Group gap={6}>
              {STATUS_FILTERS.map((item) => {
                const active = enabledStatusSet.has(item.key);
                return (
                  <Button key={item.key} size="compact-xs" radius="xl" variant={active ? 'filled' : 'default'} color={item.color}
                    aria-pressed={active} onClick={() => toggleStatus(item.key)}>
                    {item.label}
                  </Button>
                );
              })}
            </Group>
            <Switch checked={hideIsolatedNodes} onChange={toggleHideIsolatedNodes} label="연결 없는 사람 숨기기" size="xs" />
          </GraphControlSection>

          <GraphControlSection title="범위" defaultOpen={Boolean(selectedNodeId)}>
            <Text size="xs" c="dimmed">{selectedNode ? `${selectedNode.name} 주변` : '사람을 선택하면 적용'}</Text>
            <SegmentedControl aria-label="선택한 사람 주변 범위" size="xs" fullWidth disabled={!selectedNodeId}
              value={String(depthHops)} onChange={(value) => setDepthHops(Number(value) as 1 | 2 | 3)}
              data={[{ value: '1', label: '1단계' }, { value: '2', label: '2단계' }, { value: '3', label: '3단계' }]} />
            {selectedNodeId ? (
              <Button size="compact-xs" variant="subtle" leftSection={<IconFocus2 size={14} />} onClick={handleClearSelection}
                style={{ alignSelf: 'flex-start' }}>
                선택 해제
              </Button>
            ) : null}
          </GraphControlSection>

          <GraphControlSection title="색 그룹">
            {[
              { color: '#0f9f6e', label: '생명·손해 위촉 모두 완료' },
              { color: '#ea580c', label: '본등록 완료' },
              { color: '#facc15', label: highlightLegendLabel },
              { color: '#94a3b8', label: '사전등록까지만 한 사람' },
            ].map((item) => (
              <Group key={item.label} gap={8} wrap="nowrap">
                <Box style={{ width: 12, height: 12, borderRadius: 999, flexShrink: 0, background: item.color }} />
                <Text size="xs" c="gray.7">{item.label}</Text>
              </Group>
            ))}
            <Group gap={8} wrap="nowrap">
              <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
                {[8, 12, 16].map((size) => <Box key={size} style={{ width: size, height: size, borderRadius: 999, background: '#64748b' }} />)}
              </Group>
              <Text size="xs" c="gray.7">크기: 하위 전체 조직 수</Text>
            </Group>
          </GraphControlSection>

          <GraphControlSection title="보기">
            <Group gap={6}>
              <Button size="compact-xs" variant="light" onClick={() => setFitRequestId((value) => value + 1)}>화면 맞춤</Button>
              <Tooltip label={layoutMode === 'cluster' ? '고정된 집단 배치 전체를 다시 보여줍니다.' : '배치를 초기 원형 구조로 다시 정리합니다.'} withArrow>
                <Button size="compact-xs" variant="light" onClick={() => setResetLayoutRequestId((value) => value + 1)}>배치 초기화</Button>
              </Tooltip>
            </Group>
          </GraphControlSection>

          {layoutMode === 'free' ? (
            <GraphControlSection title="힘">
              <Group gap={6}>
                {PHYSICS_PRESETS.map((preset) => (
                  <Button key={preset.key} size="compact-xs" radius="xl" variant="light" color="orange" onClick={() => applyPhysicsPreset(preset.values)}>
                    {preset.label}
                  </Button>
                ))}
                <Button size="compact-xs" radius="xl" variant="subtle" color="gray" onClick={resetPhysicsSettings}>기본값</Button>
              </Group>
              {PHYSICS_SLIDERS.map((slider) => (
                <Stack key={slider.key} gap={2}>
                  <Group justify="space-between">
                    <Text size="xs" fw={600} c="dark.6">{slider.description}</Text>
                    <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {Number.isInteger(physicsSettings[slider.key]) ? physicsSettings[slider.key] : physicsSettings[slider.key].toFixed(2)}
                    </Text>
                  </Group>
                  <Slider
                    aria-label={slider.description}
                    value={physicsSettings[slider.key]}
                    onChange={(value) => updatePhysicsSetting(slider.key, value)}
                    onChangeEnd={(value) => persistPhysicsSetting(slider.key, value)}
                    min={slider.min} max={slider.max} step={slider.step} color="orange" size="xs" label={null}
                  />
                </Stack>
              ))}
            </GraphControlSection>
          ) : null}
        </GraphControlPanel>

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
