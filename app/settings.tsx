import { Feather } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const ALERTS_CHANNEL_ID = 'alerts';

export default function SettingsScreen() {
  const { role, residentId, displayName, logout } = useSession();
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [checkingChannels, setCheckingChannels] = useState(false);

  const handleCheckChannels = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert('안내', '안드로이드에서만 확인할 수 있습니다.');
      return;
    }
    setCheckingChannels(true);
    try {
      const channels = await Notifications.getNotificationChannelsAsync();
      const alertsChannel = channels.find((channel) => channel.id === ALERTS_CHANNEL_ID);
      console.log('[notifications] channels', channels);
      if (!alertsChannel) {
        Alert.alert('채널 없음', `"${ALERTS_CHANNEL_ID}" 채널이 아직 생성되지 않았습니다.`);
        return;
      }
      Alert.alert(
        '채널 상태',
        [
          `id: ${alertsChannel.id}`,
          `name: ${alertsChannel.name ?? ''}`,
          `importance: ${alertsChannel.importance ?? ''}`,
          `sound: ${alertsChannel.sound ?? ''}`,
          `vibration: ${alertsChannel.enableVibrate ? 'on' : 'off'}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (err: any) {
      Alert.alert('확인 실패', err?.message ?? '채널 조회 중 오류가 발생했습니다.');
    } finally {
      setCheckingChannels(false);
    }
  };

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
      const { error } = await supabase.functions.invoke('delete-account', {
        body: { residentId },
      });
      if (error) throw error;
      Alert.alert('삭제 완료', '계정과 관련 데이터가 삭제되었습니다.');
      logout();
      router.replace('/login');
    } catch (err: any) {
      Alert.alert('삭제 실패', err?.message ?? '계정 삭제 중 오류가 발생했습니다.');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.container}>
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
            <Feather name="trash-2" size={16} color="#fff" />
            <Text style={styles.deleteText}>{deleting ? '삭제 중...' : '계정 삭제'}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>알림 채널</Text>
          <Text style={styles.sectionText}>알림 채널(중요 알림) 상태를 확인합니다.</Text>
          <Pressable
            style={[styles.secondaryButton, checkingChannels && styles.secondaryButtonDisabled]}
            onPress={handleCheckChannels}
            disabled={checkingChannels}
            accessibilityLabel="알림 채널 상태 확인"
          >
            <Feather name="bell" size={16} color={CHARCOAL} />
            <Text style={styles.secondaryText}>{checkingChannels ? '확인 중...' : '채널 상태 확인'}</Text>
          </Pressable>
        </View>

        <Pressable style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>
      </View>

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
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 20, gap: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: '800', color: CHARCOAL },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 14, color: TEXT_MUTED },
  value: { fontSize: 14, fontWeight: '700', color: CHARCOAL },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: CHARCOAL },
  sectionText: { fontSize: 13, color: TEXT_MUTED },
  deleteButton: {
    marginTop: 6,
    backgroundColor: '#ef4444',
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  deleteButtonDisabled: { opacity: 0.7 },
  deleteText: { color: '#fff', fontWeight: '700' },
  secondaryButton: {
    marginTop: 6,
    backgroundColor: '#F9FAFB',
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  secondaryButtonDisabled: { opacity: 0.7 },
  secondaryText: { color: CHARCOAL, fontWeight: '700' },
  logoutButton: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  logoutText: { fontWeight: '700', color: TEXT_MUTED },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: CHARCOAL },
  modalText: { fontSize: 13, color: TEXT_MUTED, lineHeight: 18 },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 4 },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCancel: { backgroundColor: '#F3F4F6' },
  modalDelete: { backgroundColor: '#ef4444' },
  modalDeleteDisabled: { opacity: 0.7 },
  modalCancelText: { fontWeight: '700', color: '#4B5563' },
  modalDeleteText: { fontWeight: '700', color: '#fff' },
});
