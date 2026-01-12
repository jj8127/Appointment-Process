import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { useIdentityStatus } from '@/hooks/use-identity-status';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';

type LockedItem = {
  label: string;
  hint: string;
  route?: string;
};

const LOCKED_ITEMS: LockedItem[] = [
  { label: '임시사번 발급 요청', hint: '신원 정보 입력 후 진행' },
  { label: '수당 동의', hint: '위촉 절차 시작 후 이용 가능' },
  { label: '서류 업로드', hint: '위촉 절차 시작 후 이용 가능' },
  { label: '시험 신청', hint: '위촉 절차 시작 후 이용 가능' },
];

export default function HomeLiteScreen() {
  const { role, hydrated, logout, displayName } = useSession();
  const { data, isLoading } = useIdentityStatus();

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
      return;
    }
    if (role === 'admin') {
      router.replace('/');
      return;
    }
    if (!isLoading && data?.identityCompleted) {
      router.replace('/');
    }
  }, [data?.identityCompleted, hydrated, isLoading, role]);

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>FC 홈</Text>
        <View style={styles.topActions}>
          <Pressable style={styles.iconButton} onPress={() => router.push('/settings')}>
            <Feather name="settings" size={18} color={COLORS.text.primary} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => router.push('/notifications')}>
            <Feather name="bell" size={18} color={COLORS.text.primary} />
          </Pressable>
          <Pressable style={styles.logoutButton} onPress={logout}>
            <Text style={styles.logoutText}>로그아웃</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>둘러보기 모드</Text>
          <Text style={styles.heroTitle}>
            {displayName?.trim() ? `${displayName}님, 반갑습니다!` : '환영합니다!'}
          </Text>
          <Text style={styles.heroText}>
            위촉 절차 진행을 위해 추가 정보 입력이 필요합니다(주민번호/주소).
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => router.push('/apply-gate')}
            testID="home-lite-apply-start"
            accessibilityLabel="등록 신청 시작"
          >
            <Text style={styles.primaryButtonText}>등록 신청 시작</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>바로가기</Text>
          <View style={styles.linkGrid}>
            <Pressable style={styles.linkCard} onPress={() => router.push('/chat')}>
              <View style={styles.linkIcon}>
                <Feather name="message-circle" size={18} color={COLORS.primary} />
              </View>
              <Text style={styles.linkTitle}>1:1 문의</Text>
              <Text style={styles.linkText}>총무팀에게 문의하세요.</Text>
            </Pressable>
            <Pressable style={styles.linkCard} onPress={() => router.push('/notice')}>
              <View style={styles.linkIcon}>
                <Feather name="clipboard" size={18} color={COLORS.primary} />
              </View>
              <Text style={styles.linkTitle}>공지/안내</Text>
              <Text style={styles.linkText}>공지와 안내를 확인하세요.</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>위촉 절차</Text>
          <View style={styles.lockedNotice}>
            <Feather name="lock" size={16} color={COLORS.primary} />
            <Text style={styles.lockedNoticeText}>
              위촉 절차는 신원 정보 입력 이후에 사용할 수 있습니다.
            </Text>
          </View>
          <View style={styles.lockedList}>
            {LOCKED_ITEMS.map((item) => (
              <View key={item.label} style={styles.lockedItem}>
                <View style={styles.lockedLeft}>
                  <Feather name="lock" size={16} color="#9CA3AF" />
                  <Text style={styles.lockedLabel}>{item.label}</Text>
                </View>
                <Text style={styles.lockedHint}>{item.hint}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  topBar: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray[100],
  },
  topTitle: { fontSize: TYPOGRAPHY.fontSize.xl, fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
  },
  logoutButton: {
    backgroundColor: COLORS.gray[100],
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
  },
  logoutText: { fontSize: TYPOGRAPHY.fontSize.xs, fontWeight: TYPOGRAPHY.fontWeight.bold, color: COLORS.text.secondary },
  container: { padding: SPACING.lg, gap: SPACING.lg, paddingBottom: SPACING['2xl'] },
  heroCard: {
    backgroundColor: COLORS.primaryPale,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  heroEyebrow: { color: COLORS.primary, fontWeight: TYPOGRAPHY.fontWeight.bold, fontSize: TYPOGRAPHY.fontSize.xs },
  heroTitle: { fontSize: TYPOGRAPHY.fontSize['2xl'], fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary },
  heroText: { fontSize: TYPOGRAPHY.fontSize.base, color: COLORS.text.secondary, lineHeight: TYPOGRAPHY.lineHeight.relaxed * TYPOGRAPHY.fontSize.base },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryButtonText: { color: COLORS.white, fontWeight: TYPOGRAPHY.fontWeight.extrabold, fontSize: TYPOGRAPHY.fontSize.lg },
  section: { gap: SPACING.sm },
  sectionTitle: { fontSize: TYPOGRAPHY.fontSize.lg, fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary },
  linkGrid: { flexDirection: 'row', gap: SPACING.sm },
  linkCard: {
    flex: 1,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    padding: SPACING.base,
    backgroundColor: COLORS.white,
    gap: SPACING.sm,
  },
  linkIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkTitle: { fontWeight: TYPOGRAPHY.fontWeight.bold, fontSize: TYPOGRAPHY.fontSize.base, color: COLORS.text.primary },
  linkText: { fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.text.secondary },
  lockedNotice: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
    backgroundColor: COLORS.warning.light,
    padding: SPACING.sm,
    borderRadius: RADIUS.base,
    borderWidth: 1,
    borderColor: COLORS.warning.border,
  },
  lockedNoticeText: { flex: 1, fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.warning.dark, fontWeight: TYPOGRAPHY.fontWeight.semibold },
  lockedList: { gap: SPACING.sm },
  lockedItem: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    backgroundColor: COLORS.white,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lockedLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  lockedLabel: { fontSize: TYPOGRAPHY.fontSize.base, fontWeight: TYPOGRAPHY.fontWeight.bold, color: COLORS.text.primary },
  lockedHint: { fontSize: TYPOGRAPHY.fontSize['2xs'], color: COLORS.text.secondary },
});
