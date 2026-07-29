import { Feather } from '@expo/vector-icons';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getReferralGraphNodeColor,
  getReferralGraphNodeStatusLabel,
} from '@/lib/referral-graph-native';
import { COLORS, RADIUS, SHADOWS, SPACING } from '@/lib/theme';
import type { ReferralGraphNode } from '@/types/referral-graph';

type ReferralGraphDetailSheetProps = {
  node: ReferralGraphNode | null;
  onClose: () => void;
};

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export function ReferralGraphDetailSheet({
  node,
  onClose,
}: ReferralGraphDetailSheetProps) {
  return (
    <Modal
      visible={Boolean(node)}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="상세 정보 닫기"
        />
        <SafeAreaView style={styles.sheet} edges={['left', 'right', 'bottom']}>
          {node ? (
            <>
              <View style={styles.handle} />
              <View style={styles.header}>
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: getReferralGraphNodeColor(node) },
                  ]}
                >
                  <Feather name="user" size={20} color="#ffffff" />
                </View>
                <View style={styles.headerText}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>{node.name}</Text>
                    {node.isViewer ? (
                      <View style={styles.viewerBadge}>
                        <Text style={styles.viewerBadgeText}>나</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.affiliation} numberOfLines={1}>
                    {node.affiliation || '소속 미지정'}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [
                    styles.closeButton,
                    pressed && styles.pressed,
                  ]}
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="상세 정보 닫기"
                >
                  <Feather name="x" size={20} color={COLORS.text.secondary} />
                </Pressable>
              </View>

              <View style={styles.statusBanner}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: getReferralGraphNodeColor(node) },
                  ]}
                />
                <Text style={styles.statusText}>
                  {getReferralGraphNodeStatusLabel(node)}
                </Text>
              </View>

              <View style={styles.details}>
                <DetailRow label="활성 추천 코드" value={node.activeCode ?? '없음'} />
                <DetailRow label="직접 추천" value={`${node.directInviteeCount}명`} />
                <DetailRow label="전체 하위" value={`${node.totalDescendantCount}명`} />
                <DetailRow
                  label="추천 코드 상태"
                  value={
                    node.nodeStatus === 'has_active_code'
                      ? '사용 중'
                      : node.nodeStatus === 'code_disabled'
                        ? '비활성'
                        : '미발급'
                  }
                />
              </View>
              <Text style={styles.readOnlyNotice}>
                이 화면은 조회 전용입니다. 추천 관계나 계정 정보는 변경되지 않습니다.
              </Text>
            </>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  sheet: {
    backgroundColor: COLORS.background.primary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: SPACING.lg,
    paddingTop: 10,
    paddingBottom: SPACING.lg,
    ...SHADOWS.xl,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.gray[300],
    marginBottom: SPACING.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    flexShrink: 1,
    color: COLORS.text.primary,
    fontSize: 19,
    fontWeight: '800',
  },
  affiliation: {
    marginTop: 3,
    color: COLORS.text.secondary,
    fontSize: 13,
  },
  viewerBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    backgroundColor: '#fef9c3',
  },
  viewerBadgeText: {
    color: '#854d0e',
    fontSize: 11,
    fontWeight: '800',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray[100],
  },
  pressed: {
    opacity: 0.7,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.gray[50],
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    color: COLORS.text.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  details: {
    marginTop: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  detailRow: {
    minHeight: 46,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border.light,
  },
  detailLabel: {
    color: COLORS.text.secondary,
    fontSize: 13,
  },
  detailValue: {
    flexShrink: 1,
    color: COLORS.text.primary,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  readOnlyNotice: {
    marginTop: SPACING.md,
    color: COLORS.text.muted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
});
