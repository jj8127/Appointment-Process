import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';

import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const formatKoreanDate = (d: Date) => {
  const dow = weekdays[d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${dow})`;
};

const toYMD = (d: Date) => {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function AllowanceConsentScreen() {
  const { residentId } = useSession();
  const [tempId, setTempId] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const keyboardPadding = useKeyboardPadding();
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios');

  useEffect(() => {
    const loadTemp = async () => {
      if (!residentId) return;
        const { data, error } = await supabase
          .from('fc_profiles')
          .select('temp_id,allowance_date')
          .eq('phone', residentId)
          .maybeSingle();
      if (!error && data?.temp_id) setTempId(data.temp_id);
      if (!error && data?.allowance_date) setSelectedDate(new Date(data.allowance_date));
    };
    loadTemp();
  }, [residentId]);

  const ymd = useMemo(() => toYMD(selectedDate), [selectedDate]);

  const submit = async () => {
    if (!tempId || !ymd) {
      Alert.alert('입력 필요', '임시사번과 수당동의일을 모두 입력하세요.');
      return;
    }
    setLoading(true);
    const { error, data } = await supabase
      .from('fc_profiles')
      .update({ allowance_date: ymd, status: 'allowance-consented' })
      .eq('temp_id', tempId)
      .select('id,name')
      .single();
    setLoading(false);

    if (error) {
      Alert.alert('저장 실패', error.message);
      return;
    }
    if (!data) {
      Alert.alert('임시사번 없음', '해당 임시사번을 찾을 수 없습니다.');
      return;
    }
    supabase.functions
      .invoke('fc-notify', {
        body: { type: 'fc_update', fc_id: data.id, message: `${data.name || 'FC'}���� ���絿������ �Է��߽��ϴ�.` },
      })
      .catch(() => {});

    Alert.alert('저장 완료', '수당동의일이 저장되었습니다.');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 96 }]}
          keyboardShouldPersistTaps="handled">
          <RefreshButton />
          <Text style={styles.title}>수당동의 날짜 입력</Text>
          <Text style={styles.caption}>총무에게 받은 임시사번과 수당동의 완료일을 입력하세요.</Text>

          <View style={styles.card}>
            <Text style={styles.label}>임시사번</Text>
            <TextInput
              style={styles.input}
              placeholder="예) T-23001"
              placeholderTextColor="#9CA3AF"
              value={tempId}
              onChangeText={setTempId}
            />

            <Text style={styles.label}>수당동의일</Text>
            <Pressable
              style={[styles.input, styles.dateDisplay]}
              onPress={() => {
                if (Platform.OS === 'ios') return;
                setShowPicker(true);
              }}
              disabled={Platform.OS === 'ios'}>
              <Text style={styles.dateText}>{formatKoreanDate(selectedDate)}</Text>
            </Pressable>
            {Platform.OS === 'ios' ? (
              <DateTimePicker
                value={selectedDate}
                mode="date"
                display="spinner"
                locale="ko-KR"
                onChange={(_, d) => d && setSelectedDate(d)}
                style={{ width: '100%' }}
              />
            ) : (
              showPicker && (
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display="calendar"
                  onChange={(event, d) => {
                    setShowPicker(false);
                    if (d) setSelectedDate(d);
                  }}
                />
              )
            )}

            <Button title={loading ? '저장 중...' : '저장'} disabled={loading} onPress={submit} color={ORANGE} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff7f0' },
  container: { padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  caption: { color: '#4b5563' },
  card: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: ORANGE_LIGHT,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  label: { fontWeight: '700', color: CHARCOAL },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
    minHeight: 50,
    justifyContent: 'center',
  },
  dateDisplay: { alignItems: 'center' },
  dateText: { color: CHARCOAL, fontWeight: '800' },
});
