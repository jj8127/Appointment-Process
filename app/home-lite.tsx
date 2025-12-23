import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { useIdentityStatus } from '@/hooks/use-identity-status';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const ORANGE_FAINT = '#fff1e6';

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
            <Feather name="settings" size={18} color={CHARCOAL} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => router.push('/notifications')}>
            <Feather name="bell" size={18} color={CHARCOAL} />
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
                <Feather name="message-circle" size={18} color={HANWHA_ORANGE} />
              </View>
              <Text style={styles.linkTitle}>1:1 문의</Text>
              <Text style={styles.linkText}>총무팀에게 문의하세요.</Text>
            </Pressable>
            <Pressable style={styles.linkCard} onPress={() => router.push('/notice')}>
              <View style={styles.linkIcon}>
                <Feather name="clipboard" size={18} color={HANWHA_ORANGE} />
              </View>
              <Text style={styles.linkTitle}>공지/안내</Text>
              <Text style={styles.linkText}>공지와 안내를 확인하세요.</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>위촉 절차</Text>
          <View style={styles.lockedNotice}>
            <Feather name="lock" size={16} color={HANWHA_ORANGE} />
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
  safe: { flex: 1, backgroundColor: '#fff' },
  topBar: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  topTitle: { fontSize: 20, fontWeight: '800', color: CHARCOAL },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  logoutButton: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  logoutText: { fontSize: 13, fontWeight: '700', color: TEXT_MUTED },
  container: { padding: 20, gap: 20, paddingBottom: 40 },
  heroCard: {
    backgroundColor: ORANGE_FAINT,
    borderRadius: 20,
    padding: 20,
    gap: 10,
  },
  heroEyebrow: { color: HANWHA_ORANGE, fontWeight: '700', fontSize: 13 },
  heroTitle: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  heroText: { fontSize: 15, color: TEXT_MUTED, lineHeight: 22 },
  primaryButton: {
    backgroundColor: HANWHA_ORANGE,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  section: { gap: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: CHARCOAL },
  linkGrid: { flexDirection: 'row', gap: 12 },
  linkCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    backgroundColor: '#fff',
    gap: 8,
  },
  linkIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: ORANGE_FAINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkTitle: { fontWeight: '700', fontSize: 15, color: CHARCOAL },
  linkText: { fontSize: 13, color: TEXT_MUTED },
  lockedNotice: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  lockedNoticeText: { flex: 1, fontSize: 13, color: '#9A3412', fontWeight: '600' },
  lockedList: { gap: 10 },
  lockedItem: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#fff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lockedLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lockedLabel: { fontSize: 15, fontWeight: '700', color: CHARCOAL },
  lockedHint: { fontSize: 12, color: TEXT_MUTED },
});
