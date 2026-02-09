import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { Button } from '@/components/Button';
import { RefreshButton } from '@/components/RefreshButton';
import { useIdentityGate } from '@/hooks/use-identity-gate';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { COLORS } from '@/lib/theme';
import { RequiredDoc } from '@/types/fc';

type FcLite = { id: string; temp_id: string | null; name: string; status: string; docs_deadline_at?: string | null };
type DocItem = RequiredDoc & { storagePath?: string; originalName?: string };

const BUCKET = 'fc-documents';

const randomKey = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const normalizeDocStatus = (status: string | null | undefined): DocItem['status'] => {
  if (status === 'approved' || status === 'rejected' || status === 'pending') {
    return status;
  }
  return undefined;
};

async function sendNotificationAndPush(
  role: 'admin' | 'fc',
  residentId: string | null,
  title: string,
  body: string,
  url?: string,
) {
  const { error, data } = await supabase.functions.invoke('fc-notify', {
    body: {
      type: 'notify',
      target_role: role,
      target_id: residentId,
      title,
      body,
      category: 'app_event',
      url,
    },
  });
  if (error) {
    throw error;
  }
  if (!data?.ok) {
    throw new Error(data?.message ?? '알림 전송 실패');
  }
}

export default function DocsUploadScreen() {
  const { residentId, role } = useSession();
  useIdentityGate({ nextPath: '/docs-upload' });
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const isAdmin = role === 'admin';
  const [fc, setFc] = useState<FcLite | null>(null);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const pickingRef = useRef(false);
  const storageDebuggedRef = useRef(false);
  const keyboardPadding = useKeyboardPadding();
  const [refreshing, setRefreshing] = useState(false);

  const docCount = useMemo(
    () => ({ uploaded: docs.filter((d) => d.storagePath).length, total: docs.length }),
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
        .select('id, temp_id, name, status, docs_deadline_at')
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
          uploadedUrl: undefined,
          status: hasFile ? normalizeDocStatus(r.status) ?? 'pending' : 'pending',
          reviewerNote: r.reviewer_note ?? undefined,
          storagePath: hasFile ? r.storage_path ?? undefined : undefined,
          originalName: hasFile ? r.file_name ?? undefined : undefined,
        };
      });

      const statusRank = (doc: DocItem) => {
        if (!doc.storagePath) return 0; // 미제출
        if (doc.status === 'approved') return 2; // 승인됨
        return 1; // 미승인 (제출됨)
      };
      reqDocs.sort((a, b) => statusRank(a) - statusRank(b));

      setFc(profile as FcLite);
      setDocs(reqDocs);
    } catch (err: any) {
      Alert.alert('조회 오류', err?.message ?? '정보를 불러오지 못했습니다.');
    }
  }, [isAdmin, residentId, userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (storageDebuggedRef.current) return;
    storageDebuggedRef.current = true;
    (async () => {
      try {
        logger.debug('[supabase env]', { url: process.env.EXPO_PUBLIC_SUPABASE_URL });
        const { data, error } = await supabase.storage.listBuckets();
        if (error) {
          logger.warn('[storage] listBuckets error', { error: error.message });
          return;
        }
        const names = (data ?? []).map((b: any) => b.name);
        logger.debug('[storage] buckets', { names });
        const { data: listData, error: listError } = await supabase.storage
          .from(BUCKET)
          .list('', { limit: 1 });
        if (listError) {
          logger.warn('[storage] list bucket error', { error: listError.message });
        } else {
          logger.debug('[storage] list bucket ok', { bucket: BUCKET, count: listData?.length ?? 0 });
        }
      } catch (err: any) {
        logger.warn('[storage] listBuckets exception', { error: err?.message ?? err });
      }
    })();
  }, []);

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
    if (pickingRef.current) return;
    const targetDoc = docs.find((d) => d.type === type);
    if (targetDoc?.status === 'approved') {
      Alert.alert('수정 불가', '이 서류는 승인되어 수정할 수 없습니다.');
      return;
    }
    pickingRef.current = true;
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
    } catch (err: any) {
      Alert.alert('오류', err?.message ?? '파일 선택 중 오류가 발생했습니다.');
      return;
    } finally {
      pickingRef.current = false;
    }

    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;

    setUploadingType(type as string);
    try {
      logger.debug('[upload] start', {
        docType: type,
        uri: asset.uri,
        name: asset.name,
        size: asset.size,
        mimeType: asset.mimeType,
      });
      const objectPath = `${fc.id}/${randomKey()}.pdf`;
      const contentType = asset.mimeType ?? 'application/pdf';
      if (Platform.OS === 'web') {
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        const byteArray = new Uint8Array(await blob.arrayBuffer());
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(objectPath, byteArray, { contentType, upsert: true });
        if (uploadError) {
          logger.warn('[upload] storage upload error', { error: uploadError.message });
          throw uploadError;
        }
      } else {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(objectPath);
        if (error || !data?.signedUrl) {
          logger.warn('[upload] createSignedUploadUrl error', { error: error?.message ?? 'unknown' });
          throw error ?? new Error('Signed upload URL 생성 실패');
        }
        const uploadResult = await FileSystem.uploadAsync(data.signedUrl, asset.uri, {
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: { 'Content-Type': contentType },
        });
        if (uploadResult.status < 200 || uploadResult.status >= 300) {
          logger.warn('[upload] signed upload failed', { status: uploadResult.status });
          throw new Error(`업로드 실패 (status ${uploadResult.status})`);
        }
      }

      const signedResult = await supabase.storage.from(BUCKET).createSignedUrl(objectPath, 300);
      if (signedResult.error) {
        logger.warn('[storage] createSignedUrl failed', { error: signedResult.error.message });
      }

      const { error: dbError } = await supabase.from('fc_documents').upsert(
        {
          fc_id: fc.id,
          doc_type: type,
          storage_path: objectPath,
          file_name: asset.name ?? 'document.pdf',
          status: 'pending',
          reviewer_note: null,
        },
        { onConflict: 'fc_id,doc_type' },
      );
      if (dbError) {
        logger.warn('[upload] db upsert error', { error: dbError.message });
        throw dbError;
      }

      await supabase.from('fc_profiles').update({ status: 'docs-pending' }).eq('id', fc.id);
      const updatedDocs: DocItem[] = docs.map((doc) =>
        doc.type === type
          ? {
            ...doc,
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
        `${nameLabel}님이 ${type}을 제출했습니다.`,
        `${nameLabel}님이 ${type}을 업로드했습니다.`,
        '/dashboard',
      );

      const uploadedCount = updatedDocs.filter((d) => d.storagePath).length;
      if (uploadedCount === updatedDocs.length && updatedDocs.length > 0) {
        await sendNotificationAndPush(
          'admin',
          residentId ?? null,
          `${nameLabel}님이 모든 서류를 제출했습니다.`,
          `${nameLabel}님이 모든 필수 서류를 업로드했습니다.`,
          '/dashboard',
        );
      }

      logger.debug('[upload] success', { objectPath });
      Alert.alert('업로드 완료', '파일이 정상적으로 등록되었습니다.');
    } catch (err: any) {
      logger.warn('[upload] failed', { bucket: BUCKET, error: err?.message ?? err });
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
                <Text style={{ color: COLORS.primary, fontWeight: '700' }}>{docCount.uploaded}건</Text> 완료 ·{' '}
                <Text style={{ color: COLORS.text.primary, fontWeight: '800' }}>{Math.round(progressPercent)}%</Text>
              </Text>
              {fc?.docs_deadline_at ? (
                <View style={styles.deadlineBadge}>
                  <Text style={styles.deadlineBadgeLabel}>마감일</Text>
                  <Text style={styles.deadlineBadgeValue}>{fc.docs_deadline_at}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <RefreshButton onPress={loadData} />
            </View>
          </View>

          {isAdmin && (
            <View style={styles.adminActionBox}>
              <Text style={styles.adminLabel}>관리자 검토</Text>
              <View style={styles.adminActionRow}>
                <Button
                  onPress={() => handleApprove(false)}
                  disabled={approving}
                  variant="outline"
                  size="lg"
                  style={{ flex: 1, borderColor: '#ef4444', backgroundColor: '#fff' }}
                >
                  반려
                </Button>
                <Button
                  onPress={() => handleApprove(true)}
                  disabled={approving}
                  loading={approving}
                  variant="primary"
                  size="lg"
                  style={{ flex: 1 }}
                >
                  검토 완료 (승인)
                </Button>
              </View>
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={[styles.progressTrack, { flex: 1 }]}>
              <View style={[styles.progressBar, { width: `${progressPercent}%` }]} />
            </View>
            <Text style={styles.headerCountRight}>
              <Text style={{ color: COLORS.primary, fontWeight: '800' }}>{docCount.uploaded}</Text>
              <Text style={{ color: '#E5E7EB' }}>/</Text>
              <Text style={{ color: COLORS.text.secondary }}>{docCount.total}</Text>
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: keyboardPadding + 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.list}>
            {docs.map((doc) => {
              const isUploaded = !!doc.storagePath;
              const isUploading = uploadingType === doc.type;
              const isLocked = doc.status === 'approved';
              const isRejected = doc.status === 'rejected';

              return (
                <View key={doc.type} style={styles.card}>
                  <View style={styles.cardTopRow}>
                    {/* left icon */}
                    <View style={styles.cardIcon}>
                      <Feather name="file-text" size={18} color={COLORS.primary} />
                    </View>

                    {/* title + filename */}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.cardTitleRow}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{doc.type}</Text>

                        {/* status chip */}
                        {isUploaded ? (
                          <View
                            style={[
                              styles.chip,
                              isLocked ? styles.chipApproved : isRejected ? styles.chipRejected : styles.chipSubmitted,
                            ]}
                          >
                            <Feather
                              name={isRejected ? 'alert-triangle' : 'check'}
                              size={12}
                              color={isLocked ? '#1D4ED8' : isRejected ? '#B91C1C' : '#059669'}
                            />
                            <Text
                              style={[
                                styles.chipText,
                                { color: isLocked ? '#1D4ED8' : isRejected ? '#B91C1C' : '#059669' },
                              ]}
                            >
                              {isLocked ? '승인됨' : isRejected ? '재제출 요청' : '제출됨'}
                            </Text>
                          </View>
                        ) : (
                          <View style={[styles.chip, styles.chipPending]}>
                            <Text style={[styles.chipText, { color: COLORS.text.secondary }]}>미제출</Text>
                          </View>
                        )}
                      </View>

                      <Text style={styles.cardFileName} numberOfLines={1}>
                        {isUploaded ? (doc.originalName ?? '파일 있음') : 'PDF 파일을 업로드해주세요'}
                      </Text>

                      {!!doc.reviewerNote && (
                        <Text style={styles.cardNote} numberOfLines={2}>
                          <Text style={styles.cardNoteLabel}>반려 사유: </Text>
                          <Text style={styles.cardNoteText}>{doc.reviewerNote}</Text>
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* action bar */}
                  <View style={styles.cardActions}>
                    {isUploaded && (
                      <Pressable
                        style={({ pressed }) => [styles.btnGhost, pressed && styles.pressed]}
                        onPress={() => {
                          if (!doc.storagePath) return;
                          logger.debug('[storage] open file', {
                            bucket: BUCKET,
                            storagePath: doc.storagePath,
                            uploadedUrl: doc.uploadedUrl,
                          });
                          (async () => {
                            const { data: signed, error } = await supabase.storage
                              .from(BUCKET)
                              .createSignedUrl(doc.storagePath!, 300);
                            if (error || !signed?.signedUrl) {
                              Alert.alert('파일 열기 실패', error?.message ?? '링크 생성에 실패했습니다.');
                              return;
                            }
                            Linking.openURL(signed.signedUrl);
                          })();
                        }}
                      >
                        <Feather name="external-link" size={16} color={COLORS.text.primary} />
                        <Text style={styles.btnGhostText}>열기</Text>
                      </Pressable>
                    )}

                    <Pressable
                      style={({ pressed }) => [
                        styles.btnSecondary,
                        (isUploading || isLocked) && styles.btnDisabled,
                        pressed && !isLocked && !isUploading && styles.pressed,
                      ]}
                      onPress={() => handlePick(doc.type)}
                      disabled={isUploading || isLocked}
                    >
                      {isUploading ? (
                        <ActivityIndicator size="small" color={COLORS.primary} />
                      ) : (
                        <>
                          <Feather name="upload" size={16} color={COLORS.primary} />
                          <Text style={styles.btnSecondaryText}>
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
          <Button
            onPress={() => router.replace('/')}
            variant="primary"
            size="lg"
            fullWidth
            style={{ marginTop: 12, marginBottom: 24 }}
          >
            홈으로 가기
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },

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
  headerTitle: { fontSize: 22, fontWeight: '800', color: COLORS.text.primary },
  headerSub: { fontSize: 13, color: COLORS.text.secondary, marginTop: 4 },
  deadlineBadge: {
    marginTop: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FDBA74',
    backgroundColor: '#FFF7ED',
  },
  deadlineBadgeLabel: { fontSize: 11, fontWeight: '800', color: '#9A3412', letterSpacing: 0.2 },
  deadlineBadgeValue: { fontSize: 13, fontWeight: '800', color: '#C2410C' },
  headerCountRight: { fontSize: 20, fontWeight: '700', color: COLORS.text.secondary },

  progressTrack: {
    height: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: COLORS.primary,
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

  scrollContent: { padding: 24 },

  noticeBox: {
    flexDirection: 'row',
    backgroundColor: COLORS.background.secondary,
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    gap: 8,
  },
  noticeText: { fontSize: 13, color: COLORS.text.primary, flex: 1, lineHeight: 18 },

  list: { gap: 16 },

  emptyState: { padding: 20, alignItems: 'center' },
  emptyText: { color: COLORS.text.secondary, fontSize: 14 },

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
    color: COLORS.text.primary,
    letterSpacing: -0.2,
  },

  cardFileName: {
    marginTop: 4,
    fontSize: 13,
    color: COLORS.text.secondary,
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
  cardNoteLabel: { color: '#B91C1C', fontWeight: '800' },
  cardNoteText: { color: '#7F1D1D', fontWeight: '700' },

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
  chipRejected: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },

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
    backgroundColor: COLORS.primary,
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
    color: COLORS.text.primary,
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

  btnSecondary: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  btnSecondaryText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '900',
  },
});
