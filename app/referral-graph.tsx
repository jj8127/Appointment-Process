import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
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

import { ReferralGraphCanvas } from '@/components/referral-graph/ReferralGraphCanvas';
import { ReferralGraphDetailSheet } from '@/components/referral-graph/ReferralGraphDetailSheet';
import {
  isReferralReloginError,
} from '@/hooks/use-referral-app-session';
import { useReferralGraph } from '@/hooks/use-referral-graph';
import { useReferralGraphSearch } from '@/hooks/use-referral-graph-search';
import { createReferralGraphFilter } from '@/lib/referral-graph-filter';
import {
  getReferralGraphNeighborhood,
} from '@/lib/referral-graph-native';
import { COLORS, RADIUS, SHADOWS, SPACING } from '@/lib/theme';
import type {
  ReferralGraphNode,
  ReferralGraphStatusFilter,
} from '@/types/referral-graph';

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

export default function ReferralGraphPage() {
  const router = useRouter();
  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    canUseReferralGraph,
  } = useReferralGraph();
  const { searchTerm, appliedSearchTerm, setSearchTerm, flushSearchTerm } = useReferralGraphSearch();
  const [statusFilter, setStatusFilter] = useState<ReferralGraphStatusFilter>('all');
  const [selectedNode, setSelectedNode] = useState<ReferralGraphNode | null>(null);
  const [detailNode, setDetailNode] = useState<ReferralGraphNode | null>(null);
  const [focusHops, setFocusHops] = useState<number | null>(null);
  const [fitRequestId, setFitRequestId] = useState(0);
  const [resetRequestId, setResetRequestId] = useState(0);

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
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={
              needsRelogin
                ? () => router.push('/login?skipAuto=1')
                : () => void refetch()
            }
            accessibilityRole="button"
          >
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
        <View style={styles.summaryRow}>
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
        </View>

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
              <Pressable
                onPress={() => setSearchTerm('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="검색어 지우기"
              >
                <Feather name="x-circle" size={17} color={COLORS.text.muted} />
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
            <Pressable
              onPress={() => {
                setSelectedNode(null);
                setFocusHops(null);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="관계 집중 보기 해제"
            >
              <Feather name="x" size={17} color={COLORS.text.muted} />
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
          {visibleNodes.length > 0 ? (
            <ReferralGraphCanvas
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
      </View>

      <ReferralGraphDetailSheet
        node={detailNode}
        onClose={() => setDetailNode(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
