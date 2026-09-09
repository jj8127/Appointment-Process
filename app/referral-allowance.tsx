import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ReferralGraphCanvas } from '@/components/referral-graph/ReferralGraphCanvas';
import { useReferralAllowance, useReferralAllowanceAccess } from '@/hooks/use-referral-allowance';
import { isReferralReloginError } from '@/hooks/use-referral-app-session';
import {
  buildReferralAllowanceGraph, buildReferralAllowanceNodeAmounts, formatReferralAllowanceKrw,
  formatReferralAllowanceMonth, formatReferralAllowancePerformanceKrw,
} from '@/lib/referral-allowance-display';
import { COLORS, RADIUS, SPACING, TOUCH_TARGET } from '@/lib/theme';
import type { ReferralAllowanceNode, ReferralAllowanceStatement } from '@/types/referral-allowance';
import type { ReferralGraphNode } from '@/types/referral-graph';

function LoadingState() {
  return <View style={styles.state}><ActivityIndicator size="large" color={COLORS.primary} />
    <Text style={styles.body}>증원수당 내역을 확인하고 있습니다.</Text></View>;
}

function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const router = useRouter();
  const needsRelogin = isReferralReloginError(error);
  return <View style={styles.state}><Feather name="alert-circle" size={28} color={COLORS.primaryDark} />
    <Text style={styles.title}>{needsRelogin ? '다시 로그인해주세요' : '수당 내역을 불러오지 못했습니다'}</Text>
    <Text style={styles.body}>{needsRelogin ? '로그인 후 증원수당 내역을 다시 확인해주세요.' : '연결 상태를 확인한 뒤 다시 시도해주세요.'}</Text>
    <Pressable style={styles.action} accessibilityRole="button"
      onPress={needsRelogin ? () => router.push('/login?skipAuto=1') : retry}>
      <Text style={styles.actionText}>{needsRelogin ? '로그인' : '다시 시도'}</Text>
    </Pressable></View>;
}

export default function ReferralAllowancePage() {
  const access = useReferralAllowanceAccess();
  return <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
    {access.isLoading ? <LoadingState /> : access.error ? <ErrorState error={access.error} retry={access.retry} />
      : access.enabled ? <AllowanceStatement key={access.scope} initialMonths={access.data?.enabled ? access.data.availableMonths : []} />
        : <View style={styles.state}><Feather name="lock" size={28} color={COLORS.text.secondary} />
          <Text style={styles.title}>조회 대상 계정이 아닙니다</Text>
          <Text style={styles.body}>이 계정에는 공개된 증원수당 명세가 제공되지 않습니다.</Text></View>}
  </SafeAreaView>;
}

function AllowanceStatement({ initialMonths }: { initialMonths: string[] }) {
  const [month, setMonth] = useState<string>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const query = useReferralAllowance(month);
  const statement = query.statement;
  const months = query.availableMonths.length ? query.availableMonths : initialMonths;
  const changeMonth = (next: string) => {
    setSelectedId(null);
    setGraphOpen(false);
    setMonth(next);
  };

  if (query.error) return <ErrorState error={query.error} retry={query.retry} />;
  if (query.isLoading) return <LoadingState />;
  if (!query.enabled) return <View style={styles.state}><Text style={styles.title}>수당 조회 권한을 확인해주세요</Text>
    <Text style={styles.body}>현재 계정의 공개 내역을 확인할 수 없습니다.</Text></View>;
  if (!statement) return <View style={styles.state}><Feather name="file-text" size={28} color={COLORS.text.secondary} />
    <Text style={styles.title}>아직 공개된 수당 내역이 없습니다</Text>
    <Text style={styles.body}>월별 명세가 공개되면 이 화면에서 확인할 수 있습니다.</Text>
    <Pressable style={styles.action} onPress={query.retry} accessibilityRole="button"><Text style={styles.actionText}>새로 확인</Text></Pressable>
  </View>;

  return <StatementContent statement={statement} months={months} onChangeMonth={changeMonth}
    selectedId={selectedId} onSelect={setSelectedId} graphOpen={graphOpen} onToggleGraph={() => setGraphOpen((value) => !value)}
    onRefresh={query.retry} />;
}

function StatementContent({ statement, months, onChangeMonth, selectedId, onSelect, graphOpen, onToggleGraph, onRefresh }: {
  statement: ReferralAllowanceStatement; months: string[]; onChangeMonth: (month: string) => void;
  selectedId: string | null; onSelect: (id: string | null) => void;
  graphOpen: boolean; onToggleGraph: () => void; onRefresh: () => void;
}) {
  const rows = useMemo(() => statement.nodes.filter((node) => !node.isBeneficiary), [statement]);
  const selected = useMemo(() => statement.nodes.find((node) => node.id === selectedId), [statement, selectedId]);
  return <><FlatList data={rows} keyExtractor={(node) => node.id} contentContainerStyle={styles.list}
    initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
    ListHeaderComponent={<View style={styles.header}>
      <View style={styles.headingRow}><View><Text style={styles.eyebrow}>당월 신규 산정</Text>
        <Text style={styles.monthTitle}>{formatReferralAllowanceMonth(statement.performanceMonth)}</Text></View>
        <Pressable style={styles.iconButton} onPress={onRefresh} accessibilityRole="button" accessibilityLabel="수당 내역 새로 확인">
          <Feather name="refresh-cw" size={19} color={COLORS.primaryDark} /></Pressable></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.months}>
        {months.map((item) => <Pressable key={item} accessibilityRole="button"
          accessibilityState={{ selected: item === statement.performanceMonth }}
          style={[styles.month, item === statement.performanceMonth && styles.monthSelected]} onPress={() => onChangeMonth(item)}>
          <Text style={[styles.monthText, item === statement.performanceMonth && styles.monthSelectedText]}>{formatReferralAllowanceMonth(item)}</Text>
        </Pressable>)}
      </ScrollView>
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
      <Pressable style={styles.graphButton} onPress={onToggleGraph} accessibilityRole="button"
        accessibilityState={{ expanded: graphOpen }}><Feather name="git-branch" size={19} color={COLORS.primaryDark} />
        <Text style={styles.graphButtonText}>{graphOpen ? '기여 관계 그래프 닫기' : '기여 관계 그래프 보기'}</Text>
        <Feather name={graphOpen ? 'chevron-up' : 'chevron-down'} size={17} color={COLORS.text.secondary} /></Pressable>
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
    </Pressable>} />
    {graphOpen ? <Modal visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onToggleGraph}>
      {/* Android Modals need their own native gesture root and window insets. */}
      <GestureHandlerRootView style={styles.modalRoot}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.graphModal}>
            <View style={styles.headingRow}><Text style={styles.title}>기여 관계 그래프</Text>
              <Pressable onPress={onToggleGraph} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="기여 관계 그래프 닫기">
                <Feather name="x" size={20} color={COLORS.text.secondary} /></Pressable></View>
            <AllowanceGraph statement={statement} selectedId={selectedId} onSelect={onSelect} />
          </SafeAreaView>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal> : null}
    <Modal visible={Boolean(selected)} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => onSelect(null)}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => onSelect(null)} accessibilityRole="button" accessibilityLabel="FP 상세 닫기" />
          <View style={styles.modalSheet} accessibilityViewIsModal>
            <ScrollView>{selected ? <AllowanceDetail node={selected} onClose={() => onSelect(null)} /> : null}</ScrollView>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal></>;
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

function AllowanceGraph({ statement, selectedId, onSelect }: {
  statement: ReferralAllowanceStatement; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const graph = useMemo(() => buildReferralAllowanceGraph(statement), [statement]);
  const nodeAmounts = useMemo(() => buildReferralAllowanceNodeAmounts(statement), [statement]);
  const amountsByNodeId = useMemo(() => new Map(nodeAmounts.map((amounts) => [amounts.nodeId, amounts])), [nodeAmounts]);
  const nodeById = useMemo(() => new Map(statement.nodes.map((node) => [node.id, node])), [statement]);
  const [fit, setFit] = useState(0);
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
    <View style={styles.graphViewport}><ReferralGraphCanvas nodes={graph.nodes} edges={graph.edges}
      selectedNodeId={selectedId} onSelectNode={selectNode} fitRequestId={fit} resetRequestId={0}
      getNodeAccessibilityLabel={describeNode} nodeAmounts={nodeAmounts} /></View>
    <Text style={styles.graphCaption}>이름 아래 직접: 해당 FP로부터 받는 수당 · 총: 하위 계보 포함. 확대하면 더 많은 금액이 표시됩니다.
      {graph.omittedNodeCount > 0 ? ` 화면 부하를 줄이기 위해 ${graph.omittedNodeCount}명은 그래프에 생략했습니다. 위 금액 합계와 전체 FP 내역에는 모두 포함됩니다.` : ''}</Text>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background.secondary },
  state: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 14 },
  list: { padding: SPACING.md, paddingBottom: 32 },
  header: { gap: 14, paddingBottom: 12 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  eyebrow: { color: COLORS.primaryDark, fontSize: 12, fontWeight: '700', marginBottom: 5 },
  monthTitle: { color: COLORS.text.primary, fontSize: 25, fontWeight: '800' },
  title: { color: COLORS.text.primary, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  body: { color: COLORS.text.secondary, fontSize: 13, lineHeight: 21 },
  meta: { color: COLORS.text.secondary, fontSize: 11, lineHeight: 18 },
  months: { gap: 8 },
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
  iconButton: { width: TOUCH_TARGET.min, height: TOUCH_TARGET.min, alignItems: 'center', justifyContent: 'center' },
  graphButton: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, backgroundColor: COLORS.white, borderRadius: RADIUS.md, paddingHorizontal: 14 },
  graphButtonText: { flex: 1, fontSize: 14, fontWeight: '700', color: COLORS.text.primary },
  graphModal: { flex: 1, backgroundColor: COLORS.background.secondary, padding: SPACING.md, gap: 12 },
  graphCard: { flex: 1, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border.light },
  graphToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 12 },
  graphViewport: { flex: 1, minHeight: 220 },
  graphCaption: { color: COLORS.text.secondary, fontSize: 11, lineHeight: 18, padding: 12 },
  count: { color: COLORS.primaryDark, fontSize: 13, fontWeight: '700' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.white, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border.light, padding: 14, marginBottom: 8, minHeight: 66 },
  personRowSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryPale },
  personIdentity: { flex: 1, minWidth: 0, gap: 4 },
  personName: { color: COLORS.text.primary, fontSize: 14, fontWeight: '700' },
  personAmount: { color: COLORS.text.primary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 1 },
  detail: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.primary, borderRadius: RADIUS.lg, padding: 16, gap: 13 },
  modalRoot: { flex: 1 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: COLORS.background.overlay, padding: SPACING.md },
  modalSheet: { maxHeight: '85%', borderRadius: RADIUS.lg, overflow: 'hidden' },
});
