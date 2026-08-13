import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatSampleRevenueKrw } from '@/lib/referral-revenue-demo';
import { COLORS, RADIUS, SHADOWS, SPACING, TOUCH_TARGET } from '@/lib/theme';
import type { SampleRevenueGraphNode } from '@/types/referral-revenue-graph';

type Props = {
  node: SampleRevenueGraphNode | null;
  onClose: () => void;
};

const DISCLAIMER =
  '샘플 데이터 · 실제 조직, 매출, 정산 내역이 아닙니다. 표시된 하위 구성원의 샘플 매출에 10%를 단순 적용한 화면 예시입니다.';

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export function ReferralRevenueDetailSheet({ node, onClose }: Props) {
  if (!node) return null;

  const isViewer = node.depth === 0;
  const path = node.pathNames.join(' → ');
  const rate = node.eligible ? '10% (샘플)' : '대상 제외';
  const expected = node.eligible
    ? formatSampleRevenueKrw(node.expectedAllocationKrw)
    : '대상 제외';

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="상세 닫기"
      />
      <SafeAreaView style={styles.sheetSafe} edges={['left', 'right', 'bottom']}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{node.name}</Text>
                <View style={styles.simulationBadge}>
                  <Text style={styles.simulationBadgeText}>시뮬레이션</Text>
                </View>
              </View>
              <Text style={styles.affiliation}>{node.affiliation}</Text>
            </View>
            <Pressable
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="매출 기여 상세 닫기"
              hitSlop={8}
            >
              <Feather name="x" size={22} color={COLORS.text.secondary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.depthPill}>
              <Text style={styles.depthPillText}>
                viewer 기준 {node.depth}단계
              </Text>
            </View>
            <Text style={styles.pathLabel}>관계 경로</Text>
            <Text style={styles.path}>{path}</Text>

            {!isViewer ? (
              <View style={styles.detailList}>
                <DetailRow label="샘플 매출" value={formatSampleRevenueKrw(node.salesKrw)} />
                <DetailRow label="샘플 적용률" value={rate} />
                <DetailRow label="예상 배분액" value={expected} />
                <DetailRow
                  label="대상 상태"
                  value={node.eligible ? '1~10단계 대상' : '11단계부터 대상 제외'}
                />
              </View>
            ) : null}

            <View style={styles.notice}>
              <Feather name="info" size={16} color={COLORS.warning.dark} />
              <Text style={styles.noticeText}>{DISCLAIMER}</Text>
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.background.overlay,
  },
  sheetSafe: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '78%',
    paddingTop: 8,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    backgroundColor: COLORS.white,
    ...SHADOWS.xl,
  },
  handle: {
    width: 42,
    height: 4,
    alignSelf: 'center',
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.gray[300],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border.light,
  },
  headerText: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: COLORS.text.primary,
    fontSize: 20,
    fontWeight: '800',
  },
  affiliation: {
    marginTop: 4,
    color: COLORS.text.muted,
    fontSize: 12,
  },
  simulationBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primaryPale,
  },
  simulationBadgeText: {
    color: COLORS.primaryDark,
    fontSize: 10,
    fontWeight: '800',
  },
  closeButton: {
    width: TOUCH_TARGET.min,
    height: TOUCH_TARGET.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.full,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING['2xl'],
  },
  depthPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primaryPale,
  },
  depthPillText: {
    color: COLORS.primaryDark,
    fontSize: 12,
    fontWeight: '800',
  },
  pathLabel: {
    marginTop: SPACING.base,
    color: COLORS.text.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  path: {
    marginTop: 5,
    color: COLORS.text.secondary,
    fontSize: 13,
    lineHeight: 20,
  },
  detailList: {
    marginTop: SPACING.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border.light,
  },
  detailRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border.light,
  },
  detailLabel: {
    flex: 1,
    color: COLORS.text.secondary,
    fontSize: 13,
  },
  detailValue: {
    color: COLORS.text.primary,
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  notice: {
    flexDirection: 'row',
    gap: 9,
    marginTop: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.warning.light,
  },
  noticeText: {
    flex: 1,
    color: COLORS.warning.dark,
    fontSize: 11,
    lineHeight: 17,
  },
});
