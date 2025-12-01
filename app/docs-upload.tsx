import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { supabase } from '@/lib/supabase';
import { RequiredDoc } from '@/types/fc';

type FcLite = { id: string; temp_id: string | null; name: string };
type DocItem = RequiredDoc & { storagePath?: string; originalName?: string };

const BUCKET = 'fc-documents';
const ORANGE = '#f36f21';
const ORANGE_MUTED = '#f7b182';
const GRAY = '#9ca3af';
const SLATE = '#0f172a';
const MUTED = '#6b7280';
const ORANGE_PRIMARY = '#f36f21';
const ORANGE_FAINT = '#fff1e6';

const randomKey = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// base64 -> Uint8Array
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

  const loadForMe = async () => {
    if (!residentId) return;
    const { data: profile, error } = await supabase
      .from('fc_profiles')
      .select('id, temp_id, name')
      .eq('resident_id_masked', residentId)
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
    if (!fc) {
      Alert.alert('프로필 확인', '내 정보가 불러와지지 않았습니다.');
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (!asset?.uri) {
      Alert.alert('파일 오류', '파일 경로를 찾을 수 없습니다.');
      return;
    }

    setUploadingType(type as string);
    try {
      const fileBase64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
      const byteArray = base64ToUint8Array(fileBase64);

      const objectPath = `${fc.id}/${randomKey()}.pdf`; // UUID 형태 경로

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

      // 알림: FC 업로드 -> 관리자
      await supabase.functions.invoke('fc-notify', {
        body: {
          type: 'fc_update',
          fc_id: fc.id,
          message: `${fc.name ?? ''}님의 ${asset.name ?? '문서'}가 업로드되었습니다.`,
        },
      });

      setDocs((prev) =>
        prev.map((doc) =>
          doc.type === type
            ? {
                ...doc,
                uploadedUrl: publicUrl,
                status: 'pending',
                reviewerNote: undefined,
                storagePath: objectPath,
                originalName: asset.name ?? 'document.pdf',
              }
            : doc,
        ),
      );

      Alert.alert('업로드 완료', `${type} 업로드: ${asset.name ?? 'document.pdf'}`);
    } catch (err: any) {
      Alert.alert('업로드 실패', err?.message ?? '업로드 중 오류가 발생했습니다.');
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
          doc.type === type
            ? {
                ...doc,
                uploadedUrl: undefined,
                storagePath: undefined,
                status: 'pending',
                reviewerNote: undefined,
                originalName: undefined,
              }
            : doc,
        ),
      );
      Alert.alert('삭제 완료', '파일이 삭제되었습니다.');
    } catch (err: any) {
      Alert.alert('삭제 실패', err?.message ?? '삭제 중 오류가 발생했습니다.');
    }
  };

  return (
  <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 96 }]}
          keyboardShouldPersistTaps="handled">
          <RefreshButton />
          <Text style={styles.title}>필요 서류를 제출해 주세요</Text>
          <Text style={styles.caption}>
            요청된 서류를 확인하고 PDF를 업로드하세요. (완료 {docCount.uploaded}/{docCount.total}개)
          </Text>
          {fc?.temp_id ? <Text style={styles.temp}>임시번호 {fc.temp_id}</Text> : null}
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>제출 진행률</Text>
            <Text style={styles.summaryValue}>
              {docCount.uploaded} / {docCount.total} 완료
            </Text>
          </View>

          <View style={styles.cardList}>
            {docs.map((doc) => {
              const isUploaded = !!doc.uploadedUrl;
              const isUploading = uploadingType === doc.type;
              return (
                <View key={doc.type} style={[styles.card, isUploaded ? styles.cardOn : null]}>
                  <View style={styles.row}>
                    <View>
                      <Text style={styles.docTitle}>{doc.type}</Text>
                      <Text style={styles.docHint}>
                        {isUploaded
                          ? doc.originalName
                            ? `파일: ${doc.originalName}`
                            : '업로드가 완료되었습니다.'
                          : 'PDF 파일을 업로드해 주세요.'}
                      </Text>
                    </View>
                    <Text style={[styles.badge, isUploaded ? styles.badgeDone : styles.badgePending]}>
                      {isUploaded ? '완료' : '대기'}
                    </Text>
                  </View>
                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => handlePick(doc.type)}
                      disabled={isUploading}
                      style={[
                        styles.actionPrimary,
                        isUploaded ? styles.actionPrimaryGhost : null,
                        isUploading ? styles.disabled : null,
                      ]}>
                      <Text style={isUploaded ? styles.actionPrimaryGhostText : styles.actionPrimaryText}>
                        {isUploaded ? '다시 선택' : 'PDF 선택'}
                      </Text>
                    </Pressable>
                    {isUploaded ? (
                      <Pressable
                        onPress={() => handleDelete(doc.type, doc.storagePath)}
                        disabled={isUploading}
                        style={[styles.actionSecondary, isUploading ? styles.disabled : null]}>
                        <Text style={styles.actionSecondaryText}>삭제</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
            {!docs.length ? <Text style={styles.empty}>요청된 문서가 없습니다. 새로고침 해주세요.</Text> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff9f3' },
  container: { padding: 20, gap: 14 },
  title: { fontSize: 24, fontWeight: '800', color: SLATE, marginTop: 4 },
  caption: { color: MUTED, marginBottom: 6, lineHeight: 20 },
  summary: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  summaryTitle: { color: MUTED, fontWeight: '700' },
  summaryValue: { color: SLATE, fontWeight: '800' },
  cardList: { gap: 12, marginTop: 4 },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardOn: { borderColor: ORANGE_PRIMARY, backgroundColor: ORANGE_FAINT },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  docTitle: { fontWeight: '800', color: SLATE, fontSize: 16 },
  docHint: { color: MUTED, marginTop: 4 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontSize: 12,
    overflow: 'hidden',
  },
  badgePending: { backgroundColor: '#fff7ed', color: '#b45309' },
  badgeDone: { backgroundColor: '#dcfce7', color: '#166534' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionPrimary: {
    flex: 1,
    backgroundColor: ORANGE_PRIMARY,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionPrimaryText: { color: '#fff', fontWeight: '800' },
  actionPrimaryGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: ORANGE_PRIMARY },
  actionPrimaryGhostText: { color: ORANGE_PRIMARY, fontWeight: '800' },
  actionSecondary: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
    backgroundColor: '#fff',
  },
  actionSecondaryText: { color: '#b91c1c', fontWeight: '700' },
  disabled: { opacity: 0.6 },
  temp: { color: SLATE, fontWeight: '700' },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 20 },
});
