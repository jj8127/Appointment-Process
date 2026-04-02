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
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { useSession } from '@/hooks/use-session';
import { RecommenderSelect } from '@/components/RecommenderSelect';
import { supabase } from '@/lib/supabase';
import type { FCDocument, FCProfileWithDocuments } from '@/types/dashboard';
import type { CommissionCompletionStatus, FcProfile, FcStatus } from '@/types/fc';
import { notifications } from '@mantine/notifications';
import { useRouter } from 'next/navigation';
import { StatusToggle } from '../../components/StatusToggle';
import { getAllowanceDisplayState } from '../../lib/fc-workflow';
import {
  ADMIN_STEP_LABELS,
  calcStep,
  DOC_OPTIONS,
  getAdminStepDisplay,
  getAppointmentProgress,
  getSummaryStatus
} from '../../lib/shared';
import { sendPushNotification } from '../actions';
import { updateAppointmentAction } from './appointment/actions';
import { updateDocStatusAction } from './docs/actions';
import { registerWebPushSubscription } from '@/components/WebPushRegistrar';

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

type RecommenderDisplaySource = {
  recommender?: string | null;
  recommender_fc_id?: string | null;
};

const trimValue = (value?: string | null) => String(value ?? '').trim();

const getRecommenderDisplay = (profile?: RecommenderDisplaySource | null) => {
  const recommenderValue = trimValue(profile?.recommender) || '-';
  if (trimValue(profile?.recommender_fc_id)) {
    return {
      label: '연결된 추천인 FC',
      value: recommenderValue,
      helperText: null,
    };
  }
  if (trimValue(profile?.recommender)) {
    return {
      label: '레거시 추천인 표시값',
      value: recommenderValue,
      helperText: '현재 값은 예전 가입 데이터에 남은 표시값이며, 구조화 추천인 연결은 아닙니다.',
    };
  }
  return {
    label: '연결된 추천인 FC',
    value: '-',
    helperText: null,
  };
};

const readSignupReferralCode = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return null;
  const signupReferralCode =
    'signupReferralCode' in payload
      ? (payload as { signupReferralCode?: unknown }).signupReferralCode
      : 'inviteeReferralCode' in payload
        ? (payload as { inviteeReferralCode?: unknown }).inviteeReferralCode
        : null;
  return typeof signupReferralCode === 'string' && signupReferralCode.trim()
    ? signupReferralCode
    : null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const getBirthDate = (residentNumber?: string | null) => {
  const digits = String(residentNumber ?? '').replace(/\D/g, '');
  if (digits.length < 6) return '-';
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}`;
};

const isHanwhaApproved = (
  profile: Pick<FCProfileWithDocuments, 'status' | 'hanwha_commission_date'>,
) => Boolean(profile.hanwha_commission_date || HANWHA_APPROVED_STATUSES.includes(profile.status));

const hasHanwhaApprovedPdf = (
  profile: Pick<
    FCProfileWithDocuments,
    'status' | 'hanwha_commission_date' | 'hanwha_commission_pdf_path' | 'hanwha_commission_pdf_name'
  >,
) =>
  Boolean(
    isHanwhaApproved(profile) &&
    trimValue(profile.hanwha_commission_pdf_path) &&
    trimValue(profile.hanwha_commission_pdf_name),
  );

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
  const allSubmitted =
    docs.length > 0 && docs.every((doc) => doc.storage_path && doc.storage_path !== 'deleted');
  const allApproved = allSubmitted && docs.every((doc) => doc.status === 'approved');
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
    | 'hanwha_commission_date'
    | 'hanwha_commission_pdf_path'
    | 'hanwha_commission_pdf_name'
  >,
) => {
  if (profile.status === 'docs-approved') {
    return { label: '한화 위촉 URL 대기', color: 'blue' as const };
  }
  if (profile.status === 'hanwha-commission-review') {
    return { label: '한화 위촉 URL 검토 중', color: 'orange' as const };
  }
  if (profile.status === 'hanwha-commission-rejected') {
    return { label: '한화 위촉 URL 반려', color: 'red' as const };
  }
  if (profile.status === 'hanwha-commission-approved') {
    return hasHanwhaApprovedPdf(profile)
      ? { label: '한화 위촉 URL 승인 / PDF 완료', color: 'teal' as const }
      : { label: '한화 위촉 URL 승인 / PDF 대기', color: 'yellow' as const };
  }
  return null;
};

const getHanwhaStageDescription = (
  profile: Pick<
    FCProfileWithDocuments,
    | 'status'
    | 'hanwha_commission_date'
    | 'hanwha_commission_reject_reason'
    | 'hanwha_commission_pdf_path'
    | 'hanwha_commission_pdf_name'
  >,
) => {
  if (profile.status === 'docs-approved') {
    return '서류 승인이 완료되었습니다. FC는 한화 위촉 URL 단계로 이동해야 합니다.';
  }
  if (profile.status === 'hanwha-commission-review') {
      return 'FC가 한화 위촉 URL 완료일을 제출했습니다. 승인과 PDF 등록 전에는 생명/손해 위촉 단계를 열 수 없습니다.';
  }
  if (profile.status === 'hanwha-commission-rejected') {
    const reason = trimValue(profile.hanwha_commission_reject_reason);
    return reason
      ? `한화 위촉 URL이 반려되었습니다. 사유: ${reason}`
      : '한화 위촉 URL이 반려되었습니다. FC가 재제출해야 생명/손해 위촉 단계가 열립니다.';
  }
  if (profile.status === 'hanwha-commission-approved') {
    return hasHanwhaApprovedPdf(profile)
        ? '한화 위촉 URL 승인과 PDF 등록이 완료되었습니다. 생명/손해 위촉 단계를 진행할 수 있습니다.'
        : '한화 위촉 URL은 승인되었지만 PDF가 아직 등록되지 않았습니다. PDF 등록 후 생명/손해 위촉 단계가 열립니다.';
  }
  return null;
};

const getDefaultModalTab = (profile: FCProfileWithDocuments): string => {
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
  const [selectedRecommenderFcId, setSelectedRecommenderFcId] = useState<string | null>(null);
  const [clearRecommenderSelection, setClearRecommenderSelection] = useState(false);
  const [recommenderOverrideReason, setRecommenderOverrideReason] = useState('');
  const [careerInput, setCareerInput] = useState<'신입' | '경력' | null>(null);
  const [commissionInput, setCommissionInput] = useState<CommissionCompletionStatus>('none');
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [customDocInput, setCustomDocInput] = useState('');
  const [docsDeadlineInput, setDocsDeadlineInput] = useState<Date | null>(null);
  const [allowanceDateInput, setAllowanceDateInput] = useState<Date | null>(null);
  const [hanwhaSubmittedDateInput, setHanwhaSubmittedDateInput] = useState<Date | null>(null);
  const [isHanwhaPdfPending, setIsHanwhaPdfPending] = useState(false);
  const hanwhaPdfInputRef = useRef<HTMLInputElement | null>(null);
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
          title: '수당동의 반려',
          msg: `수당 동의가 반려되었습니다.\n사유: ${reason}`,
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
          title: '한화 위촉 URL 반려',
          msg: `한화 위촉 URL이 반려되었습니다.\n사유: ${reason}`,
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
            phone: selectedFc.phone,
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
        notifications.show({ title: '처리 완료', message: '생명/손해 위촉 정보를 반려했습니다.', color: 'green' });
        queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
      }

      if (rejectTarget.kind === 'doc') {
        const doc = rejectTarget.doc;
        const res = await updateDocStatusAction({ success: false }, {
          fcId: selectedFc.id,
          phone: selectedFc.phone,
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
        updateSelectedFc({ fc_documents: nextDocs, status: nextProfileStatus });
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
  }, [fcs, activeTab, keyword]);

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
  }, [activeTab, keyword]);

  const {
    data: signupReferralCode,
    isFetching: isSignupReferralCodeFetching,
    refetch: refetchSignupReferralCode,
  } = useQuery({
    queryKey: ['fc-signup-referral-code', selectedFc?.id],
    queryFn: async () => {
      if (!selectedFc?.id) return null;
      const resp = await fetch('/api/admin/fc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getInviteeReferralCode', payload: { fcId: selectedFc.id } }),
      });
      const json: unknown = await resp.json().catch(() => null);
      return readSignupReferralCode(json);
    },
    enabled: !!selectedFc?.id,
  });

  const canReadResidentNumber = role === 'admin' || role === 'manager';
  const {
    data: selectedResidentNumber,
    isFetching: isSelectedResidentNumberFetching,
    refetch: refetchSelectedResidentNumber,
  } = useQuery({
    queryKey: ['dashboard-resident-number', selectedFc?.id, role],
    queryFn: async () => {
      if (!selectedFc?.id) return null;
      const resp = await fetch('/api/admin/resident-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fcIds: [selectedFc.id] }),
      });
      const json: unknown = await resp.json().catch(() => null);
      if (!resp.ok || !isRecord(json) || json.ok !== true || !isRecord(json.residentNumbers)) {
        return null;
      }
      const residentNumbers = json.residentNumbers as Record<string, unknown>;
      const value = residentNumbers[selectedFc.id];
      return typeof value === 'string' && value.trim() ? value : null;
    },
    enabled: canReadResidentNumber && !!selectedFc?.id,
  });

  useEffect(() => {
    if (!opened || !selectedFc?.id) {
      return;
    }

    void refetchSignupReferralCode();
  }, [opened, refetchSignupReferralCode, selectedFc?.id]);

  useEffect(() => {
    if (!opened || !selectedFc?.id || !canReadResidentNumber) {
      return;
    }

    void refetchSelectedResidentNumber();
  }, [canReadResidentNumber, opened, refetchSelectedResidentNumber, selectedFc?.id]);

  const recommenderDisplay = useMemo(
    () => getRecommenderDisplay(selectedFc),
    [selectedFc],
  );

  const hasAnyRecommender = Boolean(selectedFc?.recommender_fc_id || trimValue(selectedFc?.recommender));
  const isRecommenderDirty = selectedFc
    ? clearRecommenderSelection
      ? hasAnyRecommender
      : (selectedFc.recommender_fc_id ?? null) !== selectedRecommenderFcId
    : false;
  const isRecommenderReasonMissing = isRecommenderDirty && !recommenderOverrideReason.trim();

  const updateInfoMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFc) return;
      const payload: Partial<FcProfile> & Record<string, unknown> = {
        career_type: careerInput,
      };
      if (isRecommenderDirty) {
        payload.recommenderFcId = clearRecommenderSelection ? null : selectedRecommenderFcId;
        payload.recommenderOverrideReason = recommenderOverrideReason.trim();
      }
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
          payload: { fcId: selectedFc.id, data: payload, phone: selectedFc.phone },
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
      return data as { profile?: Partial<FCProfileWithDocuments> | null } | null;
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
      setClearRecommenderSelection(false);
      setRecommenderOverrideReason('');
      notifications.show({ title: '저장 완료', message: '기본 정보가 업데이트되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
      queryClient.invalidateQueries({ queryKey: ['fc-signup-referral-code', selectedFc?.id ?? null] });
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
        throw new Error('수당 동의일을 선택해주세요.');
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
        throw new Error(message || '수당 동의일 저장 실패');
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
      notifications.show({ title: '저장 완료', message: '수당 동의일이 저장되었습니다.', color: 'green' });
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
            phone: selectedFc.phone,
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
    },
    onSuccess: () => {
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
            phone: selectedFc.phone,
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
    },
    onSuccess: (_data, variables) => {
      if (variables?.status) {
        updateSelectedFc({ status: variables.status, ...(variables.extra ?? {}) });
      }
      notifications.show({ title: '처리 완료', message: '상태가 변경되었습니다.', color: 'green' });
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
        throw new Error('한화 위촉 URL 완료일을 입력해주세요.');
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
        throw new Error(message || '한화 위촉 URL 완료일 저장 실패');
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
      notifications.show({ title: '저장 완료', message: '한화 위촉 URL 완료일이 저장되었습니다.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['dashboard-list'] });
    },
    onError: (err: Error) => {
      notifications.show({ title: '오류', message: err.message, color: 'red' });
    },
  });

  const handleOpenModal = (fc: FCProfileWithDocuments) => {
    setSelectedFc(fc);
    setTempIdInput(fc.temp_id || '');
    setSelectedRecommenderFcId(fc.recommender_fc_id ?? null);
    setClearRecommenderSelection(false);
    setRecommenderOverrideReason('');
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
    if (!path) return;
    const resp = await fetch('/api/admin/fc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signDoc', payload: { path } }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data?.signedUrl) {
      notifications.show({ title: '실패', message: '파일을 찾을 수 없습니다.', color: 'red' });
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const persistHanwhaPdfMetadata = async (nextPath: string, nextName: string) => {
    if (!selectedFc) return;

    const extra: Record<string, string | null> = {
      hanwha_commission_pdf_path: nextPath,
      hanwha_commission_pdf_name: nextName,
    };
    if (selectedFc.status === 'hanwha-commission-approved') {
      extra.hanwha_commission_date = trimValue(selectedFc.hanwha_commission_date) || dayjs().format('YYYY-MM-DD');
      extra.hanwha_commission_reject_reason = null;
    }

    const resp = await fetch('/api/admin/fc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateStatus',
        payload: {
          fcId: selectedFc.id,
          status: selectedFc.status,
          msg: '',
          extra,
          phone: selectedFc.phone,
        },
      }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const message =
        data && typeof data === 'object' && 'error' in data
          ? String((data as { error?: string }).error || '')
          : '';
      throw new Error(message || '한화 PDF 메타데이터 저장 실패');
    }

    updateSelectedFc(extra);
  };

  const handleHanwhaPdfFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!selectedFc || !file) return;
    if (isReadOnly) return;
    if (file.type && file.type !== 'application/pdf') {
      notifications.show({ title: '업로드 실패', message: 'PDF 파일만 업로드할 수 있습니다.', color: 'red' });
      return;
    }

    setIsHanwhaPdfPending(true);
    try {
      const resp = await fetch('/api/admin/fc', {
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
      const data = (await resp.json().catch(() => null)) as
        | { ok?: boolean; path?: string; token?: string; error?: string }
        | null;
      if (!resp.ok || !data?.path || !data?.token) {
        throw new Error(data?.error || '한화 PDF 업로드 준비에 실패했습니다.');
      }

      const { error: uploadError } = await supabase.storage
        .from('fc-documents')
        .uploadToSignedUrl(data.path, data.token, file, {
          upsert: true,
          contentType: file.type || 'application/pdf',
        });
      if (uploadError) {
        throw uploadError;
      }

      await persistHanwhaPdfMetadata(data.path, file.name);
      notifications.show({ title: '업로드 완료', message: '한화 위촉 URL PDF를 저장했습니다.', color: 'green' });
    } catch (err: unknown) {
      const error = err as Error;
      notifications.show({
        title: '업로드 실패',
        message: error?.message ?? '한화 위촉 URL PDF 업로드 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setIsHanwhaPdfPending(false);
    }
  };

  const handleDeleteHanwhaPdf = async () => {
    if (!selectedFc || !selectedFc.hanwha_commission_pdf_path) return;
    showConfirm({
      title: '한화 PDF 삭제',
      message: '등록된 한화 위촉 URL PDF를 삭제할까요? 생명/손해 위촉 단계가 다시 잠길 수 있습니다.',
      confirmLabel: '삭제',
      color: 'red',
      onConfirm: async () => {
        setIsHanwhaPdfPending(true);
        try {
          const resp = await fetch('/api/admin/fc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'deleteHanwhaPdf',
              payload: {
                fcId: selectedFc.id,
                storagePath: selectedFc.hanwha_commission_pdf_path,
              },
            }),
          });
          const data = await resp.json().catch(() => null);
          if (!resp.ok) {
            const message =
              data && typeof data === 'object' && 'error' in data
                ? String((data as { error?: string }).error || '')
                : '';
            throw new Error(message || '한화 PDF 삭제 실패');
          }

          updateSelectedFc({
            hanwha_commission_pdf_path: null,
            hanwha_commission_pdf_name: null,
          });
          notifications.show({ title: '삭제 완료', message: '한화 위촉 URL PDF를 삭제했습니다.', color: 'gray' });
        } catch (err: unknown) {
          const error = err as Error;
          notifications.show({ title: '삭제 실패', message: error?.message ?? '한화 PDF 삭제 실패', color: 'red' });
        } finally {
          setIsHanwhaPdfPending(false);
        }
      },
    });
  };

  const handleApproveHanwha = () => {
    if (!selectedFc) return;
    const submittedDate = hanwhaSubmittedDateInput ? dayjs(hanwhaSubmittedDateInput).format('YYYY-MM-DD') : '';
    if (!submittedDate) {
      notifications.show({
        title: '승인 불가',
        message: '한화 위촉 URL 완료일을 입력해주세요.',
        color: 'red',
      });
      return;
    }
    if (!selectedFc.hanwha_commission_pdf_path || !selectedFc.hanwha_commission_pdf_name) {
      notifications.show({
        title: 'PDF 필요',
        message: '한화 위촉 URL PDF 등록 후에만 승인할 수 있습니다.',
        color: 'yellow',
      });
      return;
    }

    showConfirm({
      title: '한화 위촉 URL 승인',
      message: '한화 위촉 URL을 승인하고 FC가 승인 PDF를 확인할 수 있게 할까요?',
      confirmLabel: '승인',
      color: 'blue',
      onConfirm: () =>
        updateStatusMutation.mutate({
          status: 'hanwha-commission-approved',
          title: '한화 위촉 URL 승인',
          msg: '한화 위촉 URL이 승인되었습니다. 승인 PDF를 확인해주세요.',
          extra: {
            hanwha_commission_date: dayjs().format('YYYY-MM-DD'),
            hanwha_commission_date_sub: submittedDate,
            hanwha_commission_reject_reason: null,
            hanwha_commission_pdf_path: selectedFc.hanwha_commission_pdf_path ?? null,
            hanwha_commission_pdf_name: selectedFc.hanwha_commission_pdf_name ?? null,
          },
        }),
    });
  };

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

  const handleAppointmentAction = (e: React.MouseEvent, type: 'schedule' | 'confirm', category: 'life' | 'nonlife') => {
    e.stopPropagation();
    if (!selectedFc) return;

    if (!canOpenInsuranceStage(selectedFc)) {
      notifications.show({
        title: '한화 위촉 URL 대기',
        message: '한화 위촉 URL 승인과 PDF 등록이 끝난 뒤에만 생명/손해 위촉 단계를 진행할 수 있습니다.',
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
            phone: selectedFc!.phone,
            type,
            category,
            value,
          }
        );
        if (result.success) {
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

    return (
      <Stack gap="xs" mt="sm">
        <Text size="sm" fw={600} c="dimmed">{isLife ? '생명보험' : '손해보험'}</Text>
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
                {isConfirmed ? (
                  <Badge variant="light" color="green" size="xs">
                    승인 완료
                  </Badge>
                ) : isSubmitted ? (
                  <Badge variant="light" color="orange" size="xs">
                    FC 제출
                  </Badge>
                ) : (
                  <Badge variant="light" color="gray" size="xs">
                    미입력
                  </Badge>
                )}
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
                backgroundColor: isSubmitted ? '#fff4e6' : undefined,
                borderColor: isSubmitted ? '#ff922b' : undefined,
              },
            }}
          />
        </Group>
        {isSubmitted && (
          <Text size="xs" c="orange">
            제출일: {dayjs(submittedDate).format('YYYY-MM-DD')}
          </Text>
        )}
        <Stack gap={6}>
          <Button
            fullWidth
            variant={isReadOnly ? "default" : "filled"}
            color={isReadOnly ? "gray" : "blue"}
            leftSection={<IconDeviceFloppy size={14} />}
            loading={isAppointmentPending}
            disabled={isReadOnly || !insuranceStageOpen}
            onClick={(e) => handleAppointmentAction(e, 'schedule', category)}
          >
            일정 저장
          </Button>
          <Group grow gap={6}>
            <Button
              variant={isConfirmed ? "filled" : "light"}
              color="green"
              size="xs"
              disabled={isReadOnly || isAppointmentPending || !date || !insuranceStageOpen}
              loading={isAppointmentPending}
              onClick={(e) => handleAppointmentAction(e, 'confirm', category)}
            >
              승인 완료
            </Button>
            <Button
              variant="light"
              color="red"
              size="xs"
              disabled={isReadOnly || isAppointmentPending || (!isConfirmed && !isSubmitted && !date) || !insuranceStageOpen}
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
      ? '생명/손해 완료'
      : commissionInput === 'life_only'
        ? '생명 완료'
        : commissionInput === 'nonlife_only'
          ? '손해 완료'
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
      <Table.Td>{fc.phone}</Table.Td>
      <Table.Td>{fc.affiliation || '-'}</Table.Td>
      <Table.Td>
        {(fc.appointment_date_life || fc.appointment_date_nonlife) ? (
          <Stack gap={4}>
            {fc.appointment_date_life && (
              <Group gap={6}>
                <Badge variant="light" color="orange" size="xs">생명</Badge>
                <Text size="sm" fw={700} c="dark.8">
                  {dayjs(fc.appointment_date_life).format('YYYY-MM-DD')}
                </Text>
              </Group>
            )}
            {fc.appointment_date_nonlife && (
              <Group gap={6}>
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
      <Table.Td>
        {(() => {
          const workflowStep = fc.step ?? calcStep(fc);
          const hanwha = getHanwhaStageStatus(fc);
          const summary = getSummaryStatus(fc);
          const docs = fc.fc_documents ?? [];
          const totalDocs = docs.length;
          const submittedDocs = docs.filter((d: FCDocument) => d.storage_path && d.storage_path !== 'deleted').length;
          const approvedDocs = docs.filter((d: FCDocument) => d.status === 'approved').length;
          const pendingDocs = docs.filter(
            (d: FCDocument) =>
              d.storage_path &&
              d.storage_path !== 'deleted' &&
              d.status !== 'approved' &&
              d.status !== 'rejected',
          ).length;
          const rejectedDocs = docs.filter((d: FCDocument) => d.status === 'rejected').length;
          const showDocGrid =
            workflowStep === 2 &&
            totalDocs > 0 &&
            summary.label !== '서류 제출 대기';

          return (
            <Stack gap={6}>
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
              <Group gap={6} wrap="wrap">
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
      <Table.Td>
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
      <Table.Td>
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
    return {
      total: fcs.length,
      pendingAllowance: fcs.filter((fc: FCProfileWithDocuments) => fc.status === 'allowance-pending').length,
      pendingDocs: fcs.filter((fc: FCProfileWithDocuments) => fc.status === 'docs-pending' || fc.status === 'docs-submitted').length,
    };
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

      if (result.message === 'unsupported') {
        notifications.show({
          title: '지원되지 않음',
          message: '현재 브라우저는 웹 푸시를 지원하지 않습니다.',
          color: 'orange',
        });
        return;
      }

      if (result.message === 'permission-not-granted') {
        notifications.show({
          title: '알림 권한 필요',
          message: '브라우저 사이트 설정에서 알림을 허용한 뒤 다시 시도해주세요.',
          color: 'orange',
        });
        return;
      }

      notifications.show({
        title: '웹 알림 등록 실패',
        message: result.message ?? '알림 등록 중 오류가 발생했습니다.',
        color: 'red',
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
  const selectedResidentNumberDisplay = isSelectedResidentNumberFetching
    ? '주민번호 조회 중...'
    : (selectedResidentNumber ?? '주민번호 조회 실패');

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
          <Card padding="lg" radius="md" withBorder shadow="sm" bg="white">
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
            <Text c="green" size="xs" fw={700} mt="md">
              활성 FC 현황
            </Text>
          </Card>

          <Card padding="lg" radius="md" withBorder shadow="sm" bg="white">
            <Group justify="space-between" mb="xs">
              <Text c="dimmed" tt="uppercase" fw={700} size="xs" style={{ letterSpacing: '0.5px' }}>수당동의 대기</Text>
              <ThemeIcon variant="light" color="orange" radius="md" size="lg">
                <IconCheck size={22} stroke={1.5} />
              </ThemeIcon>
            </Group>
            <Group align="flex-end" gap="xs">
              <Text fw={800} size="2.5rem" lh={1}>{metrics.pendingAllowance}</Text>
              <Text c="dimmed" size="sm" mb={6}>건</Text>
            </Group>
            <Text c="orange" size="xs" fw={700} mt="md">
              승인 필요
            </Text>
          </Card>

          <Card padding="lg" radius="md" withBorder shadow="sm" bg="white">
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
            <Text c="indigo" size="xs" fw={700} mt="md">
              검토 필요
            </Text>
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
              <Button variant="white" color={isReadOnly ? "gray" : "dark"} size="xs" leftSection={<IconUser size={14} />} onClick={() => router.push('/dashboard/exam/applicants')} disabled={isReadOnly}>
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
                onChange={setActiveTab}
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
                    <Table.Th w={200}>FC 정보</Table.Th>
                    <Table.Th w={100}>연락처</Table.Th>
                    <Table.Th w={140}>소속</Table.Th>
                      <Table.Th w={150}>생명/손해 위촉 완료일</Table.Th>
                    <Table.Th w={200}>현재 상태</Table.Th>
                    <Table.Th w={120}>진행 단계</Table.Th>
                    <Table.Th w={90} ta="center">관리</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.length > 0 ? (
                    rows
                  ) : (
                    <Table.Tr>
                      <Table.Td colSpan={7} align="center" py={80}>
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
                    생년월일: {getBirthDate(selectedResidentNumber)}
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
                  수당 동의
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
                  한화 위촉
                </Tabs.Tab>
                <Tabs.Tab
                  value="appointment"
                  leftSection={<IconCalendar size={16} />}
                  style={{ flex: '1 1 0', minWidth: 0, justifyContent: 'center', whiteSpace: 'nowrap' }}
                >
                  생명/손해 위촉
                </Tabs.Tab>

              </Tabs.List>
              <input
                ref={hanwhaPdfInputRef}
                type="file"
                accept="application/pdf"
                style={{ display: 'none' }}
                onChange={handleHanwhaPdfFileChange}
              />

              <Tabs.Panel value="info">
                <Stack gap="md">
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
                    {isReadOnly ? (
                      <Stack gap={6}>
                        <TextInput
                          style={{ flex: 1 }}
                          label={recommenderDisplay.label}
                          value={recommenderDisplay.value}
                          readOnly
                        />
                        {recommenderDisplay.helperText ? (
                          <Text size="xs" c="dimmed">
                            {recommenderDisplay.helperText}
                          </Text>
                        ) : null}
                        <Text size="xs" fw={600} c="dimmed">
                          가입 시 입력한 추천코드:{' '}
                          <Text component="span" size="xs" fw={700} c="orange">
                            {isSignupReferralCodeFetching ? '조회 중...' : (signupReferralCode ?? '-')}
                          </Text>
                        </Text>
                      </Stack>
                    ) : (
                      <Stack gap={6}>
                        <Box style={{ flex: 1 }}>
                          <RecommenderSelect
                            label="추천인 연결 FC"
                            value={clearRecommenderSelection ? null : selectedRecommenderFcId}
                            inviteeFcId={selectedFc?.id ?? null}
                            onChange={(candidate) => {
                              setSelectedRecommenderFcId(candidate?.fcId ?? null);
                              setClearRecommenderSelection(false);
                            }}
                          />
                        </Box>
                        <Text size="xs" fw={600} c="dimmed">
                          가입 시 입력한 추천코드:{' '}
                          <Text component="span" size="xs" fw={700} c="orange">
                            {isSignupReferralCodeFetching ? '조회 중...' : (signupReferralCode ?? '-')}
                          </Text>
                        </Text>
                        {selectedFc?.recommender && !selectedFc.recommender_fc_id && !clearRecommenderSelection ? (
                          <Text size="xs" c="dimmed">
                            현재 레거시 추천인 표시값: {selectedFc.recommender}
                          </Text>
                        ) : null}
                        {hasAnyRecommender ? (
                          <Group gap="xs">
                            <Button
                              variant="light"
                              color="gray"
                              size="xs"
                              onClick={() => {
                                setSelectedRecommenderFcId(null);
                                setClearRecommenderSelection(true);
                              }}
                            >
                              추천인 연결 해제
                            </Button>
                          </Group>
                        ) : null}
                        {isRecommenderDirty ? (
                          <Textarea
                            label="추천인 변경 사유"
                            placeholder="운영 수정 사유 입력"
                            value={recommenderOverrideReason}
                            onChange={(event) => setRecommenderOverrideReason(event.currentTarget.value)}
                            minRows={2}
                          />
                        ) : null}
                      </Stack>
                    )}
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
                            message: '임시사번과 수당 동의일을 비우고 조회중(임시사번 미입력) 단계로 되돌릴까요?',
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
                      const allowanceStateButtons = [
                        {
                          key: 'entered',
                          label: '입력 완료',
                          active: allowanceDisplay.key === 'entered',
                          color: 'gray' as const,
                          onClick: () =>
                            updateStatusMutation.mutate({
                              status: 'allowance-pending',
                              title: '수당동의 입력 완료',
                              msg: '수당 동의일 입력이 확인되었습니다.',
                              extra: {
                                allowance_prescreen_requested_at: null,
                                allowance_reject_reason: null,
                              },
                            }),
                        },
                        {
                          key: 'prescreen',
                          label: '사전 심사 요청 완료',
                          active: allowanceDisplay.key === 'prescreen',
                          color: 'blue' as const,
                          onClick: () =>
                            updateStatusMutation.mutate({
                              status: 'allowance-pending',
                              title: '사전 심사 요청 완료',
                              msg: '사전 심사 요청이 완료되었습니다.',
                              extra: {
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
                              title: '수당동의 승인',
                              msg: '수당 동의가 승인되었습니다. 서류 제출 단계로 진행해주세요.',
                              extra: {
                                allowance_reject_reason: null,
                              },
                            }),
                        },
                      ] as const;
                      const allowanceStateDisabled =
                        isReadOnly || updateStatusMutation.isPending;

                      return (
                        <>
                          <Group justify="space-between" mb="xs">
                            <Text fw={600} size="sm">수당 동의 상태</Text>
                            <Badge variant="light" color={allowanceDisplay.color} size="sm">
                              {allowanceDisplay.label}
                            </Badge>
                          </Group>
                          <DateInput
                            label="동의일(Actual)"
                            value={allowanceDateInput}
                            onChange={handleAllowanceDateChange}
                            placeholder="YYYY-MM-DD"
                            valueFormat="YYYY-MM-DD"
                            disabled={isReadOnly}
                            clearable={false}
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
                            onClick={() => updateAllowanceDateMutation.mutate()}
                            loading={updateAllowanceDateMutation.isPending}
                            disabled={isReadOnly || !allowanceDateInput}
                          >
                            수당 동의일 저장
                          </Button>
                          <Divider my="sm" />
                          <Text size="xs" fw={600} c="dimmed" mb={6}>
                            수당 동의 상태
                          </Text>
                          <Stack gap={8}>
                            <Group gap="xs" wrap="wrap">
                              {allowanceStateButtons.map((button) => (
                                <Chip
                                  key={button.key}
                                  checked={button.active}
                                  onChange={() => button.onClick()}
                                  color={button.color}
                                  variant={button.active ? 'filled' : 'light'}
                                  disabled={allowanceStateDisabled}
                                >
                                  {button.label}
                                </Chip>
                              ))}
                            </Group>
                            <Button
                              size="xs"
                              variant="light"
                              color="red"
                              onClick={() => openRejectModal({ kind: 'allowance' })}
                              disabled={allowanceStateDisabled}
                            >
                              미승인
                            </Button>
                          </Stack>
                        </>
                      );
                    })()}
                  </Box>

                  <Button fullWidth mt="md" onClick={() => updateInfoMutation.mutate()} loading={updateInfoMutation.isPending} disabled={isReadOnly || isRecommenderReasonMissing || (!isRecommenderDirty && (selectedFc.status !== 'draft' && selectedFc.status !== 'temp-id-issued' && selectedFc.status !== 'allowance-pending'))} color={isReadOnly ? "gray" : "dark"}>
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
                        // sendPushNotification handles both DB insert and push notification
                        await sendPushNotification(selectedFc.phone, {
                          title: '진행 요청',
                          body: '관리자가 진행을 요청하였습니다.',
                          data: { url: '/' },
                        });
                        notifications.show({ title: '전송 완료', message: '알림을 보냈습니다.', color: 'blue' });
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
                        제출된 서류 ({selectedFc.fc_documents?.filter((d: FCDocument) => d.storage_path && d.storage_path !== 'deleted').length || 0}건)
                      </Text>
                    </Group>
                    {selectedFc.fc_documents?.filter((d: FCDocument) => d.storage_path && d.storage_path !== 'deleted').length ? (
                      <Stack gap={8}>
                        {selectedFc.fc_documents?.filter((d: FCDocument) => d.storage_path && d.storage_path !== 'deleted').map((d: FCDocument, idx: number) => {
                          const isSubmitted = d.storage_path && d.storage_path.length > 0;
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
                                            message: '문서를 승인하시겠습니까?',
                                            confirmLabel: '승인',
                                            color: 'blue',
                                            onConfirm: async () => {
                                              const res = await updateDocStatusAction({ success: false }, {
                                                fcId: selectedFc.id,
                                                phone: selectedFc.phone,
                                                docType: d.doc_type,
                                                status: nextStatus,
                                                reason: null,
                                              });
                                              if (res.success) {
                                                notifications.show({ title: '승인', message: res.message, color: 'green' });
                                                const nextDocs = (selectedFc.fc_documents || []).map((doc: FCDocument) =>
                                                  doc.doc_type === d.doc_type ? { ...doc, status: nextStatus, reviewer_note: null } : doc
                                                );
                                                const allSubmitted =
                                                  nextDocs.length > 0 &&
                                                  nextDocs.every(
                                                    (doc: FCDocument) => doc.storage_path && doc.storage_path !== 'deleted',
                                                  );
                                                const allApproved =
                                                  allSubmitted && nextDocs.every((doc: FCDocument) => doc.status === 'approved');
                                                let nextProfileStatus = selectedFc.status;
                                                if (!DOCS_STAGE_LOCK_STATUSES.includes(selectedFc.status)) {
                                                  if (allApproved) {
                                                    nextProfileStatus = 'docs-approved';
                                                  } else if (selectedFc.status === 'docs-approved') {
                                                    nextProfileStatus = 'docs-pending';
                                                  }
                                                }
                                                updateSelectedFc({ fc_documents: nextDocs, status: nextProfileStatus });
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
                                        disabled={isReadOnly}
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
                          msg: '서류 검토가 완료되었습니다. 한화 위촉 URL 단계로 진행해주세요.',
                        });
                        return;
                      }
                      showConfirm({
                        title: '심사 완료 취소',
                        message: '심사 완료 상태를 취소하시겠습니까?',
                        confirmLabel: '취소',
                        color: 'orange',
                        onConfirm: () => {
                          updateStatusMutation.mutate({ status: 'docs-pending', msg: '' });
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
                          {hanwhaStatus?.label ?? '한화 위촉 URL 대기'}
                        </Text>
                        <Text size="xs">
                          {hanwhaDescription ?? '서류 승인이 끝나면 한화 위촉 URL 관리 단계가 열립니다.'}
                        </Text>
                      </Alert>
                    );
                  })()}

                  <Box mt="md">
                    <Group justify="space-between" mb="xs">
                      <Text fw={600} size="sm">한화 위촉 URL 검토</Text>
                      <Badge
                        variant="light"
                        color={selectedFc.hanwha_commission_date_sub ? 'green' : 'gray'}
                        size="sm"
                      >
                        {selectedFc.hanwha_commission_date_sub ? '입력됨' : '미입력'}
                      </Badge>
                    </Group>
                    <DateInput
                      label="완료일(한화 위촉 URL)"
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
                    <Divider my="sm" />
                    <Text size="xs" fw={600} c="dimmed" mb={6}>
                      한화 위촉 URL 상태
                    </Text>
                    <StatusToggle
                      value={selectedFc.status === 'hanwha-commission-approved' ? 'approved' : 'pending'}
                      onChange={(val) => {
                        if (val === 'approved') {
                          handleApproveHanwha();
                          return;
                        }
                        openRejectModal({ kind: 'hanwha' });
                      }}
                      labelPending="미승인"
                      labelApproved="승인 완료"
                      showNeutralForPending
                      allowPendingPress
                      readOnly={isReadOnly || updateStatusMutation.isPending}
                      isManagerMode={isReadOnly}
                    />
                    <Card
                      mt="sm"
                      radius="md"
                      withBorder
                      shadow="sm"
                      p={0}
                      style={{
                        overflow: 'hidden',
                        borderColor:
                          selectedFc.status === 'hanwha-commission-approved'
                            ? '#12b886'
                            : selectedFc.hanwha_commission_pdf_path
                              ? '#339af0'
                              : '#CED4DA',
                        borderWidth: 1,
                      }}
                    >
                      <Group justify="space-between" p="sm" wrap="nowrap">
                        <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                          <ThemeIcon
                            variant="light"
                            size="lg"
                            color={
                              selectedFc.status === 'hanwha-commission-approved'
                                ? 'teal'
                                : selectedFc.hanwha_commission_pdf_path
                                  ? 'blue'
                                  : 'gray'
                            }
                          >
                            {selectedFc.status === 'hanwha-commission-approved' ? (
                              <IconCheck size={20} />
                            ) : (
                              <IconFileText size={20} />
                            )}
                          </ThemeIcon>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <Text size="sm" fw={700}>
                              승인 PDF
                            </Text>
                            <Text size="xs" c="dimmed" truncate>
                              {selectedFc.hanwha_commission_pdf_name || '아직 업로드되지 않았습니다.'}
                            </Text>
                            <Badge
                              size="sm"
                              variant="dot"
                              color={
                                selectedFc.status === 'hanwha-commission-approved'
                                  ? 'teal'
                                  : selectedFc.hanwha_commission_pdf_path
                                    ? 'blue'
                                    : 'gray'
                              }
                              mt={4}
                            >
                              {selectedFc.status === 'hanwha-commission-approved'
                                ? '승인됨'
                                : selectedFc.hanwha_commission_pdf_path
                                  ? '등록됨'
                                  : '미등록'}
                            </Badge>
                          </div>
                        </Group>
                        <Group gap={4} wrap="nowrap">
                          <Button
                            variant="light"
                            color={isReadOnly ? 'gray' : 'orange'}
                            size="xs"
                            disabled={isReadOnly}
                            loading={isHanwhaPdfPending}
                            onClick={() => hanwhaPdfInputRef.current?.click()}
                          >
                            {selectedFc.hanwha_commission_pdf_path ? '교체' : '업로드'}
                          </Button>
                          {selectedFc.hanwha_commission_pdf_path ? (
                            <>
                              <Button
                                variant="default"
                                size="xs"
                                onClick={() => handleOpenDoc(selectedFc.hanwha_commission_pdf_path ?? '')}
                              >
                                열기
                              </Button>
                              <Divider orientation="vertical" />
                            </>
                          ) : null}
                          <Tooltip label="삭제">
                            <ActionIcon
                              variant="light"
                              color={isReadOnly ? 'gray' : 'red'}
                              size="input-xs"
                              disabled={isReadOnly || !selectedFc.hanwha_commission_pdf_path || isHanwhaPdfPending}
                              onClick={handleDeleteHanwhaPdf}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Group>
                    </Card>
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
                      <Text fw={600} size="sm">위촉 상태</Text>
                      <Badge variant="light" color={commissionSummaryColor} size="sm">
                        {commissionSummaryLabel}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">
                      생명/손해 위촉 완료 플래그를 독립적으로 저장할 수 있습니다.
                    </Text>
                    <Group gap="xs" wrap="wrap" mt="sm">
                      <Chip
                        checked={lifeCommissionSelected}
                        onChange={() => handleCommissionToggle('life')}
                        color="orange"
                        variant={lifeCommissionSelected ? 'filled' : 'light'}
                        disabled={isReadOnly || updateCommissionMutation.isPending}
                      >
                        생명 위촉 완료
                      </Chip>
                      <Chip
                        checked={nonlifeCommissionSelected}
                        onChange={() => handleCommissionToggle('nonlife')}
                        color="blue"
                        variant={nonlifeCommissionSelected ? 'filled' : 'light'}
                        disabled={isReadOnly || updateCommissionMutation.isPending}
                      >
                        손해 위촉 완료
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
                      위촉 상태 저장
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
                          한화 위촉 URL 승인과 PDF 등록이 완료되어야 생명/손해 위촉 관리 탭을 열 수 있습니다.
                        </Text>
                    </Alert>
                  )}
                </Stack>
              </Tabs.Panel>


            </Tabs>
          </>
        )}
      </Modal>
      <Modal
        opened={rejectOpened}
        onClose={closeReject}
        title={
          <Text fw={700}>
            {rejectTarget?.kind === 'allowance'
              ? '수당동의 반려 사유'
              : rejectTarget?.kind === 'hanwha'
                ? '한화 위촉 URL 반려 사유'
              : rejectTarget?.kind === 'appointment'
                ? '생명/손해 위촉 반려 사유'
                : '서류 반려 사유'}
          </Text>
        }
        size="md"
        padding="lg"
        radius="md"
        centered
        overlayProps={{ blur: 2 }}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            FC에게 전달될 반려 사유를 입력해주세요. 입력된 사유는 알림과 화면에 표시됩니다.
          </Text>
          <Textarea
            placeholder="예: 서류 식별이 어려워 재제출이 필요합니다."
            classNames={{ input: 'muted-placeholder-input' }}
            minRows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeReject} disabled={rejectSubmitting}>
              취소
            </Button>
            <Button color="red" onClick={handleRejectSubmit} loading={rejectSubmitting}>
              반려 처리
            </Button>
          </Group>
        </Stack>
      </Modal>

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
