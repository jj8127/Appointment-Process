import { Feather } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/BottomNavigation';
import { useAppLogout } from '@/hooks/use-app-logout';
import { useBottomNavAnimation } from '@/hooks/use-bottom-nav-animation';
import { useMyReferralCode } from '@/hooks/use-my-referral-code';
import { useSession } from '@/hooks/use-session';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { PLATFORM_WITHDRAWAL_VERSION, platformRequest, type PlatformWithdrawal } from '@/lib/platform-api';
import { buildReferralShareText } from '@/lib/referral-share';
import { getAccountRoleLabel } from '@/lib/staff-identity';
import { supabase } from '@/lib/supabase';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';
import { copyTextWithFeedback } from '@/lib/messenger-copy-actions';
import { resetTo } from '@/lib/back-navigation';

const APP_STORE_URL = (process.env.EXPO_PUBLIC_APP_STORE_URL ?? '').trim();
const INVITE_BASE_URL = process.env.EXPO_PUBLIC_INVITE_BASE_URL ?? '';

export default function SettingsScreen() {
  const { surface } = useLocalSearchParams<{ surface?: string }>();
  const { role, residentId, displayName, isRequestBoardDesigner, readOnly, hydrated, staffType, appSessionToken,
    platformMember, platformSessionToken, loginPlatformMember } = useSession();
  // An FC linked to a 모두온 member leaves only 가람in; an unlinked FC account is deleted as before.
  const garaminOnly = Boolean(platformMember);
  const withdrawalKey = useRef<string | null>(null);
  const deleteTitle = garaminOnly ? '가람in 탈퇴' : '계정 삭제';
  const deleteMessage = garaminOnly
    ? '가람in에 입력한 추가 정보와 가람링크 계정을 삭제해요. 모두온 계정과 다른 서비스는 그대로예요.'
    : '계정 로그인과 연결된 프로필은 삭제됩니다. 다른 사람이 작성한 대화와 업무 이력 등 일부 기록은 남을 수 있습니다. 삭제 후에는 이 계정으로 로그인할 수 없습니다.';
  const appLogout = useAppLogout();
  const insets = useSafeAreaInsets();
  const { scrollHandler, animatedStyle } = useBottomNavAnimation();
  const navPreset = resolveBottomNavPreset(
    { role, readOnly, hydrated, isRequestBoardDesigner },
    { surface: surface === 'service-hub' ? 'service-hub' : undefined },
  );
  const navActiveKey = resolveBottomNavActiveKey(
    navPreset,
    navPreset === 'request-board-designer' ? 'request-board' : 'settings',
  );

  const { data: myReferralInfo, isLoading: codeLoading, error: referralCodeError } = useMyReferralCode();
  const myReferralCode = myReferralInfo?.code ?? null;

  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const canViewMyReferralCode =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));
  const canDeleteAccount =
    role === 'fc' && !readOnly && Boolean(residentId) && Boolean(appSessionToken);

  const handleDelete = () => {
    if (!canDeleteAccount) {
      Alert.alert('오류', '로그인 정보를 확인할 수 없습니다.');
      return;
    }
    if (!residentId || !appSessionToken) {
      Alert.alert('오류', '로그인 정보를 확인할 수 없습니다.');
      return;
    }
    setShowDeleteConfirm(true);
  };

  const withdrawGaramin = async () => {
    const token = platformSessionToken ?? appSessionToken;
    if (!token) return;
    const idempotencyKey = withdrawalKey.current ?? (withdrawalKey.current = randomUUID());
    const receipt = await platformRequest<PlatformWithdrawal>('withdraw_member',
      { confirmed: true, scope: 'insurance', policyVersion: PLATFORM_WITHDRAWAL_VERSION, idempotencyKey }, token);
    withdrawalKey.current = null;
    setShowDeleteConfirm(false);
    if (!receipt.memberSession) { appLogout(); return; }
    await loginPlatformMember({ id: receipt.memberSession.memberId, name: receipt.memberSession.displayName }, receipt.memberSession.appSessionToken);
    Alert.alert(receipt.status === 'completed' ? '가람in 탈퇴 완료' : '가람in 탈퇴 처리 중',
      receipt.status === 'completed' ? '모두온 계정은 그대로 이용할 수 있어요.' : '가람링크 정리가 끝나면 자동으로 완료돼요.');
    resetTo(router, '/');
  };

  const confirmDelete = async () => {
    if (!canDeleteAccount || !residentId || !appSessionToken) return;
    setDeleting(true);
    if (garaminOnly) {
      try {
        await withdrawGaramin();
      } catch (err: unknown) {
        Alert.alert('탈퇴 실패', err instanceof Error ? err.message : '가람in 탈퇴를 처리하지 못했습니다. 다시 시도해 주세요.');
      } finally {
        setDeleting(false);
      }
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; deleted?: boolean; error?: string }>('delete-account', {
        body: {
          appSessionToken,
          residentId,
          role: 'fc',
        },
      });
      if (error) throw error;
      if (!data?.ok || !data?.deleted) {
        throw new Error(data?.error ?? '계정 삭제에 실패했습니다. 다시 시도해주세요.');
      }
      Alert.alert('삭제 완료', '계정 삭제가 완료되었습니다. 일부 대화와 업무 이력은 보존될 수 있습니다.');
      appLogout();
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
        message: buildReferralShareText({
          code: myReferralCode,
          inviteBaseUrl: INVITE_BASE_URL,
          appStoreUrl: APP_STORE_URL,
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '추천 코드를 공유하지 못했습니다.';
      Alert.alert('공유 실패', message);
    }
  };

  const handleCopyReferralCode = async () => {
    if (!myReferralCode) return;

    await copyTextWithFeedback(myReferralCode, {
      successMessage: '추천 코드를 복사했습니다.',
      failureMessage: '추천 코드를 복사하지 못했습니다.',
      logScope: 'settings',
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <Animated.ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: 100 + insets.bottom }]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(displayName || 'FC').slice(0, 1)}</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.profileName} numberOfLines={1}>{displayName || 'FC'}</Text>
            <Text style={styles.profileRole}>
              {getAccountRoleLabel({ role, readOnly, isRequestBoardDesigner, staffType })}
            </Text>
          </View>
        </View>

        {canViewMyReferralCode && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>내 추천 코드</Text>
            {!appSessionToken ? (
              <Text style={styles.sectionText}>추천 코드를 확인하려면 다시 로그인해주세요.</Text>
            ) : codeLoading ? (
              <Text style={styles.sectionText}>불러오는 중...</Text>
            ) : referralCodeError ? (
              <Text style={styles.sectionText}>
                {referralCodeError instanceof Error
                  ? referralCodeError.message
                  : '추천 코드를 불러오지 못했습니다.'}
              </Text>
            ) : myReferralCode ? (
              <>
                <Text style={styles.referralCode} selectable>{myReferralCode}</Text>
                <View style={styles.referralActions}>
                  <Pressable
                    style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                    onPress={handleShareReferralCode}
                    accessibilityLabel="추천 코드 공유하기"
                  >
                    <Feather name="share-2" size={16} color={COLORS.white} />
                    <Text style={styles.primaryButtonText}>공유하기</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                    onPress={handleCopyReferralCode}
                    accessibilityLabel="추천 코드 복사하기"
                  >
                    <Feather name="copy" size={16} color={COLORS.primaryButton} />
                    <Text style={styles.secondaryButtonText}>복사하기</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Text style={styles.sectionText}>아직 추천 코드가 발급되지 않았습니다.</Text>
            )}
          </View>
        )}

        <View style={styles.list}>
          <Pressable
            accessibilityHint="앱 푸시와 대화방별 알림을 설정합니다."
            accessibilityLabel="알림 설정 열기"
            accessibilityRole="button"
            onPress={() => router.push('/notification-settings' as never)}
            style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]}
          >
            <View style={styles.listIcon}>
              <Feather name="bell" size={18} color={COLORS.primaryButton} />
            </View>
            <Text style={styles.listTitle}>알림 설정</Text>
            <Feather name="chevron-right" size={20} color={COLORS.gray[400]} />
          </Pressable>
        </View>

        <Text style={styles.groupLabel}>계정</Text>
        <View style={styles.list}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="비밀번호 변경하기"
            onPress={() => router.push('/reset-password')}
            style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]}
          >
            <View style={styles.listIcon}>
              <Feather name="key" size={18} color={COLORS.primaryButton} />
            </View>
            <Text style={styles.listTitle}>비밀번호 변경</Text>
            <Feather name="chevron-right" size={20} color={COLORS.gray[400]} />
          </Pressable>
          <View style={styles.listDivider} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="로그아웃"
            onPress={appLogout}
            style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]}
          >
            <View style={styles.listIcon}>
              <Feather name="log-out" size={18} color={COLORS.primaryButton} />
            </View>
            <Text style={styles.listTitle}>로그아웃</Text>
          </Pressable>
        </View>

        {/* Rarely used and irreversible: kept findable at the very end, away from everyday rows. */}
        {canDeleteAccount ? (
          <Pressable
            style={styles.deleteLink}
            onPress={handleDelete}
            disabled={deleting}
            hitSlop={8}
            testID="settings-delete-account"
            accessibilityRole="button"
            accessibilityLabel={deleteTitle}
          >
            <Text style={styles.deleteLinkText}>{deleting ? '처리 중...' : deleteTitle}</Text>
          </Pressable>
        ) : null}
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
            <Text style={styles.modalTitle}>{deleteTitle}</Text>
            <Text style={styles.modalText}>{deleteMessage}</Text>
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
                <Text style={styles.modalDeleteText}>{deleting ? '처리 중...' : garaminOnly ? '탈퇴' : '삭제'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f3f4f6' },
  container: { padding: SPACING.base, gap: 12 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4, paddingVertical: SPACING.sm },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.primaryPale, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20, fontWeight: '800', color: COLORS.primaryButton },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { fontSize: 20, fontWeight: '800', color: COLORS.gray[900] },
  profileRole: { marginTop: 2, fontSize: 14, color: COLORS.gray[500] },
  card: { backgroundColor: COLORS.white, borderRadius: 24, padding: 20, gap: SPACING.sm },
  cardLabel: { fontSize: 14, fontWeight: '700', color: COLORS.gray[600] },
  referralCode: { fontSize: 26, fontWeight: '800', letterSpacing: 3, color: COLORS.gray[900], paddingVertical: 4 },
  referralActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: 4 },
  primaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: COLORS.primaryButton,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  primaryButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '800' },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: COLORS.primaryPale,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  secondaryButtonText: { color: COLORS.primaryButton, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.85 },
  sectionText: { fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.text.secondary },
  groupLabel: { marginTop: SPACING.sm, marginLeft: 8, fontSize: 13, fontWeight: '700', color: COLORS.gray[500] },
  list: { backgroundColor: COLORS.white, borderRadius: 24, paddingHorizontal: 8, paddingVertical: 4 },
  listRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderRadius: 16 },
  listRowPressed: { backgroundColor: COLORS.gray[50] },
  listIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#fdf3ea', alignItems: 'center', justifyContent: 'center' },
  listTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: COLORS.gray[900] },
  listDivider: { height: StyleSheet.hairlineWidth, marginLeft: 60, marginRight: 12, backgroundColor: COLORS.gray[200] },
  deleteLink: { alignSelf: 'center', marginTop: SPACING.xl, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.base },
  deleteLinkText: { fontSize: 13, color: COLORS.gray[400], textDecorationLine: 'underline' },
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
