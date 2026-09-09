import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ReferralRevenueDetailSheet } from '@/components/referral-revenue-graph/ReferralRevenueDetailSheet';
import { ReferralRevenueFlowCanvas } from '@/components/referral-revenue-graph/ReferralRevenueFlowCanvas';
import { REFERRAL_REVENUE_DEMO_RAW_NODES } from '@/data/referral-revenue-demo';
import { useSession } from '@/hooks/use-session';
import {
  buildSampleRevenueGraphModel,
  filterSampleRevenueNodesByDepth,
  getSampleRevenueGraphContextNodes,
} from '@/lib/referral-revenue-demo';
import { formatSampleRevenueFlowKrw } from '@/lib/referral-revenue-flow';
import { COLORS, RADIUS, SHADOWS, SPACING, TOUCH_TARGET } from '@/lib/theme';
import type {
  SampleRevenueDepthFilter,
  SampleRevenueGraphNode,
} from '@/types/referral-revenue-graph';

const DISCLAIMER =
  '샘플 데이터 · 실제 조직, 매출, 정산 내역이 아닙니다. 1~10단계 샘플 매출의 10%를 단순 적용한 화면 예시입니다.';

const DEPTH_FILTERS: { value: SampleRevenueDepthFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: '1-3', label: '1~3단계' },
  { value: '4-6', label: '4~6단계' },
  { value: '7-10', label: '7~10단계' },
];

const model = buildSampleRevenueGraphModel(REFERRAL_REVENUE_DEMO_RAW_NODES);

export default function ReferralRevenueGraphPage() {
  const { hydrated, role, readOnly, isRequestBoardDesigner } = useSession();
  const [depthFilter, setDepthFilter] = useState<SampleRevenueDepthFilter>('all');
  const [selectedNode, setSelectedNode] = useState<SampleRevenueGraphNode | null>(null);
  const [detailNode, setDetailNode] = useState<SampleRevenueGraphNode | null>(null);
  const [fitRequestId, setFitRequestId] = useState(0);
  const [resetRequestId, setResetRequestId] = useState(0);
  const canView = !isRequestBoardDesigner
    && (role === 'fc' || (role === 'admin' && readOnly));

  const {
    expectedTotalKrw,
    focusedGraphNodeIds,
    graphEdges,
    graphNodes,
    contributorCount,
  } = useMemo(() => {
    const filteredNodes = filterSampleRevenueNodesByDepth(
      model.nodes,
      depthFilter,
    );
    const nextGraphNodes = getSampleRevenueGraphContextNodes(
      model.nodes,
      depthFilter,
    );
    const nextFocusedGraphNodeIds = depthFilter === 'all'
      ? undefined
      : new Set(filteredNodes.map((node) => node.id));
    const graphNodeIds = new Set(nextGraphNodes.map((node) => node.id));
    const nextGraphEdges = model.edges.filter(
      (edge) => graphNodeIds.has(edge.source) && graphNodeIds.has(edge.target),
    );
    const contributors = filteredNodes.filter(
      (node) => !node.isViewer && node.eligible,
    );

    return {
      expectedTotalKrw: contributors.reduce(
        (total, node) => total + node.expectedAllocationKrw,
        0,
      ),
      focusedGraphNodeIds: nextFocusedGraphNodeIds,
      graphEdges: nextGraphEdges,
      graphNodes: nextGraphNodes,
      contributorCount: contributors.length,
    };
  }, [depthFilter]);

  const activeDepthLabel = DEPTH_FILTERS.find(
    (filter) => filter.value === depthFilter,
  )?.label ?? '전체';

  const handleDepthFilterChange = (filter: SampleRevenueDepthFilter) => {
    setDepthFilter(filter);
    setSelectedNode(null);
    setDetailNode(null);
  };

  const handleNodeSelect = (node: SampleRevenueGraphNode) => {
    setSelectedNode(node);
    setDetailNode(node);
  };

  const handleReset = () => {
    setDepthFilter('all');
    setSelectedNode(null);
    setDetailNode(null);
    setResetRequestId((value) => value + 1);
  };

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.stateDescription}>화면을 준비하고 있습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!canView) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.centerState}>
          <View style={styles.stateIcon}>
            <Feather name="lock" size={26} color={COLORS.text.muted} />
          </View>
          <Text style={styles.stateTitle}>이 화면을 볼 수 없는 계정입니다</Text>
          <Text style={styles.stateDescription}>
            FC 또는 조회 전용 본부장 계정으로 이용할 수 있습니다.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.page}>
        <View style={styles.summaryRow} accessibilityRole="summary">
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, styles.summaryValueAccent]}>
              {formatSampleRevenueFlowKrw(expectedTotalKrw)}
            </Text>
            <Text style={styles.summaryLabel}>예상 배분</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{contributorCount}</Text>
            <Text style={styles.summaryLabel}>기여 인원</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{activeDepthLabel}</Text>
            <Text style={styles.summaryLabel}>표시 단계</Text>
          </View>
        </View>

        <ScrollView
          style={styles.horizontalScroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {DEPTH_FILTERS.map((filter) => {
            const selected = depthFilter === filter.value;
            return (
              <Pressable
                key={filter.value}
                style={({ pressed }) => [
                  styles.filterButton,
                  selected && styles.filterButtonSelected,
                  pressed && styles.pressed,
                ]}
                onPress={() => handleDepthFilterChange(filter.value)}
                accessibilityRole="button"
                accessibilityLabel={`${filter.label} 금액 흐름 보기`}
                accessibilityState={{ selected }}
              >
                <Text style={[
                  styles.filterText,
                  selected && styles.filterTextSelected,
                ]}>
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.flowNotice}>
          <View style={styles.flowNoticeIcon}>
            <Feather name="arrow-left" size={15} color="#c2410c" />
          </View>
          <Text style={styles.flowNoticeText}>
            각 노드의 금액이 주황색 경로를 따라 중심의 나에게 합산됩니다.
          </Text>
          <View style={styles.sampleBadge}>
            <Text style={styles.sampleBadgeText}>샘플</Text>
          </View>
        </View>

        {selectedNode ? (
          <View style={styles.focusRow}>
            <Feather name="corner-left-up" size={14} color="#c2410c" />
            <Text style={styles.focusName} numberOfLines={1}>
              {selectedNode.name}의 이동 경로
            </Text>
            {!selectedNode.isViewer && selectedNode.eligible ? (
              <Text style={styles.focusAmount}>
                +{formatSampleRevenueFlowKrw(selectedNode.expectedAllocationKrw)}
              </Text>
            ) : null}
            <Pressable
              style={styles.focusCloseButton}
              onPress={() => setSelectedNode(null)}
              accessibilityRole="button"
              accessibilityLabel="금액 이동 경로 강조 해제"
            >
              <Feather name="x" size={17} color={COLORS.text.muted} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.canvasCard}>
          <View style={styles.canvasToolbar}>
            <View style={styles.canvasToolbarKey} accessibilityLabel="주황색 선은 경로별 합계">
              <View style={styles.canvasToolbarLine} />
              <Text style={styles.canvasToolbarText}>경로별 합계</Text>
            </View>
            <View style={styles.canvasActions}>
              <Pressable
                style={({ pressed }) => [styles.canvasButton, pressed && styles.pressed]}
                onPress={() => setFitRequestId((value) => value + 1)}
                accessibilityRole="button"
                accessibilityLabel="증원수당 흐름 그래프 화면 맞춤"
              >
                <Feather name="maximize" size={14} color={COLORS.text.secondary} />
                <Text style={styles.canvasButtonText}>전체 보기</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.canvasButton, pressed && styles.pressed]}
                onPress={handleReset}
                accessibilityRole="button"
                accessibilityLabel="증원수당 흐름 그래프 초기화"
              >
                <Feather name="rotate-ccw" size={14} color={COLORS.text.secondary} />
                <Text style={styles.canvasButtonText}>초기화</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.canvasViewport}>
            <ReferralRevenueFlowCanvas
              nodes={graphNodes}
              edges={graphEdges}
              expectedTotalKrw={expectedTotalKrw}
              focusedNodeIds={focusedGraphNodeIds}
              selectedNodeId={selectedNode?.id ?? null}
              onSelectNode={handleNodeSelect}
              fitRequestId={fitRequestId}
              resetRequestId={resetRequestId}
            />
          </View>
        </View>

        <ScrollView
          style={styles.horizontalScroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.legendRow}
        >
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.viewerLegendDot]} />
            <Text style={styles.legendText}>나</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.eligibleLegendDot]} />
            <Text style={styles.legendText}>배분 대상</Text>
          </View>
          <View style={styles.legendItem}>
            <Feather name="arrow-left" size={13} color="#ea580c" />
            <Text style={styles.legendText}>나에게 이동</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.excludedLegendDot]} />
            <Text style={styles.legendText}>대상 제외</Text>
          </View>
          <Text style={styles.readOnlyText}>조회 전용</Text>
        </ScrollView>

        <View style={styles.disclaimer}>
          <Feather name="info" size={13} color={COLORS.text.muted} />
          <Text style={styles.disclaimerText} numberOfLines={2}>
            {DISCLAIMER}
          </Text>
        </View>
      </View>

      <ReferralRevenueDetailSheet
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
    minWidth: 0,
  },
  summaryValue: {
    color: COLORS.text.primary,
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  summaryValueAccent: {
    color: '#c2410c',
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
  horizontalScroller: {
    flexGrow: 0,
  },
  filterRow: {
    gap: 7,
    paddingRight: SPACING.md,
  },
  filterButton: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.background.primary,
  },
  filterButtonSelected: {
    borderColor: '#f97316',
    backgroundColor: '#fff7ed',
  },
  filterText: {
    color: COLORS.text.secondary,
    fontSize: 12,
    fontWeight: '700',
  },
  filterTextSelected: {
    color: '#c2410c',
  },
  flowNotice: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: RADIUS.md,
    backgroundColor: '#fff7ed',
  },
  flowNoticeIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.full,
    backgroundColor: '#ffedd5',
  },
  flowNoticeText: {
    flex: 1,
    color: '#9a3412',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  sampleBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    backgroundColor: '#ffedd5',
  },
  sampleBadgeText: {
    color: '#c2410c',
    fontSize: 9,
    fontWeight: '900',
  },
  focusRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 10,
    paddingRight: 4,
    borderRadius: RADIUS.md,
    backgroundColor: '#ffedd5',
  },
  focusName: {
    flex: 1,
    color: COLORS.text.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  focusAmount: {
    color: '#c2410c',
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  focusCloseButton: {
    width: TOUCH_TARGET.min,
    height: TOUCH_TARGET.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasCard: {
    flex: 1,
    minHeight: 280,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.background.primary,
    ...SHADOWS.base,
  },
  canvasToolbar: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    backgroundColor: '#ffffff',
  },
  canvasToolbarKey: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  canvasToolbarLine: {
    width: 22,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#ea580c',
  },
  canvasToolbarText: {
    color: COLORS.text.secondary,
    fontSize: 10,
    fontWeight: '800',
  },
  canvasActions: {
    flexDirection: 'row',
    gap: 6,
  },
  canvasButton: {
    minHeight: TOUCH_TARGET.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.background.secondary,
  },
  canvasButtonText: {
    color: COLORS.text.secondary,
    fontSize: 11,
    fontWeight: '800',
  },
  canvasViewport: {
    flex: 1,
    minHeight: 228,
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
  viewerLegendDot: {
    backgroundColor: '#facc15',
  },
  eligibleLegendDot: {
    backgroundColor: '#f97316',
  },
  excludedLegendDot: {
    backgroundColor: '#94a3b8',
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
  disclaimer: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    paddingHorizontal: 2,
  },
  disclaimerText: {
    flex: 1,
    color: COLORS.text.muted,
    fontSize: 9,
    lineHeight: 13,
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
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.gray[100],
  },
  stateTitle: {
    marginTop: SPACING.base,
    color: COLORS.text.primary,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  stateDescription: {
    marginTop: 7,
    color: COLORS.text.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
});
