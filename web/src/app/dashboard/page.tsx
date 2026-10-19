'use client';

import {
  isNonEmptyResponseString,
  isHttpsResponseUrl,
  isValidFcStatusResponse,
  isValidYmdResponse,
  requireCleanupMutationReceipt,
  requireDocumentStatusReceipt,
  requireMutationSuccess,
  requireProfileMutationReceipt,
} from '@/lib/user-intent-policy';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { QueryReadError } from '@/lib/query-read-error';
import { normalizeAdminTempId } from '@/lib/admin-temp-id-update';
import {
  fetchAdminFcList,
  isAdminCleanupPendingResponse,
  isAdminFcProfile,
} from '@/lib/admin-document-client';

import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Chip,
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
  UnstyledButton,
  Tooltip
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCalendar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDeviceFloppy,
  IconEdit,
  IconFileText,
  IconCertificate,
  IconInfoCircle,
  IconLink,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconShieldCheck,
  IconTrash,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ChangeEvent, MouseEvent, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react';

import { useSession } from '@/hooks/use-session';
import { useResidentNumber } from '@/hooks/use-resident-number';
import { useVisiblePageResidentNumbers } from '@/hooks/use-visible-page-resident-numbers';
import {
  closePendingAdminFileWindow,
  navigateAdminFileWindowOrCurrentTab,
  openPendingAdminFileWindow,
} from '@/lib/admin-file-open';
import type { FCDocument, FCProfileWithDocuments } from '@/types/dashboard';
import type { CommissionCompletionStatus, FcProfile, FcStatus } from '@/types/fc';
import { notifications } from '@mantine/notifications';
import { useRouter } from 'next/navigation';
import { RejectReasonModal } from '@/components/RejectReasonModal';
import { ConfirmModal } from '@/components/ConfirmModal';
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
  getHanwhaProgress,
  getSummaryStatus
} from '../../lib/shared';
import {
  DASHBOARD_WORK_QUEUES,
  countDashboardWork,
  getDashboardWorkQueueKey,
  isDashboardMetricFilter,
  type DashboardMetricFilter,
  type DashboardWorkQueueKey,
} from '@/lib/dashboard-work-queue';
import { sendPushNotificationForFc } from '../actions';
import { updateAppointmentAction } from './appointment/actions';
import { updateDocStatusAction } from './docs/actions';
import styles from './page.module.css';
import fcm from './fc-modal.module.css';
import {
  DASHBOARD_FC_LIST_COLUMN_COUNT,
  DASHBOARD_FC_LIST_COLUMNS,
  formatDashboardResidentNumberCell,
  formatDashboardSignupDate,
} from '@/lib/dashboard-table-display';
import { showAdminNotificationWarning } from '@/lib/show-admin-notification-warning';

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

const FC_MODAL_STEPS = [
  { value: 'info', label: '보증 보험 동의' },
  { value: 'docs', label: '서류 관리' },
  { value: 'hanwha', label: '다위촉' },
  { value: 'appointment', label: '생명/손해 위촉' },
] as const;

type StepSummaryItem = { label: string; value: string; done?: boolean; warn?: boolean };

// Summary row on top of each modal step: finished items are ink, the first open item is the orange tile.
function StepSummary({ items }: { items: StepSummaryItem[] }) {
  const hotIndex = items.findIndex((item) => !item.done && !item.warn);
  return (
    <div className={fcm.summary} style={{ '--cols': items.length } as CSSProperties}>
      {items.map((item, index) => (
        <div
          key={item.label}
          className={fcm.summaryTile}
          data-state={item.warn ? 'warn' : item.done ? 'done' : index === hotIndex ? 'hot' : 'todo'}
        >
          <span className={fcm.summaryLabel}>
            {item.label}
            {item.done ? <IconCheck size={13} stroke={2.6} /> : null}
          </span>
          <span className={fcm.summaryValue}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

const shortDate = (value?: string | null) => (value ? dayjs(value).format('MM.DD') : null);

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

const getFcWorkQueueKey = (fc: FCProfileWithDocuments): DashboardWorkQueueKey | null =>
  getDashboardWorkQueueKey({
    step: calcStep(fc),
    allowanceKey: getAllowanceDisplayState(fc).key,
    docProgressKey: getDocProgress(fc).key,
    hanwhaKey: getHanwhaProgress(fc).key,
    lifeKey: getAppointmentProgress(fc, 'life').key,
    nonlifeKey: getAppointmentProgress(fc, 'nonlife').key,
  });

const QUEUE_ICONS: Record<DashboardWorkQueueKey, typeof IconFileText> = {
  pendingAllowance: IconShieldCheck,
  pendingDocs: IconFileText,
  pendingHanwha: IconLink,
  pendingAppointment: IconCertificate,
};

type DashboardListState = {
  activeTab: string;
  metricFilter: DashboardMetricFilter;
  keyword: string;
  currentPage: number;
};

// List state lives in the URL so returning from an FC detail page restores the same view.
function readDashboardListState(search: string, tabs: readonly string[]): DashboardListState {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  const metric = params.get('metric');
  const page = Number(params.get('page'));
  return {
    activeTab: tab && tabs.includes(tab) ? tab : 'all',
    metricFilter: isDashboardMetricFilter(metric) ? metric : 'all',
    keyword: params.get('q') ?? '',
    currentPage: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

function writeDashboardListState(search: string, state: DashboardListState): string {
  const params = new URLSearchParams(search);
  const entries: [string, string | null][] = [
    ['tab', state.activeTab !== 'all' ? state.activeTab : null],
    ['metric', state.metricFilter !== 'all' ? state.metricFilter : null],
    ['q', state.keyword || null],
    ['page', state.currentPage > 1 ? String(state.currentPage) : null],
  ];
  for (const [key, value] of entries) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return params.toString();
}

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hydrated, isReadOnly, role, residentId } = useSession();
  const [activeTab, setActiveTab] = useState<string | null>('all');
  const [metricFilter, setMetricFilter] = useState<DashboardMetricFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [listStateRestored, setListStateRestored] = useState(false);
  const ITEMS_PER_PAGE = 20;

  useEffect(() => {
    const restored = readDashboardListState(
      window.location.search,
      ['all', 'g_done', 'g_others', ...Object.keys(ADMIN_STEP_LABELS)],
    );
    setActiveTab(restored.activeTab);
    setMetricFilter(restored.metricFilter);
    setKeyword(restored.keyword);
    setCurrentPage(restored.currentPage);
    setListStateRestored(true);
  }, []);

  useEffect(() => {
    if (!listStateRestored) return;
    const next = writeDashboardListState(window.location.search, {
      activeTab: activeTab ?? 'all', metricFilter, keyword, currentPage,
    });
    if (next === window.location.search.replace(/^\?/, '')) return;
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
  }, [listStateRestored, activeTab, metricFilter, keyword, currentPage]);

  // 모달 상태
  const [opened, { open, close }] = useDisclosure(false);
  const [selectedFc, setSelectedFc] = useState<FCProfileWithDocuments | null>(null);
  // The modal step navigation marks earlier stages done and the workflow stage as current.
  const currentStepIndex = selectedFc ? FC_MODAL_STEPS.findIndex((step) => step.value === getDefaultModalTab(selectedFc)) : -1;
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

  const reminderPendingRef = useRef(false);
  const [reminderPending, setReminderPending] = useState(false);

  const [documentCleanupFcId, setDocumentCleanupFcId] = useState<string | null>(null);

  // 확인 모달 상태
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => void | Promise<unknown>;
    confirmLabel?: string;
    color?: string;
  } | null>(null);

  const showConfirm = (config: {
    title: string;
    message: string;
    onConfirm: () => void | Promise<unknown>;
    confirmLabel?: string;
    color?: string;
  }) => {
    setConfirmConfig(config);
    openConfirm();
  };

  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const confirmSubmittingRef = useRef(false);
  const handleConfirm = async () => {
    if (!confirmConfig || confirmSubmittingRef.current) return;
    confirmSubmittingRef.current = true;
    setConfirmSubmitting(true);
    try {
      await confirmConfig.onConfirm();
      closeConfirm();
    } catch {
      notifications.show({ title: '처리 결과 확인 필요', message: '요청 결과를 확인하지 못했습니다. 입력은 유지됩니다. 최신 상태를 확인한 뒤 다시 시도해주세요.', color: 'red' });
    } finally {
      confirmSubmittingRef.current = false;
      setConfirmSubmitting(false);
    }
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
        showAdminNotificationWarning(result);
        notifications.show({ title: '처리 완료', message: '생명/손해 위촉 정보를 반려했습니다.', color: 'green' });
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
        const receipt = requireDocumentStatusReceipt(res, {
          status: 'rejected',
          reviewerNote: reason,
        });
        const nextDocs = (selectedFc.fc_documents || []).map((d: FCDocument) =>
          d.doc_type === doc.doc_type
            ? { ...d, status: receipt.status, reviewer_note: receipt.reviewerNote }
            : d,
        );
        let nextProfileStatus = selectedFc.status;
        if (
          receipt.allApproved !== null
          && !DOCS_STAGE_LOCK_STATUSES.includes(selectedFc.status)
        ) {
          nextProfileStatus = receipt.allApproved ? 'docs-approved' : 'docs-pending';
        }
        updateSelectedFc(
          receipt.allApproved === null
            ? { fc_documents: nextDocs }
            : nextProfileStatus === 'docs-pending'
            ? { ...buildDocWorkflowResetProfileFields(), fc_documents: nextDocs }
            : { fc_documents: nextDocs, status: nextProfileStatus },
        );
        showAdminNotificationWarning(res);
        notifications.show({ title: '반려 완료', message: '서류가 반려되었습니다.', color: 'green' });
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

  const { data: fcs, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard-list', role, residentId],
    queryFn: () => fetchAdminFcList<FCProfileWithDocuments>(
      (value): value is FCProfileWithDocuments => isAdminFcProfile(value),
    ),
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
    if (metricFilter !== 'all') {
      result = result.filter((fc: FCProfileWithDocuments) => getFcWorkQueueKey(fc) === metricFilter);
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
  // A page restored from the URL can exceed the current result count.
  const visiblePage = Math.min(currentPage, Math.max(totalPages, 1));
  const paginatedData = useMemo(() => {
    const startIndex = (visiblePage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredData.slice(startIndex, endIndex);
  }, [filteredData, visiblePage, ITEMS_PER_PAGE]);
  const visibleFcIds = useMemo(
    () => paginatedData.map((fc: FCProfileWithDocuments) => fc.id),
    [paginatedData],
  );
  const residentNumberResetKey = [
    activeTab,
    metricFilter,
    keyword,
    currentPage,
    role,
    residentId,
  ].join('\u001f');
  const visibleResidentNumbers = useVisiblePageResidentNumbers({
    fcIds: visibleFcIds,
    enabled: hydrated && (role === 'admin' || role === 'manager'),
    resetKey: residentNumberResetKey,
  });

  // 탭이나 검색어가 변경되면 첫 페이지로 이동
  const handleMetricFilterChange = (nextFilter: DashboardMetricFilter) => {
    setMetricFilter((current) => current === nextFilter && nextFilter !== 'all' ? 'all' : nextFilter);
    setActiveTab('all');
    setCurrentPage(1);
  };

  const handleActiveTabChange = (nextTab: string | null) => {
    setActiveTab(nextTab);
    setMetricFilter('all');
    setCurrentPage(1);
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
      const normalizedTempId = normalizeAdminTempId(tempIdInput);
      if (normalizedTempId && normalizedTempId !== normalizeAdminTempId(selectedFc.temp_id)) {
        payload.temp_id = normalizedTempId;
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
      const profile = requireProfileMutationReceipt(data, { id: selectedFc.id, ...payload });
      return { response: data, profile };
    },
    onSuccess: (result) => {
      if (!result) return;
      updateSelectedFc(result.profile as Partial<FCProfileWithDocuments>);
      showAdminNotificationWarning(result.response);
      notifications.show({ title: '저장 완료', message: '기본 정보가 업데이트되었습니다.', color: 'green' });
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
      const profile = requireProfileMutationReceipt(payload, { id: selectedFc.id, ...data });
      return { response: payload, profile };
    },
    onSuccess: (result) => {
      if (!result) return;
      updateSelectedFc(result.profile as Partial<FCProfileWithDocuments>);
      showAdminNotificationWarning(result.response);
      notifications.show({ title: '저장 완료', message: '위촉 상태가 업데이트되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: Error) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const resetToLookupMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc) return;

      const expectedProfile = {
        temp_id: null,
        allowance_date: null,
        allowance_prescreen_requested_at: null,
        allowance_reject_reason: null,
        status: 'draft',
      };

      const resp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateProfile',
          payload: {
            fcId: selectedFc.id,
            data: expectedProfile,
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
      const profile = requireProfileMutationReceipt(data, { id: selectedFc.id, ...expectedProfile });
      return { response: data, profile };
    },
    onSuccess: (result) => {
      if (!result) return;
      setTempIdInput('');
      setAllowanceDateInput(null);
      updateSelectedFc(result.profile as Partial<FCProfileWithDocuments>);
      showAdminNotificationWarning(result.response);
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
      requireMutationSuccess(data);
      if (
        data.allowance_date !== normalizedAllowanceDate
        || !isValidYmdResponse(data.allowance_date)
        || !isValidFcStatusResponse(data.status)
      ) {
        throw new Error('보증보험 조회 동의일 저장 응답이 올바르지 않습니다.');
      }
      return {
        allowanceDate: data.allowance_date,
        status: data.status as FcStatus,
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
      const receipt = requireCleanupMutationReceipt(data, 'updated');
      return { response: data, cleanupPending: receipt.cleanupPending };
    },
    onSuccess: (result) => {
      if (!result) return;
      if (result.cleanupPending && selectedFc) setDocumentCleanupFcId(selectedFc.id);
      showAdminNotificationWarning(result.response);
      notifications.show({ title: '요청 완료', message: '서류 목록이 갱신되었습니다.', color: 'blue' });
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
      const profile = requireProfileMutationReceipt(data, { id: selectedFc.id, ...(extra ?? {}), status });
      if (data.status !== status) {
        throw new Error('상태 업데이트 응답이 올바르지 않습니다.');
      }
      return { response: data, profile };
    },
    onSuccess: (result) => {
      if (!result) return;
      updateSelectedFc(result.profile as Partial<FCProfileWithDocuments>);
      showAdminNotificationWarning(result.response);
      notifications.show({ title: '처리 완료', message: '상태가 변경되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: Error) => notifications.show({ title: '오류', message: err.message, color: 'red' }),
  });

  const deleteFcMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc) return;
      logger.debug('[Web][deleteFc] start', { requestCount: 1 });
      const resp = await fetch('/api/fc-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fcId: selectedFc.id }),
      });

      const data = await resp.json().catch(() => null);
      logger.debug('[Web][deleteFc] response', {
        status: resp.status,
        ok: resp.ok,
      });

      if (!resp.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: string }).error || '')
            : '';
        throw new Error(message || '삭제 실패');
      }

      // API 응답 검증
      if (!data || typeof data !== 'object') {
        logger.error('[Web][deleteFc] invalid response', {
          status: resp.status,
          errorCode: 'invalid_response',
        });
        throw new Error('서버 응답이 올바르지 않습니다.');
      }

      // deleted 플래그 확인
      if (data.ok !== true || data.deleted !== true) {
        logger.warn('[Web][deleteFc] delete returned false', {
          status: resp.status,
          errorCode: 'delete_not_confirmed',
        });
        throw new Error(
          typeof data.message === 'string' ? data.message : 'FC 정보를 삭제할 수 없습니다.'
        );
      }

      logger.info('[Web][deleteFc] success', {
        status: resp.status,
        deletedCount: 1,
      });
      requireMutationSuccess(data);
      return data;
    },
    onSuccess: (data) => {
      if (data?.cleanupWarning) notifications.show({ title: '파일 정리 확인 필요', message: 'FC 삭제는 완료됐습니다. 일부 파일 정리가 남아 있습니다. 삭제 요청을 반복하지 마세요.', color: 'yellow' });
      logger.debug('[Web][deleteFc] onSuccess', { deletedCount: 1 });
      notifications.show({ title: '삭제 완료', message: 'FC 정보가 삭제되었습니다.', color: 'gray' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
      close();
    },
    onError: (err: Error) => {
      logger.error('[Web][deleteFc] failed', {
        errorCode: 'delete_request_failed',
      });
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
      requireMutationSuccess(data);
      if (
        data.hanwha_commission_date_sub !== normalizedSubmittedDate
        || !isValidYmdResponse(data.hanwha_commission_date_sub)
        || !isValidFcStatusResponse(data.status)
      ) {
        throw new Error('다위촉 URL 완료일 저장 응답이 올바르지 않습니다.');
      }
      return {
        submittedDate: data.hanwha_commission_date_sub,
        status: data.status as FcStatus,
      };
    },
    onSuccess: (result) => {
      updateSelectedFc({
        hanwha_commission_date_sub: result.submittedDate,
        hanwha_commission_reject_reason: null,
        status: result.status,
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
      requireMutationSuccess(data);
      if (
        !isNonEmptyResponseString(data.dawichok_url_sent_at)
        || Number.isNaN(Date.parse(data.dawichok_url_sent_at))
        || !isNonEmptyResponseString(data.dawichok_url_sent_by)
        || data.dawichok_url_sent_by !== residentId.replace(/\D/g, '')
      ) {
        throw new Error('다위촉 URL 발송 신호 응답이 올바르지 않습니다.');
      }
      showAdminNotificationWarning(data);
      return {
        sentAt: data.dawichok_url_sent_at,
        sentBy: data.dawichok_url_sent_by,
      };
    },
    onSuccess: ({ sentAt, sentBy }) => {
      updateSelectedFc({
        dawichok_url_sent_at: sentAt,
        dawichok_url_sent_by: sentBy,
      });
      notifications.show({
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
      requireMutationSuccess(data);
      if (
        data.category !== category
        || data.appointmentDate !== normalizedAppointmentDate
        || !isValidYmdResponse(data.appointmentDate)
        || !isValidFcStatusResponse(data.status)
      ) {
        throw new Error('위촉 완료일 저장 응답이 올바르지 않습니다.');
      }

      return {
        category: data.category,
        appointmentDate: data.appointmentDate,
        status: data.status as FcStatus,
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
        body: JSON.stringify({ action: 'signDoc', payload: { path: normalizedPath, fcId: selectedFc?.id } }),
      });
      const data = await resp.json().catch(() => null);
      const signedUrl = data?.signedUrl;
      if (!resp.ok || data?.ok !== true || !isHttpsResponseUrl(signedUrl)) {
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
      if (!createResp.ok) {
        const message =
          createData && typeof createData === 'object' && 'error' in createData
            ? String((createData as { error?: string }).error || '')
            : '';
        throw new Error(message || '다위촉 URL PDF 업로드 URL 생성 실패');
      }
      requireMutationSuccess(createData);
      if (
        !isHttpsResponseUrl(createData.uploadUrl)
        || !isNonEmptyResponseString(createData.storagePath)
        || !isNonEmptyResponseString(createData.fileName)
      ) {
        throw new Error('다위촉 URL PDF 업로드 URL 응답이 올바르지 않습니다.');
      }

      const uploadResp = await fetch(createData.uploadUrl, {
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
          hanwha_commission_pdf_name: createData.fileName,
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
          const profile = requireProfileMutationReceipt(deleteData, {
            id: selectedFc.id,
            hanwha_commission_pdf_path: null,
            hanwha_commission_pdf_name: null,
            status:
              selectedFc.status === 'appointment-completed' || selectedFc.status === 'final-link-sent'
                ? selectedFc.status
                : 'hanwha-commission-review',
          });

          updateSelectedFc({
            hanwha_commission_pdf_path: profile.hanwha_commission_pdf_path as null,
            hanwha_commission_pdf_name: profile.hanwha_commission_pdf_name as null,
            status: profile.status as FcStatus,
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

  const documentCleanupStatus = useQuery({
    queryKey: ['document-cleanup-status', selectedFc?.id],
    enabled: Boolean(selectedFc?.id) && !isReadOnly,
    queryFn: async () => {
      const response = await fetch('/api/admin/fc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getDocumentCleanupStatus', payload: { fcId: selectedFc!.id } }) });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new QueryReadError(response.status);
      if (!isAdminCleanupPendingResponse(data)) throw new QueryReadError();
      return data;
    },
  });

  const retryDocumentCleanupMutation = useMutation({
    mutationFn: async (fcId: string) => {
      const response = await fetch('/api/admin/fc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retryDocumentCleanup', payload: { fcId } }) });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error('파일 정리 결과를 확인하지 못했습니다.');
      requireMutationSuccess(data);
      if (!isAdminCleanupPendingResponse(data)) throw new Error('파일 정리 결과를 확인하지 못했습니다.');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['document-cleanup-status'] });
      if (!data.cleanupPending) setDocumentCleanupFcId(null);
      else showAdminNotificationWarning(data);
    },
    onError: () => notifications.show({ title: '파일 정리 확인 필요', message: '업무 변경은 완료됐습니다. 파일 정리만 다시 시도해주세요.', color: 'yellow' }),
  });

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

          const receipt = requireCleanupMutationReceipt(data, 'deleted');
          showAdminNotificationWarning(data);
          if (receipt.cleanupPending) setDocumentCleanupFcId(selectedFc.id);
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
        try {
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
          showAdminNotificationWarning(result);
          notifications.show({ title: '완료', message: result.message, color: 'green' });
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
        } catch {
          notifications.show({ title: '처리 결과 확인 필요', message: '서버 응답을 확인할 수 없습니다. 목록을 새로고침하여 상태를 확인해 주세요.', color: 'red' });
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

    return (
      <div className={fcm.apptCard} data-state={isConfirmed ? 'done' : isSubmitted ? 'submitted' : undefined}>
        <div className={fcm.apptHead}>
          <Text className={fcm.apptTitle}>{sectionTitle}</Text>
          <Group gap={6}>
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
            <span className={fcm.itemState} data-done={isConfirmed || undefined} data-warn={isSubmitted || undefined}>
              승인 상태: {approvalStatusLabel}
            </span>
          </Group>
        </div>
        <div className={fcm.itemRow}>
          <Text className={fcm.fieldLabel}>예정(Plan)</Text>
          <div className={fcm.fieldControl}>
            <TextInput
              aria-label={`${sectionTitle} 예정(Plan)`}
              placeholder="예: 12월 2차 / 1월 1차"
              classNames={{ input: 'muted-placeholder-input' }}
              className={fcm.w200}
              value={schedule ?? ''}
              onChange={(e) => {
                const val = e.currentTarget?.value || '';
                setAppointmentInputs(prev => ({ ...prev, [isLife ? 'life' : 'nonlife']: val }));
              }}
              readOnly={!insuranceStageOpen}
              disabled={!insuranceStageOpen}
            />
            <Tooltip label="일정 저장" withArrow>
              <ActionIcon
                aria-label={`${sectionTitle} 일정 저장`}
                variant="filled"
                color={isReadOnly ? 'gray' : 'dark'}
                radius="xl"
                size={34}
                loading={isAppointmentPending}
                disabled={isReadOnly || appointmentBusy || !insuranceStageOpen}
                onClick={(e) => handleAppointmentAction(e, 'schedule', category)}
              >
                <IconDeviceFloppy size={16} />
              </ActionIcon>
            </Tooltip>
          </div>
          <span />
        </div>
        <div className={fcm.itemRow}>
          <Text className={fcm.fieldLabel}>확정일(Actual)</Text>
          <div className={fcm.fieldControl}>
            <DateInput
              aria-label={`${sectionTitle} 확정일(Actual)`}
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
              className={fcm.w200}
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
                },
              }}
            />
            <Tooltip label="완료일 저장" withArrow>
              <ActionIcon
                aria-label={`${sectionTitle} 완료일 저장`}
                variant="light"
                color={isReadOnly ? 'gray' : 'dark'}
                radius="xl"
                size={34}
                loading={updateAppointmentDateMutation.isPending}
                disabled={isReadOnly || appointmentBusy || !insuranceStageOpen || !date}
                onClick={() => updateAppointmentDateMutation.mutate({ category })}
              >
                <IconDeviceFloppy size={16} />
              </ActionIcon>
            </Tooltip>
          </div>
          {isSubmitted ? (
            <Text size="xs" c="orange" ta="right">
              FC 제출일: {dayjs(submittedDate).format('YYYY-MM-DD')}
            </Text>
          ) : <span />}
        </div>
        <div className={fcm.apptFoot}>
          <Button
            variant="subtle"
            color={isReadOnly ? 'gray' : 'red'}
            radius="xl"
            size="sm"
            disabled={isReadOnly || appointmentBusy || (!isConfirmed && !isSubmitted && !date) || !insuranceStageOpen}
            onClick={() => openRejectModal({ kind: 'appointment', category })}
          >
            반려
          </Button>
          <Button
            variant="filled"
            color={isConfirmed ? 'teal' : 'dark'}
            radius="xl"
            size="sm"
            leftSection={<IconCheck size={16} />}
            disabled={isConfirmed || isReadOnly || appointmentBusy || !date || !insuranceStageOpen}
            loading={isAppointmentPending}
            onClick={(e) => handleAppointmentAction(e, 'confirm', category)}
          >
            {isConfirmed ? '승인 완료됨' : '승인 처리'}
          </Button>
        </div>
      </div>
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

  const getStepSummary = (tab: string | null): StepSummaryItem[] => {
    if (!selectedFc) return [];
    if (tab === 'docs') {
      const docs = selectedFc.fc_documents ?? [];
      const submitted = docs.filter((doc: FCDocument) => doc.storage_path && doc.storage_path !== 'deleted').length;
      const approved = docs.filter((doc: FCDocument) => doc.status === 'approved').length;
      const rejected = docs.filter((doc: FCDocument) => doc.status === 'rejected').length;
      return [
        { label: '요청', value: `${docs.length}건`, done: docs.length > 0 },
        { label: '제출', value: `${submitted}/${docs.length}`, done: docs.length > 0 && submitted === docs.length },
        { label: '승인', value: `${approved}/${docs.length}`, done: docs.length > 0 && approved === docs.length },
        { label: '반려', value: `${rejected}건`, done: rejected === 0 && docs.length > 0, warn: rejected > 0 },
      ];
    }
    if (tab === 'hanwha') {
      return [
        { label: '완료일', value: shortDate(selectedFc.hanwha_commission_date_sub) ?? '미입력', done: Boolean(selectedFc.hanwha_commission_date_sub) },
        { label: 'URL 발송', value: shortDate(selectedFc.dawichok_url_sent_at) ?? '미발송', done: Boolean(selectedFc.dawichok_url_sent_at) },
        { label: 'PDF 승인', value: hasHanwhaApprovedPdf(selectedFc) ? '완료' : '대기', done: hasHanwhaApprovedPdf(selectedFc) },
      ];
    }
    if (tab === 'appointment') {
      const category = (confirmed?: string | null, submitted?: string | null) =>
        confirmed ? `${shortDate(confirmed)} 확정` : submitted ? `${shortDate(submitted)} 제출` : '미입력';
      return [
        { label: '생명 위촉', value: category(selectedFc.appointment_date_life, selectedFc.appointment_date_life_sub), done: Boolean(selectedFc.appointment_date_life) },
        { label: '손해 위촉', value: category(selectedFc.appointment_date_nonlife, selectedFc.appointment_date_nonlife_sub), done: Boolean(selectedFc.appointment_date_nonlife) },
        { label: '최종 완료', value: commissionSummaryLabel, done: commissionSummaryLabel !== '미완료' },
      ];
    }
    const allowanceKey = getAllowanceDisplayState(selectedFc).key;
    return [
      { label: '임시사번', value: selectedFc.temp_id || '미발급', done: Boolean(selectedFc.temp_id) },
      { label: '동의일', value: shortDate(selectedFc.allowance_date) ?? '미입력', done: Boolean(selectedFc.allowance_date) },
      { label: '사전 심사', value: shortDate(selectedFc.allowance_prescreen_requested_at) ?? '대기', done: Boolean(selectedFc.allowance_prescreen_requested_at) || allowanceKey === 'approved' },
      { label: '승인', value: allowanceKey === 'approved' ? '완료' : allowanceKey === 'rejected' ? '반려' : '대기', done: allowanceKey === 'approved', warn: allowanceKey === 'rejected' },
    ];
  };
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
        <Text
          size="sm"
          fw={600}
          c={visibleResidentNumbers[fc.id]?.status === 'ready' ? 'dark.7' : 'dimmed'}
        >
          {formatDashboardResidentNumberCell(visibleResidentNumbers[fc.id])}
        </Text>
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
          color="gray"
          c="dark"
          radius="xl"
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
  const workSummary = useMemo(() => {
    const queued = (fcs ?? []).map((fc: FCProfileWithDocuments) => ({ fc, key: getFcWorkQueueKey(fc) }));
    const stepCounts = [0, 0, 0, 0, 0, 0];
    for (const fc of fcs ?? []) stepCounts[getAdminStepDisplay(fc).step] += 1;
    return {
      total: fcs?.length ?? 0,
      ...countDashboardWork(queued.map((row) => row.key)),
      stepCounts,
      // 소속별 인원, 많은 순. 이름 없는 FC는 '소속 미정'으로 묶는다.
      affiliations: [...(fcs ?? []).reduce((map, fc: FCProfileWithDocuments) => {
        const name = fc.affiliation?.trim() || '소속 미정';
        return map.set(name, (map.get(name) ?? 0) + 1);
      }, new Map<string, number>())].sort((a, b) => b[1] - a[1]),
      // Newest sign-ups first, using the same date as the list's 가입일 column.
      recentSignups: [...(fcs ?? [])]
        .sort((a, b) => String(b.signup_completed_at ?? b.created_at ?? '').localeCompare(String(a.signup_completed_at ?? a.created_at ?? '')))
        .slice(0, 3),
      // Queue order first, then the existing list order inside each queue.
      items: DASHBOARD_WORK_QUEUES.flatMap((queue) =>
        queued.filter((row) => row.key === queue.key).map((row) => ({ fc: row.fc, queue })),
      ),
    };
  }, [fcs]);
  const visibleWorkItems = workSummary.items.filter((item) => metricFilter === 'all' || item.queue.key === metricFilter);
  const maxStepCount = Math.max(1, ...workSummary.stepCounts);
  // The queue with the most waiting FCs gets the single accent tile.
  const hotQueueKey = DASHBOARD_WORK_QUEUES.reduce<DashboardWorkQueueKey | null>(
    (best, queue) => (workSummary.counts[queue.key] > (best ? workSummary.counts[best] : 0) ? queue.key : best),
    null,
  );
  const busiestStep = workSummary.stepCounts.slice(0, 5).indexOf(Math.max(...workSummary.stepCounts.slice(0, 5)));
  const openWorkItem = (fc: FCProfileWithDocuments, key: DashboardWorkQueueKey) => {
    if (key === 'pendingDocs') router.push('/dashboard/docs');
    else if (key === 'pendingAppointment') router.push('/dashboard/appointment');
    else handleOpenModal(fc);
  };

  const canResetToLookup = Boolean(
    selectedFc?.temp_id && !isReadOnly && isLookupResettableStatus(selectedFc?.status),
  );
  return (
    <Box maw={1600} mx="auto">
      <Stack gap="md">
        {/* Header: today's work */}
        <div className={styles.pageHead} style={{ '--i': 0 } as CSSProperties}>
          <Title order={2} className={styles.pageTitle}>오늘 처리할 건</Title>
          <Text c="dimmed" size="sm">FC 온보딩 전체 현황판 · {dayjs().format('M월 D일')}</Text>
        </div>

        {/* Read-only Mode Alert */}
        {isReadOnly && (
          <Alert
            icon={<IconInfoCircle size={20} />}
            title="읽기 전용 모드"
            color="yellow"
            variant="light"
            radius="lg"
          >
            본부장 계정은 조회만 가능합니다. 수정 권한이 필요한 경우 관리자에게 문의하세요.
          </Alert>
        )}

        {/* Work summary: pending total, queues that filter the list, FCs per step */}
        <div className={styles.workTop}>
          <section className={styles.card} style={{ '--i': 1 } as CSSProperties} aria-label="처리 대기 합계">
            <div className={styles.cardHead}>
              <Text className={styles.cardTitle}>처리 대기 합계</Text>
              <UnstyledButton
                className={styles.softPill}
                data-active={(metricFilter === 'all' && (activeTab ?? 'all') === 'all') || undefined}
                aria-pressed={metricFilter === 'all' && (activeTab ?? 'all') === 'all'}
                onClick={() => handleActiveTabChange('all')}
              >
                총 인원 {fcs ? workSummary.total : '—'}명
              </UnstyledButton>
            </div>
            <div className={styles.bigValue}>
              <Text className={styles.heroNumber} component="span">{fcs ? workSummary.pending : '—'}</Text>
              <Text component="span" className={styles.bigUnit}>건</Text>
            </div>
            <div className={styles.deltaRow}>
              <span className={styles.delta} data-tone={workSummary.pending > 0 ? 'warn' : 'ok'}>
                {fcs && workSummary.total > 0 ? `${Math.round((workSummary.pending / workSummary.total) * 100)}%` : '—'}
              </span>
              <Text component="span" size="xs" c="dimmed">전체 FC 중 처리 대기</Text>
            </div>
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.inkButton}
                onClick={() => router.push('/dashboard/notifications/create')}
                disabled={isReadOnly}
              >
                <IconSend size={16} stroke={1.8} /> 새 공지 작성
              </button>
              <button
                type="button"
                className={styles.softButton}
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
                  queryClient.invalidateQueries({ queryKey: ['fc-signup-referral-code'] });
                }}
              >
                <IconRefresh size={16} stroke={1.8} /> 새로고침
              </button>
            </div>
            <div className={styles.well}>
              <Text size="xs" fw={600} c="dimmed" mb={8}>빠른 작업</Text>
              <div className={styles.quickGrid}>
                <button type="button" className={styles.quickItem} onClick={() => router.push('/dashboard/exam/applicants')}>
                  <span className={styles.quickIcon}><IconUser size={15} stroke={1.8} /></span>
                  시험 신청자 관리
                </button>
                <button type="button" className={styles.quickItem} onClick={() => router.push('/dashboard/exam/schedule')} disabled={isReadOnly}>
                  <span className={styles.quickIcon}><IconCalendar size={15} stroke={1.8} /></span>
                  시험 일정 등록
                </button>
              </div>
            </div>
          </section>

          <section className={`${styles.card} ${styles.tileCard}`} style={{ '--i': 2 } as CSSProperties} aria-label="업무별 대기">
            {DASHBOARD_WORK_QUEUES.map((queue) => {
              const QueueIcon = QUEUE_ICONS[queue.key];
              return (
                <button
                  key={queue.key}
                  type="button"
                  className={styles.metricCard}
                  data-hot={(queue.key === hotQueueKey) || undefined}
                  data-active={metricFilter === queue.key || undefined}
                  data-tone={queue.key}
                  aria-pressed={metricFilter === queue.key}
                  onClick={() => handleMetricFilterChange(queue.key)}
                >
                  <span className={styles.tileHead}>
                    <span className={styles.tileTitle}>{queue.label}</span>
                    <span className={styles.tileIcon}><QueueIcon size={16} stroke={1.8} /></span>
                  </span>
                  <span className={styles.tileValue}>
                    <Text component="span" size="1.9rem" className={styles.tileNumber}>{fcs ? workSummary.counts[queue.key] : '—'}</Text>
                    <span className={styles.tileUnit}>건</span>
                  </span>
                  <span className={styles.deltaRow}>
                    <span className={styles.delta} data-tone="step">{queue.step}단계</span>
                    <span className={styles.tileCaption}>{metricFilter === queue.key ? '필터 적용' : queue.task}</span>
                  </span>
                </button>
              );
            })}
          </section>

          <section className={styles.card} style={{ '--i': 3 } as CSSProperties} aria-label="단계별 FC">
            <div className={styles.cardHead}>
              <Text className={styles.cardTitle}>단계별 FC</Text>
              <span className={styles.legend}>
                <span className={styles.legendItem}><i data-kind="hot" />대기 많은 단계</span>
                <span className={styles.legendItem}><i />FC 수</span>
              </span>
            </div>
            <div className={`${styles.well} ${styles.chartWell}`}>
              <div className={styles.chart}>
                {Object.entries(ADMIN_STEP_LABELS).map(([key, label], index) => (
                  <UnstyledButton
                    key={key}
                    className={styles.barColumn}
                    data-active={activeTab === key || undefined}
                    aria-pressed={activeTab === key}
                    aria-label={`${label} ${fcs ? workSummary.stepCounts[index] : '—'}명`}
                    onClick={() => handleActiveTabChange(activeTab === key ? 'all' : key)}
                  >
                    <Text size="xs" fw={700} className={styles.barCount}>{fcs ? workSummary.stepCounts[index] : '—'}</Text>
                    <span className={styles.barTrack}>
                      <span
                        className={styles.bar}
                        data-busiest={(index === busiestStep && workSummary.stepCounts[index] > 0) || undefined}
                        style={{ height: `${Math.max(4, Math.round((workSummary.stepCounts[index] / maxStepCount) * 100))}%`, '--b': index } as CSSProperties}
                      />
                    </span>
                    <span className={styles.barLabel}>{label.replace(/^\d단계\s*/, '')}</span>
                  </UnstyledButton>
                ))}
              </div>
            </div>
            <Text size="xs" c="green" fw={700}>가입 완료 FC 현황</Text>
          </section>
        </div>

        {isError && <QueryErrorAlert error={error} onRetry={refetch} isFetching={isFetching} hasData={!!fcs} subject="FC 목록" />}

        <div className={styles.workMid}>
        {/* Progress and affiliation summary, from the same FC list */}
        <section className={styles.card} style={{ '--i': 4 } as CSSProperties} aria-label="위촉 진행률">
          <div className={styles.cardHead}>
            <Text className={styles.cardTitle}>위촉 진행률</Text>
            <span className={styles.softPill}>5단계 완료 {fcs ? workSummary.stepCounts[5] : '—'}명</span>
          </div>
          <div>
            <div className={styles.progressMeta}>
              <Text component="span" className={styles.progressValue}>
                {fcs && workSummary.total > 0 ? `${Math.round((workSummary.stepCounts[5] / workSummary.total) * 100)}%` : '—'}
              </Text>
              <Text component="span" size="xs" c="dimmed">{fcs ? `${workSummary.stepCounts[5]} / ${workSummary.total}명` : ''}</Text>
            </div>
            <div className={styles.progressTrack} role="presentation">
              <span
                className={styles.progressFill}
                style={{ width: fcs && workSummary.total > 0 ? `${(workSummary.stepCounts[5] / workSummary.total) * 100}%` : '0%' }}
              />
            </div>
          </div>
          <div className={styles.well}>
            <div className={styles.cardHead} style={{ marginBottom: 8 }}>
              <Text size="xs" fw={600} c="dimmed">소속별 FC</Text>
              {keyword ? (
                <UnstyledButton className={styles.softPillWhite} onClick={() => { setKeyword(''); setCurrentPage(1); }}>
                  검색 해제
                </UnstyledButton>
              ) : null}
            </div>
            <div className={styles.affiliationList}>
              {fcs ? workSummary.affiliations.slice(0, 5).map(([name, count]) => (
                <UnstyledButton
                  key={name}
                  className={styles.affiliationRow}
                  data-active={keyword === name || undefined}
                  aria-pressed={keyword === name}
                  onClick={() => { setKeyword(keyword === name ? '' : name); setCurrentPage(1); }}
                >
                  <span className={styles.affiliationName}>{name}</span>
                  <span className={styles.affiliationBar}>
                    <span style={{ width: `${Math.round((count / Math.max(1, workSummary.affiliations[0]?.[1] ?? 1)) * 100)}%` }} />
                  </span>
                  <span className={styles.affiliationCount}>{count}명</span>
                </UnstyledButton>
              )) : (
                <Text size="xs" c="dimmed">{isLoading ? 'FC 목록을 불러오는 중입니다.' : '—'}</Text>
              )}
            </div>
          </div>
          <div className={`${styles.well} ${styles.affiliationWell}`}>
            <Text size="xs" fw={600} c="dimmed" mb={8}>최근 가입</Text>
            <div className={styles.affiliationList}>
              {fcs ? workSummary.recentSignups.map((fc: FCProfileWithDocuments) => (
                <UnstyledButton key={fc.id} className={styles.signupRow} onClick={() => router.push(`/dashboard/profile/${fc.id}`)}>
                  <span className={styles.personAvatar}>{fc.name?.[0] ?? 'F'}</span>
                  <span className={styles.signupText}>
                    <span className={styles.affiliationName}>{fc.name}</span>
                    <span className={styles.signupMeta}>{fc.affiliation || '-'}</span>
                  </span>
                  <span className={styles.affiliationCount}>{formatDashboardSignupDate(fc.signup_completed_at ?? fc.created_at)}</span>
                </UnstyledButton>
              )) : (
                <Text size="xs" c="dimmed">{isLoading ? 'FC 목록을 불러오는 중입니다.' : '—'}</Text>
              )}
            </div>
          </div>
        </section>

        {/* Combined work queue */}
        <section className={styles.card} style={{ '--i': 5 } as CSSProperties} aria-label="처리 대기열">
          <div className={styles.cardHead}>
            <Text className={styles.cardTitle}>
              처리 대기열{metricFilter !== 'all' ? ` · ${DASHBOARD_WORK_QUEUES.find((queue) => queue.key === metricFilter)?.label ?? ''}` : ''}
            </Text>
            {fcs ? <span className={styles.softPill}>{visibleWorkItems.length}건 중 {Math.min(visibleWorkItems.length, 6)}건</span> : null}
          </div>
          <div className={styles.queueTable}>
            <div className={styles.queueHead}>
              <span>FC</span>
              <span>처리할 일</span>
              <span>진행 단계</span>
              <span />
            </div>
            {visibleWorkItems.length > 0 ? visibleWorkItems.slice(0, 6).map(({ fc, queue }) => {
              const stepDisplay = getAdminStepDisplay(fc);
              return (
                <div key={`${queue.key}:${fc.id}`} className={styles.queueRow}>
                  <span className={styles.person}>
                    <span className={styles.personAvatar}>{fc.name?.[0] ?? 'F'}</span>
                    <span>
                      <Text size="sm" fw={600} component="span" display="block">{fc.name}</Text>
                      <Text size="xs" c="dimmed" component="span" display="block">{fc.affiliation || '-'}</Text>
                    </span>
                  </span>
                  <Text size="sm">{queue.task}</Text>
                  <span className={styles.statusDot} data-color={stepDisplay.color}>{stepDisplay.label}</span>
                  <span className={styles.rowAction}>
                    <button type="button" className={styles.inkButtonSmall} onClick={() => openWorkItem(fc, queue.key)}>
                      {isReadOnly ? '보기' : '처리'}
                    </button>
                  </span>
                </div>
              );
            }) : (
              <div className={styles.queueEmpty}>
                <Text size="sm" c="dimmed">{isLoading ? 'FC 목록을 불러오는 중입니다.' : !fcs ? 'FC 목록을 확인할 수 없습니다.' : '처리 대기 없음'}</Text>
              </div>
            )}
          </div>
        </section>
        </div>
        {/* Main Content Area */}
        <Paper radius={24} p="lg" bg="white" className={styles.card} style={{ '--i': 6 } as CSSProperties}>
          <Stack gap="xs" mb="md">
            <Group justify="space-between">
              <Tabs
                value={activeTab}
                onChange={handleActiveTabChange}
                variant="pills"
                radius="xl"
                color="dark"
              >
                <Tabs.List bg="var(--dashboard-panel)" p={4} style={{ borderRadius: 24 }}>
                  <Tabs.Tab value="all" fw={600} px={16}>전체</Tabs.Tab>
                  {Object.entries(ADMIN_STEP_LABELS).map(([key, label]) => (
                    <Tabs.Tab key={key} value={key} fw={600} px={16}>{label}</Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs>
              <TextInput
                placeholder="이름, 연락처 검색"
                leftSection={<IconSearch size={16} stroke={2} />}
                classNames={{ input: 'muted-placeholder-input' }}
                value={keyword}
                onChange={(e) => {
                  const val = e.currentTarget?.value || '';
                  setKeyword(val);
                  setCurrentPage(1);
                }}
                radius="xl"
                w={260}
              />
            </Group>
            <Group gap="xs">
              <Text size="xs" c="dimmed" fw={500}>빠른 분류:</Text>
              <Tabs
                value={activeTab}
                onChange={handleActiveTabChange}
                variant="pills"
                radius="xl"
                color="dark"
              >
                <Tabs.List bg="var(--dashboard-panel)" p={4} style={{ borderRadius: 24 }}>
                  <Tabs.Tab value="g_done" fw={600} px={14}>5단계 완료</Tabs.Tab>
                  <Tabs.Tab value="g_others" fw={600} px={14}>그 이외 (0~4단계)</Tabs.Tab>
                </Tabs.List>
              </Tabs>
            </Group>
          </Stack>

          <Box pos="relative" mih={400}>
            <LoadingOverlay visible={!hydrated || isLoading} overlayProps={{ blur: 1 }} />
            <ScrollArea h="calc(100vh - 280px)" type="auto" offsetScrollbars>
              <Table verticalSpacing="sm" highlightOnHover highlightOnHoverColor="#fafaf9" className={styles.fcTable}>
                <Table.Thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
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
                          <Text c="dimmed" fw={500}>{isLoading ? 'FC 목록을 불러오는 중입니다.' : isError ? 'FC 목록을 확인할 수 없습니다.' : '조건에 맞는 데이터가 없습니다.'}</Text>
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
                  value={visiblePage}
                  onChange={setCurrentPage}
                  size="md"
                  radius="xl"
                  color="dark"
                  withEdges
                />
              </Group>
            )}
          </Box>
        </Paper>

        {/* 요약 정보 */}
        <Paper px="lg" py="sm" radius={24} bg="white">
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {fcs ? `전체 ${filteredData.length}명 중 ${paginatedData.length}명 표시 (페이지 ${visiblePage}/${totalPages})` : isError ? 'FC 목록 확인 불가' : 'FC 목록 조회 중'}
            </Text>
          </Group>
        </Paper>
      </Stack>

      <Modal
        opened={opened}
        onClose={close}
        title={<Text fw={700} size="lg">FC 상세 관리</Text>}
        size={920}
        padding="xl"
        radius={28}
        centered
        overlayProps={{ blur: 3 }}
      >
        {selectedFc && (
          <>
            {documentCleanupStatus.isError && !isReadOnly ? <QueryErrorAlert error={documentCleanupStatus.error} onRetry={() => documentCleanupStatus.refetch()} subject="파일 정리 상태" /> : null}
            {(documentCleanupFcId === selectedFc.id || documentCleanupStatus.data?.cleanupPending) ? <Alert color="yellow" mb="md" title="일부 파일 정리가 남아 있습니다">
              서류 변경은 완료됐습니다. 삭제나 요청 변경을 반복하지 마세요.
              <Button radius="xl" size="xs" mt="xs" disabled={isReadOnly} loading={retryDocumentCleanupMutation.isPending} onClick={() => retryDocumentCleanupMutation.mutate(selectedFc.id)}>파일 정리만 다시 시도</Button>
            </Alert> : null}
            <Tabs
              value={modalTab}
              onChange={setModalTab}
              variant="unstyled"
              orientation="vertical"
              className={fcm.shell}
              style={{ display: 'grid' }}
              classNames={{ list: fcm.stepList, tab: fcm.stepTab, tabLabel: fcm.stepInner, panel: fcm.panel }}
            >
              <aside className={fcm.side}>
                <div className={fcm.identity}>
                  <span className={fcm.avatar}>{selectedFc.name?.slice(0, 1) || '?'}</span>
                  <div>
                    <Group gap="xs" align="center">
                      <Text className={fcm.name}>{selectedFc.name}</Text>
                      <Badge variant="white" radius="xl" color={!selectedFc.career_type ? 'gray' : 'dark'}>
                        {selectedFc.career_type || '조회중'}
                      </Badge>
                    </Group>
                    <Text size="sm" c="dimmed" mt={4}>
                      {selectedFc.phone} · {selectedFc.affiliation || '소속 미정'}
                    </Text>
                  </div>
                  <div className={fcm.facts}>
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
                </div>
                <Tabs.List aria-label="FC 진행 단계">
                  {FC_MODAL_STEPS.map((step, index) => {
                    const state = index < currentStepIndex ? 'done' : index === currentStepIndex ? 'current' : 'todo';
                    return (
                      <Tabs.Tab key={step.value} value={step.value} data-state={state}>
                        <span className={fcm.stepDot}>{state === 'done' ? <IconCheck size={16} stroke={2.4} /> : index + 1}</span>
                        <span className={fcm.stepText}>
                          <span className={fcm.stepLabel}>{step.label}</span>
                          <span className={fcm.stepState}>{state === 'done' ? '완료' : state === 'current' ? '현재 단계' : '대기'}</span>
                        </span>
                      </Tabs.Tab>
                    );
                  })}
                </Tabs.List>
              </aside>
              <div className={fcm.content}>
                <div className={fcm.contentHead}>
                  <Text className={fcm.contentTitle}>{FC_MODAL_STEPS.find((step) => step.value === modalTab)?.label ?? ''}</Text>
                  {modalTab === 'info' ? (() => {
                    const allowanceCard = ALLOWANCE_FLOW_CARDS.find((card) => card.key === getAllowanceDisplayState(selectedFc).key);
                    return allowanceCard ? (
                      <span className={fcm.subState}><i />{allowanceCard.label} · {allowanceCard.helper}</span>
                    ) : null;
                  })() : null}
                </div>
                <StepSummary items={getStepSummary(modalTab)} />
              <Tabs.Panel value="info">
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
                    <Stack gap="md">
                      <section className={fcm.section}>
                        <div className={fcm.sectionHead}>
                          <Text className={fcm.sectionTitle}>입력 정보</Text>
                          <Button radius="xl" size="xs" variant="white" leftSection={<IconDeviceFloppy size={14} />} onClick={() => updateInfoMutation.mutate()} loading={updateInfoMutation.isPending} disabled={isReadOnly || (selectedFc.status !== 'draft' && selectedFc.status !== 'temp-id-issued' && selectedFc.status !== 'allowance-pending')} color={isReadOnly ? "gray" : "dark"}>
                            저장
                          </Button>
                        </div>
                        <div className={fcm.fieldRow}>
                          <Text className={fcm.fieldLabel}>임시사번</Text>
                          <div className={fcm.fieldControl}>
                            <TextInput
                              aria-label="임시사번"
                              placeholder="T-123456"
                              className={fcm.w200}
                              classNames={{ input: 'muted-placeholder-input' }}
                              value={tempIdInput}
                              onChange={(e) => {
                                const val = e.currentTarget?.value || '';
                                setTempIdInput(val);
                              }}
                            />
                            {canResetToLookup && (
                              <Tooltip label="조회중 단계로 되돌리기 · 잘못 입력한 임시사번을 비우고 이전 단계로 되돌릴 때 사용합니다." multiline w={240} withArrow>
                                <ActionIcon
                                  aria-label="조회중 단계로 되돌리기"
                                  variant="white"
                                  color="gray"
                                  radius="xl"
                                  size={34}
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
                                  <IconRefresh size={16} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                        <div className={fcm.fieldRow}>
                          <Text className={fcm.fieldLabel}>
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
                        </div>
                        <div className={fcm.fieldRow}>
                          <Text className={fcm.fieldLabel}>보증보험 조회 동의일</Text>
                          <div className={fcm.fieldControl}>
                            <Box className={fcm.w200}>
                              <DateInput
                                aria-label="보증보험 조회 동의일"
                                value={allowanceDateInput}
                                onChange={handleAllowanceDateChange}
                                placeholder="YYYY-MM-DD"
                                valueFormat="YYYY-MM-DD"
                                disabled={isReadOnly || !hasTempIdForAllowance}
                                clearable={false}
                                radius="lg"
                                size="sm"
                                leftSection={<IconCalendar size={16} />}
                                previousIcon={<IconChevronLeft size={16} />}
                                nextIcon={<IconChevronRight size={16} />}
                                popoverProps={{ withinPortal: true, shadow: 'md', position: 'bottom-start' }}
                                styles={getModalDateInputStyles(isReadOnly || !hasTempIdForAllowance)}
                              />
                            </Box>
                            <Tooltip label="동의일 저장" withArrow>
                              <ActionIcon
                                aria-label="보증보험 조회 동의일 저장"
                                variant="filled"
                                color={isReadOnly ? 'gray' : 'dark'}
                                radius="xl"
                                size={34}
                                onClick={() => updateAllowanceDateMutation.mutate()}
                                loading={updateAllowanceDateMutation.isPending}
                                disabled={isReadOnly || !hasTempIdForAllowance || !allowanceDateInput}
                              >
                                <IconDeviceFloppy size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </div>
                        </div>
                        {!hasTempIdForAllowance ? (
                          <Text className={fcm.hint} data-tone="red">임시사번 발급 후 보증보험 조회 동의일 저장과 승인 처리를 진행할 수 있습니다.</Text>
                        ) : null}
                        {!hasAllowanceDateForAction ? (
                          <Text className={fcm.hint} data-tone="orange">보증보험 조회 동의일을 입력해야 사전 심사 요청과 승인 완료를 저장할 수 있습니다.</Text>
                        ) : null}
                        {isReadOnly ? (
                          <Text className={fcm.hint}>본부장 계정은 현재 상태 확인만 가능하며, 저장과 상태 변경 버튼은 비활성화됩니다.</Text>
                        ) : null}
                      </section>

                      <div className={fcm.footer}>
                        <Group gap={4}>
                          <Tooltip label="FC 삭제" withArrow>
                            <ActionIcon
                              aria-label="FC 삭제"
                              radius="xl"
                              size={36}
                              variant="subtle"
                              color={isReadOnly ? 'gray' : 'red'}
                              disabled={isReadOnly}
                              onClick={() => {
                                logger.debug('[Web][deleteFc] click', { requestCount: 1 });
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
                              <IconTrash size={18} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="재촉 알림" withArrow>
                            <ActionIcon
                              aria-label="재촉 알림"
                              radius="xl"
                              size={36}
                              variant="subtle"
                              color={isReadOnly ? 'gray' : 'dark'}
                              loading={reminderPending}
                              disabled={isReadOnly || reminderPending}
                              onClick={async () => {
                                if (reminderPendingRef.current) return;
                                reminderPendingRef.current = true;
                                setReminderPending(true);
                                try {
                                // Resolve the current notification recipient from the stable FC id on the server.
                                const notificationResult = await sendPushNotificationForFc(selectedFc.id, {
                                  title: '진행 요청',
                                  body: '관리자가 진행을 요청하였습니다.',
                                  target: {
                                    version: 1,
                                    kind: 'onboarding_section',
                                    fcId: selectedFc.id,
                                    section: 'home',
                                  },
                                  data: { url: '/' },
                                });
                                if (!('inbox' in notificationResult) || !('failures' in notificationResult)) {
                                  logger.warn('[dashboard] reminder request rejected');
                                  notifications.show({
                                    title: '알림 요청 실패',
                                    message: '알림 요청을 처리하지 못했습니다. 수신자와 권한을 확인해 주세요.',
                                    color: 'red',
                                  });
                                  return;
                                }
                                const invalidRecipient = notificationResult.failures.some(
                                  (failure) => failure === 'missing_recipient' || failure === 'recipient_mismatch',
                                );
                                if (invalidRecipient) {
                                  logger.warn('[dashboard] reminder recipient invalid');
                                  notifications.show({
                                    title: '수신자 확인 필요',
                                    message: '유효한 알림 수신자를 확인할 수 없습니다.',
                                    color: 'red',
                                  });
                                  return;
                                }
                                if (!notificationResult.inbox?.logged) {
                                  logger.warn('[dashboard] reminder inbox persistence failed');
                                  notifications.show({
                                    title: '알림 등록 실패',
                                    message: '알림을 등록하지 못했습니다. 다시 시도해 주세요.',
                                    color: 'red',
                                  });
                                  return;
                                }
                                notifications.show({
                                  title: '전송 완료',
                                  message: '알림을 보냈습니다.',
                                  color: 'blue',
                                });
                                } catch {
                                  notifications.show({ title: '알림 결과 확인 필요', message: '전송 결과를 확인하지 못했습니다. 잠시 후 알림 상태를 확인해주세요.', color: 'red' });
                                } finally { reminderPendingRef.current = false; setReminderPending(false); }
                              }}
                            >
                              <IconSend size={18} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                        <Group gap="xs">
                          <Button
                            radius="xl"
                            variant="subtle"
                            color={isReadOnly ? 'gray' : 'red'}
                            disabled={allowanceStateDisabled || allowanceDisplay.key === 'rejected'}
                            onClick={() => openRejectModal({ kind: 'allowance' })}
                          >
                            반려
                          </Button>
                          <Button
                            radius="xl"
                            variant="light"
                            color="dark"
                            leftSection={<IconSend size={16} />}
                            disabled={allowanceStateDisabled}
                            onClick={() => allowanceStateButtons[0].onClick()}
                          >
                            사전 심사 요청
                          </Button>
                          <Button
                            radius="xl"
                            color="dark"
                            leftSection={<IconCheck size={16} />}
                            disabled={allowanceStateDisabled || allowanceDisplay.key === 'approved'}
                            onClick={() => allowanceStateButtons[1].onClick()}
                          >
                            {allowanceDisplay.key === 'approved' ? '승인 완료됨' : '승인 완료'}
                          </Button>
                        </Group>
                      </div>
                    </Stack>
                  );
                })()}
              </Tabs.Panel>

              <Tabs.Panel value="docs">
                <Stack gap="md">
                  <section className={fcm.section}>
                    <Group justify="space-between">
                      <Text className={fcm.sectionTitle}>
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
                              radius={16}
                              p={0}
                              style={{
                                overflow: 'hidden',
                                boxShadow: `inset 3px 0 0 ${isSubmitted ? '#3b5bdb' : 'var(--primary-color)'}`,
                              }}
                            >
                              <Group
                                justify="space-between"
                                py={8}
                                px="sm"
                                bg="white"
                                wrap="nowrap"
                              >
                                <Group gap="sm">
                                  <ThemeIcon
                                    variant="light"
                                    radius="xl"
                                    size="md"
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
                                  {(() => {
                                    // Same decision flow the approve/reject toggle used.
                                    const decide = async (val: 'approved' | 'pending') => {
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
                                              const receipt = requireDocumentStatusReceipt(res, {
                                                status: nextStatus,
                                                reviewerNote: manualApprovalNote,
                                              });
                                              showAdminNotificationWarning(res);
                                              notifications.show({ title: '승인', message: res.message, color: 'green' });
                                              const nextDocs = (selectedFc.fc_documents || []).map((doc: FCDocument) =>
                                                doc.doc_type === d.doc_type
                                                  ? { ...doc, status: receipt.status, reviewer_note: receipt.reviewerNote }
                                                  : doc
                                              );
                                              let nextProfileStatus = selectedFc.status;
                                              if (
                                                receipt.allApproved !== null
                                                && !DOCS_STAGE_LOCK_STATUSES.includes(selectedFc.status)
                                              ) {
                                                nextProfileStatus = receipt.allApproved ? 'docs-approved' : 'docs-pending';
                                              }
                                              updateSelectedFc(
                                                receipt.allApproved === null
                                                  ? { fc_documents: nextDocs }
                                                  : nextProfileStatus === 'docs-pending'
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
                                    };
                                    return (
                                      <Group gap={4} wrap="nowrap">
                                        <Tooltip label="열기">
                                          <ActionIcon
                                            aria-label="서류 열기"
                                            variant="light"
                                            color="gray"
                                            radius="xl"
                                            size={32}
                                            disabled={!isSubmitted}
                                            onClick={() => handleOpenDoc(d.storage_path ?? '')}
                                          >
                                            <IconFileText size={16} />
                                          </ActionIcon>
                                        </Tooltip>
                                        <Tooltip label="승인">
                                          <ActionIcon
                                            aria-label="서류 승인"
                                            variant={d.status === 'approved' ? 'filled' : 'light'}
                                            color={isReadOnly ? 'gray' : 'teal'}
                                            radius="xl"
                                            size={32}
                                            disabled={isReadOnly || d.status === 'approved'}
                                            onClick={() => void decide('approved')}
                                          >
                                            <IconCheck size={16} />
                                          </ActionIcon>
                                        </Tooltip>
                                        <Tooltip label="반려">
                                          <ActionIcon
                                            aria-label="서류 반려"
                                            variant={d.status === 'rejected' ? 'filled' : 'light'}
                                            color={isReadOnly ? 'gray' : 'red'}
                                            radius="xl"
                                            size={32}
                                            disabled={isReadOnly || d.status === 'rejected'}
                                            onClick={() => void decide('pending')}
                                          >
                                            <IconX size={16} />
                                          </ActionIcon>
                                        </Tooltip>
                                        <Tooltip label="파일 삭제">
                                          <ActionIcon
                                            aria-label="제출한 서류 파일 삭제"
                                            variant="subtle"
                                            color={isReadOnly ? 'gray' : 'red'}
                                            radius="xl"
                                            size={32}
                                            disabled={isReadOnly || !isSubmitted}
                                            onClick={() => handleDeleteDocFile(d)}
                                          >
                                            <IconTrash size={16} />
                                          </ActionIcon>
                                        </Tooltip>
                                      </Group>
                                    );
                                  })()}
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
                  </section>
                  <section className={fcm.section}>
                    <div className={fcm.sectionHead}>
                      <Text className={fcm.sectionTitle}>
                        필수 서류 요청 목록
                      </Text>
                      <Button radius="xl"
                      size="xs"
                      leftSection={<IconDeviceFloppy size={14} />}
                      color={isReadOnly ? "gray" : "dark"}
                      disabled={isReadOnly}
                      onClick={() => updateDocsRequestMutation.mutate({ types: selectedDocs, deadline: docsDeadlineInput })}
                      loading={updateDocsRequestMutation.isPending}
                    >
                      요청 저장
                    </Button>
                    </div>
                    <div className={fcm.fieldRow}>
                      <Text className={fcm.fieldLabel}>
                        서류 마감일 (알림용)
                      </Text>
                      <DateInput
                        className={fcm.w200}
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
                    </div>
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
                  <Group align="flex-end" gap={6} wrap="nowrap" style={{ maxWidth: 380 }}>
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
                    <ActionIcon
                      aria-label="기타 서류 추가"
                      variant="filled"
                      color={isReadOnly ? 'gray' : 'dark'}
                      radius="xl"
                      size={30}
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
                      <IconPlus size={16} />
                    </ActionIcon>
                  </Group>

                  </section>
                  {(() => {
                    const docsReviewed = ['docs-approved', 'hanwha-commission-review', 'hanwha-commission-rejected', 'hanwha-commission-approved', 'appointment-completed', 'final-link-sent'].includes(selectedFc.status);
                    const reviewLocked = isReadOnly || DOCS_STAGE_LOCK_STATUSES.includes(selectedFc.status);
                    // Same transitions the review toggle used.
                    const decideReview = (val: 'approved' | 'pending') => {
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
                    };
                    return (
                      <div className={fcm.footer}>
                        <span className={fcm.footerStatus} data-done={docsReviewed || undefined}>
                          <i />서류 심사 · {docsReviewed ? '심사 완료' : '심사 대기'}
                        </span>
                        {docsReviewed ? (
                          <Button radius="xl" variant="subtle" color="gray" disabled={reviewLocked} onClick={() => decideReview('pending')}>
                            심사 완료 취소
                          </Button>
                        ) : (
                          <Button radius="xl" color="dark" leftSection={<IconCheck size={16} />} disabled={reviewLocked} onClick={() => decideReview('approved')}>
                            서류 심사 완료
                          </Button>
                        )}
                      </div>
                    );
                  })()}
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="hanwha">
                {(() => {
                  const hanwhaStatus = getHanwhaStageStatus(selectedFc);
                  const hanwhaDescription = getHanwhaStageDescription(selectedFc);
                  const pdfApproved = hasHanwhaApprovedPdf(selectedFc);
                  return (
                    <Stack gap="md">
                      <Alert
                        color={hanwhaStatus?.color ?? 'blue'}
                        icon={<IconInfoCircle size={16} />}
                        radius="lg"
                        py={10}
                      >
                        <Text fw={700} size="sm" mb={2}>
                          {hanwhaStatus?.label ?? '다위촉 URL 대기'}
                        </Text>
                        <Text size="xs">
                          {hanwhaDescription ?? '서류 승인이 끝나면 다위촉 URL 관리 단계가 열립니다.'}
                        </Text>
                      </Alert>

                      <section className={fcm.section}>
                        <Text className={fcm.sectionTitle}>다위촉 URL 진행</Text>

                        <div className={fcm.itemRow}>
                          <Text className={fcm.fieldLabel}>완료일(다위촉 URL)</Text>
                          <div className={fcm.fieldControl}>
                            <DateInput
                              aria-label="완료일(다위촉 URL)"
                              className={fcm.w200}
                              value={hanwhaSubmittedDateInput}
                              onChange={handleHanwhaSubmittedDateChange}
                              placeholder="YYYY-MM-DD"
                              valueFormat="YYYY-MM-DD"
                              clearable={false}
                              disabled={isReadOnly}
                              radius="lg"
                              size="sm"
                              leftSection={<IconCalendar size={16} />}
                              previousIcon={<IconChevronLeft size={16} />}
                              nextIcon={<IconChevronRight size={16} />}
                              popoverProps={{ withinPortal: true, shadow: 'md', position: 'bottom-start' }}
                              styles={getModalDateInputStyles(isReadOnly)}
                            />
                            <Tooltip label="완료일 저장" withArrow>
                              <ActionIcon
                                aria-label="완료일 저장"
                                variant="filled"
                                color={isReadOnly ? 'gray' : 'dark'}
                                radius="xl"
                                size={34}
                                onClick={() => updateHanwhaSubmissionDateMutation.mutate()}
                                loading={updateHanwhaSubmissionDateMutation.isPending}
                                disabled={isReadOnly || !hanwhaSubmittedDateInput}
                              >
                                <IconDeviceFloppy size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </div>
                          <span className={fcm.itemState} data-done={selectedFc.hanwha_commission_date_sub ? true : undefined}>
                            {selectedFc.hanwha_commission_date_sub ? '입력됨' : '미입력'}
                          </span>
                        </div>

                        <div className={fcm.itemRow}>
                          <Text className={fcm.fieldLabel}>URL 발송 알림</Text>
                          <div className={fcm.fieldControl}>
                            <Text size="sm" c={selectedFc.dawichok_url_sent_at ? 'dark' : 'dimmed'}>
                              {selectedFc.dawichok_url_sent_at
                                ? `최근 발송: ${dayjs(selectedFc.dawichok_url_sent_at).format('YYYY-MM-DD HH:mm')}`
                                : '아직 보내지 않았습니다.'}
                            </Text>
                            <Tooltip label="FC에게 “카카오톡으로 전송된 다위촉 URL을 진행해 주세요.” 알림을 보냅니다." multiline w={240} withArrow>
                              <Button
                                radius="xl"
                                size="xs"
                                variant="light"
                                color={isReadOnly ? 'gray' : 'dark'}
                                leftSection={<IconSend size={14} />}
                                onClick={() => markDawichokUrlSentMutation.mutate()}
                                loading={markDawichokUrlSentMutation.isPending}
                                disabled={isReadOnly || markDawichokUrlSentMutation.isPending}
                              >
                                {selectedFc.dawichok_url_sent_at ? '다시 보내기' : '알림 보내기'}
                              </Button>
                            </Tooltip>
                          </div>
                          <span className={fcm.itemState} data-done={selectedFc.dawichok_url_sent_at ? true : undefined}>
                            {selectedFc.dawichok_url_sent_at ? '발송됨' : '미발송'}
                          </span>
                        </div>

                        <div className={fcm.itemRow}>
                          <Text className={fcm.fieldLabel}>다위촉 URL PDF</Text>
                          <div className={fcm.fieldControl}>
                            <Text size="sm" c={selectedFc.hanwha_commission_pdf_name ? 'dark' : 'dimmed'} truncate maw={220}>
                              {selectedFc.hanwha_commission_pdf_name
                                ? `등록 파일: ${selectedFc.hanwha_commission_pdf_name}`
                                : '등록된 다위촉 URL PDF가 없습니다.'}
                            </Text>
                            {!!selectedFc.hanwha_commission_pdf_path && (
                              <Tooltip label="다위촉 URL PDF 보기" withArrow>
                                <ActionIcon
                                  aria-label="다위촉 URL PDF 보기"
                                  variant="light"
                                  color="gray"
                                  radius="xl"
                                  size={30}
                                  onClick={() => handleOpenDoc(selectedFc.hanwha_commission_pdf_path!)}
                                >
                                  <IconFileText size={16} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                            {!!selectedFc.hanwha_commission_pdf_path && (
                              <Tooltip label="PDF 삭제" withArrow>
                                <ActionIcon
                                  aria-label="PDF 삭제"
                                  variant="subtle"
                                  color={isReadOnly ? 'gray' : 'red'}
                                  radius="xl"
                                  size={30}
                                  loading={isHanwhaPdfDeleting}
                                  onClick={handleDeleteHanwhaPdf}
                                  disabled={isReadOnly || isHanwhaPdfDeleting}
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </div>
                          <span className={fcm.itemState} data-done={pdfApproved || undefined}>
                            {pdfApproved ? '승인 완료' : '승인 대기'}
                          </span>
                        </div>
                      </section>

                      <input
                        ref={hanwhaPdfUploadInputRef}
                        type="file"
                        accept="application/pdf"
                        style={{ display: 'none' }}
                        onChange={handleHanwhaPdfInputChange}
                      />
                      {!!selectedFc.hanwha_commission_reject_reason && (
                        <Textarea
                          label="반려 사유"
                          value={selectedFc.hanwha_commission_reject_reason}
                          readOnly
                          minRows={2}
                        />
                      )}

                      <div className={fcm.footer}>
                        <span className={fcm.footerStatus} data-done={pdfApproved || undefined}>
                          <i />다위촉 · {hanwhaStatus?.label ?? '다위촉 URL 대기'}
                        </span>
                        <Button
                          radius="xl"
                          color={isReadOnly ? 'gray' : 'dark'}
                          leftSection={<IconCheck size={16} />}
                          loading={isHanwhaPdfUploading}
                          disabled={isReadOnly || isHanwhaPdfUploading || !hanwhaSubmittedDateInput}
                          onClick={handleApproveHanwha}
                        >
                          PDF 업로드 및 승인
                        </Button>
                      </div>
                    </Stack>
                  );
                })()}
              </Tabs.Panel>
              <Tabs.Panel value="appointment">
                <Stack gap="md">
                  {canOpenInsuranceStage(selectedFc) ? (
                    <Stack gap="sm">
                      {renderAppointmentSection('life')}
                      {renderAppointmentSection('nonlife')}
                    </Stack>
                  ) : (
                    <Alert color="yellow" icon={<IconInfoCircle size={16} />} radius="lg">
                      <Text fw={700} size="sm" mb={4}>
                        생명/손해 위촉 관리 잠금
                      </Text>
                      <Text size="xs">
                        다위촉 URL PDF가 승인되어야 생명/손해 위촉 관리 탭을 열 수 있습니다.
                      </Text>
                    </Alert>
                  )}

                  <div className={fcm.footer}>
                    <span className={fcm.footerStatus} data-done={commissionInput === 'both' || undefined}>
                      <i />최종 완료 · {commissionSummaryLabel}
                    </span>
                    <Group gap="xs">
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
                      <Tooltip label="위 승인 후 최종 완료 여부를 별도로 저장합니다." withArrow>
                        <Button
                          radius="xl"
                          color={isReadOnly ? 'gray' : 'dark'}
                          leftSection={<IconCheck size={16} />}
                          onClick={() => updateCommissionMutation.mutate()}
                          loading={updateCommissionMutation.isPending}
                          disabled={isReadOnly}
                        >
                          최종 완료 저장
                        </Button>
                      </Tooltip>
                    </Group>
                  </div>
                </Stack>
              </Tabs.Panel>


              </div>
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

      <ConfirmModal
        opened={confirmOpened}
        onClose={closeConfirm}
        onConfirm={() => void handleConfirm()}
        title={confirmConfig?.title}
        message={selectedFc?.name && confirmConfig ? `${selectedFc.name} · ${confirmConfig.message}` : confirmConfig?.message}
        confirmLabel={confirmConfig?.confirmLabel}
        color={confirmConfig?.color}
        submitting={confirmSubmitting}
      />
    </Box >
  );
}
