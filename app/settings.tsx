import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/BottomNavigation';
import { useAppLogout } from '@/hooks/use-app-logout';
import { useBottomNavAnimation } from '@/hooks/use-bottom-nav-animation';
import { useMyReferralCode } from '@/hooks/use-my-referral-code';
import { useSession } from '@/hooks/use-session';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { getAccountRoleLabel } from '@/lib/staff-identity';
import { supabase } from '@/lib/supabase';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';

export default function SettingsScreen() {
  const { role, residentId, residentMask, displayName, logout, isRequestBoardDesigner, readOnly, hydrated, staffType, appSessionToken } = useSession();
  const appLogout = useAppLogout();
  const insets = useSafeAreaInsets();
  const { scrollHandler, animatedStyle } = useBottomNavAnimation();
  const navPreset = resolveBottomNavPreset({ role, readOnly, hydrated, isRequestBoardDesigner });
  const navActiveKey = resolveBottomNavActiveKey(
    navPreset,
    isRequestBoardDesigner ? 'request-board' : 'settings',
  );

  const { data: myReferralInfo, isLoading: codeLoading, error: referralCodeError } = useMyReferralCode();
  const myReferralCode = myReferralInfo?.code ?? null;

  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const accountRole: 'fc' | 'admin' | 'manager' = readOnly ? 'manager' : role === 'admin' ? 'admin' : 'fc';
  const canViewMyReferralCode =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
    }
  }, [hydrated, role]);

  const handleDelete = () => {
    if (!role) {
      Alert.alert('오류', '로그인 정보를 확인할 수 없습니다.');
      return;
    }
    if (!residentId) {
      Alert.alert('오류', '로그인 정보를 확인할 수 없습니다.');
      return;
    }
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!residentId) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; deleted?: boolean; error?: string }>('delete-account', {
        body: { residentId, residentMask, role: accountRole },
      });
      if (error) throw error;
      if (!data?.ok || !data?.deleted) {
        throw new Error(data?.error ?? '계정 삭제에 실패했습니다. 다시 시도해주세요.');
      }
      Alert.alert('삭제 완료', '계정과 관련 데이터가 삭제되었습니다.');
      logout();
      router.replace('/login');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '계정 삭제 중 오류가 발생했습니다.';
      Alert.alert('삭제 실패', message);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleShareReferralCode = async () => {
    if (!myReferralCode) return;

    try {
      await Share.share({
        message:
          `가람in 앱 가입 시 추천 코드를 입력해주세요!\n\n` +
          `추천 코드: ${myReferralCode}\n` +
          `앱 열기 링크: hanwhafcpass://signup?code=${myReferralCode}\n\n` +
          `일부 메신저에서는 앱 열기 링크가 바로 동작하지 않을 수 있습니다.\n` +
          `앱이 열리지 않으면 가람in 앱 회원가입 화면에서 추천 코드를 직접 입력해주세요.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '추천 코드를 공유하지 못했습니다.';
      Alert.alert('공유 실패', message);
    }
  };

  const handleCopyReferralCode = async () => {
    if (!myReferralCode) return;

    try {
      await Clipboard.setStringAsync(myReferralCode);
      Alert.alert('복사 완료', '추천 코드가 클립보드에 복사되었습니다.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '추천 코드를 복사하지 못했습니다.';
      Alert.alert('복사 실패', message);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <Animated.ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: 100 + insets.bottom }]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        <View style={styles.card}>
          <Text style={styles.title}>계정</Text>
          <View style={styles.row}>
            <Text style={styles.label}>이름</Text>
            <Text style={styles.value}>{displayName || 'FC'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>역할</Text>
            <Text style={styles.value}>
              {getAccountRoleLabel({ role, readOnly, isRequestBoardDesigner, staffType })}
            </Text>
          </View>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.push('/reset-password')}
            accessibilityLabel="비밀번호 변경하기"
          >
            <Feather name="key" size={16} color={COLORS.primary} />
            <Text style={styles.secondaryButtonText}>비밀번호 변경하기</Text>
          </Pressable>
        </View>

        {canViewMyReferralCode && (
          <View style={styles.card}>
            <Text style={styles.title}>내 추천 코드</Text>
            {!appSessionToken ? (
              <Text style={styles.sectionText}>추천 코드를 확인하려면 다시 로그인해주세요.</Text>
            ) : codeLoading ? (
              <Text style={styles.value}>불러오는 중...</Text>
            ) : referralCodeError ? (
              <Text style={styles.sectionText}>
                {referralCodeError instanceof Error
                  ? referralCodeError.message
                  : '추천 코드를 불러오지 못했습니다.'}
              </Text>
            ) : myReferralCode ? (
              <>
                <Text style={[styles.value, { letterSpacing: 3, fontSize: TYPOGRAPHY.fontSize.xl, textAlign: 'center', paddingVertical: SPACING.sm }]}>
                  {myReferralCode}
                </Text>
                <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                  <Pressable
                    style={[styles.secondaryButton, { flex: 1 }]}
                    onPress={handleShareReferralCode}
                    accessibilityLabel="추천 코드 공유하기"
                  >
                    <Feather name="share-2" size={16} color={COLORS.primary} />
                    <Text style={styles.secondaryButtonText}>공유하기</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.secondaryButton, { flex: 1 }]}
                    onPress={handleCopyReferralCode}
                    accessibilityLabel="추천 코드 복사하기"
                  >
                    <Feather name="copy" size={16} color={COLORS.primary} />
                    <Text style={styles.secondaryButtonText}>복사하기</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Text style={styles.sectionText}>아직 추천 코드가 발급되지 않았습니다.</Text>
            )}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>계정 삭제</Text>
          <Text style={styles.sectionText}>계정을 삭제하면 모든 데이터가 영구적으로 제거됩니다.</Text>
          <Pressable
            style={[styles.deleteButton, deleting && styles.deleteButtonDisabled]}
            onPress={handleDelete}
            disabled={deleting}
            testID="settings-delete-account"
            accessibilityLabel="계정 삭제"
          >
            <Feather name="trash-2" size={16} color={COLORS.white} />
            <Text style={styles.deleteText}>{deleting ? '삭제 중...' : '계정 삭제'}</Text>
          </Pressable>
        </View>

        <Pressable style={styles.logoutButton} onPress={appLogout}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>
      </Animated.ScrollView>

      <BottomNavigation
        preset={navPreset ?? undefined}
        activeKey={navActiveKey}
        animatedStyle={animatedStyle}
        bottomInset={insets.bottom}
      />

      <Modal visible={showDeleteConfirm} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>계정 삭제</Text>
            <Text style={styles.modalText}>계정을 삭제하면 모든 데이터가 영구적으로 제거됩니다.</Text>
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalCancel]}
                onPress={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                <Text style={styles.modalCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalDelete, deleting && styles.modalDeleteDisabled]}
                onPress={confirmDelete}
                disabled={deleting}
              >
                <Text style={styles.modalDeleteText}>{deleting ? '삭제 중...' : '삭제'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  container: { padding: SPACING.lg, gap: SPACING.base },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    padding: SPACING.base,
    gap: SPACING.sm,
  },
  title: { fontSize: TYPOGRAPHY.fontSize.lg, fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.text.secondary },
  value: { fontSize: TYPOGRAPHY.fontSize.sm, fontWeight: TYPOGRAPHY.fontWeight.bold, color: COLORS.text.primary },
  sectionTitle: { fontSize: TYPOGRAPHY.fontSize.md, fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary },
  sectionText: { fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.text.secondary },
  deleteButton: {
    marginTop: 6,
    backgroundColor: COLORS.error,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.base,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  deleteButtonDisabled: { opacity: 0.7 },
  deleteText: { color: COLORS.white, fontWeight: TYPOGRAPHY.fontWeight.bold },
  secondaryButton: {
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.base,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primaryPale,
  },
  secondaryButtonText: {
    color: COLORS.primary,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
  logoutButton: {
    marginTop: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.base,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    alignItems: 'center',
  },
  logoutText: { fontWeight: TYPOGRAPHY.fontWeight.bold, color: COLORS.text.secondary },
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.background.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  modalTitle: { fontSize: TYPOGRAPHY.fontSize.lg, fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary },
  modalText: { fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.text.secondary, lineHeight: 18 },
  modalButtons: { flexDirection: 'row', gap: SPACING.sm, marginTop: 4 },
  modalButton: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.base,
    alignItems: 'center',
  },
  modalCancel: { backgroundColor: COLORS.gray[100] },
  modalDelete: { backgroundColor: COLORS.error },
  modalDeleteDisabled: { opacity: 0.7 },
  modalCancelText: { fontWeight: TYPOGRAPHY.fontWeight.bold, color: COLORS.gray[600] },
  modalDeleteText: { fontWeight: TYPOGRAPHY.fontWeight.bold, color: COLORS.white },
});
