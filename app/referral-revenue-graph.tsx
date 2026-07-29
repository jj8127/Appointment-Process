import { Feather } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ReferralRevenueDetailSheet } from '@/components/referral-revenue-graph/ReferralRevenueDetailSheet';
import { ReferralRevenueGraphCanvas } from '@/components/referral-revenue-graph/ReferralRevenueGraphCanvas';
import { REFERRAL_REVENUE_DEMO_RAW_NODES } from '@/data/referral-revenue-demo';
import { useSession } from '@/hooks/use-session';
import {
  buildSampleRevenueGraphModel,
  filterSampleRevenueNodesByDepth,
  formatSampleRevenueKrw,
  getSampleRevenueGraphContextNodes,
  sortSampleRevenueNodesByExpectedAmount,
} from '@/lib/referral-revenue-demo';
import { COLORS, RADIUS, SPACING, TOUCH_TARGET } from '@/lib/theme';
import type {
  SampleRevenueDepthFilter,
  SampleRevenueGraphNode,
} from '@/types/referral-revenue-graph';

type ViewMode = 'graph' | 'list';

const isGraphView = (mode: ViewMode) => mode === 'graph';

const DISCLAIMER =
  '샘플 데이터 · 실제 조직, 매출, 정산 내역이 아닙니다. 표시된 하위 구성원의 샘플 매출에 10%를 단순 적용한 화면 예시입니다.';

const DEPTH_FILTERS: { value: SampleRevenueDepthFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: '1-3', label: '1~3단계' },
  { value: '4-6', label: '4~6단계' },
  { value: '7-10', label: '7~10단계' },
];

const model = buildSampleRevenueGraphModel(REFERRAL_REVENUE_DEMO_RAW_NODES);

const COMPACT_LANDSCAPE_FIT_INSETS = {
  top: 70,
  right: 16,
  bottom: 18,
  left: 16,
};

const COMPACT_PORTRAIT_FIT_INSETS = {
  top: 72,
  right: 16,
  bottom: 18,
  left: 16,
};

export default function ReferralRevenueGraphPage() {
  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const { hydrated, role, readOnly, isRequestBoardDesigner } = useSession();
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [depthFilter, setDepthFilter] = useState<SampleRevenueDepthFilter>('all');
  const [selectedNode, setSelectedNode] = useState<SampleRevenueGraphNode | null>(null);
  const [fitRequestId, setFitRequestId] = useState(0);
  const [resetRequestId, setResetRequestId] = useState(0);
  const [controlsOpen, setControlsOpen] = useState(false);
  const activeDepthFilterLabel = DEPTH_FILTERS.find(
    (filter) => filter.value === depthFilter,
  )?.label ?? '전체';

  const canView =
    !isRequestBoardDesigner
    && (role === 'fc' || (role === 'admin' && readOnly));

  useEffect(() => {
    if (!hydrated || !canView || Platform.OS === 'web') return undefined;
    let active = true;
    void ScreenOrientation.supportsOrientationLockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    )
      .then((supported) => {
        if (!active || !supported) return;
        return ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.LANDSCAPE,
        );
      })
      .catch(() => undefined);

    return () => {
      active = false;
      void ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => undefined);
    };
  }, [canView, hydrated]);

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.centerDescription}>화면을 준비하고 있습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!canView) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.centerState}>
          <View style={styles.lockIcon}>
            <Feather name="lock" size={26} color={COLORS.text.muted} />
          </View>
          <Text style={styles.centerTitle}>이 화면을 볼 수 없는 계정입니다</Text>
          <Text style={styles.centerDescription}>
            FC 또는 조회 전용 본부장 계정으로 이용할 수 있습니다.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const filteredNodes = filterSampleRevenueNodesByDepth(model.nodes, depthFilter);
  const graphNodes = getSampleRevenueGraphContextNodes(model.nodes, depthFilter);
  const focusedGraphNodeIds = depthFilter === 'all'
    ? undefined
    : new Set(filteredNodes.map((node) => node.id));
  const graphNodeIds = new Set(graphNodes.map((node) => node.id));
  const graphEdges = model.edges.filter(
    (edge) => graphNodeIds.has(edge.source) && graphNodeIds.has(edge.target),
  );
  const listNodes = sortSampleRevenueNodesByExpectedAmount(
    filteredNodes.filter((node) => node.depth > 0),
  );
  const handleGraphReset = () => {
    setDepthFilter('all');
    setSelectedNode(null);
    setResetRequestId((value) => value + 1);
    setControlsOpen(false);
  };
  const handleGraphFit = () => {
    setFitRequestId((value) => value + 1);
    setControlsOpen(false);
  };
  const handleShowList = () => {
    setControlsOpen(false);
    setViewMode('list');
  };
  const renderImmersiveFilterButton = (
    filter: (typeof DEPTH_FILTERS)[number],
  ) => {
    const selected = depthFilter === filter.value;
    return (
      <Pressable
        key={filter.value}
        style={({ pressed }) => [
          styles.immersiveFilterButton,
          selected && styles.immersiveFilterButtonSelected,
          pressed && styles.pressed,
        ]}
        onPress={() => setDepthFilter(filter.value)}
        accessibilityRole="button"
        accessibilityLabel={`${filter.label} 필터`}
        accessibilityState={{ selected }}
      >
        <Text style={[
          styles.immersiveFilterText,
          selected && styles.immersiveFilterTextSelected,
        ]}>
          {filter.label}
        </Text>
      </Pressable>
    );
  };

  if (viewMode === 'graph') {
    return (
      <SafeAreaView style={styles.immersiveSafe}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.immersiveCanvas}>
          <ReferralRevenueGraphCanvas
            nodes={graphNodes}
            edges={graphEdges}
            focusedNodeIds={focusedGraphNodeIds}
            selectedNodeId={selectedNode?.id ?? null}
            onSelectNode={setSelectedNode}
            fitRequestId={fitRequestId}
            resetRequestId={resetRequestId}
            fitInsets={isLandscape
              ? COMPACT_LANDSCAPE_FIT_INSETS
              : COMPACT_PORTRAIT_FIT_INSETS}
            overlayBottomInset={12}
          />

          <View style={[
            styles.compactHeader,
            isLandscape
              ? styles.compactHeaderLandscape
              : styles.compactHeaderPortrait,
          ]}>
            <View style={styles.compactTopBar}>
              <Pressable
                style={({ pressed }) => [
                  styles.hudIconButton,
                  pressed && styles.pressed,
                ]}
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="매출 기여 그래프 닫기"
              >
                <Feather name="arrow-left" size={20} color={COLORS.text.primary} />
              </Pressable>
              <View style={styles.compactTitleGroup}>
                <View style={styles.compactTitleRow}>
                  <Text style={styles.compactTitle}>매출 기여</Text>
                  <View style={styles.sampleHudBadge}>
                    <Text style={styles.sampleHudBadgeText}>샘플</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.compactSettingsTriggerWrap}>
            <Pressable
              style={({ pressed }) => [
                styles.compactSettingsTrigger,
                pressed && styles.pressed,
              ]}
              onPress={() => setControlsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={
                depthFilter === 'all'
                  ? '그래프 설정 열기'
                  : `그래프 설정 열기, ${activeDepthFilterLabel} 필터 적용 중`
              }
              accessibilityState={{ expanded: controlsOpen }}
            >
              <Feather name="sliders" size={19} color={COLORS.primaryDark} />
              {depthFilter !== 'all' && (
                <View style={styles.activeFilterDot} />
              )}
            </Pressable>
          </View>

          <Modal
            visible={controlsOpen}
            transparent
            animationType="fade"
            statusBarTranslucent
            onRequestClose={() => setControlsOpen(false)}
          >
            <SafeAreaView style={styles.settingsModalSafe}>
              <Pressable
                style={styles.settingsBackdrop}
                onPress={() => setControlsOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="그래프 설정 닫기"
              />
              <View
                style={[
                  styles.settingsPanel,
                  isLandscape
                    ? styles.settingsPanelLandscape
                    : styles.settingsPanelPortrait,
                ]}
                accessibilityViewIsModal
                accessibilityLabel="그래프 설정"
              >
                <View style={styles.settingsPanelHeader}>
                  <View>
                    <Text style={styles.settingsPanelTitle}>그래프 설정</Text>
                    <Text style={styles.settingsPanelSubtitle}>
                      표시 범위와 보기 방식을 조정합니다
                    </Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [
                      styles.hudIconButton,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => setControlsOpen(false)}
                    accessibilityRole="button"
                    accessibilityLabel="그래프 설정 닫기"
                  >
                    <Feather name="x" size={20} color={COLORS.text.primary} />
                  </Pressable>
                </View>

                <ScrollView
                  style={styles.settingsPanelScroll}
                  contentContainerStyle={styles.settingsPanelContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.settingsSummaryGroup}>
                    <View style={styles.settingsSummaryRow}>
                      <View style={[
                        styles.settingsSummaryCard,
                        styles.settingsSummaryCardHalf,
                      ]}>
                        <Text style={styles.settingsSummaryLabel}>예상 배분</Text>
                        <Text style={styles.settingsSummaryValue}>
                          {formatSampleRevenueKrw(
                            model.summary.expectedAllocationKrw,
                          )}
                        </Text>
                      </View>
                      <View style={[
                        styles.settingsSummaryCard,
                        styles.settingsSummaryCardHalf,
                      ]}>
                        <Text style={styles.settingsSummaryLabel}>대상</Text>
                        <Text style={styles.settingsSummaryValue}>
                          {model.summary.eligibleContributorCount}명 · 1~10단계
                        </Text>
                      </View>
                    </View>
                    <View style={styles.settingsSummaryCard}>
                      <Text style={styles.settingsSummaryLabel}>
                        대상 샘플 매출
                      </Text>
                      <Text style={styles.settingsSummaryValue}>
                        {formatSampleRevenueKrw(model.summary.eligibleSalesKrw)}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.settingsSectionTitle}>단계 필터</Text>
                  <View style={styles.settingsFilterGrid}>
                    {DEPTH_FILTERS.map(renderImmersiveFilterButton)}
                  </View>

                  <Text style={styles.settingsSectionTitle}>보기</Text>
                  <View style={styles.settingsActionRow}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.settingsActionButton,
                        pressed && styles.pressed,
                      ]}
                      onPress={handleShowList}
                      accessibilityRole="tab"
                      accessibilityLabel="목록 보기"
                      accessibilityState={{ selected: false }}
                    >
                      <Feather name="list" size={17} color={COLORS.primaryDark} />
                      <Text style={styles.settingsActionText}>목록</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.settingsActionButton,
                        pressed && styles.pressed,
                      ]}
                      onPress={handleGraphFit}
                      accessibilityRole="button"
                      accessibilityLabel="매출 기여 그래프 화면 맞춤"
                    >
                      <Feather
                        name="maximize"
                        size={17}
                        color={COLORS.primaryDark}
                      />
                      <Text style={styles.settingsActionText}>맞춤</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.settingsActionButton,
                        pressed && styles.pressed,
                      ]}
                      onPress={handleGraphReset}
                      accessibilityRole="button"
                      accessibilityLabel="매출 기여 그래프 초기화"
                    >
                      <Feather
                        name="rotate-ccw"
                        size={17}
                        color={COLORS.primaryDark}
                      />
                      <Text style={styles.settingsActionText}>초기화</Text>
                    </Pressable>
                  </View>

                  <Text style={styles.settingsSectionTitle}>범례</Text>
                  <View style={styles.settingsLegendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, styles.viewerLegendDot]} />
                      <Text style={styles.legendText}>나</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, styles.eligibleLegendDot]} />
                      <Text style={styles.legendText}>예상 배분</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, styles.excludedLegendDot]} />
                      <Text style={styles.legendText}>대상 제외</Text>
                    </View>
                  </View>

                  <View style={styles.settingsDisclaimer}>
                    <Feather
                      name="info"
                      size={14}
                      color={COLORS.text.muted}
                    />
                    <Text style={styles.settingsDisclaimerText}>
                      샘플 범위: viewer 아래 1~10단계 · 각 구성원 샘플
                      매출의 10%
                      {'\n'}11단계부터는 대상에서 제외됩니다. 실제
                      조직·매출·정산 내역이 아닙니다.
                      {'\n'}{DISCLAIMER}
                      {'\n'}선은 조직 관계이고 돈의 이동을 의미하지
                      않습니다.
                    </Text>
                  </View>
                </ScrollView>
              </View>
            </SafeAreaView>
          </Modal>
        </View>

        <ReferralRevenueDetailSheet
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <Stack.Screen
        options={{ headerShown: true, title: '매출 기여 그래프' }}
      />
      <ScrollView
        contentContainerStyle={styles.page}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.eyebrowRow}>
          <View style={styles.simulationBadge}>
            <Feather name="activity" size={13} color={COLORS.primaryDark} />
            <Text style={styles.simulationBadgeText}>시뮬레이션</Text>
          </View>
          <Text style={styles.sampleLabel}>샘플</Text>
        </View>

        <Text style={styles.introTitle}>10단계까지의 기여를 한눈에</Text>
        <Text style={styles.scopeText}>
          샘플 범위: viewer 아래 1~10단계 · 각 구성원 샘플 매출의 10%
        </Text>
        <View style={styles.warningBanner}>
          <Feather name="alert-circle" size={16} color={COLORS.warning.dark} />
          <Text style={styles.warningText}>
            11단계부터는 대상에서 제외됩니다. 실제 조직·매출·정산 내역이 아닙니다.
          </Text>
        </View>

        <View style={styles.summarySection}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>대상 샘플 매출</Text>
            <Text style={styles.summaryValue}>
              {formatSampleRevenueKrw(model.summary.eligibleSalesKrw)}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>예상 배분액</Text>
            <Text style={[styles.summaryValue, styles.summaryAccent]}>
              {formatSampleRevenueKrw(model.summary.expectedAllocationKrw)}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>대상 구성원</Text>
            <Text style={styles.summaryValue}>
              {model.summary.eligibleContributorCount}명
            </Text>
          </View>
        </View>

        <View style={styles.segmentedControl}>
          {(['graph', 'list'] as const).map((mode) => {
            const selected = viewMode === mode;
            return (
              <Pressable
                key={mode}
                style={({ pressed }) => [
                  styles.segmentButton,
                  selected && styles.segmentButtonSelected,
                  pressed && styles.pressed,
                ]}
                onPress={() => setViewMode(mode)}
                accessibilityRole="tab"
                accessibilityLabel={mode === 'graph' ? '그래프 보기' : '목록 보기'}
                accessibilityState={{ selected }}
              >
                <Feather
                  name={mode === 'graph' ? 'share-2' : 'list'}
                  size={16}
                  color={selected ? COLORS.primaryDark : COLORS.text.muted}
                />
                <Text style={[
                  styles.segmentText,
                  selected && styles.segmentTextSelected,
                ]}>
                  {mode === 'graph' ? '그래프' : '목록'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <ScrollView
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
                onPress={() => setDepthFilter(filter.value)}
                accessibilityRole="button"
                accessibilityLabel={`${filter.label} 필터`}
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

        {isGraphView(viewMode) ? (
          <View style={styles.graphSection}>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionTitle}>샘플 기여 관계</Text>
                <Text style={styles.sectionDescription}>
                노드 안에서 예상 금액을 보고, 한 손가락으로 이동하거나 두 손가락으로
                확대·축소하세요. 노드를 누르면 상세 금액을 볼 수 있습니다.
                </Text>
                {depthFilter !== 'all' ? (
                  <Text style={styles.contextDescription}>
                    흐린 노드는 선택 구간까지 이어지는 연결 경로입니다.
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.graphCanvasShell}>
              <ReferralRevenueGraphCanvas
                nodes={graphNodes}
                edges={graphEdges}
                focusedNodeIds={focusedGraphNodeIds}
                selectedNodeId={selectedNode?.id ?? null}
                onSelectNode={setSelectedNode}
                fitRequestId={fitRequestId}
                resetRequestId={resetRequestId}
              />
              <View style={styles.canvasActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.canvasButton,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setFitRequestId((value) => value + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="매출 기여 그래프 화면 맞춤"
                >
                  <Feather
                    name="maximize"
                    size={14}
                    color={COLORS.text.secondary}
                  />
                  <Text style={styles.canvasButtonText}>화면 맞춤</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.canvasButton,
                    pressed && styles.pressed,
                  ]}
                  onPress={handleGraphReset}
                  accessibilityRole="button"
                  accessibilityLabel="매출 기여 그래프 초기화"
                >
                  <Feather
                    name="rotate-ccw"
                    size={14}
                    color={COLORS.text.secondary}
                  />
                  <Text style={styles.canvasButtonText}>초기화</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.graphLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.viewerLegendDot]} />
                <Text style={styles.legendText}>기준 viewer</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.eligibleLegendDot]} />
                <Text style={styles.legendText}>1~10단계 대상</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.excludedLegendDot]} />
                <Text style={styles.legendText}>대상 제외</Text>
              </View>
            </View>
            <View style={styles.relationshipNotice}>
              <Feather name="git-branch" size={14} color={COLORS.text.muted} />
              <Text style={styles.relationshipNoticeText}>
                선은 샘플 조직 관계이며 돈의 이동을 의미하지 않습니다.
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.listSection}>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionTitle}>사람별 예상 기여</Text>
                <Text style={styles.sectionDescription}>
                  예상 배분액이 큰 순서이며 대상 제외 항목은 마지막에 표시됩니다.
                </Text>
              </View>
            </View>
            {listNodes.map((node) => (
              <Pressable
                key={node.id}
                style={({ pressed }) => [
                  styles.listRow,
                  !node.eligible && styles.excludedRow,
                  pressed && styles.pressed,
                ]}
                onPress={() => setSelectedNode(node)}
                accessibilityRole="button"
                accessibilityLabel={`${node.name}, ${node.depth}단계, ${
                  node.eligible
                    ? `예상 배분 ${formatSampleRevenueKrw(node.expectedAllocationKrw)}`
                    : '대상 제외'
                }`}
                accessibilityHint="샘플 매출 기여 상세를 엽니다"
              >
                <View style={styles.personIdentity}>
                  <View style={[
                    styles.depthBadge,
                    !node.eligible && styles.excludedDepthBadge,
                  ]}>
                    <Text style={[
                      styles.depthBadgeText,
                      !node.eligible && styles.excludedText,
                    ]}>
                      {node.depth}단계
                    </Text>
                  </View>
                  <View style={styles.personText}>
                    <Text style={styles.personName}>{node.name}</Text>
                    <Text style={styles.personMeta} numberOfLines={1}>
                      샘플 매출 {formatSampleRevenueKrw(node.salesKrw)}
                    </Text>
                  </View>
                </View>
                <View style={styles.amountColumn}>
                  <Text style={[
                    styles.rowAmount,
                    !node.eligible && styles.excludedText,
                  ]}>
                    {node.eligible
                      ? formatSampleRevenueKrw(node.expectedAllocationKrw)
                      : '대상 제외'}
                  </Text>
                  <Feather name="chevron-right" size={17} color={COLORS.text.muted} />
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.disclaimer}>
          <Feather name="info" size={16} color={COLORS.text.muted} />
          <Text style={styles.disclaimerText}>{DISCLAIMER}</Text>
        </View>
      </ScrollView>

      <ReferralRevenueDetailSheet
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  immersiveSafe: {
    flex: 1,
    backgroundColor: '#fffaf5',
  },
  immersiveCanvas: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#fffaf5',
  },
  compactHeader: {
    position: 'absolute',
    top: 10,
    left: 12,
  },
  compactHeaderLandscape: {
    width: 190,
  },
  compactHeaderPortrait: {
    right: 70,
  },
  compactTopBar: {
    minHeight: TOUCH_TARGET.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 5,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.9)',
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  hudIconButton: {
    width: TOUCH_TARGET.min,
    height: TOUCH_TARGET.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.gray[50],
  },
  compactTitleGroup: {
    flex: 1,
  },
  compactTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactTitle: {
    color: COLORS.text.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  sampleHudBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primaryPale,
  },
  sampleHudBadgeText: {
    color: COLORS.primaryDark,
    fontSize: 8,
    fontWeight: '900',
  },
  compactSettingsTriggerWrap: {
    position: 'absolute',
    top: 10,
    right: 12,
  },
  compactSettingsTrigger: {
    width: TOUCH_TARGET.min,
    height: TOUCH_TARGET.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.9)',
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  activeFilterDot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  settingsModalSafe: {
    flex: 1,
  },
  settingsBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.2)',
  },
  settingsPanel: {
    position: 'absolute',
    top: 10,
    right: 12,
    bottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.xl,
    backgroundColor: 'rgba(255,255,255,0.98)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
  },
  settingsPanelLandscape: {
    width: 310,
  },
  settingsPanelPortrait: {
    top: 66,
    left: 12,
  },
  settingsPanelHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 7,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  settingsPanelTitle: {
    color: COLORS.text.primary,
    fontSize: 16,
    fontWeight: '900',
  },
  settingsPanelSubtitle: {
    marginTop: 2,
    color: COLORS.text.muted,
    fontSize: 9,
    fontWeight: '600',
  },
  settingsPanelScroll: {
    flex: 1,
  },
  settingsPanelContent: {
    padding: 12,
    paddingBottom: 18,
  },
  settingsSummaryGroup: {
    gap: 7,
  },
  settingsSummaryRow: {
    flexDirection: 'row',
    gap: 7,
  },
  settingsSummaryCard: {
    minHeight: 58,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(254,215,170,0.9)',
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryPale,
  },
  settingsSummaryCardHalf: {
    flex: 1,
  },
  settingsSummaryLabel: {
    color: COLORS.text.secondary,
    fontSize: 9,
    fontWeight: '700',
  },
  settingsSummaryValue: {
    marginTop: 3,
    color: COLORS.primaryDark,
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  settingsSectionTitle: {
    marginTop: 12,
    marginBottom: 6,
    color: COLORS.text.secondary,
    fontSize: 10,
    fontWeight: '900',
  },
  settingsFilterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  immersiveFilterButton: {
    minHeight: TOUCH_TARGET.min,
    flexBasis: '47%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.94)',
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  immersiveFilterButtonSelected: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(255,237,213,0.96)',
  },
  immersiveFilterText: {
    color: COLORS.text.secondary,
    fontSize: 10,
    fontWeight: '800',
  },
  immersiveFilterTextSelected: {
    color: COLORS.primaryDark,
  },
  settingsActionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  settingsActionButton: {
    minHeight: TOUCH_TARGET.min,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.94)',
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  settingsActionText: {
    color: COLORS.primaryDark,
    fontSize: 9,
    fontWeight: '900',
  },
  settingsLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  settingsDisclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginTop: 12,
    padding: 10,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.gray[50],
  },
  settingsDisclaimerText: {
    flex: 1,
    color: COLORS.text.muted,
    fontSize: 8,
    lineHeight: 12,
  },
  safe: {
    flex: 1,
    backgroundColor: COLORS.background.secondary,
  },
  page: {
    padding: SPACING.base,
    paddingBottom: SPACING['3xl'],
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  simulationBadge: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primaryPale,
  },
  simulationBadgeText: {
    color: COLORS.primaryDark,
    fontSize: 11,
    fontWeight: '800',
  },
  sampleLabel: {
    color: COLORS.text.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  introTitle: {
    marginTop: SPACING.md,
    color: COLORS.text.primary,
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  scopeText: {
    marginTop: 7,
    color: COLORS.text.secondary,
    fontSize: 12,
    lineHeight: 19,
  },
  warningBanner: {
    flexDirection: 'row',
    gap: 8,
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.warning.light,
  },
  warningText: {
    flex: 1,
    color: COLORS.warning.dark,
    fontSize: 11,
    lineHeight: 17,
  },
  summarySection: {
    marginTop: SPACING.lg,
    paddingVertical: SPACING.base,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border.light,
    gap: 12,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  summaryLabel: {
    color: COLORS.text.secondary,
    fontSize: 12,
    fontWeight: '600',
  },
  summaryValue: {
    color: COLORS.text.primary,
    fontSize: 19,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  summaryAccent: {
    color: COLORS.primaryDark,
  },
  summaryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border.light,
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: 4,
    marginTop: SPACING.lg,
    padding: 4,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.gray[100],
  },
  segmentButton: {
    flex: 1,
    minHeight: TOUCH_TARGET.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: RADIUS.base,
  },
  segmentButtonSelected: {
    backgroundColor: COLORS.white,
  },
  segmentText: {
    color: COLORS.text.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  segmentTextSelected: {
    color: COLORS.primaryDark,
  },
  filterRow: {
    gap: 7,
    paddingTop: SPACING.md,
    paddingRight: SPACING.base,
  },
  filterButton: {
    minHeight: TOUCH_TARGET.min,
    justifyContent: 'center',
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.white,
  },
  filterButtonSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale,
  },
  filterText: {
    color: COLORS.text.secondary,
    fontSize: 12,
    fontWeight: '700',
  },
  filterTextSelected: {
    color: COLORS.primaryDark,
  },
  graphSection: {
    marginTop: SPACING.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.white,
  },
  graphCanvasShell: {
    height: 470,
    overflow: 'hidden',
    backgroundColor: '#fffaf5',
  },
  canvasActions: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    gap: 6,
  },
  canvasButton: {
    minHeight: TOUCH_TARGET.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  canvasButtonText: {
    color: COLORS.text.secondary,
    fontSize: 10,
    fontWeight: '800',
  },
  graphLegend: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border.light,
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
    fontSize: 9,
    fontWeight: '700',
  },
  listSection: {
    marginTop: SPACING.lg,
  },
  sectionHeading: {
    padding: SPACING.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border.light,
  },
  sectionTitle: {
    color: COLORS.text.primary,
    fontSize: 16,
    fontWeight: '800',
  },
  sectionDescription: {
    marginTop: 4,
    color: COLORS.text.muted,
    fontSize: 11,
    lineHeight: 17,
  },
  contextDescription: {
    marginTop: 5,
    color: COLORS.text.secondary,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 16,
  },
  relationshipNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    padding: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border.light,
    backgroundColor: COLORS.gray[50],
  },
  relationshipNoticeText: {
    flex: 1,
    color: COLORS.text.muted,
    fontSize: 10,
    lineHeight: 16,
  },
  listRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border.light,
  },
  excludedRow: {
    opacity: 0.78,
  },
  personIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  depthBadge: {
    minWidth: 50,
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primaryPale,
  },
  excludedDepthBadge: {
    backgroundColor: COLORS.gray[200],
  },
  depthBadgeText: {
    color: COLORS.primaryDark,
    fontSize: 10,
    fontWeight: '800',
  },
  personText: {
    flex: 1,
  },
  personName: {
    color: COLORS.text.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  personMeta: {
    marginTop: 4,
    color: COLORS.text.muted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  amountColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  rowAmount: {
    color: COLORS.primaryDark,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  excludedText: {
    color: COLORS.text.muted,
  },
  disclaimer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: SPACING.xl,
    paddingHorizontal: 2,
  },
  disclaimerText: {
    flex: 1,
    color: COLORS.text.muted,
    fontSize: 10,
    lineHeight: 16,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  lockIcon: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.gray[100],
  },
  centerTitle: {
    marginTop: SPACING.base,
    color: COLORS.text.primary,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  centerDescription: {
    marginTop: 7,
    color: COLORS.text.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.68,
  },
});
