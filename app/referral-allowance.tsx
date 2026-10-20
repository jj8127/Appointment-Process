import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ReferralBranchFocus, type BranchFocusRow } from '@/components/referral-graph/ReferralBranchFocus';
import { ReferralGraphCanvas } from '@/components/referral-graph/ReferralGraphCanvas';
import { useReferralAllowance, useReferralAllowanceAccess } from '@/hooks/use-referral-allowance';
import { useReferralClusterLayout } from '@/hooks/use-referral-cluster-layout';
import { isReferralReloginError } from '@/hooks/use-referral-app-session';
import {
  buildReferralAllowanceGraph, buildReferralAllowanceNodeAmounts, buildReferralAllowancePathTotals, formatReferralAllowanceKrw,
  formatReferralAllowanceMonth, formatReferralAllowancePerformanceKrw,
} from '@/lib/referral-allowance-display';
import { buildBranchChildren, createBranchFocusIndex } from '@/lib/referral-branch-focus';
import { COLORS, RADIUS, SPACING, TOUCH_TARGET } from '@/lib/theme';
import type { ReferralAllowanceNode, ReferralAllowanceStatement } from '@/types/referral-allowance';
import type { ReferralGraphNode } from '@/types/referral-graph';

const BASELINE_ALLOWANCE_MONTHS = ['2026-06', '2026-07', '2026-08'] as const;
const DEFAULT_ALLOWANCE_MONTH = '2026-08';

function allowanceDisplayMonths(availableMonths: string[]) {
  return [...new Set([...availableMonths, ...BASELINE_ALLOWANCE_MONTHS])];
}

function LoadingState() {
  return <View style={styles.state}><ActivityIndicator size="large" color={COLORS.primary} />
    <Text style={styles.body}>증원수당 내역을 확인하고 있습니다.</Text></View>;
}

function ErrorState({ error, retry, inline = false, busy = false }: { error: unknown; retry: () => void; inline?: boolean; busy?: boolean }) {
  const router = useRouter();
  const needsRelogin = isReferralReloginError(error);
  return <View style={inline ? styles.readError : styles.state}><Feather name="alert-circle" size={inline ? 20 : 28} color={COLORS.primaryDark} />
    <Text style={styles.title}>{inline ? '최신 수당 내역을 불러오지 못했습니다' : needsRelogin ? '다시 로그인해주세요' : '수당 내역을 불러오지 못했습니다'}</Text>
    <Text style={styles.body}>{inline ? '이전에 확인한 내용을 표시합니다.' : needsRelogin ? '로그인 후 증원수당 내역을 다시 확인해주세요.' : '연결 상태를 확인한 뒤 다시 시도해주세요.'}</Text>
    <Pressable style={[styles.action, !needsRelogin && busy && styles.actionBusy]} accessibilityRole="button"
      disabled={!needsRelogin && busy} accessibilityState={{ disabled: !needsRelogin && busy, busy: !needsRelogin && busy }}
      onPress={needsRelogin ? () => router.push('/login?skipAuto=1') : retry}>
      {!needsRelogin && busy ? <ActivityIndicator size="small" color={COLORS.white} /> : null}
      <Text style={styles.actionText}>{needsRelogin ? '로그인' : '다시 시도'}</Text>
    </Pressable></View>;
}

function EmptyState({ month, retry, busy = false }: { month: string; retry: () => void; busy?: boolean }) {
  return <View style={styles.state}>
    <View style={styles.emptyIcon}><Feather name="bar-chart-2" size={30} color={COLORS.primaryDark} /></View>
    <Text style={[styles.title, styles.stateText]}>{formatReferralAllowanceMonth(month)} 수당 명세가 없습니다</Text>
    <Text style={[styles.body, styles.stateText]}>해당 월의 명세가 등록되면 이 화면에서 확인할 수 있습니다.</Text>
    <Pressable style={[styles.action, busy && styles.actionBusy]} onPress={retry} accessibilityRole="button"
      disabled={busy} accessibilityState={{ disabled: busy, busy }}>
      {busy ? <ActivityIndicator size="small" color={COLORS.white} /> : null}
      <Text style={styles.actionText}>다시 확인</Text>
    </Pressable>
  </View>;
}

export default function ReferralAllowancePage() {
  const access = useReferralAllowanceAccess();
  return <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
    {access.isLoading ? <LoadingState /> : access.error && !access.data ? <ErrorState error={access.error} retry={access.retry} />
      : <>{access.error ? <ErrorState error={access.error} retry={access.retry} busy={access.isRefreshing} inline /> : null}
        {access.enabled ? <AllowanceStatement key={access.scope}
          initialAvailableMonths={access.data?.enabled ? access.data.availableMonths : []} />
          : <UnavailableAllowanceStatement key={access.scope} retry={access.retry} busy={access.isRefreshing} />}</>}
  </SafeAreaView>;
}

function MonthSelector({ months, selectedMonth, onChangeMonth }: {
  months: string[]; selectedMonth?: string; onChangeMonth: (month: string) => void;
}) {
  return <ScrollView horizontal style={styles.monthScroller} showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.months} accessibilityLabel="수당 실적월 선택">
    {months.map((item) => <Pressable key={item} accessibilityRole="button"
      accessibilityState={{ selected: item === selectedMonth }}
      style={[styles.month, item === selectedMonth && styles.monthSelected]} onPress={() => onChangeMonth(item)}>
      <Text style={[styles.monthText, item === selectedMonth && styles.monthSelectedText]}>{formatReferralAllowanceMonth(item)}</Text>
    </Pressable>)}
  </ScrollView>;
}

function AllowanceStateContent({ months, selectedMonth, onChangeMonth, children }: {
  months: string[]; selectedMonth: string; onChangeMonth: (month: string) => void; children: ReactNode;
}) {
  return <View style={styles.content}>
    <View style={styles.pageHeader}>
      <View style={styles.headingRow}>
        <MonthSelector months={months} selectedMonth={selectedMonth} onChangeMonth={onChangeMonth} />
      </View>
    </View>
    {children}
  </View>;
}

function UnavailableAllowanceStatement({ retry, busy }: { retry: () => void; busy: boolean }) {
  const [month, setMonth] = useState(DEFAULT_ALLOWANCE_MONTH);
  const months = useMemo(() => allowanceDisplayMonths([]), []);
  return <AllowanceStateContent months={months} selectedMonth={month} onChangeMonth={setMonth}>
    <EmptyState month={month} retry={retry} busy={busy} />
  </AllowanceStateContent>;
}

function AllowanceStatement({ initialAvailableMonths }: { initialAvailableMonths: string[] }) {
  const [month, setMonth] = useState<string>();
  const [selection, setSelection] = useState<{ statement: ReferralAllowanceStatement; id: string } | null>(null);
  const [view, setView] = useState<'graph' | 'details'>('graph');
  // 기본은 가볍게: 가운데 한 명 + 직접 추천 가지 합계. 전체 그래프는 고를 때만 마운트한다.
  const [graphMode, setGraphMode] = useState<'branch' | 'full'>('branch');
  const query = useReferralAllowance(month);
  const statement = query.statement;
  const months = useMemo(() => allowanceDisplayMonths([...initialAvailableMonths, ...query.availableMonths]),
    [initialAvailableMonths, query.availableMonths]);
  const selectedMonth = month ?? statement?.performanceMonth ?? initialAvailableMonths[0] ?? DEFAULT_ALLOWANCE_MONTH;
  const selectedId = selection?.statement === statement ? selection.id : null;
  const changeMonth = (next: string) => {
    setSelection(null);
    setMonth(next);
  };

  if (query.isLoading) return <AllowanceStateContent months={months} selectedMonth={selectedMonth} onChangeMonth={changeMonth}>
    <LoadingState />
  </AllowanceStateContent>;
  if (query.error && !query.data) return <AllowanceStateContent months={months} selectedMonth={selectedMonth} onChangeMonth={changeMonth}>
    <ErrorState error={query.error} retry={query.retry} />
  </AllowanceStateContent>;
  if (!query.enabled || !statement || statement.nodes.length === 0) return <AllowanceStateContent
    months={months} selectedMonth={selectedMonth} onChangeMonth={changeMonth}>
    {query.error ? <ErrorState error={query.error} retry={query.retry} busy={query.isRefreshing} inline /> : null}
    <EmptyState month={selectedMonth} retry={query.retry} busy={query.isRefreshing} />
  </AllowanceStateContent>;

  return <>{query.error ? <ErrorState error={query.error} retry={query.retry} inline /> : null}
    <StatementContent statement={statement} months={months} onChangeMonth={changeMonth}
    selectedId={selectedId} onSelect={(id) => setSelection(id === null ? null : { statement, id })} view={view} onChangeView={setView}
    graphMode={graphMode} onChangeGraphMode={setGraphMode}
    onRefresh={query.retry} refreshing={query.isRefreshing} /></>;
}

function StatementContent({ statement, months, onChangeMonth, selectedId, onSelect, view, onChangeView, graphMode, onChangeGraphMode, onRefresh, refreshing }: {
  statement: ReferralAllowanceStatement; months: string[]; onChangeMonth: (month: string) => void;
  selectedId: string | null; onSelect: (id: string | null) => void;
  view: 'graph' | 'details'; onChangeView: (view: 'graph' | 'details') => void;
  graphMode: 'branch' | 'full'; onChangeGraphMode: (mode: 'branch' | 'full') => void; onRefresh: () => void; refreshing: boolean;
}) {
  const rows = useMemo(() => statement.nodes.filter((node) => !node.isBeneficiary), [statement]);
  const selected = useMemo(() => statement.nodes.find((node) => node.id === selectedId), [statement, selectedId]);
  return <View style={styles.content}>
    <View style={styles.pageHeader}>
      <View style={styles.headingRow}>
        <MonthSelector months={months} selectedMonth={statement.performanceMonth} onChangeMonth={onChangeMonth} />
        <Pressable style={styles.iconButton} onPress={onRefresh} disabled={refreshing} accessibilityState={{ busy: refreshing }}
          accessibilityRole="button" accessibilityLabel="수당 내역 새로 확인">
          {refreshing ? <ActivityIndicator size="small" color={COLORS.white} />
            : <Feather name="refresh-cw" size={19} color={COLORS.primaryDark} />}</Pressable>
      </View>
      <View style={styles.viewTabs} accessibilityRole="tablist">
        {([{ value: 'graph', label: '수당 그래프' }, { value: 'details', label: '상세 내역' }] as const).map((tab) =>
          <Pressable key={tab.value} accessibilityRole="tab" accessibilityState={{ selected: view === tab.value }}
            style={[styles.viewTab, view === tab.value && styles.viewTabSelected]} onPress={() => onChangeView(tab.value)}>
            <Text style={[styles.viewTabText, view === tab.value && styles.viewTabSelectedText]}>{tab.label}</Text>
          </Pressable>)}
      </View>
    </View>
    {view === 'graph' && graphMode === 'branch' ? <View style={styles.graphPage}>
      <AllowanceBranchFocus statement={statement} onSelect={onSelect}
        modeToggle={<GraphModeToggle value={graphMode} onChange={onChangeGraphMode} />} />
    </View> : view === 'graph' ? <GestureHandlerRootView style={styles.graphPage}>
      <View style={styles.graphSummary} accessibilityRole="summary">
        <View style={styles.headingRow}>
        <Text style={styles.paymentLabel}>당월 신규 지급예정액</Text>
        <Text style={styles.graphPaymentAmount}>{formatReferralAllowanceKrw(statement.summary.newPaymentKrw)}</Text>
        </View>
        <Text style={styles.meta}>실적월 {statement.performanceMonth} · 지급예정일 {statement.paymentDate}</Text>
         <Text style={styles.meta}>전월 이월금 제외 · 실제 입금액과 다를 수 있습니다.</Text>
        <GraphModeToggle value={graphMode} onChange={onChangeGraphMode} />
      </View>
      <AllowanceGraph statement={statement} selectedId={selectedId} onSelect={onSelect} />
    </GestureHandlerRootView> : <FlatList data={rows} keyExtractor={(node) => node.id} contentContainerStyle={styles.list}
      initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
      ListHeaderComponent={<View style={styles.header}>
      <View style={styles.paymentCard} accessibilityRole="summary">
        <Text style={styles.paymentLabel}>당월 신규 지급예정액</Text>
        <Text style={styles.paymentAmount}>{formatReferralAllowanceKrw(statement.summary.newPaymentKrw)}</Text>
        <View style={styles.divider} />
        <AmountRow label="다음 달 이월" amount={statement.summary.carryForwardKrw} signed />
        <AmountRow label="소액 음수 소멸" amount={statement.summary.extinguishedKrw} signed />
        <AmountRow label="당월 기여액 합계" amount={statement.summary.currentMonthNetKrw} signed />
        {!statement.beneficiary.eligibleAtBasisDate || statement.summary.excludedByEligibilityKrw !== 0
          ? <AmountRow label="수령인 기준일 자격에 따른 제외" amount={statement.summary.excludedByEligibilityKrw} signed /> : null}
      </View>
      <View style={styles.note}><Feather name="info" size={16} color={COLORS.primaryDark} />
        <Text style={styles.noteText}>전월 이월금은 포함하지 않은 당월 신규 산정액입니다. 실제 입금액과 다를 수 있습니다.</Text></View>
      <Text style={styles.meta}>지급일 {statement.paymentDate} · 계보·자격 기준(시범) {statement.genealogyAsOf}</Text>
      <Text style={styles.meta}>계보·인사 원본 기준일: {statement.sourceSnapshotDates.join(' · ')}</Text>
      {statement.usesLaterSnapshot ? <Text style={styles.noteText}>기준일 이후의 계보·인사 원본 자료가 포함된 시범 참조입니다. 기준일 당시의 확정 계보·자격 이력은 아닙니다.</Text> : null}
      <Text style={styles.body}>FP별 최종 대상실적의 10%를 만원 단위로 절사한 금액을 기준으로 산정합니다. 음수 기여액도 합계에 반영합니다.</Text>
      <View style={styles.headingRow}><Text style={styles.title}>전체 FP 내역</Text><Text style={styles.count}>{rows.length.toLocaleString('ko-KR')}명</Text></View>
      <Text style={styles.meta}>금액을 누르면 해당 FP의 매출과 내 수당을 확인할 수 있습니다.</Text>
    </View>}
    ListEmptyComponent={<Text style={styles.body}>이 월에는 표시할 하위 FP 내역이 없습니다.</Text>}
    renderItem={({ item }) => <Pressable onPress={() => onSelect(item.id)} accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.depth}단계, 기여액 ${formatReferralAllowanceKrw(item.contributionKrw, true)}`}
      style={[styles.personRow, item.id === selectedId && styles.personRowSelected]}>
      <View style={styles.personIdentity}><Text style={styles.personName}>{item.name}</Text>
        <Text style={styles.meta}>{item.depth}단계{item.affiliation ? ` · ${item.affiliation}` : ''}</Text></View>
      <Text style={[styles.personAmount, item.contributionKrw < 0 && styles.negative]}>{formatReferralAllowanceKrw(item.contributionKrw, true)}</Text>
      <Feather name="chevron-right" size={17} color={COLORS.text.secondary} />
    </Pressable>} />}
    <Modal visible={Boolean(selected)} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => onSelect(null)}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => onSelect(null)} accessibilityRole="button" accessibilityLabel="FP 상세 닫기" />
          <View style={styles.modalSheet} accessibilityViewIsModal>
            <ScrollView>{selected ? <AllowanceDetail node={selected} onClose={() => onSelect(null)} /> : null}</ScrollView>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal></View>;
}

function AmountRow({ label, amount, signed = false, performance = false }: { label: string; amount: number; signed?: boolean; performance?: boolean }) {
  return <View style={styles.amountRow}><Text style={styles.amountLabel}>{label}</Text>
    <Text style={[styles.amountValue, amount < 0 && styles.negative]}>{performance
      ? formatReferralAllowancePerformanceKrw(amount) : formatReferralAllowanceKrw(amount, signed)}</Text></View>;
}

function AllowanceDetail({ node, onClose }: { node: ReferralAllowanceNode; onClose: () => void }) {
  return <View style={styles.detail}>
    <View style={styles.headingRow}><Text style={styles.title}>{node.name}</Text>
      <Pressable onPress={onClose} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="FP 상세 닫기">
        <Feather name="x" size={19} color={COLORS.text.secondary} /></Pressable></View>
    <AmountRow label="매출(산정 기준)" amount={node.finalTargetPerformanceKrw} performance />
    <AmountRow label="내 수당" amount={node.contributionKrw} signed />
  </View>;
}

function GraphModeToggle({ value, onChange }: { value: 'branch' | 'full'; onChange: (mode: 'branch' | 'full') => void }) {
  return <View style={styles.graphModes} accessibilityRole="tablist">
    {([{ value: 'branch', label: '가지' }, { value: 'full', label: '전체 그래프' }] as const).map((mode) =>
      <Pressable key={mode.value} accessibilityRole="tab" accessibilityState={{ selected: value === mode.value }}
        accessibilityLabel={mode.value === 'branch' ? '가지 보기' : '전체 그래프'}
        style={[styles.graphMode, value === mode.value && styles.graphModeSelected]} onPress={() => onChange(mode.value)}>
        <Text style={[styles.graphModeText, value === mode.value && styles.graphModeSelectedText]}>{mode.label}</Text>
      </Pressable>)}
  </View>;
}

function AllowanceBranchFocus({ statement, onSelect, modeToggle }: {
  statement: ReferralAllowanceStatement; onSelect: (id: string) => void; modeToggle: ReactElement;
}) {
  const index = useMemo(() => createBranchFocusIndex(statement.nodes), [statement]);
  const totals = useMemo(() => buildReferralAllowancePathTotals(statement.nodes), [statement]);
  const [focus, setFocus] = useState<{ statement: ReferralAllowanceStatement; id: string } | null>(null);
  const focusNode = (focus?.statement === statement ? index.byId.get(focus.id) : undefined)
    ?? index.byId.get(statement.beneficiary.nodeId) ?? statement.nodes[0];
  const children = useMemo(() => buildBranchChildren(index, focusNode.id, (id) => totals.get(id) ?? 0),
    [index, totals, focusNode.id]);
  const krw = (amount: number) => formatReferralAllowanceKrw(amount, true);
  const isRoot = focusNode.isBeneficiary;
  const focusTotal = totals.get(focusNode.id) ?? 0;
  const childrenSum = children.reduce((sum, child) => sum + child.value, 0);
  const rows: BranchFocusRow[] = useMemo(() => children.map((child) => {
    const node = index.byId.get(child.id)!;
    return { id: child.id, label: node.name, valueText: krw(child.value), value: child.value, negative: child.value < 0,
      meta: `본인 ${krw(node.contributionKrw)}${child.childCount > 0 ? ` · 직접 추천 ${child.childCount}명` : ''}`,
      drillable: child.childCount > 0, accessibilityLabel: `${node.name}, 가지 합계 ${krw(child.value)}` };
  }), [children, index]);
  // 맨 위(나)는 지급예정액 하나만 크게, 그 아래 단계는 그 사람 가지 합계
  const total = isRoot
    ? { label: '당월 신규 지급예정액', valueText: formatReferralAllowanceKrw(statement.summary.newPaymentKrw),
      accessibilityLabel: `당월 신규 지급예정액 ${formatReferralAllowanceKrw(statement.summary.newPaymentKrw)}` }
    : { label: `${focusNode.name}님 가지 합계`, valueText: krw(focusTotal), negative: focusTotal < 0,
      accessibilityLabel: `${focusNode.name} 가지 합계 ${krw(focusTotal)}` };
  const summary = isRoot
    ? `가지 ${children.length}개 ${krw(childrenSum)} · ${Number(statement.paymentDate.slice(5, 7))}/${Number(statement.paymentDate.slice(8))} 지급 · 이월금 제외`
    : `본인 ${krw(focusNode.contributionKrw)} + 하위 가지 ${children.length}개 ${krw(childrenSum)}`;
  return <ReferralBranchFocus inset={false}
    path={index.pathTo(focusNode.id).map((node) => ({ id: node.id, label: node.isBeneficiary ? '나' : node.name }))}
    total={total} summary={summary} accessory={isRoot ? modeToggle : null}
    rows={rows} listTitle={isRoot ? '직접 추천 가지' : `${focusNode.name}님의 직접 추천 가지`}
    emptyText="이 아래로 연결된 FP가 없습니다."
    onFocus={(id) => setFocus({ statement, id })} onOpen={onSelect}
    onTotalPress={isRoot ? undefined : () => onSelect(focusNode.id)} />;
}

function AllowanceGraph({ statement, selectedId, onSelect }: {
  statement: ReferralAllowanceStatement; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const graph = useMemo(() => buildReferralAllowanceGraph(statement), [statement]);
  const nodeAmounts = useMemo(() => buildReferralAllowanceNodeAmounts(statement), [statement]);
  const amountsByNodeId = useMemo(() => new Map(nodeAmounts.map((amounts) => [amounts.nodeId, amounts])), [nodeAmounts]);
  const nodeById = useMemo(() => new Map(statement.nodes.map((node) => [node.id, node])), [statement]);
  const [fit, setFit] = useState(0);
  // 관리자 웹과 같은 집단 배치(계산 결과는 기억해 두고 다시 쓴다)
  const cluster = useReferralClusterLayout(graph.nodes, graph.edges, true);
  const describeNode = useCallback((node: ReferralGraphNode) => {
    const source = nodeById.get(node.id)!;
    const amounts = amountsByNodeId.get(source.id);
    return `${source.name}, ${source.depth}단계, ${amounts
      ? `${amounts.directText}, ${amounts.totalText}` : `총 수당 ${formatReferralAllowanceKrw(statement.summary.currentMonthNetKrw, true)}`}`;
  }, [nodeById, amountsByNodeId, statement.summary.currentMonthNetKrw]);
  const selectNode = useCallback((node: ReferralGraphNode) => onSelect(node.id), [onSelect]);
  return <View style={styles.graphCard}>
    <View style={styles.graphToolbar}><Text style={styles.meta}>관계 {graph.nodes.length} / {graph.totalNodeCount}명 표시</Text>
      <Pressable onPress={() => setFit((value) => value + 1)} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="기여 관계 전체 보기">
        <Feather name="maximize" size={18} color={COLORS.primaryDark} /></Pressable></View>
    {__DEV__ && cluster.elapsedMs != null ? <Text style={[styles.meta, styles.devTiming]}>
      집단 배치 {cluster.source === 'computed' ? '폰 계산' : '저장본'} {cluster.elapsedMs}ms · {graph.nodes.length}명</Text> : null}
    <View style={styles.graphViewport}>{cluster.computing ? <View style={styles.state}>
      <ActivityIndicator color={COLORS.primary} /><Text style={styles.body}>배치 중</Text></View>
      : <ReferralGraphCanvas positions={cluster.positions ?? undefined} nodes={graph.nodes} edges={graph.edges}
      selectedNodeId={selectedId} onSelectNode={selectNode} fitRequestId={fit} resetRequestId={0}
      getNodeAccessibilityLabel={describeNode} nodeAmounts={nodeAmounts} />}</View>
    <Text style={styles.graphCaption}>이름 아래 직접: 해당 FP로부터 받는 수당 · 총: 하위 계보 포함. 확대하면 더 많은 금액이 표시됩니다.
      {graph.omittedNodeCount > 0 ? ` 화면 부하를 줄이기 위해 ${graph.omittedNodeCount}명은 그래프에 생략했습니다. 금액 합계와 상세 내역의 전체 FP 내역에는 모두 포함됩니다.` : ''}</Text>
  </View>;
}

const styles = StyleSheet.create({
  readError: { margin: SPACING.md, padding: SPACING.md, gap: 6, borderRadius: RADIUS.md, backgroundColor: COLORS.primaryPale },
  safe: { flex: 1, backgroundColor: COLORS.background.secondary },
  content: { flex: 1 },
  state: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 14 },
  stateText: { textAlign: 'center' },
  emptyIcon: { width: 72, height: 72, borderRadius: RADIUS.lg, backgroundColor: COLORS.primaryPale, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  pageHeader: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md, gap: 12 },
  viewTabs: { flexDirection: 'row', padding: 4, borderRadius: RADIUS.md, backgroundColor: COLORS.border.light },
  viewTab: { flex: 1, minHeight: TOUCH_TARGET.min, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.sm },
  viewTabSelected: { backgroundColor: COLORS.white },
  viewTabText: { fontSize: 14, fontWeight: '600', color: COLORS.text.secondary },
  viewTabSelectedText: { color: COLORS.primaryDark, fontWeight: '700' },
  graphPage: { flex: 1, padding: SPACING.md, gap: 12 },
  graphSummary: { gap: 5 },
  graphModes: { flexDirection: 'row', alignSelf: 'flex-start', padding: 3, borderRadius: RADIUS.md, backgroundColor: COLORS.border.light },
  graphMode: { minHeight: 36, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.sm },
  graphModeSelected: { backgroundColor: COLORS.white },
  graphModeText: { fontSize: 13, fontWeight: '600', color: COLORS.text.secondary },
  graphModeSelectedText: { color: COLORS.primaryDark, fontWeight: '700' },
  graphPaymentAmount: { fontSize: 24, fontWeight: '800', color: COLORS.text.primary, fontVariant: ['tabular-nums'], flexShrink: 1 },
  list: { padding: SPACING.md, paddingBottom: 32 },
  header: { gap: 14, paddingBottom: 12 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { color: COLORS.text.primary, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  body: { color: COLORS.text.secondary, fontSize: 13, lineHeight: 21 },
  meta: { color: COLORS.text.secondary, fontSize: 11, lineHeight: 18 },
  months: { gap: 8 },
  monthScroller: { flex: 1 },
  month: { minHeight: TOUCH_TARGET.min, borderRadius: RADIUS.full, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border.light, justifyContent: 'center', paddingHorizontal: 14 },
  monthSelected: { backgroundColor: COLORS.primaryPale, borderColor: COLORS.primary },
  monthText: { color: COLORS.text.secondary, fontSize: 12, fontWeight: '600' },
  monthSelectedText: { color: COLORS.primaryDark },
  paymentCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: 20, borderTopWidth: 4, borderTopColor: COLORS.primary, gap: 14 },
  paymentLabel: { fontSize: 13, color: COLORS.text.secondary, fontWeight: '700' },
  paymentAmount: { fontSize: 30, fontWeight: '800', color: COLORS.text.primary, fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: COLORS.border.light, marginVertical: 2 },
  amountRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  amountLabel: { fontSize: 12, color: COLORS.text.secondary, flexShrink: 1 },
  amountValue: { fontSize: 14, fontWeight: '700', color: COLORS.text.primary, fontVariant: ['tabular-nums'] },
  negative: { color: COLORS.error },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: COLORS.primaryPale, padding: 12, borderRadius: RADIUS.md },
  noteText: { flex: 1, fontSize: 12, lineHeight: 19, color: COLORS.primaryDark },
  action: { minHeight: TOUCH_TARGET.min, paddingHorizontal: 22, justifyContent: 'center', borderRadius: RADIUS.md, backgroundColor: COLORS.primary },
  actionText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  actionBusy: { flexDirection: 'row', alignItems: 'center', gap: 8, opacity: 0.7 },
  iconButton: { width: TOUCH_TARGET.min, height: TOUCH_TARGET.min, alignItems: 'center', justifyContent: 'center' },
  graphCard: { flex: 1, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border.light },
  graphToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 12 },
  graphViewport: { flex: 1, minHeight: 0 },
  devTiming: { paddingHorizontal: 12 },
  graphCaption: { color: COLORS.text.secondary, fontSize: 11, lineHeight: 18, padding: 12 },
  count: { color: COLORS.primaryDark, fontSize: 13, fontWeight: '700' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.white, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border.light, padding: 14, marginBottom: 8, minHeight: 66 },
  personRowSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryPale },
  personIdentity: { flex: 1, minWidth: 0, gap: 4 },
  personName: { color: COLORS.text.primary, fontSize: 14, fontWeight: '700' },
  personAmount: { color: COLORS.text.primary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 1 },
  detail: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.primary, borderRadius: RADIUS.lg, padding: 16, gap: 13 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: COLORS.background.overlay, padding: SPACING.md },
  modalSheet: { maxHeight: '85%', borderRadius: RADIUS.lg, overflow: 'hidden' },
});
