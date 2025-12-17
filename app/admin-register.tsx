import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, RefreshControl, StyleSheet, Text, TextInput, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';

const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';
const GRAY = '#4b5563';

type FcRow = { id: string; name: string | null; resident_id_masked: string | null };

export default function AdminRegisterScreen() {
  const { role } = useSession();
  const [name, setName] = useState('');
  const [resident, setResident] = useState('');
  const keyboardPadding = useKeyboardPadding();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (role !== 'admin') {
      Alert.alert('접근 불가', '관리자만 이용할 수 있습니다.');
      router.replace('/');
    }
  }, [role]);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['admin-fc-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fc_profiles')
        .select('id,name,resident_id_masked')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as FcRow[];
    },
    enabled: role === 'admin',
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const digits = resident.replace(/[^0-9]/g, '');
      if (!name.trim() || digits.length < 6) {
        throw new Error('이름과 주민번호를 확인해주세요.');
      }
      const masked = digits.length >= 6 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : digits;
      const { error } = await supabase.from('fc_profiles').upsert({
        name: name.trim(),
        affiliation: '',
        phone: '',
        recommender: '',
        email: '',
        address: '',
        resident_id_masked: masked,
        status: 'draft',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      Alert.alert('등록 완료', 'FC가 등록되었습니다. 목록을 새로고침해주세요.');
      setName('');
      setResident('');
      refetch();
    },
    onError: (err: any) => Alert.alert('등록 실패', err?.message ?? '등록 중 문제가 발생했습니다.'),
  });

  const handleCreate = () => createMutation.mutate();

  // Pull to refresh handler: react-query refetch 호출
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  return (
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAwareWrapper contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 120 }]}>
        <ScrollView
          contentContainerStyle={{ gap: 12 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <RefreshButton />
          <Text style={styles.title}>신규 FC 등록</Text>
          <Text style={styles.caption}>위촉을 진행할 FC의 주민번호와 성명을 입력하세요.</Text>

          <View style={styles.card}>
            <Text style={styles.label}>이름</Text>
            <TextInput
              placeholder="예) 홍길동"
              placeholderTextColor="#9CA3AF"
              value={name}
              onChangeText={setName}
              style={styles.input}
              autoCapitalize="none"
            />
            <Text style={styles.label}>주민번호(숫자만)</Text>
            <TextInput
              placeholder="휴대폰 번호 (- 없이 숫자만 입력)"
              placeholderTextColor="#9CA3AF"
              value={resident}
              onChangeText={setResident}
              style={styles.input}
              keyboardType="numeric"
              autoCapitalize="none"
            />
            <Button title="신규 FC 등록" color={ORANGE} onPress={handleCreate} disabled={createMutation.isPending} />
          </View>

          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>등록된 FC 목록</Text>
              <Button title="새로고침" onPress={() => refetch()} color={ORANGE_LIGHT} />
            </View>
            {isLoading ? (
              <Text>불러오는 중...</Text>
            ) : (
              data?.map((row) => (
                <View key={row.id} style={styles.listItem}>
                  <View>
                    <Text style={styles.listName}>{row.name}</Text>
                    <Text style={styles.listResident}>{row.resident_id_masked}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff7f0' },
  container: { padding: 20, paddingBottom: 96, gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  caption: { color: GRAY },
  card: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 14,
    gap: 10,
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
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  listItem: {
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  listName: { color: CHARCOAL, fontWeight: '700' },
  listResident: { color: GRAY },
});
