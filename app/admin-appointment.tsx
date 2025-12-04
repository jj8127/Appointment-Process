import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#E5E7EB';
const CARD_BG = '#ffffff';

type AppointmentRow = {
  id: string;
  name: string;
  phone: string;
  affiliation: string | null;
  allowance_date: string | null;
  appointment_url: string | null;
  appointment_date: string | null;
  fc_documents?: { doc_type: string; storage_path: string | null; status: string | null }[];
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendNotificationToFc(residentId: string, message: string) {
  await supabase.from('notifications').insert({
    title: '위촉 안내',
    body: message,
    category: 'app_event',
    recipient_role: 'fc',
    resident_id: residentId,
  });

  const { data: tokens } = await supabase
    .from('device_tokens')
    .select('expo_push_token')
    .eq('role', 'fc')
    .eq('resident_id', residentId);

  const payload =
    tokens?.map((t: any) => ({
      to: t.expo_push_token,
      title: '위촉 안내',
      body: message,
      data: { type: 'appointment', resident_id: residentId },
    })) ?? [];

  if (payload.length) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

const fetchTargets = async () => {
  const { data, error } = await supabase
    .from('fc_profiles')
    .select(
      'id,name,phone,affiliation,allowance_date,appointment_url,appointment_date,fc_documents(doc_type,storage_path,status)',
    )
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AppointmentRow[];
};

export default function AdminAppointmentScreen() {
  const { role } = useSession();
  const [urlInputs, setUrlInputs] = useState<Record<string, string>>({});

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin-appointment-targets'],
    queryFn: fetchTargets,
    enabled: role === 'admin',
  });

  const readyList = useMemo(() => {
    if (!data) return [];
    return data.filter((fc) => {
      const docs = fc.fc_documents ?? [];
      const total = docs.length;
      const uploaded = docs.filter((d) => d.storage_path && d.storage_path !== 'deleted').length;
      return total > 0 && uploaded === total && !!fc.allowance_date;
    });
  }, [data]);

  const saveUrl = useMutation({
    mutationFn: async ({ id, url, phone }: { id: string; url: string; phone: string }) => {
      const trimmed = url.trim();
      const { error } = await supabase
        .from('fc_profiles')
        .update({ appointment_url: trimmed, status: 'docs-approved' })
        .eq('id', id);
      if (error) throw error;
      await sendNotificationToFc(phone, '위촉 URL이 등록되었습니다. 모바일 위촉 메뉴에서 진행해주세요.');
    },
    onSuccess: () => {
      Alert.alert('발송 완료', '위촉 URL을 저장하고 알림을 보냈습니다.');
      refetch();
    },
    onError: (err: any) => Alert.alert('오류', err.message ?? 'URL 저장 중 문제가 발생했습니다.'),
  });

  const handleOpenUrl = (url: string | null) => {
    if (!url) {
      Alert.alert('URL 없음', '먼저 URL을 입력하고 저장해주세요.');
      return;
    }
    Linking.openURL(url).catch(() => Alert.alert('열기 실패', 'URL을 열 수 없습니다.'));
  };

  const renderCard = (fc: AppointmentRow) => {
    const docs = fc.fc_documents ?? [];
    const total = docs.length;
    const uploaded = docs.filter((d) => d.storage_path && d.storage_path !== 'deleted').length;
    const value = urlInputs[fc.id] ?? fc.appointment_url ?? '';
    const completed = !!fc.appointment_date;

    return (
      <View key={fc.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.name}>{fc.name || '-'}</Text>
            <Text style={styles.metaText}>
              {fc.phone} · {fc.affiliation || '소속 미정'}
            </Text>
          </View>
          <View style={[styles.badge, completed ? styles.badgeDone : styles.badgePending]}>
            <Text style={completed ? styles.badgeDoneText : styles.badgePendingText}>
              {completed ? `완료 ${fc.appointment_date}` : '진행 중'}
            </Text>
          </View>
        </View>

        <Text style={styles.helperText}>제출 문서 {uploaded}/{total}</Text>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="https://..."
            placeholderTextColor={MUTED}
            value={value}
            onChangeText={(text) => setUrlInputs((prev) => ({ ...prev, [fc.id]: text }))}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[styles.iconButton, (!value || saveUrl.isPending) && styles.iconButtonDisabled]}
            onPress={() => saveUrl.mutate({ id: fc.id, url: value, phone: fc.phone })}
            disabled={!value || saveUrl.isPending}
          >
            {saveUrl.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Feather name="send" size={16} color="#fff" />
            )}
          </Pressable>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={[styles.secondaryButton, !fc.appointment_url && styles.secondaryButtonDisabled]}
            onPress={() => handleOpenUrl(fc.appointment_url)}
            disabled={!fc.appointment_url}
          >
            <Feather name="external-link" size={16} color={CHARCOAL} />
            <Text style={styles.secondaryText}>현재 URL 열기</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  if (role !== 'admin') {
    return (
          <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={[styles.loadingBox, { justifyContent: 'center' }]}>
          <Text style={styles.infoText}>총무 계정만 접근할 수 있습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>위촉 URL 관리</Text>
          <Text style={styles.subtitle}>서류 제출이 끝난 FC에게 위촉 링크를 발송하세요.</Text>
        </View>
        <RefreshButton onPress={refetch} />
      </View>

      {isLoading && !data ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={ORANGE} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {isRefetching && <ActivityIndicator color={ORANGE} style={{ marginBottom: 12 }} />}
          {readyList.length === 0 ? (
            <Text style={styles.infoText}>위촉 URL을 보낼 대상이 없습니다.</Text>
          ) : (
            readyList.map(renderCard)
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  subtitle: { fontSize: 14, color: MUTED, marginTop: 4 },
  list: { padding: 24, gap: 16 },
  loadingBox: { padding: 24, alignItems: 'center' },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  name: { fontSize: 17, fontWeight: '800', color: CHARCOAL },
  metaText: { fontSize: 13, color: MUTED, marginTop: 4 },
  helperText: { fontSize: 12, color: MUTED },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgePending: { backgroundColor: '#FFF7ED' },
  badgePendingText: { color: ORANGE, fontWeight: '700', fontSize: 12 },
  badgeDone: { backgroundColor: '#DCFCE7' },
  badgeDoneText: { color: '#15803d', fontWeight: '700', fontSize: 12 },
  inputRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F9FAFB',
    color: CHARCOAL,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonDisabled: { opacity: 0.5 },
  actions: { flexDirection: 'row', gap: 8 },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#F9FAFB',
  },
  secondaryButtonDisabled: { opacity: 0.5 },
  secondaryText: { color: CHARCOAL, fontWeight: '600' },
  infoText: { textAlign: 'center', color: MUTED },
});
