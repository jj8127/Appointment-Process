import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { supabase } from '@/lib/supabase';
import { RequiredDoc } from '@/types/fc';

type FcLite = { id: string; temp_id: string | null; name: string; status: string };
type DocItem = RequiredDoc & { storagePath?: string; originalName?: string };

const BUCKET = 'fc-documents';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#E5E7EB';
const BACKGROUND = '#ffffff';
const INPUT_BG = '#F9FAFB';

const randomKey = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function base64ToUint8Array(base64: string) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64.replace(/=+$/, '');
  const output: number[] = [];
  for (let bc = 0, bs = 0, idx = 0; idx < str.length; ) {
    const ch = str.charAt(idx++);
    const buffer = chars.indexOf(ch);
    if (buffer === -1) continue;
    bs = bc % 4 ? bs * 64 + buffer : buffer;
    if (bc++ % 4) output.push(255 & (bs >> ((-2 * bc) & 6)));
  }
  return new Uint8Array(output);
}

async function sendNotificationAndPush(
  role: 'admin' | 'fc',
  residentId: string | null,
  title: string,
  body: string,
) {
  await supabase.from('notifications').insert({
    title,
    body,
    category: 'app_event',
    recipient_role: role,
    resident_id: residentId,
  });

  const { data: tokens } =
    role === 'admin'
      ? await supabase.from('device_tokens').select('expo_push_token').eq('role', 'admin')
      : await supabase.from('device_tokens').select('expo_push_token').eq('role', 'fc').eq('resident_id', residentId ?? '');

  const payload =
    tokens?.map((t: any) => ({
      to: t.expo_push_token,
      title,
      body,
      data: { type: 'app_event', resident_id: residentId },
    })) ?? [];

  if (payload.length) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

export default function DocsUploadScreen() {
  const { residentId, role } = useSession();
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const isAdmin = role === 'admin';
  const [fc, setFc] = useState<FcLite | null>(null);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const keyboardPadding = useKeyboardPadding();
  const [refreshing, setRefreshing] = useState(false);

  const docCount = useMemo(
    () => ({ uploaded: docs.filter((d) => d.uploadedUrl).length, total: docs.length }),
    [docs],
  );

  const progressPercent = docCount.total > 0 ? (docCount.uploaded / docCount.total) * 100 : 0;

  const loadData = useCallback(async () => {
    try {
      let targetId: string | null = null;
      if (isAdmin && userId) {
        targetId = userId;
      } else if (residentId) {
        const { data: profileId, error: idErr } = await supabase
          .from('fc_profiles')
          .select('id')
          .eq('phone', residentId)
          .maybeSingle();
        if (idErr) throw idErr;
        targetId = profileId?.id ?? null;
      }
      if (!targetId) {
        setFc(null);
        setDocs([]);
        return;
      }

      const { data: profile, error } = await supabase
        .from('fc_profiles')
        .select('id, temp_id, name, status')
        .eq('id', targetId)
        .maybeSingle();
      if (error) throw error;
      if (!profile) {
        setFc(null);
        setDocs([]);
        return;
      }

      const { data: requirements, error: reqErr } = await supabase
        .from('fc_documents')
        .select('doc_type, storage_path, status, reviewer_note, file_name')
        .eq('fc_id', targetId);
      if (reqErr) throw reqErr;

      const reqDocs: DocItem[] = (requirements ?? []).map((r) => {
        const hasFile = r.storage_path && r.storage_path !== 'deleted';
        return {
          type: r.doc_type as any,
          required: true,
          uploadedUrl: hasFile
            ? supabase.storage.from(BUCKET).getPublicUrl(r.storage_path).data.publicUrl
            : undefined,
          status: hasFile ? (r.status as any) ?? 'pending' : 'pending',
          reviewerNote: r.reviewer_note ?? undefined,
          storagePath: hasFile ? r.storage_path ?? undefined : undefined,
          originalName: hasFile ? r.file_name ?? undefined : undefined,
        };
      });

      setFc(profile as FcLite);
      setDocs(reqDocs);
    } catch (err: any) {
      Alert.alert('조회 오류', err?.message ?? '정보를 불러오지 못했습니다.');
    }
  }, [isAdmin, residentId, userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  const handlePick = async (type: RequiredDoc['type']) => {
    if (!fc) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;

    setUploadingType(type as string);
    try {
      const fileBase64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
      const byteArray = base64ToUint8Array(fileBase64);
      const objectPath = `${fc.id}/${randomKey()}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(objectPath, byteArray, { contentType: 'application/pdf', upsert: true });
      if (uploadError) throw uploadError;

      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;

      const { error: dbError } = await supabase.from('fc_documents').upsert(
        {
          fc_id: fc.id,
          doc_type: type,
          storage_path: objectPath,
          file_name: asset.name ?? 'document.pdf',
          status: 'pending',
        },
        { onConflict: 'fc_id,doc_type' },
      );
      if (dbError) throw dbError;

      await supabase.from('fc_profiles').update({ status: 'docs-pending' }).eq('id', fc.id);
      const updatedDocs = docs.map((doc) =>
        doc.type === type
          ? {
              ...doc,
              uploadedUrl: publicUrl,
              status: 'pending',
              storagePath: objectPath,
              originalName: asset.name ?? 'document.pdf',
            }
          : doc,
      );
      setDocs(updatedDocs);

      const nameLabel = fc.name || 'FC';
      await sendNotificationAndPush(
        'admin',
        residentId ?? null,
        `${nameLabel}이/가 ${type}을 제출했습니다.`,
        `${nameLabel}님이 ${type}을 업로드했습니다.`,
      );

      const uploadedCount = updatedDocs.filter((d) => d.uploadedUrl).length;
      if (uploadedCount === updatedDocs.length && updatedDocs.length > 0) {
        await sendNotificationAndPush(
          'admin',
          residentId ?? null,
          `${nameLabel}이/가 모든 서류를 제출했습니다.`,
          `${nameLabel}님이 모든 필수 서류를 업로드했습니다.`,
        );
      }

      Alert.alert('업로드 완료', '파일이 정상적으로 등록되었습니다.');
    } catch (err: any) {
      Alert.alert('오류', err?.message ?? '업로드 실패');
    } finally {
      setUploadingType(null);
    }
  };

  const handleDelete = async (type: RequiredDoc['type'], storagePath?: string) => {
    if (!fc) return;
    try {
      if (storagePath) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
      }
      const { error: dbError } = await supabase
        .from('fc_documents')
        .update({ storage_path: 'deleted', file_name: 'deleted.pdf', status: 'pending', reviewer_note: null })
        .eq('fc_id', fc.id)
        .eq('doc_type', type);
      if (dbError) throw dbError;

      setDocs((prev) =>
        prev.map((doc) =>
          doc.type === type ? { ...doc, uploadedUrl: undefined, storagePath: undefined, originalName: undefined } : doc,
        ),
      );
    } catch (err: any) {
      Alert.alert('오류', err?.message ?? '삭제 실패');
    }
  };

  const handleApprove = async (isApprove: boolean) => {
    if (!fc) return;
    setApproving(true);
    try {
      const newStatus = isApprove ? 'docs-approved' : 'docs-rejected';
      const { error } = await supabase.from('fc_profiles').update({ status: newStatus }).eq('id', fc.id);
      if (error) throw error;
      setFc((prev) => (prev ? { ...prev, status: newStatus } : prev));
      Alert.alert('완료', isApprove ? '서류 검토가 완료되었습니다.' : '서류가 반려되었습니다.', [
        { text: '확인', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('오류', err?.message ?? '상태 업데이트 실패');
    } finally {
      setApproving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.headerContainer}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.headerTitle}>
                {isAdmin ? `${fc?.name ? `${fc.name}님의 서류` : '서류 검토'}` : '필수 서류 제출'}
              </Text>
              <Text style={styles.headerSub}>
                {docCount.total}건 중{' '}
                <Text style={{ color: HANWHA_ORANGE, fontWeight: '700' }}>{docCount.uploaded}건</Text> 완료
              </Text>
            </View>
            <RefreshButton onPress={loadData} />
          </View>

          {isAdmin && (
            <View style={styles.adminActionBox}>
              <Text style={styles.adminLabel}>관리자 검토</Text>
              <View style={styles.adminActionRow}>
                <Pressable
                  style={[styles.adminBtn, styles.rejectBtn]}
                  onPress={() => handleApprove(false)}
                  disabled={approving}
                >
                  <Text style={styles.rejectText}>반려</Text>
                </Pressable>
                <Pressable
                  style={[styles.adminBtn, styles.approveBtn]}
                  onPress={() => handleApprove(true)}
                  disabled={approving}
                >
                  {approving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.approveText}>검토 완료 (승인)</Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${progressPercent}%` }]} />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: keyboardPadding + 40 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {fc?.temp_id && (
            <View style={styles.noticeBox}>
              <Feather name="info" size={14} color={CHARCOAL} style={{ marginTop: 2 }} />
              <Text style={styles.noticeText}>
                발급된 임시번호 <Text style={{ fontWeight: '700' }}>{fc.temp_id}</Text>를 서류에 기재해주세요.
              </Text>
            </View>
          )}

          <View style={styles.list}>
            {docs.map((doc) => {
              const isUploaded = !!doc.uploadedUrl;
              const isUploading = uploadingType === doc.type;

              return (
                <View key={doc.type} style={[styles.item, isUploaded && styles.itemDone]}>
                  <View style={styles.itemContent}>
                    <View style={styles.itemHeader}>
                      <Text style={[styles.itemTitle, isUploaded && styles.textDone]}>{doc.type}</Text>
                      {isUploaded ? (
                        <View style={styles.badgeDone}>
                          <Feather name="check" size={10} color="#059669" />
                          <Text style={styles.badgeTextDone}>완료</Text>
                        </View>
                      ) : (
                        <View style={styles.badgePending}>
                          <Text style={styles.badgeTextPending}>미제출</Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.fileName} numberOfLines={1}>
                      {isUploaded ? (doc.originalName ?? '파일 업로드됨') : 'PDF 파일을 업로드해주세요'}
                    </Text>
                  </View>

                  <View style={styles.actions}>
                    <Pressable
                      style={[styles.btn, isUploaded ? styles.btnOutline : styles.btnSolid]}
                      onPress={() => handlePick(doc.type)}
                      disabled={isUploading}
                    >
                      {isUploading ? (
                        <ActivityIndicator size="small" color={isUploaded ? CHARCOAL : '#fff'} />
                      ) : (
                        <Text style={isUploaded ? styles.btnTextOutline : styles.btnTextSolid}>
                          {isUploaded ? '재업로드' : '파일 선택'}
                        </Text>
                      )}
                    </Pressable>

                    {isUploaded && (
                      <Pressable
                        style={styles.iconBtn}
                        onPress={() => handleDelete(doc.type, doc.storagePath)}
                        disabled={isUploading}
                      >
                        <Feather name="trash-2" size={18} color="#EF4444" />
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
            {!docs.length && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>요청된 서류가 없습니다.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BACKGROUND },

  headerContainer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#fff',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  headerSub: { fontSize: 14, color: MUTED, marginTop: 4 },

  progressTrack: {
    height: 4,
    backgroundColor: '#F3F4F6',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: HANWHA_ORANGE,
    borderRadius: 2,
  },
  adminActionBox: {
    marginTop: 12,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    gap: 12,
  },
  adminLabel: { fontSize: 14, fontWeight: '700', color: '#9a3412' },
  adminActionRow: { flexDirection: 'row', gap: 10 },
  adminBtn: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveBtn: { backgroundColor: HANWHA_ORANGE },
  approveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  rejectBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ef4444' },
  rejectText: { color: '#ef4444', fontWeight: '700', fontSize: 15 },

  scrollContent: { padding: 24 },

  noticeBox: {
    flexDirection: 'row',
    backgroundColor: INPUT_BG,
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 8,
  },
  noticeText: { fontSize: 13, color: CHARCOAL, flex: 1, lineHeight: 18 },

  list: { gap: 16 },
  item: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 16,
    backgroundColor: '#fff',
    gap: 16,
  },
  itemDone: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  itemContent: { gap: 4 },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemTitle: { fontSize: 16, fontWeight: '700', color: CHARCOAL },
  textDone: { color: '#065F46' },

  badgePending: { backgroundColor: '#F3F4F6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeTextPending: { fontSize: 11, color: MUTED, fontWeight: '600' },

  badgeDone: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#DCFCE7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeTextDone: { fontSize: 11, color: '#166534', fontWeight: '600' },

  fileName: { fontSize: 13, color: MUTED },

  actions: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSolid: { backgroundColor: CHARCOAL },
  btnOutline: { backgroundColor: '#fff', borderWidth: 1, borderColor: BORDER },
  btnTextSolid: { color: '#fff', fontSize: 14, fontWeight: '700' },
  btnTextOutline: { color: CHARCOAL, fontSize: 14, fontWeight: '700' },

  iconBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FEE2E2',
    backgroundColor: '#FEF2F2',
  },
  emptyState: { padding: 20, alignItems: 'center' },
  emptyText: { color: MUTED, fontSize: 14 },
});
