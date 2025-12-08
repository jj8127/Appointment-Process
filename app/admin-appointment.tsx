import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  appointment_schedule_life: string | null;
  appointment_schedule_nonlife: string | null;
  appointment_date_life: string | null;
  appointment_date_nonlife: string | null;
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
      'id,name,phone,affiliation,allowance_date,appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life,appointment_date_nonlife,fc_documents(doc_type,storage_path,status)',
    )
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AppointmentRow[];
};

export default function AdminAppointmentScreen() {
  const { role } = useSession();
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, { life?: string; nonlife?: string }>>({});

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

  const saveSchedule = useMutation({
    mutationFn: async ({
      id,
      life,
      nonlife,
      phone,
    }: { id: string; life: string; nonlife: string; phone: string }) => {
      const { error } = await supabase
        .from('fc_profiles')
        .update({
          appointment_schedule_life: life || null,
          appointment_schedule_nonlife: nonlife || null,
          status: 'docs-approved',
        })
        .eq('id', id);
      if (error) throw error;
      if (life || nonlife) {
        await sendNotificationToFc(
          phone,
          `위촉 일정이 업데이트되었습니다. 생명 ${life || '-'}월 / 손해 ${nonlife || '-'}월 진행 예정입니다.`,
        );
      }
    },
    onSuccess: () => {
      Alert.alert('저장 완료', '위촉 일정을 저장했습니다.');
      refetch();
    },
    onError: (err: any) => Alert.alert('오류', err.message ?? '저장 중 문제가 발생했습니다.'),
  });

  const handleInputChange = (id: string, key: 'life' | 'nonlife', value: string) => {
    setScheduleInputs((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [key]: value,
      },
    }));
  };

  const renderCard = (fc: AppointmentRow) => {
    const docs = fc.fc_documents ?? [];
    const total = docs.length;
    const uploaded = docs.filter((d) => d.storage_path && d.storage_path !== 'deleted').length;
    const valueLife = scheduleInputs[fc.id]?.life ?? fc.appointment_schedule_life ?? '';
    const valueNonLife = scheduleInputs[fc.id]?.nonlife ?? fc.appointment_schedule_nonlife ?? '';
    const completedLife = !!fc.appointment_date_life;
    const completedNonLife = !!fc.appointment_date_nonlife;

    return (
      <View key={fc.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.name}>{fc.name || '-'}</Text>
            <Text style={styles.metaText}>
              {fc.phone} · {fc.affiliation || '소속 미정'}
            </Text>
          </View>
          <View style={[styles.badge, completedLife && completedNonLife ? styles.badgeDone : styles.badgePending]}>
            <Text style={completedLife && completedNonLife ? styles.badgeDoneText : styles.badgePendingText}>
              {completedLife && completedNonLife ? '생명/손해 완료' : '진행 중'}
            </Text>
          </View>
        </View>

        <Text style={styles.helperText}>제출 문서 {uploaded}/{total}</Text>

        <View style={styles.inputRow}>
          <View style={[styles.badgeSmall, styles.badgeLife]}>
            <Text style={[styles.badgeSmallText, { color: ORANGE }]}>생명</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="예) 3"
            placeholderTextColor={MUTED}
            keyboardType="numeric"
            value={valueLife}
            onChangeText={(text) => handleInputChange(fc.id, 'life', text)}
          />
          <Text style={styles.suffix}>월</Text>
          {completedLife && <Text style={styles.doneText}>완료일 {fc.appointment_date_life}</Text>}
        </View>

        <View style={styles.inputRow}>
          <View style={[styles.badgeSmall, styles.badgeNonLife]}>
            <Text style={[styles.badgeSmallText, { color: '#2563eb' }]}>손해</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="예) 4"
            placeholderTextColor={MUTED}
            keyboardType="numeric"
            value={valueNonLife}
            onChangeText={(text) => handleInputChange(fc.id, 'nonlife', text)}
          />
          <Text style={styles.suffix}>월</Text>
          {completedNonLife && <Text style={styles.doneText}>완료일 {fc.appointment_date_nonlife}</Text>}
        </View>

        <Pressable
          style={[styles.saveButton, saveSchedule.isPending && styles.saveButtonDisabled]}
          onPress={() => saveSchedule.mutate({ id: fc.id, life: valueLife, nonlife: valueNonLife, phone: fc.phone })}
          disabled={saveSchedule.isPending}
        >
          {saveSchedule.isPending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.saveButtonText}>일정 저장 및 알림</Text>
          )}
        </Pressable>
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
          <Text style={styles.title}>위촉 일정 관리</Text>
          <Text style={styles.subtitle}>FC별 생명/손해 위촉 진행 월을 설정하세요.</Text>
        </View>
        <RefreshButton onPress={() => {refetch()}} />
      </View>

      {isLoading && !data ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={ORANGE} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {isRefetching && <ActivityIndicator color={ORANGE} style={{ marginBottom: 12 }} />}
          {readyList.length === 0 ? (
            <Text style={styles.infoText}>대상자가 없습니다.</Text>
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
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  badgeSmall: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeSmallText: { fontSize: 12, fontWeight: '700' },
  badgeLife: { backgroundColor: '#fff7ed' },
  badgeNonLife: { backgroundColor: '#eff6ff' },
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
  suffix: { fontSize: 14, color: CHARCOAL },
  doneText: { fontSize: 12, color: '#15803d', fontWeight: '600' },
  saveButton: {
    marginTop: 6,
    backgroundColor: ORANGE,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#fff', fontWeight: '700' },
  infoText: { textAlign: 'center', color: MUTED },
});
