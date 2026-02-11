import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/BottomNavigation';
import { useBottomNavAnimation } from '@/hooks/use-bottom-nav-animation';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';

export default function SettingsScreen() {
  const { role, residentId, residentMask, displayName, logout } = useSession();
  const insets = useSafeAreaInsets();
  const { scrollHandler, animatedStyle } = useBottomNavAnimation();

  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = () => {
    if (role !== 'fc') {
      Alert.alert('안내', '관리자 계정은 삭제할 수 없습니다.');
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
        body: { residentId, residentMask },
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
            <Text style={styles.value}>{role === 'admin' ? '관리자' : 'FC'}</Text>
          </View>
        </View>

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

        <Pressable style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>
      </Animated.ScrollView>

      <BottomNavigation
        preset={role === 'admin' ? 'admin-onboarding' : 'fc'}
        activeKey="settings"
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
