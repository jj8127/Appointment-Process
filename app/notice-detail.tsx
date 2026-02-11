import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { COLORS } from '@/lib/theme';

type AttachedFile = {
  name: string;
  url: string;
  type: string;
};

type NoticeDetail = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  created_at: string;
  images: string[] | null;
  files: AttachedFile[] | null;
};

type InboxNoticePayload = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  created_at?: string | null;
  images?: unknown;
  files?: unknown;
};

type InboxListResponse = {
  ok?: boolean;
  message?: string;
  notices?: InboxNoticePayload[];
};

const isAttachedFile = (value: unknown): value is AttachedFile => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === 'string' && typeof row.url === 'string' && typeof row.type === 'string';
};

async function fetchNoticeDetail(
  id: string,
  role: 'admin' | 'fc' | null,
  residentId: string,
): Promise<NoticeDetail | null> {
  if (!role) return null;

  const { data, error } = await supabase.functions.invoke<InboxListResponse>('fc-notify', {
    body: {
      type: 'inbox_list',
      role,
      resident_id: role === 'fc' ? (residentId || null) : null,
      limit: 200,
    },
  });
  if (error) throw error;
  if (!data?.ok) {
    throw new Error(data?.message ?? '공지를 불러오지 못했습니다.');
  }

  const row = (data.notices ?? []).find((notice) => notice.id === id);
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category ?? '공지',
    created_at: row.created_at ?? new Date().toISOString(),
    images: Array.isArray(row.images) ? row.images.filter((v): v is string => typeof v === 'string') : null,
    files: Array.isArray(row.files) ? row.files.filter(isAttachedFile) : null,
  };
}

export default function NoticeDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { role, residentId } = useSession();
  const noticeId = useMemo(() => (Array.isArray(id) ? id[0] : id) ?? '', [id]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notice', 'detail', noticeId, role, residentId],
    queryFn: () => fetchNoticeDetail(noticeId, role, residentId),
    enabled: Boolean(noticeId && role),
  });

  const handleOpenLink = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('오류', '이 링크를 열 수 없습니다.');
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert('오류', '링크를 여는 중 문제가 발생했습니다.');
    }
  };

  if (!noticeId) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.message}>공지 ID가 없습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Feather name="alert-circle" size={26} color="#EF4444" />
          <Text style={styles.message}>공지를 불러오지 못했습니다.</Text>
          <Pressable style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{data.category || '공지'}</Text>
        </View>
        <Text style={styles.date}>{new Date(data.created_at).toLocaleDateString()}</Text>
        <Text style={styles.title}>{data.title}</Text>
        <View style={styles.divider} />
        <Text style={styles.body}>{data.body}</Text>

        {data.images && data.images.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScroll}>
            {data.images.map((imgUrl, i) => (
              <Pressable key={`${imgUrl}-${i}`} onPress={() => handleOpenLink(imgUrl)}>
                <Image source={{ uri: imgUrl }} style={styles.noticeImage} />
              </Pressable>
            ))}
          </ScrollView>
        )}

        {data.files && data.files.length > 0 && (
          <View style={styles.fileList}>
            {data.files.map((file, i) => (
              <Pressable key={`${file.url}-${i}`} style={styles.fileItem} onPress={() => handleOpenLink(file.url)}>
                <Feather name="paperclip" size={14} color={COLORS.text.secondary} />
                <Text style={styles.fileName} numberOfLines={1}>
                  {file.name}
                </Text>
                <Feather name="download-cloud" size={14} color={COLORS.primary} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  container: { padding: 20, paddingBottom: 40, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  message: { color: COLORS.text.secondary, fontSize: 14 },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  retryText: { color: COLORS.text.primary, fontWeight: '700' },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#FFF7ED',
  },
  badgeText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  date: { color: '#9CA3AF', fontSize: 12 },
  title: { color: COLORS.text.primary, fontSize: 24, fontWeight: '800' },
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 6 },
  body: { color: COLORS.text.primary, fontSize: 15, lineHeight: 24 },
  imageScroll: { marginTop: 6 },
  noticeImage: { width: 220, height: 160, borderRadius: 12, marginRight: 10, backgroundColor: '#E5E7EB' },
  fileList: { marginTop: 6, gap: 8 },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fileName: { flex: 1, color: COLORS.text.primary },
});
