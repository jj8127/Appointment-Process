import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#E5E7EB';
const INPUT_BG = '#F9FAFB';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const formatKoreanDate = (d: Date) =>
  `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;

const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function AppointmentScreen() {
  const { role, residentId } = useSession();
  const keyboardPadding = useKeyboardPadding();
  const [appointmentUrl, setAppointmentUrl] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios');

  const load = useCallback(async () => {
    if (!residentId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('fc_profiles')
      .select('appointment_url,appointment_date')
      .eq('phone', residentId)
      .maybeSingle();
    setLoading(false);
    if (error) {
      Alert.alert('불러오기 실패', error.message ?? '정보를 불러오지 못했습니다.');
      return;
    }
    setAppointmentUrl(data?.appointment_url ?? null);
    if (data?.appointment_date) {
      setSelectedDate(new Date(data.appointment_date));
    }
  }, [residentId]);

  useEffect(() => {
    load();
  }, [load]);

  const formattedDate = useMemo(() => formatKoreanDate(selectedDate), [selectedDate]);

  const handleOpenUrl = () => {
    if (!appointmentUrl) {
      Alert.alert('대기 중', '총무가 위촉 URL을 발송하면 안내 드릴게요.');
      return;
    }
    Linking.openURL(appointmentUrl).catch(() =>
      Alert.alert('오류', 'URL을 열 수 없습니다. 주소를 다시 확인해주세요.'),
    );
  };

  const submit = async () => {
    if (!residentId) return;
    if (!appointmentUrl) {
      Alert.alert('대기 중', '위촉 URL 발송 후 완료일을 입력할 수 있습니다.');
      return;
    }
    setSaving(true);
    const ymd = toYMD(selectedDate);
    const { data, error } = await supabase
      .from('fc_profiles')
      .update({ appointment_date: ymd, status: 'final-link-sent' })
      .eq('phone', residentId)
      .select('id,name')
      .maybeSingle();
    setSaving(false);

    if (error || !data) {
      Alert.alert('저장 실패', error?.message ?? '정보를 저장하지 못했습니다.');
      return;
    }

    supabase.functions
      .invoke('fc-notify', {
        body: { type: 'fc_update', fc_id: data.id, message: `${data.name}님이 위촉 절차를 완료했습니다.` },
      })
      .catch(() => {});

    Alert.alert('저장 완료', '위촉 완료일이 저장되었습니다.');
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (role !== 'fc') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={styles.infoText}>FC 계정으로 로그인하면 이용할 수 있습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>모바일 위촉 진행</Text>
          <Text style={styles.subtitle}>총무가 발송한 URL로 접속 후 완료일을 입력해주세요.</Text>
        </View>
        <RefreshButton onPress={load} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <ActivityIndicator color={HANWHA_ORANGE} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>위촉 URL</Text>
              <Text style={styles.sectionDesc}>아래 버튼을 눌러 위촉 절차를 진행하세요.</Text>
              <Pressable
                style={[styles.primaryButton, !appointmentUrl && styles.buttonDisabled]}
                onPress={handleOpenUrl}
                disabled={!appointmentUrl}
              >
                <Text style={styles.primaryButtonText}>
                  {appointmentUrl ? '위촉 페이지 열기' : 'URL 발송 대기 중'}
                </Text>
                <Feather name="external-link" size={18} color="#fff" />
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>위촉 완료일</Text>
              <Text style={styles.sectionDesc}>모든 절차가 끝난 날짜를 선택하고 저장해주세요.</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>완료 날짜</Text>
                {Platform.OS === 'ios' ? (
                  <DateTimePicker
                    value={selectedDate}
                    mode="date"
                    display="default"
                    locale="ko-KR"
                    onChange={(_, d) => d && setSelectedDate(d)}
                    style={{ alignSelf: 'flex-start' }}
                  />
                ) : (
                  <Pressable style={styles.dateInput} onPress={() => setShowPicker(true)}>
                    <Text style={styles.dateText}>{formattedDate}</Text>
                    <Feather name="calendar" size={18} color={MUTED} />
                  </Pressable>
                )}
                {showPicker && Platform.OS === 'android' && (
                  <DateTimePicker
                    value={selectedDate}
                    mode="date"
                    onChange={(_, d) => {
                      setShowPicker(false);
                      if (d) setSelectedDate(d);
                    }}
                  />
                )}
              </View>

              <Pressable
                style={[
                  styles.submitButton,
                  (saving || !appointmentUrl) && styles.buttonDisabled,
                ]}
                onPress={submit}
                disabled={saving || !appointmentUrl}
              >
                <Text style={styles.submitButtonText}>{saving ? '저장 중...' : '완료 저장하기'}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
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
  container: { padding: 24, gap: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: CHARCOAL },
  sectionDesc: { fontSize: 14, color: MUTED },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: HANWHA_ORANGE,
    paddingVertical: 14,
    borderRadius: 10,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: CHARCOAL },
  dateInput: {
    height: 48,
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: { fontSize: 16, color: CHARCOAL },
  submitButton: {
    height: 52,
    backgroundColor: CHARCOAL,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  infoText: { color: MUTED, fontSize: 14 },
});
