import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
  for (let bc = 0, bs = 0, idx = 0; idx < str.length;) {
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
  url?: string,
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
      data: { type: 'app_event', resident_id: residentId, url },
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
          type: r.doc_type,
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

  // Realtime: 현재 FC의 서류/프로필 변경 시 새로고침
  useEffect(() => {
    if (!fc?.id) return;

    const docChannel = supabase
      .channel(`docs-upload-${fc.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fc_documents', filter: `fc_id=eq.${fc.id}` },
        () => loadData(),
      )
      .subscribe();

    const profileChannel = supabase
      .channel(`docs-upload-profile-${fc.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'fc_profiles', filter: `id=eq.${fc.id}` },
        () => loadData(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(docChannel);
      supabase.removeChannel(profileChannel);
    };
  }, [fc?.id, loadData]);

  const handlePick = async (type: string) => {
    if (!fc) return;
    const targetDoc = docs.find((d) => d.type === type);
    if (targetDoc?.status === 'approved') {
      Alert.alert('수정 불가', '이 서류는 승인되어 수정할 수 없습니다.');
      return;
    }
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

  const handleDelete = async (type: string, storagePath?: string) => {
    if (!fc) return;
    const targetDoc = docs.find((d) => d.type === type);
    if (targetDoc?.status === 'approved') {
      Alert.alert('삭제 불가', '승인된 서류는 삭제할 수 없습니다.');
      return;
    }
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
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.headerContainer}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.headerTitle}>
                {isAdmin ? `${fc?.name ? `${fc.name}님의 서류` : '서류 검토'}` : '필수 서류 제출'}
              </Text>
              <Text style={styles.headerSub}>
                {docCount.total}건 중{' '}
                <Text style={{ color: HANWHA_ORANGE, fontWeight: '700' }}>{docCount.uploaded}건</Text> 완료 ·{' '}
                <Text style={{ color: CHARCOAL, fontWeight: '800' }}>{Math.round(progressPercent)}%</Text>
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <RefreshButton onPress={loadData} />
            </View>
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

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={[styles.progressTrack, { flex: 1 }]}>
              <View style={[styles.progressBar, { width: `${progressPercent}%` }]} />
            </View>
            <Text style={styles.headerCountRight}>
              <Text style={{ color: HANWHA_ORANGE, fontWeight: '800' }}>{docCount.uploaded}</Text>
              <Text style={{ color: '#E5E7EB' }}>/</Text>
              <Text style={{ color: MUTED }}>{docCount.total}</Text>
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: keyboardPadding + 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.list}>
            {docs.map((doc) => {
              const isUploaded = !!doc.uploadedUrl;
              const isUploading = uploadingType === doc.type;
              const isLocked = doc.status === 'approved';

              return (
                <View key={doc.type} style={styles.card}>
                  <View style={styles.cardTopRow}>
                    {/* left icon */}
                    <View style={styles.cardIcon}>
                      <Feather name="file-text" size={18} color={HANWHA_ORANGE} />
                    </View>

                    {/* title + filename */}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.cardTitleRow}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{doc.type}</Text>

                        {/* status chip */}
                        {isUploaded ? (
                          <View style={[styles.chip, isLocked ? styles.chipApproved : styles.chipSubmitted]}>
                            <Feather name="check" size={12} color={isLocked ? '#1D4ED8' : '#059669'} />
                            <Text style={[styles.chipText, { color: isLocked ? '#1D4ED8' : '#059669' }]}>
                              {isLocked ? '승인됨' : '제출됨'}
                            </Text>
                          </View>
                        ) : (
                          <View style={[styles.chip, styles.chipPending]}>
                            <Text style={[styles.chipText, { color: MUTED }]}>미제출</Text>
                          </View>
                        )}
                      </View>

                      <Text style={styles.cardFileName} numberOfLines={1}>
                        {isUploaded ? (doc.originalName ?? '파일 있음') : 'PDF 파일을 업로드해주세요'}
                      </Text>

                      {!!doc.reviewerNote && (
                        <Text style={styles.cardNote} numberOfLines={2}>
                          {doc.reviewerNote}
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* action bar */}
                  <View style={styles.cardActions}>
                    {isUploaded && (
                      <Pressable
                        style={({ pressed }) => [styles.btnGhost, pressed && styles.pressed]}
                        onPress={() => doc.uploadedUrl && Linking.openURL(doc.uploadedUrl)}
                      >
                        <Feather name="external-link" size={16} color={CHARCOAL} />
                        <Text style={styles.btnGhostText}>열기</Text>
                      </Pressable>
                    )}

                    <Pressable
                      style={({ pressed }) => [
                        styles.btnPrimary,
                        (isUploading || isLocked) && styles.btnDisabled,
                        pressed && !isLocked && !isUploading && styles.pressed,
                      ]}
                      onPress={() => handlePick(doc.type)}
                      disabled={isUploading || isLocked}
                    >
                      {isUploading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Feather name="upload" size={16} color="#fff" />
                          <Text style={styles.btnPrimaryText}>
                            {isLocked ? '승인 완료' : isUploaded ? '재업로드' : '파일 선택'}
                          </Text>
                        </>
                      )}
                    </Pressable>

                    {isUploaded && (
                      <Pressable
                        style={({ pressed }) => [styles.iconDanger, pressed && styles.pressed]}
                        onPress={() => handleDelete(doc.type, doc.storagePath)}
                        disabled={isUploading || isLocked}
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
          <Pressable
            style={styles.homeButton}
            onPress={() => router.replace('/')}
          >
            <Text style={styles.homeButtonText}>홈으로 가기</Text>
          </Pressable>
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
  headerSub: { fontSize: 13, color: MUTED, marginTop: 4 },
  headerCountRight: { fontSize: 20, fontWeight: '700', color: MUTED },

  progressTrack: {
    height: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: HANWHA_ORANGE,
    borderRadius: 5,
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

  emptyState: { padding: 20, alignItems: 'center' },
  emptyText: { color: MUTED, fontSize: 14 },

  homeButton: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 24,
    backgroundColor: CHARCOAL,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  homeButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  btnDisabled: { opacity: 0.55 },

  // Modern Card Styles
  card: {
    borderWidth: 1,
    borderColor: '#EEF2F7',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },

  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },

  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
  },

  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },

  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: CHARCOAL,
    letterSpacing: -0.2,
  },

  cardFileName: {
    marginTop: 4,
    fontSize: 13,
    color: MUTED,
    fontWeight: '600',
  },

  cardNote: {
    marginTop: 8,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: '#E5E7EB',
  },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },

  chipPending: { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB' },
  chipSubmitted: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  chipApproved: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },

  chipText: {
    fontSize: 12,
    fontWeight: '800',
  },

  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  btnPrimary: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: HANWHA_ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    shadowColor: '#f36f21',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  btnPrimaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },

  btnGhost: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },

  btnGhostText: {
    fontSize: 13,
    fontWeight: '800',
    color: CHARCOAL,
  },

  iconDanger: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    backgroundColor: '#FEF2F2',
  },

  pressed: { transform: [{ scale: 0.985 }], opacity: 0.95 },
});
