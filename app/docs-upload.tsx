import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useMemo, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { supabase } from '@/lib/supabase';
import { RequiredDoc } from '@/types/fc';

type FcLite = { id: string; temp_id: string | null; name: string };
type DocItem = RequiredDoc & { storagePath?: string; originalName?: string };

const BUCKET = 'fc-documents';
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

export default function DocsUploadScreen() {
  const { residentId } = useSession();
  const [fc, setFc] = useState<FcLite | null>(null);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const keyboardPadding = useKeyboardPadding();

  const docCount = useMemo(
    () => ({ uploaded: docs.filter((d) => d.uploadedUrl).length, total: docs.length }),
    [docs],
  );

  const progressPercent = docCount.total > 0 ? (docCount.uploaded / docCount.total) * 100 : 0;

  const loadForMe = async () => {
    if (!residentId) return;
    const { data: profile, error } = await supabase
      .from('fc_profiles')
      .select('id, temp_id, name')
      .eq('phone', residentId)
      .maybeSingle();
    if (error || !profile) {
      setFc(null);
      setDocs([]);
      return;
    }

    const { data: requirements, error: reqErr } = await supabase
      .from('fc_documents')
      .select('doc_type, storage_path, status, reviewer_note, file_name')
      .eq('fc_id', profile.id);
    if (reqErr) {
      Alert.alert('조회 오류', reqErr.message);
      return;
    }

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
  };

  useEffect(() => {
    loadForMe();
  }, [residentId]);

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
      await supabase.functions.invoke('fc-notify', {
        body: { type: 'fc_update', fc_id: fc.id, message: `${fc.name}님의 ${asset.name}가 업로드되었습니다.` },
      });

      setDocs((prev) =>
        prev.map((doc) =>
          doc.type === type
            ? {
                ...doc,
                uploadedUrl: publicUrl,
                status: 'pending',
                storagePath: objectPath,
                originalName: asset.name ?? 'document.pdf',
              }
            : doc,
        ),
      );
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

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.headerContainer}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.headerTitle}>필수 서류 제출</Text>
              <Text style={styles.headerSub}>
                {docCount.total}건 중 <Text style={{ color: HANWHA_ORANGE, fontWeight: '700' }}>{docCount.uploaded}건</Text> 완료
              </Text>
            </View>
            <RefreshButton onPress={loadForMe} />
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${progressPercent}%` }]} />
          </View>
        </View>

        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: keyboardPadding + 40 }]}>
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
