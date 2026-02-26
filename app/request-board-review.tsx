import { Feather } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/BottomNavigation';
import { useSession } from '@/hooks/use-session';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { logger } from '@/lib/logger';
import {
  rbApproveDesign,
  rbGetRequestDetail,
  rbRejectDesign,
  type RbDesignerAssignment,
  type RbRequestDetail,
} from '@/lib/request-board-api';
import { COLORS, RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '@/lib/theme';

/* ─── Helpers ─── */

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

const ASSIGNMENT_STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '수락 대기', color: '#F59E0B', bg: '#FEF3C7' },
  accepted: { label: '진행중', color: '#3B82F6', bg: '#EFF6FF' },
  completed: { label: '설계 완료', color: '#8B5CF6', bg: '#EDE9FE' },
  rejected: { label: '거절', color: '#EF4444', bg: '#FEE2E2' },
  cancelled: { label: '취소', color: COLORS.gray[500], bg: COLORS.gray[100] },
};

const REQUEST_STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '수락 대기', color: '#F59E0B', bg: '#FEF3C7' },
  in_progress: { label: '진행중', color: '#3B82F6', bg: '#EFF6FF' },
  completed: { label: '완료', color: '#10B981', bg: '#ECFDF5' },
  cancelled: { label: '취소', color: COLORS.gray[500], bg: COLORS.gray[100] },
};

const getProductNames = (detail: RbRequestDetail): string => {
  const names = (detail.request_products ?? [])
    .map((rp) => rp.insurance_products?.name)
    .filter(Boolean) as string[];
  return names.length > 0 ? names.join(', ') : '종목 없음';
};

/* ─── Sub-components ─── */

function StatusBadge({ status, label, color, bg }: { status: string; label: string; color: string; bg: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

/* ─── Component ─── */

export default function RequestBoardReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { role, readOnly, hydrated, isRequestBoardDesigner } = useSession();

  const [detail, setDetail] = useState<RbRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /* Reject modal */
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const requestId = id ? parseInt(id, 10) : null;

  const fetchData = useCallback(async () => {
    if (!requestId) return;
    setFetchError(null);
    try {
      const data = await rbGetRequestDetail(requestId);
      setDetail(data);
      if (!data) setFetchError('의뢰 정보를 불러오는데 실패했습니다.');
    } catch (err) {
      logger.warn('[review] fetch failed', err);
      setFetchError('의뢰 정보를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ─── Actions ─── */

  const handleApprove = (assignment: RbDesignerAssignment) => {
    const designerName = assignment.designers?.users?.name ?? '설계 매니저';
    Alert.alert(
      '설계 승인',
      `${designerName}의 설계를 승인하시겠습니까?\n승인 후에는 취소할 수 없습니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '승인',
          style: 'default',
          onPress: async () => {
            if (!requestId) return;
            setSubmitting(true);
            try {
              const res = await rbApproveDesign(requestId, assignment.designer_id);
              if (res.success) {
                Alert.alert('승인 완료', '설계가 승인되었습니다.');
                await fetchData();
              } else {
                Alert.alert('오류', res.error ?? '승인 처리 중 오류가 발생했습니다.');
              }
            } catch (err) {
              logger.warn('[review] approve failed', err);
              Alert.alert('오류', '승인 처리 중 오류가 발생했습니다.');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  const handleRejectOpen = (assignment: RbDesignerAssignment) => {
    setRejectTargetId(assignment.designer_id);
    setRejectReason('');
    setRejectModalVisible(true);
  };

  const handleRejectConfirm = async () => {
    if (!requestId || !rejectTargetId) return;
    const trimmed = rejectReason.trim();
    if (!trimmed) {
      Alert.alert('거절 사유 필요', '거절 사유를 입력해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await rbRejectDesign(requestId, rejectTargetId, trimmed);
      if (res.success) {
        setRejectModalVisible(false);
        Alert.alert('거절 완료', '설계가 거절되었습니다.');
        await fetchData();
      } else {
        Alert.alert('오류', res.error ?? '거절 처리 중 오류가 발생했습니다.');
      }
    } catch (err) {
      logger.warn('[review] reject failed', err);
      Alert.alert('오류', '거절 처리 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenFile = async (fileUrl: string) => {
    try {
      const supported = await Linking.canOpenURL(fileUrl);
      if (supported) {
        await Linking.openURL(fileUrl);
      } else {
        Alert.alert('열기 실패', '파일을 열 수 없습니다.');
      }
    } catch (err) {
      logger.warn('[review] open file failed', err);
      Alert.alert('열기 실패', '파일을 여는 중 오류가 발생했습니다.');
    }
  };

  const navPreset = resolveBottomNavPreset({ role, readOnly, hydrated, isRequestBoardDesigner });
  const navActiveKey = resolveBottomNavActiveKey(navPreset, 'request-board');

  /* ─── Render Helpers ─── */

  const renderAssignment = (assignment: RbDesignerAssignment) => {
    const statusInfo = ASSIGNMENT_STATUS_LABEL[assignment.status] ?? {
      label: assignment.status,
      color: COLORS.gray[500],
      bg: COLORS.gray[100],
    };
    const designerName = assignment.designers?.users?.name ?? '설계 매니저';
    const companyName = assignment.designers?.company_name;
    const isCompleted = assignment.status === 'completed';
    const needsReview =
      isCompleted &&
      (assignment.fc_decision === 'pending' || assignment.fc_decision == null);
    const fcDecided = assignment.fc_decision === 'accepted' || assignment.fc_decision === 'rejected';
    const attachments = assignment.request_attachments ?? [];

    return (
      <View
        key={assignment.id}
        style={[styles.assignmentCard, needsReview && styles.assignmentCardHighlight]}
      >
        {/* Designer Info */}
        <View style={styles.assignmentHeader}>
          <View style={styles.designerAvatarWrap}>
            <Feather name="user" size={16} color={COLORS.primary} />
          </View>
          <View style={styles.designerInfo}>
            <Text style={styles.designerName}>{designerName}</Text>
            {companyName && <Text style={styles.designerCompany}>{companyName}</Text>}
          </View>
          <StatusBadge {...statusInfo} status={assignment.status} />
        </View>

        {/* Timeline */}
        <View style={styles.timelineRow}>
          {assignment.accepted_at && (
            <View style={styles.timelineItem}>
              <Feather name="check" size={10} color={COLORS.gray[400]} />
              <Text style={styles.timelineLabel}>수락</Text>
              <Text style={styles.timelineDate}>{formatDate(assignment.accepted_at)}</Text>
            </View>
          )}
          {assignment.completed_at && (
            <View style={styles.timelineItem}>
              <Feather name="award" size={10} color="#8B5CF6" />
              <Text style={[styles.timelineLabel, { color: '#8B5CF6' }]}>완료</Text>
              <Text style={styles.timelineDate}>{formatDate(assignment.completed_at)}</Text>
            </View>
          )}
          {assignment.processing_days != null && assignment.processing_days > 0 && (
            <View style={styles.timelineItem}>
              <Feather name="clock" size={10} color={COLORS.gray[400]} />
              <Text style={styles.timelineLabel}>처리 기간</Text>
              <Text style={styles.timelineDate}>{assignment.processing_days}일</Text>
            </View>
          )}
        </View>

        {/* Attachments */}
        {isCompleted && attachments.length > 0 && (
          <View style={styles.attachmentsWrap}>
            <Text style={styles.attachmentsTitle}>
              <Feather name="paperclip" size={11} color={COLORS.gray[600]} /> 첨부 파일 ({attachments.length})
            </Text>
            {attachments.map((file) => (
              <Pressable
                key={file.id}
                style={({ pressed }) => [styles.fileRow, pressed && { backgroundColor: COLORS.gray[50] }]}
                onPress={() => handleOpenFile(file.file_url)}
              >
                <View style={styles.fileIconWrap}>
                  <Feather name="file" size={14} color={COLORS.primary} />
                </View>
                <View style={styles.fileInfo}>
                  <Text style={styles.fileName} numberOfLines={1}>{file.file_name}</Text>
                  <Text style={styles.fileMeta}>
                    {formatFileSize(file.file_size)} · {formatDate(file.created_at)}
                  </Text>
                </View>
                <View style={styles.fileOpenBtn}>
                  <Feather name="external-link" size={14} color={COLORS.primary} />
                  <Text style={styles.fileOpenText}>열기</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {isCompleted && attachments.length === 0 && (
          <View style={styles.noFilesRow}>
            <Feather name="paperclip" size={13} color={COLORS.gray[300]} />
            <Text style={styles.noFilesText}>첨부 파일 없음</Text>
          </View>
        )}

        {/* FC Decision */}
        {fcDecided && (
          <View
            style={[
              styles.fcDecisionRow,
              assignment.fc_decision === 'accepted' ? styles.fcDecisionAccepted : styles.fcDecisionRejected,
            ]}
          >
            <Feather
              name={assignment.fc_decision === 'accepted' ? 'thumbs-up' : 'thumbs-down'}
              size={13}
              color={assignment.fc_decision === 'accepted' ? '#059669' : '#DC2626'}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.fcDecisionLabel,
                  { color: assignment.fc_decision === 'accepted' ? '#059669' : '#DC2626' },
                ]}
              >
                {assignment.fc_decision === 'accepted' ? 'FC 승인 완료' : 'FC 거절'}
              </Text>
              {assignment.fc_decision_reason && (
                <Text style={styles.fcDecisionReason}>
                  사유: {assignment.fc_decision_reason}
                </Text>
              )}
              {assignment.fc_decided_at && (
                <Text style={styles.fcDecisionDate}>{formatDate(assignment.fc_decided_at)}</Text>
              )}
            </View>
          </View>
        )}

        {/* Approve / Reject Buttons */}
        {needsReview && (
          <View style={styles.decisionBtns}>
            <Pressable
              style={({ pressed }) => [
                styles.rejectBtn,
                pressed && { opacity: 0.8 },
                submitting && { opacity: 0.5 },
              ]}
              onPress={() => handleRejectOpen(assignment)}
              disabled={submitting}
            >
              <Feather name="x" size={15} color="#DC2626" />
              <Text style={styles.rejectBtnText}>거절</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.approveBtn,
                pressed && { opacity: 0.8 },
                submitting && { opacity: 0.5 },
              ]}
              onPress={() => handleApprove(assignment)}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="check" size={15} color="#fff" />
                  <Text style={styles.approveBtnText}>승인</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  /* ─── Main Render ─── */
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 4 }]}>
        <View style={styles.headerInner}>
          <Pressable
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={20} color={COLORS.gray[700]} />
          </Pressable>
          <View style={styles.headerTitles}>
            <Text style={styles.headerTitle}>의뢰 상세</Text>
            {detail && (
              <Text style={styles.headerSub} numberOfLines={1}>
                {detail.customer_name} · {getProductNames(detail)}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Body */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.primary} size="large" />
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      ) : fetchError ? (
        <View style={styles.errorWrap}>
          <Feather name="alert-circle" size={44} color={COLORS.error} />
          <Text style={styles.errorText}>{fetchError}</Text>
          <Pressable style={styles.retryBtn} onPress={fetchData}>
            <Text style={styles.retryBtnText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : detail ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 80 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Request Info Card */}
          <View style={styles.infoCard}>
            <View style={styles.infoCardHeader}>
              <View style={styles.infoCardTitleRow}>
                <Text style={styles.infoCustomerName}>{detail.customer_name}</Text>
                {(() => {
                  const s = REQUEST_STATUS_LABEL[detail.status] ?? {
                    label: detail.status, color: COLORS.gray[500], bg: COLORS.gray[100],
                  };
                  return (
                    <View style={[styles.badge, { backgroundColor: s.bg }]}>
                      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
                    </View>
                  );
                })()}
              </View>
              <Text style={styles.infoProducts}>{getProductNames(detail)}</Text>
            </View>
            <View style={styles.infoMetaRow}>
              <View style={styles.infoMeta}>
                <Feather name="calendar" size={12} color={COLORS.gray[400]} />
                <Text style={styles.infoMetaText}>요청일 {formatDate(detail.created_at)}</Text>
              </View>
              {detail.request_details && (
                <View style={styles.infoMetaRow}>
                  <Feather name="file-text" size={12} color={COLORS.gray[400]} />
                  <Text style={styles.infoMetaText} numberOfLines={2}>
                    {detail.request_details}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Designer Assignments */}
          <Text style={styles.sectionTitle}>
            설계 진행 ({(detail.request_designers ?? []).length}건)
          </Text>

          {(detail.request_designers ?? []).length === 0 ? (
            <View style={styles.emptyWrap}>
              <Feather name="users" size={36} color={COLORS.gray[200]} />
              <Text style={styles.emptyText}>배정된 설계 매니저가 없습니다</Text>
            </View>
          ) : (
            (detail.request_designers ?? []).map(renderAssignment)
          )}
        </ScrollView>
      ) : null}

      <BottomNavigation
        preset={navPreset ?? undefined}
        activeKey={navActiveKey}
        bottomInset={insets.bottom}
      />

      {/* Reject Modal */}
      <Modal
        visible={rejectModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRejectModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setRejectModalVisible(false)}
        />
        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>설계 거절</Text>
          <Text style={styles.modalDesc}>거절 사유를 입력해주세요. (필수)</Text>
          <TextInput
            style={styles.reasonInput}
            value={rejectReason}
            onChangeText={setRejectReason}
            placeholder="예: 보험료 계산 오류, 설계 내용 불일치 등"
            placeholderTextColor={COLORS.text.muted}
            multiline
            numberOfLines={3}
            maxLength={200}
            autoFocus
          />
          <Text style={styles.charCount}>{rejectReason.length}/200</Text>
          <View style={styles.modalBtns}>
            <Pressable
              style={({ pressed }) => [styles.modalCancelBtn, pressed && { opacity: 0.7 }]}
              onPress={() => setRejectModalVisible(false)}
              disabled={submitting}
            >
              <Text style={styles.modalCancelBtnText}>취소</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.modalConfirmBtn,
                pressed && { opacity: 0.8 },
                submitting && { opacity: 0.5 },
              ]}
              onPress={handleRejectConfirm}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.modalConfirmBtnText}>거절하기</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ─── Styles ─── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.gray[50] },

  /* Header */
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: SPACING.base,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    ...SHADOWS.sm,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitles: { flex: 1 },
  headerTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: '800' as const,
    color: COLORS.gray[900],
  },
  headerSub: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
    marginTop: 1,
  },

  /* Loading / Error */
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  loadingText: { fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.text.muted },
  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    padding: SPACING.xl,
  },
  errorText: {
    fontSize: TYPOGRAPHY.fontSize.base,
    color: COLORS.error,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
  },
  retryBtnText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '600' as const,
    color: '#fff',
  },

  /* Scroll */
  scrollContent: {
    padding: SPACING.base,
  },

  /* Info Card */
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.base,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    marginBottom: SPACING.lg,
    ...SHADOWS.sm,
  },
  infoCardHeader: {
    marginBottom: SPACING.sm,
  },
  infoCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  infoCustomerName: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontWeight: '800' as const,
    color: COLORS.gray[900],
    flex: 1,
  },
  infoProducts: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
  },
  infoMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray[100],
    marginTop: SPACING.sm,
  },
  infoMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginRight: SPACING.md,
  },
  infoMetaText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.gray[500],
  },

  /* Section */
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: '700' as const,
    color: COLORS.gray[900],
    marginBottom: SPACING.sm,
  },

  /* Empty */
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xl,
    gap: SPACING.sm,
  },
  emptyText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
  },

  /* Badge */
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '700' as const,
  },

  /* Assignment Card */
  assignmentCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.base,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  assignmentCardHighlight: {
    borderColor: COLORS.primary,
    borderWidth: 1.5,
  },

  /* Designer */
  assignmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  designerAvatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  designerInfo: { flex: 1 },
  designerName: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '700' as const,
    color: COLORS.gray[900],
  },
  designerCompany: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
    marginTop: 1,
  },

  /* Timeline */
  timelineRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray[100],
    marginBottom: SPACING.sm,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  timelineLabel: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.gray[500],
    fontWeight: '500' as const,
  },
  timelineDate: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.gray[400],
  },

  /* Attachments */
  attachmentsWrap: {
    borderTopWidth: 1,
    borderTopColor: COLORS.gray[100],
    paddingTop: SPACING.sm,
    marginBottom: SPACING.sm,
    gap: 4,
  },
  attachmentsTitle: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '600' as const,
    color: COLORS.gray[600],
    marginBottom: 6,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.gray[50],
    borderWidth: 1,
    borderColor: COLORS.gray[100],
  },
  fileIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: COLORS.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInfo: { flex: 1 },
  fileName: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '600' as const,
    color: COLORS.gray[800],
  },
  fileMeta: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
    marginTop: 1,
  },
  fileOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  fileOpenText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '600' as const,
    color: COLORS.primary,
  },

  noFilesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray[100],
    marginBottom: SPACING.sm,
  },
  noFilesText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.gray[300],
  },

  /* FC Decision */
  fcDecisionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    marginBottom: 4,
  },
  fcDecisionAccepted: {
    backgroundColor: '#D1FAE5',
  },
  fcDecisionRejected: {
    backgroundColor: '#FEE2E2',
  },
  fcDecisionLabel: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '700' as const,
  },
  fcDecisionReason: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.gray[600],
    marginTop: 2,
  },
  fcDecisionDate: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.gray[400],
    marginTop: 2,
  },

  /* Decision Buttons */
  decisionBtns: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray[100],
  },
  rejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: '#DC2626',
    backgroundColor: '#FEF2F2',
  },
  rejectBtnText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '700' as const,
    color: '#DC2626',
  },
  approveBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    backgroundColor: '#059669',
    ...SHADOWS.sm,
  },
  approveBtnText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '700' as const,
    color: '#fff',
  },

  /* Reject Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    ...SHADOWS.lg,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.gray[200],
    alignSelf: 'center',
    marginBottom: SPACING.md,
  },
  modalTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: '800' as const,
    color: COLORS.gray[900],
    marginBottom: 4,
  },
  modalDesc: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
    marginBottom: SPACING.md,
  },
  reasonInput: {
    borderWidth: 1,
    borderColor: COLORS.border.base,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: TYPOGRAPHY.fontSize.base,
    color: COLORS.gray[900],
    minHeight: 80,
    textAlignVertical: 'top',
    backgroundColor: COLORS.gray[50],
  },
  charCount: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: SPACING.md,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.base,
    alignItems: 'center',
  },
  modalCancelBtnText: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '600' as const,
    color: COLORS.gray[700],
  },
  modalConfirmBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.sm,
  },
  modalConfirmBtnText: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '700' as const,
    color: '#fff',
  },
});
