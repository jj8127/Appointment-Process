import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RefreshButton } from '@/components/RefreshButton';
import { supabase } from '@/lib/supabase';

const CHARCOAL = '#111827';
const BORDER = '#e5e7eb';
const ORANGE = '#f36f21';
const SOFT_BG = '#fff7f0';
const MUTED = '#6b7280';

type Notice = { id: string; title: string; body: string; category: string | null; created_at: string };

const fetchNotices = async (): Promise<Notice[]> => {
  const { data, error } = await supabase
    .from('notices')
    .select('id,title,body,category,created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
};

export default function NoticeScreen() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notices', 'list'],
    queryFn: fetchNotices,
  });

  const notices = useMemo(() => data ?? [], [data]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>공지사항</Text>
          <RefreshButton onPress={() => void refetch()} />
        </View>

        {isLoading ? <ActivityIndicator color={ORANGE} /> : null}
        {isError ? <Text style={styles.error}>공지 불러오기에 실패했습니다.</Text> : null}
        {!isLoading && !notices.length ? <Text style={styles.empty}>등록된 공지가 없습니다.</Text> : null}

        {notices.map((n) => (
          <View key={n.id} style={styles.card}>
            <Text style={styles.noticeTitle}>{n.title}</Text>
            <Text style={styles.date}>{new Date(n.created_at).toLocaleDateString()}</Text>
            <Text style={styles.body}>{n.body}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SOFT_BG },
  container: { padding: 20, gap: 12, paddingBottom: 64 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: CHARCOAL },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    gap: 6,
  },
  noticeTitle: { fontSize: 16, fontWeight: '800', color: CHARCOAL },
  date: { color: MUTED, fontSize: 12 },
  body: { color: CHARCOAL, lineHeight: 20 },
  error: { color: '#dc2626' },
  empty: { color: MUTED },
});
