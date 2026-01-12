import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, RefreshControl, StyleSheet, Text, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { FormInput } from '@/components/FormInput';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';

type FcRow = { id: string; name: string | null; resident_id_masked: string | null };

export default function AdminRegisterScreen() {
  const { role, readOnly } = useSession();
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
      if (readOnly) {
        throw new Error('본부장은 조회 전용 계정입니다.');
      }
      const digits = resident.replace(/[^0-9]/g, '');
      if (!name.trim() || digits.length < 6) {
        throw new Error('이름과 주민번호를 확인해주세요.');
      }
      const masked = digits.length >= 6 ? `${digits.slice(0, 6)}-${'*'.repeat(7)}` : digits;
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
    onSettled: (_data, error) => {
      if (error) {
        const message = error instanceof Error ? error.message : '등록 중 문제가 발생했습니다.';
        Alert.alert('등록 실패', message);
      }
    },
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
            <FormInput
              label="이름"
              placeholder="예) 홍길동"
              value={name}
              onChangeText={setName}
              autoCapitalize="none"
              editable={!createMutation.isPending && !readOnly}
            />
            <FormInput
              label="주민번호(숫자만)"
              placeholder="휴대폰 번호 (- 없이 숫자만 입력)"
              value={resident}
              onChangeText={setResident}
              keyboardType="numeric"
              autoCapitalize="none"
              editable={!createMutation.isPending && !readOnly}
            />
            <Button
              title="신규 FC 등록"
              color={COLORS.primary}
              onPress={handleCreate}
              disabled={createMutation.isPending || readOnly}
            />
          </View>

          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>등록된 FC 목록</Text>
              <Button title="새로고침" onPress={() => refetch()} color={COLORS.primaryLight} />
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
  safe: { flex: 1, backgroundColor: COLORS.primaryPale },
  container: { padding: SPACING.lg, paddingBottom: 96, gap: SPACING.md },
  title: { fontSize: TYPOGRAPHY.fontSize.xl, fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary },
  caption: { color: COLORS.text.secondary },
  card: {
    backgroundColor: COLORS.white,
    padding: SPACING.base,
    borderRadius: RADIUS.lg,
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    shadowColor: COLORS.black,
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  label: { fontWeight: TYPOGRAPHY.fontWeight.bold, color: COLORS.text.primary },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  listItem: {
    backgroundColor: COLORS.white,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  listName: { color: COLORS.text.primary, fontWeight: '700' },
  listResident: { color: COLORS.text.secondary },
});
