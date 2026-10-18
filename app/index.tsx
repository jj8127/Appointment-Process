import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Redirect, Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  Dimensions,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View
} from 'react-native';
import Animated, { runOnUI, scrollTo as reanimatedScrollTo, useAnimatedRef } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TourGuideZone, useTourGuideController } from 'rn-tourguide';

import BrandedLoadingSpinner from '@/components/BrandedLoadingSpinner';
import ServiceHub from '@/components/ServiceHub';
import { QueryReadState } from '@/components/QueryReadState';
import BrandedLoadingState from '@/components/BrandedLoadingState';
import { AppTopActionBar } from '@/components/AppTopActionBar';
import { BottomNavigation } from '@/components/BottomNavigation';
import { Skeleton } from '@/components/LoadingSkeleton';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { resolveExamHomeSurface } from '@/lib/exam-role';
import { buildExamPhoneCandidates, normalizeExamSingle } from '@/lib/exam-display';
import {
  fetchGaraminDirectMessages,
  resolveGaraminDirectConversation,
} from '@/lib/direct-message-api';
import {
  calcAdminWorkflowStep,
  calcFcHomeWorkflowStep,
  canOpenFcProfileRegistration,
  getFcHomeNextAction,
  getFcHomeQuickLinkDescriptions,
} from '@/lib/fc-workflow';
import { FcHomeExamRounds } from '@/components/fc-home/FcHomeExamRounds';
import { FcHomeMessages } from '@/components/fc-home/FcHomeMessages';
import { FcHomeNews } from '@/components/fc-home/FcHomeNews';
import { FcHomeProgressCard } from '@/components/fc-home/FcHomeProgressCard';
import { FcHomeSectionBoundary } from '@/components/fc-home/FcHomeSectionBoundary';
import { FcHomeShortcuts } from '@/components/fc-home/FcHomeShortcuts';
import { isFcStatus } from '@/lib/fc-status';
import { useAppLogout } from '@/hooks/use-app-logout';
import { useMyReferralCode } from '@/hooks/use-my-referral-code';
import { useIdentityStatus } from '@/hooks/use-identity-status';
import { useReadSessionScope } from '@/hooks/use-read-session-scope';
import { useSession } from '@/hooks/use-session';
import { invokeFcNotify } from '@/lib/fc-notify-client';
import { fetchInternalUnreadCount } from '@/lib/internal-chat-api';
import {
  parseLatestNoticePayload,
  type LatestNoticeSummary,
} from '@/lib/inbox-list-contract';
import { formatLicenseStatuses, LICENSE_STATUS_LABELS, LICENSE_STATUS_NONE, normalizeLicenseStatuses } from '@/lib/license-statuses';
import { buildBoardActor } from '@/lib/board-api';
import { formatHomeRelativeTime } from '@/lib/fc-home-sections';
import { buildReferralShareText } from '@/lib/referral-share';
import { logger } from '@/lib/logger';
import { formatHomeCount } from '@/lib/home-read-state';
import { formatLatestNoticeLabel } from '@/lib/home-latest-notice';
import { createHomeRealtimeChannelTopic } from '@/lib/home-realtime-channel';
import { fetchMobileUnreadNotificationCountOrThrow } from '@/lib/mobile-unread-notification-count';
import { resolveNotificationInboxResidentId } from '@/lib/notification-inbox-scope';
import { resolveHomeLatestNoticeRoute } from '@/lib/notice-route';
import { openExternalUrl } from '@/lib/open-external-url';
import { NotificationReceiptStatusBanner } from '@/lib/notification-receipt-ui';
import { supabase } from '@/lib/supabase';
import {
  chunkSupabaseFilterValues,
  collectSupabaseRows,
  requireSupabaseRowMatching,
} from '@/lib/supabase-query-contract';
import { syncNativeNotificationBadge } from '@/lib/system-notification-badge';
import { useNotificationReceiptCompletion } from '@/lib/use-notification-receipt';
import { buildWelcomeTitle } from '@/lib/welcome-title';
import { hasInsuranceHomeContext } from '@/lib/service-home';
import { waitForNotificationNavigationDecision } from '@/lib/notification-navigation-coordinator';
import type { FcProfile } from '@/types/fc';

const YOUTUBE_URL = 'https://youtube.com/playlist?list=PLF5rd5c2rE9xy-VsAdwq4NEUsJQtKD7Qd&si=vKx4TDq6ww9ZgKiT';

const SHORTCUT_TOUR_TEXTS: Record<string, string> = {
  '/exam-apply': '생명/제3보험 시험 일정을 확인하고 접수할 수 있어요.',
  '/exam-apply2': '손해보험 시험 접수 메뉴예요.',
  '/fc/new': '이름, 소속, 주소 등 기본 정보를 관리해요.',
  '/signup': '사전등록 정보를 먼저 완료해요.',
  '/consent': '보증 보험 동의 상태를 확인해요.',
  '/docs-upload': '필수 서류를 업로드하고 상태를 확인해요.',
  '/hanwha-commission': '다위촉 URL 진행 단계예요.',
  '/appointment': '생명/손해 위촉 진행 단계예요.',
};

// Android Crash Fix: Strips Moti props on Android to prevent Reanimated from attaching to unmounting views
const AndroidSafeMotiView = ({ from, animate, transition, state, exit, exitTransition, delay, ...props }: any) => {
  if (Platform.OS === 'android') {
    return <View {...props} />;
  }
  return (
    <MotiView
      from={from}
      animate={animate}
      transition={transition}
      state={state}
      exit={exit}
      exitTransition={exitTransition}
      delay={delay}
      {...props}
    />
  );
};
// ... rest of imports/constants ...




const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const ORANGE_FAINT = '#fff1e6';
type StepKey = 'step0' | 'step1' | 'step2' | 'step3' | 'step4' | 'step5';
type StepCounts = Record<StepKey, number>;
type CountsResult = { total: number; steps: StepCounts };
const EMPTY_STEP_COUNTS: StepCounts = { step0: 0, step1: 0, step2: 0, step3: 0, step4: 0, step5: 0 };

type WorkflowCountRow = {
  id: string;
  name: string;
  affiliation: string;
  resident_id_masked: string | null;
  email: string | null;
  address: string | null;
  identity_completed: boolean | null;
  license_statuses: FcProfile['license_statuses'];
  allowance_date: string | null;
  allowance_prescreen_requested_at: string | null;
  allowance_reject_reason: string | null;
  status: FcProfile['status'];
  hanwha_commission_date: string | null;
  hanwha_commission_pdf_path: string | null;
  hanwha_commission_pdf_name: string | null;
  appointment_date_life: string | null;
  appointment_date_nonlife: string | null;
  appointment_date_life_sub: string | null;
  appointment_date_nonlife_sub: string | null;
  life_commission_completed: boolean | null;
  nonlife_commission_completed: boolean | null;
  fc_documents: {
    doc_type: string;
    storage_path: string | null;
    status: string | null;
  }[];
};

type FcStatusRow = Omit<FcProfile, 'created_at'>;

type ExamStatsRound = { exam_type: 'life' | 'nonlife' };
type ExamStatsRegistrationRow = {
  id: string;
  resident_id: string;
  is_confirmed: boolean | null;
  status: string;
  created_at: string;
  exam_rounds: ExamStatsRound | ExamStatsRound[];
};
type ExamStatsProfileRow = { id: string; phone: string };

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isNullableString = (value: unknown): value is string | null => (
  value === null || typeof value === 'string'
);

const isNullableBoolean = (value: unknown): value is boolean | null => (
  value === null || typeof value === 'boolean'
);

const LICENSE_STATUS_VALUES = new Set<string>(['third', 'life', 'nonlife', 'none']);

const isWorkflowDocument = (value: unknown): value is WorkflowCountRow['fc_documents'][number] => (
  isRecord(value)
  && typeof value.doc_type === 'string'
  && isNullableString(value.storage_path)
  && isNullableString(value.status)
);

const isWorkflowCountRow = (value: unknown): value is WorkflowCountRow => (
  isRecord(value)
  && typeof value.id === 'string'
  && typeof value.name === 'string'
  && typeof value.affiliation === 'string'
  && isNullableString(value.resident_id_masked)
  && isNullableString(value.email)
  && isNullableString(value.address)
  && isNullableBoolean(value.identity_completed)
  && (value.license_statuses === null
    || (Array.isArray(value.license_statuses)
      && value.license_statuses.every((item) => typeof item === 'string' && LICENSE_STATUS_VALUES.has(item))))
  && isNullableString(value.allowance_date)
  && isNullableString(value.allowance_prescreen_requested_at)
  && isNullableString(value.allowance_reject_reason)
  && isFcStatus(value.status)
  && isNullableString(value.hanwha_commission_date)
  && isNullableString(value.hanwha_commission_pdf_path)
  && isNullableString(value.hanwha_commission_pdf_name)
  && isNullableString(value.appointment_date_life)
  && isNullableString(value.appointment_date_nonlife)
  && isNullableString(value.appointment_date_life_sub)
  && isNullableString(value.appointment_date_nonlife_sub)
  && isNullableBoolean(value.life_commission_completed)
  && isNullableBoolean(value.nonlife_commission_completed)
  && Array.isArray(value.fc_documents)
  && value.fc_documents.every(isWorkflowDocument)
);

const isFcStatusRow = (value: unknown): value is FcStatusRow => {
  if (!isWorkflowCountRow(value)) return false;
  const row = value as WorkflowCountRow & Record<string, unknown>;
  return typeof row.phone === 'string'
    && isNullableString(row.temp_id)
    && isNullableString(row.hanwha_commission_date_sub)
    && isNullableString(row.hanwha_commission_reject_reason)
    && isNullableString(row.appointment_url)
    && isNullableString(row.appointment_date)
    && isNullableString(row.appointment_schedule_life)
    && isNullableString(row.appointment_schedule_nonlife)
    && isNullableBoolean(row.is_tour_seen)
    && isNullableBoolean(row.signup_completed);
};

const isExamStatsRound = (value: unknown): value is ExamStatsRound => (
  isRecord(value) && (value.exam_type === 'life' || value.exam_type === 'nonlife')
);

const isExamStatsRegistrationRow = (value: unknown): value is ExamStatsRegistrationRow => (
  isRecord(value)
  && typeof value.id === 'string'
  && typeof value.resident_id === 'string'
  && isNullableBoolean(value.is_confirmed)
  && typeof value.status === 'string'
  && typeof value.created_at === 'string'
  && (isExamStatsRound(value.exam_rounds)
    || (Array.isArray(value.exam_rounds)
      && value.exam_rounds.length === 1
      && isExamStatsRound(value.exam_rounds[0])))
);

const isExamStatsProfileRow = (value: unknown): value is ExamStatsProfileRow => (
  isRecord(value) && typeof value.id === 'string' && typeof value.phone === 'string'
);
const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.04,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

type QuickLink = { href: string; title: string; description: string; stepKey?: StepKey };

const quickLinksAdminOnboarding: QuickLink[] = [
  { href: '/dashboard', stepKey: 'step1', title: '보증 보험 동의 안내', description: '보증 보험 동의 검토 대상 FC' },
  { href: '/dashboard', stepKey: 'step2', title: '서류 안내/검토', description: '제출해야 할 서류 관리' },
  { href: '/dashboard', stepKey: 'step3', title: '다위촉 URL', description: '다위촉 서류 발송 알림 관리' },
  { href: '/dashboard', stepKey: 'step4', title: '생명/손해 위촉', description: '생명/손해 위촉 진행 확인' },
  { href: '/dashboard', stepKey: 'step5', title: '완료 관리', description: '최종 완료 현황' },
  { href: '/admin-board', title: '게시판 작성', description: '정보 게시판 글쓰기' },
  { href: '/messenger', title: '메신저', description: '가람지사/설계요청 대화 이동' },
];

const quickLinksAdminExam: QuickLink[] = [
  { href: '/exams/life', title: '생명보험/제3보험 시험', description: '응시일정 · 마감 관리' },
  { href: '/exams/nonlife', title: '손해보험 시험', description: '응시일정 · 마감 관리' },
  { href: '/exam-manage', title: '생명/제3 신청자', description: '신청 현황 조회' },
  { href: '/exam-manage2', title: '손해 신청자', description: '신청 현황 조회' },
  { href: '/exam-apply', title: '생명/제3 대리 신청', description: 'FC를 선택해 시험 접수' },
  { href: '/exam-apply2', title: '손해 대리 신청', description: 'FC를 선택해 시험 접수' },
];

const quickLinksFcBase: QuickLink[] = [
  { href: '/exam-apply', title: '생명/제3 시험 신청', description: '시험 접수하기' },
  { href: '/exam-apply2', title: '손해 시험 신청', description: '시험 접수하기' },
  { href: '/fc/new', title: '기본 정보', description: '인적사항 수정' },
  { href: '/consent', title: '보증 보험 동의', description: '약관 동의 관리' },
  { href: '/docs-upload', title: '서류 업로드', description: '필수 서류 제출' },
  { href: '/messenger', title: '메신저', description: '총무/설계매니저와 대화' },
];

const quickLinksManagerExam: QuickLink[] = [
  ...quickLinksAdminExam,
];

const allowanceLink: QuickLink = {
  href: '/referral-allowance',
  title: '수당 그래프',
  description: '나의 수당과 기여 흐름 확인',
};

const fcHomeSteps = [
  { key: 'consent', label: '보증 보험 동의', fullLabel: '보증 보험 동의' },
  { key: 'docs', label: '문서제출', fullLabel: '문서제출' },
  { key: 'hanwha', label: '다위촉 URL', fullLabel: '다위촉 URL' },
  { key: 'url', label: '생명/손해 위촉', fullLabel: '생명/손해 위촉' },
  { key: 'final', label: '완료', fullLabel: '완료' },
];

const FC_STAGE_YOUTUBE_PLACEHOLDERS: Record<
  'consent' | 'docs' | 'hanwha' | 'url' | 'final',
  { url: string | null; pendingMessage: string }
> = {
  consent: { url: null, pendingMessage: '보증 보험 동의 영상은 준비 중입니다.' },
  docs: { url: null, pendingMessage: '문서제출 영상은 준비 중입니다.' },
  hanwha: { url: null, pendingMessage: '다위촉 URL 영상은 준비 중입니다.' },
  url: { url: null, pendingMessage: '생명/손해 위촉 영상은 준비 중입니다.' },
  final: { url: null, pendingMessage: '완료 단계 영상은 준비 중입니다.' },
};

const buildFcQuickLinks = (profile?: FcProfile | null): QuickLink[] => {
  const workflowDescriptions = getFcHomeQuickLinkDescriptions(profile);
  const hanwhaLink: QuickLink = {
    href: '/hanwha-commission',
    title: '다위촉 URL',
    description: workflowDescriptions.hanwha,
  };
  const insuranceLink: QuickLink = {
    href: '/appointment',
    title: '생명/손해 위촉',
    description: workflowDescriptions.insurance,
  };

  const referralLink: QuickLink = {
    href: '/referral',
    title: '추천인 코드',
    description: '친구 초대 및 현황 확인',
  };
  const workflowLinks = canOpenFcProfileRegistration(profile)
    ? quickLinksFcBase.slice(0, 5)
    : [
        quickLinksFcBase[0],
        quickLinksFcBase[1],
        { href: '/signup', title: '사전등록', description: '회원가입 정보를 먼저 완료' },
        quickLinksFcBase[3],
        quickLinksFcBase[4],
      ];

  return [...workflowLinks, hanwhaLink, insuranceLink, quickLinksFcBase[5], referralLink, allowanceLink];
};

const fetchCounts = async (role: 'admin' | 'fc' | null, residentId: string): Promise<CountsResult> => {
  if (role !== 'admin') {
    return { total: 0, steps: { ...EMPTY_STEP_COUNTS } };
  }

  const profiles = await collectSupabaseRows<WorkflowCountRow>({
    queryName: 'mobile_home_fc_counts',
    fetchPage: (from, to) => supabase
      .from('fc_profiles')
      .select('id,name,affiliation,resident_id_masked,email,address,identity_completed,license_statuses,allowance_date,allowance_prescreen_requested_at,allowance_reject_reason,status,hanwha_commission_date,hanwha_commission_pdf_path,hanwha_commission_pdf_name,appointment_date_life,appointment_date_nonlife,appointment_date_life_sub,appointment_date_nonlife_sub,life_commission_completed,nonlife_commission_completed,fc_documents(doc_type,storage_path,status)')
      .order('id', { ascending: true })
      .range(from, to),
    isRow: isWorkflowCountRow,
    rowKey: (row) => row.id,
  });

  const steps: StepCounts = { ...EMPTY_STEP_COUNTS };
  profiles.forEach((profile) => {
    const key = getStepKey(profile);
    steps[key] += 1;
  });

  return {
    total: profiles.length,
    steps,
  };
};

const ADMIN_METRIC_CONFIG: { label: string; key: StepKey }[] = [
  { label: '1단계 보증 보험 동의', key: 'step1' },
  { label: '2단계 문서제출', key: 'step2' },
  { label: '3단계 다위촉 URL', key: 'step3' },
  { label: '4단계 생명/손해 위촉', key: 'step4' },
  { label: '5단계 완료', key: 'step5' },
];

const fetchLatestNotice = async (): Promise<LatestNoticeSummary | null> => {
  const { data, error } = await invokeFcNotify<unknown>({ type: 'latest_notice' });
  if (error) throw error;
  return parseLatestNoticePayload(data).notice;
};

const fetchLatestAdminMessage = async (residentId: string) => {
  if (!residentId) throw new Error('메시지를 조회할 로그인 정보가 없습니다.');
  const conversation = await resolveGaraminDirectConversation({ targetId: null });
  const result = await fetchGaraminDirectMessages(conversation.id);
  const latestIncoming = [...result.messages]
    .reverse()
    .find((message) => message.receiver_id === residentId);
  return latestIncoming ?? null;
};

const fetchFcStatus = async (residentId: string) => {
  const { data, error } = await supabase
    .from('fc_profiles')
    .select(
      'id,name,affiliation,phone,status,temp_id,license_statuses,allowance_date,allowance_prescreen_requested_at,allowance_reject_reason,hanwha_commission_date_sub,hanwha_commission_date,hanwha_commission_reject_reason,hanwha_commission_pdf_path,hanwha_commission_pdf_name,appointment_url,appointment_date,appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life,appointment_date_nonlife,appointment_date_life_sub,appointment_date_nonlife_sub,life_commission_completed,nonlife_commission_completed,resident_id_masked,email,address,identity_completed,is_tour_seen,signup_completed,fc_documents(doc_type,storage_path,status)',
    )
    .eq('phone', residentId)
    .maybeSingle();
  if (error) throw error;
  return requireSupabaseRowMatching(data, 'mobile_home_fc_status', isFcStatusRow);
};

type ExamStats = {
  lifeTotal: number;
  lifePending: number;
  nonlifeTotal: number;
  nonlifePending: number;
};

const fetchExamStats = async (): Promise<ExamStats> => {
  const countByType = async (examType: 'life' | 'nonlife') => {
    const isRelationshipError = (error: unknown): boolean => {
      if (!error || typeof error !== 'object') {
        return false;
      }
      const message = `${(error as { message?: string }).message ?? ''}`.toLowerCase();
      return message.includes('pgrst201') || message.includes('could not embed');
    };

    const relationNames = [
      'exam_registrations_round_exam_type_fkey',
      'exam_registrations_round_id_fkey',
      '',
    ] as const;

    for (const relationName of relationNames) {
      const relation = relationName
        ? `exam_rounds!${relationName}(exam_type)`
        : 'exam_rounds!inner(exam_type)';
      try {
        const allRows = await collectSupabaseRows<ExamStatsRegistrationRow>({
          queryName: `mobile_home_exam_registrations_${examType}_${relationName || 'inner'}`,
          fetchPage: (from, to) => supabase
            .from('exam_registrations')
            .select(`id, resident_id, is_confirmed, status, created_at, ${relation}`)
            .order('resident_id', { ascending: true })
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
          isRow: isExamStatsRegistrationRow,
          rowKey: (row) => row.id,
        });
        const rows = allRows.filter(
          (row) => normalizeExamSingle(row.exam_rounds)?.exam_type === examType,
        );
        const residentIds = Array.from(
          new Set(rows.map((row) => row.resident_id).filter(Boolean)),
        );
        const profileIdByPhoneCandidate = new Map<string, string>();
        if (residentIds.length > 0) {
          const profileLookupCandidates = Array.from(
            new Set(residentIds.flatMap((residentId) => buildExamPhoneCandidates(residentId))),
          );
          const profilePages = await Promise.all(
            chunkSupabaseFilterValues(profileLookupCandidates).map((phoneBatch, batchIndex) => (
              collectSupabaseRows<ExamStatsProfileRow>({
                queryName: `mobile_home_exam_profiles_${examType}_${batchIndex}`,
                fetchPage: (from, to) => supabase
                  .from('fc_profiles')
                  .select('id,phone')
                  .in('phone', phoneBatch)
                  .order('id', { ascending: true })
                  .range(from, to),
                isRow: isExamStatsProfileRow,
                rowKey: (row) => row.id,
              })
            )),
          );
          profilePages.flat().forEach((profile) => {
            buildExamPhoneCandidates(profile.phone).forEach((candidate) => {
              profileIdByPhoneCandidate.set(candidate, profile.id);
            });
          });
        }

        const latestByProfile = new Map<string, { confirmed: boolean; status: string }>();
        rows.forEach((row) => {
          const profileId = buildExamPhoneCandidates(row.resident_id)
            .map((candidate) => profileIdByPhoneCandidate.get(candidate))
            .find((candidate): candidate is string => Boolean(candidate));
          if (!profileId) return;
          latestByProfile.set(profileId, { confirmed: Boolean(row.is_confirmed), status: String(row.status ?? 'applied') });
        });

        const total = latestByProfile.size;
        const pending = Array.from(latestByProfile.values()).filter((v) => !v.confirmed && !['cancelled', 'rejected'].includes(v.status)).length;
        return { total, pending };
      } catch (error) {
        if (!isRelationshipError(error)) {
          throw error;
        }
      }
    }

    throw new Error('Unable to load exam registrations.');

  };

  const [life, nonlife] = await Promise.all([countByType('life'), countByType('nonlife')]);
  return {
    lifeTotal: life.total,
    lifePending: life.pending,
    nonlifeTotal: nonlife.total,
    nonlifePending: nonlife.pending,
  };
};

function calcStep(myFc: Parameters<typeof calcAdminWorkflowStep>[0]) {
  if (!myFc) return 0;
  return calcAdminWorkflowStep(myFc);
}

const getStepKey = (profile: NonNullable<Parameters<typeof calcAdminWorkflowStep>[0]>): StepKey => {
  const step = Math.max(0, Math.min(5, calcStep(profile)));
  return `step${step}` as StepKey;
};

const getLinkIcon = (href: string) => {
  // 관리자 메뉴
  if (href.includes('status=step0')) return 'user-plus'; // 사전등록
  if (href.includes('status=step1')) return 'user-plus'; // 회원가입 관리
  if (href.includes('status=step2')) return 'check-square'; // 서류 안내/검토
  if (href.includes('status=step3')) return 'file-text'; // 다위촉 URL
  if (href.includes('status=step4')) return 'link'; // 생명/손해 위촉
  if (href.includes('status=step5')) return 'award'; // 완료 관리

  if (href.includes('/exams/')) return 'calendar'; // 시험 일정 등록
  if (href.includes('exam-manage')) return 'users'; // 신청자 관리
  if (href.includes('admin-appointment')) return 'send'; // URL 발송
  if (href.includes('admin-board')) return 'edit'; // 게시판 작성
  if (href.includes('admin-notice')) return 'bell'; // 공지 등록

  // FC 메뉴
  if (href.includes('fc/new')) return 'user'; // 기본 정보
  if (href.includes('exam-apply')) return 'edit-3'; // 시험 신청
  if (href.includes('consent')) return 'check-circle'; // 보증 보험 동의
  if (href.includes('docs-upload')) return 'upload-cloud'; // 서류 업로드
  if (href.includes('hanwha-commission')) return 'file-text'; // 다위촉 URL
  if (href.includes('appointment')) return 'smartphone'; // 위촉
  if (href.includes('messenger')) return 'message-circle'; // 메신저
  if (href.includes('chat')) return 'message-circle'; // 1:1 문의
  if (href.includes('referral-allowance')) return 'bar-chart-2'; // 수당 그래프
  if (href.includes('referral')) return 'gift'; // 추천인 코드

  return 'chevron-right';
};

export default function Home() {
  const params = useLocalSearchParams();
  const { hydrated, role, isRequestBoardDesigner } = useSession();
  if (!hydrated) return <BrandedLoadingState />;
  if (!hasInsuranceHomeContext(params) && role && isRequestBoardDesigner) return <DesignerHomeLanding />;
  if (!hasInsuranceHomeContext(params)) return <ServiceHub />;
  if (!role) return <Redirect href="/login?skipAuto=1" />;
  return <LegacyInsuranceHome />;
}

function DesignerHomeLanding() {
  useFocusEffect(useCallback(() => {
    let active = true;
    void waitForNotificationNavigationDecision().then((handled) => {
      if (active && !handled) router.replace('/request-board');
    });
    return () => { active = false; };
  }, []));
  return <BrandedLoadingState />;
}

function LegacyInsuranceHome() {
  const { role, residentId, displayName, hydrated, isRequestBoardDesigner, requestBoardRole, readOnly, staffType } = useSession();
  const appLogout = useAppLogout();
  const { mode, notificationId, notificationTarget } = useLocalSearchParams<{
    mode?: string;
    notificationId?: string;
    notificationTarget?: string;
  }>();
  const { data: identityStatus, isLoading: identityLoading } = useIdentityStatus();

  const insets = useSafeAreaInsets();

  const [adminHomeTab, setAdminHomeTab] = useState<'onboarding' | 'exam'>('onboarding');
  const sessionScope = useReadSessionScope();
  const [refreshing, setRefreshing] = useState(false);

  const examHomeSurface = resolveExamHomeSurface({ role, readOnly, adminHomeTab });
  const isAdminExam = examHomeSurface === 'admin-management';
  const isManagerExam = examHomeSurface === 'manager-management';
  const showsExamManagementHome = isAdminExam || isManagerExam;
  const bottomNavPreset = resolveBottomNavPreset(
    { role, readOnly, hydrated, isRequestBoardDesigner },
    { adminHomeTab },
  );
  const isAdminLikePreset =
    bottomNavPreset === 'admin-onboarding' ||
    bottomNavPreset === 'admin-exam' ||
    bottomNavPreset === 'manager';
  const canUseReferralSelfService =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));
  const bottomNavActiveKey = resolveBottomNavActiveKey(
    bottomNavPreset,
    isAdminLikePreset ? adminHomeTab : 'home',
  );



  const {
    data: myFc,
    isLoading: statusLoading,
    isError: statusError,
    refetch: refetchMyFc,
  } = useQuery({
    queryKey: ['my-fc-status', residentId],
    queryFn: () => (residentId ? fetchFcStatus(residentId) : Promise.resolve(null)),
    enabled: role === 'fc' && !!residentId,
  });
  const notificationReceipt = useNotificationReceiptCompletion({
    params: { notificationId, notificationTarget },
    expectedTarget: myFc?.id
      ? {
          version: 1,
          kind: 'onboarding_section',
          fcId: myFc.id,
          section: 'home',
        }
      : null,
    loadState: statusError
      ? 'error'
      : myFc?.id
        ? 'success'
        : statusLoading
          ? 'loading'
          : 'error',
  });

  // FC 전용 코치마크
  const { canStart, start, stop: stopMainTour, eventEmitter } = useTourGuideController();
  const {
    start: startShortcutTour,
    stop: stopShortcutTour,
    canStart: canStartShortcutTour,
    eventEmitter: shortcutEventEmitter,
    TourGuideZone: ShortcutTourGuideZone,
  } = useTourGuideController('shortcut');
  const isFc = role === 'fc';

  const [mainTourBlocking, setMainTourBlocking] = useState(false);
  const [shortcutTourBlocking, setShortcutTourBlocking] = useState(false);
  const isTourBlocking = mainTourBlocking || shortcutTourBlocking;

  useEffect(() => {
    if (!hydrated) return;
    if (role !== 'fc') return;
    if (isRequestBoardDesigner) return;
    if (identityLoading) return;
    if (identityStatus && !identityStatus.identityCompleted) {
      router.replace('/home-lite');
    }
  }, [hydrated, identityLoading, identityStatus, isRequestBoardDesigner, role]);

  useEffect(() => {
    if (!eventEmitter) return;

    const onStart = () => setMainTourBlocking(true);
    const onStop = () => setMainTourBlocking(false);

    // 투어 시작/종료 계열 이벤트로 blocking 토글
    eventEmitter.on('start', onStart);
    eventEmitter.on('stop', onStop);
    eventEmitter.on('finish', onStop);

    return () => {
      eventEmitter.off('start', onStart);
      eventEmitter.off('stop', onStop);
      eventEmitter.off('finish', onStop);
    };
  }, [eventEmitter]);

  useEffect(() => {
    if (!shortcutEventEmitter) return;

    const onStart = () => setShortcutTourBlocking(true);
    const onStop = () => setShortcutTourBlocking(false);

    shortcutEventEmitter.on('start', onStart);
    shortcutEventEmitter.on('stop', onStop);
    shortcutEventEmitter.on('finish', onStop);

    return () => {
      shortcutEventEmitter.off('start', onStart);
      shortcutEventEmitter.off('stop', onStop);
      shortcutEventEmitter.off('finish', onStop);
    };
  }, [shortcutEventEmitter]);

  // Auto-scroll refs & cached positions
  const scrollViewRef = useAnimatedRef<Animated.ScrollView>();
  const contentRef = useRef<View>(null);
  const zone1Ref = useRef<View>(null);
  const zone2Ref = useRef<View>(null);
  const zone3Ref = useRef<View>(null);
  const zone4Ref = useRef<View>(null);
  const zoneScrollTargets = useRef<Record<number, number>>({});
  const shortcutZoneRefs = useRef<(View | null)[]>([]);
  const shortcutScrollTargets = useRef<Record<number, number>>({});

  // 투어 시작 시 zone 위치를 미리 캐시 (스크롤 전 측정)
  const cacheZonePositions = useCallback(() => {
    const contentNode = contentRef.current;
    if (!contentNode) return;
    const refs = [
      { zone: 2, ref: zone2Ref },
      { zone: 3, ref: zone3Ref },
      { zone: 4, ref: zone4Ref },
    ];
    const viewportHeight = Dimensions.get('window').height - insets.top - insets.bottom;
    for (const { zone, ref } of refs) {
      if (!ref.current) continue;
      ref.current.measureLayout(
        contentNode,
        (_x, y, _w, h) => {
          // 요소가 뷰포트 상단 40% 지점에 오도록 스크롤 타겟 설정
          const targetY = Math.max(0, y - viewportHeight * 0.35);
          zoneScrollTargets.current[zone] = targetY;
          logger.debug(`[cacheZonePos] zone ${zone}: y=${y}, h=${h}, targetY=${targetY}`);
        },
        () => { },
      );
    }
  }, [insets.top, insets.bottom]);

  const cacheShortcutZonePositions = useCallback(() => {
    const contentNode = contentRef.current;
    if (!contentNode) return;
    const viewportHeight = Dimensions.get('window').height - insets.top - insets.bottom;

    shortcutZoneRefs.current.forEach((targetRef, index) => {
      if (!targetRef) return;
      const zone = index + 1;
      targetRef.measureLayout(
        contentNode,
        (_x, y) => {
          const targetY = Math.max(0, y - viewportHeight * 0.25);
          shortcutScrollTargets.current[zone] = targetY;
          logger.debug(`[cacheShortcutPos] zone ${zone}: y=${y}, targetY=${targetY}`);
        },
        () => { },
      );
    });
  }, [insets.top, insets.bottom]);

  // 투어가 시작되면 zone 위치 캐시
  useEffect(() => {
    if (mainTourBlocking) {
      // 레이아웃 안정 후 측정
      requestAnimationFrame(() => cacheZonePositions());
    }
  }, [mainTourBlocking, cacheZonePositions]);

  useEffect(() => {
    if (shortcutTourBlocking) {
      requestAnimationFrame(() => cacheShortcutZonePositions());
    }
  }, [shortcutTourBlocking, cacheShortcutZonePositions]);

  useEffect(() => {
    const handleStepChange = (step: any) => {
      const z = step?.order;
      logger.debug('[tour stepChange]', { z, name: step?.name, order: step?.order });

      if (role !== 'fc') return;
      if (typeof z !== 'number') return;

      // runOnUI로 UI 스레드에서 동기적으로 스크롤
      // → 라이브러리의 measure()가 실행될 때 이미 스크롤 완료
      if (z === 1) {
        runOnUI(() => {
          'worklet';
          reanimatedScrollTo(scrollViewRef, 0, 0, false);
        })();
      } else if (z >= 2 && z <= 4) {
        const targetY = zoneScrollTargets.current[z];
        if (targetY != null) {
          logger.debug(`[tour scroll] zone ${z} → targetY=${targetY}`);
          runOnUI((y: number) => {
            'worklet';
            reanimatedScrollTo(scrollViewRef, 0, y, false);
          })(targetY);
        }
      }
    };

    if (eventEmitter) {
      eventEmitter.on('stepChange', handleStepChange);
    }
    return () => {
      if (eventEmitter) {
        eventEmitter.off('stepChange', handleStepChange);
      }
    };
  }, [eventEmitter, role, scrollViewRef]);

  useEffect(() => {
    const handleShortcutStepChange = (step: any) => {
      const z = step?.order;
      logger.debug('[shortcut stepChange]', { z, name: step?.name, order: step?.order });

      if (role !== 'fc') return;
      if (typeof z !== 'number') return;

      const targetY = shortcutScrollTargets.current[z];
      if (targetY == null) return;

      logger.debug(`[shortcut scroll] zone ${z} → targetY=${targetY}`);
      runOnUI((y: number) => {
        'worklet';
        reanimatedScrollTo(scrollViewRef, 0, y, false);
      })(targetY);
    };

    if (shortcutEventEmitter) {
      shortcutEventEmitter.on('stepChange', handleShortcutStepChange);
    }
    return () => {
      if (shortcutEventEmitter) {
        shortcutEventEmitter.off('stepChange', handleShortcutStepChange);
      }
    };
  }, [shortcutEventEmitter, role, scrollViewRef]);


  const openHomeYoutube = useCallback(async () => {
    try {
      await openExternalUrl(YOUTUBE_URL);
    } catch {
      Alert.alert('오류', '가이드를 열 수 없습니다.');
    }
  }, []);

  const startFcTour = useCallback(() => {
    if (!isFc) return;

    Haptics.selectionAsync();
    stopShortcutTour();
    cacheZonePositions();
    start(1);

    // canStart가 늦게 true가 되는 기기에서 시작 누락 방지
    if (!canStart) {
      setTimeout(() => start(1), 140);
      setTimeout(() => start(1), 320);
      setTimeout(() => start(1), 520);
    }
  }, [isFc, canStart, cacheZonePositions, start, stopShortcutTour]);

  const startShortcutGuide = useCallback(() => {
    if (!isFc) return;

    Haptics.selectionAsync();
    stopMainTour();
    cacheShortcutZonePositions();
    startShortcutTour(1);
    if (!canStartShortcutTour) {
      setTimeout(() => startShortcutTour(1), 140);
      setTimeout(() => startShortcutTour(1), 320);
      setTimeout(() => startShortcutTour(1), 520);
    }
  }, [isFc, canStartShortcutTour, cacheShortcutZonePositions, startShortcutTour, stopMainTour]);

  const openHowToOptions = useCallback(() => {
    Haptics.selectionAsync();
    Alert.alert('사용법', undefined, [
      { text: '홈 화면 안내', onPress: startFcTour },
      { text: '바로가기 안내', onPress: startShortcutGuide },
      { text: '영상 가이드', onPress: () => void openHomeYoutube() },
      { text: '취소', style: 'cancel' },
    ]);
  }, [openHomeYoutube, startFcTour, startShortcutGuide]);







  useEffect(() => {
    if (role !== 'admin') {
      setAdminHomeTab('onboarding');
    }
  }, [role]);

  useEffect(() => {
    if (role !== 'admin') return;
    if (mode === 'exam') {
      setAdminHomeTab('exam');
      return;
    }
    setAdminHomeTab('onboarding');
  }, [mode, role]);

  const {
    data: counts,
    isLoading,
    isError: countsError,
    error: countsReadError,
    isFetching: countsFetching,
    refetch: refetchCounts,
  } = useQuery({
    queryKey: ['fc-counts', role, residentId, sessionScope],
    queryFn: () => fetchCounts(role, residentId),
    enabled: !!role,
  });



  const {
    data: latestNotice,
    isLoading: latestNoticeLoading,
    isError: latestNoticeError,
    error: latestNoticeReadError,
    isFetching: latestNoticeFetching,
    refetch: refetchLatestNotice,
  } = useQuery({
    queryKey: ['latest-notice', sessionScope],
    queryFn: fetchLatestNotice,
    enabled: hydrated && !!role,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });

  const {
    data: examStats,
    isLoading: examStatsLoading,
    isError: examStatsError,
    error: examStatsReadError,
    isFetching: examStatsFetching,
    refetch: refetchExamStats,
  } = useQuery({
    queryKey: ['exam-stats', sessionScope],
    queryFn: fetchExamStats,
    enabled: showsExamManagementHome,
  });
  const {
    data: latestAdminMsg,
    isLoading: latestAdminMsgLoading,
    isError: latestAdminMsgError,
    refetch: refetchLatestAdminMsg,
  } = useQuery({
    queryKey: ['latest-admin-msg', residentId, sessionScope],
    queryFn: () => fetchLatestAdminMessage(residentId),
    enabled: role === 'fc' && !!residentId,
  });

  const currentStep = myFc ? calcFcHomeWorkflowStep(myFc as FcProfile) : 1;
  const nextAction = getFcHomeNextAction(myFc as FcProfile | null | undefined);
  const nextActionRoute =
    nextAction.route ??
    (nextAction.key === 'consent'
      ? '/consent'
      : nextAction.key === 'docs'
        ? '/docs-upload'
        : nextAction.key === 'hanwha'
          ? '/hanwha-commission'
          : '/appointment');
  const fcLicenseLabels = normalizeLicenseStatuses(myFc?.license_statuses)
    .filter((status) => status !== LICENSE_STATUS_NONE)
    .map((status) => LICENSE_STATUS_LABELS[status].replace(' 보험', ''));
  const boardActor = useMemo(
    () => (hydrated ? buildBoardActor({ role, residentId, displayName, readOnly }) : null),
    [displayName, hydrated, readOnly, residentId, role],
  );
  const { data: fcReferralInfo } = useMyReferralCode();
  const fcReferralCode = isFc ? fcReferralInfo?.code ?? null : null;
  const shareFcReferralCode = useCallback(async () => {
    if (!fcReferralCode) return;
    try {
      await Share.share({
        message: buildReferralShareText({
          code: fcReferralCode,
          inviteBaseUrl: process.env.EXPO_PUBLIC_INVITE_BASE_URL ?? '',
          appStoreUrl: (process.env.EXPO_PUBLIC_APP_STORE_URL ?? '').trim(),
        }),
      });
    } catch (err: unknown) {
      Alert.alert('공유 실패', err instanceof Error ? err.message : '추천 코드를 공유하지 못했습니다.');
    }
  }, [fcReferralCode]);
  const currentStepYoutube = FC_STAGE_YOUTUBE_PLACEHOLDERS[nextAction.key];
  const hasCurrentStepYoutubeUrl = Boolean(currentStepYoutube?.url);
  const openCurrentStepYoutube = useCallback(async () => {
    if (!currentStepYoutube?.url) {
      Alert.alert('준비 중', currentStepYoutube?.pendingMessage ?? `${nextAction.title} 영상은 준비 중입니다.`);
      return;
    }

    try {
      await openExternalUrl(currentStepYoutube.url);
    } catch {
      Alert.alert('오류', '단계별 영상을 열 수 없습니다.');
    }
  }, [currentStepYoutube?.pendingMessage, currentStepYoutube?.url, nextAction.title]);
  const managerReferralLink: QuickLink = {
    href: '/referral',
    title: '추천인 코드',
    description: '친구 초대 및 현황 확인',
  };
  const adminQuickLinks = adminHomeTab === 'exam' ? quickLinksAdminExam : quickLinksAdminOnboarding;
  const quickLinks =
    role === 'admin'
      ? isManagerExam
        ? canUseReferralSelfService
          ? [...quickLinksManagerExam, managerReferralLink, allowanceLink]
          : quickLinksManagerExam
        : readOnly && canUseReferralSelfService
        ? [...adminQuickLinks, managerReferralLink, allowanceLink]
        : adminQuickLinks
      : buildFcQuickLinks(myFc as FcProfile | null | undefined);
  const profileName = typeof myFc?.name === 'string' ? myFc.name.trim() : '';
  const tempIdValue = typeof myFc?.temp_id === 'string' ? myFc.temp_id.trim() : '';
  const hasTempId = tempIdValue.length > 0;
  const tempIdBadgeLabel = statusLoading
    ? '임시사번 확인 중'
    : hasTempId
      ? `임시사번 ${tempIdValue}`
      : '임시사번 미발급';
  const homeHeaderTitle = buildWelcomeTitle({
    role,
    readOnly,
    isRequestBoardDesigner,
    staffType,
    displayName,
    fcName: profileName,
    fallbackTitle: '홈',
  });

  const lifeCompleted = Boolean(myFc?.life_commission_completed || myFc?.appointment_date_life);
  const nonLifeCompleted = Boolean(myFc?.nonlife_commission_completed || myFc?.appointment_date_nonlife);
  const licenseStatusDisplay = myFc ? formatLicenseStatuses(myFc.license_statuses) : formatLicenseStatuses(null);
  const internalViewerContext = useMemo(
    () => ({
      role,
      residentId,
      readOnly,
      staffType,
      isRequestBoardDesigner,
    }),
    [isRequestBoardDesigner, readOnly, residentId, role, staffType],
  );
  const notificationInboxResidentId = useMemo(
    () => resolveNotificationInboxResidentId({
      role,
      residentId,
      readOnly,
      staffType,
    }),
    [readOnly, residentId, role, staffType],
  );

  // Unread Counts
  const {
    data: unreadMsgCount,
    isError: unreadMsgError,
    error: unreadMsgReadError,
    isFetching: unreadMsgFetching,
    refetch: refetchMsgCount,
  } = useQuery({
    queryKey: ['unread-msg-count', role, residentId, readOnly, staffType, isRequestBoardDesigner],
    queryFn: () => fetchInternalUnreadCount(internalViewerContext),
    enabled: !!role && !!residentId,
  });
  const hasUnreadMessages = !unreadMsgError
    && typeof unreadMsgCount === 'number'
    && unreadMsgCount > 0;
  const unreadMessageBadge = hasUnreadMessages
    ? (unreadMsgCount > 99 ? '99+' : String(unreadMsgCount))
    : '';

  const {
    data: unreadNotifCount = 0,
    refetch: refetchNotifCount,
    isSuccess: hasFetchedUnreadNotifCount,
    isError: unreadNotifError,
  } = useQuery({
    queryKey: ['unread-notif-count', role, notificationInboxResidentId, requestBoardRole],
    queryFn: () =>
      fetchMobileUnreadNotificationCountOrThrow({
        role,
        residentId: notificationInboxResidentId,
        requestBoardRole,
      }),
    enabled: !!role,
  });

  useEffect(() => {
    if (!hasFetchedUnreadNotifCount || unreadNotifError) {
      return;
    }

    void syncNativeNotificationBadge(unreadNotifCount, {
      context: 'home-unread-count',
      dismissPresentedWhenZero: true,
    });
  }, [hasFetchedUnreadNotifCount, unreadNotifCount, unreadNotifError]);

  // Refresh home badges and FC progress when returning to the screen.
  useFocusEffect(
    useCallback(() => {
      refetchMsgCount();
      refetchNotifCount();
      refetchLatestNotice?.();
      if (role === 'fc' && residentId) {
        refetchMyFc?.();
      }
    }, [refetchMsgCount, refetchNotifCount, refetchLatestNotice, refetchMyFc, residentId, role])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      refetchMsgCount();
      refetchNotifCount();
      refetchLatestNotice?.();
      if (role === 'fc' && residentId) {
        refetchMyFc?.();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [refetchMsgCount, refetchNotifCount, refetchLatestNotice, refetchMyFc, residentId, role]);

  // Android 뒤로가기 버튼: 앱 종료 확인 다이얼로그
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const onBackPress = () => {
        if (router.canGoBack()) return false;
        Alert.alert(
          '앱 종료',
          '앱을 종료하시겠습니까?',
          [
            { text: '취소', style: 'cancel' },
            { text: '종료', style: 'destructive', onPress: () => BackHandler.exitApp() },
          ],
          { cancelable: true }
        );
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [])
  );

  const getAppointmentStatus = (completed: boolean) => {
    if (completed) return { label: '완료', color: '#ffffff', bg: '#16a34a' };
    return { label: '대기', color: '#ffffff', bg: '#64748b' };
  };

  const lifeStatus = getAppointmentStatus(lifeCompleted);
  const nonLifeStatus = getAppointmentStatus(nonLifeCompleted);
  const completedCommissionCount = Number(lifeCompleted) + Number(nonLifeCompleted);

  useEffect(() => {
    if (!hydrated) return;
    if (isRequestBoardDesigner) {
      router.replace('/request-board');
    }
  }, [hydrated, isRequestBoardDesigner, role]);

  // 기본정보는 회원가입 시 이미 저장되므로 강제 리다이렉트 제거
  // 사용자가 홈 화면의 "기본 정보" 버튼을 눌러 자발적으로 편집 가능

  // 모바일 푸시 토큰 등록 (배너 알림 수신용)
  const handleLogout = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    appLogout();
  };

  const handleAdminTabChange = (tab: 'onboarding' | 'exam') => {
    if (tab === adminHomeTab) return;
    Haptics.selectionAsync();
    setAdminHomeTab(tab);
    if (tab === 'exam') {
      router.setParams({ mode: 'exam' } as any);
      return;
    }
    router.setParams({ mode: 'onboarding' } as any);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchCounts?.(),
        refetchMyFc?.(),
        refetchLatestNotice?.(),
        refetchLatestAdminMsg?.(),
        refetchExamStats?.(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchCounts, refetchLatestNotice, refetchLatestAdminMsg, refetchMyFc, refetchExamStats]);

  const handlePressLink = (href: string, stepKey?: StepKey) => {
    Haptics.selectionAsync();
    if (stepKey) {
      router.push(`/dashboard?status=${stepKey}` as any);
      return;
    }
    if (href === '/fc/new') {
      if (role === 'fc' && !canOpenFcProfileRegistration(myFc as FcProfile | null | undefined)) {
        Alert.alert('사전등록 필요', '본등록은 사전등록을 완료한 뒤 진행할 수 있습니다.');
        router.push('/signup');
        return;
      }
      router.push({ pathname: '/fc/new', params: { from: 'home' } } as any);
      return;
    }
    router.push(href as any);
  };

  const handleOpenLatestNotice = () => {
    Haptics.selectionAsync();
    const route = resolveHomeLatestNoticeRoute(latestNotice?.id ?? null);
    if (route) {
      router.push(route as any);
      return;
    }
    router.push('/notice');
  };

  const handleStatClick = (stepKey: StepKey) => {
    Haptics.selectionAsync();
    router.push(`/dashboard?status=${stepKey}` as any);
  };

  // 채팅에서 돌아올 때 최신 메시지 갱신
  useFocusEffect(
    useCallback(() => {
      if (role === 'fc' && residentId) {
        refetchLatestAdminMsg?.();
      }
    }, [refetchLatestAdminMsg, residentId, role]),
  );

  // 메시지 테이블은 서버 전용이므로 서명된 서비스 조회를 주기적으로 갱신한다.
  useEffect(() => {
    if (role !== 'fc' || !residentId) return;
    const intervalId = setInterval(
      () => void refetchLatestAdminMsg?.(),
      4_000,
    );
    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        if (nextState === 'active') {
          void refetchLatestAdminMsg?.();
        }
      },
    );

    return () => {
      clearInterval(intervalId);
      appStateSubscription.remove();
    };
  }, [refetchLatestAdminMsg, residentId, role]);

  // 실시간: 내 프로필 변경 시 진행도 갱신
  useEffect(() => {
    if (role !== 'fc' || !residentId) return;
    const profileChannel = supabase
      .channel(createHomeRealtimeChannelTopic('home-profile'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fc_profiles', filter: `phone=eq.${residentId}` },
        () => refetchMyFc?.(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, [role, residentId, refetchMyFc]);

  // 실시간: 내 서류 상태 변경 시 진행도 갱신
  useEffect(() => {
    if (role !== 'fc' || !myFc?.id) return;
    const docChannel = supabase
      .channel(createHomeRealtimeChannelTopic('home-documents'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fc_documents', filter: `fc_id=eq.${myFc.id}` },
        () => refetchMyFc?.(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(docChannel);
    };
  }, [role, myFc?.id, refetchMyFc]);

  // Do not reconcile the admin tree into the FC fallback while logout navigation
  // commits. A distinct root also prevents Fabric from reparenting those views.
  if (!hydrated || !role) {
    return (
      <SafeAreaView key="session-transition" style={styles.safe} edges={['left', 'right', 'bottom']}>
        <BrandedLoadingState variant="home" />
      </SafeAreaView>
    );
  }

  if (isRequestBoardDesigner) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <BrandedLoadingState
          variant="home"
          title="설계요청 화면으로 이동하고 있어요"
          subtitle="설계매니저 전용 홈을 준비하는 중입니다."
        />
      </SafeAreaView>
    );
  }

  const contentBottomPadding = (role === 'admin' ? 160 : 96) + (insets.bottom || 0);

  return (
    <SafeAreaView style={[styles.safe, isFc && styles.fcHomeSurface]} edges={['left', 'right', 'bottom']}>
      <NotificationReceiptStatusBanner
        state={notificationReceipt.state}
        onRetry={() => void notificationReceipt.retryMarkRead()}
      />
      <Animated.ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >

        <View
          ref={contentRef}
          collapsable={false}
          style={[styles.container, { paddingBottom: contentBottomPadding }, isFc && styles.fcHomeSurface]}
        >
          <AppTopActionBar
            title={homeHeaderTitle}
            onLogout={handleLogout}
            onOpenNotifications={() => router.push('/notifications')}
            notificationCount={hasFetchedUnreadNotifCount && !unreadNotifError ? unreadNotifCount : undefined}
          />
          <View style={styles.serviceHomeHeader}>
            <View style={styles.serviceHomeLinkRow}>
              <Text style={styles.serviceContextText}>보험·FC</Text>
              {role === 'admin' && (
                <View pointerEvents="none" style={styles.homeTitleWrap}>
                  <Text style={styles.homeTitle}>
                    {adminHomeTab === 'exam' ? '시험' : '위촉'}
                  </Text>
                </View>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="전체 서비스"
                onPress={() => router.replace('/')}
                style={({ pressed }) => [styles.serviceHomeLink, pressed && styles.pressedOpacity]}
              >
                <Feather name="grid" size={16} color={TEXT_MUTED} />
                <Text style={styles.serviceHomeLinkText}>전체 서비스</Text>
                <Feather name="chevron-right" size={16} color={TEXT_MUTED} />
              </Pressable>
            </View>
            {role === 'admin' && (
              <Text style={styles.homeSubtitleText}>
                {isManagerExam
                  ? '시험 일정과 신청자 명단을 확인하고 직접 시험도 접수할 수 있어요.'
                  : adminHomeTab === 'exam'
                  ? '시험 일정·신청자 관리와 FC 대리 신청 메뉴를 모았습니다.'
                  : '위촉/서류 진행 현황과 주요 업무를 확인하세요.'}
              </Text>
            )}
          </View>

          <Stack.Screen
            options={{
              headerShown: false,
            }}
          />



          {isFc ? null : latestNoticeError ? (
            <QueryReadState error={latestNoticeReadError} message="최신 공지를 불러오지 못했습니다." onRetry={() => void refetchLatestNotice()} retrying={latestNoticeFetching} />
          ) : (
            <AndroidSafeMotiView from={{ opacity: 0, translateY: -10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 500 }}>
              <Pressable
                style={({ pressed }) => [styles.notice, pressed && styles.pressedOpacity]}
                onPress={handleOpenLatestNotice}>
                <View style={styles.noticeDot} />
                <Text style={styles.noticeText} numberOfLines={1}>
                  {latestNoticeLoading ? '최신 공지를 불러오는 중...' : formatLatestNoticeLabel(latestNotice)}
                </Text>
                <Feather name="chevron-right" size={16} color={HANWHA_ORANGE} style={{ marginLeft: 'auto' }} />
              </Pressable>
            </AndroidSafeMotiView>
          )}

          <AndroidSafeMotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 600, delay: 200 }}
          >
            {role === 'admin' ? (
              showsExamManagementHome ? (
                <View style={styles.examSummaryCard}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.sectionTitle}>시험 관리 요약</Text>
                    <Text style={styles.sectionHint}>
                      {isManagerExam ? '신청자 현황을 확인하고 필요한 시험을 접수하세요' : '등록 · 신청자 메뉴만 모았습니다'}
                    </Text>
                  </View>
                  {examStatsError && <QueryReadState error={examStatsReadError} message="시험 현황을 불러오지 못했습니다." onRetry={() => void refetchExamStats()} retrying={examStatsFetching} />}
                  <Pressable
                    style={({ pressed }) => [styles.examStatRow, pressed && styles.pressedOpacity]}
                    onPress={() => handlePressLink('/exam-manage')}
                  >
                    <View style={styles.examStatTitleWrap}>
                      <Text style={styles.examStatTitle}>생명/제3보험</Text>
                      {examStatsLoading && <BrandedLoadingSpinner size="sm" color={HANWHA_ORANGE} />}
                    </View>
                    <View style={styles.examStatChips}>
                      <View style={styles.examStatChip}>
                        <Text style={styles.examStatChipLabel}>응시자</Text>
                        <Text style={styles.examStatChipValue}>{formatHomeCount(examStats?.lifeTotal, examStatsError)}</Text>
                      </View>
                      <View style={[styles.examStatChip, styles.examStatChipPending]}>
                        <Text style={styles.examStatChipLabel}>미접수</Text>
                        <Text style={[styles.examStatChipValue, styles.examStatChipValuePending]}>
                          {formatHomeCount(examStats?.lifePending, examStatsError)}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.examStatRow, pressed && styles.pressedOpacity]}
                    onPress={() => handlePressLink('/exam-manage2')}
                  >
                    <View style={styles.examStatTitleWrap}>
                      <Text style={styles.examStatTitle}>손해보험</Text>
                      {examStatsLoading && <BrandedLoadingSpinner size="sm" color={HANWHA_ORANGE} />}
                    </View>
                    <View style={styles.examStatChips}>
                      <View style={styles.examStatChip}>
                        <Text style={styles.examStatChipLabel}>응시자</Text>
                        <Text style={styles.examStatChipValue}>{formatHomeCount(examStats?.nonlifeTotal, examStatsError)}</Text>
                      </View>
                      <View style={[styles.examStatChip, styles.examStatChipPending]}>
                        <Text style={styles.examStatChipLabel}>미접수</Text>
                        <Text style={[styles.examStatChipValue, styles.examStatChipValuePending]}>
                          {formatHomeCount(examStats?.nonlifePending, examStatsError)}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.metricsCard}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.sectionTitle}>현황 요약</Text>
                  </View>
                  <View style={styles.metricsGrid}>
                    {countsError ? (
                      <QueryReadState error={countsReadError} message="FC 현황을 불러오지 못했습니다." onRetry={() => void refetchCounts()} retrying={countsFetching} />
                    ) : isLoading ? (
                      <>
                        <Skeleton width="48%" height={90} />
                        <Skeleton width="48%" height={90} />
                        <Skeleton width="48%" height={90} />
                        <Skeleton width="48%" height={90} />
                      </>
                    ) : counts ? (
                      <>
                        {ADMIN_METRIC_CONFIG.map((metric) => (
                          <MetricCard
                            key={metric.label}
                            label={metric.label}
                            value={formatHomeCount(counts.steps[metric.key], countsError)}
                            onPress={() => handleStatClick(metric.key)}
                          />
                        ))}
                      </>
                    ) : null}
                  </View>
                </View>
              )
            ) : isFc ? (
              <View ref={zone1Ref} collapsable={false}>
                <TourGuideZone
                  zone={1}
                  text="현재 위촉 진행 단계와 다음에 할 일을 여기서 확인해요."
                  borderRadius={24}
                  maskOffset={6}
                >
                  <FcHomeSectionBoundary title="내 진행 상황">
                    <FcHomeProgressCard
                      steps={fcHomeSteps}
                      currentStep={currentStep}
                      loading={statusLoading}
                      storageScope={residentId || null}
                      hasTempId={hasTempId}
                      tempIdLabel={tempIdBadgeLabel}
                      nextTitle={nextAction.title}
                      nextSubtitle={nextAction.subtitle}
                      onPressNext={() => handlePressLink(nextActionRoute)}
                      lifeCompleted={lifeCompleted}
                      nonLifeCompleted={nonLifeCompleted}
                      licenseLabels={fcLicenseLabels}
                    />
                  </FcHomeSectionBoundary>
                </TourGuideZone>
              </View>
            ) : (
              <View style={styles.progressCard}>
                <View style={styles.cardHeader}>
                  <Text style={styles.sectionTitle}>내 진행 상황</Text>
                  <Text style={styles.progressMeta}>Step {currentStep}/5</Text>
                </View>
                {statusLoading ? (
                  <View style={{ marginVertical: 20 }}>
                    <Skeleton width="100%" height={60} style={{ marginBottom: 12 }} />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Skeleton width="48%" height={80} />
                      <Skeleton width="48%" height={80} />
                    </View>
                  </View>
                ) : (
                  <>
                    <View style={styles.statusRow}>
                      <View style={styles.statusItem}>
                        <Text style={styles.statusLabel}>생명 위촉</Text>
                        <View style={[styles.statusBadge, { backgroundColor: lifeStatus.bg }]}>
                          <Text style={[styles.statusText, { color: lifeStatus.color }]}>{lifeStatus.label}</Text>
                        </View>
                      </View>
                      <View style={styles.statusDivider} />
                      <View style={styles.statusItem}>
                        <Text style={styles.statusLabel}>손해 위촉</Text>
                        <View style={[styles.statusBadge, { backgroundColor: nonLifeStatus.bg }]}>
                          <Text style={[styles.statusText, { color: nonLifeStatus.color }]}>{nonLifeStatus.label}</Text>
                        </View>
                      </View>
                    </View>
                    <Text style={styles.statusSummaryText}>위촉 완료 {completedCommissionCount}/2</Text>
                    <Text style={styles.licenseSummaryText}>
                      자격증 보유 현황: {licenseStatusDisplay}
                    </Text>
                    <View style={styles.stepContainer}>
                      {fcHomeSteps.map((step, index) => {
                        const stepNum = index + 1;
                        const isActive = stepNum === currentStep;
                        const isDone = stepNum < currentStep;
                        return (
                          <View key={step.key} style={styles.stepWrapper}>
                            {index < fcHomeSteps.length - 1 && (
                              <View style={[styles.stepConnector, isDone && styles.stepConnectorDone]} />
                            )}
                            <View style={[styles.stepCircle, isActive && styles.stepCircleActive, isDone && styles.stepCircleDone]}>
                              {isDone ? (
                                <Feather name="check" size={14} color="#fff" />
                              ) : (
                                <Text style={[styles.stepNumber, isActive && styles.stepNumberActive]}>{stepNum}</Text>
                              )}
                            </View>
                            <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>{step.label}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </>
                )}
                <View style={styles.glanceRow}>
                  <Pressable
                    onPress={() => {
                      handlePressLink(nextActionRoute);
                    }}
                    style={({ pressed }) => [
                      { flex: 1 },
                      pressed && styles.pressedScale,
                    ]}
                    >
                    <View style={styles.premiumStepCard}>
                      <View style={styles.premiumStepContent}>
                        <View style={styles.premiumStepHeader}>
                          <View style={styles.premiumStepBadge}>
                            <Text style={styles.premiumStepBadgeText}>다음 단계</Text>
                          </View>
                          <View style={styles.premiumStepIcon}>
                            <Feather name="arrow-right" size={20} color="#fff" />
                          </View>
                        </View>
                        <Text style={styles.premiumStepTitle} numberOfLines={1}>
                          {nextAction.title}
                        </Text>
                        <Text style={styles.premiumStepSub}>
                          {nextAction.subtitle}
                        </Text>
                      </View>
                      <View style={styles.premiumStepDeco1} />
                      <View style={styles.premiumStepDeco2} />
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={openCurrentStepYoutube}
                    accessibilityRole="button"
                    accessibilityLabel={`${nextAction.title} 유튜브 가이드`}
                    accessibilityHint={
                      hasCurrentStepYoutubeUrl
                        ? '현재 단계 영상 가이드를 엽니다.'
                        : '현재 단계 영상이 준비 중임을 안내합니다.'
                    }
                    style={({ pressed }) => [
                      styles.stepYoutubeButton,
                      !hasCurrentStepYoutubeUrl && styles.stepYoutubeButtonPending,
                      pressed && styles.pressedOpacity,
                    ]}
                  >
                    <View
                      style={[
                        styles.stepYoutubeIcon,
                        !hasCurrentStepYoutubeUrl && styles.stepYoutubeIconPending,
                      ]}
                    >
                      <Feather
                        name="youtube"
                        size={18}
                        color={hasCurrentStepYoutubeUrl ? '#DC2626' : '#9CA3AF'}
                      />
                    </View>
                    <Text
                      style={[
                        styles.stepYoutubeTitle,
                        !hasCurrentStepYoutubeUrl && styles.stepYoutubeTitlePending,
                      ]}
                    >
                      영상
                    </Text>
                    <Text
                      style={[
                        styles.stepYoutubeStatus,
                        !hasCurrentStepYoutubeUrl && styles.stepYoutubeStatusPending,
                      ]}
                      numberOfLines={1}
                    >
                      {hasCurrentStepYoutubeUrl ? '보기' : '준비 중'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )
            }
          </AndroidSafeMotiView>

          {unreadMsgError && (
            <QueryReadState
              error={unreadMsgReadError}
              message="읽지 않은 메시지 수를 불러오지 못했습니다."
              onRetry={() => void refetchMsgCount()}
              retrying={unreadMsgFetching}
            />
          )}

          {!(role === 'admin' && adminHomeTab === 'exam') && (
            <>
              {role === 'admin' ? (
                <AndroidSafeMotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', delay: 100 }}>
                  <Pressable onPress={() => handlePressLink('/dashboard', 'step4')}>
                    <View style={styles.ctaCard}>
                      <View style={styles.ctaContent}>
                        <View style={[styles.ctaBadge, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                          <Text style={styles.ctaBadgeText}>관리자 할 일</Text>
                        </View>
                        <Text style={styles.ctaTitle}>
                          {countsError ? '서류 대기 현황 확인 불가' : isLoading || !counts ? '현황 조회 중...' : `서류 대기 ${counts.steps.step4}건`}
                        </Text>
                        <Text style={styles.ctaSub}>승인을 기다리는 FC 서류를 검토해주세요.</Text>
                      </View>
                      <View style={[styles.ctaIconCircle, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
                        <Feather name="file-text" size={24} color="#fff" />
                      </View>
                      <View style={styles.ctaDecoCircle} />
                    </View>
                  </Pressable>
                </AndroidSafeMotiView>
              ) : isFc ? (
                <>
                  <View ref={zone2Ref} collapsable={false}>
                    <TourGuideZone zone={2} text="총무팀 메시지를 확인하고 메신저로 이동해요." borderRadius={24}>
                      <FcHomeSectionBoundary title="메시지">
                        <FcHomeMessages
                          preview={
                            latestAdminMsgLoading
                              ? '메시지 불러오는 중'
                              : latestAdminMsgError
                                ? '최근 메시지를 확인할 수 없습니다'
                                : latestAdminMsg?.content || '최근 메시지가 없습니다'
                          }
                          timeLabel={formatHomeRelativeTime(latestAdminMsg?.created_at) || null}
                          unreadCount={hasUnreadMessages ? Number(unreadMsgCount) : 0}
                          onOpenMessenger={() => handlePressLink('/messenger')}
                        />
                      </FcHomeSectionBoundary>
                    </TourGuideZone>
                  </View>
                  <View ref={zone3Ref} collapsable={false}>
                    <TourGuideZone zone={3} text="열려 있는 시험 회차와 마감일을 보고 바로 신청해요." borderRadius={24}>
                      <FcHomeSectionBoundary title="시험 접수">
                        <FcHomeExamRounds sessionScope={sessionScope} onOpen={handlePressLink} />
                      </FcHomeSectionBoundary>
                    </TourGuideZone>
                  </View>
                  <View ref={zone4Ref} collapsable={false}>
                    <TourGuideZone zone={4} text="최신 공지와 게시판 새 글을 확인해요." borderRadius={24}>
                      <FcHomeSectionBoundary title="새 소식">
                        <FcHomeNews
                          actor={boardActor}
                          sessionScope={sessionScope}
                          latestNotice={latestNoticeError ? { title: '최신 공지를 불러오지 못했습니다' } : latestNotice}
                          latestNoticeLoading={latestNoticeLoading}
                          onOpenNotice={handleOpenLatestNotice}
                          onOpenPost={(postId) => router.push({ pathname: '/board', params: { postId } } as any)}
                          onOpenBoard={() => router.push('/board')}
                        />
                      </FcHomeSectionBoundary>
                    </TourGuideZone>
                  </View>
                </>
              ) : (
                <AndroidSafeMotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', delay: 100 }}>
                  <Pressable onPress={() => handlePressLink('/messenger')}>
                    <View style={styles.ctaCard}>
                      <View style={styles.ctaContent}>
                        <View style={styles.ctaBadge}>
                          <Text style={styles.ctaBadgeText}>메신저</Text>
                        </View>
                        <Text style={styles.ctaTitle}>통합 메신저 열기</Text>
                        <Text style={styles.ctaSub} numberOfLines={2}>
                          {latestAdminMsgLoading
                            ? '메시지 불러오는 중...'
                            : latestAdminMsgError
                                  ? '최근 메시지를 확인할 수 없습니다. 메신저에서 다시 확인해주세요.'
                                  : latestAdminMsg?.content
                              ? latestAdminMsg.content
                              : '최근 총무팀 메시지를 확인하세요.'}
                        </Text>
                      </View>
                      <View style={styles.ctaIconCircle}>
                        <Feather name="message-circle" size={24} color={HANWHA_ORANGE} />
                      </View>
                      <View style={styles.ctaDecoCircle} />
                    </View>
                  </Pressable>
                </AndroidSafeMotiView>
              )}
            </>
          )}

          {isFc ? (
            <FcHomeSectionBoundary title="바로가기">
              <FcHomeShortcuts
                links={quickLinks.filter((item) => item.href !== '/messenger')}
                referralCode={fcReferralCode}
                onOpen={(href) => handlePressLink(href)}
                onShareReferral={() => void shareFcReferralCode()}
                onHowTo={openHowToOptions}
                renderTile={(tile, link, index) => (
                  <View
                    collapsable={false}
                    ref={(node) => {
                      shortcutZoneRefs.current[index] = node;
                    }}
                  >
                    <ShortcutTourGuideZone
                      zone={index + 1}
                      text={SHORTCUT_TOUR_TEXTS[link.href] ?? `${link.title} 메뉴예요.`}
                      borderRadius={16}
                    >
                      {tile}
                    </ShortcutTourGuideZone>
                  </View>
                )}
              />
            </FcHomeSectionBoundary>
          ) : (
            <>
          <View style={styles.linksSection}>
            <Text style={styles.sectionTitle}>
              {role === 'admin' && isManagerExam
                ? '시험 관리/신청 바로가기'
                : role === 'admin' && isAdminExam
                ? '시험 관리/대리 신청 바로가기'
                : '바로가기'}
            </Text>
            {role === 'admin' && showsExamManagementHome ? (
              <Text style={styles.sectionHint}>
                {isManagerExam
                  ? '시험 목록·신청자 명단과 FC 대리 신청 메뉴를 모았습니다'
                  : '시험 등록·신청자 관리와 FC 대리 신청 메뉴를 모았습니다'}
              </Text>
            ) : null}
          </View>

          <View style={styles.actionGrid}>
            {quickLinks.map((item, index) => {
              const key = `${item.href}-${item.stepKey ?? item.title ?? index}`;
              const isMessengerShortcut = item.href === '/messenger';
              const messengerUnreadBadge = unreadMessageBadge;
              const card = (
                <AndroidSafeMotiView
                  from={{ opacity: 0, translateY: 20 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'spring', delay: 300 + index * 50 }}
                  style={{ width: '100%' }}
                >
                  <Pressable
                    style={({ pressed }) => [styles.actionCardGrid, pressed && styles.pressedScale]}
                    accessibilityRole="button"
                    accessibilityLabel={
                      isMessengerShortcut && hasUnreadMessages
                        ? `${item.title}, 읽지 않은 메시지 ${messengerUnreadBadge}개`
                        : item.title
                    }
                    onPress={() => handlePressLink(item.href as any, item.stepKey)}>
                    <View style={styles.iconCircle}>
                      <Feather
                        name={getLinkIcon(item.stepKey ? `${item.href}?status=${item.stepKey}` : item.href)}
                        size={22}
                        color={CHARCOAL}
                      />
                      {isMessengerShortcut && hasUnreadMessages ? (
                        <View style={styles.quickLinkUnreadBadge}>
                          <Text style={styles.quickLinkUnreadBadgeText}>{messengerUnreadBadge}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.actionTitleGrid} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.actionDescGrid} numberOfLines={2}>{item.description}</Text>
                  </Pressable>
                </AndroidSafeMotiView>
              );

              return (
                <View key={key} style={{ width: '48%' }}>
                  {card}
                </View>
              );
            })}
          </View>
            </>
          )}
        </View >
      </Animated.ScrollView >

      <BottomNavigation
        preset={bottomNavPreset ?? undefined}
        activeKey={bottomNavActiveKey}
        onAdminTabChange={
          isAdminLikePreset ? handleAdminTabChange : undefined
        }
        bottomInset={insets.bottom}
      />
      {
        isTourBlocking && (
          <Pressable
            style={[StyleSheet.absoluteFillObject, { zIndex: 9999, elevation: 9999 }]}
            onPress={() => { }}
            onPressIn={() => { }}
          />
        )
      }
    </SafeAreaView >
  );
}

const MetricCard = ({ label, value, onPress }: { label: string; value: string; onPress: () => void }) => {
  return (
    <Pressable style={styles.metricItem} onPress={onPress}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  // FC home sections are white cards on a gray page so each area reads separately.
  fcHomeSurface: { backgroundColor: '#f3f4f6' },
  scroll: { flex: 1 },
  container: {
    paddingBottom: 20,
    backgroundColor: '#fff',
  },
  serviceHomeHeader: {
    marginBottom: 6,
  },
  serviceHomeLinkRow: {
    marginHorizontal: 20,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  serviceContextText: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
  serviceHomeLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  serviceHomeLinkText: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
  homeTitleWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  homeTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: CHARCOAL,
    textAlign: 'center',
  },
  homeSubtitleText: {
    marginHorizontal: 20,
    marginTop: 4,
    color: TEXT_MUTED,
    fontSize: 14,
    textAlign: 'center',
  },
  notice: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16, // Increased padding
    backgroundColor: ORANGE_FAINT,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: HANWHA_ORANGE,
  },
  noticeText: {
    flex: 1,
    fontSize: 16, // 13 -> 16
    color: CHARCOAL,
    fontWeight: '500',
  },
  pressedOpacity: { opacity: 0.7 },
  pressedScale: { transform: [{ scale: 0.98 }] },
  // CTA
  ctaCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: HANWHA_ORANGE,
  },
  ctaContent: { zIndex: 1 },
  ctaBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
  },
  ctaBadgeText: { color: '#fff', fontWeight: '700', fontSize: 13 }, // 11 -> 13
  ctaTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
  },
  ctaSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 20,
  },
  examPillRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  examPill: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  examPillText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  ctaIconCircle: {
    position: 'absolute',
    right: 20,
    top: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDecoCircle: {
    position: 'absolute',
    right: -40,
    bottom: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  // Metrics
  metricsCard: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20, // 18 -> 20
    fontWeight: '700',
    color: CHARCOAL,
  },
  sectionHint: { fontSize: 13, color: TEXT_MUTED, marginTop: 4 },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricItem: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    ...CARD_SHADOW,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 24, // 20 -> 24
    fontWeight: '800',
    color: HANWHA_ORANGE,
    marginBottom: 4,
  },
  metricLabel: {
    fontSize: 15, // 13 -> 15
    color: TEXT_MUTED,
    fontWeight: '500',
  },
  examSummaryCard: {
    marginHorizontal: 20,
    marginBottom: 24,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    ...CARD_SHADOW,
  },
  examSummaryGrid: { gap: 12 },
  examSummaryItem: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  examSummaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: ORANGE_FAINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  examSummaryTitle: { fontSize: 16, fontWeight: '700', color: CHARCOAL },
  examSummaryDesc: { fontSize: 14, color: TEXT_MUTED, lineHeight: 20 },
  examStatRow: {
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  examStatTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  examStatTitle: { fontSize: 15, fontWeight: '800', color: CHARCOAL },
  examStatChips: { flexDirection: 'row', gap: 10 },
  examStatChip: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: '#F9FAFB',
    padding: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  examStatChipPending: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  examStatChipLabel: { fontSize: 12, color: TEXT_MUTED, marginBottom: 6, fontWeight: '700' },
  examStatChipValue: { fontSize: 18, fontWeight: '800', color: CHARCOAL },
  examStatChipValuePending: { color: '#b45309' },
  // Progress
  progressCard: {
    marginHorizontal: 20,
    marginBottom: 24,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    ...CARD_SHADOW,
  },
  progressMeta: { fontSize: 15, fontWeight: '700', color: HANWHA_ORANGE }, // 13 -> 15
  progressHeaderActions: {
    alignItems: 'flex-end',
    gap: 6,
    flexShrink: 1,
    maxWidth: '60%',
  },
  tempIdBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  tempIdBadgeIssued: {
    backgroundColor: '#ECFDF5',
    borderColor: '#BBF7D0',
  },
  tempIdBadgeMissing: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  tempIdBadgeText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
  },
  tempIdBadgeTextIssued: { color: '#166534' },
  tempIdBadgeTextMissing: { color: '#9A3412' },
  statusRow: { flexDirection: 'row', marginBottom: 20, alignItems: 'center' },
  statusItem: { flex: 1, alignItems: 'center' },
  statusLabel: { fontSize: 14, color: TEXT_MUTED, marginBottom: 6 }, // 12 -> 14
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 13, fontWeight: '700' }, // 11 -> 13
  statusDivider: { width: 1, height: 24, backgroundColor: BORDER, marginHorizontal: 12 },
  statusSummaryText: {
    marginTop: 2,
    marginBottom: 10,
    textAlign: 'center',
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: '600',
  },
  licenseSummaryText: {
    marginTop: -4,
    marginBottom: 12,
    textAlign: 'center',
    color: CHARCOAL,
    fontSize: 13,
    fontWeight: '700',
  },
  glanceRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 1,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  stepYoutubeButton: {
    width: 92,
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  stepYoutubeButtonPending: {
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  stepYoutubeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepYoutubeIconPending: {
    backgroundColor: '#F3F4F6',
  },
  stepYoutubeTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#991B1B',
  },
  stepYoutubeTitlePending: {
    color: '#6B7280',
  },
  stepYoutubeStatus: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B91C1C',
  },
  stepYoutubeStatusPending: {
    color: '#9CA3AF',
  },
  glancePill: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
  },
  glancePrimary: { backgroundColor: ORANGE_FAINT },
  glanceGhost: { backgroundColor: '#F9FAFB' },
  glanceLabel: { fontSize: 13, color: TEXT_MUTED, marginBottom: 4 }, // 11 -> 13
  glanceValue: { fontSize: 16, fontWeight: '700', color: CHARCOAL }, // 14 -> 16
  // Links
  linksSection: {
    marginHorizontal: 20,
    marginBottom: 12,
  },
  actionGrid: {
    marginHorizontal: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionCardGrid: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
    ...CARD_SHADOW,
    minHeight: 120, // Increased height to accommodate larger text
  },
  iconCircle: {
    position: 'relative',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  quickLinkUnreadBadge: {
    position: 'absolute',
    top: -7,
    right: -9,
    minWidth: 23,
    height: 23,
    paddingHorizontal: 5,
    borderRadius: 12,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLinkUnreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
  actionTitleGrid: {
    fontSize: 17, // 15 -> 17
    fontWeight: '700',
    color: CHARCOAL,
    marginBottom: 4,
  },
  actionDescGrid: {
    fontSize: 14, // 12 -> 14
    color: TEXT_MUTED,
    lineHeight: 18,
  },
  // Step
  stepContainer: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  stepWrapper: { flex: 1, alignItems: 'center', position: 'relative' },
  stepConnector: {
    position: 'absolute',
    top: 12,
    left: '50%',
    width: '100%',
    height: 2,
    backgroundColor: '#E5E7EB',
    zIndex: -1,
  },
  stepConnectorDone: { backgroundColor: HANWHA_ORANGE },
  stepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    zIndex: 1,
  },
  stepCircleActive: { borderColor: HANWHA_ORANGE, backgroundColor: '#fff' },
  stepCircleDone: { backgroundColor: HANWHA_ORANGE, borderColor: HANWHA_ORANGE },
  stepNumber: { fontSize: 12, color: '#6B7280', fontWeight: '700' }, // 11 -> 12
  stepNumberActive: { color: HANWHA_ORANGE },
  stepLabel: { fontSize: 12, color: '#9CA3AF', textAlign: 'center' }, // 11 -> 12
  stepLabelActive: { color: CHARCOAL, fontWeight: '700' },
  premiumStepCard: {
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 24,
    marginHorizontal: 4,
    overflow: 'hidden',
    position: 'relative',
    height: 120, // Taller for impact
    justifyContent: 'center',
    shadowColor: '#f36f21',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
    backgroundColor: HANWHA_ORANGE,
  },
  premiumStepContent: {
    zIndex: 10,
    position: 'relative',
  },
  premiumStepHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  premiumStepBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  premiumStepBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  premiumStepIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumStepTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
    letterSpacing: 0,
  },
  premiumStepSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '500',
  },
  premiumStepDeco1: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  premiumStepDeco2: {
    position: 'absolute',
    bottom: -30,
    left: -10,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  // Guide Card (Senior Friendly)
  guideCard: {
    marginHorizontal: 20,
    marginBottom: 5,
    borderRadius: 20,
    backgroundColor: '#FFF7ED', // Light Orange (Warm)
    borderWidth: 1,
    borderColor: '#FED7AA', // Orange-200
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  guidePressable: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12, // 24 -> 12
    gap: 10, // 16 -> 10
  },
  guideIconCircle: {
    width: 36, // 64 -> 36
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FED7AA',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  guideTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  guideTitle: {
    fontSize: 15, // 20 -> 15
    fontWeight: '800',
    color: '#9A3412', // Orange-900 (High contrast)
    marginBottom: 2,
  },
  guideSubTitle: {
    fontSize: 12, // 15 -> 12
    color: '#C2410C', // Orange-700
    fontWeight: '500',
    lineHeight: 16,
  },


});
