import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Alert, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { useAppLogout } from '@/hooks/use-app-logout';
import { useIdentityStatus } from '@/hooks/use-identity-status';
import { openExternalUrl } from '@/lib/open-external-url';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';

const YOUTUBE_URL = 'https://youtube.com/playlist?list=PLF5rd5c2rE9xy-VsAdwq4NEUsJQtKD7Qd&si=vKx4TDq6ww9ZgKiT';
const HOME_CTA_ORANGE = COLORS.primary || '#f36f21';
const HOME_CTA_ORANGE_PALE = COLORS.primaryPale || '#fff1e6';

type LockedItem = {
  label: string;
  hint: string;
  route?: string;
};

const LOCKED_ITEMS: LockedItem[] = [
  { label: '임시사번 발급 요청', hint: '주민번호/주소 입력 후 이용 가능' },
  { label: '보증 보험 동의', hint: '주민번호/주소 입력 후 이용 가능' },
  { label: '서류 업로드', hint: '주민번호/주소 입력 후 이용 가능' },
  { label: '시험 신청', hint: '주민번호/주소 입력 후 이용 가능' },
  { label: '설계 요청', hint: '주민번호/주소 입력 후 이용 가능' },
];

export default function HomeLiteScreen() {
  const { role, hydrated, displayName, isRequestBoardDesigner } = useSession();
  const appLogout = useAppLogout();
  const { data, isLoading } = useIdentityStatus();
  const openYoutubeGuide = useCallback(async () => {
    try {
      await openExternalUrl(YOUTUBE_URL);
    } catch {
      Alert.alert('오류', '가이드 영상을 열 수 없습니다.');
    }
  }, []);

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
    if (isRequestBoardDesigner) {
      router.replace('/request-board');
      return;
    }
    if (!isLoading && data?.identityCompleted) {
      router.replace('/');
    }
  }, [data?.identityCompleted, hydrated, isLoading, isRequestBoardDesigner, role]);

  // Android 뒤로가기 버튼: 앱 종료 확인 다이얼로그
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const onBackPress = () => {
        Alert.alert(
          '앱 종료',
          '앱을 종료하시겠습니까?',
          [
            { text: '취소', style: 'cancel' },
            { text: '종료', style: 'destructive', onPress: () => BackHandler.exitApp() },
          ],
          { cancelable: true }
        );
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [])
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>임시 홈</Text>
        <View style={styles.topActions}>
          <Pressable style={styles.iconButton} onPress={() => router.push('/settings')}>
            <Feather name="settings" size={18} color={COLORS.text.primary} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => router.push('/notifications')}>
            <Feather name="bell" size={18} color={COLORS.text.primary} />
          </Pressable>
          <Pressable style={styles.logoutButton} onPress={appLogout}>
            <Text style={styles.logoutText}>로그아웃</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>둘러보기 모드</Text>
          <Text style={styles.heroTitle}>
            {displayName?.trim() ? `${displayName}님, 반갑습니다!` : '환영합니다.!'}
          </Text>
          <Text style={styles.heroText}>
            앱의 모든 기능을 사용하기 위해서는 추가 정보 입력이 필요합니다. 먼저 주민번호와 주소를 입력해 주세요.
          </Text>
          <View style={styles.heroActions}>
            <Pressable
              style={styles.primaryButton}
              onPress={() => router.push('/apply-gate')}
              testID="home-lite-apply-start"
              accessibilityLabel="필수 정보 입력 시작"
            >
              <Text style={styles.primaryButtonText}>필수 정보 입력 시작</Text>
            </Pressable>
            <Pressable
              style={styles.youtubeButton}
              onPress={openYoutubeGuide}
              accessibilityRole="button"
              accessibilityLabel="유튜브 가이드 영상 보기"
            >
              <View style={styles.youtubeIcon}>
                <Feather name="youtube" size={20} color="#DC2626" />
              </View>
              <View style={styles.youtubeTextWrap}>
                <Text style={styles.youtubeTitle}>유튜브 영상 가이드 보기</Text>
                <Text style={styles.youtubeText}>기본 입력 전 앱 사용법을 영상으로 확인하세요.</Text>
              </View>
              <Feather name="external-link" size={16} color="#DC2626" />
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>지금 가능한 메뉴</Text>
          <View style={styles.linkGrid}>
            <Pressable style={styles.linkCard} onPress={() => router.push('/messenger')}>
              <View style={styles.linkIcon}>
                <Feather name="message-circle" size={18} color={COLORS.primary} />
              </View>
              <Text style={styles.linkTitle}>메신저</Text>
              <Text style={styles.linkText}>가람지사/설계요청 대화를 한 곳에서 선택합니다.</Text>
            </Pressable>
            <Pressable style={styles.linkCard} onPress={() => router.push('/notice')}>
              <View style={styles.linkIcon}>
                <Feather name="clipboard" size={18} color={COLORS.primary} />
              </View>
              <Text style={styles.linkTitle}>공지사항</Text>
              <Text style={styles.linkText}>업무 공지와 운영 안내를 확인하세요.</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>업무 준비 상태</Text>
          <View style={styles.lockedNotice}>
            <Feather name="lock" size={16} color={COLORS.primary} />
            <Text style={styles.lockedNoticeText}>
              핵심 업무 기능은 주민번호/주소 입력 후 사용할 수 있습니다.
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
    backgroundColor: HOME_CTA_ORANGE_PALE,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  heroEyebrow: { color: HOME_CTA_ORANGE, fontWeight: TYPOGRAPHY.fontWeight.bold, fontSize: TYPOGRAPHY.fontSize.xs },
  heroTitle: { fontSize: TYPOGRAPHY.fontSize['2xl'], fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary },
  heroText: { fontSize: TYPOGRAPHY.fontSize.base, color: COLORS.text.secondary, lineHeight: TYPOGRAPHY.lineHeight.relaxed * TYPOGRAPHY.fontSize.base },
  heroActions: { gap: SPACING.sm, marginTop: 6 },
  primaryButton: {
    backgroundColor: HOME_CTA_ORANGE,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: COLORS.white, fontWeight: TYPOGRAPHY.fontWeight.extrabold, fontSize: TYPOGRAPHY.fontSize.lg },
  youtubeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  youtubeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  youtubeTextWrap: { flex: 1 },
  youtubeTitle: { fontSize: TYPOGRAPHY.fontSize.sm, fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: '#991B1B' },
  youtubeText: { fontSize: TYPOGRAPHY.fontSize.xs, fontWeight: TYPOGRAPHY.fontWeight.semibold, color: '#B91C1C' },
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
