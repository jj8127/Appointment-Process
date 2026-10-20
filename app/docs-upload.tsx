import { useReadAttempt } from '@/lib/use-read-attempt';
import { useReadSessionScope } from '@/hooks/use-read-session-scope';
import { invokeAdminAction } from '@/lib/admin-action-api';
import { ProfileReadState } from '@/components/ProfileReadState';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BrandedLoadingSpinner from '@/components/BrandedLoadingSpinner';
import { Button } from '@/components/Button';
import { OnboardingStepNowCard } from '@/components/OnboardingStepNowCard';
import { RefreshButton } from '@/components/RefreshButton';
import { useIdentityGate } from '@/hooks/use-identity-gate';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import {
  combineFcNotifyDeliveryResults,
  invokeFcNotifyForDelivery,
} from '@/lib/fc-notify-client';
import { presentPostCommitNotificationDelivery } from '@/lib/fc-notify-post-commit';
import { returnTo } from '@/lib/back-navigation';
import { logger } from '@/lib/logger';
import { getDocsStepNow } from '@/lib/onboarding-step-now';
import { INSURANCE_HOME_ROUTE } from '@/lib/service-home';
import { NotificationReceiptStatusBanner } from '@/lib/notification-receipt-ui';
import { openExternalUrl } from '@/lib/open-external-url';
import {
  hasPresentRouteParam,
  parseExactlyOneUuidRouteParam,
} from '@/lib/strict-route-params';
import { createRealtimeChannelTopic } from '@/lib/realtime-channel-topic';
import { supabase } from '@/lib/supabase';
import { COLORS } from '@/lib/theme';
import { useNotificationReceiptCompletion } from '@/lib/use-notification-receipt';
import { RequiredDoc } from '@/types/fc';
import { requireMutationRowReceipt } from '../supabase/functions/_shared/ux-mutation-contract';
import { collectSupabaseRows } from '@/lib/supabase-query-contract';

type FcLite = { id: string; temp_id: string | null; name: string; status: string; docs_deadline_at?: string | null };
type DocItem = RequiredDoc & { storagePath?: string; originalName?: string };
type DocumentRow = {
  doc_type: string;
  storage_path: string | null;
  status: string | null;
  reviewer_note: string | null;
  file_name: string | null;
};

const BUCKET = 'fc-documents';
const HANWHA_HANDOFF_STATUS = 'docs-approved';
const DOC_WORKFLOW_RESET_FIELDS = {
  hanwha_commission_date_sub: null,
  hanwha_commission_date: null,
  hanwha_commission_reject_reason: null,
  hanwha_commission_pdf_path: null,
  hanwha_commission_pdf_name: null,
  appointment_url: null,
  appointment_date: null,
  appointment_schedule_life: null,
  appointment_schedule_nonlife: null,
  appointment_date_life: null,
  appointment_date_nonlife: null,
  appointment_date_life_sub: null,
  appointment_date_nonlife_sub: null,
  appointment_reject_reason_life: null,
  appointment_reject_reason_nonlife: null,
  life_commission_completed: false,
  nonlife_commission_completed: false,
} as const;

const randomKey = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const normalizeDocStatus = (status: string | null | undefined): DocItem['status'] => {
  if (status === 'approved' || status === 'rejected' || status === 'pending') {
    return status;
  }
  return undefined;
};

const isDocumentRow = (value: unknown): value is DocumentRow => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.doc_type === 'string'
    && row.doc_type.trim().length > 0
    && (row.storage_path === null || typeof row.storage_path === 'string')
    && (row.status === null || typeof row.status === 'string')
    && (row.reviewer_note === null || typeof row.reviewer_note === 'string')
    && (row.file_name === null || typeof row.file_name === 'string');
};

async function loadAllDocuments(fcId: string): Promise<DocumentRow[]> {
  return collectSupabaseRows<DocumentRow>({
    queryName: 'fc_documents',
    fetchPage: (from, to) => supabase
      .from('fc_documents')
      .select('doc_type, storage_path, status, reviewer_note, file_name')
      .eq('fc_id', fcId)
      .order('doc_type', { ascending: true })
      .range(from, to),
    isRow: isDocumentRow,
    rowKey: (row) => row.doc_type,
  });
}

async function sendNotificationAndPush(
  role: 'admin' | 'fc',
  residentId: string | null,
  title: string,
  body: string,
  fcId: string,
  url?: string,
) {
  return invokeFcNotifyForDelivery({
    type: 'notify',
    target_role: role,
    target_id: residentId,
    title,
    body,
    category: 'app_event',
    url,
    target: {
      version: 1,
      kind: 'onboarding_section',
      fcId,
      section: 'docs_upload',
    },
  });
}

export default function DocsUploadScreen() {
  const scope = useReadSessionScope();
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const target = parseExactlyOneUuidRouteParam(userId) ?? (hasPresentRouteParam(userId) ? 'invalid' : 'own');
  return <DocsUploadScreenContent key={`${scope}:${target}`} />;
}

function DocsUploadScreenContent() {
  const { residentId, role } = useSession();
  const { destinationAccepted: identityGateAccepted } =
    useIdentityGate({ nextPath: '/docs-upload' });
  const router = useRouter();
  const { userId, notificationId, notificationTarget } =
    useLocalSearchParams<{
      userId?: string;
      notificationId?: string;
      notificationTarget?: string;
    }>();
  const isAdmin = role === 'admin';
  const routeUserId = parseExactlyOneUuidRouteParam(userId);
  const hasInvalidUserRoute =
    hasPresentRouteParam(userId) && !routeUserId;
  const [fc, setFc] = useState<FcLite | null>(null);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [cleanupStatusError, setCleanupStatusError] = useState(false);
  const deletingRef = useRef(false);
  const [deletingType, setDeletingType] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [approvingAction, setApprovingAction] = useState<'approve' | 'reject' | null>(null);
  const approvingRef = useRef(false);
  const [openingType, setOpeningType] = useState<string | null>(null);
  const pickingRef = useRef(false);
  const uploadingRef = useRef(false);
  const storageDebuggedRef = useRef(false);
  const keyboardPadding = useKeyboardPadding();
  const [refreshing, setRefreshing] = useState(false);
  const [profileLoadState, setProfileLoadState] = useState<
    'loading' | 'success' | 'error'
  >('loading');

  const docCount = useMemo(
    () => ({ uploaded: docs.filter((d) => d.storagePath).length, total: docs.length }),
    [docs],
  );

  const progressPercent = docCount.total > 0 ? (docCount.uploaded / docCount.total) * 100 : 0;
  const isDocsApproved = fc?.status === HANWHA_HANDOFF_STATUS;
  const footerRoute = !isAdmin && isDocsApproved ? '/hanwha-commission' : INSURANCE_HOME_ROUTE;
  const footerLabel = !isAdmin && isDocsApproved ? '다위촉 URL 단계로 이동' : '홈으로 가기';
  // Home is a parent screen: go back to it rather than stacking another copy; the next step opens forward.
  const openFooterRoute = () => (footerRoute === INSURANCE_HOME_ROUTE ? returnTo(router, footerRoute) : router.replace(footerRoute as any));
  const stepNow = getDocsStepNow({
    handedOff: isDocsApproved,
    docs: docs.map((doc) => ({ status: doc.status, hasFile: Boolean(doc.storagePath) })),
  });

  const beginRead = useReadAttempt();
  const beginMutation = useReadAttempt();
  const loadData = useCallback(async () => {
    const isCurrentRead = beginRead();
    if (!isCurrentRead()) return;
    try {
      setProfileLoadState('loading');
      if (hasInvalidUserRoute) {
        setFc(null);
        setDocs([]);
        setProfileLoadState('error');
        return;
      }
      let targetId: string | null = null;
      if (isAdmin && routeUserId) {
        targetId = routeUserId;
      } else if (residentId) {
        const { data: profileId, error: idErr } = await supabase
          .from('fc_profiles')
          .select('id')
          .eq('phone', residentId)
          .maybeSingle();
      if (!isCurrentRead()) return;
        if (idErr) throw idErr;
        targetId = profileId?.id ?? null;
      }
      if (!targetId) {
        setFc(null);
        setDocs([]);
        setProfileLoadState('error');
        return;
      }

      const { data: profile, error } = await supabase
        .from('fc_profiles')
        .select('id, temp_id, name, status, docs_deadline_at')
        .eq('id', targetId)
        .maybeSingle();
      if (!isCurrentRead()) return;
      if (error) throw error;
      if (!profile) {
        setFc(null);
        setDocs([]);
        setProfileLoadState('error');
        return;
      }

      const requirements = await loadAllDocuments(targetId);
      if (!isCurrentRead()) return;

      const reqDocs: DocItem[] = requirements.map((r) => {
        const hasFile = r.storage_path && r.storage_path !== 'deleted';
        const normalizedStatus = normalizeDocStatus(r.status) ?? 'pending';
        return {
          type: r.doc_type,
          required: true,
          uploadedUrl: undefined,
          status: normalizedStatus,
          reviewerNote: r.reviewer_note ?? undefined,
          storagePath: hasFile ? r.storage_path ?? undefined : undefined,
          originalName: hasFile ? r.file_name ?? undefined : undefined,
        };
      });

      const statusRank = (doc: DocItem) => {
        if (doc.status === 'rejected') return -1; // 반려됨: 다시 올릴 서류가 맨 위
        if (doc.status === 'approved') return 2; // 승인됨
        if (!doc.storagePath) return 0; // 미제출
        return 1; // 미승인 (제출됨)
      };
      reqDocs.sort((a, b) => statusRank(a) - statusRank(b));

      setFc(profile as FcLite);
      setDocs(reqDocs);
      setProfileLoadState('success');
      try {
        const cleanup = await invokeAdminAction<{ cleanupPending: boolean }>(residentId ?? '', isAdmin ? 'getDocumentCleanupStatus' : 'getOwnDocumentCleanupStatus', { fcId: targetId });
        if (!isCurrentRead()) return;
        if (typeof cleanup.cleanupPending !== 'boolean') throw new Error('cleanup_state_unverified');
        setCleanupPending(cleanup.cleanupPending);
        setCleanupStatusError(false);
      } catch {
        if (isCurrentRead()) setCleanupStatusError(true);
      }
    } catch (err: any) {
      if (!isCurrentRead()) return;
      setProfileLoadState('error');
      Alert.alert('조회 오류', err?.message ?? '정보를 불러오지 못했습니다.');
    }
  }, [beginRead, hasInvalidUserRoute, isAdmin, residentId, routeUserId]);

  useEffect(() => {
    loadData();
  }, [loadData]);
  const notificationReceipt = useNotificationReceiptCompletion({
    params: { notificationId, notificationTarget },
    expectedTarget: fc?.id
      ? {
          version: 1,
          kind: 'onboarding_section',
          fcId: fc.id,
          section: 'docs_upload',
        }
      : null,
    loadState: identityGateAccepted ? profileLoadState : 'loading',
  });

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
      .channel(createRealtimeChannelTopic('docs-upload-documents'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fc_documents', filter: `fc_id=eq.${fc.id}` },
        () => loadData(),
      )
      .subscribe();

    const profileChannel = supabase
      .channel(createRealtimeChannelTopic('docs-upload-profile'))
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
    if (pickingRef.current || uploadingRef.current) return;
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

    uploadingRef.current = true;
    setUploadingType(type as string);
    let uploadStateCleared = false;
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

      const fileName = asset.name ?? 'document.pdf';
      const documentMutation = {
        fc_id: fc.id,
        doc_type: type,
        storage_path: objectPath,
        file_name: fileName,
        status: 'pending',
        reviewer_note: null,
      } as const;
      const { data: documentReceipt, error: dbError } = await supabase.from('fc_documents').upsert(
        {
          ...documentMutation,
        },
        { onConflict: 'fc_id,doc_type' },
      )
        .select('fc_id,doc_type,storage_path,file_name,status,reviewer_note')
        .maybeSingle();
      if (dbError) {
        logger.warn('[upload] db upsert error', { error: dbError.message });
        throw dbError;
      }
      requireMutationRowReceipt(documentReceipt, documentMutation);

      const { data: profileReceipt, error: profileUpdateError } = await supabase
        .from('fc_profiles')
        .update({ status: 'docs-pending' })
        .eq('id', fc.id)
        .select('id,status')
        .maybeSingle();
      if (profileUpdateError) throw profileUpdateError;
      requireMutationRowReceipt(profileReceipt, { id: fc.id, status: 'docs-pending' });
      const markUploaded = (doc: DocItem): DocItem =>
        doc.type === type
          ? {
            ...doc,
            status: 'pending',
            storagePath: objectPath,
            originalName: fileName,
          }
          : doc;
      const updatedDocs: DocItem[] = docs.map(markUploaded);
      setDocs((previous) => previous.map(markUploaded));

      const nameLabel = fc.name || 'FC';
      const notificationJobs = [
        () => sendNotificationAndPush(
          'admin',
          null,
          `${nameLabel}님이 ${type}을 제출했습니다.`,
          `${nameLabel}님이 ${type}을 업로드했습니다.`,
          fc.id,
          '/dashboard',
        ),
      ];
      const uploadedCount = updatedDocs.filter((d) => d.storagePath).length;
      if (uploadedCount === updatedDocs.length && updatedDocs.length > 0) {
        notificationJobs.push(
          () => sendNotificationAndPush(
            'admin',
            null,
            `${nameLabel}님이 모든 서류를 제출했습니다.`,
            `${nameLabel}님이 모든 필수 서류를 업로드했습니다.`,
            fc.id,
            '/dashboard',
          ),
        );
      }

      const deliverNotifications = () =>
        Promise.all(notificationJobs.map((notify) => notify()));
      const deliveryResults = await deliverNotifications();
      let retryableNotificationIndexes = deliveryResults
        .map((delivery, index) =>
          !delivery.confirmed && delivery.notificationStored === false
            ? index
            : -1
        )
        .filter((index) => index >= 0);
      const retryFailedNotifications = async () => {
        if (retryableNotificationIndexes.length === 0) {
          return combineFcNotifyDeliveryResults(deliveryResults);
        }
        const retryResults = await Promise.all(
          retryableNotificationIndexes.map((index) => notificationJobs[index]()),
        );
        retryableNotificationIndexes = retryableNotificationIndexes.filter(
          (_index, resultIndex) =>
            !retryResults[resultIndex].confirmed
            && retryResults[resultIndex].notificationStored === false,
        );
        return combineFcNotifyDeliveryResults(retryResults);
      };

      uploadingRef.current = false;
      setUploadingType(null);
      uploadStateCleared = true;
      logger.debug('[upload] success', { objectPath });
      presentPostCommitNotificationDelivery({
        delivery: combineFcNotifyDeliveryResults(deliveryResults),
        retryNotification: retryFailedNotifications,
        successTitle: '등록 완료',
        successMessage:
          uploadedCount === updatedDocs.length && updatedDocs.length > 0
            ? '모든 필수 서류가 제출되었습니다.'
            : '파일이 정상적으로 등록되었습니다.',
        notificationLabel: '관리자',
      });
    } catch (err: any) {
      logger.warn('[upload] failed', { bucket: BUCKET, error: err?.message ?? err });
      Alert.alert('오류', err?.message ?? '업로드 실패');
    } finally {
      if (!uploadStateCleared) {
        uploadingRef.current = false;
        setUploadingType(null);
      }
    }
  };

  const handleDelete = (type: string, storagePath?: string) => {
    if (!fc || deletingRef.current || uploadingType || profileLoadState !== 'success') return;
    if (docs.find((doc) => doc.type === type)?.status === 'approved') {
      Alert.alert('삭제 불가', '승인된 서류는 삭제할 수 없습니다.'); return;
    }
    const targetId = fc.id;
    const isCurrentMutation = beginMutation();
    Alert.alert('서류 삭제 확인', '제출한 파일을 삭제하면 서류가 미제출 상태로 바뀌고 이후 위촉 일정·완료 정보가 초기화됩니다. 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => {
        if (deletingRef.current || !isCurrentMutation()) return;
        deletingRef.current = true; setDeletingType(type);
        try {
          const result = await invokeAdminAction<{ cleanupPending: boolean }>(residentId ?? '', isAdmin ? 'deleteDocFile' : 'removeOwnDocument', {
            fcId: targetId, docType: type, storagePath,
          });
          if (!isCurrentMutation()) return;
          setDocs((previous) => previous.map((doc) => doc.type === type ? { ...doc, storagePath: undefined, uploadedUrl: undefined, originalName: undefined, status: 'pending' } : doc));
          setFc((previous) => previous ? { ...previous, status: 'docs-pending', ...DOC_WORKFLOW_RESET_FIELDS } : previous);
          setCleanupPending(result.cleanupPending);
          Alert.alert('서류 삭제 완료', result.cleanupPending ? '서류 상태는 변경되었습니다. 물리 파일 정리가 보류되었습니다. 화면의 파일 정리 재시도로 마무리할 수 있습니다.' : '제출 파일을 삭제하고 서류 상태를 변경했습니다.');
          await loadData();
        } catch {
          if (!isCurrentMutation()) return;
          Alert.alert('삭제 확인 필요', '삭제 결과를 확인하지 못했습니다. 새로 불러온 상태를 확인하고 다시 시도해 주세요.');
          await loadData();
        } finally { if (isCurrentMutation()) { deletingRef.current = false; setDeletingType(null); } }
      } },
    ]);
  };

  const retryCleanup = async () => {
    if (!fc || deletingRef.current) return;
    const isCurrentMutation = beginMutation();
    if (!isCurrentMutation()) return;
    deletingRef.current = true;
    setDeletingType('cleanup');
    try {
      const result = await invokeAdminAction<{ cleanupPending: boolean }>(residentId ?? '', isAdmin ? 'retryDocumentCleanup' : 'retryOwnDocumentCleanup', { fcId: fc.id });
      if (!isCurrentMutation()) return;
      setCleanupPending(result.cleanupPending);
      setCleanupStatusError(false);
      Alert.alert(result.cleanupPending ? '파일 정리 보류' : '파일 정리 완료', result.cleanupPending ? '서류 상태는 이미 변경되었습니다. 연결을 확인한 뒤 파일 정리만 다시 시도해 주세요.' : '삭제한 서류의 물리 파일 정리를 마쳤습니다.');
    } catch {
      if (!isCurrentMutation()) return;
      setCleanupStatusError(true);
      Alert.alert('파일 정리 확인 필요', '정리 결과를 확인하지 못했습니다. 연결을 확인한 뒤 파일 정리만 다시 시도해 주세요.');
    } finally {
      if (isCurrentMutation()) { deletingRef.current = false; setDeletingType(null); }
    }
  };

  const handleApprove = async (isApprove: boolean) => {
    if (!fc || approvingRef.current) return;
    approvingRef.current = true;
    setApprovingAction(isApprove ? 'approve' : 'reject');
    try {
      const nextProfilePatch = isApprove
        ? { status: HANWHA_HANDOFF_STATUS }
        : {
            status: 'docs-pending',
            ...DOC_WORKFLOW_RESET_FIELDS,
          };

      await invokeAdminAction(residentId ?? '', 'updateStatus', {
        fcId: fc.id,
        status: nextProfilePatch.status,
      });

      setFc((prev) => (prev ? { ...prev, ...nextProfilePatch } : prev));
      Alert.alert(
        '완료',
        isApprove
          ? '서류 검토가 완료되었습니다. 다음 단계는 생명/손해 위촉이 아니라 다위촉 URL입니다.'
            : '서류가 반려되었습니다. 다시 검토가 필요합니다.',
        [
          { text: '확인', onPress: () => router.back() },
        ],
      );
    } catch (err: any) {
      Alert.alert('오류', err?.message ?? '상태 업데이트 실패');
    } finally {
      approvingRef.current = false;
      setApprovingAction(null);
    }
  };

  if (profileLoadState !== 'success' && !(!!fc)) return (
    <SafeAreaView style={{ flex: 1 }}><ProfileReadState state={profileLoadState} retained={false} onRetry={() => void loadData()} /></SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <ProfileReadState state={profileLoadState} retained={!!fc} onRetry={() => void loadData()} />
      {cleanupPending || cleanupStatusError ? <Button disabled={!!deletingType} onPress={retryCleanup}>
        {deletingType === 'cleanup' ? '파일 정리 중' : cleanupStatusError ? '파일 정리 상태 확인·재시도' : '파일 정리 재시도'}
      </Button> : null}

      <NotificationReceiptStatusBanner
        state={notificationReceipt.state}
        onRetry={() => void notificationReceipt.retryMarkRead()}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {isAdmin ? (
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
              <Text style={styles.adminHelperText}>
                승인 시 FC는 생명/손해 위촉으로 바로 가지 않고 다위촉 URL 단계로 넘어갑니다.
              </Text>
              <View style={styles.adminActionRow}>
                <Button
                  onPress={() => handleApprove(false)}
                  disabled={!!approvingAction || !!uploadingType || !!deletingType}
                  loading={approvingAction === 'reject'}
                  variant="outline"
                  size="lg"
                  style={{ flex: 1, borderColor: '#ef4444', backgroundColor: '#fff' }}
                >
                  반려
                </Button>
                <Button
                  onPress={() => handleApprove(true)}
                  disabled={!!approvingAction || !!uploadingType || !!deletingType}
                  loading={approvingAction === 'approve'}
                  variant="primary"
                  size="lg"
                  style={{ flex: 1 }}
                >
                  다위촉 URL 단계로 승인
                </Button>
              </View>
            </View>
          )}

          {isDocsApproved && (
            <View style={styles.handoffBox}>
                <Text style={styles.handoffTitle}>
                  {isAdmin ? '다위촉 URL 단계 인계 완료' : '서류 승인 완료'}
                </Text>
              <Text style={styles.handoffText}>
                {isAdmin
                  ? '이 FC의 다음 단계는 생명/손해 위촉이 아니라 다위촉 URL입니다.'
                  : '다음 단계는 생명/손해 위촉이 아니라 다위촉 URL입니다. 다위촉 URL 완료일 제출과 서류 발송 알림을 먼저 진행해주세요.'}
              </Text>
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
        ) : null}

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: keyboardPadding + 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
        >
          {!isAdmin ? (
            <OnboardingStepNowCard
              step={2}
              now={fc?.docs_deadline_at && stepNow.tone !== 'done'
                ? { ...stepNow, detail: [stepNow.detail, `마감 ${fc.docs_deadline_at}`].filter(Boolean).join(' · ') }
                : stepNow}
              action={isDocsApproved ? { label: footerLabel, onPress: () => openFooterRoute() } : undefined}
            />
          ) : null}
          <View style={styles.list}>
            {docs.map((doc) => {
              const isUploaded = !!doc.storagePath;
              const isUploading = uploadingType === doc.type;
              const isLocked = doc.status === 'approved';
              const isRejected = doc.status === 'rejected';

              return (
                <View key={doc.type} style={[styles.card, isRejected && styles.cardRejected]}>
                  <View style={styles.cardTopRow}>
                    {/* left icon */}
                    <View style={styles.cardIcon}>
                      <Feather name="file-text" size={18} color={COLORS.primaryButton} />
                    </View>

                    {/* title + filename */}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.cardTitleRow}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{doc.type}</Text>

                        {/* status chip */}
                        {isUploaded || isLocked || isRejected ? (
                          <View
                            style={[
                              styles.chip,
                              isLocked ? styles.chipApproved : isRejected ? styles.chipRejected : styles.chipSubmitted,
                            ]}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                { color: isLocked ? '#047857' : isRejected ? '#B91C1C' : '#9a3412' },
                              ]}
                            >
                              {isLocked ? '승인됨' : isRejected ? '반려됨' : '확인 중'}
                            </Text>
                          </View>
                        ) : (
                          <View style={[styles.chip, styles.chipPending]}>
                            <Text style={[styles.chipText, { color: COLORS.text.secondary }]}>제출 필요</Text>
                          </View>
                        )}
                      </View>

                      <Text style={styles.cardFileName} numberOfLines={1}>
                        {isUploaded
                          ? (doc.originalName ?? '파일 있음')
                          : isLocked
                            ? '총무 수동 승인: 파일 미제출'
                            : isRejected
                              ? '파일 없이 반려됨'
                              : 'PDF 파일을 업로드해주세요'}
                      </Text>

                      {!!doc.reviewerNote && !isRejected && (
                        <Text style={styles.cardNote} numberOfLines={2}>
                          <Text style={styles.cardNoteLabel}>검토 메모: </Text>
                          <Text style={styles.cardNoteText}>{doc.reviewerNote}</Text>
                        </Text>
                      )}
                    </View>
                  </View>

                  {isRejected && !!doc.reviewerNote && (
                    <View style={styles.rejectBox}>
                      <Text style={styles.rejectLabel}>반려 사유</Text>
                      <Text style={styles.rejectText}>{doc.reviewerNote}</Text>
                    </View>
                  )}

                  {/* action bar */}
                  <View style={styles.cardActions}>
                    {isUploaded && (
                      <Pressable
                        style={({ pressed }) => [
                          styles.btnGhost,
                          openingType === doc.type && styles.btnDisabled,
                          pressed && styles.pressed,
                        ]}
                        disabled={openingType === doc.type}
                        onPress={() => {
                          if (!doc.storagePath || openingType) return;
                          logger.debug('[storage] open file', {
                            bucket: BUCKET,
                            storagePath: doc.storagePath,
                            uploadedUrl: doc.uploadedUrl,
                          });
                          setOpeningType(doc.type);
                          (async () => {
                            try {
                              const { data: signed, error } = await supabase.storage
                                .from(BUCKET)
                                .createSignedUrl(doc.storagePath!, 300);
                              if (error || !signed?.signedUrl) {
                                Alert.alert('파일 열기 실패', error?.message ?? '링크 생성에 실패했습니다.');
                                return;
                              }
                              await openExternalUrl(signed.signedUrl).catch(() => {
                                Alert.alert('파일 열기 실패', '링크를 열 수 없습니다.');
                              });
                            } finally {
                              setOpeningType(null);
                            }
                          })();
                        }}
                      >
                        {openingType === doc.type ? (
                          <BrandedLoadingSpinner size="sm" color={COLORS.text.primary} />
                        ) : (
                          <Feather name="external-link" size={16} color={COLORS.text.primary} />
                        )}
                        <Text style={styles.btnGhostText}>열기</Text>
                      </Pressable>
                    )}

                    {!isLocked ? <Pressable
                      style={({ pressed }) => [
                        styles.btnSecondary,
                        isRejected && styles.btnRetry,
                        (!!uploadingType || isLocked) && styles.btnDisabled,
                        pressed && !isLocked && !uploadingType && styles.pressed,
                      ]}
                      onPress={() => handlePick(doc.type)}
                      disabled={!!uploadingType || isLocked || !!deletingType || profileLoadState !== 'success'}
                    >
                      {isUploading ? (
                        <BrandedLoadingSpinner size="sm" color={COLORS.primary} />
                      ) : (
                        <>
                          <Feather name="upload" size={16} color={isRejected ? '#fff' : COLORS.primaryButton} />
                          <Text style={[styles.btnSecondaryText, isRejected && styles.btnRetryText]}>
                            {isLocked ? '승인 완료' : isRejected ? '다시 올리기' : isUploaded ? '재업로드' : '파일 선택'}
                          </Text>
                        </>
                      )}
                    </Pressable> : null}

                    {isUploaded && !isLocked && (
                      <Pressable
                        style={({ pressed }) => [styles.iconDanger, pressed && styles.pressed]}
                        onPress={() => handleDelete(doc.type, doc.storagePath)}
                        disabled={isUploading || isLocked || !!deletingType || profileLoadState !== 'success'}
                      >
                        {deletingType === doc.type ? <Text>삭제 중</Text> : null}
                        <Feather name="trash-2" size={18} color="#EF4444" />
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
            {!docs.length && isAdmin && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>요청된 서류가 없습니다.</Text>
              </View>
            )}
          </View>
          {isAdmin || !isDocsApproved ? <Button
            onPress={() => openFooterRoute()}
            variant="primary"
            size="lg"
            fullWidth
            style={{ marginTop: 12, marginBottom: 24 }}
          >
            {footerLabel}
          </Button> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f3f4f6' },

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
  adminHelperText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#9a3412',
  },
  adminActionRow: { flexDirection: 'row', gap: 10 },
  handoffBox: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FDBA74',
    gap: 6,
  },
  handoffTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#9A3412',
  },
  handoffText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#9A3412',
  },

  scrollContent: { padding: 16 },


  list: { gap: 12 },

  emptyState: { padding: 20, alignItems: 'center' },
  emptyText: { color: COLORS.text.secondary, fontSize: 14 },

  btnDisabled: { opacity: 0.55 },

  // Modern Card Styles
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    gap: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  cardRejected: { borderColor: '#fecaca' },
  rejectBox: { padding: 12, borderRadius: 12, borderLeftWidth: 3, borderLeftColor: COLORS.error, backgroundColor: COLORS.gray[50] },
  rejectLabel: { fontSize: 12, fontWeight: '800', color: '#b91c1c' },
  rejectText: { marginTop: 4, fontSize: 15, lineHeight: 22, color: COLORS.gray[800] },
  btnRetry: { backgroundColor: COLORS.primaryButton, borderColor: COLORS.primaryButton },
  btnRetryText: { color: '#fff' },

  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },

  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#fdf3ea',
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
    paddingVertical: 4,
    borderRadius: 999,
  },

  chipPending: { backgroundColor: COLORS.gray[100] },
  chipSubmitted: { backgroundColor: COLORS.primaryPale },
  chipApproved: { backgroundColor: '#ecfdf5' },
  chipRejected: { backgroundColor: '#fef2f2' },

  chipText: {
    fontSize: 12,
    fontWeight: '800',
  },

  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    backgroundColor: COLORS.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  btnSecondaryText: {
    color: COLORS.primaryButton,
    fontSize: 14,
    fontWeight: '800',
  },
});
