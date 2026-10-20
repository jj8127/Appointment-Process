import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ReferralBranchFocus, type BranchFocusRow } from '@/components/referral-graph/ReferralBranchFocus';
import { ReferralGraphCanvas } from '@/components/referral-graph/ReferralGraphCanvas';
import { ReferralGraphDetailSheet } from '@/components/referral-graph/ReferralGraphDetailSheet';
import {
  isReferralReloginError,
} from '@/hooks/use-referral-app-session';
import { useReferralClusterLayout } from '@/hooks/use-referral-cluster-layout';
import { useReferralGraph } from '@/hooks/use-referral-graph';
import { useReferralGraphSearch } from '@/hooks/use-referral-graph-search';
import { createReferralGraphFilter } from '@/lib/referral-graph-filter';
import { buildBranchChildren, createBranchFocusIndex } from '@/lib/referral-branch-focus';
import {
  getReferralGraphNeighborhood,
} from '@/lib/referral-graph-native';
import { COLORS, RADIUS, SHADOWS, SPACING } from '@/lib/theme';
import type {
  ReferralGraphEdge,
  ReferralGraphNode,
  ReferralGraphStatusFilter,
} from '@/types/referral-graph';

const NO_NODES: ReferralGraphNode[] = [];
const NO_EDGES: ReferralGraphEdge[] = [];

const STATUS_FILTERS: {
  value: ReferralGraphStatusFilter;
  label: string;
}[] = [
  { value: 'all', label: '전체' },
  { value: 'commissioned', label: '위촉 완료' },
  { value: 'registered', label: '본등록' },
  { value: 'preregistered', label: '사전등록' },
];

const LEGEND = [
  { label: '현재 사용자', color: '#facc15' },
  { label: '위촉 완료', color: '#0f9f6e' },
  { label: '본등록', color: '#ea580c' },
  { label: '사전등록', color: '#94a3b8' },
];

function statusLabel(node: ReferralGraphNode) {
  if (node.allCommissionsCompleted) return '위촉 완료';
  if (node.signupCompleted) return '본등록';
  return '사전등록';
}

/** 한 화면에 "기준 한 명 + 직접 추천한 사람별 가지 인원"만 보여준다. 전체 캔버스를 마운트하지 않아 가볍다. */
function ReferralBranchView({ nodes, edges, onOpen, modeToggle }: {
  nodes: ReferralGraphNode[]; edges: ReferralGraphEdge[]; onOpen: (node: ReferralGraphNode) => void; modeToggle: ReactElement;
}) {
  const index = useMemo(() => {
    const parentOf = new Map<string, string>();
    for (const edge of edges) if (!parentOf.has(edge.target)) parentOf.set(edge.target, edge.source);
    return createBranchFocusIndex(nodes.map((node) => ({ ...node, parentId: parentOf.get(node.id) ?? null })));
  }, [nodes, edges]);
  const rootId = nodes.find((node) => node.isViewer)?.id ?? nodes[0]?.id;
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  const focus = (focusId ? index.byId.get(focusId) : undefined) ?? (rootId ? index.byId.get(rootId) : undefined);
  const children = useMemo(() => focus ? buildBranchChildren(index, focus.id,
    (id) => (index.byId.get(id)?.totalDescendantCount ?? 0) + 1) : [], [index, focus]);
  const rows: BranchFocusRow[] = useMemo(() => children.map((child) => {
    const node = index.byId.get(child.id)!;
    return { id: child.id, label: node.name, valueText: `${child.value.toLocaleString('ko-KR')}명`, value: child.value,
      meta: [statusLabel(node), child.childCount > 0 ? `직접 추천 ${child.childCount}명` : null, node.affiliation].filter(Boolean).join(' · '),
      drillable: child.childCount > 0, accessibilityLabel: `${node.name}, ${statusLabel(node)}, 가지 인원 ${child.value}명` };
  }), [children, index]);
  if (!focus) return null;
  const below = focus.totalDescendantCount;
  return <ReferralBranchFocus inset={false}
    path={index.pathTo(focus.id).map((node) => ({ id: node.id, label: node.isViewer ? '나' : node.name }))}
    total={{ label: focus.isViewer ? '내 하위 조직' : `${focus.name}님 하위 조직`, valueText: `${below.toLocaleString('ko-KR')}명`,
      accessibilityLabel: `${focus.isViewer ? '내' : `${focus.name}님`} 하위 조직 ${below}명` }}
    accessory={focus.isViewer ? modeToggle : null}
    rows={rows} listTitle={focus.isViewer ? '직접 추천한 사람' : `${focus.name}님이 직접 추천한 사람`}
    emptyText="직접 추천한 사람이 없습니다."
    onFocus={setFocusId} onOpen={(id) => { const node = index.byId.get(id); if (node) onOpen(node); }}
    onTotalPress={focus.isViewer ? undefined : () => onOpen(focus)} />;
}

export default function ReferralGraphPage() {
  const router = useRouter();
  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    loadClusterLayout,
    canUseReferralGraph,
  } = useReferralGraph();
  const { searchTerm, appliedSearchTerm, setSearchTerm, flushSearchTerm } = useReferralGraphSearch();
  const [statusFilter, setStatusFilter] = useState<ReferralGraphStatusFilter>('all');
  const [selectedNode, setSelectedNode] = useState<ReferralGraphNode | null>(null);
  const [detailNode, setDetailNode] = useState<ReferralGraphNode | null>(null);
  const [focusHops, setFocusHops] = useState<number | null>(null);
  const [fitRequestId, setFitRequestId] = useState(0);
  const [resetRequestId, setResetRequestId] = useState(0);
  // 기본은 가지 보기(가벼움). 검색·필터·촌수 보기가 있는 전체 그래프는 고를 때만 마운트한다.
  const [graphMode, setGraphMode] = useState<'branch' | 'full'>('branch');
  // 전체 그래프는 관리자 웹과 같은 집단 배치. 전체 조직으로 한 번 계산해 기억하고, 필터는 그 좌표의 일부만 보여준다.
  const clusterLayout = useReferralClusterLayout(data?.nodes ?? NO_NODES, data?.edges ?? NO_EDGES, graphMode === 'full' && Boolean(data),
    loadClusterLayout);

  const neighborhood = useMemo(
    () => (
      selectedNode && focusHops != null
        ? getReferralGraphNeighborhood(selectedNode.id, data?.edges ?? [], focusHops)
        : null
    ),
    [data?.edges, focusHops, selectedNode],
  );
  const selectVisibleGraph = useMemo(
    () => createReferralGraphFilter(data?.nodes ?? [], data?.edges ?? []),
    [data?.nodes, data?.edges],
  );
  const { nodes: visibleNodes, edges: visibleEdges } = useMemo(
    () => selectVisibleGraph({
      searchTerm: appliedSearchTerm,
      statusFilter,
      neighborhood,
    }),
    [selectVisibleGraph, neighborhood, appliedSearchTerm, statusFilter],
  );
  const totalDescendants = data?.nodes.find((node) => node.isViewer)?.totalDescendantCount
    ?? Math.max(0, (data?.nodes.length ?? 1) - 1);
  const errorMessage = error instanceof Error
    ? error.message
    : '추천 관계 그래프를 불러오지 못했습니다.';
  const needsRelogin = isReferralReloginError(error);

  const handleNodeSelect = useCallback((node: ReferralGraphNode) => {
    setSelectedNode(node);
    setDetailNode(node);
  }, []);

  const handleReset = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setSelectedNode(null);
    setFocusHops(null);
    setResetRequestId((value) => value + 1);
  };

  const modeToggle = (
    <View style={styles.modeRow} accessibilityRole="tablist">
      {([{ value: 'branch', label: '가지' }, { value: 'full', label: '전체 그래프' }] as const).map((mode) => (
        <Pressable key={mode.value} accessibilityRole="tab" accessibilityState={{ selected: graphMode === mode.value }}
          accessibilityLabel={mode.value === 'branch' ? '가지 보기' : '전체 그래프'}
          style={[styles.modeTab, graphMode === mode.value && styles.modeTabActive]} onPress={() => setGraphMode(mode.value)}>
          <Text style={[styles.modeTabText, graphMode === mode.value && styles.modeTabTextActive]}>{mode.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  if (!canUseReferralGraph) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.centerState}>
          <View style={styles.stateIcon}>
            <Feather name="lock" size={26} color={COLORS.text.muted} />
          </View>
          <Text style={styles.stateTitle}>그래프를 볼 수 없는 계정입니다</Text>
          <Text style={styles.stateDescription}>
            FC 또는 매니저용 조회 전용 계정으로 로그인해 주세요.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>추천 관계를 정리하고 있어요</Text>
          <Text style={styles.stateDescription}>
            연결된 인원이 많으면 잠시 시간이 걸릴 수 있습니다.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.centerState}>
          <View style={[styles.stateIcon, styles.errorIcon]}>
            <Feather name="alert-circle" size={26} color={COLORS.error} />
          </View>
          <Text style={styles.stateTitle}>
            {needsRelogin ? '세션이 만료되었습니다' : '그래프를 불러오지 못했습니다'}
          </Text>
          <Text style={styles.stateDescription}>{errorMessage}</Text>
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              { flexDirection: 'row', gap: 6 },
              (pressed || (!needsRelogin && isFetching)) && styles.pressed,
            ]}
            onPress={
              needsRelogin
                ? () => router.push('/login?skipAuto=1')
                : () => void refetch()
            }
            disabled={!needsRelogin && isFetching}
            accessibilityRole="button"
            accessibilityState={{ disabled: !needsRelogin && isFetching, busy: !needsRelogin && isFetching }}
          >
            {!needsRelogin && isFetching ? <ActivityIndicator size="small" color={COLORS.white} /> : null}
            <Text style={styles.primaryButtonText}>
              {needsRelogin ? '다시 로그인' : '다시 시도'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.page}>
        {graphMode === 'full' ? <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{visibleNodes.length}</Text>
            <Text style={styles.summaryLabel}>표시 인원</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{visibleEdges.length}</Text>
            <Text style={styles.summaryLabel}>연결</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{totalDescendants}</Text>
            <Text style={styles.summaryLabel}>
              {data.truncated ? '표시 하위' : '전체 하위'}
            </Text>
          </View>
          {isFetching ? <ActivityIndicator size="small" color={COLORS.primary} /> : null}
        </View> : null}

        {graphMode === 'full' ? modeToggle : null}

        {graphMode === 'branch' ? (
          <View style={styles.branchWrap}>
            {data.truncated ? (
              <View style={styles.warningBanner}>
                <Feather name="info" size={14} color={COLORS.warning.dark} />
                <Text style={styles.warningText}>모바일 표시 한도로 일부 하위 연결을 생략했습니다.</Text>
              </View>
            ) : null}
            <ReferralBranchView nodes={data.nodes} edges={data.edges} onOpen={setDetailNode} modeToggle={modeToggle} />
          </View>
        ) : <>

        <View style={styles.searchRow}>
          <View style={styles.searchInputWrap}>
            <Feather name="search" size={17} color={COLORS.text.muted} />
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              onSubmitEditing={flushSearchTerm}
              style={styles.searchInput}
              placeholder="이름, 소속, 추천 코드 검색"
              placeholderTextColor={COLORS.text.muted}
              returnKeyType="search"
              accessibilityLabel="추천 관계 검색"
            />
            {searchTerm ? (
              <Pressable style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => setSearchTerm('')}
                accessibilityRole="button"
                accessibilityLabel="검색어 지우기"
              >
                <Feather name="x-circle" size={17} color={COLORS.text.secondary} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="추천 관계 새로고침"
          >
            <Feather name="refresh-cw" size={17} color={COLORS.text.secondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.horizontalScroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
        >
          {STATUS_FILTERS.map((filter) => {
            const active = statusFilter === filter.value;
            return (
              <Pressable
                key={filter.value}
                style={({ pressed }) => [
                  styles.filterChip,
                  active && styles.filterChipActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => setStatusFilter(filter.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {selectedNode ? (
          <View style={styles.focusRow}>
            <View style={styles.focusIdentity}>
              <Feather name="target" size={14} color={COLORS.info} />
              <Text style={styles.focusName} numberOfLines={1}>{selectedNode.name}</Text>
            </View>
            {[1, 2, 3].map((hops) => (
              <Pressable
                key={hops}
                style={({ pressed }) => [
                  styles.hopButton,
                  focusHops === hops && styles.hopButtonActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => setFocusHops(focusHops === hops ? null : hops)}
                accessibilityRole="button"
                accessibilityState={{ selected: focusHops === hops }}
              >
                <Text style={[
                  styles.hopButtonText,
                  focusHops === hops && styles.hopButtonTextActive,
                ]}>
                  {hops}촌
                </Text>
              </Pressable>
            ))}
            <Pressable style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              onPress={() => {
                setSelectedNode(null);
                setFocusHops(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="관계 집중 보기 해제"
            >
              <Feather name="x" size={17} color={COLORS.text.secondary} />
            </Pressable>
          </View>
        ) : null}

        {data.truncated ? (
          <View style={styles.warningBanner}>
            <Feather name="info" size={14} color={COLORS.warning.dark} />
            <Text style={styles.warningText}>
              모바일 표시 한도로 일부 하위 연결을 생략했습니다.
            </Text>
          </View>
        ) : null}

        <View style={styles.canvasCard}>
          {clusterLayout.computing ? (
            <View style={styles.emptyGraph}>
              <ActivityIndicator color={COLORS.primary} />
              <Text style={styles.emptyGraphTitle}>배치 중</Text>
            </View>
          ) : visibleNodes.length > 0 ? (
            <ReferralGraphCanvas
              positions={clusterLayout.positions ?? undefined}
              nodes={visibleNodes}
              edges={visibleEdges}
              selectedNodeId={selectedNode?.id ?? null}
              onSelectNode={handleNodeSelect}
              fitRequestId={fitRequestId}
              resetRequestId={resetRequestId}
            />
          ) : (
            <View style={styles.emptyGraph}>
              <Feather name="search" size={28} color={COLORS.gray[300]} />
              <Text style={styles.emptyGraphTitle}>조건에 맞는 인원이 없습니다</Text>
              <Text style={styles.emptyGraphDescription}>
                검색어나 상태 필터를 바꿔 보세요.
              </Text>
            </View>
          )}
          {__DEV__ && clusterLayout.elapsedMs != null ? (
            <Text style={styles.devTiming}>집단 배치 {clusterLayout.source === 'computed' ? '폰 계산' : clusterLayout.source === 'server' ? '서버' : '저장본'} {clusterLayout.elapsedMs}ms · {data.nodes.length}명</Text>
          ) : null}
          <View style={styles.canvasActions}>
            <Pressable
              style={({ pressed }) => [styles.canvasButton, pressed && styles.pressed]}
              onPress={() => setFitRequestId((value) => value + 1)}
              accessibilityRole="button"
              accessibilityLabel="그래프 화면 맞춤"
            >
              <Feather name="maximize" size={15} color={COLORS.text.secondary} />
              <Text style={styles.canvasButtonText}>화면 맞춤</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.canvasButton, pressed && styles.pressed]}
              onPress={handleReset}
              accessibilityRole="button"
              accessibilityLabel="그래프 초기화"
            >
              <Feather name="rotate-ccw" size={15} color={COLORS.text.secondary} />
              <Text style={styles.canvasButtonText}>초기화</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.horizontalScroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.legendRow}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
        >
          {LEGEND.map((item) => (
            <View key={item.label} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: item.color }]} />
              <Text style={styles.legendText}>{item.label}</Text>
            </View>
          ))}
          <Text style={styles.readOnlyText}>조회 전용</Text>
        </ScrollView>
        </>}
      </View>

      <ReferralGraphDetailSheet
        node={detailNode}
        onClose={() => setDetailNode(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  modeRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    padding: 3,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.border.light,
  },
  modeTab: {
    minHeight: 36,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
  },
  modeTabActive: {
    backgroundColor: COLORS.white,
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text.secondary,
  },
  modeTabTextActive: {
    color: COLORS.primaryDark,
    fontWeight: '700',
  },
  devTiming: {
    position: 'absolute',
    left: 10,
    top: 8,
    fontSize: 11,
    color: COLORS.text.muted,
  },
  branchWrap: {
    flex: 1,
    gap: 10,
  },
  safe: {
    flex: 1,
    backgroundColor: COLORS.background.secondary,
  },
  page: {
    flex: 1,
    padding: SPACING.md,
    gap: 10,
  },
  summaryRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.background.primary,
    ...SHADOWS.sm,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    color: COLORS.text.primary,
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: {
    marginTop: 2,
    color: COLORS.text.muted,
    fontSize: 10,
    fontWeight: '600',
  },
  summaryDivider: {
    width: 1,
    height: 26,
    backgroundColor: COLORS.border.light,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInputWrap: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.background.primary,
  },
  searchInput: {
    flex: 1,
    color: COLORS.text.primary,
    fontSize: 13,
    paddingVertical: 0,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background.primary,
  },
  chipRow: {
    gap: 7,
    paddingRight: SPACING.md,
  },
  horizontalScroller: {
    flexGrow: 0,
  },
  filterChip: {
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.background.primary,
  },
  filterChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale,
  },
  filterChipText: {
    color: COLORS.text.secondary,
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: COLORS.primaryDark,
  },
  focusRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.infoLight,
  },
  focusIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  focusName: {
    flex: 1,
    color: COLORS.text.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  hopButton: {
    minWidth: 34,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  hopButtonActive: {
    backgroundColor: COLORS.info,
  },
  hopButtonText: {
    color: COLORS.info,
    fontSize: 11,
    fontWeight: '800',
  },
  hopButtonTextActive: {
    color: COLORS.white,
  },
  warningBanner: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.warning.light,
  },
  warningText: {
    flex: 1,
    color: COLORS.warning.dark,
    fontSize: 11,
    lineHeight: 16,
  },
  canvasCard: {
    flex: 1,
    minHeight: 260,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.background.primary,
    ...SHADOWS.base,
  },
  canvasActions: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    gap: 6,
  },
  canvasButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255,255,255,0.94)',
    ...SHADOWS.sm,
  },
  canvasButtonText: {
    color: COLORS.text.secondary,
    fontSize: 11,
    fontWeight: '800',
  },
  legendRow: {
    minHeight: 28,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 2,
    paddingRight: SPACING.base,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  legendText: {
    color: COLORS.text.secondary,
    fontSize: 10,
    fontWeight: '600',
  },
  readOnlyText: {
    color: COLORS.text.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  emptyGraph: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  emptyGraphTitle: {
    marginTop: SPACING.sm,
    color: COLORS.text.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  emptyGraphDescription: {
    marginTop: 4,
    color: COLORS.text.muted,
    fontSize: 12,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  stateIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray[100],
  },
  errorIcon: {
    backgroundColor: COLORS.errorLight,
  },
  stateTitle: {
    marginTop: SPACING.base,
    color: COLORS.text.primary,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  loadingText: {
    marginTop: SPACING.base,
    color: COLORS.text.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  stateDescription: {
    marginTop: 7,
    color: COLORS.text.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  primaryButton: {
    minWidth: 120,
    minHeight: 44,
    marginTop: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.72,
  },
});
