'use client';

import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  Group,
  LoadingOverlay,
  Modal,
  Pagination,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCalendar,
  IconBell,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDeviceFloppy,
  IconEdit,
  IconFileText,
  IconInfoCircle,
  IconRefresh,
  IconSearch,
  IconSend,
  IconTrash,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ChangeEvent, MouseEvent, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { useSession } from '@/hooks/use-session';
import { useResidentNumber } from '@/hooks/use-resident-number';
import {
  closePendingAdminFileWindow,
  navigateAdminFileWindowOrCurrentTab,
  openPendingAdminFileWindow,
} from '@/lib/admin-file-open';
import type { FCDocument, FCProfileWithDocuments } from '@/types/dashboard';
import type { CommissionCompletionStatus, FcProfile, FcStatus } from '@/types/fc';
import { notifications } from '@mantine/notifications';
import { useRouter } from 'next/navigation';
import { StatusToggle } from '../../components/StatusToggle';
import { RejectReasonModal } from '@/components/RejectReasonModal';
import {
  getAllowanceDisplayState,
  hasHanwhaApprovedPdf,
  type AllowanceDisplayKey,
} from '../../lib/fc-workflow';
import {
  ADMIN_STEP_LABELS,
  calcStep,
  DOC_OPTIONS,
  getAdminStepDisplay,
  getAppointmentProgress,
  getDocProgress,
  getSummaryStatus
} from '../../lib/shared';
import { sendPushNotificationForFc } from '../actions';
import { updateAppointmentAction } from './appointment/actions';
import { updateDocStatusAction } from './docs/actions';
import { registerWebPushSubscription } from '@/components/WebPushRegistrar';
import styles from './page.module.css';
import {
  DASHBOARD_FC_LIST_COLUMN_COUNT,
  DASHBOARD_FC_LIST_COLUMNS,
  formatDashboardSignupDate,
} from '@/lib/dashboard-table-display';
import { getWebPushRegistrationFeedback } from '@/lib/web-push-config';
import {
  ADMIN_NOTIFICATION_WARNING_TITLE,
  getAdminNotificationWarning,
} from '@/lib/admin-notification-warning';

import { logger } from '../../lib/logger';

const DOCS_STAGE_LOCK_STATUSES: FcStatus[] = [
  'hanwha-commission-review',
  'hanwha-commission-rejected',
  'hanwha-commission-approved',
  'appointment-completed',
  'final-link-sent',
];

const HANWHA_APPROVED_STATUSES: FcStatus[] = [
  'hanwha-commission-approved',
  'appointment-completed',
  'final-link-sent',
];

const trimValue = (value?: string | null) => String(value ?? '').trim();

const ALLOWANCE_FLOW_CARDS: Array<{
  key: AllowanceDisplayKey;
  label: string;
  helper: string;
}> = [
  { key: 'missing', label: '미입력', helper: 'FC 동의일 대기' },
  { key: 'entered', label: '입력 완료', helper: '동의일 저장 완료' },
  { key: 'prescreen', label: '사전 심사', helper: '사전 심사 요청 완료' },
  { key: 'approved', label: '승인 완료', helper: '문서 단계 진행 가능' },
  { key: 'rejected', label: '미승인', helper: '반려 사유 확인 필요' },
];

const isHanwhaApproved = (
  profile: Pick<FCProfileWithDocuments, 'status' | 'hanwha_commission_date'>,
) => Boolean(profile.hanwha_commission_date || HANWHA_APPROVED_STATUSES.includes(profile.status));

const buildCommissionProfileUpdate = (
  profile: FCProfileWithDocuments | null,
  commission: CommissionCompletionStatus,
): Record<string, unknown> => {
  const life = commission === 'life_only' || commission === 'both';
  const nonlife = commission === 'nonlife_only' || commission === 'both';
  const updateData: Record<string, unknown> = {
    life_commission_completed: life,
    nonlife_commission_completed: nonlife,
  };

  if (!profile) return updateData;

  if (commission === 'both') {
    updateData.status = 'final-link-sent';
    return updateData;
  }

  if (profile.status !== 'final-link-sent') {
    return updateData;
  }

  const docs = profile.fc_documents ?? [];
  const uploadedDocs = docs.filter((doc) => doc.storage_path && doc.storage_path !== 'deleted');
  const allApproved = docs.length > 0 && docs.every((doc) => doc.status === 'approved');
  const hasAppointmentActivity = Boolean(
    profile.appointment_schedule_life ||
    profile.appointment_schedule_nonlife ||
    profile.appointment_date_life_sub ||
    profile.appointment_date_nonlife_sub ||
    profile.appointment_reject_reason_life ||
    profile.appointment_reject_reason_nonlife ||
    profile.appointment_date_life ||
    profile.appointment_date_nonlife,
  );
  const hasAppointmentCompletion = Boolean(
    profile.appointment_date_life ||
    profile.appointment_date_nonlife,
  );

  if (hasAppointmentCompletion) {
    updateData.status = 'appointment-completed';
    return updateData;
  }

  if (allApproved || hasAppointmentActivity) {
    updateData.status = 'docs-approved';
    return updateData;
  }

  if (uploadedDocs.length > 0) {
    updateData.status = 'docs-submitted';
    return updateData;
  }

  if (docs.length > 0) {
    updateData.status = docs.some((doc) => doc.status === 'rejected') ? 'docs-rejected' : 'docs-requested';
    return updateData;
  }

  if (profile.allowance_date) {
    updateData.status = 'allowance-consented';
    return updateData;
  }

  if (profile.temp_id) {
    updateData.status = 'temp-id-issued';
    return updateData;
  }

  updateData.status = 'draft';
  return updateData;
};

const getCommissionCompletionStatus = (
  life: boolean,
  nonlife: boolean,
): CommissionCompletionStatus => {
  if (life && nonlife) return 'both';
  if (life) return 'life_only';
  if (nonlife) return 'nonlife_only';
  return 'none';
};

const hasInsuranceStageActivity = (
  profile: Pick<
    FCProfileWithDocuments,
    | 'appointment_url'
    | 'appointment_date'
    | 'appointment_schedule_life'
    | 'appointment_schedule_nonlife'
    | 'appointment_date_life_sub'
    | 'appointment_date_nonlife_sub'
    | 'appointment_reject_reason_life'
    | 'appointment_reject_reason_nonlife'
    | 'appointment_date_life'
    | 'appointment_date_nonlife'
    | 'life_commission_completed'
    | 'nonlife_commission_completed'
  >,
) =>
  Boolean(
    profile.appointment_url ||
    profile.appointment_date ||
    profile.appointment_schedule_life ||
    profile.appointment_schedule_nonlife ||
    profile.appointment_date_life_sub ||
    profile.appointment_date_nonlife_sub ||
    profile.appointment_reject_reason_life ||
    profile.appointment_reject_reason_nonlife ||
    profile.appointment_date_life ||
    profile.appointment_date_nonlife ||
    profile.life_commission_completed ||
    profile.nonlife_commission_completed,
  );

const canOpenInsuranceStage = (
  profile: Pick<
    FCProfileWithDocuments,
    | 'status'
    | 'hanwha_commission_date'
    | 'hanwha_commission_pdf_path'
    | 'hanwha_commission_pdf_name'
    | 'appointment_url'
    | 'appointment_date'
    | 'appointment_schedule_life'
    | 'appointment_schedule_nonlife'
    | 'appointment_date_life_sub'
    | 'appointment_date_nonlife_sub'
    | 'appointment_reject_reason_life'
    | 'appointment_reject_reason_nonlife'
    | 'appointment_date_life'
    | 'appointment_date_nonlife'
  | 'life_commission_completed'
  | 'nonlife_commission_completed'
  >,
) => hasInsuranceStageActivity(profile) || hasHanwhaApprovedPdf(profile);

const buildDocWorkflowResetProfileFields = () => ({
  status: 'docs-pending' as FcStatus,
  hanwha_commission_date_sub: null,
  hanwha_commission_date: null,
  hanwha_commission_reject_reason: null,
  hanwha_commission_pdf_path: null,
  hanwha_commission_pdf_name: null,
  dawichok_url_sent_at: null,
  dawichok_url_sent_by: null,
  appointment_url: null,
  appointment_date: null,
  appointment_schedule_life: null,
  appointment_schedule_nonlife: null,
  appointment_date_life_sub: null,
  appointment_date_nonlife_sub: null,
  appointment_reject_reason_life: null,
  appointment_reject_reason_nonlife: null,
  appointment_date_life: null,
  appointment_date_nonlife: null,
  life_commission_completed: false,
  nonlife_commission_completed: false,
});

const modalDateFieldLabelStyle = { fontWeight: 600, color: '#111827' };
const modalDateCalendarStyles = {
  calendarHeaderControl: { width: 32, height: 32 },
  calendarHeaderControlIcon: { width: 14, height: 14 },
  calendarHeaderLevel: { fontSize: 14, fontWeight: 700 },
  calendarHeader: { gap: 6 },
  weekday: {
    fontSize: 12,
    fontWeight: 700,
    textAlign: 'center' as const,
    width: 36,
  },
  day: {
    width: 36,
    height: 36,
    fontSize: 13,
    fontWeight: 600,
    textAlign: 'center' as const,
  },
  monthCell: { padding: 4 },
};

const getModalDateInputStyles = (disabled: boolean) => ({
  label: modalDateFieldLabelStyle,
  input: {
    backgroundColor: disabled ? '#F9FAFB' : '#FFFFFF',
    color: '#111827',
    borderColor: '#E5E7EB',
    fontWeight: 600,
  },
  ...modalDateCalendarStyles,
});

const getHanwhaStageStatus = (
  profile: Pick<
    FCProfileWithDocuments,
    | 'status'
    | 'hanwha_commission_date_sub'
    | 'hanwha_commission_date'
    | 'hanwha_commission_pdf_path'
    | 'hanwha_commission_pdf_name'
  >,
) => {
  const hasSubmittedDate = Boolean(trimValue(profile.hanwha_commission_date_sub));

  if (isHanwhaApproved(profile)) {
    return { label: '다위촉 URL 승인 완료', color: 'teal' as const };
  }
  if (!hasSubmittedDate) {
    return { label: '다위촉 URL 대기', color: 'blue' as const };
  }
  if (profile.status === 'hanwha-commission-rejected') {
    return { label: '다위촉 URL 반려', color: 'red' as const };
  }
  return { label: '다위촉 URL 승인 필요', color: 'orange' as const };
};

const getHanwhaStageDescription = (
  profile: Pick<
    FCProfileWithDocuments,
    | 'status'
    | 'hanwha_commission_date_sub'
    | 'hanwha_commission_date'
    | 'hanwha_commission_reject_reason'
    | 'hanwha_commission_pdf_path'
    | 'hanwha_commission_pdf_name'
  >,
) => {
  const hasSubmittedDate = Boolean(trimValue(profile.hanwha_commission_date_sub));

  if (isHanwhaApproved(profile)) {
    return '다위촉 URL 승인이 끝났고 FC에게 PDF 등록 완료 알림이 전달됩니다.';
  }
  if (!hasSubmittedDate) {
    return '1. 완료일을 먼저 저장해주세요.';
  }
  return '3단계 다위촉 URL 완료일이 저장되었습니다. 다위촉 URL PDF를 업로드해 승인을 완료해주세요.';
};

const getDefaultModalTab = (profile: FCProfileWithDocuments): string => {
  const workflowStep = calcStep(profile);
  if (workflowStep === 2) return 'docs';
  if (workflowStep === 3) return 'hanwha';
  if (workflowStep >= 4) return 'appointment';

  if (canOpenInsuranceStage(profile)) {
    return 'appointment';
  }
  if (
    ['docs-approved', 'hanwha-commission-review', 'hanwha-commission-rejected', 'hanwha-commission-approved'].includes(
      profile.status,
    )
  ) {
    return 'hanwha';
  }
  if (['docs-requested', 'docs-pending', 'docs-submitted', 'docs-rejected'].includes(profile.status)) {
    return 'docs';
  }
  return 'info';
};

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hydrated, isReadOnly, role, residentId } = useSession();
  const [activeTab, setActiveTab] = useState<string | null>('all');
  const [metricFilter, setMetricFilter] = useState<'all' | 'pendingAllowance' | 'pendingDocs'>('all');
  const [keyword, setKeyword] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;
  const [isPushRegistering, setIsPushRegistering] = useState(false);

  // 모달 상태
  const [opened, { open, close }] = useDisclosure(false);
  const [selectedFc, setSelectedFc] = useState<FCProfileWithDocuments | null>(null);
  const [modalTab, setModalTab] = useState<string | null>('info');

  // 수정용 상태
  const [tempIdInput, setTempIdInput] = useState('');
  const [careerInput, setCareerInput] = useState<'신입' | '경력' | null>(null);
  const [commissionInput, setCommissionInput] = useState<CommissionCompletionStatus>('none');
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [customDocInput, setCustomDocInput] = useState('');
  const [docsDeadlineInput, setDocsDeadlineInput] = useState<Date | null>(null);
  const [allowanceDateInput, setAllowanceDateInput] = useState<Date | null>(null);
  const [hanwhaSubmittedDateInput, setHanwhaSubmittedDateInput] = useState<Date | null>(null);
  const hanwhaPdfUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [isHanwhaPdfUploading, setIsHanwhaPdfUploading] = useState(false);
  const [isHanwhaPdfDeleting, setIsHanwhaPdfDeleting] = useState(false);
  const handleDocsDeadlineChange = (value: string | null) => {
    if (!value) {
      setDocsDeadlineInput(null);
      return;
    }
    const nextValue = new Date(value);
    setDocsDeadlineInput(Number.isNaN(nextValue.getTime()) ? null : nextValue);
  };
  const handleAllowanceDateChange = (value: Date | string | null) => {
    if (!value) {
      setAllowanceDateInput(null);
      return;
    }
    const nextValue = value instanceof Date ? value : new Date(value);
    setAllowanceDateInput(Number.isNaN(nextValue.getTime()) ? null : nextValue);
  };
  const handleHanwhaSubmittedDateChange = (value: Date | string | null) => {
    if (!value) {
      setHanwhaSubmittedDateInput(null);
      return;
    }
    const nextValue = value instanceof Date ? value : new Date(value);
    setHanwhaSubmittedDateInput(Number.isNaN(nextValue.getTime()) ? null : nextValue);
  };
  // 위촉 일정 및 승인 상태
  const [appointmentInputs, setAppointmentInputs] = useState<{
    life?: string;
    nonlife?: string;
    lifeDate?: Date | null;
    nonLifeDate?: Date | null;
  }>({});
  const [isAppointmentPending, startAppointmentTransition] = useTransition();
  const [rejectOpened, { open: openReject, close: closeReject }] = useDisclosure(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<
    | { kind: 'allowance' }
    | { kind: 'hanwha' }
    | { kind: 'appointment'; category: 'life' | 'nonlife' }
    | { kind: 'doc'; doc: FCDocument }
    | null
  >(null);
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  // 확인 모달 상태
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    confirmLabel?: string;
    color?: string;
  } | null>(null);

  const showConfirm = (config: {
    title: string;
    message: string;
    onConfirm: () => void;
    confirmLabel?: string;
    color?: string;
  }) => {
    setConfirmConfig(config);
    openConfirm();
  };

  const handleConfirm = () => {
    if (confirmConfig?.onConfirm) {
      confirmConfig.onConfirm();
    }
    closeConfirm();
  };

  const updateSelectedFc = (updates: Partial<FCProfileWithDocuments>) => {
    setSelectedFc((prev: FCProfileWithDocuments | null) => (prev ? { ...prev, ...updates } : prev));
  };

  const isLookupResettableStatus = (status?: FcStatus | null) =>
    Boolean(status && ['draft', 'temp-id-issued', 'allowance-pending', 'allowance-consented'].includes(status));

  const openRejectModal = (
    target:
      | { kind: 'allowance' }
      | { kind: 'hanwha' }
      | { kind: 'appointment'; category: 'life' | 'nonlife' }
      | { kind: 'doc'; doc: FCDocument },
  ) => {
    setRejectReason('');
    setRejectTarget(target);
    openReject();
  };

  const handleRejectSubmit = async () => {
    if (!selectedFc || !rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      notifications.show({ title: '사유 입력', message: '반려 사유를 입력해주세요.', color: 'red' });
      return;
    }
    setRejectSubmitting(true);
    try {
      if (rejectTarget.kind === 'allowance') {
        await updateStatusMutation.mutateAsync({
          status: 'allowance-pending',
          title: '보증 보험 동의 반려',
          msg: `보증 보험 동의가 반려되었습니다.\n사유: ${reason}`,
          extra: {
            allowance_date: selectedFc.allowance_date ?? null,
            allowance_prescreen_requested_at: null,
            allowance_reject_reason: reason,
          },
        });
        // Local update to reflect changes immediately in the UI (optional if invalidateQueries is fast enough)
        updateSelectedFc({
          status: 'allowance-pending',
          allowance_date: selectedFc.allowance_date,
          allowance_prescreen_requested_at: null,
          allowance_reject_reason: reason
        });
      }

      if (rejectTarget.kind === 'hanwha') {
        await updateStatusMutation.mutateAsync({
          status: 'hanwha-commission-rejected',
          title: '다위촉 URL 반려',
          msg: `다위촉 URL이 반려되었습니다.\n사유: ${reason}`,
          extra: {
            hanwha_commission_date: null,
            hanwha_commission_reject_reason: reason,
            hanwha_commission_pdf_path: null,
            hanwha_commission_pdf_name: null,
          },
        });
        updateSelectedFc({
          status: 'hanwha-commission-rejected',
          hanwha_commission_date: null,
          hanwha_commission_reject_reason: reason,
          hanwha_commission_pdf_path: null,
          hanwha_commission_pdf_name: null,
        });
      }

      if (rejectTarget.kind === 'appointment') {
        const { category } = rejectTarget;
        const result = await updateAppointmentAction(
          { success: false },
          {
            fcId: selectedFc.id,
            type: 'reject',
            category,
            value: null,
            reason,
          },
        );
        if (!result.success) throw new Error(result.error || '처리 실패');
        const isLife = category === 'life';
        const dateKey = isLife ? 'lifeDate' : 'nonLifeDate';
        setAppointmentInputs((prev) => ({ ...prev, [dateKey]: null }));
        updateSelectedFc({
          [isLife ? 'appointment_date_life' : 'appointment_date_nonlife']: null,
          [isLife ? 'appointment_date_life_sub' : 'appointment_date_nonlife_sub']: null,
          [isLife ? 'appointment_reject_reason_life' : 'appointment_reject_reason_nonlife']: reason,
          status: 'hanwha-commission-approved',
        });
        const notificationWarning = getAdminNotificationWarning(result);
        notifications.show(notificationWarning
          ? { title: ADMIN_NOTIFICATION_WARNING_TITLE, message: notificationWarning, color: 'yellow' }
          : { title: '처리 완료', message: '생명/손해 위촉 정보를 반려했습니다.', color: 'green' });
        queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
      }

      if (rejectTarget.kind === 'doc') {
        const doc = rejectTarget.doc;
        const res = await updateDocStatusAction({ success: false }, {
          fcId: selectedFc.id,
          docType: doc.doc_type,
          status: 'rejected',
          reason,
        });
        if (!res.success) throw new Error(res.error || '문서 반려 실패');
        const nextDocs = (selectedFc.fc_documents || []).map((d: FCDocument) =>
          d.doc_type === doc.doc_type ? { ...d, status: 'rejected' as const, reviewer_note: reason } : d,
        );
        let nextProfileStatus = selectedFc.status;
        if (!['appointment-completed', 'final-link-sent'].includes(selectedFc.status)) {
          nextProfileStatus = 'docs-pending';
        }
        updateSelectedFc(
          nextProfileStatus === 'docs-pending'
            ? { ...buildDocWorkflowResetProfileFields(), fc_documents: nextDocs }
            : { fc_documents: nextDocs, status: nextProfileStatus },
        );
        const notificationWarning = getAdminNotificationWarning(res);
        notifications.show(notificationWarning
          ? { title: ADMIN_NOTIFICATION_WARNING_TITLE, message: notificationWarning, color: 'yellow' }
          : { title: '반려 완료', message: '서류가 반려되었습니다.', color: 'green' });
        queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
      }

      closeReject();
    } catch (err: unknown) {
      const error = err as Error;
      notifications.show({ title: '오류', message: error?.message ?? '반려 처리 실패', color: 'red' });
    } finally {
      setRejectSubmitting(false);
    }
  };

  const { data: fcs, isLoading } = useQuery({
    queryKey: ['dashboard-list', role, residentId],
    queryFn: async () => {
      const resp = await fetch('/api/admin/list');
      const payload: unknown = await resp.json().catch(() => null);

      if (!resp.ok) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload
            ? String((payload as { error?: string }).error || '')
            : '';
        throw new Error(message || '데이터 로딩 실패');
      }

      const data = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && 'data' in payload
          ? (payload as { data?: unknown }).data
          : null;
      if (!Array.isArray(data)) {
        throw new Error('FC 목록 응답 형식이 올바르지 않습니다.');
      }
      logger.debug('[DEBUG] Web: Fetched FC List:', JSON.stringify(data, null, 2));
      return data;
    },
    enabled: hydrated && (role === 'admin' || role === 'manager'),
  });

  const filteredData = useMemo(() => {
    if (!fcs) return [];
    let result = fcs.map((fc: FCProfileWithDocuments) => {
      const workflowStep = calcStep(fc);
      const adminStep = getAdminStepDisplay(fc).step;
      return { ...fc, step: workflowStep, adminStep };
    });

    if (activeTab && activeTab !== 'all') {
      if (activeTab === 'g_done') {
        result = result.filter((fc: FCProfileWithDocuments & { adminStep: number }) => fc.adminStep === 5);
      } else if (activeTab === 'g_others') {
        result = result.filter((fc: FCProfileWithDocuments & { adminStep: number }) => fc.adminStep !== 5);
      } else if (activeTab === 'step0') {
        result = result.filter((fc: FCProfileWithDocuments & { adminStep: number }) => fc.adminStep === 0);
      } else {
        const stepNum = Number(activeTab.replace('step', ''));
        result = result.filter((fc: FCProfileWithDocuments & { adminStep: number }) => fc.adminStep === stepNum);
      }
    }
    if (metricFilter === 'pendingAllowance') {
      result = result.filter((fc: FCProfileWithDocuments & { step: number }) => {
        const allowanceDisplay = getAllowanceDisplayState(fc);
        return fc.step === 1 && ['entered', 'prescreen'].includes(allowanceDisplay.key);
      });
    } else if (metricFilter === 'pendingDocs') {
      result = result.filter(
        (fc: FCProfileWithDocuments & { step: number }) =>
          fc.step === 2 && getDocProgress(fc).key === 'in-progress',
      );
    }
    if (keyword.trim()) {
      const q = keyword.trim().toLowerCase();
      result = result.filter(
        (fc: FCProfileWithDocuments & { adminStep: number }) =>
          fc.name?.toLowerCase().includes(q) ||
          fc.phone?.includes(q) ||
          fc.affiliation?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [fcs, activeTab, keyword, metricFilter]);

  // 페이지네이션 처리
  const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredData.slice(startIndex, endIndex);
  }, [filteredData, currentPage, ITEMS_PER_PAGE]);

  // 탭이나 검색어가 변경되면 첫 페이지로 이동
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, keyword, metricFilter]);

  const handleMetricFilterChange = (nextFilter: 'all' | 'pendingAllowance' | 'pendingDocs') => {
    setMetricFilter((current) => current === nextFilter && nextFilter !== 'all' ? 'all' : nextFilter);
    setActiveTab('all');
  };

  const handleActiveTabChange = (nextTab: string | null) => {
    setActiveTab(nextTab);
    setMetricFilter('all');
  };

  const {
    residentNumberDisplay: selectedResidentNumberDisplay,
    birthDateDisplay: selectedBirthDateDisplay,
    isFetching: isSelectedResidentNumberFetching,
  } = useResidentNumber({
    fcId: selectedFc?.id,
    enabled: opened,
  });

  const updateInfoMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc) return;
      const payload: Partial<FcProfile> & Record<string, unknown> = {
        career_type: careerInput,
      };
      if (tempIdInput && tempIdInput !== selectedFc.temp_id) {
        payload.temp_id = tempIdInput;
        if (selectedFc.status === 'draft') {
          payload.status = 'temp-id-issued';
        }
      }
      const resp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateProfile',
          payload: { fcId: selectedFc.id, data: payload },
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: string }).error || '')
            : '';
        throw new Error(message || '업데이트 실패');
      }
      return data as { profile?: Partial<FCProfileWithDocuments> | null; warning?: unknown } | null;
    },
    onSuccess: (response) => {
      const nextProfileUpdates: Partial<FCProfileWithDocuments> = {
        career_type: careerInput,
      };
      if (response?.profile && typeof response.profile === 'object') {
        Object.assign(nextProfileUpdates, response.profile);
      }
      if (tempIdInput && tempIdInput !== selectedFc?.temp_id) {
        nextProfileUpdates.temp_id = tempIdInput;
      }
      updateSelectedFc(nextProfileUpdates);
      const notificationWarning = getAdminNotificationWarning(response);
      notifications.show(notificationWarning
        ? { title: ADMIN_NOTIFICATION_WARNING_TITLE, message: notificationWarning, color: 'yellow' }
        : { title: '저장 완료', message: '기본 정보가 업데이트되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: Error) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const updateCommissionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc) return null;
      const data = buildCommissionProfileUpdate(selectedFc, commissionInput);

      const resp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateProfile',
          payload: { fcId: selectedFc.id, data },
        }),
      });
      const payload = await resp.json().catch(() => null);
      if (!resp.ok) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload
            ? String((payload as { error?: string }).error || '')
            : '';
        throw new Error(message || '위촉 상태 저장 실패');
      }
      return data;
    },
    onSuccess: (data) => {
      if (!data) return;
      updateSelectedFc(data as Partial<FCProfileWithDocuments>);
      notifications.show({ title: '저장 완료', message: '위촉 상태가 업데이트되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: Error) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const resetToLookupMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc) return;

      const resp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateProfile',
          payload: {
            fcId: selectedFc.id,
            data: {
              temp_id: null,
              allowance_date: null,
              allowance_prescreen_requested_at: null,
              allowance_reject_reason: null,
              status: 'draft',
            },
          },
        }),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: string }).error || '')
            : '';
        throw new Error(message || '조회중 단계로 되돌리기 실패');
      }
    },
    onSuccess: () => {
      setTempIdInput('');
      setAllowanceDateInput(null);
      updateSelectedFc({
        temp_id: null,
        allowance_date: null,
        allowance_prescreen_requested_at: null,
        allowance_reject_reason: null,
        status: 'draft',
      });
      notifications.show({
        title: '초기화 완료',
        message: '임시사번을 비우고 조회중 단계로 되돌렸습니다.',
        color: 'green',
      });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: Error) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const updateAllowanceDateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc || !allowanceDateInput) {
        throw new Error('보증보험 조회 동의일을 선택해주세요.');
      }
      const normalizedAllowanceDate = dayjs(allowanceDateInput).format('YYYY-MM-DD');
      const resp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateAllowanceDate',
          payload: {
            fcId: selectedFc.id,
            allowanceDate: normalizedAllowanceDate,
          },
        }),
      });
      const data: unknown = await resp.json().catch(() => null);
      if (!resp.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: string }).error || '')
            : '';
        throw new Error(message || '보증보험 조회 동의일 저장 실패');
      }

      const payload = data as { allowance_date?: string; status?: FcStatus } | null;
      return {
        allowanceDate: payload?.allowance_date ?? normalizedAllowanceDate,
        status: payload?.status ?? selectedFc.status,
      };
    },
    onSuccess: ({ allowanceDate, status }) => {
      updateSelectedFc({
        allowance_date: allowanceDate,
        allowance_prescreen_requested_at: null,
        allowance_reject_reason: null,
        status,
      });
      notifications.show({ title: '저장 완료', message: '보증보험 조회 동의일이 저장되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: Error) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const updateDocsRequestMutation = useMutation({
    mutationFn: async ({ types, deadline }: { types: string[]; deadline?: Date | null }) => {
      if (!selectedFc) return;

      const nextTypes = types ?? [];
      logger.debug('Mutation Start');
      logger.debug('SelectedDocs (Intent):', nextTypes);
      const normalizedDeadline = deadline ? dayjs(deadline).format('YYYY-MM-DD') : null;

      const resp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateDocsRequest',
          payload: {
            fcId: selectedFc.id,
            types: nextTypes,
            deadline: normalizedDeadline,
            currentDeadline: selectedFc.docs_deadline_at ?? null,
          },
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: string }).error || '')
            : '';
        throw new Error(message || '업데이트 실패');
      }
      return data;
    },
    onSuccess: (response) => {
      const notificationWarning = getAdminNotificationWarning(response);
      notifications.show(notificationWarning
        ? { title: ADMIN_NOTIFICATION_WARNING_TITLE, message: notificationWarning, color: 'yellow' }
        : { title: '요청 완료', message: '서류 목록이 갱신되었습니다.', color: 'blue' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: Error) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({
      status,
      title,
      msg,
      extra,
    }: {
      status: FcStatus;
      title?: string;
      msg: string;
      extra?: Record<string, string | null | boolean | number>;
    }) => {
      if (!selectedFc) return;
      const resp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateStatus',
          payload: {
            fcId: selectedFc.id,
            status,
            title,
            msg,
            extra,
          },
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: string }).error || '')
            : '';
        throw new Error(message || '상태 업데이트 실패');
      }
      return data;
    },
    onSuccess: (response, variables) => {
      if (variables?.status) {
        updateSelectedFc({ status: variables.status, ...(variables.extra ?? {}) });
      }
      const notificationWarning = getAdminNotificationWarning(response);
      notifications.show(notificationWarning
        ? { title: ADMIN_NOTIFICATION_WARNING_TITLE, message: notificationWarning, color: 'yellow' }
        : { title: '처리 완료', message: '상태가 변경되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: Error) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const deleteFcMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc) return;
      logger.debug('[Web][deleteFc] start', { id: selectedFc.id, phone: selectedFc.phone });
      const resp = await fetch('/api/fc-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fcId: selectedFc.id }),
      });

      const data = await resp.json().catch(() => null);
      logger.debug('[Web][deleteFc] response', { id: selectedFc.id, status: resp.status, data });

      if (!resp.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: string }).error || '')
            : '';
        throw new Error(message || '삭제 실패');
      }

      // API 응답 검증
      if (!data || typeof data !== 'object') {
        logger.error('[Web][deleteFc] invalid response', { id: selectedFc.id, data });
        throw new Error('서버 응답이 올바르지 않습니다.');
      }

      // deleted 플래그 확인
      if ('deleted' in data && !data.deleted) {
        logger.warn('[Web][deleteFc] delete returned false', { id: selectedFc.id, data });
        throw new Error(
          typeof data.message === 'string' ? data.message : 'FC 정보를 삭제할 수 없습니다.'
        );
      }

      logger.info('[Web][deleteFc] success', { id: selectedFc.id, deletedCount: data.deletedCount });
      return data;
    },
    onSuccess: (data) => {
      logger.debug('[Web][deleteFc] onSuccess', { data });
      notifications.show({ title: '삭제 완료', message: 'FC 정보가 삭제되었습니다.', color: 'gray' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
      close();
    },
    onError: (err: Error) => {
      logger.error('[Web][deleteFc] failed', err);
      notifications.show({ title: '오류', message: err.message, color: 'red' });
    },
  });

  const updateHanwhaSubmissionDateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc || !hanwhaSubmittedDateInput) {
        throw new Error('다위촉 URL 완료일을 입력해주세요.');
      }
      const normalizedSubmittedDate = dayjs(hanwhaSubmittedDateInput).format('YYYY-MM-DD');
      const resp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateHanwhaSubmissionDate',
          payload: {
            fcId: selectedFc.id,
            submittedDate: normalizedSubmittedDate,
          },
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: string }).error || '')
            : '';
        throw new Error(message || '다위촉 URL 완료일 저장 실패');
      }
      return {
        submittedDate: normalizedSubmittedDate,
        status: typeof data?.status === 'string' ? data.status : null,
      };
    },
    onSuccess: (result) => {
      updateSelectedFc({
        hanwha_commission_date_sub: result.submittedDate,
        hanwha_commission_reject_reason: null,
        ...(result.status ? { status: result.status } : {}),
      });
      notifications.show({ title: '저장 완료', message: '다위촉 URL 완료일이 저장되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: Error) => {
      notifications.show({ title: '오류', message: err.message, color: 'red' });
    },
  });

  const markDawichokUrlSentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc) {
        throw new Error('FC 정보를 찾을 수 없습니다.');
      }
      const resp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'markDawichokUrlSent',
          payload: {
            fcId: selectedFc.id,
          },
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: string }).error || '')
            : '';
        throw new Error(message || '다위촉 URL 발송 신호 처리 실패');
      }
      return {
        sentAt: typeof data?.dawichok_url_sent_at === 'string' ? data.dawichok_url_sent_at : new Date().toISOString(),
        sentBy: typeof data?.dawichok_url_sent_by === 'string' ? data.dawichok_url_sent_by : null,
        warning: getAdminNotificationWarning(data),
      };
    },
    onSuccess: ({ sentAt, sentBy, warning }) => {
      updateSelectedFc({
        dawichok_url_sent_at: sentAt,
        dawichok_url_sent_by: sentBy,
      });
      notifications.show(warning
        ? { title: ADMIN_NOTIFICATION_WARNING_TITLE, message: warning, color: 'yellow' }
        : {
            title: '발송 신호 완료',
            message: 'FC에게 다위촉 URL 진행 안내를 보냈습니다.',
            color: 'green',
          });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: Error) => {
      notifications.show({ title: '오류', message: err.message, color: 'red' });
    },
  });

  const updateAppointmentDateMutation = useMutation({
    mutationFn: async ({ category }: { category: 'life' | 'nonlife' }) => {
      if (!selectedFc) {
        throw new Error('FC 정보를 찾을 수 없습니다.');
      }

      const dateInput = category === 'life' ? appointmentInputs.lifeDate : appointmentInputs.nonLifeDate;
      if (!dateInput) {
        throw new Error('위촉 완료일을 선택해주세요.');
      }

      const normalizedAppointmentDate = dayjs(dateInput).format('YYYY-MM-DD');
      const resp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateAppointmentDate',
          payload: {
            fcId: selectedFc.id,
            category,
            appointmentDate: normalizedAppointmentDate,
          },
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: string }).error || '')
            : '';
        throw new Error(message || '위촉 완료일 저장 실패');
      }
      const nextStatus =
        data && typeof data === 'object' && 'status' in data && typeof data.status === 'string'
          ? (data.status as FcStatus)
          : null;

      return {
        category,
        appointmentDate: normalizedAppointmentDate,
        status: nextStatus,
      };
    },
    onSuccess: ({ category, appointmentDate, status }) => {
      const dateKey = category === 'life' ? 'lifeDate' : 'nonLifeDate';
      const fieldKey = category === 'life' ? 'appointment_date_life' : 'appointment_date_nonlife';
      const rejectKey = category === 'life' ? 'appointment_reject_reason_life' : 'appointment_reject_reason_nonlife';
      setAppointmentInputs((prev) => ({ ...prev, [dateKey]: new Date(appointmentDate) }));
      updateSelectedFc({
        [fieldKey]: appointmentDate,
        [rejectKey]: null,
        ...(status ? { status } : {}),
      });
      notifications.show({ title: '저장 완료', message: '위촉 완료일이 저장되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: Error) => {
      notifications.show({ title: '오류', message: err.message, color: 'red' });
    },
  });

  const handleOpenModal = (fc: FCProfileWithDocuments) => {
    setSelectedFc(fc);
    setTempIdInput(fc.temp_id || '');
    setCareerInput((fc.career_type as '신입' | '경력') || null);
    setCommissionInput(
      getCommissionCompletionStatus(
        Boolean(fc.life_commission_completed),
        Boolean(fc.nonlife_commission_completed),
      ),
    );
    setAllowanceDateInput(fc.allowance_date ? new Date(fc.allowance_date) : null);
    setHanwhaSubmittedDateInput(fc.hanwha_commission_date_sub ? new Date(fc.hanwha_commission_date_sub) : null);
    const currentDocs = fc.fc_documents?.map((d: FCDocument) => d.doc_type) || [];
    logger.debug('Opening Modal for:', fc.name);
    logger.debug('Init SelectedDocs:', currentDocs);
    setSelectedDocs(currentDocs);
    setDocsDeadlineInput(fc.docs_deadline_at ? new Date(fc.docs_deadline_at) : null);

    // 위촉 일정 초기화
    setAppointmentInputs({
      life: fc.appointment_schedule_life ?? '',
      nonlife: fc.appointment_schedule_nonlife ?? '',
      lifeDate: fc.appointment_date_life ? new Date(fc.appointment_date_life) : (fc.appointment_date_life_sub ? new Date(fc.appointment_date_life_sub) : null),
      nonLifeDate: fc.appointment_date_nonlife ? new Date(fc.appointment_date_nonlife) : (fc.appointment_date_nonlife_sub ? new Date(fc.appointment_date_nonlife_sub) : null),
    });

    setCustomDocInput('');

    setModalTab(getDefaultModalTab(fc));
    open();
  };

  const handleOpenDoc = async (path: string) => {
    const normalizedPath = trimValue(path);
    if (!normalizedPath) return;

    let popup: Window | null = null;
    try {
      popup = openPendingAdminFileWindow((url, target) => window.open(url, target)) as Window | null;

      const resp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signDoc', payload: { path: normalizedPath } }),
      });
      const data = await resp.json().catch(() => null);
      const signedUrl = typeof data?.signedUrl === 'string' ? data.signedUrl : '';
      if (!resp.ok || !signedUrl) {
        closePendingAdminFileWindow(popup);
        popup = null;
        notifications.show({ title: '실패', message: '파일을 찾을 수 없습니다.', color: 'red' });
        return;
      }

      navigateAdminFileWindowOrCurrentTab(popup, signedUrl, (url) => window.location.assign(url));
    } catch {
      closePendingAdminFileWindow(popup);
      notifications.show({ title: '실패', message: '파일을 열 수 없습니다.', color: 'red' });
    }
  };

  const handleHanwhaPdfInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = '';

    if (!selectedFc || !file) return;
    const submittedDate = hanwhaSubmittedDateInput ? dayjs(hanwhaSubmittedDateInput).format('YYYY-MM-DD') : '';
    if (!submittedDate) {
      notifications.show({
        title: '승인 불가',
        message: '다위촉 URL 완료일을 먼저 저장해주세요.',
        color: 'red',
      });
      return;
    }

    if (file.type && file.type !== 'application/pdf') {
      notifications.show({ title: '파일 형식', message: 'PDF 파일만 업로드 가능합니다.', color: 'red' });
      return;
    }

    setIsHanwhaPdfUploading(true);
    try {
      const createResp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createHanwhaPdfUploadUrl',
          payload: {
            fcId: selectedFc.id,
            fileName: file.name,
          },
        }),
      });
      const createData = await createResp.json().catch(() => null);
      if (!createResp.ok || !createData?.uploadUrl) {
        const message =
          createData && typeof createData === 'object' && 'error' in createData
            ? String((createData as { error?: string }).error || '')
            : '';
        throw new Error(message || '다위촉 URL PDF 업로드 URL 생성 실패');
      }

      const uploadResp = await fetch(String(createData.uploadUrl), {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/pdf' },
        body: file,
      });
      if (!uploadResp.ok) {
        throw new Error('다위촉 URL PDF 업로드에 실패했습니다.');
      }

      await updateStatusMutation.mutateAsync({
        status: 'hanwha-commission-approved',
        title: '다위촉 URL 승인',
        msg: '다위촉 URL PDF가 등록되어 생명/손해 위촉 단계로 진행할 수 있습니다.',
        extra: {
          hanwha_commission_date: dayjs().format('YYYY-MM-DD'),
          hanwha_commission_date_sub: submittedDate,
          hanwha_commission_reject_reason: null,
          hanwha_commission_pdf_path: createData.storagePath,
          hanwha_commission_pdf_name: createData.fileName ?? file.name,
        },
      });
      notifications.show({ title: '승인 완료', message: '다위촉 URL PDF가 업로드되어 승인되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    } catch (err: unknown) {
      const error = err as Error;
      notifications.show({ title: '오류', message: error?.message ?? '다위촉 URL PDF 업로드 실패', color: 'red' });
    } finally {
      setIsHanwhaPdfUploading(false);
    }
  };

  const triggerHanwhaPdfUpload = () => {
    if (!selectedFc) return;
    const submittedDate = hanwhaSubmittedDateInput ? dayjs(hanwhaSubmittedDateInput).format('YYYY-MM-DD') : '';
    if (!submittedDate) {
      notifications.show({
        title: '승인 불가',
        message: '다위촉 URL 완료일을 먼저 저장해주세요.',
        color: 'red',
      });
      return;
    }
    if (isReadOnly) return;
    hanwhaPdfUploadInputRef.current?.click();
  };

  const handleDeleteHanwhaPdf = () => {
    if (!selectedFc) return;
    if (!selectedFc.hanwha_commission_pdf_path) {
      notifications.show({ title: '삭제 불가', message: '삭제할 다위촉 URL PDF가 없습니다.', color: 'orange' });
      return;
    }
    showConfirm({
      title: '다위촉 URL PDF 삭제',
      message: '현재 등록된 다위촉 URL PDF를 삭제하시겠습니까?',
      confirmLabel: '삭제',
      color: 'red',
      onConfirm: async () => {
        setIsHanwhaPdfDeleting(true);
        try {
          const deleteResp = await fetch('/api/admin/fc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'deleteHanwhaPdf',
              payload: {
                fcId: selectedFc.id,
                fileName: selectedFc.hanwha_commission_pdf_name ?? undefined,
              },
            }),
          });
          const deleteData = await deleteResp.json().catch(() => null);
          if (!deleteResp.ok) {
            const message =
              deleteData && typeof deleteData === 'object' && 'error' in deleteData
                ? String((deleteData as { error?: string }).error || '')
                : '';
            throw new Error(message || '다위촉 URL PDF 삭제 실패');
          }

          updateSelectedFc({
            hanwha_commission_pdf_path: null,
            hanwha_commission_pdf_name: null,
            status:
              selectedFc.status === 'appointment-completed' || selectedFc.status === 'final-link-sent'
                ? selectedFc.status
                : 'hanwha-commission-review',
          });
          queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
          notifications.show({ title: '삭제 완료', message: '다위촉 URL PDF가 삭제되었습니다.', color: 'green' });
        } catch (err: unknown) {
          const error = err as Error;
          notifications.show({ title: '오류', message: error?.message ?? '다위촉 URL PDF 삭제 실패', color: 'red' });
        } finally {
          setIsHanwhaPdfDeleting(false);
        }
      },
    });
  };

  const handleApproveHanwha = () => triggerHanwhaPdfUpload();

  const handleDeleteDocFile = async (doc: FCDocument) => {
    if (!selectedFc) return;
    if (doc?.status === 'approved') {
      notifications.show({ title: '삭제 불가', message: '승인된 서류는 삭제할 수 없습니다.', color: 'yellow' });
      return;
    }

    showConfirm({
      title: '서류 삭제',
      message: `'${doc?.doc_type}' 파일을 삭제할까요? 서류 상태가 초기화됩니다.`,
      confirmLabel: '삭제',
      color: 'red',
      onConfirm: async () => {
        try {
          const resp = await fetch('/api/admin/fc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'deleteDocFile',
              payload: {
                fcId: selectedFc.id,
                docType: doc.doc_type,
                storagePath: doc.storage_path,
              },
            }),
          });
          const data = await resp.json().catch(() => null);
          if (!resp.ok) {
            const message =
              data && typeof data === 'object' && 'error' in data
                ? String((data as { error?: string }).error || '')
                : '';
            throw new Error(message || '파일 삭제 중 오류가 발생했습니다.');
          }

          setSelectedFc((prev: FCProfileWithDocuments | null) =>
            prev
              ? {
                ...prev,
                ...buildDocWorkflowResetProfileFields(),
                fc_documents: prev.fc_documents?.map((d: FCDocument) =>
                  d.doc_type === doc.doc_type
                    ? { ...d, storage_path: 'deleted', status: 'pending' as const, file_name: 'deleted.pdf' }
                    : d,
                ),
              }
              : prev,
          );

          notifications.show({ title: '삭제 완료', message: '파일을 삭제했습니다.', color: 'gray' });
          queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
        } catch (err: unknown) {
          const error = err as Error;
          notifications.show({
            title: '삭제 실패',
            message: error?.message ?? '파일 삭제 중 오류가 발생했습니다.',
            color: 'red',
          });
        }
      },
    });
  };

  const handleAppointmentAction = (e: MouseEvent, type: 'schedule' | 'confirm', category: 'life' | 'nonlife') => {
    e.stopPropagation();
    if (!selectedFc) return;

    if (!canOpenInsuranceStage(selectedFc)) {
      notifications.show({
        title: '다위촉 URL 승인 대기',
        message: '다위촉 URL PDF가 등록되어야 생명/손해 위촉 단계를 진행할 수 있습니다.',
        color: 'orange',
      });
      return;
    }

    const isLife = category === 'life';
    let value = null;
    let dateValue: Date | null = null;
    let scheduleValue: string | null = null;

    if (type === 'schedule') {
      const scheduleVal = isLife ? appointmentInputs.life : appointmentInputs.nonlife;
      // Fallback to DB if not in state? No, modal initializes state.
      if (!scheduleVal) {
        notifications.show({ title: '입력 필요', message: '예정월을 입력해주세요.', color: 'yellow' });
        return;
      }
      scheduleValue = String(scheduleVal);
      value = scheduleValue;
    } else if (type === 'confirm') {
      const dateVal = isLife ? appointmentInputs.lifeDate : appointmentInputs.nonLifeDate;
      if (!dateVal) {
        notifications.show({ title: '입력 필요', message: '확정일을 입력해주세요.', color: 'red' });
        return;
      }
      dateValue = dateVal;
      value = dayjs(dateVal).format('YYYY-MM-DD');
    }

    const executeTransition = () => {
      startAppointmentTransition(async () => {
        const result = await updateAppointmentAction(
          { success: false },
          {
            fcId: selectedFc!.id,
            type,
            category,
            value,
          }
        );
        if (result.success) {
          const notificationWarning = getAdminNotificationWarning(result);
          notifications.show(notificationWarning
            ? { title: ADMIN_NOTIFICATION_WARNING_TITLE, message: notificationWarning, color: 'yellow' }
            : { title: '완료', message: result.message, color: 'green' });
          queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
          if (type === 'schedule' && scheduleValue) {
            updateSelectedFc({
              [isLife ? 'appointment_schedule_life' : 'appointment_schedule_nonlife']: scheduleValue,
            });
          }
          if (type === 'confirm' && dateValue) {
            const dateKey = isLife ? 'lifeDate' : 'nonLifeDate';
            setAppointmentInputs((prev) => ({ ...prev, [dateKey]: dateValue }));
            updateSelectedFc({
              [isLife ? 'appointment_date_life' : 'appointment_date_nonlife']: value,
            });
            const nextLifeDone = Boolean(
              (isLife ? value : selectedFc!.appointment_date_life) || selectedFc!.life_commission_completed,
            );
            const nextNonlifeDone = Boolean(
              (!isLife ? value : selectedFc!.appointment_date_nonlife) ||
              selectedFc!.nonlife_commission_completed,
            );
            const nextStatus = nextLifeDone && nextNonlifeDone ? 'final-link-sent' : 'appointment-completed';
            updateSelectedFc({ status: nextStatus });
          }
        } else {
          notifications.show({ title: '오류', message: result.error, color: 'red' });
        }
      });
    };

    if (type === 'schedule') {
      executeTransition();
    } else {
      showConfirm({
        title: '위촉 승인',
        message: '승인 하시겠습니까?',
        confirmLabel: '승인',
        color: 'blue',
        onConfirm: executeTransition,
      });
    }
  };

  const renderAppointmentSection = (category: 'life' | 'nonlife') => {
    if (!selectedFc) return null;

    const isLife = category === 'life';
    const schedule = isLife ? appointmentInputs.life : appointmentInputs.nonlife;
    const date = isLife ? appointmentInputs.lifeDate : appointmentInputs.nonLifeDate;
    const isConfirmed = isLife ? !!selectedFc.appointment_date_life : !!selectedFc.appointment_date_nonlife;
    const submittedDate = isLife ? selectedFc.appointment_date_life_sub : selectedFc.appointment_date_nonlife_sub;
    const isSubmitted = !isConfirmed && !!submittedDate;
    const insuranceStageOpen = canOpenInsuranceStage(selectedFc);
    const appointmentBusy = isAppointmentPending || updateAppointmentDateMutation.isPending;
    const sectionTitle = isLife ? '생명보험' : '손해보험';
    const approvalStatusLabel = isConfirmed
      ? '승인 완료'
      : isSubmitted
        ? 'FC 제출, 승인 대기'
        : '미입력';
    const approvalStatusColor = isConfirmed ? 'green' : isSubmitted ? 'orange' : 'gray';

    return (
      <Stack gap="xs" mt="sm">
        <Group justify="space-between" gap="xs" align="center">
          <Text size="sm" fw={700} c={isConfirmed ? 'green' : isSubmitted ? 'orange' : 'dimmed'}>
            {sectionTitle}
          </Text>
          <Badge variant={isConfirmed ? 'filled' : 'light'} color={approvalStatusColor} size="sm">
            승인 상태: {approvalStatusLabel}
          </Badge>
        </Group>
        <Group align="flex-end" grow>
          <TextInput
            label="예정(Plan)"
            placeholder="예: 12월 2차 / 1월 1차"
            classNames={{ input: 'muted-placeholder-input' }}
            value={schedule ?? ''}
            onChange={(e) => {
              const val = e.currentTarget?.value || '';
              setAppointmentInputs(prev => ({ ...prev, [isLife ? 'life' : 'nonlife']: val }));
            }}
            readOnly={!insuranceStageOpen}
            disabled={!insuranceStageOpen}
          />
          {isLife && !!selectedFc.appointment_reject_reason_life && (
            <Badge variant="light" color="red" size="xs">
              생명 반려
            </Badge>
          )}
          {!isLife && !!selectedFc.appointment_reject_reason_nonlife && (
            <Badge variant="light" color="red" size="xs">
              손해 반려
            </Badge>
          )}
          <DateInput
            label={
              <Group gap={6}>
                <Text size="sm">확정일(Actual)</Text>
                <Badge variant="light" color={approvalStatusColor} size="xs">
                  {approvalStatusLabel}
                </Badge>
              </Group>
            }
            value={date}
            onChange={(value) => {
              const nextValue = !value ? null : new Date(value);
              const parsed = nextValue && !Number.isNaN(nextValue.getTime()) ? nextValue : null;
              setAppointmentInputs((prev) => ({
                ...prev,
                [isLife ? 'lifeDate' : 'nonLifeDate']: parsed,
              }));
            }}
            placeholder="YYYY-MM-DD"
            valueFormat="YYYY-MM-DD"
            clearable={false}
            disabled={isReadOnly || !insuranceStageOpen}
            leftSection={<IconCalendar size={16} />}
            previousIcon={<IconChevronLeft size={16} />}
            nextIcon={<IconChevronRight size={16} />}
            popoverProps={{ withinPortal: true, shadow: 'md', position: 'bottom-start' }}
            styles={{
              ...getModalDateInputStyles(isReadOnly || !insuranceStageOpen),
              input: {
                ...(getModalDateInputStyles(isReadOnly || !insuranceStageOpen).input ?? {}),
                backgroundColor: isConfirmed ? '#EBFBEE' : isSubmitted ? '#fff4e6' : undefined,
                borderColor: isConfirmed ? '#40C057' : isSubmitted ? '#ff922b' : undefined,
              },
            }}
          />
        </Group>
        <Button
          fullWidth
          variant="light"
          color={isReadOnly ? 'gray' : 'orange'}
          leftSection={<IconDeviceFloppy size={14} />}
          loading={updateAppointmentDateMutation.isPending}
          disabled={isReadOnly || appointmentBusy || !insuranceStageOpen || !date}
          onClick={() => updateAppointmentDateMutation.mutate({ category })}
        >
          완료일 저장
        </Button>
        {isSubmitted && (
          <Text size="xs" c="orange">
            FC 제출일: {dayjs(submittedDate).format('YYYY-MM-DD')}
          </Text>
        )}
        <Stack gap={6}>
          <Button
            fullWidth
            variant={isReadOnly ? "default" : "filled"}
            color={isReadOnly ? "gray" : "blue"}
            leftSection={<IconDeviceFloppy size={14} />}
            loading={isAppointmentPending}
            disabled={isReadOnly || appointmentBusy || !insuranceStageOpen}
            onClick={(e) => handleAppointmentAction(e, 'schedule', category)}
          >
            일정 저장
          </Button>
          <Group grow gap={6}>
            <Button
              variant={isConfirmed ? "filled" : "light"}
              color="green"
              size="xs"
              disabled={isConfirmed || isReadOnly || appointmentBusy || !date || !insuranceStageOpen}
              loading={isAppointmentPending}
              onClick={(e) => handleAppointmentAction(e, 'confirm', category)}
            >
              {isConfirmed ? '승인 완료됨' : '승인 처리'}
            </Button>
            <Button
              variant="light"
              color="red"
              size="xs"
              disabled={isReadOnly || appointmentBusy || (!isConfirmed && !isSubmitted && !date) || !insuranceStageOpen}
              onClick={() => openRejectModal({ kind: 'appointment', category })}
            >
              반려
            </Button>
          </Group>
        </Stack>
      </Stack>
    );
  };

  const lifeCommissionSelected = commissionInput === 'life_only' || commissionInput === 'both';
  const nonlifeCommissionSelected = commissionInput === 'nonlife_only' || commissionInput === 'both';
  const commissionSummaryLabel =
    commissionInput === 'both'
      ? '생명/손해 최종 완료'
      : commissionInput === 'life_only'
        ? '생명 최종 완료'
        : commissionInput === 'nonlife_only'
          ? '손해 최종 완료'
          : '미완료';
  const commissionSummaryColor =
    commissionInput === 'both'
      ? 'green'
      : commissionInput === 'life_only'
        ? 'orange'
        : commissionInput === 'nonlife_only'
          ? 'blue'
          : 'gray';

  const handleCommissionToggle = (category: 'life' | 'nonlife') => {
    if (isReadOnly) return;

    const nextLife = category === 'life' ? !lifeCommissionSelected : lifeCommissionSelected;
    const nextNonlife = category === 'nonlife' ? !nonlifeCommissionSelected : nonlifeCommissionSelected;

    setCommissionInput(getCommissionCompletionStatus(nextLife, nextNonlife));
  };

  /* Table Rows */
  const rows = paginatedData.map((fc: FCProfileWithDocuments) => (
    <Table.Tr
      key={fc.id}
      style={{ cursor: 'pointer' }}
      onClick={() => router.push(`/dashboard/profile/${fc.id}`)}
    >
      <Table.Td w={200}>
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon variant="light" color="gray" size="lg" radius="xl">
            <IconUser size={18} />
          </ThemeIcon>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text size="sm" fw={600} c="dark.5" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {fc.name}
            </Text>
            <Group gap={6} mt={4}>
              {fc.career_type ? (
                <Text size="xs" c="dimmed">{fc.career_type}</Text>
              ) : (
                <Badge color="gray" size="xs" variant="outline">미입력</Badge>
              )}
              <Badge
                color={fc.identity_completed ? 'green' : 'orange'}
                size="xs"
                variant="light"
              >
                {fc.identity_completed ? '본등록' : '사전등록'}
              </Badge>
            </Group>
          </div>
        </Group>
      </Table.Td>
      <Table.Td ta="center">
        <Text size="sm" fw={600} c="dark.7">
          {fc.phone}
        </Text>
      </Table.Td>
      <Table.Td ta="center">
        <Text size="sm" fw={600} c="dark.7">
          {formatDashboardSignupDate(fc.signup_completed_at ?? fc.created_at)}
        </Text>
      </Table.Td>
      <Table.Td ta="center">
        <Text size="sm" fw={600} c="dark.7">
          {fc.affiliation || '-'}
        </Text>
      </Table.Td>
      <Table.Td ta="center">
        {(fc.appointment_date_life || fc.appointment_date_nonlife) ? (
          <Stack gap={4} align="center">
            {fc.appointment_date_life && (
              <Group gap={6} justify="center">
                <Badge variant="light" color="orange" size="xs">생명</Badge>
                <Text size="sm" fw={700} c="dark.8">
                  {dayjs(fc.appointment_date_life).format('YYYY-MM-DD')}
                </Text>
              </Group>
            )}
            {fc.appointment_date_nonlife && (
              <Group gap={6} justify="center">
                <Badge variant="light" color="blue" size="xs">손해</Badge>
                <Text size="sm" fw={700} c="dark.8">
                  {dayjs(fc.appointment_date_nonlife).format('YYYY-MM-DD')}
                </Text>
              </Group>
            )}
          </Stack>
        ) : (
          <Text size="xs" c="dimmed">-</Text>
        )}
      </Table.Td>
      <Table.Td ta="center">
        {(() => {
          const workflowStep = fc.step ?? calcStep(fc);
          const hanwha = workflowStep >= 3 ? getHanwhaStageStatus(fc) : null;
          const summary = getSummaryStatus(fc);
          const docs = fc.fc_documents ?? [];
          const totalDocs = docs.length;
          const submittedDocs = docs.filter((d: FCDocument) => d.storage_path && d.storage_path !== 'deleted').length;
          const approvedDocs = docs.filter((d: FCDocument) => d.status === 'approved').length;
          const pendingDocs = docs.filter(
            (d: FCDocument) => d.status !== 'approved' && d.status !== 'rejected',
          ).length;
          const rejectedDocs = docs.filter((d: FCDocument) => d.status === 'rejected').length;
          const showDocGrid =
            workflowStep === 2 &&
            totalDocs > 0 &&
            summary.label !== '서류 제출 대기';

          return (
            <Stack gap={6} align="center">
              {!showDocGrid &&
                (() => {
                  if (hanwha) {
                    return (
                      <Badge color={hanwha.color} variant="light" size="md" radius="sm">
                        {hanwha.label}
                      </Badge>
                    );
                  }
                  if (!summary.label || summary.label === '서류 제출 대기' || summary.label === '서류 반려') {
                    return null;
                  }
                  return (
                    <Badge color={summary.color} variant="light" size="md" radius="sm">
                      {summary.label}
                    </Badge>
                  );
                })()}
              {showDocGrid && (
                <Box
                  style={{
                    border: '1px solid #E5E7EB',
                    borderRadius: 12,
                    padding: 8,
                    backgroundColor: '#fff',
                  }}
                >
                  <SimpleGrid cols={2} spacing={6} verticalSpacing={6}>
                    <Badge color="orange" variant="light" size="md" radius="sm">
                      제출 {submittedDocs}/{totalDocs}
                    </Badge>
                    <Badge color="green" variant="light" size="md" radius="sm">
                      승인 {approvedDocs}/{totalDocs}
                    </Badge>
                    <Badge color="red" variant="light" size="md" radius="sm">
                      반려 {rejectedDocs}/{totalDocs}
                    </Badge>
                    <Badge color="yellow" variant="light" size="md" radius="sm">
                      검토 중 {pendingDocs}/{totalDocs}
                    </Badge>
                  </SimpleGrid>
                </Box>
              )}
              <Group gap={6} wrap="wrap" justify="center">
                {((workflowStep) >= 4 || getAppointmentProgress(fc, 'life').key === 'approved') &&
                  (() => {
                    const life = getAppointmentProgress(fc, 'life');
                    if (life.key === 'not-set') return null;
                    if (workflowStep < 4 && life.key !== 'approved') return null;
                    return (
                      <Badge color={life.color} variant="light" size="md" radius="sm">
                        생명 {life.label}
                      </Badge>
                    );
                  })()}
                {((workflowStep) >= 4 || getAppointmentProgress(fc, 'nonlife').key === 'approved') &&
                  (() => {
                    const nonlife = getAppointmentProgress(fc, 'nonlife');
                    if (nonlife.key === 'not-set') return null;
                    if (workflowStep < 4 && nonlife.key !== 'approved') return null;
                    return (
                      <Badge color={nonlife.color} variant="light" size="md" radius="sm">
                        손해 {nonlife.label}
                      </Badge>
                    );
                  })()}
              </Group>
            </Stack>
          );
        })()}
      </Table.Td>
      <Table.Td ta="center">
        {/* Updated Badge to use getAdminStep */}
        {(() => {
          const adminStepDisplay = getAdminStepDisplay(fc);
          return (
            <Badge
              variant="dot"
              size="md"
              color={adminStepDisplay.color}
              radius="xl"
              style={{ paddingTop: 6, paddingBottom: 6, height: 'auto', alignItems: 'center' }}
            >
              <Text
                size="xs"
                fw={700}
                style={{ whiteSpace: 'pre-line', lineHeight: 1.25, textAlign: 'center' }}
              >
                {adminStepDisplay.label.replace(' ', '\n')}
              </Text>
            </Badge>
          );
        })()}
      </Table.Td>
      <Table.Td ta="center">
        <Button
          variant="light"
          color="blue"
          size="xs"
          leftSection={<IconEdit size={14} />}
          onClick={(e) => {
            e.stopPropagation();
            handleOpenModal(fc);
          }}
        >
          관리
        </Button>
      </Table.Td>
    </Table.Tr>
  ));

  /* Metrics Calculation */
  const metrics = useMemo(() => {
    if (!fcs) return { total: 0, pendingAllowance: 0, pendingDocs: 0 };

    return fcs.reduce(
      (acc, fc: FCProfileWithDocuments) => {
        acc.total += 1;

        const workflowStep = calcStep(fc);
        const allowanceDisplay = getAllowanceDisplayState(fc);
        const docProgress = getDocProgress(fc);

        if (workflowStep === 1 && ['entered', 'prescreen'].includes(allowanceDisplay.key)) {
          acc.pendingAllowance += 1;
        }

        if (workflowStep === 2 && docProgress.key === 'in-progress') {
          acc.pendingDocs += 1;
        }

        return acc;
      },
      { total: 0, pendingAllowance: 0, pendingDocs: 0 },
    );
  }, [fcs]);

  const handleWebPushSettings = async () => {
    setIsPushRegistering(true);
    try {
      const result = await registerWebPushSubscription(role, residentId, { forceResubscribe: true });
      if (result.ok) {
        notifications.show({
          title: '웹 알림 설정 완료',
          message: '브라우저 알림이 정상 등록되었습니다.',
          color: 'green',
        });
        return;
      }

      const feedback = getWebPushRegistrationFeedback(result.message);
      notifications.show({
        title: feedback.title,
        message: feedback.message,
        color: feedback.color,
      });
    } catch (err: unknown) {
      const error = err as Error;
      notifications.show({
        title: '웹 알림 등록 실패',
        message: error?.message ?? '알림 등록 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setIsPushRegistering(false);
    }
  };

  const handleBrowserNotificationTest = async () => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      notifications.show({
        title: '지원되지 않음',
        message: '이 브라우저에서는 알림 API를 지원하지 않습니다.',
        color: 'orange',
      });
      return;
    }

    try {
      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }

      if (permission !== 'granted') {
        notifications.show({
          title: '알림 권한 필요',
          message: '브라우저 사이트 설정에서 알림을 허용해주세요.',
          color: 'orange',
        });
        return;
      }

      const title = 'FC 온보딩 알림 테스트';
      const body = '이 알림이 보이면 브라우저/OS 알림 경로는 정상입니다.';

      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.showNotification(title, {
            body,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            data: { url: '/dashboard' },
          });
        } else {
          new Notification(title, { body, icon: '/favicon.ico' });
        }
      } else {
        new Notification(title, { body, icon: '/favicon.ico' });
      }

      notifications.show({
        title: '테스트 알림 전송',
        message: '브라우저 시스템 알림 영역을 확인해주세요.',
        color: 'green',
      });
    } catch (err: unknown) {
      const error = err as Error;
      notifications.show({
        title: '알림 테스트 실패',
        message: error?.message ?? '알림 테스트 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  const canResetToLookup = Boolean(
    selectedFc?.temp_id && !isReadOnly && isLookupResettableStatus(selectedFc?.status),
  );
  return (
    <Box p="lg" maw={1600} mx="auto">
      <Stack gap="xl">
        {/* Header Section */}
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={1} fw={800} c="dark.8">대시보드</Title>
            <Text c="dimmed" mt={4}>FC 온보딩 전체 현황판</Text>
          </div>
          <Group gap="xs">
            <Button
              leftSection={<IconBell size={16} />}
              onClick={handleWebPushSettings}
              loading={isPushRegistering}
              variant="default"
              radius="md"
            >
              알림 설정
            </Button>
            <Button
              leftSection={<IconBell size={16} />}
              onClick={handleBrowserNotificationTest}
              variant="default"
              radius="md"
            >
              알림 테스트
            </Button>
            <Button
              leftSection={<IconRefresh size={16} />}
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
                queryClient.invalidateQueries({ queryKey: ['fc-signup-referral-code'] });
              }}
              variant="default"
              radius="md"
            >
              새로고침
            </Button>
          </Group>
        </Group>

        {/* Read-only Mode Alert */}
        {isReadOnly && (
          <Alert
            icon={<IconInfoCircle size={20} />}
            title="읽기 전용 모드"
            color="yellow"
            variant="light"
          >
            본부장 계정은 조회만 가능합니다. 수정 권한이 필요한 경우 관리자에게 문의하세요.
          </Alert>
        )}

        {/* Metrics Cards */}
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <Card
            component="button"
            type="button"
            padding="lg"
            radius="md"
            withBorder
            shadow="sm"
            className={styles.metricCard}
            data-active={metricFilter === 'all' || undefined}
            data-tone="total"
            aria-pressed={metricFilter === 'all'}
            onClick={() => handleMetricFilterChange('all')}
          >
            <Group justify="space-between" mb="xs">
              <Text c="dimmed" tt="uppercase" fw={700} size="xs" style={{ letterSpacing: '0.5px' }}>총 인원</Text>
              <ThemeIcon variant="light" color="blue" radius="md" size="lg">
                <IconUser size={22} stroke={1.5} />
              </ThemeIcon>
            </Group>
            <Group align="flex-end" gap="xs">
              <Text fw={800} size="2.5rem" lh={1}>{metrics.total}</Text>
              <Text c="dimmed" size="sm" mb={6}>명</Text>
            </Group>
            <Group justify="space-between" mt="md" gap="xs">
              <Text c="green" size="xs" fw={700}>가입 완료 FC 현황</Text>
              {metricFilter === 'all' && <Badge size="xs" variant="light" color="blue">전체 보기</Badge>}
            </Group>
          </Card>

          <Card
            component="button"
            type="button"
            padding="lg"
            radius="md"
            withBorder
            shadow="sm"
            className={styles.metricCard}
            data-active={metricFilter === 'pendingAllowance' || undefined}
            data-tone="allowance"
            aria-pressed={metricFilter === 'pendingAllowance'}
            onClick={() => handleMetricFilterChange('pendingAllowance')}
          >
            <Group justify="space-between" mb="xs">
              <Text c="dimmed" tt="uppercase" fw={700} size="xs" style={{ letterSpacing: '0.5px' }}>보증 보험 동의 승인 대기</Text>
              <ThemeIcon variant="light" color="orange" radius="md" size="lg">
                <IconCheck size={22} stroke={1.5} />
              </ThemeIcon>
            </Group>
            <Group align="flex-end" gap="xs">
              <Text fw={800} size="2.5rem" lh={1}>{metrics.pendingAllowance}</Text>
              <Text c="dimmed" size="sm" mb={6}>건</Text>
            </Group>
            <Group justify="space-between" mt="md" gap="xs">
              <Text c="orange" size="xs" fw={700}>승인 필요</Text>
              {metricFilter === 'pendingAllowance' && <Badge size="xs" color="orange">필터 적용</Badge>}
            </Group>
          </Card>

          <Card
            component="button"
            type="button"
            padding="lg"
            radius="md"
            withBorder
            shadow="sm"
            className={styles.metricCard}
            data-active={metricFilter === 'pendingDocs' || undefined}
            data-tone="documents"
            aria-pressed={metricFilter === 'pendingDocs'}
            onClick={() => handleMetricFilterChange('pendingDocs')}
          >
            <Group justify="space-between" mb="xs">
              <Text c="dimmed" tt="uppercase" fw={700} size="xs" style={{ letterSpacing: '0.5px' }}>서류검토 대기</Text>
              <ThemeIcon variant="light" color="indigo" radius="md" size="lg">
                <IconFileText size={22} stroke={1.5} />
              </ThemeIcon>
            </Group>
            <Group align="flex-end" gap="xs">
              <Text fw={800} size="2.5rem" lh={1}>{metrics.pendingDocs}</Text>
              <Text c="dimmed" size="sm" mb={6}>건</Text>
            </Group>
            <Group justify="space-between" mt="md" gap="xs">
              <Text c="indigo" size="xs" fw={700}>검토 필요</Text>
              {metricFilter === 'pendingDocs' && <Badge size="xs" color="indigo">필터 적용</Badge>}
            </Group>
          </Card>
        </SimpleGrid>

        {/* Quick Actions */}
        <Paper p="md" radius="md" withBorder bg="gray.0">
          <Group justify="space-between">
            <Group>
              <ThemeIcon variant="white" size="lg" radius="md" color="dark">
                <IconSend size={20} />
              </ThemeIcon>
              <div>
                <Text size="sm" fw={700}>빠른 작업</Text>
                <Text size="xs" c="dimmed">자주 사용하는 기능을 바로 실행하세요.</Text>
              </div>
            </Group>
            <Group gap="xs">
              <Button variant="white" color="dark" size="xs" leftSection={<IconUser size={14} />} onClick={() => router.push('/dashboard/exam/applicants')}>
                시험 신청자 관리
              </Button>
              <Button variant="white" color={isReadOnly ? "gray" : "dark"} size="xs" leftSection={<IconCalendar size={14} />} onClick={() => router.push('/dashboard/exam/schedule')} disabled={isReadOnly}>
                시험 일정 등록
              </Button>
              <Button variant="filled" color={isReadOnly ? "gray" : "dark"} size="xs" leftSection={<IconSend size={14} />} onClick={() => router.push('/dashboard/notifications/create')} disabled={isReadOnly}>
                새 공지 작성
              </Button>
            </Group>
          </Group>
        </Paper>

        {/* Main Content Area */}
        <Paper shadow="sm" radius="lg" withBorder p="md" bg="white">
          <Stack gap="xs" mb="md">
            <Group justify="space-between">
              <Tabs
                value={activeTab}
                onChange={handleActiveTabChange}
                variant="pills"
                radius="xl"
                color="dark"
              >
                <Tabs.List bg="gray.1" p={4} style={{ borderRadius: 24 }}>
                  <Tabs.Tab value="all" fw={600} px={16}>전체</Tabs.Tab>
                  {Object.entries(ADMIN_STEP_LABELS).map(([key, label]) => (
                    <Tabs.Tab key={key} value={key} fw={600} px={16}>{label}</Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs>
              <TextInput
                placeholder="이름, 연락처 검색"
                leftSection={<IconSearch size={16} stroke={1.5} />}
                classNames={{ input: 'muted-placeholder-input' }}
                value={keyword}
                onChange={(e) => {
                  const val = e.currentTarget?.value || '';
                  setKeyword(val);
                }}
                radius="xl"
                w={260}
              />
            </Group>
            <Group gap="xs">
              <Text size="xs" c="dimmed" fw={500}>빠른 분류:</Text>
              <Tabs
                value={activeTab}
                onChange={setActiveTab}
                variant="pills"
                radius="xl"
                color="blue"
              >
                <Tabs.List bg="blue.0" p={4} style={{ borderRadius: 24 }}>
                  <Tabs.Tab value="g_done" fw={600} px={14}>5단계 완료</Tabs.Tab>
                  <Tabs.Tab value="g_others" fw={600} px={14}>그 이외 (0~4단계)</Tabs.Tab>
                </Tabs.List>
              </Tabs>
            </Group>
          </Stack>

          <Box pos="relative" mih={400}>
            <LoadingOverlay visible={!hydrated || isLoading} overlayProps={{ blur: 1 }} />
            <ScrollArea h="calc(100vh - 280px)" type="auto" offsetScrollbars>
              <Table verticalSpacing="sm" highlightOnHover striped withTableBorder>
                <Table.Thead bg="gray.0" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <Table.Tr>
                    {DASHBOARD_FC_LIST_COLUMNS.map((column) => (
                      <Table.Th
                        key={column.key}
                        w={column.width}
                        ta={column.align === 'center' ? 'center' : undefined}
                      >
                        {column.label}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.length > 0 ? (
                    rows
                  ) : (
                    <Table.Tr>
                      <Table.Td colSpan={DASHBOARD_FC_LIST_COLUMN_COUNT} align="center" py={80}>
                        <Stack align="center" gap="xs">
                          <ThemeIcon size={60} radius="xl" color="gray" variant="light">
                            <IconSearch size={30} />
                          </ThemeIcon>
                          <Text c="dimmed" fw={500}>조건에 맞는 데이터가 없습니다.</Text>
                        </Stack>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>

            {/* 페이지네이션 */}
            {filteredData.length > ITEMS_PER_PAGE && (
              <Group justify="center" mt="lg">
                <Pagination
                  total={totalPages}
                  value={currentPage}
                  onChange={setCurrentPage}
                  size="md"
                  radius="md"
                  withEdges
                />
              </Group>
            )}
          </Box>
        </Paper>

        {/* 요약 정보 */}
        <Paper p="md" radius="md" withBorder>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              전체 {filteredData.length}명 중 {paginatedData.length}명 표시 (페이지 {currentPage}/{totalPages})
            </Text>
          </Group>
        </Paper>
      </Stack>

      <Modal
        opened={opened}
        onClose={close}
        title={<Text fw={700} size="lg">FC 상세 관리</Text>}
        size="lg"
        padding="xl"
        radius="md"
        centered
        overlayProps={{ blur: 3 }}
      >
        {selectedFc && (
          <>
            <Group mb="xl" align="flex-start">
              <Avatar size="lg" color="orange" radius="xl">
                {selectedFc.name?.slice(0, 1) || '?'}
              </Avatar>
              <div>
                <Group gap="xs" align="center">
                  <Text size="lg" fw={700}>
                    {selectedFc.name}
                  </Text>
                  <Badge variant="light" color={!selectedFc.career_type ? 'gray' : 'blue'}>
                    {selectedFc.career_type || '조회중'}
                  </Badge>
                </Group>
                <Text size="sm" c="dimmed">
                  {selectedFc.phone} · {selectedFc.affiliation || '소속 미정'}
                </Text>
                <Stack gap={2} mt={6}>
                  <Text size="sm" fw={600} c="dark.8">
                    주민등록번호:{' '}
                    <Text component="span" size="sm" fw={700} c={isSelectedResidentNumberFetching ? 'dimmed' : 'dark.8'}>
                      {selectedResidentNumberDisplay}
                    </Text>
                  </Text>
                  <Text size="xs" c="dimmed">
                    생년월일: {selectedBirthDateDisplay}
                  </Text>
                </Stack>
              </div>
            </Group>

            <Tabs value={modalTab} onChange={setModalTab} color="orange" variant="outline" radius="md">
              <Tabs.List
                mb="lg"
                style={{ display: 'flex', flexWrap: 'nowrap', gap: 8, overflowX: 'auto' }}
              >
                <Tabs.Tab
                  value="info"
                  leftSection={<IconEdit size={16} />}
                  style={{ flex: '1 1 0', minWidth: 0, justifyContent: 'center', whiteSpace: 'nowrap' }}
                >
                  보증 보험 동의
                </Tabs.Tab>
                <Tabs.Tab
                  value="docs"
                  leftSection={<IconFileText size={16} />}
                  style={{ flex: '1 1 0', minWidth: 0, justifyContent: 'center', whiteSpace: 'nowrap' }}
                >
                  서류 관리
                </Tabs.Tab>
                <Tabs.Tab
                  value="hanwha"
                  leftSection={<IconCalendar size={16} />}
                  style={{ flex: '1 1 0', minWidth: 0, justifyContent: 'center', whiteSpace: 'nowrap' }}
                >
                  다위촉
                </Tabs.Tab>
                <Tabs.Tab
                  value="appointment"
                  leftSection={<IconCalendar size={16} />}
                  style={{ flex: '1 1 0', minWidth: 0, justifyContent: 'center', whiteSpace: 'nowrap' }}
                >
                  생명/손해 위촉
                </Tabs.Tab>

              </Tabs.List>
              <Tabs.Panel value="info">
                <Stack gap="md">
                  {(() => {
                    const allowanceDisplay = getAllowanceDisplayState(selectedFc);

                    return (
                      <Box>
                        <Text size="xs" fw={700} c="dimmed" mb={6}>
                          현재 진행 단계
                        </Text>
                        <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
                          {ALLOWANCE_FLOW_CARDS.map((step) => {
                            const active = step.key === allowanceDisplay.key;
                            return (
                              <Paper
                                key={step.key}
                                withBorder
                                radius="md"
                                p="sm"
                                style={{
                                  borderColor: active
                                    ? 'var(--mantine-color-orange-3)'
                                    : 'var(--mantine-color-gray-3)',
                                  backgroundColor: active
                                    ? 'var(--mantine-color-orange-0)'
                                    : 'var(--mantine-color-white)',
                                }}
                              >
                                <Group justify="space-between" align="flex-start" gap="xs">
                                  <Stack gap={2}>
                                    <Text size="xs" c="dimmed" fw={700}>
                                      {step.label}
                                    </Text>
                                    <Text size="sm" fw={700}>
                                      {step.helper}
                                    </Text>
                                  </Stack>
                                  <Badge
                                    size="xs"
                                    variant={active ? 'filled' : 'light'}
                                    color={active ? 'orange' : 'gray'}
                                  >
                                    {active ? '현재' : '대기'}
                                  </Badge>
                                </Group>
                              </Paper>
                            );
                          })}
                        </SimpleGrid>
                      </Box>
                    );
                  })()}

                  <TextInput
                    label="임시사번"
                    placeholder="T-123456"
                    classNames={{ input: 'muted-placeholder-input' }}
                    value={tempIdInput}
                    onChange={(e) => {
                      const val = e.currentTarget?.value || '';
                      setTempIdInput(val);
                    }}
                  />
                    {canResetToLookup && (
                    <>
                      <Button
                        variant="light"
                        color="gray"
                        size="xs"
                        leftSection={<IconRefresh size={14} />}
                        loading={resetToLookupMutation.isPending}
                        onClick={() => {
                          showConfirm({
                            title: '조회중 단계로 되돌리기',
                            message: '임시사번과 보증보험 조회 동의일을 비우고 조회중(임시사번 미입력) 단계로 되돌릴까요?',
                            confirmLabel: '되돌리기',
                            color: 'orange',
                            onConfirm: () => resetToLookupMutation.mutate(),
                          });
                        }}
                      >
                        조회중 단계로 되돌리기
                      </Button>
                      <Text size="xs" c="dimmed" mt={-8}>
                        잘못 입력한 임시사번을 비우고 이전 단계로 되돌릴 때 사용합니다.
                      </Text>
                    </>
                  )}
                  <Box>
                    <Text size="sm" fw={500} mb={6}>
                      경력 구분 {careerInput === null && <Text span c="red" size="xs">(선택 필요)</Text>}
                    </Text>
                    <Chip.Group value={careerInput || ''} onChange={(v) => setCareerInput(v as '신입' | '경력' | null)}>
                      <Group gap="xs">
                        <Chip value="신입" color="orange" variant="light">
                          신입
                        </Chip>
                        <Chip value="경력" color="blue" variant="light">
                          경력
                        </Chip>
                      </Group>
                    </Chip.Group>
                  </Box>

                  <Box mt="md">
                    {(() => {
                      const allowanceDisplay = getAllowanceDisplayState(selectedFc);
                      const effectiveAllowanceDate = allowanceDateInput
                        ? dayjs(allowanceDateInput).format('YYYY-MM-DD')
                        : selectedFc.allowance_date ?? null;
                      const hasTempIdForAllowance = Boolean(String(selectedFc.temp_id ?? '').trim());
                      const allowanceStateButtons = [
                        {
                          key: 'prescreen',
                          label: '사전 심사 요청 하기',
                          active: allowanceDisplay.key === 'prescreen',
                          color: 'blue' as const,
                          onClick: () =>
                            updateStatusMutation.mutate({
                              status: 'allowance-pending',
                              title: '사전 심사 요청',
                              msg: '사전 심사 요청을 보냈습니다.',
                              extra: {
                                allowance_date: effectiveAllowanceDate,
                                allowance_prescreen_requested_at: new Date().toISOString(),
                                allowance_reject_reason: null,
                              },
                            }),
                        },
                        {
                          key: 'approved',
                          label: '승인 완료',
                          active: allowanceDisplay.key === 'approved',
                          color: 'green' as const,
                          onClick: () =>
                            updateStatusMutation.mutate({
                              status: 'allowance-consented',
                              title: '보증 보험 동의 승인',
                              msg: '보증 보험 동의가 승인되었습니다. 서류 제출 단계로 진행해주세요.',
                              extra: {
                                allowance_date: effectiveAllowanceDate,
                                allowance_reject_reason: null,
                              },
                            }),
                        },
                      ] as const;
                      const hasAllowanceDateForAction = Boolean(effectiveAllowanceDate);
                      const allowanceStateDisabled =
                        isReadOnly || updateStatusMutation.isPending || !hasTempIdForAllowance || !hasAllowanceDateForAction;

                      return (
                        <>
                          <Paper withBorder radius="lg" p="md">
                            <Text fw={600} size="sm" mb="xs">
                              보증 보험 동의 관리
                            </Text>
                            <Text size="xs" c="dimmed" mb="md">
                              화면에서 현재 진행 단계를 확인한 뒤, 아래에서 상태를 저장하거나 변경하세요.
                            </Text>
                            {!hasTempIdForAllowance ? (
                              <Alert
                                mb="md"
                                color="red"
                                radius="md"
                                icon={<IconInfoCircle size={16} />}
                              >
                                <Text size="sm">
                                  임시사번 발급 후 보증보험 조회 동의일 저장과 승인 처리를 진행할 수 있습니다.
                                </Text>
                              </Alert>
                            ) : null}
                            {!hasAllowanceDateForAction ? (
                              <Alert
                                mb="md"
                                color="orange"
                                radius="md"
                                icon={<IconInfoCircle size={16} />}
                              >
                                <Text size="sm">
                                  보증보험 조회 동의일을 입력해야 사전 심사 요청과 승인 완료를 저장할 수 있습니다.
                                </Text>
                              </Alert>
                            ) : null}

                            {isReadOnly ? (
                              <Alert
                                mb="md"
                                color="gray"
                                radius="md"
                                icon={<IconInfoCircle size={16} />}
                              >
                                <Text size="sm">
                                  본부장 계정은 현재 상태 확인만 가능하며, 저장과 상태 변경 버튼은 비활성화됩니다.
                                </Text>
                              </Alert>
                            ) : null}

                            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                              <Stack gap="sm">
                                <DateInput
                                  label="보증보험 조회 동의일"
                                  value={allowanceDateInput}
                                  onChange={handleAllowanceDateChange}
                                  placeholder="YYYY-MM-DD"
                                  valueFormat="YYYY-MM-DD"
                                  disabled={isReadOnly || !hasTempIdForAllowance}
                                  clearable={false}
                                  radius="md"
                                  size="md"
                                  leftSection={<IconCalendar size={16} />}
                                  previousIcon={<IconChevronLeft size={16} />}
                                  nextIcon={<IconChevronRight size={16} />}
                                  popoverProps={{ withinPortal: true, shadow: 'md', position: 'bottom-start' }}
                                  styles={getModalDateInputStyles(isReadOnly || !hasTempIdForAllowance)}
                                />
                                <Button
                                  fullWidth
                                  size="sm"
                                  color={isReadOnly ? 'gray' : 'orange'}
                                  variant="light"
                                  leftSection={<IconDeviceFloppy size={16} />}
                                  onClick={() => updateAllowanceDateMutation.mutate()}
                                  loading={updateAllowanceDateMutation.isPending}
                                  disabled={isReadOnly || !hasTempIdForAllowance || !allowanceDateInput}
                                >
                                  보증보험 조회 동의일 저장
                                </Button>
                              </Stack>

                              <Stack gap="sm">
                                <Box>
                                  <Text
                                    size="sm"
                                    fw={500}
                                    mb={6}
                                    c="transparent"
                                    aria-hidden="true"
                                  >
                                    상태 조작
                                  </Text>
                                  <Button
                                    fullWidth
                                    color="blue"
                                    variant={allowanceDisplay.key === 'prescreen' ? 'filled' : 'light'}
                                    onClick={() => allowanceStateButtons[0].onClick()}
                                    disabled={allowanceStateDisabled}
                                    leftSection={<IconSend size={16} />}
                                  >
                                    사전 심사 요청 하기
                                  </Button>
                                </Box>
                                <StatusToggle
                                  value={allowanceDisplay.key === 'approved' ? 'approved' : 'pending'}
                                  onChange={(val) => {
                                    if (val === 'approved') {
                                      allowanceStateButtons[1].onClick();
                                      return;
                                    }
                                    if (allowanceDisplay.key === 'rejected') {
                                      return;
                                    }
                                    openRejectModal({ kind: 'allowance' });
                                  }}
                                  labelPending="미승인"
                                  labelApproved="승인 완료"
                                  readOnly={allowanceStateDisabled}
                                  allowPendingPress
                                  isManagerMode={isReadOnly}
                                />
                              </Stack>
                            </SimpleGrid>
                          </Paper>
                        </>
                      );
                    })()}
                  </Box>

                  <Button fullWidth mt="md" onClick={() => updateInfoMutation.mutate()} loading={updateInfoMutation.isPending} disabled={isReadOnly || (selectedFc.status !== 'draft' && selectedFc.status !== 'temp-id-issued' && selectedFc.status !== 'allowance-pending')} color={isReadOnly ? "gray" : "dark"}>
                    변경사항 저장
                  </Button>

                  <Divider my="sm" />

                  <Group grow>
                    <Button
                      variant="light"
                      color={isReadOnly ? "gray" : "orange"}
                      leftSection={<IconSend size={16} />}
                      disabled={isReadOnly}
                      onClick={async () => {
                        // Resolve the current notification recipient from the stable FC id on the server.
                        const notificationResult = await sendPushNotificationForFc(selectedFc.id, {
                          title: '진행 요청',
                          body: '관리자가 진행을 요청하였습니다.',
                          data: { url: '/' },
                        });
                        notifications.show(notificationResult.success
                          ? { title: '전송 완료', message: '알림을 보냈습니다.', color: 'blue' }
                          : {
                              title: '전달 확인 필요',
                              message: '알림 저장 또는 기기 전달을 완료하지 못했습니다.',
                              color: 'yellow',
                            });
                      }}
                    >
                      재촉 알림
                    </Button>
                    <Button
                      variant="subtle"
                      color={isReadOnly ? "gray" : "red"}
                      leftSection={<IconTrash size={16} />}
                      disabled={isReadOnly}
                      onClick={() => {
                        logger.debug('[Web][deleteFc] click', { id: selectedFc?.id, phone: selectedFc?.phone });
                        showConfirm({
                          title: 'FC 삭제',
                          message: '정말로 FC를 삭제하시겠습니까? 관련 서류도 모두 삭제됩니다.',
                          confirmLabel: '삭제',
                          color: 'red',
                          onConfirm: () => {
                            logger.debug('[Web][deleteFc] mutate');
                            deleteFcMutation.mutate();
                          },
                        });
                      }}
                    >
                      FC 삭제
                    </Button>
                  </Group>
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="docs">
                <Stack gap="md">
                  <Card withBorder radius="md" p="sm" bg="gray.0">
                    <Group justify="space-between" mb="xs">
                      <Text fw={600} size="sm">
                        요청 서류 ({selectedFc.fc_documents?.length || 0}건)
                      </Text>
                    </Group>
                    {selectedFc.fc_documents?.length ? (
                      <Stack gap={8}>
                        {selectedFc.fc_documents.map((d: FCDocument, idx: number) => {
                          const isSubmitted = Boolean(d.storage_path && d.storage_path !== 'deleted');
                          return (
                            <Card
                              key={idx}
                              radius="md"
                              withBorder
                              shadow="sm"
                              p={0}
                              style={{
                                overflow: 'hidden',
                                borderColor: isSubmitted ? '#339af0' : '#fd7e14',
                                borderWidth: 1,
                              }}
                            >
                              <Group
                                justify="space-between"
                                p="sm"
                                bg="white"
                              >
                                <Group gap="sm">
                                  <ThemeIcon
                                    variant="light"
                                    size="lg"
                                    color={d.status === 'approved' ? 'teal' : d.status === 'rejected' ? 'red' : 'gray'}
                                  >
                                    {d.status === 'approved' ? (
                                      <IconCheck size={20} />
                                    ) : d.status === 'rejected' ? (
                                      <IconX size={20} />
                                    ) : (
                                      <IconFileText size={20} />
                                    )}
                                  </ThemeIcon>
                                  <div>
                                    <Text size="sm" fw={700}>
                                      {d.doc_type}
                                    </Text>
                                    <Text size="xs" c="dimmed">
                                      {d.file_name || '미제출'}
                                    </Text>
                                    <Badge
                                      size="sm"
                                      variant="dot"
                                      color={d.status === 'approved' ? 'teal' : d.status === 'rejected' ? 'red' : 'gray'}
                                      mt={4}
                                    >
                                      {d.status === 'approved'
                                        ? '승인됨'
                                        : d.status === 'rejected'
                                          ? '반려됨'
                                          : '검토 대기'}
                                    </Badge>
                                  </div>
                                </Group>
                                <Group gap={4}>
                                  {isSubmitted && (
                                    <Button
                                      variant="default"
                                      size="xs"
                                      onClick={() => handleOpenDoc(d.storage_path ?? '')}
                                    >
                                      열기
                                    </Button>
                                  )}
                                  <Divider orientation="vertical" />
                                  <Group gap={4}>
                                    <StatusToggle
                                      value={d.status === 'approved' ? 'approved' : 'pending'}
                                      onChange={async (val) => {
                                        const nextStatus = (val === 'approved' ? 'approved' : 'rejected') as 'approved' | 'rejected';
                                        if (val !== 'approved') {
                                          if (d.status === 'rejected') return;
                                          openRejectModal({ kind: 'doc', doc: d });
                                          return;
                                        }
                                        if (nextStatus === d.status) return;
                                        if (nextStatus === 'approved') {
                                          showConfirm({
                                            title: '서류 승인',
                                            message: isSubmitted
                                              ? '문서를 승인하시겠습니까?'
                                              : '파일이 미제출된 문서입니다. 총무 수동 승인으로 처리하시겠습니까?',
                                            confirmLabel: '승인',
                                            color: 'blue',
                                            onConfirm: async () => {
                                              const manualApprovalNote = isSubmitted ? null : '총무 수동 승인: 파일 미제출';
                                              const res = await updateDocStatusAction({ success: false }, {
                                                fcId: selectedFc.id,
                                                docType: d.doc_type,
                                                status: nextStatus,
                                                reason: manualApprovalNote,
                                              });
                                              if (res.success) {
                                                const notificationWarning = getAdminNotificationWarning(res);
                                                notifications.show(notificationWarning
                                                  ? { title: ADMIN_NOTIFICATION_WARNING_TITLE, message: notificationWarning, color: 'yellow' }
                                                  : { title: '승인', message: res.message, color: 'green' });
                                                const nextDocs = (selectedFc.fc_documents || []).map((doc: FCDocument) =>
                                                  doc.doc_type === d.doc_type
                                                    ? { ...doc, status: nextStatus, reviewer_note: manualApprovalNote }
                                                    : doc
                                                );
                                                const allApproved =
                                                  nextDocs.length > 0 && nextDocs.every((doc: FCDocument) => doc.status === 'approved');
                                                let nextProfileStatus = selectedFc.status;
                                                if (!DOCS_STAGE_LOCK_STATUSES.includes(selectedFc.status)) {
                                                  if (allApproved) {
                                                    nextProfileStatus = 'docs-approved';
                                                  } else if (selectedFc.status === 'docs-approved') {
                                                    nextProfileStatus = 'docs-pending';
                                                  }
                                                }
                                                updateSelectedFc(
                                                  nextProfileStatus === 'docs-pending'
                                                    ? { ...buildDocWorkflowResetProfileFields(), fc_documents: nextDocs }
                                                    : { fc_documents: nextDocs, status: nextProfileStatus },
                                                );
                                                queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
                                              } else {
                                                notifications.show({ title: '오류', message: res.error, color: 'red' });
                                              }
                                            },
                                          });
                                          return;
                                        }
                                      }}
                                      labelPending="미승인"
                                      labelApproved="승인"
                                      showNeutralForPending
                                      allowPendingPress
                                      readOnly={isReadOnly}
                                      isManagerMode={isReadOnly}
                                    />
                                    <Tooltip label="삭제">
                                      <ActionIcon
                                        variant="light"
                                        color={isReadOnly ? "gray" : "red"}
                                        size="input-xs"
                                        disabled={isReadOnly || !isSubmitted}
                                        onClick={() => handleDeleteDocFile(d)}
                                      >
                                        <IconTrash size={16} />
                                      </ActionIcon>
                                    </Tooltip>
                                  </Group>
                                </Group>
                              </Group>
                            </Card>
                          )
                        })}
                      </Stack>
                    ) : (
                      <Text size="xs" c="dimmed" ta="center" py="md">
                        제출된 서류가 없습니다.
                      </Text>
                    )}
                  </Card>

                  <Box>
                    <Text fw={600} size="sm" mb="xs">
                      필수 서류 요청 목록
                    </Text>
                    <Box mb="md">
                      <Text size="xs" c="dimmed" fw={500} mb={6}>
                        서류 마감일 (알림용)
                      </Text>
                      <DateInput
                        value={docsDeadlineInput}
                        onChange={handleDocsDeadlineChange}
                        placeholder="YYYY-MM-DD"
                        classNames={{ input: 'muted-placeholder-input' }}
                        valueFormat="YYYY-MM-DD"
                        clearable
                        size="sm"
                        leftSection={<IconCalendar size={16} />}
                        previousIcon={<IconChevronLeft size={16} />}
                        nextIcon={<IconChevronRight size={16} />}
                        popoverProps={{ withinPortal: true, shadow: 'md', position: 'bottom-start' }}
                        styles={{
                          calendarHeaderControl: { width: 32, height: 32 },
                          calendarHeaderControlIcon: { width: 14, height: 14 },
                          calendarHeaderLevel: { fontSize: 14, fontWeight: 700 },
                          calendarHeader: { gap: 6 },
                          weekday: {
                            fontSize: 12,
                            fontWeight: 700,
                            textAlign: 'center',
                            width: 36,
                          },
                          day: {
                            width: 36,
                            height: 36,
                            fontSize: 13,
                            fontWeight: 600,
                            textAlign: 'center',
                          },
                          monthCell: { padding: 4 },
                        }}
                      />
                    </Box>
                    {(() => {
                      const submittedDocTypes = new Set(
                        (selectedFc.fc_documents ?? [])
                          .filter((d: FCDocument) => d.storage_path && d.storage_path !== 'deleted')
                          .map((d: FCDocument) => d.doc_type),
                      );
                      return (
                        <Chip.Group multiple value={selectedDocs} onChange={(val) => {
                          logger.debug('Chip Change:', val);
                          setSelectedDocs(val);
                        }}>
                          <Group gap={6}>
                            {Array.from(new Set([...DOC_OPTIONS, ...selectedDocs])).map((doc) => {
                              const isRequested = selectedDocs.includes(doc);
                              const isSubmitted = submittedDocTypes.has(doc);
                              const borderColor = isSubmitted ? '#2563eb' : isRequested ? '#f97316' : '#e5e7eb';
                              const textColor = isSubmitted ? '#2563eb' : isRequested ? '#f97316' : '#9CA3AF';
                              return (
                                <Chip
                                  key={doc}
                                  value={doc}
                                  variant="outline"
                                  size="xs"
                                  radius="sm"
                                  color={isSubmitted ? 'blue' : isRequested ? 'orange' : 'gray'}
                                  styles={{
                                    label: { borderColor, color: textColor },
                                  }}
                                >
                                  {doc}
                                </Chip>
                              );
                            })}
                          </Group>
                        </Chip.Group>
                      );
                    })()}
                  </Box>

                  <Group align="flex-end" gap={6}>
                    <TextInput
                      placeholder="기타 서류 입력"
                      classNames={{ input: 'muted-placeholder-input' }}
                      style={{ flex: 1 }}
                      size="xs"
                      value={customDocInput}
                      onChange={(e) => {
                        const val = e.currentTarget?.value || '';
                        const cleaned = val.replace(/\u200B/g, '').trimStart();
                        setCustomDocInput(cleaned.trim().length === 0 ? '' : cleaned);
                      }}
                    />
                    <Button
                      variant="default"
                      size="xs"
                      disabled={isReadOnly}
                      onClick={() => {
                        if (customDocInput.trim()) {
                          const val = customDocInput.trim();
                          if (!selectedDocs.includes(val)) {
                            const nextDocs = [...selectedDocs, val];
                            setSelectedDocs(nextDocs);
                            updateDocsRequestMutation.mutate({ types: nextDocs, deadline: docsDeadlineInput });
                          }
                          setCustomDocInput('');
                        }
                      }}
                    >
                      추가
                    </Button>
                  </Group>

                  <Button
                    fullWidth
                    color={isReadOnly ? "gray" : "orange"}
                    mt="md"
                    disabled={isReadOnly}
                    onClick={() => updateDocsRequestMutation.mutate({ types: selectedDocs, deadline: docsDeadlineInput })}
                    loading={updateDocsRequestMutation.isPending}
                  >
                    서류 요청 업데이트
                  </Button>

                  <Divider my="md" />

                  <Text fw={600} size="sm" mb="xs">서류 심사 완료</Text>
                  <StatusToggle
                    value={['docs-approved', 'hanwha-commission-review', 'hanwha-commission-rejected', 'hanwha-commission-approved', 'appointment-completed', 'final-link-sent'].includes(selectedFc.status) ? 'approved' : 'pending'}
                    onChange={(val) => {
                      if (val === 'approved') {
                        updateStatusMutation.mutate({
                          status: 'docs-approved',
                          title: '서류 검토 완료',
                          msg: '서류 검토가 완료되었습니다. 다위촉 URL 단계로 진행해주세요.',
                        });
                        return;
                      }
                      showConfirm({
                        title: '심사 완료 취소',
                        message: '심사 완료 상태를 취소하시겠습니까?',
                        confirmLabel: '취소',
                        color: 'orange',
                        onConfirm: () => {
                          updateStatusMutation.mutate({
                            status: 'docs-pending',
                            msg: '',
                            extra: buildDocWorkflowResetProfileFields(),
                          });
                        },
                      });
                    }}
                    labelPending="심사 대기"
                    labelApproved="심사 완료"
                    showNeutralForPending
                    readOnly={isReadOnly || DOCS_STAGE_LOCK_STATUSES.includes(selectedFc.status)}
                    isManagerMode={isReadOnly}
                  />
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="hanwha">
                <Stack gap="md">
                  {(() => {
                    const hanwhaStatus = getHanwhaStageStatus(selectedFc);
                    const hanwhaDescription = getHanwhaStageDescription(selectedFc);

                    return (
                      <Alert
                        color={hanwhaStatus?.color ?? 'blue'}
                        icon={<IconInfoCircle size={16} />}
                        radius="md"
                      >
                        <Text fw={700} size="sm" mb={4}>
                          {hanwhaStatus?.label ?? '다위촉 URL 대기'}
                        </Text>
                        <Text size="xs">
                          {hanwhaDescription ?? '서류 승인이 끝나면 다위촉 URL 관리 단계가 열립니다.'}
                        </Text>
                      </Alert>
                    );
                  })()}

                  <Box mt="md">
                    <Group justify="space-between" mb="xs">
                      <Text fw={600} size="sm">다위촉 URL 검토</Text>
                      <Badge
                        variant="light"
                        color={selectedFc.hanwha_commission_date_sub ? 'green' : 'gray'}
                        size="sm"
                      >
                        {selectedFc.hanwha_commission_date_sub ? '입력됨' : '미입력'}
                      </Badge>
                    </Group>
                    <DateInput
                      label="완료일(다위촉 URL)"
                      value={hanwhaSubmittedDateInput}
                      onChange={handleHanwhaSubmittedDateChange}
                      placeholder="YYYY-MM-DD"
                      valueFormat="YYYY-MM-DD"
                      clearable={false}
                      disabled={isReadOnly}
                      radius="md"
                      size="md"
                      leftSection={<IconCalendar size={16} />}
                      previousIcon={<IconChevronLeft size={16} />}
                      nextIcon={<IconChevronRight size={16} />}
                      popoverProps={{ withinPortal: true, shadow: 'md', position: 'bottom-start' }}
                      styles={getModalDateInputStyles(isReadOnly)}
                    />
                    <Button
                      fullWidth
                      mt="sm"
                      size="xs"
                      color={isReadOnly ? 'gray' : 'orange'}
                      variant="light"
                      onClick={() => updateHanwhaSubmissionDateMutation.mutate()}
                      loading={updateHanwhaSubmissionDateMutation.isPending}
                      disabled={isReadOnly || !hanwhaSubmittedDateInput}
                    >
                      완료일 저장
                    </Button>
                    <Card withBorder radius="md" p="sm" mt="sm" bg={selectedFc.dawichok_url_sent_at ? 'teal.0' : 'orange.0'}>
                      <Group justify="space-between" gap="xs" mb={4}>
                        <Text size="xs" fw={700} c={selectedFc.dawichok_url_sent_at ? 'teal' : 'orange'}>
                          다위촉 URL 발송 안내
                        </Text>
                        <Badge
                          size="sm"
                          color={selectedFc.dawichok_url_sent_at ? 'teal' : 'gray'}
                          variant="light"
                        >
                          {selectedFc.dawichok_url_sent_at ? '발송됨' : '미발송'}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed">
                        FC에게 “카카오톡으로 전송된 다위촉 URL을 진행해 주세요.” 알림을 보냅니다.
                      </Text>
                      {selectedFc.dawichok_url_sent_at ? (
                        <Text size="xs" c="dimmed" mt={4}>
                          최근 발송: {dayjs(selectedFc.dawichok_url_sent_at).format('YYYY-MM-DD HH:mm')}
                        </Text>
                      ) : null}
                      <Button
                        fullWidth
                        mt="xs"
                        size="xs"
                        color={isReadOnly ? 'gray' : 'teal'}
                        variant="filled"
                        leftSection={<IconSend size={14} />}
                        onClick={() => markDawichokUrlSentMutation.mutate()}
                        loading={markDawichokUrlSentMutation.isPending}
                        disabled={isReadOnly || markDawichokUrlSentMutation.isPending}
                      >
                        {selectedFc.dawichok_url_sent_at ? 'URL 발송 알림 다시 보내기' : 'URL 발송 알림'}
                      </Button>
                    </Card>
                    <input
                      ref={hanwhaPdfUploadInputRef}
                      type="file"
                      accept="application/pdf"
                      style={{ display: 'none' }}
                      onChange={handleHanwhaPdfInputChange}
                    />
                    <Divider my="sm" />
                    <Box
                      p="sm"
                      style={{
                        borderRadius: 12,
                        border: `1px solid ${hasHanwhaApprovedPdf(selectedFc) ? '#12b886' : '#FFD8A8'}`,
                        backgroundColor: hasHanwhaApprovedPdf(selectedFc) ? '#F0FDF4' : '#FFF7ED',
                      }}
                    >
                      <Group justify="space-between" mb={4}>
                        <Text size="xs" fw={700} c={hasHanwhaApprovedPdf(selectedFc) ? 'teal' : 'orange'}>
                          다위촉 URL PDF
                        </Text>
                        <Badge size="sm" color={hasHanwhaApprovedPdf(selectedFc) ? 'teal' : 'orange'} variant="light">
                          {hasHanwhaApprovedPdf(selectedFc) ? '승인 완료' : '승인 대기'}
                        </Badge>
                      </Group>
                      {!!selectedFc.hanwha_commission_pdf_name ? (
                        <Text size="xs" c="dimmed" mb="xs">
                          등록 파일: {selectedFc.hanwha_commission_pdf_name}
                        </Text>
                      ) : (
                        <Text size="xs" c="dimmed" mb="xs">
                          등록된 다위촉 URL PDF가 없습니다.
                        </Text>
                      )}
                      <Group gap="xs">
                        {!!selectedFc.hanwha_commission_pdf_path && (
                          <Button
                            size="xs"
                            color="blue"
                            variant="light"
                            onClick={() => handleOpenDoc(selectedFc.hanwha_commission_pdf_path!)}
                          >
                            다위촉 URL PDF 보기
                          </Button>
                        )}
                        {!!selectedFc.hanwha_commission_pdf_path && (
                          <Button
                            size="xs"
                            color="red"
                            variant="light"
                            loading={isHanwhaPdfDeleting}
                            onClick={handleDeleteHanwhaPdf}
                            disabled={isReadOnly || isHanwhaPdfDeleting}
                          >
                            PDF 삭제
                          </Button>
                        )}
                      </Group>
                      <Button
                        mt="xs"
                        fullWidth
                        size="xs"
                        color={isReadOnly ? 'gray' : 'teal'}
                        variant="light"
                        loading={isHanwhaPdfUploading}
                        disabled={isReadOnly || isHanwhaPdfUploading || !hanwhaSubmittedDateInput}
                        onClick={handleApproveHanwha}
                      >
                        다위촉 URL PDF 업로드 및 승인
                      </Button>
                    </Box>
                    {!!selectedFc.hanwha_commission_reject_reason && (
                      <Textarea
                        mt="sm"
                        label="반려 사유"
                        value={selectedFc.hanwha_commission_reject_reason}
                        readOnly
                        minRows={2}
                      />
                    )}
                  </Box>
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="appointment">
                <Stack gap="md">
                  <Card withBorder radius="md" p="md" bg="gray.0">
                    <Group justify="space-between" mb="xs">
                      <Text fw={600} size="sm">최종 완료 상태</Text>
                      <Badge variant="light" color={commissionSummaryColor} size="sm">
                        {commissionSummaryLabel}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">
                      아래 승인 후 최종 완료 여부를 별도로 저장합니다.
                    </Text>
                    <Group gap="xs" wrap="wrap" mt="sm">
                      <Chip
                        checked={lifeCommissionSelected}
                        onChange={() => handleCommissionToggle('life')}
                        color="orange"
                        variant={lifeCommissionSelected ? 'filled' : 'light'}
                        disabled={isReadOnly || updateCommissionMutation.isPending}
                      >
                        생명 최종 완료
                      </Chip>
                      <Chip
                        checked={nonlifeCommissionSelected}
                        onChange={() => handleCommissionToggle('nonlife')}
                        color="blue"
                        variant={nonlifeCommissionSelected ? 'filled' : 'light'}
                        disabled={isReadOnly || updateCommissionMutation.isPending}
                      >
                        손해 최종 완료
                      </Chip>
                    </Group>
                    <Button
                      fullWidth
                      mt="sm"
                      size="xs"
                      color={isReadOnly ? 'gray' : 'teal'}
                      variant="light"
                      onClick={() => updateCommissionMutation.mutate()}
                      loading={updateCommissionMutation.isPending}
                      disabled={isReadOnly}
                    >
                      최종 완료 상태 저장
                    </Button>
                  </Card>
                  {canOpenInsuranceStage(selectedFc) ? (
                    <Card withBorder radius="md" p="md" bg="gray.0">
                      <Text fw={600} size="sm" mb="xs">생명/손해 위촉 심사 및 확정</Text>
                      {renderAppointmentSection('life')}
                      <Divider my="sm" />
                      {renderAppointmentSection('nonlife')}
                    </Card>
                  ) : (
                    <Alert color="yellow" icon={<IconInfoCircle size={16} />} radius="md">
                      <Text fw={700} size="sm" mb={4}>
                        생명/손해 위촉 관리 잠금
                      </Text>
                        <Text size="xs">
                          다위촉 URL PDF가 승인되어야 생명/손해 위촉 관리 탭을 열 수 있습니다.
                        </Text>
                    </Alert>
                  )}
                </Stack>
              </Tabs.Panel>


            </Tabs>
          </>
        )}
      </Modal>
      <RejectReasonModal
        opened={rejectOpened}
        onClose={closeReject}
        title={
          rejectTarget?.kind === 'allowance'
            ? '보증 보험 동의 반려 사유'
            : rejectTarget?.kind === 'hanwha'
              ? '다위촉 URL 반려 사유'
              : rejectTarget?.kind === 'appointment'
                ? '생명/손해 위촉 반려 사유'
                : '서류 반려 사유'
        }
        description="FC에게 전달될 반려 사유를 입력해주세요. 입력된 사유는 알림과 화면에 표시됩니다."
        placeholder="예: 서류 식별이 어려워 재제출이 필요합니다."
        value={rejectReason}
        onChange={setRejectReason}
        onSubmit={handleRejectSubmit}
        submitting={rejectSubmitting}
      />

      {/* 확인 모달 */}
      <Modal
        opened={confirmOpened}
        onClose={closeConfirm}
        title={<Text fw={700}>{confirmConfig?.title}</Text>}
        size="sm"
        padding="lg"
        radius="md"
        centered
        overlayProps={{ blur: 2 }}
      >
        <Stack gap="md">
          <Text size="sm">{confirmConfig?.message}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeConfirm}>
              취소
            </Button>
            <Button
              color={confirmConfig?.color || 'blue'}
              onClick={handleConfirm}
            >
              {confirmConfig?.confirmLabel || '확인'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box >
  );
}
